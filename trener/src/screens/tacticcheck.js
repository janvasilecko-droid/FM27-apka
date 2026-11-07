/* Karta „Rozbor sestavy a taktiky“ v Moje taktiky (zadání majitele 6. 11. 2026): jedno tlačítko „Analyzovat sestavu a taktiku“, které projde
   (1) sestavu: nejlepší jedenáctka z viditelných atributů hráčů bez ručního popisu rolí, porovnání s tvou jedenáctkou, hloubka, slabá místa podle
   pravidel, výměny a (2) nastavení taktiky: rozpory instrukcí a rolí, chybějící práci a dobře sedící dvojice. Nahoře je seznam „Co řešit jako první“.
   Vše počítají squadcheck.js a tacticanalysis.js v tomhle zařízení, bez AI a bez sítě. Každý nález má důkaz, proč vadí, co přesně změnit a druh zdroje;
   kontroly, kterým chybí údaje, se nevyhodnotí a jsou vypsané zvlášť. Rozbor neslibuje výsledek zápasu a není pravidlem FM27. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h } = ui;
  const TA = () => window.TrenerTacticAnalysis;
  const SC = () => window.TrenerSquadCheck;
  const PA = () => window.TrenerPosAttrs;
  const SEV_CHIP = { error: 'bad', warn: 'warn', note: 'neutral', info: 'neutral', good: 'good' };
  const SEV_RANK = { error: 0, warn: 1, note: 2, info: 3, good: 4 };
  const SEV_CS = { error: 'Vážný nález', warn: 'Upozornění', note: 'Poznámka', info: 'K vědomí', good: 'Silná stránka' };
  const STATE_CS = { gap: 'díra', single: 'žádná záloha', thin: 'pod cílem', ok: 'v pořádku' };
  const STATE_CHIP = { gap: 'bad', single: 'warn', thin: 'neutral', ok: 'good' };
  const cz = (v) => (v === null || v === undefined ? '–' : String(Math.round(v * 10) / 10).replace('.', ','));

  // poslední rozbor každé taktiky přežije překreslení, dokud se taktika nebo hráči nezmění (otisk)
  const last = new Map();

  function fingerprint(tactic, players) {
    return JSON.stringify([
      tactic.formation,
      tactic.mentality,
      tactic.teamInstructions,
      (tactic.slots || []).map((s) => [s.key, s.playerId, s.role, s.oopRole]),
      players.map((p) => [p.id, p.attributes, p.positions, p.age, p.flags]),
    ]);
  }

  function findingEl(f, tactic, source) {
    const posOf = (key) => ((tactic.slots || []).find((s) => s.key === key) || {}).pos;
    const places = [...new Set((f.slots || []).map(posOf).filter(Boolean))];
    return h(
      'div',
      { class: 'book finding', 'data-rule': f.id, 'data-sev': f.sev, 'data-source': source },
      h(
        'div',
        { class: 'meta' },
        h('b', { text: f.title }),
        h('span', { class: 'chips' }, ui.chip(SEV_CHIP[f.sev], SEV_CS[f.sev]), ui.chip('neutral', f.basisCs), f.agree ? ui.chip('neutral', 'shoda zdrojů: ' + f.agree) : null, places.length ? ui.chip('accent', places.join(', ')) : null),
        f.ev.length ? h('ul', { class: 'list' }, f.ev.map((e) => h('li', { text: e }))) : null,
        h('span', { text: f.why }),
        f.fix.length ? h('div', null, h('b', { text: 'Co změnit' }), h('ul', { class: 'list' }, f.fix.map((x) => h('li', { text: x })))) : null
      )
    );
  }

  // ---------------------------------------------------------------- podle čeho se vybírá: atributy podle pozice
  function attrsTable(tactic) {
    const P = PA();
    const posByGroup = {};
    for (const s of tactic.slots || []) {
      const g = window.TrenerDwrs ? window.TrenerDwrs.groupOfPosition(s.pos) : null;
      if (g) (posByGroup[g] = posByGroup[g] || []).push(s.pos);
    }
    const list = (items) => items.map((e) => e.attribute).join(', ');
    const rows = P.GROUPS.map((g) => {
      const d = P.GROUP_DATA[g];
      return h('tr', { 'data-group': g }, h('td', { text: `${d.cs}${posByGroup[g] ? ' (' + [...new Set(posByGroup[g])].join(', ') + ')' : ''}` }), h('td', { class: 'keys', text: list(d.key) }), h('td', { class: 'keys', text: list(d.pref) }));
    });
    const links = Object.entries(P.SOURCES).filter(([, s]) => s.url).map(([id, s]) => h('li', null, h('b', { text: id + ': ' }), h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name })));
    return h(
      'details',
      { id: 'squadAttrs', style: 'margin-top:12px' },
      h('summary', { text: 'Podle čeho se vybírá: které atributy rozhodují na které pozici' }),
      h('p', { class: 'hint', text: 'Každé místo se posuzuje podle klíčových atributů své pozice (počítají se třikrát) a žádoucích (jednou); ostatní atributy skóre neovlivní. Obránce tedy rozhoduje hlavně obrana (Heading, Marking, Tackling, Positioning, Strength) a slabší útok mu neškodí, útočníka naopak zakončení a pohyb. Seznamy jsou z komunitních příruček pro FM26 (slovník je shodný s FM27), ne pravidlo hry. Spolehlivější je profil hráče ve hře: klíčové atributy tam zvýrazní hra sama podle vybrané role a fáze (s míčem zeleně a modře, bez míče růžově a fialově) a liší se role od role (například zatažený útočník s míčem: Technique, Finishing, First Touch, Off The Ball, Composure, Strength). Přečti si je v kartě Profily rolí níž.' }),
      h('div', { class: 'tblscroll' }, h('table', { class: 'tbl', id: 'squadAttrsTable' }, h('thead', null, h('tr', null, ['Pozice', 'Klíčové atributy (×3)', 'Žádoucí atributy (×1)'].map((t) => h('th', { text: t })))), h('tbody', null, rows))),
      h('p', { class: 'hint', text: 'Zdroje:' }),
      h('ul', { class: 'list' }, links),
      h('p', { class: 'hint', text: 'DW = odhad autora aplikace tam, kde se zdroje k atributu nevyjadřují. Základní minimum pro hráče v poli (Passing, Decisions, Determination, Pace, Acceleration, Strength, Stamina aspoň 11) je z příručky Vortex Gaming.' })
    );
  }

  // ---------------------------------------------------------------- sestava
  function squadEl(tactic, r) {
    const out = h('div', { id: 'squadSection' }, h('h3', { text: 'Sestava', style: 'margin-top:14px' }));
    const c = r.coverage;
    out.append(h('p', { class: 'hint', id: 'squadCoverage', text: `Hráčů: ${c.players} (úplné atributy ${c.complete}, částečné ${c.partial}, žádné ${c.none}); zranění ${c.injured}. Model: ${r.model}. Role se tu nepopisují: počítá se podle skupiny pozic místa.` }));
    if (!r.usable) {
      out.append(h('div', { class: 'banner warn', id: 'squadUnusable' }, h('b', { text: 'Sestavu nejde posoudit' }), h('span', { text: r.notes[0] || 'Chybí hráči nebo jejich atributy.' })));
      return out;
    }
    if (r.user.avg !== null) {
      out.append(h('p', { id: 'squadAvg', text: `Průměr tvé jedenáctky ${cz(r.user.avg)} bodu na místo, nejlepší podle modelu ${cz(r.user.bestAvg)} (stupnice 0 až 100, odhad).` }));
    } else if (r.user.picked) {
      out.append(h('p', { class: 'hint', id: 'squadAvg', text: `V taktice máš obsazeno ${r.user.picked} z ${r.xi.length} míst; zbytek doplnil model. Pro porovnání s nejlepší jedenáctkou obsaď všechna místa.` }));
    } else {
      out.append(h('p', { class: 'hint', id: 'squadAvg', text: 'V taktice zatím nejsou obsazená místa hráči: ukazuje se nejlepší jedenáctka podle modelu. Hráče na pozice přiřadíš v editoru výš.' }));
    }
    out.append(
      h(
        'div',
        { class: 'tblscroll' },
      h(
        'table',
        { class: 'tbl', id: 'squadXi' },
        h('thead', null, h('tr', null, ['Místo', 'Hraje', 'Skóre', 'Jeho klíčové atributy pro místo', 'Nejlepší podle modelu', 'Skóre'].map((t) => h('th', { text: t })))),
        h(
          'tbody',
          null,
          r.xi.map((e) => {
            const st = e.starter;
            const tag = e.source === 'user' ? '' : ' (doplnil model)';
            const partial = (x) => (x && x.partial ? ' (částečné atributy)' : '');
            const keys = st && st.keys && st.keys.length ? st.keys.slice(0, 5).map((k) => `${k.attribute} ${k.value}`).join(' · ') : '–';
            return h('tr', { 'data-slot': e.slotKey, 'data-source': e.source }, h('td', { text: e.pos }), h('td', { text: st ? st.name + tag : 'nikdo' }), h('td', { text: st ? cz(st.score) + partial(st) : '–' }), h('td', { class: 'keys', text: keys }), h('td', { text: e.best ? e.best.name : 'nikdo' }), h('td', { text: e.best ? cz(e.best.score) + partial(e.best) : '–' }));
          })
        )
      )
      )
    );
    out.append(attrsTable(tactic));
    if (r.swaps.length) {
      out.append(h('h4', { text: 'Navržené výměny (podle modelu, odhad)', style: 'margin-top:12px' }));
      out.append(h('ul', { class: 'list', id: 'squadSwaps' }, r.swaps.map((s) => h('li', { 'data-slot': s.slotKey, text: `${s.pos}: ${s.current.name} → ${s.better.name}${s.gain === null ? ' (současného hráče nejde ohodnotit)' : ` (+${cz(s.gain)} bodu)`}` }))));
    }
    out.append(h('h4', { text: 'Hloubka podle skupin pozic (cíl: dva hráči na místo)', style: 'margin-top:12px' }));
    out.append(
      h(
        'div',
        { class: 'tblscroll' },
      h(
        'table',
        { class: 'tbl', id: 'squadDepth' },
        h('thead', null, h('tr', null, ['Skupina', 'Místa', 'Použitelných hráčů', 'Cíl', 'Stav'].map((t) => h('th', { text: t })))),
        h('tbody', null, r.depth.map((d) => h('tr', { 'data-group': d.group, 'data-state': d.state }, h('td', { text: (window.TrenerDwrs && window.TrenerDwrs.GROUP_CS[d.group]) || d.group }), h('td', { text: [...new Set(d.positions)].join(', ') }), h('td', { text: `${d.eligible} (přirozených ${d.natural})` }), h('td', { text: String(d.target) }), h('td', null, ui.chip(STATE_CHIP[d.state], STATE_CS[d.state])))))
      )
      )
    );
    if (r.findings.length) {
      out.append(h('h4', { text: 'Slabá místa a co s nimi', style: 'margin-top:12px' }));
      out.append(h('div', { class: 'books', id: 'squadFindings' }, r.findings.map((f) => findingEl(f, tactic, 'squad'))));
    } else {
      out.append(h('div', { class: 'banner ok', id: 'squadFindings' }, h('b', { text: 'Žádné slabé místo podle pravidel se nenašlo' }), h('span', { text: 'To neznamená, že je sestava výborná: smlouvy, formu ani morálku aplikace zatím nezná.' })));
    }
    if (r.strengths.length) {
      out.append(h('h4', { text: 'Silné stránky sestavy', style: 'margin-top:12px' }));
      out.append(h('div', { class: 'books', id: 'squadStrengths' }, r.strengths.map((f) => findingEl(f, tactic, 'squad'))));
    }
    if (r.age) out.append(h('p', { class: 'hint', id: 'squadAge', text: `Věk: průměr jedenáctky ${cz(r.age.avgXi)}; v kádru ${r.age.buckets.u21} do 21 let, ${r.age.buckets.mid} ve věku 22 až 29, ${r.age.buckets.o30} od 30 let.` }));
    if (r.notes.length) out.append(h('ul', { class: 'list hint', id: 'squadNotes' }, r.notes.map((n) => h('li', { text: n }))));
    return out;
  }

  // ---------------------------------------------------------------- taktika
  function coverageText(r) {
    const c = r.coverage;
    return [`mentalita: ${r.mentality || 'nepřečtena'}`, `týmové instrukce: ${c.settingsKnown} z ${c.settingsTotal}`, `role s míčem: ${c.rolesIn.known} z ${c.rolesIn.total}`, `role bez míče: ${c.rolesOut.known} z ${c.rolesOut.total}`, `atributy hráčů u ${c.withAttributes} z ${c.slotsTotal} míst`].join(' · ');
  }

  function tacticEl(tactic, r) {
    const out = h('div', { id: 'tacticSection' }, h('h3', { text: 'Taktika', style: 'margin-top:18px' }));
    out.append(h('p', { class: 'hint', id: 'tacCheckCoverage', text: 'Přečteno a použito: ' + coverageText(r) + '.' }));
    if (r.coverage.settingsKnown < 6 || r.coverage.rolesIn.known < r.coverage.rolesIn.total) {
      out.append(h('p', { class: 'hint', text: 'Čím víc instrukcí a rolí (s míčem i bez míče) je v taktice, tím víc kontrol jde vyhodnotit. Doplň je v editoru výš nebo je přečti z obrazovky hry v kartě níž.' }));
    }
    if (r.unknownSettings.length) out.append(h('p', { class: 'hint', id: 'tacCheckUnknown', text: 'Nerozpoznané instrukce (nevyhodnocují se, nic se z nich nehádá): ' + r.unknownSettings.join('; ') }));
    if (r.findings.length) {
      const err = r.findings.filter((f) => f.sev === 'error').length;
      out.append(h('div', { class: 'banner ' + (err ? 'bad' : 'warn'), id: 'tacCheckBanner' }, h('b', { text: `V nastavení taktiky ${r.findings.length} ${ui.plural(r.findings.length, 'bod', 'body', 'bodů')} k zamyšlení` }), h('span', { text: err ? `z toho ${err} vážných rozporů. Seřazeno od nejzávažnějších.` : 'Žádný vážný rozpor, jen upozornění a poznámky.' })));
      out.append(h('div', { class: 'books', id: 'tacCheckFindings' }, r.findings.map((f) => findingEl(f, tactic, 'tactic'))));
    } else {
      out.append(h('div', { class: 'banner ok', id: 'tacCheckBanner' }, h('b', { text: 'Žádný z vyhodnocených rozporů se nenašel' }), h('span', { text: `Vyhodnoceno ${r.checks.evaluated} z ${r.checks.total} kontrol. To neznamená, že je taktika dobrá: nevyhodnocené kontroly jsou níž.` })));
    }
    if (r.strengths.length) {
      out.append(h('h4', { text: 'Silné stránky nastavení', style: 'margin-top:12px' }));
      out.append(h('div', { class: 'books', id: 'tacCheckStrengths' }, r.strengths.map((f) => findingEl(f, tactic, 'tactic'))));
    }
    out.append(h('p', { class: 'hint', id: 'tacCheckCounts', text: `Kontroly: vyhodnoceno ${r.checks.evaluated} z ${r.checks.total} (bez nálezu ${r.checks.passed}, s nálezem ${r.checks.fired}); na tohle rozestavení se nevztahuje ${r.checks.notApplicable}; nevyhodnoceno kvůli chybějícím údajům ${r.checks.notEvaluated.length}. Instrukcí jiných než výchozích mezi přečtenými: ${r.complexity.nonDefaultInstructions} (přečteno ${r.coverage.settingsKnown} z ${r.coverage.settingsTotal}; úroveň složitosti odhaduje karta Tactical Effectiveness).` }));
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
    return out;
  }

  // ---------------------------------------------------------------- shrnutí „co řešit jako první“
  function topEl(tactic, sq, tr) {
    const items = [];
    if (sq) for (const f of sq.findings) items.push({ f, source: 'squad', area: 'Sestava' });
    if (tr) for (const f of tr.findings) items.push({ f, source: 'tactic', area: 'Taktika' });
    items.sort((a, b) => SEV_RANK[a.f.sev] - SEV_RANK[b.f.sev]);
    const top = items.filter((x) => x.f.sev === 'error' || x.f.sev === 'warn').slice(0, 6);
    const box = h('div', { id: 'tacCheckTop' }, h('h3', { text: 'Co řešit jako první' }));
    if (!top.length) {
      box.append(h('p', { class: 'hint', text: items.length ? 'Žádný vážný nález ani upozornění; poznámky jsou níž v sestavě a v taktice.' : 'Nic k řešení se nenašlo (viz, co všechno se nevyhodnotilo, níž).' }));
      return box;
    }
    box.append(h('ol', { class: 'list' }, top.map((x) => h('li', { 'data-rule': x.f.id, 'data-source': x.source }, h('b', { text: `${x.area}: ` }), h('span', { text: x.f.title }), x.f.fix.length ? h('div', { class: 'hint', text: 'Změna: ' + x.f.fix[0] }) : null))));
    return box;
  }

  function resultEl(tactic, res) {
    const out = h('div', { id: 'tacCheckResult' });
    out.append(topEl(tactic, res.squad, res.tac));
    if (res.squad) out.append(squadEl(tactic, res.squad));
    if (res.tac) out.append(tacticEl(tactic, res.tac));
    const lines = [].concat(res.squad ? SC().summaryLines(res.squad) : [], res.tac ? TA().summaryLines(res.tac) : []);
    out.append(h('div', { class: 'actions' }, h('button', { class: 'btn small', id: 'tacCheckCopy', type: 'button', text: 'Kopírovat rozbor', onclick: () => ui.copyText(lines.join('\n'), 'Rozbor je zkopírovaný.') })));
    return out;
  }

  function card(app, tactic) {
    const sec = h('section', { class: 'card', id: 'tacCheckCard' }, h('h2', { text: 'Rozbor sestavy a taktiky' }));
    if (!TA() || !SC() || !PA()) {
      sec.append(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul rozboru sestavy nebo taktiky' })));
      return sec;
    }
    const players = FM27.context.players(app);
    const key = fingerprint(tactic, players);
    const slot = h('div', { id: 'tacCheckBox' });
    const run = () => {
      let res;
      try {
        const W = FM27.weightsUI;
        res = { squad: SC().analyze(tactic, players, { wp: W ? W.activeProfile(app) : undefined }), tac: TA().analyze(tactic, { players }) };
      } catch (e) {
        slot.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Rozbor se nepodařilo spočítat' }), h('span', { text: String(e && e.message ? e.message : e) })));
        return;
      }
      last.set(tactic.id, { key, res });
      slot.replaceChildren(resultEl(tactic, res));
    };
    sec.append(
      h('p', { class: 'lead', text: 'Jedním kliknutím projde sestavu (podle atributů hráčů, bez ručního popisu rolí) i nastavení taktiky. U sestavy najde nejlepší jedenáctku, slabá místa podle pravidel (málo hráčů na pozici, žádná záloha, propad mezi základem a zálohou, slabé klíčové atributy, stárnoucí hráč bez nástupce) a navrhne výměny; u taktiky najde rozpory v instrukcích a rolích. Ke každému nálezu řekne, co přesně změnit. Počítá se v tomhle zařízení, bez AI. Je to pomůcka (tabulky vhodnosti jsou odhad, pravidla taktiky názor komunitních průvodců a texty hry), ne pravidlo FM27 a ne předpověď výsledku.' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'tacCheckBtn', type: 'button', text: 'Analyzovat sestavu a taktiku', onclick: run })),
      slot
    );
    const prev = last.get(tactic.id);
    if (prev && prev.key === key) slot.replaceChildren(resultEl(tactic, prev.res));
    else if (prev) slot.replaceChildren(h('p', { class: 'hint', id: 'tacCheckStale', text: 'Taktika nebo hráči se od posledního rozboru změnili. Klikni znovu na „Analyzovat sestavu a taktiku“.' }));
    return sec;
  }

  FM27.tacticCheckUI = { card };
})();
