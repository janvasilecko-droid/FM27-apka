/* Scénář 24: ROZBOR SESTAVY (Moje taktiky → karta „Rozbor sestavy a taktiky“, squadcheck.js).
   Co se zkouší: jedno tlačítko „Analyzovat sestavu a taktiku“ vypíše seznam „Co řešit jako první“, nejlepší jedenáctku z atributů bez ručního popisu rolí,
   porovnání s jedenáctkou zadanou v taktice a navržené výměny, hloubku po skupinách pozic (díra, žádná záloha, pod cílem), slabá místa podle pravidel
   se jmény atributů a hodnotami, silné stránky, poctivé poznámky (smlouvy a formu aplikace nezná) a zastarání po změně hráčů.
   Co se NEzkouší: skutečné atributy z FM27 (vstupy jsou zadané ve zkoušce); samotná pravidla a výpočty jsou v test/squadcheck.test.mjs. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text } = h;
  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacReadCard');

  // ---------- kádr: dobrá hloubka všude kromě křídel (jen dva hráči na dvě místa), jeden slabý stoper, stárnoucí brankář bez nástupce
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const D = window.TrenerDwrs;
    const careerId = app.career().id;
    const attrs = (gk, base, over) => Object.assign(Object.fromEntries((gk ? D.GK_ATTRIBUTES : D.OUTFIELD_ATTRIBUTES).map((a) => [a, base])), over || {});
    const mk = (name, positions, age, base, over) => ({ careerId, name, positions, role: '', duty: '', foot: 'unknown', age, attributes: attrs(positions[0] === 'GK', base, over), strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    const defs = [
      ['Brankář A', ['GK'], 34, 14], ['Brankář B', ['GK'], 31, 11],
      ['Stoper A', ['DC'], 27, 14, { Marking: 7, Tackling: 8 }], ['Stoper B', ['DC'], 26, 14], ['Stoper C', ['DC'], 25, 13], ['Stoper D', ['DC'], 20, 11],
      ['Bek P1', ['DR'], 26, 13], ['Bek P2', ['DR'], 22, 12], ['Bek L1', ['DL'], 27, 13], ['Bek L2', ['DL'], 21, 12],
      ['Defenzivní 1', ['DM'], 28, 14], ['Defenzivní 2', ['DM'], 24, 12],
      ['Střed 1', ['MC'], 26, 13], ['Střed 2', ['MC'], 25, 13], ['Střed 3', ['MC'], 23, 12], ['Střed 4', ['MC'], 28, 12],
      ['Křídlo P', ['AMR'], 24, 14, { Pace: 17, Acceleration: 17, Dribbling: 16 }], ['Křídlo L', ['AML'], 25, 13],
      ['Útočník 1', ['ST'], 27, 15, { Finishing: 18, Acceleration: 17, Pace: 16 }], ['Útočník 2', ['ST'], 23, 9],
    ];
    for (const d of defs) await app.store.put('player', mk(...d));
    const t = window.TrenerTactics.makeTactic({ formation: '4-3-3', name: 'Zkušební 4-3-3', careerId });
    t.teamInstructions = ['Line of Engagement: High Press', 'Defensive Line: Lower'];
    const byName = Object.fromEntries(app.store.list('player').map((p) => [p.name, p.id]));
    const pick = { GK: 'Brankář A', RB: 'Bek P1', RCB: 'Stoper A', LCB: 'Stoper B', LB: 'Bek L1', DM: 'Defenzivní 1', RCM: 'Střed 1', LCM: 'Střed 2', RW: 'Křídlo P', ST: 'Útočník 2', LW: 'Křídlo L' };
    for (const s of t.slots) s.playerId = byName[pick[s.pos]];
    const saved = await app.store.put('tactic', t);
    const career = app.store.draft(app.career());
    career.activeTacticId = saved.id;
    await app.store.put('career', career);
  });
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacCheckCard');
  check('24 před kliknutím žádný výsledek není a tlačítko se jmenuje „Analyzovat sestavu a taktiku“', (await page.locator('#tacCheckResult').count()) === 0 && /Analyzovat sestavu a taktiku/.test(await text(page, '#tacCheckBtn')));

  await page.click('#tacCheckBtn');
  await page.waitForSelector('#squadSection');
  const squad = await text(page, '#squadSection');

  // ====================================================== A) jedenáctka a porovnání
  check('24 sestava říká, že se role nepopisují a model je odhad (DWRS)', /Role se tu nepopisují/.test(squad) && /ESTIMATED/.test(squad));
  check('24 tabulka jedenáctky má 11 míst a u každého hráče skóre', (await page.locator('#squadXi tbody tr').count()) === 11 && (await page.$$eval('#squadXi tbody tr', (rows) => rows.every((r) => /\d/.test(r.children[2].textContent) && /\d/.test(r.children[4].textContent)))));
  check('24 tvoje jedenáctka je porovnaná s nejlepší podle modelu (průměr na místo)', /Průměr tvé jedenáctky [\d,]+ bodu na místo, nejlepší podle modelu [\d,]+/.test(await text(page, '#squadAvg')), await text(page, '#squadAvg'));
  const swaps = await page.$$eval('#squadSwaps li', (els) => els.map((e) => e.textContent));
  check('24 navržená výměna: útočník 2 (slabý) → útočník 1 s číslem zisku; je to označené jako odhad', swaps.some((s) => /ST: Útočník 2 → Útočník 1 \(\+[\d,]+ bodu\)/.test(s)) && /odhad/.test(await text(page, '#squadSection')), JSON.stringify(swaps));

  // ====================================================== B) hloubka
  const depth = await page.$$eval('#squadDepth tbody tr', (rows) => Object.fromEntries(rows.map((r) => [r.getAttribute('data-group'), r.getAttribute('data-state')])));
  check('24 hloubka: křídla mají jen dva hráče na dvě místa (žádná záloha), útočníci jsou v pořádku, stopeři také', depth.W === 'single' && depth.ST === 'ok' && depth.CB === 'ok', JSON.stringify(depth));
  check('24 brankáři: dva na jedno místo jsou v pořádku', depth.GK === 'ok', JSON.stringify(depth));

  // ====================================================== C) slabá místa
  const rules = await page.$$eval('#squadFindings [data-rule]', (els) => els.map((e) => e.getAttribute('data-rule')));
  check('24 slabá místa: žádná záloha na křídle (G2), slabé atributy stopera (Q1) a brankář bez nástupce (A1)', ['G2', 'Q1', 'A1'].every((id) => rules.includes(id)), JSON.stringify(rules));
  const q1 = await text(page, '#squadFindings [data-rule="Q1"]');
  check('24 nález Q1 ukazuje atributy a hodnoty a návrh změny', /Marking: 7/.test(q1) && /Tackling: 8/.test(q1) && /Zlepšit individuálním tréninkem/.test(q1) && /Stoper A/.test(q1), q1.slice(0, 260));
  const a1 = await text(page, '#squadFindings [data-rule="A1"]');
  check('24 nález A1 říká věk brankáře a že věk je komunitní odhad', /Brankář A \(34\)/.test(a1) && /komunitní odhad/.test(a1), a1.slice(0, 200));
  check('24 silné stránky: rychlé a obratné křídlo je silné v nejdůležitějších atributech své pozice', /Křídlo P/.test(await text(page, '#squadStrengths')) && /Pace: 17/.test(await text(page, '#squadStrengths')), await text(page, '#squadStrengths'));

  // ====================================================== D) co řešit jako první
  const top = await page.$$eval('#tacCheckTop li', (els) => els.map((e) => [e.getAttribute('data-source'), e.getAttribute('data-rule'), e.textContent]));
  check('24 seznam „Co řešit jako první“ obsahuje nálezy ze sestavy i z taktiky, nejzávažnější první', top.length >= 3 && top.some((t) => t[0] === 'squad') && top.some((t) => t[0] === 'tactic' && t[1] === 'A01') && top.every((t) => /Změna: /.test(t[2])), JSON.stringify(top.map((t) => t.slice(0, 2))));
  check('24 sekce Taktika a Sestava jsou obě ve výsledku, taktika má vlastní počty kontrol', (await page.locator('#tacticSection').count()) === 1 && /Kontroly: vyhodnoceno/.test(await text(page, '#tacCheckCounts')));
  check('24 poznámky přiznávají, co aplikace zatím nezná (smlouvy, forma, morálka)', /Smlouvy, morálku ani formu aplikace zatím nezná/.test(await text(page, '#squadNotes')));
  check('24 v rozboru nejsou zbytečně silná slova', !/zabere|vyhraj|zaručen/i.test(await text(page, '#tacCheckResult')));

  // ====================================================== D2) telefon: nic nepřetéká do šířky
  await page.setViewportSize({ width: 390, height: 844 });
  const ov = await h.overflow(page);
  const offenders = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((e) => !e.closest('nav, header, svg, #sidebar, .sidebar, aside') && e.getBoundingClientRect().right > cw + 1)
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 8)
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).slice(0, 30)} → ${Math.round(e.getBoundingClientRect().right)}`);
  });
  check('24 na telefonu (390 px) se rozbor vejde bez vodorovného posouvání celé stránky', ov.sw <= ov.cw + 1, { ov, offenders });
  await page.locator('#tacCheckCard').screenshot({ path: `${env.OUT}/24_rozbor_telefon.png` });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ====================================================== E) výsledek přežije překreslení, po změně hráčů zastará
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacCheckCard');
  check('24 po návratu na obrazovku je stejný rozbor stále vidět (nic se nezměnilo)', (await page.locator('#squadSection').count()) === 1);
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const p = app.store.list('player').find((x) => x.name === 'Křídlo P');
    const next = app.store.draft(p);
    next.age = 36;
    await app.store.put('player', next);
  });
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacCheckStale');
  check('24 po změně hráče starý rozbor zmizí a aplikace řekne, že je potřeba spustit nový', /Klikni znovu na „Analyzovat sestavu a taktiku“/.test(await text(page, '#tacCheckStale')) && (await page.locator('#squadSection').count()) === 0);

  // ====================================================== F) prázdná soupiska se nehádá
  await page.evaluate(async () => {
    const app = window.FM27.app;
    for (const p of app.store.list('player')) await app.store.remove('player', p.id);
  });
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacCheckCard');
  await page.click('#tacCheckBtn');
  await page.waitForSelector('#squadUnusable');
  check('24 bez hráčů aplikace řekne, že sestavu nejde posoudit, a nic nevymýšlí', /Soupiska je prázdná/.test(await text(page, '#squadUnusable')) && (await page.locator('#squadXi').count()) === 0);
  check('24 bez chyb ve skriptu a v konzoli (kromě blokovaných zdrojů)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
