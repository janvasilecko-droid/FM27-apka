/* Scénář 21: ČTENÍ SOUBORU .fmf (Moje taktiky → Import).
   Co se zkouší: soubor se rozšifruje a rozbalí v prohlížeči (WebCrypto AES-CTR, vlastní dekodér zstd z aplikace, bez stahování čehokoli z internetu), ukáže se název, obrázek, velikosti a výsledky kontrol; poškozený soubor se nepřečte;
   starší nebo cizí soubor jde na původní kontrolu; nic se neposílá do AI a nic z obsahu taktiky ani přezdívky autora se neuloží do úložiště ani do zprávy o souboru.
   Soubory jsou SYNTETICKÉ (zapisovač podle ověřeného formátu). Když je nastavená proměnná FMF_SAMPLES_DIR, přečtou se i skutečné exporty z FM27 z toho adresáře
   (do repozitáře nepatří) a ověří se totéž.
   Co se NEzkouší: pole taktiky uvnitř .tac (zatím se nedekódují) a nic proti hře samotné. */
const fs = require('fs');
const path = require('path');
const B = require('../../fixtures/fmf_builder.cjs');
const TB = require('../../fixtures/fmftac_builder.cjs');

module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, text } = h;
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
  await open(page, 'taktiky');
  const blockedBefore = c.problems.failed.length; // požadavky ven, které zkušební prostředí zablokovalo (nic nepovoluje): po načtení stránky už nesmí přibýt žádný
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacFmfFile');
  const upload = async (name, buffer) => {
    await page.setInputFiles('#tacFmfFile', { name, mimeType: 'application/octet-stream', buffer });
  };
  const note = () => text(page, '#tacImportBox');

  // ====================================================== A) syntetický export
  const cnt = TB.counts(TB.standardTree(5, B.TITLE));
  const std = B.standardFmf(5, { tac: TB.standardTac(5, B.TITLE) }); // payload taktiky se vymyšlenou, ale platnou stavbou
  await upload('Testovaci_taktika.fmf', std.file);
  await page.waitForSelector('#fmfReadBanner', { timeout: 15000 });
  const rows = await text(page, '#fmfReadRows');
  check('21 soubor se přečte: banner „je přečtený“ a řekne, že se nic neposílá ven ani do AI', /je přečtený/.test(await text(page, '#fmfReadBanner')) && /nic se neposílá na internet ani do AI/.test(await text(page, '#fmfReadBanner')), await text(page, '#fmfReadBanner'));
  check('21 banner u souboru, jehož zdroje se všechny ověřily, to říká o všech zdrojích', /U všech zdrojů sedí velikosti s manifestem/.test(await text(page, '#fmfReadBanner')) && !/U zdrojů, které se podařilo ověřit/.test(await text(page, '#fmfReadBanner')), await text(page, '#fmfReadBanner'));
  check('21 řádky: název z manifestu, autor „neověřeno“, velikost souboru a velikosti zdrojů před a po rozbalení', new RegExp(`Název taktiky \\(z manifestu\\)\\s+${B.TITLE}`).test(rows) && /Autor \(podle souboru, neověřeno\)\s+autor_test/.test(rows) && new RegExp(`Velikost souboru\\s+${std.file.length} B`).test(rows) && new RegExp(`Taktika \\(\\.tac\\)\\s+záznam ${std.recs[1].rec.length} B \\(s klíčem a IV\\) → ${std.recs[1].content.length} B rozbaleno, velikost sedí s manifestem a kontrolní součet obsahu sedí`).test(rows), rows);
  check('21 pole taktiky se výslovně označí jako nedekódovaná a neověřená', /Pole taktiky \(formace, role, instrukce…\)\s+zatím nedekódována, nic z nich není ověřeno/.test(rows), rows);
  check('21 struktura taktiky: přečtena celá, počty dvojic, bloků, položek a záznamů sedí s tím, co je v souboru', new RegExp(`Struktura taktiky \\(stavba souboru\\)\\s+přečtena celá, každý bajt zařazen: ${cnt.pairs} dvojic bloků \\(${cnt.blocks} bloků celkem\\), ${cnt.items} položek, ${cnt.idEntries} záznamů seznamu id, ${cnt.footerLists} seznamů v patičce; 11 míst očíslovaných 0 až 10`).test(rows), rows);
  check('21 obrázek z PNG v souboru se ukáže (5 × 3 bodů)', await page.evaluate(() => { const i = document.querySelector('#fmfLogo'); return !!i && i.complete && i.naturalWidth === 5 && i.naturalHeight === 3; }));
  check('21 ověřená tvrzení jsou vypsaná (hlavička, manifest, součty)', /kontrolní součet zstd souhlasí u 3 z nich/.test(await text(page, '#fmfVerified')) && /payload taktiky začíná značkou „cat\.“ a obsahuje stejný název/.test(await text(page, '#fmfVerified')), await text(page, '#fmfVerified'));
  check('21 mezi ověřenými tvrzeními je i stavba payloadu, s výhradou, že význam čísel nedokazuje', /stavba payloadu taktiky souhlasí s popsanou gramatikou[^.]*význam čísel to nedokazuje/.test(await text(page, '#fmfVerified')), await text(page, '#fmfVerified'));
  const calls = await page.evaluate(() => window.__mock.calls.length);
  check('21 čtení souboru nevolá AI', calls === 0, calls);
  check('21 čtení souboru nestahuje nic z internetu: rozbalení zstd je součást aplikace (žádný zablokovaný požadavek ven)', c.problems.failed.length === blockedBefore, c.problems.failed.slice(blockedBefore));

  // ---------- zpráva o souboru: jen velikosti a výsledky kontrol
  await page.evaluate(() => { window.__mock.saves.length = 0; });
  await page.click('#fmfSaveReport');
  await until(async () => (await page.evaluate(() => window.__mock.saves.length)) === 1);
  const saved = await page.evaluate(() => window.__mock.saves[0]);
  const report = saved ? JSON.parse(saved.text) : null;
  const leaks = [...TB.STYLES.filter(Boolean), 'autor_test'].filter((x) => saved && saved.text.includes(x)); // název z manifestu je ve zprávě záměrně (označuje taktiku), styl z payloadu a autor ne
  check('21 zpráva o souboru nese o struktuře jen počty (bez názvu, stylu a čísel z taktiky)', !!report && !!report.report.structure && report.report.structure.ok === true && report.report.structure.pairs === cnt.pairs && report.report.structure.blocks === cnt.blocks && report.report.structure.items === cnt.items && report.report.structure.idEntries === cnt.idEntries && report.report.structure.footerLists === cnt.footerLists && report.report.structure.slotsArePermutation === true && leaks.length === 0, { structure: report && report.report.structure, leaks });
  check('21 zpráva o souboru: formát, tři zdroje s kontrolami; bez obsahu taktiky, obrázku a přezdívky autora', report && saved.filename === 'fmf-zprava.json' && report.format === 'fm27-fmf-read' && report.report.entries.length === 3 && report.report.entries.every((e) => e.ok) && !saved.text.includes('autor_test') && !/"content"/.test(saved.text), saved && saved.text.slice(0, 200));

  // ---------- nic z obsahu se neuložilo
  const stored = await page.evaluate(() => JSON.stringify(window.FM27.app.store.exportAll()));
  check('21 do úložiště se nic z obsahu souboru neuložilo (ani přezdívka autora, ani název z manifestu)', !stored.includes('autor_test') && !stored.includes(B.TITLE), '');

  // ====================================================== B) poškozený, jiný a cizí soubor
  const tac = std.recs.find((x) => x.ext === '.tac');
  const damaged = Buffer.from(std.file);
  damaged[26 + tac.offset + 40 + Math.floor((tac.rec.length - 40) / 2)] ^= 0x01;
  await upload('poskozeny.fmf', damaged);
  await until(async () => /nepodařilo se ho přečíst/.test(await note()));
  const dm = await note();
  check('21 poškozený soubor: „má hlavičku exportu, ale nepodařilo se ho přečíst“, důvod uveden, obrázek se neukáže, nic se nepřevezme', /Soubor má hlavičku exportu FM27, ale nepodařilo se ho přečíst/.test(dm) && /Taktika \(\.tac\)/.test(dm) && /Nic z něj se nepřevzalo/.test(dm) && (await page.locator('#fmfLogo').count()) === 0, dm);
  const badReport = await page.locator('#fmfSaveReport').count();
  check('21 i u poškozeného souboru jde uložit zprávu', badReport === 1);
  await upload('cizi.fmf', Buffer.from('tohle není export z FM27'));
  await until(async () => /nebyl interpretován/.test(await note()));
  check('21 cizí soubor jde na původní kontrolu a odmítne se bez hádání', /nebyl interpretován/.test(await note()), await note());
  // soubor se správným začátkem hlavičky, ale s patní značkou na špatném místě: je to „náš“ formát, ale vadný? ne: bez patní značky jde na původní kontrolu
  const noFooter = Buffer.from(std.file);
  noFooter[std.A + 9 + 2] ^= 1;
  await upload('bez_patni_znacky.fmf', noFooter);
  await until(async () => !/Čtu soubor/.test(await note()) && (await note()).length > 0);
  check('21 soubor s hlavičkou, ale bez patní značky se neprohlásí za přečtený', (await page.locator('#fmfLogo').count()) === 0 && !/je přečtený/.test(await note()), await note());

  // ====================================================== C) soubor bez obrázku
  await upload('bez_obrazku.fmf', B.standardFmf(8, { png: Buffer.alloc(0) }).file);
  await page.waitForSelector('#fmfReadBanner.ok', { timeout: 15000 });
  check('21 soubor bez obrázku se přečte a obrázek se neukáže', (await page.locator('#fmfLogo').count()) === 0 && /je přečtený/.test(await text(page, '#fmfReadBanner')));

  // ====================================================== C3) zdroj bez kontrolního součtu
  await upload('bez_souctu.fmf', B.standardFmf(7, { noSum: true }).file);
  await until(async () => /Taktika \(\.tac\)/.test(await text(page, '#fmfReadRows')) && /bez_souctu|je přečtený/.test(await text(page, '#fmfReadBanner')));
  const noSumRows = await text(page, '#fmfReadRows');
  check('21 zdroj bez kontrolního součtu: soubor se přečte, ale řádek říká, že součet soubor neuvádí a ověřila se jen velikost; ostatní zdroje součet mají', /Taktika \(\.tac\)\s+[^\n]*kontrolní součet soubor u tohoto zdroje neuvádí \(neověřeno\)/.test(noSumRows) && /Obrázek \(\.img\)\s+[^\n]*kontrolní součet obsahu sedí/.test(noSumRows), noSumRows);

  // ====================================================== C4) bajty v datové části, které nepatří žádnému záznamu
  const tail = B.buildFmf({ title: B.TITLE, resources: [{ dir: '', name: B.TITLE, ext: '.tac', content: B.tacContent(B.TITLE, 300, 1) }] }, 7);
  const tailFile = Buffer.concat([Buffer.from(B.PREAMBLE), B.u64le(26 + tail.recs[0].rec.length + 5 - 9), B.u64le(17), Buffer.from([3]), tail.recs[0].rec, Buffer.alloc(5, 0xbb), Buffer.from(B.FOOTER), B.zc(tail.manifest)]);
  await upload('bajty_navic.fmf', tailFile);
  await page.waitForSelector('#fmfWarnings', { timeout: 15000 });
  const warn = await text(page, '#fmfWarnings');
  check('21 bajty v datové části bez záznamu: soubor se přečte, ale ukáže se výslovné upozornění a tvrzení „beze zbytku“ chybí', /Pozor: 5 bajtů v datové části nepatří žádnému záznamu/.test(warn) && !/beze zbytku/.test(await text(page, '#fmfVerified')) && /je přečtený/.test(await text(page, '#fmfReadBanner')), warn);
  await upload('bez_upozorneni.fmf', B.standardFmf(3).file);
  await until(async () => (await page.locator('#fmfWarnings').count()) === 0 && /je přečtený/.test(await text(page, '#fmfReadBanner')));
  check('21 běžný soubor žádné upozornění nemá a ověřená tvrzení říkají, že záznamy vyplňují datovou část beze zbytku', (await page.locator('#fmfWarnings').count()) === 0 && /záznamy beze zbytku vyplňují datovou část/.test(await text(page, '#fmfVerified')), await text(page, '#fmfVerified'));

  // ====================================================== C5) záznam zčásti mimo datovou část: dotčený zdroj je neověřený, banner nesmí tvrdit nic o všech zdrojích
  const imgLen = B.standardFmf(3).recs.find((r) => r.ext === '.img').rec.length;
  const overrun = B.buildFmf({ title: B.TITLE, resources: [{ dir: '', name: B.TITLE, ext: '.tac', content: B.tacContent(B.TITLE, 300, 1) }, { dir: '', name: 'image', ext: '.img', content: B.imageContent(B.tinyPng(5, 3)), manifestSize: imgLen + 50 }] }, 3);
  await upload('zaznam_mimo.fmf', overrun.file);
  await page.waitForSelector('#fmfWarnings', { timeout: 15000 });
  await until(async () => /Pozor: 1 záznam z manifestu leží zčásti nebo celý mimo datovou část/.test(await text(page, '#fmfWarnings')));
  const overBanner = await text(page, '#fmfReadBanner');
  const overRows = await text(page, '#fmfReadRows');
  check('21 záznam mimo datovou část: soubor se přečte, obrázek je NEOVĚŘENO, banner nehlásí shodu u všech zdrojů a tvrzení „beze zbytku“ chybí', /je přečtený/.test(overBanner) && !/U všech zdrojů/.test(overBanner) && /U zdrojů, které se podařilo ověřit/.test(overBanner) && /Pozor: jeden zdroj se nepodařilo ověřit/.test(overBanner) && /Obrázek \(\.img\)\s+[^\n]*NEOVĚŘENO/.test(overRows) && !/beze zbytku/.test(await text(page, '#fmfVerified')), overBanner + ' | ' + overRows);

  // ====================================================== C6) prohlížeč bez WebCrypto: zašifrované části se nečtou, řekne se to přímo a zbývá jen kontrola stavby souboru
  await page.evaluate(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }));
  await upload('bez_webcrypto.fmf', B.standardFmf(3).file);
  await until(async () => /nemá WebCrypto/.test(await note()));
  const noCrypto = await note();
  check('21 bez WebCrypto: soubor se nepřečte, řekne se důvod (WebCrypto, stránka přes https) a taktika se z něj nepřebírá; věta o souboru, který neodpovídá známé stavbě, se nepoužije', /nemá WebCrypto/.test(noCrypto) && /https/.test(noCrypto) && /Z tohoto souboru se tady taktika přečíst nedá/.test(noCrypto) && !/zná stavbu jen tří zkoumaných exportů/.test(noCrypto) && (await page.locator('#fmfReadBanner.ok').count()) === 0, noCrypto);
  // starší kontrola (ta, na kterou se přejde bez WebCrypto) odmítne soubor nad 5 MiB podle jeho velikosti, ještě než ho načte do paměti
  await upload('velky_bez_webcrypto.fmf', Buffer.alloc(5 * 1024 * 1024 + 1));
  await until(async () => /5242881 B/.test(await text(page, '#fmfTooBig').catch(() => '')), 15000);
  const tooBigInspect = await text(page, '#fmfTooBig').catch(() => '');
  check('21 starší kontrola: soubor o bajt větší než 5 MiB se odmítne podle velikosti (přesná čísla ve větě), ještě než se načte', /Soubor je příliš velký/.test(tooBigInspect) && /Soubor má 5242881 B \(asi 5 MiB\), víc než 5242880 B \(5 MiB\)/.test(tooBigInspect), tooBigInspect);
  await page.evaluate(() => { delete window.crypto.subtle; });

  // ====================================================== C7) příliš velký soubor: odmítne se podle velikosti, ještě než se načte do paměti
  const t7 = Date.now();
  await upload('obri.fmf', Buffer.alloc(24 * 1024 * 1024 + 1));
  await until(async () => /25165825 B/.test(await text(page, '#fmfTooBig').catch(() => '')), 20000);
  const tooBig = await text(page, '#fmfTooBig').catch(() => '');
  check('21 soubor o bajt větší než 24 MiB se odmítne podle velikosti (přesná čísla ve větě), nic se nečte a nic se nepřevezme', /Soubor je příliš velký/.test(tooBig) && /Soubor má 25165825 B \(asi 24 MiB\), víc než 25165824 B \(24 MiB\)/.test(tooBig) && (await page.locator('#fmfReadBanner').count()) === 0 && Date.now() - t7 < 20000, tooBig);

  // ====================================================== C2) payload, který nemá popsanou stavbu
  await upload('jina_stavba.fmf', B.standardFmf(9).file); // obsah .tac je vymyšlená změť bajtů: kontejner se přečte, stavba taktiky ne
  await page.waitForSelector('#fmfReadBanner.ok', { timeout: 15000 });
  await until(async () => /Struktura taktiky/.test(await text(page, '#fmfReadRows')));
  const oddRows = await text(page, '#fmfReadRows');
  check('21 payload bez popsané stavby: kontejner je přečtený, ale struktura se hlásí jako neodpovídající a nic se nepřebírá', /je přečtený/.test(await text(page, '#fmfReadBanner')) && /Struktura taktiky \(stavba souboru\)\s+NEODPOVÍDÁ popsané stavbě \(.+, bajt \d+\); nic se z ní nepřebírá/.test(oddRows) && !/stavba payloadu taktiky souhlasí/.test(await text(page, '#fmfVerified')), oddRows);
  await page.evaluate(() => { window.__mock.saves.length = 0; });
  await page.click('#fmfSaveReport');
  await until(async () => (await page.evaluate(() => window.__mock.saves.length)) === 1);
  const oddSaved = await page.evaluate(() => window.__mock.saves[0]);
  const oddReport = oddSaved ? JSON.parse(oddSaved.text) : null;
  check('21 zpráva o payloadu bez popsané stavby: ok = false, pevná věta a posun, bez obsahu', !!oddReport && oddReport.report.structure.ok === false && typeof oddReport.report.structure.error === 'string' && oddReport.report.structure.error.length > 0 && Number.isInteger(oddReport.report.structure.offset) && !oddSaved.text.includes('autor_test') && !/"content"/.test(oddSaved.text), oddReport && oddReport.report.structure);

  // ====================================================== D) skutečné exporty z FM27 (jen když je zadaný adresář; soubory nejsou v repozitáři)
  const dir = process.env.FMF_SAMPLES_DIR;
  if (dir) {
    const samples = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.fmf')).sort() : [];
    check('21 skutečné exporty: FMF_SAMPLES_DIR je zadaný a obsahuje soubory .fmf (jinak by se část D tiše přeskočila)', samples.length > 0, 'adresář je prázdný nebo neexistuje');
    for (const [i, f] of samples.entries()) {
      const buf = fs.readFileSync(path.join(dir, f));
      await upload(f, buf);
      await until(async () => /je přečtený|nepodařilo se ho přečíst|nebyl interpretován/.test(await note()), 15000);
      const t = await note();
      const logo = await page.evaluate(() => { const i = document.querySelector('#fmfLogo'); return i ? [i.naturalWidth, i.naturalHeight] : null; });
      check(`21 skutečný export č. ${i + 1} z ${samples.length}: přečtený, tři zdroje s kontrolami, struktura taktiky přečtená celá (11 míst)${logo ? `, obrázek ${logo[0]} × ${logo[1]}` : ''}`, /je přečtený/.test(t) && (t.match(/kontrolní součet obsahu sedí/g) || []).length === 3 && /Struktura taktiky \(stavba souboru\)\s+přečtena celá, každý bajt zařazen: 11 dvojic bloků[^;]*; 11 míst očíslovaných 0 až 10/.test(t), t.slice(0, 600));
    }
  }

  check('21 bez chyb ve skriptu a v konzoli', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
