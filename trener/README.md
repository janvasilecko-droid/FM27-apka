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
| `src/zstd.js` | vlastní dekodér zstd (RFC 8878) bez závislostí: strop výstupu, bloku a okna, přísné odmítání vadných rámců; zkoušený proti libzstd (`test/zstd.test.mjs`) |
| `src/fmfcontainer.js`, `fmfglue.js`, `fmftac.js` | čtečka kontejneru `.fmf` z FM27 (rozšifrování AES-128-CTR a rozbalení zstd v zařízení, kontrolní součty, limity) a přísná čtečka **stavby** payloadu taktiky (bloky, položky, seznamy; popis v `docs/FORMAT_FMF.md`); **význam čísel** (formace, role, instrukce) zatím nečte |
| `src/screens/weights.js`, `playeranalysis.js` | správa vah DWRS v Nastavení (přednastavení, vlastní profily, porovnání); rozbor hráče v Můj tým (nejlepší a nejhorší role, silné stránky a mezery, pořadí v týmu) |
| `test/*.test.mjs` | 866 testů čistých modulů, úložiště a barev vzhledu |
| `test/e2e/` | zkoušky celé aplikace v Chromiu (22 scénářů, 896 kontrol), falešné `db`, generátor syntetických souborů |

## Sestavení a zkoušky

```bash
node trener/build.mjs                                  # běžné sestavení
STRICT=1 node trener/build.mjs                         # všechny moduly povinné (to běží i v nasazení)
node --test trener/test/*.test.mjs                     # 866 testů bez prohlížeče
python3 -m unittest discover -s ai_gateway/tests -t .  # shoda validátoru s Pythonem a hlídání klíčů v repu
```

Zkoušky v prohlížeči potřebují Playwright s Chromiem, `reportlab` a `pdfjs-dist@3.11.174` (pdf.js se načítá místní kopií místo cdnjs).
Čtení `.fmf` žádnou knihovnu nepotřebuje: rozbalení zstd je vlastní modul `trener/src/zstd.js` přímo v aplikaci.

```bash
npm install --prefix /tmp/pdfjs pdfjs-dist@3.11.174
python3 trener/test/e2e/make_fixtures.py /tmp/fx
node trener/build.mjs
FIXTURES=/tmp/fx PDFJS_DIR=/tmp/pdfjs/node_modules/pdfjs-dist/build OUT=/tmp/out \
  node trener/test/e2e/e2e.cjs                         # všechny scénáře; ONLY=05,09 vybere jen některé
```

Vlastní dekodér zstd se zkouší i proti libzstd. Bez Pythonu se tyhle porovnávací zkoušky přeskočí; s ním (balíček `zstandard` ve virtuálním prostředí) běží celé:

```bash
python3 -m venv /tmp/zv && /tmp/zv/bin/pip install zstandard
ZSTD_ORACLE_PYTHON=/tmp/zv/bin/python node --test trener/test/zstd.test.mjs   # ZSTD_SEED=n zkusí jiné náhodné vstupy
```

Zkoušky nahrazují Claude, `db`, sdílení obrazovky, hlas a mikrofon zkušebními náhražkami (`trener/test/e2e/e2e.cjs`, `fakedb.cjs`)
a odpovědi Claude generují tak, aby se vyzkoušely kontroly poctivosti. Scénář 10 spouští samostatnou verzi na skutečném místním
serveru (service worker, offline, instalace) a vlastní klíč přes napodobeniny rozhraní Anthropic a OpenAI.

Po každé změně zdrojů je třeba znovu `node trener/build.mjs`; `dist/` není v gitu.

## Publikace

- **Stránka v Claude**: `dist/trener.fragment.html` s `capabilities: {sample: {images: true}, downloads: true, db: {}, user: {}, mcp: {servers: [{server: 'Parallel Search', tools: ['web_search']}]}}`.
  Soukromý odkaz majitele: https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh. Aktualizace stejným odkazem: načíst artefakt
  (`action: read`) a publikovat se stejným `url`.
- **Samostatná aplikace**: GitHub Pages z `dist/standalone/`, workflow `.github/workflows/pages.yml` (spouští se ručně a po každé změně aplikace na `main`).
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

**Ověřeno proti referenci:** vlastní dekodér zstd (`src/zstd.js`) se zkoušel proti libzstd (Python `zstandard`): platné rámce všech úrovní a strategií, více než milion náhodně poškozených rámců, ručně sestavené Huffmanovy stromy a sekvence, popis tabulek FSE a tři skutečné exporty z FM27. Libzstd (zkoušeno verze 1.5.7) je v některých případech vstřícnější: nekontroluje konec proudů bitů a přijme odkaz dál než okno rámce; dekodér je v těchto případech přísnější a každý takový případ má vlastní kód chyby (`litend`, `overread`, `window`). Obsahový kontrolní součet zstd dekodér neověřuje (ověřuje ho čtečka kontejneru). Bez Pythonu se porovnání s libzstd přeskočí, ostatní zkoušky běží vždy.

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
