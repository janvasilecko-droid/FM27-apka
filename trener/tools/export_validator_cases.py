"""Vygeneruje `trener/test/fixtures/validator_cases.json` z Pythonového validátoru.

JavaScriptový překlad v `trener/src/core.js` se testuje proti těmto případům (shodné `ok`, `errors`,
`warnings`, `needs_verification`). Spuštění z kořene repozitáře:  python3 trener/tools/export_validator_cases.py
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from ai_gateway.advice10 import validate_advice10  # noqa: E402
from ai_gateway.demo_data import demo_advice  # noqa: E402
from ai_gateway.sources import SourceRegistry  # noqa: E402

KNOWLEDGE = ROOT / "reference" / "codex-2026-11-01" / "knowledge.json"
OFFICIAL = "fm27-navigation"
PASSAGE = "bk:abc:12:3"
PASSAGES = [PASSAGE]

OBS = {
    "obs-1": {"label": "ocr_unverified", "text": "DEMO strojové čtení"},
    "obs-2": {"label": "user_entered", "text": "DEMO zadal uživatel"},
    "obs-3": {"label": "ocr_unverified", "text": "DEMO druhé strojové čtení"},
    "shot-1": {"label": "screenshot_verified", "text": "DEMO ověřený screenshot 1"},
    "shot-2": {"label": "screenshot_verified", "text": "DEMO ověřený screenshot 2"},
}


def patched(**changes):
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


def item():
    return copy.deepcopy(demo_advice()["change"]["items"][0])


def source(sid, version, source_type):
    return {"id": sid, "title": "t", "url": "https://x.test", "version": version, "source_type": source_type}


cases: list[dict] = []


def add(name, advice, *, registry="knowledge", passages=None, obs=None, max_changes=None):
    observations = OBS if obs is None else obs
    if registry == "knowledge":
        reg_items, reg = "knowledge", SourceRegistry.from_knowledge_json(KNOWLEDGE)
    elif registry == "none":
        reg_items, reg = "none", None
    else:
        reg_items, reg = registry, SourceRegistry.from_knowledge_json({"items": registry})
    kwargs = {}
    if max_changes is not None:
        kwargs["max_changes"] = max_changes
    result = validate_advice10(
        advice,
        observations=observations,
        registry=reg,
        passages=None if passages is None else {pid: {} for pid in passages},
        **kwargs,
    )
    cases.append(
        {
            "name": name,
            "advice": advice,
            "observations": observations,
            "registry": reg_items,
            "passages": passages,
            "max_changes": max_changes,
            "expected": {
                "ok": result.ok,
                "errors": result.errors,
                "warnings": result.warnings,
                "needs_verification": result.needs_verification,
            },
        }
    )


# --- struktura -----------------------------------------------------------------------------
add("demo rada je platná", demo_advice())
broken = demo_advice()
del broken["risk"]
add("chybí sekce", broken)
extra = demo_advice()
extra["bonus"] = {}
add("nadbytečná sekce je jen varování", extra)
add("není objekt (seznam)", [])
add("není objekt (text)", "text")
add("sekce není objekt", patched(**{"context": "text"}))
add("neplatná úroveň", patched(**{"context.tier": "certain"}))
add("refs nejsou seznam textů", patched(**{"context.refs": "obs-2"}))
# --- důkazy a úrovně -------------------------------------------------------------------------
add("neznámý odkaz", patched(**{"evidenceA.refs": ["obs-999"]}))
add("důkaz jen ze zdroje", patched(**{"evidenceA.refs": [OFFICIAL], "evidenceA.tier": "inferred"}))
add("úroveň silnější než důkaz", patched(**{"evidenceA.tier": "observed"}))
add("silná úroveň bez odkazů", patched(**{"context.refs": []}))
add("verified z pozorování", patched(**{"diagnosis.tier": "verified"}))
add("verified z oficiálního zdroje", patched(**{"diagnosis.tier": "verified", "diagnosis.refs": [OFFICIAL]}))
add("verified bez registru", patched(**{"diagnosis.tier": "verified", "diagnosis.refs": [OFFICIAL]}), registry="none")
add(
    "verified z komunitního zdroje FM27",
    patched(**{"diagnosis.tier": "verified", "diagnosis.refs": ["forum"]}),
    registry=[source("forum", "FM27", "Komunitní rozbor")],
)
# --- jistota -----------------------------------------------------------------------------------
two_machine = {"evidenceB": {"text": "Druhé strojové čtení potvrzuje totéž.", "tier": "inferred", "refs": ["obs-3"]}}
add("high ze dvou strojových čtení", patched(**two_machine, **{"confidence.level": "high"}))
add("medium ze dvou strojových čtení", patched(**two_machine, **{"confidence.level": "medium"}))
add("high ze strojového čtení a tvrzení uživatele", patched(**{"confidence.level": "high"}))
shots = {
    "evidenceA": {"text": "Ověřený screenshot pozic ukazuje vzdálenost řad.", "tier": "observed", "refs": ["shot-1"]},
    "evidenceB": {"text": "Druhý ověřený screenshot ukazuje totéž v jiné minutě.", "tier": "observed", "refs": ["shot-2"]},
    "diagnosis": {"text": "Záložní řada je opakovaně daleko od útočníka.", "tier": "observed", "refs": ["shot-1", "shot-2"]},
}
add("high ze dvou ověřených screenshotů", patched(**shots, **{"confidence.level": "high"}))
add(
    "high s jedním ověřeným a jedním neznámým důkazem",
    patched(
        **{
            "evidenceA": shots["evidenceA"],
            "evidenceB": {"text": "Druhý důkaz zatím nemám.", "tier": "unknown", "refs": []},
            "confidence.level": "high",
        }
    ),
)
add(
    "high s jedním ověřeným a jedním strojovým důkazem",
    patched(
        **{
            "evidenceA": shots["evidenceA"],
            "evidenceB": {"text": "Druhý důkaz je jen strojově vyčtený.", "tier": "inferred", "refs": ["obs-1"]},
            "confidence.level": "high",
        }
    ),
)
none_ev = {
    "evidenceA": {"text": "Zatím nemám žádný důkaz.", "tier": "unknown", "refs": []},
    "evidenceB": {"text": "Ani druhý důkaz zatím nemám.", "tier": "unknown", "refs": []},
}
add("medium bez důkazu", patched(**none_ev))
add("low bez důkazu", patched(**none_ev, **{"confidence.level": "low"}))
add("low bez položek unknown", patched(**{"confidence.level": "low", "unknown.items": []}))
add("neplatná jistota", patched(**{"confidence.level": "certain"}))
same_obs = {"evidenceB": {"text": "Totéž pozorování podruhé.", "tier": "inferred", "refs": ["obs-1"]}}
add("stejné pozorování u obou důkazů", patched(**same_obs))
# --- změny -------------------------------------------------------------------------------------
add("tři změny", patched(**{"change.items": [item(), item(), item()]}))
add("tři změny při limitu 3", patched(**{"change.items": [item(), item(), item()]}), max_changes=3)
add("žádná změna", patched(**{"change.items": []}))
add("dvě změny", patched(**{"change.items": [item(), item()]}))
add("z a na je stejné", patched(**{"change.items.0.to": "SOUČASNÁ povinnost (zjisti ve hře)"}))
add("chybí hráč", patched(**{"change.items.0.player": ""}))
add("prázdné kroky v menu", patched(**{"change.items.0.where": []}))
add("prázdný krok v menu", patched(**{"change.items.0.where": ["  "]}))
add("obecná cílová hodnota", patched(**{"change.items.0.to": "více podpory"}))
add("obecná cílová hodnota velkými", patched(**{"change.items.0.to": "Víc podpory"}))
add("podobné, ale ne obecné slovo", patched(**{"change.items.0.to": "víceméně stejná"}))
add("položka změny není objekt", patched(**{"change.items": ["x"]}))
add("verified navigace bez zdroje", patched(**{"change.items.0.where_tier": "verified"}))
add(
    "verified navigace s oficiálním zdrojem",
    patched(**{"change.items.0.where_tier": "verified", "change.items.0.refs": [OFFICIAL]}),
)
add(
    "verified navigace se zdrojem FM26",
    patched(**{"change.items.0.where_tier": "verified", "change.items.0.refs": ["old"]}),
    registry=[source("old", "FM26", "Oficiální produktový článek")],
)
add("observed navigace ze strojového čtení", patched(**{"change.items.0.where_tier": "observed", "change.items.0.refs": ["obs-1"]}))
add("observed navigace z ověřeného screenshotu", patched(**{"change.items.0.where_tier": "observed", "change.items.0.refs": ["shot-1"]}))
add("neplatná where_tier", patched(**{"change.items.0.where_tier": "maybe"}))
add("neověřená navigace bez otevřené otázky", patched(**{"unknown.items": []}))
add("unknown.items nejsou seznam", patched(**{"unknown.items": "x"}))
# --- měření, rizika, zpětný krok -------------------------------------------------------------------
add("žádné kontroly", patched(**{"measure.checks": []}))
add("záporné minuty", patched(**{"measure.recheck_after_minutes": -1}))
add("minuty jako bool", patched(**{"measure.recheck_after_minutes": True}))
add("minuty jako text", patched(**{"measure.recheck_after_minutes": "15"}))
add("minuty nula", patched(**{"measure.recheck_after_minutes": 0}))
add("žádná rizika", patched(**{"risk.items": []}))
add("krátký zpětný krok", patched(**{"reversal.text": "ne"}))
add("measure není objekt", patched(**{"measure": "x"}))
# --- vymyšlené mechaniky -----------------------------------------------------------------------------
add("CA v rizicích", patched(**{"risk.items": ["Sníží se CA hráče"]}))
add("match engine v kontextu", patched(**{"context.text": "V match engine se útočník ztratí v prostoru."}))
add("skrytý atribut v diagnóze", patched(**{"diagnosis.text": "Skrytý atribut hráče ho omezuje v pohybu."}))
add("potential ability v kontrolách", patched(**{"measure.checks": ["Sleduj potential ability útočníka"]}))
add("zápasový engine", patched(**{"change.text": "Zápasový engine tuto roli zvýhodňuje při útoku."}))
add(
    "mechanika jako otevřená otázka",
    patched(**{"unknown.items": ["Nevím, jak match engine pracuje s touto rolí", "Pošli screenshot obrazovky Taktika"]}),
)
add(
    "mechanika s oficiálním zdrojem",
    patched(
        **{
            "diagnosis": {
                "text": "Oficiální článek popisuje match engine a Action Zones jako součást rozšířených dat.",
                "tier": "verified",
                "refs": [OFFICIAL],
            }
        }
    ),
)
add("zkratka PA uvnitř slova není mechanika", patched(**{"risk.items": ["Riziko: ŠPAČEK nebude krýt prostor"]}))
# --- úryvky z knih --------------------------------------------------------------------------------------
add("úryvek jako opora teorie", patched(**{"diagnosis.refs": ["obs-1", PASSAGE]}), passages=PASSAGES)
add("úryvek nemůže zesílit tvrzení", patched(**{"diagnosis.tier": "observed", "diagnosis.refs": [PASSAGE]}), passages=PASSAGES)
add("úryvek není důkaz o zápase", patched(**{"evidenceA.refs": [PASSAGE], "evidenceA.tier": "inferred"}), passages=PASSAGES)
add("necitovaný úryvek", patched(**{"diagnosis.refs": ["obs-1", "bk:zzz:1:1"]}), passages=PASSAGES)
add("úryvek bez předaných úryvků", patched(**{"diagnosis.refs": ["obs-1", PASSAGE]}))

# --- nálezy nezávislé revize (4. 11. 2026) -----------------------------------------------------------------
OBS2 = {
    **OBS,
    "shot-3": {"label": "screenshot_verified", "text": "DEMO ověřený screenshot 3"},
    "snap-1": {"label": "screenshot_verified", "text": "DEMO statistiky ze sledování zápasu", "scope": "live"},
}
nav_observed = {"change.items.0.where_tier": "observed"}
add("observed navigace z čísel ze sledování zápasu", patched(**nav_observed, **{"change.items.0.refs": ["snap-1"]}), obs=OBS2)
add("observed navigace z ověřeného screenshotu (jsou i čísla ze sledování)", patched(**nav_observed, **{"change.items.0.refs": ["shot-1"]}), obs=OBS2)
add("observed navigace z čísel i ze screenshotu", patched(**nav_observed, **{"change.items.0.refs": ["snap-1", "shot-1"]}), obs=OBS2)


def high(a_refs, b_refs, **more):
    return patched(
        **{
            "evidenceA": {"text": "Ověřené screenshoty ukazují vzdálenost řad.", "tier": "observed", "refs": a_refs},
            "evidenceB": {"text": "Další ověřené screenshoty ukazují totéž.", "tier": "observed", "refs": b_refs},
            "diagnosis": {"text": "Záložní řada je opakovaně daleko od útočníka.", "tier": "observed", "refs": a_refs},
            "confidence.level": "high",
            **more,
        }
    )


add("high: oba důkazy na týchž dvou pozorováních", high(["shot-1", "shot-2"], ["shot-1", "shot-2"]), obs=OBS2)
add("high: druhý důkaz je jen podmnožina prvního", high(["shot-1", "shot-2"], ["shot-1"]), obs=OBS2)
add("high: první důkaz je jen podmnožina druhého", high(["shot-1"], ["shot-1", "shot-2"]), obs=OBS2)
add("high: každý důkaz má vlastní pozorování i sdílené", high(["shot-1", "shot-3"], ["shot-2", "shot-3"]), obs=OBS2)
add("medium: druhý důkaz je podmnožina prvního jen varuje", high(["shot-1", "shot-2"], ["shot-1"], **{"confidence.level": "medium"}), obs=OBS2)
add(
    "úryvek z knihy mezi důkazy vedle pozorování",
    patched(**{"evidenceA.refs": ["obs-1", PASSAGE], "evidenceA.tier": "inferred"}),
    passages=PASSAGES,
)
add("odkazy u změny jsou text", patched(**{"change.items.0.refs": "shot-1"}))
add("odkazy u změny nejsou texty", patched(**{"change.items.0.refs": [42, None]}))
add("odkaz u změny neexistuje", patched(**{"change.items.0.refs": ["neexistuje"]}))
add("odkaz u změny na pozorování", patched(**{"change.items.0.refs": ["obs-1"]}))
add("mechanika v názvu nastavení", patched(**{"change.items.0.setting": "Skryté atributy: Konzistence"}))
add("mechanika v cílové hodnotě", patched(**{"change.items.0.to": "CA nad 150"}))
add("mechanika v krocích menu", patched(**{"change.items.0.where": ["Taktika", "Match engine"]}))
add("mechanika ve zdůvodnění jistoty", patched(**{"confidence.text": "Jistota vychází ze současné schopnosti hráče."}))
for index, phrase in enumerate(
    [
        "match-engine ve FM27 upřednostňuje křídla",
        "matchengine favorizuje dlouhé míče",
        "herní motor zvýhodňuje rychlé útočníky",
        "skryté hodnoty hráčů rozhodují",
        "Hidden stats like consistency matter",
        "potenciál (pa) hráče je vysoký",
        "aktuální schopnost hráče je nízká",
    ]
):
    add(f"jiné vyjádření mechaniky {index + 1}", patched(**{"context.text": phrase}))
add("závorka s pasivní není mechanika", patched(**{"risk.items": ["Riziko: (pasivní) obrana nekryje prostor za zády"]}))

out = ROOT / "trener" / "test" / "fixtures" / "validator_cases.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(cases, ensure_ascii=False, indent=1), encoding="utf-8")
ok_count = sum(1 for c in cases if c["expected"]["ok"])
print(f"zapsáno {len(cases)} případů ({ok_count} platných, {len(cases) - ok_count} zamítnutých) -> {out.relative_to(ROOT)}")
