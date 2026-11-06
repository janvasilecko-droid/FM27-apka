# Průzkum ve hře FM27: co potřebuji zjistit a jak to zaznamenat (7. 11. 2026)

Majitel nabídl, že mi pustí FM27 na svém počítači a já si v něm sám otevřu, co potřebuji (nebo že pošle snímky). Tenhle dokument je **seznam, co přesně ve hře
zjistit**, aby to šlo za jedno sezení a aby se nic nehádalo. Nic z aplikace dosud nebylo zkoušeno na skutečném FM27: všechno, co aplikace o hře ví (názvy rolí
a instrukcí, rozložení obrazovek, čtení atributů, zpráva o soupeři, měřidla Tactical Effectiveness), pochází z článků třetích stran a z náhražek.

## Pravidla průzkumu

1. **Jen číst.** Nic ve hře neměnit: neukládat, nepotvrzovat změny taktiky, nekupovat, nepodepisovat, nestisknout Pokračovat (Continue) ani nic, co posouvá čas.
   Obrazovky se jen otevírají a zavírají. Když si nejsem jistý, co tlačítko udělá, nestisknu ho a zeptám se.
2. **Snímky obrazovky hry se nedávají do veřejného repozitáře** (obrazovky hry a jména skutečných hráčů). Zůstávají v soukromé pracovní složce relace.
   Do repozitáře jdou jen **zjištěné fakty**: názvy atributů, rolí a instrukcí, pořadí a rozložení obrazovek, štítky měřidel.
3. Co se nepodaří zjistit, se zapíše jako NEZJIŠTĚNO. Nic se nedoplňuje z paměti ani z článků jako fakt.
4. Skryté údaje hry (CA, PA, osobnost, reputace) se nezapisují, ani kdyby je nějaká obrazovka ukazovala.

## Co má majitel připravit

- FM27 spuštěné, **načtená uložená hra s klubem**, který hraje; v hlavním menu hry už nic rozdělaného (žádné nepotvrzené změny taktiky).
- Jazyk hry: nejlépe angličtina (aplikace čte anglické názvy). Když je hra česky, ať to řekne: názvy se pak zapíší dvojmo.
- Hra v okně nebo na celou obrazovku s rozlišením aspoň 1920 × 1080 (menší písmo se čte hůř).
- **Aspoň jeden příští zápas v kalendáři** (aby šla otevřít zpráva o soupeři a Next Match Info).
- Zavřít soukromá okna a aplikace (při ovládání počítače vidím obrazovku); počítač nenechat uspat.
- Přerušit mě může kdykoli: stačí napsat „stop“ do konverzace nebo zavřít Claude.

## Seznam (P1 = bez toho nejde aplikaci dokončit poctivě, P2 = užitečné)

U každé položky je v závorce **předpokládaná cesta ve hře** (z článků, ne ze hry: ověřit a opravit). Sloupec „Co z toho vyplyne“ říká, k čemu to v aplikaci je.

### A. Taktika (vzhled a přesné názvy)

| ID | P | Co otevřít a zachytit | Co z toho vyplyne |
|---|---|---|---|
| T1 | P1 | Obrazovka **Taktika** v pohledu **s míčem**: celé hřiště s rolemi u hráčů, mentalita, styl, měřidla | Jak vypadá rozestavení s rolemi; čtení formace a rolí ze snímku; jestli mají role povinnosti (FM27 je podle článků nemá) |
| T2 | P1 | Táž obrazovka v pohledu **bez míče** (Out of Possession): rozestavení a role bez míče | Druhá sada rolí a druhé rozestavení; pole `Role bez míče` a čtení bez míče ze snímku |
| T3 | P1 | **Týmové instrukce** po stránkách (s míčem: přehled, budování hry, postup, zakončení; bez míče: přehled, vysoký presink, nízký blok): každá instrukce s hodnotou | Přesný seznam 28 instrukcí a jejich hodnot (ověření slovníku `fm27know.js`); jak je instrukce zobrazena (posuvník, volba, text) |
| T4 | P1 | **Mentalita a styl hry** (výběr stylu a mentality): názvy a co hra předvolí | Ověření 10 stylů a 7 mentalit |
| T5 | P2 | **Individuální instrukce** hráče (jedna role): seznam a hodnoty, nové instrukce pro útok do vápna | Zda a jak modelovat individuální instrukce |
| T6 | P2 | **Tactical Tweaks** (v zápase nebo v Taktice): seznam balíčků | Doporučení během zápasu |
| T7 | P2 | Výběr role u jednoho místa (seznam nabízených rolí, popis role v rámečku) | Role podle pozic; zda popis role uvádí klíčové atributy |

### B. Tactical Effectiveness (nový systém FM27)

| ID | P | Co otevřít a zachytit | Co z toho vyplyne |
|---|---|---|---|
| E1 | P1 | **Měřidla Tactical Effectiveness** na obrazovce Taktika (celková efektivita, intenzita, složitost) včetně textu po najetí myší | Přesné názvy, stupnice (čísla, barvy, slova), kde se dají číst ze snímku; karta Tactical Effectiveness v aplikaci |
| E2 | P1 | Rozpad efektivity na čtyři pilíře (Tactical Understanding, Player Ability, Player Buy-In, Next Match Information), pokud ho hra ukazuje (Trénink, Nábor, detail měřidla) | Jestli jsou pilíře vidět jako hodnoty; co číst ze snímku a co zadat ručně |
| E3 | P2 | Obrazovka **Trénink**: plán, sezení Match Preparation (s míčem, bez míče, standardky), rozbor efektivity | Názvy sezení pro doporučení; vazba na Next Match Info |
| E4 | P2 | **Zpráva o hráči v náboru** (Scout Report) s údajem Tactical Effectiveness | Zda se dá číst vhodnost cíle pro taktiku |

### C. Hráči a atributy

| ID | P | Co otevřít a zachytit | Co z toho vyplyne |
|---|---|---|---|
| R1 | P1 | **Profil hráče → Atributy** se zapnutým **zvýrazněním klíčových atributů** (Highlight Key Attributes) pro vybranou roli: aspoň tři role (stoper, záložník, útočník), každá s míčem i bez míče | **Autoritativní seznam klíčových (zelená) a žádoucích (modrá) atributů role**: nahradí komunitní odhad v `posattrs.js` |
| R2 | P1 | **Soupiska → Hráči → pohled Atributy** (všechny technické, mentální a fyzické atributy v tabulce, brankáři zvlášť) | Které sloupce jsou vidět najednou; co musí uživatel přepnout; jak číst 25 hráčů ze snímků |
| R3 | P1 | **Profil hráče**: pozice a **jistota pozice** (přirozená, zdatná…), věk, smlouva (měsíce do konce), kondice, forma, morálka, zranění | Co je vidět z pozic a smluv; kontroly „hraje mimo pozici“, smlouvy |
| R4 | P2 | **Squad Planner / Hloubka kádru** a **Zpráva o týmu** (asistent: silné a slabé stránky) | Zda hra sama hlásí slabá místa a jak je pojmenuje (ať aplikace nepodává jako objev to, co hra říká) |
| R5 | P2 | Tooltip nebo popis u atributu, jak hra vysvětluje rozsah 1 až 20 | Vysvětlivky pro uživatele |

### D. Soupeř a příprava na zápas

| ID | P | Co otevřít a zachytit | Co z toho vyplyne |
|---|---|---|---|
| O1 | P1 | **Zpráva o soupeři** (Opposition Report / Next Match): všechny stránky (přehled, Scout Report, Analyst Report, Data Hub příštího soupeře) | Skutečná pole zprávy (formace, styl, nebezpečné oblasti, silné a slabé stránky, standardky); pole `Analýzy soupeře` a čtení ze snímku |
| O2 | P1 | **Očekávaná sestava soupeře** a jeho **hráči**: jak jsou ukázány atributy (rozmezí, hvězdičky, „neznámé“) a jak se zobrazuje úroveň znalosti | Co jde o soupeřových hráčích poctivě načíst (jen viditelné) a jak označit míru znalosti |
| O3 | P1 | **Instrukce vůči soupeři** (Opposition Instructions): seznam a hodnoty | Návrhy „co nastavit proti soupeři“ |
| O4 | P2 | **Zprávy o přípravě na zápas** v doručené poště (Match Preparation, Data Hub, rady štábu) | Co hra sama doporučuje, ať se to neopakuje jako objev |
| O5 | P2 | Výsledky a formace soupeře v posledních zápasech (Formations Faced, Goals Against Tendency) | Zdroj pravidel „slabina → jak využít“ |

### E. Ostatní

| ID | P | Co zjistit |
|---|---|---|
| M1 | P1 | Jazyk hry, rozlišení, jestli se hra dá sdílet jako okno (aplikace „Načíst z okna hry“ potřebuje, aby ji prohlížeč uměl vybrat) |
| M2 | P2 | Číslo verze hry (obrazovka O hře) a build |
| M3 | P2 | Zda hra umí export taktiky (.fmf) a exportu pohledu (Tisk obrazovky do souboru) a kde: pro alternativní cestu načítání |

## Záznam zjištění

Každé zjištění se zapíše do tabulky níž jako jedna řádka: ID, datum, co přesně je vidět, **přesné anglické názvy** (a české, pokud je hra česky), co se nepodařilo zjistit.
Vyplní se při průzkumu; zatím je prázdná.

| ID | Datum | Zjištění (názvy a rozložení, bez snímků) | NEZJIŠTĚNO |
|---|---|---|---|
| | | | |

## Co z toho půjde do aplikace

- T1 až T4, E1, E2: oprava čtení taktiky ze snímku (formace, role s míčem a bez míče, instrukce jako „Název: Hodnota“), karta Tactical Effectiveness s měřidly ze snímku.
- R1, R2, R3: seznam klíčových atributů po rolích z hry místo komunitního odhadu; čtení soupisky ze snímku; kontroly pozic a smluv.
- O1 až O3: strukturovaný profil soupeře a čtení zprávy o soupeři ze snímku; analýza slabých míst sestavy soupeře a seznam úprav tvé taktiky.

## Záložní cesta, když se k počítači nepůjde napojit

Stačí **snímky obrazovky** z položek P1 (T1, T2, T3, T4, E1, E2, R1 pro tři role, R2, R3, O1, O2, O3), tedy asi 15 až 20 snímků. Pořízení ve Windows: Win + Shift + S, pak vložit do chatu; nebo klávesa F12 ve Steamu. Stačí je poslat v jedné zprávě, popisek „T1“, „T2“ atd. pomůže.
