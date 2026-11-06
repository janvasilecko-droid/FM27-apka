# Nezávislá revize čtečky `.fmf` a dekodéru zstd (5. až 6. 11. 2026)

Po dokončení čtečky `.fmf`, vlastního dekodéru zstd a přestupového poradce nechal autor kód projít dvěma koly revize (AI agenti, každý zvlášť, bez znalosti úvah autora i ostatních revizorů).
**Nejde o revizi člověkem ani o bezpečnostní audit**: revizor je model, jeho nález je další pohled, ne důkaz. Revizoři měli hledat konkrétní chyby a každou doložit spuštěním; každý nález
jsem znovu ověřil vlastním během, než jsem ho opravil. Zprávy revizorů v repozitáři nejsou (obsahují skripty s hostilními soubory); nálezy jsou shrnuté tady.

| Kolo | Revizoři | Výsledek |
|---|---|---|
| 1 (5. 11.) A | odolnost proti nepřátelskému souboru: dekodér zstd, lepidlo, čtečka kontejneru, starší kontrola `.fmf`, čištění textů | 6 nálezů (část 1A) |
| 1 (5. 11.) B | správnost tvrzení, poctivost popisků a dokumentace, síla zkoušek (zejména porovnání s libzstd) | 8 nálezů (část 1B) |
| 2 (6. 11.) bezpečnost, poctivost, zkoušky | tři revizoři; každý nález pak samostatně ověřovali tři „skeptici“ (každý jen svou oblast), kteří ho zkoušeli vyvrátit vlastním během | 27 nálezů, všechny skeptici potvrdili (u jednoho zúžili, viz T4); část 2 |

Kolo 2 odhalilo, co kolo 1 (a já) zanechalo nepravdivě nebo nehlídané: tvrzení o libzstd, čísla bez zdroje a zkoušky, které nic nehlídaly.
Kde se text kola 1 později ukázal jako nepřesný, je to u něj výslovně poznamenáno („opraveno v kole 2“); původní chybný údaj se nemazal.

## Část 1A: odolnost (kolo 1)

| # | Nález | Oprava | Kde se hlídá |
|---|---|---|---|
| 1 | Rámec z desítek tisíc „drahých“ bloků (každý staví Huffmanův strom a tři tabulky FSE a vydá tři bajty) zdržel stránku: soubor o 22 MiB s devíti takovými rámci se četl 24 s, soubor o 4,7 MiB se šestnácti kandidáty na společném ocasu u starší kontroly 153 s. Výstup byl omezený, práce ne. | Počet bloků v rámci je omezený podle povoleného výstupu (jeden na KiB + 16, nebo podle slíbené velikosti obsahu; kód `blocks`); lepidlo má rozpočet bloků na jedno čtení souboru a **účtuje i rámce, které selžou** (kolo 1: 40 000 bloků, od kola 2: 20 000); starší kontrola bere nejvýš 64 bloků na kandidáta. Po opravě: tentýž soubor o 22 MiB se odmítne za 0,12 s a soubor se šestnácti kandidáty za 0,06 s. | `zstd.test.mjs` (strop, odvození, pořadí kontrol, 190 000 bloků), `fmfglue.test.mjs` (rozpočet, účtování selhání, 64 bloků, šestnáct kandidátů s přesným počtem bloků), `fmfcontainer.test.mjs` |
| 2 | `inspectFmf` zkoušel šestnáct kandidátů, každého s plnou prací | viz 1 (64 bloků na kandidáta) | `fmfglue.test.mjs` |
| 3 | Záznam zčásti nebo celý mimo datovou část vedl k tvrzení „záznamy beze zbytku vyplňují datovou část“ | rozložení nese i počet záznamů mimo (`outside`), `contiguous` je pravda jen bez mezer i bez záznamů mimo, a hlásí se to varováním | `fmfcontainer.test.mjs`, scénář 21 |
| 4 | Souhrn „kontrolní součet souhlasí u N z nich“ počítal i zdroje, které se neověřily (správný součet, ale jiná velikost než v manifestu) | počítají se jen ověřené zdroje | `fmfcontainer.test.mjs` |
| 5 | Pět míst, kde se čistí cizí text (soubor, odpověď modelu, web, plugin), nepokrývalo formátovací znaky Unicode (izoláty směru písma, značky, výplně hangul, prázdné braillské písmeno, selektory variant) | jednotná třída znaků ve všech pěti modulech. **Opraveno v kole 2:** tehdejší zkouška měla 134 ručně vybraných znaků (dokumentace tvrdila „kolem 170“), tři další čističe tu třídu vůbec neměly a šest přidělených neviditelných znaků (mongolské variační selektory, khmerské samohlásky) procházelo všemi; viz T0, T8, H4, H14 | `sanitize.test.mjs` |
| 6 | Zpráva o chybě u starší kontroly označila i obří okno a příliš mnoho bloků jako „překročil limit 1 MiB“ | to hlášení patří jen kódu `limit` | `tactics.test.mjs` |

## Část 1B: poctivost a síla zkoušek (kolo 1)

| # | Nález | Oprava |
|---|---|---|
| 7 | **Nepravdivé tvrzení o libzstd**: dokumentace a komentáře říkaly, že libzstd u sekvencí přijme čtení za konec proudu bitů. Zkouška proti libzstd 1.5.7 (Python `zstandard` 0.25.0) ukázala opak: sekvence odmítá stejně jako my (nepřečtené bity, čtení za začátek), odmítá i nulový opakovaný posun. | Skutečně se lišily tři případy, kde je libzstd shovívavější než specifikace: odkaz dál než okno rámce (u nás kód `window`), blok větší než okno u rámce s uvedenou velikostí obsahu (`blocksize`), pokažený konec čtyřproudých literálů (`litend`). **Opraveno v kole 2:** rozdílů je pět, ne tři, a práh u `litend` není „255 znaků“; viz část 2, T1, H1, S2 a „Rozdíly proti libzstd“ níže. |
| 8 | Porovnávací pomůcka zkoušek tolerovala i kód `overread` a omlouvala každé odmítnutí libzstd vadným kontrolním součtem | tolerují se jen kódy shovívavosti; výjimka u součtu se ověřuje: stejný rámec s opraveným součtem se pošle libzstd znovu a ten ho musí přijmout se stejným výstupem |
| 9 | Bez Pythonu a balíčku `zstandard` se porovnání s libzstd tiše přeskočilo | první zkouška v souboru dostupnost zjistí a hlásí „přeskočeno“; s `ZSTD_ORACLE_REQUIRED=1` selže; samostatná kontrola `.github/workflows/zstd-oracle.yml` běží s povinnou věštírnou po každé změně dekodéru. **Opraveno v kole 2:** povinnost se týkala jen jednoho dotazu; viz T1 |
| 10 | Slabé zkoušky: „bomba“ z 53 bajtů ověřovala jen, že se něco odmítne; tautologie; nepoužité proměnné; zkouška se skutečnými soubory se při špatné cestě tiše přeskočila; scénář 21 vypisoval začátky názvů skutečných souborů | bomba je blok s největším možným počtem sekvencí (98 047) a hlídá se přesná chyba i čas; místo tautologie se porovnávají verdikty libzstd s ručně popsanými; skutečné soubory se bez proměnné `FMF_SAMPLES_DIR` přeskočí viditelně (`skip`) a se špatnou cestou zkouška selže; scénář 21 píše „skutečný export č. N z M“ |
| 11 | Popisky v aplikaci: banner „sedí u všech zdrojů“ i když se zdroj neověřil; „zašifrováno“ u velikosti záznamu, která zahrnuje klíč a IV; text bez WebCrypto tvrdil, že aplikace nezná strukturu `.fmf` | banner to říká o všech zdrojích jen když se ověřily všechny, jinak výslovně o ověřených; „záznam N B (s klíčem a IV)“; bez WebCrypto věta o důvodu místo tvrzení o struktuře. **Opraveno v kole 2:** tyto věty hlídal jen scénář v prohlížeči, který žádná kontrola před nasazením nespouští; viz T2 |
| 12 | Dokumentace: „tři nezávislí ověřovatelé“ a „dva analytici“ (byly to běhy téhož modelu), „9 zdrojů bajt po bajtu“ bez zdroje, „čtyřech skupinách“ u počtu 495, soubor se „nepovažuje za přečtený“ i u drobných odchylek, zpráva o souboru „jen velikosti“ (nese i názvy z manifestu), nepravdivé odkazy na neexistující moduly, zastaralá čísla v matici | opraveno; porovnání devíti zdrojů s výstupem prvního rozboru (libzstd) jsem znovu provedl s kódem z repozitáře: 9 z 9 shodných. **Opraveno v kole 2:** číslo 495 a čísla v matici byla znovu nepřesná, viz H5, H13 |
| 13 | `.gitignore` nechránil před náhodným přidáním cizích taktik | `*.fmf`, `*.tac`, `*.aom` jsou ignorované |
| 14 | **Zkratky názvů ukázkových taktik jsou ve veřejné historii** (od 4. 11. v předávacích dokumentech z Cursoru, krátce i v dokumentaci z 5. 11.) | v aktuální verzi zamaskováno; **přepsání historie je rozhodnutí majitele** (změnilo by všechny hashe commitů a vyžaduje vynucené nahrání) |

## Část 2: kolo 2, 27 potvrzených nálezů (6. 11. 2026)

### Bezpečnost (2)

| # | Nález | Oprava | Kde se hlídá |
|---|---|---|---|
| S1 | **Zdržení stránky.** Záznam, který se rozbalí a až na konci selže, se nezapočítal do žádného rozpočtu: soubor o ~100 kB s 64 záznamy (nejvíc, co manifest dovolí), z nichž každý vydá 16,6 MB ze samých tříbajtových sekvencí a selže na posledním kroku, se četl 46 s (skeptik změřil 46,1 s, revizor 44,1 s). Rozpočet bloků to nezastavil, protože počítá bloky, ne práci uvnitř bloku. | Lepidlo má druhý rozpočet: **výstup 33 MiB na jedno čtení souboru**, účtuje se i za rámce, které selžou, a zbytek rozpočtu je strop pro další rámec. Chyby dekodéru nesou počet zpracovaných bloků (`blocks`) a vydaných bajtů (`produced`), aby se dala započítat práce i za selhaný rámec; cizí výjimka se zabalí jako `ZstdError` s kódem `internal`. Rozpočet bloků je 20 000 (stavba tabulek v bloku stojí kolem 45 µs). **Změřeno** (Node 22, 4 jádra; jedno měření, ne záruka): podobný soubor (64 záznamů, 120 589 B) 1,3 s místo 44,5 s; nejhorší soubor, který rozpočty ještě pustí (dva platné záznamy po 16,6 MB s kontrolním součtem a tři záznamy z drahých bloků vadné až na konci, 499 kB), se čte 2,6 s; soubor o 20,8 MiB z 56 záznamů z drahých bloků vadných na konci 0,75 s. | `fmfglue.test.mjs` (oba rozpočty na bajt přesně, účtování selhání, chyby bez údaje nic neúčtují), `fmfcontainer.test.mjs` (64 záznamů, dvanáct záznamů vadných až na konci), `zstd.test.mjs`; mutační sada lepidla 40 z 40 |
| S2 | Dekodér přijímá rámce, které libzstd 1.5.7 odmítá: váhy Huffmanova stromu zapsané přes FSE s přesností 6, když tabulka uvádí symbol 12 a víc (libzstd na ně nemá pracovní paměť), a kód Huffmana dlouhý 12 bitů (RFC 8878 mluví o nejvýš 11). Výstup přitom není špatný, literály vyjdou přesně. | **Nezpřísňuje se**: libzstd 12bitové kódy také přijímá a odmítnutí FSE vah je omezení její pracovní paměti, ne formátu; riziko plyne jen z přijetí něčeho, co je podle RFC platné. Ale hlavička dekodéru, dokumentace i zkouška to teď říkají pravdivě, jako 5. odchylku. | `zstd.test.mjs`, „dvě další odchylky od libzstd“ (nezávislý zapisovač stromů s FSE váhami; potvrzeno i na přesnosti 5: symbol 91 libzstd přijme, 92 odmítne) |

### Poctivost tvrzení (15)

| # | Nález | Oprava |
|---|---|---|
| H0 | Komentář u kódu `overread` stále tvrdil, že libzstd u sekvencí čtení za začátek proudu přijme, tedy to nepravdivé tvrzení, které bod 7 prohlašoval za opravené. | Komentář opraven; zkoušky konců proudů (přímé i proti libzstd) to hlídají. |
| H1 | Práh „pokažený konec čtyřproudých literálů od 255 znaků“ byl špatně (komentáře, názvy zkoušek, README, tento dokument). | Změřeno: libzstd přestane konec kontrolovat, když **každý ze čtyř proudů má aspoň 8 bajtů** (podle zdrojového kódu 1.5.7: rychlá cesta potřebuje všechny čtyři proudy aspoň po 8 bajtech a v sestavení s dynamickým BMI2 se používá jen na procesoru s BMI2). Na 123 měřených případech (nejkratší proud 3 až 13 B) pravidlo platí bez jediné výjimky; počet znaků rozhoduje podle kódů (u zkoušeného stromu leží hranice mezi 148 a 152 znaky). Zkouška s tím počítá a na procesoru bez BMI2 (který tu nebyl k dispozici) smí libzstd rámec odmítnout. |
| H2 | Věta „cizí projekty bez licence jsme nečetli“ (`FORMAT_FMF.md`) odporovala dokumentům, které čtení zdrojů neslicencovaných projektů přiznávají. | Pravdivé je jen to, že se nečetl žádný dekodér `.fmf`; věta to říká a odkazuje na dokumenty o ostatních projektech. |
| H3 | Matice a `POKRACOVANI.md` označovaly vhodnost hráčů v přestupech plošně za „odhad aplikace (ESTIMATED)“, ale výchozí model je jednoduchý vážený průměr, což metodika značí CUSTOM MODEL; ESTIMATED patří jen tabulkám DWRS. | Opraveno v matici, v `POKRACOVANI.md` i v záhlaví `recruit.js`: DWRS = ESTIMATED, vážený průměr = CUSTOM MODEL, vždy se píše, který. |
| H4 | „Kolem 170 znaků × pět modulů“ u čištění textů; zkouška měla 134 znaků. | Zkouška už seznam neopisuje: **bere každý přidělený znak** s vlastností Cc, Cf, Zl, Zp nebo Default_Ignorable_Code_Point plus prázdné braillské písmeno a náhradní znak objektu; v Node 22 je to **506 znaků × devět modulů**. |
| H5 | Matice si odporovala (oddíl 4 měl nová čísla, řádky 4, 7 a 15 stará). | Čísla sjednocena podle úplných běhů z 6. 11. (viz „Co po opravách platí“). |
| H6 | Zastaralé věty: matice (pole taktiky „není známo, jak jsou uložená“, ač stavba je popsaná a čtená celá), `ARCHITEKTURA_V2.md` (`fmfglue.js` jen „první rámec“; „skutečný `.fmf`“ mezi neověřitelným, ač se tři skutečné exporty čtou v Node i v Chromiu). | Opraveno. |
| H7 | README tvrdilo „předání z Cursoru, beze změn“, ale soubory se upravily (maskování zkratek názvů ukázkových taktik). | README tu úpravu uvádí. |
| H8 | Tento dokument nebyl odkazovaný z README, `POKRACOVANI.md`, matice ani `trener/README.md`, které odkazovaly jen na starší revizi z 4. 11. | Odkazy přidány. |
| H9 | Čísla „přes milion poškozených rámců“, „391 případů na 32 000 rámcích“ a „198 mutací“ se opírala o skripty, které v repozitáři nejsou; příkaz z README poslal libzstd jen 23 476 rámců a 391 se nedalo zopakovat. | Mutační nástroje jsou teď v repozitáři (`trener/test/mutation/`, s návodem) a čísla níže jsou z běhů, které se dají zopakovat příkazy z `trener/README.md`. Číslo 391 jsem nezopakoval a nepoužívám ho. |
| H10 | Komentář u `BYTES_PER_BLOCK` tvrdil, že platné rámce z libzstd mají bloky po 128 KiB. | Komentář opraven; omezení je teď popsané (a zkoušené) jako známé: platný rámec s průměrným blokem pod 1 KiB (například ze zapisovače, který po každých pár bajtech vyprázdní vyrovnávací paměť) se odmítne s kódem `blocks`, i když ho libzstd přijme. Ve třech skutečných exportech má každý ze čtyř rámců jediný blok. |
| H11 | Komentář zkoušky tvrdil kontrolu `strayBytes`, kterou zkouška neměla. | Kontrola doplněna; mutace, které ji obcházely, jsou zachycené. |
| H12 | „Popis tabulek FSE“ byl veden mezi věcmi zkoušenými proti libzstd, ale samostatná zkouška popisu je kruhová (vlastní zapisovač, vlastní čtečka). | Popis upřesněn: proti libzstd jen nepřímo (rámce, které sama napsala, a ruční případy); kruhová zkouška sama o shodě nic nedokazuje. |
| H13 | „Z 495 možných rozdělení vyhovují čtyři“ nesedí s popisem v téže větě (bity 0 a 2 až 14 jsou čtrnáct poloh; 495 platí pro třináct poloh 2 až 14). | Věta říká, pro kolik poloh číslo platí; pro čtrnáct poloh je rozdělení 715 a kolik jich vyhovuje, se nepřepočítávalo. |
| H14 | Komentáře ve všech čističích tvrdily pokrytí „neviditelných výplní a selektorů“, ale šest přidělených neviditelných znaků (U+17B4, U+17B5, U+180B až U+180D, U+180F) v textu zůstávalo. | Třída znaků je teď podle vlastností Unicode, ne podle ručního výčtu (viz H4, T0). |

### Síla zkoušek (10)

| # | Nález | Oprava |
|---|---|---|
| T0 | Oprava jednotné třídy znaků se týkala pěti modulů; tři další čističe cizího textu (`careerread.js`, `tactics.js`, `tableimport.js`) měly starou třídu nebo jen ASCII a žádná zkouška to nepoznala. | Všech **devět míst** (`fmftac`, `recruit`, `rolefit`, `matchlens`, `websources`, `careerread`, `tactics`, `tableimport`, `core.oneLine`) používá tutéž třídu; zkouška projde každý přidělený znak každým z nich a **ve všech zdrojích v `trener/src` a `trener/test` hlídá, že není doslovný neviditelný ani přepínací znak** (několik se jich našlo a nahradilo zápisem přes escape). Vrácení původní třídy shodí zkoušku v každém z devíti modulů. |
| T1 | `ZSTD_ORACLE_REQUIRED=1` hlídal jen dostupnost věštírny na jednom jednořádkovém dotazu; když věštírna na větší dávce spadla, všech 15 porovnání s libzstd se tiše přeskočilo i v „povinném“ běhu. | Jakmile se věštírna při zkoušce dostupnosti osvědčí, je její pozdější selhání chyba zkoušky (ne přeskočení); časový limit dávky je 300 s. Ověřeno záměrně rozbitým interpretem (selže, nepřeskočí). |
| T2 | Popisky opravené v kole 1 (banner „u všech zdrojů“, „záznam N B (s klíčem a IV)“, věta bez WebCrypto) hlídal jen scénář v prohlížeči; celá sada `node --test` prošla i po vrácení nepravdivých textů (7 mutací přežilo). | Věty jsou čisté funkce v `fmfcontainer.js` (`entryText`, `readBannerText`, `badSourcesText`, `inspectText`, `sizeProblemText`) s vlastní zkouškou v Node včetně skloňování počtu („zdroj, zdroje, zdrojů“; dřív „5 zdroje“); obrazovka je jen volá. |
| T3 | Nová logika rozložení v datové části měla neodhalené mutace (starý vzorec `strayBytes`, hranice `outside`, množné číslo, řazení záznamů). | Zkoušky doplněny; **mutační sada čtečky kontejneru 18 z 18 zachycena** (původně přežívaly mutace starého vzorce `strayBytes`, hranic `outside`, množného čísla, řazení záznamů a tolerance překryvu). |
| T4 | Časové meze zkoušek byly 5 až 1000krát nad skutečným časem a regres nepoznaly (zkouška šestnácti kandidátů prošla i bez stropu 64 bloků). Skeptik zúžil: tvrzení, že zkouška „soubor s mnoha záznamy“ projde i bez rozpočtu, neplatí. | Zkouška šestnácti kandidátů teď hlídá **přesný počet bloků** (každý kandidát se zastaví na 65.), ne jen čas; ostatní časové meze zůstávají jako pojistka, rozhodují počty a kódy chyb. |
| T5 | Ochrana proti přidělení paměti z drobného rámce (počáteční vyrovnávací paměť nejvýš 1 MiB, růst podle výstupu) neměla zkoušku; podle skeptika přidělil 13bajtový rámec slibující 2^29 v původní verzi hned 512 MiB. | Zkouška měří přidělenou paměť (`arrayBuffers`) u rámce slibujícího 2^29 i u růstu na 3 MiB; mutace bez omezení je zachycena. |
| T6 | Meze kontejneru proti nepřátelskému souboru (strop vstupu 24 MiB, manifestu 1 MiB, záznamu 16 MiB, součtu 32 MiB, 64 souborů, 100 000 bloků v `zstdFrameInfo`) nebyly zkoušené vůbec (7 mutací přežilo). | Jedna zkouška staví soubory na bajt přesně nad i pod každou z mezí. |
| T7 | Strop počtu bloků odmítne platné proudově zapsané rámce s drobnými bloky a žádná zkouška to neukazovala. | Zkouška „známé omezení“ (40 bloků po 5 bajtech: s volným stropem projde, při stropu podle velikosti výstupu se odmítne kódem `blocks`, libzstd ho přijme); omezení je popsané v dokumentaci. |
| T8 | Seznam skrytých znaků byl vybraný ručně a zkouška nikdy neprocházela vlastnost Unicode. | Seznam se generuje z vlastností Unicode (viz H4). |
| T9 | Drobné neprověřené větve: obalení cizí výjimky (`internal`), `exact` jen pro pravdivé `true`, zkouška obřího okna věštírnu nevolala. | Zkoušky doplněny (včetně cizí výjimky až uvnitř rozbalování, která nese počet bloků a bajtů); zkouška obřích oken se ptá libzstd. |

### Co jsem při opravách našel sám
- **Pátá odchylka od libzstd:** libzstd bere velikost obsahu 2^64−1 jako „neuvedeno“ a rámec rozbalí; my ji odmítneme (není to bezpečné celé číslo). Našlo se při doplnění dotazu na libzstd do zkoušky obřích oken.
- **Mutační sada lepidla** byla napsaná pro starší kód (vzory se nenašly); přepsaná na 40 mutací včetně rozpočtu výstupu, jedna přežila (chyba bez údaje o vydaných bajtech se účtovala jako 16 MiB) a dostala zkoušku. **Mutační sada dekodéru** má 211 mutací (13 nových k chybám, vydaným bajtům, obalu výjimek, paměti a `exact`); dvě přežily (obalení cizí výjimky uvnitř rozbalování) a dostaly zkoušku.
- **Kontrola velikosti souboru před načtením:** obrazovka načítala celý soubor do paměti dřív, než čtečka zkontrolovala jeho velikost; teď se soubor nad 24 MiB (čtečka) a nad 5 MiB (starší kontrola) odmítne podle `file.size`, a to i ve scénáři v prohlížeči.

## Rozdíly proti libzstd 1.5.7 (stav po kole 2)

Měřeno proti libzstd 1.5.7 přes Python balíček `zstandard` 0.25.0 na jednom stroji s BMI2. Každý případ má zkoušku v `test/zstd.test.mjs`.

| # | Případ | libzstd | náš dekodér |
|---|---|---|---|
| 1 | odkaz dál než okno rámce, když data ještě drží ve vyrovnávací paměti | přijme | odmítne, kód `window` |
| 2 | blok větší než okno u rámce s uvedenou velikostí obsahu | přijme | odmítne, kód `blocksize` |
| 3 | pokažený konec čtyřproudých literálů, když má každý ze čtyř proudů aspoň 8 bajtů | přijme (podle zdroje jen na procesoru s BMI2) | odmítne, kód `litend` |
| 4 | velikost obsahu 2^64−1 | bere jako „neuvedeno“, rozbalí | odmítne, kód `corrupt` |
| 5 | váhy Huffmanova stromu přes FSE, tabulka uvádí symbol 12 a víc při přesnosti 6 (92 a víc při přesnosti 5) | odmítne (nevejde se do pracovní paměti) | přijme, literály vyjdou přesně |

Shodují se na sekvencích (nepřečtené bity, čtení za začátek proudu, nulový opakovaný posun odmítají oba) a na 12bitových kódech Huffmana (přijímají oba). Náhodné poškození rámců na odchylky 4 a 5 nenarazí, proto je zkouška míří přímo; náhodná srovnávací zkouška toleruje jen odchylky 1 až 3.

## Co po opravách platí

- Testy jádra: **897**; všechny projdou s věštírnou libzstd (`ZSTD_ORACLE_REQUIRED=1`) i se skutečnými exporty z FM27 (`FMF_SAMPLES_DIR`); bez nich se 5 přeskočí viditelně (2 se skutečnými exporty a 3 s libzstd). Python: 143 + 11 (část se přeskočí bez doplňkových souborů). Prohlížeč: 904 kontrol v 22 scénářích, všechny v pořádku (4 z nich jen se skutečnými exporty, bez nich 900); scénář 21 má nově kontrolu odmítnutí souboru o bajt většího než 24 MiB a 5 MiB.
- Porovnání poškozených rámců s libzstd: 12 000 rámců na semínko `ZSTD_SEED`; **semínka 1 až 200 (2 400 000 poškozených rámců) všechna prošla** (6. 11. 2026, příkaz je v `trener/README.md`).
- Mutace (každá musí shodit aspoň jednu zkoušku; `trener/test/mutation/`): dekodér zstd **211 z 211** bez věštírny, lepidlo **40 z 40**, čtečka kontejneru **18 z 18**; čištění textů: vrácení původní třídy shodí zkoušku ve všech devíti modulech. Mutace dokazují jen to, že zkoušky chytí chyby, které jsem do seznamu napsal.
- Dekodér proti libzstd: platné rámce úrovní 1, 3, 9, 19 a 22, strategií 1 až 9, oken 1 KiB až 8 MiB a dlouhých shod (LDM), ručně sestavené Huffmanovy stromy (jeden i čtyři proudy) a sekvence, tři skutečné exporty; rozdíly viz tabulka výše.

## Co zůstalo neověřené

- Revizoři jsou modely; hledali nálezy, nedokazovali, že další nejsou. Skeptici jsou také modely.
- Rozbalení zstd ve skutečném prohlížeči mimo Chromium (Firefox, Safari) a v okně stránky uvnitř Claude (WebCrypto tam může chybět) se nezkoušelo.
- Chování libzstd na procesoru bez BMI2 (odchylka 3) a v jiném sestavení se neměřilo; zkouška s tím počítá.
- Význam čísel uvnitř `.tac` (formace, role, instrukce) se nečte: čeká na snímky obrazovky týchž tří taktik ze hry.
- Časy zdržení jsou z jednoho stroje (Node 22, 4 jádra); zkoušky mají hranice s velkou rezervou, aby nepadaly na pomalém, a rozhodují počty bloků a kódy chyb, ne čas.
- Zkratky názvů tří ukázkových taktik jsou ve veřejné historii gitu (viz bod 14); přepsání historie je rozhodnutí majitele.
