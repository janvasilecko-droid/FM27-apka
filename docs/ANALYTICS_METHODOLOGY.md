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
- **Omezení:** stupnice 20 → 100, ale 1 → 5 (ne 0). Proto etapa 2 přidává DWRS s přepočtem 1 → 0.
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

## 2. Připravované výpočty (etapy podle `PLAN_ROZSIRENI.md`)

Zapíšou se sem, až budou implementované a zkoušené; do té doby nejsou v aplikaci. Etapa 2: DWRS (kategorie vah × násobiče rolí × normalizace 0 až 100), model brankáře, přednastavené profily vah, sestava A + B s přísným pořadím cílů, hloubka a dopad změn.

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
