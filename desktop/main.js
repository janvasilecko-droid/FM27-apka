/* FM27 Trenér pro Windows: desktopový obal (Electron) kolem samostatné verze aplikace (trener/dist/standalone, kopie je v desktop/app).
   Co obal přidává proti webu: (1) okno Football Manageru si najde samo, takže „Načíst z okna hry“ nechce při každém snímku výběr okna;
   (2) odkazy otevírá v prohlížeči, drží jedinou instanci a pamatuje si velikost okna; (3) volání pluginu FMMatchLens na tomto počítači neblokuje CORS.
   Co obal NEdělá: nečte paměť ani soubory hry, nic do hry nezapisuje, nic neposílá na žádný server kromě volání AI, které si nastavíš v aplikaci.
   Snímek okna se vezme jen po kliknutí v aplikaci („Načíst z okna hry“, spuštění Live Coache) a jen z okna hry; vlastní okno aplikace se nikdy nesnímá. */
'use strict';

const { app, BrowserWindow, Menu, dialog, desktopCapturer, session, shell, protocol, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pickGameWindow, labelOf } = require('./src/windowpick.js');

const SCHEME = 'fm27app';
const HOST = 'app';
const ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = path.join(__dirname, 'app');
const TITLE = 'FM27 Trenér';
const RELEASES = 'https://github.com/janvasilecko-droid/FM27-apka/releases/latest';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
// oprávnění, která stránka aplikace smí dostat (jen ze svého původu): mikrofon pro hlasový vstup, upozornění, celá obrazovka, schránka (zápis)
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let mainWindow = null;

// ---------------------------------------------------------------- protokol a soubory
function logFile() {
  return path.join(app.getPath('userData'), 'logs', 'main.log');
}
function log(...parts) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack || p.message : String(p))).join(' ')}\n`);
  } catch (e) {
    /* protokol se nepodařilo zapsat: aplikace jede dál */
  }
}

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== HOST) return new Response('Nenalezeno', { status: 404 });
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return new Response('Zakázáno', { status: 403 });
      const body = await fs.promises.readFile(file);
      return new Response(body, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch (e) {
      return new Response('Nenalezeno', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------- nastavení a stav okna
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}
const settingsFile = () => path.join(app.getPath('userData'), 'desktop-settings.json');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

/** Nastavení obalu (soubor desktop-settings.json ve složce s daty): `gameWindowPattern` je text nebo seznam textů, které se hledají v názvu okna hry. */
function loadSettings() {
  const s = readJson(settingsFile());
  return s && typeof s === 'object' ? s : {};
}

function loadWindowState() {
  const s = readJson(stateFile());
  const def = { width: 1280, height: 860 };
  if (!s || typeof s !== 'object') return def;
  const num = (v) => Number.isFinite(v) && Math.abs(v) < 20000;
  const out = { width: num(s.width) && s.width >= 900 ? Math.round(s.width) : def.width, height: num(s.height) && s.height >= 600 ? Math.round(s.height) : def.height, maximized: s.maximized === true };
  if (num(s.x) && num(s.y)) {
    // okno, které by po odpojení monitoru skončilo mimo obrazovku, se umístí znovu
    const visible = screen.getAllDisplays().some((d) => s.x < d.workArea.x + d.workArea.width - 80 && s.x + out.width > d.workArea.x + 80 && s.y >= d.workArea.y - 10 && s.y < d.workArea.y + d.workArea.height - 80);
    if (visible) {
      out.x = Math.round(s.x);
      out.y = Math.round(s.y);
    }
  }
  return out;
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }));
  } catch (e) {
    log('stav okna se nepodařilo uložit', e);
  }
}

// ---------------------------------------------------------------- snímání okna hry
/** Nabídka oken, když okno hry není jisté (nenalezeno, nebo jich je víc): vrací zvolený zdroj, nebo null (zrušeno). */
function chooseSource(parent, matches, others, screens, headline) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    const item = (w) => ({ label: labelOf(w), click: () => finish(w.source) });
    const template = [{ label: headline, enabled: false }, { type: 'separator' }, ...matches.map(item), ...(matches.length && others.length ? [{ type: 'separator' }] : []), ...others.slice(0, 25).map(item)];
    if (screens.length) template.push({ type: 'separator' }, { label: 'Celá hlavní obrazovka', click: () => finish(screens[0]) });
    template.push({ type: 'separator' }, { label: 'Zrušit', click: () => finish(null) });
    // zavření nabídky bez volby je zrušení; klik se zpracuje o chvilku později než zavření, proto krátké zpoždění
    Menu.buildFromTemplate(template).popup({ window: parent && !parent.isDestroyed() ? parent : undefined, callback: () => setTimeout(() => finish(null), 150) });
  });
}

function installDisplayMediaHandler(ses) {
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const settings = loadSettings();
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
        const own = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : null;
        const patterns = settings.gameWindowPattern;
        const pick = pickGameWindow(sources, { patterns, excludeIds: own ? [own] : [], ownTitles: [TITLE, 'FM27 Tactical Coach'] });
        if (pick.source) {
          log('snímek okna:', pick.source.name);
          return callback({ video: pick.source });
        }
        const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        const headline = pick.matches.length > 1 ? 'Oken hry je víc. Vyber to správné:' : 'Okno hry jsem nenašel (název okna musí obsahovat „Football Manager“). Vyber okno:';
        const chosen = await chooseSource(mainWindow, pick.matches, pick.others, screens, headline);
        log('okno hry vybráno ručně:', chosen ? chosen.name : 'zrušeno');
        return callback(chosen ? { video: chosen } : null); // null = výslovné odmítnutí: stránka dostane „NotAllowedError“ a aplikace řekne, že sdílení nebylo povoleno
      } catch (e) {
        log('snímání okna selhalo', e);
        return callback(null);
      }
    },
    { useSystemPicker: false }
  );
}

// ---------------------------------------------------------------- relace: oprávnění a plugin FMMatchLens
function installSession(ses) {
  const own = (url) => typeof url === 'string' && url.startsWith(`${ORIGIN}/`);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(ALLOWED_PERMISSIONS.has(permission) && own(details && details.requestingUrl ? details.requestingUrl : wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && own(`${origin}/`));
  installDisplayMediaHandler(ses);
  // Plugin FMMatchLens odpovídá na 127.0.0.1:16726 bez hlaviček CORS (neověřeno na skutečném pluginu): jen odpovědím z tohoto jednoho místa se přidá povolení pro stránku aplikace.
  ses.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1:16726/*', 'http://localhost:16726/*'] }, (details, cb) => {
    const headers = Object.assign({}, details.responseHeaders);
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('access-control-allow-')) delete headers[k];
    headers['Access-Control-Allow-Origin'] = [ORIGIN];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: headers });
  });
}

// ---------------------------------------------------------------- okno a nabídka
function openExternal(url) {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
}

function createWindow() {
  const st = loadWindowState();
  const win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: TITLE,
    backgroundColor: '#0b1118',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, additionalArguments: [`--fm27-version=${app.getVersion()}`] },
  });
  mainWindow = win;
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      e.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on('render-process-gone', (e, details) => {
    log('proces stránky skončil:', details && details.reason);
    if (details && details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // titulek okna zůstává „FM27 Trenér“ (podle něj se vlastní okno při výběru okna hry vynechá)
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

function buildMenu() {
  const about = () =>
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'O aplikaci',
      message: `${TITLE} ${app.getVersion()}`,
      detail: `Desktopová aplikace pro Windows (Electron ${process.versions.electron}, Chromium ${process.versions.chrome}).\nOkno hry se snímá jen po kliknutí v aplikaci. Paměť ani soubory hry aplikace nečte.\nData jsou ve složce: ${app.getPath('userData')}`,
    });
  const template = [
    { label: 'Soubor', submenu: [{ role: 'quit', label: 'Ukončit' }] },
    {
      label: 'Zobrazit',
      submenu: [
        { role: 'reload', label: 'Znovu načíst' },
        { role: 'togglefullscreen', label: 'Celá obrazovka' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Přiblížit' },
        { role: 'zoomOut', label: 'Oddálit' },
        { role: 'resetZoom', label: 'Původní velikost' },
      ],
    },
    {
      label: 'Nápověda',
      submenu: [
        { label: 'O aplikaci…', click: about },
        { label: 'Nová verze (stránka ke stažení)', click: () => openExternal(RELEASES) },
        { type: 'separator' },
        { label: 'Složka s daty a nastavením', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Složka s protokolem', click: () => shell.openPath(path.dirname(logFile())) },
        { label: 'Nástroje pro vývojáře', accelerator: 'CommandOrControl+Shift+I', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- spuštění
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  process.on('uncaughtException', (e) => log('neošetřená výjimka', e));
  app.setAppUserModelId('cz.fm27.trener');
  app.whenReady().then(() => {
    registerAppProtocol();
    installSession(session.defaultSession);
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
