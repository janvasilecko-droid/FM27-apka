/* Spuštění aplikace: všechny moduly a obrazovky už jsou načtené. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  FM27.app
    .init()
    .catch((e) => {
      console.error('Aplikace se nespustila', e);
      window.__trenerError = String((e && e.stack) || e);
      FM27.ui.toast('Aplikace se nespustila: ' + ((e && e.message) || e), 10000);
    })
    .finally(() => {
      window.__trenerReady = true;
    });
})();
