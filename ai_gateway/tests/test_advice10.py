from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from ai_gateway.advice10 import (
    ADVICE10_JSON_SCHEMA,
    SECTION_KEYS,
    render_text_cs,
    validate_advice10,
)
from ai_gateway.demo_data import demo_advice
from ai_gateway.sources import SourceRegistry

KNOWLEDGE = Path(__file__).resolve().parents[2] / "reference" / "codex-2026-11-01" / "knowledge.json"
REGISTRY = SourceRegistry.from_knowledge_json(KNOWLEDGE)
OFFICIAL = "fm27-navigation"

OBS = {
    "obs-1": {"label": "ocr_unverified", "text": "DEMO strojové čtení"},
    "obs-2": {"label": "user_entered", "text": "DEMO zadal uživatel"},
    "obs-3": {"label": "ocr_unverified", "text": "DEMO druhé strojové čtení"},
    "shot-1": {"label": "screenshot_verified", "text": "DEMO ověřený screenshot 1"},
    "shot-2": {"label": "screenshot_verified", "text": "DEMO ověřený screenshot 2"},
}


def patched(**changes):
    """demo_advice() s upravenými hodnotami; klíč je cesta s tečkami, např. "change.items.0.to"."""
    advice = demo_advice()
    for path, value in changes.items():
        node = advice
        parts = path.split(".")
        for part in parts[:-1]:
            node = node[int(part)] if isinstance(node, list) else node[part]
        last = parts[-1]
        if isinstance(node, list):
            node[int(last)] = value
        else:
            node[last] = value
    return advice


def check(advice, *, obs=None, registry=REGISTRY, **kwargs):
    return validate_advice10(advice, observations=obs or OBS, registry=registry, **kwargs)


def errors_text(result):
    return " | ".join(result.errors)


class Structure(unittest.TestCase):
    def test_demo_advice_is_valid_and_flags_verification(self):
        result = check(demo_advice())
        self.assertTrue(result.ok, result.errors)
        self.assertTrue(result.needs_verification)
        self.assertTrue(any("nejsou ověřené" in w for w in result.warnings))

    def test_not_an_object(self):
        self.assertFalse(check([]).ok)
        self.assertFalse(check("text").ok)

    def test_missing_section(self):
        advice = demo_advice()
        del advice["risk"]
        result = check(advice)
        self.assertFalse(result.ok)
        self.assertIn("risk", errors_text(result))

    def test_extra_section_is_only_a_warning(self):
        advice = demo_advice()
        advice["bonus"] = {}
        result = check(advice)
        self.assertTrue(result.ok)
        self.assertTrue(any("bonus" in w for w in result.warnings))

    def test_schema_shape(self):
        self.assertEqual(ADVICE10_JSON_SCHEMA["required"], list(SECTION_KEYS))
        self.assertEqual(len(SECTION_KEYS), 10)

        def walk(node):
            if isinstance(node, dict):
                if node.get("type") == "object":
                    self.assertIs(node.get("additionalProperties"), False)
                    self.assertEqual(sorted(node["required"]), sorted(node["properties"]))
                for forbidden in ("minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"):
                    self.assertNotIn(forbidden, node)
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(ADVICE10_JSON_SCHEMA)
        json.dumps(ADVICE10_JSON_SCHEMA)


class EvidenceAndTiers(unittest.TestCase):
    def test_unknown_reference_is_error(self):
        result = check(patched(**{"evidenceA.refs": ["obs-999"]}))
        self.assertFalse(result.ok)
        self.assertIn("neodpovídá", errors_text(result))

    def test_evidence_must_cite_an_observation(self):
        result = check(patched(**{"evidenceA.refs": [OFFICIAL], "evidenceA.tier": "inferred"}))
        self.assertIn("pozorování", errors_text(result))

    def test_tier_stronger_than_evidence_is_error(self):
        result = check(patched(**{"evidenceA.tier": "observed"}))
        self.assertFalse(result.ok)
        self.assertIn("silnější", errors_text(result))

    def test_strong_tier_without_refs_is_error(self):
        result = check(patched(**{"context.refs": []}))
        self.assertIn("musí mít odkaz", errors_text(result))

    def test_verified_needs_official_fm27_source(self):
        self.assertFalse(check(patched(**{"diagnosis.tier": "verified"})).ok)
        ok = check(patched(**{"diagnosis.tier": "verified", "diagnosis.refs": [OFFICIAL]}))
        self.assertTrue(ok.ok, ok.errors)

    def test_verified_with_non_official_source_is_rejected(self):
        community = SourceRegistry.from_knowledge_json(
            {
                "items": [
                    {
                        "id": "forum",
                        "title": "t",
                        "url": "https://x.test",
                        "version": "FM27",
                        "source_type": "Komunitní rozbor",
                    }
                ]
            }
        )
        result = check(patched(**{"diagnosis.tier": "verified", "diagnosis.refs": ["forum"]}), registry=community)
        self.assertFalse(result.ok)
        self.assertIn("silnější", errors_text(result))

    def test_without_registry_nothing_is_verified(self):
        result = check(patched(**{"diagnosis.tier": "verified", "diagnosis.refs": [OFFICIAL]}), registry=None)
        self.assertFalse(result.ok)


class Confidence(unittest.TestCase):
    def two_machine_readings(self, level):
        return patched(
            **{
                "evidenceB": {"text": "Druhé strojové čtení potvrzuje totéž.", "tier": "inferred", "refs": ["obs-3"]},
                "confidence.level": level,
            }
        )

    def test_high_on_machine_reading_only_is_rejected(self):
        result = check(self.two_machine_readings("high"))
        self.assertFalse(result.ok)
        self.assertIn("strojové čtení", errors_text(result))

    def test_medium_on_machine_reading_is_allowed(self):
        self.assertTrue(check(self.two_machine_readings("medium")).ok)

    def test_high_on_one_machine_reading_plus_a_user_claim_is_rejected(self):
        # Přesně situace z ukázkové rady: strojové čtení + tvrzení uživatele nestačí na „high“.
        result = check(patched(**{"confidence.level": "high"}))
        self.assertFalse(result.ok)
        self.assertIn("ověřené důkazy", errors_text(result))

    def test_high_needs_both_evidences_verified(self):
        advice = patched(
            **{
                "evidenceA": {"text": "Ověřený screenshot pozic ukazuje vzdálenost řad.", "tier": "observed", "refs": ["shot-1"]},
                "evidenceB": {"text": "Druhý důkaz je jen strojově vyčtený.", "tier": "inferred", "refs": ["obs-1"]},
                "confidence.level": "high",
            }
        )
        self.assertFalse(check(advice).ok)

    def test_high_with_two_verified_screenshots_is_allowed(self):
        advice = patched(
            **{
                "evidenceA": {"text": "Ověřený screenshot pozic ukazuje vzdálenost řad.", "tier": "observed", "refs": ["shot-1"]},
                "evidenceB": {"text": "Druhý ověřený screenshot ukazuje totéž v jiné minutě.", "tier": "observed", "refs": ["shot-2"]},
                "diagnosis": {"text": "Záložní řada je opakovaně daleko od útočníka.", "tier": "observed", "refs": ["shot-1", "shot-2"]},
                "confidence.level": "high",
            }
        )
        result = check(advice)
        self.assertTrue(result.ok, result.errors)

    def test_high_needs_two_independent_evidences(self):
        advice = patched(
            **{
                "evidenceA": {"text": "Ověřený screenshot pozic ukazuje vzdálenost řad.", "tier": "observed", "refs": ["shot-1"]},
                "evidenceB": {"text": "Druhý důkaz zatím nemám.", "tier": "unknown", "refs": []},
                "confidence.level": "high",
            }
        )
        result = check(advice)
        self.assertFalse(result.ok)
        self.assertIn("nezávislé ověřené důkazy", errors_text(result))

    def test_medium_without_any_evidence_is_rejected(self):
        advice = patched(
            **{
                "evidenceA": {"text": "Zatím nemám žádný důkaz.", "tier": "unknown", "refs": []},
                "evidenceB": {"text": "Ani druhý důkaz zatím nemám.", "tier": "unknown", "refs": []},
            }
        )
        self.assertFalse(check(advice).ok)
        advice["confidence"]["level"] = "low"
        self.assertTrue(check(advice).ok)

    def test_low_confidence_requires_unknown_items(self):
        result = check(patched(**{"confidence.level": "low", "unknown.items": []}))
        self.assertFalse(result.ok)
        self.assertIn("nízké jistotě", errors_text(result))

    def test_invalid_level(self):
        self.assertFalse(check(patched(**{"confidence.level": "certain"})).ok)


class Changes(unittest.TestCase):
    def item(self):
        return copy.deepcopy(demo_advice()["change"]["items"][0])

    def test_between_one_and_two_changes(self):
        three = patched(**{"change.items": [self.item(), self.item(), self.item()]})
        self.assertIn("nejvýš 2", errors_text(check(three)))
        self.assertFalse(check(patched(**{"change.items": []})).ok)
        self.assertTrue(check(patched(**{"change.items": [self.item(), self.item()]})).ok)

    def test_from_equals_to_is_not_a_change(self):
        result = check(patched(**{"change.items.0.to": "SOUČASNÁ povinnost (zjisti ve hře)"}))
        self.assertFalse(result.ok)
        self.assertIn("stejná", errors_text(result))

    def test_missing_player_setting_or_steps(self):
        self.assertFalse(check(patched(**{"change.items.0.player": ""})).ok)
        self.assertFalse(check(patched(**{"change.items.0.where": []})).ok)
        self.assertFalse(check(patched(**{"change.items.0.where": ["  "]})).ok)

    def test_every_change_must_say_why(self):
        # Rada bez „proč“ je jen příkaz: každá změna musí vysvětlit příčinu a následek.
        missing = check(patched(**{"change.items.0.why": None}))
        self.assertFalse(missing.ok)
        self.assertIn("chybí „why“", errors_text(missing))
        short = check(patched(**{"change.items.0.why.text": "ne"}))
        self.assertFalse(short.ok)
        self.assertIn("příliš krátké", errors_text(short))
        self.assertFalse(check(patched(**{"change.items.0.why": {"text": "", "refs": []}})).ok)
        # u druhé ze dvou změn to platí také
        second = self.item()
        del second["why"]
        self.assertFalse(check(patched(**{"change.items": [self.item(), second]})).ok)

    def test_why_references_must_exist_and_mechanics_need_a_source(self):
        bad = check(patched(**{"change.items.0.why.refs": ["obs-999"]}))
        self.assertFalse(bad.ok)
        self.assertIn("ve „why“", errors_text(bad))
        self.assertTrue(check(patched(**{"change.items.0.why.refs": ["obs-1"]})).ok)
        self.assertFalse(check(patched(**{"change.items.0.why.refs": "obs-1"})).ok)
        invented = check(patched(**{"change.items.0.why.text": "Změna zvýší CA hráče, protože match engine počítá s jeho skrytými atributy."}))
        self.assertFalse(invented.ok)
        self.assertIn("mechanice", errors_text(invented))

    def test_vague_target_is_only_a_warning(self):
        result = check(patched(**{"change.items.0.to": "více podpory"}))
        self.assertTrue(result.ok)
        self.assertTrue(any("obecně" in w for w in result.warnings))

    def test_verified_navigation_needs_official_fm27_source(self):
        self.assertFalse(check(patched(**{"change.items.0.where_tier": "verified"})).ok)
        good = check(patched(**{"change.items.0.where_tier": "verified", "change.items.0.refs": [OFFICIAL]}))
        self.assertTrue(good.ok, good.errors)
        self.assertFalse(good.needs_verification)

    def test_verified_navigation_with_fm26_source_is_rejected(self):
        fm26 = SourceRegistry.from_knowledge_json(
            {
                "items": [
                    {
                        "id": "old",
                        "title": "t",
                        "url": "https://x.test",
                        "version": "FM26",
                        "source_type": "Oficiální produktový článek",
                    }
                ]
            }
        )
        result = check(patched(**{"change.items.0.where_tier": "verified", "change.items.0.refs": ["old"]}), registry=fm26)
        self.assertFalse(result.ok)
        self.assertIn("oficiální zdroj FM27", errors_text(result))

    def test_observed_navigation_needs_verified_screenshot(self):
        bad = check(patched(**{"change.items.0.where_tier": "observed", "change.items.0.refs": ["obs-1"]}))
        self.assertIn("screenshot_verified", errors_text(bad))
        good = check(patched(**{"change.items.0.where_tier": "observed", "change.items.0.refs": ["shot-1"]}))
        self.assertTrue(good.ok, good.errors)

    def test_unverified_navigation_requires_an_open_question(self):
        result = check(patched(**{"unknown.items": []}))
        self.assertFalse(result.ok)
        self.assertIn("co je potřeba ověřit", errors_text(result))


class BookPassages(unittest.TestCase):
    PASSAGES = {"bk:abc:12:3": {"title": "Kniha o taktice", "page": 12, "text": "Teorie o šířce a hloubce."}}

    def test_book_passage_supports_theory_at_inferred_level(self):
        advice = patched(**{"diagnosis.refs": ["obs-1", "bk:abc:12:3"]})
        result = check(advice, passages=self.PASSAGES)
        self.assertTrue(result.ok, result.errors)

    def test_book_passage_cannot_make_a_claim_stronger_than_inferred(self):
        advice = patched(**{"diagnosis.tier": "observed", "diagnosis.refs": ["bk:abc:12:3"]})
        result = check(advice, passages=self.PASSAGES)
        self.assertFalse(result.ok)
        self.assertIn("silnější", errors_text(result))

    def test_book_passage_is_theory_not_evidence_about_the_match(self):
        advice = patched(**{"evidenceA.refs": ["bk:abc:12:3"], "evidenceA.tier": "inferred"})
        result = check(advice, passages=self.PASSAGES)
        self.assertFalse(result.ok)
        self.assertIn("pozorování", errors_text(result))

    def test_only_retrieved_passages_can_be_cited(self):
        advice = patched(**{"diagnosis.refs": ["obs-1", "bk:zzz:1:1"]})
        self.assertIn("neodpovídá", errors_text(check(advice, passages=self.PASSAGES)))
        cited = patched(**{"diagnosis.refs": ["obs-1", "bk:abc:12:3"]})
        self.assertFalse(check(cited).ok)  # bez předaných úryvků nelze citovat nic z knih


class MeasureRiskReversal(unittest.TestCase):
    def test_measure(self):
        self.assertFalse(check(patched(**{"measure.checks": []})).ok)
        self.assertFalse(check(patched(**{"measure.recheck_after_minutes": -1})).ok)
        self.assertFalse(check(patched(**{"measure.recheck_after_minutes": True})).ok)
        self.assertFalse(check(patched(**{"measure.recheck_after_minutes": "15"})).ok)
        zero = check(patched(**{"measure.recheck_after_minutes": 0}))
        self.assertTrue(zero.ok)
        self.assertTrue(any("znovu vyhodnotit" in w for w in zero.warnings))

    def test_risk_and_reversal(self):
        self.assertFalse(check(patched(**{"risk.items": []})).ok)
        self.assertFalse(check(patched(**{"reversal.text": "ne"})).ok)


class MechanicsGuard(unittest.TestCase):
    def test_invented_mechanics_are_rejected(self):
        self.assertIn("mechanice", errors_text(check(patched(**{"risk.items": ["Sníží se CA hráče"]}))))
        self.assertFalse(check(patched(**{"context.text": "V match engine se útočník ztratí v prostoru."})).ok)
        self.assertFalse(check(patched(**{"diagnosis.text": "Skrytý atribut hráče ho omezuje v pohybu."})).ok)
        self.assertFalse(check(patched(**{"measure.checks": ["Sleduj potential ability útočníka"]})).ok)

    def test_the_same_words_are_fine_as_an_open_question(self):
        advice = patched(**{"unknown.items": ["Nevím, jak match engine pracuje s touto rolí", "Pošli screenshot obrazovky Taktika"]})
        self.assertTrue(check(advice).ok)

    def test_sourced_claim_is_allowed(self):
        advice = patched(
            **{
                "diagnosis": {
                    "text": "Oficiální článek popisuje match engine a Action Zones jako součást rozšířených dat.",
                    "tier": "verified",
                    "refs": [OFFICIAL],
                }
            }
        )
        self.assertTrue(check(advice).ok)


class ReviewHardening(unittest.TestCase):
    """Nálezy nezávislé revize z 4. 11. 2026: mezery, kterými procházelo tvrzení silnější, než unesou důkazy."""

    OBS2 = {
        **OBS,
        "shot-3": {"label": "screenshot_verified", "text": "DEMO ověřený screenshot 3"},
        "snap-1": {"label": "screenshot_verified", "text": "Statistiky ze sledování zápasu", "scope": "live"},
    }
    PASSAGES = {"bk:abc:12:3": {"title": "Kniha", "page": 12, "text": "Teorie."}}

    def high(self, a_refs, b_refs):
        return patched(
            **{
                "evidenceA": {"text": "Ověřené screenshoty ukazují vzdálenost řad.", "tier": "observed", "refs": a_refs},
                "evidenceB": {"text": "Další ověřené screenshoty ukazují totéž.", "tier": "observed", "refs": b_refs},
                "diagnosis": {"text": "Záložní řada je opakovaně daleko od útočníka.", "tier": "observed", "refs": a_refs},
                "confidence.level": "high",
            }
        )

    def test_observed_navigation_is_not_proven_by_numbers_from_live_tracking(self):
        bad = check(patched(**{"change.items.0.where_tier": "observed", "change.items.0.refs": ["snap-1"]}), obs=self.OBS2)
        self.assertFalse(bad.ok)
        self.assertIn("nabídku nebo nastavení", errors_text(bad))
        good = check(patched(**{"change.items.0.where_tier": "observed", "change.items.0.refs": ["shot-1"]}), obs=self.OBS2)
        self.assertTrue(good.ok, good.errors)

    def test_high_needs_each_evidence_to_have_its_own_verified_observation(self):
        for a_refs, b_refs in ((["shot-1", "shot-2"], ["shot-1", "shot-2"]), (["shot-1", "shot-2"], ["shot-1"]), (["shot-1"], ["shot-1", "shot-2"])):
            result = check(self.high(a_refs, b_refs), obs=self.OBS2)
            self.assertFalse(result.ok, (a_refs, b_refs))
            self.assertIn("nezávislé ověřené důkazy", errors_text(result))
        self.assertTrue(check(self.high(["shot-1", "shot-3"], ["shot-2", "shot-3"]), obs=self.OBS2).ok)

    def test_book_passage_is_never_part_of_the_evidence(self):
        advice = patched(**{"evidenceA.refs": ["obs-1", "bk:abc:12:3"], "evidenceA.tier": "inferred"})
        result = check(advice, passages=self.PASSAGES)
        self.assertFalse(result.ok)
        self.assertIn("úryvek z knihy", errors_text(result))

    def test_change_item_refs_must_be_known_texts(self):
        for bad in ("shot-1", [42, None], ["neexistuje"]):
            self.assertFalse(check(patched(**{"change.items.0.refs": bad})).ok, bad)

    def test_mechanics_are_caught_in_change_fields_and_confidence_text(self):
        for path, value in (
            ("change.items.0.setting", "Skryté atributy: Konzistence"),
            ("change.items.0.to", "CA nad 150"),
            ("change.items.0.where", ["Taktika", "Match engine"]),
            ("confidence.text", "Jistota vychází ze současné schopnosti hráče."),
        ):
            self.assertIn("mechanice", errors_text(check(patched(**{path: value}))), path)

    def test_other_phrasings_of_invented_mechanics(self):
        for phrase in (
            "match-engine ve FM27 upřednostňuje křídla",
            "matchengine favorizuje dlouhé míče",
            "herní motor zvýhodňuje rychlé útočníky",
            "skryté hodnoty hráčů rozhodují",
            "Hidden stats like consistency matter",
            "potenciál (pa) hráče je vysoký",
            "aktuální schopnost hráče je nízká",
        ):
            self.assertFalse(check(patched(**{"context.text": phrase})).ok, phrase)
        self.assertTrue(check(patched(**{"risk.items": ["Riziko: (pasivní) obrana nekryje prostor za zády"]})).ok)


class Rendering(unittest.TestCase):
    def test_ten_numbered_lines_with_tier_labels(self):
        text = render_text_cs(demo_advice())
        for number in range(1, 11):
            self.assertTrue(any(line.startswith(f"{number}. ") for line in text.splitlines()), number)
        self.assertIn("[odhad]", text)
        self.assertIn("[zadal uživatel]", text)
        self.assertIn("navigace: neznámé", text)
        self.assertIn("Proč: ", text)  # u každé změny se ukáže, proč právě ta

    def test_renders_even_a_partial_advice(self):
        self.assertIsInstance(render_text_cs({}), str)


if __name__ == "__main__":
    unittest.main()
