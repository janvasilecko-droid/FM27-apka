/* Napojení na FMMatchLens (zásuvný modul do hry, licence MIT, https://github.com/osnsyc/FMMatchLens): živá data zápasu a sestava z lokální adresy.
   Aplikace se připojuje JEN na tento počítač (127.0.0.1 nebo localhost; kontrola v matchlens.js), čte data pluginu bez AI a bez snímání obrazovky a skládá z nich
   časovou osu zápasu. Nikam nic neposílá a do hry nezasahuje. Údaje jsou „zadal uživatel“ (z nástroje, který běží u něj), ne „ověřeno hrou“.
   Tvar odpovědí pluginu je převzatý ze zdrojového kódu verze 0.7.x a NEBYL ověřen na běžící hře: u každé chyby aplikace říká, co zkontrolovat. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h, toast } = ui;
  const ML = () => window.TrenerMatchLens;

  const KEY = 'fm27.feed';
  const TIMEOUT_MS = 4000;
  const FIRST_TIMEOUT_MS = 20000; // první dotaz může čekat, až člověk klikne na povolení v prohlížeči
  const MAX_TEXT = 3000000;
  const EVERY_OPTIONS = [1, 2, 3, 5, 10];

  const listeners = new Set();
  const session = { state: 'off', timer: null, seq: 0, matchId: null, pluginMatchId: null, meta: null, health: null, frame: null, prev: null, count: 0, error: '', fails: 0, lines: [] };

  const prefs = () => Object.assign({ url: '', everyMinutes: 3, on: null }, ui.lsGet(KEY, {}) || {});
  const savePrefs = (patch) => ui.lsSet(KEY, Object.assign(prefs(), patch));
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  const feed = (FM27.feed = {
    session,
    prefs,
    // Odstupy dotazů v milisekundách (zkoušky je zkracují): dokud se zápas nehraje, během zápasu, po chybě.
    timing: { wait: 4000, live: 3000, error: 8000 },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    running: () => session.state !== 'off',
  });

  // ------------------------------------------------------------------ síť
  async function getJson(base, path, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || TIMEOUT_MS);
    try {
      const res = await fetch(base + path, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' });
      if (!res.ok) throw Object.assign(new Error('Plugin odpověděl chybou ' + res.status + '.'), { code: 'http' });
      const txt = await res.text();
      if (txt.length > MAX_TEXT) throw Object.assign(new Error('Odpověď pluginu je příliš velká.'), { code: 'too_big' });
      try {
        return JSON.parse(txt);
      } catch (e) {
        throw Object.assign(new Error('Odpověď pluginu není JSON.'), { code: 'bad_json' });
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw Object.assign(new Error('Plugin do ' + Math.round((ms || TIMEOUT_MS) / 1000) + ' s neodpověděl.'), { code: 'timeout' });
      if (e && e.code) throw e;
      throw Object.assign(new Error('Spojení s pluginem se nepodařilo.'), { code: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Co má člověk zkontrolovat, když spojení nejde. Bez hádání příčiny: jen kontrolní seznam. */
  function explain(e) {
    const base = (e && e.message) || 'Spojení s pluginem se nepodařilo.';
    if (e && (e.code === 'network' || e.code === 'timeout')) {
      return `${base} Zkontroluj: (1) hra běží a plugin FMMatchLens je v ní nainstalovaný (po spuštění hry musí být vidět v hlavním menu), (2) adresa a port jsou stejné jako v nastavení pluginu, (3) prohlížeč nezakázal přístup k tomuto počítači (pokud se zeptal, povol), (4) ve stránce v Claude to prohlížeč většinou nepustí: použij samostatnou verzi.`;
    }
    return base;
  }

  const baseUrl = () => {
    const r = ML().cleanBaseUrl(prefs().url);
    return r;
  };

  // ------------------------------------------------------------------ jednorázové zjištění
  /** Zeptá se pluginu na stav, zápas a čas. Nic neukládá do zápasu. Vrací {ok, lines, health, meta, frame, error}. */
  feed.probe = async function probe() {
    if (!ML()) return { ok: false, error: 'Chybí modul pro FMMatchLens.', lines: [] };
    const b = baseUrl();
    if (!b.ok) return { ok: false, error: b.error, lines: [{ ok: false, text: b.error }] };
    let health = null;
    try {
      health = ML().parseHealth(await getJson(b.url, '/api/health', FIRST_TIMEOUT_MS));
    } catch (e) {
      const text = explain(e);
      return { ok: false, error: text, lines: [{ ok: false, text }] };
    }
    if (!health.ok) return { ok: false, error: health.error, health, lines: ML().diagnose(health, null, null) };
    let meta = null;
    let frame = null;
    if (health.inMatch) {
      try {
        meta = ML().parseMeta(await getJson(b.url, '/api/match/meta'));
      } catch (e) {
        meta = { ok: false, error: explain(e) };
      }
      try {
        frame = ML().parseFrame(await getJson(b.url, '/api/match/current'));
      } catch (e) {
        frame = { ok: false, error: explain(e) };
      }
    }
    return { ok: true, health, meta, frame, url: b.url, lines: ML().diagnose(health, meta, frame) };
  };

  // ------------------------------------------------------------------ sledování zápasu
  const stopTimer = () => {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
  };

  /** Zastaví sledování. `keepWanted` ponechá u zápasu příznak „sledovat“ (používá se při novém načtení obrazovky, aby šlo navázat). */
  feed.stop = function stop(reason, opts) {
    stopTimer();
    session.seq++;
    session.state = 'off';
    session.matchId = null;
    session.pluginMatchId = null;
    session.meta = null;
    session.prev = null;
    session.fails = 0;
    session.error = reason || ''; // po ručním zastavení se neukazuje stará chyba
    if (!(opts && opts.keepWanted) && prefs().on) savePrefs({ on: null });
    notify();
  };

  const minuteText = (f) => (f && f.minute !== null ? `${f.minute}. min` : 'čas neznámý');

  async function tick(app, token) {
    if (token !== session.seq) return;
    const L = FM27.live;
    const match = L.session.matchId ? app.store.get('match', L.session.matchId) : null;
    if (!match || match.id !== session.matchId || match.status !== 'live') return feed.stop('Zápas se mezitím ukončil nebo změnil, sledování z pluginu se zastavilo.');
    const b = baseUrl();
    if (!b.ok) return feed.stop(b.error);
    let delay = feed.timing.live;
    try {
      const health = ML().parseHealth(await getJson(b.url, '/api/health', session.health ? TIMEOUT_MS : FIRST_TIMEOUT_MS));
      if (token !== session.seq) return;
      if (!health.ok) return feed.stop(health.error);
      session.health = health;
      session.fails = 0;
      session.error = '';
      if (!health.inMatch) {
        session.state = 'waiting';
        delay = feed.timing.wait;
      } else {
        const frame = ML().parseFrame(await getJson(b.url, '/api/match/current'));
        if (token !== session.seq) return;
        if (!frame.ok) {
          session.state = 'waiting';
          delay = feed.timing.wait;
        } else {
          const bound = match.feedMatchId || session.pluginMatchId;
          if (bound && frame.matchId && frame.matchId !== bound) return feed.stop('Plugin hlásí jiný zápas, než který sleduješ. Sledování se zastavilo, aby se údaje nesměšovaly. Ukonči zápas v aplikaci a začni nový.');
          if (!bound && frame.matchId) {
            session.pluginMatchId = frame.matchId;
            await L.saveMatch(app, (m) => (m.feedMatchId = frame.matchId), match.id);
          } else if (!session.pluginMatchId) session.pluginMatchId = bound;
          // Metadata (jména týmů a hráčů) se čtou jednou za zápas; když se poprvé nepovedou, zkusí se to znovu po 15 s.
          if (!session.meta || session.meta.matchId !== frame.matchId || (!session.meta.ok && Date.now() - session.metaAt > 15000)) {
            session.metaAt = Date.now();
            try {
              session.meta = ML().parseMeta(await getJson(b.url, '/api/match/meta'));
            } catch (e) {
              session.meta = { ok: false, error: explain(e), matchId: frame.matchId };
            }
            if (token !== session.seq) return;
            session.meta.matchId = session.meta.matchId || frame.matchId;
          }
          session.frame = frame;
          session.state = 'tracking';
          const d = ML().shouldRecord(session.prev, frame, { everyMinutes: prefs().everyMinutes });
          if (d.record) {
            const fields = ML().toSnapshotFields(frame, session.meta, { mySide: match.mySide });
            const r = await L.addFeedSnapshot(app, fields);
            if (token !== session.seq) return;
            if (r.status === 'added') {
              session.prev = d.state;
              session.count++;
              if (r.newFindings && r.newFindings.length) toast(`Nové upozornění: ${r.newFindings[0].title}`);
            }
          } else session.prev = d.state;
        }
      }
    } catch (e) {
      if (token !== session.seq) return;
      session.fails++;
      session.state = 'error';
      session.error = explain(e);
      delay = session.fails > 5 ? feed.timing.error * 2 : feed.timing.error;
    }
    notify();
    session.timer = setTimeout(() => tick(app, token), delay);
  }

  /** Zapne sledování aktuálního zápasu podle dat pluginu. Zápas musí už existovat (Live Coach: „Začít sledovat zápas“). */
  feed.start = function start(app) {
    const L = FM27.live;
    const id = L.session.matchId;
    const match = id ? app.store.get('match', id) : null;
    if (!match || match.status !== 'live') return { ok: false, error: 'Nejdřív začni zápas.' };
    if (!ML()) return { ok: false, error: 'Chybí modul pro FMMatchLens.' };
    const b = baseUrl();
    if (!b.ok) return { ok: false, error: b.error };
    stopTimer();
    session.seq++;
    const token = session.seq;
    Object.assign(session, { state: 'connecting', matchId: id, pluginMatchId: match.feedMatchId || null, meta: null, frame: null, error: '', fails: 0, count: 0 });
    // Po novém načtení stránky se pokračuje od posledního snímku z pluginu, ať se nezdvojují.
    const lastFeed = (match.timeline || []).filter((s) => s.via === 'fmmatchlens' && s.minute !== null).sort((a, c) => a.minute - c.minute).pop();
    session.prev = lastFeed ? { minute: lastFeed.minute, score: lastFeed.score ? [lastFeed.score.home, lastFeed.score.away] : null, reds: [null, null], period: null } : null;
    savePrefs({ on: id });
    notify();
    tick(app, token);
    return { ok: true };
  };

  /** Po novém načtení stránky naváže na sledování, které uživatel u tohoto zápasu zapnul. */
  feed.resumeIfWanted = function resumeIfWanted(app) {
    const id = FM27.live.session.matchId;
    if (!id || session.state !== 'off' || prefs().on !== id) return false;
    return feed.start(app).ok;
  };

  // ------------------------------------------------------------------ sestava z pluginu
  /** Načte sestavu mé strany z pluginu. Vrací {ok, error, result:{players, count, issues, skipped}, side, meta}. */
  feed.readSquad = async function readSquad(app, side) {
    const p = await feed.probe();
    if (!p.ok) return { ok: false, error: p.error };
    if (!p.health.inMatch || !p.meta || !p.meta.ok) return { ok: false, error: 'Plugin zatím žádný zápas nehlásí. Sestavu dodá, až bude zápas ve hře načtený.' };
    const mySide = side || p.meta.humanSide;
    if (!mySide) return { ok: false, error: 'Z dat se nepozná, který tým je tvůj. Vyber stranu.', needSide: true, meta: p.meta };
    const existing = FM27.context.players(app);
    const result = ML().squadPlayers(p.meta, mySide, p.frame, { existingNames: existing.map((x) => x.name), max: Math.max(0, 60 - existing.length) });
    if (!result) return { ok: false, error: 'V datech pluginu u tohoto týmu nejsou žádní hráči.' };
    return { ok: true, result, side: mySide, meta: p.meta };
  };

  feed.addSquad = async function addSquad(app, players) {
    let n = 0;
    for (const p of players) {
      await app.store.put('player', { careerId: app.career().id, name: p.name, positions: p.positions, role: p.role, duty: p.duty, foot: 'unknown', age: p.age, attributes: p.attributes, strengths: [], weaknesses: [], flags: { injury: p.injured, fatigue: false }, notes: p.notes, source: 'fmmatchlens', prov: { all: 'user_entered' } });
      n++;
    }
    return n;
  };

  // ------------------------------------------------------------------ karta na obrazovce
  const SIDE_CS = { home: 'domácí', away: 'hosté' };

  /** mode: 'setup' (před zápasem v Live Coachi), 'match' (během zápasu), 'squad' (Můj tým). ctx: {redraw, local}. */
  feed.card = function card(app, mode, ctx) {
    const c = ctx || {};
    const status = h('p', { class: 'hint', id: 'feedStatus', 'aria-live': 'polite' });
    const lines = h('ul', { class: 'hint', id: 'feedLines' });
    const out = h('div', { id: 'feedOut' });
    const url = ui.input({ id: 'feedUrl', maxlength: 60, placeholder: ML() ? ML().DEFAULT_URL : '', value: prefs().url });
    const every = ui.select(EVERY_OPTIONS.map((n) => [String(n), `${n} ${ui.plural(n, 'herní minuta', 'herní minuty', 'herních minut')}`]), String(prefs().everyMinutes), { id: 'feedEvery' });
    const saveFields = () => savePrefs({ url: url.value.trim(), everyMinutes: Number(every.value) || 3 });
    url.addEventListener('change', saveFields);
    every.addEventListener('change', saveFields);

    const showLines = (ls) => lines.replaceChildren(...(ls || []).map((l) => h('li', { class: l.ok ? '' : 'bad-text', text: (l.ok ? 'OK: ' : 'Pozor: ') + l.text })));

    function drawStatus() {
      const s = session;
      const txt =
        s.state === 'off' ? (s.error ? s.error : 'Sledování z pluginu je vypnuté.')
        : s.state === 'connecting' ? 'Připojuji se k pluginu…'
        : s.state === 'waiting' ? 'Plugin odpovídá, ale zápas se zatím nehraje. Spusť zápas ve hře, aplikace počká.'
        : s.state === 'tracking' ? `Sleduji zápas z pluginu: ${minuteText(s.frame)}${s.frame && s.frame.home.goals !== null ? `, ${s.frame.home.goals}:${s.frame.away.goals}` : ''}. Snímků z pluginu v tomhle spuštění: ${s.count}.`
        : `Spojení se nedaří (pokus ${s.fails}): ${s.error}`;
      status.textContent = txt;
      if (mode === 'match') {
        const on = s.state !== 'off';
        const b = document.getElementById('feedToggle');
        if (b) b.textContent = on ? 'Zastavit sledování z pluginu' : 'Zapnout sledování z pluginu';
      }
    }
    if (c.local) c.local.push(feed.subscribe(drawStatus));

    async function doProbe() {
      saveFields();
      status.textContent = 'Zkouším spojení… Pokud se prohlížeč zeptá, jestli smí stránka přistupovat k aplikacím na tomto počítači, povol to.';
      out.replaceChildren();
      const p = await feed.probe();
      showLines(p.lines);
      if (!p.ok) return (status.textContent = 'Spojení nevyšlo.');
      status.textContent = p.health.inMatch ? 'Spojení funguje a plugin hlásí zápas.' : 'Spojení funguje, ale plugin zápas zatím nehlásí.';
      return p;
    }

    const buttons = [h('button', { class: 'btn', id: 'feedProbe', type: 'button', text: 'Zkusit spojení', onclick: () => doProbe() })];

    if (mode === 'setup') {
      buttons.push(
        h('button', {
          class: 'btn primary',
          id: 'feedBegin',
          type: 'button',
          text: 'Zjistit zápas z pluginu a začít ho sledovat',
          onclick: async () => {
            const p = await doProbe();
            if (!p || !p.ok) return;
            if (!p.meta || !p.meta.ok || !p.frame || !p.frame.ok) return (status.textContent = 'Plugin zatím žádný zápas nehlásí. Spusť zápas ve hře a zkus to znovu.');
            const mine = p.meta.humanSide;
            const begin = async (side) => {
              try {
                const opp = side === 'home' ? p.meta.away.name : p.meta.home.name;
                await FM27.live.createMatch(app, { opponent: opp || 'Soupeř', competition: p.meta.competition || (app.career() && app.career().competition) || '', mySide: side });
                feed.start(app);
                if (c.redraw) c.redraw();
              } catch (e) {
                status.textContent = e.message || String(e);
              }
            };
            if (mine) return begin(mine);
            out.replaceChildren(
              h('p', { class: 'hint', text: 'Z dat se nepozná, který tým je tvůj. Vyber:' }),
              h('div', { class: 'actions' }, ['home', 'away'].map((sd) => h('button', { class: 'btn', type: 'button', 'data-side': sd, text: `Hraju za ${SIDE_CS[sd]} (${(sd === 'home' ? p.meta.home : p.meta.away).name || '?'})`, onclick: () => begin(sd) })))
            );
          },
        })
      );
    }
    if (mode === 'match') {
      buttons.push(
        h('button', {
          class: 'btn primary',
          id: 'feedToggle',
          type: 'button',
          text: session.state !== 'off' ? 'Zastavit sledování z pluginu' : 'Zapnout sledování z pluginu',
          onclick: () => {
            saveFields();
            if (session.state !== 'off') return feed.stop(), drawStatus();
            const r = feed.start(app);
            if (!r.ok) status.textContent = r.error;
          },
        })
      );
    }
    if (mode === 'squad' || mode === 'match') {
      buttons.push(
        h('button', {
          class: 'btn',
          id: 'feedSquad',
          type: 'button',
          text: 'Načíst moji sestavu z pluginu',
          onclick: async () => {
            saveFields();
            status.textContent = 'Čtu sestavu…';
            out.replaceChildren();
            const showResult = (r) => {
              if (!r.ok) {
                status.textContent = r.error;
                if (r.needSide) out.replaceChildren(h('div', { class: 'actions' }, ['home', 'away'].map((sd) => h('button', { class: 'btn', type: 'button', 'data-side': sd, text: `Hraju za ${SIDE_CS[sd]} (${(sd === 'home' ? r.meta.home : r.meta.away).name || '?'})`, onclick: async () => showResult(await feed.readSquad(app, sd)) }))));
                return;
              }
              const confirm = h('input', { type: 'checkbox', id: 'feedSquadConfirm' });
              const add = h('button', { class: 'btn primary', id: 'feedSquadAdd', type: 'button', text: r.result.count ? `Přidat ${r.result.count} ${ui.plural(r.result.count, 'hráče', 'hráče', 'hráčů')}` : 'Není koho přidat', disabled: !r.result.count });
              add.addEventListener('click', async () => {
                if (!confirm.checked) return toast('Nejdřív potvrď, že údaje odpovídají hře.');
                add.disabled = true;
                const n = await feed.addSquad(app, r.result.players);
                toast(`Z pluginu přidáno hráčů: ${n}.`, 5000);
                out.replaceChildren();
                status.textContent = `Přidáno hráčů: ${n}.`;
                if (c.redraw) c.redraw();
              });
              status.textContent = `Plugin hlásí sestavu týmu ${SIDE_CS[r.side]}${r.meta.home && r.meta.away ? ` (${(r.side === 'home' ? r.meta.home : r.meta.away).name})` : ''}. Zkontroluj ji.`;
              out.replaceChildren(
                h('div', { class: 'books', id: 'feedSquadList' }, r.result.players.slice(0, 40).map((p) => h('div', { class: 'book' }, h('div', { class: 'meta' }, h('b', { text: p.name }), h('span', { text: [p.positions.join('/') || 'pozice neuvedena', p.role ? `${p.role}${p.duty ? ' (' + p.duty + ')' : ''}` : 'role neuvedena', `${Object.keys(p.attributes).length} atributů`].join(' · ') }))))),
                r.result.issues.length ? h('p', { class: 'hint', text: r.result.issues.join(' ') }) : null,
                h('label', { class: 'checkline' }, confirm, h('span', { text: 'Zkontroloval jsem, že sestava odpovídá hře. Údaje jsou z pluginu, neověřené hrou.' })),
                h('div', { class: 'actions' }, add)
              );
            };
            showResult(await feed.readSquad(app, null));
          },
        })
      );
    }

    const root = h(
      'section',
      { class: 'card', id: 'feedCard' },
      h('h2', { text: mode === 'squad' ? 'Sestava z FMMatchLens' : 'Živá data z FMMatchLens' }),
      h('p', { class: 'lead', text: mode === 'squad'
        ? 'FMMatchLens je zdarma zásuvný modul do hry (otevřený kód, licence MIT), který za zápasu čte data hry a nabízí je na tomhle počítači. Aplikace si z něj vezme sestavu tvého týmu s rolemi a povinnostmi, jak je hra používá, a ty ji potvrdíš. Nestojí to žádné volání AI.'
        : 'FMMatchLens je zdarma zásuvný modul do hry (otevřený kód, licence MIT), který za zápasu čte data hry a nabízí je na tomhle počítači. Aplikace se k němu připojí a z minuty, skóre a statistik obou týmů (držení míče, střely, xG a další) skládá časovou osu zápasu bez čtení obrazovky a bez volání AI.' }),
      h('div', { class: 'row' }, ui.field('Adresa pluginu (jen tento počítač)', url, { grow: true, hint: 'Výchozí je http://127.0.0.1:16726' }), mode === 'squad' ? null : ui.field('Nový snímek každých', every, { width: '210px' })),
      h('div', { class: 'actions' }, buttons),
      status,
      lines,
      out,
      h('p', { class: 'hint', text: 'Neověřeno na skutečné hře: čtení je napsané podle zdrojového kódu pluginu verze 0.7.x. Plugin čte paměť hry jako editory: instaluješ ho na vlastní riziko a jen pro offline hru. Údaje z něj jsou „zadal uživatel“, ne „ověřeno hrou“. Skryté údaje hry (CA a PA, skryté atributy) aplikace nečte. Funguje jen na Windows (Steam) a jen tam, kde prohlížeč dovolí stránce volat tenhle počítač; ve stránce v Claude to většinou nejde, použij samostatnou verzi.' })
    );
    drawStatus();
    return root;
  };
})();
