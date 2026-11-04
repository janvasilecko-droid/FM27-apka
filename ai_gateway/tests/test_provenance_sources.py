from __future__ import annotations

import unittest
from pathlib import Path

from ai_gateway.provenance import LABEL_TO_TIER, LABELS, TIERS, tier_of_label, tier_rank, weakest_tier
from ai_gateway.sources import SourceRegistry

KNOWLEDGE = Path(__file__).resolve().parents[2] / "reference" / "codex-2026-11-01" / "knowledge.json"


def item(**over):
    base = {
        "id": "s1",
        "title": "T",
        "url": "https://example.test/a",
        "publisher": "P",
        "version": "FM27 Launch Preview / předvydaná verze",
        "source_type": "Oficiální produktový článek a FAQ",
        "trust": "Vysoká pro popis oznámených funkcí",
        "caveat": "Ověřit ve hře",
        "claims": ["Něco se oznamuje."],
    }
    base.update(over)
    return base


class Provenance(unittest.TestCase):
    def test_tier_order(self):
        order = ["unknown", "inferred", "user_entered", "observed", "verified"]
        self.assertEqual(sorted(TIERS, key=tier_rank), order)

    def test_every_label_maps_to_a_tier(self):
        for label in LABELS:
            self.assertIn(tier_of_label(label), TIERS)

    def test_machine_reading_is_never_stronger_than_inferred(self):
        for label in ("ocr_unverified", "vision_unverified", "heuristic_coach", "ai_advise"):
            self.assertEqual(LABEL_TO_TIER[label], "inferred")
        self.assertEqual(LABEL_TO_TIER["stub"], "unknown")
        self.assertEqual(LABEL_TO_TIER["screenshot_verified"], "observed")

    def test_weakest_tier(self):
        self.assertEqual(weakest_tier(["verified", "inferred", "observed"]), "inferred")
        self.assertEqual(weakest_tier([]), "unknown")

    def test_unknown_names_are_rejected(self):
        with self.assertRaises(ValueError):
            tier_rank("certain")
        with self.assertRaises(ValueError):
            tier_of_label("magic")


class Sources(unittest.TestCase):
    def test_real_knowledge_json_from_codex(self):
        registry = SourceRegistry.from_knowledge_json(KNOWLEDGE)
        self.assertEqual(len(registry), 3)
        for source_id in registry.ids():
            source = registry.get(source_id)
            self.assertEqual(source.fm_version, "27")
            self.assertEqual(source.release_state, "pre_release")
            self.assertTrue(registry.is_official_fm27(source_id))
            self.assertTrue(source.caveat)

    def test_fm26_official_source_is_not_fm27(self):
        registry = SourceRegistry.from_knowledge_json({"items": [item(version="FM26 Launch")]})
        self.assertEqual(registry.get("s1").fm_version, "26")
        self.assertFalse(registry.is_official_fm27("s1"))

    def test_community_source_is_not_official_even_for_fm27(self):
        registry = SourceRegistry.from_knowledge_json({"items": [item(source_type="Komunitní rozbor")]})
        self.assertFalse(registry.is_official_fm27("s1"))

    def test_source_without_fm_version_is_not_fm27(self):
        registry = SourceRegistry.from_knowledge_json({"items": [item(version="obecný fotbal")]})
        self.assertIsNone(registry.get("s1").fm_version)
        self.assertFalse(registry.is_official_fm27("s1"))

    def test_unknown_id_is_not_official(self):
        self.assertFalse(SourceRegistry().is_official_fm27("nope"))

    def test_duplicate_ids_raise(self):
        with self.assertRaises(ValueError):
            SourceRegistry.from_knowledge_json({"items": [item(), item()]})

    def test_digest_contains_caveat_and_scope(self):
        digest = SourceRegistry.from_knowledge_json(KNOWLEDGE).digest()
        self.assertIn("oficiální FM27", digest)
        self.assertIn("pre_release", digest)
        self.assertIn("upozornění:", digest)
        self.assertIn("prázdný", SourceRegistry().digest())


if __name__ == "__main__":
    unittest.main()
