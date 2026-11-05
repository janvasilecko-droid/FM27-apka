# Pokračování (stav 5. 11. 2026)

Chat se mezi relacemi nepřenese. Navazuj z tohoto souboru, z `README.md` a z `docs/AKCEPTACNI_MATICE.md`.

## Kde to stojí

- **Aplikace je implementovaná podle původního zadání** (`docs/ZADANI_MASTER_PROMPT.md`): deset sekcí, sedm etap, kontrola poctivosti
  u všeho, co aplikace říká. Kód je v `trener/`, popis v `trener/README.md`, architektura v `docs/ARCHITEKTURA_V2.md`.
- **Dvě sestavení z jednoho kódu**: stránka v Claude (publikovaná, soukromý odkaz majitele
  https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh) a samostatná aplikace, **nasazená na GitHub Pages**:
  https://janvasilecko-droid.github.io/FM27-apka/ (nasazuje se samo po každé změně aplikace na `main`).
- **Hledání zdrojů na webu** (5. 11. 2026, na přání majitele „zdroje musí hledat aplikace, ta mě to má učit“): karta „Zdroje z webu“ ve
  „Zdrojích znalostí“, volba „Hledat i na webu“ u Osobního trenéra a u lekce ve Škole, zkušební hledání v Nastavení. Cesty: konektor
  „Parallel Search“ (stránka v Claude, `mcp`) a `web_search` od Anthropic přes klíč (samostatná verze, účtuje se zvlášť). **Neověřeno proti
  živým službám**, nic z webu není `verified`, v Live Coachi se nehledá. Kód: `trener/src/websources.js`, `web.js`; zkouška 12.
- **Zkoušky**: 595 testů jádra, 141 + 11 v Pythonu, 677 kontrol v prohlížeči (17 scénářů). Kód prošel nezávislou revizí dvou AI revizorů, nálezy jsou opravené (`docs/REVIZE_NEZAVISLA_2026-11-04.md`). Co z nich dokazuje a co ne:
  `docs/AKCEPTACNI_MATICE.md`. Zkoušky používají náhražky za Claude, `db`, sdílení obrazovky a hlas; **nic z toho nebylo vyzkoušeno proti
  skutečné službě ani skutečnému FM27**.
- Kód z Cursoru (Wave 76) v repozitáři nikdy nebyl; `trener/` je nová implementace. Kdyby se našel, porovná se (ne přepíše).

## Co udělat jako první, když se na tom pracuje dál

1. Přečíst `docs/AKCEPTACNI_MATICE.md` (část 1 a 3) a `trener/README.md` (část „Co je ověřeno a co ne“).
2. Spustit zkoušky (`trener/README.md`, část „Sestavení a zkoušky“). Po změně zdrojů vždy `node trener/build.mjs`.
3. Publikace stránky v Claude: `Artifact` s `file_path=trener/dist/trener.fragment.html` a `url=https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh`
   (nejdřív `read`), capabilities `sample` (s obrázky), `downloads`, `db`, `user`, `mcp` (`{servers: [{server: 'Parallel Search', tools: ['web_search']}]}`).
4. Pokud majitel pošle skutečné vzorky (níže), nejdřív s nimi změřit čtení screenshotů a dekódování `.fmf`, ne psát další funkce.

## Co potřebuju od majitele (a kde to udělat)

1. **Vyzkoušet stránku v Claude** na počítači i telefonu pod stejným účtem: https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh
   a přidat aspoň jednu skutečnou knihu (sekce „Zdroje znalostí“).
2. **GitHub Pages** (hotovo 5. 11. 2026): majitel zapnul Source = GitHub Actions, nasazení prošlo a od teď se spouští samo po každém pushi
   aplikace (`.github/workflows/pages.yml`; ručně jde „Run workflow“ až na stránce konkrétního workflow:
   https://github.com/janvasilecko-droid/FM27-apka/actions/workflows/pages.yml, ne v přehledu „All workflows“).
   **Pozor na adresu:** aplikace běží na `https://janvasilecko-droid.github.io/FM27-apka/`. Úložiště prohlížeče (klíč AI, kariéry,
   knihy) tam sdílí původ se všemi dalšími stránkami na `janvasilecko-droid.github.io`; skript z jiné takové stránky by je mohl číst.
   Proto aplikace na `github.io` klíč výchozně nepamatuje (jen do zavření záložky) a varuje. Bezpečnější je vlastní adresa
   (Settings → Pages → Custom domain), nebo klíč nezadávat a aplikaci používat jen se stránkou v Claude.
3. **Skutečné vzorky z FM27**: tři exporty `.fmf` s předem známým nastavením (`docs/REVIZE_CLAUDE_2026-11-04.md`, část 2) a 3 až 5
   screenshotů (zápas, statistiky, taktika) s tím, co na nich vidí. Bez nich nejde změřit čtení obrazovky ani dekódovat taktiku.
3a. **Otevřít Nastavení na stránce v Claude** a poslat řádek „Sdílení obrazovky v tomto okně“ (ano/ne a proč): rozhodne, jestli živé čtení obrazovky
   půjde na předplatném bez klíče: https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh
3b. **Připojit konektor „Parallel Search“** (jen pro hledání zdrojů na stránce v Claude): https://claude.ai/settings/connectors . Potom
   stránku obnovit, v „Zdroje znalostí“ kliknout na „Najít zdroje“ a potvrdit souhlas. V Nastavení je „Zkušební hledání“, které ukáže
   skutečný výsledek (a při nečitelné odpovědi její začátek, ať jde čtení opravit).
4. **Vlastní klíč AI** pro samostatnou verzi (volitelné): https://console.anthropic.com/settings/keys, vložit **jen do Nastavení
   v aplikaci**, nikdy do chatu. Doporučen samostatný klíč pro aplikaci s měsíčním limitem.
5. **Zkouška Live Coache na Windows**: samostatná verze v Chrome nebo Edge, sdílet okno FM27, okno aplikace nechat viditelné vedle hry
   (skryté okno prohlížeč zpomaluje; aplikace na to upozorní).

## Neumí / záměrně není

Klient pro Windows (Tauri) a server s PostgreSQL ze zadání § 1 (nahrazeno webovou aplikací), pole taktiky v `.fmf` (nejsou známá),
oznámení na zavřený telefon, překryvné okno nad hrou, OCR skenů, čtení celých webových stránek (`web_fetch`; hledání na webu vrací jen výtahy),
ověření OpenAI-kompatibilního rozhraní proti živé službě. Hledání na webu v Live Coachi záměrně není (zápas nečeká).
Seznam s důvody: `docs/AKCEPTACNI_MATICE.md`, část 3.

## Možná další rozhodnutí (až majitel stránku vyzkouší)

- **Načtení dat z běžící hry jako Real Time Editor** (majitel to chce: taktika, hráči a jejich údaje, finance; 5. 11. 2026). Z prohlížeče ani ze stránky
  v Claude to technicky nejde (čtení paměti umí jen program pro Windows a je vázané na build hry). **Výzkum je v `docs/NACITANI_DAT_ZE_HRY.md`**: editory
  čtoucí paměť FM27 už existují (GPL-3.0, beta), ale **taktiku z paměti nečte žádný**; taktika se čte ze souboru (`.fmf`: `fm-ai-assistent` bez licence;
  uložená hra: `fmsave` MIT, syrová čísla). Hotovo: **čtení taktiky z obrazovky hry**, tlačítko „Načíst z okna hry“ (jeden snímek) u taktiky, soupisky a soupeře,
  šedé tlačítko „Načíst“ nahoře. Možné další kroky podle rozhodnutí majitele: (1) „Načíst uloženou hru“ přes `fmsave` v prohlížeči (samostatná verze;
  hráči, finance, zápasy, další soupeř; taktika syrově); (2) taktika ze souboru `.fmf` (svolení autora `fm-ai-assistent`, nebo vlastní rozbor souborů od
  majitele); (3) načítání CSV/JSON z hotových nástrojů: **hotovo pro hráče** (karta „Načíst hráče z exportu“ v Můj tým: CSV, TSV, HTML, JSON, výstup `fmsave`; skryté
  údaje hry se nenačítají; ověřeno jen na vlastních ukázkách, skutečný export cizího nástroje čeká na majitele), taktika a finance z exportu zatím ne;
  (4) karta Finance (ručně nebo ze snímku). Vlastní čtečku paměti nestavíme.
- **Předplatné místo kreditů:** samostatná verze potřebuje klíč API (platí se zvlášť, viz
  https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan); stránka v Claude jede na
  předplatném bez klíče. Aby šlo živé čtení i tam, aplikace zjišťuje, jestli okno claude.ai povolí sdílení obrazovky (Nastavení → „Sdílení obrazovky
  v tomto okně“). Čeká na výsledek od majitele.

- **Má rada v Live Coachi chodit i sama** (například při vážném upozornění)? Dnes přichází na tlačítko „Poradit, co změnit“; upozornění z čísel
  jsou automatická. Samočinná rada by stála víc volání a hrozí slabě podložená rada, proto je to rozhodnutí majitele.
- Číst celé stránky z webu (`web_fetch` v Parallel Search), až se ukáže skutečný tvar odpovědi konektoru.

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
