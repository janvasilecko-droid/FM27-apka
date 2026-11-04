from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path

from ai_gateway.advice10 import ADVICE10_JSON_SCHEMA
from ai_gateway.advise import MAX_IMAGE_BYTES, SYSTEM_PROMPT_CS, advise
from ai_gateway.costs import Budget, Ledger, Price, Usage
from ai_gateway.demo_data import demo_advice, demo_request
from ai_gateway.providers import FakeProvider, ProviderError, ProviderResponse, Route, Router
from ai_gateway.sources import SourceRegistry

ROOT = Path(__file__).resolve().parents[2] / "reference" / "codex-2026-11-01"
REGISTRY = SourceRegistry.from_knowledge_json(ROOT / "knowledge.json")
PLAN = json.loads((ROOT / "takticky-plan.json").read_text(encoding="utf-8"))
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()


def resp(advice=None, *, text=None, stop="end", usage=(1000, 500), model="claude-opus-5-5", category=None, notes=()):
    if text is None:
        text = json.dumps(advice, ensure_ascii=False)
    return ProviderResponse(
        text=text,
        parsed=advice,
        stop_reason=stop,
        usage=Usage(*usage),
        model=model,
        provider="fake",
        request_id="req_1",
        refusal_category=category,
        notes=list(notes),
    )


def router_for(*script):
    provider = FakeProvider(script)
    routes = {"advice": Route("fake", "claude-opus-5-5", "medium", 16000)}
    return Router({"fake": provider}, routes), provider


def bad_advice():
    """Vysoká jistota jen ze strojového čtení: validátor ji musí odmítnout."""
    advice = demo_advice()
    advice["confidence"]["level"] = "high"
    return advice


class Stub(unittest.TestCase):
    def test_no_router(self):
        result = advise(demo_request(), router=None)
        self.assertEqual((result["status"], result["provenance"]), ("stub", "stub"))
        self.assertIsNone(result["advice"])

    def test_no_provider_explains_why(self):
        router = Router({}, notes=["ANTHROPIC_API_KEY není nastaven v prostředí serveru"])
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "stub")
        self.assertIn("ANTHROPIC_API_KEY", result["errors"][0])


class HappyPath(unittest.TestCase):
    def test_valid_advice(self):
        router, provider = router_for(resp(demo_advice()))
        ledger = Ledger({"fake/claude-opus-5-5": Price(input=4.0, output=20.0)})
        result = advise(demo_request(), router=router, registry=REGISTRY, ledger=ledger)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["provenance"], "ai_advise")
        self.assertTrue(result["needs_verification"])
        self.assertIn("10. Co nevím", result["text_cs"])
        self.assertEqual(len(provider.calls), 1)
        call = provider.calls[0]
        self.assertIs(call.schema, ADVICE10_JSON_SCHEMA)
        self.assertEqual(call.system, SYSTEM_PROMPT_CS)
        prompt = call.messages[0]["content"][0]["text"]
        self.assertIn("obs-1 | ocr_unverified | 34'", prompt)
        self.assertIn("fm27-navigation", prompt)  # registr zdrojů je v promptu
        self.assertEqual(len(ledger.records), 1)
        self.assertAlmostEqual(result["cost_usd"], (1000 * 4 + 500 * 20) / 1_000_000)
        self.assertEqual(result["usage"]["input_tokens"], 1000)
        self.assertEqual(result["request_id"], "req_1")

    def test_cost_is_unknown_without_a_price(self):
        router, _ = router_for(resp(demo_advice()))
        result = advise(demo_request(), router=router, ledger=Ledger())
        self.assertEqual(result["status"], "ok")
        self.assertIsNone(result["cost_usd"])

    def test_json_in_text_when_parsed_is_missing(self):
        router, _ = router_for(resp(None, text=json.dumps(demo_advice(), ensure_ascii=False)))
        self.assertEqual(advise(demo_request(), router=router)["status"], "ok")

    def test_provider_notes_are_passed_on_as_warnings(self):
        router, _ = router_for(resp(demo_advice(), notes=["Obsloužil záložní model."]))
        result = advise(demo_request(), router=router)
        self.assertIn("Obsloužil záložní model.", result["warnings"])

    def test_plan_becomes_a_user_entered_observation(self):
        router, provider = router_for(resp(demo_advice()))
        advise({"plan": PLAN, "observations": []}, router=router)
        prompt = provider.calls[0].messages[0]["content"][0]["text"]
        self.assertIn("plan | user_entered", prompt)
        self.assertIn("Základní 4–3–3", prompt)
        self.assertIn("Brankář", prompt)


PASSAGE = {"id": "bk:abc:12:3", "title": "Kniha o taktice", "page": 12, "text": "Teorie o podpoře útočníka."}


def cites_passage(advice, pid="bk:abc:12:3"):
    advice["diagnosis"]["refs"] = ["obs-1", pid]
    return advice


class Passages(unittest.TestCase):
    def test_passages_reach_the_prompt_and_can_be_cited(self):
        router, provider = router_for(resp(cites_passage(demo_advice())))
        result = advise({**demo_request(), "passages": [PASSAGE]}, router=router)
        self.assertEqual(result["status"], "ok", result["errors"])
        prompt = provider.calls[0].messages[0]["content"][0]["text"]
        self.assertIn("bk:abc:12:3 | Kniha o taktice | 12 | Teorie o podpoře útočníka.", prompt)
        self.assertIn("Jsou to teorie", prompt)

    def test_prompt_admits_when_there_are_no_passages(self):
        router, provider = router_for(resp(demo_advice()))
        advise(demo_request(), router=router)
        self.assertIn("rada nevychází z knih", provider.calls[0].messages[0]["content"][0]["text"])

    def test_citing_a_passage_that_was_not_provided_triggers_repair(self):
        router, provider = router_for(resp(cites_passage(demo_advice(), "bk:other:1:1")), resp(demo_advice()))
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(provider.calls), 2)
        self.assertIn("neodpovídá", provider.calls[1].messages[2]["content"])

    def test_invalid_passages_are_rejected_before_any_call(self):
        cases = [
            [{**PASSAGE, "id": "kniha-1"}],
            [PASSAGE, PASSAGE],
            [{**PASSAGE, "id": "bk:" + "x" * 80}],
            [{**PASSAGE, "id": f"bk:a:{i}:1"} for i in range(13)],
            [{**PASSAGE, "id": "obs-1"}],
        ]
        for passages in cases:
            router, provider = router_for(resp(demo_advice()))
            result = advise({**demo_request(), "passages": passages}, router=router)
            self.assertEqual(result["status"], "error", passages[:1])
            self.assertEqual(provider.calls, [])

    def test_passage_id_may_not_collide_with_an_observation_id(self):
        request = {**demo_request(), "observations": [{"id": "bk:abc:12:3", "label": "user_entered", "text": "x"}], "passages": [PASSAGE]}
        router, provider = router_for(resp(demo_advice()))
        self.assertEqual(advise(request, router=router)["status"], "error")


class Repair(unittest.TestCase):
    def test_one_repair_round_fixes_the_advice(self):
        router, provider = router_for(resp(bad_advice()), resp(demo_advice()))
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(provider.calls), 2)
        second = provider.calls[1].messages
        self.assertEqual([m["role"] for m in second], ["user", "assistant", "user"])
        self.assertIn("nesplnila tato pravidla", second[2]["content"])
        self.assertIn("strojové čtení", second[2]["content"])
        self.assertEqual(result["usage"]["input_tokens"], 2000)  # obě volání se počítají

    def test_two_failures_never_return_unvalidated_advice(self):
        router, provider = router_for(resp(bad_advice()), resp(bad_advice()))
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "needs_more_info")
        self.assertIsNone(result["advice"])
        self.assertIsNone(result["text_cs"])
        self.assertTrue(result["errors"])
        self.assertEqual(len(provider.calls), 2)

    def test_no_repair_when_disabled(self):
        router, provider = router_for(resp(bad_advice()))
        result = advise(demo_request(), router=router, max_repairs=0)
        self.assertEqual(result["status"], "needs_more_info")
        self.assertEqual(len(provider.calls), 1)

    def test_invalid_json_triggers_repair(self):
        router, provider = router_for(resp(None, text="tohle není JSON"), resp(demo_advice()))
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "ok")
        self.assertIn("není platný JSON", provider.calls[1].messages[2]["content"])


class Failures(unittest.TestCase):
    def test_refusal(self):
        router, _ = router_for(resp(None, text="", stop="refusal", category="cyber"))
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "refused")
        self.assertIn("cyber", result["errors"][0])

    def test_truncated_output(self):
        router, _ = router_for(resp(None, text="{", stop="max_tokens"))
        self.assertEqual(advise(demo_request(), router=router)["status"], "error")

    def test_provider_error_keeps_retryable_flag(self):
        router, _ = router_for(ProviderError("rate_limit", "Překročen limit", retryable=True))
        result = advise(demo_request(), router=router)
        self.assertEqual(result["status"], "error")
        self.assertTrue(result["retryable"])
        self.assertIn("rate_limit", result["errors"][0])

    def test_budget_exceeded_makes_no_call(self):
        router, provider = router_for(resp(demo_advice()))
        ledger = Ledger({"fake/claude-opus-5-5": Price(input=1_000_000.0, output=0.0)})
        ledger.record(task="advice", provider="fake", model="claude-opus-5-5", usage=Usage(10, 0))
        result = advise(demo_request(), router=router, ledger=ledger, budget=Budget(ledger, daily_usd=1.0))
        self.assertEqual(result["status"], "budget_exceeded")
        self.assertEqual(provider.calls, [])

    def test_budget_is_rechecked_before_a_repair_call(self):
        ledger = Ledger({"fake/claude-opus-5-5": Price(input=1_000_000.0, output=0.0)})
        router, provider = router_for(resp(bad_advice(), usage=(1, 0)), resp(demo_advice()))
        result = advise(demo_request(), router=router, ledger=ledger, budget=Budget(ledger, daily_usd=0.5))
        self.assertEqual(result["status"], "budget_exceeded")
        self.assertEqual(len(provider.calls), 1)


class InputValidation(unittest.TestCase):
    def run_with(self, request):
        router, provider = router_for(resp(demo_advice()))
        return advise(request, router=router), provider

    def test_bad_inputs_are_rejected_before_any_call(self):
        cases = [
            {"observations": [{"id": "a", "label": "magic", "text": "x"}]},
            {"observations": [{"id": "bad id!", "label": "user_entered", "text": "x"}]},
            {"observations": [{"id": "a", "label": "user_entered", "text": "x"}] * 2},
            {"observations": [{"id": "a", "label": "ai_advise", "text": "vlastní rada se nesmí citovat"}]},
            {"plan": PLAN, "observations": [{"id": "plan", "label": "user_entered", "text": "x"}]},
            {"observations": [{"id": f"o{i}", "label": "user_entered", "text": "x"} for i in range(41)]},
        ]
        for request in cases:
            result, provider = self.run_with(request)
            self.assertEqual(result["status"], "error", request)
            self.assertIn("Neplatný vstup", result["errors"][0])
            self.assertEqual(provider.calls, [])

    def test_images_are_not_sent_without_a_user_action(self):
        request = {**demo_request(), "images": [{"id": "img-1", "media_type": "image/png", "data_b64": PNG}]}
        result, provider = self.run_with(request)
        self.assertEqual(result["status"], "ok")
        self.assertTrue(any("user_initiated_images" in w for w in result["warnings"]))
        blocks = provider.calls[0].messages[0]["content"]
        self.assertEqual([b["type"] for b in blocks], ["text"])

    def test_images_are_sent_after_a_user_action(self):
        request = {
            **demo_request(),
            "images": [{"id": "img-1", "media_type": "image/png", "data_b64": PNG}],
            "user_initiated_images": True,
        }
        result, provider = self.run_with(request)
        self.assertEqual(result["status"], "ok")
        blocks = provider.calls[0].messages[0]["content"]
        self.assertEqual([b["type"] for b in blocks], ["text", "image", "text"])
        self.assertEqual(blocks[1]["source"], {"type": "base64", "media_type": "image/png", "data": PNG})
        self.assertIn("img-1 | vision_unverified", blocks[0]["text"])

    def test_image_validation(self):
        base = {**demo_request(), "user_initiated_images": True}
        too_big = base64.b64encode(b"\x00" * (MAX_IMAGE_BYTES + 1)).decode()
        for image in (
            {"id": "img-1", "media_type": "image/bmp", "data_b64": PNG},
            {"id": "img-1", "media_type": "image/png", "data_b64": "!!!nejsou-base64!!!"},
            {"id": "img-1", "media_type": "image/png", "data_b64": ""},
            {"id": "img-1", "media_type": "image/png", "data_b64": too_big},
            {"id": "obs-1", "media_type": "image/png", "data_b64": PNG},
        ):
            result, provider = self.run_with({**base, "images": [image]})
            self.assertEqual(result["status"], "error", image["id"])
            self.assertEqual(provider.calls, [])


if __name__ == "__main__":
    unittest.main()
