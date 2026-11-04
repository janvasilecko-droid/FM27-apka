/* Společné stavební prvky obrazovek: odkazy na zdroje, úryvky z knih, oddíly s chipem důvěry, srozumitelné hlášky kontroly.
   Používá je osobní trenér, soupeř, zpráva po zápase i škola, aby všude vypadalo „odkud je to“ stejně. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h } = ui;

  const W = (FM27.widgets = {});

  // ------------------------------------------------------------------ úryvky pro otevření i po smazání knihy (jen v tomto zařízení)
  const SNAP_KEY = 'fm27.snap';
  W.snapPut = (ctx) => {
    const all = ui.lsGet(SNAP_KEY, {});
    for (const p of Object.values(ctx)) if (p.text) all[p.id] = { title: p.title, where: p.where, text: p.text };
    const ids = Object.keys(all);
    while (ids.length > 80) delete all[ids.shift()];
    ui.lsSet(SNAP_KEY, all);
  };
  W.snapGet = (id) => ui.lsGet(SNAP_KEY, {})[id] || null;

  W.openPassage = (id, fallback) => {
    const lib = FM27.library;
    const live = lib.index.byId.get(id);
    if (live) {
      const book = lib.bookById(live.bookId);
      const nodes = lib.index.neighbours(id, 1).map((p) => h('div', { class: 'passage' + (p.id === id ? ' focus' : '') }, h('small', { class: 'mono', text: `${p.id} · ${book ? lib.whereLabel(book, p) : ''}` }), h('p', { text: p.text })));
      nodes.push(h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => ui.copyText(lib.citation(id), 'Citace je zkopírovaná.'), text: 'Kopírovat citaci' })));
      return ui.openDrawer(book ? `${book.title}${book.author ? ' (' + book.author + ')' : ''}` : 'Úryvek', nodes);
    }
    const snap = W.snapGet(id) || (fallback && fallback.text ? fallback : null);
    if (snap) {
      return ui.openDrawer(snap.title, [
        h('div', { class: 'passage focus' }, h('small', { class: 'mono', text: `${id} · ${snap.where}` }), h('p', { text: snap.text })),
        h('p', { class: 'hint', text: 'Kniha už v tomto zařízení není, ukazuji uložený úryvek.' }),
      ]);
    }
    ui.toast('Úryvek je jen v zařízení, kde byl přidán. Přidej tu knihu i sem.');
  };
  FM27.openPassage = W.openPassage;

  // ------------------------------------------------------------------ odkazy
  /** ctx: {passages: {id: {title, where, text?}}, observations: {id: {label, text}}} */
  W.refChip = (ref, ctx, app) => {
    if (ref.startsWith('bk:') && ctx.passages && ctx.passages[ref]) {
      const p = ctx.passages[ref];
      return h('button', { class: 'ref', type: 'button', title: 'Otevřít úryvek z knihy', onclick: () => W.openPassage(ref, p), text: `Kniha: ${p.title}, ${p.where}` });
    }
    if (ctx.observations && ctx.observations[ref]) return h('span', { class: 'ref', title: ctx.observations[ref].text, text: `Pozorování ${ref}` });
    const src = app.registry.get(ref);
    if (src) return h('a', { class: 'ref', href: src.url, target: '_blank', rel: 'noopener noreferrer', title: src.caveat || src.title, text: `Zdroj: ${src.title}` });
    return h('span', { class: 'ref', text: ref });
  };
  W.refsRow = (refs, ctx, app) => (refs && refs.length ? h('div', { class: 'refs' }, refs.map((r) => W.refChip(r, ctx, app))) : null);

  // ------------------------------------------------------------------ oddíly
  W.sec = (no, title, chip, ...body) => h('div', { class: 'sec' }, h('h3', null, no !== null && no !== undefined ? h('span', { class: 'no', text: String(no).padStart(2, '0') }) : null, title, chip), ...body);
  /** Oddíl s tvrzením {text, tier, refs}. */
  W.claim = (no, title, c, ctx, app, ...extra) => W.sec(no, title, ui.tierChip(c.tier), h('p', { text: c.text }), W.refsRow(c.refs, ctx, app), ...extra);

  // ------------------------------------------------------------------ hlášky kontroly
  const SECTION_CS = {
    context: 'Kontext', evidenceA: 'Důkaz A', evidenceB: 'Důkaz B', confidence: 'Jistota', diagnosis: 'Diagnóza', change: 'Změna', measure: 'Měření', risk: 'Rizika', reversal: 'Vrácení změny', unknown: 'Co trenér neví',
    summary: 'Shrnutí', press: 'Napadání', winBall: 'Získání míče', side: 'Strana', spaces: 'Prostory', limit: 'Omezení hráče',
    worked: 'Co fungovalo', didntWork: 'Co nefungovalo', changesHelped: 'Změny, po kterých se zlepšilo', changesHurt: 'Změny, po kterých se zhoršilo', players: 'Hráči', opponentEdge: 'Převaha soupeře', repeatedMistakes: 'Opakované chyby', nextMatch: 'Příští utkání', limits: 'Omezení zprávy',
    principle: 'Princip', fm27Example: 'Příklad z FM27', diagram: 'Schéma', usage: 'Použití ve hře', mistakes: 'Časté chyby', exercise: 'Cvičení', quiz: 'Kvíz', why: 'Vysvětlení',
  };
  W.humanize = (msg) =>
    String(msg).replace(/^([A-Za-z0-9]+)(?:\[(\d+)\])?:/, (m, key, n) => (SECTION_CS[key] ? `${SECTION_CS[key]}${n ? ' ' + n : ''}:` : m));

  // ------------------------------------------------------------------ banner s chybou nebo nepovedenou kontrolou
  W.retryButton = (onclick) => h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Zkusit znovu', onclick }));
  W.errorBanner = (message, onRetry) => h('div', { class: 'banner bad' }, h('b', { text: 'Nepovedlo se' }), h('span', { text: message }), onRetry ? W.retryButton(onRetry) : null);
  W.failedCheckBanner = (verdict, title, onRetry) =>
    h(
      'div',
      { class: 'banner warn' },
      h('b', { text: title }),
      h('p', { text: 'Nic se proto nezobrazuje. Doplň údaje (co přesně víš, nejlépe z ověřeného screenshotu) a zkus to znovu.' }),
      h('ul', { class: 'list' }, verdict.errors.slice(0, 8).map((e) => h('li', { text: W.humanize(e) }))),
      onRetry ? W.retryButton(onRetry) : null
    );

  // ------------------------------------------------------------------ vyhodnocení změny před a po (Live Coach i historie)
  const VERDICT_CS = { higher: 'vyšší', lower: 'nižší', similar: 'podobné' };
  const num = (v) => (v === null || v === undefined ? '–' : String(v).replace('.', ','));
  /** Popisné srovnání před a po změně. Nikdy netvrdí příčinu; věta o tom je vždy vidět (id liveCausality). */
  W.evaluationView = (match, change) => {
    const ev = FM27.live.evaluate(match, change);
    if (ev.status !== 'ready') {
      return h('div', null, h('span', { class: 'chip t-unknown', text: 'zatím nelze vyhodnotit' }), h('ul', { class: 'list' }, ev.notes.map((n) => h('li', { text: n }))));
    }
    const row = (label, d) => h('div', null, h('span', { text: label }), h('span', { text: `${num(d.before)} → ${num(d.after)} (${VERDICT_CS[d.verdict] || '–'})` }));
    const pp = ev.deltas.possessionChangePp;
    return h(
      'div',
      null,
      h('div', { class: 'diag' }, row('Naše střely na 10 min', ev.deltas.mine.shots), row('Naše střely na bránu na 10 min', ev.deltas.mine.shotsOnTarget), row('Naše xG na 10 min', ev.deltas.mine.xg), row('Soupeřovy střely na 10 min', ev.deltas.opp.shots), row('Soupeřovo xG na 10 min', ev.deltas.opp.xg), h('div', null, h('span', { text: 'Změna našeho držení míče' }), h('span', { text: `${num(pp.before)} → ${num(pp.after)} p. b. (${VERDICT_CS[pp.verdict] || '–'})` }))),
      h('ul', { class: 'list' }, ev.notes.map((n) => h('li', { text: n }))),
      h('p', { class: 'banner warn', style: 'margin-top:8px', id: 'liveCausality', text: ev.causalityNote }),
      ui.tierChip(ev.evidenceTier === 'observed' ? 'observed' : 'inferred', ev.evidenceTier === 'observed' ? 'ověřené snímky' : 'neověřené čtení')
    );
  };

  // ------------------------------------------------------------------ kroky průběhu (seznam s kolečky)
  W.steps = (labels) => {
    const ol = h('ol', { class: 'steps', hidden: true });
    return {
      el: ol,
      reset(ids) {
        ol.hidden = false;
        ol.replaceChildren(...ids.map((id) => h('li', { 'data-step': id, text: labels[id] || id })));
      },
      set(id, cls, note) {
        let li = ol.querySelector(`[data-step="${id}"]`);
        if (!li) {
          li = h('li', { 'data-step': id });
          ol.append(li);
        }
        li.className = cls;
        li.textContent = note ? `${labels[id] || id}: ${note}` : labels[id] || id;
      },
    };
  };
})();
