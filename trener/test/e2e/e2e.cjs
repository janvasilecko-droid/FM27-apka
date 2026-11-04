/* Zkouška stránky v prohlížeči (Playwright + Chromium) s předstíraným Claude.

   Co se zkouší doopravdy: celá stránka, IndexedDB, čtení PDF přes pdf.js, hledání, kontrola
   poctivosti, opravné kolo, zastavení, chyby, export a import, historie, rozložení.
   Co se NEzkouší: skutečné volání Claude (stránka tu dostane `window.claude` z tohoto souboru),
   skutečné omezení okna artefaktu a souhlas při prvním volání. Tohle ověří až živá stránka.

   Použití (z kořene repozitáře):
     node trener/build.mjs
     python3 trener/test/e2e/make_fixtures.py "$FIXTURES"
     FIXTURES=... PDFJS_DIR=.../node_modules/pdfjs-dist/build OUT=... node trener/test/e2e/e2e.cjs
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { FakeDbServer, installDbMock } = require('./fakedb.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'trener', 'dist', 'trener.test.html'), 'utf8');
const HTML_STANDALONE = fs.readFileSync(path.join(ROOT, 'trener', 'dist', 'standalone', 'index.html'), 'utf8');
const FIX = process.env.FIXTURES;
const PDFJS = process.env.PDFJS_DIR;
const OUT = process.env.OUT || path.join(__dirname, 'out');
const PLAN = path.join(ROOT, 'reference', 'codex-2026-11-01', 'takticky-plan.json');
if (!FIX || !PDFJS) {
  console.error('Chybí proměnné FIXTURES a PDFJS_DIR (viz začátek souboru).');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const fx = (name) => path.join(FIX, name);

// ------------------------------------------------------------------ předstíraný Claude (běží ve stránce)
function installMock(config) {
  const mock = (window.__mock = { mode: 'ok', plannerFails: false, noImages: false, declineSave: false, calls: [], prompts: [], saves: [] });
  // Zkoušky vlastního klíče (scénář 10) berou odpovědi z téhož předstíraného Claude přes falešné HTTP API.
  mock.reply = (input, opts) => sample(input, opts);
  const err = (code, message, text) => Object.assign({ code, message }, text !== undefined ? { text } : {});
  const TIER = { user_entered: 'user_entered', screenshot_verified: 'observed', ocr_unverified: 'inferred', vision_unverified: 'inferred' };

  function parse(prompt) {
    const obs = [];
    const re = /^- ([A-Za-z0-9_.:-]{1,40}) \| (user_entered|screenshot_verified|ocr_unverified|vision_unverified) \| ([^|]*) \| (.*)$/gm;
    let m;
    while ((m = re.exec(prompt))) obs.push({ id: m[1], label: m[2], text: m[4] });
    const passIds = [...prompt.matchAll(/^- (bk:[^ |]+) \|/gm)].map((x) => x[1]);
    return { obs, passIds };
  }
  function advice(p, overclaim) {
    const [a, b] = p.obs;
    const tier = (o) => (o ? TIER[o.label] : 'unknown');
    const book = p.passIds.slice(0, 2);
    const both = a && b && tier(a) === 'observed' && tier(b) === 'observed';
    const level = overclaim || both ? 'high' : a ? 'medium' : 'low';
    return {
      context: { text: 'Soupeř nás přehrává ve středu hřiště a útočník zůstává bez podpory.', tier: book.length ? 'inferred' : a ? tier(a) : 'unknown', refs: [...(a ? [a.id] : []), ...book] },
      evidenceA: { text: a ? `Pozorování ${a.id}: ${a.text}` : 'Zatím žádné pozorování.', tier: tier(a), refs: a ? [a.id] : [] },
      evidenceB: { text: b ? `Pozorování ${b.id}: ${b.text}` : 'Druhý nezávislý důkaz zatím chybí.', tier: tier(b), refs: b ? [b.id] : [] },
      confidence: { level, text: both ? 'Dva ověřené důkazy.' : a ? 'Jeden důkaz, druhý chybí.' : 'Bez pozorování nelze říct víc.' },
      diagnosis: { text: 'Pravděpodobná příčina je velká vzdálenost mezi záložní řadou a útočníkem.', tier: 'inferred', refs: [...(a ? [a.id] : []), ...book] },
      change: {
        text: 'Přiblížit záložníka k útočníkovi, aby měl přihrávku.',
        items: [{ player: 'Útočník', setting: 'role útočníka', from: 'izolovaný', to: 'podporující', where: ['Taktika', 'Role hráčů'], where_tier: 'unknown', refs: book.slice(0, 1) }],
      },
      measure: { text: 'Po změně sleduj, zda útočník dostává míč.', checks: ['Počet přihrávek útočníkovi za 15 minut', 'Poměr střel'], recheck_after_minutes: 15 },
      risk: { text: 'Záložník bude víc vystavený protiútokům.', items: ['Víc volného prostoru za záložní řadou'] },
      reversal: { text: 'Vrať roli útočníka na původní hodnotu.' },
      unknown: { text: 'Neověřený je přesný název role ve hře.', items: ['Ověř ve hře přesný název role a cestu v menu.'] },
    };
  }

  function specialReply(kind, prompt) {
    const ids = (re) => [...prompt.matchAll(re)].map((m) => m[1]);
    if (kind === 'explain') {
      const facts = ids(/^- (geo-[^ |]+) \|/gm);
      const slots = ids(/^- (s\d+) \| /gm);
      const passages = ids(/^- (bk:[^ |]+) \|/gm);
      const f0 = facts[0] || null;
      return {
        summary: { text: 'Podle nakresleného rozložení jsou řady postavené jako v zadání.', tier: f0 ? 'inferred' : 'unknown', refs: f0 ? [f0] : [] },
        worksWell: f0 ? [{ text: 'Záloha kryje střed, v teorii z knihy se tomu říká krytí.', tier: 'inferred', refs: [f0, ...passages.slice(0, 1)], slots: slots.slice(0, 2) }] : [],
        conflicts: facts.filter((x) => !/^geo-shape-/.test(x)).slice(0, 2).map((x) => ({ text: 'Tohle rozložení může vytvořit prostorový konflikt podle nálezu.', tier: 'inferred', refs: [x], slots: slots.slice(0, 1) })),
        unknown: { text: 'Role jsou jen tvůj text, jejich pohyb nevím.', items: ['Ověř ve hře, co daná role dělá'] },
      };
    }
    if (kind === 'opponent') {
      const opp = ids(/^- (opp-[A-Za-z0-9]+) \|/gm).filter((x) => x !== 'opp-name');
      const keyLine = (/opp-keyPlayers \| [^|]* \| Klíčoví hráči: ([^\n]+)/.exec(prompt) || [])[1] || '';
      const player = keyLine ? keyLine.split(/\s+[–-]\s+/)[0].trim().split('\n')[0] : null;
      const refs = opp.slice(0, 1);
      return {
        summary: { text: 'Soupeř podle zadaných údajů hraje takhle a jde proti němu postupovat opatrně.', tier: refs.length ? 'inferred' : 'unknown', refs },
        press: { text: 'Napadat dvojicí záložníků při jejich rozehrávce.', tier: refs.length ? 'inferred' : 'unknown', refs },
        winBall: { text: 'Míč získávat po ztrátě na jejich křídle.', tier: 'unknown', refs: [] },
        side: { choice: refs.length ? 'left' : 'none', text: 'Levá strana, kde podle zadání nechávají prostor.', tier: refs.length ? 'inferred' : 'unknown', refs },
        spaces: { text: 'Obsadit prostor za jejich obráncem.', items: ['Prostor za jejich pravým obráncem'], tier: refs.length ? 'inferred' : 'unknown', refs },
        limit: { player: player || null, text: 'Hlídat nejnebezpečnějšího hráče dvojicí stoperů.', tier: refs.length ? 'inferred' : 'unknown', refs },
        risk: { text: 'Otevřený střed.', items: ['Při ztrátě míče zůstane střed otevřený'] },
        confidence: { level: refs.length ? 'medium' : 'low', text: 'Údaje jsou jen zadané ručně nebo neověřené.' },
        unknown: { text: 'Chybí standardní situace.', items: ['Jak soupeř brání rohy'] },
      };
    }
    if (kind === 'lesson') {
      const refs = ids(/^- (bk:[^ |]+) \|/gm).slice(0, 1);
      const q = (text, options, answerIndex) => ({ q: text, options, answerIndex, explanation: 'Správná odpověď vychází z principu výše.', refs: [] });
      return {
        principle: { text: 'Podle úryvků z knih mají být řady blízko u sebe, aby měl útočník komu přihrát.', tier: refs.length ? 'inferred' : 'unknown', refs },
        fm27Example: { text: 'Zkus ve hře přiblížit záložníka k útočníkovi a sleduj, jestli útočník dostane víc míčů.', tier: 'inferred', refs: [], verify: ['Ověř ve hře, jak se role záložníka jmenuje a kde se nastavuje'] },
        diagram: { players: [{ x: 50, y: 30, team: 'own', label: 'Útočník' }, { x: 50, y: 55, team: 'own', label: 'Záložník' }, { x: 50, y: 18, team: 'opp', label: 'Obránce' }], arrows: [{ from: [50, 55], to: [50, 34], kind: 'pass' }], zones: [{ x: 30, y: 35, w: 40, h: 18, label: 'Prostor' }], caption: 'Záložník nabízí přihrávku útočníkovi' },
        usage: { text: 'Obecně: zkrať vzdálenost mezi řadami.', steps: ['Najdi izolovaného hráče', 'Přibliž k němu záložníka', 'Sleduj, co se změnilo'] },
        mistakes: ['Přiblížit celou řadu najednou', 'Zapomenout na prostor za záložníkem'],
        exercise: { task: 'Nakresli rozestavení se vzdáleností řad 30 a potom 20.', hint: 'Použij taktickou laboratoř.', solutionOutline: 'Menší vzdálenost mezi řadami zvyšuje počet přihrávkových možností.' },
        quiz: [q('Co zkrátí vzdálenost mezi řadami?', ['Přiblížení záložníka k útočníkovi', 'Odsunutí obrany dozadu', 'Širší hra'], 0), q('Kdy je útočník izolovaný?', ['Když má kolem sebe hodně spoluhráčů', 'Když je daleko od zbytku týmu', 'Když hraje na křídle'], 1), q('Co hlídat po přiblížení záložníka?', ['Nic', 'Šířku hřiště', 'Prostor za ním'], 2)],
      };
    }
    if (kind === 'scenario') {
      const refs = ids(/^- (bk:[^ |]+) \|/gm).slice(0, 1);
      return {
        situation: 'Soupeř tlačí a tvůj tým ztrácí míče ve středu hřiště. Jak zareaguješ?',
        options: [{ id: 'a', text: 'Stáhneš tým hlouběji' }, { id: 'b', text: 'Zkrátíš vzdálenosti mezi řadami' }, { id: 'c', text: 'Pošleš všechny dopředu' }],
        best: 'b',
        why: { text: 'Podle úryvků zkrácení vzdáleností pomáhá bránit prostor a ostatní možnosti ho nechávají otevřený.', tier: refs.length ? 'inferred' : 'unknown', refs },
        commonMistake: 'Stáhnout tým příliš hluboko a vzdát střed.',
        followUp: 'Sleduj, jestli soupeř ztrácí míč častěji.',
      };
    }
    // report
    const obs = ids(/^- ((?:snap|live|chg|det|sum)-[A-Za-z0-9-]+) \|/gm);
    const o0 = obs[0] || null;
    return {
      worked: o0 ? [{ text: 'V první půlhodině jsme měli víc střel.', tier: 'inferred', refs: [o0] }] : [],
      didntWork: [],
      changesHelped: [],
      changesHurt: [],
      players: [],
      opponentEdge: [],
      repeatedMistakes: [],
      nextMatch: { text: 'Příště podobně.', items: [{ what: 'Nechat záložníka blíž k útočníkovi', why: 'Pomohlo to podle zadaných statistik', tier: o0 ? 'inferred' : 'unknown', refs: o0 ? [o0] : [] }] },
      limits: { text: 'Údaje jsou jen z několika snímků.', items: ['Jen málo snímků, jsou čtené z obrázků'] },
    };
  }

  async function sample(input, opts) {
    opts = opts || {};
    const isStr = typeof input === 'string';
    const kindOf = (t) =>
      /\{"ok": true\}/.test(t) ? 'ping'
      : /obrazovka se soupiskou hráčů/.test(t) ? 'squad'
      : /informacemi o soupeři/.test(t) ? 'oppread'
      : /připravuješ předzápasový plán proti soupeři/.test(t) ? 'opponent'
      : /vysvětluješ, jak je postavené rozložení/.test(t) ? 'explain'
      : /píšeš rozbor odehraného zápasu/.test(t) ? 'report'
      : /čtečka snímku obrazovky pro FM27 Tactical Coach/.test(t) ? 'extract'
      : /Jsi učitel taktiky v aplikaci FM27 Tactical Coach/.test(t) ? 'lesson'
      : /Jsi trenér rozhodování v aplikaci FM27 Tactical Coach/.test(t) ? 'scenario'
      : null;
    const special = isStr ? kindOf(input) : kindOf(input[0].content);
    const kind = special || (isStr ? 'planner' : input.length > 1 ? 'repair' : 'advice');
    const prompt = isStr ? input : input.map((t) => t.content).join('\n');
    mock.calls.push({ kind, tier: opts.modelTier || null, images: opts.images ? opts.images.length : 0, cache: opts.cache === undefined ? null : opts.cache, signal: !!opts.signal, bytes: new TextEncoder().encode(prompt).length });
    mock.prompts.push(prompt);
    if (mock.mode === 'not_granted') throw err('not_granted', 'not granted');
    if (mock.mode === 'rate_limited' && kind !== 'planner') throw err('rate_limited', 'rate limited');
    if (mock.mode === 'upstream' && kind !== 'planner') throw err('upstream_error', 'upstream');
    if (opts.signal && opts.signal.aborted) throw err('cancelled', 'aborted');
    let text;
    if (kind === 'ping') {
      text = '{"ok": true}';
    } else if (kind === 'extract') {
      const next = (mock.extractQueue && mock.extractQueue.shift()) || mock.extractReply || { screen: 'stats', minute: 10, score: { home: 0, away: 0 }, teams: { home: null, away: null }, stats: { home: { possession: 50, shots: 1 }, away: { possession: 50, shots: 1 } }, events: [], visibleText: ['Statistiky'], notes: '' };
      if (mock.mode === 'extract-invalid') text = 'to není JSON';
      else text = JSON.stringify(next);
    } else if (kind === 'squad') {
      text = JSON.stringify(mock.squadReply || { players: [{ name: 'Jan Novák', positions: ['ST'], age: 24, role: null, attributes: { Finishing: 15 }, injured: false }, { name: 'Petr Svoboda', positions: ['gk'], age: 31, role: null, attributes: {}, injured: true }, { name: '', positions: [] }], notes: 'čitelné' });
    } else if (kind === 'oppread') {
      text = JSON.stringify(mock.oppReadReply || { formation: '4 2 3 1', roles: ['Křídelník'], keyPlayers: ['Novák – hrot'], strengths: [], weaknesses: ['Pomalá obrana'], notes: 'čitelné' });
    } else if (kind === 'opponent' || kind === 'explain' || kind === 'report' || kind === 'lesson' || kind === 'scenario') {
      const prompt0 = isStr ? input : input[0].content;
      if (mock.mode === 'special-invalid') text = JSON.stringify({ nic: 1 });
      else text = JSON.stringify(specialReply(kind, prompt0));
    } else if (kind === 'planner') {
      if (mock.plannerFails) throw err('upstream_error', 'planner failed');
      text = JSON.stringify(mock.queries || ['support striker isolation', 'izolovaný útočník podpora záložníků', 'counter-pressing']);
    } else {
      if (mock.mode === 'slow') {
        await new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(err('cancelled', 'aborted'))));
      }
      const p = parse(isStr ? prompt : input[0].content);
      if (kind === 'advice') {
        if (mock.mode === 'repair' || mock.mode === 'repair-fail') text = JSON.stringify(advice(p, true));
        else if (mock.mode === 'invalid_json') text = 'Tady je rada, ale není to JSON.';
        else text = JSON.stringify(advice(p, false));
      } else {
        text = JSON.stringify(advice(p, mock.mode === 'repair-fail'));
      }
    }
    if (opts.onText) {
      const half = Math.floor(text.length / 2);
      opts.onText({ text: text.slice(0, half), delta: text.slice(0, half) });
      await new Promise((r) => setTimeout(r, 15));
      opts.onText({ text, delta: text.slice(half) });
    }
    return { text, truncated: false };
  }
  sample.json = async (input, opts) => {
    const { text } = await sample(input, opts);
    try {
      return JSON.parse(text);
    } catch (e) {
      throw err('invalid_json', 'not json', text);
    }
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: mock.noImages ? undefined : { maxCount: 3, maxInputBytes: 5242880, mediaTypes: ['image/png', 'image/jpeg', 'image/webp'] } });
  const downloads = {
    async save(req) {
      const text = req.data instanceof Blob ? await req.data.text() : String(req.data);
      if (mock.declineSave) throw err('declined', 'declined');
      mock.saves.push({ filename: req.filename, text });
      return { status: 'saved' };
    },
  };
  // Hlasový stroj: zachytí, co by se přečetlo nahlas.
  window.__spoken = [];
  const voicesList = [{ lang: 'cs-CZ', name: 'Zkušební čeština', voiceURI: 'test-cs' }];
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak(u) { window.__spoken.push({ text: u.text, volume: u.volume, rate: u.rate, lang: u.lang, voice: u.voice ? u.voice.voiceURI : null }); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {}, getVoices: () => voicesList, addEventListener() {} },
  });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  if (config.captureCanvas) {
    // Sdílení obrazovky: místo skutečného okna se sdílí plátno, jehož obsah řídí zkouška (window.__screen.draw(n)).
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    window.__screen = {
      stream: null,
      denied: false,
      draw(n) {
        ctx.fillStyle = n % 2 ? '#123' : '#e8d8c0';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = n % 2 ? '#fa0' : '#036';
        for (let i = 0; i < 8; i++) ctx.fillRect(20 + i * 70, 40 + ((n * 37 + i * 53) % 220), 50, 60);
      },
    };
    window.__screen.draw(0);
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (window.__screen.denied) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
      window.__screen.stream = canvas.captureStream(5);
      return window.__screen.stream;
    };
  }
  if (!config.noClaude) {
    window.claude = {
      use: async (name) => {
        if (name === 'sample') return sample;
        if (name === 'downloads') return downloads;
        if (name === 'db') return config.noDb ? null : window.__dbMock || null;
        if (name === 'user') return window.__userMock || null;
        return null;
      },
    };
  }
}

// ------------------------------------------------------------------ pomůcky
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'OK    ' : 'CHYBA '} ${name}${!ok && detail !== undefined ? '\n         → ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
const URL_PAGE = 'https://artifact.test/';
const cdnMap = {
  'pdf.min.js': path.join(PDFJS, 'pdf.min.js'),
  'pdf.worker.min.js': path.join(PDFJS, 'pdf.worker.min.js'),
};

async function newContext(browser, opts) {
  opts = opts || {};
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 900 },
    colorScheme: opts.colorScheme || 'dark',
    deviceScaleFactor: 1,
  });
  const problems = { console: [], page: [], failed: [] };
  await context.route('**/*', (route) => {
    problems.failed.push(route.request().url());
    return route.abort();
  });
  await context.route(URL_PAGE, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: opts.standalone ? HTML_STANDALONE : HTML }));
  await context.route('https://artifact.test/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  if (process.env.FZSTD_DIR) {
    await context.route('https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(process.env.FZSTD_DIR, 'fzstd', 'umd', 'index.js')) }));
  }
  await context.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', (route) => {
    const file = route.request().url().split('/').pop();
    if (!cdnMap[file]) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(cdnMap[file]) });
  });
  if (opts.db) {
    await opts.db.attach(context, opts.uid || 'u1');
    await context.addInitScript(installDbMock, { uid: opts.uid || 'u1' });
  }
  await context.addInitScript(installMock, { noClaude: !!opts.noClaude, noDb: !opts.db, captureCanvas: !!opts.captureCanvas });
  if (opts.localOrigin) {
    // Skutečný místní server (scénář 10): stránka, service worker i ikony se berou z něj, všechno ostatní zůstává zablokované.
    await context.route(opts.localOrigin + '/**', (route) => route.continue());
  }
  if (opts.standalone && !opts.localOrigin) {
    // Zkušební stránka nemá skutečný server, service worker by se nepodařilo stáhnout (to zkouší až scénář 10 na místním serveru).
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator.serviceWorker, 'register', { configurable: true, value: () => Promise.resolve(null) });
      } catch (e) {
        /* nic */
      }
    });
  }
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.console.push(m.text()));
  page.on('pageerror', (e) => problems.page.push(String(e)));
  return { context, page, problems };
}
async function open(page, hash) {
  await page.goto(URL_PAGE + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
}
const text = (page, sel) => page.locator(sel).first().innerText();
const mock = (page, fn, arg) => page.evaluate(fn, arg);
async function setMode(page, patch) {
  await page.evaluate((p) => Object.assign(window.__mock, p), patch);
}
async function resetCalls(page) {
  await page.evaluate(() => {
    window.__mock.calls = [];
    window.__mock.prompts = [];
  });
}
const calls = (page) => page.evaluate(() => window.__mock.calls);
async function waitIdle(page) {
  await page.waitForFunction(() => document.querySelector('#stopBtn').hidden === true && !document.querySelector('#askBtn').disabled, null, { timeout: 20000 });
}
async function ask(page, question) {
  await page.fill('#question', question);
  await page.click('#askBtn');
  await waitIdle(page);
}
async function addObs(page, label, minute, textValue) {
  await page.selectOption('#obsLabel', label);
  await page.fill('#obsMinute', minute === null ? '' : String(minute));
  await page.fill('#obsText', textValue);
  await page.click('#obsAdd');
}
async function nav(page, hash) {
  await page.click('#nav-' + hash);
  await page.waitForFunction((x) => { const b = document.querySelector('#nav-' + x); return !!b && b.getAttribute('aria-current') === 'page'; }, hash);
}
async function addBooks(page, files, { rights = true, title = '', author = '', lang = 'auto' } = {}) {
  await nav(page, 'zdroje');
  await page.setInputFiles('#bookFile', files);
  await page.fill('#bookTitle', title);
  await page.fill('#bookAuthor', author);
  await page.selectOption('#bookLang', lang);
  await page.setChecked('#bookRights', rights);
  await page.click('#bookAdd');
  await page.waitForFunction(() => !document.querySelector('#bookAdd').disabled, null, { timeout: 60000 });
  return text(page, '#bookStatus');
}
const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

// ------------------------------------------------------------------ spuštění scénářů
const helpers = { newContext, open, nav, ask, addObs, addBooks, setMode, resetCalls, calls, waitIdle, overflow, text, mock, fx, chromium, OUT, FakeDbServer };

async function main() {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const dir = path.join(__dirname, 'scenarios');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort().filter((f) => !only || only.some((o) => f.includes(o)));
  const browser = await chromium.launch();
  try {
    for (const file of files) {
      console.log(`\n=== ${file} ===`);
      await require(path.join(dir, file))({ browser, check, fx, OUT, PLAN, h: helpers });
    }
  } finally {
    await browser.close();
  }
  console.log(`\nShrnutí: ${passes} v pořádku, ${failures} chyb.`);
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Zkouška spadla:', e);
    process.exitCode = 1;
  });
} else {
  module.exports = helpers;
}
