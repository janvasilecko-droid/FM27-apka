# Revize souborů z Cursoru/Codexu (4. 11. 2026)

**Rozsah.** Jen soubory, které jsem dostal: `index.html` (stav z 1. 11.), `fmf_inspect.py`, `knowledge.json`,
`takticky-plan.json`, `fm27-tac-payload.bin` (v repozitáři není) a `icon.svg`. **Kód Wave 76 jsem neviděl**
(`app.js`, `serve_local.py`, testy, desktop). Nálezy se týkají jen těchto souborů. Co je ověřené experimentem,
je výslovně označeno.

## 1. `fmf_inspect.py`

Dobře: omezený vstup (5 MiB), omezený manifest (1 MiB), časový limit pro 7-Zip, `--` před cestou, úklid dočasného souboru,
`status: metadata_only` a seznam `unknown_fields`. Poctivé, nic nedekóduje.

Zkoušel jsem ho na syntetických kontejnerech poskládaných podle jediného pozorovaného vzorku
(`fmf_research/tests/test_fmf_inspect_v2.py`; není to reálný export FM27):

| Zkouška | Originál | Verze v2 |
|---|---|---|
| T1 platný kontejner | název i zdroje správně | stejně |
| T2 manifest je první, za ním další zstd rámec | **tiše vrátí prázdný název a zdroje** (žádná chyba) | najde manifest |
| T3 platný manifest + náhodná hlavička zstd za ním | **selže** („manifest nebylo možné ověřit“) | najde manifest |
| T4 „bomba“ (5 MiB nul) | odmítnuto | odmítnuto |
| T5 jiná hlavička, T6 bez zstd rámce | chyba | chyba |
| jen datový rámec, žádný manifest | prázdný „úspěch“ | chyba |

**Příčina T2/T3:** originál bere vždy **poslední** zstd rámec (`offsets[-1]`). To platí pro jediný pozorovaný vzorek,
ne obecně. **Oprava:** `fmf_research/fmf_inspect_v2.py` zkusí kandidáty odzadu a přijme první, který obsahuje token
`.tac`/`.img`/`.aom`; když žádný nevypadá jako manifest, skončí chybou. Originál je beze změny v `reference/`.

Dál (neověřeno experimentem, jen z čtení kódu):
- `observed_header_version` ("2.1") vznikne z prvních dvou bajtů a tvrdí význam „verze“, který nikdo neprokázal. V2 přidává `header_version_semantics: unverified`.
- `tactic_name` je heuristika (token před prvním `.tac`) z jednoho vzorku. V2 přidává `tactic_name_basis` a `tactic_name_confidence: low`.
- Záložní cesta přes 7-Zip: jestli 7-Zip rozbalí holý zstd rámec, záleží na jeho sestavení (nemám 7-Zip k ověření). Spolehlivější je `pip install zstandard`.

## 2. `fm27-tac-payload.bin`

745 B, entropie 7,73 bit/B (u tak malého souboru prakticky nerozlišitelné od náhodných dat). Žádná známá hlavička
(zstd, gzip, zip, 7z, bzip2, xz, lz4, png, json, xml), nic se nerozbalilo jako zlib/deflate/gzip, žádné čitelné řetězce.
Na offsetech 26 a 30 stojí 4bajtová little-endian hodnota 16. Inspektor ho odmítne (nemá pozorovanou hlavičku).
**Co to je, nevím.** Může být šifrovaný i komprimovaný; hádat nebudu (zadání: „Nehádej interní strukturu“).

*Dodatek (5. 11. 2026):* po obdržení tří skutečných exportů se ukázalo, že je to **výřez ze souboru `.fmf` posunutý o 26 bajtů** (od bajtu 221 do 966 souboru Underdog; skutečný záznam je od bajtu 247 do 992). Posuny v manifestu se čtou od bajtu 26, ne od začátku souboru; proto výřez začínal koncem předchozího záznamu a chyběl mu konec včetně kontrolního součtu. Skutečná struktura: `docs/FORMAT_FMF.md`.

Jak to rozhodnout bez hádání, potřebuju z FM27 tři exporty: tutéž taktiku dvakrát beze změny a jednou s jedinou změnou
(např. jiná mentalita). Shodné soubory = deterministický formát; zcela odlišné bajty u stejné taktiky = nejspíš šifrování
s náhodnou složkou (pak je import `.fmf` pravděpodobně nereálný a zbývá doplnění screenshotem nebo ručně);
malá lokální změna u jediné změny = čitelná struktura a dá se porovnávat.

## 3. `knowledge.json`

Dobře: tři oficiální zdroje s upozorněním (`caveat`), že jde o oznámené funkce předvydané verze, parafráze místo opsaných textů.
Chybí / návrhy:
- `publication_date` je ve všech třech `null`, zadání ale chce datum. Doplnit nebo vedle uvést `retrieved_on` jako samostatné pole.
- `version`, `trust`, `source_type` jsou volný text. Strojově čitelně: `fm_version: "27"`, `release_state: "pre_release"`, `official: true`.
  `ai_gateway/sources.py` to z textu zatím odvozuje, ale křehce.
- `claims` jsou holé řetězce bez `id`, takže je rada nemůže přesně citovat. Návrh: `{id, text, in_game_verified: false}`.
- Všechna tvrzení mají být `in_game_verified: false`, dokud je nepotvrdí pozorování ve hře.

## 4. `takticky-plan.json` (formát `fm27-tactical-coach-manual-plan` v1)

Je to výchozí ukázková sestava, žádná reálná data o týmu. Návrhy pro verzi 2:
- Hráči jsou ve třech kopiích (`players`, `phaseShapes.in.players`, `phaseShapes.out.players`), hrozí rozjetí. Jednou `players` a ve fázích jen souřadnice.
- Souřadnice `x`/`y` (0–100) nemají zdokumentovanou orientaci (z dat: brankář má y = 91, tedy vlastní brána dole).
- Role a pokyny jsou volný text; pro AI i pro ověřování chybí struktura a **původ každého pole** (`user_entered` / `screenshot_verified` / neznámé).
- `version: 1` bez `schema` a bez migrace; přidat.

## 5. `index.html` (stav z 1. 11.)

Je starší než Wave 76: Live coach je tam „FÁZE 1“ bez OCR a chybí vše z vln 73–76 (piny, přehled kariéry, historie rad, DEMO). Formuláře mají popisky
a texty konzistentně říkají, co je ruční a co ověřené (silná stránka). Další hodnocení bez aktuálního `app.js` nemá smysl.

## Návrh dalších kroků

1. Nahrát kód Wave 76 (viz `README.md`), spustit testy z handoffu a sepsat tabulku 15 akceptačních testů s důkazem.
2. Zapojit `ai_gateway/` do `/api/ai/advise` a sladit schéma rady s `docs/AI_GATEWAY.md`.
3. `python3 -m ai_gateway.live_check --yes` s klíčem; ověřit, co bez klíče ověřit nejde.
4. Změřit čtení obrazovky na skutečných screenshotech FM27 s ověřenou pravdou, teprve potom případně změnit štítek.
5. Windows capture (Tauri/WebView2) ověřit s majitelem na jeho PC; z cloudu to otestovat nejde.
6. `.fmf`: tři exporty podle části 2; dekódování jen s důkazem.
