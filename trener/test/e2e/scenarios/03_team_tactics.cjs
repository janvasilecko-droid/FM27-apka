/* Scénář 03: Můj tým, Moje taktiky, import plánu a kontrola .fmf, kontext kariéry pro trenéra.
   Akceptační testy zadání: 2, 3, 4, 5 (nahraje soubor, zobrazí údaje, doplní soupisku, AI zná taktiku a hráče). */
module.exports = async function run(env) {
  const { browser, check, fx, PLAN, h } = env;
  const { newContext, open, nav, ask, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 4000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };

  const c = await newContext(browser, { db: server, uid: 'u1' });
  const page = c.page;
  await open(page, 'tym');
  check('03 bez kariéry soupiska vyzve k založení kariéry', /Nejdřív založ kariéru/.test(await text(page, '#main')), await text(page, '#main'));
  await page.fill('#careerClub', 'Chelsea');
  await page.fill('#careerComp', 'Premier League');
  await page.click('#careerCreate');
  await page.waitForSelector('#plNew');

  // ---------- hráči ručně
  await page.click('#plNew');
  await page.fill('#plName', 'Jan Novák');
  await page.fill('#plPos', 'rb, rwb');
  await page.fill('#plRole', 'Krajní obránce');
  await page.fill('#plDuty', 'podpora');
  await page.fill('#plAge', '24');
  await page.fill('#plAttrs', 'Pace 16\nFinishing 14');
  await page.check('#plInjury');
  await page.click('#plSave');
  await page.waitForSelector('#playerList .player');
  const row = await text(page, '#playerList .player');
  check('03 hráč je v seznamu s pozicemi, rolí a věkem', /Jan Novák/.test(row) && /RB\/RWB/.test(row) && /role: Krajní obránce \(podpora\)/.test(row) && /věk 24/.test(row), row);
  check('03 hráč je označený jako zadaný uživatelem a zraněný', /zadal jsi/.test(row) && /zraněný/.test(row), row);

  await page.click('#plNew');
  await page.fill('#plName', 'Špatný');
  await page.fill('#plPos', 'Right Back!');
  await page.click('#plSave');
  check('03 divná pozice se odmítne srozumitelně', /Pozice .* je divná/.test(await text(page, '#plMsg')), await text(page, '#plMsg'));
  await page.fill('#plPos', 'RB');
  await page.fill('#plAttrs', 'Pace 25');
  await page.click('#plSave');
  check('03 atribut mimo 1 až 20 se odmítne', /mimo 1 až 20/.test(await text(page, '#plMsg')), await text(page, '#plMsg'));
  await page.fill('#plAttrs', 'tohle není atribut');
  await page.click('#plSave');
  check('03 atribut bez čísla se odmítne', /nemá tvar „Název číslo“/.test(await text(page, '#plMsg')), await text(page, '#plMsg'));
  await page.fill('#plAttrs', '');
  await page.fill('#plAge', '99');
  await page.click('#plSave');
  check('03 nesmyslný věk se odmítne', /Věk musí být/.test(await text(page, '#plMsg')), await text(page, '#plMsg'));
  await page.fill('#plAge', '');
  await page.click('#plSave');
  await until(async () => (await page.locator('#playerList .player').count()) === 2);
  check('03 druhý hráč se uloží po opravě', (await page.locator('#playerList .player').count()) === 2);

  // úprava a smazání
  await page.locator('#playerList .player', { hasText: 'Špatný' }).getByRole('button', { name: 'Upravit' }).click();
  await page.fill('#plName', 'Petr Svoboda');
  await page.click('#plSave');
  await until(async () => /Petr Svoboda/.test(await text(page, '#playerList')));
  check('03 úprava hráče funguje', /Petr Svoboda/.test(await text(page, '#playerList')) && !/Špatný/.test(await text(page, '#playerList')));
  const del = page.locator('#playerList .player', { hasText: 'Petr Svoboda' }).locator('button.danger');
  await del.click();
  await del.click();
  await until(async () => (await page.locator('#playerList .player').count()) === 1);
  check('03 smazání hráče funguje', (await page.locator('#playerList .player').count()) === 1);

  // ---------- import plánu v Můj tým (jen hráči)
  await page.setInputFiles('#teamPlan', PLAN);
  await until(async () => (await page.locator('#playerList .player').count()) >= 11);
  check('03 import plánu přidá 11 hráčů a označí je jako z plánu', (await page.locator('#playerList .player').count()) === 12 && /z ručního plánu/.test(await text(page, '#playerList')), await page.locator('#playerList .player').count());
  check('03 shrnutí soupisky', /12 hráčů/.test(await text(page, '#teamSummary')), await text(page, '#teamSummary'));

  // ---------- screenshot soupisky: návrh se uloží až po potvrzení
  await page.setInputFiles('#squadShot', fx('screenshot.png'));
  await page.click('#squadRead');
  await page.waitForSelector('#squadProposals .book');
  check('03 návrhy ze screenshotu jsou označené jako neověřené a špatné řádky se zahodí', /Není to ověřené/.test(await text(page, '#squadStatus')) && (await page.locator('#squadProposals .book').count()) === 2, await text(page, '#squadStatus'));
  await page.click('#squadAdd');
  check('03 bez potvrzení se z návrhů nic neuloží', (await page.locator('#playerList .player').count()) === 12);
  await page.check('#squadConfirm');
  await page.click('#squadAdd');
  await until(async () => (await page.locator('#playerList .player').count()) === 13);
  const shot = await text(page, '#playerList .player:has-text("Jan Novák") >> nth=0').catch(() => '');
  check('03 po potvrzení se návrhy uloží (zdroj: screenshot potvrzený uživatelem)', (await page.locator('#playerList .player').count()) === 13 && /ze screenshotu, potvrzeno tebou/.test(await text(page, '#playerList')), await text(page, '#playerList'));
  check('03 pozice ze screenshotu se opraví na velká písmena', /GK/.test(await text(page, '#playerList .player:has-text("Svoboda")')), '');

  // ---------- taktiky
  await nav(page, 'taktiky');
  await page.fill('#tacNewName', 'Hlavní 4-3-3');
  await page.selectOption('#tacNewFormation', '4-3-3');
  await page.click('#tacCreate');
  await page.waitForSelector('#tacSave');
  check('03 taktika se vytvoří z formace a je hned aktivní', /Hlavní 4-3-3/.test(await text(page, '#tacSelect')) && (await page.locator('#tacActive').isDisabled()), await text(page, '#tacSelect'));
  check('03 původ nové taktiky je ruční zadání', /zadáno ručně/.test(await text(page, '#tacSource')), await text(page, '#tacSource'));
  check('03 editor má 11 pozic', (await page.locator('#main .slot').count()) === 11);
  await page.selectOption('#slPl-s1', { label: 'Petr Svoboda' }).catch(() => {});
  const optionTexts = await page.locator('#slPl-s1 option').allInnerTexts();
  const gk = optionTexts.find((t) => /Svoboda/.test(t));
  check('03 hráči ze soupisky jsou k výběru u pozic', !!gk, optionTexts.slice(0, 5));
  await page.selectOption('#slPl-s1', { label: gk });
  await page.fill('#slRole-s1', 'Brankář (hraje nohama)');
  await page.fill('#tacMent', 'Vyvážená');
  await page.fill('#tacInstr', 'Hrát přes střed\nVysoký presink');
  await page.click('#tacSave');
  await until(async () => /uložená/.test(await text(page, '#toast').catch(() => '')));
  const tact = await page.evaluate(() => window.FM27.app.store.list('tactic')[0]);
  check('03 taktika se uloží včetně hráče, role a instrukcí', tact && tact.slots[0].role === 'Brankář (hraje nohama)' && !!tact.slots[0].playerId && tact.teamInstructions.length === 2 && tact.mentality === 'Vyvážená', tact);

  // změna formace přenese hráče a role podle pozice
  await page.selectOption('#tacFormation', '4-4-2');
  await page.click('#tacSave');
  await page.waitForFunction(() => /Taktika .* je uložená/.test(document.querySelector('#toast').textContent) && !document.querySelector('#toast').hidden);
  await until(async () => (await page.evaluate(() => window.FM27.app.store.list('tactic')[0].formation)) === '4-4-2');
  await page.waitForTimeout(150);
  const t2 = await page.evaluate(() => window.FM27.app.store.list('tactic')[0]);
  check('03 změna formace zachová brankáře s rolí a mění souřadnice', t2.formation === '4-4-2' && t2.slots[0].pos === 'GK' && t2.slots[0].role === 'Brankář (hraje nohama)' && !!t2.slots[0].playerId, t2.slots.slice(0, 2));

  // import ručního plánu: nová taktika, hráči se podle jména nepřidávají dvakrát
  await page.setInputFiles('#tacPlanFile', PLAN);
  await page.waitForSelector('#tacImportBox .banner.ok', { timeout: 10000 }).catch(() => {});
  const imp = await text(page, '#tacImportBox');
  check('03 import plánu ohlásí, co se načetlo a co je neznámé', /Taktika .* je načtená/.test(imp) && /už v soupisce bylo 11/.test(imp) && /tvoje zadání/.test(imp), imp);
  const tactics = await page.evaluate(() => window.FM27.app.store.list('tactic'));
  check('03 po importu jsou dvě taktiky a slot mají hráče ze soupisky', tactics.length === 2 && tactics.some((t) => t.source.type === 'plan_json' && t.slots.every((s) => !!s.playerId)), tactics.map((t) => t.source.type));
  check('03 po importu se hráči neduplikují', (await page.evaluate(() => window.FM27.app.store.list('player').length)) === 13);

  // špatný plán
  await page.setInputFiles('#tacPlanFile', { name: 'spatny.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"jiny"}') });
  await page.waitForSelector('#tacImportBox .banner.bad');
  check('03 cizí JSON se jako plán odmítne', /není použitelný plán/.test(await text(page, '#tacImportBox')), await text(page, '#tacImportBox'));

  // ---------- kontrola .fmf
  const F1 = Buffer.from('28b52ffd2034a101000b0000004d6f6a6554616b74696b61040000002e746163040000006c6f676f040000002e696d670100000078040000002e616f6d', 'hex');
  const fmf = Buffer.concat([Buffer.from('020161 66 652e'.replace(/ /g, ''), 'hex'), F1, Buffer.from('28b52ffd', 'hex'), Buffer.from('smetí za manifestem')]);
  await page.setInputFiles('#tacFmfFile', { name: 'taktika.fmf', mimeType: 'application/octet-stream', buffer: fmf });
  await page.waitForFunction(() => /Soubor vypadá jako export|Soubor se nepodařilo/.test(document.querySelector('#tacImportBox').textContent), null, { timeout: 15000 });
  const rep = await text(page, '#tacImportBox');
  check('03 .fmf: manifest se najde, ale pole taktiky se nečtou a aplikace to řekne', /Manifest\s+ano/.test(rep) && /nedekódována, nic není ověřeno/.test(rep) && /nehádá/.test(rep) && /odhad názvu: MojeTaktika/.test(rep), rep);
  check('03 .fmf: nabídne ruční doplnění a uložení zprávy', /Doplň taktiku ručně/.test(rep) && (await page.getByRole('button', { name: 'Uložit zprávu o souboru' }).count()) === 1, rep);
  await page.setInputFiles('#tacFmfFile', { name: 'cizi.fmf', mimeType: 'application/octet-stream', buffer: Buffer.from('tohle není export z FM27') });
  await page.waitForFunction(() => /Hlavička neodpovídá/.test(document.querySelector('#tacImportBox').textContent), null, { timeout: 15000 });
  check('03 cizí soubor jako .fmf se odmítne bez hádání', /nebyl interpretován/.test(await text(page, '#tacImportBox')), await text(page, '#tacImportBox'));

  // ---------- AI zná taktiku a hráče (akceptační test 5)
  await nav(page, 'trener');
  check('03 poradce řekne, co o kariéře ví', /Kariéra: Chelsea/.test(await text(page, '#ctxNote')) && /soupiska: 13/.test(await text(page, '#ctxNote')) && /taktika:/.test(await text(page, '#ctxNote')), await text(page, '#ctxNote'));
  await ask(page, 'Co s pravým obráncem?');
  const prompts = await page.evaluate(() => window.__mock.prompts);
  const adv = prompts.filter((p) => /Pozorování \(id/.test(p)).pop() || '';
  check('03 do rady jde soupiska zadaná uživatelem', /- squad \| user_entered \| - \| Soupiska \(zadal uživatel, 13 hráčů\)/.test(adv) && /Jan Novák \[RB\/RWB, role Krajní obránce \(podpora\), věk 24, atributy: Pace 16, Finishing 15, zraněný\]/.test(adv), adv.slice(adv.indexOf('Pozorování'), adv.indexOf('Pozorování') + 700));
  check('03 do rady jde aktivní taktika s rolemi a instrukcemi', /- tactic \| user_entered/.test(adv) && /Taktika „Hlavní 4-3-3“/.test(adv) && /Týmové instrukce: Hrát přes střed; Vysoký presink/.test(adv) && /role Brankář \(hraje nohama\)/.test(adv), '');
  check('03 rada s kontextem kariéry prošla kontrolou', /prošla kontrolou/.test(await text(page, '#result .banner')), await text(page, '#result .banner'));

  // ---------- synchronizace soupisky a taktik na telefon
  const phone = await newContext(browser, { db: server, uid: 'u1', viewport: { width: 390, height: 844 } });
  await open(phone.page, 'tym');
  await until(async () => (await phone.page.locator('#playerList .player').count()) === 13, 8000);
  check('03 telefon: soupiska se synchronizovala', (await phone.page.locator('#playerList .player').count()) === 13, await phone.page.locator('#playerList .player').count());
  await nav(phone.page, 'taktiky');
  // Taktiky dorazí ze synchronizace o chvilku později než soupiska; obrazovka se po jejich příchodu překreslí sama, proto se čeká (stejně jako u hráčů).
  await until(async () => (await phone.page.locator('#tacSelect option').count()) === 2, 8000);
  check('03 telefon: taktiky se synchronizovaly', (await phone.page.locator('#tacSelect option').count()) === 2, await phone.page.locator('#tacSelect option').count());

  // ---------- nález revize: změna z druhého zařízení nesmí smazat rozepsané úpravy editoru
  await nav(page, 'taktiky');
  await page.waitForSelector('#tacMent');
  const oldName = await page.inputValue('#tacName');
  const shownId = await page.inputValue('#tacSelect');
  await page.fill('#tacMent', 'Rozepsaná mentalita, ještě neuložená');
  await phone.page.evaluate((id) => {
    const t = window.FM27.app.store.get('tactic', id);
    return window.FM27.app.store.put('tactic', Object.assign(window.FM27.app.store.draft(t), { name: 'Přejmenováno jinde' }));
  }, shownId);
  await page.waitForSelector('#remoteNotice', { timeout: 8000 }).catch(() => {});
  check('03 změna z jiného zařízení při rozepsaných úpravách: aplikace upozorní a nepřekreslí', (await page.isVisible('#remoteNotice')) && (await page.inputValue('#tacMent')) === 'Rozepsaná mentalita, ještě neuložená' && (await page.inputValue('#tacName')) === oldName, { notice: await page.isVisible('#remoteNotice'), ment: await page.inputValue('#tacMent') });
  await page.getByRole('button', { name: 'Načíst novou verzi' }).click();
  await page.waitForSelector('#tacName');
  check('03 „Načíst novou verzi“ zobrazí změněnou taktiku a upozornění zmizí', (await page.inputValue('#tacName')) === 'Přejmenováno jinde' && !(await page.isVisible('#remoteNotice').catch(() => false)), await page.inputValue('#tacName'));
  // bez rozepsaných úprav se obrazovka překreslí sama
  await phone.page.evaluate((id) => {
    const t = window.FM27.app.store.get('tactic', id);
    return window.FM27.app.store.put('tactic', Object.assign(window.FM27.app.store.draft(t), { name: 'Podruhé přejmenováno' }));
  }, shownId);
  await page.waitForFunction(() => document.querySelector('#tacName') && document.querySelector('#tacName').value === 'Podruhé přejmenováno', null, { timeout: 8000 }).catch(() => {});
  check('03 bez rozepsaných úprav se změna z jiného zařízení projeví sama', (await page.inputValue('#tacName')) === 'Podruhé přejmenováno', await page.inputValue('#tacName'));

  for (const x of [c, phone]) {
    check('03 bez chyb ve skriptu', x.problems.page.length === 0, x.problems.page);
    await x.context.close();
  }
};
