# Pokračování (4. 11. 2026)

Chat se mezi relacemi nepřenese. Navazuj z tohoto souboru, z `HANDOFF_CLAUDE.md` a z `PROMPT_CLAUDE_CONTINUE.md`.

## Kde to stojí

- **Kód aplikace z Cursoru (Wave 76) v repozitáři není.** Majitel ho zatím nenahrál. Bez něj nejde „projít, vylepšit, opravit“
  samotnou aplikaci; nic jsem nestavěl od nuly (majitel: „škoda začít od nuly“).
- Z cloudu jsem přidal jen to, co handoff označuje jako prioritu 2 a základ priority 1, bokem a bez zásahu do kódu aplikace:
  - `ai_gateway/` (126 testů, živé API neověřeno), popis v `docs/AI_GATEWAY_V2.md`;
  - `fmf_research/` (oprava dvou prokázaných chyb inspektoru, 11 testů);
  - `docs/REVIZE_CLAUDE_2026-11-04.md` (kontrola souborů, které jsem dostal).
- Stav aplikace (≈ 88 %, 12 z 15 testů) je z handoffu, **neověřený mnou**.

## Co přibylo 4. 11. odpoledne: samostatný poradce `trener/`

Majitel upřesnil, že aplikace má být **samostatný poradce, který s ním řeší problémy, vychází hlavně z jeho knih (teorie)
a umí hledat kontext**. Původní zadání je teď v `docs/ZADANI_MASTER_PROMPT.md`. Cursorův kód stále není k dispozici,
a protože nebylo kam navázat, vznikl nezávislý modul, který kód z Cursoru nenahrazuje ani nepřepisuje:

- `trener/` je jedna stránka (artefakt v Claude). Knihy se čtou v prohlížeči majitele, hledá se v nich BM25 a Claude
  skládá desetibodovou radu; JS validátor poctivosti je překlad `advice10.py` (68 společných případů hlídá test).
- Žádný server, žádný klíč v chatu: stránka volá Claude přes schopnost `sample` z účtu toho, kdo ji otevře.
- Texty knih zůstávají v IndexedDB prohlížeče a v exportu, který si majitel sám uloží. **Nikdy do gitu.**
- Co je ověřené a co ne: viz `trener/README.md`, část „Co je ověřeno“.

Dlouhodobá varianta, kdyby stránka přestala stačit: samostatné hostované řešení podle pivovarské bible (vlastní Supabase
projekt, zpracování knih na serveru, hledání v databázi, náklady na AI). Rozhodnout s majitelem, až vyzkouší stránku.

## Co udělat jako první

1. Zjistit, jestli je v repozitáři kód Wave 76 (`git ls-remote origin`, `ls`). Pokud ano: přečíst `ARCHITECTURE.md`, spustit testy z handoffu
   (`python3 -m unittest discover -s tests -v`, `python3 tests/e2e_smoke.py`, `node --test tests/unit_*.mjs`) a sepsat tabulku akceptačních testů s důkazem.
2. Zapojit `ai_gateway/` do `/api/ai/advise` (snippet v `docs/AI_GATEWAY_V2.md`) a **sladit schéma 10 polí s `docs/AI_GATEWAY.md`**
   v jediném souboru `ai_gateway/advice10.py`. Nic z toho jsem neviděl, typy uvnitř polí jsou můj návrh.
3. Nepřepisovat ani nemazat stávající proxy pro OpenAI v `serve_local.py`; adaptér OpenAI v `ai_gateway/` zatím není.

## Co potřebuju od majitele

- Kód z Cursoru v repozitáři (postup v `README.md`, odkaz https://github.com/janvasilecko-droid/FM27-apka/upload/main).
- Klíč Anthropic **jen v prostředí serveru na jeho PC**, nikdy v chatu ani v repozitáři (postup v `docs/AI_GATEWAY_V2.md`), a pak výstup
  `python3 -m ai_gateway.live_check --yes`.
- Skutečný export `.fmf` z FM27 (tři exporty podle `docs/REVIZE_CLAUDE_2026-11-04.md`, část 2) a 3–5 screenshotů FM27 v jazyce hry
  (zápas, statistiky, taktika) s údaji, které na nich vidí (ověřená pravda pro měření čtení obrazovky).
- Ověření zachytávání okna FM27 na jeho Windows PC (z cloudu nejde).

## Pravidla majitele (platí vždy)

Česky a stručně; průběžně říkat, co se dělá a co to má dělat; posílat přesné odkazy; nikdy nežádat klíč, token ani heslo do chatu;
nic nemazat a nehádat; správnost před rychlostí; nepředstírat funkce (demo jen výslovně označené);
nikdy netvrdit, že aplikace „vidí“ FM27, pokud to nevyplývá z reálného snímku nebo souboru.

## Rozhodnutí z této relace

- Repozitář `FM27-apka` je **veřejný** (vytvořil ho majitel). Žádné klíče, žádná osobní data. Případně přepnout na Private:
  https://github.com/janvasilecko-droid/FM27-apka/settings (dole „Change visibility“). Soukromý repozitář pak čtu jen v relaci, která k němu má přístup.
- Soubor `fm27-tac-payload.bin` v repozitáři **není** (neznámý binární obsah z osobního exportu; stačí popis v revizi).
- Vysoká jistota v radě je záměrně těžká na splnění (dva ověřené screenshoty). Je to záměr, ne chyba.
