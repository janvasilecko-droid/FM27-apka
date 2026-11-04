/* Scénář 05: LIVE COACH se snímky vloženými ručně (stránka v Claude): čtení, duplicity, časová osa, ověřování,
   detektory, hlasová upozornění, rada, záznam změny a jeho vyhodnocení před/po, uložení zápasu.
   Akceptační testy zadání: 7, 8, 9, 10, 11, 12, 13. */
module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, open, nav, text, FakeDbServer } = h;
  const server = new FakeDbServer();
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 5000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };
  const snap = (minute, me, opp, extra) => Object.assign({ screen: 'stats', minute, score: { home: 0, away: opp.goals || 0 }, teams: { home: 'Chelsea', away: 'Sparta Praha' }, stats: { home: { possession: me.pos, shots: me.shots, shotsOnTarget: me.sot, xg: me.xg }, away: { possession: 100 - me.pos, shots: opp.shots, shotsOnTarget: opp.sot, xg: opp.xg } }, events: [], visibleText: ['Statistiky zápasu'], notes: '' }, extra);

  const c = await newContext(browser, { db: server, uid: 'u1' });
  const page = c.page;
  const calls = () => page.evaluate(() => window.__mock.calls);
  const timelineCount = () => page.locator('#liveTimeline .snap').count();
  const openManual = () => page.evaluate(() => (document.querySelector('#liveCapture details.manual').open = true));

  await open(page, 'live');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#liveStart');
  check('05 bez zápasu je nabídka nového zápasu s volbou strany', (await page.isVisible('#liveOpp')) && /domácí|doma/.test(await text(page, '#liveSide')), '');

  // hlas: nízká četnost = jen opravdu důležité (tedy upozornění, ne „sleduj“)
  await nav(page, 'nastaveni');
  await page.check('#setVoiceOn');
  await page.selectOption('#setFreq', 'low');
  await page.waitForTimeout(500);
  const vs = await page.evaluate(() => window.FM27.app.settings().voice);
  check('05 nastavení hlasu se uložilo', vs.enabled === true && vs.frequency === 'low', vs);

  await nav(page, 'live');
  await page.click('#liveStart');
  check('05 bez soupeře se zápas nezačne', /Napiš jméno soupeře/.test(await text(page, '#liveSetupMsg')), await text(page, '#liveSetupMsg'));
  await page.fill('#liveOpp', 'Sparta Praha');
  await page.click('#liveStart');
  await page.waitForSelector('#liveCapture');
  check('05 zápas běží: hlavička, snímky, osa i panel upozornění jsou vidět', (await page.isVisible('#liveHeader')) && (await page.isVisible('#liveTimeline')) && (await page.isVisible('#liveAlerts')), '');
  check('05 v Claude se nabízí vložení snímku, ne sdílení obrazovky', (await page.locator('#liveShare').count()) === 0 && /nesmí sama snímat obrazovku/.test(await text(page, '#liveCapture')), await text(page, '#liveCapture'));
  check('05 hlavička ukazuje soupeře a stranu', /Sparta Praha/.test(await text(page, '#liveHeader')) && /Hraješ za domácí/.test(await text(page, '#liveHeader')), await text(page, '#liveHeader'));

  // ---------- první snímek
  await page.evaluate((r) => (window.__mock.extractQueue = [r]), snap(20, { pos: 55, shots: 2, sot: 1, xg: 0.3 }, { shots: 4, sot: 2, xg: 0.9 }));
  await page.setInputFiles('#liveFile', fx('screenshot.png'));
  await until(async () => (await timelineCount()) === 1);
  check('05 první snímek se přečte a je na časové ose jako neověřený', (await timelineCount()) === 1 && /přečteno z obrázku, neověřeno/.test(await text(page, '#liveTimeline')) && /20\. min/.test(await text(page, '#liveTimeline')), await text(page, '#liveTimeline'));
  let cs = await calls();
  const ex = cs.filter((x) => x.tier === 'quick' && x.images === 1);
  check('05 čtení snímku jde levným tierem a obrázek jde ke Claude', ex.length === 1 && ex[0].cache === false, cs);
  const prompt1 = await page.evaluate(() => window.__mock.prompts.find((p) => /čtečka snímku obrazovky/.test(p)));
  check('05 prompt pro čtení zakazuje hádání a říká, za koho hraješ', /MUSÍ být null/.test(prompt1) && /domácí|home/i.test(prompt1), (prompt1 || '').slice(0, 200));
  check('05 jedno měření je nejvýš „sleduj“, ne upozornění', /sleduj/.test(await text(page, '#liveAlerts')) && !/upozornění/.test(await text(page, '#liveAlerts .chip')), await text(page, '#liveAlerts'));
  check('05 při nízké četnosti se „sleduj“ nahlas nečte', (await page.evaluate(() => window.__spoken.length)) === 0);

  // ---------- duplicita se neposílá
  const before = (await calls()).length;
  await page.setInputFiles('#liveFile', fx('screenshot.png'));
  await page.waitForFunction(() => /skoro stejný/.test(document.querySelector('#liveStatus').textContent));
  check('05 stejný snímek se podruhé neposílá (šetří se spotřeba)', (await calls()).length === before && (await timelineCount()) === 1, await text(page, '#liveStatus'));

  // ---------- druhý snímek: upozornění, protože stav trvá a snímky jsou od sebe ≥ 10 minut
  await page.evaluate((r) => (window.__mock.extractQueue = [r]), snap(35, { pos: 52, shots: 3, sot: 1, xg: 0.5 }, { shots: 7, sot: 4, xg: 1.8, goals: 1 }));
  await page.setInputFiles('#liveFile', fx('screenshot2.png'));
  await until(async () => (await timelineCount()) === 2);
  await until(async () => /upozornění/.test(await text(page, '#liveAlerts')));
  const alertsText = await text(page, '#liveAlerts');
  check('05 dva snímky odstup 15 minut: z „sleduj“ je upozornění', /upozornění/.test(alertsText), alertsText);
  check('05 nález říká, z čeho vychází, a že je to heuristika', /Základ:/.test(await text(page, '#liveFindings')) && /heuristik/i.test(await text(page, '#liveFindings')), await text(page, '#liveFindings'));
  check('05 nález z neověřených snímků je označený jako neověřené čtení', /neověřené čtení/.test(await text(page, '#liveFindings')), await text(page, '#liveFindings'));
  await until(async () => (await page.evaluate(() => window.__spoken.length)) >= 1);
  const spoken = await page.evaluate(() => window.__spoken);
  check('05 důležité upozornění se přečte nahlas česky a krátce', spoken.length === 1 && spoken[0].lang === 'cs-CZ' && spoken[0].text.length <= 200, spoken);
  check('05 upozornění nese štítek „řečeno nahlas“', /řečeno nahlas/.test(await text(page, '#liveAlerts')), await text(page, '#liveAlerts'));

  // ---------- ověření a oprava uživatelem
  const verifyBtns = page.locator('#liveTimeline [data-act="verify"]');
  check('05 u neověřených snímků je tlačítko pro potvrzení', (await verifyBtns.count()) === 2);
  await verifyBtns.first().click();
  await until(async () => (await page.locator('#liveTimeline [data-act="verify"]').count()) === 1);
  await page.locator('#liveTimeline [data-act="verify"]').first().click();
  await until(async () => (await page.locator('#liveTimeline [data-act="verify"]').count()) === 0);
  check('05 po potvrzení jsou snímky ověřené a nález má ověřené podklady', /ověřeno tebou podle snímku/.test(await text(page, '#liveTimeline')) && /ověřené snímky/.test(await text(page, '#liveFindings')), await text(page, '#liveFindings'));

  await page.locator('#liveTimeline .snap').first().getByRole('button', { name: 'Opravit' }).click();
  await page.fill('#lve-away-shots', '6');
  await page.click('#lveSave');
  await until(async () => /zadal jsi ručně/.test(await text(page, '#liveTimeline')));
  check('05 oprava čísel uživatelem změní původ na „zadal jsi ručně“', /zadal jsi ručně/.test(await text(page, '#liveTimeline')), await text(page, '#liveTimeline'));

  // ---------- ruční přidání
  await openManual();
  await page.fill('#lvMinute', '50');
  await page.fill('#lvScoreH', '0');
  await page.fill('#lvScoreA', '2');
  await page.fill('#lv-home-shots', '4');
  await page.fill('#lv-away-shots', '10');
  await page.fill('#lv-home-possession', '53');
  await page.click('#lvSave');
  await until(async () => (await timelineCount()) === 3);
  check('05 ruční snímek se přidá a je označený jako zadaný uživatelem', (await timelineCount()) === 3 && /50\. min/.test(await text(page, '#liveTimeline')), await text(page, '#liveTimeline'));

  // ---------- rada z průběhu zápasu
  await page.fill('#liveNote', 'Soupeř nás přehrává ve středu.');
  await page.click('#liveAsk');
  await page.waitForSelector('#liveAdvice .sec', { timeout: 20000 });
  const advPrompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /Pozorování \(id/.test(p)).pop();
  check('05 do rady jde časová osa zápasu a nálezy z čísel', /- snap-[a-z0-9]+ \| /.test(advPrompt) && /- det-1 \| heuristic_coach/.test(advPrompt) && /Uživatel hraje za domácí/.test(advPrompt), advPrompt.slice(advPrompt.indexOf('Pozorování'), advPrompt.indexOf('Pozorování') + 500));
  check('05 do rady jde i tým a taktika kariéry (kontext)', /- career \| user_entered/.test(advPrompt), '');
  check('05 rada má 10 částí a prošla kontrolou poctivosti', (await page.locator('#liveAdvice .sec').count()) === 10 && /prošla kontrolou/.test(await text(page, '#liveAdvice .banner')), await text(page, '#liveAdvice .banner'));
  check('05 rada z Live se ukládá do historie rad', (await page.evaluate(() => window.FM27.app.store.list('advice').filter((a) => a.source === 'live').length)) === 1);

  // ---------- zaznamenání změny a vyhodnocení před/po
  const rec = page.locator('#liveAdvice [data-change="record"]').first();
  check('05 u navržené změny je tlačítko „Provedl jsem tuhle změnu“', (await rec.count()) === 1);
  await rec.click();
  await until(async () => (await page.evaluate(() => window.FM27.app.store.list('match')[0].changes.length)) === 1);
  const chg = await page.evaluate(() => window.FM27.app.store.list('match')[0].changes[0]);
  check('05 změna se uloží s minutou posledního snímku a hráčem', chg.minute === 50 && /Útočník/.test(chg.summary), chg);
  await until(async () => /zatím nelze vyhodnotit/.test(await text(page, '#liveChanges')));
  const ev0 = await text(page, '#liveChanges');
  check('05 hned po změně aplikace říká, že zatím nic nevyhodnotí (málo dat po změně)', /zatím nelze vyhodnotit/.test(ev0), ev0);

  // další snímky po změně: 55. a 64. minuta (odstup aspoň 8 minut)
  for (const [minute, me, opp] of [[55, { pos: 54, shots: 5, sot: 2, xg: 0.9 }, { shots: 11, sot: 5, xg: 2.2 }], [64, { pos: 56, shots: 9, sot: 4, xg: 1.5 }, { shots: 12, sot: 5, xg: 2.4 }]]) {
    await openManual();
    await page.fill('#lvMinute', String(minute));
    await page.fill('#lv-home-shots', String(me.shots));
    await page.fill('#lv-home-shotsOnTarget', String(me.sot));
    await page.fill('#lv-home-xg', String(me.xg));
    await page.fill('#lv-home-possession', String(me.pos));
    await page.fill('#lv-away-shots', String(opp.shots));
    await page.fill('#lv-away-shotsOnTarget', String(opp.sot));
    await page.fill('#lv-away-xg', String(opp.xg));
    await page.click('#lvSave');
    await until(async () => (await timelineCount()) === (minute === 55 ? 4 : 5));
  }
  await until(async () => /Naše střely na 10 min/.test(await text(page, '#liveChanges')));
  const ev1 = await text(page, '#liveChanges');
  check('05 po dalších snímcích se změna vyhodnotí před a po', /Naše střely na 10 min/.test(ev1) && /Soupeřovy střely na 10 min/.test(ev1) && /→/.test(ev1), ev1);
  check('05 vyhodnocení vždy říká, že časová souvislost není důkaz příčiny', /Časová souvislost není důkaz příčiny/i.test(await text(page, '#liveCausality')), await text(page, '#liveCausality'));
  const episodes = await page.evaluate(() => window.FM27.live.session.alerts.map((a) => a.finding.episode + ':' + a.finding.severity));
  check('05 trvající stav se hlásí jednou za epizodu, ne při každém dalším snímku', episodes.length >= 1 && new Set(episodes).size === episodes.length, episodes);
  check('05 vyhodnocení nikdy netvrdí příčinu', !/způsobil|zavinil|díky změně/i.test(ev1), ev1);

  // ---------- „Vysvětlit podrobněji“ u upozornění (zadání § 8: nechat si doporučení vysvětlit podrobněji)
  const explainBtn = page.locator('#liveAlerts [data-act="explain"]').first();
  check('05 u upozornění je tlačítko „Vysvětlit podrobněji“', (await explainBtn.count()) === 1);
  await explainBtn.click();
  await until(async () => /Vysvětli podrobněji a poraď:/.test(await page.inputValue('#liveNote')));
  await until(async () => (await page.evaluate(() => window.__mock.prompts)).some((p) => /Vysvětli podrobněji a poraď:/.test(p)));
  await page.waitForSelector('#liveAdvice .sec', { timeout: 20000 });
  const explainPrompt = (await page.evaluate(() => window.__mock.prompts)).filter((p) => /Vysvětli podrobněji a poraď:/.test(p)).pop() || '';
  check('05 „Vysvětlit podrobněji“ pošle trenérovi to konkrétní upozornění i s časovou osou zápasu', /Vysvětli podrobněji a poraď: /.test(explainPrompt) && /Pozorování \(id/.test(explainPrompt) && /- snap-[a-z0-9]+ \| /.test(explainPrompt), explainPrompt.slice(0, 300));

  // ---------- obnovení stránky: zápas pokračuje, osa zůstane
  await page.reload();
  await page.waitForFunction(() => window.__trenerReady === true);
  await nav(page, 'live');
  await page.waitForSelector('#liveTimeline');
  check('05 po obnovení stránky se zápas obnoví i s časovou osou a změnou', (await timelineCount()) === 5 && /Provedené změny/.test(await text(page, '#liveChanges')) && (await page.locator('#liveChanges .change-item').count()) === 1, await timelineCount());

  // ---------- smazání snímku
  const delBtn = page.locator('#liveTimeline .snap').last().locator('button.danger');
  await delBtn.click();
  await delBtn.click();
  await until(async () => (await timelineCount()) === 4);
  check('05 snímek jde smazat', (await timelineCount()) === 4);

  // ---------- konec zápasu → uložen v historii
  const end = page.locator('#liveHeader').getByRole('button', { name: 'Ukončit zápas' });
  await end.click();
  await page.locator('#liveHeader').getByRole('button', { name: 'Opravdu ukončit?' }).click();
  await until(async () => (await page.evaluate(() => window.FM27.app.store.list('match')[0].status)) === 'finished');
  const m = await page.evaluate(() => window.FM27.app.store.list('match')[0]);
  check('05 zápas je uložený jako ukončený s časovou osou, změnou a výsledkem', m.status === 'finished' && m.timeline.length === 4 && m.changes.length === 1 && m.result && Number.isInteger(m.result.home), { status: m.status, tl: m.timeline.length, ch: m.changes.length, result: m.result });
  check('05 po ukončení se přejde do Historie zápasů', await until(async () => (await page.evaluate(() => location.hash)) === '#historie'));

  // ---------- chyby čtení snímku
  await nav(page, 'live');
  await page.fill('#liveOpp', 'Slavia Praha');
  await page.click('#liveStart');
  await page.waitForSelector('#liveCapture');
  await page.evaluate(() => (window.__mock.mode = 'extract-invalid'));
  await page.setInputFiles('#liveFile', fx('screenshot.png'));
  await page.waitForFunction(() => /Nic|nepovedlo|přečetl|chyba|Chyba|spolehlivě|Neočekávaná|JSON/i.test(document.querySelector('#liveStatus').textContent));
  const errStatus = await text(page, '#liveStatus');
  check('05 nečitelná odpověď modelu zápas nepoškodí a řekne to', (await timelineCount()) === 0 && errStatus.length > 5, errStatus);
  await page.evaluate(() => (window.__mock.mode = 'not_granted'));
  await page.setInputFiles('#liveFile', fx('screenshot2.png'));
  await page.waitForFunction(() => /povolený|Claude/.test(document.querySelector('#liveStatus').textContent));
  check('05 nepovolený Claude se při čtení snímku srozumitelně ohlásí', /není povolený/.test(await text(page, '#liveStatus')), await text(page, '#liveStatus'));
  await page.evaluate(() => (window.__mock.mode = 'ok'));
  await page.setInputFiles('#liveFile', { name: 'poznamky.txt', mimeType: 'text/plain', buffer: Buffer.from('není obrázek') });
  await page.waitForFunction(() => /není obrázek/.test(document.querySelector('#liveStatus').textContent)).catch(() => {});
  check('05 soubor, který není obrázek, se odmítne', /není obrázek/.test(await text(page, '#liveStatus')), await text(page, '#liveStatus'));

  // zahození zápasu
  const drop = page.locator('#liveHeader').getByRole('button', { name: 'Zahodit zápas' });
  await drop.click();
  await page.locator('#liveHeader').getByRole('button', { name: 'Opravdu zahodit?' }).click();
  await page.waitForSelector('#liveStart');
  check('05 zahozený zápas zmizí a vrátí se nabídka nového', await page.isVisible('#liveStart'));

  // ---------- nález revize: snímek, který se čte, když se zápas zahodí, nepatří do jiného zápasu
  const startMatch = async (opp) => {
    await page.fill('#liveOpp', opp);
    await page.click('#liveStart');
    await page.waitForSelector('#liveCapture');
  };
  const discard = async () => {
    await page.locator('#liveHeader').getByRole('button', { name: 'Zahodit zápas' }).click();
    await page.locator('#liveHeader').getByRole('button', { name: 'Opravdu zahodit?' }).click();
    await page.waitForSelector('#liveStart');
  };
  await startMatch('Plzeň');
  await page.evaluate(() => (window.__mock.extractDelayMs = 1500));
  await page.evaluate((r) => (window.__mock.extractQueue = [r]), snap(10, { pos: 50, shots: 1 }, { shots: 1 }));
  await page.setInputFiles('#liveFile', fx('screenshot.png'));
  await until(async () => (await page.evaluate(() => window.FM27.live.session.busy)) === true);
  await discard();
  await startMatch('Brno');
  await page.waitForTimeout(2300);
  const pinned = await page.evaluate(() => window.FM27.app.store.list('match').filter((m) => m.status === 'live').map((m) => ({ opp: m.opponent, snaps: m.timeline.length })));
  check('05 snímek čtený při zahození zápasu se nepřidá do jiného zápasu', pinned.length === 1 && pinned[0].opp === 'Brno' && pinned[0].snaps === 0, pinned);
  await page.evaluate(() => (window.__mock.extractDelayMs = 0));

  // ---------- nález revize: po opakovaném „Zahodit“ a „Začít“ se nehromadí posluchače (jedno Ctrl+V = jeden snímek, žádné „ještě se čte“)
  await discard();
  await startMatch('Ostrava');
  await discard();
  await startMatch('Olomouc');
  await page.evaluate((r) => (window.__mock.extractQueue = [r]), snap(12, { pos: 50, shots: 2 }, { shots: 2 }));
  const callsBefore = (await calls()).filter((x) => x.kind === 'extract').length;
  const png = require('fs').readFileSync(fx('screenshot2.png')).toString('base64');
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'vlozeny.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png);
  await until(async () => (await timelineCount()) === 1);
  await page.waitForTimeout(400);
  check('05 vložení obrázku po opakovaném zahození zápasu: jedno čtení, jeden snímek, stav neříká „ještě se čte“', (await calls()).filter((x) => x.kind === 'extract').length === callsBefore + 1 && !/ještě čte/.test(await text(page, '#liveStatus')) && /přečten/.test(await text(page, '#liveStatus')), await text(page, '#liveStatus'));
  await discard();

  check('05 bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
  const consoleErrors = c.problems.console.filter((m) => !/Failed to load resource/.test(m));
  check('05 bez chyb v konzoli', consoleErrors.length === 0, consoleErrors);
  await c.context.close();
};
