/* Live Coach: jádro sledování zápasu (zadání § 2). Dostane snímek obrazovky (vložený, nahraný, vyfocený, nebo ze sdílení okna),
   rozhodne, jestli ho vůbec poslat (brána změn a rozpočet), nechá model přečíst, co je čitelné (vždy jako neověřené),
   uloží ho do časové osy zápasu a spustí detektory. Nic se tu neposílá bez výslovné akce uživatele
   (vložení snímku nebo zapnutí sdílení) a sledování jde kdykoli pozastavit i zastavit. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const A = () => window.TrenerAnalysis;

  const MAX_TIMELINE = 120;
  const GRAY_W = 64;
  const GRAY_H = 36;
  const MATCH_KEY = 'fm27.liveMatch';

  const live = (FM27.live = {
    session: { matchId: null, gate: null, lastGray: null, manualCount: 0, busy: false, active: new Map(), alerts: [], capture: null, lastResult: null },
  });

  // ------------------------------------------------------------------ obrázky
  async function decode(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob);
      } catch (e) {
        /* zkusí se klasické načtení */
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Soubor není obrázek, který bych uměl přečíst.'));
      };
      img.src = url;
    });
  }
  const dims = (img) => ({ w: img.width || img.naturalWidth, h: img.height || img.naturalHeight });

  /** Zmenšený šedotónový otisk snímku pro zjištění změn (nikam se neposílá). */
  function grayOf(source, w, h) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 144;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h, 0, 0, 256, 144);
    return A().downscaleGray(ctx.getImageData(0, 0, 256, 144).data, 256, 144, GRAY_W, GRAY_H);
  }

  /** Obrázek k odeslání: velký se zmenší (nejdelší strana 2000 px) a převede na JPEG, ať se vejde do limitu. */
  async function prepare(blob, maxBytes) {
    const img = await decode(blob);
    const { w, h } = dims(img);
    if (!w || !h) throw new Error('Obrázek nemá rozměry.');
    const gray = grayOf(img, w, h);
    const scale = Math.min(1, 2000 / Math.max(w, h));
    const limit = maxBytes ? maxBytes * 0.9 : Infinity;
    let out = blob;
    if (scale < 1 || blob.size > limit || !/^image\/(png|jpeg|webp)$/.test(blob.type)) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Obrázek se nepodařilo zmenšit.'))), 'image/jpeg', 0.86));
    }
    if (img.close) img.close();
    return { blob: out, gray, width: w, height: h };
  }

  // ------------------------------------------------------------------ zápas
  const matchOf = (app) => (live.session.matchId ? app.store.get('match', live.session.matchId) : null);
  live.match = matchOf;

  live.activeMatchId = (app) => {
    const id = ui.lsGet(MATCH_KEY, null);
    const m = id ? app.store.get('match', id) : null;
    return m && m.status === 'live' && app.career() && m.careerId === app.career().id ? id : null;
  };

  function makeGate(app) {
    const s = app.settings().live;
    return A().createFrameGate({ baseIntervalMs: s.baseIntervalSec * 1000, maxPerHour: s.maxPerHour, maxPerMatch: s.maxPerMatch });
  }

  /** Nastaví zápas jako sledovaný: nová brána, prázdná paměť upozornění. */
  live.begin = (app, matchId) => {
    const s = live.session;
    live.stopCapture();
    s.matchId = matchId;
    s.gate = makeGate(app);
    s.lastGray = null;
    s.manualCount = 0;
    s.active = new Map();
    s.alerts = [];
    s.lastResult = null;
    ui.lsSet(MATCH_KEY, matchId);
    if (FM27.voice) FM27.voice.resetPolicy();
    const m = app.store.get('match', matchId);
    // Nálezy, které už na osě jsou, se nehlásí znovu jako nové.
    if (m && m.timeline && m.timeline.length && A()) for (const f of A().detectProblems(A().sortTimeline(m.timeline), { mySide: m.mySide, now: Date.now() })) s.active.set(f.episode || f.id, f.severity);
  };
  live.end = (app) => {
    live.stopCapture();
    live.session.matchId = null;
    ui.lsSet(MATCH_KEY, null);
  };

  /** Zahodí všechno, co relace drží v paměti (sdílení, upozornění, bránu); používá se při smazání všech dat. */
  live.reset = () => {
    live.stopCapture();
    const s = live.session;
    Object.assign(s, { matchId: null, gate: null, lastGray: null, manualCount: 0, busy: false, active: new Map(), alerts: [], lastResult: null });
    if (FM27.voice) FM27.voice.resetPolicy();
  };

  live.createMatch = async (app, f) => {
    const career = app.career();
    const opponent = String(f.opponent || '').trim();
    if (!opponent) throw new Error('Napiš jméno soupeře.');
    const saved = await app.store.put('match', {
      careerId: career.id,
      opponent: opponent.slice(0, 80),
      competition: String(f.competition || '').trim().slice(0, 80),
      mySide: f.mySide === 'away' ? 'away' : 'home',
      date: Date.now(),
      status: 'live',
      result: null,
      timeline: [],
      changes: [],
      notes: '',
      analysis: null,
      startedAt: Date.now(),
    });
    live.begin(app, saved.id);
    return saved;
  };

  async function saveMatch(app, mutate, matchId) {
    const m = matchId ? app.store.get('match', matchId) : matchOf(app);
    if (!m) throw new Error('Žádný zápas se nesleduje.');
    const draft = app.store.draft(m);
    mutate(draft);
    return app.store.put('match', draft);
  }
  live.saveMatch = saveMatch;

  live.finish = (app, result) => saveMatch(app, (m) => ((m.status = 'finished'), (m.endedAt = Date.now()), (m.result = result || m.result)));

  // ------------------------------------------------------------------ nálezy a upozornění
  live.findings = (match) => (A() && match && match.timeline.length ? A().detectProblems(A().sortTimeline(match.timeline), { mySide: match.mySide, now: Date.now() }) : []);

  function findingToAlert(f) {
    return { id: f.episode || f.id, severity: f.severity === 'alert' ? 'alert' : 'watch', text: `${f.title}. ${f.text}` };
  }

  /** Které nálezy jsou nové: nová epizoda (stav, který na předchozím snímku nebyl) nebo zhoršení ze „sleduj“ na upozornění.
      Trvající stav se na dalších snímcích nehlásí znovu; zmizí-li a vrátí se, je to zase nová epizoda. */
  function freshFindings(s, findings) {
    const fresh = [];
    const next = new Map();
    for (const f of findings) {
      const key = f.episode || f.id;
      if (next.has(key)) continue;
      next.set(key, f.severity);
      const was = s.active.get(key);
      if (was === undefined || (was !== 'alert' && f.severity === 'alert')) fresh.push(f);
    }
    s.active = next;
    return fresh;
  }
  live.freshFindings = freshFindings;

  /** Nové nálezy: zapíše je do upozornění relace a nechá je přečíst hlasem (podle pravidel četnosti a ztišení). */
  async function announce(app, findings) {
    const s = live.session;
    const fresh = freshFindings(s, findings);
    for (const f of fresh) {
      const entry = { at: Date.now(), finding: f, spoken: false, notified: false, reason: '' };
      s.alerts.unshift(entry);
      if (app.settings().live.autoAlerts) {
        if (FM27.voice) {
          const d = await FM27.voice.alert(app, findingToAlert(f));
          entry.spoken = !!d.speak;
          entry.reason = d.reason;
        }
        if (FM27.notify) {
          const n = FM27.notify.show(app, f);
          entry.notified = n.shown && n.via !== 'serviceWorker';
          // Přes service worker (Android) je výsledek znám až za chvíli; štítek „oznámeno“ se doplní, až se oznámení opravdu zobrazí.
          if (n.shown && n.pending) n.pending.then((ok) => (entry.notified = !!ok));
        }
      }
    }
    s.alerts = s.alerts.slice(0, 30);
    return fresh;
  }

  // ------------------------------------------------------------------ příjem snímku
  /** Vrací {status: 'added'|'skipped'|'unreadable'|'error', reason, message, snapshot, issues, findings, newFindings}.
      opts: {source: 'manual'|'screen', gray (u sdílení, už spočítaný), signal} */
  live.ingest = async function ingest(app, blob, opts) {
    const o = Object.assign({ source: 'manual' }, opts);
    const s = live.session;
    const ai = FM27.ai;
    const match = matchOf(app);
    if (!match) return { status: 'error', reason: 'no_match', message: 'Nejdřív začni zápas.' };
    const matchId = match.id; // snímek patří zápasu, při jehož čtení vznikl, i kdyby se mezitím začal jiný
    const changed = () => live.session.matchId !== matchId;
    const changedResult = { status: 'skipped', reason: 'match_changed', message: 'Zápas se mezitím ukončil nebo změnil, snímek se nepřidal.' };
    if (s.busy) return { status: 'skipped', reason: 'busy', message: 'Předchozí snímek se ještě čte.' };
    if (!ai.available || !ai.imagesSupported) return { status: 'error', reason: 'no_vision', message: 'Čtení obrazu tady není dostupné. Zadej údaje ručně.' };
    s.busy = true;
    try {
      const limits = ai.limitsInfo.images;
      const prepared = await prepare(blob, limits.maxInputBytes);
      if (o.source === 'manual') {
        const per = app.settings().live.maxPerMatch;
        if (s.manualCount >= per) return { status: 'skipped', reason: 'budget_match', message: `Dosažen limit ${per} snímků na zápas (změníš ho v Nastavení).` };
        if (s.lastGray && A().frameDiff(s.lastGray, prepared.gray) < 0.01) return { status: 'skipped', reason: 'unchanged', message: 'Tenhle snímek je skoro stejný jako poslední, nic nového. Neposílám ho znovu.' };
      }
      s.lastGray = prepared.gray;
      s.manualCount++;
      const sorted = A().sortTimeline(match.timeline);
      const last = sorted.length ? sorted[sorted.length - 1] : null;
      const raw = await ai.json(A().buildExtractionPrompt({ mySide: match.mySide, knownMinute: last ? last.minute : null }), {
        modelTier: 'quick',
        images: [prepared.blob],
        cache: false,
        signal: o.signal,
        purpose: 'čtení snímku',
      });
      if (changed()) return changedResult;
      const at = Date.now();
      const { snapshot, issues } = A().normalizeExtraction(raw, { id: 'snap-' + at.toString(36), at });
      if (!snapshot) return { status: 'unreadable', reason: 'unreadable', message: 'Na snímku jsem nic spolehlivě nepřečetl.', issues };
      const saved = await saveMatch(
        app,
        (m) => {
          m.timeline.push(snapshot);
          while (m.timeline.length > MAX_TIMELINE) m.timeline.shift();
        },
        matchId
      );
      const findings = live.findings(saved);
      const newFindings = await announce(app, findings);
      if (s.gate) s.gate.noteResult({ important: newFindings.some((f) => f.severity === 'alert') });
      return { status: 'added', snapshot, issues, findings, newFindings };
    } catch (e) {
      if (e && e.code === 'cancelled') return { status: 'skipped', reason: 'cancelled', message: 'Zastaveno.' };
      return { status: 'error', reason: (e && e.code) || 'error', message: e && e.code ? ai.errorText(e) : (e && e.message) || String(e) };
    } finally {
      s.busy = false;
    }
  };

  /** Ruční snímek: čísla zadá uživatel (user_entered). */
  live.addManual = async function addManual(app, fields) {
    const at = Date.now();
    const issues = [];
    const snapshot = A().makeSnapshot(Object.assign({}, fields, { id: 'snap-' + at.toString(36), at, provenance: 'user_entered', screen: fields.screen || 'stats' }), { issues });
    if (snapshot.minute === null && snapshot.score === null && !A().STAT_KEYS.some((k) => snapshot.stats.home[k] !== null || snapshot.stats.away[k] !== null)) {
      return { status: 'unreadable', message: 'Vyplň aspoň minutu, skóre nebo jednu statistiku.', issues };
    }
    const saved = await saveMatch(app, (m) => {
      m.timeline.push(snapshot);
      while (m.timeline.length > MAX_TIMELINE) m.timeline.shift();
    });
    const newFindings = await announce(app, live.findings(saved));
    return { status: 'added', snapshot, issues, newFindings };
  };

  /** Uživatel potvrdí, že přečtené hodnoty odpovídají snímku (vision_unverified → screenshot_verified). */
  live.verify = (app, snapId) =>
    saveMatch(app, (m) => {
      const s = m.timeline.find((x) => x.id === snapId);
      if (s && s.provenance === 'vision_unverified') s.provenance = 'screenshot_verified';
    });
  /** Úprava čísel uživatelem: hodnoty jsou pak jeho zadání (user_entered). */
  live.edit = (app, snapId, fields) =>
    saveMatch(app, (m) => {
      const i = m.timeline.findIndex((x) => x.id === snapId);
      if (i < 0) return;
      const old = m.timeline[i];
      const merged = A().makeSnapshot(Object.assign({}, old, fields, { id: old.id, at: old.at, provenance: 'user_entered' }));
      m.timeline[i] = merged;
    });
  live.removeSnapshot = (app, snapId) =>
    saveMatch(app, (m) => {
      m.timeline = m.timeline.filter((x) => x.id !== snapId);
    });

  // ------------------------------------------------------------------ změny a jejich vyhodnocení
  /** Zaznamená, že uživatel provedl změnu z rady. Minuta je poslední známá minuta zápasu (nebo zadaná). */
  live.recordChange = (app, item, o) => {
    const opts = Object.assign({ minute: null, recheckAfterMinutes: 0, summary: '' }, o);
    return saveMatch(app, (m) => {
      const sorted = A().sortTimeline(m.timeline);
      const lastMinute = sorted.length ? sorted[sorted.length - 1].minute : null;
      const minute = Number.isInteger(opts.minute) ? opts.minute : lastMinute;
      m.changes.push({
        id: 'chg-' + Date.now().toString(36),
        at: Date.now(),
        minute,
        summary: opts.summary || `${item.player}: ${item.setting}, z „${item.from}“ na „${item.to}“`,
        items: [{ player: item.player, setting: item.setting, from: item.from, to: item.to }],
        baselineIds: sorted.slice(-3).map((x) => x.id),
        recheckAfterMinutes: opts.recheckAfterMinutes || 0,
      });
    });
  };
  live.evaluate = (match, change) => A().evaluateChange(A().sortTimeline(match.timeline), change, { mySide: match.mySide });

  // ------------------------------------------------------------------ pozorování pro poradce z průběhu zápasu
  live.observations = function observations(match) {
    const out = [];
    const sorted = A().sortTimeline(match.timeline);
    sorted.slice(-6).forEach((s) => {
      const st = (side) => {
        const x = s.stats[side];
        const bits = [];
        if (x.possession !== null) bits.push(`držení ${x.possession} %`);
        if (x.shots !== null) bits.push(`střely ${x.shots}`);
        if (x.shotsOnTarget !== null) bits.push(`na bránu ${x.shotsOnTarget}`);
        if (x.xg !== null) bits.push(`xG ${x.xg}`);
        return bits.join(', ') || 'bez statistik';
      };
      const score = s.score ? `${s.score.home}:${s.score.away}` : 'skóre neznámé';
      out.push({
        id: s.id,
        label: s.provenance === 'screenshot_verified' ? 'screenshot_verified' : s.provenance === 'user_entered' ? 'user_entered' : 'vision_unverified',
        minute: s.minute,
        scope: 'live',
        text: `Snímek (${s.screen}), ${score}. Domácí: ${st('home')}. Hosté: ${st('away')}.${match.mySide ? ` Uživatel hraje za ${match.mySide === 'home' ? 'domácí' : 'hosty'}.` : ''}`.slice(0, 400),
      });
    });
    const findings = live.findings(match);
    for (const [i, o] of A().findingsToObservations(findings, { prefix: 'det' }).entries()) out.push(Object.assign({}, o, { id: `det-${i + 1}`, scope: 'live' }));
    return out;
  };

  // ------------------------------------------------------------------ sdílení obrazovky (jen mimo Claude, kde to prohlížeč dovolí)
  /** Štítek „SLEDUJI“ v hlavičce ukazuje skutečný stav sdílení: zapíná a vypíná ho jen tenhle modul. */
  live.setPill = (on) => {
    const el = document.querySelector('#pillLive');
    if (el) el.hidden = !on;
  };
  live.captureAvailable = () => !!(FM27.app.standalone && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

  /** hooks: {onStatus(text), onResult(result), onEnded()}. Vyžaduje výslovný souhlas uživatele (okno prohlížeče). */
  live.startCapture = async function startCapture(app, hooks) {
    const s = live.session;
    const h = hooks || {};
    if (s.capture) return s.capture;
    if (!live.captureAvailable()) throw new Error('Sdílení obrazovky tady není dostupné.');
    // Prohlížeč sám zobrazí výběr okna a souhlas. Zvuk nechceme.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 2, max: 5 } }, audio: false });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    // play() se nečeká: u sdíleného proudu může skončit až s prvním snímkem. Smyčka si počká na rozměry videa.
    video.play().catch(() => {});
    // Hooks se čtou při každém použití: po přepnutí obrazovky je nová obrazovka znovu připojí (cap.hooks = …).
    const cap = { stream, video, timer: 0, paused: false, stopped: false, frames: 0, hooks: h, ctl: new AbortController() };
    const canvas = document.createElement('canvas');
    const tick = async () => {
      if (cap.paused || cap.stopped || s.busy || !video.videoWidth) return;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0);
        cap.frames++;
        const gray = grayOf(canvas, canvas.width, canvas.height);
        const gate = s.gate.check(gray, Date.now());
        if (!gate.process) {
          if (cap.hooks.onStatus) cap.hooks.onStatus(`Sleduji. Přeskočeno: ${gate.reason}.`);
          return;
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        if (cap.hooks.onStatus) cap.hooks.onStatus('Čtu snímek…');
        const result = await live.ingest(app, blob, { source: 'screen', signal: cap.ctl.signal });
        if (cap.stopped) return; // sdílení mezitím skončilo: výsledek se nehlásí obrazovce, která už nesleduje
        if (cap.hooks.onStatus) cap.hooks.onStatus(result.status === 'added' ? 'Snímek přečten.' : result.message || 'Snímek se nepodařilo přečíst.');
        if (cap.hooks.onResult) cap.hooks.onResult(result);
      } catch (e) {
        if (cap.hooks.onStatus) cap.hooks.onStatus('Chyba při sledování: ' + ((e && e.message) || e));
      }
    };
    cap.timer = setInterval(tick, 1500);
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      live.stopCapture();
      if (cap.hooks.onEnded) cap.hooks.onEnded();
    });
    s.capture = cap;
    live.setPill(true);
    return cap;
  };
  live.pauseCapture = () => {
    const c = live.session.capture;
    if (c) {
      c.paused = true;
      if (live.session.gate) live.session.gate.pause();
      live.setPill(false);
    }
  };
  live.resumeCapture = () => {
    const c = live.session.capture;
    if (c) {
      c.paused = false;
      if (live.session.gate) live.session.gate.resume();
      live.setPill(true);
    }
  };
  live.stopCapture = () => {
    const s = live.session;
    const c = s.capture;
    if (!c) {
      live.setPill(false);
      return;
    }
    c.stopped = true;
    c.ctl.abort(); // čtení snímku, které právě běží, se zruší, aby se po Stop nic neuložilo
    live.setPill(false);
    clearInterval(c.timer);
    try {
      for (const t of c.stream.getTracks()) t.stop();
    } catch (e) {
      /* už zastaveno */
    }
    c.video.srcObject = null;
    s.capture = null;
  };
})();
