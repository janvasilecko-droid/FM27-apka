/* Scénář 04: Taktická laboratoř (hřiště, přesouvání, rozbor prostoru, porovnání, soupeř, vysvětlení od modelu)
   a Analýza soupeře (profil s původem údajů, čtení screenshotu, předzápasový plán s kontrolou poctivosti).
   Akceptační testy zadání: 3 (zobrazí taktické údaje), 8 (vyhodnotí problémy), § 6 a § 7. */
module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, open, nav, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 5000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };

  const c = await newContext(browser, { db: server, uid: 'u1' });
  const page = c.page;
  const slot = (key) => page.evaluate((k) => window.FM27.app.store.list('tactic')[0].slots.find((s) => s.key === k), key);

  await open(page, 'laborator');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#labCreate');
  check('04 bez taktiky laboratoř nabídne vytvoření', /Nejdřív potřebuješ taktiku/.test(await text(page, '#main')), await text(page, '#main'));
  await page.click('#labCreate');
  await page.waitForSelector('svg.pitch .pl');
  check('04 hřiště ukazuje 11 hráčů', (await page.locator('svg.pitch .pl').count()) === 11);
  check('04 rozložení je popsané v číslech (řady, velikost, třetiny)', /řady podle nakreslené svislé polohy/.test(await text(page, '#labFacts')) && /hloubka týmu/.test(await text(page, '#labFacts')), await text(page, '#labFacts'));
  check('04 výchozí 4-3-3 nehlásí žádný konflikt', /nenašlo nic/.test(await text(page, '#labConflicts')), await text(page, '#labConflicts'));

  // ---------- přetažení hráče na hřišti myší
  const centre = async (key) => {
    await page.evaluate(() => document.querySelector('svg.pitch').scrollIntoView({ block: 'start' }));
    const b = await page.locator(`svg.pitch .pl[data-key="${key}"] circle`).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const st = await centre('s10');
  const box2 = await page.locator('svg.pitch').boundingBox();
  await page.mouse.move(st.x, st.y);
  await page.mouse.down();
  await page.mouse.move(st.x, box2.y + box2.height * 0.04, { steps: 6 });
  await page.mouse.up();
  await until(async () => (await slot('s10')).y < 10);
  const moved = await slot('s10');
  check('04 přetažení útočníka změní jeho souřadnici a uloží se', moved.y < 10 && moved.x === 50, moved);
  check('04 laboratoř přepočítá rozložení: útočník je daleko od zbytku', /nejvíc vysunutý hráč/.test(await text(page, '#labConflicts')), await text(page, '#labConflicts'));
  check('04 konflikt říká, že práh je heuristika, ne pravidlo FM27', /heuristik/i.test(await text(page, '#labConflicts')), await text(page, '#labConflicts'));
  await page.locator('#labConflicts .conflict').first().click();
  check('04 kliknutí na konflikt zvýrazní dotčené hráče', (await page.locator('svg.pitch .pl.hi').count()) >= 1, await page.locator('svg.pitch .pl.hi').count());

  // fáze bez míče má vlastní souřadnice
  await page.click('#labPhase-out');
  const out0 = await centre('s5');
  await page.mouse.move(out0.x, out0.y);
  await page.mouse.down();
  await page.mouse.move(out0.x + 30, out0.y - 20, { steps: 5 });
  await page.mouse.up();
  await until(async () => { const s = await slot('s5'); return s.ox !== s.x || s.oy !== s.y; });
  const s5 = await slot('s5');
  check('04 pohyb ve fázi „bez míče“ mění jen její souřadnice', (s5.ox !== s5.x || s5.oy !== s5.y) && s5.x === 19 && s5.y === 76, s5);
  await page.click('#labPhase-in');

  // klávesnice
  const y0 = (await slot('s6')).y;
  await page.locator('svg.pitch .pl[data-key="s6"]').focus();
  await page.keyboard.press('ArrowDown');
  await until(async () => (await slot('s6')).y === y0 + 1);
  check('04 hráče jde posunout šipkami (bez myši)', (await slot('s6')).y === y0 + 1, await slot('s6'));

  // vazby, zóny
  await page.check('#labLinks');
  await page.check('#labZones');
  check('04 vazby a zóny se vykreslí', (await page.locator('svg.pitch .links line').count()) > 5 && (await page.locator('svg.pitch .zones text').count()) > 0, '');
  await page.uncheck('#labLinks');
  await page.uncheck('#labZones');

  // porovnání dvou taktik a soupeřova formace
  await page.evaluate(async () => {
    const T = window.TrenerTactics;
    const t = T.makeTactic({ formation: '4-4-2', name: 'Alternativa 4-4-2', kind: 'alternative' });
    await window.FM27.app.store.put('tactic', Object.assign(t, { careerId: window.FM27.app.career().id }));
  });
  await nav(page, 'taktiky');
  await nav(page, 'laborator');
  await page.selectOption('#labB', { label: 'Alternativa 4-4-2 (4-4-2)' });
  check('04 porovnání ukáže rozdíly a nakreslí druhou taktiku čárkovaně', /Porovnání s/i.test(await text(page, '#labCompare')) && (await page.locator('svg.pitch .ghost circle').count()) === 11, await text(page, '#labCompare'));
  await page.selectOption('#labOpp', '3-5-2');
  check('04 po zvolení soupeřovy formace se zobrazí jeho body a rozbor přečíslení', (await page.locator('svg.pitch .opp circle').count()) === 11 && /Soupeř proti tvému tvaru/i.test(await text(page, '#labOverload')), await text(page, '#labOverload'));

  // ---------- vysvětlení od modelu
  await page.click('#labExplainBtn');
  await page.waitForSelector('#labExplain .banner.ok', { timeout: 20000 });
  const prompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /vysvětluješ, jak je postavené rozložení/.test(p)).pop() || '';
  check('04 model dostane sloty, geometrická fakta a pravidla (fakta nejsou chování hráčů)', /- s1 \| GK \|/.test(prompt) && /- geo-shape-lines \|/.test(prompt) && /Fakta jsou geometrie bodů/.test(prompt), prompt.slice(0, 300));
  check('04 vysvětlení prošlo kontrolou a říká, že o chování hráčů ve FM27 nic netvrdí', /O chování hráčů ve FM27 nic netvrdí/.test(await text(page, '#labExplain')), await text(page, '#labExplain'));
  await page.getByRole('button', { name: 'Poslat nálezy trenérovi' }).click();
  await page.waitForFunction(() => location.hash === '#trener');
  await page.waitForSelector('#obsList li');
  check('04 nálezy z laboratoře se předají trenérovi jako pozorování', (await page.locator('#obsList li').count()) >= 1 && /nejvíc vysunutý/.test(await text(page, '#obsList')), await text(page, '#obsList'));
  await nav(page, 'laborator');
  await page.evaluate(() => (window.__mock.mode = 'special-invalid'));
  await page.click('#labExplainBtn');
  await page.waitForSelector('#labExplain .banner.warn', { timeout: 20000 });
  check('04 vysvětlení, které neprojde kontrolou, se nezobrazí', /neprošlo kontrolou poctivosti/.test(await text(page, '#labExplain')) && (await page.locator('#labExplain .sec').count()) === 0, await text(page, '#labExplain'));
  await page.evaluate(() => (window.__mock.mode = 'ok'));

  // ---------- telefon
  const phone = await newContext(browser, { db: server, uid: 'u1', viewport: { width: 390, height: 844 } });
  await open(phone.page, 'laborator');
  await phone.page.waitForSelector('svg.pitch .pl', { timeout: 10000 });
  const o = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('04 telefon: laboratoř bez vodorovného posouvání', o.sw <= o.cw, o);
  // Hřiště se při příchodu synchronizovaných dat může překreslit; měří se uvnitř stránky, až je k dispozici.
  await phone.page.waitForFunction(() => { const el = document.querySelector('svg.pitch'); return !!el && el.getBoundingClientRect().width > 0; }, null, { timeout: 10000 }).catch(() => {});
  const pb = await phone.page.evaluate(() => { const el = document.querySelector('svg.pitch'); const r = el && el.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; });
  check('04 telefon: hřiště se vejde na šířku', !!pb && pb.width <= 390 && pb.width > 250, pb);
  const movedOnPhone = await phone.page.evaluate(() => window.FM27.app.store.list('tactic').find((t) => t.name !== 'Alternativa 4-4-2').slots.find((s) => s.key === 's10').y);
  check('04 telefon: přesunutý útočník je vidět i na telefonu (synchronizace)', movedOnPhone < 10, movedOnPhone);
  await phone.context.close();

  // ================= ANALÝZA SOUPEŘE
  await nav(page, 'soupere');
  await page.fill('#oppNew', 'Sparta Praha');
  await page.click('#oppCreate');
  await page.waitForSelector('#oppSave');
  await page.click('#oppPlanBtn');
  check('04 plán bez jediného údaje o soupeři se nepřipraví', /Vyplň aspoň jeden údaj o soupeři/.test(await text(page, '#toast')), await text(page, '#toast'));
  await page.fill('#oppF-formation', '4-2-3-1');
  await page.fill('#oppF-keyPlayers', 'Novák – hrot');
  await page.fill('#oppF-pressingHeight', 'Napadá vysoko po ztrátě');
  await page.selectOption('#oppP-pressingHeight', 'vision_unverified');
  await page.click('#oppSave');
  await until(async () => (await page.evaluate(() => Object.keys(window.FM27.app.store.list('opponent')[0].fields).length)) === 3);
  const prof = await page.evaluate(() => window.FM27.app.store.list('opponent')[0]);
  check('04 profil soupeře uchová u každého údaje jeho původ', prof.fields.formation.prov === 'user_entered' && prof.fields.pressingHeight.prov === 'vision_unverified', prof.fields);
  await page.click('#oppPlanBtn');
  await page.waitForSelector('#oppPlan .banner.ok', { timeout: 20000 });
  const op = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /předzápasový plán proti soupeři/.test(p)).pop() || '';
  check('04 do plánu jdou údaje o soupeři s původem a tým s taktikou kariéry', /- opp-formation \| user_entered/.test(op) && /- opp-pressingHeight \| vision_unverified/.test(op) && /- career \| user_entered/.test(op) && /- tactic \| user_entered/.test(op), op.slice(op.indexOf('Pozorování'), op.indexOf('Pozorování') + 500));
  const planText = await text(page, '#oppPlan');
  check('04 plán má všechny části: napadání, získání míče, strana, prostory, hráč, riziko, jistota, co neví', /Jak soupeře napadat/i.test(planText) && /Kde získávat míč/i.test(planText) && /Kterou stranu využívat/i.test(planText) && /Které prostory obsazovat/i.test(planText) && /Kterého hráče omezit: Novák/i.test(planText) && /Rizika/i.test(planText) && /Jistota/i.test(planText) && /Co trenér neví/i.test(planText), planText.slice(0, 300));
  check('04 plán nikdy nemá vysokou jistotu bez dvou ověřených údajů', !/vysoká/i.test(await text(page, '#oppPlan .sec:nth-of-type(7)')), '');
  await page.reload();
  await page.waitForFunction(() => window.__trenerReady === true);
  await nav(page, 'soupere');
  check('04 uložený plán je po obnovení stránky vidět', /Uložený plán z/.test(await text(page, '#oppPlan')), await text(page, '#oppPlan'));

  // čtení screenshotu soupeře
  await page.setInputFiles('#oppShot', fx('screenshot.png'));
  await page.click('#oppRead');
  await page.waitForSelector('#oppProposals .book', { timeout: 15000 });
  check('04 čtení screenshotu soupeře je jen návrh (nic se nepřepíše samo)', /jen návrh/.test(await text(page, '#oppShotStatus')) && (await page.inputValue('#oppF-formation')) === '4-2-3-1', await text(page, '#oppShotStatus'));
  await page.evaluate(() => (window.__mock.oppReadReply = { formation: '3 5 2', roles: [], keyPlayers: [], strengths: [], weaknesses: [], notes: '' }));
  await page.locator('#oppProposals .book', { hasText: 'Rozestavení' }).getByRole('button', { name: /Použít/ }).click();
  await until(async () => (await page.inputValue('#oppF-formation')) !== '4-2-3-1');
  check('04 použitá hodnota ze screenshotu je označená jako neověřená', (await page.inputValue('#oppP-formation')) === 'vision_unverified' && (await page.inputValue('#oppF-formation')) === '4-2-3-1' || (await page.inputValue('#oppP-formation')) === 'vision_unverified', await page.inputValue('#oppP-formation'));

  // plán, který neprojde kontrolou
  await page.evaluate(() => (window.__mock.mode = 'special-invalid'));
  await page.click('#oppPlanBtn');
  await page.waitForSelector('#oppPlan .banner.warn', { timeout: 20000 });
  check('04 plán, který neprojde kontrolou, se nezobrazí', /neprošel kontrolou poctivosti/.test(await text(page, '#oppPlan')), await text(page, '#oppPlan'));
  await page.evaluate(() => (window.__mock.mode = 'ok'));

  // smazání
  await page.getByRole('button', { name: 'Smazat soupeře' }).click();
  await page.getByRole('button', { name: 'Opravdu smazat?' }).click();
  await until(async () => (await page.evaluate(() => window.FM27.app.store.list('opponent').length)) === 0);
  check('04 soupeře jde smazat', (await page.evaluate(() => window.FM27.app.store.list('opponent').length)) === 0);

  check('04 bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
  const consoleErrors = c.problems.console.filter((m) => !/Failed to load resource/.test(m));
  check('04 bez chyb v konzoli', consoleErrors.length === 0, consoleErrors);
  await c.context.close();
};
