/* Scénář 23: ROZBOR TAKTIKY (Moje taktiky → karta „Rozbor taktiky“, tacticanalysis.js).
   Co se zkouší: role bez míče se uloží, tlačítko Analyzovat taktiku vypíše nálezy s důkazem, návrhem změny a druhem zdroje, silné stránky,
   pravidla s atributy hráčů (pomalý stoper při vysoké linii), nevyhodnocené kontroly vypsané zvlášť, rozbor zastará po změně taktiky
   a bez chyb ve skriptu a v konzoli.
   Co se NEzkouší: skutečnou taktiku z FM27 ani skutečné atributy (vstupy jsou zadané ve zkoušce); pravidla samotná jsou v test/tacticanalysis.test.mjs. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text } = h;
  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacReadCard');

  // ---------- taktika s rozpory, role s míčem i bez míče a dva stopeři s atributy
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const mk = (name, positions, attributes) => ({ careerId, name, positions, role: '', duty: '', foot: 'unknown', age: null, attributes, strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    const slow = await app.store.put('player', mk('Pomalý stoper', ['DC'], { Pace: 10, Acceleration: 11, Passing: 12 }));
    const fast = await app.store.put('player', mk('Rychlý stoper', ['DC'], { Pace: 16, Acceleration: 15, Passing: 14 }));
    const t = window.TrenerTactics.makeTactic({ formation: '4-3-3', name: 'Zkušební 4-3-3', careerId });
    t.mentality = 'Balanced';
    t.teamInstructions = ['Line of Engagement: Low Block', 'Defensive Line: Much Higher', 'Defensive Transition: Counter-Press', 'Passing Directness: More Direct', 'Patience: Work Ball Into Box', 'Něco mimo slovník'];
    const roles = { GK: ['Goalkeeper', 'Line-Holding Keeper'], RB: ['Wing-Back', null], LB: ['Wing-Back', null], RCB: ['Centre-Back', null], LCB: ['Centre-Back', null], DM: ['Defensive Midfielder', null], RCM: ['Central Midfielder', null], LCM: ['Central Midfielder', null], RW: ['Inside Winger', null], ST: ['Centre Forward', null], LW: ['Inside Winger', null] };
    for (const s of t.slots) {
      const r = roles[s.pos];
      if (r) {
        s.role = r[0];
        if (r[1]) s.oopRole = r[1];
      }
      if (s.pos === 'RCB') s.playerId = slow.id;
      if (s.pos === 'LCB') s.playerId = fast.id;
    }
    const saved = await app.store.put('tactic', t);
    const career = app.store.draft(app.career());
    career.activeTacticId = saved.id;
    await app.store.put('career', career);
  });
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacCheckCard');

  // ====================================================== A) úvod a role bez míče
  const lead = await text(page, '#tacCheckCard');
  check('23 karta Rozbor sestavy a taktiky je v Moje taktiky a říká, že jde o pomůcku, ne pravidlo FM27 ani předpověď', /Rozbor sestavy a taktiky/.test(lead) && /ne pravidlo FM27 a ne předpověď výsledku/.test(lead) && /bez AI/.test(lead), lead.slice(0, 200));
  check('23 před kliknutím žádný výsledek není', (await page.locator('#tacCheckResult').count()) === 0);
  check('23 editor má pole „Role bez míče“ u každého místa a uložená role bez míče se zobrazí', (await page.locator('[id^="slOop-"]').count()) === 11 && (await page.inputValue('#slOop-s1')) === 'Line-Holding Keeper');

  // ====================================================== B) rozbor
  await page.click('#tacCheckBtn');
  await page.waitForSelector('#tacCheckResult');
  const result = await text(page, '#tacCheckResult');
  const ruleIds = await page.$$eval('#tacCheckFindings [data-rule]', (els) => els.map((e) => e.getAttribute('data-rule')));
  check('23 rozbor ukáže, co se přečetlo: mentalitu, 5 z 28 instrukcí, role s míčem, role bez míče a atributy', /mentalita: Balanced/.test(result) && /týmové instrukce: 5 z 28/.test(result) && /role s míčem: 11 z 11/.test(result) && /role bez míče: 1 z 11/.test(result) && /atributy hráčů u 2 z 11 míst/.test(result), result.slice(0, 400));
  check('23 nerozpoznaná instrukce se uvede a nezkresluje rozbor', /Nerozpoznané instrukce/.test(result) && /Něco mimo slovník/.test(result));
  check('23 nálezy: linie × zapojení (A01), Counter-Press z nízkého bloku (A04), brankář na čáře při vysoké linii (A09), přímé × trpělivé (C01), pomalý stoper (A08); Counter-Press s NÍZKOU linií se nehlásí, linie je vysoká (A03)', ['A01', 'A04', 'A08', 'A09', 'C01'].every((id) => ruleIds.includes(id)) && !ruleIds.includes('A03'), JSON.stringify(ruleIds));
  check('23 vážné rozpory jsou první a každý nález má důkaz, návrh změny a druh zdroje', await page.evaluate(() => {
    const items = [...document.querySelectorAll('#tacCheckFindings [data-rule]')];
    const rank = { error: 0, warn: 1, note: 2, info: 3 };
    const order = items.map((e) => rank[e.getAttribute('data-sev')]);
    const sorted = order.every((v, i) => i === 0 || order[i - 1] <= v);
    return items.length > 0 && sorted && items.every((e) => /Co změnit/.test(e.textContent) && /(textu|názor|odhad)/.test(e.textContent) && e.querySelectorAll('ul.list li').length >= 2);
  }));
  const a01 = await text(page, '[data-rule="A01"]');
  check('23 nález A01 ukazuje přesné nastavení a přesnou změnu (název instrukce → hodnota)', /Defensive Line: Much Higher/.test(a01) && /Line of Engagement: Low Block/.test(a01) && /Defensive Line → Standard/.test(a01), a01.slice(0, 300));
  const a08 = await text(page, '[data-rule="A08"]');
  check('23 nález A08 ukazuje atribut nejpomalejšího stopera a místo', /Pace 10/.test(a08) && /RCB/.test(a08), a08.slice(0, 300));
  check('23 rozbor říká, že nevyhodnocené kontroly se nehádají, a vypisuje je zvlášť', /nevyhodnoceno kvůli chybějícím údajům \d+/.test(await text(page, '#tacCheckCounts')) && /Nevyhodnocené kontroly/.test(await text(page, '#tacCheckMissing')));
  check('23 složitost taktiky se uvede podle počtu nastavených instrukcí', /Složitost podle počtu nastavených instrukcí: nízká \(5 jiných než výchozích\)/.test(await text(page, '#tacCheckCounts')), await text(page, '#tacCheckCounts'));
  check('23 v rozboru nejsou zbytečně silná slova: žádné „zabere“, „vyhraješ“ ani „zaručeně“', !/zabere|vyhraj|zaručen/i.test(result));

  // ====================================================== C) změna taktiky: rozbor zastará
  await page.fill('#tacInstr', 'Line of Engagement: Mid Block\nDefensive Line: Standard');
  await page.click('#tacSave');
  await page.waitForSelector('#tacCheckStale');
  check('23 po úpravě taktiky starý rozbor zmizí a aplikace řekne, že je potřeba spustit nový', /Klikni znovu na „Analyzovat sestavu a taktiku“/.test(await text(page, '#tacCheckStale')) && (await page.locator('#tacCheckResult').count()) === 0);
  await page.click('#tacCheckBtn');
  await page.waitForSelector('#tacCheckResult');
  const ids2 = await page.$$eval('#tacCheckFindings [data-rule], #tacCheckBanner', (els) => els.map((e) => e.getAttribute('data-rule') || 'banner'));
  check('23 po opravě instrukcí rozpor A01 zmizel a pomalý stoper při standardní linii už není nález', !ids2.includes('A01') && !ids2.includes('A08'), JSON.stringify(ids2));

  // ====================================================== D) role bez míče se ukládá a rozbor ji použije
  await page.fill('#slOop-s6', 'Screening Defensive Midfielder');
  await page.fill('#slOop-s1', 'Sweeper Keeper');
  await page.click('#tacSave');
  await page.waitForSelector('#tacCheckStale');
  const stored = await page.evaluate(() => {
    const t = window.FM27.app.store.list('tactic')[0];
    return { gk: t.slots.find((s) => s.pos === 'GK').oopRole, dm: t.slots.find((s) => s.pos === 'DM').oopRole };
  });
  check('23 role bez míče se uloží do taktiky', stored.gk === 'Sweeper Keeper' && stored.dm === 'Screening Defensive Midfielder', JSON.stringify(stored));
  await page.click('#tacCheckBtn');
  await page.waitForSelector('#tacCheckResult');
  check('23 rozbor počítá nově zadané role bez míče (2 z 11)', /role bez míče: 2 z 11/.test(await text(page, '#tacCheckCoverage')), await text(page, '#tacCheckCoverage'));

  // ====================================================== E) kopírování a čistota konzole
  check('23 rozbor jde zkopírovat jedním tlačítkem', (await page.locator('#tacCheckCopy').count()) === 1);
  check('23 bez chyb ve skriptu a v konzoli (kromě blokovaných zdrojů)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
