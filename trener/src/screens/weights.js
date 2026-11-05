/* Správa vah hodnocení hráčů (DWRS): přednastavení stylu hry s vysvětlením, vlastní profily vah (úprava, uložení, smazání), porovnání dvou profilů
   a návrat k výchozímu odhadu. Výpočet je v dwrs.js; tady je jen obrazovka a ukládání (typ dokumentu `weightprofile`, volba v nastavení `rating`).
   Poctivost: tabulky kategorií atributů jsou vlastní odhad autora aplikace (ESTIMATED), ne pravidlo FM27. Proto jdou upravit, každé přednastavení řekne, co přesně změnilo,
   a profil se nikdy nepřepíše potichu. Skryté údaje hry se do vah nedostanou (tabulky obsahují jen viditelné atributy). */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h, toast } = ui;
  const DW = () => window.TrenerDwrs;
  const fmt = (v) => String(v).replace('.', ',');
  const parseNum = (v) => {
    const t = String(v === undefined || v === null ? '' : v).trim().replace(',', '.');
    return t === '' ? NaN : Number(t);
  };
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'cs');
  const MODEL_OPTIONS = [
    ['simple', 'Jednoduchý: klíčové atributy 2, žádoucí 1'],
    ['dwrs', 'DWRS: kategorie atributů (odhad aplikace)'],
  ];

  // ------------------------------------------------------------------ profily a volba v nastavení
  const rating = (app) => (app.settings().rating && typeof app.settings().rating === 'object' ? app.settings().rating : {});
  const modelOf = (app) => (rating(app).model === 'dwrs' ? 'dwrs' : 'simple');
  const activeId = (app) => (typeof rating(app).profileId === 'string' && rating(app).profileId ? rating(app).profileId : 'universal');

  /** Všechny profily vah k výběru: přednastavení (vestavěná) a vlastní (z úložiště, ověřené). */
  function allProfiles(app) {
    const d = DW();
    const built = d.presets().map((p) => ({ id: p.id, name: p.name, note: p.note, builtin: true, profile: p, issues: [] }));
    const own = app.store
      .list('weightprofile')
      .sort(byName)
      .map((raw) => {
        const n = d.normalizeProfile(raw);
        n.profile.id = raw.id;
        return { id: raw.id, name: n.profile.name, note: n.profile.note, builtin: false, profile: n.profile, issues: n.issues };
      });
    return built.concat(own);
  }
  /** Aktivní profil vah; smazaný nebo neznámý profil se nahradí výchozím odhadem (a je to vidět v nastavení). */
  function activeProfile(app) {
    const list = allProfiles(app);
    return (list.find((p) => p.id === activeId(app)) || list[0]).profile;
  }
  const setActive = (app, id) => app.updateSettings({ rating: { profileId: id } });
  const setModel = (app, model) => app.updateSettings({ rating: { model: model === 'dwrs' ? 'dwrs' : 'simple' } });

  // `after` je funkce volaná po uložení volby; do prvku se nedává (jinak by se její text objevil v atributu)
  function modelSelect(app, props) {
    const { after, ...attrs } = props || {};
    return ui.select(MODEL_OPTIONS, modelOf(app), Object.assign(attrs, { onchange: async (e) => { await setModel(app, e.target.value); if (after) after(); } }));
  }
  function profileSelect(app, props) {
    const { after, ...attrs } = props || {};
    const list = allProfiles(app);
    const cur = list.find((p) => p.id === activeId(app)) || list[0];
    return ui.select(list.map((p) => [p.id, p.name + (p.builtin ? '' : ' (vlastní)')]), cur.id, Object.assign(attrs, { onchange: async (e) => { await setActive(app, e.target.value); if (after) after(); } }));
  }

  // ------------------------------------------------------------------ editor profilu
  function editor(app, existing, base, onDone) {
    const d = DW();
    const src = d.normalizeProfile(existing || base).profile;
    const name = ui.input({ id: 'wtName', maxlength: 60, value: existing ? src.name : (base && base.name ? base.name + ' (kopie)' : 'Vlastní profil') });
    const note = ui.input({ id: 'wtNote', maxlength: 300, value: existing ? src.note : 'Moje úprava vah.' });
    const numberBox = (id, value, min, max, step) => ui.input({ id, type: 'text', inputmode: 'decimal', value: fmt(value), 'data-min': min, 'data-max': max, 'aria-label': id, size: 5, style: 'width:72px' });
    const cw = {};
    const gk = {};
    const tiers = d.TIERS.slice().reverse();
    for (const t of tiers) {
      cw[t] = numberBox('wtCw_' + t, src.categoryWeights[t]);
      gk[t] = numberBox('wtGk_' + t, src.gkCategoryWeights[t]);
    }
    const mulKey = numberBox('wtMulKey', src.multipliers.key);
    const mulPref = numberBox('wtMulPref', src.multipliers.pref);
    const h3 = (t) => h('h3', { text: t, style: 'margin-top:18px' });
    const row = (label, ...nodes) => h('div', { class: 'row', style: 'align-items:center;gap:8px;margin:4px 0' }, h('span', { text: label, style: 'min-width:190px' }), ...nodes);

    // kontextové násobiče (styl hry)
    const ctxInputs = new Map();
    const ctxTable = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Atribut' }), h('th', { text: 'Násobič (1 = beze změny)' }))), h('tbody', null, d.OUTFIELD_ATTRIBUTES.map((a) => {
      const inp = numberBox('wtCtx_' + a.replace(/\s+/g, ''), src.context[a] || 1);
      ctxInputs.set(a, inp);
      return h('tr', null, h('td', { text: a }), h('td', null, inp));
    })));

    // kategorie atributů po skupinách pozic
    const tierSelects = new Map(); // `${group}|${attribute}` → select
    const groupBlocks = d.GROUPS.map((g) => {
      const effective = d.tiersFor(g, src);
      const defaults = d.defaultTiers(g);
      const rows = [...effective.values()].map((e) => {
        const sel = ui.select(tiers.map((t) => [t, d.TIER_CS[t]]), e.tier, { 'aria-label': `${e.attribute} (${d.GROUP_CS[g]})`, id: `wtTier_${g}_${e.attribute.replace(/\s+/g, '')}` });
        tierSelects.set(g + '|' + e.attribute, { sel, base: defaults.get(e.attribute.toLowerCase().replace(/[^a-z0-9]/g, '')).tier });
        return h('tr', null, h('td', { text: e.attribute }), h('td', null, sel));
      });
      return h('details', { class: 'flow-table', 'data-group': g }, h('summary', { text: `Kategorie atributů: ${d.GROUP_CS[g]}` }), h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Atribut' }), h('th', { text: 'Kategorie' }))), h('tbody', null, rows)));
    });

    const msg = h('p', { class: 'hint', id: 'wtMsg', 'aria-live': 'polite' });
    const save = h('button', {
      class: 'btn primary',
      id: 'wtSave',
      type: 'button',
      text: existing ? 'Uložit úpravu profilu' : 'Uložit profil vah',
      onclick: async () => {
        const raw = { id: existing ? existing.id : undefined, name: name.value, base: src.base || 'universal', note: note.value, categoryWeights: {}, gkCategoryWeights: {}, multipliers: {}, context: {}, overrides: {} };
        const bad = [];
        const take = (target, key, box, label) => {
          const v = parseNum(box.value);
          if (Number.isNaN(v)) bad.push(`${label}: není číslo.`);
          else target[key] = v;
        };
        for (const t of tiers) {
          take(raw.categoryWeights, t, cw[t], `Váha „${d.TIER_CS[t]}“ (hráči z pole)`);
          take(raw.gkCategoryWeights, t, gk[t], `Váha „${d.TIER_CS[t]}“ (brankář)`);
        }
        take(raw.multipliers, 'key', mulKey, 'Násobič klíčového atributu');
        take(raw.multipliers, 'pref', mulPref, 'Násobič žádoucího atributu');
        for (const [a, inp] of ctxInputs) take(raw.context, a, inp, `Kontextový násobič ${a}`);
        for (const [k, { sel, base: b }] of tierSelects) {
          if (sel.value === b) continue;
          const [g, attr] = k.split('|');
          (raw.overrides[g] = raw.overrides[g] || {})[attr] = sel.value;
        }
        if (bad.length) return (msg.textContent = bad.slice(0, 3).join(' '));
        const n = d.normalizeProfile(raw);
        if (n.issues.length) return (msg.textContent = 'Profil se neuložil: ' + n.issues.slice(0, 3).join(' '));
        if (!String(name.value).trim()) return (msg.textContent = 'Profil potřebuje název.');
        const toSave = Object.assign({}, n.profile);
        if (existing) toSave.id = existing.id;
        else delete toSave.id;
        const stored = await app.store.put('weightprofile', toSave);
        if (!existing) await setActive(app, stored.id);
        ui.closeDrawer();
        toast(existing ? `Profil vah „${n.profile.name}“ je uložený.` : `Profil vah „${n.profile.name}“ je uložený a používá se.`, 4500);
        if (onDone) onDone();
      },
    });
    return h(
      'div',
      null,
      h('p', { class: 'hint', text: 'Tady měníš odhad aplikace, ne pravidlo hry. Nic se nepřepíše potichu: výsledek se uloží jako tvůj vlastní profil a u každého hodnocení je vidět, z jakých vah vzešlo.' }),
      ui.field('Název profilu', name),
      ui.field('Poznámka', note),
      h3('Váhy kategorií (hráči z pole)'),
      tiers.map((t) => row(d.TIER_CS[t], cw[t])),
      h3('Váhy kategorií (brankář)'),
      tiers.map((t) => row(d.TIER_CS[t], gk[t])),
      h3('Násobiče role'),
      row('Klíčový atribut role (1 až 3)', mulKey),
      row('Žádoucí atribut role (1 až 3)', mulPref),
      h('details', { class: 'flow-table' }, h('summary', { text: 'Kontextové násobiče atributů (styl hry, 0,1 až 5)' }), ctxTable),
      h3('Kategorie atributů podle pozice'),
      groupBlocks,
      msg,
      h('div', { class: 'actions' }, save)
    );
  }

  // ------------------------------------------------------------------ karta v Nastavení
  function card(app) {
    const d = DW();
    const box = h('div');
    const section = h('section', { class: 'card', id: 'weightsCard' }, h('h2', { text: 'Hodnocení hráčů: váhy atributů (DWRS)' }), box);

    function draw() {
      const list = allProfiles(app);
      const cur = list.find((p) => p.id === activeId(app)) || list[0];
      const missing = !list.some((p) => p.id === activeId(app));
      const model = modelOf(app);
      const describe = d.describeProfile(cur.profile);
      const cmpA = ui.select(list.map((p) => [p.id, p.name]), 'universal', { id: 'wtCmpA' });
      const cmpB = ui.select(list.map((p) => [p.id, p.name]), cur.builtin && cur.id !== 'universal' ? cur.id : (list.find((p) => !p.builtin) || list[1]).id, { id: 'wtCmpB' });
      const cmpOut = h('div', { id: 'wtCmpOut', 'aria-live': 'polite' });
      const runCompare = () => {
        const a = list.find((p) => p.id === cmpA.value);
        const b = list.find((p) => p.id === cmpB.value);
        const c = d.compareProfiles(a.profile, b.profile);
        cmpOut.replaceChildren(
          h('p', { class: 'hint', id: 'wtCmpHead', text: c.changed ? `„${b.name}“ se od „${a.name}“ liší v ${c.changed} ${ui.plural(c.changed, 'věci', 'věcech', 'věcech')}:` : `„${a.name}“ a „${b.name}“ mají stejné váhy.` }),
          c.changed ? h('ul', { class: 'list', id: 'wtCmpLines' }, c.lines.slice(0, 60).map((l) => h('li', { text: l }))) : null,
          c.lines.length > 60 ? h('p', { class: 'hint', text: `A dalších ${c.lines.length - 60} změn.` }) : null
        );
      };
      box.replaceChildren(
        h('p', { class: 'lead', text: 'DWRS je způsob, jak z atributů hráče spočítat jedno číslo 0 až 100 pro konkrétní roli: atributy se rozdělí do kategorií důležitosti pro skupinu pozic (extrémně důležité, důležité, dobré, přijatelné, téměř nepodstatné), role zdvihne své klíčové (×1,5) a žádoucí (×1,2) atributy a výsledek se přepočte na 0 až 100. Čísla kategorií (8 / 4 / 2 / 1 / 0,2) a násobiče jsou podle veřejně popsané metody; to, který atribut patří do které kategorie, je vlastní odhad aplikace (ESTIMATED), ne pravidlo FM27. Proto jsou váhy tady k úpravě.' }),
        h('div', { class: 'row' }, ui.field('Model hodnocení v sestavě (rozbor hráče vždy používá DWRS)', modelSelect(app, { id: 'wtModel', after: draw }), { grow: true })),
        h('div', { class: 'row' }, ui.field('Aktivní profil vah (platí pro model DWRS)', profileSelect(app, { id: 'wtActive', after: draw }), { grow: true })),
        missing ? h('p', { class: 'banner warn', id: 'wtMissing', text: 'Vybraný vlastní profil už neexistuje (smazán nebo ještě nedorazil z druhého zařízení): zatím platí výchozí odhad.' }) : null,
        h('p', { class: 'hint', id: 'wtModelNote', text: model === 'dwrs' ? 'Sestava teď počítá podle DWRS. Je to odhad aplikace, který jde upravit; u každého čísla je rozpis po atributech.' : 'Sestava teď počítá jednoduše (klíčové atributy role 2, žádoucí 1). DWRS si zapneš výš; rozbor hráče ho používá vždy.' }),
        h('h3', { text: `Co mění profil „${cur.name}“ oproti výchozímu odhadu` }),
        describe.changed
          ? h('ul', { class: 'list', id: 'wtDescribe' }, describe.lines.slice(0, 40).map((l) => h('li', { text: l })))
          : h('p', { class: 'hint', id: 'wtDescribe', text: 'Nic: je to výchozí odhad aplikace bez úprav.' }),
        cur.note ? h('p', { class: 'hint', text: cur.note }) : null,
        cur.issues && cur.issues.length ? h('p', { class: 'banner warn', text: 'U profilu se při čtení opravily hodnoty: ' + cur.issues.slice(0, 3).join(' ') }) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', id: 'wtNew', type: 'button', text: 'Vytvořit vlastní profil z aktivního', onclick: () => ui.openDrawer('Nový profil vah', [editor(app, null, cur.profile, draw)]) }),
          cur.builtin ? null : h('button', { class: 'btn', id: 'wtEdit', type: 'button', text: 'Upravit aktivní profil', onclick: () => ui.openDrawer('Upravit profil vah', [editor(app, app.store.get('weightprofile', cur.id), cur.profile, draw)]) }),
          h('button', { class: 'btn', id: 'wtReset', type: 'button', text: 'Obnovit výchozí odhad', onclick: async () => { await setActive(app, 'universal'); toast('Platí výchozí odhad aplikace. Vlastní profily zůstaly uložené.', 4000); draw(); } })
        ),
        h('h3', { text: 'Přednastavení stylu hry' }),
        h('p', { class: 'hint', text: 'Přednastavení nezmění tabulky, jen zvýší nebo sníží důležitost některých atributů. U každého je napsáno, co přesně změnilo.' }),
        h('div', { class: 'books', id: 'wtPresets' }, list.filter((p) => p.builtin).map((p) => {
          const dsc = d.describeProfile(p.profile);
          return h('div', { class: 'book', 'data-preset': p.id },
            h('div', { class: 'meta' }, h('b', { text: p.name }), h('span', { text: p.note }), h('span', { class: 'hint', text: dsc.changed ? 'Mění: ' + Object.entries(p.profile.context).sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([name, f]) => `${name} ×${fmt(f)}`).join(', ') + ' (násobič důležitosti atributu u hráčů z pole).' : 'Nic nemění.' })),
            h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', 'data-act': 'use', text: p.id === cur.id ? 'Používá se' : 'Použít', disabled: p.id === cur.id, onclick: async () => { await setActive(app, p.id); draw(); } })));
        })),
        h('h3', { text: 'Moje profily vah' }),
        list.some((p) => !p.builtin)
          ? h('div', { class: 'books', id: 'wtOwn' }, list.filter((p) => !p.builtin).map((p) => h('div', { class: 'book', 'data-own': p.id },
              h('div', { class: 'meta' }, h('b', { text: p.name }), h('span', { text: p.note || '' }), h('span', { class: 'hint', text: `Změn proti výchozímu odhadu: ${d.describeProfile(p.profile).changed}.` })),
              h('div', { class: 'row' },
                h('button', { class: 'btn small', type: 'button', 'data-act': 'use', text: p.id === cur.id ? 'Používá se' : 'Použít', disabled: p.id === cur.id, onclick: async () => { await setActive(app, p.id); draw(); } }),
                h('button', { class: 'btn small', type: 'button', 'data-act': 'edit', text: 'Upravit', onclick: () => ui.openDrawer('Upravit profil vah', [editor(app, app.store.get('weightprofile', p.id), p.profile, draw)]) }),
                ui.confirmButton('Smazat', 'Opravdu?', async () => { await app.store.remove('weightprofile', p.id); toast('Profil je smazaný.', 3000); draw(); })))))
          : h('p', { class: 'hint', id: 'wtOwnEmpty', text: 'Zatím žádný vlastní profil. Vytvoříš ho z aktivního tlačítkem výš.' }),
        h('h3', { text: 'Porovnat dva profily' }),
        h('div', { class: 'row' }, ui.field('Z profilu', cmpA, { grow: true }), ui.field('Na profil', cmpB, { grow: true })),
        h('div', { class: 'actions' }, h('button', { class: 'btn', id: 'wtCmpRun', type: 'button', text: 'Ukázat rozdíly', onclick: runCompare })),
        cmpOut
      );
    }
    draw();
    app.watch(['weightprofile', 'settings'], () => section.isConnected && !document.querySelector('#drawer:not([hidden]) #wtSave') && draw());
    return section;
  }

  FM27.weightsUI = { card, activeProfile, allProfiles, modelOf, activeId, setActive, setModel, modelSelect, profileSelect, MODEL_OPTIONS };
})();
