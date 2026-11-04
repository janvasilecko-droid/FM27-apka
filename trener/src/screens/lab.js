/* Taktická laboratoř (zadání § 6): hřiště s přesouváním hráčů, rozbor prostoru, porovnání dvou taktik,
   soupeřova formace a vysvětlení od modelu. Všechno tu je geometrie bodů, které si nakreslíš. Nic z toho
   netvrdí, jak se hráči chovají ve FM27, a prahy jsou heuristiky aplikace (každý nález říká, z čeho plyne). */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, svg, $, toast } = ui;
  const W = FM27.widgets;

  const PW = 68; // šířka hřiště v metrech (jen pro vykreslení; souřadnice tahu jsou 0–100)
  const PL = 105;
  const toX = (x) => (x / 100) * PW;
  const toY = (y) => (y / 100) * PL;
  const fromX = (px) => (px / PW) * 100;
  const fromY = (py) => (py / PL) * 100;

  const state = { a: null, b: null, phase: 'in', links: false, zones: false, snap: true, opp: '', hi: new Set() };
  let running = null;

  const T = () => window.TrenerTactics;
  const phaseXY = (s, phase) => (phase === 'out' ? { x: s.ox, y: s.oy } : { x: s.x, y: s.y });
  const SEV_CS = { warn: 'pozor', watch: 'sleduj', info: 'info' };

  // ------------------------------------------------------------------ kreslení hřiště
  function pitchBackground() {
    const g = svg('g', { class: 'pitch-lines' });
    const line = (attrs) => svg('rect', Object.assign({ class: 'pl-line', fill: 'none' }, attrs));
    g.append(line({ x: 0.3, y: 0.3, width: PW - 0.6, height: PL - 0.6 }));
    g.append(svg('line', { class: 'pl-line', x1: 0.3, y1: PL / 2, x2: PW - 0.3, y2: PL / 2 }));
    g.append(svg('circle', { class: 'pl-line', cx: PW / 2, cy: PL / 2, r: 9.15, fill: 'none' }));
    const penW = 40.3;
    const penH = 16.5;
    const gW = 18.3;
    const gH = 5.5;
    g.append(line({ x: (PW - penW) / 2, y: 0.3, width: penW, height: penH }), line({ x: (PW - gW) / 2, y: 0.3, width: gW, height: gH }));
    g.append(line({ x: (PW - penW) / 2, y: PL - penH - 0.3, width: penW, height: penH }), line({ x: (PW - gW) / 2, y: PL - gH - 0.3, width: gW, height: gH }));
    return g;
  }

  function zonesLayer(analysis) {
    const g = svg('g', { class: 'zones' });
    const cuts = [20, 40, 60, 80];
    for (const x of cuts) g.append(svg('line', { class: 'zone-line', x1: toX(x), y1: 0, x2: toX(x), y2: PL }));
    for (const y of [100 / 3, 200 / 3]) g.append(svg('line', { class: 'zone-line', x1: 0, y1: toY(y), x2: PW, y2: toY(y) }));
    const chIds = ['left', 'leftHalf', 'centre', 'rightHalf', 'right'];
    const thirdRows = [['att', 100 / 6], ['mid', 50], ['def', 500 / 6]];
    chIds.forEach((c, ci) => {
      thirdRows.forEach(([t, cy]) => {
        const n = analysis && analysis.zones ? analysis.zones[`${t}/${c}`] : 0;
        if (n) g.append(svg('text', { class: 'zone-n', x: toX(ci * 20 + 10), y: toY(cy), 'text-anchor': 'middle', text: String(n) }));
      });
    });
    return g;
  }

  function linksLayer(work, phase) {
    const g = svg('g', { class: 'links' });
    const pts = work.slots.map((s) => Object.assign({ key: s.key }, phaseXY(s, phase)));
    const drawn = new Set();
    for (const p of pts) {
      const near = pts
        .filter((q) => q.key !== p.key)
        .map((q) => ({ q, d: Math.hypot(q.x - p.x, (q.y - p.y) * 1.5) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const { q } of near) {
        const id = [p.key, q.key].sort().join('-');
        if (drawn.has(id)) continue;
        drawn.add(id);
        g.append(svg('line', { class: 'link-line', x1: toX(p.x), y1: toY(p.y), x2: toX(q.x), y2: toY(q.y) }));
      }
    }
    return g;
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    if (!T() || !window.TrenerLabExplain) {
      root.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul taktik' })));
      return;
    }
    const Tc = T();
    let work = null; // pracovní kopie taktiky A, mění se při přesouvání
    let saveTimer = 0;
    const names = () => Object.fromEntries(FM27.context.players(app).map((p) => [p.id, p.name]));

    const build = () => {
      const career = app.requireCareer(root, 'Laboratoř');
      if (!career) return;
      const all = FM27.context.tactics(app);
      if (!all.length) {
        const f = ui.select(Tc.FORMATIONS.map((x) => [x.id, x.label]), '4-3-3', { id: 'labFormation' });
        root.replaceChildren(
          ui.card(
            'Taktická laboratoř',
            h('p', { class: 'lead', text: 'Nejdřív potřebuješ taktiku. Vytvoř ji tady ze šablony formace, nebo nahraj ruční plán v sekci Moje taktiky.' }),
            ui.field('Formace', f, { width: '160px' }),
            h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'labCreate', type: 'button', text: 'Vytvořit taktiku', onclick: async () => {
              const t = Tc.makeTactic({ formation: f.value, name: `Taktika ${f.value}`, kind: 'primary' });
              const saved = await app.store.put('tactic', Object.assign(t, { careerId: career.id }));
              const c = app.store.draft(app.career());
              c.activeTacticId = saved.id;
              await app.store.put('career', c);
              state.a = saved.id;
              build();
            } }))
          )
        );
        return;
      }
      if (!all.some((t) => t.id === state.a)) state.a = (FM27.context.activeTactic(app) || all[0]).id;
      if (state.b && !all.some((t) => t.id === state.b)) state.b = null;
      const source = all.find((t) => t.id === state.a);
      work = app.store.draft(source);
      const other = state.b ? all.find((t) => t.id === state.b) : null;

      const selA = ui.select(all.map((t) => [t.id, `${t.name} (${t.formation})`]), state.a, { id: 'labA', onchange: (e) => ((state.a = e.target.value), build()) });
      const selB = ui.select([['', '(bez porovnání)'], ...all.filter((t) => t.id !== state.a).map((t) => [t.id, `${t.name} (${t.formation})`])], state.b || '', { id: 'labB', onchange: (e) => ((state.b = e.target.value || null), build()) });
      const selOpp = ui.select([['', '(bez soupeře)'], ...Tc.FORMATIONS.map((f) => [f.id, f.label])], state.opp, { id: 'labOpp', onchange: (e) => ((state.opp = e.target.value), update()) });
      const phaseBtns = ['in', 'out'].map((p) => h('button', { class: 'btn small seg', id: 'labPhase-' + p, type: 'button', 'aria-pressed': String(state.phase === p), text: p === 'in' ? 'S míčem' : 'Bez míče', onclick: () => ((state.phase = p), phaseBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['in', 'out'][i] === p))), update()) }));
      const chk = (id, label, key) => {
        const el = h('input', { type: 'checkbox', id, checked: state[key] });
        el.addEventListener('change', () => ((state[key] = el.checked), update()));
        return h('label', { class: 'checkline compact' }, el, h('span', { text: label }));
      };

      const svgEl = svg('svg', { class: 'pitch', id: 'pitch', viewBox: `0 0 ${PW} ${PL}`, role: 'img', 'aria-label': 'Hřiště s rozestavením. Hráče přetáhni prstem nebo myší.' });
      const factsBox = h('div', { id: 'labFacts' });
      const conflictsBox = h('div', { id: 'labConflicts' });
      const compareBox = h('div', { id: 'labCompare' });
      const overloadBox = h('div', { id: 'labOverload' });
      const explainBox = h('div', { id: 'labExplain' });
      const explainSteps = W.steps({ search: 'Hledám v knihách', ask: 'Skládám vysvětlení', check: 'Kontroluji poctivost', repair: 'Opravuji podle kontroly' });

      // ---- přepočet a vykreslení
      function update() {
        const phase = state.phase;
        const analysis = Tc.analyzeShape(work, { phase });
        const conflicts = analysis.ok ? Tc.findConflicts(work, { phase }) : [];
        const facts = analysis.ok ? Tc.shapeFacts(analysis, { phase }) : [];
        const squadNames = names();

        svgEl.replaceChildren(svg('rect', { class: 'pitch-bg', x: 0, y: 0, width: PW, height: PL, rx: 1.5 }), pitchBackground());
        if (state.zones) svgEl.append(zonesLayer(analysis));
        if (state.links) svgEl.append(linksLayer(work, phase));
        if (other) {
          const ghost = svg('g', { class: 'ghost' });
          for (const s of other.slots) {
            const p = phaseXY(s, phase);
            ghost.append(svg('circle', { class: 'ghost-dot', cx: toX(p.x), cy: toY(p.y), r: 3 }), svg('text', { class: 'ghost-t', x: toX(p.x), y: toY(p.y) + 0.9, 'text-anchor': 'middle', text: s.pos }));
          }
          svgEl.append(ghost);
        }
        let oppTactic = null;
        if (state.opp) {
          oppTactic = Tc.makeTactic({ formation: state.opp, name: 'Soupeř' });
          const g = svg('g', { class: 'opp' });
          for (const s of oppTactic.slots) {
            const p = { x: 100 - s.x, y: 100 - s.y };
            g.append(svg('circle', { class: 'opp-dot', cx: toX(p.x), cy: toY(p.y), r: 2.8 }), svg('text', { class: 'opp-t', x: toX(p.x), y: toY(p.y) + 0.9, 'text-anchor': 'middle', text: s.pos }));
          }
          svgEl.append(g);
        }
        for (const s of work.slots) {
          const p = phaseXY(s, phase);
          const line = Tc.lineOf(s.pos) || 'mid';
          const g = svg('g', { class: `pl ${line}${state.hi.has(s.key) ? ' hi' : ''}`, 'data-key': s.key, tabindex: 0, role: 'button', 'aria-label': `${s.pos}${s.playerId && squadNames[s.playerId] ? ' ' + squadNames[s.playerId] : ''}` });
          g.append(svg('circle', { cx: toX(p.x), cy: toY(p.y), r: 3.5 }), svg('text', { class: 'pl-pos', x: toX(p.x), y: toY(p.y) + 0.9, 'text-anchor': 'middle', text: s.pos }));
          const label = s.playerId && squadNames[s.playerId] ? squadNames[s.playerId].split(' ').slice(-1)[0] : '';
          if (label) g.append(svg('text', { class: 'pl-name', x: toX(p.x), y: toY(p.y) + 6.4, 'text-anchor': 'middle', text: label.slice(0, 12) }));
          if (s.role) g.append(svg('title', { text: `${s.pos}: ${s.role}${s.duty ? ' (' + s.duty + ')' : ''}` }));
          svgEl.append(g);
        }

        // ---- fakta
        factsBox.replaceChildren(
          h('h3', { text: 'Rozložení v číslech' }),
          analysis.ok ? h('ul', { class: 'list' }, facts.map((f) => h('li', { title: f.basis || '', text: f.text }))) : h('p', { class: 'hint', text: (analysis.errors || [])[0] || 'Rozložení nejde rozebrat.' })
        );
        // ---- konflikty
        conflictsBox.replaceChildren(
          h('h3', { text: 'Možné prostorové konflikty' }),
          conflicts.length
            ? h('div', { class: 'books' }, conflicts.map((c) => h('div', { class: 'book conflict', 'data-kind': c.kind, onclick: () => ((state.hi = new Set(c.slots)), update()) }, h('div', { class: 'meta' }, h('b', { text: c.text }), h('span', { text: c.basis || '' })), h('span', { class: 'chip t-' + (c.severity === 'warn' ? 'unknown' : c.severity === 'watch' ? 'inferred' : 'observed'), text: SEV_CS[c.severity] || c.severity }))))
            : h('p', { class: 'hint', text: analysis.ok ? 'Při výchozích prazích se nenašlo nic. Prahy jsou heuristiky aplikace, ne pravidla FM27.' : '' })
        );
        // ---- porovnání
        compareBox.replaceChildren();
        if (other) {
          const cmp = Tc.compareTactics(work, other, { phase });
          compareBox.append(h('h3', { text: `Porovnání s „${other.name}“ (čárkované body)` }), cmp.ok ? h('ul', { class: 'list' }, cmp.summary.map((s) => h('li', { text: s }))) : h('p', { class: 'hint', text: (cmp.errors || [])[0] || '' }), h('p', { class: 'hint', text: cmp.note || '' }));
        }
        // ---- přečíslení soupeřem
        overloadBox.replaceChildren();
        let overloads = [];
        if (oppTactic) {
          overloads = Tc.opponentOverloads(work, oppTactic, {});
          overloadBox.append(h('h3', { text: 'Soupeř proti tvému tvaru' }), overloads.length ? h('ul', { class: 'list' }, overloads.map((o) => h('li', { text: o.text }))) : h('p', { class: 'hint', text: 'Při tomhle párování se nenašlo přečíslení v tvé polovině.' }));
        }
        update.last = { analysis, conflicts, facts, overloads };
      }

      // ---- přesouvání hráčů
      let drag = null;
      const point = (ev) => {
        const m = svgEl.getScreenCTM();
        const pt = svgEl.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const p = pt.matrixTransform(m.inverse());
        return { x: fromX(p.x), y: fromY(p.y) };
      };
      const clamp = (v) => Math.min(98, Math.max(2, v));
      const snap = (v) => (state.snap ? Math.round(v / 2.5) * 2.5 : Math.round(v * 10) / 10);
      svgEl.addEventListener('pointerdown', (ev) => {
        const g = ev.target.closest && ev.target.closest('.pl');
        if (!g) return;
        drag = { key: g.getAttribute('data-key') };
        try {
          svgEl.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* nevadí */
        }
        ev.preventDefault();
      });
      svgEl.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const p = point(ev);
        const s = work.slots.find((x) => x.key === drag.key);
        const x = clamp(snap(p.x));
        const y = clamp(snap(p.y));
        if (state.phase === 'out') Object.assign(s, { ox: x, oy: y });
        else Object.assign(s, { x, y });
        update();
      });
      const endDrag = () => {
        if (!drag) return;
        drag = null;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          await app.store.put('tactic', work);
          toast('Rozestavení je uložené.');
        }, 150);
      };
      svgEl.addEventListener('pointerup', endDrag);
      svgEl.addEventListener('pointercancel', endDrag);
      svgEl.addEventListener('keydown', (ev) => {
        const g = ev.target.closest && ev.target.closest('.pl');
        if (!g || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
        const s = work.slots.find((x) => x.key === g.getAttribute('data-key'));
        const d = ev.shiftKey ? 5 : 1;
        const dx = ev.key === 'ArrowLeft' ? -d : ev.key === 'ArrowRight' ? d : 0;
        const dy = ev.key === 'ArrowUp' ? -d : ev.key === 'ArrowDown' ? d : 0;
        const p = phaseXY(s, state.phase);
        const x = clamp(p.x + dx);
        const y = clamp(p.y + dy);
        if (state.phase === 'out') Object.assign(s, { ox: x, oy: y });
        else Object.assign(s, { x, y });
        ev.preventDefault();
        update();
        const again = svgEl.querySelector(`[data-key="${s.key}"]`);
        if (again) again.focus();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => app.store.put('tactic', work), 400);
      });

      // ---- vysvětlení od modelu
      const explainBtn = h('button', { class: 'btn', id: 'labExplainBtn', type: 'button', text: 'Vysvětlit rozložení (AI)', disabled: !FM27.ai.available });
      explainBtn.addEventListener('click', async () => {
        const ai = FM27.ai;
        const E = window.TrenerLabExplain;
        const { analysis, conflicts, facts, overloads } = update.last;
        if (!analysis.ok) return toast('Rozložení nejde rozebrat.');
        const items = [...facts, ...conflicts, ...overloads];
        const observations = Tc.factsToObservations(items, { prefix: '' });
        const obsMap = Object.fromEntries(observations.map((o) => [o.id, { label: o.label, text: o.text }]));
        const ctl = new AbortController();
        running = ctl;
        explainBtn.disabled = true;
        explainBox.replaceChildren();
        explainSteps.reset(['search', 'ask', 'check']);
        try {
          const lib = FM27.library;
          let hits = [];
          if (lib.size) {
            explainSteps.set('search', 'run');
            const seeds = [`${work.formation} rozestavení vzdálenost mezi řadami`, 'prostorové konflikty překrývání pozic hráčů', 'šířka a hloubka týmu kompaktnost', 'zajištění při ztrátě míče'];
            for (const c of conflicts) seeds.push({ line_gap: 'vzdálenost mezi řadami', isolated_forward: 'izolovaný útočník podpora', overlap: 'překrývání prostoru hráčů', empty_channel: 'obsazení meziprostorů', thin_rest_defence: 'zajištění obrany rest defence', width_imbalance: 'asymetrické rozestavení' }[c.kind] || '');
            hits = C.multiSearch(lib.index, seeds.filter(Boolean).slice(0, 6), { k: 8, perBook: 3 });
            explainSteps.set('search', 'done', `${hits.length} ${ui.plural(hits.length, 'úryvek', 'úryvky', 'úryvků')}`);
          } else explainSteps.set('search', 'skip', 'knihovna je prázdná');
          const passageCtx = {};
          for (const hit of hits) {
            const book = lib.bookById(hit.bookId);
            passageCtx[hit.id] = { id: hit.id, bookId: hit.bookId, title: book ? book.title : '?', where: book ? lib.whereLabel(book, hit) : '?', text: hit.text.slice(0, 900) };
          }
          W.snapPut(passageCtx);
          const turns = E.buildExplainTurns({ tactic: work, phase: state.phase, facts: observations, passages: Object.values(passageCtx), playerNames: names(), sourcesDigest: app.registry.digest() });
          const result = await ai.structured({
            turns,
            validate: (x) => E.validateExplain(x, { observations: obsMap, passages: new Set(Object.keys(passageCtx)), registry: app.registry, slotKeys: work.slots.map((s) => s.key) }),
            tier: 'default',
            signal: ctl.signal,
            purpose: 'vysvětlení rozložení',
            onStep: (s, st, note) => explainSteps.set(s, st, note),
          });
          const ctx = { passages: passageCtx, observations: obsMap };
          if (result.status === 'ok') {
            const x = result.value;
            const mark = (list) => h('div', { class: 'advice' }, list.map((it) => W.claim(null, (it.slots || []).join(', ') || 'bez slotů', it, ctx, app)));
            explainBox.append(
              h('div', { class: 'banner ok' }, h('b', { text: 'Vysvětlení prošlo kontrolou poctivosti' }), h('p', { class: 'hint', text: 'Opírá se o geometrii nakreslených pozic a o tvoje knihy. O chování hráčů ve FM27 nic netvrdí.' })),
              h('div', { class: 'advice' }, W.claim(null, 'Shrnutí', x.summary, ctx, app)),
              x.worksWell.length ? h('div', null, h('h3', { text: 'Proč to prostorově funguje' }), mark(x.worksWell)) : null,
              x.conflicts.length ? h('div', null, h('h3', { text: 'Kde může vzniknout konflikt' }), mark(x.conflicts)) : null,
              h('div', { class: 'advice' }, W.sec(null, 'Co trenér neví', ui.tierChip('unknown'), h('p', { text: x.unknown.text }), h('ul', null, x.unknown.items.map((s) => h('li', { text: s }))))),
              h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Poslat nálezy trenérovi', onclick: () => {
                const risky = conflicts.filter((c) => c.severity !== 'info').slice(0, 5);
                for (const c of risky) FM27.coachAddObservation('heuristic_coach', null, c.text, 'geo');
                toast(risky.length ? 'Nálezy jsou v Osobním trenérovi jako pozorování.' : 'Žádné nálezy k odeslání.');
                app.go('trener');
              } }))
            );
          } else explainBox.append(W.failedCheckBanner(result.verdict, 'Vysvětlení neprošlo kontrolou poctivosti', () => explainBtn.click()));
        } catch (e) {
          if (e && e.code === 'cancelled') toast('Zastaveno.');
          else explainBox.append(W.errorBanner(ai.errorText(e), !(e && ai.NO_RETRY.includes(e.code)) ? () => explainBtn.click() : null));
        } finally {
          running = null;
          explainBtn.disabled = !ai.available;
        }
      });

      const controls = h(
        'div',
        { class: 'labbar' },
        h('div', { class: 'row' }, ui.field('Taktika', selA, { grow: true, noMargin: true }), ui.field('Porovnat s', selB, { grow: true, noMargin: true }), ui.field('Soupeřova formace', selOpp, { width: '170px', noMargin: true })),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'seggroup', role: 'group', 'aria-label': 'Fáze hry' }, ...phaseBtns), chk('labLinks', 'Vazby', 'links'), chk('labZones', 'Zóny a počty', 'zones'), chk('labSnap', 'Přichytávat k mřížce', 'snap'))
      );
      root.replaceChildren(
        h(
          'div',
          { class: 'lab-grid' },
          h('section', { class: 'card' }, h('h2', { text: 'Taktická laboratoř' }), h('p', { class: 'lead', text: 'Přetáhni hráče na hřišti (nebo vyber šipkami). Změny se ukládají. Tvar „bez míče“ si nakreslíš zvlášť.' }), controls, svgEl, h('p', { class: 'hint', text: 'Nahoře je branka soupeře, tvůj tým útočí nahoru. Vazby spojují nejbližší spoluhráče, čárkované body jsou porovnávaná taktika, červené soupeřova formace.' })),
          h('section', { class: 'card' }, factsBox, conflictsBox, compareBox, overloadBox, h('div', { class: 'actions' }, explainBtn, h('button', { class: 'btn', type: 'button', text: 'Zastavit', onclick: () => running && running.abort() })), h('p', { class: 'hint', text: FM27.ai.available ? '' : 'Vysvětlení potřebuje Claude.' }), explainSteps.el, explainBox)
        )
      );
      update();
    };

    build();
    app.watch(['tactic', 'player', 'career'], (e) => e && e.origin === 'remote' && build());
    app.onCleanup(() => {
      if (running) running.abort();
    });
  }

  FM27.screens.register({ id: 'laborator', hash: 'laborator', label: 'Taktická laboratoř', order: 5, render });
})();
