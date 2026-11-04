/* Jen samostatná verze (mimo Claude): označí aplikaci jako samostatnou, zaregistruje service worker
   a zachytí nabídku instalace. Stránka v Claude tenhle soubor nemá. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  FM27.app.standalone = true;
  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* bez service workeru aplikace funguje dál, jen ne offline */
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    FM27.installPrompt = e;
    FM27.bus.emit('installable');
  });
  window.addEventListener('appinstalled', () => {
    FM27.installPrompt = null;
    FM27.bus.emit('installable');
  });
})();
