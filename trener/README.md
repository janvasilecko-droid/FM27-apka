# FM27 Tactical Coach: poradce ze tvých knih (stránka v Claude)

Samostatný poradce k Football Manageru 27. Přečte tvoje knihy o taktice (PDF s textovou vrstvou, TXT, MD), najde v nich
místa k tvému problému, složí desetibodovou radu a u každého tvrzení řekne, odkud je. Co neví, to napíše a řekne, co má
ověřit ve hře. Výslovně nepředstírá, že FM27 vidí.

Je to jedna stránka (artefakt v Claude). Nepotřebuje server ani klíč: volá Claude přes schopnost `sample` z účtu toho,
kdo stránku otevře, a spotřebuje jeho limit. Zadání: [`docs/ZADANI_MASTER_PROMPT.md`](../docs/ZADANI_MASTER_PROMPT.md).

## Jak radí

1. **Plán hledání.** Levné volání Claude (`modelTier: quick`) navrhne 3 až 5 krátkých dotazů v jazycích tvých knih.
2. **Hledání v knihách.** Index BM25 (bez ohledu na diakritiku, lehké stemování, čeština a angličtina), více dotazů se spojí
   (RRF), z jedné knihy nejvýš tři úryvky. Hledá se v zařízení, texty knih nikam neodcházejí kromě úryvků do dotazu na radu.
3. **Rada.** Jedno volání (`default`, v důkladném režimu `complex`) s pravidly poctivosti, pozorováními, zdroji a úryvky.
4. **Kontrola poctivosti** (`core.js`, `validateAdvice10`, překlad `ai_gateway/advice10.py`). Neprošla-li rada, jedno opravné
   kolo. Když neprojde ani to, **žádná rada se neukáže**, jen důvody a „Zkusit znovu“.
5. **Doplnění.** Co trenér neví (`unknown.items`), můžeš vyplnit a poradit znovu; předchozí rada jde do dotazu jako kontext.

Pravidla, která kontrola vynucuje: úroveň důvěry nesmí být silnější než nejslabší důkaz; strojově vyčtený text je nejvýš
„odhad“; vysoká jistota jen ze dvou nezávislých ověřených screenshotů; žádné vymyšlené mechaniky (CA/PA, match engine, skryté
atributy); nejvýš dvě konkrétní změny; názvy nastavení a cest v menu FM27 jsou neověřené, dokud je nepotvrdí screenshot
nebo oficiální zdroj FM27. **Úryvek z knihy je teorie, ne důkaz**: nikdy nesmí být důkaz A ani B a nikdy nepopisuje, jak funguje FM27.

## Soubory

| Soubor | K čemu |
|---|---|
| `src/core.js` | jádro bez DOM: text, odstavce, BM25, kontrola poctivosti, prompty. Běží v prohlížeči i v Node |
| `src/app.js` | rozhraní: knihovna (IndexedDB, pdf.js z cdnjs), pozorování, volání Claude, vykreslení, historie |
| `src/styles.css`, `src/index.template.html` | vzhled (tmavý a světlý), kostra stránky |
| `build.mjs` | slepí vše do `dist/trener.fragment.html` (publikuje se) a `dist/trener.test.html` (zkoušky) |
| `test/core.test.mjs` | 27 testů jádra; 68 případů validátoru je společných s Pythonem (`test/fixtures/validator_cases.json`) |
| `test/e2e/` | zkouška celé stránky v Chromiu s předstíraným Claude (94 kontrol) a generátor syntetických souborů |
| `tools/export_validator_cases.py` | z Pythonu vyrobí společné případy validátoru |

## Sestavení a zkoušky

```bash
node trener/build.mjs                                 # dist/trener.fragment.html + dist/trener.test.html
node --test trener/test/*.test.mjs                    # jádro, bez prohlížeče
python3 -m unittest discover -s ai_gateway/tests -t . # shoda validátoru s Pythonem se hlídá i tady
```

Zkouška v prohlížeči (potřebuje Playwright s Chromiem, `reportlab` a `pdfjs-dist@3.11.174`; stránka tak načítá pdf.js lokálně
místo z cdnjs):

```bash
npm install --prefix /tmp/pdfjs pdfjs-dist@3.11.174
python3 trener/test/e2e/make_fixtures.py /tmp/fx
FIXTURES=/tmp/fx PDFJS_DIR=/tmp/pdfjs/node_modules/pdfjs-dist/build OUT=/tmp/out node trener/test/e2e/e2e.cjs
```

Po změně `core.js`, `app.js` nebo stylů vždy znovu `node trener/build.mjs`; `dist/` není v gitu.

## Publikace

Artefakt z `dist/trener.fragment.html` s `capabilities: {sample: {images: true}, downloads: true}`. Obálku `<html>` doplní
publikace. Aktualizace: znovu publikovat ten samý soubor se stejnou adresou, ať zůstane odkaz.

## Co je ověřeno a co ne

Ověřeno (zkouškou v Chromiu s předstíraným `window.claude`): načtení stránky, čtení PDF přes pdf.js (s Web Workerem i bez něj,
400 stran za ≈ 1,5 s bez zasekání rozhraní), odstranění záhlaví a čísel stran, odmítnutí skenů bez textu, duplicity, uložení
v IndexedDB a přežití obnovení, hledání (diakritika, čeština, angličtina), pořadí volání (plán `quick`, rada `default`/`complex`,
bez mezipaměti), opravné kolo, selhání opravy, odpověď mimo JSON, chyby `not_granted`, `rate_limited`, `upstream_error`,
zastavení, doplnění s předchozí radou, obrázek jen v prvním volání, plán, export a import, historie, rozložení na telefonu
(bez vodorovného posouvání) ve světlém i tmavém režimu.

**Neověřeno z cloudu** (to ukáže až živá stránka):

- skutečná odpověď Claude: jestli rada na první pokus projde kontrolou, nebo se často spouští oprava;
- souhlas při prvním volání Claude a skutečné limity okna artefaktu (pdf.js z cdnjs, Web Worker, IndexedDB);
- čtení skutečných knih (sazba ve sloupcích, vzorce, tabulky; skeny bez textové vrstvy se vynechají, OCR zatím není).

Když něco z toho selže, stránka to řekne na záložce Info (Zkouška spojení s Claude, Zkouška hledání) nebo v hlášení u knihy.

## Soukromí a autorská práva

Texty knih zůstávají v IndexedDB prohlížeče a v exportu, který si uložíš sám (`fm27-knihovna.json`, obsahuje texty knih,
nikam ho nesdílej). Do Claude jde jen dotaz a vybrané úryvky. Při přidání knihy potvrzuješ, že dokument smíš používat.
Repozitář je veřejný: obsah knih nesmí do gitu, testů ani záznamů. Testovací soubory jsou syntetické a vznikají generátorem.

## Omezení a co dál

- Rada vychází z teorie v knihách a z toho, co jí řekneš. Hru nevidí; názvy nastavení FM27 jsou vždy neověřené.
- Hledání je lexikální (BM25), ne sémantické. Pro velké knihovny nebo hledání významem by se hodil hostovaný index.
- Možné rozšíření: nechat Claude hledat v knihách samo přes `tools` ve `sample` (víc kol hledání), čtení skenů přes obrázky,
  napojení na `ai_gateway/` a Live Coach z původního zadání.
