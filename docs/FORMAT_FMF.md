# Formát souboru `.fmf` (export taktiky z FM27): kontejner

Popis vznikl rozborem **tří skutečných exportů z FM27**, které poslal majitel (5. 11. 2026; komunitní taktiky, které si načetl do své hry). **Obecný postup (zdroj zašifrovaný klíčem přímo v souboru, AES v režimu CTR, potom zstd) byl znám už z výzkumu cizích projektů** (`docs/NACITANI_DAT_ZE_HRY.md`, `docs/AUDIT_ZDROJU_FM27_2026-11-05.md`); konkrétní tvar popsaný níže (rozložení souboru, manifest, AES-128-CTR s klíčem a IV v záznamu, kontrolní součty) byl ověřen na těch třech souborech (viz „Stav ověření“). Nepoužil se žádný cizí dekodér formátu `.fmf` ani jeho kód a dekodér taktiky cizího projektu se nečetl (`docs/REFERENCE_ANALYSIS.md`); že se při rozboru nepoužila žádná jiná část cizího zdroje, z repozitáře doložit nejde
(cizí projekty se pro jiné části aplikace procházely; co se z nich četlo a pod jakou licencí, říkají `docs/REFERENCE_ANALYSIS.md` a `docs/AUDIT_ZDROJU_FM27_2026-11-05.md`). Soubory ani rozšifrovaný obsah v repozitáři nejsou: je to práce jejich autorů a jsou v nich veřejné přezdívky autorů.
Kód čtečky: `trener/src/fmfcontainer.js` (čistý modul), zkoušky: `trener/test/fmfcontainer.test.mjs` (syntetické soubory), `trener/test/e2e/scenarios/21_fmf_cteni.cjs`.

**Stav ověření.** Ověřeno na těch třech souborech: (1) první rozbor (provedl Claude) našel postup a ověřil ho na všech třech, (2) tři další samostatné běhy Claude, z nichž každý dostal jen textový popis (ne kód prvního rozboru), ho sestavily znovu (v Node i v Pythonu) a došly ke stejnému výsledku; je to shoda opakovaných pokusů téhož modelu, ne ověření člověkem ani oficiální specifikace,
(3) čtečka v aplikaci (vlastní kód, napsaná zvlášť, s vlastním dekodérem zstd) přečte všechny tři soubory v Node i v Chromiu, všechny kontrolní součty sedí a **všech 9 rozbalených zdrojů (po třech z každého souboru) je bajt po bajtu stejných** jako výstup prvního rozboru, který rozbaloval referenčním dekodérem libzstd (porovnání se znovu provedlo 5. 11. 2026 s kódem z repozitáře). **Co se tím nedokazuje:** že totéž platí pro každý export z jiné verze hry nebo z jiného sestavení;
čtečka proto u každého kroku kontroluje, co se dá. Vada manifestu nebo zdroje taktiky (`.tac`) znamená, že se soubor nepovažuje za přečtený; jiné odchylky (vadný obrázek nebo detaily, nepokrytá místa v datové části, záznam zčásti mimo ni, jiné hodnoty polí předmluvy) se hlásí jako varování a nic se o nich netvrdí.

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
- Přesnost tvrzení: ověřený je big-endian přenos čítače jen do druhého nejnižšího bajtu (největší záznam má 4111 bloků); šířku čítače (32, 64 nebo 128 bitů) vzorky neodliší a čtečka používá celých 128 bitů jako OpenSSL a WebCrypto. Délky `16` a `16` u záznamu jsou ve všech vzorcích stejné; zda jiná hodnota znamená AES-192 nebo AES-256, **nevíme** (čtečka odmítne cokoli jiného než 16 a 16).
- Po dešifrování vznikne **právě jeden zstd rámec** (hlavička `28 b5 2f fd`, příznaky `04`, okno `50`, jeden blok, na konci čtyři bajty = spodních 32 bitů XXH64 obsahu se seedem 0). Rámec nemá uvedenou velikost obsahu,
  takže se musí rozbalovat proudově. Obrazová data jsou v rámci uložená jako blok „raw“. „Jeden blok“ a „raw“ jsou vlastnosti těchto malých souborů (jeden blok pojme nejvýš 128 KiB), ne pravidla formátu: čtečka prochází bloky obecně a vyžaduje jen **jeden rámec na záznam**.
- Rozdíl velikostí v manifestu: u obrázku `velikost − třetí = 53` (40 bajtů záhlaví záznamu + 13 bajtů rámce), u `.aom` 38 nebo 35 (rámec je menší než obsah), u `.tac` je „třetí“ mnohem větší než velikost (obsah je stlačený).
- Posledních 26 bajtů předchozího záznamu vypadá na začátku dalšího jako náhodná „hlavička“: je to jen šifrotext předchozího záznamu (kdo čte posuny jako absolutní, hledá klíč o 26 bajtů dřív).
- Tím se vysvětlil i dřívější „nerozluštitelný“ samostatný vzorek `fm27-tac-payload.bin` (745 bajtů): je to přesně výřez souboru od bajtu 221 do 966, tedy o 26 bajtů dřív a o 26 bajtů kratší než skutečný záznam (chybí mu konec včetně kontrolního součtu); vyříznutý byl s posuny braných jako absolutní.

## Obsah zdrojů

| Zdroj | Obsah po rozbalení |
|---|---|
| `.img` | 10bajtová hlavička a data: bajt verze (`01`), bajt příznaku obrázku (`00` bez obrázku, `01` s obrázkem), u32 `0`, u32 délka dat; za ní PNG (pozná se podle podpisu). Bez obrázku jsou za verzí samé nuly. Význam příznaku a verze je odvozený z jediného souboru s obrázkem; shoda délky dat s PNG sedí u všech tří souborů. |
| `.aom` | `03 01` „moa.“ `04 00`, řetězec `TACTICS_TYPE_HANDLER`, název taktiky, 10 × `00`, 16 × `ff`, řetězec s veřejnou přezdívkou autora a 22 bajtů na konci (`02 00 01 00 02`, 4 proměnné bajty, `01 00 10 01 0b`, 8 proměnných bajtů; vypadají jako identifikátory nebo časy, **význam neznáme**). |
| `.tac` | `03 01` „cat.“ + 10 konstantních bajtů `22 00 22 44 00 1b 00 00 00 02` + řetězec s názvem taktiky + vlastní data taktiky. **Stavba** těchto dat je popsaná níže a čtečka ji přečte celou; **význam čísel (formace, role, povinnosti, instrukce) zatím neznáme** a nic z nich se do aplikace nepřebírá, dokud není ověřený. |

Značky typovaných záznamů jsou přípony zapsané pozpátku („moa.“ = `.aom`, „cat.“ = `.tac`, „fmf.“ = `.fmf`); u „afe.“ v předmluvě to neplatí.

## Stavba payloadu taktiky (`.tac` po rozbalení): jen stavba, ne význam

Vznikla rozborem týchž tří souborů, který samostatně provedly **dva běhy Claude** (nejsou to lidé a shoda dvou pokusů téhož modelu není oficiální specifikace); každý sestavil vlastní čtečku i zapisovač a obě spotřebují každý bajt všech tří payloadů (4771, 5085 a 6104 bajtů) a zapíšou je zpět bajt po bajtu stejně.
Naše čtečka v JavaScriptu (`trener/src/fmftac.js`, napsaná zvlášť) čte tři skutečné payloady stejně a zkoušky mají vlastní, nezávislý zapisovač (`trener/test/fixtures/fmftac_builder.cjs`). Všechna čísla jsou little endian, řetězec je `u32 délka` + UTF-8 bajty.

```
soubor    := značka[16] | název | 12 × 00 | hlavička6 | zabalených12 | styl | čtveřice4 | dvojice* | seznam id | patička
značka    := 03 01 „cat.“ 22 00 22 44 00 1b 00 00 00 02        (shodná ve všech třech souborech)
hlavička6 := 04 a b 07 02 03                                      (a a b jsou volné bajty, význam neznáme)
styl      := ff | řetězec
dvojice   := blok | blok | bajt místa                             (čtou se, dokud další tři bajty jsou 44 00 02)
blok      := 44 00 02 | selektor u32 | 00 | 01 | příznak (00 nebo 01) | počet u32 | položka{počet} | 00 00 00 00 | maska u64      (26 + 24 · počet bajtů)
položka   := klíč u64 | 02 02 02 | maska2 u64 | ff | hodnota u32                                                                  (24 bajtů)
seznam id := 01 | N u32 | záznam{N};  záznam := id u32 | příznak u32 (0 nebo 1) | [blok, když příznak = 1]
patička   := 00 00 00 00 | početSeznamů u32 | seznam* | 01 00 00 00 | záznam13{12} | bajt konce | 30 × 00
seznam    := značka u32 | počet u32 | (01 00 | id u32){počet}
```

**Ověřeno z bajtů (T1)**: tvar a konstanty výše; v každém ze tří souborů je 11 dvojic, 22, 23 a 24 bloků (22 + počet záznamů s příznakem 1), 156, 166 a 205 položek, 0, 23 a 16 záznamů seznamu id a 0, 0 a 3 seznamy v patičce;
prosté vyhledání bajtů `44 00 02` dává přesně tolik bloků, kolik jich dává rozbor, a každý bajt `02 02 02` a `ff` je gramatikou vysvětlený.
**Konzistence (T2, jen shoda uvnitř tří souborů, ne důkaz významu)**: klíč položky má vždy právě jeden nastavený bit a v bloku vzestupně; maska bloku má vždy dva bity (jeden z klíčů téhož bloku a jeden z bitů 21 až 23); bajty míst tvoří permutaci 0 až 10;
selektor (5 bajtů) nese v každém z 69 bloků právě jeden bit 0 až 14 (bit 1 se nevyskytl) a k tomu kód strany {0, bit 20, bit 21}, který se objevuje jen u bitů 4, 7, 10, 13 a 14; že jde o pozici hráče a stranu hřiště, je domněnka. Počty bitů v pěti skupinách po sobě jdoucích bitů odpovídají číslicím formace ve dvou ze tří názvů souborů (třetí název formaci neuvádí), a to je slabá shoda: z 495 možných rozdělení třinácti poloh bitů 2 až 14 na pět skupin po sobě jdoucích bitů vyhovují čtyři (bit 0 se do tohoto počítání nezahrnul; se čtrnácti polohami je možných rozdělení 715 a kolik z nich vyhovuje, se nepřepočítávalo). Spárování bajtu místa s bloky podle shodného selektoru potvrzuje jediný ze tří souborů (9 z 11 míst proti 2 z 11 náhodou), u dalších dvou nerozhoduje. **Co to dokazuje a co ne:** tvar souboru je znám, ale **co které číslo znamená, nevíme**; hypotézy (dvojice = role ve dvou fázích hry, klíč = role, maska = vybraná role s povinností) jsou **neověřené** a čtečka je nepoužívá.

**Nevíme:** vnitřek „zabalených 12“ a „čtveřice4“, význam `a` a `b` v hlavičce, význam `maska2` a `hodnota` u položek, význam id v seznamu a v patičce a proč za záznamem s příznakem 1 následuje blok, vnitřek 12 záznamů po 13 bajtech, význam bajtu konce.
Ověření významu potřebuje údaje z obrazovky hry pro tytéž taktiky (viz „Co dál“).

Čtečka je přísná: jiná konstanta, nenulový bajt tam, kde mají být nuly, počet nad meze (dvojic 32, položek v bloku 4096, záznamů 4096, seznamů 64, id v seznamu 4096, bloků celkem 1024, řetězec 4096 bajtů, payload 4 MiB), bajty navíc i chybějící konec znamenají „soubor má jinou stavbu“ a **nic se neodhaduje**.
Co čtečka přijme, to se zapíše zpět bajt po bajtu stejně (zkouška na 4000 nahodile poškozených vstupech). Čtečka vrací syrové hodnoty, nic nepřekládá na role ani formaci. Zpráva o souboru nese o struktuře jen počty (bez názvu stylu, čísel a bajtů z taktiky).

## Co čtečka dělá a nedělá

- Ověří předmluvu, patní značku, manifest (spotřebuje se celý), meze záznamů, délky klíče a IV, tvar zstd rámce (přesná délka, žádné bajty navíc), shodu velikosti po rozbalení s manifestem a kontrolní součet XXH64.
- Potom přečte **stavbu** payloadu taktiky (`fmftac.js`, viz výše); když stavba nesedí, kontejner zůstane přečtený a obrazovka řekne „stavba neodpovídá, nic se z ní nepřebírá“.
- Limity proti zneužití: soubor do 24 MiB, manifest do 1 MiB, nejvýš 64 souborů, jeden zdroj po rozbalení do 16 MiB, celkem 32 MiB; záznam, který by podle manifestu po rozbalení přesáhl limit, se nerozbaluje (kontrola je po záznamech). Rozbalení zstd je vlastní (`trener/src/zstd.js`) a práci má omezenou: strop výstupu, největší blok 128 KiB, okno do 2^27 + 1 B (128 MiB a bajt navíc: stejný strop jako výchozí nastavení libzstd), počet bloků nejvýš ceil(povolený výstup / 1 KiB) + 16 (povolený výstup je velikost obsahu uvedená v rámci, jinak strop výstupu; jinak se stavba tabulek v každém bloku dá zneužít ke zdržení stránky) a rozpočty na jedno čtení souboru: 20 000 bloků a 33 MiB výstupu; účtuje se i práce za záznamy, které selžou (jinak by soubor s mnoha záznamy vadnými až na konci stránku zdržel).
  **Známé omezení:** platný rámec, který má víc než ceil(povolený výstup / 1 KiB) + 16 bloků (například z proudového zapisovače, který po každých pár bajtech vyprázdní vyrovnávací paměť), se odmítne s kódem `blocks`, i když ho referenční dekodér přijme. Povolený výstup je velikost obsahu uvedená v rámci, jinak strop výstupu (výchozí 16 MiB): rámec z drobných bloků se proto odmítne jen při stropu blízkém jeho velikosti (tak dekodér volá čtečka kontejneru, se stropem podle manifestu) a s výchozím stropem 16 MiB projde až 16 400 bloků. Ve všech třech skutečných exportech má každý ze čtyř rámců jediný blok.
  **Rozdíly proti libzstd 1.5.7 u vadných rámců** (změřeno přes Python balíček `zstandard` 0.25.0 na stroji s BMI2; platné rámce se shodují; šest případů je v tabulce v `docs/REVIZE_FMF_2026-11-05.md`, přesné podmínky v záhlaví `trener/src/zstd.js`; všech 9 zdrojů ze tří skutečných exportů se s libzstd shoduje, viz „Stav ověření“). Dekodér odmítne, co libzstd přijme, v těchto případech: odkaz dál než okno rámce (`window`); blok větší než okno (`blocksize`) a okno nad 2^27 + 1 B (`bigwindow`; okna s windowLog nad 31 libzstd odmítne už v hlavičce), které libzstd nekontroluje u rámce, jenž uvádí velikost obsahu a ta se vejde do výstupní paměti volajícího (u věštírny 128 KiB): je to jednoprůchodová zkratka v rozhraní `ZSTD_decompressStream`, vlastnost rozhraní, ne rámce (bez uvedené velikosti obsahu nebo s výstupem, který se do paměti volajícího nevejde, libzstd tytéž rámce odmítne); konec čtyřproudých literálů (`litend`), který libzstd nekontroluje jen tehdy, když má **každý ze čtyř proudů aspoň 8 B a zároveň nejdelší kód Huffmanova stromu nejvýš 11 bitů** (strom s 12bitovými kódy rychlou cestu nepoužije a konec kontroluje; podle zdroje libzstd to závisí i na BMI2); velikost obsahu 2^64−1, kterou libzstd bere jako „neuvedeno“ (`corrupt`). Opačně libzstd odmítne váhy Huffmanova stromu zapsané přes FSE se symbolem 12 a víc při přesnosti 6 (92 a víc při přesnosti 5), protože se nevejdou do její pracovní paměti, a dekodér je přijme (literály vyjdou přesně).
- Vše běží v zařízení; nic se neposílá na internet ani do AI. Zpráva o souboru obsahuje název souboru, název taktiky a cesty zdrojů z manifestu, velikosti a výsledky kontrol, ne obsah taktiky, obrázek ani přezdívku autora. Do úložiště aplikace se z `.fmf` zatím nic neukládá.
- Soubor, který nesedí na tento popis (starší nebo cizí), jde na původní kontrolu bez hádání; soubor se správnou hlavičkou, který nejde přečíst, se hlásí jako poškozený nebo z jiné verze hry.

## Co dál

Rozbor polí uvnitř `.tac` (formace, role a povinnosti, instrukce) potřebuje kromě tří souborů i **údaje z obrazovky hry pro tytéž taktiky**, aby se čísla v souboru dala spárovat s tím, co ukazuje hra (viz `POKRACOVANI.md`).
