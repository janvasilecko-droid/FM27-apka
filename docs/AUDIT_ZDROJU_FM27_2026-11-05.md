# Technický audit čtyř projektů pro AI trenéra FM27 (5. 11. 2026)

Zadání majitele: prostudovat zdrojové kódy **FMMatchLens, FM Player Analyzer, FMSuperScout a FMSAT**, u každého zjistit sedm věcí (jak získává data, jaká data, analytická logika, algoritmy hodnocení hráčů a taktiky, uživatelské rozhraní, co lze převzít podle licence, co je kompatibilní s FM27), navrhnout, jak nejlepší části spojit, a **zachovat stávající aplikaci**. Nic cizího se nesmí tvářit jako ověřené, nevymýšlejí se funkce a nepoužívají se simulovaná data.

## 0. Shrnutí pro majitele

| Projekt | Co to je | Licence | Odkud bere data | Skrytá data hry | FM27 | Co s ním |
|---|---|---|---|---|---|---|
| **FMMatchLens** 0.7.1 ([repo](https://github.com/osnsyc/FMMatchLens)) | Zásuvný modul do hry (C#) a webový přehled (React); **živý zápas** | **MIT** | Čte paměť běžící hry (jen čtení), nabízí ji na `127.0.0.1:16726`, ukládá archivy `.fmlens` | Čte CA, PA, reputaci, mzdy i **přesné atributy všech hráčů v zápase, tedy i soupeřových** | **Ano** (2 sestavení Steam, jen Windows) | **Nejlepší zdroj živých dat. Už napojeno** (viz 8). Další části lze převzít (archiv, mapy). |
| **FM Player Analyzer** 2.0.4 ([repo](https://github.com/ElectroHugin/FM-Player-Analyzer)) | Aplikace C++/Qt: nejlepší sestava, slabá místa, posily, mládež, registrace | **GPL-3.0** | Nečte hru; importuje CSV/HTML z FM View Exporteru | Žádná (jen viditelná) | Částečně (import ano, váhy z FM24) | **Jen metody, žádný kód ani tabulky** (copyleft). |
| **FMSuperScout** 1.7.2 ([repo](https://github.com/mavarobli/FMSuperScout)) | Čtečka paměti (C#) + místní web (čistý JS); skauting hráčů a štábu | **MIT** | Čte paměť hry zvenku (Windows), na Macu se vkládá do hry | Čte CA, PA, reputaci a **analytika je používá** | Ano (27.0 předvydavatelské) | Slovníky, tvar CSV, role-fit jako nápad; **bez CA/PA**. |
| **FMSAT** 0.1.0 ([repo](https://github.com/Glawster/fmsat)) | Aplikace Python/Qt: čte snímky obrazovky (OCR), hodnotí sestavu | **Žádná** (všechna práva vyhrazena) | OCR snímků **FM26** | CA a PA vyžaduje | **Ne** (jen FM26) | **Jen nápady.** |

**Šest hlavních zjištění**

1. **Živá data zápasu dává jen FMMatchLens.** FMSuperScout čte jen databázi (hráči, štáb), ne zápas ani taktiku; FM Player Analyzer a FMSAT hru nečtou vůbec (tabulky, OCR).
2. **Hodnocení taktiky nemá žádný z nich.** FMSuperScout a FMSAT to mají výslovně neexistující, FM Player Analyzer skládá nejlepší sestavu pro obě fáze hry, ale taktiku nehodnotí, FMMatchLens taktiku jen zobrazuje. Hodnocení taktiky, rady, vysvětlení „proč“, knihy a výuka zůstávají **tím, co umí jen naše aplikace**.
3. **Váhy a prahy hodnocení hráčů nejsou nikde doložené.** Pocházejí z FM24 nebo FM26, z cizích webů nebo z odhadu autora; autor FM Player Analyzer to přiznává přímo v kódu („předpoklad, dokud se nezkouší engine“). Rozpad hodnocení hráče v FMMatchLens má jen syntetické testy. **Nepřebírat jako fakt**, jen jako výslovně označený odhad.
4. **Skrytá data čtou tři ze čtyř a FMSuperScout je používá v analýze.** Naše pravidla je zakazují. Čtečky v aplikaci mají filtr „nikdy nečíst“ (CA, PA, skryté atributy, osobnost, reputace, atributy soupeře) a testy, které po jeho vypnutí spadnou.
5. **Licence rozhodují o tom, co smíme.** MIT (FMMatchLens, FMSuperScout): kód lze převzít s oznámením o autorských právech. GPL-3.0 (FM Player Analyzer): kopie kódu nebo tabulek by znamenala, že celá naše aplikace musí být pod GPL-3.0, proto jen metody. Bez licence (FMSAT): nic.
6. **FM27 vychází 10. 11. 2026** a všechny čtyři nástroje cílí na předvydavatelské sestavení 27.0. Po prvním opravném vydání mohou přestat fungovat; FMMatchLens zná jen dvě konkrétní sestavení hry.

**Co potřebuji od majitele** (doporučená odpověď je první)

1. **Plugin čtoucí paměť hry (FMMatchLens) používat jen pro offline hru na vlastní riziko?** Doporučuji ano, s varováním v aplikaci (už tam je). Autor pluginu riziko přenáší na uživatele a podmínky hry (EULA) nikdo z nich neřeší.
2. **Odkud vzít váhy pro „vhodnost hráče na roli“ a nejlepší sestavu?** Doporučuji: (a) načíst klíčové atributy rolí z obrazovky role ve hře (přepis potvrdíš ty) a (b) nechat tě je upravit. Předvyplněný odhad z FMSuperScout (MIT) jen volitelně a vždy s nápisem „odhad, hra to nepotvrzuje“. Bez tohohle rozhodnutí etapu 1 nezačnu.
3. **Pošli skutečná data z FM27:** 1 až 2 archivy `.fmlens` po zápase s pluginem a snímky obrazovky rolí. Bez nich nejde ověřit nic proti skutečné hře (viz 1).
4. **Licence naší aplikace.** Repozitář zatím žádnou nemá. Při převzetí MIT kódu přidám `THIRD_PARTY_NOTICES.md` s textem licence. GPL kód nepřebírat (jinak by celá aplikace musela být GPL-3.0).

## 1. Jak byl audit udělán a co neověřuje

- **Čteny byly zdrojové kódy** (klony jen ke čtení mimo repozitář aplikace). **Nic z nich se nespouštělo, nesestavovalo ani neinstalovalo.** Každý projekt prošel čtením nezávislého čtenáře kódu s pevnou osnovou (sedm bodů + využitelné části + nejistoty) a povinností citovat `soubor:řádek`; co je jen v README, je označené „jen README/docs“.
- **Stopové kontroly provedl autor aplikace přímo v kódu** u každého projektu: licenční soubor, nejdůležitější vzorec nebo tvrzení o FM27; u FMMatchLens navíc celé lokální API, datové typy, katalog podporovaných sestavení a seznam čtených atributů. V textu níže je to označeno **(ověřeno)**. Ostatní údaje jsou podle čtenáře kódu.
- **Hra FM27 ani její data nebyla k dispozici.** Z kódu jde ověřit, co se čte, odkud a jak se počítá. **Nejde ověřit**, že čtené adresy v paměti sedí na skutečné sestavení FM27, ani že čísla jsou správná. Tvrzení „ověřeno na FM27“ v cizích projektech jsou jen slova jejich autorů.
- **FM27 vychází 10. 11. 2026** (backlog FMSuperScout, `docs/backlog.md`, **ověřeno**). Všechny nástroje cílí na **předvydavatelské sestavení 27.0**.
- Soubory určené cizím AI asistentům (`AGENTS.md`, `CLAUDE.md` ve FMSAT) jsme brali jako data a neřídili se jimi.

## 2. Srovnání podle sedmi bodů

| Bod | FMMatchLens | FM Player Analyzer | FMSuperScout | FMSAT |
|---|---|---|---|---|
| **1. Jak získává data** | Plugin BepInEx 6 v procesu hry: nativní přesměrování funkce zápasu a čtení paměti na pevných adresách (jen čtení). Sestavení pozná podle SHA-256 `game_plugin.dll` | Nečte hru. CSV nebo HTML z FM View Exporteru (jiný projekt), verzi hry volí uživatel | Windows: externí `ReadProcessMemory`, hledání objektů podle typových tabulek, F9. Mac: knihovna vložená do hry | Snímky obrazovky přes OCR (PaddleOCR), jen FM26 |
| **2. Jaká data** | Zápas po tikách (4/s): míč, hráči (poloha, rating, statistiky), týmy (25 polí vč. xG), události, momentum, formace, role s míčem a bez míče, sestavy | 42 atributů, pozice, věk, klub, osobnost, mzda, hodnota (viditelné) | 47 viditelných atributů + 5 skrytých, CA/PA, smlouvy, kluby, štáb, datum, „váš klub“. Nečte zápasy, taktiku, formu ani finance | Atributy, pozice, CA/PA, taktika z obrazovky (formace, role, instrukce) |
| **3. Analytická logika** | Statistiky se čtou ze hry; **xG se čte ze hry** (ověřeno), momentum počítá plugin, ostatní odvozeniny (heatmapy, přihrávky, pohyb) počítá webový přehled | Import → role → hodnocení DWRS → sestava → slabá místa, posily, mládež | Dump do JSON → web: filtry, hodnocení, odhad hodnoty, projekce (většinou z CA/PA) | OCR → validace → databáze → hodnocení role → nejlepší sestava |
| **4. Algoritmy** | Rozpad hodnocení hráče (odhad, 38 tabulek vah, jen syntetické testy), ovládání prostoru (Gaussovo pole, nedoložené konstanty), tepelná mapa 40×60, mapa přihrávek | DWRS = vážený průměr atributů (váhy FM24); nejlepší sestava přes Hungarian a min-cost flow, testy proti hrubé síle; slabá místa; posily simulací | Meta skóre (váhy z cizího webu, FM26), role-fit z viditelných atributů, hodnota regresí, zájem hráče logistikou | Vážené skóre role (celá čísla 0 až 10, původ nedoložen), nejlepší sestava přes bitové přiřazení. **Hodnocení taktiky nemá nikdo** |
| **5. Rozhraní** | React 19, Vite, Pixi, Tailwind; živě přes WebSocket nebo přehrávání archivu | Qt 6 Widgets, ~22 stránek, EN/DE | Čistý JS bez rámců, místní server, 4 jazyky (nl/en/fr/de) | PySide6, tabulky, hřiště, CLI |
| **6. Licence** | **MIT** | **GPL-3.0** | **MIT** | **žádná** |
| **7. FM27** | Ano, 2 sestavení Steam (README stále píše FM26) | Import ano; váhy FM24; role FM27 přepsané z autorových snímků | Ano, 27.0 (podle autora ověřeno na ukázkovém savu) | Ne, jen FM26 |

## 3. Projekty podrobně

### 3.1 FMMatchLens 0.7.1 (MIT, autor osnsyc)

- **Velikost:** 33 souborů C# (11,7 tis. řádků, hlavně hák na paměť hry 3,4 tis.), frontend 153 souborů TypeScript (34 tis. řádků), testy frontendu 4 tis. Verze formátu archivu 2.8.
- **Získání dat.** Nativní přesměrování funkce aktualizace zápasu v `game_plugin.dll` a čtení paměti po jejím návratu (`P/Memory/GameMatchTickHook.cs`, `P/Memory/Offsets.cs`). Zápis do paměti v kódu není, ale přesměrování mění začátek funkce hry. **Podporovaná sestavení (ověřeno, `GamePluginBuildCatalog.cs:12-22`):** `steam-26340721` (RVA 0x4532A00) a `steam-26227640` (0x4530BC0), obě FM27 podle CHANGELOGu. Neznámé sestavení: záložní adresa, použije se jen když to vypadá jako začátek funkce; nic neověřuje, že jde o tutéž funkci (riziko, oprava pádu v 0.7.1). Čte se zobrazovaná instance zápasu, ne „budoucí“ simulace.
- **Lokální API (ověřeno, `LocalApiServer.cs`).** Jen `127.0.0.1:16726`, JSON camelCase, **CORS `Access-Control-Allow-Origin: *`**, jen GET, bez ověřování, bez verze schématu (`/api/health.gameVersion` je konstanta sestavení, ne zjištění, jaká hra běží). Cesty: `/api/health`, `/api/match/current|meta|status|frames|formation/history|momentum/events|momentum/updates`, `/api/archives…`, `/api/assets/…`, WebSocket `/ws` (až 4 zprávy za sekundu).
- **Data (ověřeno u týmů a atributů).** Tým: 25 polí včetně **xG, které plugin čte z paměti hry** (`CaptureSnapshots.cs`), žádný vlastní model xG tam není. Hráč na tik (~50 polí): poloha, rychlost, rating, statistiky, vzdálenost, kondice. Metadata: jména, číslo, pozice, **role a povinnosti s míčem i bez míče**, 47 viditelných atributů (ověřeno: seznam v `GameMatchTickHook.cs:1809-1888`, žádný skrytý), manažer s příznakem „řídí člověk“. **Skryté:** `currentAbility`, `potentialAbility`, reputace, mzda, morálka jdou do API i archivu; atributy čte přesné u všech hráčů v zápase, tedy i u soupeře (hra u hráčů, které neznáš, ukazuje atributy jen jako rozsahy; zda je maskuje i u soupeře v zápase, z kódu nezjistíme, proto je nebereme).
- **Analytika.** Momentum počítá plugin (váhy podle typu události a zóny hřiště, označené „potvrzeno FM26“). Webový přehled odvozuje xG po minutách, xG jednotlivé střely (odhad: párování změn xG a střel v okně 96 ticků), tepelné mapy (mřížka 40×60, bilineární rozptyl), mapu přihrávek, pohyb a sprinty (≥25 km/h), řetězec střely, **ovládání prostoru**.
- **Hodnocení hráče.** Číslo u hráče je nativní (ze hry). Jen „rozpad“ je rekonstrukce: vzorec a 38 tabulek vah jsou zapsané ručně, bez popisu, jak vznikly, a s 12 z 50 rolí bez mapování; testy jsou syntetické. Autorovo „téměř rekonstruuje vzorec hry“ doslova v README není: je to **odhad s neznámou přesností**.
- **Formát archivu `.fmlens`** (podrobně pro budoucí čtečku): hlavička `FMLENS2\0`, verze 2.x, bloky s kontrolním součtem, komprese zlib (v prohlížeči `DecompressionStream`), proměnná délka čísel (LEB128), snímky po deltách, metadata s tabulkou řetězců. **Čtečka v čistém JS už existuje** (`F/api/archiveParser.ts`, 1157 řádků, jen standardní rozhraní prohlížeče). Archiv obsahuje CA/PA a absolutní cesty k souborům na disku (obojí se musí při čtení zahodit).
- **Rozhraní.** Komponenty: časová osa a momentum, xG graf a mapa střel, soupiska a profil hráče, formace v obou fázích, statistiky, přehrávání archivu, taktická deska s ovládáním prostoru; 4 motivy; zh-CN a en.
- **Licence.** MIT, držitel „osnsyc“. Nepokryto: fonty bez licenčního prohlášení (FMUniverse, ABCSocial), kopie komponent z knihoven, motivy „inspirované“ Opta/Sofascore/Wyscout (nepřebírat).
- **FM27.** Ano (CHANGELOG 0.7.0: „přechod z FM26 na FM27“; **ověřeno**). README a komentáře ještě píšou FM26.

### 3.2 FM Player Analyzer 2.0.4 (GPL-3.0, autor ElectroHugin)

- **Velikost.** C++20 + Qt 6.8, 43 tis. řádků (jádro 12 tis., rozhraní 24 tis., testy 7 tis., 30 testovacích programů), CMake; **žádný Electron ani web** (ověřeno). Starší verze v Pythonu (Streamlit) je v adresáři `legacy` jako reference.
- **Získání dat.** Jen soubory: CSV nebo HTML z **FM View Exporteru** (jiný projekt, plugin ve hře, nečten). Hlavičky musí být přesně jako ve hře v angličtině (`Unique ID`, `Player` povinné; 60 čtených sloupců, ~312 známých ignorovaných); české rozhraní hry by podle kódu selhalo. Verzi hry (FM24 nebo FM27) volí uživatel při zakládání savu, ze souboru se nezjišťuje. Do hry se nezapisuje (jen se na žádost kopírují pohledy a taktiky do složky dokumentů).
- **Data.** Identita, věk, klub, národnost, pozice (surový text), výška, noha, osobnost, mzda, hodnota, průměrná známka, **42 atributů 1 až 20 (rozsah `12-15` se bere jako střed, chybějící `-` jako 0)**. CA a PA se výslovně neberou (ani hvězdy), skryté atributy nejsou ve schématu.
- **Hodnocení hráče na roli (DWRS)** — vážený průměr atributů: 25 atributů ve skupinách důležitosti (váhy hráčů z pole 8/4/2/1/0,2, brankáři 3/2/1/0,5/0,25/0,2), násobič 1,5 pro klíčové atributy role a 1,2 pro žádoucí, výsledek přepočten na 0 až 100. **Ověřeno čtením:** kód sám říká, že jde o „skupiny důležitosti z FM24, předpoklad, dokud se nezkouší engine“ (`AttributeTiers.cpp:5-6`) a v seznamu 25 atributů s vahami **chybí** Heading, Crossing, Aggression, Bravery, Flair, Leadership a Corners, tedy se u hráčů z pole do vzorce nepočítají (podle čtenáře kódu přitom role FM27 některé z nich uvádějí jako klíčové). Chybějící hodnoty (neoskautovaní hráči) se čtou jako 0 a ne jako „neznámé“, ačkoli README tvrdí opak.
- **Nejlepší sestava.** *Jedna sestava:* maďarský algoritmus (přiřazení hráčů ke slotům) s celočíselnými prioritami: počet obsazených míst, součet hodnocení XI, počet obsazených míst B-týmu, součet B. *FM27 se dvěma sestavami (s míčem a bez míče):* každý hráč dostane místo v obou, maximalizuje se počet umístěných a pak `α·skóre_s_míčem + (1−α)·skóre_bez_míče` (α = 50 %), řešeno **min-cost flow**. Testy porovnávají řešiče s hrubou silou na malých vzorcích. Rozpor: README i rozhraní slibují „nejsilnější B-tým mezi stejně silnými XI“, ve FM27 to ale tak není.
- **Slabá místa** (medián DWRS sestavy; „vytlačení“ a „propad“ ≥ 8 bodů; prahy bez zdůvodnění), **poradce posil** (zkusí 12 nejlepších z trhu pro každé místo a přepočítá sestavu), **talent mládeže** (vzorec bez zdroje), **trénink** (okna „komunitní zkušenost“), **registrace do soutěží** (pravidla jako konstanty přepsané z autorových snímků; podle dokumentace „nejsou základ reálných pravidel“).
- **FM27.** Role s míčem i bez míče (79 rolí) jsou **přepis autorových snímků obrazovky**; váhy atributů, geometrie hřiště a trénink zůstaly z FM24; skutečný export FM27 v repozitáři není.
- **Licence.** Nezměněný text GPL-3.0 (**ověřeno**); držitel práv „© 2026 ElectroHugin“ podle okna O aplikaci (`AboutDialog.cpp:230`, podle čtenáře kódu). SPDX hlavičky ani „nebo novější“ nejsou. Datové tabulky vlastní licenci nemají a spadají pod GPL repozitáře; jejich původ je z autorových snímků (práva Sports Interactive nejasná).

### 3.3 FMSuperScout 1.7.2 (MIT, autor mavarobli)

- **Velikost.** 77 souborů: JavaScript 6,5 tis. řádků (z toho `app/app.js` 4,8 tis., **čistý JS bez závislostí**), C# 3,3 tis. (jádro čtečky paměti), C a Swift pro Mac. **Žádné závislosti** (jen vestavěné moduly Node).
- **Získání dat.** Windows: samostatný program čte paměť `fm.exe` zvenku (`OpenProcess`, `ReadProcessMemory`), objekty hledá podle typových tabulek a pole čte na pevných adresách odvozených z **cizích Cheat Engine tabulek**. F9 vyvolá sken. Mac: knihovna se do hry **vkládá** (`DYLD_INSERT_LIBRARIES`), chyba by shodila hru. Sestavení: čte se jen major.minor `game_plugin.dll` (27.0 a 26.3); **neznámé sestavení sken neblokuje** (jen žlutý nápis). Pojistky: rozsah CA/PA, nulová UID, starý dump se nepřepíše prázdným. Zátěž až ~550 MB paměti. EULA a ochrana proti podvodům: neověřeno.
- **Data.** Hráči: identita, 47 viditelných atributů, pozice, smlouvy, mzda. Štáb: 22 atributů a preferovaná práce. **Skryté čte a používá:** CA, PA (filtry, „wonderkid“, projekce, hodnota, kádr), reputaci (hodnota, cena, zájem), osobnost (zájem). Nečte: zápasy, taktiku, zranění, trénink, finance, formu, morálku. „Váš klub“ = klub, jehož tým ukazuje na objekt lidského manažera.
- **Analytika** (vše v `app/app.js`, čistý JS bez závislostí podle čtenáře kódu): **meta skóre** (váhy z cizího webu FM-Arena, testy FM26; Pace a Acceleration dohromady 43 % váhy, Tackling a Passing nula), **role-fit** (19 rolí, vlastní seznamy klíčových a žádoucích atributů „podle zeleně a modře označených vlastností ve hře“: `(2·Σklíčové + Σžádoucí)/(2·n_klíč + n_žád)`), hodnota (regrese na ~45 hráčích), požadovaná cena, zájem, projekce růstu, kádr po skupinách pozic. Většina stojí na skrytých datech.
- **Rozhraní.** Záložky Hráči, Štáb, Shortlist, Analýza; porovnání až 3 hráčů; PNG karta hráče; 4 jazyky. **Export CSV:** sloupce `Name, Position, Age, Club, Nationality, CA, PA, Value(GBP), AskingPrice(GBP), Wage(GBP), Contract, Interest`, čárka, CRLF, UTF-8 s BOM, vše v uvozovkách; při vypnutém zobrazení skrytých údajů sloupce CA, PA a AskingPrice **chybí** (proměnný počet sloupců).
- **Licence.** MIT, držitel „mavarobli“ (**ověřeno**). Nepokryto: váhy z FM-Arena, adresy z Cheat Engine tabulek, herní data (ID zemí), předkompilované binárky.
- **FM27.** Ano, 27.0 (rozložení databáze je rozložení FM26 plus jedna změněná adresa; „ověřeno na běžícím savu“ je slovo autora). Neověřený den prvního opravného vydání.

### 3.4 FMSAT 0.1.0 (bez licence, autor Glawster)

- **Název** je ve skutečnosti „Football Manager Squad **Assessment** Tool“. Alfa, Python 3.12 + PySide6, 313 souborů (Python 41 tis. řádků, 90 souborů testů).
- **Získání dat.** Jen snímky obrazovky přes OCR; typ obrazovky pozná podle klíčových slov. **Verzi hry nezjišťuje, FM27 se v kódu nevyskytuje** (ověřeno hledáním). Soubory `.fmf` jen prohlíží (entropie, řetězce, zkoušení komprese), **nedekóduje** je a tabulky kódů mentalit, instrukcí a rolí nemá; slovníky jsou přepis textů z rozhraní FM26 pro OCR.
- **Data.** Atributy (42), pozice, **CA a PA povinné** (bez jejich sloupců parser vrací prázdný seznam, **ověřeno**; slouží k identitě hráčů, do skóre nevstupují), taktika (sloty, role, povinnosti, 27 kategorií týmových pokynů), profil role.
- **Algoritmy.** *Vhodnost hráče na roli* (**ověřeno**): `skóre = Σ(hodnota×váha) / Σ(20×váha) × 100`; chybí-li vážený atribut, výsledek je „nedostupné“, nikdy nula (dobrý nápad). Váhy: 31 rolí × 10 až 12 atributů, celá čísla 0 až 10, původ nedoložen (autor píše, že jde o jeho politiku hodnocení, ne o skrytá fakta). *Nejlepší sestava:* dynamické programování přes bitové masky s lexikografickým cílem. **Hodnocení taktiky neexistuje.**
- **Rozhraní.** Qt: import, kontrola řádků, přehled sestavy a taktiky, hřiště, editor vah.
- **Licence.** Žádný soubor LICENSE ani zmínka (**ověřeno**), tedy „všechna práva vyhrazena“: kopírovat nelze nic (kód, váhy, slovníky, snímky), studovat a převzít obecné nápady lze. Soubory pro AI asistenty (`AGENTS.md`, `CLAUDE.md`) popisují jen vývojový postup autora.
- **Dobré nápady k nezávislému napsání:** politika „nedostupné místo nuly“, vysvětlitelné příspěvky atributů, model původu (extrahováno / opraveno / potvrzeno), slučování snímků bez CA/PA.

## 4. Licence a rizika

| Projekt | Smíme | Povinnosti | Licence nekryje | Riziko | Pravidlo pro nás |
|---|---|---|---|---|---|
| FMMatchLens | Převzít a upravit kód i data | Zachovat oznámení „Copyright (c) 2026 osnsyc“ a text MIT ve všech kopiích a podstatných částech | Fonty a obrázky bez licence, kopie komponent z knihoven, motivy podle komerčních služeb, binárky BepInEx a MonoMod | Nízké, pokud se přebírá jen čistá logika (čtečka archivu, mapy) | Přidat `THIRD_PARTY_NOTICES.md` s textem MIT a seznamem převzatých souborů; text oznámení vložit i do sestavené stránky |
| FMSuperScout | Převzít a upravit kód i data | Totéž (držitel „mavarobli“) | Váhy z webu FM-Arena, adresy z Cheat Engine tabulek (cizí licence neověřena), herní data (ID zemí), předkompilované binárky | Nízké u slovníků a čisté logiky; **vysoké** u vah (původ třetí strany) | Váhy jen s nápisem „odhad“; adresy a čtečku nepřebírat |
| FM Player Analyzer | **Jen myšlenky, metody a fakta** (Hungarian, min-cost flow, vzorec DWRS jako matematika, názvy sloupců) | — | Konkrétní zápis kódu, datové tabulky (role, registrace, váhy), překlady | **Vysoké:** zkopírovaný kus kódu nebo tabulky = odvozené dílo; při předání dál (a JavaScript se do prohlížeče stahuje) by musela být **celá aplikace pod GPL-3.0 se zdrojem**. Práva Sports Interactive k přepsaným tabulkám rolí nejasná | Nic nekopírovat ani nepřekládat řádek po řádku; psát vlastní implementaci podle popsané metody a s vlastními, označenými daty |
| FMSAT | Jen studovat a převzít obecné nápady | — | Všechno ostatní (výchozí „všechna práva vyhrazena“) | **Vysoké** při jakékoli kopii | Nic nekopírovat. Chceme-li jeho slovníky, napsat autorovi, ať přidá licenci. Nedoporučuji: cílí na FM26 |

Další pravidla:
- **Zatím nebyl převzat žádný cizí kód ani datová tabulka.** Čtečky v aplikaci (`matchlens.js`, `feed.js`, `tableimport.js`) jsou napsané samostatně podle tvaru rozhraní a formátů (což jsou fakta); proto `THIRD_PARTY_NOTICES.md` zatím není potřeba. Vznikne s prvním převzatým MIT kódem (etapa 2).
- Žádný z projektů neschvaluje čtení paměti pro soutěžní nebo online hru; plugin i skener jsou „na vlastní riziko“. Naše aplikace paměť **sama nečte**, jen převezme výstup nástroje, který uživatel sám spustil.
- Údaje z nástrojů jsou v aplikaci vždy „zadal uživatel (data od nástroje u tebe)“, nikdy „ověřeno hrou“.
- Herní názvy rolí, atributů a pozic patří Sports Interactive/SEGA. Nesdružujeme jejich přepsané tabulky; názvy se berou z toho, co uživatel nahraje nebo co aplikace přečte z obrazovky.
- Tento oddíl není právní porada.

## 5. Architektura jedné aplikace

Stávající aplikace **zůstává celá** (deset sekcí, kariéry, AI trenér s kontrolou poctivosti, Live Coach, hlas, soupeř, historie, škola, knihy a zdroje z webu). Nové zdroje dat se přidávají **jako adaptéry**, které na jednom místě přeloží cizí formát na naše záznamy. Nic dalšího se nemění.

```
 ZDROJE DAT (každý adaptér dá záznamu štítek původu)                      stav
   obrazovka hry (sdílení okna, vložený snímek) → čtení obrazu AI           hotovo   neověřeno, dokud neotvrdíš
   ruční zadání                                                             hotovo   zadal uživatel
   tabulky z nástrojů (CSV, TSV, HTML, JSON, fmsave)                        hotovo   zadal uživatel (soubor od tebe)
   FMMatchLens živě (127.0.0.1:16726)                                       hotovo   zadal uživatel + původ „fmmatchlens“
   FMMatchLens archiv .fmlens                                               etapa 2
   FMSuperScout dump / CSV, FM View Exporter (FM27 pohledy)                 etapa 3  jen viditelná pole
        │
        ▼  BRÁNA POCTIVOSTI: „nikdy nečíst“ (CA, PA, skryté atributy, osobnost, reputace, atributy soupeře),
        │  jeden seznam pro všechny adaptéry; testy po jeho vypnutí padají
        ▼
 DATA V ZAŘÍZENÍ: kariéra → hráči, taktiky, zápasy (časová osa snímků), soupeři, paměť, zdroje
        ▼
 ANALYTIKA (čisté moduly, bez AI, každý s testy)
   detektory problémů, vyhodnocení změny, graf průběhu zápasu            hotovo
   vhodnost na role + nejlepší sestava ve dvou fázích + slabá místa      etapa 1
   mapy z archivu: střely, přihrávky, tepelné mapy, pohyb               etapa 2
        ▼
 ZNALOSTI: knihy, zdroje z webu, škola (úryvky s původem)
        ▼
 AI TRENÉR: rada s kontrolou poctivosti (úrovně jistoty, odkazy, žádné skryté mechaniky), vysvětlení „proč“, výuka
        ▼
 ROZHRANÍ: Live Coach, Můj tým, Moje taktiky, Soupeř, Historie zápasů, Škola, … (beze změny; přibývají karty)
```

**Rozhodnutí architektury**

1. **Adaptér je jediné místo, kde se mluví s cizím nástrojem.** Zbytek aplikace vidí jen naše záznamy (snímek zápasu, hráč). Nový nástroj nebo nová verze pluginu proto nezasáhne analytiku ani AI.
2. **Štítek původu na každém záznamu** (úroveň jistoty + odkud, např. `via: fmmatchlens`). Úprava uživatelem původ přepíše na „zadal uživatel“.
3. **Brána „nikdy nečíst“** je jeden seznam a používají ho všechny adaptéry (už tak funguje pro tabulky a FMMatchLens, včetně zahazování atributů soupeře).
4. **Aplikace zůstává statická** (stránka v Claude a samostatná verze na GitHub Pages), bez našeho serveru. Lokální nástroje se čtou přes lokální adresu (jen tento počítač) nebo ze souboru.
5. **Dvě sestavení z jednoho kódu** zůstávají. Stránka v Claude lokální adresy většinou volat nesmí, samostatná verze ano; aplikace to umí oznámit a poradí.
6. **Nic cizího se nepřebírá jako „pravidlo hry“.** Váhy, prahy a modely z cizích nástrojů jsou jen odhad s nápisem a vždy s odkazem, odkud jsou.

## 6. Seznam využitelných částí

Typ převzetí: **kód MIT** = lze přepsat/převzít s oznámením; **metoda** = vlastní implementace podle popsaného postupu (u GPL a bez licence); **fakt** = tvar rozhraní nebo formátu; **nepřebírat**.

| # | Část | Zdroj | Typ | Stav |
|---|---|---|---|---|
| 1 | Klient živého API (`/api/health`, `/meta`, `/current`) a převod na snímek zápasu | FMMatchLens, `LocalApiServer.cs`, `realtimeMatch.ts` | fakt, vlastní kód | **Hotovo** |
| 2 | Minuta ze ticků (240 na minutu) | FMMatchLens, `realtimeMatch.ts:1024` | fakt | **Hotovo** |
| 3 | Sestava s rolemi a povinnostmi s míčem (bez míče v poznámce) | FMMatchLens, metadata hráčů | fakt, vlastní kód | **Hotovo** |
| 4 | Graf průběhu (xG, střely, držení) | nápad z FMMatchLens (XgTimeline) | vlastní kód | **Hotovo** |
| 5 | Načtení tabulek z nástrojů, skryté sloupce se vynechají | FM Player Analyzer, FMSuperScout (tvar CSV) | fakt, vlastní kód | **Hotovo** (profil FM View Exporteru: etapa 3) |
| 6 | **Čtečka archivu `.fmlens`** | FMMatchLens, `archiveParser.ts` (1157 ř.) | **kód MIT** | Etapa 2 |
| 7 | Sémantika typů událostí (přihrávky, střely, souboje se souřadnicemi) | FMMatchLens, `momentumEventSemantics.ts`, `Offsets.cs:66-159` | kód MIT; neznámé typy označit | Etapa 2 |
| 8 | Mapa střel, xG jednotlivé střely (odhad) | FMMatchLens, `replayDerivations.ts:510-666` | kód MIT, popisek „odhad“ | Etapa 2 |
| 9 | Mapa přihrávek | FMMatchLens, `passMap.ts` (224 ř.) | kód MIT | Etapa 2 |
| 10 | Tepelná mapa (akumulace do mřížky) | FMMatchLens, `heatmap.ts` | kód MIT (bez Pixi) | Etapa 2 |
| 11 | Pohyb a sprinty (pásma 7/20/25 km/h) | FMMatchLens, `playerMovement.ts` | kód MIT | Etapa 3 |
| 12 | Vhodnost hráče na roli, vysvětlitelná, **„nedostupné“ místo nuly** | FMSAT (metoda), FMSuperScout (seznamy klíčových atributů, MIT) | metoda + volitelně data MIT s nápisem „odhad“ | Etapa 1, čeká na rozhodnutí o vahách |
| 13 | Nejlepší sestava pro obě fáze hry (přiřazení: maďarský algoritmus, min-cost flow) a testy proti hrubé síle | FM Player Analyzer (metoda), FMSAT (bitové přiřazení) | **metoda** | Etapa 1 |
| 14 | Slabá místa a hloubka kádru bez CA/PA | FM Player Analyzer (nápad), FMSuperScout `app.js:4077-4192` | metoda / nápad | Etapa 1 |
| 15 | Profil importu „FM View Exporter FM27“ (hlavičky, aliasy, povinné sloupce) | FM Player Analyzer `ImportSchema.cpp` | fakt (názvy sloupců) | Etapa 3 |
| 16 | Slovníky atributů, pozic a rolí v dalších jazycích (nl, fr, de) | FMSuperScout `Fields.cs`, `app.js` | kód MIT (data) | Etapa 3 |
| 17 | Import `dump.json` a CSV shortlistu z FMSuperScout (jen viditelná pole) | FMSuperScout `Dumper.cs`, `app.js:2984-3006` | fakt | Etapa 3 |
| 18 | Taktika z pluginu: formace a role v obou fázích do „Moje taktiky“ (formaci potvrdí uživatel) | FMMatchLens, `/formation/history`, `TacticalFormationDecoder.cs` | fakt + metoda | Etapa 4 |
| 19 | Ovládání prostoru | FMMatchLens, `pitchControl.ts` | jen jako označený model (konstanty nedoloženy) | Odloženo |
| 20 | Momentum | FMMatchLens, `MomentumCalculator.cs` | nepřepisovat; číst hotové body z API | Odloženo |
| 21 | Rozpad hodnocení hráče; DWRS, meta skóre, hodnota, cena, zájem, talent, trénink, registrace | všechny čtyři | **nepřebírat** (nedoložené váhy, skrytá data, práva) | — |
| 22 | Čtečky paměti, vkládání do hry, samoaktualizace | FMMatchLens, FMSuperScout | **nepřebírat** (proti zásadám, nepřenositelné do prohlížeče) | — |
| 23 | Dekodér `.fmf` | FMSAT `fmf/` | **není co převzít** (nic nedekóduje) | — |

## 7. Plán implementace

Každá etapa končí testy v obou směrech (kontrola projde, rozbitá pojistka zkoušku shodí), dokumentací a nasazením. Žádná etapa nemění stávající funkce.

| Etapa | Obsah | Hotovo když | Potřebuji od majitele |
|---|---|---|---|
| **E0 — hotovo 5. 11.** | Import tabulek hráčů; FMMatchLens živě (sledování zápasu bez AI, sestava s rolemi); graf průběhu zápasu; tento audit | 598 testů jádra, 677 kontrol v prohlížeči; nahrané na GitHub | Vyzkoušet doma (viz 9) |
| **E1 — sestava a role** | Vhodnost hráče na roli s politikou „nedostupné“ a rozpisem příspěvků atributů; nejlepší sestava pro obě fáze (vlastní přiřazování); slabá místa; výstup jde AI trenérovi jako pozorování s nápisem „odhad“ | Řešič shoduje s hrubou silou na tisících náhodných vzorků; váhy vždy s původem a upravitelné; bez CA/PA | **Rozhodnutí o zdroji vah** a snímky obrazovky rolí z FM27 |
| **E2 — rozbor po zápase z archivu** | Čtečka `.fmlens` (kód MIT přepsaný do čistého JS), události, mapa střel a přihrávek, tepelné mapy; rozbor po zápase s AI nad skutečnými daty; ořez CA/PA a cest k souborům | Čtečka projde zkouškami se zapsaným archivem podle formátu **a se skutečným souborem od majitele** | **1 až 2 skutečné archivy `.fmlens` z FM27** |
| **E3 — další importy** | Profil FM View Exporteru (FM27), `dump.json` a CSV z FMSuperScout (jen viditelná pole), hlavičky v dalších jazycích, pohyb a sprinty | Reálné exporty z FM27 se načtou s navrženým mapováním | Ukázkové soubory z nástrojů |
| **E4 — taktika z pluginu** | Formace a role s míčem i bez míče z pluginu do „Moje taktiky“, porovnání s tím, co hraješ, vysvětlení „proč“ s citacemi z knih | Formace se nikdy nehádá (nejasné potvrdí uživatel) | Vyzkoušet na skutečné hře |
| **E5 — ověření na skutečné hře** | Kontrolní seznam (plugin, sestavení hry, spojení, jeden zápas, snímky, graf, sestava), sběr diagnostiky, opravy; **po prvním opravném vydání FM27 znovu** | Jeden celý zápas načtený a rozebraný | Majitel, na svém počítači |

Rizika plánu: (1) tvar dat pluginu se bez hry ověřit nedá; (2) po opravném vydání FM27 se mohou změnit adresy v paměti a plugin nebo skener přestanou fungovat (tohle nejde z naší strany opravit, jen počkat na novou verzi nástroje); (3) prohlížeč může stránce z internetu zakázat volání tohoto počítače (Chrome se ptá na povolení; Safari to zakazuje); (4) role, váhy a prahy z cizích nástrojů jsou odhad.

## 8. Co je už hotové (z této relace)

Vše je v repozitáři `janvasilecko-droid/fm27-apka`, větev `main`, a nasazené na https://janvasilecko-droid.github.io/FM27-apka/ (stránka v Claude: https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh).

| Co | Jak se pozná | Zkoušky |
|---|---|---|
| **Načíst hráče z tabulky exportu** (CSV, TSV, HTML, JSON, výstup fmsave): Můj tým → „Načíst hráče z exportu“ | Soubor se čte v zařízení, bez AI; aplikace navrhne význam sloupců, uživatel potvrdí; skryté sloupce (CA, PA, skryté atributy) se nenačtou a je vidět proč | `tableimport.test.mjs` (22), zkouška 15 (34) |
| **Živá data zápasu z FMMatchLens**: Live Coach → karta „Živá data z FMMatchLens“ | Volá jen tento počítač; sleduje zápas podle herního času (gól, červená, nová část, 1 až 10 minut); bez AI; zápas se založí z dat pluginu | `matchlens.test.mjs` (18), zkouška 16 (41) |
| **Sestava z FMMatchLens**: Můj tým → „Sestava z FMMatchLens“ | Role a povinnosti s míčem, viditelné atributy mého týmu; **atributy soupeře se nikdy nepřebírají** (a když není poznat, který tým je můj, nepřebírají se žádné) | tamtéž |
| **Graf průběhu zápasu** (xG, střely, střely na bránu, držení): Live Coach a Historie zápasů | Body jsou snímky, nic se nedopočítává; tabulka pro čtečky | zkouška 17 (14) |
| Šedé tlačítko „Načíst“ nabízí i tabulku a FMMatchLens | — | zkouška 14 (35) |

Ověřeno i opačně: když se rozbije kontrola adresy, načtou se skryté atributy nebo graf vezme špatnou stranu, zkoušky spadnou. **Co hotovo není a nejde z cloudu ověřit:** čtení skutečného pluginu a skutečné hry (zkoušky používají náhražku podle zdrojového kódu pluginu), skutečný export z cizích nástrojů a chování prohlížeče vůči volání lokální adresy.

Od dřívějška nezměněné a funkční: čtení obrazovky, taktiky, soupeř, historie, škola, knihy, zdroje z webu, hlas, kariéry a synchronizace.

## 9. Nejistoty a co zkusit doma

**Nejistoty (z auditu)**
- Nic z cizích projektů se nespouštělo; počty řádků jsou z `wc`, ne z měření. Klony jsou mělké (jeden commit), takže historie, počet autorů a aktivita po 28. 8. (FMSAT) nebo 2. 11. (FM Player Analyzer) nejsou známy.
- Adresy v paměti, hashe sestavení a jejich vazba na konkrétní vydání FM27: jen z komentářů autorů. Který ze dvou známých buildů FMMatchLens je který, nevíme.
- Zda hra u soupeřových hráčů v zápase atributy maskuje (plugin čte přesné): z kódu nezjistitelné; proto se neberou žádné atributy kromě atributů mého týmu, a když plugin nepozná, který tým je můj, tak žádné.
- Dopad pluginu na výkon a stabilitu hry, podmínky hry (EULA) a ochrana proti podvodům: neověřeno u žádného nástroje.
- Licence zdrojů třetích stran uvnitř cizích repozitářů (BepInEx, MonoMod, Qt, adresy z Cheat Engine tabulek, váhy z FM-Arena): neověřeno.
- FM View Exporter (z něj čerpá FM Player Analyzer) nebyl čten; jeho formát a licenci neznáme.
- `.fmf`: ani FMSAT ho nedekóduje. Naše dosavadní zjištění (kontejner s klíčem uvnitř a zstd, tabulky kódů jen v kódu bez licence) platí; dekódování taktiky ze souboru zůstává otevřené a potřebuje vzorky od majitele.

**Co vyzkoušet doma (5 minut, nic se neinstaluje do hry)**
1. Otevři https://janvasilecko-droid.github.io/FM27-apka/ → Můj tým → „Načíst hráče z exportu“ a nahraj libovolné CSV/HTML z nástroje, který používáš. Zkontroluj navržené sloupce.
2. Až budeš mít nainstalovaný FMMatchLens (podle jeho README: BepInEx 6 a plugin do složky hry, jen Steam a Windows): Live Coach → „Zkusit spojení“. Prohlížeč se může zeptat na povolení přístupu k tomuto počítači, povol ho. Aplikace napíše, co zkontrolovat, když spojení nejde.
3. Pošli mi (bez hesel a klíčů) text z řádků pod tlačítkem „Zkusit spojení“ a případně jeden archiv `.fmlens` po zápase; podle nich opravím, co se liší od zdrojového kódu pluginu.
