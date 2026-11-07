# Druhá nezávislá revize (7. 11. 2026): rozbor taktiky (42 pravidel) a rozbor sestavy

Po verzi 29 (commit d1bcf54) prošel druhý nezávislý revizor (model Claude, který výsledek jen četl a spouštěl v Node, nic v repozitáři neměnil) soubory `tacticanalysis.js` (42 pravidel taktiky),
`fm27know.js`, `posattrs.js`, `squadcheck.js` a obrazovku `screens/tacticcheck.js`. Ke každému nálezu spustil konkrétní vstup a popsal špatný výstup; obrazovku DOM nespouštěl, ověřil jen data a texty, která z ní vycházejí.
Nálezy jsem před opravou ověřil zkouškou, která na starém kódu selhala (35 nových zkoušek selhalo na kódu z d1bcf54: 21 u pravidel taktiky a 14 u sestavy; ostatní hlídají to, co se opravou nemělo změnit). Revizor je model, ne člověk: bere se jako druhý pohled,
ne jako důkaz, že už nic nezbývá.

Dopad (A = špatná rada nebo porušení poctivosti, B = okrajový případ, C = drobnost). Stav „opraveno“ znamená, že je na to zkouška, která na starém kódu selhala.

## Co zjistil a co se opravilo

| Id | Nález | Stav |
|---|---|---|
| A1 | Falešné „výměny“ uvnitř téže skupiny: skóre závisí jen na skupině pozic, takže stopeři na levém a pravém místě jsou zaměnitelní; po prohození měla každá druhá jedenáctka radu „RCB: CB2 → CB1 (+5,2)“ bez zisku | opraveno: při rovnocenných řešeních vyhrává jedenáctka shodná s tvou (preference rozhoduje jen při shodě a nikdy nepřebije ani desetinu bodu); zkouška s 60 náhodnými záměnami |
| A2 | I1 radil „Vyměnit za“ zraněného hráče samotného | opraveno: náhradu hledá model mezi zdravými hráči |
| A3 | G1 radil „Doplnit hráče“, když chyběly jen atributy (brankář bez pohledu Brankářské); u sestavy, kterou nejde posoudit, banner uváděl poznámku o smlouvách a v „Co řešit jako první“ bylo šest stejných rad | opraveno: nový nález G5 („hráči jsou, ale chybí jim atributy“, rada načíst pohledy), G1 zůstává pro opravdu chybějící hráče; sestava, kterou nejde posoudit, má přesný důvod a v „Co řešit jako první“ jednu položku |
| A4 | E01 se ve čtyřech formacích (4-4-1-1, 4-3-2-1, 3-5-2, 5-3-2) nedalo splnit: role držáka existuje jen u defenzivních záložníků, ve středu zálohy a za ním není | opraveno: práce, kterou role pro místa středu nenabízejí, se nežádá; zkouška projde všechna rozestavění a ověří, že pravidlo jde splnit |
| A5 | H01 počítal jednoho hráče dvakrát (Outlet role bez míče i role s míčem, která běhá dopředu) | opraveno: počítají se hráči, ne role |
| A6 | B03 měl titulek „Nízký blok“, ale spouštěl se i při Regroup s vysokým presinkem | opraveno: jen Low Block |
| A7 | Částečný vstup se bral jako „v pořádku“ (A12, B01, B03, C02, C03, C06, C14, D01, D03, E02, G06, G07, H01) | opraveno systémově: podmínky z víc instrukcí se skládají tříhodnotovou logikou (neznámá část nikdy neznamená „neplatí“), pravidla o atributech neřeknou „v pořádku“, dokud neznají atributy všech dotčených hráčů; nálezy z přečtené části zůstávají. Novou zkouškou, která pouští všech 42 pravidel s náhodně neúplnými údaji a porovnává je s náhodnými doplněními, se našlo **17 pravidel** (kromě uvedených ještě A08, C07, F01, F02) |
| A8 | Rady, které nevedly k cíli nebo vyrobily rozpor: A12, C03, F04, G06, A03, A08, D03, E01 | opraveno: A12 se spouští jen bez vysokého presinku a rada říká i obrannou linii; C03 radí podle toho, co ho spouští (trpělivost, krátké přihrávky, nebo obojí); F04 nenabízí roli bez míče; G06 říká „nejvýš jednu“; A03 u Low Block radí Regroup a u High Press Higher; A08 nezmiňuje Line of Engagement, který nečte; D03 radí změnu toho, co rozehru spouští; E01 říká, kolik rolí se musí změnit |
| B1 | H01 hlásilo „nevyhodnoceno“ i při úplných datech (u vyšší linie se pravidlo nevztahuje); podobně A08, B01, D03 bez atributů | opraveno: nesplněný předpoklad je „v pořádku“, ať atributy známe, nebo ne |
| B2 | A08 ukazoval špatného viníka (nejpomalejší stoper, i když vadila Acceleration druhého) | opraveno: viníkem je místo, jehož atribut opravdu vadí |
| B3 | D03 četl jen prvního defenzivního záložníka | opraveno: posuzují se všichni |
| B4 | Jeden hráč na dvou místech: průměr 84 proti 71, silné stránky dvakrát, žádné varování | opraveno: nový nález D1, hráč se počítá u prvního místa, další doplní model a jedenáctka se neporovnává |
| B5 | Plovoucí čárka u prahů: rozdíl přesně 12,0 bodu vyšel 11,999…, takže Q2 nebyl a stejně swapGain | opraveno: porovnává se v desetinách (v číslech, která uživatel vidí) |
| B6 | Hloubka počítala hráče s víc pozicemi v každé skupině, takže „hloubka v pořádku“ u středu, kde jsou na tři místa čtyři univerzální záložníci | opraveno: každý hráč se počítá jen jednou (nejdřív základní místa všech skupin, pak zálohy, při shodě přednost přirozené pozici); texty to říkají |
| B7 | Kopie rozboru ztrácela štítek původu (KOMUNITA, HRA, ODHAD), shodu zdrojů, poznámku „není pravidlo FM27“ a seznam nevyhodnocených pravidel | opraveno: každý nález v kopii nese `[id, druh, shoda zdrojů]`, na konci je seznam nevyhodnocených pravidel a poznámka |
| B8 | C07 u podběhu jedním bokem nehlídal stranu a nález neměl místa | opraveno: podběh jedním bokem potřebuje běžce na té straně nebo ve středu a nález ukazuje na boční místa |
| B9 | Počty a pokrytí nesedí: silná stránka není v žádném čísle, hráč bez atributů se počítá jako „s atributy“, F01 a F02 se počítají jako vyhodnocené i tam, kde nemohou nastat, průměr se bral z ohodnocených hráčů a porovnával se se všemi jedenácti | opraveno: `vyhodnoceno = bez nálezu + nález + silné stránky`, pokrytí atributy bez prázdných hráčů, F01 a F02 jsou u rozestavění bez dvou hráčů na lajně „nevztahuje se“, průměr se porovnává na týchž místech |
| B10 | Štítky HRA u C12, A05, F02, G07 nejsou ve hře ověřené (podezření: texty jsou z FM Scout Tactic Creator a Guide to Football) | opraveno: ve zdrojích a v repozitáři nelze dohledat, že by znění ve hře někdo ověřil, proto jsou všechna čtyři KOMUNITA a texty říkají, že ve hře samotné se to neověřovalo; HRA mají jen věty, které aplikace přepisuje ze zprávy hry |
| C1 | `parseInstruction` řešil rozpor mezi názvem a hodnotou podle hodnoty („Tackling: Counter-Press“ → Defensive Transition; „Defensive Line Behaviour: Higher“ → Defensive Line) | opraveno: rozpor se nehádá, vrací se „nerozpoznáno“ |
| C2 | Výchozí hodnota „Šetření času“ (Less Often) se liší od hodnoty viděné ve hře | **ponecháno, opakovaný nález z revize č. 1**: výchozí hodnotu hra neukázala, poznámka v odhadu složitosti říká, že výchozí hodnoty aplikace ve FM27 neověřila |
| C3 | Texty neodpovídají kódu: E02 slibuje „dva bloudící hráče“ (netestuje se), F02 říká „útočným krajním obráncem“ (zahrnuje i Full-Back), A12 si odporovalo s A08, ODHAD má „2 zdroje“, chip „shoda zdrojů“ i u nálezů sestavy | opraveno: E02, F02 a A12 mají text, který odpovídá kódu; u nálezů sestavy je chip „podklad“, ne „shoda zdrojů“; **ponecháno**: u ODHAD „shoda zdrojů“ říká, na kolika zdrojích se závěr autora opírá |
| C4 | Čeština v textech: „2 hráče nemá žádné atributy“, „U 3 hráče chybí věk“, „4 přirozených hráčů“ | opraveno |
| C5 | Prázdný seznam míst vedl u C07 a G06 k „v pořádku“; `slots: [null]` shodilo rozbor | opraveno: bez hráčů v poli se pravidla nevyhodnotí, prázdná a nesmyslná místa se přeskočí |
| C6 | Jedenáctka mohla nechat místo prázdné, i když šlo obsadit víc míst (součet skóre převážil) | opraveno: nejdřív se obsadí co nejvíc míst, pak se hledá nejlepší součet |
| C7 | Neuložené úpravy taktiky se neanalyzují (z čtení kódu) | **potvrzeno čtením kódu, chování ponecháno**: karta počítá z uložené taktiky; přibyla věta, že neuložené úpravy se do rozboru nezapočítají |

## Co revizor ověřil a nenašel

`parseInstruction` a `stepOf` pro všech 29 instrukcí × všechny hodnoty × sedm zápisů, česky i anglicky (0 chybných čtení), pořadí hodnot proti směru pravidel (`defensiveLine`, `passingDirectness`, `attackingWidth`,
`triggerPress`), nezávislost výsledku na pořadí hráčů v kádru, škálu 0 až 100 v `posattrs.js` u všech osmi skupin (žádný atribut není klíčový i žádoucí zároveň, všechny názvy jsou slovníku známé; chybějící atributy dají
`null` nebo částečné skóre s pokrytím, nikdy nulu), 4 000 náhodných vstupů do `squadcheck.analyze` bez výjimky a bez NaN, optimalitu jedenáctky (3 000 náhodných malých kádrů proti hrubé síle, rozdíl 0), žádná skrytá data
(CA, PA, osobnost, reputace) ani předpověď v textech, a metamorfní zkoušku 42 pravidel (po použití rady nález zmizí a nevznikne vážný rozpor) s výjimkami, které jsou v A8.

## Zkoušky k opravám

`test/tacticanalysis.test.mjs` (včetně zkoušky správného částečného vyhodnocení se třemi řadami náhodných údajů), `test/squadcheck.test.mjs`, `test/docs.test.mjs` a scénář 24 v prohlížeči. Mutační seznamy
`test/mutation/tacticanalysis.mutations.json` (25 mutací), `squadcheck.mutations.json` (22) a `fm27know.mutations.json` (2): každá se chytí; první běh nechal 7 mutací přežít (například měřítko preference,
hráč na víc místech bez výměn, zraněný bez atributů, přednost přirozené pozice, jedno pravidlo A12 jen pro Mid Block) a pro každou přibyla zkouška. Postup je v `test/mutation/README.md`.
