/* Scénář 21: ČTENÍ SOUBORU .fmf (Moje taktiky → Import).
   Co se zkouší: soubor se rozšifruje a rozbalí v prohlížeči (WebCrypto AES-CTR, zstd), ukáže se název, obrázek, velikosti a výsledky kontrol; poškozený soubor se nepřečte;
   starší nebo cizí soubor jde na původní kontrolu; nic se neposílá do AI a nic z obsahu taktiky ani přezdívky autora se neuloží do úložiště ani do zprávy o souboru.
   Soubory jsou SYNTETICKÉ (zapisovač podle ověřeného formátu). Když je nastavená proměnná FMF_SAMPLES_DIR, přečtou se i skutečné exporty z FM27 z toho adresáře
   (do repozitáře nepatří) a ověří se totéž.
   Co se NEzkouší: pole taktiky uvnitř .tac (zatím se nedekódují) a nic proti hře samotné. */
const fs = require('fs');
const path = require('path');
const B = require('../../fixtures/fmf_builder.cjs');

module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, text } = h;
  if (!process.env.FZSTD_DIR) {
    console.log('PŘESKOČENO 21: chybí FZSTD_DIR (knihovna zstd pro zkoušku)');
    return;
  }
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
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacFmfFile');
  const upload = async (name, buffer) => {
    await page.setInputFiles('#tacFmfFile', { name, mimeType: 'application/octet-stream', buffer });
  };
  const note = () => text(page, '#tacImportBox');

  // ====================================================== A) syntetický export
  const std = B.standardFmf(5);
  await upload('Testovaci_taktika.fmf', std.file);
  await page.waitForSelector('#fmfReadBanner', { timeout: 15000 });
  const rows = await text(page, '#fmfReadRows');
  check('21 soubor se přečte: banner „je přečtený“ a řekne, že se nic neposílá ven ani do AI', /je přečtený/.test(await text(page, '#fmfReadBanner')) && /nic se neposílá na internet ani do AI/.test(await text(page, '#fmfReadBanner')), await text(page, '#fmfReadBanner'));
  check('21 řádky: název z manifestu, autor „neověřeno“, velikost souboru a velikosti zdrojů před a po rozbalení', new RegExp(`Název taktiky \\(z manifestu\\)\\s+${B.TITLE}`).test(rows) && /Autor \(podle souboru, neověřeno\)\s+autor_test/.test(rows) && new RegExp(`Velikost souboru\\s+${std.file.length} B`).test(rows) && new RegExp(`Taktika \\(\\.tac\\)\\s+${std.recs[1].rec.length} B zašifrováno → ${std.recs[1].content.length} B rozbaleno, kontroly sedí`).test(rows), rows);
  check('21 pole taktiky se výslovně označí jako nedekódovaná a neověřená', /Pole taktiky \(formace, role, instrukce…\)\s+zatím nedekódována, nic z nich není ověřeno/.test(rows), rows);
  check('21 obrázek z PNG v souboru se ukáže (5 × 3 bodů)', await page.evaluate(() => { const i = document.querySelector('#fmfLogo'); return !!i && i.complete && i.naturalWidth === 5 && i.naturalHeight === 3; }));
  check('21 ověřená tvrzení jsou vypsaná (hlavička, manifest, součty)', /kontrolní součet zstd souhlasí u 3 z nich/.test(await text(page, '#fmfVerified')) && /payload taktiky začíná značkou „cat\.“ a obsahuje stejný název/.test(await text(page, '#fmfVerified')), await text(page, '#fmfVerified'));
  const calls = await page.evaluate(() => window.__mock.calls.length);
  check('21 čtení souboru nevolá AI', calls === 0, calls);

  // ---------- zpráva o souboru: jen velikosti a výsledky kontrol
  await page.evaluate(() => { window.__mock.saves.length = 0; });
  await page.click('#fmfSaveReport');
  await until(async () => (await page.evaluate(() => window.__mock.saves.length)) === 1);
  const saved = await page.evaluate(() => window.__mock.saves[0]);
  const report = saved ? JSON.parse(saved.text) : null;
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

  // ====================================================== D) skutečné exporty z FM27 (jen když je zadaný adresář; soubory nejsou v repozitáři)
  const dir = process.env.FMF_SAMPLES_DIR;
  if (dir && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.fmf'))) {
      const buf = fs.readFileSync(path.join(dir, f));
      await upload(f, buf);
      await until(async () => /je přečtený|nepodařilo se ho přečíst|nebyl interpretován/.test(await note()), 15000);
      const t = await note();
      const logo = await page.evaluate(() => { const i = document.querySelector('#fmfLogo'); return i ? [i.naturalWidth, i.naturalHeight] : null; });
      check(`21 skutečný export „${f.slice(0, 28)}“: přečtený, tři zdroje s kontrolami${logo ? `, obrázek ${logo[0]} × ${logo[1]}` : ''}`, /je přečtený/.test(t) && (t.match(/kontroly sedí/g) || []).length === 3, t.slice(0, 300));
    }
  }

  check('21 bez chyb ve skriptu a v konzoli', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();
};
