# Akceptační matice (zadání § 17)

Stav k 5. 11. 2026. Zadání říká: „Projekt není dokončen, dokud nebude možné prokázat následující“ a „všechny zásadní funkce
musí mít automatizované testy **a praktické ověření**“. Automatizované testy jsou hotové. **Praktické ověření na skutečných věcech
(Claude, FM27, okno hry, telefon) z cloudu udělat nejde**, proto u každého bodu stojí zvlášť, co je ověřené a co ne.

Značení:

- **Ověřeno v simulaci**: prošlo automatickou zkouškou v prohlížeči (Chromium, Playwright), ve které Claude, synchronizované úložiště
  `db`, sdílení obrazovky a hlas zastupují zkušební náhražky. Zkouška dokazuje, že aplikace jedná správně, když dostane takovou odpověď.
  Nedokazuje, že skutečná služba odpoví stejně.
- **Čeká na tebe**: jde ověřit jen na tvém zařízení, s tvými knihami nebo se skutečným FM27.
- **Neumí**: funkce v aplikaci není (a je to řečeno otevřeně).

## 1. Patnáct akceptačních testů

| # | Požadavek | Stav | Co je ověřené (zkouška) | Co ověřené není | Co udělat |
|---|---|---|---|---|---|
| 1 | Přihlášení na počítači i telefonu | **Ověřeno v simulaci** (stránka v Claude) | Stránka v Claude pozná uživatele (`user`) a data ukládá do jeho soukromé části (`data/users/<id>`). Zkouška 02: dvě okna (počítač a telefon) stejného účtu se vidí; jiný účet cizí data nevidí; na serveru je jen soukromá podsložka. | Skutečné přihlášení na claude.ai na obou zařízeních, skutečné povolení `db`. **Samostatná verze se nepřihlašuje a data nesynchronizuje** (jsou jen v zařízení, přenos exportem). | Otevři odkaz na počítači i v telefonu pod stejným účtem Claude, potvrď povolení. |
| 2 | Nahrání skutečného exportu taktiky | **Částečně** | Import ručního plánu (`takticky-plan.json`, formát z původní složky) i kontroly vstupu: zkouška 03. Soubor `.fmf`: aplikace ho v zařízení rozšifruje a rozbalí (vlastní dekodér zstd), ukáže název, obrázek a výsledky kontrol a přečte **stavbu** taktiky; formát je odvozený ze tří skutečných exportů (`docs/FORMAT_FMF.md`), zkouška 21 (syntetické soubory, s `FMF_SAMPLES_DIR` i skutečné exporty). | **Význam polí taktiky (formace, role, instrukce, mentalita) se z `.fmf` nepřebírá** (není ověřený, hádat se nesmí). Exporty z jiných verzí hry vyzkoušené nejsou. | Pošli snímek obrazovky taktiky ze hry pro každý ze tří souborů (formace s rolemi a povinnostmi, instrukce, mentalita). |
| 3 | Zobrazení rozpoznaných taktických údajů | **Ověřeno v simulaci** (plán), **částečně** (`.fmf`) | Z plánu se zobrazí rozestavení, role, povinnosti, instrukce i původ každého údaje; u `.fmf` kontejner a výslovná věta, že pole taktiky se nečtou. Zkoušky 03 a 04. | Údaje z `.fmf` (viz bod 2). | Viz bod 2. |
| 4 | Doplnění soupisky | **Ověřeno v simulaci** | Ruční zadání s kontrolou (pozice, atributy 1 až 20, věk), úprava, smazání, import z plánu, návrh ze screenshotu **až po potvrzení uživatelem**. Zkouška 03 (40 kontrol). | Čtení skutečného screenshotu soupisky z FM27 (zkouška používá náhradní čtečku). | Vyzkoušej na vlastním screenshotu soupisky. |
| 5 | AI zná uloženou taktiku a hráče | **Ověřeno** (že se kontext posílá) | Do každé rady jde soupiska, aktivní taktika s rolemi a instrukcemi, paměť z minulých zápasů; označené původem. Zkoušky 03 a 07 čtou přímo text zadání pro model. | Jak skutečný Claude s kontextem naloží. | Zeptej se v „Osobním trenérovi“ a zkontroluj, zda rada zmiňuje tvé hráče. |
| 6 | Povolení sdílení obrazovky FM27 | **Ověřeno v simulaci** (samostatná verze) | Výslovný souhlas, indikátor „SLEDUJI“, pauza, zastavení, odmítnutí souhlasu, běh po přepnutí sekce, zastavení proudu. Zkouška 06 proti zkušebnímu proudu z plátna. Aplikace varuje, když je okno skryté (prohlížeč ho pak zpomaluje). | Skutečné okno FM27 na Windows. **Stránka v Claude obrazovku snímat nesmí** (omezení Claude, ne aplikace): tam se snímky vkládají ručně (Ctrl+V, soubor, foto z telefonu). | Spusť samostatnou verzi v Chrome nebo Edge, vyber okno hry, nech aplikaci viditelnou vedle hry. |
| 7 | Rozpoznání dostupných informací na obrazovce | **Postup ověřen, kvalita ne** | Prompt čtečky zakazuje hádání, výstup se kontroluje (rozsahy čísel, skóre, minuta), vždy je to „neověřené čtení“, dokud uživatel nepotvrdí. Brána posílá snímek jen při změně obrazovky a hlídá limity. Zkoušky 05 a 06, 65 testů `analysis.js`. | **Přesnost čtení skutečných screenshotů FM27** (žádný jsem neviděl). | Pošli 3 až 5 screenshotů FM27 s tím, co na nich vidíš. |
| 8 | Vyhodnocení taktických problémů | **Ověřeno v simulaci** (detektory), **neověřeno** (kvalita rad skutečného Claude) | Detektory jsou počítané heuristiky s minimálním vzorkem (bez dvou snímků od sebe aspoň 10 minut jen „sleduj“). Každý nález říká základ a že práh je heuristika aplikace, ne pravidlo FM27. Rada z AI musí projít kontrolou poctivosti. | Zda jsou rady skutečného Claude věcně dobré. | Hraj zápas a posuď, zda rady dávají smysl. |
| 9 | Konkrétní změna a jak ji provést | **Ověřeno** (tvar a kontroly), **neověřeno** (názvy ve hře) | Rada má 10 částí; změna má hráče, nastavení, z čeho na co a kroky v menu. Názvy rolí, nastavení a cest v menu FM27 jsou **vždy označené jako neověřené** a rada musí napsat, co ověřit. Nejvýš dvě změny najednou. | Skutečné názvy v FM27 (aplikace je nezná). | Ověř názvy ve hře podle pokynů v radě. |
| 10 | AI si vyžádá další informace | **Ověřeno v simulaci** | Chybí-li údaje, rada je v části „Co trenér neví“ vyjmenuje a nabídne pole k doplnění; rada, která neprojde kontrolou ani po jedné opravě, se **nezobrazí** a aplikace řekne, co chybí. Zkoušky 01 a 03. | – | – |
| 11 | Vyhodnocení účinku po změně | **Ověřeno v simulaci** | Uživatel zaznamená provedenou změnu; po aspoň 8 minutách dalších snímků aplikace porovná střely, držení a další za 10 minut před a po. Vždy nese větu „časová souvislost není důkaz příčiny“ a nikdy netvrdí příčinu. Zkoušky 05 a 07. | Smysluplnost na skutečném zápase (zkoušeno na vymyšlených číslech). | Zkus na vlastním zápase. |
| 12 | Hlasové upozornění | **Ověřeno v simulaci** | Česky (`cs-CZ`), krátce (do 200 znaků), jen při důležitém (četnost nízká/běžná/častá), nezahlcuje (odstup, limit za 10 minut, žádná duplicita do 5 minut), tichý režim, hlasitost a rychlost, hlasová otázka (samostatná verze), čtení rady nahlas. Zkoušky 05 a 09. | Skutečný hlas a jeho kvalita (zkouška zachycuje, co by se řeklo). V zařízení bez české hlasové zásoby aplikace varuje. | V Nastavení stiskni „Vyzkoušet hlas“. |
| 13 | Uložení historie zápasu | **Ověřeno v simulaci** | Zápas se průběžně ukládá, po ukončení je v Historii s obdobími, změnami, vyhodnocením i rozborem; přežije obnovení stránky; zkouška 05 a 07. | – | – |
| 14 | Synchronizace změn s telefonem | **Ověřeno v simulaci** (stránka v Claude) | Kariéry, hráči, taktiky, zápasy, rozbory, pokrok ve škole i nastavení se přenesou mezi dvěma okny (počítač a telefon); smazání se přenese a na serveru po něm nezůstane obsah. Zkoušky 02, 03, 07, 08. Texty knih a lekce z nich se **záměrně nesynchronizují** (zůstávají jen v zařízení). | Skutečné `db` Claude (zpoždění, souběh dvou úprav). Samostatná verze nesynchronizuje. | Změň něco na počítači a podívej se na telefonu. |
| 15 | Rozlišení ověřeného, odhadu a neznámého | **Ověřeno** | Úrovně důvěry a štítky původu; úroveň tvrzení nepřekročí nejslabší důkaz; úryvek z knihy je jen teorie; žádné vymyšlené mechaniky FM27; vysoká jistota jen ze dvou nezávislých ověřených screenshotů. 100 kontrol ve zkoušce 01, 897 testů jádra (celá sada), validátor shodný s Pythonem (103 společných případů). Kód prošel nezávislou revizí (`docs/REVIZE_NEZAVISLA_2026-11-04.md`), její nálezy o mezerách v kontrole jsou opravené; čtečka `.fmf` a dekodér zstd prošly dvěma dalšími koly (`docs/REVIZE_FMF_2026-11-05.md`). | Zda skutečný model někdy najde mezeru, kterou kontrola nechytí (proto jsou dokumentované limity a revize). | – |

## 2. Etapy ze zadání (§ 16)

| Etapa | Stav |
|---|---|
| 1 Základ | Hotovo: deset sekcí, kariéry, synchronizace (stránka v Claude), nastavení, záloha a smazání dat. |
| 2 Taktiky | Hotovo, **`.fmf`: kontejner a stavba payloadu taktiky** (význam polí formace, role a instrukcí se z něj zatím nepřebírá). Plán JSON, **čtení taktiky z obrazovky hry** (návrh k potvrzení), editor 11 pozic, laboratoř s tahem hráčů, porovnání taktik, soupeř zrcadlově. |
| 3 AI trenér | Hotovo: rada s kontextem, pamětí, knihami, obrázky; kontrola poctivosti a jedna oprava. |
| 4 Live Coach | Hotovo: ruční vkládání snímků (v Claude), sdílení obrazovky (samostatná verze), brána změn, časová osa, detektory, vyhodnocení změny. |
| 5 Hlas | Hotovo: výstup, tichý režim, hlasitost, četnost; vstup v samostatné verzi. |
| 6 Mobil | Rozhraní pro telefon a synchronizace hotové; sdílení snímků vložením nebo fotkou. **Systémová oznámení** jen při otevřené aplikaci (samostatná verze, skryté okno). **Oznámení na zavřený telefon neumí** (potřebuje vlastní server). |
| 7 Vzdělávání | Hotovo: 28 lekcí (A až E), sedm částí lekce, schéma, cvičení, ověření znalostí, trenér rozhodování, osobní rozvoj. |

## 3. Co aplikace záměrně neobsahuje

- Klient pro Windows (Tauri) a server s PostgreSQL ze zadání § 1: nahrazeno jednou webovou aplikací (důvod v `docs/ARCHITEKTURA_V2.md`).
- **Neomezené hledání na internetu.** Aplikace hledá zdroje na webu (konektor Parallel Search v Claude, nebo web search přes klíč Anthropic
  v samostatné verzi), ale **jen na pokyn** (tlačítko Najít zdroje, volba „Hledat i na webu“ u rady a lekce; v Live Coachi se nehledá,
  zápas nečeká), s limity a pamětí výsledků. **Nic z webu není ověřené**: výtah z hledání není celý text stránky, takže i oficiální web
  hry zůstává jen odhad (`inferred`) a zdroj z webu uložený mezi „moje zdroje“ se nikdy nestane „oficiální FM27“. Starší verze Football
  Manageru je označená „NENÍ FM27“. **Neověřeno z cloudu:** skutečná odpověď Parallel Search (tvar je odhad, čtení toleruje víc tvarů a při
  neznámém tvaru ukáže začátek odpovědi) a skutečné API Anthropic z prohlížeče (nástroj `web_search_20250305`, CORS, účtování 10 USD za 1 000 hledání podle
  dokumentace k 5. 11. 2026). Ověří to až tlačítko „Zkušební hledání“ v Nastavení u tebe.
- **Načtení dat přímo z paměti běžící hry jako Real Time Editor** (taktika, hráči a jejich údaje, finance jedním tlačítkem). Prohlížeč ani stránka
  v Claude do jiného programu sahat nesmí, takže to v téhle aplikaci technicky nejde. Hledání na GitHubu (5. 11. 2026) ukázalo, že kolem FM27 už existují
  editory čtoucí paměť (hráči, štáb, finance klubu), ale **taktiku z paměti nečte žádný**; taktika se čte ze souboru (`.fmf`, uložená hra). Vlastní čtečku
  paměti nestavíme (nedá se vyzkoušet z cloudu, struktury FM27 jsou vázané na build hry, hra by mohla spadnout, licenční podmínky je třeba ověřit).
  Dnes aplikace čte **obrazovku hry** (snímek vložený ručně, nebo jedním kliknutím z okna hry, kde to stránka smí) a ručně zadané údaje; **taktika se čte
  z obrazovky** (formace, mentalita, instrukce, role přesně jak je hra píše, návrh k potvrzení); finance zatím aplikace nemá. Přehled nástrojů, licencí
  a možných cest je v `docs/NACITANI_DAT_ZE_HRY.md`.
- Dekódování polí taktiky z `.fmf` (formace, role, instrukce): stavba souboru je popsaná a čtená celá (`docs/FORMAT_FMF.md`), ale **význam čísel není znám** a zadání zakazuje hádání; čeká na snímky obrazovky týchž tří taktik ze hry.
- Oznámení na zavřený telefon (push) a překryvné okno nad hrou (Document Picture-in-Picture).
- Čtení naskenovaných PDF bez textové vrstvy (OCR).
- Ověření OpenAI-kompatibilního rozhraní proti živé službě (zkoušeno jen proti napodobenině serveru; v aplikaci je označené jako neověřené). Adaptér Anthropic ověřen jen proti napodobenině rozhraní, ne proti živému API.

## 4. Automatické zkoušky

| Zkouška | Počet | Jak spustit |
|---|---|---|
| Jádro v Node (`trener/test/*.test.mjs`) | 897 (z toho 13 hlídá barvy a kontrast vzhledu, 27 čtení klubu ze hry, 40 DWRS, 38 sestavu A + B, 47 přestupy, 34 čtečku kontejneru `.fmf`, 25 čtečku stavby taktiky, 34 dekodér zstd, 10 jeho lepidlo a 11 čištění cizích textů; 2 zkoušky běží jen se skutečnými exporty z FM27 a 3 jen s libzstd (Python `zstandard`): bez nich se přeskočí viditelně, s `ZSTD_ORACLE_REQUIRED=1` zkouška věštírny selže) | `node --test trener/test/*.test.mjs` |
| Serverové jádro v Pythonu (`ai_gateway/`) | 143 (16 se přeskočí bez doplňkových knihoven) | `python3 -m unittest discover -s ai_gateway/tests -t .` |
| Inspektor FMF v Pythonu (`fmf_research/`) | 11 (potřebují `zstandard`) | `python3 -m unittest discover -s fmf_research/tests -t .` |
| Prohlížeč, celá aplikace (`trener/test/e2e/`) | 904 (900 bez skutečných souborů `.fmf`) | viz `trener/README.md` |

Prohlížečové zkoušky: 01 poradce (100; vč. povinného „proč“ u změny a opravného kola, když chybí), 02 kariéry, synchronizace a záloha (29), 03 tým a taktiky (40), 04 laboratoř a soupeř (34),
05 Live Coach (46), 06 sdílení obrazovky (26), 07 historie a rozbor (21), 08 škola (34; vč. „Co udělat“ a „Proč“ u každého kroku), 09 hlas a oznámení (57),
10 samostatná verze: vlastní klíč, service worker, offline, instalace (47), 11 průchod všemi obrazovkami: zbloudilý text,
vodorovné posouvání, čitelnost písma ve světlém i tmavém vzhledu, ikony a popisky menu (27), 12 zdroje z webu: konektor Parallel Search (zkušební náhražka),
karty a uložení zdroje, rada a lekce se zdroji z webu, chyby konektoru, samostatná verze s web search přes klíč Anthropic (falešné HTTP API) (86).
19 klub ze hry při zakládání kariéry: ze snímku, z okna hry a z pluginu (falešný), vložení snímku Ctrl+V, návrh a potvrzení, původ polí, podvržené odpovědi a názvy, cizí adresa pluginu, bez AI (37;
ověřeno šesti záměrnými poruchami, každá zkoušku shodila). Skutečné čtení FM27 a skutečný plugin se nezkoušely.
Zkoušku 12 jsem ověřil i opačně: po vypnutí kontroly adres (povolení `javascript:` a `http:`) spadla v 15 bodech.
13 sdílení obrazovky ve stránce v Claude: rámeček z jiného původu napodobuje claude.ai s povolením (`allow="display-capture"`) a bez něj (14);
ověřeno i opačně (po ignorování pravidla rámečku spadly 4 body). Skutečný rámeček claude.ai se z cloudu ověřit nedá.
14 načíst z obrazovky hry: šedé tlačítko „Načíst“, čtení taktiky z obrazovky s potvrzením, jeden snímek okna hry, soupiska a soupeř z okna hry (35);
ověřeno i opačně (po vypuštění potvrzení a po hádání rolí zkouška spadla). Čtení skutečné obrazovky FM27 skutečným Claude se z cloudu ověřit nedá.
15 načtení hráčů z tabulky exportu: CSV (UTF-8 s BOM), TSV (UTF-16), stará česká znaková sada (windows-1250), HTML tabulka, JSON ve tvaru čtečky `fmsave` (podle její
dokumentace), úprava významu sloupce uživatelem, limit 60 hráčů, soubory bez tabulky, prázdné a příliš velké, nepřátelský text v souboru (34); skryté údaje hry
(CA a PA, skryté atributy, osobnost) se nenačtou a u sloupce je vidět proč. Skutečné soubory cizích nástrojů se z cloudu ověřit nedají.
16 živá data a sestava z FMMatchLens (samostatná verze, náhražka pluginu na 127.0.0.1:16726 s tvarem odpovědí podle jeho zdrojového kódu 0.7.x): zkouška spojení,
odmítnutí cizí adresy i adresy v místní síti, cizí služba na adrese, plugin bez zápasu, zápas z dat pluginu (soupeř, soutěž, strana), snímky podle herního času (gól,
červená, nová část, tři minuty), držení míče a přesnost přihrávek z čísel pluginu, hodnocení jen mých hráčů, žádné volání AI, jiný zápas v pluginu, výpadek a zotavení,
navázání po novém načtení stránky bez zdvojení, sestava s rolemi s míčem, skryté údaje a CA/PA se nenačtou, nepřátelský text je jen text, stránka v Claude (41).
Ověřeno i opačně (po povolení cizí adresy a po načtení skrytých atributů zkouška spadla). **Skutečný plugin a skutečnou hru se z cloudu ověřit nedá.**
17 graf průběhu zápasu: xG, střely, střely na bránu a držení míče v čase z časové osy, strana hosta, přepínání a zachování výběru po novém snímku, značka změny skóre,
tabulka pro čtečky, Historie zápasů (14); ověřeno i opačně (po vynucení domácí strany zkouška spadla).
18 profily rolí, vhodnost na role a nejlepší sestava (Moje taktiky): čtení role z obrazovky (náhražka Claude) s potvrzením a úpravou, ruční profily, skrytý údaj hry se do profilu nepřijme,
přesná čísla vhodnosti a přiřazení (70, 73, 55, 77,5; součet 275,5), „nedostupné“ místo nuly, role bez profilu se neobsadí a řekne se proč, slabá místa (o 16,5 pod mediánem),
sestava v taktice se změní jen po kliknutí, AI trenér dostane výsledek jako „heuristiku“, záloha nového typu dokumentu (34); ověřeno i opačně (skryté atributy v profilu, štítek pro AI, použití
sestavy bez kliknutí). Algoritmus přiřazení: 500 + 400 náhodných instancí proti hrubé síle v testech jádra. Skutečné role a obrazovku role ve FM27 se z cloudu ověřit nedá.
20 DWRS, správa vah, sestava A + B, zámky, rozbor hráče: přednastavení vah a výpis toho, co každé změnilo, vlastní profil (úprava, neplatné hodnoty, porovnání, smazání, návrat k výchozímu odhadu, záloha),
čísla DWRS a součty A i B v prohlížeči sedí na výpočet mimo stránku (Node), zámek, vyřazení a zraněný hráč, lavička B bez hráčů z A, náhrady s přesným dopadem, tabulka výpadků, rizika (jediný brankář),
hloubka, „mimo sestavu“ s důvody, vstup pro AI trenéra s modelem a rizikem, rozbor hráče (nejlepší role, silné stránky a mezery, pořadí v týmu, vhodnost na místa v taktice, hráč bez atributů),
použití jen sestavy A v taktice (61). Optimalizace A + B: shoda s hrubou silou na 570 náhodných úlohách (zámky, vyřazení, zranění, lavička) a deset mutací v testech jádra. **DWRS se nezkoušelo proti skutečné hře: tabulky kategorií jsou odhad.**
21 čtení souboru `.fmf` (Moje taktiky → Import): syntetický export se rozšifruje a rozbalí v prohlížeči (WebCrypto AES-CTR, zstd), ukáže se název, obrázek, velikosti a výsledky kontrol, zpráva o souboru bez obsahu a bez přezdívky autora, nic se neuloží ani neodešle do AI, poškozený soubor se nepřečte, cizí a starší soubor jde na původní kontrolu, přečte se i **stavba** taktiky (počty bloků, položek a záznamů; zpráva o souboru nese o ní jen počty) a payload bez popsané stavby se hlásí jako neodpovídající (28 kontrol, mezi nimi prohlížeč bez WebCrypto, záznam zčásti mimo datovou část, banner, který nic netvrdí o neověřených zdrojích, a odmítnutí souboru o bajt většího než 24 MiB (čtečka) a 5 MiB (starší kontrola) podle velikosti, ještě než se načte do paměti); **když je zadaný adresář `FMF_SAMPLES_DIR`, přečtou se i tři skutečné exporty z FM27 (další 4 kontroly: adresář opravdu obsahuje soubory; všechny kontroly sedí, stavba taktiky přečtená celá, obrázek 250 × 166)**. **Význam** polí taktiky se nezkouší, zatím se nedekóduje (stavba souboru je známá, co čísla znamenají ne). Formát kontejneru: `docs/FORMAT_FMF.md`.
22 přestupový poradce (Můj tým → Přestupy): kandidát zadaný ručně i z tabulky (potvrzení sloupců, skryté údaje se nenačtou, neznámá cena a mzda zůstanou neznámé, rozsah ceny se nepřevezme), hledání posil na celý tým i na jedno místo (pořadí, vhodnost a dopad shodné s výpočtem mimo stránku), dopad odchodu a výměny, platnost jednání podle data hry, které zadá uživatel (datum hry se nečte), uložení doporučení a skutečný výsledek podle hodnocení uživatele, záloha nových typů dokumentů, překreslení karty počká, dokud uživatel píše. **Vhodnost hráčů vychází z DWRS (ESTIMATED: tabulky kategorií jsou odhad autora) nebo z jednoduchého váženého průměru (CUSTOM MODEL: heuristika aplikace); vždy se píše, z kterého modelu. Nezkoušelo se proti skutečnému FM27 ani proti exportům cizích nástrojů.**

Pythonové zkoušky hlídají i to, že se do repozitáře nedostal klíč ani text podobný klíči (test `test_no_secrets` prochází všechny textové soubory).

## 5. Co potřebuju od tebe (a kde to udělat)

1. **Vyzkoušet stránku v Claude** (počítač i telefon, stejný účet): https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh
   Claude se při prvním použití zeptá na povolení. Přidej aspoň jednu skutečnou knihu: v aplikaci „Zdroje znalostí“.
2. **Samostatná verze už běží** (GitHub Pages zapnuté a nasazené 5. 11. 2026): https://janvasilecko-droid.github.io/FM27-apka/ . Nasazuje se
   samo po každé změně aplikace na větvi `main` (ručně: https://github.com/janvasilecko-droid/FM27-apka/actions/workflows/pages.yml, tlačítko
   „Run workflow“ je až na stránce konkrétního workflow, ne v přehledu „All workflows“). Adresa `github.io` sdílí úložiště prohlížeče se všemi
   dalšími stránkami na tvém `janvasilecko-droid.github.io`: aplikace tam klíč AI výchozně nepamatuje (jen do zavření záložky) a varuje;
   bezpečnější je vlastní adresa (Custom domain: https://github.com/janvasilecko-droid/FM27-apka/settings/pages) nebo používat jen stránku v Claude.
2b. **Připojit konektor „Parallel Search“** (jen pro hledání zdrojů na stránce v Claude): https://claude.ai/settings/connectors , najdi ho v seznamu
   a připoj; potom stránku obnov a v „Zdroje znalostí“ klikni na „Najít zdroje“. První hledání se zeptá na souhlas. V samostatné verzi
   hledání běží přes tvůj klíč Anthropic (účtuje se zvlášť).
3. **Skutečné vzorky z FM27**: tři exporty `.fmf` a 3 až 5 screenshotů (zápas, statistiky, taktika) s tím, co na nich vidíš.
4. **Vlastní klíč AI** (jen pro samostatnou verzi): vytvoř ho na https://console.anthropic.com/settings/keys a vlož ho
   **jen do Nastavení v aplikaci**. Nikdy ho neposílej do chatu.
5. **Zkouška Live Coache na Windows**: samostatná verze v Chrome nebo Edge, sdílet okno FM27, okno aplikace nechat vidět vedle hry.
