# Nezávislá revize nových modulů (7. 11. 2026): co našla a co se opravilo

Po nasazení verze 27 (commit 158e4d5) prošel nový kód (`fm27cs.js`, `oppread.js`, `oppanalysis.js`, `tacteff.js`, `squadread.js`, české čtení v `tactics.js` a obrazovky `oppprep.js`, `teffect.js`,
`tactics.js`, `team.js`, `rolefit.js`) čtením jednoho nezávislého revizora (model Claude, který výsledek jen četl a nic v repozitáři neměnil). Revizor ke každému nálezu spustil konkrétní vstup
a popsal špatný výstup. Nálezy jsem před opravou ověřil zkouškou, která na starém kódu selhala; až potom následovala oprava. Revizor je model, ne člověk: bere se jako druhý pohled, ne jako důkaz,
že už nic nezbývá.

Dopad (A = špatná rada nebo poškození dat nebo porušení poctivosti, B = okrajový případ, C = drobnost). Stav „opraveno“ znamená, že je na to zkouška, která na starém kódu selhala.

| Id | Nález | Stav |
|---|---|---|
| A1 | Pravidlo P04 ztratilo stranu, když řádek sestavy neměl kód místa, jen pozici „OZ (P)“: rada o straně spadla na střed | opraveno: strana se bere z pozice; brankář ve špatné formě žádnou stranu neotevírá |
| A2 | `sameName` spároval křestní jméno nebo jednoslovné jméno s plným jménem („Gabriel“ = „Gabriel Jesus“) a ztrácel písmena Ł, Ø, Đ | opraveno: příjmení (poslední slovo) musí sedět celé, jednoslovné jméno sedí jen na totéž; Ł, Ø, Đ se skládají |
| A3 | Zápis soupisky bral první shodu jména a dva různí hráči se stejně zapsaným jménem se sloučili do jednoho hráče | opraveno: nejednoznačné se nezapíše a obrazovka ukáže proč; při rozdílném věku nebo pozicích se hráči nesloučí |
| A4 | Úprava profilu role bez míče přepsala profil téhož jména s míčem (formulář neznal fázi) | opraveno: `editProfile` přenáší fázi, formulář fázi nabízí, seznam ji ukazuje |
| A5 | Sloučení zpráv o soupeři poškozovalo data: chudší sestava nahradila úplnou, změněná sestava dala unii o 13 hráčích, zastaralé údaje přežily, zpráva o jiném týmu se smíchala se starou | opraveno: nová pravidla sloučení, kontrola týmu a souhlas s nahrazením, jména se porovnávají přes `sameName` |
| A6 | Strop 24 instrukcí při čtení a 20 v editoru, hra jich má 27: editor při jakékoli úpravě tiše smazal další | opraveno: strop 40 na obou místech |
| A7 | P01 a P03 špatně mapovaly oblasti (brankářova slabina u střel z dálky vedla na radu o vzduchu, „Hbitost“ na radu o brankáři), Vyrážení se klasifikovalo, ale pravidlo ho nečetlo, silná stránka Rohy nic nespustila | opraveno: o oblasti brankáře rozhoduje věta; Vyrážení je atribut; anglické brankářské atributy se znají; Rohy spouští P11. Oblasti „Tvořivost“, „Obrana“, „Útok“ a „Nejlepší střelec“ se klasifikují, ale žádné pravidlo je zatím nečte |
| A8 | Složitost taktiky „nízká“ vyšla i z nepřečtených dat (0 z 27 instrukcí) | opraveno: z přečtených instrukcí je to dolní odhad (neznámá, aspoň střední, vysoká); nízká jen při přečtení všech 27 |
| A9 | „Nevyhodnoceno“ bylo podhodnocené (P03, P05, P06, P14) a P09 počítal střed zálohy z pozic, které se nepodařilo převést | opraveno |
| B1 | P10 a P11 spouštěly záporné věty o standardkách („not conceded“, „0 of“, „Neinkasují“) | opraveno: záporné a omezující tvary se vynechají |
| B2 | Kvadratický regulární výraz v `parsePositions`: obří řetězec mezer zablokoval stránku na desítky sekund | opraveno: meze délky celého údaje i jedné pozice |
| B3 | P05 hlídal hráče, který podle hry nehraje; pozice významného hráče nerozlišila dva Nováky; P06 tvrdil, že jde o „hlavní“ stopery | opraveno |
| B4 | `normalizeAttributes` přijímal jakýkoli název atributu, tedy i skryté údaje (CA, PA, osobnost, reputace), které by se uložily a mohly odejít do kontextu AI | opraveno: přijmou se jen atributy, které slovník zná; navíc se skryté názvy (i z dřívějších uložených dat) vyřazují při sestavení kontextu pro AI trenéra |
| C | P08 bral „Aktivní“ (Positive) za útočnou mentalitu a „Protiútočný“ za útočnou; P07 neznal „Často“ a bral „Not often“ za časté | opraveno |
| C | P04 neznal příjmení kratší než čtyři písmena a hledal přes hranice slov a v nadpisu oblasti | opraveno: shoda po slovech, jen z věty |
| C | Rozpočet změn počítal totéž nastavení dvakrát, „jedna testovatelná změna“ mívala dvě nastavení | opraveno: unikátní nastavení; jedna změna je jedno nastavení |
| C | Tvrzení u P12 o „nereálně rychlých obráncích“ nebylo dohledatelné | doplněn odkaz na oficiální článek hry |
| C | Štítek „text hry“ byl na celém bloku pilíře včetně rad | opraveno: jen u popisu pilíře; rady jsou označené jako komunita a odhad |
| C | Výchozí hodnota „Šetření času“ se liší od hodnoty viděné ve hře | nezjištěno: poznámka v odhadu složitosti, že výchozí hodnoty aplikace ve FM27 neověřila |
| C | `tactics[0]` se v přehledu přípravy jmenoval „tvoje aktivní taktika“, i když žádná aktivní nebyla | opraveno: přehled říká, která taktika se použila |
| C | Ukázky ve zkouškách obsahovaly jména skutečných hráčů z průzkumu, což odporuje pravidlu průzkumu | opraveno: nahrazena vymyšlenými jmény |
| — | Věta pilíře Next Match Info je stejná jako u Tactical Understanding bez dovětku | **není chyba**: je to text hry (7. 11. 2026); poznámka v kódu, na obrazovce se nezobrazuje |
| — | 3-5-2 a 5-3-2 mají stejnou množinu míst, předvolí se první | **ponecháno**: formaci stejně potvrzuje uživatel podle obrazovky a aplikace to hlásí |
| — | `parseSlotCode` přijme i kódy, které hra nemá (DZ, ÚTL); `report.ok` ignoruje některá pole; jeden čas `updatedAt` pro zprávu i soupisku | **ponecháno**: bez dopadu na rady |

Revizor v dalších oblastech nenašel nic: `change()` a `already` u směrů „up“ a „down“, převod stran u kódů míst, `parseInstruction` (603 kombinací), `parseSlotCode` u 22 míst, odvození formace z 11 míst, přiřazení rolí k místům,
vkládání do DOM (jen `textContent`), potvrzení před každým zápisem, rozpočet změn a odolnost normalizérů proti nepřátelskému vstupu.

Zkoušky k opravám: `test/fm27cs.test.mjs`, `test/squadread.test.mjs`, `test/oppread.test.mjs`, `test/oppanalysis.test.mjs`, `test/tacteff.test.mjs`, `test/rolefit.test.mjs`, `test/tactics.test.mjs` a scénáře 25 až 27 v prohlížeči.
