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
| `src/tactics.js`, `analysis.js`, `school.js`, `providers.js`, `alerts.js`, `opponent.js`, `report.js`, `labexplain.js`, `fmfglue.js` | čisté moduly bez DOM (UMD), běží v prohlížeči i v Node |
| `src/store.js` | místní úložiště a zrcadlení do `db` (poslední zápis vyhrává, náhrobky, limit 240 kB na dokument) |
| `src/ui.js`, `app.js`, `library.js`, `ai.js`, `context.js`, `advice.js`, `live.js`, `voice.js`, `widgets.js` | rozhraní a napojení na prohlížeč |
| `src/screens/*.js` | jedna obrazovka na soubor; `zz_stubs.js` zachytí sekci bez obrazovky a poctivě řekne, že není hotová |
| `src/standalone.js`, `standalone/` | jen samostatná verze: service worker, manifest, ikony, nabídka instalace |
| `build.mjs` | slepí vše do `dist/trener.fragment.html` (publikuje se), `dist/trener.test.html` (zkoušky) a `dist/standalone/` (nasazení na Pages) |
| `test/*.test.mjs` | 558 testů čistých modulů a úložiště |
| `test/e2e/` | zkoušky celé aplikace v Chromiu (14 scénářů, 588 kontrol), falešné `db`, generátor syntetických souborů |

## Sestavení a zkoušky

```bash
node trener/build.mjs                                  # běžné sestavení
STRICT=1 node trener/build.mjs                         # všechny moduly povinné (to běží i v nasazení)
node --test trener/test/*.test.mjs                     # 558 testů bez prohlížeče
python3 -m unittest discover -s ai_gateway/tests -t .  # shoda validátoru s Pythonem a hlídání klíčů v repu
```

Zkoušky v prohlížeči potřebují Playwright s Chromiem, `reportlab`, `pdfjs-dist@3.11.174` (pdf.js se načítá místní kopií místo cdnjs)
a `fzstd@0.1.1` (čtení `.fmf`):

```bash
npm install --prefix /tmp/pdfjs pdfjs-dist@3.11.174 fzstd@0.1.1
python3 trener/test/e2e/make_fixtures.py /tmp/fx
node trener/build.mjs
FIXTURES=/tmp/fx PDFJS_DIR=/tmp/pdfjs/node_modules/pdfjs-dist/build FZSTD_DIR=/tmp/pdfjs/node_modules OUT=/tmp/out \
  node trener/test/e2e/e2e.cjs                         # všechny scénáře; ONLY=05,09 vybere jen některé
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
cesty: [`docs/NACITANI_DAT_ZE_HRY.md`](../docs/NACITANI_DAT_ZE_HRY.md).

## Co je ověřeno a co ne

Podrobně po bodech zadání v [`docs/AKCEPTACNI_MATICE.md`](../docs/AKCEPTACNI_MATICE.md). Zkráceně:

**Ověřeno automatickými zkouškami** (se zkušebními náhražkami): jednání aplikace ve všech deseti sekcích, kontroly poctivosti,
synchronizace mezi dvěma okny, import plánu, brána snímků, detektory, vyhodnocení změny před a po, hlasová pravidla, vlastní klíč
a chyby poskytovatelů, service worker a offline otevření, rozložení na telefonu, čitelnost ve světlém i tmavém vzhledu.

**Neověřeno z cloudu** (čeká na skutečné prostředí): odpovědi skutečného Claude a jak často rada projde kontrolou na první pokus; **čtení taktiky, soupisky a soupeře ze skutečné obrazovky FM27** (jazyk hry, rozložení, kolik záložek je potřeba) a „Načíst z okna hry“ na skutečném okně hry;
skutečné `db`, `sample` a souhlasy v artefaktu; čtení skutečných screenshotů FM27; skutečný export `.fmf` (pole taktiky se
**nedekódují**, aplikace čte jen kontejner); sdílení okna FM27 na Windows; kvalita českého hlasu; OpenAI-kompatibilní rozhraní
proti živé službě; pdf.js uvnitř omezeného okna artefaktu a čtení skutečných knih (sazba ve sloupcích, tabulky); **zda okno claude.ai povolí stránce sdílení obrazovky** (aplikace to zjistí předem a ukáže v Nastavení; pokud ano, živé čtení jede i na stránce v Claude, tedy na předplatném bez klíče); **hledání zdrojů na webu**:
skutečná odpověď konektoru Parallel Search (tvar je odhad, čtení je tolerantní) a nástroj `web_search` Anthropic volaný z prohlížeče (CORS, účtování).
Ověřeno jen se zkušebními náhražkami: že se výsledky čtou, řadí a označují poctivě (druh zdroje podle domény, starší verze FM „NENÍ FM27“,
jen https, text z webu je jen text a v promptu jen jeden řádek dat, nic z webu není `verified`) a že chyby konektoru mají srozumitelné hlášky.

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
