from __future__ import annotations

import base64
import json
import unittest

from ai_gateway.advise import advise
from ai_gateway.costs import Budget, Ledger, Price, Usage
from ai_gateway.demo_data import demo_advice
from ai_gateway.live_check import main as live_check_main
from ai_gateway.providers import FakeProvider, ProviderError, ProviderResponse, Route, Router
from ai_gateway.vision import (
    SCREEN_JSON_SCHEMA,
    VISION_SYSTEM_PROMPT_CS,
    extract_screen,
    fields_to_observations,
    validate_screen,
)

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()
IMAGE = {"media_type": "image/png", "data_b64": PNG}


def screen(**over):
    base = {
        "screen_type": "match_stats",
        "fields": [
            {"key": "držení míče domácí", "value": "62 %", "evidence_text": "Držení míče 62% 38%"},
            {"key": "střely", "value": "11", "evidence_text": "Střely 11 3"},
        ],
        "unreadable": ["pravý dolní roh je zakrytý"],
    }
    base.update(over)
    return base


def resp(parsed=None, *, text=None, stop="end", model="claude-haiku-5-5", notes=()):
    return ProviderResponse(
        text=json.dumps(parsed, ensure_ascii=False) if text is None else text,
        parsed=parsed,
        stop_reason=stop,
        usage=Usage(1500, 120),
        model=model,
        provider="fake",
        request_id="req_v",
        notes=list(notes),
    )


def router_for(*script):
    provider = FakeProvider(script)
    return Router({"fake": provider}, {"vision": Route("fake", "claude-haiku-5-5", "low", 4096), "advice": Route("fake", "claude-opus-5-5", "medium", 16000)}), provider


class Validation(unittest.TestCase):
    def test_valid_fields_pass(self):
        fields, dropped, errors = validate_screen(screen())
        self.assertEqual((len(fields), dropped, errors), (2, [], []))

    def test_value_must_be_inside_the_evidence_text(self):
        bad = screen(fields=[{"key": "střely", "value": "14", "evidence_text": "Střely 11 3"}])
        fields, dropped, _ = validate_screen(bad)
        self.assertEqual(fields, [])
        self.assertIn("není obsažena", dropped[0])

    def test_whitespace_and_case_do_not_matter(self):
        ok = screen(fields=[{"key": "k", "value": "Držení  Míče 62 %", "evidence_text": "držení míče 62%"}])
        self.assertEqual(len(validate_screen(ok)[0]), 1)

    def test_missing_evidence_duplicates_and_long_values_are_dropped(self):
        fields = [
            {"key": "a", "value": "1", "evidence_text": ""},
            {"key": "b", "value": "2", "evidence_text": "2"},
            {"key": "b", "value": "2", "evidence_text": "2"},
            {"key": "c", "value": "x" * 200, "evidence_text": "x" * 200},
            {"key": "d"},
        ]
        clean, dropped, errors = validate_screen(screen(fields=fields))
        self.assertEqual([f["key"] for f in clean], ["b"])
        self.assertEqual(len(dropped), 4)
        self.assertEqual(errors, [])

    def test_structure_errors(self):
        self.assertTrue(validate_screen([])[2])
        self.assertTrue(validate_screen(screen(screen_type="nonsense"))[2])
        self.assertTrue(validate_screen(screen(fields="x"))[2])
        self.assertTrue(validate_screen(screen(unreadable=[1]))[2])

    def test_schema_is_strict(self):
        self.assertIs(SCREEN_JSON_SCHEMA["additionalProperties"], False)
        self.assertEqual(SCREEN_JSON_SCHEMA["required"], ["screen_type", "fields", "unreadable"])
        json.dumps(SCREEN_JSON_SCHEMA)
        self.assertIn("DOSLOVA", VISION_SYSTEM_PROMPT_CS)


class Extraction(unittest.TestCase):
    def test_ok_flow_is_always_unverified(self):
        router, provider = router_for(resp(screen()))
        ledger = Ledger({"fake/claude-haiku-5-5": Price(input=0.10, output=0.50)})
        result = extract_screen(IMAGE, router=router, ledger=ledger, user_initiated=True, hint="statistiky zápasu")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["provenance"], "vision_unverified")
        self.assertEqual(result["screen_type"], "match_stats")
        self.assertEqual(len(result["fields"]), 2)
        self.assertEqual(result["unreadable"], ["pravý dolní roh je zakrytý"])
        self.assertAlmostEqual(result["cost_usd"], (1500 * 0.10 + 120 * 0.50) / 1_000_000)
        call = provider.calls[0]
        self.assertEqual((call.task, call.effort), ("vision", "low"))
        self.assertIs(call.schema, SCREEN_JSON_SCHEMA)
        blocks = call.messages[0]["content"]
        self.assertEqual([b["type"] for b in blocks], ["image", "text"])
        self.assertIn("jen nápověda", blocks[1]["text"])

    def test_no_image_leaves_without_a_user_action(self):
        router, provider = router_for(resp(screen()))
        result = extract_screen(IMAGE, router=router)
        self.assertEqual(result["status"], "refused_privacy")
        self.assertEqual(provider.calls, [])
        for flag in (False, None, 1, "yes"):
            self.assertEqual(extract_screen(IMAGE, router=router, user_initiated=flag)["status"], "refused_privacy")

    def test_bad_images_are_rejected_before_any_call(self):
        router, provider = router_for(resp(screen()))
        for image in (
            {"media_type": "image/bmp", "data_b64": PNG},
            {"media_type": "image/png", "data_b64": "***"},
            {"media_type": "image/png", "data_b64": ""},
        ):
            self.assertEqual(extract_screen(image, router=router, user_initiated=True)["status"], "error")
        self.assertEqual(provider.calls, [])

    def test_stub_without_provider(self):
        result = extract_screen(IMAGE, router=Router({}, notes=["ANTHROPIC_API_KEY není nastaven"]), user_initiated=True)
        self.assertEqual((result["status"], result["provenance"]), ("stub", "stub"))
        self.assertIn("ANTHROPIC_API_KEY", result["errors"][0])

    def test_nothing_readable_needs_review_and_passes_nothing_on(self):
        router, _ = router_for(resp(screen(screen_type="unreadable", fields=[])))
        result = extract_screen(IMAGE, router=router, user_initiated=True)
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(fields_to_observations(result), [])

    def test_all_fields_dropped_needs_review(self):
        router, _ = router_for(resp(screen(fields=[{"key": "x", "value": "9", "evidence_text": "10"}])))
        result = extract_screen(IMAGE, router=router, user_initiated=True)
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(len(result["dropped"]), 1)

    def test_failures(self):
        cases = [
            (resp(None, text="", stop="refusal"), "refused"),
            (resp(None, text="{", stop="max_tokens"), "error"),
            (resp(None, text="není JSON"), "error"),
            (resp({"screen_type": "nonsense", "fields": [], "unreadable": []}), "error"),
            (ProviderError("rate_limit", "limit", retryable=True), "error"),
        ]
        for item, status in cases:
            router, _ = router_for(item)
            self.assertEqual(extract_screen(IMAGE, router=router, user_initiated=True)["status"], status, item)

    def test_budget_exceeded_makes_no_call(self):
        router, provider = router_for(resp(screen()))
        ledger = Ledger({"fake/m": Price(input=1_000_000.0, output=0.0)})
        ledger.record(task="vision", provider="fake", model="m", usage=Usage(5, 0))
        result = extract_screen(IMAGE, router=router, ledger=ledger, budget=Budget(ledger, daily_usd=1.0), user_initiated=True)
        self.assertEqual(result["status"], "budget_exceeded")
        self.assertEqual(provider.calls, [])

    def test_observations_feed_the_advice_without_raising_trust(self):
        router, _ = router_for(resp(screen()))
        result = extract_screen(IMAGE, router=router, user_initiated=True)
        observations = fields_to_observations(result, minute=34)
        self.assertEqual([o["label"] for o in observations], ["vision_unverified"] * 2)
        self.assertEqual(observations[0]["id"], "vis-1")
        self.assertIn("z obrazovky: „Držení míče 62% 38%“", observations[0]["text"])
        advice = demo_advice()
        advice["evidenceA"]["refs"] = ["vis-1"]
        advice["diagnosis"]["refs"] = ["vis-1", "obs-2"]
        router2, provider2 = router_for(resp(advice, model="claude-opus-5-5"))
        out = advise({"observations": [*observations, {"id": "obs-2", "label": "user_entered", "text": "x"}]}, router=router2)
        self.assertEqual(out["status"], "ok", out["errors"])
        prompt = provider2.calls[0].messages[0]["content"][0]["text"]
        self.assertIn("vis-1 | vision_unverified | 34'", prompt)


class LiveCheck(unittest.TestCase):
    def run_main(self, argv, router=None, env=None):
        lines: list[str] = []
        code = live_check_main(argv, env=env or {}, router=router, out=lines.append)
        return code, "\n".join(lines)

    def test_requires_explicit_confirmation(self):
        code, text = self.run_main([])
        self.assertEqual(code, 2)
        self.assertIn("placené API", text)

    def test_without_key_it_says_so_and_calls_nothing(self):
        code, text = self.run_main(["--yes"])
        self.assertEqual(code, 3)
        self.assertIn("ANTHROPIC_API_KEY", text)

    def test_with_a_router_it_reports_status_and_cost(self):
        provider = FakeProvider([resp(demo_advice(), model="claude-opus-5-5")])
        router = Router({"fake": provider}, {"advice": Route("fake", "claude-opus-5-5", "medium", 4096)})
        code, text = self.run_main(["--yes"], router=router)
        self.assertEqual(code, 0, text)
        self.assertIn("status: ok", text)
        self.assertIn("DEMO", text)
        self.assertIn("API požadavek přijalo", text)

    def test_provider_error_is_a_failure_code(self):
        provider = FakeProvider([ProviderError("auth", "klíč je neplatný")])
        router = Router({"fake": provider}, {"advice": Route("fake", "claude-opus-5-5", "medium", 4096)})
        code, text = self.run_main(["--yes"], router=router)
        self.assertEqual(code, 1)
        self.assertIn("auth", text)


if __name__ == "__main__":
    unittest.main()
