# FM27 Tactical Coach: osobní trenér ze tvých knih

Aplikace k Football Manageru 27, která s tebou řeší problémy, vychází hlavně z **tvých knih** (teorie) a umí si vzít kontext z toho,
co jí ukážeš: tým, taktiku, screenshoty a průběh zápasu. Co neví, to řekne a napíše, co má ověřit ve hře. **FM27 nevidí a nepředstírá,
že ho vidí.** Zadání: [`docs/ZADANI_MASTER_PROMPT.md`](../docs/ZADANI_MASTER_PROMPT.md), architektura:
[`docs/ARCHITEKTURA_V2.md`](../docs/ARCHITEKTURA_V2.md), stav proti zadání: [`docs/AKCEPTACNI_MATICE.md`](../docs/AKCEPTACNI_MATICE.md).

## Dvě sestavení z jednoho kódu

| | **Stránka v Claude** (artefakt) | **Samostatná aplikace** (PWA) |
|---|---|---|
| Kde běží | claude.ai, soukromý odkaz majitele | prohlížeč, jde nainstalovat na plochu a telefon |
| AI | schopnost `sample` z tvého účtu Claude, žádný klíč | tvůj vlastní klíč (Anthropic, nebo OpenAI-kompatibilní), uložený jen v tomhle prohlížeči (na `github.io` výchozí volba „jen do zavření záložky“) |
| Data | místně + synchronizace počítač ↔ telefon přes `db` (soukromá část `data/users/<id>`) | jen místně (IndexedDB), přenos zálohou |
| Snímky obrazovky | vkládáš ručně (Ctrl+V, soubor, foto z telefonu); **sdílení okna hry jen tehdy, když to okno claude.ai stránce povolí** (řádek „Sdílení obrazovky v tomto okně“ v Nastavení; z cloudu to nejde ověřit) | navíc **sdílení okna hry** s výslovným souhlasem |
| Hlas | čtení nahlas | čtení nahlas, **hlasová otázka**, systémové oznámení při skrytém okně |
| Offline | ne | ano (service worker); volání AI a čtení PDF potřebují internet |
| Hledání zdrojů na webu | konektor „Parallel Search“ (musíš ho mít připojený v claude.ai), bez poplatku z aplikace | web search od Anthropic přes tvůj klíč, **účtuje se zvlášť** |

## Deset sekcí

LIVE COACH · Můj tým · Moje taktiky · Analýza soupeře · Taktická laboratoř · Škola taktiky · Historie zápasů · Osobní trenér ·
Zdroje znalostí · Nastavení. Co která dělá, v jakých souborech žije a jaká data má, popisuje architektura (část 2 a 4).

## Jak radí

1. **Plán hledání** (levné volání, `quick`): 3 až 5 krátkých dotazů v jazycích tvých knih; vynechá se, když nejsou žádné knihy.
2. **Hledání v knihách**: index BM25 (bez diakritiky, lehké stemování, čeština a angličtina), víc dotazů se spojí, z jedné knihy
   nejvýš tři úryvky. Hledá se v zařízení; do Claude jdou jen vybrané úryvky.
3. **Rada**: kontext kariéry (soupiska, taktika, paměť z minulých zápasů), pozorování, úryvky a pravidla poctivosti.
4. **Kontrola poctivosti** (`core.js`, `validateAdvice10`, překlad `ai_gateway/advice10.py`): neprošla-li rada, jedno opravné kolo.
   Když neprojde ani to, **žádná rada se neukáže**, jen důvody a „Zkusit znovu“.
5. **Doplnění**: co trenér neví, můžeš vyplnit a poradit znovu.

Pravidla, která se vynucují (úplný seznam v architektuře, část 3): úroveň tvrzení nesmí být silnější než nejslabší důkaz;
strojově vyčtené snímky jsou „neověřené“, dokud je nepotvrdíš; vysoká jistota jen ze dvou nezávislých ověřených screenshotů;
žádné vymyšlené mechaniky FM27 (CA/PA, match engine, skryté atributy); názvy rolí, nastavení a cest v menu FM27 jsou neověřené;
**úryvek z knihy je teorie, ne důkaz o aktuálním zápase**; statistická odchylka není taktický problém; **časová souvislost není
důkaz příčiny** (vyhodnocení změny to říká pokaždé).

## Soubory

| Cesta | K čemu |
|---|---|
| `src/core.js` | jádro bez DOM: text, odstavce, BM25, kontrola poctivosti, prompty |
| `src/websources.js`, `web.js` | zdroje z webu: druh zdroje, verze FM, čtení výsledků, plány hledání (čistý modul); doprava, paměť, limity a karta zdroje (rozhraní) |
| `src/tactics.js`, `analysis.js`, `school.js`, `providers.js`, `alerts.js`, `opponent.js`, `report.js`, `labexplain.js`, `zstd.js`, `fmfglue.js` | čisté moduly bez DOM (UMD), běží v prohlížeči i v Node |
| `src/store.js` | místní úložiště a zrcadlení do `db` (poslední zápis vyhrává, náhrobky, limit 240 kB na dokument) |
| `src/ui.js`, `app.js`, `library.js`, `ai.js`, `context.js`, `advice.js`, `live.js`, `voice.js`, `widgets.js` | rozhraní a napojení na prohlížeč |
| `src/screens/*.js` | jedna obrazovka na soubor; `zz_stubs.js` zachytí sekci bez obrazovky a poctivě řekne, že není hotová |
| `src/standalone.js`, `standalone/` | jen samostatná verze: service worker, manifest, ikony, nabídka instalace |
| `build.mjs` | slepí vše do `dist/trener.fragment.html` (publikuje se), `dist/trener.test.html` (zkoušky) a `dist/standalone/` (nasazení na Pages) |
| `src/styles.css` | celý vzhled: barvy jako proměnné (tmavý a světlý vzhled), karty, levé menu, tlačítka, graf, hřiště; hlídá ho `test/styles.test.mjs` |
| `src/careerread.js`, `clubread.js` | klub, soutěž a sezóna ze hry při zakládání kariéry: pravidla čtení a čištění (čistý modul); blok „Načíst klub ze hry“ ve formuláři kariéry (rozhraní) |
| `src/dwrs.js`, `squadopt.js` | hodnocení hráče na roli (DWRS: kategorie atributů, násobiče role, 0 až 100, profily vah) a nejlepší sestava A + B (maďarský algoritmus s přísným pořadím cílů, zámky, vyřazení, zranění, náhrady s dopadem, hloubka, dopad výpadku, rizika); čisté moduly, metodika M15 až M22 v `docs/ANALYTICS_METHODOLOGY.md` |
| `src/recruit.js`, `screens/recruit.js` | přestupový poradce: kandidáti (ručně, z tabulky), čtení cen a mezd (jen čitelné, jinak neznámé), přesný dopad příchodu, odchodu a výměny na sestavu A + B, hledání na celý tým i na místo, potřeby týmu, podobní kandidáti, jednání s platností, doporučení s výsledkem; metodika M23 až M28, zkouška 22 |
| `src/zstd.js` | vlastní dekodér zstd (RFC 8878) bez závislostí: strop výstupu, bloku, okna a počtu bloků, přísné odmítání vadných rámců; zkoušený proti libzstd (`test/zstd.test.mjs`) |
| `src/fmfcontainer.js`, `fmfglue.js`, `fmftac.js` | čtečka kontejneru `.fmf` z FM27 (rozšifrování AES-128-CTR a rozbalení zstd v zařízení, kontrolní součty, limity; `fmfglue.js` hlídá na jedno čtení souboru dva rozpočty, bloků (20 000) a výstupu (33 MiB), a to i za rámce, které selžou) a přísná čtečka **stavby** payloadu taktiky (bloky, položky, seznamy; popis v `docs/FORMAT_FMF.md`); **význam čísel** (formace, role, instrukce) zatím nečte |
| `src/screens/weights.js`, `playeranalysis.js` | správa vah DWRS v Nastavení (přednastavení, vlastní profily, porovnání); rozbor hráče v Můj tým (nejlepší a nejhorší role, silné stránky a mezery, pořadí v týmu) |
| `test/*.test.mjs` | 898 testů čistých modulů, úložiště a barev vzhledu |
| `test/e2e/` | zkoušky celé aplikace v Chromiu (22 scénářů, 908 kontrol, z toho 4 jen se skutečnými exporty), falešné `db`, generátor syntetických souborů |

## Sestavení a zkoušky

**Požadavky.** Aplikace ani sestavení nemají žádnou závislost (repozitář nemá `package.json` ani seznam balíčků; čtení `.fmf` žádnou knihovnu nepotřebuje, rozbalení zstd je vlastní modul `trener/src/zstd.js` přímo v aplikaci); zkoušky potřebují:

- **Node 22.15 nebo novější.** Zkoušky dekodéru zstd, čtečky kontejneru a čtečky stavby taktiky i generátor souborů `.fmf` pro zkoušky v prohlížeči volají `zlib.zstdCompressSync` nebo `zlib.zstdDecompressSync`, které má Node od verze 22.15.0 (podle CHANGELOG Node 22).
  Na Node bez nich zkoušky nepřeskočí, ale selžou (výjimka: jediná zkouška v `tactics.test.mjs` má ochranu a přeskočí se; ověřeno jen odebráním funkcí `zlib.zstd*`, ne na skutečném starším Node). CI používá `node-version: 22`. „Node 18+“ v hlavičce `build.mjs` platí jen pro samotné sestavení (a na skutečném Node 18 se neověřilo).
- **Python 3**: `reportlab` a písmo DejaVu Sans pro `make_fixtures.py` (skript má cestu `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` napevno; na Debianu a Ubuntu je v balíčku `fonts-dejavu-core`) a `zstandard==0.25.0` pro věštírnu libzstd
  (verze, na které se zkoušky ladily a kterou připíná CI; bez ní se porovnání s libzstd přes věštírnu přeskočí).
- **Playwright s Chromiem** a `pdfjs-dist@3.11.174` pro zkoušky v prohlížeči (příkazy níže). Playwright se nedodává s repozitářem a `e2e.cjs` ho bere přes `require('playwright')`, takže musí být vidět přes `NODE_PATH`; ani globální instalace (`npm i -g playwright`) nestačí, Node hledá moduly jen v místních adresářích `node_modules` a v `NODE_PATH`, ne v globálním adresáři npm (u globální instalace: `export NODE_PATH=$(npm root -g)`).
- **`FMF_SAMPLES_DIR`** (nepovinná proměnná): složka se skutečnými exporty `.fmf` z FM27. Jsou to soukromé soubory majitele, v repozitáři nejsou a nikdy nesmí být. Bez proměnné se zkoušky jádra se skutečnými exporty viditelně přeskočí
  a ve scénáři 21 se vynechají 4 kontroly (z 908 jich pak běží 904).

```bash
node trener/build.mjs                                   # běžné sestavení
STRICT=1 node trener/build.mjs                          # všechny moduly povinné (to běží i v nasazení)
node --test trener/test/*.test.mjs                      # 898 testů bez prohlížeče
python3 -m unittest discover -s ai_gateway/tests -t .   # shoda validátoru s Pythonem a hlídání tvarů klíčů v repu (jen v textových souborech uvedených přípon; hesla a texty knih nehlídá)
python3 -m unittest discover -s fmf_research/tests -t . # inspektor `.fmf` v Pythonu (bez balíčku `zstandard` se přeskočí)
```

**Pythonové zkoušky (`ai_gateway`, `fmf_research`) v CI neběží**, pouštějí se ručně posledními dvěma příkazy výše z kořene repozitáře (dohromady kolem sekundy). Zkoušky v prohlížeči, mutační zkoušky a zkoušky se skutečnými exporty v CI také neběží (viz část „CI na GitHubu“).

```bash
npm install --prefix /tmp/pw playwright                # balíček Playwright (v repozitáři není)
/tmp/pw/node_modules/.bin/playwright install chromium  # prohlížeč; na Linuxu případně s --with-deps (systémové knihovny)
export NODE_PATH=/tmp/pw/node_modules                  # aby ho `require('playwright')` v e2e.cjs našel (u globální instalace: export NODE_PATH=$(npm root -g))
npm install --prefix /tmp/pdfjs pdfjs-dist@3.11.174    # pdf.js se načítá místní kopií místo cdnjs
python3 trener/test/e2e/make_fixtures.py /tmp/fx
node trener/build.mjs
FIXTURES=/tmp/fx PDFJS_DIR=/tmp/pdfjs/node_modules/pdfjs-dist/build OUT=/tmp/out \
  node trener/test/e2e/e2e.cjs                         # všechny scénáře; ONLY=05,09 vybere jen některé; FMF_SAMPLES_DIR=<složka s .fmf> přidá kontroly se skutečnými exporty
```

**Úplný běh zkoušek v prohlížeči chce volný stroj.** Na vytíženém stroji může scénář 01 závodit s aplikací a selhat bez chyby v aplikaci: kontroly četly výsledek rady dřív, než se uložil a vykreslil, protože `screens/coach.js` uvolnil tlačítka hned po odpovědi
(pomocník `waitIdle` čeká jen na tlačítka). Příčina v `screens/coach.js` je odstraněná (tlačítka se uvolní až po vykreslení výsledku; hlídá to kontrola A18 ve scénáři 01, která uložení rady zpomalí a stránku přečte v prvním okamžiku, kdy jsou tlačítka volná), ale časové meze zkoušek (v Node například zastavení rámce z drahých bloků a čtení kontejneru, v prohlížeči čekání na stránku a na tlačítka)
jsou odvozené z měření na jednom stroji, takže na pomalém nebo vytíženém stroji mohou selhat i bez chyby v kódu. Selže-li jediná kontrola, pusť nejdřív samotný scénář (například `ONLY=01`) na volném stroji, než začneš hledat chybu.

Vlastní dekodér zstd se zkouší i proti libzstd (Python balíček `zstandard` jako „věštírna“, `test/fixtures/zstd_oracle.py`; interpret se bere z `ZSTD_ORACLE_PYTHON`, jinak `python3`). Bez Pythonu a balíčku se porovnávací zkoušky přeskočí: viditelně tři (dostupnost věštírny, poškozené rámce, náhodné bloky sekvencí);
ostatní zkoušky v `zstd.test.mjs`, které se libzstd ptají, proběhnou jen svými přímými kontrolami dekodéru, bez porovnání s libzstd a bez značky přeskočení. S balíčkem (ve virtuálním prostředí) běží celé.
S `ZSTD_ORACLE_REQUIRED=1` je věštírna povinná v každé zkoušce, která se jí ptá, i když zkoušku vybereš samostatně přes `--test-name-pattern`: bez fungující věštírny pak zkouška selže, místo aby se tiše přeskočila.

```bash
python3 -m venv /tmp/zv && /tmp/zv/bin/pip install zstandard==0.25.0   # verze, na které se zkoušky ladily (libzstd 1.5.7)
ZSTD_ORACLE_PYTHON=/tmp/zv/bin/python node --test trener/test/zstd.test.mjs   # ZSTD_SEED=n zkusí jiné náhodné vstupy
ZSTD_ORACLE_REQUIRED=1 ZSTD_ORACLE_PYTHON=/tmp/zv/bin/python node --test trener/test/zstd.test.mjs   # věštírna povinná: bez ní zkouška selže místo přeskočení
# delší běh proti libzstd: každé semínko je 12 000 náhodně upravených rámců, z nichž asi osmina vyjde beze změny (6. 11. 2026 prošla semínka 1 až 200; jedno semínko trvá asi 2 s)
# smyčka vybírá dvě zkoušky (dostupnost věštírny a poškozené rámce) a ohlásí semínko, které selhalo nebo se přeskočilo (bere jen výstup s `# pass 2` a `# skipped 0`); výstup nezahazuje, výstup selhaného semínka zůstane v /tmp/zstd-seed-<n>.log
for s in $(seq 1 200); do
  ZSTD_SEED=$s ZSTD_ORACLE_REQUIRED=1 ZSTD_ORACLE_PYTHON=/tmp/zv/bin/python \
    node --test --test-reporter=tap --test-name-pattern='věštírna|poškozené rámce' trener/test/zstd.test.mjs > /tmp/zstd-seed.log 2>&1 \
    && grep -qx '# pass 2' /tmp/zstd-seed.log && grep -qx '# skipped 0' /tmp/zstd-seed.log \
    || { echo "semínko $s selhalo nebo se přeskočilo (výstup: /tmp/zstd-seed-$s.log)"; cp /tmp/zstd-seed.log /tmp/zstd-seed-$s.log; }
done
```

Mutační zkoušky (kontrola, že zkoušky skutečně chytí chybu vloženou do kódu) jsou v `trener/test/mutation/` včetně návodu ([`test/mutation/README.md`](test/mutation/README.md): spuštění, `--oracle`, návratové kódy a pracovní složka `WORK`, která se na začátku maže);
seznamy mutací jsou jen pro `zstd.js`, `fmfglue.js` a `fmfcontainer.js`. Do běžných testů ani do CI nepatří, jeden běh trvá minuty až desítky minut.

Totéž s povinnou věštírnou (balíček `zstandard==0.25.0`) běží na GitHubu jako samostatná kontrola `.github/workflows/zstd-oracle.yml`; brána nasazení stránky (`pages.yml`) věštírnu výslovně vypíná (viz část „CI na GitHubu“).

Zkoušky nahrazují Claude, `db`, sdílení obrazovky, hlas a mikrofon zkušebními náhražkami (`trener/test/e2e/e2e.cjs`, `fakedb.cjs`)
a odpovědi Claude generují tak, aby se vyzkoušely kontroly poctivosti. Scénář 10 spouští samostatnou verzi na skutečném místním
serveru (service worker, offline, instalace) a vlastní klíč přes napodobeniny rozhraní Anthropic a OpenAI.

Po každé změně zdrojů je třeba znovu `node trener/build.mjs`; `dist/` není v gitu.

## CI na GitHubu

V `.github/workflows/` jsou dvě kontroly:

| Workflow | Spouští se | Co dělá |
|---|---|---|
| `pages.yml` | ručně a po `push` na `main`, který změní `trener/**`, `reference/codex-2026-11-01/**`, `ai_gateway/costs.py` nebo samotný workflow | brána před nasazením: `node --test trener/test/*.test.mjs` (Node 22, **věštírna libzstd vypnutá**: `ZSTD_ORACLE_PYTHON=/nonexistent/python`) a `STRICT=1 node trener/build.mjs`; potom nasazení na GitHub Pages |
| `zstd-oracle.yml` | ručně a po `push` na `main`, který změní `trener/src/zstd.js`, `trener/src/fmfglue.js`, `trener/test/zstd.test.mjs`, `trener/test/fixtures/zstd_*` nebo samotný workflow | Python 3.12, `pip install zstandard==0.25.0` a `ZSTD_ORACLE_REQUIRED=1 ZSTD_ORACLE_PYTHON=python node --test trener/test/zstd.test.mjs`: dekodér zstd proti libzstd s povinnou věštírnou |

- Filtr `pages.yml` obsahuje i `reference/codex-2026-11-01/**` a `ai_gateway/costs.py`, protože je čtou sestavení a zkoušky jádra: registr zdrojů (`knowledge.json`, i sestavení), plán taktiky (`takticky-plan.json`) a ceník AI v Pythonu (`costs.py`), se kterým se porovnává ceník v JavaScriptu.
- **Brána nasazení věštírnu nepoužívá.** Systémový `python3` na runneru má balíček `zstandard` v neznámé, nepřipnuté verzi a změna obrazu runneru by mohla zablokovat nasazení bez jakékoli změny v repozitáři, proto ji `pages.yml` výslovně vypíná.
  Tři porovnávací zkoušky (dostupnost věštírny, poškozené rámce, náhodné bloky sekvencí) se tam viditelně přeskočí a ostatní zkoušky, které se libzstd ptají, proběhnou jen svými přímými kontrolami dekodéru. Porovnání rozhodnutí dekodéru s libzstd přes věštírnu je v CI jen v `zstd-oracle.yml` (připnuté `zstandard==0.25.0`); brána nasazení dál rozbaluje rámce, které napsala libzstd z Node (zkoušky „shodné s libzstd“ v `zstd.test.mjs`),
  a v kontejneru srovnává vlastní dekodér s dekodérem libzstd z Node (`fmfcontainer.test.mjs`); nasazení na výsledku věštírny nezávisí.
- **Co v CI neběží:** Pythonové zkoušky (`ai_gateway`, včetně hlídání tvarů klíčů, a `fmf_research`), zkoušky v prohlížeči, mutační zkoušky a zkoušky se skutečnými exporty (`FMF_SAMPLES_DIR`). Příkazy jsou v části „Sestavení a zkoušky“.
- **Známé omezení (neopraveno):** GitHub při každém běhu varuje, že akce `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, `actions/upload-pages-artifact@v3` (v logu jmenuje `actions/upload-artifact@v4`, kterou tato akce volá) a `actions/deploy-pages@v4`
  míří na zastaralý Node.js 20 a že je runner nuceně spouští na Node.js 24. Běhy dnes procházejí, ale spoléhají na toto přechodové chování runneru. Novější hlavní verze akcí, které cílí na Node.js 24, se nepodařilo ověřit, a proto se verze nezměnily.
  Po každé změně verzí je třeba obě workflow pustit znovu a zkontrolovat, že varování zmizelo.

## Publikace

- **Stránka v Claude**: `dist/trener.fragment.html` s `capabilities: {sample: {images: true}, downloads: true, db: {}, user: {}, mcp: {servers: [{server: 'Parallel Search', tools: ['web_search']}]}}`.
  Soukromý odkaz majitele: https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh. Aktualizace stejným odkazem: načíst artefakt
  (`action: read`) a publikovat se stejným `url`.
- **Samostatná aplikace**: GitHub Pages z `dist/standalone/`, workflow `.github/workflows/pages.yml` (spouští se ručně a po změně aplikace na `main`: `trener/**`, `reference/codex-2026-11-01/**`, `ai_gateway/costs.py` nebo samotného workflow; podrobnosti v části „CI na GitHubu“).
  Pages zapnul majitel (Source: GitHub Actions) a první nasazení prošlo 5. 11. 2026: https://janvasilecko-droid.github.io/FM27-apka/

## Načíst aktuální hru

Šedé tlačítko „Načíst“ nahoře ukáže, co jde načíst z obrazovky hry (taktika, soupiska, soupeř, zápas), a vede na obrazovku, kde se to dělá. Aplikace
**nečte paměť hry ani její soubory**: čte jen to, co je vidět na obrazovce, a výsledek je vždy návrh k potvrzení. Tlačítko „Načíst z okna hry“ vezme jeden
snímek sdíleného okna (samostatná verze, nebo okno claude.ai, pokud sdílení povolí; řádek v Nastavení). Proč ne paměť, jaké nástroje existují a jaké jsou další
cesty: [`docs/NACITANI_DAT_ZE_HRY.md`](../docs/NACITANI_DAT_ZE_HRY.md). Technický audit čtyř projektů (FMMatchLens, FM Player Analyzer, FMSuperScout, FMSAT: data, algoritmy, licence, FM27, architektura, plán):
[`docs/AUDIT_ZDROJU_FM27_2026-11-05.md`](../docs/AUDIT_ZDROJU_FM27_2026-11-05.md).

Hráče jde načíst i z **tabulky, kterou uložil jiný nástroj** (CSV, TSV, webová stránka, JSON, třeba výstup čtečky uložené hry `fmsave`): karta „Načíst hráče z exportu“ v Můj tým.
Soubor se čte jen v zařízení a bez volání AI. Aplikace navrhne, co který sloupec znamená, ty to potvrdíš a můžeš změnit. **Skryté údaje hry (CA a PA, skryté atributy,
osobnost) se nenačítají.** Načtené údaje jsou „zadal uživatel (soubor od tebe)“, ne „ověřeno hrou“.

**Živá data z FMMatchLens** (samostatná verze, Windows): zásuvný modul do hry (otevřený kód, MIT) nabízí data zápasu na tomhle počítači. Karta v Live Coachi z nich skládá
časovou osu zápasu bez čtení obrazovky a bez volání AI, karta v Můj tým načte sestavu s rolemi. Aplikace volá jen tento počítač (127.0.0.1 nebo localhost) a čte jen viditelné údaje.
**Napsáno podle zdrojového kódu pluginu 0.7.x, neověřeno na běžící hře.** Graf průběhu zápasu (xG, střely, držení) kreslí časovou osu ze snímků z obrazovky i z pluginu.

**Vhodnost hráčů na role a nejlepší sestava** (Moje taktiky): klíčové a žádoucí atributy role se přečtou z obrazovky role ve hře (přepis potvrdíš a můžeš upravit) nebo se zadají ručně;
z nich aplikace spočítá vhodnost hráče na roli (vážený průměr: klíčový atribut váží 2, žádoucí 1; **chybí-li atribut, je to „nedostupné“, ne nula**), přiřadí hráče k místům taktiky
maďarským algoritmem (nejdřív co nejvíc obsazených míst, pak největší součet) a ukáže slabá místa. **Je to heuristika aplikace, ne pravidlo FM27**; profily rolí nevymýšlí, skryté údaje hry
se do nich nepouštějí, sestava se v taktice změní jen po kliknutí a AI trenér výsledek dostane jako neověřený odhad.

**Co dělat a proč** (výuka i rady): u každé změny v radě je povinné „proč“ (příčina a následek, odkaz na pozorování nebo úryvek z knihy; bez odkazu je to označené „úvaha trenéra, bez zdroje“),
u každého kroku „Konkrétního použití“ v lekci je „Co udělat“ i „Proč“ a Trenér rozhodování ukáže po tvé volbě doporučený postup, důvod, častou chybu a co sledovat dál. Rada nebo lekce bez „proč“
projde opravným kolem, ne na obrazovku. Kontrola je v JavaScriptu i v Pythonu stejná (sdílené případy).

## Co je ověřeno a co ne

Podrobně po bodech zadání v [`docs/AKCEPTACNI_MATICE.md`](../docs/AKCEPTACNI_MATICE.md). Zkráceně:

**Ověřeno automatickými zkouškami** (se zkušebními náhražkami): jednání aplikace ve všech deseti sekcích, kontroly poctivosti,
synchronizace mezi dvěma okny, import plánu, brána snímků, detektory, vyhodnocení změny před a po, hlasová pravidla, vlastní klíč
a chyby poskytovatelů, service worker a offline otevření, rozložení na telefonu, čitelnost ve světlém i tmavém vzhledu.

**Neověřeno z cloudu** (čeká na skutečné prostředí): odpovědi skutečného Claude a jak často rada projde kontrolou na první pokus; **čtení taktiky, soupisky a soupeře ze skutečné obrazovky FM27** (jazyk hry, rozložení, kolik záložek je potřeba) a „Načíst z okna hry“ na skutečném okně hry; **skutečné exporty cizích nástrojů** (návrh významu sloupců se zkoušel na vlastních ukázkách a podle dokumentace `fmsave`);
skutečné `db`, `sample` a souhlasy v artefaktu; čtení skutečných screenshotů FM27; čtení `.fmf` uvnitř okna claude.ai (kontejner a stavba taktiky jsou ověřené na třech skutečných exportech jen ve zkušebním prostředí;
**pole taktiky se nedekódují**, jejich význam čeká na snímky obrazovky hry); sdílení okna FM27 na Windows; kvalita českého hlasu; OpenAI-kompatibilní rozhraní
proti živé službě; pdf.js uvnitř omezeného okna artefaktu a čtení skutečných knih (sazba ve sloupcích, tabulky); **zda okno claude.ai povolí stránce sdílení obrazovky** (aplikace to zjistí předem a ukáže v Nastavení; pokud ano, živé čtení jede i na stránce v Claude, tedy na předplatném bez klíče); **hledání zdrojů na webu**:
skutečná odpověď konektoru Parallel Search (tvar je odhad, čtení je tolerantní) a nástroj `web_search` Anthropic volaný z prohlížeče (CORS, účtování).
Ověřeno jen se zkušebními náhražkami: že se výsledky čtou, řadí a označují poctivě (druh zdroje podle domény, starší verze FM „NENÍ FM27“,
jen https, text z webu je jen text a v promptu jen jeden řádek dat, nic z webu není `verified`) a že chyby konektoru mají srozumitelné hlášky.

**Ověřeno proti referenci:** vlastní dekodér zstd (`src/zstd.js`) se zkoušel proti libzstd 1.5.7 (Python `zstandard` 0.25.0, jeden stroj s BMI2): platné rámce úrovní 1, 3, 9, 19, 20, 21 a 22 a strategií 1 až 9, náhodně upravené rámce (12 000 na jedno semínko `ZSTD_SEED`; semínka 1 až 200, tedy 2 400 000 náhodně upravených rámců, z toho asi 12,7 % beze změny, prošla všechna), ručně sestavené Huffmanovy stromy a sekvence a tři skutečné exporty z FM27. **Popis tabulek FSE** se proti libzstd zkouší jen nepřímo (rámce, které libzstd sama napsala, a ruční případy); samostatná zkouška popisu je kruhová (vlastní zapisovač a vlastní čtečka), takže o shodě s libzstd sama nic nedokazuje.

Rozdíly proti libzstd, které jsem našel a změřil (je jich šest, každý má zkoušku; číslování je stejné jako v tabulce „Rozdíly proti libzstd“ v dokumentu revize, odkaz níže). U (1) až (5) libzstd rámec přijme a dekodér ho odmítne (dekodér je přísnější), u (6) je to naopak:

1. Odkaz dál než okno rámce, když data ještě drží ve vyrovnávací paměti (u nás kód `window`).
2. Blok větší než okno u rámce s uvedenou velikostí obsahu, pokud se ta velikost vejde do výstupní paměti volajícího (u věštírny 128 KiB; kód `blocksize`). Je to jednoprůchodová zkratka v `ZSTD_decompressStream`, tedy vlastnost rozhraní, ne rámce: při větší uvedené velikosti libzstd tentýž blok odmítne.
3. Okno nad 2^27 + 1 B při téže zkratce (kód `bigwindow`): libzstd okno nekontroluje a rámec rozbalí (v pokusu přijala okna 0x89 a 0xa8, okno 0xb8 odmítla už v hlavičce; bez uvedené velikosti obsahu nebo s velikostí 300 000 B odmítne i okno 0x89). Strop okna dekodéru, 2^27 + 1 B, je stejný jako výchozí strop libzstd na proudové cestě; zkratka ho obchází.
4. Pokažený konec čtyřproudých literálů (kód `litend`): libzstd ho nekontroluje jen tehdy, když KAŽDÝ ze čtyř proudů má aspoň 8 B **a zároveň** nejdelší kód Huffmanova stromu má nejvýš 11 bitů (strom s kratšími kódy se přepočte na tabulku o 11 bitech a jede rychlou cestou; strom s 12bitovými kódy ji nepoužije a konec kontroluje; podle zdrojového kódu navíc jen na procesoru s BMI2, bez něj se konec kontroluje vždy, což se neměřilo). Změřeno na 123 případech (nejkratší proud 5 až 13 B) bez výjimky z pravidla „nejkratší proud aspoň 8 B“, ale jen na stromu s kódy do 2 bitů; stromy s 11 a 12bitovými kódy mají pevný případ ve zkoušce shovívavostí.
5. Velikost obsahu 2^64−1: libzstd ji bere jako „neuvedeno“ a rámec rozbalí (u nás kód `corrupt`).
6. Váhy Huffmanova stromu zapsané přes FSE se symbolem 12 a víc při přesnosti 6 (92 a víc při přesnosti 5): libzstd je odmítne, protože se jí nevejdou do pracovní paměti, a dekodér je přijme (literály vyjdou přesně). Kód Huffmana dlouhý 12 bitů přijímají oba, i když RFC 8878 mluví o nejvýš 11.

U sekvencí se s libzstd shoduje (odmítá nepřečtené bity i čtení za začátek proudu, kódy `inexact` a `overread`, i nulový opakovaný posun). Náhodné poškození rámců zasáhne prakticky jen odchylku 4 (`litend`); ostatní se zkoušejí přímo a náhodná srovnávací zkouška toleruje jen kódy `window`, `blocksize` a `litend`. Dekodér navíc hlídá práci: strop výstupu, největší blok (128 KiB), okno nejvýš 2^27 + 1 B a počet bloků nejvýš ceil(povolený výstup / 1 KiB) + 16 (kód `blocks`; povolený výstup je velikost obsahu uvedená v rámci, jinak `maxOutput`, ve výchozím nastavení 16 MiB, s nímž projde až 16 400 bloků). Známé omezení: platný rámec z proudového zapisovače, který vydá víc drobných bloků, než strop dovolí, se odmítne, ale jen při stropu blízkém jeho velikosti, jak ho volá čtečka kontejneru (velikost z manifestu). Obsahový kontrolní součet zstd dekodér neověřuje (ověřuje ho čtečka kontejneru). Bez Pythonu se porovnání s libzstd přeskočí, ostatní zkoušky běží vždy. Podrobnosti a čísla: [`docs/REVIZE_FMF_2026-11-05.md`](../docs/REVIZE_FMF_2026-11-05.md).

Když něco z toho selže, aplikace to řekne: Nastavení má stav schopností a zkoušky spojení, kniha hlášení o čtení.

## Soukromí a autorská práva

Texty knih zůstávají v IndexedDB prohlížeče a v exportu, který si uložíš sám (`fm27-knihovna.json`, obsahuje texty, nikam ho nesdílej).
Do synchronizace a do zálohy dat knihy **nejdou**; lekce složené z knih zůstávají také jen v zařízení. Do Claude jde dotaz a vybrané
úryvky. Při hledání na webu jde vyhledávači jen text tvého dotazu nebo tématu a z něj odvozené výrazy (ne knihy, kariéra ani obrázky); u konektoru je to
služba třetí strany, u klíče Anthropic hledá Anthropic. Klíč AI (samostatná verze) je jen v tomhle prohlížeči: není v záloze, v synchronizaci ani v exportu. Repozitář je veřejný:
obsah knih, klíče ani osobní data nesmí do gitu, testů ani záznamů; testovací soubory jsou syntetické.

## Omezení a co dál

- Rada vychází z teorie v knihách a z toho, co jí řekneš nebo ukážeš. Názvy nastavení FM27 jsou vždy neověřené.
- Hledání je lexikální (BM25), ne sémantické. Pro velké knihovny by se hodil hostovaný index (varianta podle „Pivovarské bible“).
- Hledání na webu jede jen na pokyn (tlačítko, volba „Hledat i na webu“), ne v Live Coachi, a nic z něj není ověřené. Čtení celých stránek (`web_fetch`)
  zatím není.
- Neumí: `.fmf` pole taktiky, OCR skenů, oznámení na zavřený telefon, překryvné okno nad hrou, klienta pro Windows (viz akceptační matice).
- Možné rozšíření: nechat Claude hledat v knihách samo přes `tools` ve `sample`, hostovaná databáze se serverovým zpracováním knih.
