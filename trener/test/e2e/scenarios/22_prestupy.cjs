/* Scénář 22: PŘESTUPOVÝ PORADCE (Můj tým → Přestupy: kandidáti a posily).
   Co se zkouší: přidání kandidáta ručně (kontroly, neznámá cena a mzda zůstanou neznámé, rozsah ceny se nepřevezme), načtení kandidátů z tabulky se sloupci pro klub, cenu a mzdu (potvrzení sloupců,
   skryté údaje se nenačtou, duplicity), hledání posil na celý tým i na jedno místo (pořadí, vhodnost a dopad shodné s výpočtem mimo stránku), filtry a nakládání s neznámými údaji, platnost jednání podle data hry, které zadá uživatel (datum hry se nečte),
   dopad odchodu hráče i výměny, uložení doporučení, zapsání výsledku a úspěšnost podle hodnocení uživatele, záloha nových typů dokumentů, žádné volání AI.
   Co se NEzkouší: shoda s hrou (vhodnost je odhad aplikace, ne pravidlo FM27) a skutečné exporty cizích nástrojů (soubory jsou vymyšlené). */
const R = require('../../../src/recruit.js');
const SO = require('../../../src/squadopt.js');

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
  const fmtN = (v) => String(v).replace('.', ',');
  const spaced = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const c = await newContext(browser, {});
  const page = c.page;

  // ====================================================== příprava: kariéra, soupiska, profily rolí a taktika s rolemi
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacReadCard');
  await nav(page, 'tym');
  await page.waitForSelector('#recruitCard');
  check('22 karta Přestupy je v Můj tým a bez soupisky a taktiky řekne, co chybí; kandidáty jde přesto evidovat', /Soupiska je prázdná/.test(await text(page, '#recPrereq')) && /Není žádná taktika/.test(await text(page, '#recPrereq')) && /jen evidovat/.test(await text(page, '#recPrereq')) && (await page.locator('#recAdd').count()) === 1, await text(page, '#recPrereq'));
  const lead = await text(page, '#recLead');
  check('22 úvod říká, že vhodnost je odhad aplikace, cena a mzda jsou jen zadané a skryté údaje se nepoužívají', /odhad aplikace/.test(lead) && /ne pravidlo FM27/.test(lead) && /Cena a mzda jsou jen to, co zadáš/.test(lead) && /skryté údaje se nepoužívají/.test(lead), lead);

  // kandidát bez soupisky a taktiky: dopad nejde spočítat a je to řečeno (nic se nedosazuje)
  await page.evaluate(async () => {
    const app = window.FM27.app;
    await app.store.put('candidate', { careerId: app.career().id, name: 'Předčasný Kandidát', age: 24, positions: ['ST'], attributes: { Finishing: 15 }, club: '', price: null, wage: null, currency: '', contractEnd: '', notes: '', origin: { type: 'manual', fileName: null, at: 1 }, deal: { status: 'watch', validUntil: null, note: '', at: 1 } });
  });
  await page.waitForSelector('#recList [data-act="impact"]');
  await page.click('#recList [data-act="impact"]');
  check('22 u kandidáta bez soupisky a taktiky se dopad nepočítá a píše se proč', /Dopad nejde spočítat: Soupiska je prázdná/.test(await text(page, '#recList [data-impact]')), await text(page, '#recList [data-impact]'));
  await page.click('#recRun');
  check('22 hledání bez soupisky a taktiky ukáže, co chybí, a nic nepočítá', /Nejde spočítat/.test(await text(page, '#recNotReady')) && (await page.locator('#recRows').count()) === 0, await text(page, '#recResults'));
  await page.evaluate(async () => {
    const app = window.FM27.app;
    for (const x of app.store.list('candidate')) await app.store.remove('candidate', x.id);
  });
  await until(async () => (await page.locator('#recList [data-cand]').count()) === 0);

  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const put = (p) => app.store.put('player', { careerId, name: p.name, positions: p.positions, role: '', duty: '', foot: 'unknown', age: p.age || null, attributes: p.attributes, strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    const A = (o) => o;
    const squad = [
      { name: 'Brankář', positions: ['GK'], attributes: A({ Reflexes: 15, Handling: 15, Kicking: 12 }) },
      { name: 'Stoper A', positions: ['DC'], attributes: A({ Passing: 14, Tackling: 17, Composure: 13 }) },
      { name: 'Stoper B', positions: ['DC'], attributes: A({ Passing: 12, Tackling: 13, Composure: 12 }) },
      { name: 'Útočník A', positions: ['ST'], age: 27, attributes: A({ Finishing: 17, 'Off The Ball': 15, Dribbling: 14, Pace: 16 }) },
      { name: 'Útočník B', positions: ['ST'], age: 24, attributes: A({ Finishing: 14, 'Off The Ball': 12, Dribbling: 11, Pace: 13 }) },
      { name: 'Útočník C', positions: ['ST'], age: 21, attributes: A({ Finishing: 11, 'Off The Ball': 10, Dribbling: 9, Pace: 10 }) },
    ];
    for (const p of squad) await put(p);
    const roleDefs = [
      { name: 'Sweeper Keeper', key: ['Reflexes', 'Handling'], pref: ['Kicking'] },
      { name: 'Ball Playing Defender', key: ['Passing', 'Tackling'], pref: ['Composure'] },
      { name: 'Advanced Forward', key: ['Finishing', 'Off The Ball'], pref: ['Dribbling', 'Pace'] },
      { name: 'Poacher', key: ['Finishing'], pref: ['Off The Ball'] },
    ];
    for (const r of roleDefs) await app.store.put('roleprofile', window.TrenerRoleFit.makeProfile({ name: r.name, key: r.key, pref: r.pref, source: 'user' }, { now: 1 }).profile);
    const t = window.TrenerTactics.makeTactic({ formation: '4-4-2', name: 'Zkušební 4-4-2', careerId });
    const roles = { s1: 'Sweeper Keeper', s3: 'Ball Playing Defender', s4: 'Ball Playing Defender', s10: 'Advanced Forward', s11: 'Poacher' };
    t.slots.forEach((sl) => {
      if (roles[sl.key]) sl.role = roles[sl.key];
    });
    const saved = await app.store.put('tactic', t);
    const career = app.store.draft(app.career());
    career.activeTacticId = saved.id;
    await app.store.put('career', career);
  });
  await until(async () => (await page.locator('#recPrereq').count()) === 0);
  check('22 po doplnění soupisky, taktiky s rolemi a profilů rolí varování zmizí', (await page.locator('#recPrereq').count()) === 0);

  // vstup do výpočtu se v Node sestaví z toho, co je opravdu v úložišti stránky
  const world = () => page.evaluate(() => {
    const app = window.FM27.app;
    const tactic = window.FM27.context.activeTactic(app);
    return {
      slots: tactic.slots.map((x) => ({ key: x.key, pos: x.pos, role: x.role, duty: x.duty })),
      players: window.FM27.context.players(app).map((p) => ({ id: p.id, name: p.name, positions: p.positions || [], attributes: p.attributes || {}, injured: !!(p.flags && p.flags.injury) })),
      profiles: app.store.list('roleprofile'),
    };
  });
  const candidates = () => page.evaluate(() => window.FM27.app.store.list('candidate').map((x) => JSON.parse(JSON.stringify(x))));
  const recs = () => page.evaluate(() => window.FM27.app.store.list('recommendation').map((x) => JSON.parse(JSON.stringify(x))));

  // ====================================================== A) ruční přidání kandidáta
  await page.click('#recAdd');
  await page.waitForSelector('#rcName');
  await page.click('#rcSave');
  check('22 kandidát bez jména se nepřijme a nic se neuloží', /Jméno kandidáta chybí/.test(await text(page, '#rcMsg')) && (await candidates()).length === 0, await text(page, '#rcMsg'));
  await page.fill('#rcName', 'Hvězdný Útočník');
  await page.fill('#rcAttrs', 'Finishing 19\nOff The Ball 18\nDribbling 16\nPace 18\nabc');
  await page.click('#rcSave');
  check('22 řádek atributů bez čísla se nepřijme s vysvětlením', /nemá tvar „Název číslo“/.test(await text(page, '#rcMsg')) && (await candidates()).length === 0, await text(page, '#rcMsg'));
  await page.fill('#rcAttrs', 'Finishing 19\nOff The Ball 18\nDribbling 16\nPace 18');
  await page.fill('#rcAge', '29');
  await page.fill('#rcPos', 'st');
  await page.fill('#rcClub', 'FC Zkouška');
  await page.fill('#rcPrice', '€25M - €30M');
  await page.fill('#rcWage', '35000');
  await page.click('#rcSave');
  await until(async () => (await candidates()).length === 1);
  const star = (await candidates())[0];
  check('22 rozsah ceny se nepřevezme (cena zůstane neznámá), mzda se uloží, pozice se zapíše velkými písmeny, věk, klub a atributy se uloží', star.price === null && star.wage === 35000 && JSON.stringify(star.positions) === '["ST"]' && star.age === 29 && star.club === 'FC Zkouška' && star.attributes.Finishing === 19 && star.deal.status === 'watch' && star.origin.type === 'manual', star);
  await until(async () => (await page.locator('#recList [data-cand]').count()) === 1);
  const listText = await text(page, '#recList');
  check('22 v seznamu je kandidát s cenou „neznámá“, mzdou a stavem „sleduji“; je označený jako zadání uživatele', /Hvězdný Útočník/.test(listText) && /Cena: neznámá/.test(listText) && /mzda týdně: 35 000/.test(listText) && /sleduji/.test(listText) && /zadal uživatel/.test(listText), listText);

  // ====================================================== příklady kandidátů pro hledání
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const mk = (name, positions, attributes, extra) => app.store.put('candidate', Object.assign({ careerId, name, age: null, positions, attributes, club: '', price: null, wage: null, currency: '', contractEnd: '', notes: '', origin: { type: 'manual', fileName: null, at: 1 }, deal: { status: 'watch', validUntil: null, note: '', at: 1 } }, extra || {}));
    await mk('Dobrý Útočník', ['ST'], { Finishing: 15, 'Off The Ball': 14, Dribbling: 13, Pace: 14 }, { age: 25, price: 5000000, wage: 20000, currency: '€' });
    await mk('Mladý Talent', ['ST'], { Finishing: 12, 'Off The Ball': 12, Dribbling: 12, Pace: 13 }, { age: 19 });
    await mk('Stoper Navíc', ['DC'], { Passing: 16, Tackling: 19, Composure: 15 }, { age: 27, price: 8000000, currency: '€' });
    await mk('Bez Atributů', ['ST'], { Pace: 18 }, { age: 23 });
    await mk('Jiný Brankář', ['GK'], { Reflexes: 17, Handling: 16, Kicking: 14 }, { age: 31, price: 2000000, wage: 15000, currency: '€' });
  });
  await until(async () => (await page.locator('#recList [data-cand]').count()) === 6);
  const w = await world();
  const allCands = await candidates();
  const expect = R.search({ slots: w.slots, players: w.players, profiles: w.profiles }, { model: 'simple', mode: 'strict', allowPartial: false, bench: true }, allCands, {});

  // ====================================================== B) hledání na celý tým
  await page.click('#recRun');
  await page.waitForSelector('#recRows');
  const order = await page.locator('#recRows [data-cand]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cand')));
  check('22 pořadí kandidátů v prohlížeči je stejné jako při výpočtu mimo stránku (dopad na součet A, potom B)', JSON.stringify(order) === JSON.stringify(expect.rows.map((r) => r.id)), { order, expect: expect.rows.map((r) => r.name) });
  const starRow = expect.rows.find((r) => r.name === 'Hvězdný Útočník');
  const starText = await text(page, `#recRows [data-cand="${starRow.id}"] [data-line="summary"]`);
  check('22 u hvězdy je vidět nejlepší místo, vhodnost a dopad na součet A přesně jako ve výpočtu', starText.includes(`${starRow.bestSlot.pos}`) && starText.includes(fmtN(starRow.bestFit)) && starText.includes(`dopad na součet A +${fmtN(starRow.impact.deltaA)}`), starText);
  const lastRow = expect.rows[expect.rows.length - 1];
  const unknownText = await text(page, `#recRows [data-cand="${expect.rows.find((r) => r.name === 'Bez Atributů').id}"] [data-line="summary"]`);
  check('22 kandidát bez potřebných atributů je na konci a píše se u něj, že vhodnost nejde spočítat (nula se nedosadí); brankář má místo s rolí a ohodnotí se', /nejde spočítat/.test(unknownText) && lastRow.name === 'Bez Atributů' && lastRow.known === false && lastRow.bestFit === null && expect.rows.find((r) => r.name === 'Jiný Brankář').known === true, unknownText);
  check('22 u každého řádku výsledku je vidět stav jednání (sleduji)', /sleduji/.test(await text(page, `#recRows [data-cand="${starRow.id}"] .chips`)), await text(page, `#recRows [data-cand="${starRow.id}"] .chips`));
  const sumText = await text(page, '#recSummary');
  check('22 souhrn říká počet kandidátů a model (jednoduchý vážený průměr, heuristika aplikace)', /Nalezeno 6 kandidátů/.test(sumText) && /jednoduchý vážený průměr/.test(sumText) && /heuristika aplikace/.test(sumText), sumText);
  await page.evaluate(() => document.querySelectorAll('#recRows details').forEach((d) => (d.open = true)));
  const starExplain = await text(page, `#recRows [data-cand="${starRow.id}"] details`);
  check('22 rozbor u hvězdy cituje součty A a B, říká, že cena i mzda jsou zadané nebo neznámé, a že potenciál se nepoužívá', /Součet A/.test(starExplain) && /Cena: neznámá \(UNKNOWN\), neodhaduje se/.test(starExplain) && /mzda: 35 000/.test(starExplain) && /Potenciál a další skryté údaje hry se nepoužívají/.test(starExplain), starExplain);

  // ====================================================== C) hledání na jedno místo
  const slotOptions = await page.locator('#recSlot option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
  check('22 výběr místa nabízí celý tým a jen místa s rolí', slotOptions.length === 6 && /Celý tým/.test(slotOptions[0][1]) && slotOptions.some((o) => /ST · Advanced Forward/.test(o[1])), slotOptions);
  await page.selectOption('#recSlot', 's10');
  await page.click('#recRun');
  await until(async () => /Vhodnost na místě \w+: /.test(await text(page, '#recRows')));
  const expectSlot = R.search({ slots: w.slots, players: w.players, profiles: w.profiles }, { model: 'simple', mode: 'strict', allowPartial: false, bench: true }, allCands, { slotKey: 's10' });
  const order2 = await page.locator('#recRows [data-cand]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cand')));
  check('22 pořadí na jedno místo (podle vhodnosti na roli) je stejné jako při výpočtu mimo stránku', JSON.stringify(order2) === JSON.stringify(expectSlot.rows.map((r) => r.id)), { order2, expect: expectSlot.rows.map((r) => r.name + ':' + (r.slot && r.slot.fit)) });
  const firstFit = expectSlot.rows[0].slot.fit;
  const slotPos = expectSlot.rows[0].slot.pos;
  check('22 první kandidát má vhodnost na místě přesně jako ve výpočtu', (await text(page, `#recRows [data-cand="${expectSlot.rows[0].id}"] [data-line="summary"]`)).includes(`Vhodnost na místě ${slotPos}: ${fmtN(firstFit)}`), await text(page, `#recRows [data-cand="${expectSlot.rows[0].id}"] [data-line="summary"]`));
  await page.evaluate(() => document.querySelectorAll('#recRows details').forEach((d) => (d.open = true)));
  const slotExplain = await text(page, `#recRows [data-cand="${expectSlot.rows[0].id}"] details`);
  check('22 rozbor na místě ukáže současného hráče a rozdíl vhodnosti', /nyní tam hraje Útočník A s vhodností/.test(slotExplain) && /\(rozdíl \+/.test(slotExplain), slotExplain);

  // ====================================================== D) filtry
  await page.selectOption('#recSlot', '');
  await page.fill('#recMaxAge', '27');
  await page.click('#recRun');
  await until(async () => /vyřazeno filtry/.test(await text(page, '#recSummary')));
  const expAge = R.search({ slots: w.slots, players: w.players, profiles: w.profiles }, { model: 'simple', mode: 'strict', allowPartial: false, bench: true }, allCands, { maxAge: 27 });
  check('22 filtr věku vyřadí starší kandidáty a počet vyřazených je v souhrnu', (await page.locator('#recRows [data-cand]').count()) === expAge.rows.length && new RegExp(`vyřazeno filtry: ${Object.values(expAge.skipped).reduce((a, b) => a + b, 0)}`).test(await text(page, '#recSummary')), await text(page, '#recSummary'));
  await page.fill('#recMaxAge', '');
  await page.fill('#recMaxPrice', '6000000');
  await page.click('#recRun');
  await until(async () => /vyřazeno filtry: 1/.test(await text(page, '#recSummary')));
  const unknownPriceKept = await page.locator('#recRows [data-cand]').evaluateAll((els) => els.map((e) => e.innerText));
  check('22 cena nad limit se vyřadí, kandidát s neznámou cenou zůstane a je označený „cena neznámá“', !unknownPriceKept.some((t) => /Stoper Navíc/.test(t)) && unknownPriceKept.some((t) => /Hvězdný Útočník/.test(t) && /cena neznámá \(UNKNOWN\)/.test(t)), unknownPriceKept.map((t) => t.slice(0, 80)));
  await page.check('#recDropPrice');
  await page.click('#recRun');
  await until(async () => !/Hvězdný Útočník/.test(await text(page, '#recRows')));
  check('22 po zapnutí „vyřadit kandidáty s neznámou cenou“ zůstanou jen ti s cenou v limitu', (await page.locator('#recRows [data-cand]').count()) === 2 && /Dobrý Útočník/.test(await text(page, '#recRows')) && /Jiný Brankář/.test(await text(page, '#recRows')), await text(page, '#recRows'));
  await page.uncheck('#recDropPrice');
  await page.fill('#recMaxPrice', '');

  // ====================================================== E) doporučení a výsledek
  await page.click('#recRun');
  await page.waitForSelector('#recRows [data-act="recommend"]');
  await page.locator(`#recRows [data-cand="${starRow.id}"] [data-act="recommend"]`).click();
  await until(async () => (await recs()).length === 1);
  const rec = (await recs())[0];
  check('22 doporučení se uložilo s kandidátem, místem, modelem, doklady a očekávaným dopadem; výsledek je prázdný', rec.candidateName === 'Hvězdný Útočník' && rec.kind === 'transfer' && rec.slot && rec.slot.pos === starRow.impact.placements[0].pos && rec.slot.slotKey === starRow.impact.placements[0].slotKey && /jednoduchý vážený průměr/.test(rec.model) && rec.evidence.length >= 4 && rec.expected.deltaA === starRow.impact.deltaA && rec.result === null && rec.snapshot.price === null, rec);
  await until(async () => await page.locator(`#recRows [data-cand="${starRow.id}"] [data-act="recommend"]`).isDisabled());
  check('22 u kandidáta s otevřeným doporučením je tlačítko opravdu vypnuté a říká to', (await page.locator(`#recRows [data-cand="${starRow.id}"] [data-act="recommend"]`).isDisabled()) && /už je uložené/.test(await text(page, `#recRows [data-cand="${starRow.id}"] [data-act="recommend"]`)));
  check('22 doporučení je vidět v seznamu a úspěšnost zatím nejde spočítat', /Hvězdný Útočník/.test(await text(page, '#recRecs')) && /Doporučení: 1, otevřených 1/.test(await text(page, '#recStats')) && /úspěšnost nejde spočítat/.test(await text(page, '#recStats')), await text(page, '#recStats'));
  const recBox = '#recRecs [data-rec]';
  await page.fill(`${recBox} [data-f="note"]`, 'rozepsaná poznámka');
  await page.evaluate(() => { document.querySelector('#recRecs [data-rec] [data-f="note"]').__znacka = 'stejny-prvek'; });
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const c0 = app.store.list('candidate')[0];
    const next = app.store.draft(c0);
    next.notes = 'změna na pozadí';
    await app.store.put('candidate', next);
  });
  await page.waitForTimeout(500);
  check('22 rozepsaná poznámka u doporučení přežije změnu dat na pozadí', (await page.inputValue(`${recBox} [data-f="note"]`)) === 'rozepsaná poznámka', await page.inputValue(`${recBox} [data-f="note"]`));
  check('22 při psaní poznámky se karta nepřekreslí: pole je pořád to samé a drží kurzor', await page.evaluate(() => { const el = document.querySelector('#recRecs [data-rec] [data-f="note"]'); return el.__znacka === 'stejny-prvek' && document.activeElement === el; }));
  await page.click('#recLead'); // opuštění pole: odložené překreslení se provede a poznámka zůstane
  const redrawn = await until(async () => (await page.evaluate(() => document.querySelector('#recRecs [data-rec] [data-f="note"]').__znacka)) === undefined);
  check('22 po opuštění pole se odložené překreslení provede (pole je nové) a rozepsaná poznámka zůstane', redrawn && (await page.inputValue(`${recBox} [data-f="note"]`)) === 'rozepsaná poznámka', await page.inputValue(`${recBox} [data-f="note"]`));
  await page.fill(`${recBox} [data-f="note"]`, '');
  await page.selectOption(`${recBox} [data-f="decision"]`, 'passed');
  await page.selectOption(`${recBox} [data-f="verdict"]`, 'good');
  await page.click(`${recBox} [data-act="result"]`);
  check('22 hodnotit výsledek jde jen u koupeného hráče: nic se nezapíše a je to řečeno', /jen u koupeného hráče/.test(await text(page, recBox)) && (await recs())[0].result === null, await text(page, recBox));
  await page.selectOption(`${recBox} [data-f="decision"]`, 'signed');
  await page.fill(`${recBox} [data-f="note"]`, 'Střílí góly');
  await page.click(`${recBox} [data-act="result"]`);
  await until(async () => (await recs())[0].result !== null);
  const done = (await recs())[0];
  check('22 výsledek „koupeno, dopadlo dobře“ se zapsal i s poznámkou', done.result.decision === 'signed' && done.result.verdict === 'good' && done.result.note === 'Střílí góly', done.result);
  await until(async () => /Hodnocených případů je jen 1/.test(await text(page, '#recStats')));
  check('22 úspěšnost je podle hodnocení uživatele a při jednom případu říká, že nic nedokazuje', /100 %/.test(await text(page, '#recStats')) && /nic nedokazuje/.test(await text(page, '#recStats')), await text(page, '#recStats'));

  // ====================================================== F) dopad příchodu přímo u kandidáta, stav jednání a platnost podle data ve hře
  const good = (await candidates()).find((x) => x.name === 'Dobrý Útočník');
  await page.locator(`#recList [data-cand="${good.id}"] [data-act="impact"]`).click();
  await page.waitForSelector(`#recList [data-impact="${good.id}"] [data-cand]`);
  const goodRow = R.search({ slots: w.slots, players: w.players, profiles: w.profiles }, { model: 'simple', mode: 'strict', allowPartial: false, bench: true }, [good], { statuses: 'all' }).rows[0];
  check('22 tlačítko „Dopad příchodu“ u kandidáta ukáže jeho vhodnost a dopad přesně jako ve výpočtu', (await text(page, `#recList [data-impact="${good.id}"] [data-line="summary"]`)).includes(fmtN(goodRow.bestFit)) && (await text(page, `#recList [data-impact="${good.id}"] [data-line="summary"]`)).includes(`dopad na součet A ${goodRow.impact.deltaA > 0 ? '+' : ''}${fmtN(goodRow.impact.deltaA)}`), await text(page, `#recList [data-impact="${good.id}"]`));
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const c0 = app.store.list('candidate')[0];
    const next = app.store.draft(c0);
    next.notes = 'změna na pozadí 2';
    await app.store.put('candidate', next);
  });
  await page.waitForTimeout(500);
  check('22 otevřený rozbor dopadu u kandidáta přežije překreslení seznamu po změně dat na pozadí', (await page.locator(`#recList [data-impact="${good.id}"] [data-cand]`).count()) === 1);
  await page.locator(`#recList [data-cand="${good.id}"] [data-act="edit"]`).click();
  await page.waitForSelector('#rcStatus');
  check('22 úprava kandidáta ukáže jeho hodnoty (cena a mzda jako čísla, měna, stav)', (await page.inputValue('#rcName')) === 'Dobrý Útočník' && (await page.inputValue('#rcPrice')) === '5000000' && (await page.inputValue('#rcWage')) === '20000' && (await page.inputValue('#rcCur')) === '€' && (await page.inputValue('#rcStatus')) === 'watch');
  await page.selectOption('#rcStatus', 'offer');
  await page.fill('#rcValid', '31.1.2027');
  await page.click('#rcSave');
  await until(async () => (await candidates()).find((x) => x.id === good.id).deal.status === 'offer');
  const offered = (await candidates()).find((x) => x.id === good.id);
  check('22 neplatné datum platnosti se nepřevezme (je to oznámeno), stav jednání se uloží a čas změny se aktualizuje', offered.deal.validUntil === null && offered.deal.status === 'offer' && offered.deal.at > good.deal.at, offered.deal);
  await page.locator(`#recList [data-cand="${good.id}"] [data-act="edit"]`).click();
  await page.waitForSelector('#rcValid');
  await page.fill('#rcValid', '2027-01-10');
  await page.fill('#rcDealNote', 'čeká na odpověď klubu');
  await page.click('#rcSave');
  await until(async () => (await candidates()).find((x) => x.id === good.id).deal.validUntil === '2027-01-10');
  await until(async () => /platí do 2027-01-10/.test(await text(page, `#recList [data-cand="${good.id}"]`)));
  const noDate = await text(page, `#recList [data-cand="${good.id}"]`);
  check('22 platnost jednání bez data ve hře se nehlídá a je to napsané; stav, platnost a poznámka jsou vidět', /nabídka podána/.test(noDate) && /platí do 2027-01-10/.test(noDate) && /Platnost se nehlídá: není zadané dnešní datum ve hře/.test(noDate) && /čeká na odpověď klubu/.test(noDate) && !/platnost jednání skončila/.test(noDate), noDate);
  await page.fill('#recGameDate', '2027-02-30');
  await page.locator('#recGameDate').blur();
  check('22 neexistující datum ve hře se nepřijme a kariéra se nezmění', /existovat v kalendáři/.test(await text(page, '#recGameDateMsg')) && (await page.evaluate(() => window.FM27.app.career().gameDate)) === undefined, await text(page, '#recGameDateMsg'));
  await page.fill('#recGameDate', '2027-01-11');
  await page.locator('#recGameDate').blur();
  await until(async () => (await page.evaluate(() => window.FM27.app.career().gameDate)) === '2027-01-11');
  await until(async () => /platnost jednání skončila/.test(await text(page, `#recList [data-cand="${good.id}"]`)));
  const expired = await text(page, `#recList [data-cand="${good.id}"]`);
  check('22 po zadání data ve hře po platnosti se jednání označí jako propadlé a řekne se, o kolik dní', /platnost jednání skončila/.test(expired) && /před 1 dnem/.test(expired) && !/Platnost se nehlídá/.test(expired), expired);
  check('22 datum ve hře je uložené v kariéře jako text RRRR-MM-DD', (await page.evaluate(() => window.FM27.app.career().gameDate)) === '2027-01-11');

  // ====================================================== G) odchod hráče a výměna
  const inputNow = { slots: w.slots, players: w.players, profiles: w.profiles };
  const optsNow = { model: 'simple', mode: 'strict', allowPartial: false, bench: true };
  const uA = w.players.find((x) => x.name === 'Útočník A');
  await page.selectOption('#recDepPlayer', uA.id);
  await page.waitForSelector('#recDepLines li');
  const depLines = await page.locator('#recDepLines li').allInnerTexts();
  check('22 odchod hráče: řádky o součtu A a B a změnách po místech jsou stejné jako ve výpočtu mimo stránku', JSON.stringify(depLines) === JSON.stringify(R.describeChange(R.departure(inputNow, optsNow, uA.id))) && /Součet A .* \(-/.test(depLines[0]), depLines);
  check('22 odchod říká, že se nic nemění a jde jen o výpočet', /Nic se v soupisce ani v taktice nemění/.test(await text(page, '#recDeparture')) && /Když odejde Útočník A:/.test(await text(page, '#recDepTitle')));
  const star2 = (await candidates()).find((x) => x.name === 'Hvězdný Útočník');
  await page.selectOption('#recDepSwap', star2.id);
  await until(async () => /a přijde Hvězdný Útočník/.test(await text(page, '#recDepTitle')));
  const swapLines = await page.locator('#recDepLines li').allInnerTexts();
  const swapCand = R.normalizeCandidate(Object.assign({}, star2), {}).candidate;
  check('22 výměna: řádky odpovídají výpočtu a součet A po výměně je vyšší než po samotném odchodu', JSON.stringify(swapLines) === JSON.stringify(R.describeChange(R.swap(inputNow, optsNow, Object.assign({}, swapCand, { id: star2.id }), uA.id))) && R.swap(inputNow, optsNow, Object.assign({}, swapCand, { id: star2.id }), uA.id).deltaA > R.departure(inputNow, optsNow, uA.id).deltaA, swapLines);

  // ---------- podobní kandidáti: potřebují všechny atributy, jinak se neřadí a říká se proč
  check('22 hráč s částí atributů: podobné kandidáty nejde hledat, říká se proč a že míra je vlastní model (nic se nedomýšlí)', /Hráči chybí atributy/.test(await text(page, '#recSimilarWhy')) && /vlastní model aplikace/.test(await text(page, '#recSimilar')), await text(page, '#recSimilar'));
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const A = window.TrenerDwrs.OUTFIELD_ATTRIBUTES;
    const full = (v, over) => Object.assign(Object.fromEntries(A.map((a) => [a, v])), over || {});
    await app.store.put('player', { careerId, name: 'Úplný Útočník', positions: ['ST'], role: '', duty: '', foot: 'unknown', age: 26, attributes: full(12, { Finishing: 17, Pace: 16 }), strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    const mk = (name, attributes) => app.store.put('candidate', { careerId, name, age: 24, positions: ['ST'], attributes, club: '', price: null, wage: null, currency: '', contractEnd: '', notes: '', origin: { type: 'manual', fileName: null, at: 1 }, deal: { status: 'watch', validUntil: null, note: '', at: 1 } });
    await mk('Podobný Plný', full(12, { Finishing: 16, Pace: 16 }));
    await mk('Vzdálený Plný', full(6, { Finishing: 4, Pace: 5 }));
    await mk('Neúplný Podobný', { Finishing: 17, Pace: 16 });
  });
  const tgt = await page.evaluate(() => {
    const p = window.FM27.context.players(window.FM27.app).find((x) => x.name === 'Úplný Útočník');
    return { id: p.id, name: p.name, positions: p.positions, attributes: p.attributes };
  });
  await until(async () => (await page.locator('#recDepPlayer option', { hasText: 'Úplný Útočník' }).count()) === 1);
  await page.selectOption('#recDepSwap', '');
  await page.selectOption('#recDepPlayer', tgt.id);
  await page.waitForSelector('#recSimilarRows [data-similar]');
  const openCands = (await candidates()).filter((x) => R.OPEN_STATUSES.includes(x.deal.status));
  const simExpect = R.similarCandidates(tgt, openCands, { n: 5 });
  const simRows = await page.locator('#recSimilarRows [data-similar]').allInnerTexts();
  check('22 podobní kandidáti: pořadí, podobnost i vzdálenost jsou přesně jako ve výpočtu mimo stránku a nejpodobnější je „Podobný Plný“', simExpect.ok && simExpect.rows[0].name === 'Podobný Plný' && JSON.stringify(simRows) === JSON.stringify(simExpect.rows.map((x) => `${x.name}: podobnost ${fmtN(x.similarity)} (vzdálenost ${fmtN(x.distance)})`)), { simRows, expect: simExpect.rows.map((x) => x.name) });
  const simUnknown = await text(page, '#recSimilarUnknown');
  check('22 kandidáti bez všech atributů se neřadí a jsou vypsaní zvlášť jako „bez porovnání“', /Bez porovnání \(chybí atributy\):/.test(simUnknown) && /Neúplný Podobný/.test(simUnknown) && !/Podobný Plný/.test(simUnknown), simUnknown);

  // ====================================================== H) načtení kandidátů z tabulky
  const csv = [
    'Name,Age,Position,Club,Asking Price,Wage,Contract Expires,Finishing,Off The Ball,Dribbling,Pace,Passing,Current Ability',
    'Tabulkový Útočník,22,ST,FC Export,€12.5M,"€35,000 p/w",2029-06-30,16,15,14,17,10,150',
    'Druhý Z Tabulky,30,ST,Test United,€900K,€8K p/w,2027-06-30,13,12,11,10,9,120',
    'Útočník A,27,ST,Duplicita,€1M,,,17,15,14,16,8,100',
    'Rozsah Cena,25,ST,Range FC,€25M - €30M,€2M p/a,,12,11,10,12,8,90',
  ].join('\n');
  const before = (await candidates()).length;
  await page.setInputFiles('#recFile', { name: 'kandidati.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.waitForSelector('#recImportColumns');
  const roles = await page.locator('#recImportColumns [data-header]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-header'), e.querySelector('select').value])));
  check('22 sloupce z tabulky dostanou návrh významu (jméno, věk, pozice, klub, cena, mzda, konec smlouvy, atributy); skrytý údaj se ignoruje', roles.Name === 'name' && roles.Age === 'age' && roles.Position === 'positions' && roles.Club === 'club' && roles['Asking Price'] === 'price' && roles.Wage === 'wage' && roles['Contract Expires'] === 'contract' && roles.Finishing === 'attribute' && roles.Pace === 'attribute' && roles['Current Ability'] === 'ignore', roles);
  const impSummary = await text(page, '#recImportSummary');
  check('22 souhrn: přidají se tři kandidáti, jeden je duplicitní (je v soupisce) a nečitelné částky jsou vysvětlené', /Přidá se 3 kandidáti/.test(impSummary) && /opakují: 1/.test(impSummary) && /Cena: Rozsah cen se nepřebírá/.test(impSummary) && /Mzda: je roční/.test(impSummary), impSummary);
  check('22 náhled ukáže cenu a mzdu přečtenou ze souboru, nebo „neznámá“', /cena 12 500 000 €/.test(await text(page, '#recImportPlayers')) && /mzda 35 000 €/.test(await text(page, '#recImportPlayers')) && /cena neznámá/.test(await text(page, '#recImportPlayers')), await text(page, '#recImportPlayers'));
  await page.click('#recImportAdd');
  check('22 bez potvrzení sloupců se nic nepřidá', (await candidates()).length === before);
  await page.check('#recImportConfirm');
  await page.click('#recImportAdd');
  await until(async () => (await candidates()).length === before + 3);
  const all2 = await candidates();
  const tab = all2.find((x) => x.name === 'Tabulkový Útočník');
  const range = all2.find((x) => x.name === 'Rozsah Cena');
  check('22 z tabulky se uložily ceny a mzdy jen tam, kde byly čitelné; původ je tabulka a soubor; skrytá Current Ability se nepřevzala', tab.price === 12500000 && tab.wage === 35000 && tab.currency === '€' && tab.contractEnd === '2029-06-30' && tab.origin.type === 'table' && tab.origin.fileName === 'kandidati.csv' && range.price === null && range.wage === null && !JSON.stringify(all2).includes('Current Ability') && Object.keys(tab.attributes).length === 5 && !all2.some((x) => x.name === 'Útočník A'), { tab, range });
  await until(async () => (await page.locator('#recList [data-cand]').count()) === before + 3);
  check('22 nově načtení kandidáti jsou v seznamu a značka říká „z tabulky (zadal uživatel)“', /z tabulky \(zadal uživatel\)/.test(await text(page, `#recList [data-cand="${tab.id}"]`)));

  // ====================================================== I) mazání a záloha nových typů dokumentů
  await page.locator(`#recList [data-cand="${range.id}"] button`, { hasText: 'Smazat' }).click();
  await page.locator(`#recList [data-cand="${range.id}"] button`, { hasText: 'Opravdu smazat?' }).click();
  await until(async () => (await candidates()).every((x) => x.id !== range.id));
  await until(async () => (await page.locator(`#recList [data-cand="${range.id}"]`).count()) === 0);
  check('22 smazání kandidáta chce potvrzení a po něm kandidát zmizí ze seznamu i z úložiště', (await page.locator(`#recList [data-cand="${range.id}"]`).count()) === 0);
  const backup = await page.evaluate(async () => {
    const store = window.FM27.app.store;
    const data = store.exportAll();
    const docs = data.docs.filter((d) => d.type === 'candidate' || d.type === 'recommendation');
    const revived = docs.map((d) => Object.assign({}, d, { updatedAt: d.updatedAt + 1000, data: Object.assign({}, d.data, { notes: d.type === 'candidate' ? 'z obrazu' : undefined }) }));
    const n = await store.importAll({ format: data.format, version: data.version, docs: revived });
    return { candidates: docs.filter((d) => d.type === 'candidate').length, recommendations: docs.filter((d) => d.type === 'recommendation').length, accepted: n, notes: store.list('candidate').filter((x) => x.notes === 'z obrazu').length };
  });
  check('22 záloha obsahuje kandidáty i doporučení a po obnově se přijmou', backup.candidates >= 7 && backup.recommendations === 1 && backup.accepted === backup.candidates + backup.recommendations && backup.notes === backup.candidates, backup);

  check('22 čtení a výpočty nevolají AI', (await page.evaluate(() => window.__mock.calls.length)) === 0);
  check('22 bez chyb ve skriptu a v konzoli', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
