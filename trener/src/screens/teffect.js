/* Karta „Tactical Effectiveness“ v Moje taktiky (zadání majitele: FM27 má nové měřidlo a aplikace ho má umět vysvětlit a poradit). Hra ukazuje měřidla jen jako barevné
   pruhy bez čísel, proto tu úrovně pilířů zadáváš sám podle toho, co vidíš v Trénink › Tactical Effectiveness; aplikace k nim doplní vysvětlení z textů hry, rady podle
   klíčových faktorů, odhad složitosti tvé taktiky a doporučená sezení z tréninkového rozvrhu. Výpočet je v tacteff.js. Nic se nepředpovídá a nic se samo nemění. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h } = ui;
  const TE = () => window.TrenerTactEff;
  const TA = () => window.TrenerTacticAnalysis;
  const LEVEL_CHIP = { low: 'bad', mid: 'warn', high: 'good', unknown: 'neutral' };

  // zadané úrovně přežijí překreslení obrazovky (jen v tomto sezení; hra úrovně mění každý zápas, proto se neukládají do taktiky)
  const state = new Map();

  function card(app, tactic) {
    const T = TE();
    if (!T || !tactic) return null;
    const st = state.get(tactic.id) || { levels: {}, hint: '', opp: '' };
    state.set(tactic.id, st);
    const CS = window.TrenerFm27Cs;
    const pillars = CS.TE.pillars;
    const levelSelect = (id, label) => ui.select(T.LEVELS.map((l) => [l, T.LEVEL_CS[l]]), st.levels[id] || 'unknown', { id: `te-${id}`, 'aria-label': label, onchange: (e) => (st.levels[id] = e.target.value) });
    const rows = pillars.map((p) => h('div', { class: 'row' }, ui.field(`${p.name} (${T.PILLAR_INFO[p.id].cs})`, levelSelect(p.id, p.name), { hint: T.PILLAR_INFO[p.id].csDesc, grow: true })));
    const overall = h('div', { class: 'row' }, ui.field('Celková efektivita (Effectiveness)', levelSelect('overall', 'Celková efektivita'), { hint: 'Pruh vpravo nahoře na obrazovce Taktika a „Celková efektivita“ na stránce Tactical Effectiveness.', grow: true }));
    const hint = ui.select([['', '— asistent nic nejmenuje / nevím —'], ...CS.TRAINING.tacticalUnderstanding.map((s) => [s, s])], st.hint || '', { id: 'teHint', onchange: (e) => (st.hint = e.target.value) });
    const opp = ui.input({ id: 'teOpp', type: 'number', min: '0', max: '11', value: st.opp, placeholder: '0', oninput: (e) => (st.opp = e.target.value) });
    const out = h('div', { id: 'teResult' });

    function run() {
      const players = FM27.context.players(app);
      const ta = TA() ? TA().analyze(tactic, { players }) : null;
      const n = st.opp === '' ? null : Number(st.opp);
      const r = T.analyze({ levels: Object.assign({}, st.levels), assistantHint: st.hint || null, tacticAnalysis: ta, oppositionInstructions: Number.isInteger(n) ? n : null });
      out.replaceChildren();
      out.append(
        h('div', { class: 'banner ok', id: 'tePriority' }, h('b', { text: 'Na co se zaměřit nejdřív' }), h('span', { text: r.priority.length ? r.priority.map((id) => { const p = r.pillars.find((x) => x.id === id); return `${p.name} (${p.levelCs})`; }).join(' → ') : 'Všechny pilíře jsou vysoké: hlavně nemáchej v taktice.' }))
      );
      for (const p of r.pillars) {
        out.append(
          h(
            'div',
            { class: 'book finding', id: `te-block-${p.id}`, 'data-level': p.level },
            h(
              'div',
              { class: 'meta' },
              h('b', { text: `${p.name}: ${p.levelCs}` }),
              h('span', { class: 'chips' }, ui.chip(LEVEL_CHIP[p.level], p.levelCs), ui.chip('neutral', 'popis pilíře: text hry')),
              h('span', { class: 'hint', text: p.csDesc }),
              p.note ? h('span', { text: p.note }) : null,
              p.advice.length ? h('details', { open: p.level === 'low' }, h('summary', { text: `Klíčové faktory (názvy ze hry) a rady k nim (komunita a odhad autora, ${p.advice.length})` }), h('ul', { class: 'list' }, p.advice.map((a) => h('li', null, h('b', { text: a.factor + ': ' }), h('span', { text: a.text }))))) : h('details', null, h('summary', { text: 'Klíčové faktory (názvy ze hry)' }), h('ul', { class: 'list' }, p.factors.map((f) => h('li', { text: f }))))
            )
          )
        );
      }
      if (r.complexity) {
        const c = r.complexity;
        out.append(
          h(
            'div',
            { class: 'book finding', id: 'teComplexity', 'data-level': c.level },
            h(
              'div',
              { class: 'meta' },
              h('b', { text: `Složitost tvé taktiky: ${c.level} (odhad aplikace)` }),
              h('span', { class: 'chips' }, ui.chip('neutral', 'odhad autora aplikace')),
              h('span', { text: `Instrukcí mimo výchozí hodnotu: ${c.nonDefault}${c.opposition !== null ? `, pokynů k soupeři: ${c.opposition}` : ''} (celkem ${c.total}${c.complete ? '' : ', nejméně'}). Přečteno ${c.known === null ? 'jen část' : `${c.known} z ${c.allInstructions}`} týmových instrukcí.` }),
              h('span', { class: 'hint', text: c.note }),
              c.nonDefaultList.length ? h('details', null, h('summary', { text: 'Které instrukce to jsou' }), h('ul', { class: 'list', id: 'teComplexityList' }, c.nonDefaultList.map((x) => h('li', { text: x })))) : null
            )
          )
        );
      }
      if (r.sessions.length) {
        out.append(h('h3', { text: 'Doporučená sezení (Trénink › Tréninkový rozvrh)' }), h('ul', { class: 'list', id: 'teSessions' }, r.sessions.map((s) => h('li', { 'data-category': s.category }, h('b', { text: s.session ? `${s.category}: ${s.session}` : s.category }), h('span', { text: ` — ${s.why}` }), ui.chip(s.basis === 'HRA' ? 'good' : 'neutral', s.basis === 'HRA' ? 'radí hra' : 'odhad')))));
      }
      out.append(h('h3', { text: 'Co si pamatovat' }), h('ul', { class: 'list', id: 'teWarnings' }, r.warnings.map((w) => h('li', { text: w }))), h('details', { id: 'teUnknown' }, h('summary', { text: 'Co aplikace neví' }), h('ul', { class: 'list' }, r.unknown.map((w) => h('li', { text: w })))));
    }

    return h(
      'section',
      { class: 'card', id: 'teCard' },
      h('h2', { text: 'Tactical Effectiveness' }),
      h('p', { class: 'lead', text: 'FM27 měří, jak dobře tým rozumí taktice a umí ji na zápas provést (Trénink › Tactical Effectiveness, čtyři pilíře). Ve hře jsou měřidla jen barevné pruhy bez čísel, proto úrovně zadáš sám podle toho, co vidíš. Aplikace k nim vysvětlí, co pilíř znamená, poradí podle klíčových faktorů, odhadne složitost tvé taktiky a doporučí sezení z tréninkového rozvrhu. Nic se nepředpovídá a nic se samo nemění.' }),
      ...rows,
      overall,
      h('div', { class: 'row' }, ui.field('Asistent ve hře radí věnovat víc času…', hint, { hint: 'Věta pod pilířem Tactical Understanding, např. „We need to dedicate more time to Build Up in training“.', grow: true }), ui.field('Pokyny k soupeři, které máš nastavené', opp, { hint: 'Počítají se do složitosti. Nechej prázdné, když nevíš.', width: '230px' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'teRun', type: 'button', text: 'Vysvětlit a poradit', onclick: run })),
      out
    );
  }

  FM27.teUI = { card };
})();
