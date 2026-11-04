"""AI gateway pro FM27 Tactical Coach (serverová část, priorita 2 z HANDOFF_CLAUDE.md).

Veřejné vstupy:
    advise(request, router=…, registry=…, ledger=…, budget=…)  → dict se `status`
    build_default_router(env)                                   → Router z prostředí serveru
    validate_advice10(advice, observations=…, registry=…)       → ValidationResult
Podrobně: docs/AI_GATEWAY_V2.md
"""

from .advice10 import ADVICE10_JSON_SCHEMA, SECTION_KEYS, ValidationResult, render_text_cs, validate_advice10
from .advise import advise
from .config import build_default_budget, build_default_router, load_registry
from .costs import Budget, Ledger, Usage
from .providers import FakeProvider, ProviderError, Route, Router
from .sources import Source, SourceRegistry

__all__ = [
    "ADVICE10_JSON_SCHEMA",
    "SECTION_KEYS",
    "Budget",
    "FakeProvider",
    "Ledger",
    "ProviderError",
    "Route",
    "Router",
    "Source",
    "SourceRegistry",
    "Usage",
    "ValidationResult",
    "advise",
    "build_default_budget",
    "build_default_router",
    "load_registry",
    "render_text_cs",
    "validate_advice10",
]
