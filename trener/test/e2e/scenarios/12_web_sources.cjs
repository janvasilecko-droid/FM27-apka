/* Scénář 12: ZDROJE Z WEBU. Aplikace sama hledá zdroje a ukazuje je s odkazem, druhem, verzí hry a datem.
   Zkouší se celá cesta stránka → web.js → konektor Parallel Search (zkušební náhražka schopnosti `mcp`) → čtení výsledků →
   karty, uložení do mých zdrojů, rada a lekce se zdroji z webu, chyby konektoru. Potom samostatná verze: hledání přes klíč
   Anthropic (falešné HTTP API s nástrojem web_search).
   NEZKOUŠÍ se skutečný konektor ani skutečné API: výsledky jsou vymyšlené a tvar odpovědi Parallel Search je odhad.
   Zkouší se hlavně poctivost: nic z webu není ověřené, starší verze hry není FM27, nebezpečné odkazy se zahodí a text z webu
   nikdy nevytvoří pozorování ani nespustí kód. */
module.exports = async function run(env) {
  const { browser, check, fx, h } = env;
  const { newContext, open, nav, ask, text, addBooks } = h;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };

  // ====================================================== A) stránka v Claude s konektorem
  const c = await newContext(browser, { mcp: true });
  const page = c.page;
  const mcpCalls = () => page.evaluate(() => window.__mcp.calls);
  const mcpSet = (patch) => page.evaluate((p) => Object.assign(window.__mcp, p), patch);
  const resultCount = () => page.locator('#webResultList .web-source').count();
  const find = async (topic) => {
    await page.fill('#webTopic', topic);
    await page.click('#webFind');
    await page.waitForFunction(() => !document.querySelector('#webFind').disabled, null, { timeout: 15000 });
  };

  await open(page, 'zdroje');
  check('12 karta „Zdroje z webu“ je na obrazovce Zdroje znalostí první', (await page.evaluate(() => document.querySelector('#main section.card').id)) === 'webSearchCard', await page.evaluate(() => document.querySelector('#main section.card').id));
  check('12 stránka s konektorem zvolí cestu „connector“', (await page.evaluate(() => window.FM27.web.route)) === 'connector' && (await page.evaluate(() => window.FM27.web.available)) === true);
  await page.waitForSelector('#webSrcOk', { timeout: 5000 });
  check('12 před prvním hledáním poctivě říká, že spojení zatím nepotvrdil', /zatím nepotvrdil/.test(await text(page, '#webSrcOk')), await text(page, '#webSrcOk'));
  check('12 aplikace do konektoru zatím nic neposlala (hledá se jen na pokyn)', (await mcpCalls()).length === 0);

  await page.click('#webStarter');
  await page.waitForSelector('#webResultList .web-source', { timeout: 10000 });
  let calls = await mcpCalls();
  check('12 jedno volání konektoru: server „Parallel Search“, nástroj web_search, se zrušitelným signálem a pamětí', calls.length === 1 && calls[0].server === 'Parallel Search' && calls[0].tool === 'web_search' && calls[0].signal === true && calls[0].cacheOpt === true, calls);
  check('12 vstup má cíl (objective) a 4 dotazy o FM27 (search_queries)', typeof calls[0].input.objective === 'string' && calls[0].input.objective.length > 40 && Array.isArray(calls[0].input.search_queries) && calls[0].input.search_queries.length === 4 && calls[0].input.search_queries.every((q) => /^Football Manager 27/.test(q)), calls[0].input);
  check('12 cíl hledání říká, že starší verze hry se nesmí vydávat za FM27', /older Football Manager versions/.test(calls[0].input.objective), calls[0].input.objective);

  check('12 nebezpečný (javascript:) a nezabezpečený (http:) odkaz se zahodí: zbývá pět zdrojů', (await resultCount()) === 5, await resultCount());
  const titles = await page.locator('#webResultList .web-source .meta b').allInnerTexts();
  check('12 pořadí: oficiální FM27, rozbor taktiky, komunitní FM27, starší FM26, neznámý web', /FM27: Tactical Tweaks/.test(titles[0]) && /Gegenpressing/.test(titles[1]) && /FM27 pressing guide/.test(titles[2]) && /FM26: Old tactics/.test(titles[3]) && /Neznámý blog/.test(titles[4]), titles);
  check('12 značky z názvu se odstraní (název se ukáže jako text)', !titles.some((t) => /<|>/.test(t)) && /Neznámý blog \(zkušební/.test(titles[4]), titles[4]);
  const card0 = await page.locator('#webResultList .web-source').nth(0).innerText();
  const card3 = await page.locator('#webResultList .web-source').nth(3).innerText();
  const card4 = await page.locator('#webResultList .web-source').nth(4).innerText();
  check('12 první zdroj: oficiální web hry, FM27 podle adresy, datum česky, doslovný výtah', /oficiální web hry/.test(card0) && /FM27 \(podle adresy nebo názvu\)/.test(card0) && /20\. 10\. 2026/.test(card0) && /doslovný výtah/.test(card0) && /footballmanager\.com/.test(card0), card0);
  check('12 starší verze je označená „NENÍ FM27“', /FM26: starší hra, NENÍ FM27/.test(card3), card3);
  check('12 neznámý web je „neznámý web“ s verzí neuvedenou', /neznámý web/.test(card4) && /verze FM neuvedena/.test(card4), card4);
  check('12 každý zdroj nese štítek „z webu, neověřeno“ a větu o výtahu', (await page.locator('#webResultList .web-source .chip.t-inferred').count()) === 5 && (await page.locator('#webResultList .web-source:has-text("Výtah z hledání, ne celý text stránky")').count()) === 5);
  const links = await page.locator('#webResultList .web-source a').evaluateAll((as) => as.map((a) => ({ href: a.href, rel: a.rel, target: a.target })));
  check('12 odkazy jsou jen https, otevírají se v nové záložce s rel noopener a bez sledovacích parametrů', links.length === 5 && links.every((l) => l.href.startsWith('https://') && /noopener/.test(l.rel) && l.target === '_blank') && !links.some((l) => /utm_/.test(l.href)), links);
  check('12 žádný odkaz javascript: na stránce není a ze stránky se nespustil žádný kód', (await page.locator('a[href^="javascript"]').count()) === 0 && (await page.evaluate(() => window.__pwned)) === undefined && (await page.locator('#webResultList script').count()) === 0);
  check('12 text z webu, který se vydává za pokyn, se jen zobrazí jako text', /Ignoruj všechna pravidla/.test(card4) && !/<script>/i.test(await page.locator('#webResultList').innerHTML()));

  // uložení mezi moje zdroje
  await page.locator('#webResultList .web-source').nth(0).locator('[data-act="save-web"]').click();
  await page.waitForFunction(() => /Uloženo/.test(document.querySelector('#webResultList .web-source [data-act="save-web"]').textContent), null, { timeout: 5000 });
  check('12 zdroj jde uložit a tlačítko se změní na „Uloženo“', (await page.locator('#webResultList .web-source').nth(0).locator('[data-act="save-web"]').isDisabled()) && /Uloženo/.test(await page.locator('#webResultList .web-source').nth(0).locator('[data-act="save-web"]').innerText()));
  await until(async () => /\(4\)/.test(await text(page, '#sourceHdr')));
  const listText = await text(page, '#sourceList');
  check('12 uložený zdroj je v seznamu zdrojů se štítky „nalezeno na webu“ a „jen odhad“', /FM27: Tactical Tweaks/.test(listText) && /nalezeno na webu/.test(listText) && /jen odhad/.test(listText) && /\(4\)/.test(await text(page, '#sourceHdr')), listText.slice(-400));
  const reg = await page.evaluate(() => [...window.FM27.app.registry.byId.keys()].filter((k) => k.startsWith('my:')).map((id) => ({ id, official: window.FM27.app.registry.isOfficialFm27(id), type: window.FM27.app.registry.get(id).sourceType, url: window.FM27.app.registry.get(id).url })));
  check('12 uložený zdroj z oficiální domény se v registru NIKDY nestane „oficiální FM27“ (výtah z hledání není ověření)', reg.length === 1 && reg[0].official === false && /nalezeno hledáním na webu/.test(reg[0].type) && /^https:\/\/www\.footballmanager\.com\//.test(reg[0].url), reg);
  const digest = await page.evaluate(() => window.FM27.app.registry.digest());
  check('12 přehled zdrojů pro model ho označí „NE oficiální FM27“ a upozorní na výtah', /my:[^\]]*\[NE oficiální FM27/.test(digest) && /výtah z hledání/.test(digest), digest.slice(-500));

  // po návratu na obrazovku jsou výsledky vidět dál; opakované hledání jde z paměti
  await nav(page, 'nastaveni');
  await nav(page, 'zdroje');
  check('12 po přepnutí sekce zůstanou nalezené zdroje na obrazovce (a uložený je označený „Uloženo“)', (await resultCount()) === 5 && (await page.locator('#webResultList .web-source').nth(0).locator('[data-act="save-web"]').isDisabled()));
  await page.click('#webStarter');
  await page.waitForFunction(() => /z paměti/.test(document.querySelector('#webResultsHdr') ? document.querySelector('#webResultsHdr').textContent : ''), null, { timeout: 5000 }).catch(() => {});
  check('12 stejné hledání podruhé jde z paměti a konektor se nevolá znovu', /z paměti/.test(await text(page, '#webResultsHdr')) && (await mcpCalls()).length === 1, { hdr: await text(page, '#webResultsHdr'), n: (await mcpCalls()).length });

  // hledání podle tématu
  await find('gegenpressing');
  calls = await mcpCalls();
  check('12 hledání podle tématu: dotazy „Football Manager 27 …“, „… football tactics“ a samotné téma', calls.length === 2 && JSON.stringify(calls[1].input.search_queries) === JSON.stringify(['Football Manager 27 gegenpressing', 'gegenpressing football tactics', 'gegenpressing']), calls[1] && calls[1].input.search_queries);
  await page.click('.web-topic >> nth=0');
  await page.waitForFunction(() => !document.querySelector('#webFind').disabled, null, { timeout: 15000 });
  calls = await mcpCalls();
  check('12 návrh tématu (Presink) spustí hledání s anglickým výrazem', calls.length === 3 && calls[2].input.search_queries[0] === 'Football Manager 27 pressing triggers' && (await page.inputValue('#webTopic')) === 'pressing triggers', calls[2] && calls[2].input.search_queries);

  // ---------- jiný tvar odpovědi (text místo JSON)
  await mcpSet({ mode: 'text' });
  await find('text answer');
  check('12 odpověď konektoru jako prostý text (Title/URL/Excerpts) se přečte také', (await resultCount()) === 5, await resultCount());

  // ---------- chyby konektoru
  await mcpSet({ mode: 'not_connected' });
  await find('connector missing');
  check('12 nepřipojený konektor: hláška říká, co udělat, s přesným odkazem na Konektory v claude.ai', /Konektor Parallel Search není u tebe připojený/.test(await text(page, '#webMsg')) && (await page.locator('#webMsg a[href="https://claude.ai/settings/connectors"]').count()) === 1, await text(page, '#webMsg'));
  await nav(page, 'nastaveni');
  await nav(page, 'zdroje');
  await page.waitForSelector('#webSrcOff', { timeout: 5000 });
  const off = await text(page, '#webSrcOff');
  check('12 karta při načtení ukáže postup: otevřít Konektory, připojit „Parallel Search“, obnovit stránku', /nejede/.test(off) && /Parallel Search/.test(off) && (await page.locator('#webSrcOff a[href="https://claude.ai/settings/connectors"]').count()) === 1 && (await page.locator('#webSrcOff ol li').count()) === 3, off);
  await mcpSet({ mode: 'reauth' });
  await find('needs reauth');
  check('12 vypršené přihlášení konektoru: hláška o novém přihlášení s odkazem', /přihlásit znovu/.test(await text(page, '#webMsg')) && (await page.locator('#webMsg a').count()) === 1, await text(page, '#webMsg'));
  await mcpSet({ mode: 'tool_error' });
  await find('tool error');
  check('12 chyba nástroje: ukáže se její text, ne obecné „něco se nepovedlo“', /Vyhledávač vrátil chybu: zkušební chyba nástroje/.test(await text(page, '#webMsg')), await text(page, '#webMsg'));
  check('12 po chybě se na obrazovce nezůstanou zastaralé výsledky', (await resultCount()) === 0);
  await mcpSet({ mode: 'unparsed' });
  await find('unparsed answer');
  check('12 odpověď bez odkazů: poctivě řekne, že jí aplikace nerozumí, a ukáže, co přišlo (k opravě čtení)', /neumí přečíst odkazy/.test(await text(page, '#webResults')) && /Zkušební odpověď bez jakýchkoli odkazů/.test(await page.locator('#webRaw').textContent()), await text(page, '#webResults'));
  await mcpSet({ mode: 'empty' });
  await find('empty answer');
  check('12 prázdný výsledek: „Nic nenalezeno“', /Nic nenalezeno/.test(await text(page, '#webResults')), await text(page, '#webResults'));
  const before = (await mcpCalls()).length;
  await mcpSet({ mode: 'unavailable_once', unavailableSent: false });
  await find('transient failure');
  const after = (await mcpCalls()).length;
  check('12 přechodná chyba (server_unavailable) se zopakuje jednou sama a hledání projde', after - before === 2 && (await resultCount()) === 5, { n: after - before, results: await resultCount() });
  await mcpSet({ mode: 'ok', schema: 'other' });
  const n0 = (await mcpCalls()).length;
  await find('different schema');
  check('12 konektor s neznámými parametry: nic se nepošle a hláška to řekne', /jiné parametry/.test(await text(page, '#webMsg')) && (await mcpCalls()).length === n0, await text(page, '#webMsg'));
  await mcpSet({ mode: 'slow', schema: 'parallel' });
  await page.fill('#webTopic', 'slow search');
  await page.click('#webFind');
  await page.waitForSelector('#webStop:not([hidden])', { timeout: 3000 });
  await page.click('#webStop');
  await page.waitForFunction(() => !document.querySelector('#webFind').disabled, null, { timeout: 5000 });
  check('12 Zastavit přeruší hledání a řekne to', /Zastaveno/.test(await text(page, '#webMsg')), await text(page, '#webMsg'));
  await mcpSet({ mode: 'ok' });

  // ====================================================== B) rada se zdroji z webu
  await addBooks(page, [fx('taktika-cs.txt')]);
  await nav(page, 'trener');
  check('12 u konektoru je „Hledat i na webu“ ve výchozím stavu zapnuté a nabídnuté', (await page.isChecked('#webMode')) && !(await page.isDisabled('#webMode')) && /Parallel Search/.test(await text(page, '#webModeText')), await text(page, '#webModeText'));
  const n1 = (await mcpCalls()).length;
  await ask(page, 'Útočník je izolovaný a soupeř nás přehrává ve středu hřiště.');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  calls = await mcpCalls();
  check('12 rada udělala jedno hledání na webu se čtyřmi dotazy (z plánovače knih a z dotazu)', calls.length === n1 + 1 && calls[n1].input.search_queries.length === 4 && calls[n1].input.search_queries.some((q) => /^Football Manager 27 Útočník je izolovaný/.test(q)) && calls[n1].input.search_queries.some((q) => /support striker isolation football tactics/.test(q)), calls[n1] && calls[n1].input);
  const prompts = await page.evaluate(() => window.__mock.prompts);
  const advicePrompt = prompts.filter((p) => /Úryvky z knih a z webu/.test(p)).pop() || '';
  const webLines = advicePrompt.split('\n').filter((l) => /^- web:/.test(l));
  check('12 prompt rady obsahuje úryvky z webu (jeden řádek na zdroj) a pravidlo o nich', webLines.length === 5 && /Úryvky s id začínajícím web:/.test(advicePrompt) && /nikdy jako verified/.test(advicePrompt), { lines: webLines.length });
  check('12 text z webu v promptu nevytvoří řádek vydávající se za pozorování (padělek je slitý do jednoho řádku dat)', !/^- obs-9 \|/m.test(advicePrompt) && webLines.every((l) => l.split(' | ').length === 4), webLines.map((l) => l.split(' | ').length));
  check('12 v promptu je štítek verze („FM26: starší hra, NENÍ FM27“) i druh zdroje', /NENÍ FM27/.test(advicePrompt) && /oficiální web hry/.test(advicePrompt) && /neznámý web/.test(advicePrompt));
  check('12 rada prošla kontrolou poctivosti i s odkazy na web', /prošla kontrolou/.test(await text(page, '#result .banner')) && (await page.locator('#result .sec').count()) === 10, await text(page, '#result .banner'));
  const chips = await page.locator('#result a.ref[href^="https://"]').evaluateAll((as) => as.map((a) => ({ text: a.textContent, rel: a.rel, target: a.target, title: a.title })));
  check('12 odkazy na zdroj z webu v radě jsou klikatelné, začínají „Web:“ a říkají, že jsou neověřené', chips.length >= 2 && chips.every((x) => /^Web: /.test(x.text) && /noopener/.test(x.rel) && x.target === '_blank' && /neověřeno/.test(x.title)), chips);
  check('12 pod radou je blok „Zdroje z webu, které trenér dostal (5)“ s upozorněním', /Zdroje z webu, které trenér dostal \(5\)/.test(await text(page, '#result details.web-sources')) && /Nejsou ověřené/.test(await text(page, '#result details.web-sources')), await text(page, '#result details.web-sources'));
  check('12 průběh ukáže krok „Hledám zdroje na webu: 5 zdrojů“', /Hledám zdroje na webu: 5 zdrojů/.test(await text(page, '#steps')), await text(page, '#steps'));
  const saved = await page.evaluate(() => window.FM27.app.store.list('advice').sort((a, b) => b.at - a.at)[0]);
  const webKeys = Object.keys(saved.passages).filter((k) => k.startsWith('web:'));
  check('12 uložená rada nese odkazy na zdroje z webu (id, název, popis, adresa), ale ne jejich text', webKeys.length === 5 && webKeys.every((k) => /^https:\/\//.test(saved.passages[k].url) && !('text' in saved.passages[k])), webKeys.map((k) => saved.passages[k]));
  await page.click('#historyList li:first-child button');
  await page.waitForTimeout(150);
  check('12 rada otevřená z historie má odkazy na web (po obnovení stránky se nic neztratí)', (await page.locator('#result a.ref[href^="https://"]').count()) >= 2 && (await page.locator('#result details.web-sources a').count()) === 5);

  // vypnuté hledání na webu
  await page.uncheck('#webMode');
  const n2 = (await mcpCalls()).length;
  await resetPrompts(page);
  await ask(page, 'Co když soupeř hraje s pěti obránci?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const prompts2 = await page.evaluate(() => window.__mock.prompts);
  check('12 s vypnutým „Hledat i na webu“ se konektor nevolá a prompt zdroje z webu neobsahuje', (await mcpCalls()).length === n2 && !prompts2.some((p) => /^- web:/m.test(p)) && !/Hledám zdroje na webu/.test(await text(page, '#steps')), { calls: (await mcpCalls()).length - n2 });
  await page.check('#webMode');

  // selhání hledání radu nezastaví
  await mcpSet({ mode: 'not_connected' });
  await ask(page, 'A co když soupeř tlačí do křídel?');
  await page.waitForSelector('#result .sec', { timeout: 20000 });
  const banner = await text(page, '#result .banner');
  check('12 když hledání na webu selže, rada přesto vznikne jen z knih a řekne to', (await page.locator('#result .sec').count()) === 10 && /Hledání na webu se nepovedlo/.test(banner) && /jen z knih/.test(banner), banner);
  check('12 krok „web“ se označí jako neúspěšný', (await page.locator('#steps li[data-step="web"].fail').count()) === 1, await text(page, '#steps'));
  await mcpSet({ mode: 'ok' });

  // ====================================================== C) nastavení
  await nav(page, 'nastaveni');
  check('12 nastavení má kartu „Hledání zdrojů na webu“ a řádek ve stavu', (await page.locator('#webCard').count()) === 1 && /konektor Parallel Search/.test(await text(page, '#diag')), await text(page, '#diag'));
  await page.click('#webTest');
  await page.waitForFunction(() => /Funguje|nic nenašel|neumí|chyb|není/.test(document.querySelector('#webTestOut').textContent), null, { timeout: 10000 });
  check('12 zkušební hledání ukáže skutečný výsledek: nalezeno 3 zdroje a jejich karty', /Funguje: nalezeno 3 zdroje/.test(await text(page, '#webTestOut')) && (await page.locator('#webTestResults .web-source').count()) === 3, await text(page, '#webTestOut'));
  await page.selectOption('#setWebMode', 'off');
  await page.waitForTimeout(500);
  check('12 nastavení „Vypnuto“ se uloží', (await page.evaluate(() => window.FM27.app.settings().web.mode)) === 'off');
  await page.evaluate(() => {
    location.hash = '#trener';
  });
  await page.reload();
  await page.waitForFunction(() => window.__trenerReady === true, null, { timeout: 20000 });
  await page.waitForSelector('#webMode');
  check('12 po vypnutí v nastavení je „Hledat i na webu“ po načtení nezaškrtnuté, ale jde zapnout ručně', !(await page.isChecked('#webMode')) && !(await page.isDisabled('#webMode')));
  check('12 během celého scénáře nevznikla chyba v konzoli ani výjimka stránky', c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0 && c.problems.page.length === 0, { console: c.problems.console, page: c.problems.page });
  await c.context.close();

  // ====================================================== D) lekce se zdroji z webu (bez knih)
  const d = await newContext(browser, { mcp: true });
  const dp = d.page;
  await open(dp, 'skola');
  check('12 lekce: „Najít zdroje i na webu“ je ve výchozím stavu zapnuté (konektor je zdarma)', (await dp.isChecked('#lessonWeb')) && !(await dp.isDisabled('#lessonWeb')), await text(dp, '#lessonWebText'));
  await dp.click('#lessonGen');
  await dp.waitForSelector('#lessonView', { timeout: 20000 });
  const dCalls = await dp.evaluate(() => window.__mcp.calls);
  check('12 lekce nejdřív hledá na webu: dotazy z osnovy, jedna o FM27, cíl s názvem lekce', dCalls.length === 1 && /Rozestavení/.test(dCalls[0].input.objective) && dCalls[0].input.search_queries.some((q) => /football tactics explained/.test(q)) && dCalls[0].input.search_queries.some((q) => /^Football Manager 27 /.test(q)), dCalls[0] && dCalls[0].input);
  const lessonPrompt = (await dp.evaluate(() => window.__mock.prompts)).filter((p) => /Jsi učitel taktiky/.test(p)).pop() || '';
  check('12 prompt lekce obsahuje úryvky z webu a pravidlo, že jsou neověřené', (lessonPrompt.match(/^- web:/gm) || []).length === 5 && /Úryvky s id začínajícím web:/.test(lessonPrompt) && /id začínají bk: u knih nebo web: u webu/.test(lessonPrompt), (lessonPrompt.match(/^- web:/gm) || []).length);
  const lessonBox = await text(dp, '#lessonBox');
  check('12 lekce bez knih, ale se zdroji z webu, to říká: vychází jen z webu a je to odhad', /jen ze zdrojů z webu/.test(lessonBox) && !/nevychází z tvých knih ani ze zdrojů z webu/.test(lessonBox), lessonBox.slice(0, 200));
  check('12 lekce ukáže „Zdroje této lekce z webu (5)“ s odkazy a označí ten, který použila', /Zdroje této lekce z webu \(5\)/.test(await text(dp, '#lessonView details.web-sources')) && (await dp.locator('#lessonView details.web-sources a').count()) === 5 && /použito v textu/.test(await text(dp, '#lessonView details.web-sources')), await text(dp, '#lessonView details.web-sources'));
  check('12 princip lekce odkazuje na zdroj z webu klikatelným odkazem', (await dp.locator('#lessonView a.ref[href^="https://"]').count()) >= 1, await dp.locator('#lessonView a.ref').count());
  const lessonDoc = await dp.evaluate(() => JSON.parse(localStorage.getItem('fm27.lessons')).A1);
  check('12 uložená lekce nese odkazy na zdroje z webu, ale ne jejich text', lessonDoc.fromWeb === true && Object.values(lessonDoc.passages).filter((p) => /^web:/.test(p.id)).length === 5 && Object.values(lessonDoc.passages).every((p) => !('text' in p)), lessonDoc.passages);
  await d.context.close();

  // ====================================================== E) starší publikace bez konektorů
  const e = await newContext(browser, {});
  const ep = e.page;
  await open(ep, 'zdroje');
  await ep.waitForSelector('#webSrcOff', { timeout: 5000 });
  check('12 bez schopnosti konektorů stránka poctivě řekne, proč hledání nejede', (await ep.evaluate(() => window.FM27.web.route)) === 'none' && /nemá povolený přístup ke konektorům/.test(await text(ep, '#webSrcOff')), await text(ep, '#webSrcOff'));
  await ep.fill('#webTopic', 'cokoli');
  await ep.click('#webFind');
  check('12 tlačítko Najít bez konektorů nic nehledá a vysvětlí to', /Hledání na webu není dostupné/.test(await text(ep, '#webMsg')), await text(ep, '#webMsg'));
  await nav(ep, 'trener');
  check('12 „Hledat i na webu“ je bez konektorů vypnuté, nezaškrtnuté a s důvodem', (await ep.isDisabled('#webMode')) && !(await ep.isChecked('#webMode')) && /není dostupné/.test(await text(ep, '#webModeText')), await text(ep, '#webModeText'));
  await ask(ep, 'Útočník je izolovaný.');
  await ep.waitForSelector('#result .sec', { timeout: 20000 });
  check('12 rada bez webu funguje jako dřív (žádné zdroje z webu, žádný blok)', (await ep.locator('#result details.web-sources').count()) === 0 && !(await ep.evaluate(() => window.__mock.prompts)).some((p) => /^- web:/m.test(p)));
  await nav(ep, 'skola');
  check('12 škola bez konektorů: volba webu je vypnutá a lekce se složí jen z knih', (await ep.isDisabled('#lessonWeb')) && !(await ep.isChecked('#lessonWeb')));
  await e.context.close();

  // ====================================================== F) samostatná verze: web search přes klíč Anthropic
  const KEY = ['sk', 'ant', 'api03', 'ZKOUSKAweb' + 'a1B2c3D4'.repeat(4)].join('-');
  const f = await newContext(browser, { standalone: true, noClaude: true });
  const fp = f.page;
  await f.context.addInitScript((k) => localStorage.setItem('fm27.aiConfig', JSON.stringify({ kind: 'anthropic', apiKey: k })), KEY);
  const api = { mode: 'ok', log: [] };
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  const wsResponse = {
    id: 'msg_ws',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 800, output_tokens: 60, server_tool_use: { web_search_requests: 2 } },
    content: [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Football Manager 27 tactics new features' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: [
          { type: 'web_search_result', url: 'https://www.footballmanager.com/fm27/features/anthropic-test', title: 'FM27 test (cesta Anthropic)', encrypted_content: 'ZASIFROVANO-1', page_age: 'October 20, 2026' },
          { type: 'web_search_result', url: 'https://blog.example/abc', title: 'Blog (cesta Anthropic)', encrypted_content: 'ZASIFROVANO-2', page_age: null },
          { type: 'web_search_result', url: 'http://insecure.example/zzz', title: 'Nezabezpečený', encrypted_content: 'ZASIFROVANO-3' },
        ],
      },
      { type: 'text', text: 'Nalezeno. ', citations: [{ type: 'web_search_result_location', url: 'https://www.footballmanager.com/fm27/features/anthropic-test', title: 'FM27 test (cesta Anthropic)', encrypted_index: 'x', cited_text: 'Zkušební citace z oficiální stránky.' }] },
    ],
  };
  const fromMessages = (messages) => {
    const turns = messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('') }));
    const planner = turns.length === 1 && /^Navrhni hledací dotazy do knihovny/.test(turns[0].content);
    return planner ? turns[0].content : turns;
  };
  await f.context.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    api.log.push({ headers: req.headers(), body });
    const json = (status, payload) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(payload) });
    if (Array.isArray(body.tools) && body.tools.some((t) => t.name === 'web_search')) {
      if (api.mode === 'disabled') return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Web search is not enabled for your organization' } });
      if (api.mode === 'tool_error') return json(200, Object.assign({}, wsResponse, { usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } }, { type: 'text', text: 'Nepovedlo se.' }] }));
      return json(200, wsResponse);
    }
    const input = fromMessages(body.messages || []);
    const reply = await fp.evaluate((i) => window.__mock.reply(i, { modelTier: 'x' }).then((r) => r.text), input);
    return json(200, { id: 'msg_zk', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 300 } });
  });
  await open(fp, 'zdroje');
  check('12 samostatná verze s klíčem Anthropic zvolí cestu „anthropic“', (await fp.evaluate(() => window.FM27.web.route)) === 'anthropic');
  await fp.waitForSelector('#webSrcOk', { timeout: 5000 });
  check('12 stav říká, že hledání běží přes klíč a účtuje se zvlášť', /tvůj klíč Anthropic/.test(await text(fp, '#webSrcOk')) && /účtuje zvlášť/.test(await text(fp, '#webSrcOk')), await text(fp, '#webSrcOk'));
  await fp.click('#webStarter');
  await fp.waitForSelector('#webResultList .web-source', { timeout: 10000 });
  const wsReq = api.log.find((r) => Array.isArray(r.body.tools));
  check('12 požadavek: nástroj web_search_20250305, nejvýš 4 hledání, levný model, klíč jen v hlavičce', wsReq && wsReq.body.tools[0].type === 'web_search_20250305' && wsReq.body.tools[0].name === 'web_search' && wsReq.body.tools[0].max_uses <= 4 && /haiku/.test(wsReq.body.model) && wsReq.headers['x-api-key'] === KEY && !JSON.stringify(wsReq.body).includes(KEY), wsReq && wsReq.body.tools);
  check('12 zprávu k hledání tvoří cíl a dotazy o FM27', wsReq && /Football Manager 27 tactics new features/.test(wsReq.body.messages[0].content) && /web_search tool/.test(wsReq.body.messages[0].content), wsReq && wsReq.body.messages[0].content.slice(0, 200));
  check('12 výsledky: dva zdroje (nezabezpečený se zahodil), výtah je doslovná citace, datum česky', (await fp.locator('#webResultList .web-source').count()) === 2 && /Zkušební citace z oficiální stránky/.test(await fp.locator('#webResultList .web-source').first().innerText()) && /20\. 10\. 2026/.test(await fp.locator('#webResultList .web-source').first().innerText()), await text(fp, '#webResultList'));
  check('12 zašifrovaný obsah výsledků se nikam nedostal', !(await fp.evaluate(() => document.documentElement.outerHTML)).includes('ZASIFROVANO') && !(await fp.evaluate(() => JSON.stringify(localStorage))).includes('ZASIFROVANO'));
  const usage = await fp.evaluate(() => window.FM27.web.usage());
  check('12 počet hledání se počítá podle odpovědi API (2) a ukáže odhad poplatku', usage.searches === 2 && usage.usd === 0.02, usage);
  await nav(fp, 'nastaveni');
  await fp.waitForSelector('#webStatusLine');
  check('12 nastavení ukáže spotřebu hledání tento měsíc', /tento měsíc 2/.test(await text(fp, '#webStatusLine')) && /Hledání zdrojů na webu/.test(await text(fp, '#diag')), await text(fp, '#webStatusLine'));
  check('12 u vlastního klíče je hledání při radě výchozně vypnuté (stojí peníze)', (await fp.evaluate(() => window.FM27.web.autoOn(window.FM27.app))) === false);
  await nav(fp, 'trener');
  check('12 „Hledat i na webu“ je u vlastního klíče nabídnuté, ale nezaškrtnuté a upozorní na poplatek', !(await fp.isChecked('#webMode')) && !(await fp.isDisabled('#webMode')) && /účtuje zvlášť/.test(await text(fp, '#webModeText')), await text(fp, '#webModeText'));
  await fp.check('#webMode');
  const nApi = api.log.length;
  await ask(fp, 'Útočník je izolovaný a nemáme střely.');
  await fp.waitForSelector('#result .sec', { timeout: 20000 });
  const adviceReqs = api.log.slice(nApi);
  const webReq = adviceReqs.find((r) => Array.isArray(r.body.tools));
  const adviceReq = adviceReqs.filter((r) => !Array.isArray(r.body.tools)).pop();
  check('12 rada s webem přes klíč: jedno hledání a pak rada, ve které jsou úryvky z webu', !!webReq && !!adviceReq && /^- web:/m.test(adviceReq.body.messages[0].content) && (adviceReq.body.messages[0].content.match(/^- web:/gm) || []).length === 2 && /prošla kontrolou/.test(await text(fp, '#result .banner')), { n: adviceReqs.length });
  check('12 odkaz na zdroj z webu v radě i při vlastním klíči', (await fp.locator('#result a.ref[href^="https://www.footballmanager.com/"]').count()) >= 1);
  check('12 klíč nikde na stránce není vidět', !(await fp.evaluate(() => document.documentElement.outerHTML)).includes(KEY));
  api.mode = 'disabled';
  await nav(fp, 'zdroje');
  await fp.fill('#webTopic', 'jiné téma pro chybu');
  await fp.click('#webFind');
  await fp.waitForFunction(() => !document.querySelector('#webFind').disabled, null, { timeout: 10000 });
  check('12 když je web search v účtu Anthropic vypnutý, hláška to řekne (a bez klíče)', /Web search is not enabled/.test(await text(fp, '#webMsg')) && !(await text(fp, '#webMsg')).includes(KEY), await text(fp, '#webMsg'));
  api.mode = 'tool_error';
  await fp.fill('#webTopic', 'další téma pro chybu nástroje');
  await fp.click('#webFind');
  await fp.waitForFunction(() => !document.querySelector('#webFind').disabled, null, { timeout: 10000 });
  check('12 chyba nástroje uvnitř odpovědi (HTTP 200, too_many_requests) se ukáže srozumitelně', /příliš mnoho hledání/.test(await text(fp, '#webMsg')), await text(fp, '#webMsg'));
  check('12 samostatná verze: žádná chyba v konzoli ani výjimka stránky', f.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0 && f.problems.page.length === 0, { console: f.problems.console, page: f.problems.page });
  await f.context.close();

  // ====================================================== G) klíč zadaný až za běhu: cesta hledání se přepne bez obnovení stránky
  const g = await newContext(browser, { standalone: true, noClaude: true });
  const gp = g.page;
  await open(gp, 'nastaveni');
  check('12 samostatná verze bez klíče: hledání na webu není dostupné a důvod říká, že je potřeba klíč Anthropic', (await gp.evaluate(() => window.FM27.web.route)) === 'none' && /klíč Anthropic/.test(await gp.evaluate(() => window.FM27.web.reason)) && /Zadej ho v Nastavení/.test(await gp.evaluate(() => window.FM27.web.reason)), await gp.evaluate(() => window.FM27.web.reason));
  await gp.fill('#keyValue', KEY);
  await gp.click('#keySave');
  await gp.waitForFunction(() => /Klíč je uložený/.test(document.querySelector('#keyMsg').textContent), null, { timeout: 8000 }).catch(() => {});
  check('12 po zadání klíče se cesta hledání přepne na „anthropic“ bez obnovení stránky', (await gp.evaluate(() => window.FM27.web.route)) === 'anthropic' && (await gp.evaluate(() => window.FM27.web.available)) === true, await gp.evaluate(() => window.FM27.web.route));
  check('12 po zadání klíče stav v nastavení ukáže hledání přes klíč', /tvůj klíč Anthropic/.test(await text(gp, '#webStatusLine')) || (await until(async () => /tvůj klíč Anthropic/.test(await text(gp, '#webStatusLine')))), await text(gp, '#webStatusLine'));
  await g.context.close();

  async function resetPrompts(p) {
    await p.evaluate(() => {
      window.__mock.prompts = [];
      window.__mock.calls = [];
    });
  }
};
