/* Přestupy (karta v Můj tým): kandidáti na přestup, hledání posil podle role nebo podle dopadu na celý tým, dopad odchodu vlastního hráče a doporučení s výsledkem zapsaným později.
   Výpočty jsou v recruit.js (a pod ním squadopt.js, dwrs.js, rolefit.js); tady je jen obrazovka.
   Poctivost: kandidáta zadáváš ty (ručně nebo z exportu tabulky). Vhodnost a dopad jsou odhad aplikace (DWRS nebo jednoduchý vážený průměr), ne pravidlo FM27, a vždy se píše, podle čeho vznikly.
   Cena a mzda jsou jen to, co zadáš nebo co stálo v souboru: jinak jsou „neznámé“ a nikdy se neodhadují. Potenciál a další skryté údaje hry se nepoužívají. Nic se v soupisce ani v taktice nezmění samo.
   Úspěšnost doporučení je podle TVÉHO hodnocení výsledku, ne podle hry. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h, toast } = ui;
  const RC = () => window.TrenerRecruit;
  const TI = () => window.TrenerTableImport;
  const fmt = (v) => String(v).replace('.', ',');
  const spaced = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const moneyLabel = (v, cur) => (v === null || v === undefined ? 'neznámá' : spaced(v) + (cur ? ' ' + cur : ''));
  const h3 = (text, id) => h('h3', { text, id, style: 'margin-top:18px' });

  // nastavení hledání platí jen v téhle relaci a přežije překreslení karty
  const st = { slotKey: '', maxAge: '', maxPrice: '', maxWage: '', dropAge: false, dropPrice: false, dropWage: false, all: false, query: '', partial: false, shown: false, depPlayer: '', swapWith: '', impact: new Set() };
  const rst = new Map(); // rozepsaný výsledek u každého doporučení (rozhodnutí, hodnocení, poznámka, hláška): přežije překreslení karty

  const careerOf = (app) => app.career();
  const candidatesOf = (app) => {
    const c = careerOf(app);
    return c ? app.store.list('candidate', (x) => x.careerId === c.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs')) : [];
  };
  const recsOf = (app) => {
    const c = careerOf(app);
    return c ? app.store.list('recommendation', (x) => x.careerId === c.id).sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
  };
  const gameDateOf = (app) => {
    const c = careerOf(app);
    return c && RC().isDate(c.gameDate) ? c.gameDate : null;
  };

  /** Vstup pro výpočet: soupiska, aktivní taktika (jen místa) a profily rolí; model a profil vah jako u karty Nejlepší sestava. Co chybí, je v problems. */
  function context(app) {
    const players = FM27.context.players(app);
    const tactic = FM27.context.activeTactic(app);
    const profiles = app.store.list('roleprofile');
    const W = FM27.weightsUI;
    const slots = tactic ? (tactic.slots || []).filter((s) => s && typeof s === 'object').map((s) => ({ key: s.key, pos: s.pos, role: s.role, duty: s.duty })) : [];
    const input = {
      slots,
      players: players.map((p) => ({ id: p.id, name: p.name, positions: p.positions || [], attributes: p.attributes || {}, injured: !!(p.flags && p.flags.injury) })),
      profiles,
    };
    const opts = { model: W ? W.modelOf(app) : 'simple', wp: W ? W.activeProfile(app) : undefined, mode: 'strict', allowPartial: st.partial, bench: true };
    const problems = [];
    if (!players.length) problems.push('Soupiska je prázdná: přidej hráče výš v téhle sekci.');
    if (!tactic) problems.push('Není žádná taktika: vytvoř ji v sekci Moje taktiky.');
    else if (!slots.some((s) => typeof s.role === 'string' && s.role.trim())) problems.push('V aktivní taktice nemá žádné místo zadanou roli (doplň role v Moje taktiky).');
    else if (!profiles.length) problems.push('Chybí profily rolí (čtou se z obrazovky role ve hře, viz Moje taktiky).');
    return { players, tactic, input, opts, slots, ready: problems.length === 0, problems };
  }

  // ------------------------------------------------------------------ formulář kandidáta
  const attrsToText = (a) => Object.entries(a || {}).map(([k, v]) => `${k} ${v}`).join('\n');
  function parseAttrs(text) {
    const out = {};
    const errors = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^(.+?)[\s:=]+(\d{1,2})$/.exec(line);
      if (!m) {
        errors.push(`Řádek „${line.slice(0, 30)}“ nemá tvar „Název číslo“.`);
        continue;
      }
      out[m[1].trim()] = Number(m[2]);
    }
    return { out, errors };
  }

  function candidateForm(app, existing, onDone) {
    const R = RC();
    const c = existing || {};
    const deal = c.deal || {};
    const orNull = (v) => (v === null || v === undefined ? '' : String(v));
    const name = ui.input({ id: 'rcName', maxlength: 60, value: c.name || '', placeholder: 'Jméno kandidáta' });
    const age = ui.input({ id: 'rcAge', type: 'number', min: 14, max: 50, value: orNull(c.age), inputmode: 'numeric' });
    const pos = ui.input({ id: 'rcPos', maxlength: 30, value: (c.positions || []).join(', '), placeholder: 'Např. ST, AMC' });
    const club = ui.input({ id: 'rcClub', maxlength: 60, value: c.club || '' });
    const price = ui.input({ id: 'rcPrice', maxlength: 30, value: orNull(c.price), placeholder: 'Např. 12500000 nebo €12.5M; prázdné = neznámá' });
    const wage = ui.input({ id: 'rcWage', maxlength: 30, value: orNull(c.wage), placeholder: 'Týdenní, např. 35000; prázdné = neznámá' });
    const currency = ui.input({ id: 'rcCur', maxlength: 4, value: c.currency || '', placeholder: '€' });
    const contract = ui.input({ id: 'rcContract', maxlength: 24, value: c.contractEnd || '', placeholder: 'Např. 2029-06-30' });
    const attrs = h('textarea', { id: 'rcAttrs', placeholder: 'Jedna dvojice na řádek, např.\nFinishing 14\nPace 16', style: 'min-height:90px' });
    attrs.value = attrsToText(c.attributes);
    const status = ui.select(R.STATUSES.map((s) => [s, R.STATUS_CS[s]]), deal.status || 'watch', { id: 'rcStatus' });
    const valid = ui.input({ id: 'rcValid', maxlength: 10, value: deal.validUntil || '', placeholder: 'RRRR-MM-DD (datum ve hře)' });
    const dnote = ui.input({ id: 'rcDealNote', maxlength: 200, value: deal.note || '' });
    const notes = h('textarea', { id: 'rcNotes', style: 'min-height:56px', placeholder: 'Cokoli, co si chceš pamatovat' });
    notes.value = c.notes || '';
    const msg = h('p', { class: 'hint', id: 'rcMsg', 'aria-live': 'polite' });
    const save = h('button', {
      class: 'btn primary',
      id: 'rcSave',
      type: 'button',
      text: 'Uložit kandidáta',
      onclick: async () => {
        const at = parseAttrs(attrs.value);
        if (at.errors.length) return (msg.textContent = at.errors[0]);
        const ageN = age.value === '' ? null : Number(age.value);
        const same = existing && deal.status === status.value && (deal.validUntil || '') === valid.value.trim();
        const n = R.normalizeCandidate({
          careerId: careerOf(app).id, name: name.value, age: ageN, positions: pos.value, attributes: at.out, club: club.value, price: price.value, wage: wage.value, currency: currency.value, contractEnd: contract.value, notes: notes.value,
          origin: existing ? existing.origin : { type: 'manual', fileName: null, at: Date.now() },
          deal: { status: status.value, validUntil: valid.value.trim(), note: dnote.value, at: same ? deal.at : Date.now() },
        }, { now: Date.now() });
        if (!n.ok) return (msg.textContent = n.issues[0]);
        if (!existing && candidatesOf(app).length >= R.LIMITS.maxCandidates) return (msg.textContent = `Kandidátů je nejvýš ${R.LIMITS.maxCandidates}.`);
        if (existing) {
          const next = app.store.draft(existing);
          Object.assign(next, n.candidate, { id: existing.id, careerId: existing.careerId });
          await app.store.put('candidate', next);
        } else await app.store.put('candidate', n.candidate);
        ui.closeDrawer();
        toast(n.issues.length ? `Kandidát „${n.candidate.name}“ je uložený. Pozor: ${n.issues.slice(0, 3).join(' ')}` : `Kandidát „${n.candidate.name}“ je uložený.`, n.issues.length ? 9000 : undefined);
        if (onDone) onDone();
      },
    });
    ui.openDrawer(existing ? 'Upravit kandidáta' : 'Nový kandidát', [
      ui.field('Jméno', name),
      h('div', { class: 'row' }, ui.field('Pozice (zkratky)', pos, { grow: true }), ui.field('Věk', age, { width: '90px' })),
      ui.field('Klub', club),
      h('div', { class: 'row' }, ui.field('Cena', price, { grow: true }), ui.field('Mzda týdně', wage, { grow: true }), ui.field('Měna', currency, { width: '80px' })),
      h('p', { class: 'hint', text: 'Cena a mzda jsou jen to, co sem napíšeš. Prázdné pole znamená „neznámá“: aplikace nic neodhaduje a měnu nepřepočítává.' }),
      ui.field('Konec smlouvy', contract),
      ui.field('Viditelné atributy (1 až 20)', attrs, { hint: 'Jen to, co o hráči vidíš. Skryté údaje (potenciál, osobnost) nepiš, aplikace s nimi nepočítá.' }),
      h('div', { class: 'row' }, ui.field('Stav jednání', status, { grow: true }), ui.field('Platí do (datum ve hře)', valid, { grow: true })),
      ui.field('Poznámka k jednání', dnote),
      ui.field('Poznámky', notes),
      h('div', { class: 'actions' }, save),
      msg,
    ]);
    name.focus();
  }

  // ------------------------------------------------------------------ načtení z exportu tabulky
  const UNIQUE = ['name', 'positions', 'age', 'club', 'price', 'wage', 'contract'];
  /** Načtení z tabulky je statický prvek karty: nepřekresluje se při změně dat (rozpracované mapování sloupců a vybraný soubor by se jinak ztratily); po přidání se vyčistí sám. */
  function importCard(app, onAdded) {
    const R = RC();
    const T = TI();
    if (!T) return null;
    const input = h('input', { type: 'file', id: 'recFile', accept: '.csv,.tsv,.txt,.html,.htm,.json,.jsonl,text/csv,text/plain,text/html,application/json', hidden: true });
    const status = h('p', { class: 'hint', id: 'recFileStatus', 'aria-live': 'polite' });
    const out = h('div', { id: 'recImport' });
    const reset = () => {
      out.replaceChildren();
      status.textContent = '';
      input.value = '';
      onAdded();
    };
    input.addEventListener('change', async () => {
      const file = input.files[0];
      out.replaceChildren();
      if (!file) return (status.textContent = '');
      status.textContent = 'Čtu soubor…';
      try {
        const dec = T.decodeBytes(new Uint8Array(await file.arrayBuffer()));
        if (!dec.ok) return (status.textContent = dec.error);
        const table = T.extractTable(dec.text);
        if (!table.ok) return (status.textContent = table.error);
        status.textContent = `Nalezena tabulka: ${table.rows.length} ${ui.plural(table.rows.length, 'řádek', 'řádky', 'řádků')}, ${table.columns} ${ui.plural(table.columns, 'sloupec', 'sloupce', 'sloupců')}. Zkontroluj, co který sloupec znamená.`;
        mapping(app, out, table, file.name, reset);
      } catch (e) {
        status.textContent = 'Soubor se nepodařilo přečíst: ' + ((e && e.message) || e);
      }
    });
    return h('div', { id: 'recImportBox' }, ui.pickButton('Načíst z tabulky (CSV, HTML, JSON)', input, { id: 'recFileBtn' }), input, status, out);
  }

  function mapping(app, box, table, fileName, redraw) {
    const R = RC();
    const T = TI();
    const map = R.suggestRoles(T.guessMapping(table)).map((c) => (R.CANDIDATE_ROLES.includes(c.role) ? c : Object.assign({}, c, { role: 'ignore' })));
    const existingNames = candidatesOf(app).map((c) => c.name).concat(FM27.context.players(app).map((p) => p.name));
    const room = Math.max(0, R.LIMITS.maxCandidates - candidatesOf(app).length);
    const selects = [];
    const summary = h('p', { class: 'hint', id: 'recImportSummary', 'aria-live': 'polite' });
    const preview = h('div', { class: 'books', id: 'recImportPlayers' });
    const confirm = h('input', { type: 'checkbox', id: 'recImportConfirm' });
    const add = h('button', { class: 'btn primary', id: 'recImportAdd', type: 'button', text: 'Přidat kandidáty' });
    const example = (i) => table.rows.slice(0, 3).map((r) => String(r[i] === undefined ? '' : r[i]).slice(0, 24)).filter(Boolean).join(' · ');
    let current = null;
    function refresh() {
      current = R.candidatesFromTable(table, map, { existingNames, max: room, fileName, now: Date.now() });
      const n = current.candidates.length;
      add.textContent = n ? `Přidat ${n} ${ui.plural(n, 'kandidáta', 'kandidáty', 'kandidátů')}` : 'Není koho přidat';
      add.disabled = !n;
      const parts = [`Přidá se ${n} ${ui.plural(n, 'kandidát', 'kandidáti', 'kandidátů')}.`];
      if (current.skipped.duplicates) parts.push(`Už v soupisce nebo mezi kandidáty jsou, nebo se opakují: ${current.skipped.duplicates}.`);
      if (current.skipped.overLimit) parts.push(`Nad limit ${R.LIMITS.maxCandidates} kandidátů: ${current.skipped.overLimit}.`);
      summary.textContent = parts.join(' ') + (current.issues.length ? ' ' + current.issues.slice(0, 5).join(' ') : '');
      preview.replaceChildren(...current.candidates.slice(0, 5).map((c) => h('div', { class: 'book' }, h('div', { class: 'meta' }, h('b', { text: c.name }), h('span', { text: [c.positions.join('/') || 'pozice neuvedena', c.age ? `věk ${c.age}` : 'věk neuveden', `${Object.keys(c.attributes).length} atributů`, `cena ${moneyLabel(c.price, c.currency)}`, `mzda ${moneyLabel(c.wage, c.currency)}`].join(' · ') })))));
    }
    const rows = map.map((c, k) => {
      const sel = h('select', { 'aria-label': 'Význam sloupce ' + c.header, 'data-col': String(c.index) }, R.CANDIDATE_ROLES.map((r) => h('option', { value: r, text: R.CANDIDATE_ROLE_LABEL[r], selected: r === c.role })));
      selects.push(sel);
      sel.addEventListener('change', () => {
        c.role = sel.value;
        if (UNIQUE.includes(c.role)) {
          map.forEach((o, j) => {
            if (j !== k && o.role === c.role) {
              o.role = 'ignore';
              selects[j].value = 'ignore';
            }
          });
        }
        refresh();
      });
      return h('div', { class: 'book', 'data-header': c.header }, h('div', { class: 'meta' }, h('b', { text: c.header }), h('span', { text: example(c.index) || '(prázdné)' }), h('span', { class: 'hint', text: c.reason })), sel);
    });
    add.addEventListener('click', async () => {
      if (!confirm.checked) return toast('Nejdřív potvrď, že sloupce odpovídají souboru.');
      if (!current || !current.candidates.length) return;
      add.disabled = true;
      let n = 0;
      for (const c of current.candidates) {
        await app.store.put('candidate', Object.assign({}, c, { careerId: careerOf(app).id }));
        n++;
      }
      toast(`Z exportu přidáno kandidátů: ${n} (soubor ${fileName}).`, 5000);
      redraw();
    });
    box.append(
      h('p', { class: 'hint', text: 'Cena a mzda se přečtou jen z čitelné částky (třeba „€12.5M“ nebo „35 000“). Rozsah, slovo nebo nejednoznačný zápis se přeskočí a cena zůstane neznámá. Skryté údaje hry se nenačítají.' }),
      h('div', { class: 'books', id: 'recImportColumns' }, rows),
      summary,
      preview,
      h('label', { class: 'checkline' }, confirm, h('span', { text: 'Zkontroloval jsem, že sloupce odpovídají souboru.' })),
      h('div', { class: 'actions' }, add)
    );
    refresh();
  }

  // ------------------------------------------------------------------ řádek výsledku (hledání i jednotlivý kandidát)
  const FLAG_CHIP = (text) => h('span', { class: 'chip t-unknown', text });
  function rowView(app, row, ctx, redraw) {
    const R = RC();
    const c = row.candidate;
    const lines = R.explain(row);
    const open = recsOf(app).some((r) => r.candidateId === c.id && !r.result);
    const save = h('button', {
      class: 'btn small',
      type: 'button',
      'data-act': 'recommend',
      text: open ? 'Doporučení už je uložené' : 'Uložit doporučení',
      disabled: open || !row.known,
      onclick: async () => {
        if (recsOf(app).length >= R.LIMITS.maxRecommendations) return toast(`Doporučení je nejvýš ${R.LIMITS.maxRecommendations}: nějaké smaž.`);
        const b = R.buildRecommendation(row, { careerId: careerOf(app).id, now: Date.now() });
        if (!b.ok) return toast(b.issues[0]);
        await app.store.put('recommendation', Object.assign({}, b.recommendation, { careerId: careerOf(app).id }));
        toast(`Doporučení „${c.name}“ je uložené.`);
        redraw();
      },
    });
    const ds = R.dealState(c, gameDateOf(app));
    return h('div', { class: 'book fit-row', 'data-cand': c.id },
      h('div', { class: 'meta' },
        h('b', { text: row.name }),
        h('span', { text: [(c.positions || []).join('/') || 'pozice neuvedena', c.age ? `věk ${c.age}` : 'věk neuveden', c.club || null].filter(Boolean).join(' · ') }),
        h('span', { 'data-line': 'summary', text: row.known ? (row.slot && row.slot.fit !== null ? `Vhodnost na místě ${row.slot.pos}: ${fmt(row.slot.fit)}` : row.bestSlot ? `Nejlépe na místě ${row.bestSlot.pos}${row.bestSlot.role ? ' (' + row.bestSlot.role + ')' : ''}: ${fmt(row.bestFit)}` : '') + (row.impact && row.impact.ok ? `; dopad na součet A ${row.impact.deltaA > 0 ? '+' : ''}${fmt(row.impact.deltaA)}` : '') : 'Vhodnost nejde spočítat' }),
        h('span', { class: 'chips' }, ui.chip('accent', ds.label), ds.expired && ds.open ? h('span', { class: 'chip t-unknown', text: 'platnost jednání skončila' }) : null, ...row.flags.map(FLAG_CHIP))),
      h('details', { class: 'flow-table' }, h('summary', { text: 'Z čeho se to počítá' }), h('ul', { class: 'list' }, lines.map((l) => h('li', { text: l }))), ds.note ? h('p', { class: 'hint', text: ds.note }) : null),
      h('div', { class: 'row' }, save));
  }

  // ------------------------------------------------------------------ seznam kandidátů
  function listSection(app, ctx, redraw) {
    const R = RC();
    const list = candidatesOf(app);
    const gd = gameDateOf(app);
    const rows = list.map((c) => {
      const ds = R.dealState(c, gd);
      const impact = h('div', { 'data-impact': c.id });
      const showImpact = () => {
        if (!ctx.ready) return impact.replaceChildren(h('p', { class: 'hint', text: 'Dopad nejde spočítat: ' + ctx.problems.join(' ') }));
        const row = R.search(ctx.input, ctx.opts, [c], { statuses: 'all' }).rows[0];
        impact.replaceChildren(rowView(app, row, ctx, redraw));
      };
      if (st.impact.has(c.id)) showImpact();
      return h('div', { class: 'book player', 'data-cand': c.id },
        h('div', { class: 'meta' },
          h('b', { text: c.name }),
          h('span', { text: [(c.positions || []).join('/') || 'pozice neuvedena', c.age ? `věk ${c.age}` : 'věk neuveden', c.club || null, c.contractEnd ? `smlouva do ${c.contractEnd}` : null].filter(Boolean).join(' · ') }),
          h('span', { text: `Cena: ${moneyLabel(c.price, c.currency)} · mzda týdně: ${moneyLabel(c.wage, c.currency)} · ${Object.keys(c.attributes || {}).length} atributů` }),
          h('span', { class: 'chips' }, ui.chip('accent', ds.label), ds.validUntil ? h('span', { class: 'chip', text: `platí do ${ds.validUntil}` }) : null, ds.expired && ds.open ? h('span', { class: 'chip t-unknown', text: 'platnost jednání skončila' }) : null, c.origin && c.origin.type === 'table' ? ui.tierChip('user_entered', 'z tabulky (zadal uživatel)') : ui.tierChip('user_entered')),
          ds.note ? h('span', { class: 'hint', text: ds.note }) : null,
          c.deal && c.deal.note ? h('span', { class: 'hint', text: c.deal.note }) : null),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', type: 'button', 'data-act': 'impact', text: 'Dopad příchodu', onclick: () => {
            st.impact.add(c.id);
            showImpact();
          } }),
          h('button', { class: 'btn small', type: 'button', 'data-act': 'edit', text: 'Upravit', onclick: () => candidateForm(app, c, redraw) }),
          ui.confirmButton('Smazat', 'Opravdu smazat?', async () => {
            await app.store.remove('candidate', c.id);
            toast(`Kandidát „${c.name}“ je smazaný.`);
            redraw();
          })),
        impact);
    });
    return h('div', { id: 'recList' }, list.length ? h('div', { class: 'books' }, rows) : h('div', { class: 'empty' }, h('b', { text: 'Zatím žádní kandidáti' }), h('p', { class: 'hint', text: 'Přidej kandidáta ručně nebo načti tabulku hráčů z exportu. Aplikace spočítá, jak by příchod změnil tvoji sestavu.' })));
  }

  // ------------------------------------------------------------------ hledání posil
  // Ovládací prvky se vytvoří jednou a překreslením karty se nemění (jinak by uživateli při psaní mizel kurzor); měnit se může jen nabídka míst, ta se přepíše na místě. Výsledky se přepočítají.
  function searchControls() {
    const num = (v) => (v === '' || v === undefined ? null : Number(v));
    const slot = ui.select([['', 'Celý tým (podle dopadu na součet A)']], '', { id: 'recSlot' });
    const maxAge = ui.input({ id: 'recMaxAge', type: 'number', min: 14, max: 50, value: st.maxAge, inputmode: 'numeric' });
    const maxPrice = ui.input({ id: 'recMaxPrice', type: 'number', min: 0, value: st.maxPrice, inputmode: 'numeric', placeholder: 'bez limitu' });
    const maxWage = ui.input({ id: 'recMaxWage', type: 'number', min: 0, value: st.maxWage, inputmode: 'numeric', placeholder: 'bez limitu' });
    const query = ui.input({ id: 'recQuery', maxlength: 60, value: st.query, placeholder: 'Část jména' });
    const check = (id, label, key) => {
      const cb = h('input', { type: 'checkbox', id, checked: st[key] });
      cb.addEventListener('change', () => (st[key] = cb.checked));
      return h('label', { class: 'checkline' }, cb, h('span', { text: label }));
    };
    const bind = (el, key) => el.addEventListener('input', () => (st[key] = el.value));
    slot.addEventListener('change', () => (st.slotKey = slot.value));
    bind(maxAge, 'maxAge');
    bind(maxPrice, 'maxPrice');
    bind(maxWage, 'maxWage');
    bind(query, 'query');
    /** Přepíše nabídku míst podle aktivní taktiky a ponechá volbu, pokud místo ještě existuje. */
    function refresh(ctx) {
      const options = [['', 'Celý tým (podle dopadu na součet A)']].concat(ctx.slots.filter((x) => typeof x.role === 'string' && x.role.trim()).map((x) => [String(x.key), `${x.pos || '?'} · ${x.role}`]));
      slot.replaceChildren(...options.map(([v, t]) => h('option', { value: v, text: t })));
      slot.value = options.some(([v]) => v === st.slotKey) ? st.slotKey : '';
    }
    const filters = () => ({
      slotKey: st.slotKey, maxAge: num(st.maxAge), maxPrice: num(st.maxPrice), maxWage: num(st.maxWage), query: st.query,
      unknownAge: st.dropAge ? 'drop' : 'keep', unknownPrice: st.dropPrice ? 'drop' : 'keep', unknownWage: st.dropWage ? 'drop' : 'keep', statuses: st.all ? 'all' : undefined,
    });
    const run = h('button', { class: 'btn primary', id: 'recRun', type: 'button', text: 'Najít posily' });
    const el = h('div', null,
      h('div', { class: 'row' }, ui.field('Kde potřebuješ posilu', slot, { grow: true }), ui.field('Nejvýš let', maxAge, { width: '110px' }), ui.field('Nejvyšší cena', maxPrice, { width: '150px' }), ui.field('Nejvyšší mzda týdně', maxWage, { width: '150px' })),
      h('div', { class: 'row' }, ui.field('Jméno obsahuje', query, { grow: true })),
      check('recDropAge', 'Vyřadit kandidáty bez věku, když je věk omezený', 'dropAge'),
      check('recDropPrice', 'Vyřadit kandidáty s neznámou cenou, když je cena omezená', 'dropPrice'),
      check('recDropWage', 'Vyřadit kandidáty s neznámou mzdou, když je mzda omezená', 'dropWage'),
      check('recAll', 'Počítat i kandidáty, jejichž jednání je uzavřené (podepsáno, odmítnuto, nezajímá)', 'all'),
      check('recPartial', 'Povolit částečná data (hráč nemá všechny atributy role; číslo je pak označené)', 'partial'),
      h('div', { class: 'actions' }, run));
    return { el, run, refresh, filters };
  }

  function searchResults(app, ctx, controls, out, redraw) {
    const R = RC();
    st.shown = true;
    if (!ctx.ready) return out.replaceChildren(h('div', { class: 'banner warn', id: 'recNotReady' }, h('b', { text: 'Nejde spočítat' }), h('span', { text: ctx.problems.join(' ') })));
    const res = R.search(ctx.input, ctx.opts, candidatesOf(app), controls.filters());
    const skippedTotal = Object.values(res.skipped).reduce((a, b) => a + b, 0);
    out.replaceChildren(
      h('p', { class: 'hint', id: 'recSummary', text: `Nalezeno ${res.total} ${ui.plural(res.total, 'kandidát', 'kandidáti', 'kandidátů')}${res.total > res.shown ? `, ukázáno ${res.shown}` : ''}${skippedTotal ? `; vyřazeno filtry: ${skippedTotal}` : ''}. Model: ${res.model}.` }),
      res.issues.length ? h('div', { class: 'banner warn', id: 'recIssues' }, h('b', { text: 'Pozor' }), h('span', { text: res.issues.slice(0, 4).join(' ') })) : null,
      res.rows.length ? h('div', { class: 'books', id: 'recRows' }, res.rows.map((row) => rowView(app, row, ctx, redraw))) : h('p', { class: 'hint', text: 'Nikdo nevyhovuje. Zkus povolit víc (vyšší limity, všechny stavy jednání) nebo přidej kandidáty.' }),
      h('p', { class: 'hint', text: 'Pořadí: nejdřív kdo nejvíc zvedne součet A (potom B); kdo nejde ohodnotit (chybí atribut, nemá pozici místa), je na konci s důvodem, nikdy s nulou. Číslo je odhad aplikace, ne pravidlo FM27.' })
    );
  }

  // ------------------------------------------------------------------ odchod hráče
  function departureControls() {
    const sel = ui.select([['', 'Vyber hráče']], '', { id: 'recDepPlayer' });
    const swapSel = ui.select([['', 'bez náhrady (jen odchod)']], '', { id: 'recDepSwap' });
    const fill = (select, options, value) => {
      select.replaceChildren(...options.map(([v, t]) => h('option', { value: v, text: t })));
      select.value = options.some(([v]) => v === value) ? value : '';
    };
    return {
      sel,
      swapSel,
      el: h('div', { class: 'row' }, ui.field('Kdo by odešel', sel, { grow: true }), ui.field('Za koho (kandidát)', swapSel, { grow: true })),
      /** Přepíše nabídky hráčů a kandidátů na místě; volby zůstanou, pokud položka ještě existuje. */
      refresh(app) {
        const R = RC();
        fill(sel, [['', 'Vyber hráče'], ...FM27.context.players(app).map((p) => [p.id, p.name])], st.depPlayer);
        fill(swapSel, [['', 'bez náhrady (jen odchod)'], ...candidatesOf(app).filter((c) => R.OPEN_STATUSES.includes(c.deal && c.deal.status)).map((c) => [c.id, c.name])], st.swapWith);
        st.depPlayer = sel.value;
        st.swapWith = swapSel.value;
      },
    };
  }

  function departureResult(app, ctx, controls, out) {
    const R = RC();
    st.depPlayer = controls.sel.value;
    st.swapWith = controls.swapSel.value;
    if (!st.depPlayer) return out.replaceChildren();
    if (!ctx.ready) return out.replaceChildren(h('p', { class: 'hint', text: 'Dopad nejde spočítat: ' + ctx.problems.join(' ') }));
    const cands = candidatesOf(app).filter((c) => R.OPEN_STATUSES.includes(c.deal && c.deal.status));
    const cand = st.swapWith ? cands.find((c) => c.id === st.swapWith) : null;
    const res = cand ? R.swap(ctx.input, ctx.opts, cand, st.depPlayer) : R.departure(ctx.input, ctx.opts, st.depPlayer);
    if (!res.ok) return out.replaceChildren(h('p', { class: 'hint', text: res.issues[0] }));
    const name = cand ? res.out.name : res.player.name;
    const target = ctx.input.players.find((p) => p.id === st.depPlayer);
    const sim = R.similarCandidates(target, cands, { wp: ctx.opts.wp, n: 5 });
    out.replaceChildren(
      h('p', { class: 'hint', id: 'recDepTitle', text: cand ? `Když odejde ${name} a přijde ${cand.name}:` : `Když odejde ${name}:` }),
      h('ul', { class: 'list', id: 'recDepLines' }, R.describeChange(res).map((l) => h('li', { text: l }))),
      h('p', { class: 'hint', text: `Model: ${res.model}. Nic se v soupisce ani v taktice nemění, je to jen výpočet.` }),
      h('div', { id: 'recSimilar' },
        h('b', { text: `Kdo z kandidátů je nejpodobnější hráči ${name}` }),
        h('p', { class: 'hint', text: 'Míra podobnosti je vlastní model aplikace (vzdálenost v atributech vážených jako v DWRS), ne údaj hry. Porovnat jde jen hráče, kteří mají všechny atributy s váhou; ostatní se neřadí a nic se jim nedomýšlí.' }),
        sim.ok
          ? h('ul', { class: 'list', id: 'recSimilarRows' }, sim.rows.length ? sim.rows.map((x) => h('li', { 'data-similar': x.id, text: `${x.name}: podobnost ${fmt(x.similarity)} (vzdálenost ${fmt(x.distance)})` })) : h('li', { text: 'Žádný kandidát nemá všechny potřebné atributy.' }))
          : h('p', { class: 'hint', id: 'recSimilarWhy', text: sim.reason }),
        sim.ok && sim.unknown.length ? h('p', { class: 'hint', id: 'recSimilarUnknown', text: `Bez porovnání (chybí atributy): ${sim.unknown.map((x) => x.name).join(', ')}.` }) : null)
    );
  }

  // ------------------------------------------------------------------ doporučení a výsledky
  function recSection(app, redraw) {
    const R = RC();
    const recs = recsOf(app);
    const stats = R.recommendationStats(recs);
    const rows = recs.map((r) => {
      const f = rst.get(r.id) || { decision: r.result ? r.result.decision : '', verdict: r.result && r.result.verdict ? r.result.verdict : '', note: r.result ? r.result.note : '', msg: '' };
      rst.set(r.id, f);
      const decision = ui.select([['', 'Vyber rozhodnutí'], ...R.DECISIONS.map((d) => [d, R.DECISION_CS[d]])], f.decision, { 'aria-label': 'Rozhodnutí', 'data-f': 'decision' });
      const verdict = ui.select([['', 'bez hodnocení'], ...R.VERDICTS.map((v) => [v, R.VERDICT_CS[v]])], f.verdict, { 'aria-label': 'Hodnocení výsledku', 'data-f': 'verdict' });
      const note = ui.input({ maxlength: 300, value: f.note, placeholder: 'Poznámka k výsledku', 'aria-label': 'Poznámka k výsledku', 'data-f': 'note' });
      const msg = h('span', { class: 'hint', 'data-f': 'msg', text: f.msg });
      decision.addEventListener('change', () => (f.decision = decision.value));
      verdict.addEventListener('change', () => (f.verdict = verdict.value));
      note.addEventListener('input', () => (f.note = note.value));
      return h('div', { class: 'book', 'data-rec': r.id },
        h('div', { class: 'meta' },
          h('b', { text: `${r.candidateName}${r.slot ? ' · ' + r.slot.pos + (r.slot.role ? ' ' + r.slot.role : '') : ''}` }),
          h('span', { text: `${ui.fmtDate(r.at)} · ${r.model || 'model neuveden'}${r.expected && r.expected.deltaA !== null ? ` · očekávaný dopad na součet A ${r.expected.deltaA > 0 ? '+' : ''}${fmt(r.expected.deltaA)}` : ''}` }),
          h('span', { class: 'chips' }, r.result ? ui.chip('accent', `${R.DECISION_CS[r.result.decision]}${r.result.verdict ? ': ' + R.VERDICT_CS[r.result.verdict] : ''}`) : h('span', { class: 'chip', text: 'výsledek zatím nezapsán' }))),
        h('details', { class: 'flow-table' }, h('summary', { text: 'Z čeho se to počítalo' }), h('ul', { class: 'list' }, (r.evidence || []).map((l) => h('li', { text: l })))),
        h('div', { class: 'row' }, decision, verdict, note,
          h('button', { class: 'btn small', type: 'button', 'data-act': 'result', text: 'Zapsat výsledek', onclick: async () => {
            const res = R.setResult(r, { decision: f.decision, verdict: f.verdict || null, note: f.note, at: Date.now() });
            if (!res.ok) {
              f.msg = res.issues[0];
              msg.textContent = f.msg;
              return;
            }
            f.msg = '';
            await app.store.put('recommendation', Object.assign(app.store.draft(r), { result: res.recommendation.result }));
            toast('Výsledek je zapsaný.');
            redraw();
          } }),
          r.result ? h('button', { class: 'btn small', type: 'button', 'data-act': 'reopen', text: 'Vrátit mezi otevřená', onclick: async () => {
            await app.store.put('recommendation', Object.assign(app.store.draft(r), { result: null }));
            rst.delete(r.id);
            redraw();
          } }) : null,
          ui.confirmButton('Smazat', 'Opravdu smazat?', async () => {
            await app.store.remove('recommendation', r.id);
            rst.delete(r.id);
            redraw();
          }),
          msg));
    });
    return h('div', { id: 'recRecs' }, h('p', { class: 'hint', id: 'recStats', text: stats.total ? `Doporučení: ${stats.total}, otevřených ${stats.open}. ${stats.note}` : 'Zatím žádná doporučení. Uložíš je z výsledků hledání nebo u kandidáta.' }), rows.length ? h('div', { class: 'books' }, rows) : null);
  }

  // ------------------------------------------------------------------ celá karta
  /** Karta se sestaví jednou a sama se stará o aktualizaci: při změně dat se překreslí jen části s výsledky (seznam, výsledky hledání, odchod, doporučení), ne ovládací prvky ani načtení z tabulky. */
  function card(app) {
    const R = RC();
    if (!R) return null;
    let ctx = context(app);
    const bannerBox = h('div', { id: 'recBannerBox' });
    const listBox = h('div');
    const resultsBox = h('div', { id: 'recResults', 'aria-live': 'polite' });
    const depOut = h('div', { id: 'recDepOut', 'aria-live': 'polite' });
    const recBox = h('div');
    const controls = searchControls();
    const dep = departureControls();
    const gd = h('input', { type: 'text', id: 'recGameDate', maxlength: 10, value: gameDateOf(app) || '', placeholder: 'RRRR-MM-DD' });
    const gdMsg = h('p', { class: 'hint', id: 'recGameDateMsg', 'aria-live': 'polite', text: gameDateOf(app) ? '' : 'Bez data ve hře se platnost jednání nehlídá.' });
    gd.addEventListener('change', async () => {
      const v = gd.value.trim();
      if (v !== '' && !R.isDate(v)) return (gdMsg.textContent = 'Datum musí být ve tvaru RRRR-MM-DD a existovat v kalendáři.');
      const career = app.store.draft(careerOf(app));
      if (v === '') delete career.gameDate;
      else career.gameDate = v;
      await app.store.put('career', career);
      gdMsg.textContent = v ? '' : 'Bez data ve hře se platnost jednání nehlídá.';
      toast(v ? 'Datum ve hře je uložené.' : 'Datum ve hře je smazané: platnost jednání se nehlídá.');
    });
    function draw() {
      ctx = context(app);
      bannerBox.replaceChildren(ctx.ready ? null : h('div', { class: 'banner warn', id: 'recPrereq' }, h('b', { text: 'Dopad na sestavu zatím nejde spočítat' }), h('span', { text: ctx.problems.join(' ') + ' Kandidáty můžeš zatím jen evidovat.' })));
      controls.refresh(ctx);
      dep.refresh(app);
      listBox.replaceChildren(listSection(app, ctx, draw));
      if (st.shown) searchResults(app, ctx, controls, resultsBox, draw);
      departureResult(app, ctx, dep, depOut);
      recBox.replaceChildren(recSection(app, draw));
    }
    controls.run.addEventListener('click', () => searchResults(app, ctx, controls, resultsBox, draw));
    dep.sel.addEventListener('change', () => departureResult(app, ctx, dep, depOut));
    dep.swapSel.addEventListener('change', () => departureResult(app, ctx, dep, depOut));
    const section = h('section', { class: 'card', id: 'recruitCard' },
      h('h2', { text: 'Přestupy: kandidáti a posily' }),
      h('p', { class: 'lead', id: 'recLead', text: 'Kandidáti jsou cizí hráči, které sem zadáš nebo načteš z exportu tabulky. Aplikace spočítá, jak by příchod změnil tvoji sestavu A + B v aktivní taktice. Vhodnost je odhad aplikace (DWRS nebo jednoduchý průměr), ne pravidlo FM27. Cena a mzda jsou jen to, co zadáš (jinak neznámé), potenciál a další skryté údaje se nepoužívají a nic se nezmění samo.' }),
      bannerBox,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'recAdd', type: 'button', text: 'Přidat kandidáta', onclick: () => candidateForm(app, null, draw) })),
      importCard(app, draw),
      ui.field('Dnešní datum ve hře (nepovinné)', gd, { width: '200px', hint: 'Slouží jen ke hlídání platnosti jednání. Aplikace datum ve hře nezná, takže ho píšeš ty.' }),
      gdMsg,
      h3('Kandidáti', 'recListTitle'),
      h('div', { id: 'recListBox' }, listBox),
      h3('Hledání posil', 'recSearchTitle'),
      h('div', { id: 'recSearch' }, controls.el, resultsBox),
      h3('Odchod hráče', 'recDepTitle0'),
      h('div', { id: 'recDeparture' }, dep.el, depOut),
      h3('Doporučení a výsledky', 'recRecsTitle'),
      recBox);
    draw();
    // Překreslení při změně dat (i z druhého zařízení); ovládací prvky a rozepsaný stav zůstávají.
    app.watch(['candidate', 'recommendation', 'player', 'tactic', 'roleprofile', 'weightprofile', 'settings', 'career'], () => section.isConnected && draw());
    return section;
  }

  FM27.recruitUI = { card };
})();
