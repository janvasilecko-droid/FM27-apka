from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from ai_gateway.costs import DEFAULT_PRICES, Budget, Ledger, Price, Usage
from ai_gateway.providers import (
    DEFAULT_ROUTES,
    FakeProvider,
    ProviderError,
    ProviderResponse,
    Route,
    Router,
    routes_from_config,
)


class Clock:
    def __init__(self, now=1_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


class Costs(unittest.TestCase):
    def test_opus_cost(self):
        ledger = Ledger()
        usd = ledger.cost_usd("anthropic", "claude-opus-5-5", Usage(1000, 500))
        self.assertAlmostEqual(usd, (1000 * 4 + 500 * 20) / 1_000_000)

    def test_unknown_model_cost_is_unknown_not_zero(self):
        self.assertIsNone(Ledger().cost_usd("anthropic", "claude-future-9", Usage(10, 10)))

    def test_cache_tokens_need_a_cache_price(self):
        ledger = Ledger()
        priced = ledger.cost_usd("anthropic", "claude-opus-5-5", Usage(0, 0, cache_read_tokens=1_000_000))
        self.assertAlmostEqual(priced, 0.20)
        self.assertIsNone(ledger.cost_usd("anthropic", "claude-haiku-5-5", Usage(0, 0, cache_read_tokens=10)))

    def test_haiku_long_context_tier(self):
        ledger = Ledger()
        short = ledger.cost_usd("anthropic", "claude-haiku-5-5", Usage(100_000, 0))
        long = ledger.cost_usd("anthropic", "claude-haiku-5-5", Usage(100_001, 0))
        # Kniha zaokrouhluje na 6 desetinných míst (miliontiny USD).
        self.assertEqual(short, round(100_000 * 0.10 / 1_000_000, 6))
        self.assertEqual(long, round(100_001 * 0.50 / 1_000_000, 6))
        self.assertGreater(long, short * 4)

    def test_default_prices_say_where_they_come_from(self):
        for price in DEFAULT_PRICES.values():
            self.assertTrue(price.source)
            self.assertRegex(price.valid_from, r"^\d{4}-\d{2}-\d{2}$")

    def test_ledger_summary_and_unpriced_calls(self):
        clock = Clock()
        ledger = Ledger(clock=clock)
        ledger.record(task="advice", provider="anthropic", model="claude-opus-5-5", usage=Usage(1000, 500))
        ledger.record(task="vision", provider="anthropic", model="claude-haiku-5-5", usage=Usage(2000, 100))
        ledger.record(task="advice", provider="other", model="mystery", usage=Usage(5, 5))
        summary = ledger.summary()
        self.assertEqual(summary["calls"], 3)
        self.assertEqual(summary["unpriced_calls"], 1)
        self.assertEqual(summary["by_task"]["advice"]["calls"], 2)
        self.assertEqual(summary["input_tokens"], 3005)
        self.assertAlmostEqual(summary["usd_known"], ledger.total_usd())
        self.assertIn("ověřit", summary["prices_note"])

    def test_budget_windows(self):
        clock = Clock()
        ledger = Ledger({"p/m": Price(input=1_000_000.0, output=0.0)}, clock=clock)
        budget = Budget(ledger, daily_usd=5.0, monthly_usd=8.0, clock=clock)
        self.assertEqual(budget.check(), (True, None))
        ledger.record(task="advice", provider="p", model="m", usage=Usage(4, 0))  # 4 USD
        self.assertTrue(budget.check()[0])
        ledger.record(task="advice", provider="p", model="m", usage=Usage(2, 0))  # 6 USD za 24 h
        allowed, why = budget.check()
        self.assertFalse(allowed)
        self.assertIn("Denní limit", why)
        clock.now += 2 * 86_400  # den uplynul, měsíc ne
        allowed, why = budget.check()
        self.assertTrue(allowed)
        ledger.record(task="advice", provider="p", model="m", usage=Usage(3, 0))  # 9 USD za 30 dní
        allowed, why = budget.check()
        self.assertFalse(allowed)
        self.assertIn("Měsíční limit", why)

    def test_sink_writes_json_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            sink = Path(tmp) / "nested" / "usage.jsonl"
            ledger = Ledger(sink=sink)
            ledger.record(task="advice", provider="anthropic", model="claude-opus-5-5", usage=Usage(1, 2), request_id="req_1")
            rows = [json.loads(line) for line in sink.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(rows[0]["request_id"], "req_1")
            self.assertEqual(rows[0]["usage"]["output_tokens"], 2)


def response(provider="a", model="m"):
    return ProviderResponse(
        text="{}", parsed={}, stop_reason="end", usage=Usage(1, 1), model=model, provider=provider
    )


class Routing(unittest.TestCase):
    def test_config_overrides_without_touching_defaults(self):
        routes = routes_from_config({"advice": {"model": "claude-opus-5-5", "effort": "high"}})
        self.assertEqual(routes["advice"].effort, "high")
        self.assertEqual(DEFAULT_ROUTES["advice"].effort, "medium")
        self.assertEqual(routes["vision"], DEFAULT_ROUTES["vision"])

    def test_invalid_config_is_rejected(self):
        with self.assertRaises(ValueError):
            routes_from_config({"dance": {}})
        with self.assertRaises(ValueError):
            routes_from_config({"advice": {"effort": "turbo"}})

    def test_swapping_provider_needs_config_only(self):
        a, b = FakeProvider([response("a"), response("a")], id="a"), FakeProvider([response("b")], id="b")
        providers = {"a": a, "b": b}
        for name in ("a", "a", "b"):
            routes = {"advice": Route(name, "model-x", "low", 123)}
            Router(providers, routes).complete("advice", system="s", messages=[])
        self.assertEqual((len(a.calls), len(b.calls)), (2, 1))
        request = b.calls[0]
        self.assertEqual((request.model, request.effort, request.max_tokens), ("model-x", "low", 123))

    def test_unconfigured_provider_is_reported(self):
        router = Router({}, notes=["ANTHROPIC_API_KEY není nastaven"])
        self.assertFalse(router.available("advice"))
        self.assertIn("ANTHROPIC_API_KEY", router.why_unavailable("advice"))
        with self.assertRaises(ProviderError) as ctx:
            router.complete("advice", system="s", messages=[])
        self.assertEqual(ctx.exception.kind, "not_configured")

    def test_unknown_task_is_unavailable(self):
        self.assertFalse(Router({}).available("juggling"))
        self.assertIn("nemá nastavenou trasu", Router({}).why_unavailable("juggling"))

    def test_fake_provider_script(self):
        boom = ProviderError("server", "x")
        provider = FakeProvider([boom, lambda req: response(model=req.model)])
        router = Router({"anthropic": provider})
        with self.assertRaises(ProviderError):
            router.complete("advice", system="s", messages=[])
        got, route = router.complete("advice", system="s", messages=[])
        self.assertEqual(got.model, route.model)
        with self.assertRaises(ProviderError):
            router.complete("advice", system="s", messages=[])  # skript vyčerpán

    def test_refusal_fallback_flag_reaches_the_provider(self):
        provider = FakeProvider([response(), response(), response()])
        routes = {"advice": Route("fake", "m")}
        Router({"fake": provider}, routes).complete("advice", system="s", messages=[])
        Router({"fake": provider}, routes, refusal_fallback=False).complete("advice", system="s", messages=[])
        Router({"fake": provider}, routes, refusal_fallback=False).complete(
            "advice", system="s", messages=[], refusal_fallback=True
        )
        self.assertEqual([c.refusal_fallback for c in provider.calls], [True, False, True])


if __name__ == "__main__":
    unittest.main()
