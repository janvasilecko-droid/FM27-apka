/* Scénář 13: SDÍLENÍ OBRAZOVKY VE STRÁNCE V CLAUDE. Stránka v Claude běží v rámečku claude.ai, který jí sdílení obrazovky buď povolí
   (atribut allow="display-capture"), nebo ne. Aplikace to zjistí předem (document.permissionsPolicy) a podle toho nabídne sdílení,
   nebo ruční vkládání snímků; Nastavení říká, jak to dopadlo. Rámeček claude.ai se napodobuje stránkou z jiného původu
   (wrapper.test), která vkládá aplikaci s povolením a bez povolení. Skutečný rámeček claude.ai se z cloudu ověřit nedá:
   proto je právě tenhle řádek v Nastavení určený k tomu, aby majitel viděl skutečný výsledek. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, text } = h;

  const c = await newContext(browser, { captureCanvas: true });
  const page = c.page;
  const wrapper = (allow) => `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" src="https://artifact.test/#nastaveni" ${allow ? 'allow="display-capture"' : ''} style="width:1200px;height:850px;border:0"></iframe>`;
  await c.context.route('https://wrapper.test/allow', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: wrapper(true) }));
  await c.context.route('https://wrapper.test/deny', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: wrapper(false) }));

  const openFramed = async (kind) => {
    await page.goto('https://wrapper.test/' + kind);
    const frame = await (async () => {
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const f = page.frames().find((x) => /artifact\.test/.test(x.url()));
        if (f) return f;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    })();
    await frame.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
    return frame;
  };

  // ---------- rámeček s povolením
  let frame = await openFramed('allow');
  check('13 stránka v rámečku s povolením pozná, že je v rámečku a že sdílení obrazovky smí', (await frame.evaluate(() => window.self !== window.top)) && (await frame.evaluate(() => window.FM27.live.framedCaptureAllowed())) === true);
  check('13 sdílení obrazovky je dostupné, i když to není samostatná verze', (await frame.evaluate(() => window.FM27.app.standalone)) !== true && (await frame.evaluate(() => window.FM27.live.captureAvailable())) === true);
  await frame.waitForSelector('#diag');
  check('13 Nastavení říká, že okno claude.ai sdílení povoluje', /Sdílení obrazovky v tomto okně\s*ano \(okno claude\.ai to stránce povoluje\)/.test(await frame.locator('#diag').innerText()), await frame.locator('#diag').innerText());
  check('13 hlasový vstup a oznámení zůstávají jen v samostatné verzi (sdílení obrazovky je jediná změna)', /Hlasový vstup \(mikrofon\)\s*ne \(jen v samostatné verzi\)/.test(await frame.locator('#diag').innerText()));
  // Live Coach: po založení kariéry a zápasu je tlačítko Sdílet obrazovku
  await frame.evaluate(() => (location.hash = '#live'));
  await frame.waitForSelector('#careerClub', { timeout: 10000 });
  await frame.fill('#careerClub', 'Chelsea');
  await frame.click('#careerCreate');
  await frame.waitForSelector('#liveStart');
  await frame.fill('#liveOpp', 'Sparta Praha');
  await frame.click('#liveStart');
  // když se tlačítko neukáže, chyba řekne proč (zpráva formuláře, vyplněný soupeř, jestli formulář ještě je): jednou za čas tu spadl úplný běh a samostatný scénář pak desítkykrát prošel
  await frame.waitForSelector('#liveShare', { timeout: 10000 }).catch(async (e) => {
    const state = await frame.evaluate(() => ({ hash: location.hash, setupMsg: (document.querySelector('#liveSetupMsg') || {}).textContent || null, opponent: document.querySelector('#liveOpp') ? document.querySelector('#liveOpp').value : null, formStillThere: !!document.querySelector('#liveStart') })).catch(() => null);
    throw new Error('13: tlačítko „Sdílet obrazovku FM27“ se neukázalo po založení zápasu: ' + JSON.stringify(state) + ' | ' + e.message);
  });
  check('13 Live Coach ve stránce v Claude nabízí „Sdílet obrazovku FM27“', await frame.isVisible('#liveShare'));
  check('13 nenabízí se text „stránka nesmí sama snímat obrazovku“', !/nesmí sama snímat obrazovku/.test(await frame.locator('#liveCapStatus').evaluate((el) => el.parentElement.innerText)));
  await frame.click('#liveShare');
  await frame.waitForFunction(() => !document.querySelector('#pillLive').hidden, null, { timeout: 8000 }).catch(() => {});
  check('13 sdílení se spustí a ukáže se štítek SLEDUJI', !(await frame.evaluate(() => document.querySelector('#pillLive').hidden)));
  await frame.click('#liveStopShare');
  check('13 sdílení jde zastavit', await frame.evaluate(() => document.querySelector('#pillLive').hidden));

  // ---------- rámeček bez povolení (jako by ho claude.ai nepovolil)
  frame = await openFramed('deny');
  check('13 rámeček bez povolení: stránka pozná, že sdílení smět nebude', (await frame.evaluate(() => window.FM27.live.framedCaptureAllowed())) === false && (await frame.evaluate(() => window.FM27.live.captureAvailable())) === false);
  await frame.waitForSelector('#diag');
  check('13 Nastavení říká proč a co dělat místo toho', /Sdílení obrazovky v tomto okně\s*ne: okno claude\.ai sdílení obrazovky stránkám nepovoluje, snímky vkládej ručně/.test(await frame.locator('#diag').innerText()), await frame.locator('#diag').innerText());
  await frame.evaluate(() => (location.hash = '#live'));
  // kariéra i rozehraný zápas z předchozího rámečku zůstaly v úložišti téhož původu: buď se zápas rovnou obnoví, nebo se založí nový
  await frame.waitForSelector('#liveOpp, #liveDrop', { timeout: 10000 });
  if (await frame.locator('#liveOpp').count()) {
    await frame.fill('#liveOpp', 'Sparta Praha');
    await frame.click('#liveStart');
  }
  await frame.waitForSelector('#liveDrop', { timeout: 10000 });
  check('13 bez povolení se nabízí vkládání snímků (Ctrl+V), ne sdílení', (await frame.locator('#liveShare').count()) === 0 && /nesmí sama snímat obrazovku/.test(await frame.locator('#liveCapStatus').evaluate((el) => el.parentElement.innerText)));

  // ---------- samostatná zkouška logiky s předstíraným prostředím a stránka bez rámečku
  await page.goto('https://artifact.test/#nastaveni');
  await page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  const logic = await page.evaluate(() => ({
    top: window.FM27.live.framedCaptureAllowed(),
    fakeAllowed: window.FM27.live.framedCaptureAllowed({ framed: true, policy: { allowsFeature: (f) => f === 'display-capture' } }),
    fakeDenied: window.FM27.live.framedCaptureAllowed({ framed: true, policy: { allowsFeature: () => false } }),
    fakeNoApi: window.FM27.live.framedCaptureAllowed({ framed: true, policy: {} }),
    fakeThrows: window.FM27.live.framedCaptureAllowed({ framed: true, policy: { allowsFeature: () => { throw new Error('x'); } } }),
    reason: window.FM27.live.captureReason(),
  }));
  check('13 mimo rámeček (samostatná stránka bez samostatné verze) se sdílení nenabízí a důvod to říká', logic.top === false && /ne \(jen v samostatné verzi\)/.test(logic.reason), logic);
  check('13 rozhodnutí se řídí jen hodnotou allowsFeature (povoleno ano, zakázáno ne, bez API ne, výjimka ne)', logic.fakeAllowed === true && logic.fakeDenied === false && logic.fakeNoApi === false && logic.fakeThrows === false, logic);
  check('13 bez chyb ve skriptu a v konzoli (kromě blokovaných zdrojů)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
