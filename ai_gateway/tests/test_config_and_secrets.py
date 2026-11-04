from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from ai_gateway.config import build_default_budget, build_default_router, load_registry
from ai_gateway.costs import Ledger

try:
    import anthropic  # noqa: F401
except ImportError:  # pragma: no cover
    anthropic = None

REPO = Path(__file__).resolve().parents[2]


class Config(unittest.TestCase):
    def test_without_key_the_router_has_no_provider_and_says_why(self):
        router = build_default_router({})
        self.assertEqual(router.providers, {})
        self.assertFalse(router.available("advice"))
        self.assertIn("ANTHROPIC_API_KEY", router.why_unavailable("advice"))

    @unittest.skipUnless(anthropic is not None, "chybí balíček anthropic")
    def test_with_key_the_anthropic_provider_is_registered(self):
        router = build_default_router({"ANTHROPIC_API_KEY": "sk-test-not-real"})
        self.assertIn("anthropic", router.providers)
        self.assertTrue(router.available("advice"))
        self.assertEqual(router.notes, [])

    def test_routes_can_be_overridden_from_the_environment(self):
        env = {"FM27_AI_ROUTES": json.dumps({"advice": {"model": "claude-sonnet-5-5", "effort": "high"}})}
        router = build_default_router(env)
        self.assertEqual((router.routes["advice"].model, router.routes["advice"].effort), ("claude-sonnet-5-5", "high"))

    def test_refusal_fallback_switch(self):
        self.assertTrue(build_default_router({}).refusal_fallback)
        for off in ("0", "false", "OFF", " no "):
            self.assertFalse(build_default_router({"FM27_AI_REFUSAL_FALLBACK": off}).refusal_fallback, off)
        self.assertTrue(build_default_router({"FM27_AI_REFUSAL_FALLBACK": "1"}).refusal_fallback)

    def test_invalid_routes_fail_loudly(self):
        with self.assertRaises(ValueError):
            build_default_router({"FM27_AI_ROUTES": json.dumps({"advice": {"effort": "turbo"}})})
        with self.assertRaises(ValueError):
            build_default_router({"FM27_AI_ROUTES": "{nejde to"})

    def test_budget_from_environment(self):
        ledger = Ledger()
        self.assertIsNone(build_default_budget(ledger, {}))
        self.assertIsNone(build_default_budget(ledger, {"FM27_AI_BUDGET_DAILY_USD": "nejde"}))
        budget = build_default_budget(ledger, {"FM27_AI_BUDGET_DAILY_USD": "2.5", "FM27_AI_BUDGET_MONTHLY_USD": "40"})
        self.assertEqual((budget.daily_usd, budget.monthly_usd), (2.5, 40.0))

    def test_registry_loading(self):
        self.assertEqual(len(load_registry(REPO / "reference" / "codex-2026-11-01" / "knowledge.json")), 3)
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(len(load_registry(Path(tmp) / "chybi.json")), 0)  # prázdný registr = nic není verified


SECRET_PATTERNS = {
    "Anthropic klíč": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "OpenAI klíč": re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}"),
    "Supabase secret": re.compile(r"sb_secret_[A-Za-z0-9_-]{10,}"),
    "JWT": re.compile(r"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}"),
    "GitHub token": re.compile(r"\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{25,}"),
    "AWS klíč": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
}
TEXT_SUFFIXES = {".py", ".md", ".json", ".js", ".mjs", ".html", ".css", ".txt", ".yml", ".yaml", ".toml", ".env", ""}


class NoSecretsInRepo(unittest.TestCase):
    """Repozitář je veřejný: žádný klíč nesmí skončit v souborech (ani v testech a ukázkách)."""

    def test_no_secret_looking_strings(self):
        offenders = []
        for path in REPO.rglob("*"):
            if not path.is_file() or ".git" in path.parts or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for label, pattern in SECRET_PATTERNS.items():
                if pattern.search(text):
                    offenders.append(f"{path.relative_to(REPO)}: {label}")
        self.assertEqual(offenders, [])

    def test_no_env_files_are_committed(self):
        envs = [p.name for p in REPO.rglob(".env*") if ".git" not in p.parts and p.is_file()]
        self.assertEqual(envs, [])


if __name__ == "__main__":
    unittest.main()
