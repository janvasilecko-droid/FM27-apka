"""Spotřeba AI: ceník, účetní kniha volání a rozpočet.

Ceny v `DEFAULT_PRICES` jsou převzaté z tabulky modelů v dokumentaci Claude API ve stavu
k 6. 10. 2026 (USD za 1 milion tokenů) a mohou zastarat. Proto má každá cena `valid_from`
a `source`, a když cena chybí, cena volání je `None` (neznámá), nikdy ne nula.
Před spoléháním na částky ceny ověř na oficiální stránce cen Anthropic.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Mapping

PRICE_SOURCE = "Dokumentace Claude API, tabulka modelů (stav 2026-10-06); ověřit na stránce cen"


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    cache_read: float | None = None
    cache_write: float | None = None
    # Nad tímto počtem vstupních tokenů platí jiné sazby (např. Haiku 5.5 nad 100 000).
    long_threshold: int | None = None
    long_input: float | None = None
    long_output: float | None = None
    valid_from: str = "2026-10-06"
    source: str = PRICE_SOURCE


DEFAULT_PRICES: dict[str, Price] = {
    "anthropic/claude-opus-5-5": Price(input=4.00, output=20.00, cache_read=0.20, cache_write=5.00),
    "anthropic/claude-sonnet-5-5": Price(input=2.00, output=10.00, cache_read=0.20, cache_write=2.50),
    "anthropic/claude-haiku-5-5": Price(
        input=0.10, output=0.50, long_threshold=100_000, long_input=0.50, long_output=2.50
    ),
}


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


class Ledger:
    """Kniha volání v paměti (volitelně navíc řádky JSONL do souboru `sink`)."""

    def __init__(
        self,
        prices: Mapping[str, Price] | None = None,
        *,
        clock: Callable[[], float] = time.time,
        sink: str | Path | None = None,
    ):
        self.prices: dict[str, Price] = dict(DEFAULT_PRICES if prices is None else prices)
        self._clock = clock
        self._sink = Path(sink) if sink else None
        self.records: list[dict] = []

    def cost_usd(self, provider: str, model: str, usage: Usage) -> float | None:
        price = self.prices.get(f"{provider}/{model}")
        if price is None:
            return None
        long_context = price.long_threshold is not None and usage.input_tokens > price.long_threshold
        rate_in = price.long_input if long_context and price.long_input is not None else price.input
        rate_out = price.long_output if long_context and price.long_output is not None else price.output
        if usage.cache_read_tokens and price.cache_read is None:
            return None
        if usage.cache_write_tokens and price.cache_write is None:
            return None
        total = usage.input_tokens * rate_in + usage.output_tokens * rate_out
        total += usage.cache_read_tokens * (price.cache_read or 0.0)
        total += usage.cache_write_tokens * (price.cache_write or 0.0)
        return round(total / 1_000_000, 6)

    def record(
        self,
        *,
        task: str,
        provider: str,
        model: str,
        usage: Usage,
        request_id: str | None = None,
    ) -> dict:
        entry = {
            "at": self._clock(),
            "task": task,
            "provider": provider,
            "model": model,
            "usage": usage.as_dict(),
            "usd": self.cost_usd(provider, model, usage),
            "request_id": request_id,
        }
        self.records.append(entry)
        if self._sink is not None:
            self._sink.parent.mkdir(parents=True, exist_ok=True)
            with self._sink.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry

    def total_usd(self, since: float | None = None) -> float:
        """Součet cen volání, jejichž cena je známá. Volání bez ceny se nezapočítají."""
        return round(sum(r["usd"] for r in self._window(since) if r["usd"] is not None), 6)

    def summary(self, since: float | None = None) -> dict:
        rows = self._window(since)
        by_task: dict[str, dict] = {}
        for row in rows:
            slot = by_task.setdefault(row["task"], {"calls": 0, "usd": 0.0})
            slot["calls"] += 1
            slot["usd"] = round(slot["usd"] + (row["usd"] or 0.0), 6)
        return {
            "calls": len(rows),
            "usd_known": self.total_usd(since),
            "unpriced_calls": sum(1 for r in rows if r["usd"] is None),
            "input_tokens": sum(r["usage"]["input_tokens"] for r in rows),
            "output_tokens": sum(r["usage"]["output_tokens"] for r in rows),
            "by_task": by_task,
            "prices_note": PRICE_SOURCE,
        }

    def _window(self, since: float | None) -> list[dict]:
        return [r for r in self.records if since is None or r["at"] >= since]


class Budget:
    """Klouzavé limity (posledních 24 h / 30 dní). Neznámé ceny se do limitu nepočítají."""

    def __init__(
        self,
        ledger: Ledger,
        *,
        daily_usd: float | None = None,
        monthly_usd: float | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.ledger = ledger
        self.daily_usd = daily_usd
        self.monthly_usd = monthly_usd
        self._clock = clock

    def check(self) -> tuple[bool, str | None]:
        now = self._clock()
        if self.daily_usd is not None:
            spent = self.ledger.total_usd(since=now - 86_400)
            if spent >= self.daily_usd:
                return False, f"Denní limit {self.daily_usd:.2f} USD vyčerpán ({spent:.2f} USD za 24 h)."
        if self.monthly_usd is not None:
            spent = self.ledger.total_usd(since=now - 30 * 86_400)
            if spent >= self.monthly_usd:
                return False, f"Měsíční limit {self.monthly_usd:.2f} USD vyčerpán ({spent:.2f} USD za 30 dní)."
        return True, None
