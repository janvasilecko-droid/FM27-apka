# Akceptační matice (zadání § 17)

Stav k 4. 11. 2026. Zadání říká: „Projekt není dokončen, dokud nebude možné prokázat následující“ a „všechny zásadní funkce
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
| 2 | Nahrání skutečného exportu taktiky | **Částečně** | Import ručního plánu (`takticky-plan.json`, formát z původní složky) i kontroly vstupu: zkouška 03. Soubor `.fmf`: aplikace najde kontejner a seznam zdrojů (`.tac`, `.img`, `.aom`) podle jediného pozorovaného vzorku. | **Pole taktiky uvnitř `.fmf` se nedekódují** (nikdo je neodhalil, hádat se nesmí). Skutečný export FM27 jsem neměl, zkoušeno na syntetickém kontejneru. | Pošli tři exporty `.fmf` s předem známým nastavením (postup v `docs/REVIZE_CLAUDE_2026-11-04.md`, část 2). |
| 3 | Zobrazení rozpoznaných taktických údajů | **Ověřeno v simulaci** (plán), **částečně** (`.fmf`) | Z plánu se zobrazí rozestavení, role, povinnosti, instrukce i původ každého údaje; u `.fmf` kontejner a výslovná věta, že pole taktiky se nečtou. Zkoušky 03 a 04. | Údaje z `.fmf` (viz bod 2). | Viz bod 2. |
| 4 | Doplnění soupisky | **Ověřeno v simulaci** | Ruční zadání s kontrolou (pozice, atributy 1 až 20, věk), úprava, smazání, import z plánu, návrh ze screenshotu **až po potvrzení uživatelem**. Zkouška 03 (37 kontrol). | Čtení skutečného screenshotu soupisky z FM27 (zkouška používá náhradní čtečku). | Vyzkoušej na vlastním screenshotu soupisky. |
| 5 | AI zná uloženou taktiku a hráče | **Ověřeno** (že se kontext posílá) | Do každé rady jde soupiska, aktivní taktika s rolemi a instrukcemi, paměť z minulých zápasů; označené původem. Zkoušky 03 a 07 čtou přímo text zadání pro model. | Jak skutečný Claude s kontextem naloží. | Zeptej se v „Osobním trenérovi“ a zkontroluj, zda rada zmiňuje tvé hráče. |
| 6 | Povolení sdílení obrazovky FM27 | **Ověřeno v simulaci** (samostatná verze) | Výslovný souhlas, indikátor „SLEDUJI“, pauza, zastavení, odmítnutí souhlasu, běh po přepnutí sekce, zastavení proudu. Zkouška 06 proti zkušebnímu proudu z plátna. Aplikace varuje, když je okno skryté (prohlížeč ho pak zpomaluje). | Skutečné okno FM27 na Windows. **Stránka v Claude obrazovku snímat nesmí** (omezení Claude, ne aplikace): tam se snímky vkládají ručně (Ctrl+V, soubor, foto z telefonu). | Spusť samostatnou verzi v Chrome nebo Edge, vyber okno hry, nech aplikaci viditelnou vedle hry. |
| 7 | Rozpoznání dostupných informací na obrazovce | **Postup ověřen, kvalita ne** | Prompt čtečky zakazuje hádání, výstup se kontroluje (rozsahy čísel, skóre, minuta), vždy je to „neověřené čtení“, dokud uživatel nepotvrdí. Brána posílá snímek jen při změně obrazovky a hlídá limity. Zkoušky 05 a 06, 62 testů `analysis.js`. | **Přesnost čtení skutečných screenshotů FM27** (žádný jsem neviděl). | Pošli 3 až 5 screenshotů FM27 s tím, co na nich vidíš. |
| 8 | Vyhodnocení taktických problémů | **Ověřeno v simulaci** (detektory), **neověřeno** (kvalita rad skutečného Claude) | Detektory jsou počítané heuristiky s minimálním vzorkem (bez dvou snímků od sebe aspoň 10 minut jen „sleduj“). Každý nález říká základ a že práh je heuristika aplikace, ne pravidlo FM27. Rada z AI musí projít kontrolou poctivosti. | Zda jsou rady skutečného Claude věcně dobré. | Hraj zápas a posuď, zda rady dávají smysl. |
| 9 | Konkrétní změna a jak ji provést | **Ověřeno** (tvar a kontroly), **neověřeno** (názvy ve hře) | Rada má 10 částí; změna má hráče, nastavení, z čeho na co a kroky v menu. Názvy rolí, nastavení a cest v menu FM27 jsou **vždy označené jako neověřené** a rada musí napsat, co ověřit. Nejvýš dvě změny najednou. | Skutečné názvy v FM27 (aplikace je nezná). | Ověř názvy ve hře podle pokynů v radě. |
| 10 | AI si vyžádá další informace | **Ověřeno v simulaci** | Chybí-li údaje, rada je v části „Co trenér neví“ vyjmenuje a nabídne pole k doplnění; rada, která neprojde kontrolou ani po jedné opravě, se **nezobrazí** a aplikace řekne, co chybí. Zkoušky 01 a 03. | – | – |
| 11 | Vyhodnocení účinku po změně | **Ověřeno v simulaci** | Uživatel zaznamená provedenou změnu; po aspoň 8 minutách dalších snímků aplikace porovná střely, držení a další za 10 minut před a po. Vždy nese větu „časová souvislost není důkaz příčiny“ a nikdy netvrdí příčinu. Zkoušky 05 a 07. | Smysluplnost na skutečném zápase (zkoušeno na vymyšlených číslech). | Zkus na vlastním zápase. |
| 12 | Hlasové upozornění | **Ověřeno v simulaci** | Česky (`cs-CZ`), krátce (do 200 znaků), jen při důležitém (četnost nízká/běžná/častá), nezahlcuje (odstup, limit za 10 minut, žádná duplicita do 5 minut), tichý režim, hlasitost a rychlost, hlasová otázka (samostatná verze), čtení rady nahlas. Zkoušky 05 a 09. | Skutečný hlas a jeho kvalita (zkouška zachycuje, co by se řeklo). V zařízení bez české hlasové zásoby aplikace varuje. | V Nastavení stiskni „Vyzkoušet hlas“. |
| 13 | Uložení historie zápasu | **Ověřeno v simulaci** | Zápas se průběžně ukládá, po ukončení je v Historii s obdobími, změnami, vyhodnocením i rozborem; přežije obnovení stránky; zkouška 05 a 07. | – | – |
| 14 | Synchronizace změn s telefonem | **Ověřeno v simulaci** (stránka v Claude) | Kariéry, hráči, taktiky, zápasy, rozbory, pokrok ve škole i nastavení se přenesou mezi dvěma okny (počítač a telefon); smazání se přenese a na serveru po něm nezůstane obsah. Zkoušky 02, 03, 07, 08. Texty knih a lekce z nich se **záměrně nesynchronizují** (zůstávají jen v zařízení). | Skutečné `db` Claude (zpoždění, souběh dvou úprav). Samostatná verze nesynchronizuje. | Změň něco na počítači a podívej se na telefonu. |
| 15 | Rozlišení ověřeného, odhadu a neznámého | **Ověřeno** | Úrovně důvěry a štítky původu; úroveň tvrzení nepřekročí nejslabší důkaz; úryvek z knihy je jen teorie; žádné vymyšlené mechaniky FM27; vysoká jistota jen ze dvou nezávislých ověřených screenshotů. 92 kontrol ve zkoušce 01, 484 testů jádra, validátor shodný s Pythonem (68 společných případů). | Zda skutečný model někdy najde mezeru, kterou kontrola nechytí (proto jsou dokumentované limity a revize). | – |

## 2. Etapy ze zadání (§ 16)

| Etapa | Stav |
|---|---|
| 1 Základ | Hotovo: deset sekcí, kariéry, synchronizace (stránka v Claude), nastavení, záloha a smazání dat. |
| 2 Taktiky | Hotovo, **`.fmf` jen kontejner** (pole taktiky se nedekódují). Plán JSON, editor 11 pozic, laboratoř s tahem hráčů, porovnání taktik, soupeř zrcadlově. |
| 3 AI trenér | Hotovo: rada s kontextem, pamětí, knihami, obrázky; kontrola poctivosti a jedna oprava. |
| 4 Live Coach | Hotovo: ruční vkládání snímků (v Claude), sdílení obrazovky (samostatná verze), brána změn, časová osa, detektory, vyhodnocení změny. |
| 5 Hlas | Hotovo: výstup, tichý režim, hlasitost, četnost; vstup v samostatné verzi. |
| 6 Mobil | Rozhraní pro telefon a synchronizace hotové; sdílení snímků vložením nebo fotkou. **Systémová oznámení** jen při otevřené aplikaci (samostatná verze, skryté okno). **Oznámení na zavřený telefon neumí** (potřebuje vlastní server). |
| 7 Vzdělávání | Hotovo: 28 lekcí (A až E), sedm částí lekce, schéma, cvičení, ověření znalostí, trenér rozhodování, osobní rozvoj. |

## 3. Co aplikace záměrně neobsahuje

- Klient pro Windows (Tauri) a server s PostgreSQL ze zadání § 1: nahrazeno jednou webovou aplikací (důvod v `docs/ARCHITEKTURA_V2.md`).
- Dekódování polí taktiky z `.fmf`: není známo, jak jsou uložená, a zadání zakazuje hádání.
- Oznámení na zavřený telefon (push) a překryvné okno nad hrou (Document Picture-in-Picture).
- Čtení naskenovaných PDF bez textové vrstvy (OCR).
- Ověření OpenAI-kompatibilního rozhraní proti živé službě (zkoušeno jen proti napodobenině serveru; v aplikaci je označené jako neověřené). Adaptér Anthropic ověřen jen proti napodobenině rozhraní, ne proti živému API.

## 4. Automatické zkoušky

| Zkouška | Počet | Jak spustit |
|---|---|---|
| Jádro v Node (`trener/test/*.test.mjs`) | 484 | `node --test trener/test/*.test.mjs` |
| Serverové jádro v Pythonu (`ai_gateway/`) | 135 (16 se přeskočí bez doplňkových knihoven) | `python3 -m unittest discover -s ai_gateway/tests -t .` |
| Inspektor FMF v Pythonu (`fmf_research/`) | 11 (potřebují `zstandard`) | `python3 -m unittest discover -s fmf_research/tests -t .` |
| Prohlížeč, celá aplikace (`trener/test/e2e/`) | 421 | viz `trener/README.md` |

Prohlížečové zkoušky: 01 poradce (92), 02 kariéry a synchronizace (23), 03 tým a taktiky (37), 04 laboratoř a soupeř (32),
05 Live Coach (43), 06 sdílení obrazovky (24), 07 historie a rozbor (21), 08 škola (31), 09 hlas a oznámení (50),
10 samostatná verze: vlastní klíč, service worker, offline, instalace (43), 11 průchod všemi obrazovkami: zbloudilý text,
vodorovné posouvání, čitelnost písma ve světlém i tmavém vzhledu (25).

Pythonové zkoušky hlídají i to, že se do repozitáře nedostal klíč ani text podobný klíči (test `test_no_secrets` prochází všechny textové soubory).

## 5. Co potřebuju od tebe (a kde to udělat)

1. **Vyzkoušet stránku v Claude** (počítač i telefon, stejný účet): https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh
   Claude se při prvním použití zeptá na povolení. Přidej aspoň jednu skutečnou knihu: v aplikaci „Zdroje znalostí“.
2. **Zapnout GitHub Pages** (jednou), aby šla nainstalovat samostatná verze se sdílením obrazovky a mikrofonem:
   https://github.com/janvasilecko-droid/FM27-apka/settings/pages, v části „Source“ zvol **GitHub Actions**. Potom spusť nasazení:
   https://github.com/janvasilecko-droid/FM27-apka/actions/workflows/pages.yml (tlačítko „Run workflow“). Sestavení už na serveru
   GitHubu prošlo, nasazení se zastavilo jen proto, že Pages ještě nejsou zapnuté.
3. **Skutečné vzorky z FM27**: tři exporty `.fmf` a 3 až 5 screenshotů (zápas, statistiky, taktika) s tím, co na nich vidíš.
4. **Vlastní klíč AI** (jen pro samostatnou verzi): vytvoř ho na https://console.anthropic.com/settings/keys a vlož ho
   **jen do Nastavení v aplikaci**. Nikdy ho neposílej do chatu.
5. **Zkouška Live Coache na Windows**: samostatná verze v Chrome nebo Edge, sdílet okno FM27, okno aplikace nechat vidět vedle hry.
