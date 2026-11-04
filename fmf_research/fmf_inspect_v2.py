"""FMF inspektor v2 — oprava a zpřesnění `reference/codex-2026-11-01/fmf_inspect.py`.

Návrh Claude, 4. 11. 2026. Originál zůstává beze změny (je to kód z Cursoru/Codexu).
Tato verze řeší dvě chyby, které se prokázaly zkouškou na syntetických kontejnerech
(viz `tests/test_fmf_inspect_v2.py` a `docs/REVIZE_CLAUDE_2026-11-04.md`):

1. Originál bere vždy POSLEDNÍ zstd rámec v souboru. Když za manifestem následuje další rámec,
   vrátí tiše `metadata_only` s prázdným názvem a zdroji (žádná chyba, jen nic).
   Když se magic `28 b5 2f fd` náhodou objeví v datech za manifestem, kontrola selže úplně.
   Teď se zkusí všechny kandidáty a přijme se první, jehož obsah vypadá jako manifest
   (obsahuje token `.tac`, `.img` nebo `.aom`).
2. Když žádný kandidát nevypadá jako manifest, skončí to chybou místo prázdného „úspěchu“.

Beze změny zůstává: žádná pole taktiky se nedekódují (`status = metadata_only`), formát se
nehádá, limity (5 MiB soubor, 1 MiB manifest, 8 s pro 7-Zip) a záložní cesta přes 7-Zip.

Poctivost: pozorovaná hlavička (`02 01 61 66 65 2e`) pochází z JEDNOHO vzorku a není to
oficiální specifikace FMF. Název taktiky je heuristika (token před prvním `.tac`).
"""

from __future__ import annotations

import hashlib
import io
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

INSPECTOR_VERSION = "v2-claude-2026-11-04"
OBSERVED_PREFIX = bytes.fromhex("02 01 61 66 65 2e")
ZSTD_MAGIC = bytes.fromhex("28 b5 2f fd")
MAX_INPUT_BYTES = 5 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_7Z_SECONDS = 8
MAX_CANDIDATES = 16
RESOURCE_EXTENSIONS = (".tac", ".img", ".aom")


class FMFInspectionError(ValueError):
    """Soubor nelze touto omezenou čtečkou bezpečně zkontrolovat."""


class _FrameInvalid(Exception):
    """Kandidát na zstd rámec se nedá rozbalit — zkusí se další."""


class _FrameOversize(Exception):
    """Rozbalený rámec přesáhl limit manifestu."""


def _decode_candidate_python(data: bytes, offset: int) -> bytes | None:
    """Rozbalí jeden rámec od `offset`. None = chybí knihovna `zstandard`."""
    try:
        import zstandard  # type: ignore[import-not-found]
    except ImportError:
        return None
    try:
        # Čte se jen omezený začátek, poškozený rámec nemůže alokovat neomezenou paměť.
        with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data[offset:])) as reader:
            result = reader.read(MAX_MANIFEST_BYTES + 1)
    except Exception as exc:  # noqa: BLE001 - knihovna hlásí chyby specifické pro formát.
        raise _FrameInvalid(str(exc)) from exc
    if len(result) > MAX_MANIFEST_BYTES:
        raise _FrameOversize()
    return result


def _decode_with_7zip(data: bytes) -> bytes:
    executable = shutil.which("7z.exe") or shutil.which("7z") or shutil.which("7zz")
    if not executable:
        raise FMFInspectionError(
            "Pro kontrolu Zstandard manifestu chybí Python balíček zstandard nebo 7-Zip."
        )
    temp_path: Path | None = None
    process: subprocess.Popen[bytes] | None = None
    reader: threading.Thread | None = None
    output = bytearray()
    reader_errors: list[OSError] = []
    try:
        with tempfile.NamedTemporaryFile(prefix="fm27-fmf-", suffix=".fmf", delete=False) as tmp:
            temp_path = Path(tmp.name)
            tmp.write(data)
        process = subprocess.Popen(
            [executable, "x", "-so", "--", str(temp_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        assert process.stdout is not None

        def read_bounded_output() -> None:
            try:
                while len(output) <= MAX_MANIFEST_BYTES:
                    chunk = process.stdout.read(min(64 * 1024, MAX_MANIFEST_BYTES + 1 - len(output)))
                    if not chunk:
                        return
                    output.extend(chunk)
                process.kill()
            except OSError as exc:
                reader_errors.append(exc)

        reader = threading.Thread(target=read_bounded_output, name="fmf-manifest-reader", daemon=True)
        reader.start()
        try:
            return_code = process.wait(timeout=MAX_7Z_SECONDS)
        except subprocess.TimeoutExpired as exc:
            process.kill()
            process.wait(timeout=2)
            reader.join(timeout=2)
            raise FMFInspectionError("Časový limit pro kontrolu FMF vypršel.") from exc
        reader.join(timeout=2)
        if reader.is_alive():
            raise FMFInspectionError("Čtení Zstandard manifestu se nepodařilo bezpečně dokončit.")
        if len(output) > MAX_MANIFEST_BYTES:
            raise FMFInspectionError("Manifest překročil limit 1 MiB.")
        if reader_errors:
            raise FMFInspectionError("Výstup nástroje pro kontrolu FMF se nepodařilo přečíst.") from reader_errors[0]
        if return_code != 0 or not output:
            raise FMFInspectionError("7-Zip nedokázal rozbalit ověřený Zstandard manifest.")
        return bytes(output)
    except OSError as exc:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=2)
        raise FMFInspectionError("Nástroj pro čtení Zstandard manifestu se nepodařilo spustit.") from exc
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=2)
        if reader is not None and reader.is_alive():
            reader.join(timeout=1)
        if process and process.stdout:
            process.stdout.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _length_prefixed_ascii_tokens(manifest: bytes) -> list[str]:
    """Ohraničená ASCII pole, jejichž předchozí little-endian délka sedí."""
    tokens: list[str] = []
    for offset in range(0, max(0, len(manifest) - 4)):
        length = int.from_bytes(manifest[offset : offset + 4], "little")
        if not 1 <= length <= 96 or offset + 4 + length > len(manifest):
            continue
        value = manifest[offset + 4 : offset + 4 + length]
        if all(0x20 <= byte <= 0x7E for byte in value):
            tokens.append(value.decode("ascii"))
    return tokens


def _looks_like_manifest(tokens: list[str]) -> bool:
    return any(token in RESOURCE_EXTENSIONS for token in tokens)


def _resource_names(tokens: list[str]) -> list[str]:
    names: list[str] = []
    for index, token in enumerate(tokens):
        if token in RESOURCE_EXTENSIONS and index:
            names.append(f"{tokens[index - 1]}{token}")
    return names


def _find_manifest(data: bytes, offsets: list[int]) -> tuple[bytes, int, int]:
    """Vrátí (manifest, offset rámce, počet zkoušených kandidátů) nebo vyhodí chybu."""
    # Nejdřív poslední rámec (tak vypadal jediný pozorovaný vzorek), potom ostatní odzadu.
    ordered = list(reversed(offsets))[:MAX_CANDIDATES]
    oversize = False
    tried = 0
    for offset in ordered:
        tried += 1
        try:
            manifest = _decode_candidate_python(data, offset)
        except _FrameInvalid:
            continue
        except _FrameOversize:
            oversize = True
            continue
        if manifest is None:
            # Chybí knihovna zstandard: jediná záložní cesta je 7-Zip nad celým souborem.
            manifest = _decode_with_7zip(data)
            if _looks_like_manifest(_length_prefixed_ascii_tokens(manifest)):
                return manifest, offsets[-1], tried
            raise FMFInspectionError(
                "Rozbalený obsah nevypadá jako známý manifest (chybí .tac/.img/.aom)."
            )
        if _looks_like_manifest(_length_prefixed_ascii_tokens(manifest)):
            return manifest, offset, tried
    if oversize:
        raise FMFInspectionError("Manifest překročil limit 1 MiB.")
    raise FMFInspectionError(
        "Žádný nalezený Zstandard rámec nevypadá jako manifest známý z dodaného exportu "
        "(chybí tokeny .tac/.img/.aom). Soubor nebyl interpretován."
    )


def inspect_fmf_bytes(data: bytes, *, filename: str = "uploaded.fmf") -> dict[str, object]:
    """Vrátí pozorovaná metadata kontejneru; nedekóduje nastavení taktiky."""
    if not data:
        raise FMFInspectionError("Soubor je prázdný.")
    if len(data) > MAX_INPUT_BYTES:
        raise FMFInspectionError("Soubor překračuje limit 5 MiB.")
    if not data.startswith(OBSERVED_PREFIX):
        raise FMFInspectionError(
            "Hlavička neodpovídá pozorovanému prefixu FM27 exportu; soubor nebyl interpretován."
        )
    offsets = [match.start() for match in re.finditer(re.escape(ZSTD_MAGIC), data)]
    if not offsets:
        raise FMFInspectionError(
            "V souboru nebyl nalezen Zstandard manifest známý z dodaného exportu."
        )
    manifest, manifest_offset, tried = _find_manifest(data, offsets)
    tokens = _length_prefixed_ascii_tokens(manifest)
    resources = _resource_names(tokens)
    tactic_name = next(
        (tokens[index - 1] for index, token in enumerate(tokens) if token == ".tac" and index),
        None,
    )
    return {
        "format": "fm27-tactic-fmf-observed",
        "status": "metadata_only",
        "inspector_version": INSPECTOR_VERSION,
        "filename": Path(filename).name,
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "observed_prefix_hex": OBSERVED_PREFIX.hex(" "),
        "observed_header_version": f"{data[0]}.{data[1]}",
        "header_version_semantics": "unverified",
        "zstd_manifest_offset": manifest_offset,
        "zstd_candidates_found": len(offsets),
        "zstd_candidates_tried": tried,
        "manifest_size_bytes": len(manifest),
        "tactic_name": tactic_name,
        "tactic_name_basis": "token_before_first_.tac" if tactic_name else None,
        "tactic_name_confidence": "low" if tactic_name else None,
        "resources": resources,
        "recognized_fields": ["souborový název taktiky", "manifestové názvy zdrojů"],
        "unknown_fields": [
            "formace",
            "hráčské pozice",
            "role a povinnosti",
            "týmové instrukce",
            "individuální instrukce",
            "mentalita",
            "intenzita, komplexita a efektivita",
        ],
        "notice": (
            "Pole taktiky nebyla dekódována. Název a zdroje pocházejí z komprimovaného manifestu "
            "(heuristika z jednoho pozorovaného vzorku); formace a instrukce zůstávají neznámé. "
            "Pozorovaný prefix zatím není oficiální specifikací FMF."
        ),
    }


def inspect_fmf(path: str | Path) -> dict[str, object]:
    file_path = Path(path)
    if not file_path.is_file():
        raise FMFInspectionError("Soubor nebyl nalezen.")
    if file_path.stat().st_size > MAX_INPUT_BYTES:
        raise FMFInspectionError("Soubor překračuje limit 5 MiB.")
    return inspect_fmf_bytes(file_path.read_bytes(), filename=file_path.name)


if __name__ == "__main__":
    import argparse
    import json
    import sys

    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Read-only inspection of an observed FM27 FMF file (v2)")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_fmf(args.path), indent=2, ensure_ascii=False))
