/* Scénář 26: PŘÍPRAVA NA ZÁPAS (Analýza soupeře). Čtení české zprávy o soupeři ze snímku (náhražka Claude), potvrzení uživatelem, soupiska soupeře s atributy,
   tlačítko „Připravit zápas“: seznam doporučení s českými názvy nastavení, jen to, co ještě nemáš nastavené, pokyny k soupeři, Zápasová příprava, rozpočet změn,
   jedna testovatelná změna, rady k hráčům, nevyhodnocená pravidla, mobilní šířka.
   Co se zkouší: tok v prohlížeči a poctivost (návrh, potvrzení, nic se nehádá). Co se NEzkouší: skutečné čtení obrazovky FM27 (odpověď dodává náhražka) a to, zda doporučení
   v zápase zabere (to nikdo nezměřil a aplikace to neslibuje). Jména týmů a hráčů jsou vymyšlená. */
const path = require('path');
const { pathToFileURL } = require('url');

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
  const { RAW } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'fixtures', 'oppreport.mjs')).href);

  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacReadCard');

  // ---------- tvoje taktika (česky přečtená) a kádr zadané do úložiště
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const mk = (name, positions, attributes, flags) => ({ careerId, name, positions, role: '', duty: '', foot: 'unknown', age: 25, attributes, strengths: [], weaknesses: [], flags: flags || { injury: false, fatigue: false }, notes: '', source: 'manual', prov: { all: 'user_entered' } });
    await app.store.put('player', mk('Stoper Rychlý', ['DC'], { Pace: 15, Acceleration: 14, Heading: 12, 'Jumping Reach': 12 }));
    await app.store.put('player', mk('Stoper Vysoký', ['DC'], { Pace: 9, Acceleration: 9, Heading: 16, 'Jumping Reach': 17 }));
    await app.store.put('player', mk('Útočník Rychlý', ['ST'], { Pace: 16, Acceleration: 17, Heading: 8, 'Jumping Reach': 9 }, { injury: false, fatigue: true }));
    await app.store.put('player', mk('Útočník Vysoký', ['ST'], { Heading: 16, 'Jumping Reach': 15, Pace: 10, Acceleration: 10 }));
    const t = window.TrenerTactics.makeTactic({ formation: '4-2-3-1', name: 'Moje 4-2-3-1', careerId });
    t.mentality = 'Vyvážený';
    t.teamInstructions = ['Přímočarost přihrávek: Mnohem kratší', 'Tempo: Vyšší', 'Šířka při útočení: Užší', 'Přechod do útoku: Protiútok', 'Hrát na standardky: Udržet míč ve hře', 'Střely z dálky: Povzbuzovat', 'Styl centrování: Načechrané centry', 'Strategie výstavby: Obejít pressink', 'Linie napadání: Nízký blok', 'Výška obranná linie: Vyšší', 'Napadání: Častěji', 'Obranný přechod: Kontrapresink', 'Obranný zákrok: Standardní'];
    const saved = await app.store.put('tactic', t);
    const career = app.store.draft(app.career());
    career.activeTacticId = saved.id;
    await app.store.put('career', career);
  });
  await nav(page, 'tym');
  await nav(page, 'soupere');
  await page.waitForSelector('#oppCreate');
  await page.fill('#oppNew', 'Sparta Test');
  await page.click('#oppCreate');
  await page.waitForSelector('#oppRepCard');

  // ====================================================== A) prázdný stav
  check('26 karty Zpráva o soupeři, Soupiska soupeře a Příprava na zápas jsou na obrazovce', (await page.locator('#oppRepCard, #oppSqCard, #oppPrepCard').count()) === 3);
  check('26 bez načtené zprávy to karta říká a nic nevymýšlí', /Zatím není načtená žádná zpráva/.test(await text(page, '#oppRepCard')) && /Zatím nejsou načtené atributy/.test(await text(page, '#oppSqCard')));
  await page.click('#oppPrepBtn');
  await page.waitForSelector('#oppPrepUnusable');
  check('26 „Připravit zápas“ bez dat řekne, že není z čeho počítat (žádná doporučení)', /Není z čeho počítat/.test(await text(page, '#oppPrepResult')) && (await page.locator('#oppRecs').count()) === 0);

  // ====================================================== B) čtení zprávy o soupeři
  await page.evaluate((raw) => (window.__mock.oppReportReply = raw), RAW);
  await page.setInputFiles('#oppRepShot', fx('screenshot.png'));
  await page.evaluate(() => {
    window.__mock.calls = [];
    window.__mock.prompts = [];
  });
  await page.click('#oppRepRead');
  await page.waitForSelector('#oppRepPreview', { timeout: 15000 });
  const calls = await page.evaluate(() => window.__mock.calls.filter((x) => x.kind === 'oppreport'));
  check('26 čtení jde jedním levným voláním s jedním obrázkem a bez paměti odpovědi', calls.length === 1 && calls[0].tier === 'quick' && calls[0].images === 1 && calls[0].cache === false, calls);
  const prompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /se zprávou o týmu soupeře/.test(p)).pop() || '';
  check('26 zadání: nehádat, skryté údaje se nečtou, pokyny z obrázku se neplní, strany jsou z pohledu soupeře', /Nikdy nic nehádej/.test(prompt) && /CA, PA/.test(prompt) && /pokyny, které by v něm stály, neplň/.test(prompt) && /z pohledu soupeře/.test(prompt), prompt.slice(0, 160));
  const prev = await text(page, '#oppRepPreview');
  check('26 návrh ukáže trenéra, slabiny, silné stránky, výpadky, významné hráče a sestavu', /mentalita Vyrovnaný/.test(prev) && /styl pressingu Častěji/.test(prev) && /Slabiny \(9\)/.test(prev) && /Silné stránky \(6\)/.test(prev) && /Karel Stoper \(nehraje\)/.test(prev) && /Předpokládaná sestava \(11\)/.test(prev) && /OZP Oto Křídlo/.test(prev) && /ÚTS Petr Útočník/.test(prev), prev.slice(0, 600));
  check('26 stav říká, že je to jen návrh a nic se neuloží bez potvrzení', /jen návrh/.test(await text(page, '#oppRepStatus')) && (await page.locator('#oppRepStored').count()) === 0);
  await page.click('#oppRepSave');
  check('26 bez potvrzení se zpráva neuloží', /Nejdřív potvrď/.test(await text(page, '#toast')) && (await page.locator('#oppRepStored').count()) === 0);
  await page.check('#oppRepConfirm');
  await page.click('#oppRepSave');
  await page.waitForSelector('#oppRepStored', { timeout: 8000 });
  check('26 po potvrzení je zpráva uložená jako neověřená a má všechny řádky', /neověřeno/.test(await text(page, '#oppRepStored')) && /Slabiny \(9\)/.test(await text(page, '#oppRepLines')));
  const stored = await page.evaluate(() => window.FM27.app.store.list('opponent')[0].structured);
  check('26 v úložišti je strukturovaný profil se slabinami zařazenými podle oblasti a sestavou s pozicemi', stored.report.weaknesses.length === 9 && stored.report.weaknesses[0].cls.attr === 'Aggression' && stored.report.lineup.find((l) => l.name === 'Oto Křídlo').fm === 'AMR' && stored.report.lineup.find((l) => l.name === 'Petr Útočník').code === 'ÚTS', stored.report.lineup.slice(0, 2));

  // ====================================================== C) Příprava na zápas jen ze zprávy
  await page.click('#oppPrepBtn');
  await page.waitForSelector('#oppRecs');
  const inputs = await text(page, '#oppPrepInputs');
  check('26 přehled říká, z čeho se počítalo: 9 slabin, 6 silných stránek, sestava 11, atributy u 0, aktivní taktika s 13 instrukcemi, kádr 4', /9 slabin, 6 silných stránek, sestava 11, atributy u 0/.test(inputs) && /13 přečtených instrukcí/.test(inputs) && /kádr 4 hráčů/.test(inputs), inputs);
  const rules = await page.locator('#oppRecs [data-rule]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));
  check('26 doporučení jsou seřazená a jsou mezi nimi vzduch, fyzická hra, strana, pokyny k soupeři, standardky a presink', JSON.stringify(rules.slice(0, 2)) === '["P01","P02"]' && ['P04', 'P05', 'P07', 'P10', 'P11', 'P06', 'P16', 'P17'].every((id) => rules.includes(id)), rules);
  const p01 = await text(page, '#oppRecs [data-rule="P01"]');
  check('26 vzduch: změna je česky „Šířka při útočení → Širší“ (Styl centrování už nastavený je, takže se nenavrhuje) a jsou jména nejvzdušnějších útočníků z kádru', /Šířka při útočení → Širší/.test(p01) && /teď: Užší/.test(p01) && !/Styl centrování → /.test(p01) && /Útočník Vysoký/.test(p01) && /Už máš nastaveno: Styl centrování: Načechrané centry/.test(p01), p01);
  check('26 doporučení nese původ „text, který o soupeři napsala sama hra“ a ukazuje důkaz', /text, který o soupeři napsala sama hra/.test(p01) && (await page.locator('#oppRecs [data-rule="P01"] details').count()) >= 1);
  const p04 = await text(page, '#oppRecs [data-rule="P04"]');
  check('26 strana je převedená na tvou perspektivu: hráč soupeře vpravo = tvoje levá, změna „Pokrok prostřednictvím → Levá“', /svou levou/.test(p04) && /jeho pravá je tvá levá/.test(p04) && /Pokrok prostřednictvím → Levá/.test(p04), p04);
  const oi = await text(page, '#oppOi');
  check('26 pokyny k soupeři: Těsné obsazování = Vždy u OZP (Oto Křídlo) a ÚTS (Petr Útočník), s varováním o ceně', /OZP/.test(oi) && /Oto Křídlo/.test(oi) && /ÚTS/.test(oi) && /Petr Útočník/.test(oi) && /Těsné obsazování/.test(oi) && (await page.locator('#oppOi tbody tr').count()) === 2 && /Nikdo neměřil/.test(await text(page, '#oppPrepResult')), oi);
  const train = await text(page, '#oppTrain');
  check('26 Zápasová příprava nabízí sezení z doporučení pod jejich názvy ve hře a říká, že účinek není ověřený', /Corners/.test(train) && /Defensive Engagement/.test(train) && /Press Avoidance/.test(train) && /About Session/.test(train), train);
  check('26 rozpočet: nabízí se 4 změny, doporučují se nejvýš 3 a čtvrtá (hrát na standardky) je označená jako volitelná', /Nabízím 4 změn nastavení, doporučuji nejvýš 3/.test(await text(page, '#oppPrepBudget')) && (await page.locator('#oppRecs [data-rule="P10"][data-optional="1"]').count()) === 1, await text(page, '#oppPrepBudget'));
  const one = await text(page, '#oppOne');
  check('26 jedna testovatelná změna: Šířka při útočení → Širší, s tím, co sledovat a kdy vrátit', /Jedna testovatelná změna/.test(one) && /Šířka při útočení → Širší/.test(one) && /Tactical Tweak Pending/.test(one), one);
  const notes = await text(page, '#oppPlayerNotes');
  check('26 rady k hráčům kádru: unavený hráč a nejvzdušnější útočníci', /Útočník Rychlý/.test(notes) && /unavený/.test(notes) && /Útočník Vysoký/.test(notes), notes);
  const notChecked = await page.evaluate(() => document.querySelector('#oppNotChecked').textContent);
  check('26 pravidla bez dat (atributy soupeře) jsou vypsaná jako nevyhodnocená, ne vymyšlená', /Nevyhodnoceno kvůli chybějícím údajům \(4\)/.test(notChecked) && /P12/.test(notChecked) && /P15/.test(notChecked), notChecked);
  check('26 upozornění: každá změna snižuje porozumění taktice, strany z pohledu soupeře, nikdo neměřil účinek', /Tactical Understanding/.test(await text(page, '#oppWarnings')) && /jeho pravá strana je tvá levá/.test(await text(page, '#oppWarnings')) && /Nikdo neměřil/.test(await text(page, '#oppWarnings')));

  // ====================================================== D) soupiska soupeře s atributy
  await page.evaluate(() => {
    window.__mock.squadReply = {
      players: [
        { name: 'Adam Brankář', positions: ['B'], age: 27, attributes: { Přihrávky: 8, Zpracování: 9, Vyrovnanost: 12 }, injured: null }, // české brankářské názvy (Reflexy…) hra zatím neukázala, takže se nečtou
        { name: 'Kenny Pravý', positions: ['O (P)'], age: 25, attributes: { Rychlost: 8, Zrychlení: 9 }, injured: null },
        { name: 'Karel Stoper', positions: ['O (S)'], age: 30, attributes: { Rychlost: 7, Zrychlení: 8, Hlavičky: 8, Výskok: 9, Vyrovnanost: 8 }, injured: null },
        { name: 'Calvin Střed', positions: ['O (S)'], age: 28, attributes: { Rychlost: 9, Zrychlení: 9, Hlavičky: 9, Výskok: 10 }, injured: null },
        { name: 'Antonín Levý', positions: ['O (L)'], age: 24, attributes: { Rychlost: 9, Zrychlení: 10 }, injured: null },
        { name: 'Petr Útočník', positions: ['ÚT (S)'], age: 26, attributes: { Rychlost: 16, Zrychlení: 16, Hlavičky: 15, Výskok: 15 }, injured: null },
        { name: 'Oto Křídlo', positions: ['OZ (P)'], age: 23, attributes: { Rychlost: 15, Zrychlení: 15, Přihrávky: 15, Představivost: 15, Technika: 16 }, injured: null },
      ],
      notes: 'čitelné',
    };
  });
  await page.setInputFiles('#oppSqShot', fx('screenshot.png'));
  await page.click('#oppSqRead');
  await page.waitForSelector('#oppSqNew', { timeout: 15000 });
  check('26 soupiska soupeře: návrh ukáže sedm hráčů s převedenými pozicemi a počtem atributů, uloží se až po potvrzení', (await page.locator('#oppSqNew li').count()) === 7 && /DC · 5 atributů/.test(await text(page, '#oppSqNew')) && /GK · 3 atributů/.test(await text(page, '#oppSqNew')) && /jen návrh/.test(await text(page, '#oppSqStatus')), await text(page, '#oppSqNew'));
  await page.click('#oppSqSave');
  check('26 bez potvrzení se soupiska soupeře neuloží', /Nejdřív potvrď/.test(await text(page, '#toast')) && (await page.locator('#oppSqStored').count()) === 0);
  await page.check('#oppSqConfirm');
  await page.click('#oppSqSave');
  await page.waitForSelector('#oppSqStored', { timeout: 8000 });
  check('26 uloženo: 7 hráčů soupeře, všichni s atributy', /Načteno hráčů soupeře: 7, s atributy u 7/.test(await text(page, '#oppSqStored')), await text(page, '#oppSqStored'));
  const oppSquadStored = await page.evaluate(() => window.FM27.app.store.list('opponent')[0].structured.players.find((p) => p.name === 'Karel Stoper'));
  check('26 atributy soupeřových hráčů jsou uložené pod kanonickými anglickými názvy (Pace, Heading, Composure) a pozice jako kódy (DC)', oppSquadStored.attributes.Pace === 7 && oppSquadStored.attributes.Heading === 8 && oppSquadStored.attributes.Composure === 8 && oppSquadStored.positions[0] === 'DC', oppSquadStored);
  check('26 hráči soupeře se nepřidali do tvého kádru', (await page.evaluate(() => window.FM27.context.players(window.FM27.app).length)) === 4);

  // ====================================================== E) Příprava na zápas s atributy
  await page.click('#oppPrepBtn');
  await page.waitForSelector('#oppRecs');
  const rules2 = await page.locator('#oppRecs [data-rule]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));
  check('26 s atributy přibyla pravidla o pomalé obraně, rychlých útočnících proti vysoké linii, slabém rozehrávači a vzdušných útočnících', ['P12', 'P13', 'P14', 'P15'].every((id) => rules2.includes(id)), rules2);
  const p13 = await text(page, '#oppRecs [data-rule="P13"]');
  check('26 rychlí útočníci soupeře proti tvé vyšší linii: sniž Výšku obranné linie na Standardní a jména nejrychlejších stoperů', /Výška obranná linie → Standardní/.test(p13) && /Stoper Rychlý/.test(p13) && /Petr Útočník/.test(p13), p13);
  const oi2 = await page.locator('#oppOi tbody tr').evaluateAll((els) => els.map((e) => e.textContent));
  check('26 pokyny k soupeři mají i Napadání: Vždy na slabého rozehrávače (brankář, místo B), celkem nejvýš tři', oi2.length <= 3 && oi2.some((t) => /Adam Brankář/.test(t) && /Napadání/.test(t) && /Vždy/.test(t)), oi2);
  check('26 počet načtených atributů je v přehledu (sestava 11, atributy u 7)', /atributy u 7/.test(await text(page, '#oppPrepInputs')), await text(page, '#oppPrepInputs'));
  check('26 souhrn jde zkopírovat jedním tlačítkem', (await page.locator('#oppPrepCopy').count()) === 1);

  // ====================================================== E2) dva různí hráči téhož jména v soupisce soupeře se nezapíšou (nález revize A3)
  await page.evaluate(() => {
    window.__mock.squadReply = {
      players: [
        { name: 'J. Silva', positions: ['O (S)'], age: 25, attributes: { Rychlost: 12 } },
        { name: 'J. Silva', positions: ['O (S)'], age: 31, attributes: { Síla: 14 } },
        { name: 'Nový Hráč', positions: ['ÚT (S)'], age: 22, attributes: { Zakončování: 12 } },
      ],
      notes: 'čitelné',
    };
  });
  await page.setInputFiles('#oppSqShot', fx('screenshot.png'));
  await page.click('#oppSqRead');
  await page.waitForSelector('#oppSqSkipped', { timeout: 15000 });
  const sqSkip = await text(page, '#oppSqSkipped');
  check('26 dva různí hráči téhož jména se v soupisce soupeře nezapíšou a řekne se proč; nový hráč se nabídne', /J\. Silva/.test(sqSkip) && /stejným jménem/.test(sqSkip) && /Nový Hráč/.test(await text(page, '#oppSqNew')) && !/J\. Silva/.test(await text(page, '#oppSqNew')), sqSkip);

  // ====================================================== E3) zpráva o jiném týmu se nemíchá s uloženou (nález revize A5)
  await page.evaluate(() => {
    window.__mock.oppReportReply = { team: 'Baník Test', summary: 'Jiný soupeř.', weaknesses: [{ area: 'Síla', text: 'Jiný tým je slabý v síle.' }], absences: [{ name: 'Cizí Hráč', status: 'out' }] };
  });
  await page.setInputFiles('#oppRepShot', fx('screenshot.png'));
  await page.click('#oppRepRead');
  await page.waitForSelector('#oppRepTeamWarn', { timeout: 15000 });
  const warn = await text(page, '#oppRepTeamWarn');
  check('26 zpráva o jiném týmu ukáže varování: uložená zpráva se nahradí, nemíchá se', /Sparta Test/.test(warn) && /Baník Test/.test(warn) && /NAHRADÍ/.test(warn), warn);
  await page.check('#oppRepConfirm');
  await page.click('#oppRepSave');
  check('26 bez výslovného souhlasu s nahrazením se zpráva o jiném týmu neuloží', /jiném týmu/.test(await text(page, '#toast')) && (await page.evaluate(() => window.FM27.app.store.list('opponent')[0].structured.report.team)) === 'Sparta Test');
  await page.check('#oppRepReplace');
  await page.click('#oppRepSave');
  await page.waitForFunction(() => window.FM27.app.store.list('opponent')[0].structured.report.team === 'Baník Test', null, { timeout: 8000 });
  const rep2 = await page.evaluate(() => window.FM27.app.store.list('opponent')[0].structured.report);
  check('26 po souhlasu platí jen nová zpráva: slabiny, výpadky a sestava Sparty se do zprávy o Baníku nedostaly', rep2.weaknesses.length === 1 && rep2.absences.length === 1 && rep2.absences[0].name === 'Cizí Hráč' && rep2.lineup.length === 0, rep2);

  // ====================================================== F) mobil
  const ovfDesk = await h.overflow(page);
  check('26 na počítači nic nepřetéká do šířky', ovfDesk.sw <= ovfDesk.cw + 1, ovfDesk);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(150);
  const ovf = await h.overflow(page);
  check('26 na telefonu (390 px) nic nepřetéká do šířky', ovf.sw <= ovf.cw + 1, ovf);
  await c.context.close();
};
