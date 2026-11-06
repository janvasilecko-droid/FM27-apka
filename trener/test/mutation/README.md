# Mutační zkoušky (pomůcka, ne součást běžných testů)

Mutační zkouška odpovídá na otázku „chytila by moje zkouška chybu v kódu?“. Do KOPIE zdrojového souboru se zapíše jedna drobná změna (mutace: posunutá hranice, vynechaná kontrola, prohozená konstanta),
pustí se zkoušky a **aspoň jedna musí selhat**. Mutace, kterou žádná zkouška nezachytí (přeživší), je díra ve zkouškách: buď chybí zkouška, nebo je mutace jen jiný zápis téhož (pak se nahradí smysluplnou).

Nic z toho neběží v `node --test trener/test/*.test.mjs` ani v CI: jeden běh trvá minuty až desítky minut. Repozitář se nemění, mutace se zapisují jen do pracovní kopie v dočasné složce
(`trener/src`, `trener/test`, `reference` a `ai_gateway` ve stejném rozložení jako v repozitáři, aby zkoušky našly své soubory).

## Spuštění (z kořene repozitáře)

```bash
# dekodér zstd: 214 mutací, věštírna libzstd vypnutá (přímé zkoušky musí mutace chytit samy), čtyři dávky souběžně
for i in 0 1 2 3; do WORK=/tmp/mut_zstd_$i node trener/test/mutation/mutate.mjs trener/src/zstd.js trener/test/mutation/zstd.mutations.json zstd.test.mjs --shard $i/4 & done; wait

# lepidlo mezi čtečkami a dekodérem (rozpočty bloků a výstupu, strop výstupu): 44 mutací
node trener/test/mutation/mutate.mjs trener/src/fmfglue.js trener/test/mutation/glue.mutations.json fmfglue.test.mjs

# čtečka kontejneru (rozložení souboru, souhrny, množná čísla, meze na bajt přesně, strop předávaný rozbalovači): 37 mutací
node trener/test/mutation/mutate.mjs trener/src/fmfcontainer.js trener/test/mutation/container.mutations.json fmfcontainer.test.mjs
```

- `--oracle` zapne věštírnu libzstd (Python balíček `zstandard`, interpret z `ZSTD_ORACLE_PYTHON`, jinak `python3`): nástroj před během ověří, že v něm jde `import zstandard`, a zkouškám nastaví `ZSTD_ORACLE_REQUIRED=1`, takže věštírna není nikdy tiše vynechaná. Bez `--oracle` je věštírna vypnutá, aby se vidělo, co chytí samotné přímé zkoušky.
- `--only <regulární výraz>` pustí jen mutace s odpovídajícím názvem, `--shard i/n` každou n-tou mutaci počínaje i-tou (souběžné běhy je nutné rozlišit proměnnou `WORK`).
- Pracovní složka: bez `WORK` má nástroj vlastní, s číslem procesu (souběžné běhy se nepřepisují), a na konci ji smaže. Zadaná `WORK` se na začátku **SMAŽE a vytvoří znovu**, a proto ji nástroj přijme jen nepřítomnou, prázdnou nebo takovou, kterou sám dřív vytvořil (značkový soubor `.mutate-work`); nikdy ne uvnitř repozitáře ani nad ním. Má tedy mířit na novou dočasnou cestu.
- Návratový kód: 0 = všechny mutace zachyceny, 1 = nějaká přežila nebo má nepoužitelný vzor, 2 = zkoušky neprojdou ani bez mutace, 3 = výběr nezahrnuje žádnou mutaci (překlep v `--only`, prázdná dávka `--shard`: nic se nezkoušelo, takže to není „vše zachyceno“), 64 = chybné použití (argumenty, neplatný regulární výraz, nepřípustná `WORK`, `--oracle` bez fungující věštírny).

## Seznamy mutací

Každý záznam je trojice `[název, původní text, nový text]`; původní text se musí v souboru vyskytovat PRÁVĚ JEDNOU (po změně kódu se vzor musí upravit, jinak ho běh ohlásí jako nepoužitelný a započítá mezi přeživší).
Seznamy vznikly ručně z toho, co kód dělá (hranice, příznaky, kódy chyb, rozpočty, hlášení), a rostly o mutace, které se při revizích ukázaly jako nezachycené. Nejsou důkazem, že zkoušky jsou úplné:
chytají jen takové chyby, jaké se do seznamu napsaly. Mutační seznamy jsou jen pro tyto tři soubory (`zstd.js`, `fmfglue.js`, `fmfcontainer.js`); jiné moduly (například `squadopt.js` a `recruit.js`) mutační seznam nemají.
