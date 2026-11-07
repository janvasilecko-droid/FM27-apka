# Analýza sestavy a taktiky, příprava na zápas a Tactical Effectiveness (stav 7. 11. 2026)

Tenhle dokument říká, **co aplikace u těchto tří věcí dělá, na čem staví a čemu z toho věřit**. Je psaný pro majitele aplikace a pro každého, kdo bude
pravidla měnit nebo kontrolovat. Zdrojem pravdy je kód (`trener/src/tacticanalysis.js`, `squadcheck.js`, `posattrs.js`, `oppanalysis.js`, `tacteff.js`);
tabulky pravidel níž jsou z něj vygenerované a zkouška `test/docs.test.mjs` hlídá, aby se s kódem rozcházet nemohly.

## 1. K čemu to je

Majitel chtěl, aby aplikace **sama načetla hráče a taktiku ze hry** (bez ručního popisování), **ohodnotila sestavu a taktiku konkrétně** (slabá místa, silné stránky,
co a jak zlepšit) a před zápasem **našla slabá místa soupeře a dala seznam konkrétních úprav jeho vlastní taktiky a rad pro hráče**. K tomu přibyla otázka
na nové měřidlo FM27 **Tactical Effectiveness**: aplikace ho má vysvětlit a poradit.

| Co | Kde v aplikaci | Čte ze hry | Potřebuje AI |
|---|---|---|---|
| Načíst hráče a jejich atributy | Můj tým › Doplnit ze screenshotu | snímek Sestava › A-tým, 6 pohledů atributů | jen ke čtení obrázku |
| Načíst taktiku | Moje taktiky › Přečíst taktiku z obrazovky hry | snímek Taktika › Tvar týmu + Týmové instrukce (s míčem i bez míče) | jen ke čtení obrázku |
| Rozbor sestavy a taktiky | Moje taktiky › Rozbor sestavy a taktiky | nic nového (pracuje s načteným) | **ne** |
| Zpráva o soupeři a soupiska soupeře | Soupeři › (soupeř) › Zpráva o soupeři ze hry, Soupiska soupeře (atributy) | snímky Zpráva o týmu soupeře a jeho atributů | jen ke čtení obrázku |
| Příprava na zápas | Soupeři › (soupeř) › Příprava na zápas | nic nového | **ne** |
| Tactical Effectiveness | Moje taktiky › Tactical Effectiveness | nic: úrovně pruhů zadáš ty | **ne** |

**Čtení obrázku a rozbor jsou dvě oddělené věci.** Model (Claude) jen **přepíše, co na snímku stojí**; názvy z české hry převádí na kanonické **kód** (`fm27cs.js`),
ne model. Rozbory (pravidla) jsou čistý kód bez sítě a bez AI: stejný vstup dá vždy stejný výstup a dá se to zkoušet (viz odstavec 9).

## 2. Postup krok za krokem

1. **Můj tým:** na obrazovce hry otevři Sestava › A-tým, vlevo nahoře rozbal pohledy a vyfoť **Atributy › Technické, Psychika, Fyzické atributy** (u brankářů Brankářské). Pohled Technické má jen
   12 ze 14 technických atributů (chybí Vedení míče a Obsazování; nejspíš jsou v pohledech Obrana a Útok, ve hře to ale není ověřené). Hra nikdy neukáže všechny atributy najednou, proto se snímky
   **slučují podle jména hráče** (jeden hráč se nikdy nezaloží dvakrát) a atribut, který na žádném snímku nebyl, zůstane neznámý.
   Aplikace ukáže návrh (nový, doplněný, beze změny) a **zapíše jen to, co potvrdíš**. Dva různí hráči se stejně zapsaným jménem („J. Silva“ dvakrát s jiným věkem nebo pozicemi)
   ani zkratka, která sedí na víc hráčů v kádru, se **nesloučí a nezapíšou**: aplikace je vypíše zvlášť i s důvodem, protože z obrázku nejde poznat, který je který. Do atributů se dostanou jen
   názvy, které aplikace zná (skryté údaje a cizí názvy se vynechají).
2. **Moje taktiky:** vyfoť Taktika › Přehled › **Tvar týmu** (hřiště s tabulkou rolí; s míčem i bez míče) a **Týmové instrukce** (s míčem i bez míče). Formace se odvodí z kódů 11 míst
   (B, O, KO, DZ, Z, OZ, ÚT a strany P, L, S), role s míčem i bez míče se přiřadí ke každému místu, přečte se styl, mentalita a všechny instrukce.
   Co aplikace nepoznala, jí zůstane prázdné (nic se nehádá) a uvidíš to v návrhu.
3. **Rozbor sestavy a taktiky** (jedno tlačítko „Analyzovat sestavu a taktiku“): 42 pravidel taktiky, rozbor sestavy (hloubka, kvalita, věk, zranění), vzájemné **kontroly rolí a instrukcí**.
   Pravidlo, kterému chybí vstup, se **nevyhodnotí** a je v seznamu „nevyhodnoceno“.
4. **Soupeř:** (zpráva o jiném týmu se nikdy nesmíchá s uloženou: aplikace to ukáže a uloženou zprávu nahradí jen s tvým výslovným souhlasem) ve hře otevři Zpráva o týmu soupeře (Přehled; Analýza formace › Očekávaná taktika; Analýza standardek) a vyfoť. Volitelně vyfoť i atributy jeho hráčů, **ale jen když je hra
   ukazuje** (u týmu s dobrými znalostmi jsou to přesná čísla; jinak zůstanou neznámé a rozbor atributů se nedělá).
5. **Příprava na zápas** (tlačítko „Připravit zápas“): seznam doporučení seřazený podle důležitosti. U každého je **důkaz** (co o soupeři psala hra nebo co ukazují atributy), **konkrétní změna
   v českých názvech hry** („Šířka při útočení → Širší“), případně **pokyn k soupeři** (sloupec, místo, hodnota), **koho z tvého kádru** dát, **rizika**, **na co se dívat v zápase**
   a **sezení Zápasové přípravy**. Nahoře je **jedna testovatelná změna** a **rozpočet změn** (nejvýš tři; víc změn znamená menší porozumění taktice, viz odstavec 7).
6. **Tactical Effectiveness:** otevři Trénink › Tactical Effectiveness a podle barevných pruhů zadej úroveň čtyř pilířů. Aplikace vysvětlí, co pilíř znamená, poradí podle klíčových faktorů,
   odhadne složitost tvé taktiky a doporučí sezení z tréninkového rozvrhu.

## 3. Čemu věřit: tři štítky původu

Každý nález a doporučení nese štítek, **odkud se vzalo**. Štítek **nevyjadřuje, že je to správně**, jen kdo to tvrdí.

| Štítek | Význam | Příklad |
|---|---|---|
| **HRA** | Text nebo přednastavení, které napsala sama hra (zpráva štábu, popis tweaku, texty měřidel). Aplikace ho jen **přepisuje a převádí na kroky**. | „Hra píše: soupeř je slabý ve vzduchu.“ |
| **KOMUNITA** | Názor veřejných průvodců FM (Passion4FM, FM Scout, FM-Base, AssMan.AI, Vortex Gaming, FM Dossier, Guide to Football). Sporné body jsou označené. | „Counter-Press z nízkého bloku se tluče.“ |
| **ODHAD** | Závěr autora aplikace. Prahy atributů a vzorce jsou odhad a dají se posunout. | „Složitost taktiky: vysoká.“ |
| VÝPOČET | (jen rozbor sestavy) výpočet z tvých dat bez názoru: počty hráčů, zranění, pozice. | „Na místo bez zálohy.“ |

**Důležité:** štítek HRA u doporučení znamená, že **důkaz** (slabina soupeře) je z hry. **Krok, který z toho aplikace vyvodí** (například „hraj víc centrů“), je úvaha z komunitních rad,
ne rada hry. Proto u každého doporučení stojí i **rizika** a **na co se dívat**. Nikdo nezměřil, že konkrétní změna zlepší výsledek, a **aplikace nic nepředpovídá**: nikde nestojí, že taktika „zabere“.

## 4. Co je ověřené ve hře (7. 11. 2026)

Jiná relace Claude prošla českou hru FM27 na počítači majitele (podrobně `docs/FM27_PRUZKUM_VE_HRE.md`, tabulka „Záznam zjištění“). Do aplikace z toho šlo:

- **Čeština hry** a slovník `fm27cs.js`: 39 českých názvů atributů (36 hráčských a 3 brankářské; ostatní brankářské názvy nejsou ověřené), pozice (B, O, KO, DZ, Z, OZ, ÚT a strany P, L, S), 22 míst pro pokyny k soupeři,
  **27 týmových instrukcí** (18 s míčem + 9 bez míče), **11 stylů** (jedenáctý „Čistý štít“ není ve veřejných zdrojích), **7 mentalit**, **15 Active Tactical Tweaks**, názvy měřidel a sezení v Tréninku. U hodnot instrukcí se rozlišuje, jestli byla česká hodnota **ve hře viděna** (`seen`), nebo se jen odvodila;
  u odvozené aplikace píše do závorky anglickou hodnotu.
- **Dvě sady rolí** (s míčem „Role“, bez míče „Role MP“), **role nemají povinnosti**.
- **Tactical Effectiveness:** měřidla Intenzita, Complexity a Effectiveness jsou **barevné ikony a pruhy bez čísel**; stránka Trénink › Tactical Effectiveness má **čtyři pilíře** (Tactical Understanding, Player Ability,
  Player Buy-In, Next Match Info) a 17 klíčových faktorů; **změna taktiky nebo tweak dočasně sníží porozumění** (štítek „Tactical Tweak Pending“).
- **Tréninkový rozvrh:** 8 sezení Tactical Understanding a **7 sezení Zápasové přípravy** (Press Avoidance, Defensive Block, Defensive Positioning, Defensive Engagement, Corners, Free Kicks, Penalty).
- **Zpráva o soupeři** má strukturu: Přehled, Analýza formace › Očekávaná taktika (**Silné stránky a Slabiny**), Analýza standardek; pokyny k soupeři mají 4 sloupce (Těsné obsazování, Napadání, Obranné zákroky, Nutit hrát nohou).
- **Klíčové atributy rolí hra zvýrazňuje sama** (bez zapínání): podle vybrané role a **podle fáze**, s míčem zeleně (klíčový) a modře (žádoucí), bez míče růžově a fialově.

## 5. Klíčové atributy rolí podle hry (ověřeno u šesti rolí)

Hra u každé role zvýrazňuje jiné atributy a liší se **role od role i fáze od fáze**. Ověřili jsme jen šest rolí (z desítek), proto aplikace **nemá vestavěnou tabulku všech rolí**:
vybírá jedenáctku (a) podle **skupinového modelu pozic** z příruček (odstavec 6.2) a (b) podle **profilů rolí, které si načteš ze hry** (Moje taktiky › Profily rolí), kde ke každé roli patří
seznam klíčových a žádoucích atributů jen tak, jak je hra ukazuje. Seznamy níž jsou **pro kontrolu a jako příklad**; hodnoty konkrétních hráčů se nepřebírají.

| Fáze | Role (česky ve hře) | Kanonicky | Klíčové atributy | Žádoucí atributy |
|---|---|---|---|---|
| s míčem | Rozehrávající stoper | Ball-Playing Centre-Back | Heading, Tackling, Marking, Passing; Concentration, Work Rate, Determination, Bravery, Positioning, Anticipation, Teamwork, Composure; Balance, Strength, Stamina, Jumping Reach | Technique, First Touch, Aggression, Decisions, Pace |
| s míčem | Zatažený tvůrce hry | Deep-Lying Playmaker | Passing, Technique, First Touch; Concentration, Work Rate, Vision, Decisions, Teamwork, Composure | Tackling, Marking; Off The Ball, Positioning, Anticipation; Balance, Stamina |
| s míčem | Zatažený útočník | Deep-Lying Forward | Technique, Finishing, First Touch; Off The Ball, Composure; Strength | Passing, Dribbling; Concentration, Vision, Anticipation; Balance |
| bez míče | Střední obránce | Centre-Back | Heading, Tackling, Marking; Positioning, Anticipation; Strength, Jumping Reach | Aggression, Concentration, Bravery, Composure; Pace, Stamina |
| bez míče | Defenzivní záložník | Defensive Midfielder | Tackling; Work Rate, Positioning, Anticipation, Teamwork; Strength | Marking; Aggression, Off The Ball, Concentration, Decisions; Stamina |
| bez míče | Střední útočník | Centre Forward | Work Rate, Anticipation, Decisions | Marking; Aggression, Off The Ball, Concentration, Teamwork; Stamina |

**Co z toho plyne:** (1) komunitní model „obránce potřebuje obranu, útočník zakončení“ je správný v hrubém, ale **role se liší i uvnitř jedné pozice** (zatažený útočník potřebuje Technique a First Touch,
střední útočník bez míče hlavně Work Rate, Anticipation a Decisions); (2) ve hře značí **klíčovost atributu podbarvení řádku s pruhem vlevo**, ne barva čísla v rámečku (ta ukazuje kvalitu hodnoty); (3) když chceš přesný výběr podle role, načti si profil role ze hry.

## 6. Rozbor taktiky a sestavy

### 6.1 Rozbor taktiky: 42 pravidel

Pravidla hledají v **viditelném nastavení** (mentalita, týmové instrukce, role s míčem a bez míče, rozestavení) a v načtených atributech **rozpory, nedodělky a dobře sedící dvojice**. Vzniklo to z komunitních průvodců
a z textů hry; každé pravidlo nese zdroj úsudku, závažnost a **shodu zdrojů** („3 zdroje“, „spor v přísnosti“, „spor s hrou“). Pravidla se posuzovala proti 10 stylům z veřejných zdrojů a 90 dvojicím formací,
které dodává sama hra: **co hra sama používá, je jen upozornění nebo poznámka, ne chyba**. Jedenáctý styl (Čistý štít) s pravidly srovnán nebyl. Žádné pravidlo není pravidlem FM27
a žádné nepotřebuje skrytá data (CA, PA, osobnost, reputace). Prahy atributů jsou komunitní a dají se posunout (`opts.attrShift`, například −2 pro nižší soutěž).

| Id | Oblast | Co hlídá | Zdroj úsudku | Závažnost | Shoda zdrojů |
|---|---|---|---|---|---|
| A01 | Obrana | Obranná linie a linie zapojení jsou příliš daleko od sebe | KOMUNITA | Vážný rozpor | 3 zdroje |
| A02 | Obrana | Obranná linie a linie zapojení nesedí o dva stupně | KOMUNITA | Upozornění | spor v přísnosti |
| A03 | Obrana | Counter-Press s nízkou obrannou linií | KOMUNITA | Upozornění | spor s hrou |
| A04 | Obrana | Counter-Press z nízkého bloku | KOMUNITA | Vážný rozpor | 3 zdroje |
| A04b | Obrana | Regroup při vysokém presinku | ODHAD | Poznámka | 2 zdroje |
| A05 | Obrana | Counter-Press se širokým týmem | HRA | Upozornění | 1 zdroj |
| A06 | Obrana | Vysoká obrana, ale málo spuštěný presink | KOMUNITA | Upozornění | 1 zdroj + texty hry |
| A07 | Obrana | Chování linie jde proti její výšce | KOMUNITA | Upozornění | 1 zdroj + texty hry |
| A08 | Obrana | Vysoká obranná linie a pomalí stopeři | KOMUNITA | Vážný rozpor | 3+ zdroje |
| A09 | Obrana | Vysoká linie s brankářem, který zůstává na čáře | ODHAD | Upozornění | 2 zdroje |
| A12 | Obrana | Krátké rozehrávky soupeřova brankáře bez vysokého presinku | KOMUNITA | Poznámka | 2 zdroje |
| B01 | Výdrž | Intenzivní presink a střed bez výdrže | KOMUNITA | Upozornění | 3+ zdroje |
| B02 | Výdrž | Counter-Press s tvrdým nasazením | KOMUNITA | Poznámka | 2 zdroje |
| B03 | Výdrž | Nízký blok s tvrdým nasazením | KOMUNITA | Poznámka | 1 zdroj |
| C01 | Útok | Přímé přihrávky a trpělivý útok najednou | KOMUNITA | Vážný rozpor | 3 zdroje |
| C02 | Útok | Protiútok s trpělivým nebo krátkým rozehráním | KOMUNITA | Upozornění | 2 zdroje |
| C03 | Útok | Největší tempo s krátkou a trpělivou hrou | KOMUNITA | Upozornění | 1–2 zdroje |
| C04 | Útok | Široký tým s krátkými přihrávkami | KOMUNITA | Upozornění | 2 zdroje |
| C06 | Útok | Na křídle nikdo nedrží lajnu | KOMUNITA | Vážný rozpor | 3 zdroje |
| C07 | Útok | Přesah nebo podběh bez hráče, který jej dělá | KOMUNITA | Upozornění | 3 zdroje |
| C08 | Útok | Trpělivý útok se střelami z dálky | KOMUNITA | Upozornění | 2 zdroje |
| C10 | Útok | Disciplína týmu proti rolím s pevnou tvořivostí | KOMUNITA | Poznámka | 1 zdroj |
| C12 | Útok | Counter-Press s udržením tvaru po zisku míče | HRA | Silná stránka | 2 zdroje |
| C14 | Útok | Přihrávky do prostoru s krátkou nebo trpělivou hrou | KOMUNITA | Poznámka | 1 zdroj |
| C15 | Útok | Rozehra přes presink s přímými přihrávkami | ODHAD | Poznámka | 1 zdroj |
| D01 | Rozehra | Rozehra přes presink s dlouhými výkopy | KOMUNITA | Vážný rozpor | 2 zdroje |
| D02 | Rozehra | Obejití presinku s krátkými výkopy | ODHAD | Poznámka | 1 zdroj |
| D03 | Rozehra | Rozehra od brankáře a technicky slabí stopeři | KOMUNITA | Upozornění | 3 zdroje |
| D06 | Rozehra | Role brankáře s míčem a bez míče si odporují | ODHAD | Poznámka | 1 zdroj |
| E01 | Záloha | Ve středu chybí jedna z prací: držák, běžec nebo tvůrce | KOMUNITA | Poznámka | 2 zdroje |
| E02 | Záloha | Dvojice záložníků se dvěma stejnými pracemi | KOMUNITA | Upozornění | 1 zdroj |
| E03 | Záloha | Ve středu bez míče nikdo nečistí prostor | KOMUNITA | Poznámka | 2 zdroje |
| F01 | Boky | Dva hráči běhají po stejné lajně | KOMUNITA | Upozornění | 2 zdroje |
| F02 | Boky | Vnitřní křídelník s krajním obráncem u lajny | HRA | Silná stránka | 3 zdroje |
| F04 | Boky | Oba krajní obránci útočí za jediným defenzivním záložníkem | KOMUNITA | Upozornění | 2 zdroje |
| F05 | Boky | Asymetrie na bocích | KOMUNITA | Silná stránka | 2 zdroje |
| G01 | Útok | Dva útočníci se stejnou prací | KOMUNITA | Upozornění | 1–2 zdroje |
| G02 | Útok | Osamělý útočník bez spojky za sebou | KOMUNITA | K vědomí | 1 zdroj |
| G03 | Obrana | Dva stopeři s rolí Ball-Playing Centre-Back | KOMUNITA | Upozornění | 1 zdroj |
| G06 | Obrana | Víc rolí Outlet, nebo Outlet s Counter-Pressem | ODHAD | Upozornění | 2 zdroje |
| G07 | Obrana | Týmový Trigger Press proti rolím, které jej mají pevně | HRA | Poznámka | 2 zdroje |
| H01 | Mentalita | Opatrná mentalita, ale víc hráčů zůstává vysoko | ODHAD | Upozornění | 1 zdroj |

### 6.2 Rozbor sestavy

Pro místa taktiky spočítá z viditelných atributů **vhodnost na skupinu pozic** podle klíčových (×3) a žádoucích (×1) atributů (`posattrs.js`; Vortex Gaming, FM Dossier, AssMan.AI; tam, kde se zdroje k atributu
nevyjadřují, odhad autora z původních tabulek DWRS). Najde nejlepší jedenáctku (přesné přiřazení, maďarský algoritmus) a porovná ji s jedenáctkou, kterou máš v taktice. Slabé místo hlásí **jen tehdy, když platí aspoň
jedna podmínka** (princip tří podmínek je z veřejného popisu nástroje FM Dossier; kód ani tabulky odtamtud nejsou): málo hráčů na skupinu pozic proti cíli, **kvalitní útes** (základ je o `cliffGap` bodů nad zálohou),
**viditelná slabina** v nejdůležitějších atributech, stárnoucí základní hráč bez nástupce, zranění. Důvod: „o osm bodů pod mediánem“ najde slabé místo v každém kádru, takže nic neříká.

| Id | Co hlásí | Zdroj úsudku |
|---|---|---|
| G1 | Pozice, kde chybí hráči i na základ (díra) | VÝPOČET |
| G2 | Skupina pozic bez zálohy (jediná možnost) | KOMUNITA (cíl 2 hráči na místo) |
| G3 | Hloubka pod cílem | KOMUNITA |
| G4 | Málo přirozených hráčů na skupinu pozic | KOMUNITA |
| P1 | Hráč hraje mimo své pozice, nebo jeho pozice není známá | VÝPOČET |
| Q1 | Základní hráč má slabé atributy, na kterých u pozice nejvíc záleží | KOMUNITA |
| Q2 | Velký propad mezi základním hráčem a nejlepší zálohou | ODHAD |
| A1 | Stárnoucí základní hráč bez mladšího nástupce | KOMUNITA |
| U1 | Základní hráč s atributem pod 11 v tom, co mají mít všichni v poli (Passing, Decisions, Determination, Pace, Acceleration, Strength, Stamina) | KOMUNITA |
| I1 | Zraněný hráč je v sestavě | VÝPOČET |
| S1 | Silná stránka: aspoň dva klíčové atributy skupiny na 15 a víc | KOMUNITA |
| S2 | Hloubka skupiny pozic je v pořádku | KOMUNITA |
| S3 | Průměrný věk jedenáctky (komunitní doporučení 25 až 28 let) | KOMUNITA |

**Prahy** (`squadcheck.js`, `DEFAULTS`, dají se posunout): `perSlot` 2 hráči na místo, `cliffGap` 12 bodů (stupnice 0 až 100), `weakValue` 9, `swapGain` 4 body pro návrh výměny, `veteranAge` 31,
`successorMaxAge` 27, `minCoverage` 0,6 (hráč s menším pokrytím potřebných atributů se **neohodnotí**, nikdy se nedosadí nula), `topAttrs` 3. Hráč bez věku se do věkových pravidel nezapočítá a řekne se to.
Rozbor **neřadí hráče podle „kvality“ napříč pozicemi**.

## 7. Příprava na zápas: 17 pravidel soupeře

Vstupem je **zpráva o soupeři ze hry** (silné a slabé stránky, formace, mentalita a pressing trenéra, výpadky, významní hráči, předpokládaná sestava, standardky), volitelně **atributy soupeřových hráčů**,
tvoje **vlastní taktika** a tvůj kádr. Výstupem je seřazený seznam (`Doporučeno` › `Zvaž` › `K vědomí`).

**Pravidla, kterým chybí vstup, se nevyhodnotí** a jsou v seznamu „nevyhodnoceno“. Vlastní nastavení se nikdy nebere jako výchozí. Strany soupeře se převádějí na **tvou perspektivu**: jeho pravá strana je tvá levá.

| Id | Oblast | Co hledá | Zdroj úsudku |
|---|---|---|---|
| P01 | Vzduch a centry | Soupeř je slabý ve vzduchu nebo v brankářově hře do vzduchu | HRA |
| P02 | Fyzická hra | Soupeř je fyzicky a mentálně měkký | HRA |
| P03 | Brankář | Soupeřův brankář je slabý v zákrocích | ODHAD |
| P04 | Strana | Hráč soupeře ve špatné formě: útoč přes jeho stranu | HRA |
| P05 | Pokyny k soupeři | Hlavní hráči soupeře: těsné obsazování | KOMUNITA |
| P06 | Výpadky | Soupeř nebude mít některé hráče | HRA |
| P07 | Presink soupeře | Soupeř napadá často: bezpečná rozehrávka | KOMUNITA |
| P08 | Styl soupeře | Mentalita soupeřova trenéra: jak na něj | KOMUNITA |
| P09 | Střed zálohy | Přesila ve středu zálohy | ODHAD |
| P10 | Standardky | Soupeř je zranitelný při obraně standardek | HRA |
| P11 | Standardky | Soupeř je nebezpečný na standardky | HRA |
| P12 | Soupiska soupeře | Pomalá obrana soupeře a rychlý útočník u tebe | ODHAD |
| P13 | Soupiska soupeře | Soupeřovi rychlí útočníci proti tvé vysoké linii | ODHAD |
| P14 | Soupiska soupeře | Slabý rozehrávač v zadní řadě soupeře | KOMUNITA |
| P15 | Soupiska soupeře | Vzdušně silní útočníci soupeře: tvoji nejlepší stopeři | ODHAD |
| P16 | Poctivost zprávy | Stejná oblast je u soupeře silná i slabá | HRA |
| P17 | Znalost soupeře | Kolik o soupeři hra a aplikace opravdu ví | HRA |

**Prahy** (`oppanalysis.js`, `DEFAULTS`, odhad, žádný zdroj číslo nedává a dají se posunout): atribut ≤ 9 je nízký, ≥ 14 vysoký; průměr Heading a Jumping Reach stoperů ≤ 10 = slabý vzduch; Pace i Acceleration ≥ 15 = rychlý hráč;
průměr Pace a Acceleration obránců ≤ 10 = pomalá obrana; průměr Passing, Vision a Technique ≥ 14 = tvůrce hry; Composure, Passing nebo First Touch ≤ 9 u obránce nebo brankáře = slabý rozehrávač; rozbor atributů se dělá, jen když
je potřebné atributy načteno u aspoň 3 hráčů sestavy; aspoň 2 fyzické slabiny = fyzicky měkký soupeř; rozdíl 2 hráčů ve středu zálohy = přesila.

**Cena změn.** Ve hře každá změna taktiky i každý tweak snižuje porozumění taktice (štítek „Tactical Tweak Pending“, několik minut se drží staré hodnoty). Proto doporučení nese **počet změn**, drží se **nejvýš tří různých změn
nastavení** (`maxChanges`; totéž nastavení, které chtějí dvě pravidla, se počítá jednou) a **nejvýš tří pokynů k soupeři** (`maxOi`), a nad rozpočet jde jen označené „volitelné“. Nahoře je vždy **jedna testovatelná změna, tedy jedno
nastavení** (první z nejvyššího doporučení; zbytek téhož doporučení je zmíněný jako pozdější krok): tu změň první, sleduj ji a teprve potom přidávej další.

**Štítek u konkrétního doporučení může být přesnější než v tabulce.** Tabulka níž udává zdroj úsudku pravidla; například P05 (těsné obsazování významných hráčů) je v katalogu KOMUNITA, ale doporučení nese HRA, když významné hráče
uvedla hra, a ODHAD, když je aplikace určila z atributů. Pravidlo, kterému chybí vstup, je „nevyhodnoceno“; prázdný seznam výpadků znamená, že se ta část zprávy nenačetla, takže P06 je nevyhodnoceno, ne „nikdo nechybí“.
Jména hráčů se z textu hry spárují jen jednoznačně (příjmení jako celé slovo; víc shod rozliší křestní jméno nebo iniciála; jinak se o koho jde nehádá).

## 8. Tactical Effectiveness

Ve hře jsou měřidla jen barevné pruhy bez čísel, proto **úrovně pilířů (nízká, střední, vysoká, nevím) zadáváš ty**. Aplikace k nim doplní:

- **Vysvětlení pilíře** a názvy jeho klíčových faktorů přesně jak je píše hra (HRA): Tactical Understanding (In Possession Shape, Passing Style, Build Up, Chance Creation, Out Of Possession Shape, Line of Engagement,
  Pressing Intensity, Pressing Trap, Player Tactical Ability, Tactical Complexity), Player Ability (Player Capability, Player Role Suitability), Player Buy-In (Managerial Support, Teammates and Staff Relationships, Manager Tendencies),
  Next Match Info (Quality of Next Opposition Report, Opposition Player Knowledge).
- **Rady podle klíčových faktorů** (KOMUNITA/ODHAD): u každého ze 17 faktorů, co s ním dělat. U pilíře s nízkou úrovní jsou rozbalené.
- **Pořadí, na co se zaměřit nejdřív:** nízká, pak střední, pak „nevím“, vysoká poslední.
- **Odhad složitosti tvé taktiky** (ODHAD): počet týmových instrukcí mimo výchozí hodnotu plus pokyny k soupeři; od 7 „střední“, od 12 „vysoká“. Počítá se jen z **přečtených** instrukcí, takže při neúplném čtení je to dolní odhad:
  „vysoká“ platí vždy, od sedmi je to „aspoň střední“, a jinak je složitost „neznámá“ (nízká se řekne jen tehdy, když je přečteno všech 27 instrukcí). Výchozí hodnoty instrukcí aplikace ve FM27 neověřila (bere je z veřejných průvodců).
  Vzorec hry neznáme, je to jen vodítko.
- **Doporučená sezení** z tréninkového rozvrhu: Tactical Understanding (pokud asistent ve hře jmenuje oblast, použije se jeho věta: štítek HRA) a Zápasová příprava (výběr podle karty Příprava na zápas).

**Co aplikace u Tactical Effectiveness neví:** text po najetí na měřidla, barevnou stupnici a počet stupňů, z čeho se pilíře počítají a jak moc které změny pomáhají. To je v kartě i v seznamu „Co aplikace neví“.

## 9. Co aplikace nikdy nedělá

- **Nepředpovídá výsledek** ani nepíše, že taktika „zabere“, ani nepočítá „vlastní skóre 0 až 100“ taktiky (bez dat hry by bylo vymyšlené).
- **Nehádá chybějící údaj:** neznámé atributy, neznámá role, neznámá instrukce = pravidlo se nevyhodnotí a je to vidět. Vlastní nastavení se nikdy nebere jako výchozí.
- **Nepoužívá skryté údaje hry** (CA, PA, osobnost, reputace), ani kdyby je obrazovka ukazovala; nečte paměť hry a **nic ve hře nemění**. Do úložiště se z obrázku dostanou jen atributy, jejichž název aplikace zná.
- **Neslučuje dva různé hráče** se stejně zapsaným jménem a nepřepisuje údaje hráče v kádru podle nejednoznačné shody jména.
- **Nevydává za vlastní objev to, co hra sama říká** (Datové centrum, zpráva štábu): takové věty jsou označené HRA.
- **Nepřebírá cizí kód ani tabulky** (nástroje třetích stran jsou jen inspirace podle veřejných popisů; viz `docs/REFERENCE_ANALYSIS.md`).
- Snímky obrazovky hry ani jména skutečných hráčů se **neukládají do repozitáře**; v repozitáři jsou jen názvy, rozložení a vymyšlené zkušební příklady.

## 10. Co zůstává nezjištěno

Seznam je v `docs/FM27_PRUZKUM_VE_HRE.md` (odstavec „Co zůstává NEZJIŠTĚNO“). Nejdůležitější: české názvy rolí u většiny míst a zkratky na štítcích; anglické názvy českých instrukcí
(Doprovodné akce, Zapojení centrů, Šetření času) a plné stupnice instrukcí; text po najetí na měřidla TE a jejich barevná stupnice; hodnoty sloupců Obranné zákroky a Nutit hrát nohou v pokynech k soupeři;
záložka Šířka kádru; co ukazuje zpráva o soupeři při slabé znalosti týmu; číslo verze hry. Kde je údaj nezjištěn, aplikace **neříká nic** místo domněnky.

## 11. Kde je kód a jak se to zkouší

| Co | Soubor | Zkouška |
|---|---|---|
| České názvy a převody | `trener/src/fm27cs.js` | `test/fm27cs.test.mjs` |
| Čtení taktiky a soupisky z obrazovky | `tactics.js`, `squadread.js` | `test/tacticread.test.mjs`, `test/squadread.test.mjs`, scénář 25 |
| Zpráva o soupeři | `oppread.js` | `test/oppread.test.mjs` |
| 42 pravidel taktiky | `tacticanalysis.js` | `test/tacticanalysis.test.mjs`, scénář 23 |
| Rozbor sestavy | `squadcheck.js`, `posattrs.js` | `test/squadcheck.test.mjs`, scénář 24 |
| Příprava na zápas | `oppanalysis.js`, `screens/oppprep.js` | `test/oppanalysis.test.mjs`, scénář 26 |
| Tactical Effectiveness | `tacteff.js`, `screens/teffect.js` | `test/tacteff.test.mjs`, scénář 27 |

Nezávislá revize nových modulů (7. 11. 2026) a co se podle ní opravilo: `docs/REVIZE_PRIPRAVA_NA_ZAPAS_2026-11-07.md`.

Pravidla jsou čisté funkce: zkoušky ověřují, že stejný vstup dá stejný výstup, že se vstupy nemění, že moduly nesahají na DOM ani na síť a že chybějící vstup pravidlo nevyhodnotí.
