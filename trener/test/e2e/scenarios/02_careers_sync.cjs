/* Scénář 02: kariéry, ukládání a synchronizace počítač ↔ telefon, záloha a smazání dat.
   Akceptační testy zadání: 1 (stejný účet na počítači i telefonu), 14 (změny se synchronizují s telefonem), § 15 (smazání dat). */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  // Zápis do db je odložený (sloučení dávek), proto se na server čeká.
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 4000);
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };

  const careerOptions = (page) => page.locator('#careerSelect option').allInnerTexts();
  const waitOptions = (page, n, timeout) => page.waitForFunction((x) => document.querySelectorAll('#careerSelect option').length === x, n, { timeout: timeout || 8000 }).then(() => true, () => false);
  async function createCareer(page, club, comp, season) {
    await page.click('#careerNew');
    await page.fill('#careerClub', club);
    await page.fill('#careerComp', comp || '');
    await page.fill('#careerSeason', season || '');
    await page.click('#careerCreate');
    await page.waitForSelector('#careerSelect');
  }

  // ---------- počítač
  const pc = await newContext(browser, { db: server, uid: 'u1' });
  await open(pc.page, 'live');
  await pc.page.waitForFunction(() => /Synchronizace: zapnutá/.test(document.querySelector('#pillSync').textContent), null, { timeout: 8000 }).catch(() => {});
  check('02 počítač: synchronizace je zapnutá', /Synchronizace: zapnutá/.test(await text(pc.page, '#pillSync')), await text(pc.page, '#pillSync'));
  check('02 počítač: bez kariéry je v hlavičce výzva k založení', await pc.page.isVisible('#careerNew'));

  await nav(pc.page, 'tym').catch(() => {});
  await createCareer(pc.page, 'Chelsea', 'Premier League', '2026/27');
  check('02 počítač: kariéra je založená a vybraná', (await careerOptions(pc.page)).join() === 'Chelsea (2026/27)', await careerOptions(pc.page));
  await until(() => server.docs.size > 0);
  check('02 data jsou na serveru jen v soukromé podsložce uživatele u1', [...server.docs.keys()].length > 0 && [...server.docs.keys()].every((k) => k.startsWith('data/users/u1/')), [...server.docs.keys()]);

  // ---------- telefon, stejný účet
  const phone = await newContext(browser, { db: server, uid: 'u1', viewport: { width: 390, height: 844 } });
  await open(phone.page, 'live');
  check('02 telefon: kariéra z počítače se objeví (synchronizace)', await waitOptions(phone.page, 1), await careerOptions(phone.page));
  check('02 telefon: je to ta samá kariéra', (await careerOptions(phone.page)).join() === 'Chelsea (2026/27)', await careerOptions(phone.page));

  await createCareer(phone.page, 'Sparta Praha', 'Chance liga', '2026/27');
  check('02 počítač: kariéra založená na telefonu se objeví', await waitOptions(pc.page, 2), await careerOptions(pc.page));

  // ---------- cizí účet nevidí nic
  const other = await newContext(browser, { db: server, uid: 'u2' });
  await open(other.page, 'live');
  await other.page.waitForFunction(() => /Synchronizace: zapnutá/.test(document.querySelector('#pillSync').textContent), null, { timeout: 8000 }).catch(() => {});
  await other.page.waitForTimeout(300);
  check('02 jiný účet nevidí cizí kariéry', (await other.page.locator('#careerSelect').count()) === 0, await careerOptions(other.page));

  // ---------- úprava na jednom zařízení se přenese na druhé
  await pc.page.selectOption('#careerSelect', { label: 'Sparta Praha (2026/27)' });
  check('02 přepnutí kariéry funguje', (await pc.page.locator('#careerSelect').inputValue()) !== '', '');

  // ---------- po obnovení stránky data zůstanou (místní úložiště)
  await pc.page.reload();
  await pc.page.waitForFunction(() => window.__trenerReady === true);
  check('02 po obnovení stránky kariéry zůstaly', await waitOptions(pc.page, 2), await careerOptions(pc.page));

  // ---------- smazání kariéry se přenese na telefon
  await nav(pc.page, 'nastaveni');
  const del = pc.page.locator('#main .book', { hasText: 'Chelsea' }).locator('button.danger');
  await del.click();
  await del.click();
  await pc.page.waitForFunction(() => !/Chelsea/.test(document.querySelector('#careerSelect') ? document.querySelector('#careerSelect').textContent : ''), null, { timeout: 5000 }).catch(() => {});
  check('02 po smazání kariéry na počítači zmizí z výběru', !(await careerOptions(pc.page)).some((t) => /Chelsea/.test(t)), await careerOptions(pc.page));
  check('02 smazání se přenese na telefon', await phone.page.waitForFunction(() => !/Chelsea/.test(document.querySelector('#careerSelect').textContent), null, { timeout: 8000 }).then(() => true, () => false), await careerOptions(phone.page));
  const careerDocs = [...server.docs.entries()].filter(([k]) => /\/career_/.test(k));
  check('02 na serveru po smazání nezůstala žádná data kariéry (jen prázdný náhrobek)', careerDocs.some(([, d]) => d.deleted === true && d.data === null) && careerDocs.filter(([, d]) => d.data && d.data.club === 'Chelsea').length === 0, careerDocs.map(([k, d]) => k + ':' + d.deleted));

  // ---------- záloha a obnova v samostatném okně bez db
  await nav(pc.page, 'nastaveni');
  await pc.page.click('#exportData');
  await pc.page.waitForFunction(() => window.__mock.saves.length >= 1, null, { timeout: 5000 }).catch(() => {});
  const saves = await pc.page.evaluate(() => window.__mock.saves);
  let dump = null;
  try {
    dump = JSON.parse(saves[0].text);
  } catch (e) {
    /* ohlásí se níž */
  }
  check('02 záloha dat má správný formát a kariéru Sparta', dump && dump.format === 'fm27-trener-data' && dump.docs.some((d) => d.type === 'career' && d.data.club === 'Sparta Praha'), saves.map((s) => s.filename));

  const solo = await newContext(browser, {});
  await open(solo.page, 'nastaveni');
  check('02 bez db stránka řekne, že data jsou jen v zařízení', /jen v tomto zařízení/.test(await text(solo.page, '#pillSync')), await text(solo.page, '#pillSync'));
  await solo.page.setInputFiles('#importData', { name: 'fm27-data.json', mimeType: 'application/json', buffer: Buffer.from(saves[0].text) });
  await solo.page.waitForFunction(() => document.querySelector('#careerSelect') && /Sparta/.test(document.querySelector('#careerSelect').textContent), null, { timeout: 5000 }).catch(() => {});
  check('02 obnova ze zálohy vrátí kariéru', (await careerOptions(solo.page)).some((t) => /Sparta/.test(t)), await careerOptions(solo.page));
  await solo.page.setInputFiles('#importData', { name: 'spatny.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await solo.page.waitForSelector('#toast:not([hidden])');
  check('02 cizí soubor při obnově se odmítne', /Obnovení se nepovedlo/.test(await text(solo.page, '#toast')), await text(solo.page, '#toast'));

  // ---------- smazání všech dat
  await nav(pc.page, 'nastaveni');
  const purge = pc.page.getByRole('button', { name: 'Smazat všechna data aplikace' });
  await purge.click();
  await pc.page.getByRole('button', { name: 'Opravdu smazat úplně všechno?' }).click();
  await pc.page.waitForFunction(() => !document.querySelector('#careerSelect'), null, { timeout: 5000 }).catch(() => {});
  check('02 po smazání všeho zmizela i poslední kariéra', (await pc.page.locator('#careerSelect').count()) === 0);
  await until(() => [...server.docs.values()].every((d) => d.data === null));
  const leftovers = [...server.docs.values()].filter((d) => d.data !== null);
  check('02 na serveru nezůstal žádný obsah uživatele', leftovers.length === 0, leftovers.map((d) => d.key));

  for (const c of [pc, phone, other, solo]) {
    check('02 bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
    await c.context.close();
  }
};
