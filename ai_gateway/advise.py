"""Orchestrace: pozorování + plán → 10bodová rada, vždy zvalidovaná nebo poctivé „nelze poradit“.

Vstup `request` (dict):
    question               text dotazu uživatele (volitelné)
    plan                   ruční plán `fm27-tactical-coach-manual-plan` (volitelné)
    observations           [{id, label, text, minute?}]  label ∈ heuristic_coach, ocr_unverified,
                           vision_unverified, user_entered, screenshot_verified
    images                 [{id, media_type, data_b64}]  jen když user_initiated_images is True
    user_initiated_images  True jen po výslovné akci uživatele (soukromí: žádné tiché odesílání obrazu)

Výstup (dict) má vždy `status`:
    ok               rada prošla kontrolou poctivosti (`advice`, `text_cs`, `warnings`)
    stub             není klíč nebo SDK; žádná AI nebyla volána (`provenance: "stub"`)
    needs_more_info  rada ani po jedné opravě neprošla kontrolou; nic se uživateli nevydává jako rada
    refused          model odmítl odpovědět
    budget_exceeded  vyčerpán limit nákladů
    error            chyba poskytovatele nebo neplatný vstup
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Mapping
from typing import Any

from .advice10 import ADVICE10_JSON_SCHEMA, render_text_cs, validate_advice10
from .costs import Budget, Ledger, Usage
from .providers import ProviderError, Router
from .sources import SourceRegistry

MAX_OBSERVATIONS = 40
MAX_OBS_TEXT = 1500
MAX_QUESTION = 1000
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024
INPUT_LABELS = ("heuristic_coach", "ocr_unverified", "vision_unverified", "user_entered", "screenshot_verified")
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")
_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")

SYSTEM_PROMPT_CS = """Jsi FM27 Tactical Coach, osobní trenér pro Football Manager 27. Uživateli řekneš, co má ve hře změnit, proč a kde. Odpovídáš česky a výhradně jedním JSON objektem podle dodaného schématu (10 sekcí).

Pravidla poctivosti platí bez výjimky:
1. Pracuješ jen s tím, co dostaneš: s pozorováními (každé má id a štítek původu) a se zdroji znalostí (každý má id). Hru nevidíš. Nikdy netvrď, že jsi něco viděl, pokud to není v pozorování.
2. Každé tvrzení má `tier`: verified (oficiální zdroj FM27 z registru), observed (pozorování se štítkem screenshot_verified), user_entered (zadal uživatel), inferred (tvůj odhad nebo strojové čtení), unknown (nevíš). Úroveň nesmí být silnější než nejslabší důkaz, na který se odkazuješ v `refs` (id pozorování nebo zdroje).
3. Text vyčtený strojem (ocr_unverified, vision_unverified) a heuristiky jsou nejvýš `inferred`. Na jejich základě neuváděj vysokou jistotu.
4. Jeden údaj nebo jedna chvíle není důkaz problému. Vysoká jistota vyžaduje dva nezávislé důkazy (evidenceA a evidenceB odkazují na různá pozorování). Chybí-li druhý důkaz, dej mu tier unknown a jistotu nejvýš střední.
5. Nevymýšlej mechaniky FM27 (CA/PA, match engine, skryté atributy, vnitřní fungování). Názvy rolí, nastavení a cest v menu FM27 považuj za neověřené, pokud je nepotvrzuje zdroj z registru nebo pozorování screenshot_verified. Neověřené označ where_tier unknown nebo inferred a do `unknown.items` zapiš, co má uživatel ve hře ověřit.
6. Žádné obecné rady („zlepši pressing“). Navrhni nejvýš dvě konkrétní změny: komu (hráč nebo „tým“), které nastavení, z jaké hodnoty na jakou a kroky v menu.
7. Uveď, jak změnu změřit (konkrétní kontroly a kdy znovu vyhodnotit), rizika a jak změnu vrátit zpět.
8. Když informací nestačí, řekni to: nízká jistota a v `unknown.items` přesně to, co potřebuješ vidět nebo vědět. Raději poctivé „nevím“ než odhad vydávaný za fakt."""


def _error(status: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "status": status,
        "provenance": "stub" if status == "stub" else "ai_advise",
        "advice": None,
        "text_cs": None,
        "errors": [message],
        "warnings": [],
        "needs_verification": False,
        "model": None,
        "usage": None,
        "cost_usd": None,
        "request_id": None,
        **extra,
    }


def render_plan(plan: Mapping[str, Any]) -> str:
    """Stručný text z ručního plánu. Je to zadání uživatele, ne data načtená z FM27."""
    lines = [
        f"Klub: {plan.get('club', '?')}; taktika: {plan.get('tactic', '?')}; formace: {plan.get('formation', '?')}; "
        f"aktivní fáze: {plan.get('activePhase', '?')}"
    ]
    shapes = plan.get("phaseShapes") or {}
    for phase in ("in", "out"):
        instructions = str((shapes.get(phase) or {}).get("instructions") or "").strip()
        lines.append(f"Pokyny ({phase}): {instructions or '(prázdné)'}")
    for player in (plan.get("players") or [])[:15]:
        flags = player.get("flags") or {}
        marks = [name for name in ("injury", "fatigue") if flags.get(name)]
        lines.append(
            f"- {player.get('id', '?')} {player.get('name', '?')} | {player.get('position', '?')} | "
            f"role: {player.get('role', '?')} | x={player.get('x', '?')}, y={player.get('y', '?')}"
            + (f" | {', '.join(marks)}" if marks else "")
        )
    return "\n".join(lines)[:3000]


def normalize_request(request: Mapping[str, Any]) -> dict[str, Any]:
    """Zkontroluje vstup a sestaví pozorování. Vyhodí ValueError při neplatném vstupu."""
    warnings: list[str] = []
    question = str(request.get("question") or "").strip()[:MAX_QUESTION]
    observations: dict[str, dict[str, Any]] = {}

    for raw in request.get("observations") or []:
        obs_id = str(raw.get("id") or "")
        label = raw.get("label")
        if not _ID.match(obs_id):
            raise ValueError(f"Neplatné id pozorování: {obs_id!r}")
        if obs_id in observations:
            raise ValueError(f"Duplicitní id pozorování: {obs_id!r}")
        if label not in INPUT_LABELS:
            raise ValueError(f"Pozorování {obs_id}: štítek {label!r} není povolený ({', '.join(INPUT_LABELS)})")
        minute = raw.get("minute")
        observations[obs_id] = {
            "label": label,
            "text": str(raw.get("text") or "").strip()[:MAX_OBS_TEXT],
            "minute": minute if isinstance(minute, int) and not isinstance(minute, bool) else None,
        }
    if len(observations) > MAX_OBSERVATIONS:
        raise ValueError(f"Příliš mnoho pozorování (max {MAX_OBSERVATIONS}).")

    plan = request.get("plan")
    if isinstance(plan, Mapping):
        if "plan" in observations:
            raise ValueError("Id „plan“ je vyhrazené pro ruční plán.")
        observations["plan"] = {"label": "user_entered", "text": render_plan(plan), "minute": None}

    images: list[dict[str, str]] = []
    raw_images = request.get("images") or []
    if raw_images and request.get("user_initiated_images") is not True:
        warnings.append("Obrázky nebyly odeslány: chybí výslovná akce uživatele (user_initiated_images).")
        raw_images = []
    for raw in raw_images[:MAX_IMAGES]:
        img_id = str(raw.get("id") or "")
        if not _ID.match(img_id) or img_id in observations:
            raise ValueError(f"Neplatné nebo duplicitní id obrázku: {img_id!r}")
        if raw.get("media_type") not in IMAGE_TYPES:
            raise ValueError(f"Obrázek {img_id}: nepodporovaný typ {raw.get('media_type')!r}")
        try:
            decoded = base64.b64decode(str(raw.get("data_b64") or ""), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"Obrázek {img_id}: neplatné base64") from exc
        if not decoded or len(decoded) > MAX_IMAGE_BYTES:
            raise ValueError(f"Obrázek {img_id}: prázdný nebo větší než {MAX_IMAGE_BYTES // (1024 * 1024)} MiB")
        images.append({"id": img_id, "media_type": raw["media_type"], "data_b64": raw["data_b64"]})
        observations[img_id] = {"label": "vision_unverified", "text": "(obrázek předaný modelu)", "minute": None}
    if len(raw_images) > MAX_IMAGES:
        warnings.append(f"Odesláno jen prvních {MAX_IMAGES} obrázků.")

    return {"question": question, "observations": observations, "images": images, "warnings": warnings}


def build_user_blocks(norm: Mapping[str, Any], registry: SourceRegistry | None) -> list[dict[str, Any]]:
    lines = [f"Dotaz uživatele: {norm['question'] or '(bez dotazu: navrhni, co je nejdůležitější ověřit nebo změnit)'}", ""]
    lines.append("Pozorování (id | štítek původu | minuta | text):")
    if not norm["observations"]:
        lines.append("(žádná: bez pozorování nemůžeš tvrdit nic o aktuálním průběhu)")
    for obs_id, obs in norm["observations"].items():
        minute = f"{obs['minute']}'" if obs.get("minute") is not None else "-"
        lines.append(f"- {obs_id} | {obs['label']} | {minute} | {obs['text']}")
    lines.append("")
    lines.append("Zdroje znalostí, které smíš citovat v `refs`:")
    lines.append(registry.digest() if registry is not None else "(registr zdrojů nebyl předán)")
    blocks: list[dict[str, Any]] = [{"type": "text", "text": "\n".join(lines)}]
    for image in norm["images"]:
        blocks.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": image["media_type"], "data": image["data_b64"]},
            }
        )
        blocks.append({"type": "text", "text": f"(Předchozí obrázek má id {image['id']}.)"})
    return blocks


def _repair_text(errors: list[str]) -> str:
    listed = "\n".join(f"- {error}" for error in errors)
    return (
        "Tvoje odpověď nesplnila tato pravidla:\n"
        f"{listed}\n\n"
        "Oprav JSON. Nevymýšlej důkazy ani zdroje. Když pro tvrzení nemáš oporu, sniž jeho úroveň, "
        "přiznej to v unknown a nastav nízkou jistotu."
    )


def _try_json(text: str) -> Any | None:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


def advise(
    request: Mapping[str, Any],
    *,
    router: Router | None,
    registry: SourceRegistry | None = None,
    ledger: Ledger | None = None,
    budget: Budget | None = None,
    max_repairs: int = 1,
) -> dict[str, Any]:
    try:
        norm = normalize_request(request)
    except ValueError as exc:
        return _error("error", f"Neplatný vstup: {exc}")

    if router is None or not router.available("advice"):
        reason = router.why_unavailable("advice") if router is not None else "Router není nastaven."
        return _error(
            "stub",
            f"Bez AI (stub): {reason}",
            warnings=list(norm["warnings"]),
        )

    messages: list[dict[str, Any]] = [{"role": "user", "content": build_user_blocks(norm, registry)}]
    usage_total = Usage()
    cost_total: float | None = 0.0
    last_errors: list[str] = []
    model: str | None = None
    request_id: str | None = None
    notes: list[str] = []

    for attempt in range(max_repairs + 1):
        if budget is not None:
            allowed, why = budget.check()
            if not allowed:
                return _error("budget_exceeded", why or "Vyčerpán limit nákladů.")
        try:
            response, _route = router.complete("advice", system=SYSTEM_PROMPT_CS, messages=messages, schema=ADVICE10_JSON_SCHEMA)
        except ProviderError as exc:
            return _error("error", f"Chyba poskytovatele ({exc.kind}): {exc}", retryable=exc.retryable)

        model, request_id = response.model, response.request_id
        notes.extend(response.notes)
        usage_total.input_tokens += response.usage.input_tokens
        usage_total.output_tokens += response.usage.output_tokens
        usage_total.cache_read_tokens += response.usage.cache_read_tokens
        usage_total.cache_write_tokens += response.usage.cache_write_tokens
        if ledger is not None:
            entry = ledger.record(
                task="advice",
                provider=response.provider,
                model=response.model,
                usage=response.usage,
                request_id=response.request_id,
            )
            cost_total = None if (cost_total is None or entry["usd"] is None) else round(cost_total + entry["usd"], 6)
        else:
            cost_total = None

        meta = {
            "model": model,
            "usage": usage_total.as_dict(),
            "cost_usd": cost_total,
            "request_id": request_id,
        }
        if response.stop_reason == "refusal":
            category = f" (kategorie: {response.refusal_category})" if response.refusal_category else ""
            return {**_error("refused", f"Model odmítl odpovědět{category}."), **meta}
        if response.stop_reason == "max_tokens":
            return {**_error("error", "Odpověď byla useknuta (max_tokens)."), **meta}

        advice = response.parsed if response.parsed is not None else _try_json(response.text)
        if advice is None:
            last_errors = ["Odpověď není platný JSON podle schématu."]
        else:
            result = validate_advice10(advice, observations=norm["observations"], registry=registry)
            if result.ok:
                return {
                    "status": "ok",
                    "provenance": "ai_advise",
                    "advice": advice,
                    "text_cs": render_text_cs(advice),
                    "errors": [],
                    "warnings": [*norm["warnings"], *notes, *result.warnings],
                    "needs_verification": result.needs_verification,
                    **meta,
                }
            last_errors = result.errors

        if attempt < max_repairs:
            echoed = response.text or json.dumps(advice, ensure_ascii=False)
            messages = [
                *messages,
                {"role": "assistant", "content": echoed},
                {"role": "user", "content": _repair_text(last_errors)},
            ]

    return {
        "status": "needs_more_info",
        "provenance": "ai_advise",
        "advice": None,
        "text_cs": None,
        "errors": last_errors,
        "warnings": [
            *norm["warnings"],
            *notes,
            "AI nedodala radu, která by prošla kontrolou poctivosti. Doplň pozorování "
            "(screenshot taktiky nebo zápasu, údaje z obrazovky) a zkus to znovu.",
        ],
        "needs_verification": False,
        "model": model,
        "usage": usage_total.as_dict(),
        "cost_usd": cost_total,
        "request_id": request_id,
    }
