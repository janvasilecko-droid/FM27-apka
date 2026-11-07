# Akceptační matice (zadání § 17)

Stav k 6. 11. 2026. Zadání říká: „Projekt není dokončen, dokud nebude možné prokázat následující“ a „všechny zásadní funkce
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
| 15 | Rozlišení ověřeného, odhadu a neznámého | **Ověřeno** | Úrovně důvěry a štítky původu; úroveň tvrzení nepřekročí nejslabší důkaz; úryvek z knihy je jen teorie; žádné vymyšlené mechaniky FM27; vysoká jistota jen ze dvou nezávislých ověřených screenshotů. 102 kontrol ve zkoušce 01, 898 testů jádra (celá sada), validátor shodný s Pythonem (103 společných případů). Kód prošel nezávislou revizí (`docs/REVIZE_NEZAVISLA_2026-11-04.md`), její nálezy o mezerách v kontrole jsou opravené; čtečka `.fmf` a dekodér zstd prošly třemi dalšími koly revize modelů (`docs/REVIZE_FMF_2026-11-05.md`; opravy třetího kola prověřil už jen cílený průchod). | Zda skutečný model někdy najde mezeru, kterou kontrola nechytí (proto jsou dokumentované limity a revize). | – |
| 16 | Aplikace pro Windows s instalátorem, ne webová (zadání majitele 7. 11. 2026) | **Částečně** (obal ověřen v Electronu na Linuxu, instalátor ne) | Desktopový obal (`desktop/`, Electron): aplikace naběhne z vlastního protokolu bez chyb, stránka dostane jen příznak desktopu (žádný přístup k Node.js), „Načíst z okna hry“ najde okno Football Manageru samo a nasnímá právě ho (ne jiné okno, ne vlastní, ne celou obrazovku), vzor z nastavení přepíše výchozí, bez okna hry se nabídne seznam oken a zrušení nic nenasnímá, odkazy jdou do prohlížeče, cizí soubory se nevydají, oprávnění jen z povoleného seznamu, velikost okna se pamatuje, druhá instance se nespustí (`desktop/test/smoke.cjs`, 20 kontrol; výběr okna 6 testů; stránka v desktopovém režimu zkouška 28). Konfigurace instalátoru a balení ověřené sestavením rozbalené aplikace pro Windows na Linuxu. | **Sestavení a spuštění instalátoru na Windows** (sestaví GitHub na `windows-latest`), SmartScreen a antivirus (instalátor není podepsaný), **skutečný Football Manager 2027** (název okna, nasnímání jeho okna ve Windows, režim na celou obrazovku), plugin FMMatchLens. | Stáhni instalátor, spusť ho (SmartScreen: „Další informace“, „Přesto spustit“), v Nastavení zadej klíč AI, spusť FM27 v okně a zkus „Načíst z okna hry“; napiš mi, co ukázalo okno nebo protokol (Nápověda → Složka s protokolem). Návod: `docs/WINDOWS_APLIKACE.md`. |

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
| Jádro v Node (`trener/test/*.test.mjs`) | 1148 (z toho 13 hlídá barvy a kontrast vzhledu, 27 čtení klubu ze hry, 40 DWRS, 38 sestavu A + B, 47 přestupy, 34 čtečku kontejneru `.fmf`, 25 čtečku stavby taktiky, 34 dekodér zstd, 10 jeho lepidlo a 11 čištění cizích textů; od 6. 11. 2026 přibyly rozbor taktiky (79), rozbor sestavy (39), klíčové atributy podle pozice (14), český slovník hry (19), čtení české obrazovky taktiky (9), čtení soupisky (13), zpráva o soupeři (13), rozbor soupeře (27), Tactical Effectiveness (7) a shoda dokumentace `ANALYZA_SESTAVY_A_PRIPRAVY.md` s pravidly v kódu (8); 2 zkoušky běží jen se skutečnými exporty z FM27 (`FMF_SAMPLES_DIR`) a 3 jen s libzstd (Python `zstandard`): bez nich se přeskočí viditelně; další zkoušky v `zstd.test.mjs`, které se ptají libzstd, bez věštírny projdou bez porovnání s libzstd a bez značky přeskočení (běží jen jejich přímé kontroly dekodéru); s `ZSTD_ORACLE_REQUIRED=1` selže bez věštírny každá zkouška, která se jí ptá, i když se vybere samostatně) | `node --test trener/test/*.test.mjs` |
| Serverové jádro v Pythonu (`ai_gateway/`) | 143 (16 se přeskočí bez balíčku `anthropic`) | `python3 -m unittest discover -s ai_gateway/tests -t .` |
| Inspektor FMF v Pythonu (`fmf_research/`) | 11 (potřebují `zstandard`, bez něj se všech 11 přeskočí) | `python3 -m unittest discover -s fmf_research/tests -t .` |
| Prohlížeč, celá aplikace (`trener/test/e2e/`) | 1047 v 28 scénářích (1043 bez skutečných souborů `.fmf`) | viz `trener/README.md` |

Prohlížečové zkoušky: 01 poradce (102; vč. povinného „proč“ u změny a opravného kola, když chybí), 02 kariéry, synchronizace a záloha (29), 03 tým a taktiky (40), 04 laboratoř a soupeř (34),
05 Live Coach (46), 06 sdílení obrazovky (26), 07 historie a rozbor (21), 08 škola (34; vč. „Co udělat“ a „Proč“ u každého kroku), 09 hlas a oznámení (57),
10 samostatná verze: vlastní klíč, service worker, offline, instalace (47), 11 průchod všemi obrazovkami: zbloudilý text,
vodorovné posouvání, čitelnost písma ve světlém i tmavém vzhledu, ikony a popisky menu (27), 12 zdroje z webu: konektor Parallel Search (zkušební náhražka),
karty a uložení zdroje, rada a lekce se zdroji z webu, chyby konektoru, samostatná verze s web search přes klíč Anthropic (falešné HTTP API) (86).
19 klub ze hry při zakládání kariéry: ze snímku, z okna hry a z pluginu (falešný), vložení snímku Ctrl+V, návrh a potvrzení, původ polí, podvržené odpovědi a názvy, cizí adresa pluginu, bez AI (37;
ověřeno šesti záměrnými poruchami, každá zkoušku shodila). Skutečné čtení FM27 a skutečný plugin se nezkoušely.
Zkoušku 12 jsem ověřil i opačně: po vypnutí kontroly adres (povolení `javascript:` a `http:`) spadla v 15 bodech.
13 sdílení obrazovky ve stránce v Claude: rámeček z jiného původu napodobuje claude.ai s povolením (`allow="display-capture"`) a bez něj (15);
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
použití jen sestavy A v taktice (61). Optimalizace A + B: shoda s hrubou silou na 570 náhodných úlohách (zámky, vyřazení, zranění, lavička). Mutační kontrola sestavy A + B a přestupů byla jednorázová a ruční při psaní kódu (záznam jen ve zprávách commitů f8d7ad8 a 67f3629), skripty v repozitáři nejsou; mutační seznamy v `trener/test/mutation/` jsou jen pro dekodér zstd, jeho lepidlo a čtečku kontejneru. **DWRS se nezkoušelo proti skutečné hře: tabulky kategorií jsou odhad.**
21 čtení souboru `.fmf` (Moje taktiky → Import): syntetický export se rozšifruje a rozbalí v prohlížeči (WebCrypto AES-CTR, zstd), ukáže se název, obrázek, velikosti a výsledky kontrol, zpráva o souboru bez obsahu a bez přezdívky autora, nic se neuloží ani neodešle do AI, poškozený soubor se nepřečte, cizí a starší soubor jde na původní kontrolu, přečte se i **stavba** taktiky (počty bloků, položek a záznamů; zpráva o souboru nese o ní jen počty) a payload bez popsané stavby se hlásí jako neodpovídající (29 kontrol, mezi nimi prohlížeč bez WebCrypto, záznam zčásti mimo datovou část, banner, který nic netvrdí o neověřených zdrojích, odmítnutí souboru o bajt většího než 24 MiB (čtečka) a 5 MiB (starší kontrola, v prohlížeči bez WebCrypto) podle velikosti bez načtení do paměti: počítadla `Blob.prototype.arrayBuffer` a `FileReader.prototype.readAsArrayBuffer` u těchto dvou souborů naměří 0 čtení (jiné způsoby čtení Blobu se nepočítají), a oddíl C8 scénáře: soubor o 6 MiB, který čtečka nepozná, se přečte právě jednou a starší kontrola ho odmítne větou o svém limitu 5 MiB, ne větou, že se nenačítá); **když je zadaný adresář `FMF_SAMPLES_DIR`, přečtou se i tři skutečné exporty z FM27 (další 4 kontroly: adresář opravdu obsahuje soubory; všechny kontroly sedí, stavba taktiky přečtená celá, obrázek 250 × 166)**. **Význam** polí taktiky se nezkouší, zatím se nedekóduje (stavba souboru je známá, co čísla znamenají ne). Formát kontejneru: `docs/FORMAT_FMF.md`.
22 přestupový poradce (Můj tým → Přestupy): kandidát zadaný ručně i z tabulky (potvrzení sloupců, skryté údaje se nenačtou, neznámá cena a mzda zůstanou neznámé, rozsah ceny se nepřevezme), hledání posil na celý tým i na jedno místo (pořadí, vhodnost a dopad shodné s výpočtem mimo stránku), dopad odchodu a výměny, platnost jednání podle data hry, které zadá uživatel (datum hry se nečte), uložení doporučení a skutečný výsledek podle hodnocení uživatele, záloha nových typů dokumentů, překreslení karty počká, dokud uživatel píše (55). **Vhodnost hráčů vychází z DWRS (ESTIMATED: tabulky kategorií jsou odhad autora) nebo z jednoduchého váženého průměru (CUSTOM MODEL: heuristika aplikace); vždy se píše, z kterého modelu. Nezkoušelo se proti skutečnému FM27 ani proti exportům cizích nástrojů.**
23 rozbor taktiky (Moje taktiky): karta „Rozbor sestavy a taktiky“ říká, že jde o pomůcku, ne o pravidlo FM27 ani předpověď; pole „Role bez míče“ u každého místa; co se přečetlo (mentalita, 5 z 27 instrukcí, role s míčem a bez míče, atributy);
nerozpoznaná instrukce se uvede; nálezy A01, A04, A08, A09 a C01 s důkazem, přesnou změnou (název instrukce → hodnota) a druhem zdroje; vážné rozpory první; nevyhodnocené kontroly zvlášť; žádná silná slova („zabere“, „zaručeně“);
po úpravě taktiky starý rozbor zmizí a po opravě instrukcí zmizí i nález; kopírování souhrnu (18).
24 rozbor sestavy: výběr jedenáctky podle klíčových atributů pozice (označeno jako odhad podle příruček, role se nepopisují), tabulka „Podle čeho se vybírá“ s osmi skupinami a zdroji s odkazy, výměna s číslem zisku, hloubka (G2),
slabé atributy (Q1), brankář bez nástupce (A1), silné stránky, seznam „Co řešit jako první“ z obou rozborů, poznámka, co aplikace zatím nezná (smlouvy, forma, morálka), telefon 390 px, po změně hráče starý rozbor zmizí,
bez hráčů se nic nevymýšlí (22).
25 česká obrazovka hry: zadání pro čtení (sloupce Zvp, Role, Role MP, pole Styl a Herní systém, dlaždice instrukcí, vynechání lavičky a měřidel), formace odvozená z míst tabulky, lavička se nečte jako základní hráč, 7 z 7 instrukcí česky,
role s míčem i bez míče u míst (dva stopeři zprava doleva s poznámkou o odhadu), hráči se spárují s kádrem jen při jednoznačné shodě, rozbor ukáže „7 z 27“ a role jen z ověřených zkratek (GK, CB, BCB), soupiska česky se slučuje
(nový hráč / doplnění; existující věk a pozice se nepřepíšou, kanonické názvy atributů a kódy pozic), profil role po fázích (s míčem zelená a modrá, bez míče růžová a fialová; dva profily téže role), úprava profilu bez míče nepřepíše profil s míčem, dva různí hráči téhož jména se nezapíšou, skryté údaje se nedostanou do kontextu AI (24).
26 příprava na zápas (Soupeři): tři karty (Zpráva o soupeři ze hry, Soupiska soupeře, Příprava na zápas), čtení jedním levným voláním s jedním obrázkem, návrh se uloží až po potvrzení a jako neověřený, strukturovaný profil se slabinami podle oblasti,
doporučení v českých názvech hry (vzduch, fyzická hra, strana převedená na tvou perspektivu, pokyny k soupeři, standardky, presink) s původem a důkazem, rozpočet změn (nejvýš 3, čtvrtá volitelná), jedna testovatelná změna, rady k hráčům kádru,
soupiska soupeře s kanonickými názvy atributů (do tvého kádru se nepřidá) a pravidla z atributů (pomalá obrana, rychlí útočníci proti vysoké linii, slabý rozehrávač, vzdušní útočníci), nevyhodnocená pravidla, dva různí hráči téhož jména se nezapíšou, zpráva o jiném týmu se nesmíchá s uloženou (jen s výslovným souhlasem s nahrazením), kopírování souhrnu, telefon (38).
27 Tactical Effectiveness (Moje taktiky): čtyři pilíře pod jejich názvy ve hře, úrovně zadává uživatel (hra ukazuje jen barevné pruhy), osm sezení Tactical Understanding, priority (nízké první, vysoké vynechané), rady k deseti faktorům u nízkého
porozumění, složitost taktiky jako odhad (8 instrukcí mimo výchozí + 5 pokynů k soupeři = 13 → vysoká), sezení podle věty asistenta, složitost taktiky říká, kolik instrukcí je přečteno (dolní odhad), co aplikace neví, zadané úrovně přežijí překreslení, telefon (16).
28 stránka v desktopové aplikaci pro Windows (příznak `window.fm27desktop` nasimulovaný): aplikace pozná desktop, texty říkají, že si okno Football Manageru najde sama, hlasový vstup se nenabízí, celé černý snímek (hra na celou obrazovku výhradním režimem) se nepošle k přečtení a řekne, co udělat, zrušený výběr okna se ohlásí lidsky, v obyčejném prohlížeči zůstává vše jako dřív (11).
Zkoušky 23 až 28 běží se zkušební náhražkou Claude a s vymyšlenými jmény a daty; tvary odpovědí odpovídají tomu, co ukázala hra 7. 11. 2026. **Skutečné čtení české obrazovky FM27 skutečným Claude se z cloudu ověřit nedá.**

„Ověřeno i opačně“ u zkoušek 12 až 19 je jednorázová ruční kontrola při psaní zkoušky (kód úmyslně rozbit, zkouška musí selhat): skripty v repozitáři nejsou, záznam o kontrole je jen ve zprávách commitů 1d09bdf, bacb24b, d8e5b86, 71ae879, b68c9e5 a da59210. Čísla „15 bodů“ u zkoušky 12 a „4 body“ u zkoušky 13 v těch zprávách nejsou; zopakoval je závěrečný průchod kola 3 jednořádkovou změnou kódu (vypuštění kontroly protokolu `https:` v `normalizeUrl` dalo 15 chyb, `return true` ve `framedCaptureAllowed` dalo 4). Trvalé mutační seznamy v `trener/test/mutation/` jsou jen pro dekodér zstd, jeho lepidlo a čtečku kontejneru.

Pythonové zkoušky hlídají i to, že se do repozitáře nedostal klíč: třída `NoSecretsInRepo` (`ai_gateway/tests/test_config_and_secrets.py`) má test `test_no_secret_looking_strings`, který hledá šest tvarů klíčů (Anthropic, OpenAI, Supabase secret, JWT, token GitHubu, klíč AWS) jen v souborech s příponou `.py .md .json .js .mjs .cjs .html .css .txt .yml .yaml .toml .env .svg .webmanifest .sh` a bez přípony, a test `test_no_env_files_are_committed`, který hlídá, že v repozitáři není soubor `.env*`. Hesla ani texty knih žádná zkouška v celém repozitáři nehlídá (jen úzká kontrola v `trener/test/school.test.mjs`, že `school.js` neobsahuje id skutečných úryvků z knih) a Pythonové zkoušky v CI neběží.

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
3. **Skutečné vzorky z FM27**: tři exporty `.fmf` už jsou (5. 11. 2026). Zbývá **snímek obrazovky taktiky ze hry pro každý z těch tří souborů** (formace s rolemi a povinnostmi, všechny instrukce, mentalita) a 3 až 5 snímků zápasu a statistik s tím, co na nich vidíš. Bez nich nejde ověřit význam čísel v `.fmf` ani změřit čtení obrazovky.
4. **Vlastní klíč AI** (jen pro samostatnou verzi): vytvoř ho na https://console.anthropic.com/settings/keys a vlož ho
   **jen do Nastavení v aplikaci**. Nikdy ho neposílej do chatu.
5. **Zkouška Live Coache na Windows**: samostatná verze v Chrome nebo Edge, sdílet okno FM27, okno aplikace nechat vidět vedle hry.
