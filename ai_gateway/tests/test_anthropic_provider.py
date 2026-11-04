"""Adaptér Anthropic proti ZACHYCENÉMU HTTP přenosu (`httpx2.MockTransport`).

Používá se skutečné SDK, takže testy ověřují, co SDK doopravdy odešle (tělo, hlavičky, adresa)
a jak čte odpověď. Neověřují, že živé API přijme všechny parametry: to vyžaduje klíč
(viz docs/AI_GATEWAY_V2.md, „Co ověřit s klíčem“).
"""

from __future__ import annotations

import json
import unittest

from ai_gateway.advice10 import ADVICE10_JSON_SCHEMA
from ai_gateway.providers import ProviderError, ProviderRequest

try:
    import anthropic
    import httpx2
except ImportError:  # pragma: no cover
    anthropic = None

from ai_gateway.anthropic_provider import FALLBACK_BETA, AnthropicProvider

SECRET = "sk-test-NEVER-LEAK-1234567890"


def message(*, text="{}", stop="end_turn", model="claude-opus-5-5", usage=None, extra=None):
    body = {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop,
        "stop_sequence": None,
        "usage": usage or {"input_tokens": 11, "output_tokens": 7, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
    }
    body.update(extra or {})
    return body


def error_body(kind, text):
    return {"type": "error", "error": {"type": kind, "message": text}}


@unittest.skipUnless(anthropic is not None, "chybí balíček anthropic")
class AnthropicAdapter(unittest.TestCase):
    def setUp(self):
        self.seen: list[dict] = []
        self.replies: list = []

    def provider(self):
        def handler(request):
            self.seen.append(
                {
                    "method": request.method,
                    "path": request.url.path,
                    "query": str(request.url.query),
                    "headers": {k.lower(): v for k, v in request.headers.items()},
                    "body": json.loads(request.content or b"{}"),
                }
            )
            reply = self.replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            status, body = reply
            return httpx2.Response(status, json=body, headers={"request-id": "req_abc"})

        client = anthropic.Anthropic(
            api_key=SECRET,
            http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler)),
            max_retries=0,
        )
        return AnthropicProvider(client=client)

    def request(self, **over):
        base = dict(
            task="advice",
            model="claude-opus-5-5",
            system="Systémový prompt",
            messages=[{"role": "user", "content": [{"type": "text", "text": "ahoj"}]}],
            schema=ADVICE10_JSON_SCHEMA,
            effort="medium",
            max_tokens=2000,
        )
        base.update(over)
        return ProviderRequest(**base)

    # --- tvar požadavku -------------------------------------------------------------------
    def test_opus_request_shape_with_fallback(self):
        self.replies.append((200, message(text=json.dumps({"ok": True}))))
        result = self.provider().complete(self.request())
        sent = self.seen[0]
        self.assertEqual(sent["method"], "POST")
        self.assertEqual(sent["path"], "/v1/messages")
        self.assertIn(FALLBACK_BETA, sent["headers"]["anthropic-beta"])
        self.assertIn("anthropic-version", sent["headers"])
        body = sent["body"]
        self.assertEqual(body["fallbacks"], "default")
        self.assertEqual(body["model"], "claude-opus-5-5")
        self.assertEqual(body["max_tokens"], 2000)
        self.assertEqual(body["system"], "Systémový prompt")
        self.assertEqual(body["output_config"]["effort"], "medium")
        self.assertEqual(body["output_config"]["format"], {"type": "json_schema", "schema": ADVICE10_JSON_SCHEMA})
        for removed in ("temperature", "top_p", "top_k", "thinking", "tool_choice"):
            self.assertNotIn(removed, body)
        self.assertEqual(body["messages"][-1]["role"], "user")  # žádný prefill asistenta
        self.assertEqual(result.parsed, {"ok": True})

    def test_haiku_has_no_fallback(self):
        self.replies.append((200, message(model="claude-haiku-5-5")))
        self.provider().complete(self.request(model="claude-haiku-5-5", effort="low", schema=None))
        sent = self.seen[0]
        self.assertEqual(sent["path"], "/v1/messages")
        self.assertNotIn("anthropic-beta", sent["headers"])
        self.assertNotIn("fallbacks", sent["body"])
        self.assertEqual(sent["body"]["output_config"], {"effort": "low"})

    def test_fallback_can_be_switched_off(self):
        self.replies.append((200, message()))
        self.provider().complete(self.request(refusal_fallback=False))
        self.assertNotIn("anthropic-beta", self.seen[0]["headers"])
        self.assertNotIn("fallbacks", self.seen[0]["body"])

    def test_no_output_config_when_nothing_requested(self):
        self.replies.append((200, message(model="claude-haiku-5-5")))
        self.provider().complete(self.request(model="claude-haiku-5-5", effort=None, schema=None))
        self.assertNotIn("output_config", self.seen[0]["body"])

    def test_image_blocks_are_passed_through_unchanged(self):
        blocks = [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"}},
            {"type": "text", "text": "co vidíš?"},
        ]
        self.replies.append((200, message(model="claude-haiku-5-5")))
        self.provider().complete(
            self.request(model="claude-haiku-5-5", messages=[{"role": "user", "content": blocks}], schema=None)
        )
        self.assertEqual(self.seen[0]["body"]["messages"][0]["content"], blocks)

    # --- čtení odpovědi -------------------------------------------------------------------
    def test_response_mapping(self):
        usage = {"input_tokens": 100, "output_tokens": 40, "cache_creation_input_tokens": 5, "cache_read_input_tokens": 60}
        self.replies.append((200, message(text='{"a": 1}', usage=usage)))
        result = self.provider().complete(self.request())
        self.assertEqual(result.stop_reason, "end")
        self.assertEqual(result.parsed, {"a": 1})
        self.assertEqual(
            (result.usage.input_tokens, result.usage.output_tokens, result.usage.cache_read_tokens, result.usage.cache_write_tokens),
            (100, 40, 60, 5),
        )
        self.assertEqual((result.provider, result.model, result.request_id), ("anthropic", "claude-opus-5-5", "req_abc"))

    def test_invalid_json_leaves_parsed_empty(self):
        self.replies.append((200, message(text="tohle není JSON")))
        result = self.provider().complete(self.request())
        self.assertIsNone(result.parsed)
        self.assertEqual(result.text, "tohle není JSON")
        self.assertTrue(any("JSON" in note for note in result.notes))

    def test_refusal(self):
        extra = {"stop_details": {"type": "refusal", "category": "cyber", "explanation": "x"}}
        self.replies.append((200, message(text="", stop="refusal", extra=extra)))
        result = self.provider().complete(self.request())
        self.assertEqual((result.stop_reason, result.refusal_category), ("refusal", "cyber"))
        self.assertIsNone(result.parsed)

    def test_max_tokens(self):
        self.replies.append((200, message(text='{"a"', stop="max_tokens")))
        result = self.provider().complete(self.request())
        self.assertEqual(result.stop_reason, "max_tokens")
        self.assertIsNone(result.parsed)

    def test_other_model_served_is_noted(self):
        self.replies.append((200, message(model="claude-opus-4-8")))
        result = self.provider().complete(self.request())
        self.assertEqual(result.model, "claude-opus-4-8")
        self.assertTrue(any("claude-opus-4-8" in note for note in result.notes))

    # --- chyby ----------------------------------------------------------------------------
    def test_fallback_rejected_by_api_is_retried_once_without_it(self):
        self.replies.append((400, error_body("invalid_request_error", "Unknown parameter: fallbacks")))
        self.replies.append((200, message()))
        result = self.provider().complete(self.request())
        self.assertEqual(len(self.seen), 2)
        self.assertIn("fallbacks", self.seen[0]["body"])
        self.assertNotIn("fallbacks", self.seen[1]["body"])
        self.assertNotIn("anthropic-beta", self.seen[1]["headers"])
        self.assertTrue(any("zopakován" in note for note in result.notes))

    def test_unrelated_bad_request_is_not_retried(self):
        self.replies.append((400, error_body("invalid_request_error", "max_tokens: too large")))
        with self.assertRaises(ProviderError) as ctx:
            self.provider().complete(self.request())
        self.assertEqual(ctx.exception.kind, "bad_request")
        self.assertEqual(len(self.seen), 1)

    def test_error_mapping(self):
        cases = [
            ((401, error_body("authentication_error", "invalid x-api-key")), "auth", False),
            ((403, error_body("permission_error", "no")), "auth", False),
            ((404, error_body("not_found_error", "model: x")), "not_found", False),
            ((429, error_body("rate_limit_error", "slow down")), "rate_limit", True),
            ((500, error_body("api_error", "oops")), "server", True),
            ((529, error_body("overloaded_error", "busy")), "server", True),
            (httpx2.ConnectError("boom"), "connection", True),
        ]
        for reply, kind, retryable in cases:
            self.replies.append(reply)
            with self.assertRaises(ProviderError) as ctx:
                self.provider().complete(self.request(refusal_fallback=False))
            self.assertEqual((ctx.exception.kind, ctx.exception.retryable), (kind, retryable), reply)

    def test_api_key_never_appears_in_errors(self):
        self.replies.append((401, error_body("authentication_error", f"invalid key {SECRET}")))
        with self.assertRaises(ProviderError) as ctx:
            self.provider().complete(self.request(refusal_fallback=False))
        self.assertNotIn(SECRET, str(ctx.exception))
        # Klíč odešel jen v autorizační hlavičce (SDK 2.x posílá `Authorization: Bearer …`), nikam jinam.
        self.assertIn(SECRET, self.seen[0]["headers"]["authorization"])
        self.assertNotIn(SECRET, json.dumps(self.seen[0]["body"]))

    def test_error_from_the_retry_is_mapped_too(self):
        self.replies.append((400, error_body("invalid_request_error", "Unknown parameter: fallbacks")))
        self.replies.append((429, error_body("rate_limit_error", "slow down")))
        with self.assertRaises(ProviderError) as ctx:
            self.provider().complete(self.request())
        self.assertEqual(ctx.exception.kind, "rate_limit")


if __name__ == "__main__":
    unittest.main()
