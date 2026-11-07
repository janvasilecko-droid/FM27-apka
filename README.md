# FM27 Tactical Coach

Osobní AI trenér pro Football Manager 27: radí z tvých knih o taktice, zná tvůj tým a taktiku, čte snímky obrazovky,
sleduje zápas, upozorňuje hlasem, vede historii zápasů, učí taktiku a **sám hledá zdroje na webu** (vždy označené jako neověřené). Co neví, to řekne; **nikdy nepředstírá, že FM27 vidí**.
Zadání (doslova): [`docs/ZADANI_MASTER_PROMPT.md`](./docs/ZADANI_MASTER_PROMPT.md).

## Stav k 6. 11. 2026

Aplikace je implementovaná podle zadání (deset sekcí, sedm etap) a prochází přes tisíc automatických zkoušek (1081 testů jádra, 143 + 11 v Pythonu, 1015 kontrol v prohlížeči; **1011 bez skutečných exportů z FM27, které v repozitáři nejsou**: 4 kontroly v prohlížeči a 2 testy jádra jedou jen s nimi). Část zkoušek se navíc přeskočí bez balíčků `zstandard` a `anthropic`. Kód prošel nezávislou revizí dvou AI revizorů, jejich nálezy jsou opravené: [`docs/REVIZE_NEZAVISLA_2026-11-04.md`](./docs/REVIZE_NEZAVISLA_2026-11-04.md); čtečka `.fmf` a vlastní dekodér zstd prošly ještě třemi koly revize (5. a 6. 11. 2026; revizoři i ověřovatelé jsou modely, ne lidé; opravy třetího kola prověřil už jen cílený průchod, ne další úplné kolo): [`docs/REVIZE_FMF_2026-11-05.md`](./docs/REVIZE_FMF_2026-11-05.md). **Z cloudu nejde ověřit
skutečného Claude, skutečné FM27 ani okno hry**, proto je u každého bodu zadání zvlášť napsáno, co je ověřené a co čeká na tebe:
[`docs/AKCEPTACNI_MATICE.md`](./docs/AKCEPTACNI_MATICE.md).

| Co | Kde |
|---|---|
| **Stránka v Claude** (hned použitelná, bez klíče) | https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh (soukromý odkaz) |
| **Samostatná aplikace** (sdílení okna hry, hlasová otázka, instalace; vlastní klíč AI) | **běží**: https://janvasilecko-droid.github.io/FM27-apka/ (nasazuje se ručně a po změně aplikace na `main`: `trener/**`, `reference/codex-2026-11-01/**`, `ai_gateway/costs.py` nebo samotného workflow; podrobnosti v [`docs/ARCHITEKTURA_V2.md`](./docs/ARCHITEKTURA_V2.md), část 7) |
| Popis aplikace, sestavení, zkoušky | [`trener/README.md`](./trener/README.md) |
| Architektura a pravidla poctivosti | [`docs/ARCHITEKTURA_V2.md`](./docs/ARCHITEKTURA_V2.md) |
| Rozšíření podle zadání majitele (6 referenčních projektů): analýza, metodika výpočtů, plán a rizika | [`docs/REFERENCE_ANALYSIS.md`](./docs/REFERENCE_ANALYSIS.md), [`docs/ANALYTICS_METHODOLOGY.md`](./docs/ANALYTICS_METHODOLOGY.md), [`docs/PLAN_ROZSIRENI.md`](./docs/PLAN_ROZSIRENI.md) |
| Analýza sestavy a taktiky, příprava na zápas, Tactical Effectiveness: co aplikace dělá, na čem staví a čemu věřit (štítky HRA, KOMUNITA, ODHAD, tabulky pravidel) | [`docs/ANALYZA_SESTAVY_A_PRIPRAVY.md`](./docs/ANALYZA_SESTAVY_A_PRIPRAVY.md) |
| Průzkum české hry FM27 (7. 11. 2026): co je ve hře ověřeno a co zůstává nezjištěno | [`docs/FM27_PRUZKUM_VE_HRE.md`](./docs/FM27_PRUZKUM_VE_HRE.md) |
| Co dál a co potřebuju od tebe | [`POKRACOVANI.md`](./POKRACOVANI.md) |

## Co je v repozitáři

| Složka | Obsah |
|---|---|
| `trener/` | **aplikace** (jedna kódová základna, dvě sestavení: stránka v Claude a samostatná PWA) a její zkoušky |
| `ai_gateway/` | serverové AI jádro v Pythonu (kontrola poctivosti, čtení obrazovky, náklady); validátor z něj je přeložený do `trener/src/core.js`. 143 testů, živé API neověřeno |
| `fmf_research/` | opravený inspektor souborů `.fmf` (11 testů); originál zůstává beze změny v `reference/` |
| `docs/` | zadání, architektura, akceptační matice, revize souborů z Cursoru, popis `ai_gateway` |
| `reference/` | starší soubory z původní složky, jen pro srovnání |
| `HANDOFF_CLAUDE.md`, `PROMPT_CLAUDE_CONTINUE.md` | předání z Cursoru; jediná úprava (5. 11. 2026): zkratky názvů tří ukázkových taktik jsou zamaskované jako „sample tactic 1/2/3“ |

**Kód z Cursoru (Wave 76) v repozitáři nikdy nebyl**, takže aplikace v `trener/` je nová implementace podle původního zadání, ne
pokračování toho kódu. Kdyby se kód z Cursoru našel, porovná se s ní, nepřepíše se.

## Zkoušky

```bash
node --test trener/test/*.test.mjs                     # 1081 testů jádra, úložiště, barev vzhledu a shody dokumentace s pravidly v kódu (bez Pythonu s balíčkem zstandard a bez skutečných exportů se část přeskočí)
python3 -m unittest discover -s ai_gateway/tests -t .  # 143 testů (16 se bez balíčku anthropic přeskočí) a hlídání klíčů v repu
python3 -m unittest discover -s fmf_research/tests -t . # 11 testů, potřebují `pip install zstandard` (bez něj se všech 11 přeskočí)
```

Zkoušky celé aplikace v Chromiu (1015 kontrol, 27 scénářů; 1011 bez skutečných exportů z FM27, které v repozitáři nejsou) a jejich spuštění: `trener/README.md`.
Skutečné exporty (testy jádra i scénář 21) se zadávají proměnnou `FMF_SAMPLES_DIR` (adresář se soubory `.fmf`); bez ní se příslušné zkoušky přeskočí.
Zkoušky volají jen zkušební náhražky a zachycený přenos, žádné placené API.

**Co běží v CI (GitHub Actions):** jen dvě kontroly: nasazení stránky (`pages.yml`: testy jádra v Node bez věštírny libzstd, sestavení, nasazení) a samostatné porovnání dekodéru zstd s libzstd (`zstd-oracle.yml`, povinná věštírna). **Pythonové zkoušky (`ai_gateway`, `fmf_research`, včetně hlídání klíčů) a zkoušky v prohlížeči v CI neběží**, pouštějí se ručně.

## Pravidla

- Repozitář je **veřejný**: nikdy do něj nedávej klíče, tokeny, hesla ani texty knih. Hlídá se jen tvar klíčů: Pythonová zkouška `NoSecretsInRepo` (`ai_gateway/tests/test_config_and_secrets.py`) hledá šest tvarů klíčů (`test_no_secret_looking_strings`) v souborech s příponou `.py .md .json .js .mjs .cjs .html .css .txt .yml .yaml .toml .env .svg .webmanifest .sh` a bez přípony a kontroluje, že v repozitáři není soubor `.env*` (`test_no_env_files_are_committed`). Hesla a texty knih v celém repozitáři žádná zkouška nehlídá (jen úzká kontrola v `trener/test/school.test.mjs`, že `school.js` neobsahuje id skutečných úryvků z knih); je to pravidlo pro autora. Zkouška klíčů se v CI nespouští.
- Klíč AI patří jen do Nastavení v aplikaci, nikdy do chatu ani do repozitáře.
- Nic se nemaže a nehádá; názvy rolí, nastavení a cest v menu FM27 jsou v aplikaci vždy označené jako neověřené, dokud je nepotvrdí
  tvůj screenshot nebo oficiální zdroj FM27.
