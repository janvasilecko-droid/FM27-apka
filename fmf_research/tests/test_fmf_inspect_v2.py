"""Testy FMF inspektoru v2 na SYNTETICKÝCH kontejnerech.

Nejde o reálné exporty FM27: kontejner je poskládaný podle toho, co jediný pozorovaný vzorek
naznačil (prefix + zstd rámec s délkou prefixovanými ASCII tokeny). Testy tedy prokazují
chování čtečky, ne správnost interpretace skutečného formátu FM27.

Spuštění z kořene repozitáře:  python3 -m unittest discover -s fmf_research/tests -t . -v
Vyžaduje balíček `zstandard` (jinak se testy přeskočí).
"""

from __future__ import annotations

import struct
import unittest

from fmf_research import fmf_inspect_v2 as m

try:
    import zstandard  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    zstandard = None

PREFIX = m.OBSERVED_PREFIX
TOKENS = ["MojeTaktika", ".tac", "logo", ".img", "x", ".aom"]


def manifest(tokens: list[str]) -> bytes:
    return b"".join(struct.pack("<I", len(t)) + t.encode("ascii") for t in tokens)


def z(raw: bytes) -> bytes:
    return zstandard.ZstdCompressor().compress(raw)


@unittest.skipUnless(zstandard is not None, "chybí balíček zstandard")
class InspectV2(unittest.TestCase):
    def good(self) -> bytes:
        return PREFIX + b"\x00" * 40 + z(manifest(TOKENS))

    def test_valid_container_gives_name_and_resources(self):
        r = m.inspect_fmf_bytes(self.good(), filename="a.fmf")
        self.assertEqual(r["tactic_name"], "MojeTaktika")
        self.assertEqual(r["resources"], ["MojeTaktika.tac", "logo.img", "x.aom"])
        self.assertEqual(r["tactic_name_confidence"], "low")
        self.assertEqual(r["header_version_semantics"], "unverified")

    def test_never_claims_decoded_fields(self):
        r = m.inspect_fmf_bytes(self.good())
        self.assertEqual(r["status"], "metadata_only")
        for field in ("formace", "role a povinnosti", "týmové instrukce", "mentalita"):
            self.assertIn(field, r["unknown_fields"])
        self.assertNotIn("formace", r["recognized_fields"])

    def test_manifest_first_then_other_frame(self):
        # Originál tady tiše vrátil prázdný název a zdroje.
        data = PREFIX + b"\x00" * 10 + z(manifest(TOKENS)) + b"\x11" * 8 + z(b"\xaa\xbb\xcc" * 500)
        r = m.inspect_fmf_bytes(data)
        self.assertEqual(r["tactic_name"], "MojeTaktika")
        self.assertEqual(r["zstd_candidates_found"], 2)
        self.assertEqual(r["zstd_candidates_tried"], 2)
        self.assertLess(r["zstd_manifest_offset"], len(data) // 2)

    def test_false_magic_after_manifest(self):
        # Originál tady selhal („manifest nebylo možné ověřit“).
        data = self.good() + b"\x00\x00" + m.ZSTD_MAGIC + b"\x01\x02\x03"
        r = m.inspect_fmf_bytes(data)
        self.assertEqual(r["tactic_name"], "MojeTaktika")
        self.assertEqual(r["zstd_candidates_found"], 2)

    def test_only_payload_frame_is_error_not_empty_success(self):
        data = PREFIX + b"\x00" * 10 + z(b"\xaa\xbb\xcc" * 500)
        with self.assertRaises(m.FMFInspectionError) as ctx:
            m.inspect_fmf_bytes(data)
        self.assertIn("nevypadá jako manifest", str(ctx.exception))

    def test_decompression_bomb_is_rejected(self):
        data = PREFIX + z(b"\x00" * (5 * 1024 * 1024))
        with self.assertRaises(m.FMFInspectionError) as ctx:
            m.inspect_fmf_bytes(data)
        self.assertIn("1 MiB", str(ctx.exception))

    def test_wrong_header_is_rejected(self):
        data = b"\x09\x09" + self.good()[2:]
        with self.assertRaises(m.FMFInspectionError):
            m.inspect_fmf_bytes(data)

    def test_no_zstd_frame_is_rejected(self):
        with self.assertRaises(m.FMFInspectionError):
            m.inspect_fmf_bytes(PREFIX + b"\x00" * 200)

    def test_tac_first_keeps_resources_without_name(self):
        data = PREFIX + z(manifest([".tac", "MojeTaktika", "logo", ".img"]))
        r = m.inspect_fmf_bytes(data)
        self.assertIsNone(r["tactic_name"])
        self.assertIsNone(r["tactic_name_basis"])
        self.assertEqual(r["resources"], ["logo.img"])

    def test_empty_and_oversize_inputs(self):
        with self.assertRaises(m.FMFInspectionError):
            m.inspect_fmf_bytes(b"")
        with self.assertRaises(m.FMFInspectionError):
            m.inspect_fmf_bytes(PREFIX + b"\x00" * (m.MAX_INPUT_BYTES + 1))

    def test_candidate_cap(self):
        # Hodně falešných magic hlaviček nesmí způsobit neomezenou práci.
        junk = (m.ZSTD_MAGIC + b"\x00") * (m.MAX_CANDIDATES * 3)
        data = PREFIX + z(manifest(TOKENS)) + junk
        with self.assertRaises(m.FMFInspectionError):
            m.inspect_fmf_bytes(data)  # platný rámec je mimo prvních MAX_CANDIDATES odzadu


if __name__ == "__main__":
    unittest.main()
