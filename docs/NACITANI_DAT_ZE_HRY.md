# Načítání dat ze hry (výzkum a rozhodnutí, 5. 11. 2026)

Majitel chce „šedé tlačítko Načíst jako v Real Time Editoru“: aplikace si sama načte z běžící hry taktiku, hráče a údaje o nich, finance
a podle toho radí. Tenhle dokument říká, co existuje, co z toho jde použít a co aplikace dělá a nedělá. Všechny údaje o cizích projektech
jsem přečetl z jejich README, stránek vydání a částí zdrojových kódů na GitHubu k 5. 11. 2026. **Nic z toho jsem nezkoušel na běžící hře.**
Projekty jsou staré dny až týdny, většinou beta a bez zkušeností komunity.

## Co existuje (GitHub, téma `football-manager-2027` a okolí)

| Projekt | Jak čte data | Co čte | Licence | Pro nás |
|---|---|---|---|---|
| [barak14/fm-editor](https://github.com/barak14/fm-editor) | paměť běžící hry (Windows, Linux) | hráči, štáb, kluby, finance klubu; zapisuje | GPL-3.0 | taktiku nečte; bez exportu |
| [tozmoz/FMLibreEditor](https://github.com/tozmoz/FMLibreEditor) | paměť (Windows, macOS; Steam, Game Pass) | hráči, štáb, kluby a finance; **export seznamu hráčů do CSV nebo JSON**; zapisuje | GPL-3.0 | taktiku nečte; export hráčů použitelný |
| [Jackhamerp24/Football-Manager-27-Editor](https://github.com/Jackhamerp24/Football-Manager-27-Editor) | paměť (jen dva buildy FM27) | hráči, štáb, kluby, finance; příkazová řádka a export CSV/JSON; zapisuje | GPL-3.0 | taktiky jsou jen v plánu |
| [SiRRAHx/fm27-live-editor](https://github.com/SiRRAHx/fm27-live-editor) | paměť (Windows, Game Pass) | hráči, smlouvy, finance, hostování | **žádná** | bez exportu, bez licence |
| [mavarobli/FMSuperScout](https://github.com/mavarobli/FMSuperScout) | paměť, jen čtení (klávesa F9) | hráči a štáb včetně skrytých údajů, „váš klub“; místní webová aplikace, CSV shortlistu | MIT | taktiku ani finance nečte |
| [rhiever/fmsave](https://github.com/rhiever/fmsave) | **uložená hra `.fm` ze souboru**, jen čtení, bez paměti | hráči a všechny atributy, kluby, finance (měsíční řádky), zápasy, tabulky; u klubu uživatele **taktiky** (syrová čísla s nepotvrzeným významem), sestavy, tréninky; Python, CLI, CSV/JSON; **webová aplikace čte save přímo v prohlížeči** | MIT | nejlepší cesta k datům ze savu |
| [YanivGabay/fm-open-scout](https://github.com/YanivGabay/fm-open-scout) | uložená hra (parser v Rustu), MCP server | hráči (54 atributů), soupisky | MIT | jen hráči |
| [Napas/fm-mcp](https://github.com/Napas/fm-mcp) | uložená hra, MCP server v Go | **taktika (mentalita, role na pozicích v obou fázích)**, poslední sestava, zápasy, tabulka, finance (zůstatek a rozpočty), soupiska | **žádná** | kód přebírat nelze |
| [ElectroHugin/FM-View-Exporter](https://github.com/ElectroHugin/FM-View-Exporter) | zásuvný modul BepInEx čte obrazovku (klávesa F9) | seznam hráčů na obrazovce do CSV a HTML (všechny sloupce pohledu) | GPL-3.0 | jen seznamy hráčů; Steam, Windows |
| [JelmerBouma1985/fm-ai-assistent](https://github.com/JelmerBouma1985/fm-ai-assistent) | paměť běžící hry + soubor `.fmf` s taktikou | hráči, finance (příjmy, výdaje), program a další soupeř; **taktika ze souboru `.fmf`**; AI přes OpenRouter nebo příkazový nástroj; MCP server | **žádná** | nejpodobnější našemu záměru |
| [nonorigon-design/fm27-adjoint](https://github.com/nonorigon-design/fm27-adjoint) | snímky obrazovky (bez paměti), francouzsky | taktika, hráči, předzápasový rozbor, živý režim | **žádná** | podobné čtení obrazovky |
| [FM-Prism/fm-prism-plugin](https://github.com/FM-Prism/fm-prism-plugin) | zásuvný modul | nahrává data na web fmprism.com | **vlastnická** | nelze |

Ostatní nalezené projekty (grafika, překlady, skautské nástroje na jednom savu) k tématu nic nepřidávají.

## Hlavní zjištění

1. **Taktiku z paměti běžící hry nečte žádný nalezený nástroj.** Editory čtou hráče, štáb a finance klubu. Taktiku čtou jen ze **souboru**:
   z uložené hry (`fmsave`, `fm-mcp`) nebo ze souboru `.fmf` (`fm-ai-assistent`).
2. **Soubor `.fmf` s taktikou je archiv, jehož zdroj taktiky je „zašifrovaný“ klíčem, který je přímo v souboru** (AES v režimu CTR, potom zstd). Obsah
   se dekóduje tabulkou kódů (mentalita, instrukce, role), kterou autor `fm-ai-assistent` zjistil ze skutečných souborů. **Jeho kód nemá licenci,
   takže ho přebírat nesmíme**; formát lze ale odvodit vlastním rozborem skutečných souborů.
3. **Uložená hra jde číst bez paměti hry.** `fmsave` (MIT) to umí a jeho webová aplikace (https://rhiever.github.io/fmsave/app/) čte save přímo
   v prohlížeči, bez instalace a bez nahrávání. Podporuje FM27 jen pro jeden build (`27.0.0+2486695`), ostatní buildy jako „neověřené“.
4. Čtení paměti je **u každého projektu vázané na konkrétní build hry** a ověřené jen částečně (u `barak14/fm-editor` je FM27 „in progress“).
   Všechny editory do hry i zapisují, mají varování o zálohování a mají nepodepsané instalátory.

## Co aplikace dělá teď

- **Čte obrazovku hry** (snímek vložený ručně, nebo jedním kliknutím z okna hry, kde to stránka smí): soupiska, soupeř, statistiky zápasu a
  **taktika** (formace, mentalita, instrukce, role přesně tak, jak je hra píše). Všechno přečtené je návrh k potvrzení; názvy hry se nepřekládají
  ani nedoplňují; role se přiřadí jen k jednoznačné pozici (jinak skončí v poznámce); neznámá formace se nikdy nenahradí jinou.
- Šedé tlačítko „Načíst“ nahoře ukáže, co jde načíst, a vede na příslušnou obrazovku.
- **Nečte paměť hry ani její soubory** a nic do nich nezapisuje.

## Možné další kroky (rozhodnutí majitele)

1. **Načíst uloženou hru přes `fmsave` v prohlížeči** (samostatná verze): hráči a atributy, finance, zápasy, další soupeř a jeho soupiska,
   taktika jako syrová čísla. Je to čtení souboru, ne paměti. Nevýhody: aktuální stav je jen tak čerstvý, jak je poslední uložení hry; FM27 podporuje
   `fmsave` zatím jen pro jeden build; významy polí taktiky jsou nepotvrzené, takže taktika by dál šla spolehlivě číst jen z obrazovky; stahuje
   Pyodide a balíček z PyPI (v artefaktu v Claude to prohlížeč neumožní). Odhad práce: střední, nejde ověřit bez skutečného savu.
2. **Taktika ze souboru `.fmf`**: bude to chtít buď svolení autora `fm-ai-assistent` k použití jeho dekodéru (na GitHubu mu stačí napsat, ať přidá licenci),
   nebo vlastní rozbor několika `.fmf` souborů s předem známým nastavením od majitele.
3. **Použít hotový nástroj vedle** (třeba `fm-ai-assistent`, `FMLibreEditor`) a jeho CSV/JSON načítat v naší aplikaci: potřebuje ukázky skutečných souborů;
   nástroje jsou nové, nepodepsané a čtou paměť hry: na vlastní riziko, jen offline hra.
4. **Vlastní program pro Windows na čtení paměti FM27**: nedoporučuji. Nikdo zatím nečte taktiku z paměti, struktury se musí zjistit na běžící hře
   s ladicím nástrojem, to z cloudu nejde; chyba může spadnout hru; licenční podmínky hry je třeba ověřit.
5. **Karta Finance** (ručně nebo ze snímku obrazovky): aplikace zatím finance nezná.

## Co by se muselo ověřit u majitele

Všechno výše o cizích projektech je z jejich README. U majitele je potřeba ověřit: že čtení taktiky z obrazovky funguje na skutečném FM27 (jazyk hry,
rozložení), že okno claude.ai sdílení obrazovky povolí (řádek v Nastavení), a případně jak dopadne `fmsave` na jeho savu.
