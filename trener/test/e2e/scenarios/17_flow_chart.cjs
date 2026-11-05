/* Scénář 17: GRAF PRŮBĚHU ZÁPASU (xG, střely, držení míče v čase) z časové osy, v Live Coachi i v Historii zápasů.
   Co se zkouší: poctivost (graf kreslí jen snímky, nic nedopočítává, bez dvou snímků to řekne), správná strana (jsem domácí nebo host),
   přepínání statistiky a že výběr přežije nový snímek, značka změny skóre, textová tabulka pro čtečky a popis obrázku.
   Co se NEzkouší: vzhled v prohlížečích mimo Chromium. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text } = h;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return fn();
  };
  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'live');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#liveStart');
  await page.fill('#liveOpp', 'Sparta Praha');
  await page.click('#liveStart');
  await page.waitForSelector('#liveFlow');
  const add = (f) => page.evaluate((fields) => window.FM27.live.addManual(window.FM27.app, fields).then((r) => r.status), f);
  const stats = (home, away) => ({ home, away });

  check('17 bez snímků graf říká, že potřebuje aspoň dva snímky', /aspoň dva snímky/.test(await text(page, '#flowEmpty')) && /Zatím jich je 0/.test(await text(page, '#flowEmpty')) && (await page.locator('#flowSvg').count()) === 0, await text(page, '#liveFlow'));
  await add({ minute: 10, score: { home: 0, away: 0 }, stats: stats({ xg: 0.3, shots: 2, shotsOnTarget: 1, possession: 55 }, { xg: 0.1, shots: 1, shotsOnTarget: 0, possession: 45 }) });
  await until(async () => /Zatím jich je 1/.test(await text(page, '#liveFlow')));
  check('17 s jedním snímkem se graf ještě nekreslí', /Zatím jich je 1/.test(await text(page, '#flowEmpty')) && (await page.locator('#flowSvg').count()) === 0);
  await add({ minute: 25, score: { home: 0, away: 0 }, stats: stats({ xg: 0.8, shots: 5, shotsOnTarget: 2, possession: 58 }, { xg: 0.2, shots: 2, shotsOnTarget: 1, possession: 42 }) });
  await page.waitForSelector('#flowSvg');
  check('17 s dvěma snímky se kreslí xG: dvě čáry a čtyři body, popis obrázku nese poslední hodnoty', (await page.locator('#flowSvg polyline').count()) === 2 && (await page.locator('#flowSvg circle.dot').count()) === 4 && /xG: ty 0,80, soupeř 0,20 v 25\. minutě; 2 bodů/.test((await page.getAttribute('#flowSvg', 'aria-label')) || ''), await page.getAttribute('#flowSvg', 'aria-label'));
  check('17 výchozí statistika je xG, tlačítko je označené jako zapnuté', (await page.getAttribute('#liveFlow [data-metric="xg"]', 'aria-pressed')) === 'true' && (await page.getAttribute('#liveFlow [data-metric="shots"]', 'aria-pressed')) === 'false');
  await add({ minute: 40, score: { home: 1, away: 0 }, stats: stats({ xg: 1.2, shots: 8, shotsOnTarget: 4, possession: 60 }, { xg: 0.3, shots: 3, shotsOnTarget: 1, possession: 40 }) });
  await until(async () => (await page.locator('#flowSvg circle.dot').count()) === 6);
  check('17 třetí snímek přidá body a změna skóre 1:0 je označená svislou čárkou s popiskem', (await page.locator('#flowSvg circle.dot').count()) === 6 && (await page.locator('#flowSvg line.goal').count()) === 1 && /1:0/.test(await page.locator('#flowSvg').textContent()), await page.locator('#flowSvg').textContent());
  check('17 tabulka hodnot pro čtečky má tři řádky se skóre', (await page.locator('#liveFlow .flow-table tbody tr').count()) === 3 && /1:0/.test(await page.locator('#liveFlow .flow-table tbody').textContent()));
  await page.click('#liveFlow [data-metric="shots"]');
  check('17 přepnutí na střely změní popis obrázku', /^Střely: ty 8, soupeř 3 v 40\. minutě/.test((await page.getAttribute('#flowSvg', 'aria-label')) || ''), await page.getAttribute('#flowSvg', 'aria-label'));
  await add({ minute: 55, score: { home: 1, away: 0 }, stats: stats({ xg: 1.4, shots: 10, shotsOnTarget: 5, possession: 61 }, { xg: 0.4, shots: 4, shotsOnTarget: 1, possession: 39 }) });
  await until(async () => (await page.locator('#flowSvg circle.dot').count()) === 8);
  check('17 vybraná statistika přežije nový snímek (graf se překreslil, ale zůstaly střely)', (await page.locator('#flowSvg circle.dot').count()) === 8 && /^Střely: ty 10, soupeř 4 v 55\. minutě/.test((await page.getAttribute('#flowSvg', 'aria-label')) || '') && (await page.getAttribute('#liveFlow [data-metric="shots"]', 'aria-pressed')) === 'true', await page.getAttribute('#flowSvg', 'aria-label'));
  await page.click('#liveFlow [data-metric="possession"]');
  check('17 držení míče má osu do 100 a popis s hodnotami obou stran', /^Držení míče \(%\): ty 61, soupeř 39 v 55\. minutě/.test((await page.getAttribute('#flowSvg', 'aria-label')) || '') && /100/.test(await page.locator('#flowSvg').textContent()), await page.getAttribute('#flowSvg', 'aria-label'));
  await page.click('#liveFlow [data-metric="shotsOnTarget"]');
  check('17 popisky osy nejsou vyšší než nutné (střely na bránu do 5)', /^Střely na bránu: ty 5, soupeř 1/.test((await page.getAttribute('#flowSvg', 'aria-label')) || ''));

  // ---------- strana hosta a chybějící údaje: kreslí se jen to, co je, a strana se bere podle zápasu
  const away = await page.evaluate(() => {
    const An = window.TrenerAnalysis;
    const snap = (minute, ah, aa, xh, xa) => An.makeSnapshot({ id: 's' + minute, at: minute, minute, score: { home: 0, away: 0 }, provenance: 'user_entered', stats: { home: { xg: xh, shots: ah }, away: { xg: xa, shots: aa } } });
    const m = { mySide: 'away', timeline: [snap(10, 2, 3, 0.2, 0.5), snap(30, 4, 7, 0.3, 1.1), snap(50, 5, null, 0.4, null)] };
    const el = window.FM27.widgets.flowChart(m, {});
    const svg = el.querySelector('svg');
    return { label: svg && svg.getAttribute('aria-label'), dots: el.querySelectorAll('circle.dot').length, who: [...el.querySelectorAll('.flow-legend span')].map((x) => x.textContent).join('|') };
  });
  check('17 když hraju venku, „ty“ jsou hosté (xG 1,10 proti 0,30); snímek bez hodnoty soupeře se nekreslí a nic se nedopočítává', away.label && /^xG: ty 1,10, soupeř 0,30 v 30\. minutě; 2 bodů/.test(away.label) && away.dots === 4 && /Ty \(hosté\)/.test(away.who), away);

  // ---------- Historie zápasů
  await page.evaluate(() => window.FM27.live.finish(window.FM27.app, { home: 1, away: 0 }).then(() => window.FM27.live.end(window.FM27.app)));
  await nav(page, 'historie');
  await page.waitForSelector('#histList .book.match');
  await page.click('#histList .book.match button');
  await page.waitForSelector('#histFlow');
  check('17 v Historii zápasů je u zápasu stejný graf', (await page.locator('#histFlow #flowSvg').count()) === 1 && (await page.locator('#histFlow circle.dot').count()) === 8 && /Průběh zápasu \(graf\)/.test(await text(page, '#histFlow')), await text(page, '#histFlow'));
  check('17 graf nese poctivý popisek: body jsou snímky, spojnice je jen pomůcka, nic není měřeno souvisle', /Body jsou snímky zápasu, ne souvislé měření/.test(await text(page, '#histFlow')));
  check('17 bez chyb ve skriptu a v konzoli', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
