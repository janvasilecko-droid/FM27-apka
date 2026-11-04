/* Scénář 10: SAMOSTATNÁ VERZE mimo Claude: vlastní klíč (Anthropic a OpenAI-kompatibilní přes falešná HTTP API),
   tajnost klíče, chyby poskytovatele, spotřeba, zastavení volání; potom skutečný service worker na místním serveru,
   otevření bez připojení a karta instalace.
   Falešná API berou odpovědi z téhož předstíraného Claude jako ostatní scénáře, takže se zkouší celá cesta
   stránka → adaptér → fetch → odpověď → kontrola poctivosti. Živé API se tu NEZKOUŠÍ (není klíč). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Na GitHub Pages běží aplikace pod adresou /<repozitář>/, ne v kořeni. Zkouška to napodobuje, aby odhalila absolutní odkazy.
const BASE = '/FM27-apka';

function serve(root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) {
      res.writeHead(404);
      return res.end('not found');
    }
    const rel = url.pathname.slice(BASE.length);
    const name = rel === '' || rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
    const file = path.join(root, path.normalize(name));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port || 0, () => resolve(server)));
}

module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, nav, ask, text, waitIdle, addBooks } = h;
  const root = path.join(__dirname, '..', '..', '..', 'dist', 'standalone');
  let server = await serve(root);
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };
  const openLocal = async (page, hash) => {
    await page.goto(origin + BASE + '/' + (hash ? '#' + hash : ''));
    await page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  };
  // Klíče se skládají za běhu, aby v repu nezůstal žádný text podobný klíči. Nejsou skutečné.
  const KEY = ['sk', 'ant', 'api03', 'ZKOUSKA' + 'a1B2c3D4'.repeat(4)].join('-');
  const KEY2 = ['sk', 'ZKOUSKA' + 'q9W8e7R6'.repeat(4)].join('-');

  // ---------------------------------------------------------------- falešná API
  const api = { mode: 'ok', log: [], usage: { input: 1000, output: 500 }, delayMs: 0 };
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  const fromMessages = (messages) => {
    const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('') }));
    const images = messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'image' || b.type === 'image_url').length : 0), 0);
    const planner = turns.length === 1 && /^Navrhni hledací dotazy do knihovny/.test(turns[0].content);
    return { input: planner ? turns[0].content : turns, images };
  };
  async function handle(page, route, flavour) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    api.log.push({ flavour, url: req.url(), headers: req.headers(), body });
    const json = (status, payload) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(payload) });
    if (api.mode === 'network') return route.abort('connectionfailed');
    if (api.mode === 'unauthorized') return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key ' + (req.headers()['x-api-key'] || (req.headers().authorization || '').replace('Bearer ', '')) } });
    if (api.mode === 'ratelimit') return json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } });
    if (api.mode === 'server') return json(500, { type: 'error', error: { type: 'api_error', message: 'internal' } });
    if (api.delayMs) await new Promise((r) => setTimeout(r, api.delayMs));
    const { input, images } = fromMessages(body.messages || []);
    let reply;
    try {
      reply = await page.evaluate(([i, n]) => window.__mock.reply(i, { images: new Array(n).fill(0), modelTier: 'x' }).then((r) => r.text), [input, images]);
    } catch (e) {
      return json(500, { type: 'error', error: { type: 'api_error', message: 'zkušební server selhal' } });
    }
    if (flavour === 'anthropic') {
      return json(200, { id: 'msg_zkouska', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: api.usage.input, output_tokens: api.usage.output } });
    }
    return json(200, { id: 'chatcmpl-zkouska', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: api.usage.input, completion_tokens: api.usage.output } });
  }

  // ====================================================== A) vlastní klíč Anthropic
  const c = await newContext(browser, { standalone: true, noClaude: true, localOrigin: origin });
  const page = c.page;
  await c.context.route('https://api.anthropic.com/**', (route) => handle(page, route, 'anthropic'));
  await c.context.route('https://llm.test/**', (route) => handle(page, route, 'openai'));
  await openLocal(page, 'trener');
  check('10 bez klíče trenér poctivě říká, že nemá přístup k AI, a tlačítko Poradit je vypnuté', /nemá přístup ke Claude/.test(await text(page, '.hint:has-text("přístup ke Claude")')) && (await page.isDisabled('#askBtn')), await page.evaluate(() => document.querySelector('#askBtn').disabled));
  await nav(page, 'nastaveni');
  check('10 v samostatné verzi je karta „Vlastní klíč AI“ (v Claude se neukazuje)', await page.isVisible('#keyCard'));
  await page.click('#keySave');
  check('10 uložení bez klíče se odmítne', /Vlož klíč/.test(await text(page, '#keyMsg')), await text(page, '#keyMsg'));
  await page.fill('#keyValue', KEY);
  await page.click('#keySave');
  await page.waitForFunction(() => /Klíč je uložený/.test(document.querySelector('#keyMsg').textContent), null, { timeout: 8000 }).catch(() => {});
  check('10 klíč se uloží, AI je dostupná jako „Claude (vlastní klíč)“', /Klíč je uložený/.test(await text(page, '#keyMsg')) && (await page.evaluate(() => window.FM27.ai.kind)) === 'anthropic' && (await page.evaluate(() => window.FM27.ai.available)) === true, await text(page, '#keyMsg'));
  check('10 po uložení se klíč nezobrazuje (pole je prázdné, stránka ho nikde nevypíše)', (await page.inputValue('#keyValue')) === '' && !(await page.evaluate(() => document.documentElement.outerHTML)).includes(KEY));

  // zkouška spojení
  await page.click('#testClaude');
  await page.waitForFunction(() => /Spojení s Claude funguje/.test(document.querySelector('#testOut').textContent), null, { timeout: 10000 }).catch(() => {});
  check('10 zkouška spojení projde přes falešné API Anthropic', /Spojení s Claude funguje/.test(await text(page, '#testOut')) && api.log.length === 1, await text(page, '#testOut'));
  const r0 = api.log[0] || { headers: {}, body: {} };
  const version = await page.evaluate(() => window.TrenerProviders.ANTHROPIC_VERSION);
  check('10 požadavek jde na api.anthropic.com/v1/messages s klíčem, verzí a hlavičkou pro prohlížeč', r0.url === 'https://api.anthropic.com/v1/messages' && r0.headers['x-api-key'] === KEY && r0.headers['anthropic-version'] === version && r0.headers['anthropic-dangerous-direct-browser-access'] === 'true' && /application\/json/.test(r0.headers['content-type']), { url: r0.url, h: Object.keys(r0.headers) });
  check('10 tělo požadavku má model, max_tokens a zprávy (levný model pro zkoušku)', typeof r0.body.model === 'string' && /^claude-/.test(r0.body.model) && Number.isInteger(r0.body.max_tokens) && Array.isArray(r0.body.messages) && r0.body.messages.length === 1, r0.body);

  // rada: plán hledání (levný model) a rada (důkladný model); plán hledání se dělá jen, když jsou v knihovně knihy
  await addBooks(page, [fx('taktika-cs.txt')]);
  await nav(page, 'trener');
  check('10 s klíčem je tlačítko Poradit zapnuté', !(await page.isDisabled('#askBtn')));
  await ask(page, 'Soupeř nás přehrává ve středu hřiště, co mám změnit?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const advRows = api.log.slice(1);
  const kinds = await page.evaluate(() => window.__mock.calls.map((x) => x.kind));
  check('10 rada vzniká dvěma volanými kroky (plán hledání, rada) a oba jdou přes API s klíčem', advRows.length === 2 && kinds.join(',') === 'ping,planner,advice', { kinds, rows: advRows.length });
  check('10 plán hledání jde levnějším modelem než rada', advRows.length === 2 && advRows[0].body.model !== advRows[1].body.model, advRows.map((r) => r.body.model));
  check('10 rada z vlastního klíče má 10 částí a prošla kontrolou poctivosti', (await page.locator('#result .sec').count()) === 10 && /prošla kontrolou/.test(await text(page, '#result .banner')), await text(page, '#result .banner'));

  // obrázek jde jako base64 blok
  await page.setInputFiles('#imageInput', fx('screenshot.png'));
  await ask(page, 'Co z toho screenshotu vyčteš?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const last = api.log[api.log.length - 1];
  const lastMsg = last.body.messages[last.body.messages.length - 1];
  const imgBlock = Array.isArray(lastMsg.content) ? lastMsg.content.find((b) => b.type === 'image') : null;
  check('10 screenshot jde Claude jako obrázek (base64, png) a text zůstane po něm', !!imgBlock && imgBlock.source.type === 'base64' && imgBlock.source.media_type === 'image/png' && imgBlock.source.data.length > 100 && lastMsg.content[lastMsg.content.length - 1].type === 'text', imgBlock ? { t: imgBlock.source.media_type, len: imgBlock.source.data.length } : lastMsg.content);

  // klíč zůstává jen v tomto prohlížeči
  const leaks = await page.evaluate(async (key) => {
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== 'fm27.aiConfig' && String(localStorage.getItem(k)).includes(key)) found.push('localStorage:' + k);
    }
    if (!String(localStorage.getItem('fm27.aiConfig')).includes(key)) found.push('chybí v aiConfig');
    if (JSON.stringify(window.FM27.app.store.exportAll()).includes(key)) found.push('export dat');
    if (document.documentElement.outerHTML.includes(key)) found.push('stránka');
    const dbs = (await indexedDB.databases()) || [];
    for (const info of dbs) {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(info.name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const name of [...db.objectStoreNames]) {
        const rows = await new Promise((res, rej) => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        if (JSON.stringify(rows).includes(key)) found.push('indexedDB:' + info.name + '/' + name);
      }
      db.close();
    }
    return found;
  }, KEY);
  check('10 klíč je jen v nastavení tohoto prohlížeče: ne v exportu dat, v databázích ani ve stránce', leaks.length === 0, leaks);

  // spotřeba podle skutečných tokenů z odpovědi API
  await nav(page, 'nastaveni');
  const calls = api.log.length;
  const usage = await text(page, '#usageBox');
  const fmt = (n) => new RegExp(String(n).replace(/(\d)(?=(\d{3})+$)/g, '$1\\s'));
  check('10 spotřeba počítá volání i tokeny, které API opravdu vrátilo (ne odhad)', new RegExp('Volání celkem\\s*' + calls).test(usage) && fmt(calls * 1000).test(usage) && /0 % záznamů je odhad/.test(usage), usage);

  // chyby poskytovatele
  const errBanner = async (mode, expect, why) => {
    api.mode = mode;
    await nav(page, 'trener');
    await page.fill('#question', 'Zkouška chyby ' + mode);
    await page.click('#askBtn');
    await page.waitForSelector('#result .banner.bad', { timeout: 20000 });
    const t = await text(page, '#result .banner.bad');
    check(why, expect.test(t) && !t.includes(KEY), t);
    api.mode = 'ok';
  };
  await errBanner('unauthorized', /odmítl klíč API[\s\S]*HTTP 401[\s\S]*Zkontroluj klíč v Nastavení/, '10 odmítnutý klíč: srozumitelná hláška s HTTP 401 a odkazem na nastavení, klíč se v ní neobjeví');
  await errBanner('ratelimit', /limit požadavků/, '10 překročený limit: hláška o limitu poskytovatele');
  await errBanner('server', /HTTP 500/, '10 chyba služby: hláška s HTTP 500');
  check('10 u chyby služby se nabízí „Zkusit znovu“ a po opravě projde', await (async () => {
    const retry = page.locator('#result .banner.bad').getByRole('button', { name: 'Zkusit znovu' });
    if ((await retry.count()) !== 1) return false;
    await retry.click();
    await page.waitForSelector('#result .sec', { timeout: 20000 });
    return (await page.locator('#result .sec').count()) === 10;
  })());
  await errBanner('network', /Spojení se službou se nepovedlo/, '10 výpadek spojení: hláška o připojení');

  // zastavení volání (AbortController až do fetch)
  api.delayMs = 4000;
  await nav(page, 'trener');
  await page.fill('#question', 'Zkouška zastavení');
  await page.click('#askBtn');
  await page.waitForSelector('#stopBtn:not([hidden])', { timeout: 10000 });
  await until(async () => api.log.length >= 1 && (await page.evaluate(() => window.__mock.calls.length)) >= 1);
  await page.click('#stopBtn');
  await page.waitForFunction(() => /Zastaveno/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 }).catch(() => {});
  check('10 zastavení přeruší volání přes API a aplikace to řekne', /Zastaveno/.test(await text(page, '#toast')) && (await page.isVisible('#askBtn')), await text(page, '#toast'));
  api.delayMs = 0;
  await waitIdle(page);

  // ====================================================== B) OpenAI-kompatibilní
  await nav(page, 'nastaveni');
  await page.selectOption('#keyKind', 'openai');
  check('10 u OpenAI-kompatibilního se ukáže adresa a tři modely i upozornění, že je to neověřené', (await page.isVisible('#keyBase')) && (await page.isVisible('#keyQuick')) && /Neověřeno/.test(await text(page, '#keyOpenAiNote')), await text(page, '#keyOpenAiNote'));
  await page.fill('#keyValue', KEY2);
  await page.fill('#keyBase', 'https://llm.test/v1');
  await page.click('#keySave');
  check('10 bez názvů modelů se uložení odmítne (žádný model se nevymýšlí)', /Vyplň názvy všech tří modelů/.test(await text(page, '#keyMsg')), await text(page, '#keyMsg'));
  await page.fill('#keyValue', KEY2);
  await page.fill('#keyBase', 'https://llm.test/v1');
  await page.fill('#keyQuick', 'zkusebni-maly');
  await page.fill('#keyDefault', 'zkusebni-stredni');
  await page.fill('#keyComplex', 'zkusebni-velky');
  await page.click('#keySave');
  await until(async () => (await page.evaluate(() => window.FM27.ai.kind)) === 'openai');
  const before = api.log.length;
  await page.click('#testClaude');
  await page.waitForFunction(() => /Spojení s Claude funguje/.test(document.querySelector('#testOut').textContent), null, { timeout: 10000 }).catch(() => {});
  const o0 = api.log[before] || { headers: {}, body: {} };
  check('10 OpenAI-kompatibilní: požadavek jde na zadanou adresu s hlavičkou Authorization a JSON režimem', o0.url === 'https://llm.test/v1/chat/completions' && o0.headers.authorization === 'Bearer ' + KEY2 && o0.body.model === 'zkusebni-maly' && o0.body.response_format && o0.body.response_format.type === 'json_object', { url: o0.url, model: o0.body.model, rf: o0.body.response_format });
  check('10 OpenAI-kompatibilní: zkouška spojení projde', /Spojení s Claude funguje/.test(await text(page, '#testOut')), await text(page, '#testOut'));
  await nav(page, 'trener');
  await ask(page, 'Jak ubránit křídlo?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const oRows = api.log.slice(before + 1);
  check('10 OpenAI-kompatibilní: rada projde stejnou kontrolou poctivosti, plán levným a rada běžným modelem', (await page.locator('#result .sec').count()) === 10 && oRows.length === 2 && oRows[0].body.model === 'zkusebni-maly' && oRows[1].body.model === 'zkusebni-stredni', { rows: oRows.map((r) => r.body.model), secs: await page.locator('#result .sec').count() });
  await page.check('#deepMode');
  const beforeDeep = api.log.length;
  await ask(page, 'Jak ubránit křídlo důkladně?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const deepRows = api.log.slice(beforeDeep);
  check('10 důkladný režim pošle radu největšímu modelu, který uživatel zadal', deepRows.length === 2 && deepRows[1].body.model === 'zkusebni-velky', deepRows.map((r) => r.body.model));
  await page.uncheck('#deepMode');
  api.mode = 'unauthorized';
  await page.fill('#question', 'Zkouška odmítnutí');
  await page.click('#askBtn');
  await page.waitForSelector('#result .banner.bad', { timeout: 20000 });
  const t401 = await text(page, '#result .banner.bad');
  check('10 OpenAI-kompatibilní: odmítnutý klíč se nezobrazí a hláška říká, co dělat', /HTTP 401/.test(t401) && !t401.includes(KEY2), t401);
  api.mode = 'ok';

  // klíč jen do zavření záložky: v sessionStorage, ne v localStorage; po obnovení stránky v téže záložce zůstane
  await nav(page, 'nastaveni');
  await page.selectOption('#keyKind', 'anthropic');
  await page.fill('#keyValue', KEY);
  await page.uncheck('#keyRemember');
  await page.click('#keySave');
  await page.waitForFunction(() => /Klíč platí jen do zavření záložky/.test(document.querySelector('#keyMsg').textContent), null, { timeout: 8000 }).catch(() => {});
  const where = await page.evaluate(() => ({ local: localStorage.getItem('fm27.aiConfig'), session: sessionStorage.getItem('fm27.aiConfig'), kind: window.FM27.ai.kind, where: window.FM27.ai.configWhere() }));
  check('10 „jen do zavření záložky“: klíč je v sessionStorage a ne v localStorage a AI funguje', where.local === null && !!where.session && where.session.includes(KEY) && where.kind === 'anthropic' && where.where === 'session', { where: where.where, kind: where.kind });
  await page.reload();
  await page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  check('10 po obnovení stránky v téže záložce klíč platí dál', (await page.evaluate(() => window.FM27.ai.kind)) === 'anthropic' && (await page.evaluate(() => window.FM27.ai.configWhere())) === 'session');

  // smazání klíče
  await nav(page, 'nastaveni');
  const del = page.locator('#keyCard').getByRole('button', { name: 'Smazat klíč' });
  await del.click();
  await page.locator('#keyCard').getByRole('button', { name: 'Opravdu smazat klíč?' }).click();
  await until(async () => (await page.evaluate(() => localStorage.getItem('fm27.aiConfig'))) === null);
  check('10 smazání klíče ho odstraní z prohlížeče (localStorage i sessionStorage) a AI se vypne', (await page.evaluate(() => localStorage.getItem('fm27.aiConfig'))) === null && (await page.evaluate(() => sessionStorage.getItem('fm27.aiConfig'))) === null && (await page.evaluate(() => window.FM27.ai.kind)) === 'none', await page.evaluate(() => window.FM27.ai.kind));
  check('10 A: bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
  const ce = c.problems.console.filter((m) => !/Failed to load resource/.test(m));
  check('10 A: bez chyb v konzoli', ce.length === 0, ce);
  await c.context.close();

  // ====================================================== A2) adresa github.io sdílí úložiště s dalšími stránkami: varování a výchozí „jen do zavření záložky“
  const gh = await newContext(browser, { standalone: true, noClaude: true });
  await gh.context.route('https://zkouska.github.io/FM27-apka/', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(root, 'index.html')) }));
  await gh.page.goto('https://zkouska.github.io/FM27-apka/#nastaveni');
  await gh.page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  check('10 na adrese github.io se ukáže varování o sdíleném úložišti a klíč se výchozně nepamatuje trvale', (await gh.page.isVisible('#keySharedWarn')) && /sdílí úložiště prohlížeče s dalšími stránkami na github\.io/.test(await text(gh.page, '#keySharedWarn')) && !(await gh.page.isChecked('#keyRemember')), await text(gh.page, '#keyCard'));
  await gh.page.fill('#keyValue', KEY);
  await gh.page.click('#keySave');
  await gh.page.waitForFunction(() => /Klíč platí jen do zavření záložky/.test(document.querySelector('#keyMsg').textContent), null, { timeout: 8000 }).catch(() => {});
  check('10 na github.io se klíč bez dalšího zásahu uloží jen do sessionStorage', (await gh.page.evaluate(() => localStorage.getItem('fm27.aiConfig'))) === null && (await gh.page.evaluate(() => !!sessionStorage.getItem('fm27.aiConfig'))), '');
  await gh.context.close();

  // ====================================================== C) PWA: manifest, service worker, offline, instalace
  const p = await newContext(browser, { standalone: true, noClaude: true, localOrigin: origin });
  const pp = p.page;
  await openLocal(pp, 'nastaveni');
  const man = await pp.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    const json = await res.json();
    const icons = [];
    for (const i of json.icons) {
      const r = await fetch(new URL(i.src, link.href));
      icons.push({ src: i.src, ok: r.ok, type: r.headers.get('content-type'), sizes: i.sizes, purpose: i.purpose });
    }
    return { json, icons, apple: !!document.querySelector('link[rel="apple-touch-icon"]'), theme: !!document.querySelector('meta[name="theme-color"]') };
  });
  check('10 manifest je platný: název, start, režim „standalone“, ikony 192 a 512 včetně maskable', !!man && man.json.display === 'standalone' && man.json.start_url === './' && !!man.json.name && !!man.json.short_name && man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.purpose === 'maskable') && man.apple && man.theme, man && { display: man.json.display, icons: man.icons.length });
  check('10 všechny ikony z manifestu se stáhnou jako obrázky', !!man && man.icons.every((i) => i.ok && /^image\//.test(i.type)), man && man.icons);

  const sw = await pp.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
    if (!reg) return null;
    return { scope: reg.scope, active: !!reg.active };
  });
  check('10 service worker se zaregistruje a aktivuje pod adresou /repozitář/ jako na GitHub Pages', !!sw && sw.active && sw.scope === origin + BASE + '/', sw);
  await pp.reload();
  await pp.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  await until(async () => await pp.evaluate(() => !!navigator.serviceWorker.controller));
  const cache = await pp.evaluate(async () => {
    const names = await caches.keys();
    const entries = [];
    for (const n of names) for (const r of await (await caches.open(n)).keys()) entries.push(new URL(r.url).pathname);
    return { names, entries };
  });
  check('10 stránku řídí service worker a jeho mezipaměť má kostru aplikace i ikony', cache.names.length === 1 && /^fm27-coach-/.test(cache.names[0]) && ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].map((x) => BASE + x).every((x) => cache.entries.includes(x)), cache);

  // karta instalace: před nabídkou prohlížeče a po ní
  check('10 před nabídkou prohlížeče karta radí, jak aplikaci nainstalovat ručně', (await pp.isVisible('#installCard')) && /Prohlížeč zatím instalaci nenabídl/.test(await text(pp, '#installNote')) && (await pp.locator('#installBtn').count()) === 0, await text(pp, '#installCard'));
  const prevented = await pp.evaluate(() => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = async () => {
      window.__prompted = (window.__prompted || 0) + 1;
    };
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  await pp.waitForSelector('#installBtn', { timeout: 3000 }).catch(() => {});
  check('10 nabídka instalace od prohlížeče se zachytí a ukáže jako tlačítko', prevented === true && (await pp.locator('#installBtn').count()) === 1, prevented);
  await pp.click('#installBtn');
  await until(async () => (await pp.evaluate(() => window.__prompted)) === 1);
  check('10 tlačítko spustí instalaci prohlížeče a po použití zmizí', (await pp.evaluate(() => window.__prompted)) === 1 && (await pp.locator('#installBtn').count()) === 0, await text(pp, '#installCard'));

  // offline: místní server se vypne, aplikace se musí otevřít z mezipaměti
  await nav(pp, 'tym');
  await pp.fill('#careerClub', 'Chelsea');
  await pp.click('#careerCreate');
  await pp.waitForSelector('#teamTitle, #teamName, #playerForm, .card h2', { timeout: 8000 }).catch(() => {});
  await pp.waitForTimeout(300);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pp.reload();
  await pp.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  check('10 bez serveru se aplikace otevře z mezipaměti service workeru', (await pp.locator('nav').count()) >= 1 && (await pp.evaluate(() => !!navigator.serviceWorker.controller)), '');
  const offline = await pp.evaluate(() => ({ careers: window.FM27.app.store.list('career').map((x) => x.club), hash: location.hash }));
  check('10 bez serveru jsou po otevření dostupná i uložená data (kariéra zůstala v zařízení)', offline.careers.includes('Chelsea'), offline);
  await nav(pp, 'nastaveni');
  check('10 bez serveru aplikace dál funguje (nastavení se otevře, uložená data jsou na místě)', await pp.isVisible('#diag'), '');
  check('10 C: bez chyb ve skriptu', p.problems.page.length === 0, p.problems.page);
  const pe = p.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m));
  check('10 C: bez chyb v konzoli', pe.length === 0, pe);
  await p.context.close();
  server.closeAllConnections();
};
