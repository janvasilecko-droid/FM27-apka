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
    // Chrome nahlásí hlasy se zpožděním; obrazovka s výběrem hlasu se podle toho překreslí.
    if (FM27.bus) FM27.bus.emit('voices');
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
    resetPolicy: () => {
      if (policy) policy.reset();
      if (notifyPolicy) notifyPolicy.reset();
    },

    /** Tlačítko „Vyzkoušet hlas“ v nastavení: mluví vždy, jen tichý režim ho zastaví. */
    async test(app) {
      const s = app.settings().voice;
      if (!voice.available()) return FM27.ui.toast('Hlasový výstup tady není k dispozici.');
      if (s.quiet) return FM27.ui.toast('Tichý režim je zapnutý, hlas je vypnutý.');
      if (!voice.hasCzech()) FM27.ui.toast('V tomto zařízení není česká hlasová zásoba. Použije se výchozí hlas, a ten může česky znít divně.', 6000);
      await voice.say('Pozor, soupeř začal opakovaně využívat prostor za pravým obráncem.', s);
    },

    // ---------------------------------------------------------------- hlasový vstup (jen samostatná verze)
    // v desktopové aplikaci (Electron) rozpoznávání řeči z Chromia nefunguje (chybí klíče služby), proto se tam hlasový vstup nenabízí
    recognitionAvailable: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !(FM27.app && FM27.app.desktop && FM27.app.desktop.noSpeechRecognition),
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
  // -------------------------------------------------------------------- systémová oznámení (jen samostatná verze)
  /** Důležité upozornění jako oznámení systému, ale jen když je okno aplikace skryté (jinak by se zdvojilo s textem a hlasem).
      Funguje, dokud je aplikace otevřená (i skrytá za hrou). Oznámení na zavřený telefon vyžaduje server a není součástí aplikace. */
  const notifyPolicy = A ? A.createAlertPolicy() : null;
  const notify = (FM27.notify = {
    available: () => typeof window.Notification === 'function',
    permission: () => (notify.available() ? window.Notification.permission : 'unsupported'),
    /** Zeptá se prohlížeče (musí se volat z kliknutí). Vrací 'granted' | 'denied' | 'default' | 'unsupported'. */
    async request() {
      if (!notify.available()) return 'unsupported';
      try {
        const r = await window.Notification.requestPermission();
        return r || notify.permission();
      } catch (e) {
        return notify.permission();
      }
    },
    /** alert: nález z Live Coache {id, severity, title, text}. Vrací {shown, reason}. */
    show(app, alert) {
      const s = app.settings().notify || {};
      if (!s.enabled) return { shown: false, reason: 'off' };
      if (!notify.available() || notify.permission() !== 'granted') return { shown: false, reason: 'no_permission' };
      if (alert.severity !== 'alert') return { shown: false, reason: 'too_minor' };
      if (!document.hidden) return { shown: false, reason: 'visible' };
      // Stejná pravidla jako u hlasu: tichý režim, odstup mezi hlášeními, žádná duplicita téhož nálezu.
      const v = app.settings().voice;
      const id = alert.episode || alert.id;
      const now = Date.now();
      const d = notifyPolicy.decide({ id, severity: 'alert', text: alert.text }, { enabled: true, quiet: v.quiet, frequency: v.frequency }, now);
      if (!d.speak) return { shown: false, reason: d.reason };
      const body = A ? A.shortenForSpeech(alert.text, 180) : String(alert.text || '').slice(0, 180);
      const sent = notify.send('FM27 Coach: ' + alert.title, { body, tag: id || undefined });
      if (sent.ok) notifyPolicy.record({ id }, now);
      return { shown: sent.ok, reason: sent.ok ? 'ok' : 'error', via: sent.via, pending: sent.pending };
    },

    /** Pošle oznámení. Počítač ho vytvoří přímo; Chrome na Androidu to neumí (výjimka „Illegal constructor“) a vyžaduje
        service worker. Vrací {ok, via, pending}: ok je jisté jen u přímého vytvoření, u service workeru dává výsledek `pending`. */
    send(title, options) {
      try {
        new window.Notification(title, options);
        return { ok: true, via: 'page', pending: Promise.resolve(true) };
      } catch (e) {
        const sw = navigator.serviceWorker && navigator.serviceWorker.getRegistration;
        if (!sw) return { ok: false, via: 'none', pending: Promise.resolve(false) };
        const pending = navigator.serviceWorker
          .getRegistration()
          .then((reg) => (reg && reg.showNotification ? reg.showNotification(title, options).then(() => true) : false))
          .catch(() => false);
        return { ok: true, via: 'serviceWorker', pending };
      }
    },

    /** Zkušební oznámení z Nastavení: ukáže, jestli oznámení opravdu dorazí (sama volba v Nastavení to nezaručuje). */
    async test() {
      if (!notify.available()) return { ok: false, reason: 'unsupported' };
      if (notify.permission() !== 'granted') return { ok: false, reason: 'no_permission' };
      const sent = notify.send('FM27 Coach', { body: 'Zkušební oznámení. Takhle se ukáže důležité upozornění, když je okno aplikace skryté.', tag: 'fm27-test' });
      const ok = sent.ok ? await sent.pending : false;
      return { ok: !!ok, reason: ok ? 'ok' : 'error', via: sent.via };
    },
  });
})();
