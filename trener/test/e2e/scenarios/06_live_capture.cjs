/* Scénář 06: LIVE COACH se sdílením obrazovky v samostatné verzi. Sdílí se plátno místo skutečného okna hry,
   takže se zkouší všechno kromě operačního systému: souhlas, indikátor, brána změn, pauza, zastavení.
   Skutečné sdílení okna FM27 na Windows se z cloudu ověřit nedá. Akceptační testy zadání: 6, 7. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return fn();
  };

  const c = await newContext(browser, { db: server, uid: 'u1', standalone: true, captureCanvas: true });
  const page = c.page;
  const extractions = async () => (await page.evaluate(() => window.__mock.calls)).filter((x) => x.images === 1 && x.tier === 'quick').length;
  const timelineCount = () => page.locator('#liveTimeline .snap').count();
  const reply = (minute, shots) => ({ screen: 'match', minute, score: { home: 0, away: 0 }, teams: { home: 'Chelsea', away: 'Sparta Praha' }, stats: { home: { possession: 55, shots }, away: { possession: 45, shots: 1 } }, events: [], visibleText: ['Zápas'], notes: '' });

  await open(page, 'live');
  check('06 samostatná verze se označí jako samostatná', await page.evaluate(() => window.FM27.app.standalone === true));
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#liveStart');
  await page.evaluate(() => window.FM27.app.updateSettings({ live: { baseIntervalSec: 5, maxPerHour: 60, maxPerMatch: 20 } }));
  await page.fill('#liveOpp', 'Sparta Praha');
  await page.click('#liveStart');
  await page.waitForSelector('#liveShare');
  check('06 samostatná verze nabízí sdílení obrazovky', await page.isVisible('#liveShare'));
  check('06 limity ze Nastavení se promítly do brány', /limity 60\/h a 20\/zápas/.test(await text(page, '#liveGate')), await text(page, '#liveGate'));
  check('06 indikátor sledování je skrytý, dokud se nesdílí', !(await page.isVisible('#pillLive')));

  // rychlejší brána jen pro zkoušku
  await page.evaluate(() => {
    window.FM27.live.session.gate = window.TrenerAnalysis.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 1000, maxPerMatch: 50 });
    window.__mock.extractQueue = [{ screen: 'match', minute: 10, score: { home: 0, away: 0 }, teams: { home: null, away: null }, stats: { home: { possession: 55, shots: 1 }, away: { possession: 45, shots: 1 } }, events: [], visibleText: ['Zápas'], notes: '' }];
  });

  // ---------- souhlas zamítnut
  await page.evaluate(() => (window.__screen.denied = true));
  await page.click('#liveShare');
  await page.waitForFunction(() => /nepovolil/.test(document.querySelector('#liveCapStatus').textContent));
  check('06 když uživatel sdílení nepovolí, nic se nesleduje a řekne se to', !(await page.isVisible('#pillLive')) && /nic se nesleduje/.test(await text(page, '#liveCapStatus')), await text(page, '#liveCapStatus'));
  await page.evaluate(() => (window.__screen.denied = false));

  // ---------- sdílení běží
  await page.click('#liveShare');
  await page.waitForSelector('#pillLive:not([hidden])');
  check('06 při sdílení je vidět indikátor SLEDUJI', /SLEDUJI/.test(await text(page, '#pillLive')));
  await page.evaluate(() => window.__screen.draw(0));
  check('06 první snímek se přečte (důvod „first“)', await until(async () => (await extractions()) === 1 && (await timelineCount()) === 1, 12000), { extractions: await extractions(), tl: await timelineCount() });
  check('06 snímek ze sdílení je neověřené čtení', /přečteno z obrázku, neověřeno/.test(await text(page, '#liveTimeline')), await text(page, '#liveTimeline'));

  // ---------- skryté okno: aplikace to řekne (prohlížeč skryté okno zpomaluje, obejít to nejde)
  await page.evaluate(() => {
    window.__hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
  });
  check('06 při viditelném okně není žádné varování před zpomalením', !(await page.isVisible('#liveHidden')));
  await page.evaluate(() => {
    window.__hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check('06 při skrytém okně aplikace varuje, že sledování může být pomalejší, a radí okno nechat vidět', (await page.isVisible('#liveHidden')) && /Okno aplikace je teď skryté/.test(await text(page, '#liveHidden')) && /vedle hry/.test(await text(page, '#liveHidden')), await text(page, '#liveHidden'));
  await page.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check('06 po návratu okna varování zmizí', !(await page.isVisible('#liveHidden')));

  // ---------- nezměněná obrazovka se neposílá
  await page.waitForTimeout(3500);
  check('06 nezměněná obrazovka se znovu neposílá (šetří se spotřeba)', (await extractions()) === 1, await extractions());
  const stats = await page.evaluate(() => window.FM27.live.session.gate.stats());
  check('06 brána eviduje přeskočené snímky', Object.keys(stats.skipped).length > 0 && stats.processed === 1, stats);

  // ---------- změna obrazovky se zpracuje
  await page.evaluate((r) => ((window.__mock.extractQueue = [r]), window.__screen.draw(1)), reply(25, 3));
  check('06 změněná obrazovka se po ustálení zpracuje', await until(async () => (await extractions()) === 2 && (await timelineCount()) === 2, 12000), { extractions: await extractions(), tl: await timelineCount() });

  // ---------- pauza
  await page.click('#livePause');
  check('06 pauza skryje indikátor a změní tlačítko', !(await page.isVisible('#pillLive')) && /Pokračovat/.test(await text(page, '#livePause')), await text(page, '#livePause'));
  await page.evaluate(() => window.__screen.draw(2));
  await page.waitForTimeout(3500);
  check('06 při pauze se nic neposílá', (await extractions()) === 2, await extractions());
  await page.evaluate((r) => (window.__mock.extractQueue = [r]), reply(40, 5));
  await page.click('#livePause');
  await page.waitForSelector('#pillLive:not([hidden])');
  await page.evaluate(() => window.__screen.draw(3));
  check('06 po pokračování se zase zpracovává', await until(async () => (await extractions()) === 3, 14000), await extractions());

  // ---------- zastavení
  await page.click('#liveStopShare');
  check('06 po zastavení zmizí indikátor a sdílení skončí', !(await page.isVisible('#pillLive')) && /zastavené/.test(await text(page, '#liveCapStatus')), await text(page, '#liveCapStatus'));
  const ended = await page.evaluate(() => window.__screen.stream.getTracks().every((t) => t.readyState === 'ended'));
  check('06 stopy sdílení se opravdu zastavily', ended);
  await page.evaluate(() => window.__screen.draw(4));
  await page.waitForTimeout(2500);
  check('06 po zastavení se nic neposílá', (await extractions()) === 3, await extractions());

  // ---------- sdílení přežije přepnutí do jiné sekce a po návratu jde zastavit
  await page.click('#liveShare');
  await page.waitForSelector('#pillLive:not([hidden])');
  await nav(page, 'nastaveni');
  await page.waitForTimeout(300);
  check('06 sdílení běží dál i po přepnutí do jiné sekce, indikátor zůstává', (await page.evaluate(() => !!window.FM27.live.session.capture)) && (await page.isVisible('#pillLive')), '');
  await nav(page, 'live');
  check('06 po návratu na LIVE COACH jsou tlačítka sdílení znovu použitelná', (await page.isEnabled('#liveStopShare')) && !(await page.locator('#liveStopShare').isDisabled()), '');
  await page.click('#liveStopShare');
  check('06 sdílení jde po návratu zastavit', !(await page.isVisible('#pillLive')) && !(await page.evaluate(() => !!window.FM27.live.session.capture)), '');

  // ---------- nález revize: zahození zápasu při sdílení vypne i štítek SLEDUJI a zruší čtení, které právě běží
  await page.click('#liveShare');
  await page.waitForSelector('#pillLive:not([hidden])');
  await page.evaluate(() => (window.__mock.extractDelayMs = 4000));
  await page.evaluate((r) => (window.__mock.extractQueue = [r]), reply(70, 6));
  await page.evaluate(() => window.__screen.draw(7));
  await until(async () => (await page.evaluate(() => window.FM27.live.session.busy)) === true, 14000);
  await page.locator('#liveHeader').getByRole('button', { name: 'Zahodit zápas' }).click();
  await page.locator('#liveHeader').getByRole('button', { name: 'Opravdu zahodit?' }).click();
  await page.waitForSelector('#liveStart');
  check('06 po zahození zápasu při sdílení zmizí štítek SLEDUJI a sdílení se zastaví', !(await page.isVisible('#pillLive')) && !(await page.evaluate(() => !!window.FM27.live.session.capture)), await page.isVisible('#pillLive'));
  await page.fill('#liveOpp', 'Jiný soupeř');
  await page.click('#liveStart');
  await page.waitForSelector('#liveCapture');
  await page.waitForTimeout(1500);
  const snaps = await page.evaluate(() => window.FM27.app.store.list('match').filter((m) => m.status === 'live').map((m) => ({ opp: m.opponent, n: m.timeline.length })));
  check('06 čtení snímku, které běželo při zahození zápasu, se nezapsalo do nového zápasu', snaps.length === 1 && snaps[0].opp === 'Jiný soupeř' && snaps[0].n === 0, snaps);
  await page.evaluate(() => (window.__mock.extractDelayMs = 0));

  check('06 bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
  await c.context.close();
};
