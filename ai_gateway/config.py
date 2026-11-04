"""Sestavení routeru, rozpočtu a registru zdrojů z prostředí serveru.

Proměnné prostředí (nastavují se na straně serveru, nikdy v prohlížeči ani v repozitáři):
    ANTHROPIC_API_KEY            klíč Anthropic; bez něj gateway vrací stub
    FM27_AI_ROUTES               JSON, který přepíše trasy, např.
                                 {"advice": {"model": "claude-opus-5-5", "effort": "high"}}
    FM27_AI_REFUSAL_FALLBACK     0 vypne serverový fallback při odmítnutí (výchozí je zapnuto)
    FM27_AI_BUDGET_DAILY_USD     denní limit nákladů (klouzavých 24 h)
    FM27_AI_BUDGET_MONTHLY_USD   měsíční limit nákladů (klouzavých 30 dní)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Mapping

from .costs import Budget, Ledger
from .providers import Router, routes_from_config
from .sources import SourceRegistry


def build_default_router(env: Mapping[str, str] | None = None) -> Router:
    env = os.environ if env is None else env
    providers = {}
    notes: list[str] = []
    key = env.get("ANTHROPIC_API_KEY")
    if key:
        try:
            from .anthropic_provider import AnthropicProvider

            providers["anthropic"] = AnthropicProvider(api_key=key)
        except ImportError as exc:
            notes.append(str(exc))
    else:
        notes.append("ANTHROPIC_API_KEY není nastaven v prostředí serveru")
    routes = None
    raw = env.get("FM27_AI_ROUTES")
    if raw:
        routes = routes_from_config(json.loads(raw))
    fallback = env.get("FM27_AI_REFUSAL_FALLBACK", "1").strip().lower() not in ("0", "false", "off", "no")
    return Router(providers, routes, notes=notes, refusal_fallback=fallback)


def _float_or_none(value: str | None) -> float | None:
    try:
        return float(value) if value else None
    except ValueError:
        return None


def build_default_budget(ledger: Ledger, env: Mapping[str, str] | None = None) -> Budget | None:
    env = os.environ if env is None else env
    daily = _float_or_none(env.get("FM27_AI_BUDGET_DAILY_USD"))
    monthly = _float_or_none(env.get("FM27_AI_BUDGET_MONTHLY_USD"))
    if daily is None and monthly is None:
        return None
    return Budget(ledger, daily_usd=daily, monthly_usd=monthly)


def load_registry(path: str | Path) -> SourceRegistry:
    """Načte `knowledge.json`; když soubor chybí, vrátí prázdný registr (nic nebude `verified`)."""
    file_path = Path(path)
    if not file_path.is_file():
        return SourceRegistry()
    return SourceRegistry.from_knowledge_json(file_path)
