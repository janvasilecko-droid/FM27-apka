"""Úrovně důvěry (trust tiers) a štítky původu dat.

Shodné s HANDOFF_CLAUDE.md z Cursoru: `verified` / `observed` / `inferred` / `unknown` / `user_entered`
a štítky `heuristic_coach` / `ocr_unverified` / `ai_advise` / `user_entered` / `screenshot_verified`.
Přidané štítky: `vision_unverified` (strojové čtení obrazu modelem) a `stub` (výstup bez klíče).
"""

from __future__ import annotations

from typing import Iterable

# Od nejsilnějšího po nejslabší důkaz o tom, jak funguje / vypadá FM27.
TIERS = ("verified", "observed", "user_entered", "inferred", "unknown")
TIER_RANK = {"unknown": 0, "inferred": 1, "user_entered": 2, "observed": 3, "verified": 4}

LABELS = (
    "heuristic_coach",
    "ocr_unverified",
    "vision_unverified",
    "ai_advise",
    "user_entered",
    "screenshot_verified",
    "stub",
)

# Co může štítek původu nejvýš „unést“. Strojové čtení (OCR i vision) a výstupy AI jsou
# neověřené, takže nejsou silnější než `inferred`. Ověřená je jen věc, kterou potvrdil člověk
# nad screenshotem (`screenshot_verified` → `observed`).
LABEL_TO_TIER = {
    "screenshot_verified": "observed",
    "user_entered": "user_entered",
    "ocr_unverified": "inferred",
    "vision_unverified": "inferred",
    "heuristic_coach": "inferred",
    "ai_advise": "inferred",
    "stub": "unknown",
}

# Štítky, které znamenají „přečetl stroj, nikdo to neověřil“.
MACHINE_READ_LABELS = frozenset({"ocr_unverified", "vision_unverified", "heuristic_coach", "ai_advise"})


def tier_rank(tier: str) -> int:
    try:
        return TIER_RANK[tier]
    except KeyError as exc:
        raise ValueError(f"Neznámá úroveň důvěry: {tier!r}") from exc


def tier_of_label(label: str) -> str:
    try:
        return LABEL_TO_TIER[label]
    except KeyError as exc:
        raise ValueError(f"Neznámý štítek původu: {label!r}") from exc


def weakest_tier(tiers: Iterable[str]) -> str:
    """Nejslabší z úrovní; prázdný vstup = `unknown` (nic nepodporuje tvrzení)."""
    ranked = [(tier_rank(t), t) for t in tiers]
    return min(ranked)[1] if ranked else "unknown"
