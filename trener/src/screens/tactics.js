/* Moje taktiky: uložené a alternativní taktiky kariéry, import ručního plánu a kontrola souboru .fmf.
   Zadání § 4: nehádat vnitřní strukturu souborů, upozornit na chybějící údaje, nabídnout doplnění ručně a řádně
   označit, co je ověřené. Soubor .fmf se tu jen zkontroluje; pole taktiky se z něj nedekódují (to zatím neumíme). */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h, $, toast } = ui;

  let selectedId = null;
  let importNote = null; // výsledek posledního importu; přežije překreslení obrazovky
  const FZSTD_URL = 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js';

  // ------------------------------------------------------------------ zstd na požádání (jen při kontrole .fmf)
  let fzstdPromise = null;
  function loadFzstd() {
    if (window.fzstd) return Promise.resolve(window.fzstd);
    if (!fzstdPromise) {
      fzstdPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = FZSTD_URL;
        s.onload = () => (window.fzstd ? resolve(window.fzstd) : reject(new Error('Knihovna zstd se načetla, ale chybí.')));
        s.onerror = () => {
          fzstdPromise = null;
          reject(new Error('Knihovnu pro rozbalení zstd se nepodařilo načíst.'));
        };
        document.head.appendChild(s);
      });
    }
    return fzstdPromise;
  }

  const T = () => window.TrenerTactics;
  const tacticsOf = (app) => FM27.context.tactics(app);

  async function saveTactic(app, tactic) {
    const career = app.career();
    return app.store.put('tactic', Object.assign(app.store.draft(tactic), { careerId: career.id }));
  }
  async function setActive(app, id) {
    const career = app.store.draft(app.career());
    career.activeTacticId = id;
    await app.store.put('career', career);
  }

  // ------------------------------------------------------------------ původ údajů z importu
  const SOURCE_CS = { manual: 'zadáno ručně', plan_json: 'z ručního plánu', fmf: 'ze souboru .fmf (jen kontrola)', screenshot: 'ze screenshotu' };
  function sourceBlock(t) {
    const src = t.source || { type: 'manual', fields: {} };
    const fields = src.fields || {};
    const rows = Object.entries(fields);
    return h(
      'div',
      { class: 'hint', id: 'tacSource' },
      `Původ: ${SOURCE_CS[src.type] || src.type}${src.fileName ? ' (' + src.fileName + ')' : ''}${src.importedAt ? ', ' + ui.fmtDate(src.importedAt) : ''}. `,
      rows.length ? `Údaje: ${rows.map(([k, v]) => `${k}: ${v === 'unknown' ? 'neznámé' : v === 'user_entered' ? 'zadal uživatel' : v}`).join('; ')}.` : 'Všechno je tvoje zadání, nic se nenačítalo z FM27.'
    );
  }

  // ------------------------------------------------------------------ import plánu
  const setNote = (box, ...nodes) => {
    importNote = nodes.length ? nodes : null;
    box.replaceChildren(...nodes);
  };

  async function importPlan(app, file, box) {
    const Tc = T();
    setNote(box);
    let parsed;
    try {
      parsed = Tc.importPlanJson(await file.text(), { fileName: file.name, careerId: app.career().id, now: Date.now() });
    } catch (e) {
      setNote(box, h('div', { class: 'banner bad' }, h('b', { text: 'Plán se nepodařilo načíst' }), h('span', { text: e.message || String(e) })));
      return;
    }
    const rep = parsed.report;
    if (rep.errors.length || !parsed.tactic) {
      setNote(box, h('div', { class: 'banner bad' }, h('b', { text: 'Soubor není použitelný plán' }), h('ul', { class: 'list' }, rep.errors.map((e) => h('li', { text: e })))));
      return;
    }
    const imported = await FM27.team.importPlanPlayers(app, parsed.players);
    const tactic = parsed.tactic;
    tactic.name = tactic.name || file.name.replace(/\.[^.]+$/, '');
    tactic.slots = tactic.slots.map((s) => (s.playerId && imported.map[s.playerId] ? Object.assign({}, s, { playerId: imported.map[s.playerId] }) : Object.assign({}, s, { playerId: null })));
    const saved = await saveTactic(app, tactic);
    selectedId = saved.id;
    setNote(
      box,
      h(
        'div',
        { class: 'banner ok' },
        h('b', { text: `Taktika „${saved.name}“ je načtená` }),
        h('p', { text: `Hráči: přidáno ${imported.added}, už v soupisce bylo ${imported.skipped}.` }),
        rep.userEntered.length ? h('p', { class: 'hint', text: 'Přečteno jako tvoje zadání: ' + rep.userEntered.join(', ') + '.' }) : null,
        rep.unknown.length ? h('p', { class: 'hint', text: 'Neznámé (doplň ručně): ' + rep.unknown.join(', ') + '.' }) : null,
        rep.warnings.length ? h('ul', { class: 'list' }, rep.warnings.map((w) => h('li', { text: w }))) : null
      )
    );
  }

  // ------------------------------------------------------------------ kontrola .fmf
  async function inspectFile(app, file, box) {
    const Tc = T();
    setNote(box, h('p', { class: 'hint', text: 'Kontroluji soubor…' }));
    let report;
    let zstdNote = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let decompress = null;
      try {
        decompress = window.TrenerFmfGlue.makeFirstFrameDecompressor(await loadFzstd());
      } catch (e) {
        zstdNote = e.message || String(e);
      }
      report = Tc.inspectFmf(bytes, decompress ? { decompress } : {});
    } catch (e) {
      setNote(box, h('div', { class: 'banner bad' }, h('b', { text: 'Soubor se nepodařilo zkontrolovat' }), h('span', { text: e.message || String(e) })));
      return;
    }
    const rows = [
      ['Velikost', `${report.size} B`],
      ['Hlavička', report.header.hex + (report.header.matchesObserved ? ' (shoduje se s pozorováním z jednoho vzorku)' : ' (neshoduje se)')],
      ['Zstandard rámce', `${report.candidates.found} nalezeno, ${report.candidates.tried} zkoušeno`],
      ['Manifest', report.manifest ? `ano, ${report.manifest.tokenCount} tokenů, odhad názvu: ${report.manifest.tacticNameGuess || 'žádný'}` : 'nenalezen'],
      ['Pole taktiky (formace, role, instrukce…)', 'nedekódována, nic není ověřeno'],
    ];
    const next = h(
      'div',
      { class: 'actions' },
      h('button', {
        class: 'btn small',
        type: 'button',
        text: 'Uložit zprávu o souboru',
        onclick: () => app.saveFile('fmf-zprava.json', JSON.stringify({ format: 'fm27-fmf-inspect', createdAt: new Date().toISOString(), fileName: file.name, report }, null, 2), 'application/json'),
      })
    );
    setNote(
      box,
      h(
        'div',
        { class: report.ok ? 'banner warn' : 'banner bad' },
        h('b', { text: report.ok ? 'Soubor vypadá jako export, ale taktiku z něj zatím číst neumím' : 'Soubor se nepodařilo interpretovat' }),
        report.ok ? h('p', { text: 'Aplikace zatím nezná vnitřní strukturu .fmf, a nehádá ji. Doplň taktiku ručně (Nová taktika níže) nebo ji nahraj jako ruční plán (.json). Zprávu o souboru si můžeš uložit.' }) : h('p', { text: report.reason }),
        zstdNote ? h('p', { class: 'hint', text: zstdNote }) : null
      ),
      h('div', { class: 'diag' }, rows.map(([k, v]) => h('div', null, h('span', { text: k }), h('span', { text: v })))),
      report.warnings.length ? h('ul', { class: 'list' }, report.warnings.map((w) => h('li', { text: w }))) : null,
      next
    );
  }

  // ------------------------------------------------------------------ editor taktiky
  function editor(app, tactic, redraw) {
    const Tc = T();
    const squad = FM27.context.players(app);
    const name = ui.input({ id: 'tacName', maxlength: 60, value: tactic.name });
    const kind = ui.select([['primary', 'Hlavní'], ['alternative', 'Alternativní']], tactic.kind, { id: 'tacKind' });
    const formation = ui.select(Tc.FORMATIONS.map((f) => [f.id, f.label]), tactic.formation, { id: 'tacFormation' });
    const mentality = ui.input({ id: 'tacMent', maxlength: 60, value: tactic.mentality || '', placeholder: 'Jak to vidíš ve hře' });
    const instr = h('textarea', { id: 'tacInstr', placeholder: 'Jedna týmová instrukce na řádek, přesně jak ji vidíš ve hře', style: 'min-height:70px' });
    instr.value = (tactic.teamInstructions || []).join('\n');
    const notes = h('textarea', { id: 'tacNotes', style: 'min-height:54px' });
    notes.value = tactic.notes || '';

    const slotRows = tactic.slots.map((s) => {
      const player = ui.select([['', '(nikdo)'], ...squad.map((p) => [p.id, p.name])], s.playerId || '', { id: 'slPl-' + s.key });
      const role = ui.input({ id: 'slRole-' + s.key, maxlength: 60, value: s.role || '', placeholder: 'role' });
      const duty = ui.input({ id: 'slDuty-' + s.key, maxlength: 40, value: s.duty || '', placeholder: 'povinnost' });
      return { key: s.key, pos: s.pos, player, role, duty };
    });
    const msg = h('p', { class: 'hint', id: 'tacMsg' });

    const save = h('button', {
      class: 'btn primary',
      id: 'tacSave',
      type: 'button',
      text: 'Uložit taktiku',
      onclick: async () => {
        const nm = name.value.trim();
        if (!nm) return (msg.textContent = 'Napiš název taktiky.');
        const next = app.store.draft(tactic);
        next.name = nm;
        next.kind = kind.value;
        next.mentality = mentality.value.trim();
        next.teamInstructions = instr.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
        next.notes = notes.value.trim().slice(0, 400);
        if (formation.value !== tactic.formation) {
          // Nová formace přebírá hráče, role a povinnosti podle pozice, kde to jde, jinak podle pořadí.
          const fresh = Tc.makeTactic({ formation: formation.value, name: nm, kind: kind.value });
          const used = new Set();
          fresh.slots = fresh.slots.map((s, i) => {
            const same = tactic.slots.find((o) => o.pos === s.pos && !used.has(o.key)) || tactic.slots[i];
            if (same) used.add(same.key);
            return Object.assign(s, same ? { playerId: same.playerId, role: same.role, duty: same.duty } : {});
          });
          next.formation = fresh.formation;
          next.slots = fresh.slots;
        } else {
          next.slots = next.slots.map((s) => {
            const r = slotRows.find((x) => x.key === s.key);
            return Object.assign({}, s, { playerId: r.player.value || null, role: r.role.value.trim(), duty: r.duty.value.trim() });
          });
        }
        await saveTactic(app, next);
        toast(`Taktika „${nm}“ je uložená.`);
        redraw();
      },
    });
    const active = app.career().activeTacticId === tactic.id || (!app.career().activeTacticId && FM27.context.activeTactic(app) && FM27.context.activeTactic(app).id === tactic.id);
    return h(
      'section',
      { class: 'card' },
      h('h2', { text: 'Taktika' }),
      sourceBlock(tactic),
      h('div', { class: 'row' }, ui.field('Název', name, { grow: true }), ui.field('Druh', kind, { width: '160px' }), ui.field('Formace', formation, { width: '140px' })),
      formation.value !== tactic.formation ? null : null,
      h('p', { class: 'hint', text: 'Změna formace přeskládá hráče na hřišti. Hráče, role a povinnosti převezme podle pozice, kde to půjde.' }),
      ui.field('Mentalita (jak ji vidíš ve hře)', mentality),
      ui.field('Týmové instrukce', instr),
      h('h3', { text: 'Hráči na pozicích', style: 'margin-top:14px' }),
      squad.length ? null : h('p', { class: 'hint', text: 'Soupiska je prázdná. Hráče přidej v Můj tým, pak je tady přiřadíš k pozicím.' }),
      h('div', { class: 'slots' }, slotRows.map((r) => h('div', { class: 'row slot' }, h('b', { class: 'mono', text: r.pos, style: 'width:42px;flex:none' }), ui.field('Hráč', r.player, { grow: true, noMargin: true }), ui.field('Role', r.role, { grow: true, noMargin: true }), ui.field('Povinnost', r.duty, { width: '140px', noMargin: true })))),
      ui.field('Poznámky', notes),
      h(
        'div',
        { class: 'actions' },
        save,
        h('button', { class: 'btn', id: 'tacActive', type: 'button', text: active ? 'Aktivní taktika' : 'Nastavit jako aktivní', disabled: active, onclick: async () => (await setActive(app, tactic.id), toast('Aktivní taktika je nastavená.'), redraw()) }),
        h('button', { class: 'btn', type: 'button', text: 'Otevřít na hřišti', onclick: () => app.go('laborator') }),
        h('button', { class: 'btn small', type: 'button', text: 'Duplikovat', onclick: async () => {
          const copy = app.store.draft(tactic);
          delete copy.id;
          copy.name = (tactic.name + ' (kopie)').slice(0, 60);
          copy.kind = 'alternative';
          const saved = await saveTactic(app, copy);
          selectedId = saved.id;
          redraw();
        } }),
        h('button', { class: 'btn small', type: 'button', text: 'Uložit jako plán (.json)', onclick: () => {
          const plan = Tc.exportPlanJson(tactic, FM27.context.players(app), { club: app.career().club });
          app.saveFile((tactic.name || 'taktika').replace(/[^\w\-]+/g, '_') + '.json', JSON.stringify(plan, null, 2), 'application/json');
        } }),
        ui.confirmButton('Smazat taktiku', 'Opravdu smazat?', async () => {
          await app.store.remove('tactic', tactic.id);
          selectedId = null;
          toast('Taktika je smazaná.');
          redraw();
        })
      ),
      msg
    );
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    if (!T() || !window.TrenerFmfGlue) {
      root.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul taktik' })));
      return;
    }
    const Tc = T();
    const draw = () => {
      guard.reset(); // obrazovka se kreslí znovu, takže žádné neuložené úpravy už nejsou
      const career = app.requireCareer(root, 'Taktiky');
      if (!career) return;
      const all = tacticsOf(app);
      if (!all.some((t) => t.id === selectedId)) selectedId = all.length ? all[0].id : null;
      const tactic = all.find((t) => t.id === selectedId) || null;

      const importBox = h('div', { id: 'tacImportBox' }, ...(importNote || []));
      const planInput = h('input', { type: 'file', id: 'tacPlanFile', accept: 'application/json,.json' });
      planInput.addEventListener('change', async () => {
        if (planInput.files[0]) await importPlan(app, planInput.files[0], importBox);
        planInput.value = '';
      });
      const fmfInput = h('input', { type: 'file', id: 'tacFmfFile', accept: '.fmf,application/octet-stream' });
      fmfInput.addEventListener('change', async () => {
        if (fmfInput.files[0]) await inspectFile(app, fmfInput.files[0], importBox);
        fmfInput.value = '';
      });

      const newName = ui.input({ id: 'tacNewName', maxlength: 60, placeholder: 'Např. Hlavní 4-3-3' });
      const newFormation = ui.select(Tc.FORMATIONS.map((f) => [f.id, f.label]), '4-3-3', { id: 'tacNewFormation' });
      const newKind = ui.select([['primary', 'Hlavní'], ['alternative', 'Alternativní']], all.length ? 'alternative' : 'primary', { id: 'tacNewKind' });
      const create = async () => {
        const nm = newName.value.trim() || `Taktika ${newFormation.value}`;
        const t = Tc.makeTactic({ formation: newFormation.value, name: nm, kind: newKind.value });
        const saved = await saveTactic(app, t);
        selectedId = saved.id;
        if (!career.activeTacticId) await setActive(app, saved.id);
        toast(`Taktika „${nm}“ je vytvořená.`);
        draw();
      };

      const list = h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Moje taktiky' }),
        h('p', { class: 'lead', text: 'Hlavní a alternativní taktiky tvé kariéry. Trenér čte aktivní taktiku při každé radě. Role, povinnosti a instrukce piš tak, jak je vidíš ve hře: aplikace jejich oficiální názvy nezná.' }),
        all.length
          ? h('div', { class: 'row' }, ui.field('Vybraná taktika', ui.select(all.map((t) => [t.id, `${t.name} (${t.formation}${t.kind === 'primary' ? ', hlavní' : ', alternativní'})`]), selectedId, { id: 'tacSelect', onchange: (e) => ((selectedId = e.target.value), draw()) }), { grow: true, noMargin: true }))
          : h('div', { class: 'empty' }, h('b', { text: 'Zatím žádná taktika' }), h('p', { class: 'hint', text: 'Vytvoř ji níže, nebo nahraj ruční plán.' })),
        h('h3', { text: 'Nová taktika', style: 'margin-top:14px' }),
        h('div', { class: 'row' }, ui.field('Název', newName, { grow: true, noMargin: true }), ui.field('Formace', newFormation, { width: '130px', noMargin: true }), ui.field('Druh', newKind, { width: '150px', noMargin: true }), h('button', { class: 'btn', id: 'tacCreate', type: 'button', text: 'Vytvořit', onclick: create }))
      );
      const imports = h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Import' }),
        h('p', { class: 'lead', text: 'Ruční plán (.json) se načte celý a označí se jako tvoje zadání. Soubor .fmf se jen zkontroluje: pole taktiky z něj zatím číst neumím a aplikace nic nehádá.' }),
        ui.field('Ruční plán taktiky (.json z aplikace)', planInput),
        ui.field('Export taktiky z FM27 (.fmf), jen kontrola souboru', fmfInput),
        importBox
      );
      root.replaceChildren(list, tactic ? editor(app, tactic, draw) : null, imports);
    };
    const guard = ui.dirtyGuard(root, app, () => draw());
    draw();
    // změna z druhého zařízení nesmí smazat rozepsané úpravy editoru
    app.watch(['tactic', 'player', 'career'], (e) => e && e.origin === 'remote' && guard.onRemote());
  }

  FM27.screens.register({ id: 'taktiky', hash: 'taktiky', label: 'Moje taktiky', order: 3, render });
})();
