/* Scénář 15: NAČTENÍ HRÁČŮ Z EXPORTU NÁSTROJE (CSV, TSV, HTML, JSON, výstup fmsave). Přesná data o hráčích bez AI a bez kreditů.
   Zkouší se celá cesta: soubor → kódování → tabulka → návrh významu sloupců → úprava uživatelem → potvrzení → hráči v soupisce.
   Poctivost: skryté údaje hry (CA a PA, skryté atributy) se nenačtou, načtené údaje jsou „zadal uživatel (soubor od tebe)“,
   nic se nepřidá bez potvrzení a text ze souboru je jen text. Co se NEzkouší: skutečné soubory cizích nástrojů (výstup fmsave se
   napodobuje podle jeho dokumentace, ostatní tvary jsou obecné). */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, text } = h;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return fn();
  };
  const c = await newContext(browser, {});
  const page = c.page;
  const players = () => page.evaluate(() => window.FM27.context.players(window.FM27.app).map((p) => ({ name: p.name, age: p.age, positions: p.positions, attributes: p.attributes, source: p.source, prov: p.prov, notes: p.notes, flags: p.flags })));
  const upload = async (name, buffer, mimeType) => {
    await page.setInputFiles('#exportFile', { name, mimeType: mimeType || 'text/plain', buffer });
    await page.waitForFunction(() => document.querySelector('#exportStatus') && document.querySelector('#exportStatus').textContent !== '' && document.querySelector('#exportStatus').textContent !== 'Čtu soubor…', null, { timeout: 8000 });
  };
  const roleOf = (header) => page.locator(`#exportColumns [data-header="${header}"] select`).inputValue();
  const addAll = async () => {
    await page.check('#exportConfirm');
    await page.click('#exportAdd');
  };

  await open(page, 'tym');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#exportCard');
  check('15 Můj tým nabízí načtení hráčů z exportu a říká, že skryté údaje hry se nenačítají', /Načíst hráče z exportu/.test(await text(page, '#exportCard')) && /Skryté údaje hry/.test(await text(page, '#exportCard')) && /CA a PA/.test(await text(page, '#exportCard')));
  check('15 karta říká, že se načítá jen v tomto zařízení a bez volání AI', /čte se jen v tomto zařízení/.test(await text(page, '#exportCard')) && /nestojí žádné volání AI/.test(await text(page, '#exportCard')));

  // ---------- CSV s českou hlavičkou (UTF-8 s BOM)
  const csv = '\ufeffJméno,Věk,Pozice,Finishing,Passing,Pace,Stamina,Vision,Zápasy,CA\nJan Novák,24,ST,15,12,14,13,11,9,140\nPetr Dvořák,31,GK,3,8,9,5,7,18,120\nKarel Čermák,27,DC,5,11,10,6,9,14,100\n';
  await upload('soupiska.csv', Buffer.from(csv, 'utf8'), 'text/csv');
  check('15 stav ukáže počet řádků a sloupců, druh souboru a kódování', /3 řádky, 10 sloupců \(CSV \(čárka\), kódování UTF-8\)/.test(await text(page, '#exportStatus')), await text(page, '#exportStatus'));
  const roles = Object.fromEntries(await Promise.all(['Jméno', 'Věk', 'Pozice', 'Finishing', 'Pace', 'Zápasy', 'CA'].map(async (k) => [k, await roleOf(k)])));
  check('15 návrh významu sloupců: jméno, věk, pozice a atributy; zápasy a CA se nepoužijí', roles['Jméno'] === 'name' && roles['Věk'] === 'age' && roles['Pozice'] === 'positions' && roles.Finishing === 'attribute' && roles.Pace === 'attribute' && roles['Zápasy'] === 'ignore' && roles.CA === 'ignore', roles);
  check('15 u CA je vidět proč: skrytý údaj hry', /skrytý údaj hry/.test(await page.locator('#exportColumns [data-header="CA"]').innerText()), await page.locator('#exportColumns [data-header="CA"]').innerText());
  check('15 náhled ukáže tři hráče a shrnutí', (await page.locator('#exportPlayers .book').count()) === 3 && /Přidá se 3 hráči/.test(await text(page, '#exportSummary')), await text(page, '#exportSummary'));
  await page.click('#exportAdd');
  check('15 bez potvrzení se nic nepřidá', /Nejdřív potvrď/.test(await text(page, '#toast')) && (await players()).length === 0, await text(page, '#toast'));
  await addAll();
  await until(async () => (await players()).length === 3);
  const ps = await players();
  const jan = ps.find((p) => p.name === 'Jan Novák');
  check('15 po potvrzení jsou v soupisce tři hráči s věkem, pozicí a atributy', ps.length === 3 && jan.age === 24 && JSON.stringify(jan.positions) === '["ST"]' && jan.attributes.Finishing === 15 && jan.attributes.Vision === 11, ps);
  check('15 skryté CA se do hráče nedostalo a zápasy také ne', !('CA' in jan.attributes) && !('Zápasy' in jan.attributes) && Object.keys(jan.attributes).length === 5, jan.attributes);
  check('15 zdroj je „z exportu“ a údaje jsou jen „zadal uživatel“, ne ověřené hrou', jan.source === 'export' && jan.prov.all === 'user_entered', jan);
  await page.waitForSelector('#playerList .player');
  check('15 seznam hráčů ukáže původ „z exportu (soubor od tebe)“', /z exportu \(soubor od tebe\)/.test(await text(page, '#playerList')), await text(page, '#playerList'));
  check('15 celé načtení proběhlo bez jediného volání AI', (await page.evaluate(() => window.__mock.calls.length)) === 0);

  // ---------- stejný soubor podruhé: nikdo nový
  await page.waitForFunction(() => !document.querySelector('#exportColumns'), null, { timeout: 5000 });
  await upload('soupiska.csv', Buffer.from(csv, 'utf8'), 'text/csv');
  check('15 stejný soubor podruhé: všichni už v soupisce jsou a není koho přidat', /Už v soupisce jsou nebo se opakují: 3/.test(await text(page, '#exportSummary')) && (await page.isDisabled('#exportAdd')) && /Není koho přidat/.test(await text(page, '#exportAdd')), await text(page, '#exportSummary'));

  // ---------- TSV v UTF-16 (BOM), anglická hlavička
  const tsv = '\ufeffName\tAge\tPosition\tFinishing\tPassing\tPace\tStamina\tTackling\nLukáš Procházka\t22\tST\t14\t12\t15\t13\t6\nMarek Šťastný\t29\tDM\t8\t13\t10\t14\t16\n';
  await upload('export.tsv', Buffer.from(tsv, 'utf16le'), 'text/tab-separated-values');
  check('15 UTF-16 se přečte, čeština zůstane a druh je TSV', /TSV \(tabulátor\), kódování UTF-16/.test(await text(page, '#exportStatus')) && /Lukáš Procházka/.test(await text(page, '#exportPlayers')), await text(page, '#exportStatus'));
  await addAll();
  await until(async () => (await players()).length === 5);
  check('15 přibyli dva hráči, soupiska má pět', (await players()).length === 5 && (await players()).some((p) => p.name === 'Marek Šťastný' && p.attributes.Tackling === 16));

  // ---------- starší česká znaková sada (windows-1250): bajty se skládají ručně z tabulky znaků
  await page.waitForFunction(() => !document.querySelector('#exportColumns'), null, { timeout: 5000 });
  const CP1250 = { 'á': 0xe1, 'č': 0xe8, 'é': 0xe9, 'ě': 0xec, 'í': 0xed, 'ř': 0xf8, 'ž': 0x9e, 'Č': 0xc8, 'Ř': 0xd8, 'Ž': 0x8e };
  const toCp1250 = (s) => Buffer.from([...s].map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : CP1250[ch])));
  await upload('stary.csv', toCp1250('Jméno;Věk;Pozice\nDvořák Řehoř;30;GK\nČáp Ždímal;21;DC\n'), 'text/csv');
  check('15 stará česká znaková sada (windows-1250) se pozná a jména jsou čitelná', /windows-1250/.test(await text(page, '#exportStatus')) && /Dvořák Řehoř/.test(await text(page, '#exportPlayers')) && /Čáp Ždímal/.test(await text(page, '#exportPlayers')), await text(page, '#exportStatus') + ' | ' + (await text(page, '#exportPlayers')));
  await page.setInputFiles('#exportFile', []);

  // ---------- HTML tabulka (webová stránka z nástroje)
  const html = '<html><body><script>window.__pwned = 1</script><table><tr><th>Unique ID</th><th>Name</th><th>Age</th><th>Position</th><th>Fin</th><th>Pas</th><th>Pac</th><th>Sta</th><th>Tck</th></tr><tr><td>1</td><td><b>Ondřej</b> Král</td><td>25</td><td>D (RLC), WB (R)</td><td>6</td><td>11</td><td>12</td><td>14</td><td>15</td></tr><tr><td>2</td><td>Tomáš &amp; syn</td><td>19</td><td>ST</td><td>13</td><td>9</td><td>16</td><td>12</td><td>5</td></tr></table></body></html>';
  await upload('pohled.html', Buffer.from(html, 'utf8'), 'text/html');
  check('15 HTML: tabulka se najde, skript ze stránky se nespustí a značky z buněk zmizí', /webová stránka/.test(await text(page, '#exportStatus')) && (await page.evaluate(() => window.__pwned)) === undefined, await text(page, '#exportStatus'));
  check('15 HTML: sloupec „Unique ID“ se nepoužije, „Name“ je jméno, atributů je pět', (await roleOf('Name')) === 'name' && (await roleOf('Unique ID')) === 'ignore' && (await roleOf('Fin')) === 'attribute' && (await roleOf('Tck')) === 'attribute', { name: await roleOf('Name'), uid: await roleOf('Unique ID') });
  await addAll();
  await until(async () => (await players()).length === 7);
  const html7 = (await players()).find((p) => p.name === 'Ondřej Král');
  check('15 pozice „D (RLC), WB (R)“ se nepřevádějí, uloží se do poznámky; druhý hráč má pozici ST', html7 && html7.positions.length === 0 && /Pozice v exportu: D \(RLC\), WB \(R\)/.test(html7.notes) && (await players()).find((p) => p.name === 'Tomáš & syn').positions[0] === 'ST', html7);

  // ---------- výstup fmsave (vnořený JSON podle dokumentace)
  await page.waitForFunction(() => !document.querySelector('#exportColumns'), null, { timeout: 5000 });
  const fmsave = JSON.stringify([
    { uid: 1, unique_id: 10, name: 'Adam Veselý', age: 23, natural_positions: ['ST'], attributes: { finishing: 16, off_the_ball: 14, first_touch: 13, passing: 11, pace: 15, consistency: 18, important_matches: 17 }, ability: { current: 140, potential: 175 }, personality: { ambition: 15 }, contract: { wage: 7000 } },
    { uid: 2, unique_id: 11, name: 'Boris Malý', age: 30, natural_positions: ['GK'], attributes: { finishing: 3, off_the_ball: 4, first_touch: 8, passing: 9, pace: 7, consistency: 12, important_matches: 11 }, ability: { current: 120, potential: 120 }, personality: { ambition: 9 }, contract: { wage: 3000 } },
  ]);
  await upload('squad.json', Buffer.from(fmsave, 'utf8'), 'application/json');
  check('15 JSON ze čtečky uložené hry se pozná (fmsave): sloupce podle její dokumentace', /JSON/.test(await text(page, '#exportStatus')) && (await roleOf('name')) === 'name' && (await roleOf('natural_positions')) === 'positions' && (await roleOf('attributes_finishing')) === 'attribute', await text(page, '#exportStatus'));
  check('15 skryté atributy, schopnosti a osobnost se nenavrhnou ani jako atributy, a je vidět proč', (await roleOf('attributes_consistency')) === 'ignore' && (await roleOf('attributes_important_matches')) === 'ignore' && (await roleOf('ability_current')) === 'ignore' && (await roleOf('personality_ambition')) === 'ignore' && /skrytý údaj hry/.test(await page.locator('#exportColumns [data-header="attributes_consistency"]').innerText()));
  await addAll();
  await until(async () => (await players()).length === 9);
  const adam = (await players()).find((p) => p.name === 'Adam Veselý');
  check('15 hráč z fmsave má hezké názvy atributů a žádný skrytý údaj', adam && adam.attributes['Off the ball'] === 14 && adam.attributes['First touch'] === 13 && adam.attributes.Finishing === 16 && !('Consistency' in adam.attributes) && Object.keys(adam.attributes).length === 5 && JSON.stringify(adam.positions) === '["ST"]', adam);

  // ---------- úprava významu sloupce uživatelem
  await page.waitForFunction(() => !document.querySelector('#exportColumns'), null, { timeout: 5000 });
  const csv2 = 'Hráč,Klub,Věk,Finishing,Passing,Pace,Stamina,Vision\nNový Hráč,Sparta,20,10,10,10,10,10\nDruhý Hráč,Slavia,21,11,11,11,11,11\n';
  await upload('uprava.csv', Buffer.from(csv2, 'utf8'), 'text/csv');
  check('15 název sloupce „Hráč“ se pozná jako jméno', (await roleOf('Hráč')) === 'name' && (await roleOf('Klub')) === 'ignore', { h: await roleOf('Hráč'), k: await roleOf('Klub') });
  await page.selectOption('#exportColumns [data-header="Klub"] select', 'name');
  check('15 když uživatel určí jiný sloupec jako jméno, původní se vypne (jeden význam jen u jednoho sloupce) a náhled se přepočítá', (await roleOf('Hráč')) === 'ignore' && /Sparta/.test(await text(page, '#exportPlayers')), { h: await roleOf('Hráč') });
  await page.selectOption('#exportColumns [data-header="Finishing"] select', 'ignore');
  check('15 vypnutý atribut se do náhledu nepromítne', /4 atributů/.test(await text(page, '#exportPlayers')), await text(page, '#exportPlayers'));
  await page.setInputFiles('#exportFile', []);

  // ---------- špatné soubory
  const bad = async (name, buffer, re, label) => {
    await upload(name, buffer, 'text/plain');
    check(label, re.test(await text(page, '#exportStatus')) && (await page.locator('#exportColumns').count()) === 0, await text(page, '#exportStatus'));
  };
  await bad('nic.txt', Buffer.from('ahoj, tohle není tabulka'), /nenašel tabulku/, '15 soubor bez tabulky: aplikace to řekne a nic nenabídne');
  await bad('prazdny.csv', Buffer.alloc(0), /prázdný/, '15 prázdný soubor se odmítne');
  await bad('velky.csv', Buffer.alloc(3 * 1024 * 1024, 65), /větší než 2 MB/, '15 příliš velký soubor se odmítne');
  await bad('rozbity.json', Buffer.from('[{"name": "A", '), /nenašel tabulku/, '15 rozbitý JSON není tabulka');

  // ---------- text ze souboru je jen text
  const evil = 'Name,Age,Position,Finishing,Passing,Pace,Stamina,Vision\n"<img src=x onerror=""window.__pwned=2""> Zloděj",25,ST,10,10,10,10,10\n"<script>window.__pwned=3</script>Hacker",26,GK,10,10,10,10,10\n';
  await upload('zly.csv', Buffer.from(evil, 'utf8'), 'text/csv');
  check('15 značky ve jménech se zobrazí jako text a žádný kód se nespustí', (await page.evaluate(() => window.__pwned)) === undefined && (await page.locator('#exportPlayers img, #exportPlayers script, #exportColumns img').count()) === 0, await text(page, '#exportPlayers'));
  await addAll();
  await until(async () => (await players()).length === 11);
  check('15 uložená jména nemají žádné značky', (await players()).every((p) => !/[<>]/.test(p.name)), (await players()).map((p) => p.name));

  // ---------- limit 60 hráčů
  await page.waitForFunction(() => !document.querySelector('#exportColumns'), null, { timeout: 5000 });
  const many = ['Name,Age,Position,Finishing,Passing,Pace,Stamina,Vision'].concat(Array.from({ length: 70 }, (_, i) => `Limit ${i},20,ST,10,10,10,10,10`)).join('\n');
  await upload('hodne.csv', Buffer.from(many, 'utf8'), 'text/csv');
  check('15 limit soupisky 60 hráčů: přidá se jen tolik, kolik se vejde, a zbytek se přizná', /Přidá se 49 hráčů/.test(await text(page, '#exportSummary')) && /Nad limit 60 hráčů: 21/.test(await text(page, '#exportSummary')), await text(page, '#exportSummary'));
  await addAll();
  await until(async () => (await players()).length === 60);
  check('15 soupiska má nejvýš 60 hráčů', (await players()).length === 60);
  check('15 bez chyb ve skriptu a v konzoli (kromě blokovaných zdrojů)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
