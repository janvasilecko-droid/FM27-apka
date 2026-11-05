# Analýza referenčních projektů (stav k 5. 11. 2026)

Zadání majitele (zadávací dokument „MASTER PROMPT – rozšíření FM27 Tactical Coach podle nejlepších existujících analytických aplikací“, 5. 11. 2026): prozkoumat šest projektů,
pochopit jejich funkce, výpočty, datové modely a rozhodovací postupy a **převzít technické principy**, ne vzhled. Nepředstírat znalost nezveřejněných algoritmů, u open-source
ověřit licenci, bez povolení licence psát vlastní řešení podle veřejně popsaných principů.

Tenhle dokument je první výstup (etapa 1). Navazují `ANALYTICS_METHODOLOGY.md` (registr výpočtů se štítky) a `PLAN_ROZSIRENI.md` (audit aplikace, architektura, etapy, rizika, licence).
Starší, podrobnější audit čtyř zdrojových projektů (FMMatchLens, FM Player Analyzer, FMSuperScout, FMSAT) je v `AUDIT_ZDROJU_FM27_2026-11-05.md`; tady se neopakuje, jen doplňuje.

**Jak je dokument poctivý.** U každého tvrzení je zdroj důkazu: **ČTENÍ ZDROJE** (četl jsem kód; kód jsem nespouštěl, takže chování je z čtení, ne z měření),
**DOKUMENTACE** (veřejný text projektu) nebo **NEZVEŘEJNĚNO** (nevím, nehádám). Nic z cizích projektů jsem neověřoval na běžícím FM27.
Klony jsou mělké (jeden commit), proto neznám historii ani aktivitu projektů.

## 0. Přehled a licence

| # | Projekt | Druh | Zdroj dostupný? | Licence | Co smíme |
|---|---|---|---|---|---|
| 1 | **FM AI Assistent** (JelmerBouma1985, verze 2.1.0-SNAPSHOT, 30. 10. 2026) | Java 25 + Spring Boot + Vaadin, čte paměť hry, MCP nástroje pro AI | ano | **`"license": "UNLICENSED"`** v `package.json`, soubor LICENSE chybí | **Nic nekopírovat** (kód, tabulky, texty). Smí se studovat a psát vlastní řešení podle popsaných principů. |
| 2 | **FMMatchLens** (osnsyc, 0.7.1, 3. 11. 2026) | plugin BepInEx (C#) + webový přehled (TypeScript) | ano | **MIT** | Kód lze převzít s oznámením o autorských právech. Dosud jsem kód nepřebral, jen formát a principy. |
| 3 | **FM Player Analyzer** (ElectroHugin, 2.0.4, 2. 11. 2026) | C++/Qt, importuje exporty z FM View Exporteru | ano | **GPL-3.0** | Metody a matematika ano. Kód a datové tabulky ne (copyleft by vztáhl GPL na celou aplikaci). |
| 4 | **FM Scout Tactic Analyser** (fmscout.com/tac) | webový nástroj, čte soubor taktiky `.fmf` | ne | nezveřejněna, obecné podmínky webu | Jen veřejně popsané funkce jako inspiraci. |
| 5 | **AssMan.AI** (assman.ai, John Brawner, 2nd Foundry) | webová aplikace, screenshot → LLM | ne | vlastnická (podmínky webu) | Jen veřejně popsané funkce jako inspiraci. |
| 6 | **FM Companion Tactic Lab** (fmcompanion.com/tactic-lab) | webový nástroj | ne | neznámá | **Nelze zjistit** (viz níž). |

## 1. FM AI Assistent (UNLICENSED)

1. **Funkce.** Čte načtenou hru FM27 přímo z paměti procesu (Windows, Linux); prohlížení a porovnání hráčů, štábu, klubů a soutěží; AI chat (Codex, Antigravity, GitHub Copilot, OpenRouter) s nástroji MCP;
   kontext: řízený klub a exportovaná taktika `.fmf` (obě fáze hry); zápis souboru shortlistu `.fmf` do složky hry; databáze doporučení (náborová tabule). DOKUMENTACE + ČTENÍ ZDROJE.
2. **Vstupy.** Paměť běžícího FM27 (snímek se po kliknutí „Load data“ uloží do místní H2 databáze); soubor taktiky `.fmf` (z disku nebo nahraný). Tvrzení o čtení paměti jsou ČTENÍ ZDROJE (balíky `memory`, `linux`, `windows`, `exporter`), nezkoušel jsem je.
3. **Výstupy.** Odpovědi nástrojů MCP: rozbor kádru, optimalizovaná sestava, náborové priority, srovnání hráčů, náhrady, plán přestupů, shortlist.
4. **Algoritmy** (ČTENÍ ZDROJE, soubory `decision/RoleFitService`, `decision/LineupOptimizerService`, `mcp/FmDecisionTools`):
   - **Vhodnost na roli:** vážený průměr atributů hráče (0 až 20), váha 2 u „primárních“ atributů role, jinak 1. Tabulka atributů rolí je v jejich databázi (data; nepřebíráme).
   - **Vhodnost na místo taktiky (dvě fáze):** průměr vhodnosti pro roli s míčem a bez míče; celkové skóre = 35 % ohodnocení pozice + 45 % ohodnocení role + 20 % min(1, CA/200). **CA je skrytý údaj hry**; u nás nepřípustné.
   - **Životaschopný hráč:** ohodnocení pozice aspoň 15 ve všech přítomných fázích.
   - **Sestava:** přesné přiřazení (maďarský algoritmus s „prázdnými sloupci“ pro záměrně neobsazená místa), tajbrejk CA a identifikátor; zámky (hráč pevně na místě), vyřazení hráčů, zranění a reprezentační pauza jako filtry; **alternativy** po místech s příznakem „rozbije jiné místo“; **úzká místa** = obsazení pod 70 nebo neobsazeno.
   - **Hloubka kádru:** pokrytí místa „zdravé / tenké / díra“ podle počtu životaschopných hráčů (≥ 2, 1, 0), zvlášť s ohledem na zranění; priority náboru; rizika smluv (horizont 12 měsíců), věk od 30, mládež (PA − CA ≥ 15, **skryté údaje**).
   - **Podobnost hráčů:** 100 × (1 − Σ w·|a − b| / (Σ w · 19)) přes atributy role.
   - **Skóre rozhodnutí a náhrady** (váhy 0,55/0,25/0,10/0,10, resp. 0,50/0,20/0,15/0,10/0,05) stojí z velké části na skrytých CA a PA a na ceně; **nepřebíráme**.
   - **Plán přesunů:** kádr před a po (odchozí pryč, příchozí navíc), sestava před/po, rozdíl součtu, změny v základu; **neznámá cena a mzda zůstávají neznámé, ne nula**.
   - **Důkazy v náborové tabuli:** záznam zájmu a fáze jednání s platností (30 herních dní), zastaralé důkazy nepřebíjejí rozhodnutí.
5. **Veřejně doložené vzorce.** Webová stránka funkce taktiky (fmaiassistant.com/features/tactics) a stránky „how it works“ a „privacy“ **nepopisují žádný vzorec, váhu ani práh** (DOKUMENTACE). Vzorce výše jsou jen z kódu.
6. **Co lze zjistit ze zdroje.** Viz bod 4 a zdroj. Je tu 381 souborů; mám přečtené jen výpočetní jádro (role, sestava, rozbor kádru, srovnání, náhrady, plán přesunů), ne dekodér taktiky (`tactic/FmTacticDecoder`, 609 řádků) ani čtení paměti.
7. **Popsáno bez známého algoritmu.** Dekódování `.fmf` do rolí a instrukcí (zdroj je, ale nečtu ho a bez licence ho nelze převzít); odhad ochoty hráče k přestupu („estimated willingness“, váhy neznám).
8. **Lze převzít jako princip.** Společná optimalizace přiřazení místo řazení podle hodnocení; hráč nanejvýš jednou; zámky a vyřazení; alternativy s cenou za rozbití jiného místa; priority náboru z hloubky a z úzkých míst; **simulace příchodu a odchodu hráče s přepočtem sestavy**; neznámé zůstává neznámé; každá odpověď nese identitu dat (otisk taktiky, čas snímku).
9. **Implementovat jinak.** Bez CA, PA, reputace, ochoty a ceny z paměti: jen viditelné atributy, role z obrazovky hry a údaje, které zadá uživatel (cena a mzda jako UNKNOWN, dokud je nezadá). Rozbor kádru podle viditelných pozic. Práh „70“ a „15“ jsou jejich konstanty; naše se musí označit jako vlastní a upravitelné.
10. **Ověření správnosti.** U sestavy: shoda s hrubou silou na malých instancích (už děláme); u simulace přestupu: po přidání hráče součet nikdy neklesne a změna je vysvětlitelná změnami v základu; u neznámé ceny: nikdy nula.

## 2. FMMatchLens (MIT)

1. **Funkce.** Plugin do hry čte živá data zápasu; webový přehled ukazuje časovou osu, momentum, xG, formace a události, **tepelné mapy hráčů**, mapu přihrávek, ovládání prostoru; archivy `.fmlens`. DOKUMENTACE (README) + ČTENÍ ZDROJE.
2. **Vstupy.** Čtení paměti hry jen pro čtení (Windows, Steam; FM27 podle CHANGELOGu 0.7.x), HTTP a WebSocket na `127.0.0.1:16726`: `/api/health`, `/api/match/meta`, `/api/match/current`, `/api/match/frames?fromTick&stride&limit`, `/api/match/formation/history`.
3. **Výstupy.** Snímky po tikách (polohy hráčů, držení, statistiky týmů, hodnocení), události (typ, hráč, příjemce, souřadnice, trajektorie, příznaky), momentum, soubor `.fmlens`.
4. **Algoritmy** (ČTENÍ ZDROJE `frontend/src/api/heatmap.ts`, `passMap.ts`, `components/heatmap/*`):
   - **Tepelná mapa:** mřížka **40 × 60** buněk; poloha hráče z každého snímku se rozloží **bilineárně** do čtyř sousedních buněk; rozsahy **celý zápas / poločas / posledních 15 minut**; fáze **vše / s míčem / bez míče**; rozsah **tým nebo hráč**; vykreslení s tónovým mapováním (gamma 1,2 pro barvu, 0,7 pro průhlednost) a rozostřením v rendereru.
   - **Mapa přihrávek:** uzly = hráči (průměrná poloha, počet pokusů, dokončené přihrávky, úspěšnost), hrany = přihrávající → přijímající s četností a prahy četnosti (4 úrovně); standardní situace se vylučují; filtr podle časového rozsahu a hráčů na hřišti. Události (`TacticalEventPoint`) frontend skládá z položek, které posílá plugin (`RealtimeMomentumEvent`: nativní typ události, hráč, příjemce, souřadnice, příznaky); typy 6 až 11 se berou jako přihrávky.
   - **Ovládání prostoru:** Gaussovo pole; konstanty nedoložené.
   - **Rozpad hodnocení hráče:** 38 tabulek vah, jde o odhad autora, jen syntetické testy.
   - **xG:** čte se ze hry (ověřeno ve zdroji pluginu), nepočítá se.
5. **Veřejně doložené vzorce.** README popisuje funkce, ne vzorce. Konstanty výše jsou z kódu.
6. **Ze zdroje lze zjistit** tvar API a událostí a derivace. Nezkoumal jsem celý plugin v C# (čtení paměti).
7. **Popsáno bez známého algoritmu.** Přesné normalizování hustoty (ochrana proti extrémům) a konstanty ovládání prostoru jsem nezkoumal; nebudu je tvrdit.
8. **Převzít jako princip.** Tepelná mapa z **vlastních prostorových vzorků** (nikdy z vymyšlených poloh), bilineární rozložení, časová okna a filtr fáze; mapa přihrávek z událostí s příjemcem; archiv zápasu k přehrání; vždy stavět na datech pluginu, ne na odhadu z obrazovky.
9. **Implementovat jinak.** Naše aplikace dnes čte jen agregované snímky (`/api/match/current`) a metadata. Pro tepelné mapy a síť přihrávek je potřeba **číst i `/api/match/frames` a události**, což **jsem proti skutečnému pluginu neověřil**; nejdřív ověřit tvar odpovědí na tvých `.fmlens` souborech a skutečném pluginu. Bez pluginu: přibližné polohy ze screenshotů označit přesností (jen hrubě; vzorků málo).
10. **Ověření správnosti.** Heatmapa: součet hustoty = počet vzorků (zachování hmoty), prázdná data → prázdná mapa, časové filtry, odolnost proti extrémům; pass map: součet hran = počet přihrávek, uzel bez přihrávek se nekreslí.

## 3. FM Player Analyzer (GPL-3.0)

1. **Funkce.** Import exportů z FM View Exporteru; hodnocení hráčů na role (DWRS); nejlepší sestava a B-tým; hloubka a slabá místa; poradce posil; talent mládeže; poradce tréninku; registrace do soutěží; reprezentace. DOKUMENTACE + ČTENÍ ZDROJE.
2. **Vstupy.** CSV a HTML z FM View Exporteru (viditelné atributy a údaje; hru nečte).
3. **Výstupy.** Tabulky a hřiště (základ, B-tým, zálohy), DWRS po rolích, doporučení posil s dopadem na sestavu, přehledy kádru.
4. **Algoritmy** (ČTENÍ ZDROJE `core/DwrsEngine`, `AttributeTiers`, `SquadBuilder`, `Assignment`, `MinCostFlow`, `SigningAdvisor`):
   - **DWRS (Dynamic Weighted Role Score):** pro každou roli jsou atributy v tabulce kategorií důležitosti (pro brankáře jiná tabulka); atribut se **vynásobí násobičem role** (klíčový 1,5, žádoucí 1,2, jinak 1,0), v každé kategorii se **zprůměrují** a průměry se sečtou s **vahami kategorií** (hráči z pole 8 / 4 / 2 / 1 / 0,2: Extremely Important / Important / Good / Decent / Almost Irrelevant). Výsledek se přepočte na **0 až 100 mezi teoretickým minimem (všechny atributy 1) a maximem (všechny 20) při stejném vážení**. Tabulku autor sám označuje za **předpoklad z FM24, dokud se nezkouší engine**, a seznam má 25 atributů (chybí např. Heading, Crossing, Aggression, Bravery, Flair, Leadership, Corners). Chybějící hodnoty se čtou jako 0 (README tvrdí opak).
   - **Model brankáře:** samostatné skupiny (13 atributů); autor uvádí, že je odvodil **z ročních statistik 335 brankářů FM24** (zabráněné xG na 90 minut, atributy očištěné o celkovou úroveň) s korelací 0,58 proti 0,43 u staršího schématu. Neověřeno mnou.
   - **Základní sestava a B-tým společně:** přesné přiřazení (maďarský algoritmus / min-cost flow, celočíselné náklady), **přísné pořadí cílů: (1) co nejvíc obsazených míst základu, (2) největší součet základu, (3) co nejvíc míst B-týmu, (4) největší součet B-týmu**; skóre = DWRS × váha herního času × bonus přirozené pozice.
   - **Dvě fáze hry:** hráč dostane jedno místo v sestavě s míčem a jedno bez míče; hodnota = podíl_s_míčem × skóre(role s míčem) + (1 − podíl) × skóre(role bez míče); přesné min-cost flow; B-tým z těch, kdo zbyli; ruční „mosty“.
   - **Poradce posil:** pro každé místo vezme několik nejlepších hráčů z trhu, **každého přidá do kádru a přepočítá základ a B-tým přesně**; přínos = změna součtu DWRS základu (vedlejší efekty se započtou). Neznámý herní čas příchozího se simuluje bez něj.
   - **Trénink:** okamžitý přírůstek DWRS na +1 bod atributu je v lineárním modelu konstantní, tedy přesná mezní hodnota tréninku.
5. **Veřejně doložené vzorce.** Komentáře ve zdroji a dokumentace popisují metodu (výše). Tabulka kategorií je data pod GPL.
6. **Ze zdroje lze zjistit** vše výše; tabulky rolí a registrací jsou data.
7. **Bez známého algoritmu.** Vzorec talentu mládeže a okna tréninku („komunitní zkušenost“), pravidla registrace (konstanty z autorových snímků).
8. **Převzít jako princip.** DWRS (kategorie × násobiče × normalizace 0 až 100), přesné přiřazení se **striktním pořadím cílů** pro základ a B-tým, hloubka po rolích, simulace příchodu hráče, mezní hodnota tréninku, dvě fáze s podílem.
9. **Implementovat jinak.** Vlastní tabulka kategorií (označená **ODHAD**, upravitelná, s přednastaveními), vlastní model brankáře, **chybějící atribut = neznámý (pokrytí váhy), nikdy nula**, role z obrazovky role ve hře, ne z cizí tabulky.
10. **Ověření správnosti.** DWRS: pravidlo normalizace (všechno 1 → 0, všechno 20 → 100), násobiče, kategorie, chybějící atributy, extrémy; sestava: shoda s hrubou silou, hráč nanejvýš jednou, pořadí cílů (A před B), omezení dostupnosti.

## 4. FM Scout Tactic Analyser (fmscout.com/tac)

Stránky načetla pomocná čtečka (DOKUMENTACE); kód nástroje neznáme.

1. **Funkce.** Čte soubor taktiky `.fmf`; ukazuje tvar taktiky s míčem i bez něj, co každá instrukce mění, **místa, kde si taktika odporuje**, čtyři skóre a „nejbližší z 28 herních stylů“ (s poznámkou, že to neznamená, že taktika styl používá). FM26 a FM27; starší verze nepodporuje.
2. **Vstupy.** Nahraný soubor `.fmf` (Documents › Sports Interactive › Football Manager 27 › tactics). Ruční zadání ani screenshot nejsou zmíněny. Vyžaduje bezplatný účet, 20 analýz denně.
3. **Výstupy.** Přehled taktiky, „Findings“ (např. instrukce, které „cost more than they give“), čtyři skóre (názvy ani váhy nezveřejněny), tabulka týmových instrukcí s filtrem „Changed vs preset“.
4. **Algoritmy.** **NEZVEŘEJNĚNO.** Stránka výslovně říká, že nástroj „does not play matches“ a nehádá výsledky.
5. **Doložené vzorce.** Žádné.
6. **Ze zdroje.** Není dostupný.
7. **Bez známého algoritmu.** Všechno: pravidla nálezů, čtyři skóre, 28 stylů.
8. **Převzít jako princip.** Pojmy, ne výpočty: odděleně s míčem a bez míče; **filtr „co se liší od předvolby“**; **nálezy jako rozpory s vysvětlením**; „nejbližší styl“ jen jako popis. A hlavně: poctivé „nehraje zápasy“.
9. **Implementovat jinak.** Vlastní pravidla (viz `PLAN_ROZSIRENI.md`, etapa 4) se sedmi poli (název, podmínka, závažnost, vysvětlení, příklad, řešení, vedlejší účinky), s označením **VLASTNÍ MODEL**; čtyři vlastní skóre s vysvětleným výpočtem.
10. **Ověření správnosti.** Testovací taktiky s úmyslnými rozpory (musí se najít) a neobvyklé, ale správné taktiky (nesmí se označit za chybné).

## 5. AssMan.AI (assman.ai)

1. **Funkce.** Rozbor taktiky ze **screenshotu** velkým jazykovým modelem („prompted to behave like a real assistant manager“) a chat; čtyři oblasti: tvar, slučitelnost rolí, **rozpory instrukcí**, vhodnost mentality; sekce hráčů; výuka. **Podporované verze: FM24 a FM26** (FM27 nezmíněno). DOKUMENTACE.
2. **Vstupy.** Jen nahrané screenshoty (PNG/JPG/WebP do 5 MB).
3. **Výstupy.** Strukturovaná analýza a odpovědi v chatu.
4. **Algoritmy.** **NEZVEŘEJNĚNO** (prompt ani pravidla). Autor píše, že průvodce vychází z jím vedeného referenčního dokumentu FM26 (nezveřejněn).
5. **Doložené vzorce.** Žádné. **Přesnost:** bez měření; podmínky odmítají záruky.
6. **Ze zdroje.** Není dostupný. Stránky: bezplatná beta, volitelné přihlášení Google; nahrané obrázky „zpracovány dočasně“, současně se na hlavní stránce zobrazují veřejné adresy obrázků (rozpor, který stránky nevysvětlují).
7. **Bez známého algoritmu.** Všechno.
8. **Převzít jako princip.** **Čtyři osy rozboru** (tvar, role, rozpory instrukcí, mentalita) jako osnova výstupu; screenshot jako vstup; chat pro doplňující otázky; „proč“ u rolí a instrukcí. To už naše aplikace z velké části dělá (čtení taktiky ze screenshotu, rada s „proč“).
9. **Implementovat jinak.** Naše rady jsou ukotvené v dodaných datech a **kontrolou poctivosti** (úroveň důkazu, odkazy), ne volným výstupem modelu; taktika se hodnotí deterministickými pravidly (etapa 4) a model jen vysvětluje.
10. **Ověření správnosti.** Stejné jako u rad: žádná smyšlená čísla, každé tvrzení s odkazem, přiznání, že údaje chybí.

## 6. FM Companion Tactic Lab (fmcompanion.com/tactic-lab)

Stránka vrátila jen název („FM Companion – AI-Powered Tools for Football Manager Success“); obsah se vykresluje skriptem v prohlížeči a čtečka stránek skripty nespouští.
**Všech deset bodů: NELZE ZJISTIT.** Skripty cizího webu jsem **nečetl ani nezpětně analyzoval** (podmínky použití a to, že nic nezveřejňuje). Pokud majitel pošle text stránky nebo screenshot, doplním to.

## 7. Srovnávací tabulka

| Schopnost | FM AI Assistent | FMMatchLens | FM Player Analyzer | FM Scout Tactic Analyser | AssMan.AI | FM Companion Tactic Lab | Naše aplikace dnes |
|---|---|---|---|---|---|---|---|
| Zdroj dat | paměť hry, `.fmf` | paměť hry (plugin) | exporty tabulek | soubor `.fmf` | screenshot | nelze zjistit | snímek, export, plugin (agregáty), ruční zadání |
| Hodnocení hráče na roli | vážený průměr (váhy 2/1), se skrytým CA | rozpad hodnocení (odhad) | **DWRS** | ne | nezveřejněno | nelze zjistit | **vážený průměr z profilu role z obrazovky** (2/1) |
| Optimální sestava | **maďarský**, zámky, alternativy | ne | **maďarský / flow, A + B** | ne | ne | nelze zjistit | **maďarský** (jedna role na místo), bez B |
| Dvě fáze hry | **ano** (sloty mají obě role) | role obou fází čte | **ano** (min-cost flow) | **ano** (zobrazení) | ne | nelze zjistit | **ne** (laboratoř kreslí obě fáze, role jen jedna) |
| Rozbor kádru a náborové priority | **ano** | ne | **ano** | ne | ne | nelze zjistit | slabá místa; hloubka ne |
| Simulace příchodu/odchodu | **ano** | ne | **ano** | ne | ne | nelze zjistit | **ne** |
| Hodnocení taktiky a rozporů | ne | ne | ne | **ano** (nezveřejněno jak) | **ano** (LLM) | nelze zjistit | geometrické prahy v laboratoři; rozpory instrukcí ne |
| Živá data zápasu | ne | **ano** | ne | ne | ne | nelze zjistit | **ano** (agregáty), detektory, rada |
| Tepelné mapy, síť přihrávek, mapa střel | ne | **ano** | ne | ne | ne | nelze zjistit | **ne** |
| xG | ne | **čte ze hry** | ne | ne | ne | nelze zjistit | čte ze hry, vlastní model **ne** |
| Paměť kariéry | **ano** (taktika, náborová tabule) | archiv zápasů | ne | uložené analýzy | uložené analýzy | nelze zjistit | **ano** (kariéry, zápasy, paměť) |
| Výuka | ne | ne | ne | ne | **ano** (průvodce) | nelze zjistit | **ano** (28 lekcí, scénáře) |
| Kontrola poctivosti odpovědí AI | částečně (neznámé zůstává) | – | – | – | ne | nelze zjistit | **ano** (úrovně důkazů, odkazy) |

## 8. Co převzít a co vyvinout

**Převzít jako princip (s vlastním kódem a vlastními daty):**
DWRS (kategorie × násobiče × normalizace), přesné přiřazení se striktním pořadím cílů a B-týmem, zámky a vyřazení, alternativy s cenou za rozbití, simulace příchodu a odchodu hráče, dvě fáze s podílem, rozdělení hloubky na zdravá/tenká/díra, mezní hodnota tréninku, tepelná mapa z vlastních vzorků (40 × 60, bilineárně, časová okna, filtr fáze), síť přihrávek z událostí s příjemcem, filtr „co se liší od předvolby“, nálezy jako rozpory s vysvětlením, neznámé zůstává neznámé.

**Vyvinout sami (v žádném z projektů to není, nebo je to nezveřejněné):**
hodnocení taktiky a rozporů s vysvětlením (sedm polí u pravidla), čtyři skóre taktiky s vysvětleným výpočtem, příčina proti projevu v AI trenérovi (diagnostika z dat), sledování výsledku doporučení, paměť doporučení a jejich úspěšnosti, vlastní model xG označený MODEL (jen když budou prostorová data), výuka s oddělením ověřené mechaniky, fotbalových principů, komunitní zkušenosti a hypotézy.

**Nepřebíráme:** skrytá data (CA, PA, reputace, osobnost), ceny a ochotu odhadnuté z paměti, registrace do soutěží, talent mládeže bez zdroje, cizí tabulky rolí a vah, kód z projektů bez licence nebo pod GPL.

## 9. Co jsem neověřil

- Nic z cizích projektů jsem nespouštěl; vše je čtením zdroje nebo veřejného textu.
- FM27 jsem neměl k dispozici; tvar dat FMMatchLens (včetně `/api/match/frames` a událostí) a formáty `.fmf` nejsou ověřeny na skutečné hře.
- FM Companion Tactic Lab se nepodařilo přečíst.
- Veřejné tvrzení FM Player Analyzer o korelaci modelu brankářů (0,58 proti 0,43) je tvrzení autora, ne moje měření.
