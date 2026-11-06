# Pokračování (stav 6. 11. 2026)

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
- **Vzhled** (5. 11. 2026, na přání majitele „udělej to modernější graficky, třeba ve stylu FM 27“): tmavý grafitově modrý podklad s limetkovým
  akcentem, zaoblené karty, levé menu s ikonami (na telefonu pruh nahoře), segmentové přepínače, zelené hřiště v laboratoři, světlý i tmavý vzhled.
  **Jen inspirace stylem Football Manageru: žádné logo, písmo ani obrázky hry.** Barvy jsou proměnné v `trener/src/styles.css`; kontrast písma
  v obou vzhledech hlídá `trener/test/styles.test.mjs` (a zkouška 11 na skutečných obrazovkách). Písmo Inter a Barlow se stahuje z Google Fonts
  (bez připojení nastoupí systémové písmo, nic se nerozbije).
- **Klub ze hry** (5. 11. 2026, na přání majitele „ten klub si má ta apka načíst z FM“): formulář kariéry má blok „Načíst klub ze hry“ (snímek obrazovky hry nebo okno hry
  přečte Claude, nebo klub poví plugin FMMatchLens při zápase). Je to jen návrh do políček; kariéra vznikne až po potvrzení a původ polí se ukládá. Paměť hry se nečte.
  **Neověřeno na skutečném FM27 ani se skutečným pluginem.** Kód: `trener/src/careerread.js`, `clubread.js`; zkouška 19.
- **Hráči a sestava** (5. 11. 2026, etapa 2 rozšíření podle zadání o šesti referenčních projektech: `docs/PLAN_ROZSIRENI.md`): vedle jednoduché vhodnosti na roli je **DWRS** (kategorie atributů, násobiče role, stupnice 0 až 100, brankář zvlášť), **správa vah** v Nastavení (přednastavení stylu hry s výpisem, co změnila, vlastní profily, porovnání, návrat k výchozímu odhadu), **sestava A + B** v Moje taktiky (zámky, vyřazení, zranění, náhrady s přesným dopadem, hloubka, dopad výpadku, rizika, „mimo sestavu“ s důvody) a **rozbor hráče** v Můj tým. **Kategorie atributů v DWRS jsou vlastní odhad aplikace (ESTIMATED), ne pravidlo FM27, a nikdy se nezkoušely proti skutečné hře.** Kód: `trener/src/dwrs.js`, `squadopt.js`, `screens/weights.js`, `screens/playeranalysis.js`; metodika M15 až M22; zkouška 20.
- **Přestupy** (5. 11. 2026, etapa 3 rozšíření): v **Můj tým** je karta **Přestupy**. Kandidát (cizí hráč) se zadá ručně, nebo se načte z tabulky (export z nástroje; **mapování sloupců potvrzuje uživatel**, nic se nehádá a skryté údaje se ignorují). Aplikace spočítá **přesný dopad příchodu, odchodu i výměny** na sestavu A + B (rozdíl dvou optimalizací, ne odhad), hledá kandidáty na celý tým i na jedno místo (věk, cena, mzda; neznámá cena se neskryje, jen se řekne, že je neznámá), ukáže potřeby týmu a podobné kandidáty (míra podobnosti je **vlastní model aplikace**), vede stav jednání s platností podle data, které zadá uživatel (datum hry se nečte), a ukládá **doporučení se skutečným výsledkem** (úspěšnost jen podle hodnocení uživatele). Cena a mzda jsou jen to, co je čitelné v zadání nebo tabulce, jinak „neznámá“; měny se nepřepočítávají. **Hodnocení hráčů vychází z DWRS (ESTIMATED: tabulky kategorií jsou odhad autora) nebo z jednoduchého váženého průměru (CUSTOM MODEL: heuristika aplikace); vždy se píše, z kterého modelu. Nezkoušelo se proti skutečnému FM27 ani proti exportům cizích nástrojů.** Kód: `trener/src/recruit.js`, `screens/recruit.js`; metodika M23 až M28; zkouška 22.
- **Soubory `.fmf`** (5. 11. 2026): majitel poslal tři skutečné exporty z FM27. Obecný postup (zdroj zašifrovaný klíčem přímo v souboru, AES-CTR, potom zstd) byl znám už z výzkumu cizích projektů (`docs/NACITANI_DAT_ZE_HRY.md`, `docs/AUDIT_ZDROJU_FM27_2026-11-05.md`); konkrétní tvar jsme ověřili vlastním rozborem tří exportů (AES-128-CTR s klíčem a IV přímo v záznamu, potom zstd, kontrolní součty XXH64; `docs/FORMAT_FMF.md`). Dekodér taktiky cizího projektu se nečetl (`docs/REFERENCE_ANALYSIS.md`); že se při rozboru `.fmf` nepoužila žádná jiná část cizího zdroje, z repozitáře doložit nejde. Aplikace kontejner umí přečíst: **Moje taktiky → Import → Export taktiky z FM27 (.fmf)** ukáže název, obrázek a výsledky kontrol. Přečte se i **stavba** taktiky uvnitř (bloky, položky, seznamy; každý bajt zařazen, zápis zpět dává stejné bajty). **Význam čísel (formace, role, instrukce) se zatím nepřebírá**: jeho rozbor běží a ověření potřebuje snímky obrazovky týchž taktik ze hry. **Rozbalení zstd je vlastní modul** `trener/src/zstd.js` (RFC 8878, bez knihovny třetí strany a **bez stahování z internetu**, takže čtení funguje i bez připojení; na stránce uvnitř Claude se to nezkoušelo, záleží na WebCrypto v jejím okně): má strop výstupu, bloku, okna a počtu bloků a rozpočty na jedno čtení souboru (20 000 bloků a 33 MiB výstupu, i za rámce, které selžou), odmítá vadné rámce a je zkoušený proti libzstd 1.5.7 na 2,4 milionu náhodně upravených rámců (semínka 1 až 200; z toho asi 12,7 % beze změny, tedy asi 2,09 milionu skutečně poškozených), na ručně sestavených rámcích a na třech skutečných exportech; od libzstd se liší v šesti změřených případech (`docs/REVIZE_FMF_2026-11-05.md`; `trener/README.md`, jak zkoušku pustit s Pythonem). Kód: `trener/src/fmfcontainer.js`, `fmfglue.js`, `fmftac.js`, `zstd.js`; zkouška 21.
- **Zkoušky**: 898 testů jádra, 143 + 11 v Pythonu, 908 kontrol v prohlížeči (22 scénářů; z toho 4 kontroly ve scénáři 21 jen se skutečnými exporty majitele, které v repozitáři nejsou, bez nich 904). Část zkoušek se přeskočí buď bez balíčků `zstandard` a `anthropic`, nebo bez skutečných exportů (2 testy jádra a oněch 4 kontrol). V CI běží jen testy jádra při nasazení (bez věštírny libzstd) a samostatné porovnání dekodéru zstd s libzstd (`zstd-oracle.yml`); Pythonové zkoušky a zkoušky v prohlížeči se pouštějí ručně. Kód prošel nezávislou revizí dvou AI revizorů, nálezy jsou opravené (`docs/REVIZE_NEZAVISLA_2026-11-04.md`); čtečka `.fmf` a dekodér zstd prošly ještě třemi koly revize modelů (`docs/REVIZE_FMF_2026-11-05.md`; opravy třetího kola prověřil už jen cílený průchod, ne další úplné kolo). Co z nich dokazuje a co ne:
  `docs/AKCEPTACNI_MATICE.md`. Zkoušky používají náhražky za Claude, `db`, sdílení obrazovky a hlas; **nic z toho nebylo vyzkoušeno proti
  skutečné službě ani skutečnému FM27**.
- Kód z Cursoru (Wave 76) v repozitáři nikdy nebyl; `trener/` je nová implementace. Kdyby se našel, porovná se (ne přepíše).

## Co udělat jako první, když se na tom pracuje dál

1. Přečíst `docs/AKCEPTACNI_MATICE.md` (část 1 a 3) a `trener/README.md` (část „Co je ověřeno a co ne“).
2. Spustit zkoušky (`trener/README.md`, část „Sestavení a zkoušky“). Po změně zdrojů vždy `node trener/build.mjs`.
3. Publikace stránky v Claude: `Artifact` s `file_path=trener/dist/trener.fragment.html` a `url=https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh`
   (nejdřív `read`), capabilities `sample` (s obrázky), `downloads`, `db`, `user`, `mcp` (`{servers: [{server: 'Parallel Search', tools: ['web_search']}]}`).
4. Pokud majitel pošle skutečné vzorky (níže), nejdřív s nimi změřit čtení screenshotů a dekódování `.fmf`, ne psát další funkce.
5. **Známé neopravené omezení CI:** GitHub při každém běhu workflow (`pages.yml`, `zstd-oracle.yml`) varuje, že akce `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, `actions/upload-pages-artifact@v3` (varování jmenuje `actions/upload-artifact@v4`, kterou tato akce volá) a `actions/deploy-pages@v4` míří na zastaralé Node.js 20 a že je runner nuceně spouští na Node.js 24. Běhy procházejí, ale spoléhají na toto přechodové chování runneru. Verze akcí se zatím nezměnily, protože novější hlavní verze nešlo ověřit; po přechodu na ně pustit obě workflow znovu a zkontrolovat, že varování zmizelo (`docs/ARCHITEKTURA_V2.md`, část 7).

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
3. **Skutečné vzorky z FM27**: tři exporty `.fmf` už jsou (5. 11. 2026). Zbývá **snímek obrazovky taktiky ze hry pro každý z těch tří souborů** (formace s rolemi a povinnostmi, všechny instrukce, mentalita)
   a 3 až 5 snímků zápasu a statistik s tím, co na nich vidí. Bez nich nejde ověřit význam čísel v `.fmf` ani změřit čtení obrazovky.
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

Klient pro Windows (Tauri) a server s PostgreSQL ze zadání § 1 (nahrazeno webovou aplikací), význam polí taktiky v `.fmf` (stavba je známá, význam čísel ne),
oznámení na zavřený telefon, překryvné okno nad hrou, OCR skenů, čtení celých webových stránek (`web_fetch`; hledání na webu vrací jen výtahy),
ověření OpenAI-kompatibilního rozhraní proti živé službě. Hledání na webu v Live Coachi záměrně není (zápas nečeká).
Seznam s důvody: `docs/AKCEPTACNI_MATICE.md`, část 3.

## Možná další rozhodnutí (až majitel stránku vyzkouší)

- **Načtení dat z běžící hry jako Real Time Editor** (majitel to chce: taktika, hráči a jejich údaje, finance; 5. 11. 2026). Z prohlížeče ani ze stránky
  v Claude to technicky nejde (čtení paměti umí jen program pro Windows a je vázané na build hry). **Výzkum je v `docs/NACITANI_DAT_ZE_HRY.md` a podrobný audit zdrojových kódů čtyř projektů s architekturou, licencemi a plánem etap v `docs/AUDIT_ZDROJU_FM27_2026-11-05.md`**: editory
  čtoucí paměť FM27 už existují (GPL-3.0, beta), ale **taktiku z paměti nečte žádný**; taktika se čte ze souboru (`.fmf`: `fm-ai-assistent` bez licence;
  uložená hra: `fmsave` MIT, syrová čísla). Hotovo: **čtení taktiky z obrazovky hry**, tlačítko „Načíst z okna hry“ (jeden snímek) u taktiky, soupisky a soupeře,
  šedé tlačítko „Načíst“ nahoře. Možné další kroky podle rozhodnutí majitele: (1) „Načíst uloženou hru“ přes `fmsave` v prohlížeči (samostatná verze;
  hráči, finance, zápasy, další soupeř; taktika syrově); (2) význam čísel v taktice ze souboru `.fmf` (kontejner i stavba jsou už přečtené vlastním rozborem, svolení autora cizího projektu už
  není potřeba; **čeká na snímky obrazovky týchž taktik ze hry**); (3) načítání CSV/JSON z hotových nástrojů: **hotovo pro hráče** (karta „Načíst hráče z exportu“ v Můj tým: CSV, TSV, HTML, JSON, výstup `fmsave`; skryté
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
- Soubor `fm27-tac-payload.bin` v repozitáři **není** (binární obsah z osobního exportu; stačí popis v revizi). Ten obsah už není neznámý: je to výřez souboru `.fmf` od bajtu 221 do 966, tedy o 26 bajtů dřív a o 26 bajtů kratší než skutečný záznam (`docs/FORMAT_FMF.md`, část „Záznam jednoho zdroje“).
- Vysoká jistota v radě je záměrně těžká na splnění (dva ověřené screenshoty). Je to záměr, ne chyba.
