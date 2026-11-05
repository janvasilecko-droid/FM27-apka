# Plán rozšíření FM27 Tactical Coach (etapa 1: audit, architektura, plán, rizika, licence)

Navazuje na zadávací dokument majitele z 5. 11. 2026 („MASTER PROMPT – rozšíření podle nejlepších existujících analytických aplikací“). Obsah odpovídá požadovanému prvnímu výstupu:
1. audit současné aplikace, 2. srovnávací tabulka (je v `REFERENCE_ANALYSIS.md`, část 7), 3. přehled algoritmů (`REFERENCE_ANALYSIS.md` a `ANALYTICS_METHODOLOGY.md`),
4. co převzít a 5. co vyvinout (`REFERENCE_ANALYSIS.md`, část 8), 6. datová architektura, 7. etapy, 8. rizika, 9. závislosti a licence.

## 1. Audit současné aplikace

*Popis stavu k zahájení rozšíření (5. 11. 2026, před etapou 2). Co se od té doby změnilo, je ve sloupci „Stav“ tabulky etap v části 3 a v `ANALYTICS_METHODOLOGY.md`.*

### 1.1 Technologie a stavba
- **Jazyk a stavba:** čistý JavaScript bez rámce, bez balíčků za běhu; `trener/build.mjs` slepí moduly do jednoho souboru ve dvou podobách: **stránka v Claude** (artefakt, `window.claude`) a **samostatná aplikace** (PWA na GitHub Pages).
- **Moduly:** čisté moduly bez DOM (UMD, běží v prohlížeči i v Node: `core`, `tactics`, `analysis`, `rolefit`, `matchlens`, `careerread`, `tableimport`, `school`, `alerts`, `opponent`, `report`, …) a rozhraní (`ui`, `store`, `ai`, `live`, `feed`, obrazovky v `screens/`). Výpočty jsou oddělené od vzhledu a mají jednotkové zkoušky.
- **AI:** ve stránce v Claude schopnost `sample` z účtu uživatele; v samostatné verzi vlastní klíč (Anthropic nebo OpenAI-kompatibilní), klíč jen v prohlížeči. Každá odpověď prochází **kontrolou poctivosti** (úrovně důkazu, odkazy, jistota, „proč“).
- **Data:** místní úložiště v prohlížeči (IndexedDB, dokument do 240 kB) s volitelnou synchronizací počítač ↔ telefon přes `db` artefaktu; kariéry jsou odděleně, každý záznam nese `careerId`; záloha a obnova.
- **Čtení hry:** snímky obrazovky přečte Claude (návrh k potvrzení), okno hry jedním kliknutím (samostatná verze), export tabulek hráčů (CSV, TSV, HTML, JSON), plugin FMMatchLens (agregované statistiky a sestava, jen samostatná verze), klub ze snímku nebo z pluginu. **Paměť hry se nečte.**
- **Zkoušky (k zahájení rozšíření):** 661 testů jádra (Node), 143 + 11 v Pythonu (shoda validátoru, hlídání klíčů), 756 kontrol v prohlížeči (Playwright, 19 scénářů); po etapě 2: 739 testů jádra a 817 kontrol v 20 scénářích; po čtečce kontejneru `.fmf`: 765 a 834 v 21. **Všechno proti náhražkám Claude, `db`, pluginu a sdílení obrazovky; nic proti skutečnému FM27.**

### 1.2 Co je skutečně funkční (zkoušeno na náhražkách) a co ne

| Oblast | Stav | Poznámka |
|---|---|---|
| Kariéry, soupiska, taktiky (ruční zadání, plán `.json`, čtení ze screenshotu) | **funkční** | Role a instrukce se přepisují přesně tak, jak je hra píše; neověřený návrh potvrdí uživatel. |
| Soubor taktiky `.fmf` | **jen struktura** | Inspektor čte strukturu; **pole taktiky se nedekódují** (formát není ověřen na skutečném souboru, nehádáme). |
| Vhodnost hráče na roli, nejlepší sestava (maďarský algoritmus), slabá místa | **funkční, jednoduché** | Jedna role na místo, váhy 2/1, stupnice 20 → 100 (1 → 5), bez B-týmu, bez zámků, bez hloubky. |
| Dvě fáze hry (s míčem / bez míče) | **chybí** v modelu role | Laboratoř kreslí oba tvary, ale místo taktiky má jednu roli. |
| Taktická laboratoř (geometrie, přečíslení soupeře) | **funkční** | Prahy jsou vlastní heuristiky; nejde o simulaci zápasu. |
| Hodnocení taktiky a rozporů (instrukce, kombinace rolí) | **chybí** | Je jen geometrie rozestavení. |
| Živý zápas: snímky, detektory, rada, vyhodnocení změny | **funkční** | Z agregátů; **bez poloh, bez událostí**. |
| Plugin FMMatchLens | **funkční proti náhražce** | Čte `/health`, `/meta`, `/current`; **nečte `/frames` a události**; tvar odpovědí neověřen na skutečné hře. |
| Tepelné mapy, síť přihrávek, mapa střel, vlastní xG | **chybí** | Vyžadují prostorová data (plugin frames a události); xG se jen čte ze hry. |
| Soupeř (profil, plán) | **částečně** | Plán je textový rozbor; strukturovaný plán A/B a větve „vedeme / remíza / prohráváme“ chybí. |
| Přestupový poradce | **chybí** | Neexistuje fond kandidátů; údaje o ceně a mzdě se nikde neukládají. |
| Paměť kariéry | **částečně** | Zápasy, taktiky, soupiska, poznámky; chybí historie výkonů hráčů, přestupů, zranění, **seznam doporučení a jejich úspěšnosti**. |
| Rozbor po zápase | **funkční** | Graf, období, změny, nálezy; chybí tepelné mapy, sítě přihrávek, mapa střel a **vyhodnocení, zda předchozí rada pomohla**. |
| Škola taktiky | **funkční** | 28 lekcí, scénáře, kvízy, „co udělat“ a „proč“. |
| Vzhled, použitelnost za zápasu | **funkční** | Světlý i tmavý, telefon; kontrast hlídá zkouška. |

### 1.3 Nalezené nedostatky, duplicity a neúplnosti
1. **Role bez dvou fází** je největší mezera proti FM27 (každé místo má roli s míčem i bez míče; plugin je čte, naše taktika ne).
2. **Vhodnost na roli používá jen atributy z profilu role** a stupnici, ve které nejhorší hráč nemá 0 (20 → 100, 1 → 5). Etapa 2 přidává DWRS s přepočtem 1 → 0.
3. **Duplicitní kód:** kontrola poctivosti rady je záměrně ve dvou jazycích (JavaScript a Python) s paritními zkouškami (103 případů). Python (`ai_gateway/`) aplikace za běhu nepoužívá; je to referenční serverové jádro. Není to chyba, ale údržba dvou kopií je nevýhoda, proto paritní zkouška.
4. **Prahy a váhy jsou vlastní odhady** (M3, M5, M7, M11, M12 v `ANALYTICS_METHODOLOGY.md`): nejsou ověřené proti FM27 a nejde je měnit v aplikaci.
5. **Čtení hry stojí na obrazovce a na pluginu** (nezkoušeno na skutečné hře). Přesnost čtení obrázků Claudem se ukáže až u majitele.
6. **Žádná falešná tlačítka ani makety jsem nenašel**; funkce, které chybí, v aplikaci nejsou (sekce se nepředstírají).

## 2. Datová architektura (návrh nejmenšího bezpečného rozšíření)

**Zásady.** Nepřepisovat funkční části. Všechno nové jako **čisté moduly** (bez DOM) + tenké obrazovky. Všechny moduly sdílejí jeden datový model v existujícím úložišti (`store.js`).
Každý záznam má `careerId`, čas a **původ údaje** (`user_entered`, `screenshot_verified`, `vision_unverified`, `fmmatchlens`, `computed`). Každý výstup nese `inputs` (co se do něj započítalo) a štítek (VERIFIED, SOURCE-BASED, CUSTOM MODEL, ESTIMATED, UNKNOWN).

**Typy záznamů (stávající → nové):**

| Typ | Stav | Obsah |
|---|---|---|
| `career`, `player`, `tactic`, `match`, `opponent`, `memory`, `progress`, `settings`, `advice`, `source`, `roleprofile` | existují | beze změny tvaru |
| `weightprofile` | **hotovo (etapa 2)** | pojmenovaný profil vah DWRS: kategorie atributů po skupinách pozic, násobiče, popis změn oproti výchozímu; globální (bez `careerId`) |
| `lineup` | **odloženo (etapa 7)** | uložená sestava A + B (taktika, hráči po místech, součty, čas, otisk vstupů) pro porovnání v čase; v etapě 2 se sestava jen počítá a porovnává „před a po změně“, do historie se neukládá |
| `slot.oop` | **rozšíření taktiky (etapa 4)** | volitelná druhá role místa (bez míče: `role`, `duty`); starší taktiky bez ní zůstávají platné |
| `candidate` | **nový (etapa 3)** | cizí hráč jako kandidát na přestup: atributy (viditelné), věk, `price`/`wage` (`null` = UNKNOWN), původ, poznámka, stav jednání s platností |
| `recommendation` | **nový (etapa 3 a 6)** | doporučení (přestup, změna taktiky): čas, kariéra, důvod, použitá data, očekávaný přínos, **skutečný výsledek** doplněný později |
| `matchframes` / události | **nový (etapa 5)** | polohy a události ze zápasu (jen z pluginu); ukládat po částech mimo dokument 240 kB |

**Moduly (čisté, s jednotkovými zkouškami) a obrazovky:**

| Modul podle zadání | Čistý modul | Obrazovka |
|---|---|---|
| Player Analytics | `dwrs.js` (nový), `rolefit.js` (stávající) | Můj tým (detail hráče), Nastavení (správa vah) |
| Squad Optimizer | `squadopt.js` (nový) | Moje taktiky (sestava A/B) |
| Recruitment Advisor | `recruit.js` (etapa 3) | Můj tým / nová sekce |
| Tactic Analyzer | `tacticanalysis.js` (etapa 4) | Taktická laboratoř / Moje taktiky |
| Live Match Analytics | `heat.js`, `passnet.js`, `shotmap.js` (etapa 5) | Live Coach, Historie |
| AI Match Coach | `analysis.js` (stávající), `coach.js` (etapa 6) | Live Coach, Osobní trenér |
| Opponent Analysis | `opponent.js` (stávající, rozšíření etapa 6) | Analýza soupeře |
| Career Memory | `store.js` + `recommendation` (etapa 3 a 7) | Historie zápasů, Osobní trenér |
| Post-Match Analysis | `report.js` (stávající, rozšíření etapa 7) | Historie zápasů |
| Tactical Academy | `school.js` (stávající) | Škola taktiky |

## 3. Etapy a kritéria hotovosti

Každá etapa končí: čisté moduly s jednotkovými zkouškami (včetně hrubé síly u optimalizací), zkouška v prohlížeči, aktualizace `ANALYTICS_METHODOLOGY.md` (vzorec, zdroj, štítek, příklad), mutační kontrola (úmyslná porucha musí zkoušku shodit), nasazení a ověření.

| Etapa | Obsah | Závisí na | Stav |
|---|---|---|---|
| **1. Audit** | tyto tři dokumenty | – | **hotovo** (5. 11. 2026) |
| **2. Hráči a sestava** | DWRS (kategorie 8/4/2/1/0,2, násobiče 1,5/1,2/1,0, normalizace 0 až 100), model brankáře, přednastavené profily a správa vah, role s rozpadem po atributech, sestava A + B (přísné pořadí cílů), slabé pozice, dopad změn | profily rolí z obrazovky (hotovo) | **hotovo na náhražkách** (5. 11. 2026): `dwrs.js`, `squadopt.js`, karta Nejlepší sestava (A + B, zámky, vyřazení, zranění, náhrady s dopadem, hloubka, dopad výpadku, rizika), rozbor hráče, správa vah v Nastavení; metodika M15 až M22. Ověření DWRS na skutečných datech FM27 čeká na majitele. Z plánu **nevzniklo** ukládání sestav do historie (`lineup`, odloženo na etapu 7) a obrazovka pro podobné hráče (funkce je hotová, použije ji etapa 3) |
| **3. Přestupový poradce** | kandidáti (export tabulek, ruční zadání), role-based hledání, simulace příchodu a odchodu s přepočtem sestavy, cena a mzda jen zadané (jinak UNKNOWN), historie doporučení | etapa 2; zdroj kandidátů (exporty) | čeká |
| **4. Tactic Analyzer** | model taktiky se dvěma fázemi, pravidla rozporů se sedmi poli, čtyři vlastní skóre, kontrola instrukcí | etapa 2; **skutečný `.fmf` export taktiky FM27 od majitele** | **zahájeno** (5. 11. 2026): majitel poslal tři skutečné exporty; **kontejner `.fmf` je rozluštěný a aplikace ho čte** (`docs/FORMAT_FMF.md`, `fmfcontainer.js`); rozbor polí taktiky uvnitř běží, jejich ověření potřebuje snímky obrazovky těchže taktik ze hry |
| **5. Live Match Analytics** | čtení `/frames` a událostí, tepelné mapy, síť přihrávek, mapa střel, časová osa s návratem, archiv | **ověření tvaru dat na skutečném pluginu a souborech `.fmlens`** | čeká |
| **6. AI Match Coach** | diagnostika příčin z dat, priorizace jedné změny, sledování výsledku změny, plán A/B a větve soupeře | etapy 4 a 5 | čeká |
| **7. Kariéra a výuka** | historie výkonů a doporučení s úspěšností, rozšířený rozbor po zápase, rozšíření školy | etapy 3 až 6 | čeká |
| **8. Kompletní testování** | integrační a regresní zkoušky, výkon, kompatibilita FM27 | vše | čeká |

## 4. Technická rizika

| Riziko | Závažnost | Opatření |
|---|---|---|
| **Žádná zkouška proti skutečnému FM27** (formáty, plugin, čtení obrazovky) | vysoká | Výstupy mají štítky a „neověřeno“; každá etapa uvádí, co čeká na majitele; nejdřív ověřit na skutečných souborech. |
| **Váhy atributů a prahy jsou odhady**, ne pravidla FM27 | vysoká | Štítek ESTIMATED / CUSTOM MODEL, upravitelné profily, vysvětlený rozpad, srovnání výsledků při různých vahách. |
| **Dekódování `.fmf` bez skutečného vzorku** | vysoká | Nedekódovat bez ověření; požádat majitele o export taktiky; cizí dekodér (nelicencovaný) nepřebírat. |
| **Plugin FMMatchLens je nový**, API se může změnit | střední | Číst jen podle ověřeného tvaru, jasná chyba při odlišné odpovědi, náhražka ve zkouškách. |
| **Velká data (polohy po tikách)** v prohlížeči | střední | Řídké vzorkování, ukládání po částech, výpočet v dávkách. |
| **Skrytá data** (CA, PA, reputace) lákají k odvozování | střední | Nikdy se nečtou a nepoužívají; zkoušky to hlídají. |
| **Licence** (GPL, bez licence) | střední | Jen metody, vlastní kód; MIT kód jen s oznámením. |
| **Rozsah zadání** (osm etap) | vysoká | Etapy s kritérii hotovosti; nic se nepředstírá; co chybí, v aplikaci není. |
| **Přesnost čtení obrázků Claudem** | střední | Návrh k potvrzení; levné přečtení, kontrola rozsahů; nikdy automatická změna dat. |

## 5. Závislosti a licenční omezení

**Naše závislosti:** žádné knihovny za běhu. Písma Inter a Barlow (SIL OFL) z Google Fonts; čtení PDF pdf.js (Apache-2.0, z cdnjs); dekomprese fzstd (MIT, jen inspektor `.fmf`). Vývoj a zkoušky: Node, Playwright (Apache-2.0), Python s `reportlab`.

**Referenční projekty:**

| Projekt | Licence | Povolené použití v našem repozitáři (veřejném) |
|---|---|---|
| FMMatchLens | MIT | Kód lze převzít s oznámením o autorských právech a zachováním licence. Zatím nepřebráno nic. |
| FM Player Analyzer | GPL-3.0 | Jen metody a matematika vlastním kódem. Kopie kódu nebo tabulek by vztáhla GPL na celou aplikaci. |
| FM AI Assistent | **UNLICENSED** (bez práv k užití) | Nic nepřebírat; studovat a psát vlastní řešení podle principů. |
| FM Scout Tactic Analyser, AssMan.AI, FM Companion Tactic Lab | vlastnické webové služby | Jen veřejně popsané funkce jako inspirace; žádný kód ani výstupy. |

**Co potřebuji od majitele, aby šlo pokračovat poctivě** (nic z toho nepožaduju vložit do chatu jako klíč či heslo):
1. Export taktiky FM27 (`.fmf` ze složky `Documents › Sports Interactive › Football Manager 27 › tactics`), nejlépe dvě různé taktiky: bez něj nelze etapu 4 postavit bez hádání.
2. Jeden až dva soubory `.fmlens` ze zápasu s pluginem FMMatchLens a potvrzení, že plugin smí na tvém počítači běžet: bez toho nelze ověřit etapu 5.
3. Screenshoty popisu několika rolí z FM27 (profil rolí z obrazovky), případně export tabulky kádru z FM View Exporteru: pro ověření DWRS na skutečných datech.
