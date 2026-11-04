/* Můj tým: soupiska kariéry. Hráče zadáváš ručně, z ručního plánu (.json) nebo ze screenshotu, který si před uložením
   zkontroluješ. Role a povinnosti jsou volný text přesně tak, jak je vidíš ve hře: aplikace nezná jejich oficiální názvy
   a nikdy je nedoplňuje z paměti. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;

  const MAX_PLAYERS = 60;
  const SUGGEST_ATTRS = ['Finishing', 'Passing', 'Pace', 'Stamina', 'Defending', 'Tackling', 'Dribbling', 'Vision', 'Positioning', 'Work rate', 'Strength', 'Heading'];

  // ------------------------------------------------------------------ převody a kontroly
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

  /** "Finishing 14" na řádek → {Finishing: 14}. Chyby se vracejí českou větou. */
  function parseAttributes(text) {
    const out = {};
    const errors = [];
    for (const line of lines(text)) {
      const m = /^(.+?)[\s:=]+(\d{1,2})$/.exec(line);
      if (!m) {
        errors.push(`Řádek „${line}“ nemá tvar „Název číslo“.`);
        continue;
      }
      const v = Number(m[2]);
      if (v < 1 || v > 20) errors.push(`Atribut „${m[1]}“: hodnota ${v} je mimo 1 až 20.`);
      else out[m[1].trim().slice(0, 30)] = v;
    }
    if (Object.keys(out).length > 40) errors.push('Atributů je víc než 40.');
    return { out, errors };
  }
  function parsePositions(text) {
    const list = String(text || '').toUpperCase().split(/[\s,;/]+/).filter(Boolean);
    const bad = list.find((p) => !/^[A-Z]{1,4}$/.test(p));
    if (bad) return { error: `Pozice „${bad}“ je divná. Piš zkratky jako GK, RB, DM, ST, oddělené čárkou.` };
    return { list: [...new Set(list)].slice(0, 4) };
  }
  const attrsToText = (a) => Object.entries(a || {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} ${v}`).join('\n');

  function sourceChip(p) {
    const map = { manual: ['user_entered', 'zadal jsi'], plan: ['user_entered', 'z ručního plánu'], screenshot: ['observed', 'ze screenshotu, potvrzeno tebou'] };
    const [tier, text] = map[p.source] || map.manual;
    return ui.tierChip(tier, text);
  }

  // ------------------------------------------------------------------ úpravy
  async function savePlayer(app, base, fields) {
    const career = app.career();
    const next = Object.assign({ source: 'manual', prov: {} }, base ? app.store.draft(base) : {}, fields, { careerId: career.id });
    return app.store.put('player', next);
  }

  /** Vloží hráče z plánu; kdo už je podle jména v soupisce, se přeskočí. Vrací {added, skipped, map: {idPlánu: idHráče}}. */
  async function importPlanPlayers(app, planPlayers) {
    const career = app.career();
    const existing = new Map(FM27.context.players(app).map((p) => [p.name.trim().toLowerCase(), p]));
    const map = {};
    let added = 0;
    let skipped = 0;
    for (const raw of planPlayers) {
      const name = String(raw.name || '').trim();
      if (!name) continue;
      const have = existing.get(name.toLowerCase());
      if (have) {
        map[raw.id] = have.id;
        skipped++;
        continue;
      }
      if (existing.size >= MAX_PLAYERS) break;
      const saved = await app.store.put('player', {
        careerId: career.id,
        name: name.slice(0, 60),
        positions: raw.positions && raw.positions.length ? raw.positions : raw.position ? [String(raw.position).toUpperCase()] : [],
        role: raw.role || '',
        duty: raw.duty || '',
        foot: raw.foot || 'unknown',
        age: raw.age || null,
        attributes: raw.attributes || {},
        strengths: raw.strengths || [],
        weaknesses: raw.weaknesses || [],
        flags: { injury: !!(raw.flags && raw.flags.injury), fatigue: !!(raw.flags && raw.flags.fatigue) },
        notes: raw.notes || '',
        source: 'plan',
        prov: {},
      });
      existing.set(name.toLowerCase(), saved);
      map[raw.id] = saved.id;
      added++;
    }
    return { added, skipped, map };
  }
  FM27.team = { importPlanPlayers, parseAttributes, parsePositions };

  // ------------------------------------------------------------------ editor hráče
  function openEditor(app, player, afterSave) {
    const p = player || { name: '', positions: [], role: '', duty: '', foot: 'unknown', age: null, attributes: {}, strengths: [], weaknesses: [], flags: { injury: false, fatigue: false }, notes: '' };
    const name = ui.input({ id: 'plName', maxlength: 60, value: p.name, placeholder: 'Jméno hráče' });
    const pos = ui.input({ id: 'plPos', maxlength: 30, value: (p.positions || []).join(', '), placeholder: 'Např. RB, RWB' });
    const role = ui.input({ id: 'plRole', maxlength: 60, value: p.role || '', placeholder: 'Přesně, jak je to vidět ve hře' });
    const duty = ui.input({ id: 'plDuty', maxlength: 40, value: p.duty || '', placeholder: 'Např. podpora, útok, obrana' });
    const foot = ui.select([['unknown', 'neznámá'], ['left', 'levá'], ['right', 'pravá'], ['both', 'obě']], p.foot || 'unknown', { id: 'plFoot' });
    const age = ui.input({ id: 'plAge', type: 'number', min: 14, max: 50, value: p.age || '', inputmode: 'numeric' });
    const attrs = h('textarea', { id: 'plAttrs', placeholder: 'Jedna dvojice na řádek, např.\nFinishing 14\nPace 16', style: 'min-height:90px' });
    attrs.value = attrsToText(p.attributes);
    const strengths = h('textarea', { id: 'plStr', style: 'min-height:56px', placeholder: 'Jedna silná stránka na řádek' });
    strengths.value = (p.strengths || []).join('\n');
    const weaknesses = h('textarea', { id: 'plWeak', style: 'min-height:56px', placeholder: 'Jedna slabá stránka na řádek' });
    weaknesses.value = (p.weaknesses || []).join('\n');
    const injury = h('input', { type: 'checkbox', id: 'plInjury', checked: !!(p.flags && p.flags.injury) });
    const fatigue = h('input', { type: 'checkbox', id: 'plFatigue', checked: !!(p.flags && p.flags.fatigue) });
    const notes = h('textarea', { id: 'plNotes', style: 'min-height:56px', placeholder: 'Cokoli, co má trenér vědět' });
    notes.value = p.notes || '';
    const msg = h('p', { class: 'hint', id: 'plMsg' });

    const save = h('button', {
      class: 'btn primary',
      id: 'plSave',
      type: 'button',
      text: 'Uložit hráče',
      onclick: async () => {
        const nm = name.value.trim();
        if (!nm) return (msg.textContent = 'Napiš jméno hráče.');
        const ps = parsePositions(pos.value);
        if (ps.error) return (msg.textContent = ps.error);
        const at = parseAttributes(attrs.value);
        if (at.errors.length) return (msg.textContent = at.errors[0]);
        const ageN = age.value === '' ? null : Number(age.value);
        if (ageN !== null && (!Number.isInteger(ageN) || ageN < 14 || ageN > 50)) return (msg.textContent = 'Věk musí být celé číslo od 14 do 50.');
        if (!player && FM27.context.players(app).length >= MAX_PLAYERS) return (msg.textContent = `Soupiska má nejvýš ${MAX_PLAYERS} hráčů.`);
        await savePlayer(app, player, {
          name: nm,
          positions: ps.list,
          role: role.value.trim(),
          duty: duty.value.trim(),
          foot: foot.value,
          age: ageN,
          attributes: at.out,
          strengths: lines(strengths.value).slice(0, 8),
          weaknesses: lines(weaknesses.value).slice(0, 8),
          flags: { injury: injury.checked, fatigue: fatigue.checked },
          notes: notes.value.trim().slice(0, 400),
        });
        ui.closeDrawer();
        toast(`Hráč „${nm}“ je uložený.`);
        if (afterSave) afterSave();
      },
    });
    const datalist = h('datalist', { id: 'attrNames' }, SUGGEST_ATTRS.map((a) => h('option', { value: a })));
    ui.openDrawer(player ? 'Upravit hráče' : 'Nový hráč', [
      datalist,
      ui.field('Jméno', name),
      h('div', { class: 'row' }, ui.field('Pozice (zkratky)', pos, { grow: true }), ui.field('Věk', age, { width: '90px' }), ui.field('Silnější noha', foot, { width: '140px' })),
      h('div', { class: 'row' }, ui.field('Role (jak ji vidíš ve hře)', role, { grow: true }), ui.field('Povinnost', duty, { grow: true })),
      h('p', { class: 'hint', text: 'Názvy rolí a povinností aplikace nezná. Piš je tak, jak je vidíš ve hře. Trenér je bere jako tvoje zadání, ne jako ověřený fakt o FM27.' }),
      ui.field('Atributy (1 až 20)', attrs, { hint: 'Názvy si vybereš sám (třeba Finishing, Pace). Nic se nedoplňuje.' }),
      h('div', { class: 'row' }, ui.field('Silné stránky', strengths, { grow: true }), ui.field('Slabé stránky', weaknesses, { grow: true })),
      h('label', { class: 'checkline' }, injury, h('span', { text: 'Zraněný' })),
      h('label', { class: 'checkline' }, fatigue, h('span', { text: 'Unavený' })),
      ui.field('Poznámky', notes),
      h('div', { class: 'actions' }, save),
      msg,
    ]);
    name.focus();
  }

  // ------------------------------------------------------------------ čtení soupisky ze screenshotu
  const SQUAD_PROMPT = `Na přiložených obrázcích je obrazovka se soupiskou hráčů hry Football Manager. Přepiš jen hráče, které na obrázku opravdu čteš.

Pravidla:
- Co na obrázku není čitelné, napiš jako null. Nikdy nic nehádej ani nedoplňuj z paměti.
- Jména přepiš přesně tak, jak jsou napsaná. Pozice jako zkratky, které vidíš (např. GK, DC, ST).
- Atributy jen tehdy, když je vidíš jako čísla; název atributu přepiš tak, jak je napsaný.
- Neuváděj názvy rolí ani nastavení hry, které na obrázku nevidíš.
- Hráče, jejichž jméno nečteš, vynech.

Odpověz POUZE JSON objektem:
{"players": [{"name": "…", "positions": ["…"], "age": číslo|null, "role": "…"|null, "attributes": {"Název": číslo}, "injured": true|false|null}], "notes": "krátká poznámka o čitelnosti"}`;

  /** Kontrola odpovědi modelu: cokoli podezřelého se zahodí. Návrhy jsou vždy neověřené, dokud je uživatel nepotvrdí. */
  function normalizeSquadExtraction(raw) {
    const issues = [];
    const list = raw && Array.isArray(raw.players) ? raw.players : null;
    if (!list) return { proposals: [], issues: ['Odpověď nemá seznam hráčů.'] };
    const seen = new Set();
    const proposals = [];
    for (const r of list.slice(0, 40)) {
      const name = r && typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim() : '';
      if (name.length < 2 || name.length > 60) {
        issues.push('Řádek bez čitelného jména se vynechal.');
        continue;
      }
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const positions = (Array.isArray(r.positions) ? r.positions : []).map((x) => String(x).toUpperCase().trim()).filter((x) => /^[A-Z]{1,4}$/.test(x)).slice(0, 4);
      const age = Number.isInteger(r.age) && r.age >= 14 && r.age <= 50 ? r.age : null;
      const attributes = {};
      if (r.attributes && typeof r.attributes === 'object') {
        for (const [k, v] of Object.entries(r.attributes).slice(0, 40)) {
          if (Number.isInteger(v) && v >= 1 && v <= 20) attributes[String(k).slice(0, 30)] = v;
          else issues.push(`${name}: atribut „${k}“ má nečitelnou hodnotu, vynechal se.`);
        }
      }
      proposals.push({ name, positions, age, role: typeof r.role === 'string' ? r.role.trim().slice(0, 60) : '', attributes, injured: r.injured === true });
    }
    return { proposals, issues };
  }
  FM27.team.normalizeSquadExtraction = normalizeSquadExtraction;

  function screenshotCard(app, redraw) {
    const ai = FM27.ai;
    if (!ai.imagesSupported) {
      return h('section', { class: 'card' }, h('h2', { text: 'Doplnit ze screenshotu' }), h('p', { class: 'hint', text: 'Čtení screenshotů tady není dostupné (potřebuje Claude s podporou obrázků). Zadej hráče ručně nebo z plánu.' }));
    }
    const input = h('input', { type: 'file', id: 'squadShot', accept: ai.limitsInfo.images.mediaTypes.join(','), multiple: true });
    const out = h('div', { id: 'squadProposals' });
    const status = h('p', { class: 'hint', id: 'squadStatus', 'aria-live': 'polite' });
    const read = h('button', {
      class: 'btn',
      id: 'squadRead',
      type: 'button',
      text: 'Přečíst soupisku ze screenshotu',
      onclick: async () => {
        const files = [...input.files].slice(0, ai.limitsInfo.images.maxCount);
        if (!files.length) return (status.textContent = 'Vyber aspoň jeden obrázek.');
        read.disabled = true;
        status.textContent = 'Čtu obrázek… (při prvním použití potvrď okno Claude)';
        out.replaceChildren();
        try {
          const raw = await ai.json(SQUAD_PROMPT, { modelTier: 'quick', images: files, cache: false, purpose: 'čtení soupisky' });
          const { proposals, issues } = normalizeSquadExtraction(raw);
          status.textContent = proposals.length ? `Přečetl jsem ${proposals.length} hráčů. Není to ověřené: zkontroluj je podle screenshotu.` : 'Nic čitelného jsem nenašel.';
          if (issues.length) out.append(h('p', { class: 'hint', text: 'Poznámky ke čtení: ' + [...new Set(issues)].slice(0, 4).join(' ') }));
          if (proposals.length) renderProposals(app, out, proposals, redraw);
        } catch (e) {
          status.textContent = ai.errorText(e);
        } finally {
          read.disabled = false;
        }
      },
    });
    return h('section', { class: 'card' }, h('h2', { text: 'Doplnit ze screenshotu' }), h('p', { class: 'lead', text: 'Model přečte hráče z obrázku soupisky. Co přečte, je jen návrh: nic se neuloží, dokud nepotvrdíš, že to odpovídá screenshotu.' }), ui.field('Screenshot soupisky', input), h('div', { class: 'actions' }, read), status, out);
  }

  function renderProposals(app, box, proposals, redraw) {
    const checks = proposals.map((p) => h('input', { type: 'checkbox', checked: true, 'aria-label': 'Přidat ' + p.name }));
    const confirm = h('input', { type: 'checkbox', id: 'squadConfirm' });
    const add = h('button', {
      class: 'btn primary',
      id: 'squadAdd',
      type: 'button',
      text: 'Přidat vybrané hráče',
      onclick: async () => {
        if (!confirm.checked) return toast('Nejdřív potvrď, že jsi návrhy zkontroloval podle screenshotu.');
        const existing = new Set(FM27.context.players(app).map((p) => p.name.toLowerCase()));
        let n = 0;
        for (const [i, p] of proposals.entries()) {
          if (!checks[i].checked || existing.has(p.name.toLowerCase())) continue;
          await app.store.put('player', { careerId: app.career().id, name: p.name, positions: p.positions, role: p.role, duty: '', foot: 'unknown', age: p.age, attributes: p.attributes, strengths: [], weaknesses: [], flags: { injury: p.injured, fatigue: false }, notes: '', source: 'screenshot', prov: { all: 'screenshot_verified' } });
          n++;
        }
        toast(n ? `Přidáno hráčů: ${n}.` : 'Nikdo nový k přidání.');
        box.replaceChildren();
        redraw();
      },
    });
    box.append(
      h('div', { class: 'books' }, proposals.map((p, i) => h('label', { class: 'book' }, h('div', { class: 'meta' }, h('b', { text: p.name }), h('span', { text: [p.positions.join('/') || 'pozice nečitelná', p.age ? `věk ${p.age}` : null, p.role ? `role: ${p.role}` : null, Object.keys(p.attributes).length ? `${Object.keys(p.attributes).length} atributů` : null, p.injured ? 'zraněný' : null].filter(Boolean).join(' · ') })), checks[i]))),
      h('label', { class: 'checkline' }, confirm, h('span', { text: 'Zkontroloval jsem návrhy podle screenshotu a odpovídají mu.' })),
      h('div', { class: 'actions' }, add)
    );
  }

  // ------------------------------------------------------------------ seznam
  function listCard(app, redraw) {
    const team = FM27.context.players(app);
    const rows = team.map((p) =>
      h(
        'div',
        { class: 'book player' },
        h(
          'div',
          { class: 'meta' },
          h('b', { text: p.name }),
          h('span', { text: [(p.positions || []).join('/') || 'pozice neuvedena', p.role ? `role: ${p.role}${p.duty ? ' (' + p.duty + ')' : ''}` : 'role neuvedena', p.age ? `věk ${p.age}` : null].filter(Boolean).join(' · ') }),
          h('span', { class: 'chips' }, sourceChip(p), p.flags && p.flags.injury ? h('span', { class: 'chip t-unknown', text: 'zraněný' }) : null, p.flags && p.flags.fatigue ? h('span', { class: 'chip t-inferred', text: 'unavený' }) : null)
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn small', type: 'button', text: 'Upravit', onclick: () => openEditor(app, p, redraw) }),
          ui.confirmButton('Smazat', 'Opravdu smazat?', async () => {
            await app.store.remove('player', p.id);
            toast(`Hráč „${p.name}“ je smazaný.`);
            redraw();
          })
        )
      )
    );
    const planInput = h('input', { type: 'file', id: 'teamPlan', accept: 'application/json,.json', hidden: true });
    planInput.addEventListener('change', async () => {
      const file = planInput.files[0];
      if (!file) return;
      try {
        if (!window.TrenerTactics) throw new Error('Chybí modul taktik.');
        const parsed = window.TrenerTactics.importPlanJson(JSON.parse(await file.text()));
        if (!parsed.players || !parsed.players.length) throw new Error((parsed.report && parsed.report.errors && parsed.report.errors[0]) || 'V plánu nejsou hráči.');
        const r = await importPlanPlayers(app, parsed.players);
        toast(`Z plánu přidáno ${r.added}, už v soupisce bylo ${r.skipped}.`);
        redraw();
      } catch (e) {
        toast('Plán se nepodařilo načíst: ' + (e.message || e));
      }
      planInput.value = '';
    });
    return h(
      'section',
      { class: 'card' },
      h('h2', { text: 'Můj tým' }),
      h('p', { class: 'lead', text: 'Soupiska tvé kariéry. Trenér ji čte při každé radě, takže pozná, jestli se rada hodí pro tvé hráče. Co sem napíšeš, bere jako tvoje zadání, ne jako data načtená z FM27.' }),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', id: 'plNew', type: 'button', text: 'Přidat hráče', onclick: () => openEditor(app, null, redraw) }),
        h('label', { class: 'btn', for: 'teamPlan', style: 'cursor:pointer', text: 'Importovat z plánu (.json)' }),
        planInput
      ),
      h('p', { class: 'hint', id: 'teamSummary', text: team.length ? `${team.length} ${ui.plural(team.length, 'hráč', 'hráči', 'hráčů')}, ${team.filter((p) => p.flags && p.flags.injury).length} zraněných.` : '' }),
      h('div', { class: 'books', id: 'playerList' }, rows.length ? rows : h('div', { class: 'empty' }, h('b', { text: 'Soupiska je prázdná' }), h('p', { class: 'hint', text: 'Přidej hráče ručně, z plánu nebo ze screenshotu. Bez soupisky trenér neví, jestli se rada hodí pro tvůj tým.' })))
    );
  }

  function render(root, app) {
    // Seznam se překresluje při každé změně (i z druhého zařízení), karta se screenshotem ne:
    // jinak by změna uprostřed výběru souboru vybraný obrázek zahodila.
    const listBox = h('div');
    const shotBox = h('div');
    const drawList = () => listBox.replaceChildren(listCard(app, drawList));
    if (!app.requireCareer(root, 'Soupiska')) return;
    root.replaceChildren(listBox, shotBox);
    drawList();
    shotBox.replaceChildren(screenshotCard(app, drawList));
    app.watch(['player'], () => root.contains(listBox) && drawList());
  }

  FM27.screens.register({ id: 'tym', hash: 'tym', label: 'Můj tým', order: 2, render });
})();
