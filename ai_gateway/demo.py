"""Ukázka formátu 10bodové rady. Spuštění z kořene repozitáře:  python3 -m ai_gateway.demo

Nevolá žádnou síť ani AI. Používá falešného poskytovatele, který vrací předem napsanou radu
(`demo_data.py`); slouží jen k tomu, abys viděl, jak rada vypadá a jak ji validátor kontroluje.
"""

from __future__ import annotations

import json
import sys

from . import FakeProvider, Router, advise
from .costs import Usage
from .demo_data import DEMO_BANNER, demo_advice, demo_request
from .providers import DEFAULT_ROUTES, ProviderResponse, Route


def main() -> int:
    advice = demo_advice()
    provider = FakeProvider(
        [
            ProviderResponse(
                text=json.dumps(advice, ensure_ascii=False),
                parsed=advice,
                stop_reason="end",
                usage=Usage(input_tokens=1200, output_tokens=650),
                model="demo-model",
                provider="fake",
            )
        ]
    )
    router = Router({"fake": provider}, {**DEFAULT_ROUTES, "advice": Route("fake", "demo-model", None, 4096)})
    result = advise(demo_request(), router=router)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("=" * 78)
    print(DEMO_BANNER)
    print("=" * 78)
    print(f"status: {result['status']} | provenance: {result['provenance']}")
    print()
    print(result["text_cs"] or "\n".join(result["errors"]))
    if result["warnings"]:
        print("\nUpozornění:")
        for warning in result["warnings"]:
            print(f"  ! {warning}")
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
