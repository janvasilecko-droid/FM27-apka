/* Zkouška desktopového obalu v Electronu (Linux, virtuální displej): spouští se ručně, ne v `node --test`.
   Potřebuje: Playwright (require('playwright'), například NODE_PATH=$(npm root -g)), xvfb-run a malý správce oken (openbox), aby desktopCapturer okna vůbec vypsal.
   Spuštění z kořene repozitáře:
     node desktop/prepare.mjs
     xvfb-run -a -s "-screen 0 1280x900x24" sh -c 'openbox >/dev/null 2>&1 & sleep 1.5; node desktop/test/smoke.cjs'
   Co se zkouší: aplikace naběhne z vlastního protokolu bez chyb, stránka dostane jen příznak desktopu, „Načíst z okna hry“ najde okno Football Manageru samo a nasnímá
   právě ho (ne vlastní okno, ne jiné okno, ne celou obrazovku), vzor z nastavení přepíše výchozí, odkazy jdou do prohlížeče, stav okna se uloží a druhá instance se nespustí. */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const desktop = path.join(__dirname, '..');
// FM27_ENTRY: místo složky desktop/ spustí balíček (soubor app.asar z rozbaleného instalátoru): ověří, že aplikace jede i z archivu
const entry = process.env.FM27_ENTRY || desktop;
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'OK    ' : 'CHYBA '} ${name}${ok ? '' : detail === undefined ? '' : ` → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Okno s jednobarevným obsahem a daným názvem v hlavním procesu aplikace; vrací id okna. */
async function openFake(app, title, color) {
  return app.evaluate(
    async ({ BrowserWindow }, a) => {
      const w = new BrowserWindow({ width: 420, height: 320, title: a.title, show: true, webPreferences: { sandbox: true } });
      w.on('page-title-updated', (e) => e.preventDefault());
      const html = `<title>${a.title}</title><body style="margin:0;background:${a.color}"><div style="height:100vh"></div></body>`;
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`); // celý obsah kódovaný: „#“ v barvě by jinak ukončil adresu`;
      await new Promise((r) => setTimeout(r, 300));
      return w.id;
    },
    { title, color }
  );
}
async function closeFake(app, id) {
  await app.evaluate(({ BrowserWindow }, wid) => { const w = BrowserWindow.fromId(wid); if (w) w.destroy(); }, id);
}
/** Jeden snímek přes getDisplayMedia ze stránky aplikace (s uživatelským gestem); vrací barvu prostředního bodu. */
async function grabCenterColor(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'FM27 Trenér').webContents;
    const code = `(async () => { try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 2, max: 5 } }, audio: false });
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream; video.play().catch(() => {});
      const end = Date.now() + 5000; while (!video.videoWidth && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0);
      const px = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      stream.getTracks().forEach((t) => t.stop());
      return { w: c.width, h: c.height, rgb: [px[0], px[1], px[2]] };
    } catch (e) { return { error: e.name + ': ' + e.message }; } })()`;
    try { return await wc.executeJavaScript(code, true); } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
  });
}
const near = (rgb, want) => rgb && rgb.every((v, i) => Math.abs(v - want[i]) < 40);

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fm27-desktop-'));
  const launch = () => electron.launch({ executablePath: require(path.join(desktop, 'node_modules', 'electron')), args: [entry, '--no-sandbox', `--user-data-dir=${userData}`], cwd: desktop });
  let app = await launch();
  const problems = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) problems.push('console: ' + m.text()); });
  await page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 30000 });

  // ---------- stránka
  check('aplikace běží z vlastního protokolu fm27app://app', (await page.evaluate(() => location.origin)) === 'fm27app://app');
  const d = await page.evaluate(() => window.fm27desktop);
  check('stránka dostane příznak desktopu, verzi a platformu (a nic víc)', d && d.isDesktop === true && /^\d+\.\d+\.\d+$/.test(d.version) && Object.keys(d).sort().join() === 'electron,isDesktop,noSpeechRecognition,platform,version', d);
  check('stránka nemá přístup k Node.js ani k Electronu', await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined' && typeof window.electron === 'undefined'));
  check('aplikace se rozpozná jako samostatná verze', await page.evaluate(() => window.FM27.app.standalone === true));
  check('sdílení obrazovky je v aplikaci dostupné (tlačítko „Načíst z okna hry“ se nabídne)', await page.evaluate(() => window.FM27.live.captureAvailable() === true));
  check('titulek okna je „FM27 Trenér“ i po načtení stránky s jiným titulkem', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())) === 'FM27 Trenér');

  // ---------- snímání okna hry
  // název okna hry je ověřený na počítači majitele: „Football Manager 27“; vedle hry běží okno jiného nástroje s názvem „FMTOOL 27…“, které se nesmí vybrat
  const fm = await openFake(app, 'Football Manager 27', '#00a000');
  const decoy = await openFake(app, 'Poznámkový blok', '#c00000');
  const tool = await openFake(app, 'FMTOOL 27.0.0-build6', '#e0c000');
  await pause(1200);
  const c1 = await grabCenterColor(app);
  check('„Načíst z okna hry“ najde okno „Football Manager 27“ samo a nasnímá právě ho (zelené), ne jiné okno, ne okno nástroje „FMTOOL 27…“ (žluté) a ne celou obrazovku', c1.rgb && near(c1.rgb, [0, 160, 0]), c1);
  await closeFake(app, fm);
  await closeFake(app, decoy);
  await closeFake(app, tool);

  // vzor z nastavení přepíše výchozí
  fs.writeFileSync(path.join(userData, 'desktop-settings.json'), JSON.stringify({ gameWindowPattern: 'moje hra' }));
  const fm2 = await openFake(app, 'Football Manager 27', '#00a000');
  const mine = await openFake(app, 'Moje hra – okno', '#0000c0');
  await pause(1200);
  const c2 = await grabCenterColor(app);
  check('vzor „moje hra“ z nastavení vyhrává nad výchozím „Football Manager“ (nasnímá se modré okno)', c2.rgb && near(c2.rgb, [0, 0, 192]), c2);
  await closeFake(app, fm2);
  await closeFake(app, mine);
  fs.rmSync(path.join(userData, 'desktop-settings.json'));

  // okno hry není (ani vlastní vzor ho nenajde): aplikace nabídne seznam oken; výběr z nabídky se nasnímá, zrušení nesnímá nic
  const redWin = await openFake(app, 'Poznámkový blok', '#c00000');
  const blueWin = await openFake(app, 'Něco jiného', '#0000c0');
  await pause(1200);
  await app.evaluate(({ Menu }) => {
    global.__build = Menu.buildFromTemplate;
    Menu.buildFromTemplate = (tpl) => ({
      popup: (o) => {
        global.__menu = tpl.map((i) => i.label || '---');
        const pick = global.__pickLabel ? tpl.find((i) => i.label === global.__pickLabel) : null;
        setTimeout(() => { if (pick) pick.click(); o.callback(); }, 50);
      },
    });
    global.__pickLabel = 'Poznámkový blok';
  });
  const c3 = await grabCenterColor(app);
  const menu = await app.evaluate(() => global.__menu);
  check('bez okna hry se nabídne seznam oken (první řádek říká proč) a vybrané okno se nasnímá (červené)', /^Okno hry jsem nenašel/.test(menu[0]) && menu.includes('Poznámkový blok') && menu.includes('Něco jiného') && menu.includes('Celá hlavní obrazovka') && menu.includes('Zrušit') && c3.rgb && near(c3.rgb, [192, 0, 0]), { menu, c3 });
  check('v nabídce oken není vlastní okno aplikace', !menu.some((l) => /FM27 Trenér|FM27 Tactical Coach/.test(l)), menu);
  await app.evaluate(() => { global.__pickLabel = null; });
  const c4 = await grabCenterColor(app);
  check('zavření nabídky bez volby je zrušení: nic se nenasnímá a stránka dostane odmítnutí (v Chromiu AbortError nebo NotAllowedError)', !!c4.error && /AbortError|NotAllowedError/.test(c4.error), c4);
  await app.evaluate(({ Menu }) => { Menu.buildFromTemplate = global.__build; });
  await closeFake(app, redWin);
  await closeFake(app, blueWin);

  // ---------- odkazy a navigace
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = (u) => { global.__opened.push(u); return Promise.resolve(); }; });
  await page.evaluate(() => { window.open('https://example.com/a', '_blank'); });
  await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.com/b'; a.target = '_blank'; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); });
  await pause(300);
  await page.evaluate(() => { location.href = 'https://example.com/c'; }).catch(() => {});
  await pause(500);
  const opened = await app.evaluate(() => global.__opened);
  check('odkazy ven (window.open, odkaz s target=_blank, přesměrování stránky) se otevřou v prohlížeči, ne v okně aplikace', ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'].every((u) => opened.includes(u)), opened);
  check('okno aplikace zůstalo na aplikaci', (await page.evaluate(() => location.origin)) === 'fm27app://app');
  await app.evaluate(({ shell }) => { shell.openExternal = () => Promise.resolve(); });

  // ---------- soubory a oprávnění
  const traversal = await page.evaluate(async () => { try { const r = await fetch('fm27app://app/..%2f..%2fmain.js'); return r.status; } catch (e) { return 'chyba'; } });
  check('protokol nevydá soubory mimo složku aplikace (cesta ../main.js)', traversal === 404 || traversal === 403 || traversal === 'chyba', traversal);
  // oprávnění: mikrofon (hlasový vstup) projde (v testu není zařízení, takže chyba je „nenalezeno“, ne „zakázáno“); nepovolená oprávnění (poloha) se odmítnou
  const mic = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'ok', (e) => e.name));
  check('mikrofon pro hlasový vstup je povolený (chyba jen „zařízení nenalezeno“, ne „zakázáno“)', mic === 'ok' || mic === 'NotFoundError', mic);
  const geo = await page.evaluate(() => new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('ok'), (e) => resolve(e.code), { timeout: 4000 })));
  check('poloha se stránce nepovolí (oprávnění mimo seznam se odmítají)', geo === 1, geo);

  // ---------- stav okna
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'FM27 Trenér'); w.setBounds({ x: 40, y: 30, width: 1050, height: 720 }); });
  await pause(300);
  check('žádné chyby stránky ani konzole', problems.length === 0, problems);
  await page.screenshot({ path: path.join(userData, 'okno-aplikace.png') });
  await app.close();
  const st = JSON.parse(fs.readFileSync(path.join(userData, 'window-state.json'), 'utf8'));
  check('velikost okna se při zavření uloží', st.width === 1050 && st.height === 720, st);

  // ---------- druhá instance
  app = await launch();
  const p2 = await app.firstWindow();
  await p2.waitForFunction(() => window.__trenerReady === true, null, { timeout: 30000 });
  const reopened = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'FM27 Trenér').getBounds());
  check('při dalším spuštění se obnoví uložená velikost okna', Math.abs(reopened.width - 1050) <= 20 && Math.abs(reopened.height - 720) <= 20, reopened);
  const second = spawnSync(require(path.join(desktop, 'node_modules', 'electron')), [entry, '--no-sandbox', `--user-data-dir=${userData}`], { cwd: desktop, timeout: 20000, env: process.env });
  check('druhá instance se nespustí (skončí hned s kódem 0) a první okno zůstane', second.status === 0 && (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) >= 1, { status: second.status, signal: second.signal });
  await app.close();

  const bad = results.filter((r) => !r).length;
  console.log(`\nShrnutí: ${results.length - bad} v pořádku, ${bad} chyb.  (snímek okna: ${path.join(userData, 'okno-aplikace.png')})`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('CHYBA zkoušky', e);
  process.exit(2);
});
