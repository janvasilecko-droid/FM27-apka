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
| E3 | P2 | Obrazovka **Trénink**: plán, sezení Match Preparation (podle průzkumu 7 sezení, ne tři), rozbor efektivity | Názvy sezení pro doporučení; vazba na Next Match Info |
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

Průzkum provedla 7. 11. 2026 jiná relace Claude na počítači majitele (ovládání počítače, česká hra FM27 ze Steamu, uložená hra s klubem z Premier League; hra stála na obrazovce před zápasem a pak se odehrál jeden zápas).
Do repozitáře jdou jen **názvy a rozložení**; snímky obrazovek a jména skutečných hráčů zůstaly mimo něj. Skryté údaje (CA, PA, osobnost, reputace) se nezapisují, i když je profil hráče ukazuje.

**Hlavní poznatek: hra je česky, ale část názvů zůstává anglicky.** Aplikace počítá s anglickými názvy, proto vznikl slovník `trener/src/fm27cs.js` (česky → kanonicky anglicky).

| ID | Datum | Zjištění (názvy a rozložení, bez snímků) | NEZJIŠTĚNO |
|---|---|---|---|
| M1 | 7. 11. 2026 | Čeština (menu a většina textů), anglicky zůstaly např. „Complexity“, „Effectiveness“, „Tactical Effectiveness“, „Active Tactical Tweaks“, „Instruct“, „Press Avoidance“. Monitor 1536 × 864, okno hry 1456 × 819. V instalaci jsou modifikace (BepInEx, správce vzhledů). | Číslo verze hry (v souborech je jen verze Unity 6000.3.18). Zda prohlížeč umí okno hry vybrat ke sdílení (nezkoušeno). |
| T1 | 7. 11. 2026 | TAKTIKA › Přehled › **Tvar týmu**. Horní lišta: výběr taktiky „1 · 2 · 3“, pole **Styl**, pole **Herní systém** (= mentalita), vpravo měřidla **Intenzita**, **Complexity**, **Effectiveness**. Hřiště s přepínačem „Kombinace / S míčem na kopačkách / Bez míče / Oba“, panel „Náhradníci“ (S1 až S9). Tabulka: Zvp · Role · Role MP · Taktická schopn… (hvězdy) · Hl · Hráč · Pozice · Inf · Effectiveness (proužek u každého hráče) · Kon · Rzh · Mor. · Gly · Asi · Hod. **Role nemají povinnost**: jedna role s míčem a jedna bez míče; (P) (S) (L) jsou strany. | Význam sloupců Hl, Inf, Rzh. Zkratky rolí na štítcích (ověřené jen BCB, CB, CFD); české názvy rolí u většiny míst. |
| T2 | 7. 11. 2026 | Stejná obrazovka, přepínač **Bez míče**: hřiště se třemi pásmy VYSOKÝ PRESINK / STŘEDNÍ BLOK / NÍZKÝ BLOK; štítky rolí anglicky (GK, FB, CB, DM, TWM, AM, CFD). | Plný název rolí bez míče u křídel a záložníků. |
| T3 | 7. 11. 2026 | TAKTIKA › Přehled › **Týmové instrukce**. Dlaždice (ikona, název, hodnota) a vpravo textový přehled po sekcích s tlačítkem „Vybrat“. **S míčem 18 různých názvů** (sekce Přehled 7, Závěrečná třetina 4, Postup 4, Rozehrávka 4; „Vedení míče“ je v sekcích dvakrát, „Doprovodné akce“ je jedno nastavení): Přímočarost přihrávek, Tempo, Šířka při útočení, Přechod do útoku, Tvůrčí volnost, Šetření času, Hrát na standardky, Trpělivost, Střely z dálky, Styl centrování, Vedení míče, Doprovodné akce, Pokrok prostřednictvím, Příjem přihrávek, Strategie výstavby, Odkopy od brány, BR rozehrávka (rychlost), Rozehrávka brankáře. **Bez míče 9**: Linie napadání, Výška obranná linie, Chování obranné linie, Napadání, Obranný přechod, Obranný zákrok, Krátká rozehrávka brankáře, Presinková past, Zapojení centrů. Stránky bez míče: Přehled, Vysoký presink, Vysoký presink – Zóna, Střední blok, Střední blok – Zóna, Nízký blok, Nízký blok – Zóna. Dlaždice po najetí ukáže šipky a stupnici a popis. | Anglické názvy české hry. Zda se „Doprovodné akce“ rovná Overlap, Underlap, nebo obojímu. Obsah stránek „– Zóna“. Hodnoty „Zapojení centrů“. Plné stupnice většiny instrukcí (viděna jen aktuální hodnota). |
| T4 | 7. 11. 2026 | **Styl (11)**: Držení míče · Gegenpress · Tiki-taka · Vertikální tiki-taka · Hra na křídla · Nakopávané míče · Plynulý protiútok · Přímočarý protiútok · Catenaccio · Zaparkovaný autobus · **Čistý štít** (jedenáctý, ve veřejných zdrojích není). **Herní systém = mentalita (7)**: Velmi defenzivní · Obranný · Opatrný · Vyvážený · Aktivní · Útočný · Velmi útočný. | Co hra u stylu předvolí (nevybíralo se); doporučená mentalita ke stylu „Čistý štít“. |
| T6 | 7. 11. 2026 | **Active Tactical Tweaks** (rozbalovač pod lištou; záložky „Tým“ a „Individual“, volba „Obnovení“): 15 týmových balíčků anglicky: Swap Wings, Go Long, Play Out From the Back, Play With More Urgency, Play With More Patience, Get Physical, Take a Breather, Exploit the Width, Go Narrower, Disrupt, Press Aggressively, Press Less Aggressively, GK To Go Up For Set Pieces, Throw the Kitchen Sink, Shut Up Shop. U každého popis, plusy a mínusy od asistenta a seznam instrukcí, které změní. Postup: klik → „Instruct“ → „Instructing“ → potvrdit změny (ve 3D pohledu samo). Změna se neprojeví hned: dotčené instrukce dostanou ikonu hodin a štítek **„Tactical Tweak Pending“** a několik minut drží staré hodnoty; aktivní tweak je zelený, vypíná se „Stop“. Příklady: Exploit the Width mění Šířku při útočení (Širší), Pokrok prostřednictvím (Obě strany), Doprovodné akce (Obě strany); Get Physical mění Hrát na standardky, Obranný zákrok (Přitvrdit hru), Napadání; Shut Up Shop mění 11 instrukcí včetně mentality (Velmi defenzivní). | Popis dvanácti ostatních tweaků; záložka „Individual“. |
| T7 | 7. 11. 2026 | Rozbalovač ve sloupci Role dává krátkou nabídku rolí s hvězdičkami a odkazy „Přejít na výběr role“ a „Přejít na pokyny pro hráče“. V profilu hráče jsou u místa stopera **6 rolí s míčem** (Rozehrávající stoper, Vysunutý stoper, Střední obránce, Krajní stoper, Jednoduchý stoper, Překrývající stoper) a **6 bez míče** (Střední obránce, Široký stoper, Vystupující stoper, Zajišťující stoper, Vystupující krajní stoper, Zajišťující krajní stoper); u defenzivního záložníka 5 + 5 a u útočníka 6 + 4 (seznamy v `fm27cs.js`). Počty sedí na slovník z veřejných zdrojů. | Role ostatních míst česky. Plné okno „výběr role“ s klíčovými pokyny: čtení druhé relace obsahovalo názvy (Libero, Konstruktivní obránce…), které nesedí na žádný seznam z profilu, proto se nepřebírají. |
| E1 | 7. 11. 2026 | Měřidla **Intenzita** a **Complexity** jsou kruhové ikony s barevným prstencem, **Effectiveness** je svislý pruhový ukazatel (řada čárek, aktuální úroveň barevně). **Žádná čísla ani slova.** Stejné měřidlo je i v Tréninku (Přehled: panel TACTICAL EFFECTIVENESS „Overall Level“; stránka Tactical Effectiveness: „Celková efektivita“) a v soupisce (pohledy „Tactical Effectiveness“ a „Znalost taktiky“, sloupec Effectiveness u každého hráče). | Text po najetí myší; barevná stupnice a počet stupňů. |
| E2 | 7. 11. 2026 | TRÉNINK › **Tactical Effectiveness**, nadpis „Breakdown“, **čtyři pilíře** s měřidlem, popisem, klíčovými faktory a větou od asistenta: **Tactical Understanding** (In Possession Shape, Passing Style, Build Up, Chance Creation, Out Of Possession Shape, Line of Engagement, Pressing Intensity, Pressing Trap + Player Tactical Ability, Tactical Complexity), **Player Ability** (Player Capability, Player Role Suitability), **Player Buy-In** (Managerial Support, Teammates and Staff Relationships, Manager Tendencies), **Next Match Info** (Quality of Next Opposition Report, Opposition Player Knowledge). Přepínač „Player View“. Při náboru se rozpad neukazuje. | Barvy a prahy měřidel; „Player View“ nezkoušen. |
| E3 | 7. 11. 2026 | TRÉNINK › Přehled › Tréninkový rozvrh → sezení v kalendáři. **Pět kategorií**: Tactical Understanding (8: Passing Style, Build Up, Vytvoření šancí, In Possession Shape, Line of Engagement, Pressing Intensity, Pressing Trap, Out Of Possession Shape) · **Zápasová příprava (7: Press Avoidance, Defensive Block, Defensive Positioning, Defensive Engagement, Corners, Free Kicks, Penalty)** · Footballing Development (4) · Physical and Recovery (5) · Mimofotbalové aktivity (2). Detail sezení: About Session, Attribute Focuses, Tactical Understanding a „Session Impacts“ (Tactical Understanding, Riziko zranění, Kondice, Únava, Připravenost na zápas, Spokojenost). **Oprava předpokladu: zápasová příprava nemá tři sezení s míčem / bez míče / standardky, ale sedm výše.** | Co přesně které ze sedmi sezení zlepšuje (viděn jen popis Press Avoidance). |
| R1 | 7. 11. 2026 | Profil hráče: zvýraznění klíčových atributů je **automatické podle vybrané role** (bez zapínání) a **barva se mění podle fáze**: s míčem Klíčový = zelená, Upřednostňovaný = modrá; bez míče Klíčový = růžová, Upřednostňovaný = fialová (podbarvení řádku a pruh vlevo; barva čísla v rámečku je kvalita hodnoty, ne klíčovost). Přepínač „S míčem / Bez míče“ pod hřištěm, seznam rolí s hvězdami (radio). Zjištěno pro 3 role s míčem a 3 bez míče (stoper, defenzivní záložník, útočník), viz tabulka v `docs/ANALYZA_SESTAVY_A_PRIPRAVY.md`. | Zbylé role. |
| R2 | 7. 11. 2026 | SESTAVA › A-tým › A-tým, rozbalovač pohledů vlevo nahoře: Informace o výběru · Obecné informace · **Atributy ▸** (Fyzické atributy, Psychika, Technické, Brankářské, Obrana, Útok) · Smlouva · Přestup · Domácí status · Herní vytížení · Týmová chemie · Hlášení · Zranění · Posouzení rizika · Statistiky ▸ · Mezinárodní · Vývoj · **Tactical Effectiveness** · **Znalost taktiky** · Vlastní zobrazení ▸ (a vytvoření, přejmenování, odstranění, import a export pohledu). **Všechny atributy najednou vidět nejdou**; pohled „Technické“ má 12 z 14 technických atributů (chybí Vedení míče a Obsazování, jsou nejspíš v pohledech Útok a Obrana). Rychlé filtry podle pozic nad tabulkou. | Obsah pohledů Obrana a Útok. |
| R3 | 7. 11. 2026 | Profil hráče: pozice slovy a zkratkou (např. „O (S)“), **jistota pozice = barevné tečky na hřišti bez čísel**, věk s datem narození, smlouva (měsíční mzda, datum konce, status v kádru), Schopnosti a Potenciál (hvězdy), panely Spokojenost, Kondice (srdce + slovo + zranění), Forma (graf 5 zápasů + číslo), Trénink, Statistiky za sezónu. Štítek stavu u jména (Žád, Nes, Pod, Odp, Cíl, Sus, Pož, A21, ČSS, Proti, FtT, Zra). Pozice se píší **česky**: B, O, KO, DZ, Z, OZ, ÚT se stranami P, L, S (viz `fm27cs.js`). | Význam všech štítků stavu. |
| O1 | 7. 11. 2026 | Zpráva o týmu soupeře (z panelu „Report o příštím soupeři“ nebo z menu soupeře). Záložky: **Přehled · Analýza formace · Analýza gólů · Analýza standardek · Týmová analýza · Šířka kádru**. Přehled: příští zápas, shrnutí, forma, zprávy o týmu (nepřítomen / nejistý start), informace o manažerovi (reputace, výhry %, **Preferovaná formace, Herní mentalita, Styl pressingu, Styl obsazování**), významní hráči (nejlepší střelec, asistent, hodnocení), radary s verdikty typu „Podává výrazně nadprůměrné výkony“. **Analýza formace** má tři podzáložky: Očekávaná formace (formace s míčem a bez míče s četností, počtem šancí), **Očekávaná taktika (sestava + seznamy Silné stránky a Slabiny, každá položka s oblastí a větou)**, Očekávaný taktický styl. **Analýza gólů**: Góly / Asistence / Pozice, mapa oblastí, typy gólů, časy gólů (Skórování a Přiznává). **Analýza standardek**: Preference při standardních situacích (zahrávání, cílení, počet útočících hráčů, obrana tyčí, počet bránících, obsazování, výška obranné linie), mapy prvního kontaktu, a seznamy „Postřehy o datech“ (útok a obrana, anglicky). Týmová analýza: devět dlaždic s radary a verdikty. Hlavička: „Zpráva od: skaut“ a **„Analýza hodnocení zaměstnanců: Základní“**. | Záložka Šířka kádru (nejde otevřít). Plný obsah Týmové analýzy. |
| O2 | 7. 11. 2026 | TAKTIKA › Opposition › Opposition › Předpokládaná sestava: hřiště s jedenáctkou (číslo dresu, pozice, jméno), forma, „Current Position“, tabulka Poz. · Hráč · KON · ROZ · Hodnocení · Rada · 4 sloupce pokynů; nahoře rada asistenta manažera s listováním (1/11). Atributy soupeřova hráče jsou na jeho profilu **přesná čísla** (ne rozmezí ani hvězdy) u týmu, o němž hra tvrdí „máme velmi dobré znalosti“; morálka a forma cizího hráče jsou „Informace nejsou k dispozici“ / „Data not being tracked“. Profil cizího hráče: Zpráva skauta (písmeno + věta), „Ask …“. | Co je vidět při slabé znalosti týmu (ověřen jen případ dobré znalosti). |
| O3 | 7. 11. 2026 | **Pokyny k soupeři**: nabídka „Opposition“ má tři položky (Opposition, Report soupeře, Priority týmové zprávy); dvě záložky „Předpokládaná sestava“ (11 hráčů) a „Všechny pozice“ (**22 míst**: B, OP, OL, OS, OSL, OSP, KOP, KOL, DZS, DZSL, DZSP, ZP, ZL, ZS, ZSL, ZSP, OZP, OZL, OZS, OZSL, OZSP, ÚTS). **4 sloupce**: Těsné obsazování · Napadání · Obranné zákroky · Nutit hrát nohou. Hodnoty u prvních dvou: „-“, „Nikdy“, „Vždy“. Tlačítka „Využít rady“, „Použijte všechny rady“ (vzala v jedné relaci nastavení zpět, u druhé nic neudělala), „Vymazat pokyny“; text „Multi select player to manually change the same instructions at once“. | Hodnoty sloupců Obranné zákroky a Nutit hrát nohou (seznam se neotevřel, pravděpodobně chyba nainstalovaného vzhledu). |
| D1 | 7. 11. 2026 | **Datové centrum** (panel v Portálu a záložka u zápasu): Klíčová zjištění · Poslední zápas · Týmová analýza · Analýza hráčů · Analýza formace · Analýza gólů · Analýza standardek. Hra sama píše verdikty a texty typu „Podává podprůměrné výkony“ a „Our set piece goal numbers might be worth checking.“ → aplikace nesmí tyhle poznatky vydávat za vlastní objev (viz R4/O4). Po zápase je k dispozici i hodnocení hráčů, statistiky a tepelné mapy hráčů. | Obsah záložky Analýza hráčů. |

### Co zůstává NEZJIŠTĚNO (pořadí podle toho, co aplikaci nejvíc chybí)

1. České názvy rolí u všech míst kromě stoperů, defenzivních záložníků a útočníka a jejich zkratky na štítcích (hra je ukazuje jen jako štítky; plné názvy jsou v rozbalovači Role a v profilu hráče).
2. Anglické názvy české hry (zejména „Doprovodné akce“, „Zapojení centrů“, „Šetření času“) a plné stupnice instrukcí.
3. Text po najetí na měřidla Intenzita, Complexity a Effectiveness a barevná stupnice.
4. Hodnoty sloupců Obranné zákroky a Nutit hrát nohou v pokynech k soupeři.
5. Záložka Šířka kádru ve zprávě o soupeři; Standardní situace a Penalty u vlastní taktiky; Zpětná vazba k taktice; Priority týmové zprávy.
6. Co ukazuje zpráva o soupeři a profil jeho hráčů, když je znalost týmu slabá.
7. Číslo verze hry.

## Co z toho je v aplikaci (stav 7. 11. 2026; podrobně `docs/ANALYZA_SESTAVY_A_PRIPRAVY.md`)

- **T1 až T4, E1, E2:** čtení taktiky z české obrazovky (formace z kódů 11 míst, role s míčem i bez míče, styl, mentalita, 27 instrukcí; co se nepozná, zůstane prázdné) a karta
  Tactical Effectiveness (čtyři pilíře a jejich faktory ze hry; úrovně pruhů zadává uživatel, protože hra čísla neukazuje).
- **R1 až R3:** čtení soupisky ze snímků (šest pohledů atributů, slučování podle jména hráče) a profily rolí po fázích (s míčem a bez míče). Seznam klíčových atributů po rolích se
  **nevkládá jako hotová tabulka**: ověřeno je jen šest rolí (tabulka v odstavci 5 dokumentu `ANALYZA_SESTAVY_A_PRIPRAVY.md`), takže si uživatel profil role načte ze hry sám a rozbor sestavy
  jinak počítá ze skupinového modelu pozic podle příruček (označeno jako odhad). Kontroly smluv, formy a morálky se zatím nedělají (aplikace je nečte).
- **O1 až O3:** strukturovaná zpráva o soupeři ze snímků, soupiska soupeře s atributy (jen když je hra ukazuje), rozbor soupeře (17 pravidel) se seznamem konkrétních úprav tvé taktiky
  v českých názvech hry, pokyny k soupeři (sloupce Těsné obsazování a Napadání) a sezení Zápasové přípravy. Sloupce Obranné zákroky a Nutit hrát nohou aplikace nenavrhuje (jejich hodnoty nejsou zjištěné).

## Záložní cesta, když se k počítači nepůjde napojit

Stačí **snímky obrazovky** z položek P1 (T1, T2, T3, T4, E1, E2, R1 pro tři role, R2, R3, O1, O2, O3), tedy asi 15 až 20 snímků. Pořízení ve Windows: Win + Shift + S, pak vložit do chatu; nebo klávesa F12 ve Steamu. Stačí je poslat v jedné zprávě, popisek „T1“, „T2“ atd. pomůže.
