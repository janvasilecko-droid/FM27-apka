# Mutační zkoušky (pomůcka, ne součást běžných testů)

Mutační zkouška odpovídá na otázku „chytila by moje zkouška chybu v kódu?“. Do KOPIE zdrojového souboru se zapíše jedna drobná změna (mutace: posunutá hranice, vynechaná kontrola, prohozená konstanta),
pustí se zkoušky a **aspoň jedna musí selhat**. Mutace, kterou žádná zkouška nezachytí (přeživší), je díra ve zkouškách: buď chybí zkouška, nebo je mutace jen jiný zápis téhož (pak se nahradí smysluplnou).

Nic z toho neběží v `node --test trener/test/*.test.mjs` ani v CI: jeden běh trvá minuty až desítky minut. Repozitář se nemění, mutace se zapisují jen do pracovní kopie v dočasné složce.

## Spuštění (z kořene repozitáře)

```bash
# dekodér zstd: 211 mutací, věštírna libzstd vypnutá (přímé zkoušky musí mutace chytit samy), čtyři dávky souběžně
for i in 0 1 2 3; do WORK=/tmp/mut_zstd_$i node trener/test/mutation/mutate.mjs trener/src/zstd.js trener/test/mutation/zstd.mutations.json zstd.test.mjs --shard $i/4 & done; wait

# lepidlo mezi čtečkami a dekodérem (rozpočty bloků a výstupu)
node trener/test/mutation/mutate.mjs trener/src/fmfglue.js trener/test/mutation/glue.mutations.json fmfglue.test.mjs

# čtečka kontejneru (rozložení souboru, souhrny, množná čísla)
node trener/test/mutation/mutate.mjs trener/src/fmfcontainer.js trener/test/mutation/container.mutations.json fmfcontainer.test.mjs
```

- `--oracle` zapne věštírnu libzstd (Python balíček `zstandard`, interpret z `ZSTD_ORACLE_PYTHON`); bez něj je vypnutá, aby se vidělo, co chytí samotné přímé zkoušky.
- `--only <regulární výraz>` pustí jen mutace s odpovídajícím názvem, `--shard i/n` každou n-tou mutaci počínaje i-tou (souběžné běhy je nutné rozlišit proměnnou `WORK`).
- Návratový kód: 0 = všechny mutace zachyceny, 1 = nějaká přežila nebo má nepoužitelný vzor, 2 = zkoušky neprojdou ani bez mutace.

## Seznamy mutací

Každý záznam je trojice `[název, původní text, nový text]`; původní text se musí v souboru vyskytovat PRÁVĚ JEDNOU (po změně kódu se vzor musí upravit, jinak ho běh ohlásí jako nepoužitelný a započítá mezi přeživší).
Seznamy vznikly ručně z toho, co kód dělá (hranice, příznaky, kódy chyb, rozpočty, hlášení), a rostly o mutace, které se při revizích ukázaly jako nezachycené. Nejsou důkazem, že zkoušky jsou úplné:
chytají jen takové chyby, jaké se do seznamu napsaly.
