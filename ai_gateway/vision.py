"""Čtení obrazovky modelem (priorita 1 z handoffu): snímek → NEOVĚŘENÁ pozorování.

Výstup má vždy štítek `vision_unverified`. Nikdy to není „OCR PASS“ ani „vision PASS“:
čtení se musí teprve změřit na skutečných screenshotech FM27 s ověřenou pravdou
(`screenshot_verified`). Do té doby jsou hodnoty nejvýš `inferred` a `advise()` na nich
nepostaví vysokou jistotu.

Ochrana proti vymýšlení: každý údaj musí nést `evidence_text` (doslovný text z obrázku) a
`value` v něm musí být obsaženo. Údaje, které tuto kontrolu nepřežijí, se zahodí a vypíšou
se v `dropped`. Model nic neinterpretuje ani neradí; jen přepisuje.

Kdy snímek poslat (změna obrazovky, frekvence, deduplikace, rozpočet) rozhoduje filtr snímků
na straně klienta/desktopu. Tento modul vždy vyžaduje výslovnou akci uživatele
(`user_initiated=True`): žádné tiché odesílání obrazu.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Mapping
from typing import Any

from .advise import IMAGE_TYPES, MAX_IMAGE_BYTES
from .costs import Budget, Ledger
from .providers import ProviderError, Router

SCREEN_TYPES = ("match", "match_stats", "tactics", "squad", "other", "unreadable")
MAX_FIELDS = 40
MAX_KEY = 40
MAX_VALUE = 120
MAX_EVIDENCE = 200

_STR = {"type": "string"}
SCREEN_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "screen_type": {"type": "string", "enum": list(SCREEN_TYPES)},
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"key": _STR, "value": _STR, "evidence_text": _STR},
                "required": ["key", "value", "evidence_text"],
                "additionalProperties": False,
            },
        },
        "unreadable": {"type": "array", "items": _STR},
    },
    "required": ["screen_type", "fields", "unreadable"],
    "additionalProperties": False,
}

VISION_SYSTEM_PROMPT_CS = """Jsi čtečka obrazovky pro FM27 Tactical Coach. Dostaneš jeden snímek obrazovky hry. Úkol: přepsat DOSLOVA čitelné údaje, nic víc. Odpovídáš výhradně jedním JSON objektem podle schématu.

Pravidla:
1. Do `fields` dej jen údaje, které jsou na snímku čitelné. U každého uveď `key` (krátký popis, co údaj je), `value` a `evidence_text` = přesný text z obrázku, ze kterého `value` pochází. `value` musí být obsaženo v `evidence_text`.
2. Nehádej, nedopočítávej a nevymýšlej názvy rolí ani nastavení FM27. Co nejde přečíst, popiš stručně v `unreadable`.
3. `screen_type`: match (probíhající zápas), match_stats (statistiky zápasu), tactics (obrazovka taktiky), squad (soupiska), other, unreadable.
4. Nic neinterpretuješ a neradíš: žádná diagnóza, žádné doporučení."""


def _norm(text: str) -> str:
    return re.sub(r"\s+", "", text).casefold()


def validate_screen(result: Any) -> tuple[list[dict[str, str]], list[str], list[str]]:
    """Vrátí (platné údaje, důvody zahozených údajů, chyby struktury)."""
    if not isinstance(result, Mapping):
        return [], [], ["Odpověď není JSON objekt."]
    errors: list[str] = []
    if result.get("screen_type") not in SCREEN_TYPES:
        errors.append(f"Neplatný screen_type {result.get('screen_type')!r}.")
    raw_fields = result.get("fields")
    if not isinstance(raw_fields, list):
        errors.append("fields musí být seznam.")
        raw_fields = []
    unreadable = result.get("unreadable")
    if not (isinstance(unreadable, list) and all(isinstance(item, str) for item in unreadable)):
        errors.append("unreadable musí být seznam textů.")
    if errors:
        return [], [], errors

    clean: list[dict[str, str]] = []
    dropped: list[str] = []
    seen: set[tuple[str, str]] = set()
    for index, raw in enumerate(raw_fields, start=1):
        if not isinstance(raw, Mapping) or not all(isinstance(raw.get(k), str) for k in ("key", "value", "evidence_text")):
            dropped.append(f"pole {index}: špatná struktura")
            continue
        key, value, evidence = (raw[k].strip() for k in ("key", "value", "evidence_text"))
        if not key or not value or not evidence:
            dropped.append(f"pole {index} ({key or '?'}): chybí klíč, hodnota nebo doslovný text z obrázku")
        elif len(key) > MAX_KEY or len(value) > MAX_VALUE or len(evidence) > MAX_EVIDENCE:
            dropped.append(f"pole {index} ({key[:20]}): příliš dlouhé")
        elif _norm(value) not in _norm(evidence):
            dropped.append(f"pole {index} ({key}): hodnota „{value}“ není obsažena v doslovném textu z obrázku")
        elif (key.casefold(), _norm(value)) in seen:
            dropped.append(f"pole {index} ({key}): duplicita")
        else:
            seen.add((key.casefold(), _norm(value)))
            clean.append({"key": key, "value": value, "evidence_text": evidence})
    if len(clean) > MAX_FIELDS:
        dropped.append(f"nad limit {MAX_FIELDS} polí: zahozeno {len(clean) - MAX_FIELDS}")
        clean = clean[:MAX_FIELDS]
    return clean, dropped, []


def fields_to_observations(result: Mapping[str, Any], *, minute: int | None = None, prefix: str = "vis") -> list[dict[str, Any]]:
    """Pozorování pro `advise()`: štítek `vision_unverified`, tedy nejvýš `inferred`."""
    screen = result.get("screen_type") or "other"
    return [
        {
            "id": f"{prefix}-{index}",
            "label": "vision_unverified",
            "minute": minute,
            "text": f"[{screen}] {field['key']}: {field['value']} (z obrazovky: „{field['evidence_text']}“)",
        }
        for index, field in enumerate(result.get("fields") or [], start=1)
    ]


def _result(status: str, message: str | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "status": status,
        "provenance": "stub" if status == "stub" else "vision_unverified",
        "screen_type": None,
        "fields": [],
        "unreadable": [],
        "dropped": [],
        "errors": [message] if message else [],
        "warnings": [],
        "model": None,
        "usage": None,
        "cost_usd": None,
        "request_id": None,
        **extra,
    }


def extract_screen(
    image: Mapping[str, Any],
    *,
    router: Router | None,
    ledger: Ledger | None = None,
    budget: Budget | None = None,
    user_initiated: bool = False,
    hint: str | None = None,
) -> dict[str, Any]:
    """Pošle JEDEN snímek modelu a vrátí zvalidované, neověřené údaje."""
    if user_initiated is not True:
        return _result("refused_privacy", "Obraz se neodesílá bez výslovné akce uživatele (user_initiated).")
    if image.get("media_type") not in IMAGE_TYPES:
        return _result("error", f"Nepodporovaný typ obrázku {image.get('media_type')!r}.")
    try:
        decoded = base64.b64decode(str(image.get("data_b64") or ""), validate=True)
    except (binascii.Error, ValueError):
        return _result("error", "Obrázek není platné base64.")
    if not decoded or len(decoded) > MAX_IMAGE_BYTES:
        return _result("error", f"Obrázek je prázdný nebo větší než {MAX_IMAGE_BYTES // (1024 * 1024)} MiB.")
    if router is None or not router.available("vision"):
        reason = router.why_unavailable("vision") if router is not None else "Router není nastaven."
        return _result("stub", f"Bez AI (stub): {reason}")
    if budget is not None:
        allowed, why = budget.check()
        if not allowed:
            return _result("budget_exceeded", why or "Vyčerpán limit nákladů.")

    text = "Přepiš čitelné údaje z tohoto snímku obrazovky."
    if hint:
        text += f" Očekávaná obrazovka (jen nápověda, neber ji jako fakt): {hint.strip()[:100]}"
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": image["media_type"], "data": image["data_b64"]}},
                {"type": "text", "text": text},
            ],
        }
    ]
    try:
        response, _route = router.complete("vision", system=VISION_SYSTEM_PROMPT_CS, messages=messages, schema=SCREEN_JSON_SCHEMA)
    except ProviderError as exc:
        return _result("error", f"Chyba poskytovatele ({exc.kind}): {exc}", retryable=exc.retryable)

    cost = None
    if ledger is not None:
        cost = ledger.record(
            task="vision",
            provider=response.provider,
            model=response.model,
            usage=response.usage,
            request_id=response.request_id,
        )["usd"]
    meta = {
        "model": response.model,
        "usage": response.usage.as_dict(),
        "cost_usd": cost,
        "request_id": response.request_id,
        "warnings": list(response.notes),
    }
    if response.stop_reason == "refusal":
        return _result("refused", "Model odmítl snímek zpracovat.", **meta)
    if response.stop_reason == "max_tokens":
        return _result("error", "Odpověď byla useknuta (max_tokens).", **meta)

    parsed = response.parsed
    if parsed is None:
        try:
            parsed = json.loads(response.text)
        except (json.JSONDecodeError, TypeError):
            return _result("error", "Odpověď není platný JSON podle schématu.", **meta)
    fields, dropped, errors = validate_screen(parsed)
    if errors:
        return _result("error", "; ".join(errors), **meta)
    screen_type = parsed["screen_type"]
    status = "ok" if fields and screen_type != "unreadable" else "needs_review"
    out = _result(
        status,
        None,
        screen_type=screen_type,
        fields=fields,
        unreadable=list(parsed["unreadable"]),
        dropped=dropped,
        **meta,
    )
    if status == "needs_review":
        out["warnings"].append("Z obrazovky se nepodařilo spolehlivě přečíst žádný údaj; nic se nepředává dál.")
    return out
