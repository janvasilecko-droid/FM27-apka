/* Historie zápasů a analýza po zápase (zadání § 11): uložené zápasy s časovou osou a změnami, porovnání před a po
   a zpráva od modelu s kontrolou poctivosti. Hlavní pravidlo zadání: časová souvislost není důkaz příčiny. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;
  const W = FM27.widgets;
  const A = () => window.TrenerAnalysis;
  const R = () => window.TrenerReport;

  let selectedId = null;
  let running = null;
  const STEPS = { plan: 'Hledám v knihách', ask: 'Skládám rozbor', check: 'Kontroluji poctivost', repair: 'Opravuji rozbor podle kontroly' };
  const SECTION_TITLES = [
    ['worked', 'Co fungovalo'],
    ['didntWork', 'Co nefungovalo'],
    ['changesHelped', 'Změny, po kterých se situace zlepšila'],
    ['changesHurt', 'Změny, po kterých se situace zhoršila'],
    ['players', 'Jak hráli jednotliví hráči'],
    ['opponentEdge', 'Kde měl soupeř převahu'],
    ['repeatedMistakes', 'Chyby, které se opakovaly'],
  ];
  const sideLabel = (s) => (s === 'home' ? 'domácí' : s === 'away' ? 'hosté' : '?');
  const resultText = (m) => (m.result && Number.isInteger(m.result.home) && Number.isInteger(m.result.away) ? `${m.result.home}:${m.result.away}` : 'výsledek neznámý');

  // ------------------------------------------------------------------ pozorování pro rozbor
  /** Pozorování z odehraného zápasu: období, součty, změny s vyhodnocením, nálezy a poznámka. Vše spočítala aplikace
      z přečtených čísel (heuristic_coach), proto to nikdy není silnější než odhad. */
  function reportObservations(app, match) {
    const An = A();
    const sorted = An.sortTimeline(match.timeline);
    const sum = An.summarizeMatch(sorted, match.changes, { mySide: match.mySide, now: Date.now() });
    const obs = [];
    const f = (v) => (v === null || v === undefined ? '–' : String(v).replace('.', ','));
    sum.periods.forEach((p, i) => {
      if (!p.stats || !p.stats.mine) return;
      const m = p.stats.mine;
      const o = p.stats.opp;
      obs.push({ id: `sum-${i + 1}`, label: 'heuristic_coach', minute: p.fromMinute, text: `Období ${p.fromMinute}.–${p.toMinute}. min (tempo na 10 min): naše střely ${f(m.rates.shots)}, na bránu ${f(m.rates.shotsOnTarget)}, xG ${f(m.rates.xg)}; soupeřovy střely ${f(o.rates.shots)}, na bránu ${f(o.rates.shotsOnTarget)}, xG ${f(o.rates.xg)}; změna našeho držení ${f(m.possession.changePp)} p. b.` });
    });
    const t = sum.totals;
    obs.push({ id: 'sum-total', label: 'heuristic_coach', minute: t.lastMinute, text: `Celý zápas: ${t.snapshots} snímků, poslední minuta ${f(t.lastMinute)}, skóre ${t.score ? `${t.score.home}:${t.score.away}` : 'neznámé'}. Události: ${Object.entries(t.events).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'žádné'}. Původ snímků: ${Object.entries(t.provenance).map(([k, n]) => `${k} ${n}`).join(', ')}.` });
    const changeStatus = {};
    for (const ch of sum.changes) {
      if (!ch.id) continue;
      changeStatus[ch.id] = ch.evaluation.status;
      const ev = ch.evaluation;
      const delta = ev.status === 'ready' ? `Před a po (na 10 min): naše střely ${f(ev.deltas.mine.shots.before)} → ${f(ev.deltas.mine.shots.after)}, soupeřovy ${f(ev.deltas.opp.shots.before)} → ${f(ev.deltas.opp.shots.after)}, naše xG ${f(ev.deltas.mine.xg.before)} → ${f(ev.deltas.mine.xg.after)}.` : `Nelze vyhodnotit: ${ev.notes[0] || 'nedostatek dat'}`;
      obs.push({ id: ch.id, label: 'heuristic_coach', minute: ch.minute, text: `Změna ${ch.minute !== null ? ch.minute + '. min' : '(minuta neznámá)'}: ${ch.summary}. ${delta} ${ev.causalityNote}`.slice(0, 700) });
    }
    for (const [i, o] of An.findingsToObservations(sum.findings, { prefix: 'det' }).entries()) obs.push(Object.assign({}, o, { id: `det-${i + 1}` }));
    if (match.notes && match.notes.trim()) obs.push({ id: 'note-1', label: 'user_entered', minute: null, text: match.notes.trim().slice(0, 600) });
    return { observations: obs, changeStatus, summary: sum };
  }

  // ------------------------------------------------------------------ vykreslení zprávy
  function renderReport(app, box, report, ctx, matchId) {
    box.replaceChildren();
    const rows = (key, title) => {
      const list = report[key] || [];
      if (!list.length) return null;
      return h('div', null, h('h3', { text: title }), h('div', { class: 'advice' }, list.map((x) => W.claim(null, x.name ? x.name : x.changeId ? `Změna ${x.changeId}` : '·', x, ctx, app))));
    };
    box.append(h('div', { class: 'banner ok' }, h('b', { text: 'Rozbor prošel kontrolou poctivosti' }), h('p', { class: 'hint', text: 'Opírá se jen o přečtená čísla a tvé poznámky. U změn jde o souvislost v čase, ne o důkaz příčiny.' })));
    for (const [key, title] of SECTION_TITLES) box.append(rows(key, title) || h('div', null));
    if (!SECTION_TITLES.some(([k]) => (report[k] || []).length)) box.append(h('p', { class: 'hint', text: 'Z dat se nepodařilo vyvodit nic, co by neslo jen za odhad. Víc snímků a údajů dá lepší rozbor.' }));
    const next = report.nextMatch;
    box.append(
      h(
        'div',
        { class: 'advice' },
        W.sec(null, 'Co změnit pro příští utkání', null, h('p', { text: next.text }), h('div', { class: 'books' }, next.items.map((it) => h('div', { class: 'book' }, h('div', { class: 'meta' }, h('b', { text: it.what }), h('span', { text: it.why }), W.refsRow(it.refs, ctx, app), h('span', { class: 'chips' }, ui.tierChip(it.tier))), h('button', { class: 'btn small', type: 'button', 'data-act': 'memory', text: 'Uložit do paměti kariéry', onclick: async (ev) => { try { await FM27.context.addLesson(app, `${it.what} (${it.why})`, 'match', matchId); ev.target.disabled = true; ev.target.textContent = 'Uloženo do paměti'; } catch (e) { toast(e.message || String(e)); } } }))))),
        W.sec(null, 'Omezení rozboru', ui.tierChip('unknown'), h('p', { text: report.limits.text }), h('ul', null, report.limits.items.map((s) => h('li', { text: s }))))
      ),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Kopírovat rozbor', onclick: () => ui.copyText(R().reportToText(report), 'Rozbor je zkopírovaný.') }))
    );
  }

  // ------------------------------------------------------------------ vytvoření rozboru
  async function runReport(app, match, box, steps, button) {
    const ai = FM27.ai;
    if (!ai.available) return toast('Claude není dostupný.');
    if (match.timeline.length < 2) return toast('K rozboru jsou potřeba aspoň dva snímky zápasu.');
    const { observations: matchObs, changeStatus } = reportObservations(app, match);
    const careerObs = FM27.context.observations(app, { memory: true });
    const observations = [...matchObs, ...careerObs];
    const obsMap = Object.fromEntries(observations.map((o) => [o.id, { label: o.label, text: o.text }]));
    const ctl = new AbortController();
    running = ctl;
    button.disabled = true;
    box.replaceChildren();
    steps.reset(['plan', 'ask', 'check']);
    try {
      const lib = FM27.library;
      let hits = [];
      if (lib.size) {
        steps.set('plan', 'run');
        hits = C.multiSearch(lib.index, ['rozbor zápasu taktické změny', 'reakce na vývoj zápasu úprava taktiky', 'jak vyhodnotit účinek taktické změny'], { k: 6, perBook: 2 });
        steps.set('plan', 'done', `${hits.length} ${ui.plural(hits.length, 'úryvek', 'úryvky', 'úryvků')}`);
      } else steps.set('plan', 'skip', 'knihovna je prázdná');
      const passageCtx = {};
      for (const hit of hits) {
        const book = lib.bookById(hit.bookId);
        passageCtx[hit.id] = { id: hit.id, bookId: hit.bookId, title: book ? book.title : '?', where: book ? lib.whereLabel(book, hit) : '?', text: hit.text.slice(0, 900) };
      }
      W.snapPut(passageCtx);
      const knownPlayers = FM27.context.players(app).map((p) => p.name);
      const unverified = match.timeline.filter((s) => s.provenance === 'vision_unverified').length;
      const turns = R().buildReportTurns({ observations, passages: Object.values(passageCtx), sourcesDigest: app.registry.digest() });
      const result = await ai.structured({
        turns,
        validate: (x) => R().validateReport(x, { observations: obsMap, passages: new Set(Object.keys(passageCtx)), registry: app.registry, changeStatus, knownPlayers, dataLimited: unverified > 0 || match.timeline.length < 4 }),
        tier: 'default',
        signal: ctl.signal,
        purpose: 'rozbor po zápase',
        onStep: (s, st, note) => steps.set(s, st, note),
      });
      const ctx = { passages: passageCtx, observations: obsMap };
      if (result.status === 'ok') {
        const saved = await app.store.put('match', Object.assign(app.store.draft(app.store.get('match', match.id)), { analysis: { report: result.value, at: Date.now(), passages: Object.fromEntries(Object.entries(passageCtx).map(([id, p]) => [id, { id, title: p.title, where: p.where }])), observations: obsMap } }));
        renderReport(app, box, saved.analysis.report, ctx, match.id);
      } else box.append(W.failedCheckBanner(result.verdict, 'Rozbor neprošel kontrolou poctivosti', () => runReport(app, match, box, steps, button)));
    } catch (e) {
      if (e && e.code === 'cancelled') toast('Zastaveno.');
      else box.append(W.errorBanner(ai.errorText(e), !(e && ai.NO_RETRY.includes(e.code)) ? () => runReport(app, match, box, steps, button) : null));
    } finally {
      running = null;
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------------ detail zápasu
  function detail(app, match, redraw) {
    const An = A();
    const sorted = An.sortTimeline(match.timeline);
    const { summary } = reportObservations(app, match);
    const homeIn = ui.input({ id: 'histHome', type: 'number', min: 0, max: 30, value: match.result ? match.result.home : '', inputmode: 'numeric' });
    const awayIn = ui.input({ id: 'histAway', type: 'number', min: 0, max: 30, value: match.result ? match.result.away : '', inputmode: 'numeric' });
    const notes = h('textarea', { id: 'histNotes', placeholder: 'Poznámky k zápasu: co jsi viděl ty, co statistiky neukážou', style: 'min-height:80px' });
    notes.value = match.notes || '';
    const saveInfo = h('button', {
      class: 'btn',
      id: 'histSave',
      type: 'button',
      text: 'Uložit výsledek a poznámky',
      onclick: async () => {
        const hv = homeIn.value === '' ? null : Number(homeIn.value);
        const av = awayIn.value === '' ? null : Number(awayIn.value);
        const d = app.store.draft(app.store.get('match', match.id));
        d.result = hv === null || av === null || !Number.isInteger(hv) || !Number.isInteger(av) ? null : { home: hv, away: av };
        d.notes = notes.value.trim().slice(0, 1500);
        await app.store.put('match', d);
        toast('Zápas je uložený.');
        redraw();
      },
    });
    const periods = summary.periods.filter((p) => p.stats && p.stats.mine);
    const steps = W.steps(STEPS);
    const reportBox = h('div', { id: 'histReportBox' });
    const reportBtn = h('button', { class: 'btn primary', id: 'histReport', type: 'button', text: match.analysis ? 'Připravit rozbor znovu' : 'Připravit rozbor po zápase', disabled: !FM27.ai.available, onclick: () => runReport(app, match, reportBox, steps, reportBtn) });
    if (match.analysis) renderReport(app, reportBox, match.analysis.report, { passages: match.analysis.passages || {}, observations: match.analysis.observations || {} }, match.id);
    return h(
      'div',
      { class: 'coach-grid' },
      h(
        'div',
        null,
        h('section', { class: 'card', id: 'histDetail' }, h('h2', { text: `${app.career().club} – ${match.opponent}` }), h('p', { class: 'lead', text: `${ui.fmtDateTime(match.startedAt || match.date)}, hrál jsi za ${sideLabel(match.mySide)}, ${resultText(match)}, ${match.timeline.length} snímků, ${match.changes.length} ${ui.plural(match.changes.length, 'změna', 'změny', 'změn')}.` }), h('div', { class: 'row' }, ui.field('Skóre domácí', homeIn, { width: '120px' }), ui.field('Skóre hosté', awayIn, { width: '120px' })), ui.field('Poznámky', notes), h('div', { class: 'actions' }, saveInfo, match.status === 'live' ? h('button', { class: 'btn', type: 'button', text: 'Pokračovat v Live Coach', onclick: () => (FM27.live.begin(app, match.id), app.go('live')) }) : null, ui.confirmButton('Smazat zápas', 'Opravdu smazat?', async () => {
          await app.store.remove('match', match.id);
          selectedId = null;
          toast('Zápas je smazaný.');
          redraw();
        }))),
        h('section', { class: 'card', id: 'histFlow' }, h('h2', { text: 'Průběh zápasu (graf)' }), FM27.widgets.flowChart(match, {})),
        h('section', { class: 'card' }, h('h2', { text: 'Průběh po obdobích' }), periods.length ? h('div', { class: 'diag' }, periods.map((p) => h('div', null, h('span', { text: `${p.fromMinute}.–${p.toMinute}. min` }), h('span', { text: `naše střely ${p.stats.mine.rates.shots === null ? '–' : String(p.stats.mine.rates.shots).replace('.', ',')}, soupeřovy ${p.stats.opp.rates.shots === null ? '–' : String(p.stats.opp.rates.shots).replace('.', ',')} na 10 min` })))) : h('p', { class: 'hint', text: 'Zatím není dost snímků se statistikami pro rozdělení na období.' }), summary.notes.length ? h('ul', { class: 'list' }, summary.notes.slice(0, 5).map((n) => h('li', { text: n }))) : null),
        h('section', { class: 'card' }, h('h2', { text: 'Změny a jejich účinek' }), match.changes.length ? h('div', { class: 'books' }, match.changes.map((ch) => h('div', { class: 'change-item' }, h('div', { class: 'what', text: `${ch.minute !== null ? ch.minute + '. min: ' : ''}${ch.summary}` }), W.evaluationView(match, ch)))) : h('p', { class: 'hint', text: 'V zápase nebyla zaznamenaná žádná změna.' })),
        h('section', { class: 'card' }, h('h2', { text: `Časová osa (${sorted.length})` }), sorted.length ? h('div', { class: 'books' }, sorted.slice().reverse().map((s) => h('div', { class: 'book' }, h('div', { class: 'meta' }, h('b', { text: `${s.minute !== null ? s.minute + '. min' : 'minuta neznámá'}${s.score ? `, ${s.score.home}:${s.score.away}` : ''}` }), h('span', { class: 'chips' }, ui.tierChip(s.provenance === 'screenshot_verified' ? 'observed' : s.provenance === 'user_entered' ? 'user_entered' : 'inferred', s.provenance === 'screenshot_verified' ? 'ověřeno' : s.provenance === 'user_entered' ? 'zadáno' : 'neověřeno')))))) : h('p', { class: 'hint', text: 'Bez snímků.' }))
      ),
      h('section', { class: 'card' }, h('h2', { text: 'Rozbor po zápase' }), h('p', { class: 'lead', text: 'Co fungovalo, co ne, které změny pomohly a které ne (jen jako souvislost v čase), kde měl soupeř převahu, jaké chyby se opakovaly a co změnit příště. Trenér to píše z přečtených čísel a tvých poznámek a poctivě řekne, co mu chybělo.' }), h('div', { class: 'actions' }, reportBtn, h('button', { class: 'btn', type: 'button', text: 'Zastavit', onclick: () => running && running.abort() }), h('span', { class: 'hint', text: FM27.ai.available ? '' : 'Bez Claude se rozbor připravit nedá.' })), steps.el, reportBox)
    );
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    if (!A() || !R()) {
      root.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul zápasů' })));
      return;
    }
    const draw = () => {
      guard.reset(); // obrazovka se kreslí znovu, takže žádné neuložené úpravy už nejsou
      const career = app.requireCareer(root, 'Historie zápasů');
      if (!career) return;
      const all = app.store.list('match', (m) => m.careerId === career.id).sort((a, b) => (b.startedAt || b.date || 0) - (a.startedAt || a.date || 0));
      if (!all.some((m) => m.id === selectedId)) selectedId = all.length ? all[0].id : null;
      const match = all.find((m) => m.id === selectedId) || null;
      const list = h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Historie zápasů' }),
        all.length
          ? h('div', { class: 'books', id: 'histList' }, all.map((m) => h('div', { class: 'book match' + (m.id === selectedId ? ' selected' : ''), 'data-id': m.id }, h('div', { class: 'meta' }, h('b', { text: `${career.club} – ${m.opponent}` }), h('span', { text: `${ui.fmtDateTime(m.startedAt || m.date)} · ${resultText(m)} · ${m.timeline.length} snímků` }), h('span', { class: 'chips' }, m.status === 'live' ? h('span', { class: 'chip t-inferred', text: 'rozehraný' }) : h('span', { class: 'chip t-observed', text: 'ukončený' }), m.analysis ? h('span', { class: 'chip t-user_entered', text: 'má rozbor' }) : null)), h('button', { class: 'btn small', type: 'button', text: m.id === selectedId ? 'Otevřeno' : 'Otevřít', onclick: () => ((selectedId = m.id), draw()) }))))
          : h('div', { class: 'empty' }, h('b', { text: 'Zatím žádný zápas' }), h('p', { class: 'hint', text: 'Zápasy se ukládají z LIVE COACH. Začni tam nový zápas a vkládej snímky.' }), h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Přejít na LIVE COACH', onclick: () => app.go('live') })))
      );
      root.replaceChildren(list, match ? detail(app, match, draw) : null);
    };
    const guard = ui.dirtyGuard(root, app, () => draw());
    draw();
    // změna z druhého zařízení nesmí smazat poznámky, které právě píšeš
    app.watch(['match'], (e) => e && e.origin === 'remote' && guard.onRemote());
    app.onCleanup(() => running && running.abort());
  }

  FM27.screens.register({ id: 'historie', hash: 'historie', label: 'Historie zápasů', order: 7, render });
})();
