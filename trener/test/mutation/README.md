# Mutační zkoušky (pomůcka, ne součást běžných testů)

Mutační zkouška odpovídá na otázku „chytila by moje zkouška chybu v kódu?“. Do KOPIE zdrojového souboru se zapíše jedna drobná změna (mutace: posunutá hranice, vynechaná kontrola, prohozená konstanta),
pustí se zkoušky a **aspoň jedna musí selhat**. Mutace, kterou žádná zkouška nezachytí (přeživší), je díra ve zkouškách: buď chybí zkouška, nebo je mutace jen jiný zápis téhož (pak se nahradí smysluplnou).

Nic z toho neběží v `node --test trener/test/*.test.mjs` ani v CI: jeden běh trvá minuty až desítky minut. Repozitář se nemění, mutace se zapisují jen do pracovní kopie v dočasné složce
(`trener/src`, `trener/test`, `reference` a `ai_gateway` ve stejném rozložení jako v repozitáři, aby zkoušky našly své soubory).

## Spuštění (z kořene repozitáře)

```bash
# dekodér zstd: 216 mutací, věštírna libzstd vypnutá (přímé zkoušky musí mutace chytit samy), čtyři dávky souběžně (WORK tu jen nechá pracovní kopie po běhu k prohlédnutí, není nutná)
for i in 0 1 2 3; do WORK=/tmp/mut_zstd_$i node trener/test/mutation/mutate.mjs trener/src/zstd.js trener/test/mutation/zstd.mutations.json zstd.test.mjs --shard $i/4 & done; wait

# lepidlo mezi čtečkami a dekodérem (rozpočty bloků a výstupu, strop výstupu): 44 mutací
node trener/test/mutation/mutate.mjs trener/src/fmfglue.js trener/test/mutation/glue.mutations.json fmfglue.test.mjs

# čtečka kontejneru (rozložení souboru, souhrny, množná čísla, meze na bajt přesně, strop předávaný rozbalovači): 37 mutací
node trener/test/mutation/mutate.mjs trener/src/fmfcontainer.js trener/test/mutation/container.mutations.json fmfcontainer.test.mjs

# moduly přípravy na zápas a čtení české hry (69 mutací, každá se chytí; stav 7. 11. 2026 po nezávislé revizi)
node trener/test/mutation/mutate.mjs trener/src/oppanalysis.js trener/test/mutation/oppanalysis.mutations.json oppanalysis.test.mjs
node trener/test/mutation/mutate.mjs trener/src/fm27cs.js trener/test/mutation/fm27cs.mutations.json fm27cs.test.mjs,squadread.test.mjs,tacticread.test.mjs,oppread.test.mjs
node trener/test/mutation/mutate.mjs trener/src/squadread.js trener/test/mutation/squadread.mutations.json squadread.test.mjs,tacticread.test.mjs
node trener/test/mutation/mutate.mjs trener/src/oppread.js trener/test/mutation/oppread.mutations.json oppread.test.mjs,oppanalysis.test.mjs
node trener/test/mutation/mutate.mjs trener/src/tacteff.js trener/test/mutation/tacteff.mutations.json tacteff.test.mjs
node trener/test/mutation/mutate.mjs trener/src/rolefit.js trener/test/mutation/rolefit.mutations.json rolefit.test.mjs,squadopt.test.mjs
```

Seznamy pro poslední skupinu modulů vznikly z oprav po nezávislé revizi 7. 11. 2026: každá oprava, na kterou je zkouška, má mutaci, která ji vrací zpět. První běh nechal 19 mutací přežít (například meze délky pozic, hranice složitosti 7 a 12
a sloučení zpráv podle novějšího čtení); pro každou přibyla zkouška a druhý běh je zabil všechny. Dvě mutace se vyřadily jako rovnocenné (funkce `mentioned` v `oppanalysis.js` vrací při nejednoznačnosti prázdný seznam a volající bere jen přesně jednu shodu,
takže návratová hodnota s víc shodami nic nemění). Jeden běh trvá několik sekund.

- `--oracle` zapne věštírnu libzstd (Python balíček `zstandard`, interpret z `ZSTD_ORACLE_PYTHON`, jinak `python3`): nástroj před během ověří, že v něm jde `import zstandard`, a zkouškám nastaví `ZSTD_ORACLE_REQUIRED=1`, takže věštírna není nikdy tiše vynechaná. Bez `--oracle` je věštírna vypnutá, aby se vidělo, co chytí samotné přímé zkoušky.
- `--only <regulární výraz>` pustí jen mutace s odpovídajícím názvem, `--shard i/n` každou n-tou mutaci počínaje i-tou (souběžné běhy se nepřepisují: každý má vlastní pracovní složku s číslem procesu, `WORK` netřeba). Hodnoty přepínačů se píšou za mezeru (ne `--only=výraz`), zkoušky se oddělují čárkou (ne mezerou), zdroj musí ležet v kopírovaných složkách; neznámý přepínač, přepínač bez hodnoty nebo zdvojený, víc než tři poziční argumenty nebo chybný tvar `--shard` skončí kódem 64, nic se mlčky neignoruje.
- Pracovní složka: bez `WORK` má nástroj vlastní, s číslem procesu, a na konci ji smaže (i po neočekávané výjimce, jen ne po `SIGKILL`). Zadaná `WORK` se na začátku **SMAŽE a vytvoří znovu** a na konci **zůstane** k prohlédnutí; nástroj ji proto přijme jen nepřítomnou, prázdnou nebo takovou, kterou sám dřív vytvořil (značkový soubor `.mutate-work`), a nikdy ne uvnitř repozitáře ani nad ním (podle skutečné cesty, symbolické odkazy se rozloží); soubor nebo odkaz místo složky se odmítne. Má tedy mířit na novou dočasnou cestu a u souběžných běhů na jinou pro každý (dva běhy se stejnou `WORK` si složku navzájem smažou).
- Návratový kód: 0 = všechny mutace zachyceny, 1 = nějaká přežila nebo má nepoužitelný vzor, 2 = zkoušky neprojdou ani bez mutace, 3 = výběr nezahrnuje žádnou mutaci (překlep v `--only`, prázdná dávka `--shard`: nic se nezkoušelo, takže to není „vše zachyceno“), 64 = chybné použití (argumenty, neplatný regulární výraz, zdroj mimo kopírované složky, nepřípustná `WORK`, `--oracle` bez fungující věštírny). Kód 1 je výrok o mutacích jen po řádku „Přeživších mutací“; neočekávaná chyba prostředí (například plný disk při kopírování) skončí také kódem 1, ale se zásobníkem výjimky na chybovém výstupu a bez toho řádku.

## Seznamy mutací

Každý záznam je trojice `[název, původní text, nový text]`; původní text se musí v souboru vyskytovat PRÁVĚ JEDNOU (po změně kódu se vzor musí upravit, jinak ho běh ohlásí jako nepoužitelný a započítá mezi přeživší).
Seznamy vznikly ručně z toho, co kód dělá (hranice, příznaky, kódy chyb, rozpočty, hlášení), a rostly o mutace, které se při revizích ukázaly jako nezachycené. Nejsou důkazem, že zkoušky jsou úplné:
chytají jen takové chyby, jaké se do seznamu napsaly. Mutační seznamy jsou pro soubory `zstd.js`, `fmfglue.js`, `fmfcontainer.js` a pro moduly přípravy na zápas výše; jiné moduly (například `squadopt.js` a `recruit.js`) mutační seznam nemají.
