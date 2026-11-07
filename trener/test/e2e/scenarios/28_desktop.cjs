/* Scénář 28: STRÁNKA V DESKTOPOVÉ APLIKACI PRO WINDOWS (desktop/). Obal vloží před stránku `window.fm27desktop` (jen příznaky); zkouška ho nasimuluje a ověří, že stránka
   (1) poznává desktop a mluví pravdu o tom, jak se okno hry načítá (aplikace si ho najde sama, nic se nepřidá do prohlížeče), (2) nenabízí hlasový vstup, který v Electronu
   nefunguje, a (3) nepošle k přečtení snímek, který je celý černý (hra na celou obrazovku výhradním režimem se nedá nasnímat).
   Co se NEzkouší: samotný Electron, výběr okna a instalátor (to dělá desktop/test/smoke.cjs a sestavení na GitHubu); skutečný Football Manager. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, text } = h;

  // ====================================================== A) desktopová aplikace
  const c = await newContext(browser, { standalone: true, captureCanvas: true });
  await c.context.addInitScript(() => {
    window.fm27desktop = Object.freeze({ isDesktop: true, platform: 'win32', version: '1.0.0', electron: '45.2.3', noSpeechRecognition: true });
    window.webkitSpeechRecognition = function () {}; // v Chromiu existuje, v Electronu ale nefunguje
  });
  const page = c.page;
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacGrab');
  check('28 stránka pozná desktopovou aplikaci a je to samostatná verze', await page.evaluate(() => !!window.FM27.app.desktop && window.FM27.app.desktop.version === '1.0.0' && window.FM27.app.standalone === true));
  check('28 v Nastavení je u sdílení obrazovky, že si aplikace okno hry najde sama', await page.evaluate(() => /aplikace pro Windows si okno hry najde sama/.test(window.FM27.live.captureReason())));
  check('28 tlačítko „Načíst z okna hry“ říká, že si aplikace najde okno Football Manageru sama a snímá jen po kliknutí', /najde okno Football Manageru sama/.test((await page.getAttribute('#tacGrab', 'title')) || '') && /jen po tomto kliknutí/.test((await page.getAttribute('#tacGrab', 'title')) || ''));
  await page.click('#loadBtn');
  await page.waitForSelector('#loadLead');
  check('28 panel „Načíst“ neříká „prohlížeč se zeptá“, ale že aplikace okno Football Manageru najde sama', /najde sama/.test(await text(page, '#loadLead')) && !/sdílíš okno hry/.test(await text(page, '#loadLead')), await text(page, '#loadLead'));
  await page.click('#drawerClose');
  check('28 hlasový vstup se nenabízí (rozpoznávání řeči z Chromia v Electronu nefunguje), i když ho prohlížeč hlásí', await page.evaluate(() => window.FM27.voice.recognitionAvailable() === false && !!window.webkitSpeechRecognition));

  // ---------- černý snímek (hra na celou obrazovku výhradním režimem)
  await page.evaluate(() => {
    window.__goodShare = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 640, 360);
      const stream = canvas.captureStream(5);
      setTimeout(() => ctx.fillRect(0, 0, 640, 360), 60);
      return stream;
    };
    window.__mock.calls = [];
  });
  await page.click('#tacGrab');
  await page.waitForFunction(() => /celé černé/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
  const toast = await text(page, '#toast');
  check('28 černý snímek se nepošle k přečtení a aplikace řekne proč a co udělat (okno nebo režim bez okrajů)', /celé černé/.test(toast) && /do okna nebo do režimu bez okrajů/.test(toast), toast);
  check('28 po černém snímku se nic nepřečetlo a nic se nevolalo na AI', (await page.evaluate(() => window.__mock.calls.length)) === 0 && !/Snímek okna hry je připravený/.test(await text(page, '#tacReadStatus')));
  // zrušený výběr okna: v Electronu to Chromium hlásí jako AbortError „Invalid capture constraints“; aplikace to řekne lidsky
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw Object.assign(new Error('Invalid capture constraints'), { name: 'AbortError' });
    };
  });
  await page.click('#tacGrab');
  await page.waitForFunction(() => /Okno hry se nevybralo/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
  check('28 zrušený výběr okna (AbortError z Electronu) se ohlásí „Okno hry se nevybralo, nic se nenačetlo“, ne anglickou chybou', !/Invalid capture/.test(await text(page, '#toast')) && /nic se nenačetlo/.test(await text(page, '#toast')), await text(page, '#toast'));
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = window.__goodShare;
  });
  await page.click('#tacGrab');
  await page.waitForFunction(() => /Snímek okna hry je připravený/.test(document.querySelector('#tacReadStatus').textContent), null, { timeout: 8000 });
  check('28 normální snímek se po tom načte jako dřív', /Snímek okna hry je připravený/.test(await text(page, '#tacReadStatus')));
  check('28 bez chyb ve skriptu a v konzoli (kromě blokovaných zdrojů)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();

  // ====================================================== B) obyčejný prohlížeč zůstává, jak byl
  const w = await newContext(browser, { standalone: true, captureCanvas: true });
  await w.context.addInitScript(() => {
    window.webkitSpeechRecognition = function () {};
  });
  await open(w.page, 'taktiky');
  await w.page.fill('#careerClub', 'Chelsea');
  await w.page.click('#careerCreate');
  await w.page.waitForSelector('#tacGrab');
  check('28 v obyčejném prohlížeči je desktop vypnutý, hlasový vstup se nabízí a tlačítko ví, že se prohlížeč zeptá na okno', await w.page.evaluate(() => window.FM27.app.desktop === null && window.FM27.voice.recognitionAvailable() === true) && /Prohlížeč se zeptá/.test((await w.page.getAttribute('#tacGrab', 'title')) || ''));
  await w.context.close();
};
