"""Registr zdrojů znalostí (formát `knowledge.json` z Cursoru/Codexu).

Pravidlo ze zadání: „Starší verze FM nesmí být automaticky považovány za totožné s FM27.“
Proto `is_official_fm27()` vrací True jen pro OFICIÁLNÍ zdroj výslovně vázaný na FM27.
I takový zdroj popisuje jen oznámené funkce (`caveat`), ne ověřené chování ve hře.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Iterable, Mapping
from typing import Any

_FM_VERSION = re.compile(r"\bFM\s*-?\s*(\d{2})\b", re.IGNORECASE)


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    url: str
    publisher: str
    fm_version: str | None  # "27", "26", … ; None = nejde o konkrétní verzi FM
    official: bool
    release_state: str  # "pre_release" | "released" | "unknown"
    source_type: str
    trust: str
    caveat: str
    claims: tuple[str, ...]


def _parse_item(item: Mapping[str, Any]) -> Source:
    version_text = str(item.get("version") or "")
    match = _FM_VERSION.search(version_text)
    lowered = version_text.lower()
    if "preview" in lowered or "předvyd" in lowered or "pre-release" in lowered:
        release_state = "pre_release"
    elif match:
        release_state = "released"
    else:
        release_state = "unknown"
    source_type = str(item.get("source_type") or "")
    official = "ficiáln" in source_type.lower() or "official" in source_type.lower()
    return Source(
        id=str(item["id"]),
        title=str(item.get("title") or ""),
        url=str(item.get("url") or ""),
        publisher=str(item.get("publisher") or ""),
        fm_version=match.group(1) if match else None,
        official=official,
        release_state=release_state,
        source_type=source_type,
        trust=str(item.get("trust") or ""),
        caveat=str(item.get("caveat") or ""),
        claims=tuple(str(c) for c in item.get("claims") or ()),
    )


class SourceRegistry:
    def __init__(self, sources: Iterable[Source] = ()):
        self._by_id: dict[str, Source] = {}
        for source in sources:
            if source.id in self._by_id:
                raise ValueError(f"Duplicitní id zdroje: {source.id}")
            self._by_id[source.id] = source

    @classmethod
    def from_knowledge_json(cls, data: Mapping[str, Any] | str | Path) -> "SourceRegistry":
        if not isinstance(data, Mapping):
            data = json.loads(Path(data).read_text(encoding="utf-8"))
        return cls(_parse_item(item) for item in data.get("items", ()))

    def __contains__(self, source_id: object) -> bool:
        return source_id in self._by_id

    def __len__(self) -> int:
        return len(self._by_id)

    def get(self, source_id: str) -> Source | None:
        return self._by_id.get(source_id)

    def ids(self) -> list[str]:
        return list(self._by_id)

    def is_official_fm27(self, source_id: str) -> bool:
        source = self._by_id.get(source_id)
        return bool(source and source.official and source.fm_version == "27")

    def digest(self, max_claims_per_source: int = 6) -> str:
        """Stručný výpis pro systémový prompt: co se smí citovat a s jakým upozorněním."""
        if not self._by_id:
            return "(registr zdrojů je prázdný — žádné tvrzení o FM27 nelze označit jako verified)"
        lines: list[str] = []
        for source in self._by_id.values():
            scope = "oficiální FM27" if self.is_official_fm27(source.id) else "NE oficiální FM27"
            lines.append(f"- {source.id} [{scope}, {source.release_state}] {source.title}")
            if source.caveat:
                lines.append(f"    upozornění: {source.caveat}")
            for claim in source.claims[:max_claims_per_source]:
                lines.append(f"    • {claim}")
        return "\n".join(lines)
