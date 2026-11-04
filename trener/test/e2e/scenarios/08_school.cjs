/* Scénář 08: Škola taktiky, ověření znalostí, Trenér rozhodování a Osobní rozvoj.
   Akceptační testy zadání: etapa 7 (škola, cvičení, hodnocení znalostí, osobní rozvoj), § 9 a § 10. */
module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, open, nav, addBooks, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };

  const c = await newContext(browser, { db: server, uid: 'u1' });
  const page = c.page;
  const progress = () => page.evaluate(() => window.FM27.app.store.get('progress', 'progress'));
  const answer = async (picks) => {
    for (const [i, j] of picks.entries()) await page.check(`#quiz-${i}-${j}`);
  };

  await open(page, 'skola');
  check('08 osnova má pět skupin A až E s 28 lekcemi', (await page.locator('.lesson-row').count()) === 28 && (await page.locator('[id^="schoolList-"]').count()) === 5, await page.locator('.lesson-row').count());
  check('08 osobní rozvoj doporučí první lekci', /Rozestavení/.test(await text(page, '#progressNext')) && /A1/.test(await text(page, '#progressNext')), await text(page, '#progressNext'));
  check('08 škola funguje i bez kariéry (učení nezávisí na kariéře)', (await page.locator('#lessonGen').count()) === 1);

  // ---------- lekce bez knih: poctivě označená jako obecná znalost
  await page.click('#lessonGen');
  await page.waitForSelector('#lessonView', { timeout: 20000 });
  check('08 lekce bez knih nese upozornění, že nevychází z tvých knih', /nevychází z tvých knih/.test(await text(page, '#lessonBox')), await text(page, '#lessonBox'));
  check('08 lekce má všech sedm částí zadání', (await page.locator('#lessonView .sec').count()) === 7, await page.locator('#lessonView .sec').count());
  const sections = await text(page, '#lessonView');
  check('08 části: princip, příklad z FM27, schéma, použití, chyby, cvičení, ověření', /Princip/i.test(sections) && /Příklad z FM27/i.test(sections) && /Grafické znázornění/i.test(sections) && /Konkrétní použití/i.test(sections) && /Nejčastější chyby/i.test(sections) && /Praktické cvičení/i.test(sections) && /Ověření znalostí/i.test(sections), sections.slice(0, 200));
  check('08 příklad z FM27 je označený jako neověřený a říká, co ověřit ve hře', /neověřeno/.test(sections) && /Ověř si ve hře/.test(sections), '');
  check('08 schéma je vykreslené jako SVG s popisky', (await page.locator('#lessonDiagram svg').count()) === 1 && /Útočník/.test(await page.locator('#lessonDiagram').innerHTML()), '');
  const prompt0 = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /Jsi učitel taktiky/.test(p)).pop() || '';
  check('08 prompt lekce zakazuje fakta z paměti a tvrzení o FM27', /Nepřidávej fakta z paměti/.test(prompt0) && /Rozestavení/.test(prompt0), prompt0.slice(0, 200));

  // ---------- ověření znalostí
  await page.click('#quizSubmit');
  check('08 bez odpovědí se ověření nevyhodnotí', /Odpověz na všechny otázky/.test(await text(page, '#toast')), await text(page, '#toast'));
  await answer([0, 1, 2]);
  await page.click('#quizSubmit');
  await page.waitForSelector('#quizResult .banner');
  check('08 správné odpovědi: lekce je probraná', /Správně 3 z 3 \(100 %\)/.test(await text(page, '#quizResult')) && /Lekce je probraná/.test(await text(page, '#quizResult')), await text(page, '#quizResult'));
  await until(async () => ((await progress()) || { school: { lessons: {} } }).school.lessons.A1 !== undefined);
  const p1 = await progress();
  check('08 pokrok se uloží (stav probráno, nejlepší výsledek 100 %)', p1 && p1.school.lessons.A1 && p1.school.lessons.A1.status === 'done' && p1.school.lessons.A1.bestScore === 100, p1 && p1.school);
  check('08 vysvětlení u každé otázky je vidět', (await page.locator('#quizResult li').count()) === 3 && /Správná odpověď vychází/.test(await text(page, '#quizResult')), await text(page, '#quizResult'));
  await page.waitForTimeout(200);
  check('08 osobní rozvoj ukáže 1 z 28 a další doporučenou lekci', /1 z 28/.test(await text(page, '#progressCard')) && !/Rozestavení \(A1\)/.test(await text(page, '#progressNext')), await text(page, '#progressNext'));

  // ---------- lekce s knihami: odkazy na úryvky
  await addBooks(page, [fx('taktika-cs.txt')]);
  await nav(page, 'skola');
  await page.locator('.lesson-row[data-id="A1"] button').click();
  await page.click('#lessonGen');
  await page.waitForFunction(() => document.querySelector('#lessonView') && !/nevychází z tvých knih/.test(document.querySelector('#lessonBox').textContent), null, { timeout: 20000 });
  check('08 lekce s knihami má u principu odkaz na úryvek z knihy', (await page.locator('#lessonView button.ref').count()) >= 1 && !/nevychází z tvých knih/.test(await text(page, '#lessonBox')), await page.locator('#lessonView button.ref').count());
  await page.locator('#lessonView button.ref').first().click();
  check('08 odkaz otevře úryvek z knihy', await page.isVisible('#drawer'));
  await page.click('#drawerClose');

  // ---------- špatné odpovědi nesníží nejlepší výsledek
  await answer([1, 0, 0]);
  await page.click('#quizSubmit');
  await page.waitForSelector('#quizResult .banner.warn');
  check('08 špatné odpovědi: lekce se neoznačí, vysvětlení se ukáže', /Na probrání je potřeba aspoň 60 %/.test(await text(page, '#quizResult')) && (await page.locator('#quizResult .quiz-bad').count()) >= 2, await text(page, '#quizResult'));
  await until(async () => (await progress()).school.lessons.A1.attempts >= 2);
  const p2 = await progress();
  check('08 nejlepší výsledek zůstane 100 % a lekce probraná', p2.school.lessons.A1.bestScore === 100 && p2.school.lessons.A1.status === 'done' && p2.school.lessons.A1.attempts === 2, p2.school.lessons.A1);

  // ---------- neplatná lekce se nezobrazí
  await page.locator('.lesson-row[data-id="B1"] button').click();
  await page.evaluate(() => (window.__mock.mode = 'special-invalid'));
  await page.click('#lessonGen');
  await page.waitForSelector('#lessonBox .banner.warn', { timeout: 20000 });
  check('08 lekce, která neprojde kontrolou poctivosti, se nezobrazí', /neprošla kontrolou poctivosti/.test(await text(page, '#lessonBox')) && (await page.locator('#lessonView').count()) === 0, await text(page, '#lessonBox'));
  await page.evaluate(() => (window.__mock.mode = 'ok'));

  // ---------- trenér rozhodování: nejdřív výběr, potom vysvětlení
  await page.click('#scenarioNext');
  await page.waitForSelector('#scenarioSituation', { timeout: 20000 });
  check('08 scénář ukáže situaci a možnosti, vysvětlení je zatím skryté', (await page.locator('#scenarioBox .option').count()) === 3 && (await page.locator('#scenarioReveal').innerText()).trim() === '', await text(page, '#scenarioBox'));
  const sprompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /Jsi trenér rozhodování/.test(p)).pop() || '';
  check('08 prompt scénáře říká, že uživatel vybírá dřív než uvidí vysvětlení', /vybere dřív, než uvidí vysvětlení/.test(sprompt), sprompt.slice(0, 200));
  await page.locator('#scenarioBox .option[data-option="a"]').click();
  await page.waitForSelector('#scenarioReveal .banner');
  check('08 špatná volba: ukáže se doporučený postup, důvod a častá chyba', /Doporučený postup je jiný/.test(await text(page, '#scenarioReveal')) && /Zkrátíš vzdálenosti/.test(await text(page, '#scenarioReveal')) && /Častá chyba/i.test(await text(page, '#scenarioReveal')), await text(page, '#scenarioReveal'));
  check('08 po výběru jsou možnosti zamčené a doporučená označená', (await page.locator('#scenarioBox .option:disabled').count()) === 3 && (await page.locator('#scenarioBox .option.best').count()) === 1);
  await until(async () => Object.values((await progress()).skills).some((s) => s.seen >= 1));
  const p3 = await progress();
  check('08 rozhodnutí se zapíše do pokroku včetně chyby', p3.mistakes.length >= 1 && Object.values(p3.skills).some((s) => s.seen >= 1), p3.mistakes);
  await page.click('#scenarioNext');
  await page.waitForFunction(() => document.querySelector('#scenarioBox .option:not(:disabled)'), null, { timeout: 20000 });
  await page.locator('#scenarioBox .option[data-option="b"]').click();
  await page.waitForSelector('#scenarioReveal .banner.ok');
  check('08 správná volba se pozná', /odpovídá doporučenému postupu/.test(await text(page, '#scenarioReveal')), await text(page, '#scenarioReveal'));

  // ---------- scénář bez shody s knihami: vysvětlení je označené jako odhad
  const pr = await progress();
  check('08 pokrok obsahuje obě rozhodnutí', Object.values(pr.skills).reduce((a, s) => a + (s.seen || 0), 0) >= 2, pr.skills);

  // ---------- synchronizace jen pokroku, ne lekcí
  const phone = await newContext(browser, { db: server, uid: 'u1', viewport: { width: 390, height: 844 } });
  await open(phone.page, 'skola');
  await phone.page.waitForFunction(() => /1 z 28/.test(document.querySelector('#progressCard').textContent), null, { timeout: 10000 }).catch(() => {});
  check('08 telefon: pokrok se synchronizoval (1 probraná lekce)', /1 z 28/.test(await text(phone.page, '#progressCard')), await text(phone.page, '#progressCard'));
  check('08 telefon: obsah lekcí z knih se nesynchronizuje (zůstává jen v zařízení)', (await phone.page.locator('.lesson-row .chip', { hasText: 'lekce složená' }).count()) === 0);
  const o = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('08 telefon: škola bez vodorovného posouvání', o.sw <= o.cw, o);
  await phone.context.close();

  check('08 bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
  const consoleErrors = c.problems.console.filter((m) => !/Failed to load resource/.test(m));
  check('08 bez chyb v konzoli', consoleErrors.length === 0, consoleErrors);
  await c.context.close();
};
