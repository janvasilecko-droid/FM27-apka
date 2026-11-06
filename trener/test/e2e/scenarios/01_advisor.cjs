/* Scénář 01: poradce (Osobní trenér) a knihovna (Zdroje znalostí): původní zkouška upravená pro novou kostru. */
const path = require('path');
module.exports = async function run(env) {
  const { browser, check, fx, OUT, h } = env;
  const { newContext, open, nav, ask, addObs, addBooks, setMode, resetCalls, calls, waitIdle, overflow, text } = h;
  {
    // ---------- A) hlavní průchod
    const { context, page, problems } = await newContext(browser);
    await open(page, 'trener');

    check('A1 stránka naběhla bez chyb ve skriptu', problems.page.length === 0, problems.page);
    check('A1 stav Claude: připojeno', /připojeno/.test(await text(page, '#pillClaude')), await text(page, '#pillClaude'));
    check('A1 stav knihovny: prázdná', /prázdná/.test(await text(page, '#pillLibrary')), await text(page, '#pillLibrary'));
    check('A1 tlačítko Poradit je povolené', await page.isEnabled('#askBtn'));
    check('A1 pole pro obrázky je vidět (Claude hlásí podporu)', await page.isVisible('#imageField'));
    await nav(page, 'nastaveni');
    const diag = await text(page, '#diag');
    check('A1 Info: verze stránky a registr zdrojů', /Verze stránky\s+\d{4}-\d\d-\d\d-[0-9a-f]{8}/.test(diag) && /registru\s+3/.test(diag), diag);
    await nav(page, 'trener');

    // A2: rada s prázdnou knihovnou
    await ask(page, 'Útočník je od 25. minuty bez podpory a soupeř nás přehrává ve středu hřiště.');
    let c = await calls(page);
    check('A2 prázdná knihovna: žádný dotaz na plán hledání, jen jedno volání rady', c.length === 1 && c[0].kind === 'advice', c);
    check('A2 rada má 10 částí', (await page.locator('#result .sec').count()) === 10, await page.locator('#result .sec').count());
    check('A2 stránka řekne, že rada nevychází z knih', /rada nevychází z knih/.test(await text(page, '#result .banner')), await text(page, '#result .banner'));
    check('A2 volání bez mezipaměti a s tierem default', c[0].cache === false && c[0].tier === 'default', c[0]);
    check('A2 bez pozorování je jistota nízká', /nízká/.test(await text(page, '#result .sec:nth-child(4)')), await text(page, '#result .sec:nth-child(4)'));
    check('A2 u každé změny je „Proč“: příčina a následek, ne jen příkaz', (await page.locator('#result .change-item').count()) === (await page.locator('#result .change-item .why').count()) && (await page.locator('#result .change-item .why').count()) >= 1 && /Proč: .*proto dostává málo přihrávek/.test(await text(page, '#result .change-item .why')), await text(page, '#result .change-item'));
    check('A2 „Proč“ bez zdroje je viditelně označené jako úvaha trenéra', /úvaha trenéra, bez zdroje/.test(await text(page, '#result .change-item .why')), await text(page, '#result .change-item .why'));

    // A3: knihovna
    let status = await addBooks(page, [fx('prazdny.txt')]);
    check('A3 prázdný soubor se odmítne srozumitelně', /není čitelný text/.test(status), status);
    status = await addBooks(page, [fx('sken.pdf')]);
    check('A3 sken bez textové vrstvy se odmítne srozumitelně', /není čitelný text/.test(status), status);
    status = await addBooks(page, [fx('taktika-cs.txt')], { rights: false });
    check('A3 bez potvrzení práv se nic nepřidá', /Potvrď/.test(status) && (await page.locator('#bookList .book').count()) === 0, status);
    status = await addBooks(page, [fx('taktika-cs.txt')], { title: 'Zkušební taktika', author: 'Autor Zkoušky', lang: 'auto' });
    check('A3 TXT se přidá', /Přidáno: 1/.test(status) && (await page.locator('#bookList .book').count()) === 1, status);
    check('A3 jazyk TXT se pozná jako čeština', /čeština/.test(await text(page, '#bookList .book')), await text(page, '#bookList .book'));
    check('A3 stav knihovny: 1 kniha', /1 kniha/.test(await text(page, '#pillLibrary')), await text(page, '#pillLibrary'));
    status = await addBooks(page, [fx('taktika-cs.pdf'), fx('tactics-en.pdf')]);
    check('A3 dvě PDF se přidají přes pdf.js', /Přidáno: 2/.test(status), status);
    const booksText = await text(page, '#bookList');
    check('A3 PDF se počítá na listy a skloňuje se správně', /3 listy/.test(booksText) && /4 listy/.test(booksText) && /1 oddíl ·/.test(booksText) && /2 úryvky/.test(booksText), booksText);
    check('A3 jazyk anglického PDF se pozná', /angličtina/.test(booksText), booksText);
    status = await addBooks(page, [fx('taktika-cs.txt')]);
    check('A3 stejná kniha podruhé se nepřidá', /už v knihovně máš/.test(status) && (await page.locator('#bookList .book').count()) === 3, status);

    // A4: hledání
    await page.fill('#searchQ', 'izolovaný útočník podpora');
    await page.click('#searchBtn');
    const hit1 = await text(page, '#searchResults .hit');
    check('A4 hledání češtiny najde odstavec o izolovaném útočníkovi', /izolovan/i.test(hit1) && /útočník/.test(hit1), hit1);
    check('A4 u nálezu je název knihy a místo', /,\s*(list PDF č\. \d+|oddíl \d+)/.test(await text(page, '#searchResults .hit .cite')), await text(page, '#searchResults .hit .cite'));
    await page.fill('#searchQ', 'izolovany utocnik');
    await page.click('#searchBtn');
    check('A4 hledání funguje i bez diakritiky', (await page.locator('#searchResults .hit').count()) > 0);
    await page.fill('#searchQ', 'counter-pressing compact');
    await page.click('#searchBtn');
    const citeEn = await text(page, '#searchResults .hit .cite');
    check('A4 hledání v angličtině cituje list PDF', /tactics-en, list PDF č\. 2/.test(citeEn), citeEn);
    await page.fill('#searchQ', 'qwertzuiop');
    await page.click('#searchBtn');
    check('A4 neexistující výraz nic nenajde a řekne to', /Nic nenalezeno/.test(await text(page, '#searchResults')), await text(page, '#searchResults'));
    await page.fill('#searchQ', 'protipresink ztráta míče');
    await page.click('#searchBtn');
    await page.locator('#searchResults .hit button').first().click();
    check('A4 úryvek se otevře v panelu i se sousedními odstavci', (await page.isVisible('#drawer')) && (await page.locator('#drawerBody .passage').count()) >= 2);
    await page.keyboard.press('Escape');
    check('A4 Escape panel zavře', !(await page.isVisible('#drawer')));

    // A5: knihovna přežije obnovení stránky
    await page.reload();
    await page.waitForFunction(() => window.__trenerReady === true);
    check('A5 po obnovení stránky jsou knihy pořád tam', /3 knihy/.test(await text(page, '#pillLibrary')), await text(page, '#pillLibrary'));
    await nav(page, 'zdroje');
    await page.fill('#searchQ', 'izolovaný útočník');
    await page.click('#searchBtn');
    check('A5 a hledání po obnovení funguje', (await page.locator('#searchResults .hit').count()) > 0);
    await nav(page, 'trener');

    // A6: rada s knihami
    await resetCalls(page);
    await addObs(page, 'user_entered', 25, 'střely 11:3, držení míče 62 %');
    check('A6 pozorování se přidá do seznamu', (await page.locator('#obsList li').count()) === 1 && /obs-1/.test(await text(page, '#obsList')), await text(page, '#obsList'));
    await ask(page, 'Útočník je od 25. minuty bez podpory a soupeř nás přehrává ve středu hřiště.');
    c = await calls(page);
    check('A6 pořadí volání: plán hledání, rada', c.map((x) => x.kind).join() === 'planner,advice', c.map((x) => x.kind));
    check('A6 plán hledání jde levným tierem, rada defaultním', c[0].tier === 'quick' && c[1].tier === 'default', c.map((x) => x.tier));
    const prompt = await page.evaluate(() => window.__mock.prompts[1]);
    check('A6 rada dostala úryvky z knih (id bk:) i pozorování obs-1', /- bk:[^ ]+ \| /.test(prompt) && /- obs-1 \| user_entered/.test(prompt));
    check('A6 výsledek má 10 částí a prošel kontrolou', (await page.locator('#result .sec').count()) === 10 && /prošla kontrolou/.test(await text(page, '#result .banner')));
    const refButtons = await page.locator('#result button.ref').count();
    check('A6 odkazy na knihy jsou klikací', refButtons >= 1, refButtons);
    await page.locator('#result button.ref').first().click();
    check('A6 odkaz na knihu otevře úryvek', (await page.isVisible('#drawer')) && (await text(page, '#drawerBody')).length > 40);
    await page.click('#drawerClose');
    check('A6 historie má dva záznamy (A2 a A6)', (await page.locator('#historyList li').count()) === 2, await page.locator('#historyList li').count());
    check('A6 průběh ukazuje hotovo', (await page.locator('#steps li.done').count()) >= 3, await text(page, '#steps'));
    check('A6 banner ukazuje, co se hledalo', /Hledáno:/.test(await text(page, '#result .banner')));

    // A7: důkladný režim
    await resetCalls(page);
    await page.check('#deepMode');
    await ask(page, 'Co mám změnit?');
    c = await calls(page);
    check('A7 důkladný režim volá tier complex', c.some((x) => x.kind === 'advice' && x.tier === 'complex'), c);
    await page.uncheck('#deepMode');

    // A8: opravné kolo
    await setMode(page, { mode: 'repair' });
    await resetCalls(page);
    await ask(page, 'Pressing nefunguje.');
    c = await calls(page);
    check('A8 neprošlá rada vyvolá jedno opravné kolo', c.map((x) => x.kind).join() === 'planner,advice,repair', c.map((x) => x.kind));
    check('A8 po opravě se rada zobrazí', (await page.locator('#result .sec').count()) === 10);
    const repairPrompt = await page.evaluate(() => window.__mock.prompts[2]);
    check('A8 opravné kolo dostane seznam výhrad', /nesplnila tato pravidla/.test(repairPrompt) && /confidence: high/.test(repairPrompt), repairPrompt.slice(-600));

    // změna bez „proč“ se zamítne a opraví
    await setMode(page, { mode: 'no-why' });
    await resetCalls(page);
    await ask(page, 'Pressing nefunguje.');
    c = await calls(page);
    check('A8 rada bez „proč“ u změny vyvolá opravné kolo', c.map((x) => x.kind).join() === 'planner,advice,repair', c.map((x) => x.kind));
    check('A8 oprava doplní „proč“ a rada se zobrazí', (await page.locator('#result .sec').count()) === 10 && (await page.locator('#result .change-item .why').count()) >= 1);
    const whyPrompt = await page.evaluate(() => window.__mock.prompts[2]);
    check('A8 opravné kolo říká, že chybí „why“', /chybí „why“/.test(whyPrompt), whyPrompt.slice(-500));

    await setMode(page, { mode: 'repair-fail' });
    await resetCalls(page);
    await ask(page, 'Pressing nefunguje.');
    check('A8 když ani oprava neprojde, žádná rada se neukáže', (await page.locator('#result .sec').count()) === 0 && /nedodal radu/.test(await text(page, '#result .banner')), await text(page, '#result'));
    check('A8 stránka vypíše důvody výhrad', (await page.locator('#result .banner li').count()) >= 1);
    const failText = await text(page, '#result .banner');
    check('A8 výhrady jsou česky (Jistota:), ne s názvem pole (confidence:)', /Jistota:/.test(failText) && !/confidence:/.test(failText), failText);
    await setMode(page, { mode: 'ok' });
    await page.getByRole('button', { name: 'Zkusit znovu' }).click();
    await waitIdle(page);
    check('A8 „Zkusit znovu“ po neúspěchu zkusí radu znovu', (await page.locator('#result .sec').count()) === 10);
    await setMode(page, { mode: 'repair-fail' });

    await setMode(page, { mode: 'invalid_json' });
    await resetCalls(page);
    await ask(page, 'Pressing nefunguje.');
    c = await calls(page);
    check('A8 odpověď mimo JSON vyvolá opravné kolo', c.map((x) => x.kind).join() === 'planner,advice,repair' && (await page.locator('#result .sec').count()) === 10, c.map((x) => x.kind));
    await setMode(page, { mode: 'ok' });

    // A9: chyby
    await setMode(page, { mode: 'not_granted' });
    await ask(page, 'Pressing nefunguje.');
    check('A9 nepovolený Claude: srozumitelná zpráva a bez zbytečného „Zkusit znovu“', /není povolený/.test(await text(page, '#result .banner.bad')) && !/Zkusit znovu/.test(await text(page, '#result .banner.bad')), await text(page, '#result'));
    await setMode(page, { mode: 'rate_limited' });
    await ask(page, 'Pressing nefunguje.');
    check('A9 vyčerpaný limit: srozumitelná zpráva', /limitu/.test(await text(page, '#result .banner.bad')), await text(page, '#result'));
    await setMode(page, { mode: 'upstream' });
    await ask(page, 'Pressing nefunguje.');
    check('A9 přechodná chyba služby nabídne „Zkusit znovu“', /Služba Claude/.test(await text(page, '#result .banner.bad')) && /Zkusit znovu/.test(await text(page, '#result .banner.bad')), await text(page, '#result'));
    await setMode(page, { mode: 'ok', plannerFails: true });
    await ask(page, 'Pressing nefunguje.');
    check('A9 selhání plánu hledání rada přežije a řekne to', (await page.locator('#result .sec').count()) === 10 && /Plán hledání se nepovedl/.test(await text(page, '#result .banner')), await text(page, '#result .banner'));
    await setMode(page, { plannerFails: false });

    // A10: zastavení
    await setMode(page, { mode: 'slow' });
    await page.fill('#question', 'Pomalá otázka.');
    await page.click('#askBtn');
    await page.waitForSelector('#stopBtn:not([hidden])');
    await page.click('#stopBtn');
    await waitIdle(page);
    check('A10 zastavení vrátí tlačítka do základu', (await page.isEnabled('#askBtn')) && !(await page.isVisible('#stopBtn')));
    check('A10 průběh ukazuje zastaveno', /zastaveno/.test(await text(page, '#steps')), await text(page, '#steps'));
    await setMode(page, { mode: 'ok' });

    // A11: doplnění
    await resetCalls(page);
    await ask(page, 'Útočník je bez podpory.');
    const followInputs = page.locator('#result .followup input');
    check('A11 rada nabídne doplnění k tomu, co neví', (await followInputs.count()) >= 1);
    await followInputs.first().fill('Hraju 4-2-3-1, záložníci jsou hluboko.');
    await page.getByRole('button', { name: 'Poradit znovu s doplněním' }).click();
    await waitIdle(page);
    const prompts = await page.evaluate(() => window.__mock.prompts);
    const last = prompts[prompts.length - 1];
    check('A11 doplnění se vrátí jako pozorování dop-1', /dop-1/.test(await text(page, '#obsList')) && /- dop-1 \| user_entered/.test(last), await text(page, '#obsList'));
    check('A11 nová rada zná předchozí radu', /Předchozí rada v tomto rozhovoru/.test(last));

    // A12: obrázek
    await page.setInputFiles('#imageInput', fx('screenshot.png'));
    check('A12 obrázek se ukáže v poznámce', /screenshot\.png/.test(await text(page, '#imageInfo')), await text(page, '#imageInfo'));
    await setMode(page, { mode: 'repair' });
    await resetCalls(page);
    await ask(page, 'Podívej se na screenshot.');
    c = await calls(page);
    const adv = c.find((x) => x.kind === 'advice');
    const rep = c.find((x) => x.kind === 'repair');
    check('A12 obrázek jde jen v prvním volání rady, ne v opravě', adv && adv.images === 1 && rep && rep.images === 0, c);
    const p2 = await page.evaluate(() => window.__mock.prompts.find((x) => /img-1/.test(x)));
    check('A12 obrázek je v pozorováních jako vision_unverified', /- img-1 \| vision_unverified/.test(p2 || ''), (p2 || '').slice(0, 300));
    await setMode(page, { mode: 'ok' });
    await page.setInputFiles('#imageInput', []);

    // A13: export a import
    await nav(page, 'zdroje');
    await page.click('#exportLib');
    await page.waitForFunction(() => window.__mock.saves.length >= 1, null, { timeout: 10000 }).catch(() => {});
    const saves = await page.evaluate(() => window.__mock.saves);
    let exported = null;
    try {
      exported = JSON.parse(saves[0].text);
    } catch (e) {
      /* ohlásí se níž */
    }
    check('A13 export uloží soubor fm27-knihovna.json s 3 knihami', saves.length === 1 && saves[0].filename === 'fm27-knihovna.json' && exported && exported.format === 'fm27-trener-library' && exported.books.length === 3 && exported.passages.length > 5, saves.map((s) => s.filename));
    for (let i = 0; i < 3; i++) {
      const del = page.locator('#bookList .danger').first();
      await del.click();
      await del.click();
      await page.waitForFunction((n) => document.querySelectorAll('#bookList .book').length === n, 2 - i);
    }
    check('A13 po smazání je knihovna prázdná', (await page.isVisible('#bookEmpty')) && /prázdná/.test(await text(page, '#pillLibrary')));
    await page.reload();
    await page.waitForFunction(() => window.__trenerReady === true);
    check('A13 smazání přežije obnovení', /prázdná/.test(await text(page, '#pillLibrary')), await text(page, '#pillLibrary'));
    await nav(page, 'zdroje');
    await page.setInputFiles('#importLib', { name: 'fm27-knihovna.json', mimeType: 'application/json', buffer: Buffer.from(saves[0].text) });
    await page.waitForFunction(() => document.querySelectorAll('#bookList .book').length === 3);
    await page.fill('#searchQ', 'izolovaný útočník');
    await page.click('#searchBtn');
    check('A13 import vrátí 3 knihy a hledání zase funguje', (await page.locator('#searchResults .hit').count()) > 0);
    await page.setInputFiles('#importLib', { name: 'spatny.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
    await page.waitForSelector('#toast:not([hidden])');
    check('A13 cizí JSON se při importu odmítne', /Import se nepovedl/.test(await text(page, '#toast')), await text(page, '#toast'));

    // A14: historie po obnovení
    await page.reload();
    await page.waitForFunction(() => window.__trenerReady === true);
    await nav(page, 'trener');
    check('A14 historie přežije obnovení', (await page.locator('#historyList li').count()) >= 1);
    await page.locator('#historyList button').first().click();
    check('A14 uložená rada se dá otevřít', (await page.locator('#result .sec').count()) === 10 && /Uložená rada/.test(await text(page, '#result .banner')));
    const histRef = page.locator('#result button.ref').first();
    if (await histRef.count()) {
      await histRef.click();
      check('A14 odkaz v uložené radě otevře úryvek', await page.isVisible('#drawer'));
      await page.click('#drawerClose');
    }

    // A15: Info a zkoušky
    await nav(page, 'nastaveni');
    await page.click('#testClaude');
    await page.waitForFunction(() => /Spojení s Claude funguje/.test(document.querySelector('#testOut').textContent));
    check('A15 zkouška spojení s Claude', true);
    await page.click('#testSearch');
    check('A15 zkouška hledání', /Hledání funguje/.test(await text(page, '#testOut')), await text(page, '#testOut'));

    // A16: téma přepnuté ručně přebije systém
    // Barvy se neopisují ze stylů (při změně palety by zkouška zbytečně spadla): tělo stránky musí mít barvu pozadí vybraného tématu
    // (--bg) a světlé téma musí být skutečně světlejší než tmavé, takže ruční volba přebila systém v obou směrech.
    const bgOf = (theme) =>
      page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        const probe = document.createElement('div');
        probe.style.background = 'var(--bg)';
        document.body.append(probe);
        const token = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const body = getComputedStyle(document.body).backgroundColor;
        const [r, g, b] = body.match(/\d+/g).slice(0, 3).map(Number);
        return { body, token, lightness: 0.2126 * r + 0.7152 * g + 0.0722 * b };
      }, theme);
    const bgLight = await bgOf('light');
    const bgDark = await bgOf('dark');
    check('A16 ruční volba tématu přebije systém v obou směrech', bgLight.body === bgLight.token && bgDark.body === bgDark.token && bgLight.lightness > bgDark.lightness + 100, { bgLight, bgDark });
    await page.evaluate(() => delete document.documentElement.dataset.theme);

    // A17: rada, která běží, přežije odchod z obrazovky (nález revize: po návratu se „Poradit“ znovu zapnulo a Stop rušil jen druhé volání)
    await nav(page, 'trener');
    await setMode(page, { mode: 'ok' });
    await page.evaluate(() => (window.__mock.adviceDelayMs = 1800));
    await page.fill('#question', 'Co když odejdu během rady?');
    await page.click('#askBtn');
    await page.waitForSelector('#stopBtn:not([hidden])');
    await nav(page, 'nastaveni');
    await nav(page, 'trener');
    check('A17 po návratu na obrazovku je „Poradit“ vypnuté a „Zastavit“ vidět, dokud rada běží', (await page.isDisabled('#askBtn')) && (await page.isVisible('#stopBtn')), { ask: await page.isDisabled('#askBtn'), stop: await page.isVisible('#stopBtn') });
    await page.waitForSelector('#result .sec', { timeout: 20000 });
    await waitIdle(page);
    check('A17 hotová rada se vykreslí na vrácené obrazovce a tlačítka se vrátí do základu', (await page.locator('#result .sec').count()) === 10 && (await page.isEnabled('#askBtn')) && !(await page.isVisible('#stopBtn')));
    const adviceBefore = await page.evaluate(() => window.FM27.app.store.list('advice').length);
    await page.fill('#question', 'Odejdu a nevrátím se.');
    await page.click('#askBtn');
    await page.waitForSelector('#stopBtn:not([hidden])');
    await nav(page, 'nastaveni');
    await page.waitForFunction(() => /uložená v historii rad/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
    check('A17 rada dokončená, když uživatel odešel, se uloží do historie rad a nic nespadne', (await page.evaluate(() => window.FM27.app.store.list('advice').length)) === adviceBefore + 1, await text(page, '#toast'));
    await page.evaluate(() => (window.__mock.adviceDelayMs = 0));

    // A18: tlačítka se uvolní až po uložení a vykreslení rady (dřív po uložení: za pomalého ukládání četla zkouška stránku dřív, než se rada vykreslila)
    await nav(page, 'trener');
    await page.evaluate(() => {
      const save = window.FM27.advice.save;
      window.__origSave = save;
      window.__saveFinished = false;
      window.FM27.advice.save = async function (...args) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const saved = await save.apply(this, args);
        window.__saveFinished = true;
        return saved;
      };
    });
    await page.fill('#question', 'Zkouška: pomalé uložení rady.');
    await page.click('#askBtn');
    await page.waitForSelector('#stopBtn:not([hidden])');
    const firstIdle = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      const timer = setInterval(() => {
        const idle = !document.querySelector('#askBtn').disabled && document.querySelector('#stopBtn').hidden;
        if (idle || performance.now() - t0 > 15000) {
          clearInterval(timer);
          resolve({ idle, saveFinished: window.__saveFinished, sections: document.querySelectorAll('#result .sec').length });
        }
      }, 5);
    }));
    await page.evaluate(() => {
      window.FM27.advice.save = window.__origSave;
      delete window.__origSave;
      delete window.__saveFinished;
    });
    check('A18 tlačítka se uvolní až po uložení a vykreslení rady: v prvním okamžiku, kdy je stránka volná, je uložení hotové a rada má 10 částí', firstIdle.idle && firstIdle.saveFinished === true && firstIdle.sections === 10, firstIdle);

    // A19: odchod z obrazovky až během ukládání rady (dřív se vykreslovalo do neexistující obrazovky: TypeError a žádné hlášení, ač se rada uložila)
    await nav(page, 'trener');
    const adviceBefore19 = await page.evaluate(() => window.FM27.app.store.list('advice').length);
    const pageErrorsBefore19 = problems.page.length;
    await page.evaluate(() => {
      const save = window.FM27.advice.save;
      window.__origSave = save;
      window.__saveStarted = false;
      window.__saveDone = false;
      document.querySelector('#toast').textContent = ''; // text hlášení po zmizení zůstává; starý z A17 by tu zkoušku předčasně pustil dál
      window.FM27.advice.save = async function (...args) {
        window.__saveStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 900));
        const saved = await save.apply(this, args);
        window.__saveDone = true;
        return saved;
      };
    });
    await page.fill('#question', 'Zkouška: odejdu během ukládání.');
    await page.click('#askBtn');
    await page.waitForFunction(() => window.__saveStarted === true, null, { timeout: 15000 });
    await nav(page, 'nastaveni');
    await page.waitForFunction(() => window.__saveDone === true, null, { timeout: 20000 });
    await page.waitForFunction(() => /uložená v historii rad/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.FM27.advice.save = window.__origSave;
      delete window.__origSave;
      delete window.__saveStarted;
      delete window.__saveDone;
    });
    const adviceAfter19 = await page.evaluate(() => window.FM27.app.store.list('advice').length);
    check('A19 odchod z obrazovky během ukládání rady: rada se uloží do historie, stránka to oznámí a nic nespadne', adviceAfter19 === adviceBefore19 + 1 && problems.page.length === pageErrorsBefore19, { before: adviceBefore19, after: adviceAfter19, toast: await text(page, '#toast'), errors: problems.page.slice(pageErrorsBefore19) });

    check('A99 žádná chyba ve skriptu za celou dobu', problems.page.length === 0, problems.page);
    const consoleErrors = problems.console.filter((m) => !/Failed to load resource/.test(m));
    check('A99 žádná chyba v konzoli za celou dobu', consoleErrors.length === 0, consoleErrors);
    const unexpected = problems.failed.filter((u) => !/fonts\.gstatic\.com/.test(u));
    check('A99 stránka nesahala na nic mimo povolené adresy', unexpected.length === 0, unexpected);

    // ---------- B) rozložení a snímky
    await nav(page, 'trener');
    await setMode(page, { mode: 'ok' });
    await resetCalls(page);
    await ask(page, 'Útočník je od 25. minuty bez podpory a soupeř nás přehrává ve středu hřiště.');
    const shots = [
      ['desktop-dark-coach', { width: 1280, height: 900 }, 'dark', 'trener'],
      ['phone-dark-coach', { width: 390, height: 844 }, 'dark', 'trener'],
      ['phone-light-coach', { width: 390, height: 844 }, 'light', 'trener'],
      ['desktop-light-library', { width: 1280, height: 900 }, 'light', 'zdroje'],
      ['phone-dark-library', { width: 390, height: 844 }, 'dark', 'zdroje'],
      ['phone-light-info', { width: 390, height: 844 }, 'light', 'nastaveni'],
    ];
    for (const [name, viewport, scheme, tab] of shots) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await nav(page, tab);
      await page.waitForTimeout(150);
      const o = await overflow(page);
      check(`B ${name}: bez vodorovného posouvání`, o.sw <= o.cw, o);
      await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await nav(page, 'zdroje');
    await page.fill('#searchQ', 'izolovaný útočník');
    await page.click('#searchBtn');
    await page.locator('#searchResults .hit button').first().click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'phone-light-drawer.png') });
    const o2 = await overflow(page);
    check('B phone-light-drawer: bez vodorovného posouvání', o2.sw <= o2.cw, o2);
    await context.close();

    // ---------- C) bez Claude
    const second = await newContext(browser, { noClaude: true });
    await open(second.page, 'trener');
    check('C stránka bez Claude: stav nedostupné', /nedostupné/.test(await text(second.page, '#pillClaude')), await text(second.page, '#pillClaude'));
    check('C stránka bez Claude: Poradit je zakázané a vysvětlené', !(await second.page.isEnabled('#askBtn')) && /nemá přístup ke Claude/.test(await text(second.page, '#askHint')), await text(second.page, '#askHint'));
    check('C stránka bez Claude: pole pro obrázky skryté', !(await second.page.isVisible('#imageField')));
    await addBooks(second.page, [fx('taktika-cs.txt')]);
    await second.page.fill('#searchQ', 'izolovaný útočník');
    await second.page.click('#searchBtn');
    check('C knihovna a hledání fungují i bez Claude', (await second.page.locator('#searchResults .hit').count()) > 0);
    check('C bez Claude žádná chyba ve skriptu', second.problems.page.length === 0, second.problems.page);
    await second.context.close();

    // ---------- D) delší kniha se záhlavím a čísly stran
    const third = await newContext(browser);
    await open(third.page);
    const dStatus = await addBooks(third.page, [fx('kniha-s-zahlavim.pdf')]);
    check('D delší PDF se přidá', /Přidáno: 1/.test(dStatus), dStatus);
    check('D počet listů a úryvků je v seznamu knih', /24 listů/.test(await text(third.page, '#bookList')) && /\d+ úryvků/.test(await text(third.page, '#bookList')), await text(third.page, '#bookList'));
    await third.page.fill('#searchQ', 'ZKUŠEBNÍ PŘÍRUČKA ZÁHLAVÍ STRANY');
    await third.page.click('#searchBtn');
    check('D záhlaví stran se do úryvků nedostalo', !/ZÁHLAVÍ STRANY/.test(await text(third.page, '#searchResults')), await text(third.page, '#searchResults'));
    await third.page.fill('#searchQ', 'útočník nabíhá do prostoru');
    await third.page.click('#searchBtn');
    const dHits = await third.page.locator('#searchResults .hit').allInnerTexts();
    check('D v těle knihy se hledá dál', dHits.length > 0 && dHits.every((t) => !/^\s*\d+\s*$/m.test(t.replace(/^.*\n/, ''))), dHits.slice(0, 1));
    check('D bez chyb ve skriptu', third.problems.page.length === 0, third.problems.page);
    await third.context.close();
  }
};
