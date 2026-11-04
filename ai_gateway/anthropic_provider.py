"""Adaptér Anthropic přes oficiální SDK (`pip install anthropic`).

Běží jen na serveru: klíč se bere z prostředí (`ANTHROPIC_API_KEY`), nikdy z klienta.
Požadavek respektuje změny API u modelů 5.x (viz dokumentace Claude API):
- bez `temperature`/`top_p`/`top_k` (SDK je už ani nepřijímá), bez `thinking.budget_tokens`,
  bez předvyplněné odpovědi asistenta a bez vynuceného `tool_choice`;
- hloubku uvažování řídí `output_config.effort`, strukturovaný výstup `output_config.format`;
- `stop_reason == "refusal"` se vrací jako odmítnutí, ne jako prázdná odpověď;
- u Opus 5.5 / Sonnet 5.5 se podle doporučení dokumentace zapíná serverový fallback při odmítnutí
  (`betas=["server-side-fallback-2026-07-01"]`, `fallbacks="default"`). Pokud ho API odmítne
  jako neplatný parametr, požadavek se jednou zopakuje bez něj.

NEOVĚŘENO proti živému API (v době psaní nebyl k dispozici klíč): testy běží proti zachycenému
HTTP přenosu (`httpx2.MockTransport`), takže ověřují, co SDK skutečně odešle a jak čte odpověď,
ale ne, že API přijme všechny parametry. Viz `docs/AI_GATEWAY_V2.md`, část „Co ověřit s klíčem“.
"""

from __future__ import annotations

import json
from typing import Any

from .costs import Usage
from .providers import ProviderError, ProviderRequest, ProviderResponse

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Modely, u nichž dokumentace počítá se serverovým fallbackem. Haiku 5.5 ho nemá.
FALLBACK_MODELS = frozenset({"claude-opus-5-5", "claude-sonnet-5-5"})

_STOP_MAP = {"end_turn": "end", "stop_sequence": "end", "max_tokens": "max_tokens", "refusal": "refusal"}


def _mentions_fallback(exc: Exception) -> bool:
    text = str(getattr(exc, "message", exc)).lower()
    return "fallback" in text or "beta" in text


class AnthropicProvider:
    id = "anthropic"

    def __init__(
        self,
        client: Any | None = None,
        *,
        api_key: str | None = None,
        timeout: float = 120.0,
        max_retries: int = 2,
    ):
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - závisí na prostředí
            raise ImportError("Chybí balíček anthropic: spusť `pip install anthropic`.") from exc
        self._sdk = anthropic
        self._client = client or anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=max_retries)

    # ------------------------------------------------------------------------------------
    def complete(self, req: ProviderRequest) -> ProviderResponse:
        kwargs: dict[str, Any] = {
            "model": req.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": req.messages,
        }
        output_config: dict[str, Any] = {}
        if req.effort:
            output_config["effort"] = req.effort
        if req.schema:
            output_config["format"] = {"type": "json_schema", "schema": req.schema}
        if output_config:
            kwargs["output_config"] = output_config

        notes: list[str] = []
        use_fallback = req.refusal_fallback and req.model in FALLBACK_MODELS
        try:
            response = self._create(kwargs, use_fallback)
        except self._sdk.BadRequestError as exc:
            if not (use_fallback and _mentions_fallback(exc)):
                raise self._map_error(exc) from exc
            notes.append("API nepřijalo serverový fallback při odmítnutí; požadavek zopakován bez něj.")
            try:
                response = self._create(kwargs, False)
            except self._sdk.APIError as retry_exc:
                raise self._map_error(retry_exc) from retry_exc
        except self._sdk.APIError as exc:
            raise self._map_error(exc) from exc
        return self._to_response(req, response, notes)

    # ------------------------------------------------------------------------------------
    def _create(self, kwargs: dict[str, Any], use_fallback: bool) -> Any:
        if use_fallback:
            return self._client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
        return self._client.messages.create(**kwargs)

    def _to_response(self, req: ProviderRequest, response: Any, notes: list[str]) -> ProviderResponse:
        stop = _STOP_MAP.get(getattr(response, "stop_reason", None), "other")
        text = "".join(
            block.text for block in getattr(response, "content", []) if getattr(block, "type", None) == "text"
        )
        parsed = None
        if req.schema and stop == "end" and text.strip():
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                notes.append("Odpověď nebyla platný JSON.")
        usage_raw = getattr(response, "usage", None)
        usage = Usage(
            input_tokens=getattr(usage_raw, "input_tokens", 0) or 0,
            output_tokens=getattr(usage_raw, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(usage_raw, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(usage_raw, "cache_creation_input_tokens", 0) or 0,
        )
        details = getattr(response, "stop_details", None)
        served_model = getattr(response, "model", None) or req.model
        if served_model != req.model:
            notes.append(f"Odpověď obsloužil jiný model než požadovaný: {served_model}.")
        return ProviderResponse(
            text=text,
            parsed=parsed,
            stop_reason=stop,
            usage=usage,
            model=served_model,
            provider=self.id,
            request_id=getattr(response, "_request_id", None),
            refusal_category=getattr(details, "category", None) if details else None,
            notes=notes,
        )

    def _map_error(self, exc: Exception) -> ProviderError:
        sdk = self._sdk
        message = str(getattr(exc, "message", None) or exc)
        if isinstance(exc, (sdk.AuthenticationError, sdk.PermissionDeniedError)):
            return ProviderError("auth", "API klíč je neplatný nebo nemá potřebná oprávnění.")
        if isinstance(exc, sdk.RateLimitError):
            return ProviderError("rate_limit", "Překročen limit požadavků; zkus to za chvíli.", retryable=True)
        if isinstance(exc, sdk.NotFoundError):
            return ProviderError("not_found", f"Model nebo adresa nenalezena: {message}")
        if isinstance(exc, sdk.BadRequestError):
            return ProviderError("bad_request", f"API odmítlo požadavek: {message}")
        if isinstance(exc, sdk.APITimeoutError):
            return ProviderError("timeout", "Vypršel časový limit požadavku.", retryable=True)
        if isinstance(exc, sdk.APIConnectionError):
            return ProviderError("connection", "Chyba sítě při volání API.", retryable=True)
        status = getattr(exc, "status_code", None)
        if isinstance(exc, sdk.APIStatusError) and isinstance(status, int) and status >= 500:
            return ProviderError("server", f"Chyba serveru API ({status}).", retryable=True)
        return ProviderError("unknown", f"Neočekávaná chyba API: {message}")
