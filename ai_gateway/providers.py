"""Rozhraní poskytovatelů AI a router úloh.

Výměna poskytovatele nebo modelu se dělá jen konfigurací (`Route`), ne přepisem aplikace.
Klíče nikdy neprocházejí tímto modulem: poskytovatel si je bere z prostředí serveru.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol, Sequence

from .costs import Usage

TASKS = ("advice", "vision", "teach", "voice")
EFFORTS = ("low", "medium", "high", "xhigh", "max")


class ProviderError(Exception):
    """Chyba poskytovatele. `kind`: not_configured | auth | rate_limit | bad_request | not_found | server | connection | timeout | unknown."""

    def __init__(self, kind: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable


@dataclass
class ProviderRequest:
    task: str
    model: str
    system: str
    messages: list[dict[str, Any]]
    schema: dict[str, Any] | None = None
    effort: str | None = None
    max_tokens: int = 16000
    refusal_fallback: bool = True


@dataclass
class ProviderResponse:
    text: str
    parsed: Any | None
    stop_reason: str  # "end" | "max_tokens" | "refusal" | "other"
    usage: Usage
    model: str
    provider: str
    request_id: str | None = None
    refusal_category: str | None = None
    notes: list[str] = field(default_factory=list)


class Provider(Protocol):
    id: str

    def complete(self, req: ProviderRequest) -> ProviderResponse: ...


class FakeProvider:
    """Skriptovaný poskytovatel pro testy a DEMO. Nikdy nevolá síť."""

    def __init__(self, script: Sequence[Any], *, id: str = "fake"):
        self.id = id
        self._script = list(script)
        self.calls: list[ProviderRequest] = []

    def complete(self, req: ProviderRequest) -> ProviderResponse:
        self.calls.append(req)
        if not self._script:
            raise ProviderError("unknown", "FakeProvider: skript je vyčerpaný")
        item = self._script.pop(0)
        if isinstance(item, BaseException):
            raise item
        if callable(item):
            item = item(req)
        return item


@dataclass(frozen=True)
class Route:
    provider: str
    model: str
    effort: str | None = None
    max_tokens: int = 16000


# Výchozí trasy jsou ODHAD vhodné rovnováhy cena/kvalita (viz docs/AI_GATEWAY_V2.md).
# Na skutečných screenshotech FM27 je nutné ověřit, jestli levnější model pro `vision` stačí.
DEFAULT_ROUTES: dict[str, Route] = {
    "advice": Route("anthropic", "claude-opus-5-5", "medium", 16000),
    "vision": Route("anthropic", "claude-haiku-5-5", "low", 4096),
    "teach": Route("anthropic", "claude-sonnet-5-5", "medium", 16000),
    "voice": Route("anthropic", "claude-haiku-5-5", "low", 1024),
}


def routes_from_config(config: Mapping[str, Mapping[str, Any]] | None) -> dict[str, Route]:
    """Přepíše výchozí trasy konfigurací `{"advice": {"provider": …, "model": …, "effort": …}}`."""
    routes = dict(DEFAULT_ROUTES)
    for task, spec in (config or {}).items():
        if task not in TASKS:
            raise ValueError(f"Neznámá úloha {task!r}; povolené: {', '.join(TASKS)}")
        base = routes[task]
        effort = spec.get("effort", base.effort)
        if effort is not None and effort not in EFFORTS:
            raise ValueError(f"Neplatná hodnota effort {effort!r} u úlohy {task}")
        routes[task] = Route(
            provider=str(spec.get("provider", base.provider)),
            model=str(spec.get("model", base.model)),
            effort=effort,
            max_tokens=int(spec.get("max_tokens", base.max_tokens)),
        )
    return routes


class Router:
    def __init__(
        self,
        providers: Mapping[str, Provider],
        routes: Mapping[str, Route] | None = None,
        *,
        notes: Sequence[str] = (),
        refusal_fallback: bool = True,
    ):
        self.providers: dict[str, Provider] = dict(providers)
        self.routes: dict[str, Route] = dict(DEFAULT_ROUTES if routes is None else routes)
        self.notes: list[str] = list(notes)
        # Serverový fallback při odmítnutí (dokumentace ho u Opus/Sonnet 5.5 doporučuje).
        # Vypnout jde proměnnou FM27_AI_REFUSAL_FALLBACK=0, kdyby ho API odmítalo.
        self.refusal_fallback = refusal_fallback

    def available(self, task: str) -> bool:
        route = self.routes.get(task)
        return bool(route and route.provider in self.providers)

    def why_unavailable(self, task: str) -> str:
        route = self.routes.get(task)
        if route is None:
            return f"Úloha {task!r} nemá nastavenou trasu."
        if route.provider not in self.providers:
            extra = f" ({'; '.join(self.notes)})" if self.notes else ""
            return f"Poskytovatel {route.provider!r} není nakonfigurovaný{extra}."
        return ""

    def complete(
        self,
        task: str,
        *,
        system: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any] | None = None,
        refusal_fallback: bool | None = None,
    ) -> tuple[ProviderResponse, Route]:
        if not self.available(task):
            raise ProviderError("not_configured", self.why_unavailable(task))
        route = self.routes[task]
        provider = self.providers[route.provider]
        request = ProviderRequest(
            task=task,
            model=route.model,
            system=system,
            messages=messages,
            schema=schema,
            effort=route.effort,
            max_tokens=route.max_tokens,
            refusal_fallback=self.refusal_fallback if refusal_fallback is None else refusal_fallback,
        )
        return provider.complete(request), route
