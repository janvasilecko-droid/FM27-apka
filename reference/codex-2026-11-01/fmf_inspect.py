"""Conservative, read-only metadata inspection for the observed FM27 tactic container."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path


OBSERVED_PREFIX = bytes.fromhex("02 01 61 66 65 2e")
ZSTD_MAGIC = bytes.fromhex("28 b5 2f fd")
MAX_INPUT_BYTES = 5 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_7Z_SECONDS = 8


class FMFInspectionError(ValueError):
    """Raised when the file is not safely inspectable by this limited reader."""


def _decompress_manifest_with_python(data: bytes, offset: int) -> bytes | None:
    try:
        import zstandard  # type: ignore[import-not-found]
    except ImportError:
        return None
    try:
        # Stream only the bounded manifest prefix. A malformed frame cannot make
        # this reader allocate an unbounded decompressed payload.
        import io

        with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(data[offset:])) as reader:
            result = reader.read(MAX_MANIFEST_BYTES + 1)
    except Exception as exc:  # noqa: BLE001 - dependency reports format-specific errors.
        raise FMFInspectionError("Zstandard manifest nebylo možné ověřit.") from exc
    if len(result) > MAX_MANIFEST_BYTES:
        raise FMFInspectionError("Manifest překročil limit 1 MiB.")
    return result


def _decompress_manifest_with_7zip(data: bytes) -> bytes:
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
    """Collect bounded ASCII fields whose preceding little-endian length matches."""
    tokens: list[str] = []
    for offset in range(0, max(0, len(manifest) - 4)):
        length = int.from_bytes(manifest[offset : offset + 4], "little")
        if not 1 <= length <= 96 or offset + 4 + length > len(manifest):
            continue
        value = manifest[offset + 4 : offset + 4 + length]
        if all(0x20 <= byte <= 0x7E for byte in value):
            decoded = value.decode("ascii")
            tokens.append(decoded)
    return tokens


def _resource_names(tokens: list[str]) -> list[str]:
    names: list[str] = []
    extensions = {".tac", ".img", ".aom"}
    for index, token in enumerate(tokens):
        if token in extensions and index:
            names.append(f"{tokens[index - 1]}{token}")
    return names


def inspect_fmf_bytes(data: bytes, *, filename: str = "uploaded.fmf") -> dict[str, object]:
    """Return observed container metadata; does not decode tactic settings."""
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
    manifest_offset = offsets[-1]
    manifest = _decompress_manifest_with_python(data, manifest_offset)
    if manifest is None:
        manifest = _decompress_manifest_with_7zip(data)
    tokens = _length_prefixed_ascii_tokens(manifest)
    resources = _resource_names(tokens)
    tactic_name = next(
        (tokens[index - 1] for index, token in enumerate(tokens) if token == ".tac" and index),
        None,
    )
    return {
        "format": "fm27-tactic-fmf-observed",
        "status": "metadata_only",
        "filename": Path(filename).name,
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "observed_prefix_hex": OBSERVED_PREFIX.hex(" "),
        "observed_header_version": f"{data[0]}.{data[1]}",
        "zstd_manifest_offset": manifest_offset,
        "manifest_size_bytes": len(manifest),
        "tactic_name": tactic_name,
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
            "Pole taktiky nebyla dekódována. Název a zdroje pocházejí z komprimovaného manifestu; "
            "formace a instrukce zůstávají neznámé. Tento pozorovaný prefix zatím není oficiální "
            "specifikací FMF."
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
    import sys

    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Read-only inspection of an observed FM27 FMF file")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect_fmf(args.path), indent=2, ensure_ascii=False))
