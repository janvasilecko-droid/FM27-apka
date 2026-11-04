/* Scénář 09: HLASOVÝ TRENÉR (zadání § 8, etapa 5, akceptační test 12): česky, krátce, hlasitost a rychlost,
   četnost a tichý režim, čtení rady nahlas, hlasová otázka (jen samostatná verze).
   Hlasový výstup i rozpoznávání řeči zastupují zkušební stroje (skutečný hlas a mikrofon se tady zkoušet nedají),
   zkouší se tedy všechno kolem nich: pravidla, nastavení, kdy se mluví a kdy ne, chyby a stav tlačítek. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, ask, text, waitIdle, FakeDbServer } = h;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };
  const spokenOf = (page) => page.evaluate(() => window.__spoken);
  const voiceSettings = (page) => page.evaluate(() => window.FM27.app.settings().voice);
  const setRange = (page, sel, value) =>
    page.evaluate(
      ([s, v]) => {
        const el = document.querySelector(s);
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      [sel, value]
    );
  const patchVoice = (page, patch) => page.evaluate((p) => window.FM27.app.updateSettings({ voice: p }), patch);
  const decide = (page, alert) => page.evaluate((a) => window.FM27.voice.alert(window.FM27.app, a), alert);
  const toastText = (page) => page.evaluate(() => document.querySelector('#toast').textContent);

  // ====================================================== A) stránka v Claude (bez mikrofonu)
  const server = new FakeDbServer();
  const c = await newContext(browser, { db: server, uid: 'u1' });
  const page = c.page;
  await open(page, 'nastaveni');
  const ids = ['#setVoiceOn', '#setQuiet', '#setVolume', '#setRate', '#setFreq', '#voiceTest'];
  const visible = [];
  for (const id of ids) visible.push(await page.isVisible(id));
  check('09 nastavení má hlas zapnout, tichý režim, hlasitost, rychlost, četnost i zkoušku hlasu', visible.every(Boolean), visible);
  check('09 hlas je ve výchozím stavu vypnutý (nic nemluví, dokud to uživatel nezapne)', (await voiceSettings(page)).enabled === false && (await voiceSettings(page)).quiet === false, await voiceSettings(page));
  check('09 stav schopností říká: hlasový výstup ano, mikrofon jen v samostatné verzi', /Hlasový výstup \(čeština\)\s*ano/.test(await text(page, '#diag')) && /Hlasový vstup \(mikrofon\)\s*ne \(jen v samostatné verzi\)/.test(await text(page, '#diag')), await text(page, '#diag'));

  check('09 v Claude se systémová oznámení nenabízí (stránka je nesmí zapnout)', (await page.locator('#setNotify').count()) === 0 && /Systémová oznámení[^\n]*\s*ne \(jen v samostatné verzi\)/.test(await text(page, '#diag')), await text(page, '#diag'));

  // ---------- zkouška hlasu
  await page.click('#voiceTest');
  await until(async () => (await spokenOf(page)).length === 1);
  let sp = await spokenOf(page);
  check('09 zkouška hlasu mluví česky, českým hlasem a krátce', sp.length === 1 && sp[0].lang === 'cs-CZ' && sp[0].voice === 'test-cs' && sp[0].text.length < 120, sp);
  check('09 výchozí hlasitost je 0,9 a rychlost 1', sp[0].volume === 0.9 && sp[0].rate === 1, sp[0]);
  await setRange(page, '#setVolume', 0.4);
  await setRange(page, '#setRate', 1.2);
  await until(async () => (await voiceSettings(page)).volume === 0.4 && (await voiceSettings(page)).rate === 1.2);
  await page.click('#voiceTest');
  await until(async () => (await spokenOf(page)).length === 2);
  sp = await spokenOf(page);
  check('09 hlasitost a rychlost z nastavení se opravdu použijí', sp.length === 2 && sp[1].volume === 0.4 && sp[1].rate === 1.2, sp);

  // ---------- pravidla upozornění (stejný kód jako v Live Coachi): vypnuto → ticho → četnost → odstup → duplicita
  const A1 = { id: 'a1', severity: 'alert', text: 'Pozor, soupeř opakovaně využívá prostor za pravým obráncem. Doporučuji změnit jeho povinnost na obranu.' };
  let d = await decide(page, A1);
  check('09 vypnutý hlas: upozornění se nepřečte', d.speak === false && d.reason === 'voice_off', d);
  await page.check('#setVoiceOn');
  await until(async () => (await voiceSettings(page)).enabled === true);
  await patchVoice(page, { quiet: true });
  d = await decide(page, A1);
  check('09 tichý režim: upozornění se nepřečte, zůstane jen text na obrazovce', d.speak === false && d.reason === 'quiet' && (await spokenOf(page)).length === 2, d);
  await patchVoice(page, { quiet: false, frequency: 'low' });
  d = await decide(page, { id: 'w1', severity: 'watch', text: 'Sleduj střely soupeře.' });
  check('09 nízká četnost: „sleduj“ se nahlas nečte', d.speak === false && d.reason === 'too_minor', d);
  d = await decide(page, A1);
  await until(async () => (await spokenOf(page)).length === 3);
  sp = await spokenOf(page);
  check('09 nízká četnost: opravdu důležité upozornění se přečte česky a krátce', d.speak === true && sp[2].lang === 'cs-CZ' && sp[2].text.length <= 200 && /prostor za pravým obráncem/.test(sp[2].text), { d, sp: sp[2] });
  d = await decide(page, A1);
  check('09 totéž upozornění se do 5 minut nezopakuje', d.speak === false && d.reason === 'duplicate', d);
  d = await decide(page, { id: 'a2', severity: 'alert', text: 'Soupeř přechází do tlaku po křídle.' });
  check('09 dvě upozornění těsně po sobě se nepřečtou (nezahlcovat)', d.speak === false && d.reason === 'gap' && (await spokenOf(page)).length === 3, d);
  await page.evaluate(() => window.FM27.voice.resetPolicy());

  // ---------- tichý režim v nastavení
  await page.check('#setQuiet');
  await until(async () => (await voiceSettings(page)).quiet === true);
  await page.click('#voiceTest');
  check('09 tichý režim: zkouška hlasu nemluví a řekne proč', /Tichý režim je zapnutý/.test(await toastText(page)) && (await spokenOf(page)).length === 3, await toastText(page));
  await page.uncheck('#setQuiet');
  await until(async () => (await voiceSettings(page)).quiet === false);

  // ---------- rada nahlas z Osobního trenéra
  await nav(page, 'trener');
  check('09 v Claude není tlačítko Mluvit (stránka nemá mikrofon)', (await page.locator('#micBtn').count()) === 0);
  await ask(page, 'Soupeř nás přehrává po křídle, co mám změnit?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const speakBtn = page.locator('#result [data-act="speak"]');
  check('09 rada nabízí „Přečíst radu nahlas“', (await speakBtn.count()) === 1);
  await speakBtn.click();
  await until(async () => (await spokenOf(page)).length === 4);
  sp = await spokenOf(page);
  check('09 mluvená rada je krátká: diagnóza, první změna a hlavní riziko', sp.length === 4 && /^Diagnóza:/.test(sp[3].text) && sp[3].text.length <= 320 && sp[3].lang === 'cs-CZ' && sp[3].volume === 0.4, sp[3]);
  check('09 rada se při samotném zeptání sama nahlas nečte (jen na přání nebo po hlasové otázce)', sp.length === 4);

  await nav(page, 'nastaveni');
  await page.check('#setQuiet');
  await until(async () => (await voiceSettings(page)).quiet === true);
  await nav(page, 'trener');
  await ask(page, 'A co standardní situace?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  await page.locator('#result [data-act="speak"]').click();
  check('09 tichý režim: rada se nahlas nepřečte a aplikace řekne, jak to změnit', /Tichý režim je zapnutý/.test(await toastText(page)) && (await spokenOf(page)).length === 4, await toastText(page));
  check('09 nastavení hlasu se synchronizuje (je v uloženém nastavení)', (await voiceSettings(page)).volume === 0.4 && (await voiceSettings(page)).quiet === true, await voiceSettings(page));

  check('09 A: bez chyb ve skriptu', c.problems.page.length === 0, c.problems.page);
  const ce = c.problems.console.filter((m) => !/Failed to load resource/.test(m));
  check('09 A: bez chyb v konzoli', ce.length === 0, ce);
  await c.context.close();

  // ====================================================== B) samostatná verze s mikrofonem
  const MIC = () => {
    window.__rec = { next: { transcript: 'Soupeř nás přehrává po pravé straně, co mám změnit?' }, started: 0, stopped: 0, lang: null };
    class Rec {
      start() {
        const cfg = window.__rec;
        const n = cfg.next || {};
        cfg.started++;
        cfg.lang = this.lang;
        this._t = setTimeout(() => {
          if (n.error) this.onerror && this.onerror({ error: n.error });
          else if (n.transcript) this.onresult && this.onresult({ results: [[{ transcript: n.transcript }]] });
          setTimeout(() => this.onend && this.onend(), 10);
        }, n.delay || 60);
      }
      stop() {
        window.__rec.stopped++;
        clearTimeout(this._t);
        setTimeout(() => this.onend && this.onend(), 5);
      }
    }
    window.SpeechRecognition = Rec;
  };
  const s = await newContext(browser, { standalone: true });
  await s.context.addInitScript(MIC);
  const sp2 = s.page;
  await open(sp2, 'trener');
  check('09 samostatná verze nabízí hlasovou otázku (tlačítko Mluvit)', (await sp2.locator('#micBtn').count()) === 1 && /Mluvit/.test(await text(sp2, '#micBtn')));
  await sp2.click('#micBtn');
  check('09 během poslechu tlačítko říká, že aplikace poslouchá', /Poslouchám/.test(await text(sp2, '#micBtn')), await text(sp2, '#micBtn'));
  await until(async () => (await sp2.inputValue('#question')).length > 0);
  const heard = await sp2.inputValue('#question');
  check('09 řeč se přepíše do otázky a rozpoznávání je nastavené na češtinu', /přehrává po pravé straně/.test(heard) && (await sp2.evaluate(() => window.__rec.lang)) === 'cs-CZ', { heard, lang: await sp2.evaluate(() => window.__rec.lang) });
  await until(async () => /Mluvit/.test(await text(sp2, '#micBtn')));
  check('09 po poslechu se tlačítko vrátí do původního stavu', /Mluvit/.test(await text(sp2, '#micBtn')), await text(sp2, '#micBtn'));

  // otázka položená hlasem → krátká mluvená odpověď
  await sp2.click('#askBtn');
  await waitIdle(sp2);
  await sp2.waitForSelector('#result .sec', { timeout: 20000 });
  await until(async () => (await spokenOf(sp2)).length === 1);
  let spk = await spokenOf(sp2);
  check('09 otázka položená hlasem dostane krátkou mluvenou odpověď', spk.length === 1 && /^Diagnóza:/.test(spk[0].text) && spk[0].text.length <= 320 && spk[0].lang === 'cs-CZ', spk);
  // otázka napsaná rukou se nahlas nečte
  await ask(sp2, 'Jak mám bránit standardní situace?');
  await sp2.waitForSelector('#result .sec', { timeout: 20000 });
  await sp2.waitForTimeout(150);
  check('09 otázka napsaná rukou se sama nahlas nečte', (await spokenOf(sp2)).length === 1, await spokenOf(sp2));
  // tichý režim: ani hlasová otázka se nahlas nepřečte
  await patchVoice(sp2, { quiet: true });
  await sp2.click('#micBtn');
  await until(async () => (await sp2.evaluate(() => window.__rec.started)) === 2);
  await until(async () => /Mluvit/.test(await text(sp2, '#micBtn')));
  await sp2.click('#askBtn');
  await waitIdle(sp2);
  await sp2.waitForSelector('#result .sec', { timeout: 20000 });
  await sp2.waitForTimeout(150);
  check('09 tichý režim: hlasová otázka dostane jen textovou odpověď', (await spokenOf(sp2)).length === 1, await spokenOf(sp2));
  await patchVoice(sp2, { quiet: false });

  // chyby rozpoznávání
  await sp2.evaluate(() => (window.__rec.next = { error: 'not-allowed' }));
  await sp2.click('#micBtn');
  await sp2.waitForFunction(() => /Mikrofon jsi nepovolil/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 }).catch(() => {});
  check('09 zakázaný mikrofon se srozumitelně ohlásí', /Mikrofon jsi nepovolil/.test(await toastText(sp2)), await toastText(sp2));
  await until(async () => /Mluvit/.test(await text(sp2, '#micBtn')));
  await sp2.evaluate(() => (window.__rec.next = { error: 'no-speech' }));
  await sp2.click('#micBtn');
  await sp2.waitForFunction(() => /nepodařilo rozpoznat/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 }).catch(() => {});
  check('09 neslyšená řeč se ohlásí a otázka zůstane, jak byla', /nepodařilo rozpoznat \(no-speech\)/.test(await toastText(sp2)) && /přehrává po pravé straně/.test(await sp2.inputValue('#question')), await toastText(sp2));
  await until(async () => /Mluvit/.test(await text(sp2, '#micBtn')));

  // druhé stisknutí poslech zastaví a nic nevloží
  await sp2.evaluate(() => {
    document.querySelector('#question').value = '';
    document.querySelector('#question').dispatchEvent(new Event('input', { bubbles: true }));
    window.__rec.next = { transcript: 'tohle se nesmí vložit', delay: 5000 };
  });
  await sp2.click('#micBtn');
  await sp2.click('#micBtn');
  await until(async () => /Mluvit/.test(await text(sp2, '#micBtn')));
  await sp2.waitForTimeout(150);
  check('09 druhým stisknutím jde poslech zastavit a nic se nevloží', (await sp2.evaluate(() => window.__rec.stopped)) === 1 && (await sp2.inputValue('#question')) === '', { stopped: await sp2.evaluate(() => window.__rec.stopped), q: await sp2.inputValue('#question') });
  check('09 nastavení říká, že hlasový vstup v samostatné verzi funguje', await (async () => {
    await nav(sp2, 'nastaveni');
    return /Hlasový vstup \(mikrofon\)\s*ano/.test(await text(sp2, '#diag'));
  })(), await text(sp2, '#diag'));
  check('09 B: bez chyb ve skriptu', s.problems.page.length === 0, s.problems.page);
  const se = s.problems.console.filter((m) => !/Failed to load resource/.test(m));
  check('09 B: bez chyb v konzoli', se.length === 0, se);
  await s.context.close();

  // ====================================================== C) prohlížeč bez hlasu a bez rozpoznávání řeči
  const n = await newContext(browser, { standalone: true });
  await n.context.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.speechSynthesis;
  });
  await open(n.page, 'trener');
  check('09 bez rozpoznávání řeči se tlačítko Mluvit vůbec neukáže', (await n.page.locator('#micBtn').count()) === 0);
  await ask(n.page, 'Jak vyřešit tlak soupeře?');
  await n.page.waitForSelector('#result .sec', { timeout: 20000 });
  check('09 bez hlasového výstupu rada nenabízí čtení nahlas', (await n.page.locator('#result [data-act="speak"]').count()) === 0);
  await nav(n.page, 'nastaveni');
  await n.page.click('#voiceTest');
  check('09 bez hlasového výstupu to zkouška hlasu řekne otevřeně', /není k dispozici/.test(await toastText(n.page)), await toastText(n.page));
  const diagNo = await text(n.page, '#diag');
  check('09 stav schopností: výstup ne, vstup ne (prohlížeč řeč nemá)', /Hlasový výstup \(čeština\)\s*ne\b/.test(diagNo) && /Hlasový vstup \(mikrofon\)\s*ne: prohlížeč/.test(diagNo), diagNo);
  await n.context.close();

  // ====================================================== E) systémová oznámení (jen samostatná verze)
  const NOTE = () => {
    window.__notes = [];
    window.__notePerm = 'default';
    window.__noteAnswer = 'granted';
    window.__asked = 0;
    window.__hidden = false;
    window.Notification = class {
      constructor(title, opts) {
        window.__notes.push({ title, body: opts && opts.body, tag: opts && opts.tag });
      }
      static get permission() {
        return window.__notePerm;
      }
      static async requestPermission() {
        window.__asked++;
        window.__notePerm = window.__noteAnswer;
        return window.__notePerm;
      }
    };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
  };
  const f = await newContext(browser, { standalone: true });
  await f.context.addInitScript(NOTE);
  const fp = f.page;
  await open(fp, 'nastaveni');
  const FINDING = { id: 'det-1', severity: 'alert', title: 'Soupeř tlačí po křídle', text: 'Soupeř má za posledních 15 minut výrazně víc střel. ' + 'Delší text, který se musí zkrátit. '.repeat(12) };
  const show = (finding) => fp.evaluate((x) => window.FM27.notify.show(window.FM27.app, x), finding);
  const notes = () => fp.evaluate(() => window.__notes);
  check('09 samostatná verze nabízí systémová oznámení a stav říká, že zatím nejsou povolená', (await fp.isVisible('#setNotify')) && /Systémová oznámení[^\n]*\s*zatím nepovolena/.test(await text(fp, '#diag')), await text(fp, '#diag'));
  let ns = await show(FINDING);
  check('09 oznámení jsou ve výchozím stavu vypnutá', ns.shown === false && ns.reason === 'off' && (await notes()).length === 0, ns);
  await fp.check('#setNotify');
  await until(async () => (await fp.evaluate(() => window.FM27.app.settings().notify.enabled)) === true);
  check('09 zapnutí požádá prohlížeč o povolení (z kliknutí) a uloží se', (await fp.evaluate(() => window.__asked)) === 1 && (await fp.evaluate(() => window.FM27.app.settings().notify.enabled)) === true && /Oznámení jsou zapnutá/.test(await text(fp, '#notifyMsg')), await text(fp, '#notifyMsg'));
  ns = await show(FINDING);
  check('09 při viditelném okně se oznámení neposílá (text a hlas stačí)', ns.shown === false && ns.reason === 'visible' && (await notes()).length === 0, ns);
  await fp.evaluate(() => (window.__hidden = true));
  ns = await show(Object.assign({}, FINDING, { id: 'w1', severity: 'watch' }));
  check('09 „sleduj“ se jako oznámení neposílá ani při skrytém okně', ns.shown === false && ns.reason === 'too_minor', ns);
  ns = await show(FINDING);
  const sent = await notes();
  check('09 důležité upozornění při skrytém okně přijde jako oznámení s krátkým textem', ns.shown === true && sent.length === 1 && sent[0].title === 'FM27 Coach: Soupeř tlačí po křídle' && sent[0].body.length <= 180 && sent[0].tag === 'det-1', { ns, sent });
  await fp.uncheck('#setNotify');
  await until(async () => (await fp.evaluate(() => window.FM27.app.settings().notify.enabled)) === false);
  ns = await show(FINDING);
  check('09 po vypnutí se oznámení neposílají', ns.shown === false && ns.reason === 'off' && (await notes()).length === 1, ns);
  await fp.evaluate(() => {
    window.__notePerm = 'default';
    window.__noteAnswer = 'denied';
  });
  await fp.click('#setNotify'); // zaškrtnutí se hned vrátí, proto click (check by to hlásil jako chybu)
  await until(async () => /zakázal/.test(await text(fp, '#notifyMsg')));
  check('09 zakázané oznámení se nezapne a aplikace řekne, kde je povolit', !(await fp.isChecked('#setNotify')) && (await fp.evaluate(() => window.FM27.app.settings().notify.enabled)) === false && /Povol je v nastavení webu/.test(await text(fp, '#notifyMsg')), await text(fp, '#notifyMsg'));
  check('09 E: bez chyb ve skriptu', f.problems.page.length === 0, f.problems.page);
  await f.context.close();

  // ====================================================== D) zařízení bez české hlasové zásoby
  const e = await newContext(browser, {});
  await e.context.addInitScript(() => {
    window.speechSynthesis.getVoices = () => [{ lang: 'en-US', name: 'English', voiceURI: 'en-1' }];
  });
  await open(e.page, 'nastaveni');
  await e.page.click('#voiceTest');
  await until(async () => (await spokenOf(e.page)).length === 1);
  const sp3 = await spokenOf(e.page);
  check('09 bez české hlasové zásoby aplikace varuje a nepředstírá, že hlas je český', /není česká hlasová zásoba/.test(await toastText(e.page)) && sp3.length === 1 && sp3[0].voice === null && sp3[0].lang === 'cs-CZ', { toast: await toastText(e.page), sp3 });
  check('09 stav schopností to říká', /bez české hlasové zásoby/.test(await text(e.page, '#diag')), await text(e.page, '#diag'));
  await e.context.close();
};
