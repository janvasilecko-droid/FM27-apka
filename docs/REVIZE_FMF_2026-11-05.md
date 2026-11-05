# Nezávislá revize čtečky `.fmf` a dekodéru zstd (5. 11. 2026)

Po dokončení čtečky `.fmf`, vlastního dekodéru zstd a přestupového poradce nechal autor kód projít dvěma samostatnými revizory (AI agenti, každý zvlášť, bez znalosti úvah autora i druhého revizora).
**Nejde o revizi člověkem ani o bezpečnostní audit**: revizor je model, jeho nález je další pohled, ne důkaz. Revizoři měli hledat konkrétní chyby a každou doložit spuštěním; každý nález
jsem znovu ověřil vlastním během, než jsem ho opravil. Zprávy revizorů v repozitáři nejsou (obsahují skripty s hostilními soubory); nálezy jsou shrnuté tady.

| Revizor | Rozsah | Výsledek |
|---|---|---|
| A | Odolnost proti nepřátelskému souboru: dekodér zstd, lepidlo, čtečka kontejneru, starší kontrola `.fmf`, čištění textů | nálezy níže (bod 1 až 6) |
| B | Správnost tvrzení, poctivost popisků a dokumentace, síla zkoušek (zejména porovnání s libzstd) | nálezy níže (bod 7 až 14) |

## A) Odolnost

| # | Nález | Oprava | Kde se hlídá |
|---|---|---|---|
| 1 | Rámec z desítek tisíc „drahých“ bloků (každý staví Huffmanův strom a tři tabulky FSE a vydá tři bajty) zdržel stránku: soubor o 22 MiB s devíti takovými rámci se četl 24 s, soubor o 4,7 MiB se šestnácti kandidáty na společném ocasu u starší kontroly 153 s. Výstup byl omezený, práce ne. | Počet bloků v rámci je omezený podle povoleného výstupu (jeden na KiB + 16, nebo podle slíbené velikosti obsahu; kód `blocks`); lepidlo má rozpočet 40 000 bloků na jedno čtení souboru a **účtuje i rámce, které selžou** (jinak by ho obešel soubor s rámci vadnými až na konci); starší kontrola bere nejvýš 64 bloků na kandidáta. Po opravě: tentýž soubor o 22 MiB se odmítne za 0,12 s a soubor se šestnácti kandidáty za 0,06 s; nejhorší soubor, který rozpočet ještě pustí (21 MiB, 56 záznamů z drahých rámců vadných až na konci), se čte 1,8 s. | `zstd.test.mjs` (strop, odvození, pořadí kontrol, 190 000 bloků), `fmfglue.test.mjs` (rozpočet, účtování selhání, 64 bloků, šestnáct kandidátů), `fmfcontainer.test.mjs` (dvanáct záznamů vadných až na konci) |
| 2 | `inspectFmf` zkoušel šestnáct kandidátů, každého s plnou prací | viz 1 (64 bloků na kandidáta) | `fmfglue.test.mjs` |
| 3 | Záznam zčásti nebo celý mimo datovou část vedl k tvrzení „záznamy beze zbytku vyplňují datovou část“ | rozložení nese i počet záznamů mimo (`outside`), `contiguous` je pravda jen bez mezer i bez záznamů mimo, a hlásí se to varováním | `fmfcontainer.test.mjs`, scénář 21 |
| 4 | Souhrn „kontrolní součet souhlasí u N z nich“ počítal i zdroje, které se neověřily (správný součet, ale jiná velikost než v manifestu) | počítají se jen ověřené zdroje | `fmfcontainer.test.mjs` |
| 5 | Pět míst, kde se čistí cizí text (soubor, odpověď modelu, web, plugin), nepokrývalo formátovací znaky Unicode (izoláty směru písma, značky, výplně hangul, prázdné braillské písmeno, selektory variant) | jednotná třída znaků (`\p{Cc}\p{Cf}\p{Zl}\p{Zp}` a neviditelné výplně a selektory) ve všech pěti modulech | `sanitize.test.mjs` (kolem 170 znaků × pět modulů; vrácení původních vzorů test shodí v každém modulu) |
| 6 | Zpráva o chybě u starší kontroly označila i obří okno a příliš mnoho bloků jako „překročil limit 1 MiB“ | to hlášení patří jen kódu `limit` | `tactics.test.mjs` |

## B) Poctivost a síla zkoušek

| # | Nález | Oprava |
|---|---|---|
| 7 | **Nepravdivé tvrzení o libzstd**: dokumentace a komentáře říkaly, že libzstd u sekvencí přijme čtení za konec proudu bitů. Zkouška proti libzstd 1.5.7 (Python `zstandard` 0.25.0) ukázala opak: sekvence odmítá stejně jako my (nepřečtené bity, čtení za začátek), odmítá i nulový opakovaný posun. | Skutečně se liší jen ve třech případech, kde je libzstd shovívavější než specifikace: odkaz dál než okno rámce (u nás kód `window`), blok větší než okno u rámce s uvedenou velikostí obsahu (`blocksize`), pokažený konec čtyřproudých literálů od 255 znaků (`litend`). Každý případ má zkoušku, která libzstd skutečně zeptá a ukáže, že ho přijme (`zstd.test.mjs`, „tři pozorované shovívavosti“). Komentáře, README a zkoušky opravené. |
| 8 | Porovnávací pomůcka zkoušek tolerovala i kód `overread` a omlouvala každé odmítnutí libzstd vadným kontrolním součtem | tolerují se jen tři výše uvedené kódy; výjimka u součtu se ověřuje: stejný rámec s opraveným součtem se pošle libzstd znovu a ten ho musí přijmout se stejným výstupem |
| 9 | Bez Pythonu a balíčku `zstandard` se porovnání s libzstd tiše přeskočilo | první zkouška v souboru dostupnost zjistí a hlásí „přeskočeno“; s `ZSTD_ORACLE_REQUIRED=1` selže; nové přímé zkoušky konců proudů bez věštírny; mutační běh se spouští i bez věštírny a každý přeživší dostal přímou zkoušku; samostatná kontrola `.github/workflows/zstd-oracle.yml` běží s povinnou věštírnou po každé změně dekodéru |
| 10 | Slabé zkoušky: „bomba“ z 53 bajtů ověřovala jen, že se něco odmítne; tautologie `přijato + odmítnuto = počet`; nepoužité proměnné a pomůcky; zkouška se skutečnými soubory se při špatné cestě tiše přeskočila; scénář 21 vypisoval začátky názvů skutečných souborů | bomba je blok s největším možným počtem sekvencí (98 047) a hlídá se přesná chyba i čas; místo tautologie se porovnávají verdikty libzstd s ručně popsanými; skutečné soubory se bez proměnné `FMF_SAMPLES_DIR` přeskočí viditelně (`skip`) a se špatnou cestou zkouška selže; scénář 21 píše „skutečný export č. N z M“ |
| 11 | Popisky v aplikaci: banner „sedí u všech zdrojů“ i když se zdroj neověřil; „zašifrováno“ u velikosti záznamu, která zahrnuje klíč a IV; text bez WebCrypto tvrdil, že aplikace nezná strukturu `.fmf` | banner to říká o všech zdrojích jen když se ověřily všechny, jinak výslovně o ověřených; „záznam N B (s klíčem a IV)“; bez WebCrypto věta o důvodu místo tvrzení o struktuře (scénář 21) |
| 12 | Dokumentace: „tři nezávislí ověřovatelé“ a „dva analytici“ (byly to běhy téhož modelu), „9 zdrojů bajt po bajtu“ bez zdroje, „čtyřech skupinách“ u počtu 495, soubor se „nepovažuje za přečtený“ i u drobných odchylek, zpráva o souboru „jen velikosti“ (nese i názvy z manifestu), nepravdivé odkazy na neexistující moduly, zastaralá čísla v matici | opraveno; porovnání devíti zdrojů s výstupem prvního rozboru (libzstd) jsem znovu provedl s kódem z repozitáře: 9 z 9 shodných |
| 13 | `.gitignore` nechránil před náhodným přidáním cizích taktik | `*.fmf`, `*.tac`, `*.aom` jsou ignorované |
| 14 | **Zkratky názvů ukázkových taktik jsou ve veřejné historii** (od 4. 11. v předávacích dokumentech z Cursoru, krátce i v dokumentaci z 5. 11.) | v aktuální verzi zamaskováno; **přepsání historie je rozhodnutí majitele** (změnilo by všechny hashe commitů a vyžaduje vynucené nahrání) |

## Co po opravách platí

- Testy jádra: COUNT_UNIT (s věštírnou libzstd), bez ní 1 zkouška viditelně přeskočená; prohlížeč: COUNT_E2E kontrol v 22 scénářích (3 z nich jen se skutečnými exporty majitele).
- Mutace: dekodér zstd MUT_ZSTD, lepidlo MUT_GLUE (každá mutace musí shodit aspoň jednu zkoušku; dekodér i **bez věštírny**, aby přímé zkoušky nestály na libzstd).
- Dekodér proti libzstd: platné rámce všech úrovní a strategií, přes milion náhodně poškozených rámců (soak mimo běžné zkoušky), ručně sestavené Huffmanovy stromy a sekvence, popis tabulek FSE, tři skutečné exporty.

## Co zůstalo neověřené

- Revizoři jsou modely; hledali nálezy, nedokazovali, že další nejsou.
- Rozbalení zstd ve skutečném prohlížeči mimo Chromium (Firefox, Safari) a v okně stránky uvnitř Claude (WebCrypto tam může chybět) se nezkoušelo.
- Význam čísel uvnitř `.tac` (formace, role, instrukce) se nečte: čeká na snímky obrazovky týchž tří taktik ze hry.
- Časy zdržení jsou z jednoho stroje; zkoušky mají hranice s velkou rezervou, aby nepadaly na pomalém.
