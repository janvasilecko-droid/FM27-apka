/* Pravidla hlasových upozornění (zadání § 8): krátce, jen při důležitém, nezahlcovat, jde ztišit.
   Čistá logika bez DOM a bez hlasového stroje, takže jde zkoušet v Node (test/alerts.test.mjs). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerAlerts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Odstup mezi dvěma upozněními nahlas podle zvolené četnosti. Číslo „alert“ je nejkratší odstup i pro naléhavé upozornění.
  const GAP_MS = { low: 180000, normal: 75000, high: 30000 };
  const URGENT_GAP_MS = 15000;
  const MAX_PER_10_MIN = { low: 2, normal: 4, high: 8 };
  const DUPLICATE_MS = 300000;

  /** Zkrátí text na jednu až dvě věty, aby se dal přečíst za pár vteřin. */
  function shortenForSpeech(text, max) {
    const limit = max || 200;
    const clean = String(text || '')
      .replace(/[*_`#>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length <= limit) return clean;
    const sentences = clean.match(/[^.!?…]+[.!?…]+(?:\s|$)/g) || [clean];
    let out = '';
    for (const s of sentences) {
      if ((out + s).length > limit) break;
      out += s;
    }
    if (out.trim()) return out.trim();
    return clean.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
  }

  function createAlertPolicy() {
    const spoken = []; // {at, id}
    return {
      /** alert: {id, severity: 'info'|'watch'|'alert', text}; settings: {enabled, quiet, frequency}. Vrací {speak, reason, text}. */
      decide(alert, settings, now) {
        const s = settings || {};
        const sev = alert.severity || 'info';
        const text = shortenForSpeech(alert.text);
        const no = (reason) => ({ speak: false, reason, text });
        if (!s.enabled) return no('voice_off');
        if (s.quiet) return no('quiet');
        if (!text) return no('empty');
        const freq = GAP_MS[s.frequency] ? s.frequency : 'normal';
        if (sev === 'info' && freq !== 'high') return no('too_minor');
        if (sev === 'watch' && freq === 'low') return no('too_minor');
        if (alert.id && spoken.some((x) => x.id === alert.id && now - x.at < DUPLICATE_MS)) return no('duplicate');
        const last = spoken.length ? spoken[spoken.length - 1].at : null;
        if (last !== null && now - last < (sev === 'alert' ? URGENT_GAP_MS : GAP_MS[freq])) return no('gap');
        const recent = spoken.filter((x) => now - x.at < 600000).length;
        if (sev !== 'alert' && recent >= MAX_PER_10_MIN[freq]) return no('rate');
        return { speak: true, reason: 'ok', text };
      },
      /** Zapíše, že se upozornění opravdu přečetlo. */
      record(alert, now) {
        spoken.push({ at: now, id: alert.id || null });
        while (spoken.length > 50) spoken.shift();
      },
      reset() {
        spoken.length = 0;
      },
      history: () => spoken.slice(),
    };
  }

  return { createAlertPolicy, shortenForSpeech, GAP_MS, URGENT_GAP_MS, MAX_PER_10_MIN, DUPLICATE_MS };
});
