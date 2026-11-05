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
    for (const p of Object.values(ctx)) if (p.text) all[p.id] = { title: p.title, where: p.where, text: p.text, url: typeof p.url === 'string' ? p.url : undefined };
    const ids = Object.keys(all);
    while (ids.length > 80) delete all[ids.shift()];
    ui.lsSet(SNAP_KEY, all);
  };
  W.snapGet = (id) => ui.lsGet(SNAP_KEY, {})[id] || null;

  W.openPassage = (id, fallback) => {
    if (typeof id === 'string' && id.startsWith('web:')) return openWebPassage(id, fallback);
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

  /** Úryvek z webu: výtah z hledání a odkaz. Text i adresa se vykreslují jako text, odkaz jen https. */
  function openWebPassage(id, fallback) {
    const snap = W.snapGet(id) || fallback || null;
    const WS = window.TrenerWebSources;
    const href = snap && WS ? WS.normalizeUrl(snap.url) : '';
    if (!snap) return ui.toast('Tenhle úryvek z webu už v tomto zařízení není. Otevři odkaz ze zdrojů rady.');
    return ui.openDrawer(snap.title || 'Zdroj z webu', [
      h('div', { class: 'passage focus' }, h('small', { class: 'mono', text: `${id} · ${snap.where || ''}` }), h('p', { text: snap.text || '(bez výtahu)' })),
      href ? h('div', { class: 'actions' }, h('a', { class: 'btn small', href, target: '_blank', rel: 'noopener noreferrer', text: 'Otevřít stránku' })) : null,
      h('p', { class: 'hint', text: 'Výtah z hledání na webu, ne celý text stránky. Neověřeno: otevři odkaz, než se na to spolehneš.' }),
    ]);
  }

  // ------------------------------------------------------------------ odkazy
  /** ctx: {passages: {id: {title, where, text?}}, observations: {id: {label, text}}} */
  // Odkazy z uložené rady se vykreslují obranně: jen vlastní klíče objektů (ne „constructor“) a jen texty, ať jedna divná položka neshodí obrazovku.
  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const safeHref = (url) => (/^https?:\/\//i.test(String(url || '')) ? String(url) : null);
  W.refChip = (ref, ctx, app) => {
    const id = typeof ref === 'string' ? ref : String(ref);
    if (id.startsWith('bk:') && own(ctx.passages, id)) {
      const p = ctx.passages[id];
      return h('button', { class: 'ref', type: 'button', title: 'Otevřít úryvek z knihy', onclick: () => W.openPassage(id, p), text: `Kniha: ${p.title}, ${p.where}` });
    }
    if (id.startsWith('web:') && own(ctx.passages, id)) {
      const p = ctx.passages[id];
      const href = safeHref(p.url);
      const label = `Web: ${String(p.title || id).slice(0, 80)}`;
      const tip = `Zdroj z webu (výtah z hledání, neověřeno). ${String(p.where || '')}`;
      return href ? h('a', { class: 'ref', href, target: '_blank', rel: 'noopener noreferrer', title: tip, text: label }) : h('span', { class: 'ref', title: tip, text: label });
    }
    if (own(ctx.observations, id)) return h('span', { class: 'ref', title: ctx.observations[id].text, text: `Pozorování ${id}` });
    const src = app.registry.get(id);
    if (src) {
      const href = safeHref(src.url);
      return href ? h('a', { class: 'ref', href, target: '_blank', rel: 'noopener noreferrer', title: src.caveat || src.title, text: `Zdroj: ${src.title}` }) : h('span', { class: 'ref', title: src.caveat || src.title, text: `Zdroj: ${src.title}` });
    }
    return h('span', { class: 'ref', text: id });
  };
  W.refsRow = (refs, ctx, app) => (Array.isArray(refs) && refs.length ? h('div', { class: 'refs' }, refs.map((r) => W.refChip(r, ctx, app))) : null);

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
  /** Štítek podkladů nálezu nebo vyhodnocení: ověřené snímky, ručně zadané údaje, nebo neověřené čtení z obrazu. */
  W.evidenceChip = (tier) => (tier === 'observed' ? ui.tierChip('observed', 'ověřené snímky') : tier === 'user_entered' ? ui.tierChip('user_entered', 'zadáno ručně') : ui.tierChip('inferred', 'neověřené čtení'));
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
      W.evidenceChip(ev.evidenceTier)
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
