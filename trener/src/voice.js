/* Hlasový trenér: čte krátká upozornění česky a (jen v samostatné verzi) umí poslouchat otázku.
   Kdy smí mluvit, rozhoduje alerts.js (četnost, odstup, tichý režim). Tady je jen napojení na prohlížeč.
   Stránka v Claude mikrofon nepouští, proto je hlasový vstup jen v samostatné verzi. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const A = window.TrenerAlerts;
  const synth = window.speechSynthesis || null;
  const policy = A ? A.createAlertPolicy() : null;
  let voices = [];

  function loadVoices() {
    try {
      voices = synth ? synth.getVoices() : [];
    } catch (e) {
      voices = [];
    }
  }
  if (synth) {
    loadVoices();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
  }

  const voice = (FM27.voice = {
    available: () => !!(synth && typeof window.SpeechSynthesisUtterance === 'function' && policy),
    voices: () => voices.slice(),
    czechVoices: () => voices.filter((v) => /^cs([-_]|$)/i.test(v.lang)),
    hasCzech: () => voice.czechVoices().length > 0,
    pick(uri) {
      const cz = voice.czechVoices();
      return cz.find((v) => v.voiceURI === uri) || cz[0] || null;
    },

    /** Přečte text nahlas. Vrací true, když řeč doběhla, false při chybě. Neptá se na pravidla (to dělá alert). */
    say(text, o) {
      return new Promise((resolve) => {
        if (!voice.available()) return resolve(false);
        const opts = Object.assign({ volume: 0.9, rate: 1, voiceURI: '' }, o);
        try {
          const u = new window.SpeechSynthesisUtterance(String(text));
          u.lang = 'cs-CZ';
          u.volume = Math.min(1, Math.max(0, Number(opts.volume)));
          u.rate = Math.min(1.5, Math.max(0.6, Number(opts.rate)));
          const v = voice.pick(opts.voiceURI);
          if (v) u.voice = v;
          u.onend = () => resolve(true);
          u.onerror = () => resolve(false);
          synth.speak(u);
        } catch (e) {
          resolve(false);
        }
      });
    },

    /** Upozornění z Live Coache: projde pravidly a případně se přečte. Vrací rozhodnutí {speak, reason, text}. */
    async alert(app, alert) {
      const s = app.settings().voice;
      const now = Date.now();
      const d = policy.decide(alert, s, now);
      if (!d.speak) return d;
      if (!voice.available()) return { speak: false, reason: 'unavailable', text: d.text };
      policy.record(alert, now);
      voice.say(d.text, s);
      return d;
    },
    stop() {
      try {
        if (synth) synth.cancel();
      } catch (e) {
        /* nic */
      }
    },
    resetPolicy: () => policy && policy.reset(),

    /** Tlačítko „Vyzkoušet hlas“ v nastavení: mluví vždy, jen tichý režim ho zastaví. */
    async test(app) {
      const s = app.settings().voice;
      if (!voice.available()) return FM27.ui.toast('Hlasový výstup tady není k dispozici.');
      if (s.quiet) return FM27.ui.toast('Tichý režim je zapnutý, hlas je vypnutý.');
      if (!voice.hasCzech()) FM27.ui.toast('V tomto zařízení není česká hlasová zásoba. Použije se výchozí hlas, a ten může česky znít divně.', 6000);
      await voice.say('Pozor, soupeř začal opakovaně využívat prostor za pravým obráncem.', s);
    },

    // ---------------------------------------------------------------- hlasový vstup (jen samostatná verze)
    recognitionAvailable: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    /** Poslechne jednu větu. Vrací {stop()}. onResult(text), onEnd(), onError(kód). */
    listen(o) {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Rec) {
        if (o.onError) o.onError('unavailable');
        return { stop() {} };
      }
      const rec = new Rec();
      rec.lang = 'cs-CZ';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const text = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
        if (text && o.onResult) o.onResult(text.trim());
      };
      rec.onerror = (e) => o.onError && o.onError(e.error || 'error');
      rec.onend = () => o.onEnd && o.onEnd();
      try {
        rec.start();
      } catch (e) {
        if (o.onError) o.onError('start_failed');
      }
      return {
        stop() {
          try {
            rec.stop();
          } catch (e) {
            /* nic */
          }
        },
      };
    },
  });
})();
