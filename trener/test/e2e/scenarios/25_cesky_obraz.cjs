/* Scénář 25: ČESKÁ HRA FM27. Čtení tabulky „Tvar týmu“ a „Týmových instrukcí“, soupisky a profilu role z obrazovek v češtině (průzkum 7. 11. 2026):
   formace se odvodí z jedenácti míst tabulky, role s míčem i bez míče se dosadí k místům, jména hráčů se spárují s kádrem, české pozice
   a názvy atributů se převedou na kanonické a rozbor taktiky z toho přečte instrukce i ověřené role.
   Co se zkouší: tok v prohlížeči s odpovědí zkušební náhražky ve tvaru české obrazovky. Co se NEzkouší: skutečné čtení obrazovky FM27
   skutečným Claude (odpověď dodává náhražka) a skutečné role mimo ty, které průzkum potvrdil. Jména hráčů ve zkoušce jsou vymyšlená. */
module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, open, nav, text } = h;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return fn();
  };
  const toast = (page) => text(page, '#toast');

  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacReadCard');

  // ---------- kádr zadaný do úložiště (jména jako anglicky psaná plná jména; tabulka hry má „J. Novotný“)
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const mk = (name, positions) => ({ careerId, name, positions, role: '', duty: '', foot: 'unknown', age: null, attributes: {}, strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    await app.store.put('player', mk('Jiří Novotný', ['GK']));
    await app.store.put('player', mk('Tomáš Svoboda', ['DR']));
    await app.store.put('player', mk('Radek Dvořák', ['DC']));
    await app.store.put('player', mk('Marek Veselý', ['DM']));
    await app.store.put('player', mk('Martin Veselý', ['DM']));
    await app.store.put('player', mk('Gabriel Jelínek', ['ST']));
  });
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacReadCard');

  // ====================================================== A) Tvar týmu + Týmové instrukce česky
  const ROWS = [
    { slot: 'B', role: 'GK', oopRole: 'GK', player: 'J. Novotný' },
    { slot: 'O (P)', role: 'O', oopRole: 'FB', player: 'T. Svoboda' },
    { slot: 'O (S)', role: 'CB', oopRole: 'CB', player: 'R. Dvořák' },
    { slot: 'O (S)', role: 'BCB', oopRole: 'CB', player: 'S. Procházka' },
    { slot: 'O (L)', role: 'KO', oopRole: 'FB', player: 'L. Horák' },
    { slot: 'DZ', role: 'DZ', oopRole: 'DM', player: 'M. Veselý' },
    { slot: 'DZ', role: 'ZTH', oopRole: 'DM', player: 'A. Kučera' },
    { slot: 'OZ (P)', role: 'PHH', oopRole: 'TWM', player: 'W. Král' },
    { slot: 'OZ (S)', role: 'FR', oopRole: 'AM', player: 'N. Pospíšil' },
    { slot: 'OZ (L)', role: 'IW', oopRole: 'TWM', player: 'G. Marek' },
    { slot: 'ÚT (S)', role: 'KH', oopRole: 'CFD', player: 'G. Jelínek' },
    { slot: 'S1', role: 'GK', oopRole: 'GK', player: 'N. Rezerva' },
  ];
  const INSTR = [
    { label: 'Přímočarost přihrávek', value: 'Mnohem kratší', phase: 'in' },
    { label: 'Tempo', value: 'Vyšší', phase: 'in' },
    { label: 'Šířka při útočení', value: 'Užší', phase: 'in' },
    { label: 'Linie napadání', value: 'Nízký blok', phase: 'out' },
    { label: 'Výška obranná linie', value: 'Vyšší', phase: 'out' },
    { label: 'Napadání', value: 'Častěji', phase: 'out' },
    { label: 'Obranný přechod', value: 'Kontrapresink', phase: 'out' },
  ];
  await page.evaluate(([rows, instr]) => (window.__mock.tacReply = { name: 'Z české hry', formation: null, style: 'Čistý štít', mentality: 'Vyvážený', instructions: instr, roles: rows, notes: 'čitelné' }), [ROWS, INSTR]);
  await page.setInputFiles('#tacShot', fx('screenshot.png'));
  await page.evaluate(() => {
    window.__mock.calls = [];
    window.__mock.prompts = [];
  });
  await page.click('#tacReadBtn');
  await page.waitForSelector('#tacReadRows', { timeout: 15000 });
  const prompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /obrazovka s taktikou hry/.test(p)).pop() || '';
  check('25 zadání popisuje českou obrazovku: sloupce Zvp, Role, Role MP, pole Styl a Herní systém, dlaždice instrukcí, vynechání lavičky a měřidel', /Zvp/.test(prompt) && /Role MP/.test(prompt) && /Herní systém/.test(prompt) && /„label“/.test(prompt) && /S1 až S9/.test(prompt) && /Intenzita, Complexity a Effectiveness/.test(prompt), prompt.slice(0, 200));
  const rows = await text(page, '#tacReadRows');
  check('25 návrh ukáže odvozenou formaci, styl, mentalitu, instrukce (rozpoznáno 7 z 7) a role s míčem i bez míče', /4-2-3-1 \(odvozeno z jedenácti míst tabulky\)/.test(rows) && /Čistý štít/.test(rows) && /Vyvážený/.test(rows) && /rozpoznáno 7 z 7/.test(rows) && /O \(S\): BCB \/ CB/.test(rows) && /ÚT \(S\): KH \/ CFD/.test(rows), rows);
  check('25 lavička (S1) se nečte jako základní hráč', !/S1: GK/.test(rows) && !/N\. Rezerva/.test(rows), rows);
  check('25 formace v nabídce je předvyplněná odvozenou a stav to přizná', (await page.inputValue('#tacReadFormation')) === '4-2-3-1' && /odvozená z jedenácti míst/.test(await text(page, '#tacReadOut')), await text(page, '#tacReadOut'));
  await page.check('#tacReadConfirm');
  await page.click('#tacReadCreate');
  await until(async () => (await page.evaluate(() => window.FM27.context.tactics(window.FM27.app).length)) === 1);
  await page.waitForFunction(() => /Taktika „/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
  const createToast = await toast(page);
  const t = await page.evaluate(() => window.FM27.context.tactics(window.FM27.app)[0]);
  const by = (pos) => t.slots.find((s) => s.pos === pos);
  check('25 vznikne taktika 4-2-3-1 se stylem, mentalitou a sedmi instrukcemi česky', t.formation === '4-2-3-1' && t.style === 'Čistý štít' && t.mentality === 'Vyvážený' && t.teamInstructions.length === 7 && t.teamInstructions[0] === 'Přímočarost přihrávek: Mnohem kratší', t);
  check('25 role s míčem i bez míče jsou u míst; dva stopeři zprava doleva s poznámkou o odhadu', by('RB').role === 'O' && by('RB').oopRole === 'FB' && by('RCB').role === 'CB' && by('LCB').role === 'BCB' && by('ST').oopRole === 'CFD' && /odhad/.test(t.notes), { rb: by('RB'), rcb: by('RCB'), lcb: by('LCB'), notes: t.notes });
  check('25 hráči z tabulky se spárovali s kádrem jen tam, kde je shoda jednoznačná (brankář, pravý bek, stoper, útočník); dva Veselí a neznámí ne', by('GK').playerId && by('RB').playerId && by('RCB').playerId && by('ST').playerId && !by('RDM').playerId && !by('LDM').playerId && t.slots.every((s) => !('readPlayer' in s)), t.slots.map((s) => [s.pos, s.playerId]));
  check('25 toast řekl, kolik hráčů se přiřadilo a kolik jmen se nepodařilo spárovat', /Ke 4 místům jsem přiřadil hráče/.test(createToast) && /jmen se nepodařilo jednoznačně spárovat/.test(createToast), createToast);

  // ---------- rozbor taktiky čte české instrukce a jen ověřené role
  await page.waitForSelector('#tacCheckBtn');
  await page.click('#tacCheckBtn');
  await page.waitForSelector('#tacCheckTop');
  const cov = await text(page, '#tacCheckResult');
  check('25 rozbor ukáže „týmové instrukce: 7 z 27“ (ve hře je jich 27) a mentalitu Balanced', /týmové instrukce: 7 z 27/.test(cov) && /mentalita: Balanced/.test(cov), cov.slice(0, 500));
  check('25 role s míčem: jen 3 z 11 (GK, CB, BCB jsou ověřené zkratky), ostatní zkratky aplikace nehádá', /role s míčem: 3 z 11/.test(cov) && /role bez míče: 4 z 11/.test(cov), cov.slice(0, 500));

  // ====================================================== B) soupiska česky
  await nav(page, 'tym');
  await page.waitForSelector('#squadRead');
  await page.evaluate(() => {
    window.__mock.squadReply = {
      players: [
        { name: 'T. Svoboda', positions: ['O/KO/Z/OZ (P)'], age: 24, role: null, attributes: { Hlavičky: 8, 'Obranné zákroky': 15, Obsazování: 14, 'Poziční hra': 13, Rychlost: 14 }, injured: null },
        { name: 'A. Kučera', positions: ['DZ, Z (S)'], age: 22, role: null, attributes: { Přihrávky: 16, Zpracování: 15 }, injured: false },
        { name: 'Nový Hráč', positions: ['OZ (LS)', 'ÚT (S)'], age: 19, role: null, attributes: { Zakončování: 12, 'Bez míče': 13 }, injured: false },
      ],
      notes: 'čitelné',
    };
  });
  await page.setInputFiles('#squadShot', fx('screenshot.png'));
  await page.click('#squadRead');
  await page.waitForSelector('#squadProposals .book');
  const prop = await text(page, '#squadProposals');
  check('25 soupiska: nový hráč a hráč už v kádru (doplnit atributy) jsou ve dvou skupinách, pozice jsou převedené na kódy', /Noví hráči/i.test(prop) && /Už v kádru: doplnit atributy/i.test(prop) && /AML\/AMC\/ST/.test(prop) && /Heading: nově 8/.test(prop), prop);
  await page.check('#squadConfirm');
  await page.click('#squadAdd');
  await until(async () => (await page.evaluate(() => window.FM27.context.players(window.FM27.app).length)) === 8);
  const squadToast = await toast(page);
  const pl = await page.evaluate(() => window.FM27.context.players(window.FM27.app).map((p) => ({ name: p.name, positions: p.positions, attributes: p.attributes, age: p.age })));
  const sv = pl.find((p) => p.name === 'Tomáš Svoboda');
  const nh = pl.find((p) => p.name === 'Nový Hráč');
  check('25 toast řekl, že se přidali dva hráči a jeden se doplnil', /Přidáno hráčů: 2/.test(squadToast) && /Doplněno hráčů: 1/.test(squadToast), squadToast);
  check('25 hráči se doplnili a přidali s kanonickými názvy atributů a kódy pozic (Heading, Tackling, Positioning, AML)', sv.attributes.Heading === 8 && sv.attributes.Tackling === 15 && sv.attributes.Positioning === 13 && sv.attributes.Pace === 14 && nh.positions.join() === 'AML,AMC,ST' && nh.attributes['Finishing'] === 12 && nh.attributes['Off The Ball'] === 13 && nh.age === 19, { sv, nh });
  check('25 věk a pozice existujícího hráče se nepřepsaly (už byly), jen se doplnil věk, který chyběl', JSON.stringify(sv.positions) === '["DR"]' && sv.age === 24, sv);

  // dva různí hráči téhož jména na snímku se nesloučí ani nezapíšou (nález revize A3)
  await page.evaluate(() => {
    window.__mock.squadReply = {
      players: [
        { name: 'J. Silva', positions: ['O (S)'], age: 25, attributes: { Rychlost: 12 } },
        { name: 'J. Silva', positions: ['O (S)'], age: 31, attributes: { Síla: 14 } },
        { name: 'Třetí Hráč', positions: ['B'], age: 28, attributes: {} },
      ],
      notes: 'čitelné',
    };
  });
  await page.setInputFiles('#squadShot', fx('screenshot.png'));
  await page.click('#squadRead');
  await page.waitForSelector('#squadSkipped', { timeout: 15000 });
  const skipTxt = await text(page, '#squadSkipped');
  check('25 dva různí hráči téhož jména na snímku se nezapíšou a řekne se proč; nový hráč se nabídne', /J\. Silva/.test(skipTxt) && /stejným jménem/.test(skipTxt) && /Třetí Hráč/.test(await text(page, '#squadNew')) && !/J\. Silva/.test(await text(page, '#squadNew')), skipTxt);
  await page.check('#squadConfirm');
  await page.click('#squadAdd');
  await until(async () => (await page.evaluate(() => window.FM27.context.players(window.FM27.app).length)) === 9);
  check('25 zapsal se jen jeden hráč a J. Silva se do kádru nedostal', !(await page.evaluate(() => window.FM27.context.players(window.FM27.app).some((p) => /Silva/.test(p.name)))));

  // skryté údaje se nedostanou do kontextu AI, ani když je dřívější verze aplikace uložila (nález revize B4)
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const p = app.store.draft(window.FM27.context.players(app).find((x) => x.name === 'Tomáš Svoboda'));
    p.attributes = Object.assign({}, p.attributes, { Professionalism: 18, Potential: 17, 'Current Ability': 14, Reputation: 9, Personality: 11 });
    await app.store.put('player', p);
  });
  const squadCtx = await page.evaluate(async () => (await window.FM27.context.observations(window.FM27.app, { tactic: false, memory: false })).find((o) => o.id === 'squad').text);
  check('25 skryté údaje (CA, PA, osobnost, reputace, skryté atributy) se do kontextu AI nedostanou, známé atributy ano', /Heading/.test(squadCtx) && !/Professionalism|Potential|Current Ability|Reputation|Personality/.test(squadCtx), squadCtx.slice(0, 400));

  // ====================================================== C) role s míčem a bez míče se nepřepisují
  await nav(page, 'taktiky');
  await page.waitForSelector('#roleReadBtn');
  await page.evaluate(() => (window.__mock.roleReply = { role: 'Střední obránce', phase: 'in', duty: null, key: ['Hlavičky', 'Obranné zákroky'], preferred: ['Rychlost'], notes: 'zelená a modrá' }));
  await page.setInputFiles('#roleShot', fx('screenshot.png'));
  await page.evaluate(() => {
    window.__mock.prompts = [];
  });
  await page.click('#roleReadBtn');
  await page.waitForSelector('#roleReadSave', { timeout: 15000 });
  const rprompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /s profilem hráče nebo s popisem role/.test(p)).pop() || '';
  check('25 zadání pro profil role popisuje barvy podle fáze: s míčem zelená a modrá, bez míče růžová a fialová', /zelený/.test(rprompt) && /modrý/.test(rprompt) && /růžový/.test(rprompt) && /fialový/.test(rprompt) && /celý řádek atributu/.test(rprompt), rprompt.slice(0, 200));
  await page.check('#roleReadConfirm');
  await page.click('#roleReadSave');
  await until(async () => (await page.evaluate(() => window.FM27.app.store.list('roleprofile').length)) === 1);
  await until(async () => (await page.locator('#roleReadSave').count()) === 0);
  await page.evaluate(() => (window.__mock.roleReply = { role: 'Střední obránce', phase: 'out', duty: null, key: ['Hlavičky', 'Poziční hra'], preferred: ['Agresivita'], notes: 'růžová a fialová' }));
  await page.setInputFiles('#roleShot', fx('screenshot.png'));
  await page.click('#roleReadBtn');
  await page.waitForSelector('#roleReadSave', { timeout: 15000 });
  check('25 druhé čtení téže role v druhé fázi nehlásí přepsání (je to jiný profil)', (await page.locator('#roleReadExists').count()) === 0);
  await page.check('#roleReadConfirm');
  await page.click('#roleReadSave');
  await until(async () => (await page.evaluate(() => window.FM27.app.store.list('roleprofile').length)) === 2);
  const profs = await page.evaluate(() => window.FM27.app.store.list('roleprofile').map((p) => ({ id: p.id, name: p.name, phase: p.phase, key: p.key })));
  check('25 vznikly dva profily „Střední obránce“: s míčem a bez míče, s českými názvy atributů', profs.length === 2 && profs.some((p) => p.phase === 'in' && p.key.includes('Hlavičky')) && profs.some((p) => p.phase === 'out' && p.key.includes('Poziční hra')) && new Set(profs.map((p) => p.id)).size === 2, profs);

  // úprava profilu role bez míče nepřepíše profil téhož jména s míčem (nález revize A4)
  const outId = await page.evaluate(() => window.FM27.app.store.list('roleprofile').find((p) => p.phase === 'out').id);
  await until(async () => (await page.locator('#roleList .book').count()) === 2); // seznam se překreslí až po zápisu do úložiště
  check('25 seznam profilů rozlišuje fázi u profilů téhož jména', /\(s míčem\)/.test(await text(page, '#roleList')) && /\(bez míče\)/.test(await text(page, '#roleList')), await text(page, '#roleList'));
  await page.click(`#roleList [data-role="${outId}"] [data-act="edit"]`);
  await page.waitForSelector('#rpKey');
  check('25 formulář profilu nabízí fázi a u profilu bez míče je předvybraná', (await page.inputValue('#rpPhase')) === 'out');
  await page.fill('#rpKey', 'Hlavičky, Poziční hra, Předvídavost');
  await page.click('#rpSave');
  await until(async () => (await page.evaluate((id) => (window.FM27.app.store.get('roleprofile', id) || { key: [] }).key.length, outId)) === 3);
  const after = await page.evaluate(() => window.FM27.app.store.list('roleprofile').map((p) => ({ id: p.id, phase: p.phase, key: p.key })));
  check('25 úprava profilu role bez míče zůstala u profilu bez míče; profil s míčem se nezměnil', after.length === 2 && after.find((p) => p.phase === 'out').key.length === 3 && after.find((p) => p.phase === 'in').key.length === 2 && after.find((p) => p.phase === 'in').key.join() === 'Hlavičky,Obranné zákroky', after);

  const ovf = await h.overflow(page);
  check('25 na obrazovkách s českým čtením nic nepřetéká do šířky', ovf.sw <= ovf.cw + 1, ovf);
  await c.context.close();
};
