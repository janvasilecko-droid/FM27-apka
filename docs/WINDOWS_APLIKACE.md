# Aplikace pro Windows (instalační)

Na přání majitele (7. 11. 2026: „vytvoř aplikaci, která není webová, ale instalační na Windows“). Je to **stejná aplikace** jako samostatná verze na webu, zabalená do okna s instalátorem
(desktopový obal v Electronu, složka `desktop/`). Navíc proti webu:

- **Okno Football Manageru si najde sama.** Tlačítko „Načíst z okna hry“ (u taktiky, soupisky, soupeře, klubu i Live Coach) se v prohlížeči při každém snímku ptá na výběr okna.
  V aplikaci pro Windows se neptá: hledá okno, jehož název obsahuje „Football Manager“, a nasnímá právě ho. Najde-li víc oken, nebo žádné, ukáže seznam oken k výběru.
- Nepotřebuje prohlížeč, otevírá se z nabídky Start nebo z plochy, pamatuje si velikost okna a drží jedinou instanci.
- Odkazy ven otevírá v prohlížeči, okno aplikace zůstává na aplikaci.

Co se **nemění**: aplikace dál čte hru jen z obrazu okna (snímek po kliknutí), nečte paměť ani soubory hry, nic do hry nezapisuje a nic neposílá na žádný server kromě volání AI, které si
nastavíš (viz níže). Všechna pravidla poctivosti (štítky HRA, KOMUNITA, ODHAD, žádná skrytá data, nic se nehádá, vše přečtené je návrh k potvrzení) platí stejně.

## Stažení a instalace

1. Stáhni instalátor: https://github.com/janvasilecko-droid/FM27-apka/releases/latest/download/FM27-Trener-Setup.exe
   (všechna vydání: https://github.com/janvasilecko-droid/FM27-apka/releases; první vydání `desktop-v1.0.0` z 7. 11. 2026 má 121,6 MB, sestavil ho GitHub:
   https://github.com/janvasilecko-droid/FM27-apka/actions/runs/42395321606).
2. Spusť `FM27-Trener-Setup.exe`. Instaluje se **jen pro tebe, bez práv správce**, vznikne zástupce na ploše a v nabídce Start; po instalaci se aplikace sama otevře.
3. **Windows ukáže varování „Windows ochránil váš počítač“ (SmartScreen).** Instalátor není podepsaný: podpis kódu je placená služba a majitel ji zatím nemá. Klikni na **„Další informace“** a potom na
   **„Přesto spustit“**. Totéž může udělat antivirus; instalátor se sestavuje veřejně na GitHubu z kódu v tomto repozitáři (sestavení lze projít v záložce Actions).
4. Odinstalace: Nastavení Windows → Aplikace → FM27 Trenér. Data (kariéry, hráči, taktiky) zůstanou ve složce aplikace, dokud je nesmažeš (Nápověda → Složka s daty a nastavením).

## První spuštění

1. **Klíč AI.** Čtení obrazovky a Osobní trenér potřebují Claude se čtením obrázků. Aplikace mimo stránku v Claude nemůže použít předplatné z claude.ai, potřebuje **API klíč Anthropic**:
   vytvoř ho tady https://console.anthropic.com/settings/keys a vlož ho v aplikaci do Nastavení (část AI). Klíč se uloží jen na tomhle počítači, ve složce s daty aplikace, **bez šifrování**:
   kdo má přístup k tvému účtu ve Windows, má přístup i k němu (bezpečnější úložiště Windows je v plánu). Zvol klíč s nízkým měsíčním limitem a v Nastavení si můžeš vybrat, jestli se má
   „zapamatovat“, nebo platit jen do zavření aplikace. **Klíč nikdy nepiš do chatu.** Volání AI se účtuje podle spotřeby u Anthropic (ne přes předplatné). Rozbor sestavy a taktiky, příprava na zápas z již načtených údajů a ostatní výpočty AI nepotřebují.
2. **Football Manager v okně nebo v režimu bez okrajů.** Hra na celou obrazovku ve výhradním režimu se nedá nasnímat (snímek je černý). Aplikace to pozná („Okno hry je na snímku celé černé…“) a
   nic nehádá; v nastavení hry přepni zobrazení do okna nebo do režimu bez okrajů.

## Jak se načítá hra

1. Ve hře otevři obrazovku, kterou chceš načíst (Taktika, Sestava s atributy, Zpráva o soupeři…). Aplikace vidí jen to, co je právě na obrazovce, takže taktika, atributy hráčů a zpráva o soupeři
   jsou každá jeden snímek.
2. V aplikaci klikni na „Načíst z okna hry“ u příslušné sekce (nebo na šedé tlačítko „Načíst“ nahoře, které sekce vypíše). Aplikace okno hry najde, jednou ho nasnímá a hned přestane.
3. Přečtené se ukáže jako návrh; ty ho potvrdíš. Nic se nezapíše bez potvrzení.

Okno aplikace se při automatickém výběru ani v seznamu oken nesnímá (jedině volba „Celá hlavní obrazovka“ v seznamu by ho zachytila spolu s ostatními okny). Snímek se vezme jen po kliknutí v aplikaci (tlačítko „Načíst z okna hry“ nebo spuštění Live Coache); u Live Coache je vidět, že aplikace sleduje, a jde zastavit.

## Nastavení obalu a řešení potíží

- **Okno hry se nenašlo** (název okna neobsahuje „Football Manager“, například v jiném jazyce): aplikace ukáže seznam oken, vyber hru. Natrvalo jde vzor přepsat v souboru
  `desktop-settings.json` ve složce s daty (Nápověda → Složka s daty a nastavením), například `{ "gameWindowPattern": "Fotbalový manažer" }` (text nebo seznam textů, bez rozlišení velikosti písmen).
  Změna platí hned při dalším snímku. **Název okna hry v FM27 není ověřený** (předpoklad je „Football Manager 2027“), proto je záložní výběr oken.
- **Snímek je černý:** hra běží na celou obrazovku výhradním režimem, viz výše.
- **Nic se neděje po kliknutí na „Načíst z okna hry“:** podívej se do protokolu (Nápověda → Složka s protokolem, soubor `main.log`) a pošli mi jeho obsah, hesla ani klíče v něm nejsou.
- **Hlasový vstup (mikrofon) v aplikaci chybí:** rozpoznávání řeči z Chromia v Electronu nefunguje, proto se nenabízí. Hlasové čtení rad (výstup) funguje.
- **Plugin FMMatchLens** (živá data zápasu na 127.0.0.1:16726): aplikace pro Windows povolí stránce jen tuhle jednu adresu; **na skutečném pluginu to nikdo nezkoušel**.
- Nová verze: Nápověda → Nová verze (stránka ke stažení). Aplikace se sama neaktualizuje: stáhni a spusť nový instalátor, data zůstanou.

## Co je ověřeno a co ne

Ověřeno v tomto repozitáři (Linux, Electron 45 na virtuálním displeji, `desktop/test/smoke.cjs`, 20 kontrol): aplikace naběhne z vlastního protokolu bez chyb, stránka dostane jen příznak desktopu a verzi
(žádný přístup k Node.js), „Načíst z okna hry“ najde okno Football Manageru samo a nasnímá právě ho (ne jiné okno, ne vlastní okno, ne celou obrazovku), vzor z nastavení přepíše výchozí, bez okna hry se
nabídne seznam oken a zrušení nic nenasnímá, odkazy jdou do prohlížeče, protokol nevydá cizí soubory, mikrofon projde a poloha ne, velikost okna se pamatuje a druhá instance se nespustí.
Sestavení instalátoru na GitHubu (`windows-latest`) 7. 11. 2026 **prošlo** a vydání vzniklo; staženému `FM27-Trener-Setup.exe` jsem ověřil, že je to instalátor NSIS pro Windows, a z něj rozbalený archiv
`app.asar` (stejný kód, jaký poběží u tebe) jsem pustil v Electronu na Linuxu se stejnou zkouškou (`FM27_ENTRY=…/app.asar node desktop/test/smoke.cjs`): všech 20 kontrol prošlo.
Čistá logika výběru okna má 6 testů (`desktop/test/windowpick.test.mjs`), stránka v desktopovém režimu zkoušku 28 v prohlížeči. Balení aplikace (soubory v archivu, ikona, konfigurace instalátoru) se
ověřilo sestavením rozbalené aplikace pro Windows na Linuxu.

**Neověřeno** (z cloudu to nejde): **spuštění** instalátoru a aplikace na Windows (sestavení na `windows-latest` prošlo, ale nikdo ho na Windows nespustil; první skutečná zkouška je u majitele), chování SmartScreenu a antiviru,
**skutečný Football Manager 2027** (název okna, to, jak Windows nasnímá jeho okno, režim na celou obrazovku), čtení skutečných obrazovek hry a plugin FMMatchLens.

## Sestavení (pro vývojáře)

```bash
cd desktop
npm ci                    # závislosti (Electron 45, electron-builder 26)
npm start                 # sestaví samostatnou verzi do desktop/app a spustí aplikaci
npm run dist              # instalátor desktop/dist/FM27-Trener-Setup.exe (NSIS; sestavuje se na Windows)
node --test test/*.test.mjs
```

Zkouška obalu na Linuxu (virtuální displej a malý správce oken, aby `desktopCapturer` okna vypsal; potřebuje Playwright):

```bash
node desktop/prepare.mjs
xvfb-run -a -s "-screen 0 1280x900x24" sh -c 'openbox >/dev/null 2>&1 & sleep 1.5; node desktop/test/smoke.cjs'
```

**Vydání na GitHubu:** Actions → „Windows aplikace (instalátor)“ → Run workflow (název vydání například `desktop-v1.0.0`), nebo vložení značky `desktop-v*`. Workflow
`.github/workflows/desktop-windows.yml` na `windows-latest` spustí zkoušky výběru okna, `npm ci`, `npm run dist`, nahraje instalátor jako artefakt běhu a jako přílohu vydání.
Instalátor má stabilní název `FM27-Trener-Setup.exe`, takže odkaz `releases/latest/download/FM27-Trener-Setup.exe` vždy vede na poslední vydání.
Podepsání instalátoru (certifikát pro podpis kódu) by SmartScreen varování odstranilo; zatím se nepodepisuje.

## Co dál

Režim „Průchod hrou“ (sdílení se nespouští pokaždé: aplikace sleduje okno hry, pozná, jaká obrazovka je vidět, a načte ji sama), volání pluginu FMMatchLens přes hlavní proces a bezpečné uložení klíče AI
v úložišti Windows (DPAPI) místo úložiště stránky. Nic z toho není hotové.
