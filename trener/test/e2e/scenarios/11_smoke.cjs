/* Scénář 11: PROCHÁZKA VŠEMI OBRAZOVKAMI. Zachytí to, co zkoušky jednotlivých funkcí nevidí:
   zbloudilé texty („null“, „undefined“, „NaN“, „[object Object]“), vodorovné posouvání na telefonu, chyby v konzoli
   a nečitelný text (kontrast písma proti pozadí) ve světlém i tmavém vzhledu, na počítači i na telefonu.
   Obrazovky se procházejí prázdné (bez kariéry) i naplněné daty (kariéra, hráč, taktika, soupeř, zápas, lekce, rada). */
module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, open, nav, ask, text, FakeDbServer } = h;
  const SCREENS = ['live', 'tym', 'taktiky', 'soupere', 'laborator', 'skola', 'historie', 'trener', 'zdroje', 'nastaveni'];
  const STRAY = /(^|[^\p{L}\p{N}_.])(null|undefined|NaN|\[object Object\])($|[^\p{L}\p{N}_])/u;

  // ---------------------------------------------------------------- měření uvnitř stránky
  const measure = () => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = (c) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const backdrop = (el) => {
      const layers = [];
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg && bg.a > 0) {
          layers.push(bg);
          if (bg.a >= 1) break;
        }
      }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };
    const issues = [];
    const roots = [document.querySelector('header.topbar'), document.querySelector('#nav'), document.querySelector('#main')].filter(Boolean);
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        if (!own) continue;
        if (el.closest('[hidden]') || el.closest(':disabled') || el.closest('svg')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const fg0 = parse(cs.color);
        if (!fg0) continue;
        const bg = backdrop(el);
        const fg = over(fg0, bg);
        const [a, b] = [lum(fg), lum(bg)];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) issues.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} „${own.slice(0, 32)}“ ${ratio.toFixed(2)}:1 (potřeba ${need})`);
      }
    }
    const body = document.body;
    return {
      text: (document.querySelector('#main') || body).innerText + '\n' + ((document.querySelector('header.topbar') || body).innerText || ''),
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      contrast: issues,
    };
  };

  async function sweep(page, label, { phone } = {}) {
    const stray = [];
    const overflow = [];
    const contrast = [];
    for (const id of SCREENS) {
      await nav(page, id);
      await page.waitForTimeout(220);
      const m = await page.evaluate(measure);
      const hit = STRAY.exec(m.text);
      if (hit) stray.push(`${id}: „${hit[2]}“ v „${m.text.slice(Math.max(0, hit.index - 30), hit.index + 40).replace(/\s+/g, ' ')}“`);
      if (phone && m.sw > m.cw) overflow.push(`${id}: ${m.sw} > ${m.cw}`);
      for (const c of m.contrast.slice(0, 6)) contrast.push(`${id}: ${c}`);
    }
    check(`11 ${label}: žádný zbloudilý text „null“, „undefined“, „NaN“ ani „[object Object]“ na žádné z deseti obrazovek`, stray.length === 0, stray);
    if (phone) check(`11 ${label}: žádná obrazovka se neposouvá vodorovně`, overflow.length === 0, overflow);
    check(`11 ${label}: text je čitelný (kontrast aspoň 4,5:1, u velkého písma 3:1) na všech obrazovkách`, contrast.length === 0, contrast.slice(0, 12));
  }

  // ====================================================== A) bez kariéry
  const server = new FakeDbServer();
  const empty = await newContext(browser, { db: server, uid: 'empty', viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await open(empty.page, 'live');
  // Levé menu: každá z deseti sekcí má vlastní ikonu (jen ozdoba, skrytá čtečkám) a popisek, který tlačítko pojmenovává.
  const navInfo = await empty.page.evaluate(() =>
    [...document.querySelectorAll('#nav .navbtn')].map((b) => {
      const svg = b.querySelector('svg.navico');
      return { id: b.id, label: (b.querySelector('.navlabel') || {}).textContent || '', icon: svg ? [...svg.children].map((e) => e.getAttribute('d') || e.tagName + e.getAttribute('cx') + e.getAttribute('cy') + e.getAttribute('r')).join('|') : '', hidden: svg ? svg.getAttribute('aria-hidden') : null, name: b.textContent.trim() };
    })
  );
  check('11 menu: deset sekcí, každá s ikonou a popiskem', navInfo.length === SCREENS.length && navInfo.every((n) => n.icon && n.label.trim() && n.name === n.label.trim()), navInfo.map((n) => n.id));
  check('11 menu: ikony jsou jen ozdoba (skryté čtečkám) a každá je jiná', navInfo.every((n) => n.hidden === 'true') && new Set(navInfo.map((n) => n.icon)).size === navInfo.length, navInfo.map((n) => n.hidden));
  await sweep(empty.page, 'prázdná aplikace, tmavý vzhled, počítač');
  await empty.page.setViewportSize({ width: 390, height: 844 });
  await empty.page.emulateMedia({ colorScheme: 'light' });
  await sweep(empty.page, 'prázdná aplikace, světlý vzhled, telefon', { phone: true });
  check('11 prázdná aplikace: bez chyb ve skriptu a v konzoli', empty.problems.page.length === 0 && empty.problems.console.filter((m) => !/Failed to load resource/.test(m)).length === 0, { page: empty.problems.page, console: empty.problems.console });
  await empty.context.close();

  // ====================================================== B) s daty
  const c = await newContext(browser, { db: server, uid: 'full', viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = c.page;
  await open(page, 'tym');
  await page.fill('#careerClub', 'Chelsea');
  await page.fill('#careerComp', 'Premier League');
  await page.click('#careerCreate');
  await page.waitForSelector('#plNew');
  await page.click('#plNew');
  await page.fill('#plName', 'Jan Novák');
  await page.fill('#plPos', 'ST');
  await page.fill('#plRole', 'Útočník');
  await page.fill('#plAge', '24');
  await page.fill('#plAttrs', 'Pace 16\nFinishing 14');
  await page.click('#plSave');
  await nav(page, 'taktiky');
  await page.fill('#tacNewName', 'Hlavní 4-3-3');
  await page.selectOption('#tacNewFormation', '4-3-3');
  await page.click('#tacCreate');
  await page.waitForSelector('#tacSave');
  await nav(page, 'soupere');
  await page.fill('#oppNew', 'Sparta Praha');
  await page.click('#oppCreate');
  await page.waitForSelector('#oppSave');
  await nav(page, 'skola');
  await page.locator('.lesson-row[data-id="A1"] button').click();
  await page.click('#lessonGen');
  await page.waitForSelector('#lessonView', { timeout: 20000 });
  await nav(page, 'trener');
  await ask(page, 'Soupeř nás přehrává ve středu hřiště, co mám změnit?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  await nav(page, 'live');
  await page.fill('#liveOpp', 'Sparta Praha');
  await page.click('#liveStart');
  await page.waitForSelector('#liveCapture');
  await page.evaluate(() => (document.querySelector('#liveCapture details.manual').open = true));
  await page.fill('#lvMinute', '30');
  await page.fill('#lv-home-shots', '3');
  await page.fill('#lv-away-shots', '9');
  await page.click('#lvSave');
  await page.waitForSelector('#liveTimeline .snap');

  await sweep(page, 'naplněná aplikace, tmavý vzhled, počítač');
  await page.emulateMedia({ colorScheme: 'light' });
  await sweep(page, 'naplněná aplikace, světlý vzhled, počítač');
  await page.setViewportSize({ width: 390, height: 844 });
  await sweep(page, 'naplněná aplikace, světlý vzhled, telefon', { phone: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await sweep(page, 'naplněná aplikace, tmavý vzhled, telefon', { phone: true });

  // ukončený zápas v historii s rozborem
  await page.setViewportSize({ width: 1280, height: 900 });
  await nav(page, 'live');
  const end = page.locator('#liveHeader').getByRole('button', { name: 'Ukončit zápas' });
  await end.click();
  await page.locator('#liveHeader').getByRole('button', { name: 'Opravdu ukončit?' }).click();
  await page.waitForFunction(() => location.hash === '#historie', null, { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.match, .book', { timeout: 8000 }).catch(() => {});
  await sweep(page, 'naplněná aplikace s odehraným zápasem, tmavý vzhled, počítač');
  check('11 naplněná aplikace: bez chyb ve skriptu a v konzoli', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();

  // ====================================================== C) samostatná verze bez klíče (karta klíče a instalace)
  const s = await newContext(browser, { standalone: true, noClaude: true, viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await open(s.page, 'nastaveni');
  await sweep(s.page, 'samostatná verze, tmavý vzhled, počítač');
  await s.page.setViewportSize({ width: 390, height: 844 });
  await s.page.emulateMedia({ colorScheme: 'light' });
  await sweep(s.page, 'samostatná verze, světlý vzhled, telefon', { phone: true });
  check('11 samostatná verze: bez chyb ve skriptu a v konzoli', s.problems.page.length === 0 && s.problems.console.filter((m) => !/Failed to load resource/.test(m)).length === 0, { page: s.problems.page, console: s.problems.console });
  await s.context.close();
};
