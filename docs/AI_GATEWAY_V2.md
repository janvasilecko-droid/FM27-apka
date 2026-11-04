# AI gateway v2 (serverová část, priorita 2 z handoffu)

Balíček `ai_gateway/` dělá z pozorování a ručního plánu **10bodovou radu**, která vždy projde kontrolou poctivosti,
nebo poctivě řekne, že poradit nelze. Běží jen na serveru. Klíč nikdy nejde do prohlížeče ani do repozitáře.

> **Pozor:** Cursorův `docs/AI_GATEWAY.md` a `serve_local.py` jsem neviděl. Názvy 10 polí jsou podle handoffu,
> ale **typy uvnitř polí jsem navrhl já** (`advice10.py`). Až bude kód v repozitáři, sladit v jediném souboru.

## Zapojení do `serve_local.py`

```python
from ai_gateway import Ledger, advise, build_default_budget, build_default_router, load_registry

ROUTER = build_default_router()                 # čte ANTHROPIC_API_KEY z prostředí serveru
LEDGER = Ledger(sink=".local/ai_usage.jsonl")   # přehled spotřeby (složka je v .gitignore)
BUDGET = build_default_budget(LEDGER)           # None, dokud nenastavíš limity
REGISTRY = load_registry("knowledge.json")      # zdroje, které smí AI citovat

def api_ai_advise(payload: dict) -> tuple[int, dict]:
    result = advise(payload, router=ROUTER, registry=REGISTRY, ledger=LEDGER, budget=BUDGET)
    status = result["status"]
    if status == "budget_exceeded":
        return 429, result
    if status == "error":
        bad_input = result["errors"][0].startswith("Neplatný vstup")
        return (400 if bad_input else 502), result
    return 200, result       # ok, stub, needs_more_info, refused
```

## Vstup a výstup

Vstup: `question`, `plan` (ruční plán `fm27-tactical-coach-manual-plan`), `observations`
(`{id, label, text, minute?}`, štítek ∈ `heuristic_coach`, `ocr_unverified`, `vision_unverified`, `user_entered`,
`screenshot_verified`) a volitelně `images` spolu s `user_initiated_images: true`.
Obrázky se bez toho **neodešlou** (soukromí: žádné tiché posílání obrazu).

Výstup má vždy `status`: `ok` (rada prošla kontrolou), `stub` (není klíč nebo SDK, AI se nevolala),
`needs_more_info` (rada ani po jedné opravě neprošla, uživateli se nevydá žádná rada), `refused`, `budget_exceeded`, `error`.
K tomu `provenance`, `advice`, `text_cs` (české vykreslení 10 bodů), `warnings`, `needs_verification`, `usage`, `cost_usd`.

## Úryvky z knih (`passages`)

Žádost smí nést `passages`: seznam `{id, title, page, text}`, kde `id` začíná `bk:` (nejvýš 12 úryvků, text se krátí na 1500 znaků).
Do požadavku je dá aplikace, která knihy hledá (v `trener/` to dělá stránka v Claude). Gateway s nimi zachází jako s **teorií obecného fotbalu**:

- v `refs` je smí citovat `context`, `diagnosis` a `change`; nejvýš na úrovni `inferred`, nikdy výš;
- `evidenceA` a `evidenceB` musí odkazovat na pozorování, úryvek z knihy důkazem není;
- neznámé `bk:` id (rada si vymyslela citaci) je chyba a spustí opravné kolo;
- v systémovém promptu je pravidlo, že úryvky nesmí sloužit k tvrzení, jak funguje FM27.

Texty knih nepatří do repozitáře, do logů ani do záznamu spotřeby.

## Pravidla poctivosti, která validátor vynucuje

Každé pravidlo má test v `ai_gateway/tests/test_advice10.py`; šest záměrně vnesených chyb testy odhalily.

- Každé tvrzení má úroveň (`verified` / `observed` / `user_entered` / `inferred` / `unknown`) a odkazy na pozorování
  nebo zdroje, které opravdu existují. Úroveň není silnější než nejslabší důkaz, o který se opírá.
- Strojové čtení (`ocr_unverified`, `vision_unverified`) a heuristiky jsou nejvýš `inferred`.
- **Vysoká jistota** jen ze dvou nezávislých ověřených pozorování (`screenshot_verified`). Jedna chvíle ani jedna
  statistika není důkaz problému.
- Názvy rolí, nastavení a cesty v menu FM27 jsou „neověřené“, dokud je nepotvrdí oficiální zdroj FM27 z registru
  nebo ověřený screenshot. Neověřené musí skončit v `unknown` jako úkol k ověření.
- Starší verze FM není FM27: `verified` smí nést jen oficiální zdroj výslovně vázaný na FM27. I ten popisuje jen
  oznámené funkce (viz `caveat` v `knowledge.json`), ne ověřené chování ve hře.
- Žádná tvrzení o interní mechanice FM27 (CA/PA, match engine, skryté atributy) bez ověřeného zdroje.
- Nejvýš dvě cílené změny; každá s hráčem (nebo „tým“), nastavením, z → na a kroky v menu.
- Rada musí říct, co po změně měřit, kdy znovu vyhodnotit, jaká jsou rizika a jak změnu vrátit.

## Čtení obrazovky (`vision.py`, priorita 1)

`extract_screen()` pošle jeden snímek a vrátí údaje se štítkem **`vision_unverified`**. Každý údaj musí nést doslovný
`evidence_text` z obrázku a `value` v něm musí být obsaženo; ostatní se zahodí (`dropped`). Model nic neradí.
`fields_to_observations()` je převede na pozorování pro `advise()`. **Není to „OCR PASS“ ani „vision PASS“:** čtení se musí
teprve změřit na skutečných screenshotech FM27 s ověřenou pravdou. Kdy snímek poslat (změna obrazovky, frekvence,
deduplikace) rozhoduje filtr snímků na klientu/desktopu, ne tento modul.

## Trasy modelů a náklady

Výchozí trasy jsou **odhad** (`providers.py`): `advice` → `claude-opus-5-5` (effort `medium`), `vision` →
`claude-haiku-5-5` (`low`), `teach` → `claude-sonnet-5-5`, `voice` → `claude-haiku-5-5`. Jestli levnější model pro čtení
obrazovky stačí, je nutné změřit na skutečných screenshotech. Přepis bez zásahu do kódu:
`FM27_AI_ROUTES='{"advice": {"model": "claude-opus-5-5", "effort": "high"}}'`.

Ceny v `costs.py` jsou z dokumentace Claude API ve stavu k 6. 10. 2026 a mohou zastarat. Když cena modelu chybí, cena volání je
`None` (neznámá), nikdy nula. Limity: `FM27_AI_BUDGET_DAILY_USD`, `FM27_AI_BUDGET_MONTHLY_USD` (klouzavá okna 24 h / 30 dní).

## Klíč

Do prostředí serveru, ne do chatu a ne do souboru v repozitáři. Klíč Anthropic spravuješ na
https://console.anthropic.com/settings/keys. Pro jedno spuštění v PowerShellu (po zavření okna zmizí):

```powershell
$env:ANTHROPIC_API_KEY = "tady-vlož-klíč-jen-do-terminálu"
python3 serve_local.py
```

## Co je ověřeno a co ne

**Ověřeno testy bez klíče:** kontrola poctivosti, repair smyčka, ochrana soukromí obrázků, náklady a limity, zapojení trasy,
tvar požadavku a čtení odpovědi proti zachycenému HTTP přenosu skutečného SDK (`anthropic` 2.4.0): žádné `temperature`,
`thinking`, prefill ani vynucený `tool_choice`, `output_config` se schématem a `effort`, správné čtení tokenů a odmítnutí.

**Neověřeno (potřebuje klíč):** že živé API přijme strukturovaný výstup s tímto schématem, `effort` a serverový fallback
(`server-side-fallback-2026-07-01`). Pokud API fallback odmítne, adaptér to jednou zopakuje bez něj a napíše to do `warnings`.

```bash
python3 -m ai_gateway.live_check --yes     # jedno placené volání, řádově jednotky centů
```

Po spuštění zkontroluj: `status` je `ok` nebo `needs_more_info` (obojí znamená, že API požadavek přijalo), ve `warnings`
není „zopakován bez něj“ (jinak vypni fallback `FM27_AI_REFUSAL_FALLBACK=0`) a `cena` není `None` (jinak chybí cena modelu).

## Omezení

- Adaptér pro OpenAI zatím není; zůstává stávající proxy v `serve_local.py`, až bude kód v repozitáři.
- Žádná dlouhodobá paměť kariéry a žádný hlas. V dokumentaci Claude API, kterou mám, řečový vstup ani výstup není
  (ověřit v etapě 5); vrstva pro TTS/STT je samostatná práce.
- Rada se počítá z textových pozorování; skutečné čtení obrazovky na FM27 nebylo na reálných screenshotech změřeno.
