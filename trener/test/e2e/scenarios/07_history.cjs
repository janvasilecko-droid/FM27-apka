/* Scénář 07: Historie zápasů a analýza po zápase: uložený zápas, výsledek a poznámky, průběh po obdobích, změny před a po,
   rozbor s kontrolou poctivosti, uložení do paměti kariéry, mazání a synchronizace.
   Akceptační testy zadání: 13 (historie se uloží), § 11 (zpráva po zápase), § 5 (zkušenosti z předchozích zápasů). */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, ask, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 5000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };
  const stats = (pos, shots, sot, xg, ashots, asot, axg) => ({ home: { possession: pos, shots, shotsOnTarget: sot, xg }, away: { possession: 100 - pos, shots: ashots, shotsOnTarget: asot, xg: axg } });
  const snap = (id, minute, provenance, st, score) => ({ id, at: 1000 + minute, minute, score, screen: 'stats', stats: Object.fromEntries(['home', 'away'].map((s) => [s, Object.assign({ passes: null, passAccuracy: null, tackles: null, fouls: null, corners: null, offsides: null, saves: null }, st[s])])), events: [], provenance, notes: '', teams: null, visibleText: [], players: [] });

  const c = await newContext(browser, { db: server, uid: 'u1' });
  const page = c.page;
  await open(page, 'historie');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#histList, .empty');
  check('07 bez zápasů je prázdný stav s odkazem na LIVE COACH', /Zatím žádný zápas/.test(await text(page, '#main')) && (await page.getByRole('button', { name: 'Přejít na LIVE COACH' }).count()) === 1, await text(page, '#main'));

  // uložený zápas (jako by vznikl v Live Coach)
  const matchId = await page.evaluate(
    async ({ timeline, changes }) => {
      const career = window.FM27.app.career();
      const saved = await window.FM27.app.store.put('match', { careerId: career.id, opponent: 'Sparta Praha', competition: '', mySide: 'home', date: 5000, startedAt: 5000, status: 'finished', result: null, timeline, changes, notes: '', analysis: null });
      return saved.id;
    },
    {
      timeline: [snap('snap-a', 20, 'vision_unverified', stats(55, 2, 1, 0.3, 4, 2, 0.9), { home: 0, away: 0 }), snap('snap-b', 35, 'user_entered', stats(52, 3, 1, 0.5, 7, 4, 1.8), { home: 0, away: 1 }), snap('snap-c', 50, 'user_entered', stats(53, 4, 1, 0.7, 10, 5, 2.1), { home: 0, away: 2 }), snap('snap-d', 55, 'user_entered', stats(54, 5, 2, 0.9, 11, 5, 2.2), { home: 0, away: 2 }), snap('snap-e', 64, 'user_entered', stats(56, 9, 4, 1.5, 12, 5, 2.4), { home: 1, away: 2 })],
      changes: [{ id: 'chg-test1', at: 6000, minute: 50, summary: 'Útočník: role útočníka, z „izolovaný“ na „podporující“', items: [{ player: 'Útočník', setting: 'role útočníka', from: 'izolovaný', to: 'podporující' }], baselineIds: ['snap-a', 'snap-b', 'snap-c'], recheckAfterMinutes: 10 }],
    }
  );
  await nav(page, 'tym');
  await nav(page, 'historie');
  await page.waitForSelector('#histList .match');
  check('07 zápas je v historii s výsledkem „neznámý“ a počtem snímků', /Sparta Praha/.test(await text(page, '#histList')) && /výsledek neznámý/.test(await text(page, '#histList')) && /5 snímků/.test(await text(page, '#histList')), await text(page, '#histList'));
  check('07 detail ukazuje průběh po obdobích', /min/.test(await text(page, '#main')) && (await page.locator('#main .diag div').count()) > 3, '');
  check('07 u změny je vyhodnocení před a po a věta o příčině', /Naše střely na 10 min/.test(await text(page, '#main')) && /Časová souvislost není důkaz příčiny/.test(await text(page, '#liveCausality')), '');

  // výsledek a poznámky
  await page.fill('#histHome', '1');
  await page.fill('#histAway', '2');
  await page.fill('#histNotes', 'Soupeř nás přehrával ve středu hřiště.');
  await page.click('#histSave');
  await until(async () => (await page.evaluate((id) => window.FM27.app.store.get('match', id).result, matchId)) !== null);
  const m1 = await page.evaluate((id) => window.FM27.app.store.get('match', id), matchId);
  check('07 výsledek a poznámky se uloží', m1.result.home === 1 && m1.result.away === 2 && /přehrával/.test(m1.notes), { result: m1.result });
  await page.waitForTimeout(200);
  check('07 historie ukazuje výsledek 1:2', /1:2/.test(await text(page, '#histList')), await text(page, '#histList'));

  // rozbor po zápase
  await page.click('#histReport');
  await page.waitForSelector('#histReportBox .banner.ok', { timeout: 20000 });
  const prompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /píšeš rozbor odehraného zápasu/.test(p)).pop() || '';
  check('07 do rozboru jdou období, součty, změna s vyhodnocením a poznámka', /- sum-\d+ \| heuristic_coach/.test(prompt) && /- sum-total \| heuristic_coach/.test(prompt) && /- chg-test1 \| heuristic_coach/.test(prompt) && /- note-1 \| user_entered/.test(prompt) && /Změna 50\. min/.test(prompt), prompt.slice(prompt.indexOf('Pozorování'), prompt.indexOf('Pozorování') + 400));
  check('07 prompt zakazuje příčinné tvrzení a hráče mimo soupisku', /ČASOVÁ SOUVISLOST NENÍ DŮKAZ PŘÍČINY/.test(prompt) && /Hráče uváděj jen jmény ze soupisu|jmény ze soupisky/.test(prompt), '');
  const rep = await text(page, '#histReportBox');
  check('07 rozbor prošel kontrolou a ukazuje příští utkání i omezení', /prošel kontrolou poctivosti/i.test(rep) && /Co změnit pro příští utkání/i.test(rep) && /Omezení rozboru/i.test(rep), rep.slice(0, 400));
  const saved = await page.evaluate((id) => window.FM27.app.store.get('match', id).analysis, matchId);
  check('07 rozbor se uloží k zápasu bez textů knih', saved && saved.report && saved.report.nextMatch.items.length >= 1 && Object.values(saved.passages || {}).every((p) => !('text' in p)), saved && Object.keys(saved));

  // paměť kariéry
  await page.locator('#histReportBox [data-act="memory"]').first().click();
  await until(async () => (await page.evaluate(() => window.FM27.context.memory(window.FM27.app).lessons.length)) === 1);
  check('07 poznatek z rozboru se uloží do paměti kariéry po stisku tlačítka', (await page.evaluate(() => window.FM27.context.memory(window.FM27.app).lessons.length)) === 1);
  await nav(page, 'trener');
  check('07 poradce hlásí, že má paměť z minulých zápasů', /paměť: 1 poznámka/.test(await text(page, '#ctxNote')), await text(page, '#ctxNote'));
  await ask(page, 'Jak dál?');
  const adv = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /Pozorování \(id/.test(p)).pop() || '';
  check('07 do další rady jde zkušenost z minulého zápasu jako odhad (heuristic_coach)', /- mem-1 \| heuristic_coach/.test(adv) && /Zkušenost z dřívějška/.test(adv), adv.slice(adv.indexOf('Pozorování'), adv.indexOf('Pozorování') + 600));

  // neplatný rozbor se nezobrazí
  await nav(page, 'historie');
  await page.evaluate(() => (window.__mock.mode = 'special-invalid'));
  await page.click('#histReport');
  await page.waitForSelector('#histReportBox .banner.warn', { timeout: 20000 });
  check('07 rozbor, který neprojde kontrolou, se nezobrazí a nabídne zkusit znovu', /neprošel kontrolou poctivosti/.test(await text(page, '#histReportBox')) && (await page.getByRole('button', { name: 'Zkusit znovu' }).count()) >= 1 && (await page.locator('#histReportBox .sec').count()) === 0, await text(page, '#histReportBox'));
  await page.evaluate(() => (window.__mock.mode = 'ok'));

  // málo snímků = bez rozboru
  const shortId = await page.evaluate(async (s) => (await window.FM27.app.store.put('match', { careerId: window.FM27.app.career().id, opponent: 'Slavia', competition: '', mySide: 'away', date: 9000, startedAt: 9000, status: 'finished', result: { home: 0, away: 0 }, timeline: [s], changes: [], notes: '', analysis: null })).id, snap('snap-x', 10, 'user_entered', stats(50, 1, 0, 0.1, 1, 0, 0.1), { home: 0, away: 0 }));
  await page.reload();
  await page.waitForFunction(() => window.__trenerReady === true);
  await nav(page, 'historie');
  await page.locator(`#histList .match[data-id="${shortId}"] button`).click();
  await page.click('#histReport');
  await page.waitForFunction(() => /aspoň dva snímky/.test(document.querySelector('#toast').textContent) && !document.querySelector('#toast').hidden);
  check('07 zápas s jedním snímkem se bez dat neanalyzuje', true);

  // synchronizace na telefon
  const phone = await newContext(browser, { db: server, uid: 'u1', viewport: { width: 390, height: 844 } });
  await open(phone.page, 'historie');
  await phone.page.waitForSelector('#histList .match', { timeout: 10000 });
  check('07 telefon: zápasy a rozbor se synchronizovaly', (await phone.page.locator('#histList .match').count()) === 2 && /Sparta Praha/.test(await text(phone.page, '#histList')), await text(phone.page, '#histList'));
  await phone.page.locator(`#histList .match[data-id="${matchId}"] button`).click();
  await phone.page.waitForSelector('#histReportBox .banner.ok', { timeout: 8000 });
  check('07 telefon: uložený rozbor je vidět', /Rozbor prošel kontrolou/.test(await text(phone.page, '#histReportBox')), '');
  const o = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('07 telefon: historie bez vodorovného posouvání', o.sw <= o.cw, o);

  // mazání
  const del = page.locator('#main section', { hasText: 'Průběh po obdobích' }).first();
  void del;
  await page.locator(`#histList .match[data-id="${shortId}"] button`).click();
  const delBtn = page.getByRole('button', { name: 'Smazat zápas' });
  await delBtn.click();
  await page.getByRole('button', { name: 'Opravdu smazat?' }).click();
  await until(async () => (await page.locator('#histList .match').count()) === 1);
  check('07 zápas jde smazat', (await page.locator('#histList .match').count()) === 1);

  for (const x of [c, phone]) {
    check('07 bez chyb ve skriptu', x.problems.page.length === 0, x.problems.page);
    await x.context.close();
  }
};
