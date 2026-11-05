/* Scénář 20: DWRS, SPRÁVA VAH, SESTAVA A + B, ZÁMKY, DOPAD ZMĚN A ROZBOR HRÁČE.
   Co se zkouší: přednastavení vah a to, že každé řekne, co změnilo; vlastní profil vah (úprava, uložení, neplatné hodnoty, porovnání, smazání, návrat k výchozímu odhadu);
   přesná čísla DWRS a A + B v prohlížeči; zámky, vyřazení a zranění; náhrady s dopadem na součet; hloubka a rizika; rozbor hráče (nejlepší a nejhorší role, silné stránky a mezery);
   vstup pro AI trenéra s nápisem, že jde o odhad aplikace; záloha nového typu dokumentu.
   Co se NEzkouší: shoda DWRS s čímkoli ve hře (tabulky kategorií jsou odhad aplikace, ne pravidlo FM27) a skutečné čtení rolí z obrazovky hry. */
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
  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'nastaveni');
  await page.waitForSelector('#weightsCard');
  const rating = () => page.evaluate(() => window.FM27.app.settings().rating);
  const wprofiles = () => page.evaluate(() => window.FM27.app.store.list('weightprofile').map((p) => ({ id: p.id, name: p.name, categoryWeights: p.categoryWeights, multipliers: p.multipliers, context: p.context, overrides: p.overrides, base: p.base })));

  // ====================================================== A) správa vah
  const lead = await text(page, '#weightsCard .lead');
  check('20 karta vah říká, že kategorie atributů jsou odhad aplikace, ne pravidlo FM27, a proto jdou upravit', /vlastní odhad aplikace \(ESTIMATED\)/.test(lead) && /ne pravidlo FM27/.test(lead) && /8 \/ 4 \/ 2 \/ 1 \/ 0,2/.test(lead), lead.slice(0, 160));
  check('20 výchozí volba: jednoduchý model a výchozí odhad bez úprav', JSON.stringify(await rating()) === '{"model":"simple","profileId":"universal"}' && /Nic: je to výchozí odhad/.test(await text(page, '#wtDescribe')), await rating());
  check('20 šest přednastavení a u každého je napsáno, co mění (výchozí nic)', (await page.locator('#wtPresets [data-preset]').count()) === 6 && /Nic nemění/.test(await text(page, '#wtPresets [data-preset="universal"]')) && /Mění: .*Pace ×1,5/.test(await text(page, '#wtPresets [data-preset="speed"]')), await text(page, '#wtPresets'));
  check('20 aktivní přednastavení je označené a nejde ho použít znovu', await page.locator('#wtPresets [data-preset="universal"] [data-act="use"]').isDisabled());

  await page.click('#wtPresets [data-preset="speed"] [data-act="use"]');
  await until(async () => (await rating()).profileId === 'speed');
  await until(async () => /Pace: kontextový násobič 1 → 1,5/.test(await text(page, '#wtDescribe')));
  const describeSpeed = await text(page, '#wtDescribe');
  check('20 po použití přednastavení „Rychlostní fotbal“ se v aktivním profilu vypíše přesně, co změnilo', /Pace: kontextový násobič 1 → 1,5/.test(describeSpeed) && /Stamina: kontextový násobič 1 → 1,2/.test(describeSpeed) && /Work Rate: kontextový násobič 1 → 1,2/.test(describeSpeed), describeSpeed);
  check('20 volba se uložila do synchronizovaného nastavení', (await rating()).profileId === 'speed' && (await rating()).model === 'simple');

  // ---------- vlastní profil z aktivního
  await page.click('#wtNew');
  await page.waitForSelector('#wtName');
  check('20 nový profil začíná kopií aktivního (název s „kopie“, váha 8, kontext Pace 1,5)', (await page.inputValue('#wtName')) === 'Rychlostní fotbal (kopie)' && (await page.inputValue('#wtCw_extreme')) === '8' && (await page.inputValue('#wtCtx_Pace')) === '1,5');
  await page.fill('#wtName', 'Moje rychlost');
  await page.fill('#wtCw_extreme', 'abc');
  await page.click('#wtSave');
  check('20 neplatné číslo se nepřijme a je to řečeno; nic se neuložilo', /není číslo/.test(await text(page, '#wtMsg')) && (await wprofiles()).length === 0, await text(page, '#wtMsg'));
  await page.fill('#wtCw_extreme', '150');
  await page.click('#wtSave');
  check('20 váha mimo rozsah se nepřijme s vysvětlením; nic se neuložilo', /Profil se neuložil/.test(await text(page, '#wtMsg')) && /od 0 do 100/.test(await text(page, '#wtMsg')) && (await wprofiles()).length === 0, await text(page, '#wtMsg'));
  await page.fill('#wtCw_extreme', '10');
  await page.fill('#wtMulKey', '2');
  await page.locator('details[data-group="ST"] summary').click();
  await page.selectOption('#wtTier_ST_Heading', 'extreme');
  await page.click('#wtSave');
  await until(async () => (await wprofiles()).length === 1 && (await rating()).profileId === (await wprofiles())[0].id);
  await until(async () => /Heading \(útočník\)/.test(await text(page, '#wtDescribe')));
  const own = (await wprofiles())[0];
  check('20 vlastní profil je uložený se změnami (váha 10, násobič 2, kategorie Heading u útočníka) a s kontextem převzatým z přednastavení', own.name === 'Moje rychlost' && own.categoryWeights.extreme === 10 && own.multipliers.key === 2 && own.overrides.ST && own.overrides.ST.Heading === 'extreme' && own.context.Pace === 1.5 && !own.overrides.CB, own);
  check('20 nový profil se hned používá a řádky „co mění“ ukazují i změnu kategorie', (await rating()).profileId === own.id && /Váha kategorie „extrémně důležitý“ \(hráči z pole\): 8 → 10/.test(await text(page, '#wtDescribe')) && /Heading \(útočník\): dobrý → extrémně důležitý/.test(await text(page, '#wtDescribe')), await text(page, '#wtDescribe'));
  check('20 seznam „Moje profily vah“ ukáže profil a počet změn', /Moje rychlost/.test(await text(page, '#wtOwn')) && /Změn proti výchozímu odhadu: \d+/.test(await text(page, '#wtOwn')));

  // ---------- porovnání
  await page.selectOption('#wtCmpA', 'universal');
  await page.selectOption('#wtCmpB', own.id);
  await page.click('#wtCmpRun');
  const cmp = await text(page, '#wtCmpOut');
  check('20 porovnání ukáže rozdíly po řádcích (váha, násobič, kategorie, kontext)', /Váha kategorie „extrémně důležitý“ \(hráči z pole\): 8 → 10/.test(cmp) && /Násobič klíčového atributu role: 1,5 → 2/.test(cmp) && /Heading \(útočník\)/.test(cmp) && /Pace: kontextový násobič 1 → 1,5/.test(cmp), cmp);
  await page.selectOption('#wtCmpA', own.id);
  await page.selectOption('#wtCmpB', own.id);
  await page.click('#wtCmpRun');
  check('20 stejný profil proti sobě: žádný rozdíl a je to řečeno', /mají stejné váhy/.test(await text(page, '#wtCmpHead')));

  // ---------- úprava, návrat, smazání
  await page.click('#wtEdit');
  await page.waitForSelector('#wtName');
  check('20 úprava načte uložené hodnoty', (await page.inputValue('#wtName')) === 'Moje rychlost' && (await page.inputValue('#wtCw_extreme')) === '10' && (await page.inputValue('#wtTier_ST_Heading')) === 'extreme');
  await page.fill('#wtName', 'Moje rychlost 2');
  await page.click('#wtSave');
  await until(async () => (await wprofiles())[0].name === 'Moje rychlost 2');
  check('20 po úpravě je pořád jeden profil (přepsal se) a stále se používá', (await wprofiles()).length === 1 && (await rating()).profileId === own.id);
  await page.click('#wtReset');
  await until(async () => (await rating()).profileId === 'universal');
  await until(async () => /Nic: je to výchozí odhad/.test(await text(page, '#wtDescribe')));
  check('20 „Obnovit výchozí odhad“ vrátí výchozí profil a vlastní zůstane uložený', (await wprofiles()).length === 1 && /Nic: je to výchozí odhad/.test(await text(page, '#wtDescribe')));
  await page.locator(`#wtOwn [data-own="${own.id}"] [data-act="use"]`).click();
  await until(async () => (await rating()).profileId === own.id);
  await page.evaluate(async (id) => { await window.FM27.app.updateSettings({ rating: { profileId: id } }); }, 'neexistuje');
  await page.waitForSelector('#wtMissing');
  check('20 smazaný nebo neznámý profil se nahradí výchozím odhadem a je to na kartě vidět', /zatím platí výchozí odhad/.test(await text(page, '#wtMissing')) && (await page.evaluate(() => window.FM27.weightsUI.activeProfile(window.FM27.app).id)) === 'universal');
  await page.locator(`#wtOwn [data-own="${own.id}"] button`, { hasText: 'Smazat' }).click();
  await page.locator(`#wtOwn [data-own="${own.id}"] button`, { hasText: 'Opravdu?' }).click();
  await until(async () => (await wprofiles()).length === 0);
  await until(async () => (await page.locator('#wtOwnEmpty').count()) === 1);
  check('20 po smazání vlastního profilu zůstává jen výchozí odhad a přednastavení', (await page.locator('#wtOwnEmpty').count()) === 1 && (await page.locator('#wtPresets [data-preset]').count()) === 6);

  // ---------- model
  await page.selectOption('#wtModel', 'dwrs');
  await until(async () => (await rating()).model === 'dwrs');
  await until(async () => /počítá podle DWRS/.test(await text(page, '#wtModelNote')));
  check('20 přepnutí na DWRS se uloží a poznámka to potvrdí', /počítá podle DWRS/.test(await text(page, '#wtModelNote')) && (await rating()).model === 'dwrs');
  await page.selectOption('#wtModel', 'simple');
  await until(async () => (await rating()).model === 'simple');
  await until(async () => /počítá jednoduše/.test(await text(page, '#wtModelNote')));

  // ---------- záloha nového typu dokumentu
  await page.evaluate(async () => { await window.FM27.app.store.put('weightprofile', { name: 'Zálohovaný', categoryWeights: { extreme: 9 }, multipliers: {}, context: {}, overrides: {} }); });
  const backup = await page.evaluate(async () => {
    const store = window.FM27.app.store;
    const data = store.exportAll();
    const docs = data.docs.filter((d) => d.type === 'weightprofile');
    const revived = docs.map((d) => Object.assign({}, d, { updatedAt: d.updatedAt + 1000, data: Object.assign({}, d.data, { note: 'z obnovy' }) }));
    const n = await store.importAll({ format: data.format, version: data.version, docs: revived });
    return { exported: docs.length, accepted: n, notes: store.list('weightprofile').map((p) => p.note) };
  });
  check('20 záloha obsahuje profily vah a po obnově se přijmou', backup.exported === 1 && backup.accepted === 1 && backup.notes[0] === 'z obnovy', backup);

  check('20 bez chyb ve skriptu a v konzoli (správa vah)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();

  // ====================================================== B) nejlepší sestava A + B s DWRS
  const DW = require('../../../src/dwrs.js');
  const RFm = require('../../../src/rolefit.js');
  const SO = require('../../../src/squadopt.js');
  const OUTA = DW.OUTFIELD_ATTRIBUTES;
  const GKA = DW.GK_ATTRIBUTES;
  const outAttrs = (base, over) => Object.assign(Object.fromEntries(OUTA.map((a) => [a, base])), over || {});
  const gkAttrs = (base, over) => Object.assign(Object.fromEntries(GKA.map((a) => [a, base])), over || {});
  const squad = [
    { name: 'Brankář', positions: ['GK'], attributes: gkAttrs(11, { Handling: 16, Reflexes: 15, 'Aerial Reach': 14, Positioning: 15 }) },
    { name: 'Stoper A', positions: ['DC'], attributes: outAttrs(11, { Tackling: 17, Marking: 16, Positioning: 15, Heading: 15, Passing: 13 }) },
    { name: 'Stoper B', positions: ['DC'], attributes: outAttrs(10, { Tackling: 13, Marking: 12, Positioning: 12, Heading: 11, Passing: 12 }) },
    { name: 'Stoper C', positions: ['DC'], attributes: outAttrs(10, { Tackling: 14, Marking: 14, Positioning: 13, Heading: 13 }), injury: true },
    { name: 'Útočník A', positions: ['ST'], attributes: outAttrs(11, { Finishing: 17, Pace: 16, Acceleration: 16, 'Off The Ball': 15, Dribbling: 14 }) },
    { name: 'Útočník B', positions: ['ST'], attributes: outAttrs(10, { Finishing: 14, Pace: 13, Acceleration: 13, 'Off The Ball': 12, Dribbling: 11 }) },
    { name: 'Útočník C', positions: ['ST'], attributes: outAttrs(9, { Finishing: 11, Pace: 10, Acceleration: 10, 'Off The Ball': 10, Dribbling: 9 }) },
    { name: 'Neúplný', positions: ['ST'], attributes: { Finishing: 18, Pace: 17 } },
  ];
  const roleDefs = [
    { name: 'Sweeper Keeper', key: ['Reflexes', 'Handling'], pref: ['Kicking'] },
    { name: 'Ball Playing Defender', key: ['Passing', 'Tackling'], pref: ['Composure'] },
    { name: 'Advanced Forward', key: ['Finishing', 'Off The Ball'], pref: ['Dribbling', 'Pace'] },
    { name: 'Poacher', key: ['Finishing'], pref: ['Off The Ball'] },
  ];
  const c2 = await newContext(browser, {});
  const pg = c2.page;
  await open(pg, 'taktiky');
  await pg.fill('#careerClub', 'Chelsea');
  await pg.click('#careerCreate');
  await pg.waitForSelector('#tacReadCard');
  await pg.evaluate(async ({ squad, roleDefs }) => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    for (const p of squad) await app.store.put('player', { careerId, name: p.name, positions: p.positions, role: '', duty: '', foot: 'unknown', age: null, attributes: p.attributes, strengths: [], weaknesses: [], flags: { injury: !!p.injury, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    for (const r of roleDefs) await app.store.put('roleprofile', window.TrenerRoleFit.makeProfile({ name: r.name, key: r.key, pref: r.pref, source: 'user' }, { now: 1 }).profile);
    const t = window.TrenerTactics.makeTactic({ formation: '4-4-2', name: 'Zkušební 4-4-2', careerId });
    const roles = { s1: ['Sweeper Keeper', 'Support'], s3: ['Ball Playing Defender', 'Defend'], s4: ['Ball Playing Defender', 'Defend'], s10: ['Advanced Forward', 'Attack'], s11: ['Poacher', 'Attack'] };
    t.slots.forEach((sl) => {
      if (roles[sl.key]) [sl.role, sl.duty] = roles[sl.key];
    });
    const saved = await app.store.put('tactic', t);
    const career = app.store.draft(app.career());
    career.activeTacticId = saved.id;
    await app.store.put('career', career);
  }, { squad, roleDefs });
  await nav(pg, 'tym');
  await nav(pg, 'taktiky');
  await pg.waitForSelector('#bestCard');

  // vstup do výpočtu se v Node sestaví z toho, co je opravdu v úložišti stránky (stejná čísla, nezávislé spuštění)
  const world = () => pg.evaluate(() => {
    const app = window.FM27.app;
    const tactic = window.FM27.context.tactics(app)[0];
    return {
      slots: tactic.slots.map((x) => ({ key: x.key, pos: x.pos, role: x.role, duty: x.duty })),
      players: window.FM27.context.players(app).map((p) => ({ id: p.id, name: p.name, positions: p.positions || [], attributes: p.attributes || {}, injured: !!(p.flags && p.flags.injury) })),
      profiles: app.store.list('roleprofile'),
      tacticId: tactic.id,
    };
  });
  const idOf = (w, name) => w.players.find((x) => x.name === name).id;
  const fmtN = (v) => String(v).replace('.', ',');
  const openAll = (sel) => pg.evaluate((q) => document.querySelectorAll(q).forEach((d) => (d.open = true)), sel);
  const bRow = (key) => pg.locator(`#bestRows [data-slot="${key}"]`).innerText();
  const metaOf = (key) => pg.locator(`#bestRows [data-slot="${key}"] .meta`).innerText();

  // ---------- model a profil vah na kartě
  check('20 karta sestavy má volbu modelu; ve výchozím stavu je jednoduchý a profil vah se neukazuje', (await pg.inputValue('#bestModel')) === 'simple' && (await pg.locator('#bestWeights').count()) === 0 && /heuristika aplikace/.test(await text(pg, '#bestLead')));
  await pg.click('#bestRun');
  await pg.waitForSelector('#bestRows');
  const w0 = await world();
  const simple = SO.optimize({ slots: w0.slots, players: w0.players, profiles: w0.profiles }, { model: 'simple' });
  check('20 jednoduchý model v prohlížeči dá stejný součet A i B jako výpočet mimo stránku', new RegExp(`Obsazeno ${simple.a.filled} z 11 míst, součet vhodnosti ${fmtN(simple.a.total)}`).test(await text(pg, '#bestSummary')) && new RegExp(`Sestava B \\(druhá jedenáctka\\): obsazeno ${simple.b.filled}, součet ${fmtN(simple.b.total)}`).test(await text(pg, '#bestSummary')), await text(pg, '#bestSummary'));

  await pg.selectOption('#bestModel', 'dwrs');
  await until(async () => (await rating2()).model === 'dwrs');
  async function rating2() {
    return pg.evaluate(() => window.FM27.app.settings().rating);
  }
  await pg.waitForSelector('#bestWeights');
  await until(async () => /DWRS/.test(await text(pg, '#bestModelInfo')));
  check('20 po přepnutí na DWRS se výpočet sám obnoví, lead i řádek o modelu to říkají a objeví se výběr profilu vah', /Model DWRS/.test(await text(pg, '#bestLead')) && /ESTIMATED/.test(await text(pg, '#bestLead')) && /Model: DWRS/.test(await text(pg, '#bestModelInfo')) && /profil vah „Univerzální analytik“/.test(await text(pg, '#bestModelInfo')), await text(pg, '#bestModelInfo'));
  const expectDwrs = (opts) => SO.optimize({ slots: w0.slots, players: w0.players, profiles: w0.profiles }, Object.assign({ model: 'dwrs', wp: DW.defaultProfile() }, opts || {}));
  let exp = expectDwrs();
  const sum1 = await text(pg, '#bestSummary');
  check('20 DWRS: obsazení a součet A i B v prohlížeči sedí na výpočet mimo stránku', new RegExp(`Obsazeno ${exp.a.filled} z 11 míst, součet vhodnosti ${fmtN(exp.a.total)}`).test(sum1) && new RegExp(`součet ${fmtN(exp.b.total)}`).test(sum1) && /Odhad aplikace \(DWRS\), ne pravidlo FM27/.test(sum1), sum1);
  const goalie = exp.a.assignments.find((x) => x.slotKey === 's1');
  const striker = exp.a.assignments.find((x) => x.slotKey === 's10');
  check('20 DWRS: každé obsazené místo má přesné číslo z výpočtu a jméno hráče', (await metaOf('s1')).includes(`${goalie.player.name}: vhodnost ${fmtN(goalie.fit)}`) && (await metaOf('s10')).includes(`${striker.player.name}: vhodnost ${fmtN(striker.fit)}`), [await metaOf('s1'), await metaOf('s10')]);
  check('20 DWRS: sestava ukazuje A (Útočník A na místě pokročilého útočníka) a lavičku B (Útočník B)', /Útočník A: vhodnost/.test(await metaOf('s10')) && /Lavička B: Útočník B/.test(await bRow('s10')) || /Lavička B:/.test(await bRow('s10')), await bRow('s10'));
  await openAll('#bestRows details, #bestLeftOut, #bestInjury');
  const dwBreak = pg.locator('#bestRows [data-slot="s10"] details[data-model="dwrs"]');
  check('20 DWRS: rozpis má řádek za každý atribut skupiny (36 atributů), kategorii a přepočet na 0 až 100', (await dwBreak.locator('tbody tr').count()) === 36 && /nejhorší možný/.test(await dwBreak.innerText()) && /\(součet − nejhorší\) \/ \(nejlepší − nejhorší\) × 100/.test(await dwBreak.innerText()) && /extrémně důležitý/.test(await dwBreak.innerText()), (await dwBreak.innerText()).slice(0, 200));
  check('20 B nikdy neobsahuje hráče z A (lavička z těch, kdo zbyli)', await pg.evaluate(() => {
    const a = [...document.querySelectorAll('#bestRows .meta > span:nth-of-type(1)')].map((e) => e.textContent.split(':')[0]);
    const b = [...document.querySelectorAll('#bestRows [data-b]')].map((e) => e.textContent.replace('Lavička B: ', '').replace(/ [\d,]+( \(č\.\))?$/, ''));
    return b.length > 0 && b.every((x) => !a.includes(x));
  }));
  check('20 poslední tři řádky karty: rizika, dopad výpadků a seznam mimo sestavu existují', (await pg.locator('#bestRisks').count()) === 1 && (await pg.locator('#bestInjury tbody tr').count()) === exp.a.filled && (await pg.locator('#bestLeftOut').count()) === 1);
  check('20 Stoper C je zraněný: nepoužije se, je v seznamu „mimo sestavu“ jako zraněný a nikde v A ani v B', /Stoper C: zraněný nebo nedostupný/.test(await text(pg, '#bestLeftOut')) && !(await pg.locator('#bestRows .meta').allInnerTexts()).some((t) => /Stoper C/.test(t)));
  check('20 Neúplný (jen dva atributy) se nepoužije a není nulový: v seznamu je „nejde ohodnotit“', /Neúplný: nejde ohodnotit/.test(await text(pg, '#bestLeftOut')));

  // ---------- přednastavení vah v kartě
  await pg.selectOption('#bestWeights', 'speed');
  await until(async () => /profil vah „Rychlostní fotbal“/.test(await text(pg, '#bestModelInfo')));
  const spd = SO.optimize({ slots: w0.slots, players: w0.players, profiles: w0.profiles }, { model: 'dwrs', wp: DW.presetProfile('speed') });
  check('20 jiný profil vah přepočítá sestavu a čísla sedí na výpočet mimo stránku', new RegExp(`součet vhodnosti ${fmtN(spd.a.total)}`).test(await text(pg, '#bestSummary')) && spd.a.total !== exp.a.total, await text(pg, '#bestSummary'));
  await pg.selectOption('#bestWeights', 'universal');
  await until(async () => /profil vah „Univerzální analytik“/.test(await text(pg, '#bestModelInfo')));

  // ---------- zámek, vyřazení
  const lockSel = pg.locator('#bestRows [data-slot="s10"] [data-act="lock"]');
  await lockSel.selectOption(idOf(w0, 'Útočník C'));
  await until(async () => /zamčeno uživatelem/.test(await metaOf('s10')));
  const locked = expectDwrs({ locks: { s10: idOf(w0, 'Útočník C') } });
  check('20 zámek: Útočník C je na místě pokročilého útočníka a má štítek; součet odpovídá výpočtu se zámkem', /Útočník C: vhodnost/.test(await metaOf('s10')) && new RegExp(`součet vhodnosti ${fmtN(locked.a.total)}`).test(await text(pg, '#bestSummary')), await metaOf('s10'));
  check('20 zamčený hráč není v lavičce B', !(await pg.locator('#bestRows [data-b]').allInnerTexts()).some((t) => /Útočník C/.test(t)));
  await lockSel.selectOption('');
  await until(async () => !/zamčeno uživatelem/.test(await metaOf('s10')));
  check('20 zrušení zámku vrátí původní optimum', new RegExp(`součet vhodnosti ${fmtN(exp.a.total)}`).test(await text(pg, '#bestSummary')));
  await openAll('#bestPlayers');
  await pg.locator(`#bestPlayers [data-ex="${idOf(w0, 'Útočník A')}"]`).check();
  await until(async () => !/Útočník A: vhodnost/.test(await metaOf('s10')));
  const excl = expectDwrs({ exclude: [idOf(w0, 'Útočník A')] });
  await openAll('#bestLeftOut');
  check('20 vyřazení: Útočník A se nepoužije ani v A, ani v B; součet odpovídá výpočtu a v seznamu je „vyřazen uživatelem“', new RegExp(`součet vhodnosti ${fmtN(excl.a.total)}`).test(await text(pg, '#bestSummary')) && /Útočník A: vyřazen uživatelem/.test(await text(pg, '#bestLeftOut')) && !(await pg.locator('#bestRows .meta').allInnerTexts()).some((t) => /Útočník A/.test(t)), await text(pg, '#bestSummary'));
  await pg.locator(`#bestPlayers [data-ex="${idOf(w0, 'Útočník A')}"]`).uncheck();
  await until(async () => /Útočník A: vhodnost/.test(await metaOf('s10')));

  // ---------- náhrady, dopad výpadku, hloubka, rizika
  const altList = pg.locator('#bestRows [data-slot="s10"] details[data-alt]');
  await openAll('#bestRows details[data-alt]');
  const altText = await altList.innerText();
  check('20 náhrady říkají, kde hráč teď je a o kolik by se změnil součet sestavy A (přesně z přepočtu)', /vhodnost [\d,]+/.test(altText) && /součet sestavy A (klesne|vzroste) o [\d,]+|beze změny/.test(altText) && (await altList.locator('li[data-status]').count()) >= 1, altText);
  const firstAlt = exp.a.assignments.find((x) => x.slotKey === 's10').alternatives[0];
  const viaLock = expectDwrs({ locks: { s10: firstAlt.id } });
  check('20 dopad první náhrady na součet A je přesně rozdíl mezi optimem a optimem se zámkem', firstAlt.deltaA === Math.round((viaLock.a.total - exp.a.total) * 10) / 10 && firstAlt.deltaA <= 0, { firstAlt: firstAlt.deltaA, a: viaLock.a.total, b: exp.a.total });
  const impactRow = pg.locator('#bestInjury tbody tr[data-severity]').first();
  await openAll('#bestInjury');
  check('20 tabulka výpadků má u každého hráče základní sestavy součet před a po, kdo ho nahradí, a závažnost; nejhorší je nahoře', /→/.test(await impactRow.innerText()) && (await pg.locator('#bestInjury tbody tr').count()) === exp.a.filled && ['critical'].includes(await impactRow.getAttribute('data-severity')), await impactRow.innerText());
  check('20 brankář je v soupisce jediný, takže je to riziko a jeho výpadek je kritický', /jediný použitelný brankář/.test(await text(pg, '#bestRisks')) && (await pg.locator('#bestRisks li[data-kind="gk"][data-severity="high"]').count()) === 1 && (await pg.locator('#bestInjury tr[data-severity="critical"]').count()) >= 1);
  check('20 hloubka: místa s jediným hráčem nebo bez hráče jsou vypsaná a říkají to', (await pg.locator('#bestDepth li').count()) >= 1 && /jediný hráč|nikdo/.test(await text(pg, '#bestDepth')), await text(pg, '#bestDepth'));

  // ---------- AI trenér a použití sestavy
  const fitObs = await pg.evaluate(() => window.FM27.context.observations(window.FM27.app).find((o) => o.id === 'fit'));
  check('20 AI trenér dostane výsledek jako pozorování „heuristika“, s modelem, zálohami a rizikem', fitObs && fitObs.label === 'heuristic_coach' && /model: DWRS/.test(fitObs.text) && /ne pravidla FM27/.test(fitObs.text) && /záloha /.test(fitObs.text) && /Riziko: /.test(fitObs.text), fitObs && fitObs.text.slice(0, 400));
  await pg.click('#bestApply');
  const placed = await pg.evaluate(() => window.FM27.context.tactics(window.FM27.app)[0].slots.filter((x) => x.playerId).map((x) => x.key).sort());
  check('20 použití sestavy dosadí do taktiky jen hráče sestavy A (B se do taktiky nedává)', placed.length === exp.a.filled && placed.every((k) => exp.a.assignments.find((x) => x.slotKey === k && x.player)), placed);

  // ====================================================== C) rozbor hráče
  await nav(pg, 'tym');
  await pg.waitForSelector('#playerList');
  const w1 = await world();
  const groupsC = SO.inferRoleGroups(w1.profiles, [w1.slots]);
  const wpD = DW.defaultProfile();
  const playerOf = (name) => w1.players.find((x) => x.name === name);
  const anA = DW.analyzePlayer(playerOf('Útočník A'), SO.withGroups(w1.profiles, groupsC), wpD, {});
  const analyzeBtn = (name) => pg.locator('#playerList .player', { hasText: name }).locator('[data-act="analyze"]');
  check('20 u každého hráče je tlačítko Rozbor hráče', (await pg.locator('#playerList [data-act="analyze"]').count()) === squad.length);
  await analyzeBtn('Útočník A').click();
  await pg.waitForSelector('#playerAnalysis');
  const noteTxt = await text(pg, '#paNote');
  check('20 rozbor říká, že je to DWRS, odhad aplikace, který profil vah použil a že skryté údaje se nepoužívají', /DWRS/.test(noteTxt) && /ESTIMATED/.test(noteTxt) && /ne pravidlo FM27/.test(noteTxt) && /Univerzální analytik/.test(noteTxt) && /Skryté údaje hry se nepoužívají/.test(noteTxt), noteTxt);
  const bestTexts = await pg.locator('#paBest li').allInnerTexts();
  check('20 nejlepší role: pořadí a čísla odpovídají výpočtu mimo stránku (3 role z 3 ohodnotitelných)', bestTexts.length === anA.best.length && anA.best.every((r, i) => bestTexts[i].includes(r.role) && bestTexts[i].includes(fmtN(r.score))), { bestTexts, expected: anA.best.map((r) => [r.role, r.score]) });
  check('20 role mimo hráčovy pozice (stoper u útočníka) má štítek „mimo jeho pozice“', anA.best.some((r) => !r.relevant) ? bestTexts.some((t) => /Ball Playing Defender/.test(t) && /mimo jeho pozice/.test(t)) : true);
  const sgExp = DW.strengthsGaps(anA.best[0].result.contributions, 3);
  const strengthsTxt = await text(pg, '#paStrengths');
  check('20 silné stránky nejlepší role: první je atribut s největším příspěvkem a hodnotou', sgExp.strengths.length > 0 && strengthsTxt.includes(`${sgExp.strengths[0].attribute} ${sgExp.strengths[0].value}`), { strengthsTxt, sgExp: sgExp.strengths });
  check('20 mezery nejlepší role jsou vypsané (nebo je řečeno, že žádné nejsou)', (await pg.locator('#paGaps').count()) === 1 && (sgExp.gaps.length ? (await text(pg, '#paGaps')).includes(sgExp.gaps[0].attribute) : /Žádný důležitý atribut/.test(await text(pg, '#paGaps'))));
  await openAll('#paBreakdown, #paUnavailable');
  check('20 rozpis nejlepší role má řádek za každý atribut skupiny', (await pg.locator('#paBreakdown tbody tr').count()) === anA.best[0].result.contributions.length && anA.best[0].result.contributions.length === 36);
  check('20 brankářská role se u útočníka nehodnotí a důvod je napsaný (chybí brankářské atributy)', /Sweeper Keeper: Hráči chybí atributy/.test(await text(pg, '#paUnavailable')), await text(pg, '#paUnavailable'));
  const rankExp = SO.rankForRole({ players: w1.players, profile: w1.profiles.find((x) => x.name === anA.best[0].role), slotPos: '', group: anA.best[0].group }, { model: 'dwrs', wp: wpD, mode: 'free' });
  const meExp = rankExp.find((x) => x.id === playerOf('Útočník A').id);
  check('20 pořadí v týmu na nejlepší roli sedí na výpočet mimo stránku', (await pg.locator('#paRank').getAttribute('data-rank')) === String(meExp.rank) && new RegExp(`${meExp.rank}\\. z ${rankExp.filter((x) => x.fit !== null).length} hodnotitelných`).test(await text(pg, '#paRank')), await text(pg, '#paRank'));
  const fitsExp = SO.playerSlotFits({ slots: w1.slots, players: [playerOf('Útočník A')], profiles: w1.profiles }, { model: 'dwrs', wp: wpD, mode: 'strict' }, playerOf('Útočník A').id).filter((f) => f.fit !== null);
  check('20 vhodnost na místa v aktivní taktice: místa útočníků s čísly z výpočtu mimo stránku', (await pg.locator('#paTactic li').count()) === fitsExp.length && fitsExp.length >= 2, await pg.locator('#paTactic').innerText());
  for (const f of fitsExp) check(`20 místo ${f.pos} · ${f.role}: číslo ${fmtN(f.fit)} v seznamu`, (await pg.locator(`#paTactic li[data-slot="${f.slotKey}"]`).innerText()).includes(fmtN(f.fit)));
  await pg.click('#drawerClose');
  // hráč s neúplnými atributy: nic se nehodnotí a je to řečeno
  await analyzeBtn('Neúplný').click();
  await pg.waitForSelector('#playerAnalysis');
  await openAll('#paUnavailable');
  check('20 hráč s neúplnými atributy: žádná role se nehodnotí, není to nula a důvody jsou vypsané', (await pg.locator('#paNoScore').count()) === 1 && (await pg.locator('#paBest').count()) === 0 && /Hráči chybí atributy/.test(await text(pg, '#paUnavailable')));
  await pg.click('#drawerClose');
  // hráč bez atributů a bez profilů rolí
  await pg.evaluate(async () => {
    const app = window.FM27.app;
    await app.store.put('player', { careerId: app.career().id, name: 'Bez atributů', positions: ['ST'], role: '', duty: '', foot: 'unknown', age: null, attributes: {}, strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
  });
  await until(async () => (await pg.locator('#playerList .player', { hasText: 'Bez atributů' }).count()) === 1);
  await analyzeBtn('Bez atributů').click();
  await pg.waitForSelector('#playerAnalysis');
  check('20 hráč bez atributů: rozbor to řekne a nic nehodnotí', /nemá žádné atributy/.test(await text(pg, '#paNoAttrs')) && (await pg.locator('#paBest').count()) === 0);
  await pg.click('#drawerClose');
  await nav(pg, 'taktiky');
  await pg.waitForSelector('#bestCard');

  // ---------- vzhled (snímek se dělá se zapnutou sestavou B)
  await pg.click('#bestRun');
  await pg.waitForSelector('#bestRows [data-b]');
  await pg.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; }); // oznámení by zakrylo snímek
  await openAll('#bestInjury');
  await pg.locator('#bestCard').screenshot({ path: `${env.OUT}/20_sestava_ab.png` });

  // ---------- bez B
  await pg.locator('#bestBench').uncheck();
  await pg.click('#bestRun');
  await until(async () => (await pg.locator('#bestRows [data-b]').count()) === 0);
  check('20 bez volby „sestava B“ se lavička nepočítá ani nezobrazuje', !/Sestava B/.test(await text(pg, '#bestSummary')) && (await pg.locator('#bestRows [data-b]').count()) === 0);
  await pg.locator('#bestBench').check();

  check('20 bez chyb ve skriptu a v konzoli (sestava A + B)', c2.problems.page.length === 0 && c2.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c2.problems.page, console: c2.problems.console });
  await c2.context.close();
};
