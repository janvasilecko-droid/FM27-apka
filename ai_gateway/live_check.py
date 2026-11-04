"""Jednorázová zkouška se SKUTEČNÝM klíčem:  python3 -m ai_gateway.live_check --yes

Volá placené API (jedno volání úlohy `advice` s ukázkovými DEMO pozorováními; řádově
jednotky centů u Opus). Slouží k ověření toho, co testy bez klíče ověřit nemohou: že API přijme
strukturovaný výstup, `effort` i serverový fallback, a že se správně čtou tokeny a cena.

Klíč se čte jen z proměnné prostředí ANTHROPIC_API_KEY a nikdy se nevypisuje.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Callable, Mapping

from .advise import advise
from .config import build_default_router, load_registry
from .costs import Ledger
from .demo_data import DEMO_BANNER, demo_request
from .providers import Router

KNOWLEDGE_CANDIDATES = ("knowledge.json", "reference/codex-2026-11-01/knowledge.json")


def main(
    argv: list[str] | None = None,
    env: Mapping[str, str] | None = None,
    router: Router | None = None,
    out: Callable[[str], None] = print,
) -> int:
    parser = argparse.ArgumentParser(description="Jednorázová zkouška gateway se skutečným klíčem (placené volání).")
    parser.add_argument("--yes", action="store_true", help="potvrzuji, že se zavolá placené API")
    args = parser.parse_args(argv)
    if not args.yes:
        out("Tento příkaz volá placené API. Spusť ho znovu s --yes, pokud to chceš.")
        return 2
    router = router or build_default_router(os.environ if env is None else env)
    if not router.available("advice"):
        out(f"Nelze zkoušet: {router.why_unavailable('advice')}")
        return 3

    registry = next((load_registry(p) for p in KNOWLEDGE_CANDIDATES if Path(p).is_file()), None)
    ledger = Ledger()
    out(DEMO_BANNER)
    out(f"trasa advice: {router.routes['advice']}")
    result = advise(demo_request(), router=router, registry=registry, ledger=ledger)
    out(f"status: {result['status']} | model: {result.get('model')} | request_id: {result.get('request_id')}")
    out(f"tokeny: {result.get('usage')} | cena: {result.get('cost_usd')} USD (None = cena modelu není v ceníku)")
    for warning in result["warnings"]:
        out(f"  ! {warning}")
    if result["status"] == "ok":
        out("")
        out(result["text_cs"])
        out("\nVÝSLEDEK: API požadavek přijalo a rada prošla kontrolou poctivosti.")
        return 0
    for error in result["errors"]:
        out(f"  CHYBA: {error}")
    if result["status"] == "needs_more_info":
        out("\nAPI požadavek přijalo, ale rada nesplnila pravidla ani po opravě (to je dovolený výsledek).")
        return 0
    return 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
