/* Jen samostatná verze (mimo Claude): označí aplikaci jako samostatnou, zaregistruje service worker
   a zachytí nabídku instalace. Stránka v Claude tenhle soubor nemá. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  FM27.app.standalone = true;
  // Desktopová aplikace pro Windows (desktop/) vloží před stránku `window.fm27desktop`: jen příznaky (verze, systém), žádné funkce Node.js ani Electronu.
  FM27.app.desktop = window.fm27desktop && window.fm27desktop.isDesktop === true ? window.fm27desktop : null;
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
