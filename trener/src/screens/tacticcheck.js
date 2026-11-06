/* Karta „Rozbor taktiky“ v Moje taktiky (zadání majitele 6. 11. 2026): jedno tlačítko, které z nastavení taktiky a z viditelných atributů hráčů
   vypíše rozpory, chybějící práci rolí a dobře sedící dvojice. Vše počítá tacticanalysis.js v tomhle zařízení, bez AI a bez sítě.
   Každý nález nese důkaz (co je nastavené), proč vadí, co přesně změnit, druh zdroje a shodu průvodců; kontroly, kterým chybí údaje, se
   nevyhodnotí a jsou vypsané zvlášť. Rozbor neslibuje výsledek zápasu a není pravidlem FM27. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h } = ui;
  const A = () => window.TrenerTacticAnalysis;
  const SEV_CHIP = { error: 'bad', warn: 'warn', note: 'neutral', info: 'neutral', good: 'good' };

  // poslední rozbor každé taktiky přežije překreslení, dokud se taktika nebo hráči nezmění (otisk)
  const last = new Map();

  function fingerprint(tactic, players) {
    return JSON.stringify([
      tactic.formation,
      tactic.mentality,
      tactic.teamInstructions,
      (tactic.slots || []).map((s) => [s.key, s.playerId, s.role, s.oopRole]),
      players.map((p) => [p.id, p.attributes]),
    ]);
  }

  function findingEl(f, tactic) {
    const posOf = (key) => ((tactic.slots || []).find((s) => s.key === key) || {}).pos;
    const places = [...new Set(f.slots.map(posOf).filter(Boolean))];
    return h(
      'div',
      { class: 'book finding', 'data-rule': f.id, 'data-sev': f.sev },
      h(
        'div',
        { class: 'meta' },
        h('b', { text: f.title }),
        h('span', { class: 'chips' }, ui.chip(SEV_CHIP[f.sev], A().SEV_CS[f.sev]), ui.chip('neutral', f.basisCs), f.agree ? ui.chip('neutral', 'shoda zdrojů: ' + f.agree) : null, places.length ? ui.chip('accent', places.join(', ')) : null),
        f.ev.length ? h('ul', { class: 'list' }, f.ev.map((e) => h('li', { text: e }))) : null,
        h('span', { text: f.why }),
        f.fix.length ? h('div', null, h('b', { text: 'Co změnit' }), h('ul', { class: 'list' }, f.fix.map((x) => h('li', { text: x })))) : null
      )
    );
  }

  function coverageText(r) {
    const c = r.coverage;
    const parts = [
      `mentalita: ${r.mentality || 'nepřečtena'}`,
      `týmové instrukce: ${c.settingsKnown} z ${c.settingsTotal}`,
      `role s míčem: ${c.rolesIn.known} z ${c.rolesIn.total}`,
      `role bez míče: ${c.rolesOut.known} z ${c.rolesOut.total}`,
      `atributy hráčů u ${c.withAttributes} z ${c.slotsTotal} míst`,
    ];
    return parts.join(' · ');
  }

  function resultEl(tactic, r) {
    const out = h('div', { id: 'tacCheckResult' });
    const lines = A().summaryLines(r);
    out.append(h('p', { class: 'hint', id: 'tacCheckCoverage', text: 'Přečteno a použito: ' + coverageText(r) + '.' }));
    if (r.coverage.settingsKnown < 6 || r.coverage.rolesIn.known < r.coverage.rolesIn.total) {
      out.append(h('p', { class: 'hint', text: 'Čím víc instrukcí a rolí (s míčem i bez míče) je v taktice, tím víc kontrol jde vyhodnotit. Doplň je v editoru výš nebo je přečti z obrazovky hry v kartě níž.' }));
    }
    if (r.unknownSettings.length) out.append(h('p', { class: 'hint', id: 'tacCheckUnknown', text: 'Nerozpoznané instrukce (nevyhodnocují se, nic se z nich nehádá): ' + r.unknownSettings.join('; ') }));

    if (r.findings.length) {
      const err = r.findings.filter((f) => f.sev === 'error').length;
      out.append(h('div', { class: 'banner ' + (err ? 'bad' : 'warn'), id: 'tacCheckBanner' }, h('b', { text: `Nalezeno ${r.findings.length} ${ui.plural(r.findings.length, 'bod', 'body', 'bodů')} k zamyšlení` }), h('span', { text: err ? `z toho ${err} vážných rozporů. Seřazeno od nejzávažnějších.` : 'Žádný vážný rozpor, jen upozornění a poznámky.' })));
      out.append(h('div', { class: 'books', id: 'tacCheckFindings' }, r.findings.map((f) => findingEl(f, tactic))));
    } else {
      out.append(h('div', { class: 'banner ok', id: 'tacCheckBanner' }, h('b', { text: 'Žádný z vyhodnocených rozporů se nenašel' }), h('span', { text: `Vyhodnoceno ${r.checks.evaluated} z ${r.checks.total} kontrol. To neznamená, že je taktika dobrá: nevyhodnocené kontroly jsou níž.` })));
    }
    if (r.strengths.length) {
      out.append(h('h3', { text: 'Silné stránky nastavení', style: 'margin-top:14px' }));
      out.append(h('div', { class: 'books', id: 'tacCheckStrengths' }, r.strengths.map((f) => findingEl(f, tactic))));
    }
    out.append(
      h(
        'p',
        { class: 'hint', id: 'tacCheckCounts' },
        `Kontroly: vyhodnoceno ${r.checks.evaluated} z ${r.checks.total} (bez nálezu ${r.checks.passed}, s nálezem ${r.checks.fired}); na tohle rozestavení se nevztahuje ${r.checks.notApplicable}; nevyhodnoceno kvůli chybějícím údajům ${r.checks.notEvaluated.length}. Složitost podle počtu nastavených instrukcí: ${r.complexity.level} (${r.complexity.nonDefaultInstructions} jiných než výchozích).`
      )
    );
    if (r.checks.notEvaluated.length) {
      out.append(
        h(
          'details',
          { id: 'tacCheckMissing' },
          h('summary', { text: `Nevyhodnocené kontroly (${r.checks.notEvaluated.length}): co k nim chybí doplnit` }),
          h('p', { class: 'hint', text: 'U těchhle kontrol chybí údaj, který se nehádá: instrukce nebyla načtena, role není v taktice nebo není rozpoznaná, nebo u hráčů nejsou atributy. Chybějící instrukce se nebere jako výchozí hodnota.' }),
          h('ul', { class: 'list' }, r.checks.notEvaluated.map((x) => h('li', { text: `${x.id}: ${x.title}` })))
        )
      );
    }
    out.append(h('p', { class: 'hint', text: r.note }));
    out.append(h('div', { class: 'actions' }, h('button', { class: 'btn small', id: 'tacCheckCopy', type: 'button', text: 'Kopírovat rozbor', onclick: () => ui.copyText(lines.join('\n'), 'Rozbor je zkopírovaný.') })));
    return out;
  }

  function card(app, tactic) {
    const sec = h('section', { class: 'card', id: 'tacCheckCard' }, h('h2', { text: 'Rozbor taktiky' }));
    if (!A()) {
      sec.append(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul rozboru taktiky' })));
      return sec;
    }
    const players = FM27.context.players(app);
    const key = fingerprint(tactic, players);
    const slot = h('div', { id: 'tacCheckBox' });
    const run = () => {
      let r;
      try {
        r = A().analyze(tactic, { players });
      } catch (e) {
        slot.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Rozbor se nepodařilo spočítat' }), h('span', { text: String(e && e.message ? e.message : e) })));
        return;
      }
      last.set(tactic.id, { key, r });
      slot.replaceChildren(resultEl(tactic, r));
    };
    sec.append(
      h('p', { class: 'lead', text: 'Najde v nastavení taktiky rozpory (například vysoký presink s hlubokou obranou), chybějící práci rolí a dobře sedící dvojice, a ke každému nálezu řekne, co přesně změnit. Počítá se v tomhle zařízení, bez AI. Je to pomůcka podle komunitních průvodců a textů hry, ne pravidlo FM27 a ne předpověď výsledku.' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'tacCheckBtn', type: 'button', text: 'Analyzovat taktiku', onclick: run })),
      slot
    );
    const prev = last.get(tactic.id);
    if (prev && prev.key === key) slot.replaceChildren(resultEl(tactic, prev.r));
    else if (prev) slot.replaceChildren(h('p', { class: 'hint', id: 'tacCheckStale', text: 'Taktika nebo hráči se od posledního rozboru změnili. Klikni znovu na „Analyzovat taktiku“.' }));
    return sec;
  }

  FM27.tacticCheckUI = { card };
})();
