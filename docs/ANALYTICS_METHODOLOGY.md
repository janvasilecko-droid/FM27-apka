# Metodika výpočtů (registr)

U každého výpočtu aplikace je tu název, vzorec, zdroj, štítek, předpoklady, omezení a ukázkový příklad s čísly. Každý analytický výstup v aplikaci má být schopný ukázat,
z čeho vznikl (rozpad po atributech, použité snímky, prahy). Zkoušky jsou uvedené u každého výpočtu; počty viz `AKCEPTACNI_MATICE.md`.

## Štítky

| Štítek | Význam |
|---|---|
| **VERIFIED** | Ověřeno z dostupného zdroje nebo ze skutečných herních dat (čtení zdroje pluginu se nepočítá: viz SOURCE-BASED). Žádný výpočet dosud nemá štítek VERIFIED proti skutečnému FM27. |
| **SOURCE-BASED** | Doloženo veřejnou dokumentací, veřejným algoritmem nebo čtením zdrojového kódu cizího projektu (zdroj je uveden). |
| **CUSTOM MODEL** | Vlastní výpočet nebo vlastní pravidlo této aplikace (práh, váha, heuristika). Není to pravidlo FM27. |
| **ESTIMATED** | Odhad autora z komunitní zkušenosti, bez ověření proti enginu FM27. Musí být upravitelný a označený. |
| **UNKNOWN** | Hodnota není známa. Nikdy se nenahrazuje nulou ani vymyšleným číslem. |

Pozn.: „VÝPOČET“ v tabulkách znamená hodnotu spočtenou aplikací z vložených údajů, ne údaj ze hry.

## 1. Implementované výpočty

### M1. Vhodnost hráče na roli (verze 1: klíčové a žádoucí atributy)
- **Vzorec:** `skóre = Σ(hodnota × váha) / Σ(20 × váha) × 100`; váha klíčového atributu 2, žádoucího 1. Seznam klíčových a žádoucích atributů je **profil role** přečtený z obrazovky role ve hře (nebo zadaný ručně).
- **Zdroj:** vlastní model; princip váženého průměru atributů podle role je obecný (FM Player Analyzer, FM AI Assistent). **Štítek: CUSTOM MODEL** (váhy 2 a 1 jsou naše volba), profil role: zadal uživatel nebo z obrazovky (neověřeno, dokud ho nepotvrdí).
- **Předpoklady:** atributy jsou celá čísla 1 až 20. **Chybí-li hráči atribut profilu, výsledek je „nedostupné“ (UNKNOWN), ne nula**; částečný výpočet jen na výslovné přání při aspoň 80 % váhy. Skryté údaje hry (CA, PA, osobnost, reputace) se nikdy nepoužijí.
- **Omezení:** stupnice 20 → 100, ale 1 → 5 (ne 0). Proto je vedle něj DWRS (M15) s přepočtem 1 → 0; v sestavě se model volí v Nastavení.
- **Příklad:** klíčové Finishing 16 a Off The Ball 14, žádoucí Dribbling 12: body = 16·2 + 14·2 + 12·1 = 72, maximum 20·(2 + 2 + 1) = 100, **skóre 72,0**.
- **Zkoušky:** `rolefit.test.mjs` (18), scénář 18.

### M2. Přiřazení hráčů k místům sestavy
- **Vzorec:** maximalizace součtu vhodností při podmínce, že hráč je použit nejvýš jednou a místo nejvýš jedním hráčem. Maďarský algoritmus (Kuhn–Munkres, složitost O(n²m)), maximalizace převedená na minimalizaci `náklad = nejvyšší zisk − zisk`. **Přísné pořadí cílů** kódované celými čísly: nejdřív co nejvíc obsazených míst (konstanta 1 000 000), pak největší součet (na desetiny bodu), nakonec pořadí hráčů jako tajbrejk.
- **Zdroj:** algoritmus je veřejný (Kuhn 1955, Munkres 1957); použití pro sestavu: FM Player Analyzer a FM AI Assistent (princip). **Štítek: SOURCE-BASED** (algoritmus), cíle: CUSTOM MODEL.
- **Předpoklady:** způsobilost podle pozic (přísně, nebo volně); místo bez profilu role se neobsazuje.
- **Omezení:** místo má jednu roli (dvě fáze hry zatím ne).
- **Příklad:** hráč P1 má vhodnost 80 na místo „Finisher“ a 60 na „Passer“, hráč P2 má 75 a 50. Chamtivě (nejvyšší číslo první) vyjde P1 na Finisher a P2 na Passer: **80 + 50 = 130**. Optimum je P2 na Finisher a P1 na Passer: **75 + 60 = 135**. Aplikace vrací 135.
- **Zkoušky:** shoda s hrubou silou na 900 náhodných instancích (`rolefit.test.mjs`), scénář 18.

### M3. Slabá místa sestavy
- **Vzorec:** místo je slabé, když `medián − vhodnost ≥ 8` bodů (medián obsazených míst, aspoň 3 obsazená); neobsazené místo s rolí je slabé vždy.
- **Zdroj:** nápad z FM Player Analyzer (práh 8 tam není zdůvodněn). **Štítek: CUSTOM MODEL** (práh 8 je heuristika).
- **Příklad:** vhodnosti 80, 78, 77, 60 → medián 77,5; místo s 60 je o **17,5** pod mediánem, tedy slabé.
- **Zkoušky:** `rolefit.test.mjs`.

### M4. Tempo a podíly v okně zápasu
- **Vzorec:** statistiky ve hře jsou kumulativní součty; tempo v okně = `(hodnota na konci − hodnota na začátku) / minuty × 10` (na 10 minut); podíl = `moje / (moje + soupeřovy)`. Držení míče a přesnost přihrávek jsou procenta a tempo se z nich nepočítá. Záporný rozdíl (snímky si neodpovídají) se nepočítá a hlásí se.
- **Zdroj:** vlastní. **Štítek: VÝPOČET z vložených údajů; CUSTOM MODEL** v zacházení s okny.
- **Příklad:** soupeřovy střely 8 v 40. minutě a 12 v 50. minutě → tempo `(12 − 8) / 10 × 10 =` **4 na 10 minut**.
- **Zkoušky:** `analysis.test.mjs`.

### M5. Detektory problémů v zápase (šest)
| Detektor | Podmínka (výchozí prahy) | Štítek |
|---|---|---|
| Držení bez šancí | naše držení ≥ 58 % a náš podíl střel i xG (kde jsou) < 40 %; posuzuje se od 6 střel nebo 0,6 xG obou týmů | CUSTOM MODEL |
| Soupeř má víc šancí | jeho střely nebo xG ≥ 1,8× naše a aspoň 3 jeho střely | CUSTOM MODEL |
| Soupeřovy střely zrychlují | tempo na 10 min v posledním okně ≥ 2× předchozí a aspoň 3 střely | CUSTOM MODEL |
| Prohráváme a nehrozíme | od 60. minuty prohráváme a aspoň 10 min nemáme střelu na bránu | CUSTOM MODEL |
| Pokles hodnocení hráče | o ≥ 0,8 mezi snímky | CUSTOM MODEL |
| Červená karta | fakt z události, žádný práh | VÝPOČET / z údajů |
- **Pravidla:** „upozornění“ jen když stav platí na dvou snímcích s odstupem aspoň 10 minut; jinak „sleduj“ (jedno měření). Každý nález říká, že nejde o diagnózu, nabízí „možnou příčinu k ověření“ a cituje svůj práh. Úroveň důkazu nálezu = nejslabší použitý snímek. **Neříká příčinu** a statistická odchylka sama není taktický problém.
- **Příklad:** držení 61 %, naše střely 3, soupeřovy 9 → náš podíl 3/12 = 25 % < 40 %, součet 12 ≥ 6 → spustí se „Držení bez šancí“; zároveň 9 ≥ 1,8 × 3 → „Soupeř má víc šancí“.
- **Zkoušky:** `analysis.test.mjs`, scénář 05.

### M6. Úroveň důkazu
- **Pravidlo:** úroveň závěru je úroveň nejslabšího podkladu: ověřený screenshot (observed) > zadané uživatelem (user_entered) > strojové čtení a heuristiky (inferred) > neznámé (unknown). Vysoká jistota jen se dvěma nezávislými ověřenými screenshoty. **Štítek: CUSTOM MODEL** (pravidlo poctivosti zadání).
- **Zkoušky:** `core.test.mjs`, shoda s Pythonem (103 případů), scénář 01.

### M7. Vyhodnocení změny taktiky
- **Vzorec:** okno před změnou = snímky se statistikami do minuty změny (20 minut zpět), okno po = snímky po změně (aspoň 8 minut mezi dvěma snímky). Pro každou metriku (střely, střely na bránu, xG; držení v procentních bodech) se porovná tempo na 10 minut: `vyšší / nižší / podobné` s pásmem ±15 % (držení ±1 p. b.). Úsek se samotnou změnou se nepočítá.
- **Pravidla poctivosti:** výsledek je jen popis; **časová souvislost není důkaz příčiny** (věta se připojí vždy); varování při malém vzorku (pod 6 střel obou týmů v okně) a při krátkém okně (pod 15 minut).
- **Štítek: CUSTOM MODEL.**
- **Příklad:** střely soupeře před změnou 3 za 20 minut (tempo 1,5), po změně 2 za 10 minut (tempo 2,0): relativní změna +33 % > 15 % → „vyšší“; mají-li oba týmy v oknech dohromady méně než 6 střel, přibude varování o malém vzorku.
- **Zkoušky:** `analysis.test.mjs`, scénáře 05 a 07.

### M8. Rozbor po zápase a graf průběhu
- Období po 15 minutách (součty z rozdílů snímků), změny s vyhodnocením (M7), nálezy (M5), poznámky o chybějících datech; graf je řada snímků, **nic se nedopočítává**. **Štítek: VÝPOČET / CUSTOM MODEL.** Zkoušky: `analysis.test.mjs`, `report.test.mjs`, scénáře 07 a 17.

### M9. Převod snímku z FMMatchLens
- **Vzorec:** minuta = `displayTick / 240`; držení míče = `100 · domácí čas / (domácí + hosté)`; přesnost přihrávek = `dokončené / všechny`; xG se **čte** (zaokrouhleno na 2 desetinná místa). **Údaje jsou „zadal uživatel, data od nástroje u tebe“, ne „ověřeno hrou“.**
- **Zdroj:** čtení zdrojového kódu pluginu 0.7.x (MIT). **Štítek: SOURCE-BASED**; tvar odpovědí nebyl ověřen na běžící hře. xG: nikdy se nepočítá vlastním modelem.
- **Zkoušky:** `matchlens.test.mjs` (18), scénář 16 (falešný plugin).

### M10. Politika hlasových upozornění a brána snímků
- Podle četnosti nízká / běžná / vysoká: odstup mezi upozorněními 180 / 75 / 30 s a nejvýš 2 / 4 / 8 běžných upozornění za 10 minut; naléhavé po 15 s; stejné upozornění se do 5 minut neopakuje. Snímek obrazovky jde k AI jen když se obraz změnil, ustálil a v rámci limitů (15 s, 60 za hodinu, 150 za zápas). **CUSTOM MODEL.** Zkoušky: `alerts.test.mjs`, `analysis.test.mjs`.

### M11. Geometrie taktické laboratoře
- Řady podle shlukování na ose y (mezera nad 8 jednotek = nová řada), mezera mezi řadami nad 30, osamělý hráč nad 40 jednotek od nejbližšího, překryv pod 5, zajištění méně než 3 hráči za půlící čárou, nevyváženost stran o víc než 1, tři a více prázdných kanálů v obranné třetině (varování), přečíslení soupeře v zóně (aspoň 2 a o 1 víc než my). **Je to geometrie nakresleného rozestavení, ne simulace zápasu.** **CUSTOM MODEL** (každý nález cituje svůj práh). Zkoušky: `tactics.test.mjs`, scénář 04.

### M12. Škola: hodnocení a obtížnost
- Lekce je probraná od 60 % v ověření; hodnocení tématu začíná na 50, klouzavý průměr s váhou nejnovějšího výsledku 0,2; opakování pod 40 nebo po chybě bez následné správné odpovědi po 2 dnech; obtížnost nahoru po 3 správných za sebou, dolů po 2 chybách. **CUSTOM MODEL.** Zkoušky: `school.test.mjs`, scénář 08.

### M13. Hledání v knihách (BM25)
- **Vzorec:** `skóre(d) = Σ_t IDF(t) · f(t,d)·(k1 + 1) / (f(t,d) + k1·(1 − b + b·|d|/avgdl))`, `IDF = ln(1 + (N − n + 0,5) / (n + 0,5))`, `k1 = 1,4`, `b = 0,75`; text bez diakritiky, lehké stemování; z jedné knihy nejvýš tři úryvky.
- **Zdroj:** Robertson a Spärck Jones (BM25). **Štítek: SOURCE-BASED** (vzorec), parametry volba autora. Úryvek z knihy je teorie, **ne důkaz o aktuálním zápase**. Zkoušky: `core.test.mjs`.

### M14. Kontrola poctivosti rady
- Pravidla ve `validateAdvice10` (JavaScript) a `advice10.py` (Python), společné případy (103): odkazy musí existovat, úroveň ne silnější než nejslabší důkaz, vysoká jistota jen se dvěma nezávislými ověřenými důkazy, nejvýš dvě změny, povinné „proč“ (aspoň 20 znaků), vymyšlené mechaniky se odmítnou. **CUSTOM MODEL (politika).** Zkoušky: `core.test.mjs`, Python, scénáře 01 a 08.

### M15. DWRS: vážené hodnocení hráče na roli (etapa 2)
- **Vzorec:** atributy skupiny pozic jsou rozdělené do pěti kategorií důležitosti (extrémně důležitý, důležitý, dobrý, přijatelný, téměř nepodstatný) s váhami **8 / 4 / 2 / 1 / 0,2**. Váha jednoho atributu je `w = váha kategorie × násobič role × kontextový násobič / počet atributů v kategorii` (to je „průměr v kategorii“ rozepsaný po atributech); násobič role je **1,5** pro klíčový atribut role, **1,2** pro žádoucí a **1** pro ostatní. `skóre = (Σ w·hodnota − Σ w) / (19 · Σ w) × 100`: hráč se samými jedničkami má 0, hráč se samými dvacítkami 100 (u M1 má nejhorší hráč 5).
- **Zdroj:** čísla kategorií, násobiče role a normalizace jsou podle veřejně popsané metody (komentáře ve zdroji FM Player Analyzer, GPL-3.0); převzata je jen matematika, **žádný kód ani tabulka**. **Štítek: SOURCE-BASED** (kategorie, násobiče, normalizace). **Tabulky „který atribut patří do které kategorie“ po skupinách pozic (střední obránce, krajní obránce, defenzivní záložník, střední záložník, křídlo, ofenzivní záložník, útočník, brankář) jsou vlastní odhad autora aplikace: ESTIMATED**, ne pravidlo FM27, a dají se upravit (M16). **Brankář** má vlastní stupnici kategorií 3 / 2 / 1 / 0,5 / 0,2 a vlastní tabulku atributů (**CUSTOM MODEL**), protože brankářský model se podle zdroje liší.
- **Předpoklady:** atributy jsou celá čísla 1 až 20; role (klíčové a žádoucí atributy) pochází z profilu role z obrazovky nebo ručního zadání. Atribut role, který v tabulce skupiny není (třeba útočný atribut u brankáře), se nepočítá a je to vidět. **Chybí-li hráči atribut z tabulky, výsledek je „nedostupné“ (UNKNOWN), nikdy nula**; částečný výpočet jen na přání při aspoň 80 % váhy a je označený. Skryté údaje hry (CA, PA, osobnost, reputace) se nepoužijí.
- **Omezení:** výsledek je odhad: tabulky kategorií nejsou ověřené proti enginu FM27 (**nikdy nezkoušeno proti skutečné hře**). Skupina pozic role se bere z nastavení u role, jinak z pozice místa v taktice, jinak z anglického názvu role; kde to nejde, role se nehodnotí a je to řečeno.
- **Příklad (zkouška to počítá):** skupina útočník, role Poacher (klíčový Finishing, žádoucí Off The Ball), hráč má všechny atributy 10 kromě Finishing 16 a Off The Ball 14. V kategorii „extrémně důležitý“ jsou 3 atributy (Finishing, Acceleration, Pace), takže váha Finishing je 8 × 1,5 / 3 = **4,0**, Pace 8 / 3 = 2,667; Off The Ball je ve 4 „důležitých“: 4 × 1,2 / 4 = **1,2**. Σ w = 16,733, Σ w·hodnota = 196,133, minimum 16,733, maximum 334,667 → **skóre 56,4**. Hráč se samými 10 má 47,4 (= 9 / 19), se samými 20 má 100, se samými 1 má 0.
- **Zkoušky:** `dwrs.test.mjs` (39), scénáře 20.

### M16. Správa vah DWRS: profily, přednastavení, porovnání (etapa 2)
- **Co to je:** profil vah = váhy kategorií (hráči z pole i brankář), násobiče role, **kontextové násobiče atributů** (styl hry) a přesuny atributu do jiné kategorie. Přednastavení: Univerzální analytik (bez změn), Rychlostní fotbal, Poziční fotbal, Pressing, Protiútoky, Technický fotbal. Přednastavení jsou **kontextové násobiče** (např. Rychlostní: Pace a Acceleration ×1,5, Agility, Stamina, Work Rate ×1,2); posun kategorie se nepoužívá, protože by v kategorii zředil průměr.
- **Poctivost:** každé přednastavení i každý vlastní profil umí vypsat, **co přesně změnil** oproti výchozímu odhadu (`describeProfile`) a v čem se liší od jiného profilu (`compareProfiles`). Neplatné hodnoty se nepřijmou s vysvětlením (váha 0 až 100, násobič role 1 až 3, kontextový násobič 0,1 až 5). Nic se nepřepíše potichu: úprava se ukládá jako vlastní profil (typ `weightprofile`, synchronizuje se jako ostatní data). Návrat k výchozímu odhadu jedním kliknutím, vlastní profily zůstávají.
- **Štítek: ESTIMATED** (obsah přednastavení je odhad autora, ne pravidlo FM27), úpravy uživatele: zadal uživatel.
- **Zkoušky:** `dwrs.test.mjs`, scénář 20 (přednastavení, úprava, neplatné hodnoty, porovnání, smazání, záloha).

### M17. Sestava A + B v jedné úloze s přísným pořadím cílů (etapa 2)
- **Vzorec:** přiřazení hráčů k místům taktiky maďarským algoritmem (jako M2) s **přísným pořadím cílů**: 1) co nejvíc obsazených míst A, 2) největší součet vhodnosti A, 3) co nejvíc obsazených míst B, 4) největší součet B. Pořadí je vynucené celočíselným kódováním zisků (`A: t + S2·v + S3`, `B: t + S0·v + S1`, kde `v` je vhodnost v desetinách bodu a každá úroveň S je větší než součet všech nižších), takže B nikdy nepřebije A, ale při shodě v A vybere nejlepší B. Hráč je nejvýš jednou (v A, nebo v B). Pokud by kódování přetáklo (stovky míst), výpočet se odmítne místo špatného výsledku.
- **Zdroj:** algoritmus je veřejný (Kuhn–Munkres); strategie „nejdřív základní sestava, pak nejlepší lavička“ a přísné pořadí je princip z FM Player Analyzer (GPL-3.0; jen myšlenka). **Štítek: SOURCE-BASED** (algoritmus a princip), **CUSTOM MODEL** (cíle, tajbrejk podle pořadí hráčů v soupisce).
- **Předpoklady:** způsobilost podle pozic (přísně, nebo volně), místo bez profilu role se neobsazuje; hráč, kterého nejde ohodnotit (chybí atribut), se do sestavy nedostane a je v seznamu „mimo sestavu“ s důvodem. Model hodnocení: jednoduchý (M1) nebo DWRS (M15).
- **Příklad (zkouška to počítá):** dvě místa (útočník, stoper) a hráči a1 (útočník, 100), a2 (stoper, 100), X (obojí: 80 jako útočník, 10 jako stoper), Y (útočník, 50). A = a1 + a2 = **200**. Lavička B: buď X na útočníka (80) a stoper prázdný (jedno obsazené místo), nebo Y na útočníka (50) a X na stopera (10): **dvě obsazená místa, součet 60**. Přednost má počet obsazených míst, takže B je 60, ne 80.
- **Zkoušky:** `squadopt.test.mjs` (shoda s hrubou silou na 240 + 150 + 180 náhodných úlohách se zámky, vyřazením a zraněním, shoda se starou funkcí `assignBest`, příklady výše, mutační kontrola), scénáře 18 a 20.

### M18. Omezení: zámky, vyřazení, zranění (etapa 2)
- **Pravidla:** **zámek** (uživatel dá hráče na místo A) drží vždycky, i mimo pozici (s příznakem „zamčeno uživatelem, nemá pozici místa“); zamčený hráč není nikde jinde ani v B. Zámek, který nejde použít (neznámé místo, hráč není v soupisce, je zraněný nebo vyřazený, je zamčený na dvou místech), se **nepřijme a aplikace to řekne**. **Zraněný** hráč (příznak v Můj tým) a **vyřazený** (volba na kartě sestavy) se do A ani B nedá a je v seznamu „mimo sestavu“. Únava je jen informace.
- **Zdroj:** princip omezení a náhrad je z FM AI Assistent (bez licence: jen myšlenka). **Štítek: CUSTOM MODEL.**
- **Zkoušky:** `squadopt.test.mjs`, scénář 20.

### M19. Náhrady s dopadem a „naruší jiné místo“ (etapa 2)
- **Vzorec:** pro každé místo A jsou nejlepší tři jiní hráči s vypočtenou vhodností. U každého se **přepočítá nejlepší sestava se zámkem toho hráče na tomhle místě**, takže `dopad = součet A po − součet A před` je přesný včetně řetězových posunů. Stav: volný (teď nehraje), na lavičce (v B), **hraje jinde (naruší jiné místo A)**.
- **Zdroj:** vlastní (princip „disrupts another slot“ z FM AI Assistent). **Štítek: CUSTOM MODEL.**
- **Příklad (zkouška):** dopad náhrady = rozdíl mezi optimem a optimem se zámkem; musí být ≤ 0 a rovnat se přepočtu.
- **Zkoušky:** `squadopt.test.mjs`, scénář 20.

### M20. Hloubka soupisky, dopad výpadku a rizika (etapa 2)
- **Hloubka místa:** počet dostupných hráčů s vypočtenou vhodností na roli místa: **0 = nikdo (mezera), 1 = jediný hráč (tenká), 2 a víc = pokryto**.
- **Dopad výpadku:** pro každého hráče základní sestavy se znovu najde optimum bez něj. Závažnost: **kritické** = místo zůstane prázdné, nebo klesne součet A o 15 a víc; **citelné** = o 6 a víc; jinak nízké. Prahy 15 a 6 jsou **CUSTOM MODEL** (jdou změnit v kódu, ne v obrazovce).
- **Rizika soupisky:** jen z toho, co aplikace spočítala a zná: mezera nebo tenká hloubka, kritický výpadek, méně než dva použitelní brankáři (jen když jsou pozice hráčů zadané), hráči, které nejde ohodnotit.
- **Zkoušky:** `squadopt.test.mjs`, scénář 20.

### M21. Rozbor hráče (etapa 2)
- **Obsah:** DWRS na každou roli s profilem; **nejlepší tři role**, **nejhorší tři role** (jen z těch, které dávají smysl na pozicích hráče, bez překryvu), role bez hodnocení s důvodem; u nejlepší role **silné stránky** (atributy ≥ 12 s největším `w·(hodnota − 10,5)`) a **mezery** (atributy ≤ 9 s nejmenším příspěvkem); **pořadí v týmu** na nejlepší roli (jen z hodnotitelných hráčů, bez hlídání pozic); vhodnost na místa v aktivní taktice.
- **Štítek:** DWRS (ESTIMATED); prahy 12 a 9 a výběr tří jsou CUSTOM MODEL. Skupina pozic role: z nastavení u role, z použití v taktikách (jen když je jednoznačné), z anglického názvu; jinak se role nehodnotí.
- **Zkoušky:** `dwrs.test.mjs`, `squadopt.test.mjs`, scénář 20.

### M22. Podobní hráči (etapa 2, zatím bez obrazovky)
- **Vzorec:** `vzdálenost = √(Σ w·(x − y)² / Σ w)` přes atributy s váhou DWRS pro skupinu pozic; `podobnost = 100 · (1 − vzdálenost / 19)`. Hráč, kterému chybí atribut s váhou, se neřadí (je zvlášť v `unknown`), cíl bez atributů vrací chybu, nic se nehádá.
- **Štítek: CUSTOM MODEL** (míra podobnosti je vlastní). Funkce je v modulu a zkoušená (`squadopt.test.mjs`); v aplikaci ji používá přestupový poradce (M28: nejpodobnější kandidáti hráči, který by odešel).

### M23. Kandidát na přestup a čtení částek (etapa 3)
- **Co:** cizí hráč, kterého zadal uživatel (ručně nebo z exportu tabulky): jméno (2 až 60 znaků), věk 14 až 50, pozice jako kódy 1 až 4 písmen (nejvýš čtyři), viditelné atributy (celá čísla 1 až 20, nejvýš 40; skryté názvy se nepřevezmou), klub, cena a mzda, měna (nejvýš čtyři znaky), konec smlouvy, poznámka, původ (ručně, nebo tabulka a soubor) a jednání (stav, platnost, poznámka). Pole CA, PA, potenciál, osobnost a reputace se nikdy nepřevezmou a je to řečeno.
- **Čtení částky** (`parseMoney`): přečte jednu čitelnou částku. Číslo, zkratky K, M, B, „tis.“, „mil.“, „mld.“ a slova thousand, million, billion; oddělovače tisíců (mezera, tečka, čárka, apostrof) jen po skupinách po třech číslicích a jen jednoho druhu; ve zkratce je oddělovač desetinný („€12,5M“). Měna (€, £, $, Kč, CZK, EUR, GBP, USD) se jen zapíše a nepřepočítává. Rozsah („€25M - €30M“), slovo („neprodejný“), nejednoznačný zápis („12.5“, „1.234,567“) a hodnota nad 10¹⁰ dají **neznámou částku** (u rozsahu a nejednoznačného zápisu s důvodem): nic se neodhaduje a neznámá cena není nula. Mzda se čeká týdenní: roční („p/a“, „ročně“) se nepřepočítá (nepřevzato s důvodem); u ceny se údaj o období odmítne.
- **Štítek:** údaje jsou „zadal uživatel“ (ne ověřeno hrou); pravidla čtení částky jsou vlastní pravidla aplikace, ne formát žádného nástroje.
- **Zkoušky:** `recruit.test.mjs` (tabulky zápisů částek, normalizace, čtení z CSV, mutace modulu), scénář 22.

### M24. Dopad příchodu, odchodu a výměny na sestavu (etapa 3)
- **Vzorec:** `dopad A = součet A po − součet A před` (stejně B), kde „po“ je sestava A + B znovu spočtená v jedné úloze (M17) s kandidátem navíc (příchod), bez hráče (odchod) nebo s obojím (výměna), a se stejnými omezeními (zámky, vyřazení, zranění). Je to přesný rozdíl dvou optim, ne odhad postupu.
- **Vlastnost:** příchod nikdy nesníží součet A (ověřeno hrubou silou na 150 náhodných úlohách, i s kandidáty bez části atributů). Součet B se může změnit libovolně (vytlačený hráč tam spadne). Kandidát, kterého nejde ohodnotit (chybí atribut role, nemá pozici místa), má dopad 0 a v hledání je označený „nejde spočítat“, nikdy „nezlepší“.
- **Štítek:** DWRS (ESTIMATED) nebo jednoduchý vážený průměr (heuristika aplikace) podle zvoleného modelu; vždy se píše, který.
- **Zkoušky:** hrubá síla v `recruit.test.mjs`, scénář 22 (čísla v prohlížeči jsou stejná jako mimo stránku).

### M25. Hledání posil a pořadí (etapa 3)
- **Pořadí na celý tým:** 1. dopad na součet A sestupně, 2. dopad na součet B, 3. nejlepší vhodnost na některé místo, 4. jméno; kdo nejde ohodnotit, je na konci s důvodem (ne s nulou). **Na jedno místo:** 1. vhodnost na roli místa, potom jako celý tým.
- **Filtry:** věk, cena, mzda (neznámou hodnotu kandidáta nechá s příznakem „neznámá“, nebo na přání vyřadí), pozice (kandidát bez uvedené pozice se nevyřadí), stav jednání (výchozí jen otevřená), jméno, vyřazení. Nejvýš 200 kandidátů, výchozích 50 řádků.
- **Potřeby (`needs`):** neobsazená a slabá místa (M3) a tenká nebo chybějící hloubka (M20), bez vlastních prahů.
- **Štítek:** pořadí a filtry CUSTOM MODEL, čísla ESTIMATED (viz M24).

### M26. Doporučení a úspěšnost podle hodnocení uživatele (etapa 3)
- **Co:** doporučení je záznam s kandidátem, místem, modelem, doklady (řádky s čísly z výpočtu), očekávaným dopadem a prázdným výsledkem. Výsledek zapíše uživatel později: rozhodnutí (koupeno, nekoupeno, nepodařilo se získat), u koupeného hodnocení (dopadlo dobře, bez většího vlivu, dopadlo špatně) a poznámku.
- **Vzorec:** `podíl dobrých = dobře / hodnocených koupených × 100 %`; bez hodnocení se nepočítá a pod pěti hodnocenými případy se výslovně píše, že to nic nedokazuje.
- **Štítek: CUSTOM** (hodnocení je uživatelovo, ne údaj hry).

### M27. Platnost jednání (etapa 3)
- **Co:** stav jednání (sleduji, zjišťuji podmínky, nabídka podána, dohodnuto, podepsáno, odmítnuto, už nezajímá) a datum platnosti RRRR-MM-DD. Porovnává se s dnešním datem ve hře, které **píše uživatel** (aplikace datum ve hře nezná; je uložené v kariéře). Bez něj se platnost nehlídá a je to napsané. Propadlé jednání se jen označí, nic se nemění samo; u uzavřeného stavu se neupozorňuje.
- **Štítek:** zadal uživatel.

### M28. Podobní kandidáti (etapa 3, používá M22)
- Kandidáti nejpodobnější hráči soupisky, který by odešel, podle míry M22. Porovnat jde jen hráče se všemi atributy s váhou; ostatní jsou zvlášť („bez porovnání“) a nic se jim nedomýšlí. **CUSTOM MODEL.**

## 2. Připravované výpočty (etapy podle `PLAN_ROZSIRENI.md`)

Zapíšou se sem, až budou implementované a zkoušené; do té doby nejsou v aplikaci. Etapa 4: dvě fáze role, pravidla rozporů se sedmi poli, čtyři vlastní skóre (vyžaduje skutečný `.fmf` export). Etapa 5: tepelné mapy, síť přihrávek, mapa střel, vlastní xG (vyžaduje ověření dat z pluginu). Etapy 6 a 7: diagnostika příčin, historie doporučení a jejich úspěšnosti.

## 3. Šablona nového záznamu

```
### Mx. Název
- Vzorec: …
- Zdroj: … Štítek: VERIFIED | SOURCE-BASED | CUSTOM MODEL | ESTIMATED | UNKNOWN
- Předpoklady: …
- Omezení: …
- Příklad: (čísla, která zkouška opravdu počítá)
- Zkoušky: soubor a počet
```
