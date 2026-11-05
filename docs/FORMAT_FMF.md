# Formát souboru `.fmf` (export taktiky z FM27): kontejner

Popis vznikl vlastním rozborem **tří skutečných exportů z FM27**, které poslal majitel (5. 11. 2026; komunitní taktiky, které si načetl do své hry). Nepoužil se žádný cizí dekodér ani jeho kód
(cizí projekty bez licence jsme nečetli). Soubory ani rozšifrovaný obsah v repozitáři nejsou: je to práce jejich autorů a jsou v nich veřejné přezdívky autorů.
Kód čtečky: `trener/src/fmfcontainer.js` (čistý modul), zkoušky: `trener/test/fmfcontainer.test.mjs` (syntetické soubory), `trener/test/e2e/scenarios/21_fmf_cteni.cjs`.

**Stav ověření.** Ověřeno na těch třech souborech: (1) analytik našel postup a ověřil ho na všech třech, (2) ověřovatel, který dostal jen textový popis, ho sestavil znovu a došel ke stejnému výsledku, (3) naše čtečka v JavaScriptu
(napsaná zvlášť) přečte všechny tři soubory v Node i v Chromiu a všechny kontrolní součty sedí. **Co se tím nedokazuje:** že totéž platí pro každý export z jiné verze hry nebo z jiného sestavení;
čtečka proto u každého kroku kontroluje, co se dá, a při jakékoli odchylce soubor nepovažuje za přečtený.

## Rozložení souboru

| Část | Poloha | Obsah |
|---|---|---|
| Předmluva | bajty 0 až 25 | `02 01` + „afe.“ (`61 66 65 2e`) + `08 00 00`, u64 **A**, u64 `17`, bajt `03` |
| Datová část | od bajtu 26 | záznamy zdrojů za sebou (viz níže) |
| Patní značka | bajty A + 9 až A + 17 | `02 01` + „fmf.“ (`66 6d 66 2e`) + `08 00 00` |
| Manifest | od bajtu A + 18 do konce | **jeden zstd rámec** (bez uvedené velikosti obsahu, s kontrolním součtem) |

**A** je posun patní značky minus 9, takže `26 + součet velikostí záznamů = A + 9`. Význam čísel `17` a `03` v předmluvě a rozdíl mezi značkami „afe.“ a „fmf.“ **neznáme** (nehádáme).

## Manifest (rozbalený, little endian)

```
manifest := řetězec název | adresář(kořen)
adresář  := u32 počet souborů | soubor* | u32 počet podadresářů | (řetězec název | adresář)*
soubor   := řetězec název | řetězec přípona | u64 posun | u64 velikost | u64 „třetí“ | i64 čas1 | i64 čas2
řetězec  := u32 délka | UTF-8 bajty
```

- V pozorovaných souborech: kořen má `image.img` a `<název taktiky>.tac`, podadresář `_data` má `details.aom`. Oba časy jsou vždy `-62135596800` (0001-01-01, tedy pravděpodobně „nenastaveno“; význam je hypotéza).
- **Posun je od bajtu 26** (konec předmluvy), ne od začátku souboru. Záznamy leží za sebou v pořadí `.aom`, `.img`, `.tac`, manifest je vypisuje v jiném pořadí.
- „Třetí“ hodnota je **velikost záznamu po rozbalení** (rozbalený zstd rámec). Manifest se musí spotřebovat do posledního bajtu.

## Záznam jednoho zdroje

```
záznam := u32 16 | u32 16 | klíč[16] | IV[16] | šifrotext
```

- Šifrotext je **AES-128-CTR** s klíčem a IV z téhož záznamu. IV je celý počáteční čítací blok (čítač 128 bitů, big endian; WebCrypto: `AES-CTR`, `counter = IV`, `length = 128`; Node: `aes-128-ctr`).
- Klíč a IV leží v záznamu otevřeně: žádná derivace, žádné tajemství mimo soubor, **žádný podpis ani MAC**. Kontrolní součet zstd chrání před poškozením, **ne před záměrnou úpravou**.
- Po dešifrování vznikne **právě jeden zstd rámec** (hlavička `28 b5 2f fd`, příznaky `04`, okno `50`, jeden blok, na konci čtyři bajty = spodních 32 bitů XXH64 obsahu se seedem 0). Rámec nemá uvedenou velikost obsahu,
  takže se musí rozbalovat proudově. Obrazová data jsou v rámci uložená jako blok „raw“.
- Rozdíl velikostí v manifestu: u obrázku `velikost − třetí = 53` (40 bajtů záhlaví záznamu + 13 bajtů rámce), u `.aom` 38 nebo 35 (rámec je menší než obsah), u `.tac` je „třetí“ mnohem větší než velikost (obsah je stlačený).
- Posledních 26 bajtů předchozího záznamu vypadá na začátku dalšího jako náhodná „hlavička“: je to jen šifrotext předchozího záznamu (kdo čte posuny jako absolutní, hledá klíč o 26 bajtů dřív).

## Obsah zdrojů

| Zdroj | Obsah po rozbalení |
|---|---|
| `.img` | 10bajtová hlavička (`01 00 00 00 00 00 00 00 00 00` bez obrázku; u obrázku např. `01 01 00 00 00 00 d2 00 01 00`) a volitelné PNG (pozná se podle podpisu). Význam hlavičky neznáme. |
| `.aom` | `03 01` „moa.“ `04 00`, řetězec `TACTICS_TYPE_HANDLER`, název taktiky, nuly, 16 × `ff`, řetězec s veřejnou přezdívkou autora, několik dalších bajtů (vypadají jako identifikátory nebo časy). |
| `.tac` | `03 01` „cat.“ + 10 konstantních bajtů `22 00 22 44 00 1b 00 00 00 02` + řetězec s názvem taktiky + vlastní data taktiky (z velké části nuly). **Pole taktiky zatím nejsou dekódovaná**; jejich rozbor běží zvlášť a nic z nich se do aplikace nepřebírá, dokud není ověřené. |

Značky typovaných záznamů jsou přípony zapsané pozpátku („moa.“ = `.aom`, „cat.“ = `.tac`, „fmf.“ = `.fmf`); u „afe.“ v předmluvě to neplatí.

## Co čtečka dělá a nedělá

- Ověří předmluvu, patní značku, manifest (spotřebuje se celý), meze záznamů, délky klíče a IV, tvar zstd rámce (přesná délka, žádné bajty navíc), shodu velikosti po rozbalení s manifestem a kontrolní součet XXH64.
- Limity proti zneužití: soubor do 24 MiB, manifest do 1 MiB, nejvýš 64 souborů, jeden zdroj po rozbalení do 16 MiB, celkem 32 MiB; manifest, který slibuje větší velikost, se odmítne dřív, než se cokoli rozbalí.
- Vše běží v zařízení; nic se neposílá na internet ani do AI. Zpráva o souboru obsahuje jen velikosti a výsledky kontrol, ne obsah taktiky, obrázek ani přezdívku autora. Do úložiště aplikace se z `.fmf` zatím nic neukládá.
- Soubor, který nesedí na tento popis (starší nebo cizí), jde na původní kontrolu bez hádání; soubor se správnou hlavičkou, který nejde přečíst, se hlásí jako poškozený nebo z jiné verze hry.

## Co dál

Rozbor polí uvnitř `.tac` (formace, role a povinnosti, instrukce) potřebuje kromě tří souborů i **údaje z obrazovky hry pro tytéž taktiky**, aby se čísla v souboru dala spárovat s tím, co ukazuje hra (viz `POKRACOVANI.md`).
