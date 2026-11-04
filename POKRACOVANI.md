# Pokračování (stav 4. 11. 2026, večer)

Chat se mezi relacemi nepřenese. Navazuj z tohoto souboru, z `README.md` a z `docs/AKCEPTACNI_MATICE.md`.

## Kde to stojí

- **Aplikace je implementovaná podle původního zadání** (`docs/ZADANI_MASTER_PROMPT.md`): deset sekcí, sedm etap, kontrola poctivosti
  u všeho, co aplikace říká. Kód je v `trener/`, popis v `trener/README.md`, architektura v `docs/ARCHITEKTURA_V2.md`.
- **Dvě sestavení z jednoho kódu**: stránka v Claude (publikovaná, soukromý odkaz majitele
  https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh) a samostatná aplikace (sestavení prochází na serveru GitHubu, **nasazení čeká na
  zapnutí GitHub Pages majitelem**, viz níže).
- **Zkoušky**: 509 testů jádra, 141 + 11 v Pythonu, 453 kontrol v prohlížeči (11 scénářů). Kód prošel nezávislou revizí dvou AI revizorů, nálezy jsou opravené (`docs/REVIZE_NEZAVISLA_2026-11-04.md`). Co z nich dokazuje a co ne:
  `docs/AKCEPTACNI_MATICE.md`. Zkoušky používají náhražky za Claude, `db`, sdílení obrazovky a hlas; **nic z toho nebylo vyzkoušeno proti
  skutečné službě ani skutečnému FM27**.
- Kód z Cursoru (Wave 76) v repozitáři nikdy nebyl; `trener/` je nová implementace. Kdyby se našel, porovná se (ne přepíše).

## Co udělat jako první, když se na tom pracuje dál

1. Přečíst `docs/AKCEPTACNI_MATICE.md` (část 1 a 3) a `trener/README.md` (část „Co je ověřeno a co ne“).
2. Spustit zkoušky (`trener/README.md`, část „Sestavení a zkoušky“). Po změně zdrojů vždy `node trener/build.mjs`.
3. Publikace stránky v Claude: `Artifact` s `file_path=trener/dist/trener.fragment.html` a `url=https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh`
   (nejdřív `read`), capabilities `sample` (s obrázky), `downloads`, `db`, `user`.
4. Pokud majitel pošle skutečné vzorky (níže), nejdřív s nimi změřit čtení screenshotů a dekódování `.fmf`, ne psát další funkce.

## Co potřebuju od majitele (a kde to udělat)

1. **Vyzkoušet stránku v Claude** na počítači i telefonu pod stejným účtem: https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh
   a přidat aspoň jednu skutečnou knihu (sekce „Zdroje znalostí“).
2. **Zapnout GitHub Pages**: https://github.com/janvasilecko-droid/FM27-apka/settings/pages → Source: **GitHub Actions**; potom
   „Run workflow“: https://github.com/janvasilecko-droid/FM27-apka/actions/workflows/pages.yml. Až první nasazení projde, přidá se
   spouštění po každém pushi (nyní jen ručně, `.github/workflows/pages.yml`).
   **Pozor na adresu:** aplikace pak poběží na `https://janvasilecko-droid.github.io/FM27-apka/`. Úložiště prohlížeče (klíč AI, kariéry,
   knihy) tam sdílí původ se všemi dalšími stránkami na `janvasilecko-droid.github.io`; skript z jiné takové stránky by je mohl číst.
   Proto aplikace na `github.io` klíč výchozně nepamatuje (jen do zavření záložky) a varuje. Bezpečnější je vlastní adresa
   (Settings → Pages → Custom domain), nebo klíč nezadávat a aplikaci používat jen se stránkou v Claude.
3. **Skutečné vzorky z FM27**: tři exporty `.fmf` s předem známým nastavením (`docs/REVIZE_CLAUDE_2026-11-04.md`, část 2) a 3 až 5
   screenshotů (zápas, statistiky, taktika) s tím, co na nich vidí. Bez nich nejde změřit čtení obrazovky ani dekódovat taktiku.
4. **Vlastní klíč AI** pro samostatnou verzi (volitelné): https://console.anthropic.com/settings/keys, vložit **jen do Nastavení
   v aplikaci**, nikdy do chatu. Doporučen samostatný klíč pro aplikaci s měsíčním limitem.
5. **Zkouška Live Coache na Windows**: samostatná verze v Chrome nebo Edge, sdílet okno FM27, okno aplikace nechat viditelné vedle hry
   (skryté okno prohlížeč zpomaluje; aplikace na to upozorní).

## Neumí / záměrně není

Klient pro Windows (Tauri) a server s PostgreSQL ze zadání § 1 (nahrazeno webovou aplikací), pole taktiky v `.fmf` (nejsou známá),
oznámení na zavřený telefon, překryvné okno nad hrou, OCR skenů, hledání na internetu za běhu (kontext je z knih, přidaných zdrojů a
registru oficiálních článků FM27), ověření OpenAI-kompatibilního rozhraní proti živé službě.
Seznam s důvody: `docs/AKCEPTACNI_MATICE.md`, část 3.

## Možná další rozhodnutí (až majitel stránku vyzkouší)

- Hostovaná varianta podle „Pivovarské bible“ (vlastní Supabase projekt, zpracování knih na serveru, hledání v databázi, náklady na AI),
  kdyby měla aplikace sdílet knihy mezi zařízeními nebo se samostatná verze měla synchronizovat. Do té doby knihy zůstávají v zařízení.
- Nechat Claude hledat v knihách samo (`tools` ve `sample`) místo jednoho plánu dotazů.

## Pravidla majitele (platí vždy)

Česky a stručně; průběžně říkat, co se dělá a co to má dělat; posílat přesné odkazy; nikdy nežádat klíč, token ani heslo do chatu;
nic nemazat a nehádat; správnost před rychlostí; nepředstírat funkce (demo jen výslovně označené);
nikdy netvrdit, že aplikace „vidí“ FM27, pokud to nevyplývá z reálného snímku nebo souboru.

## Rozhodnutí z minulých relací

- Repozitář `FM27-apka` je **veřejný** (vytvořil ho majitel). Žádné klíče, žádná osobní data, žádný obsah knih. Případně přepnout na
  Private: https://github.com/janvasilecko-droid/FM27-apka/settings (dole „Change visibility“); soukromý repozitář pak čtu jen v relaci,
  která k němu má přístup, a GitHub Pages u soukromého repozitáře mohou vyžadovat placený plán (ověř v nastavení účtu).
- Soubor `fm27-tac-payload.bin` v repozitáři **není** (neznámý binární obsah z osobního exportu; stačí popis v revizi).
- Vysoká jistota v radě je záměrně těžká na splnění (dva ověřené screenshoty). Je to záměr, ne chyba.
