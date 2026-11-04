"""10bodová rada: schéma pro model, validátor poctivosti a vykreslení do češtiny.

Pole (`context`, `evidenceA`, `evidenceB`, `confidence`, `diagnosis`, `change`, `measure`, `risk`,
`reversal`, `unknown`) odpovídají handoffu z Cursoru. TYPY uvnitř polí jsou můj návrh: Cursorův
`docs/AI_GATEWAY.md` jsem neviděl. Až bude kód v repozitáři, sladit v tomto jediném souboru.

Validátor nehodnotí, jestli je rada fotbalově správná. Hlídá poctivost:
- každé tvrzení má úroveň důvěry a odkazy na pozorování/zdroje, které opravdu existují;
- úroveň tvrzení není silnější než nejslabší důkaz, o který se opírá;
- vysoká jistota potřebuje dva nezávislé důkazy a nesmí stát jen na neověřeném strojovém čtení;
- názvy nastavení a navigace ve FM27 jsou „neověřené“, dokud je nepotvrdí oficiální zdroj FM27
  z registru nebo ověřený screenshot; neověřené musí skončit v `unknown` jako úkol k ověření;
- žádná tvrzení o interní mechanice FM27 (CA/PA, match engine, skryté atributy) bez ověření;
- nanejvýš 1–2 cílené změny, každá s hráčem, nastavením, z → na a kroky v menu.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from collections.abc import Mapping
from typing import Any

from .provenance import LABEL_TO_TIER, TIERS, tier_rank
from .sources import SourceRegistry

SECTION_KEYS = (
    "context",
    "evidenceA",
    "evidenceB",
    "confidence",
    "diagnosis",
    "change",
    "measure",
    "risk",
    "reversal",
    "unknown",
)
MIN_TEXT = 8
MAX_CHANGES = 2

_STR = {"type": "string"}
_STRS = {"type": "array", "items": _STR}
_TIER = {"type": "string", "enum": list(TIERS)}


def _tiered_section() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"text": _STR, "tier": _TIER, "refs": _STRS},
        "required": ["text", "tier", "refs"],
        "additionalProperties": False,
    }


# JSON Schema pro `output_config.format` (strukturovaný výstup). Záměrně bez `minItems`/`minLength`
# a bez null hodnot: ty se kontrolují ve validátoru, který umí hlásit srozumitelné chyby.
ADVICE10_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "context": _tiered_section(),
        "evidenceA": _tiered_section(),
        "evidenceB": _tiered_section(),
        "confidence": {
            "type": "object",
            "properties": {"level": {"type": "string", "enum": ["low", "medium", "high"]}, "text": _STR},
            "required": ["level", "text"],
            "additionalProperties": False,
        },
        "diagnosis": _tiered_section(),
        "change": {
            "type": "object",
            "properties": {
                "text": _STR,
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "player": _STR,
                            "setting": _STR,
                            "from": _STR,
                            "to": _STR,
                            "where": _STRS,
                            "where_tier": _TIER,
                            "refs": _STRS,
                        },
                        "required": ["player", "setting", "from", "to", "where", "where_tier", "refs"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["text", "items"],
            "additionalProperties": False,
        },
        "measure": {
            "type": "object",
            "properties": {
                "text": _STR,
                "checks": _STRS,
                # 0 = neurčeno
                "recheck_after_minutes": {"type": "integer"},
            },
            "required": ["text", "checks", "recheck_after_minutes"],
            "additionalProperties": False,
        },
        "risk": {
            "type": "object",
            "properties": {"text": _STR, "items": _STRS},
            "required": ["text", "items"],
            "additionalProperties": False,
        },
        "reversal": {
            "type": "object",
            "properties": {"text": _STR},
            "required": ["text"],
            "additionalProperties": False,
        },
        "unknown": {
            "type": "object",
            "properties": {"text": _STR, "items": _STRS},
            "required": ["text", "items"],
            "additionalProperties": False,
        },
    },
    "required": list(SECTION_KEYS),
    "additionalProperties": False,
}

_MECHANIC_PATTERNS = (
    re.compile(r"\b(?:CA|PA)\b"),
    re.compile(r"current ability|potential ability", re.IGNORECASE),
    re.compile(r"match engine|herní engine|engine hry|zápasov\w+ engine|simulační engine", re.IGNORECASE),
    re.compile(r"skryt\w+ atribut\w*|hidden attribute\w*", re.IGNORECASE),
)
_VAGUE_TARGET = re.compile(
    r"^(?:více|víc|méně|míň|vyšší|nižší|větší|menší|lepší|horší|silnější|slabší|širší|užší|hlubší|"
    r"jinak|jiné|upravit|změnit|zlepšit|optimální|správně|vhodné|vhodnější)\b",
    re.IGNORECASE,
)


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    needs_verification: bool = False


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _str_list(value: Any) -> list[str] | None:
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return [item.strip() for item in value]
    return None


def validate_advice10(
    advice: Any,
    *,
    observations: Mapping[str, Mapping[str, Any]],
    registry: SourceRegistry | None = None,
    passages: Mapping[str, Any] | None = None,
    max_changes: int = MAX_CHANGES,
) -> ValidationResult:
    """Zkontroluje poctivost rady.

    `observations`: id → {"label": …, "text": …}. `passages`: id úryvků z knih, které se v této žádosti
    opravdu vyhledaly. Úryvek z knihy podporuje obecnou fotbalovou teorii, ne tvrzení o fungování FM27
    ani důkaz o aktuálním zápase, takže tvrzení s ním je nejvýš `inferred` a jako důkaz (evidenceA/B) se
    nepočítá.
    """
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(advice, Mapping):
        return ValidationResult(False, ["Odpověď není JSON objekt."])
    missing = [key for key in SECTION_KEYS if key not in advice]
    if missing:
        return ValidationResult(False, [f"Chybí sekce: {', '.join(missing)}."])
    extra = [key for key in advice if key not in SECTION_KEYS]
    if extra:
        warnings.append(f"Nadbytečné sekce byly ignorovány: {', '.join(extra)}.")

    obs_tier = {oid: LABEL_TO_TIER[obs["label"]] for oid, obs in observations.items()}
    obs_label = {oid: obs["label"] for oid, obs in observations.items()}

    def ref_tier(ref: str) -> str | None:
        if ref in obs_tier:
            return obs_tier[ref]
        if passages is not None and ref in passages:
            return "inferred"
        if registry is not None and ref in registry:
            return "verified" if registry.is_official_fm27(ref) else "inferred"
        return None

    def mechanic_scan(name: str, text: str, tier: str | None = None) -> None:
        if tier in ("verified", "observed"):
            return
        for pattern in _MECHANIC_PATTERNS:
            match = pattern.search(text)
            if match:
                errors.append(
                    f"{name}: tvrzení o interní mechanice FM27 („{match.group(0)}“) bez ověřeného zdroje; "
                    "přepiš jako otevřenou otázku do sekce unknown."
                )
                return

    def tiered(name: str, section: Any, *, need_observation: bool = False) -> dict[str, Any] | None:
        if not isinstance(section, Mapping):
            errors.append(f"{name}: sekce musí být objekt.")
            return None
        text = _text(section.get("text"))
        tier = section.get("tier")
        refs = _str_list(section.get("refs"))
        if len(text) < MIN_TEXT:
            errors.append(f"{name}: text je prázdný nebo příliš krátký.")
        if tier not in TIERS:
            errors.append(f"{name}: neplatná úroveň důvěry „{tier}“.")
            return None
        if refs is None:
            errors.append(f"{name}: refs musí být seznam textů.")
            return None
        for ref in refs:
            if ref_tier(ref) is None:
                errors.append(f"{name}: odkaz „{ref}“ neodpovídá žádnému pozorování ani zdroji.")
        good = [ref for ref in refs if ref_tier(ref) is not None]
        if tier in ("verified", "observed", "user_entered") and not good:
            errors.append(f"{name}: tvrzení s úrovní {tier} musí mít odkaz na pozorování nebo zdroj.")
        if good:
            weakest = min((ref_tier(ref) for ref in good), key=tier_rank)  # type: ignore[arg-type]
            if tier_rank(tier) > tier_rank(weakest):
                errors.append(
                    f"{name}: úroveň {tier} je silnější než nejslabší odkazovaný důkaz ({weakest})."
                )
        if need_observation and tier != "unknown" and not any(ref in obs_tier for ref in good):
            errors.append(f"{name}: důkaz musí odkazovat alespoň na jedno pozorování (id).")
        mechanic_scan(name, text, tier)
        return {"tier": tier, "refs": good}

    tiered("context", advice["context"])
    ev_a = tiered("evidenceA", advice["evidenceA"], need_observation=True)
    ev_b = tiered("evidenceB", advice["evidenceB"], need_observation=True)
    tiered("diagnosis", advice["diagnosis"])

    # --- jistota -------------------------------------------------------------------------
    conf = advice["confidence"]
    level = conf.get("level") if isinstance(conf, Mapping) else None
    if level not in ("low", "medium", "high"):
        errors.append("confidence: level musí být low, medium nebo high.")
    if not _text(conf.get("text") if isinstance(conf, Mapping) else None):
        errors.append("confidence: chybí zdůvodnění.")
    obs_a = {ref for ref in (ev_a or {}).get("refs", []) if ref in obs_tier}
    obs_b = {ref for ref in (ev_b or {}).get("refs", []) if ref in obs_tier}
    a_known = bool(ev_a and ev_a["tier"] != "unknown")
    b_known = bool(ev_b and ev_b["tier"] != "unknown")
    if level == "high":
        # Vysoká jistota jen ze dvou nezávislých OVĚŘENÝCH pozorování (screenshot_verified).
        # Strojové čtení ani tvrzení uživatele na ni nestačí: jedna chvíle není důkaz problému.
        verified_both = bool(
            a_known
            and b_known
            and tier_rank(ev_a["tier"]) >= tier_rank("observed")  # type: ignore[index]
            and tier_rank(ev_b["tier"]) >= tier_rank("observed")  # type: ignore[index]
        )
        if not (verified_both and len(obs_a | obs_b) >= 2):
            errors.append(
                "confidence: high vyžaduje dva nezávislé ověřené důkazy (evidenceA a evidenceB s různými "
                "pozorováními screenshot_verified), ne jen neověřené strojové čtení (ocr_unverified / "
                "vision_unverified) nebo tvrzení uživatele."
            )
    elif level == "medium" and not (a_known or b_known):
        errors.append("confidence: medium vyžaduje alespoň jeden důkaz.")
    if a_known and b_known and obs_a and obs_a == obs_b:
        warnings.append("evidenceA a evidenceB stojí na stejném pozorování, nejsou nezávislé.")

    # --- unknown (potřebujeme ho znát dřív než změny) ---------------------------------------
    unknown = advice["unknown"]
    unknown_items = _str_list(unknown.get("items")) if isinstance(unknown, Mapping) else None
    if unknown_items is None:
        errors.append("unknown: items musí být seznam textů.")
        unknown_items = []
    unknown_items = [item for item in unknown_items if item]

    # --- změna ---------------------------------------------------------------------------
    needs_verification = False
    change = advice["change"]
    items = change.get("items") if isinstance(change, Mapping) else None
    if not isinstance(items, list) or not items:
        errors.append("change: musí obsahovat alespoň jednu konkrétní změnu (items).")
        items = []
    elif len(items) > max_changes:
        errors.append(f"change: nejvýš {max_changes} cílené změny najednou, dostal jsem {len(items)}.")
    if isinstance(change, Mapping):
        change_text = _text(change.get("text"))
        if len(change_text) < MIN_TEXT:
            errors.append("change: chybí shrnutí změny (text).")
        mechanic_scan("change", change_text)
    for index, item in enumerate(items, start=1):
        name = f"change[{index}]"
        if not isinstance(item, Mapping):
            errors.append(f"{name}: položka musí být objekt.")
            continue
        player, setting = _text(item.get("player")), _text(item.get("setting"))
        before, after = _text(item.get("from")), _text(item.get("to"))
        if not (player and setting and before and after):
            errors.append(f"{name}: vyplň hráče (nebo „tým“), nastavení, hodnotu z a hodnotu na.")
        elif before.casefold() == after.casefold():
            errors.append(f"{name}: hodnota „z“ a „na“ je stejná, nejde o změnu.")
        elif _VAGUE_TARGET.match(after):
            warnings.append(f"{name}: cílová hodnota „{after}“ vypadá obecně; uveď konkrétní hodnotu nastavení.")
        steps = _str_list(item.get("where"))
        if not steps or not all(steps):
            errors.append(f"{name}: where musí obsahovat alespoň jeden neprázdný krok v menu.")
        where_tier = item.get("where_tier")
        refs = _str_list(item.get("refs")) or []
        if where_tier not in TIERS:
            errors.append(f"{name}: neplatná úroveň where_tier „{where_tier}“.")
            continue
        if where_tier == "verified":
            if not refs or not all(registry is not None and registry.is_official_fm27(ref) for ref in refs):
                errors.append(
                    f"{name}: navigace označená jako verified musí odkazovat na oficiální zdroj FM27 z registru."
                )
        elif where_tier == "observed":
            if not any(obs_label.get(ref) == "screenshot_verified" for ref in refs):
                errors.append(
                    f"{name}: navigace označená jako observed musí odkazovat na pozorování screenshot_verified."
                )
        else:
            needs_verification = True
            warnings.append(
                f"{name}: název nastavení a navigace nejsou ověřené ve hře; ověř je, než změnu provedeš."
            )

    if needs_verification and not unknown_items:
        errors.append("unknown: u neověřeného názvu nastavení nebo navigace musí být uvedeno, co je potřeba ověřit.")
    if level == "low" and not unknown_items:
        errors.append("unknown: při nízké jistotě uveď, co chybí (unknown.items).")

    # --- měření, rizika, zpětný krok -------------------------------------------------------
    measure = advice["measure"]
    if isinstance(measure, Mapping):
        if len(_text(measure.get("text"))) < MIN_TEXT:
            errors.append("measure: chybí popis, co po změně sledovat.")
        checks = _str_list(measure.get("checks"))
        if not checks or not all(checks):
            errors.append("measure: checks musí obsahovat alespoň jednu konkrétní kontrolu.")
        else:
            for check in checks:
                mechanic_scan("measure", check)
        minutes = measure.get("recheck_after_minutes")
        if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 0:
            errors.append("measure: recheck_after_minutes musí být celé číslo ≥ 0 (0 = neurčeno).")
        elif minutes == 0:
            warnings.append("measure: není určeno, kdy změnu znovu vyhodnotit.")
        mechanic_scan("measure", _text(measure.get("text")))
    else:
        errors.append("measure: sekce musí být objekt.")

    risk = advice["risk"]
    if isinstance(risk, Mapping):
        risk_items = _str_list(risk.get("items"))
        if len(_text(risk.get("text"))) < MIN_TEXT:
            errors.append("risk: chybí popis rizika.")
        if not risk_items or not all(risk_items):
            errors.append("risk: items musí obsahovat alespoň jedno konkrétní riziko.")
        else:
            for entry in risk_items:
                mechanic_scan("risk", entry)
        mechanic_scan("risk", _text(risk.get("text")))
    else:
        errors.append("risk: sekce musí být objekt.")

    reversal = advice["reversal"]
    if isinstance(reversal, Mapping):
        if len(_text(reversal.get("text"))) < MIN_TEXT:
            errors.append("reversal: chybí popis, jak změnu vrátit zpět.")
        mechanic_scan("reversal", _text(reversal.get("text")))
    else:
        errors.append("reversal: sekce musí být objekt.")

    return ValidationResult(
        ok=not errors, errors=errors, warnings=warnings, needs_verification=needs_verification
    )


TIER_LABEL_CS = {
    "verified": "ověřeno, oficiální zdroj",
    "observed": "pozorováno na ověřeném screenshotu",
    "user_entered": "zadal uživatel",
    "inferred": "odhad",
    "unknown": "neznámé",
}
LEVEL_CS = {"low": "nízká", "medium": "střední", "high": "vysoká"}


def render_text_cs(advice: Mapping[str, Any]) -> str:
    """Čitelný český text rady (UI i hlasový výstup). Předpokládá už zvalidovanou radu."""

    def tiered(title: str, key: str) -> str:
        section = advice.get(key) or {}
        tier = TIER_LABEL_CS.get(section.get("tier"), "?")
        refs = ", ".join(section.get("refs") or [])
        suffix = f" (odkazy: {refs})" if refs else ""
        return f"{title} [{tier}]: {_text(section.get('text'))}{suffix}"

    lines = [
        "1. " + tiered("Kontext", "context"),
        "2. " + tiered("Důkaz A", "evidenceA"),
        "3. " + tiered("Důkaz B", "evidenceB"),
    ]
    conf = advice.get("confidence") or {}
    lines.append(f"4. Jistota: {LEVEL_CS.get(conf.get('level'), '?')}. {_text(conf.get('text'))}")
    lines.append("5. " + tiered("Diagnóza", "diagnosis"))
    change = advice.get("change") or {}
    lines.append(f"6. Co změnit: {_text(change.get('text'))}")
    for item in change.get("items") or []:
        verified = TIER_LABEL_CS.get(item.get("where_tier"), "?")
        lines.append(
            f"   • {_text(item.get('player'))}: {_text(item.get('setting'))}, "
            f"z „{_text(item.get('from'))}“ na „{_text(item.get('to'))}“"
        )
        lines.append(f"     Kde ve hře: {' › '.join(item.get('where') or [])} (navigace: {verified})")
    measure = advice.get("measure") or {}
    minutes = measure.get("recheck_after_minutes") or 0
    when = f"; znovu vyhodnotit za {minutes} min" if minutes else "; čas dalšího vyhodnocení neurčen"
    lines.append(f"7. Jak změřit: {_text(measure.get('text'))} Zkontrolovat: {'; '.join(measure.get('checks') or [])}{when}")
    risk = advice.get("risk") or {}
    lines.append(f"8. Rizika: {_text(risk.get('text'))} " + "; ".join(risk.get("items") or []))
    lines.append(f"9. Jak vrátit zpět: {_text((advice.get('reversal') or {}).get('text'))}")
    unknown = advice.get("unknown") or {}
    lines.append(f"10. Co nevím / co ověřit: {_text(unknown.get('text'))}")
    for entry in unknown.get("items") or []:
        lines.append(f"   • {entry}")
    return "\n".join(lines)
