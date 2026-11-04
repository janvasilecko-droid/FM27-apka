/* Analýza soupeře (zadání § 7): profil soupeře s původem každého údaje a předzápasový plán s kontrolou poctivosti.
   Co o soupeři nevíš, zůstane prázdné a trenér to přizná. Údaje přečtené z obrázku jsou jen návrh, dokud je nepotvrdíš. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;
  const W = FM27.widgets;

  let selectedId = null;
  let running = null;
  const PROV_CS = [
    ['user_entered', 'moje poznámka'],
    ['vision_unverified', 'přečteno z obrázku, neověřeno'],
    ['screenshot_verified', 'ověřeno mnou podle screenshotu'],
  ];
  const STEPS = { plan: 'Hledám v knihách', ask: 'Skládám plán', check: 'Kontroluji poctivost', repair: 'Opravuji plán podle kontroly' };

  const listOpponents = (app) => app.store.list('opponent', (o) => o.careerId === app.career().id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'));

  // ------------------------------------------------------------------ plán
  function renderPlan(app, box, plan, ctx, meta) {
    box.replaceChildren();
    const O = window.TrenerOpponent;
    const list = h('div', { class: 'advice' });
    list.append(W.claim(null, 'Shrnutí', plan.summary, ctx, app));
    list.append(W.claim(null, 'Jak soupeře napadat', plan.press, ctx, app));
    list.append(W.claim(null, 'Kde získávat míč', plan.winBall, ctx, app));
    list.append(W.claim(null, `Kterou stranu využívat: ${O.SIDE_CS[plan.side.choice]}`, plan.side, ctx, app));
    list.append(W.claim(null, 'Které prostory obsazovat', plan.spaces, ctx, app, h('ul', null, plan.spaces.items.map((s) => h('li', { text: s })))));
    list.append(W.claim(null, plan.limit.player ? `Kterého hráče omezit: ${plan.limit.player}` : 'Hráč k omezení', plan.limit, ctx, app));
    list.append(W.sec(null, 'Rizika zvoleného přístupu', null, h('p', { text: plan.risk.text }), h('ul', null, plan.risk.items.map((s) => h('li', { text: s })))));
    list.append(W.sec(null, 'Jistota', h('span', { class: 'chip t-' + (plan.confidence.level === 'high' ? 'observed' : plan.confidence.level === 'medium' ? 'inferred' : 'unknown'), text: C.LEVEL_CS[plan.confidence.level] }), h('p', { text: plan.confidence.text })));
    list.append(W.sec(null, 'Co trenér neví', ui.tierChip('unknown'), h('p', { text: plan.unknown.text }), h('ul', null, plan.unknown.items.map((s) => h('li', { text: s })))));
    box.append(h('div', { class: 'banner ok' }, h('b', { text: 'Plán prošel kontrolou poctivosti' }), meta ? h('p', { class: 'hint', text: meta }) : null), list, h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Kopírovat plán', onclick: () => ui.copyText(O.planToText(plan), 'Plán je zkopírovaný.') })));
  }

  async function runPlan(app, opp, box, steps, button) {
    const ai = FM27.ai;
    const O = window.TrenerOpponent;
    if (!ai.available) return toast('Claude není dostupný.');
    const oppObs = O.profileToObservations(opp);
    if (oppObs.length < 2) return toast('Vyplň aspoň jeden údaj o soupeři.');
    const careerObs = FM27.context.observations(app, { memory: true });
    const observations = [...oppObs, ...careerObs];
    const obsMap = {};
    for (const o of observations) obsMap[o.id] = { label: o.label, text: o.text };
    const ctl = new AbortController();
    running = ctl;
    button.disabled = true;
    box.replaceChildren();
    steps.reset(['plan', 'ask', 'check']);
    try {
      const lib = FM27.library;
      let hits = [];
      if (lib.size) {
        steps.set('plan', 'run');
        hits = C.multiSearch(lib.index, O.searchSeeds(opp).concat([`jak hrát proti soupeři ${(opp.fields.formation && opp.fields.formation.value) || ''}`]), { k: 8, perBook: 3 });
        steps.set('plan', 'done', `${hits.length} ${ui.plural(hits.length, 'úryvek', 'úryvky', 'úryvků')}`);
      } else steps.set('plan', 'skip', 'knihovna je prázdná');
      const passageCtx = {};
      for (const hit of hits) {
        const book = lib.bookById(hit.bookId);
        passageCtx[hit.id] = { id: hit.id, bookId: hit.bookId, title: book ? book.title : '?', where: book ? lib.whereLabel(book, hit) : '?', text: hit.text.slice(0, 1000) };
      }
      W.snapPut(passageCtx);
      const knownPlayers = ((opp.fields.keyPlayers && opp.fields.keyPlayers.value) || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const turns = O.buildPlanTurns({ observations: observations.map((o) => ({ id: o.id, label: o.label, text: o.text })), passages: Object.values(passageCtx), sourcesDigest: app.registry.digest() });
      const result = await ai.structured({
        turns,
        validate: (plan) => O.validatePlan(plan, { observations: obsMap, passages: new Set(Object.keys(passageCtx)), registry: app.registry, knownPlayers }),
        tier: 'default',
        signal: ctl.signal,
        purpose: 'plán proti soupeři',
        onStep: (s, st, note) => steps.set(s, st, note),
      });
      const ctx = { passages: passageCtx, observations: obsMap };
      if (result.status === 'ok') {
        // Profil se mezitím mohl upravit (třeba „Uložit profil“ během čtení plánu): k plánu se přidává do aktuální verze, ne do kopie ze začátku.
        const latest = app.store.get('opponent', opp.id);
        if (!latest) return toast('Soupeř mezitím zmizel, plán se neuložil.');
        const saved = await app.store.put('opponent', Object.assign(app.store.draft(latest), { plan: result.value, planAt: Date.now(), planPassages: Object.fromEntries(Object.entries(passageCtx).map(([id, p]) => [id, { id, title: p.title, where: p.where }])), planObservations: obsMap }));
        renderPlan(app, box, saved.plan, ctx, result.verdict.warnings.join(' '));
      } else {
        box.append(W.failedCheckBanner(result.verdict, 'Plán neprošel kontrolou poctivosti', () => runPlan(app, opp, box, steps, button)));
      }
    } catch (e) {
      if (e && e.code === 'cancelled') toast('Zastaveno.');
      else box.append(W.errorBanner(ai.errorText(e), !(e && ai.NO_RETRY.includes(e.code)) ? () => runPlan(app, opp, box, steps, button) : null));
    } finally {
      running = null;
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------------ čtení obrazovky soupeře
  function screenshotCard(app, opp, applyFields) {
    const ai = FM27.ai;
    if (!ai.imagesSupported) return null;
    const O = window.TrenerOpponent;
    const input = h('input', { type: 'file', id: 'oppShot', accept: ai.limitsInfo.images.mediaTypes.join(','), multiple: true });
    const status = h('p', { class: 'hint', id: 'oppShotStatus', 'aria-live': 'polite' });
    const out = h('div', { id: 'oppProposals' });
    const read = h('button', {
      class: 'btn',
      id: 'oppRead',
      type: 'button',
      text: 'Přečíst soupeře ze screenshotu',
      onclick: async () => {
        const files = [...input.files].slice(0, ai.limitsInfo.images.maxCount);
        if (!files.length) return (status.textContent = 'Vyber aspoň jeden obrázek.');
        read.disabled = true;
        status.textContent = 'Čtu obrázek… (při prvním použití potvrď okno Claude)';
        out.replaceChildren();
        try {
          const raw = await ai.json(O.EXTRACTION_PROMPT, { modelTier: 'quick', images: files, cache: false, purpose: 'čtení soupeře' });
          const { fields, issues } = O.normalizeExtraction(raw);
          const keys = Object.keys(fields);
          status.textContent = keys.length ? 'Přečteno. Je to jen návrh, žádná hodnota se nepřepíše, dokud ji nepoužiješ.' : 'Nic spolehlivého jsem nepřečetl.';
          if (issues.length) out.append(h('p', { class: 'hint', text: issues.join(' ') }));
          for (const key of keys) {
            out.append(
              h(
                'div',
                { class: 'book' },
                h('div', { class: 'meta' }, h('b', { text: O.FIELD_LABEL[key] }), h('span', { text: fields[key] })),
                h('button', {
                  class: 'btn small',
                  type: 'button',
                  text: 'Použít (neověřené)',
                  onclick: async (ev) => {
                    const btn = ev.currentTarget;
                    btn.disabled = true;
                    await applyFields({ [key]: fields[key] });
                    btn.textContent = 'Použito';
                  },
                })
              )
            );
          }
        } catch (e) {
          status.textContent = ai.errorText(e);
        } finally {
          read.disabled = false;
        }
      },
    });
    return h('section', { class: 'card' }, h('h2', { text: 'Doplnit ze screenshotu' }), h('p', { class: 'lead', text: 'Model přečte, co je na obrazovce o soupeři. Použité hodnoty se označí „přečteno z obrázku, neověřeno“, dokud je sám nepotvrdíš.' }), ui.field('Screenshot soupeře', input), h('div', { class: 'actions' }, read), status, out);
  }

  // ------------------------------------------------------------------ editor profilu
  function editor(app, opp, redraw) {
    const O = window.TrenerOpponent;
    const name = ui.input({ id: 'oppName', maxlength: 80, value: opp.name });
    const controls = {};
    const rows = O.FIELDS.map(([key, label, hint]) => {
      const f = (opp.fields && opp.fields[key]) || { value: '', prov: 'user_entered' };
      const area = h('textarea', { id: 'oppF-' + key, placeholder: hint, style: 'min-height:54px' });
      area.value = f.value || '';
      const prov = ui.select(PROV_CS, f.prov || 'user_entered', { id: 'oppP-' + key });
      controls[key] = { area, prov };
      return h('div', { class: 'row oppfield' }, ui.field(label, area, { grow: true }), ui.field('Původ údaje', prov, { width: '230px' }));
    });
    const msg = h('p', { class: 'hint', id: 'oppMsg' });
    const save = h('button', {
      class: 'btn primary',
      id: 'oppSave',
      type: 'button',
      text: 'Uložit profil',
      onclick: async () => {
        const nm = name.value.trim();
        if (!nm) return (msg.textContent = 'Napiš jméno soupeře.');
        const fields = {};
        for (const [key] of O.FIELDS) {
          const v = controls[key].area.value.trim().slice(0, 500);
          if (v) fields[key] = { value: v, prov: controls[key].prov.value };
        }
        await app.store.put('opponent', Object.assign(app.store.draft(opp), { name: nm.slice(0, 80), fields }));
        msg.textContent = '';
        toast('Profil soupeře je uložený.');
        redraw();
      },
    });
    const section = h(
      'section',
      { class: 'card' },
      h('h2', { text: 'Profil soupeře' }),
      h('p', { class: 'lead', text: 'Vyplň, co o soupeři víš. U každého údaje řekni, odkud ho máš. Prázdné pole znamená „nevím“ a trenér to přizná.' }),
      ui.field('Jméno soupeře', name),
      ...rows,
      h('div', { class: 'actions' }, save, ui.confirmButton('Smazat soupeře', 'Opravdu smazat?', async () => {
        await app.store.remove('opponent', opp.id);
        selectedId = null;
        toast('Soupeř je smazaný.');
        redraw();
      })),
      msg
    );
    // Použití návrhu ze screenshotu přepíše jen to jedno pole; ostatní rozepsané úpravy v profilu zůstanou.
    section.applyField = (key, value) => {
      if (!controls[key]) return;
      controls[key].area.value = value;
      controls[key].prov.value = 'vision_unverified';
    };
    return section;
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    if (!window.TrenerOpponent) {
      root.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul analýzy soupeře' })));
      return;
    }
    const draw = () => {
      guard.reset(); // obrazovka se kreslí znovu, takže žádné neuložené úpravy už nejsou
      const career = app.requireCareer(root, 'Soupeři');
      if (!career) return;
      const all = listOpponents(app);
      if (!all.some((o) => o.id === selectedId)) selectedId = all.length ? all[0].id : null;
      const opp = all.find((o) => o.id === selectedId) || null;

      const newName = ui.input({ id: 'oppNew', maxlength: 80, placeholder: 'Jméno soupeře, např. Sparta Praha' });
      const create = async () => {
        const nm = newName.value.trim();
        if (!nm) return toast('Napiš jméno soupeře.');
        const saved = await app.store.put('opponent', { careerId: career.id, name: nm.slice(0, 80), fields: {}, plan: null });
        selectedId = saved.id;
        draw();
      };
      newName.addEventListener('keydown', (e) => e.key === 'Enter' && create());
      const picker = h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Soupeři' }),
        all.length
          ? h('div', { class: 'row' }, ui.field('Vybraný soupeř', ui.select(all.map((o) => [o.id, o.name]), selectedId, { id: 'oppSelect', onchange: (e) => ((selectedId = e.target.value), draw()) }), { grow: true, noMargin: true }))
          : h('p', { class: 'hint', text: 'Zatím žádný soupeř. Přidej prvního.' }),
        h('div', { class: 'row', style: 'margin-top:10px' }, ui.field('Nový soupeř', newName, { grow: true, noMargin: true }), h('button', { class: 'btn', id: 'oppCreate', type: 'button', text: 'Přidat soupeře', onclick: create }))
      );
      if (!opp) return root.replaceChildren(picker);

      const planBox = h('div', { id: 'oppPlan' });
      const steps = W.steps(STEPS);
      const planBtn = h('button', { class: 'btn primary', id: 'oppPlanBtn', type: 'button', text: opp.plan ? 'Připravit plán znovu' : 'Připravit předzápasový plán', disabled: !FM27.ai.available, onclick: () => runPlan(app, opp, planBox, steps, planBtn) });
      const stop = h('button', { class: 'btn', type: 'button', text: 'Zastavit', onclick: () => running && running.abort() });
      if (opp.plan) renderPlan(app, planBox, opp.plan, { passages: opp.planPassages || {}, observations: opp.planObservations || {} }, 'Uložený plán z ' + ui.fmtDateTime(opp.planAt));
      const planCard = h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Předzápasový plán' }),
        h('p', { class: 'lead', text: 'Konkrétně: jak soupeře napadat, kde získávat míč, kterou stranu využít, které prostory obsadit, koho omezit a jaké z toho plyne riziko. Vychází z profilu, z tvé soupisky a taktiky a z tvých knih.' }),
        h('div', { class: 'actions' }, planBtn, stop, h('span', { class: 'hint', text: FM27.ai.available ? '' : 'Bez Claude se plán připravit nedá.' })),
        steps.el,
        planBox
      );
      let editorSection = null;
      const applyFields = async (patch) => {
        const cur = app.store.draft(app.store.get('opponent', opp.id));
        cur.fields = cur.fields || {};
        for (const [k, v] of Object.entries(patch)) cur.fields[k] = { value: v, prov: 'vision_unverified' };
        await app.store.put('opponent', cur);
        if (editorSection) for (const [k, v] of Object.entries(patch)) editorSection.applyField(k, v);
        toast('Hodnota je použitá, označená jako neověřená.');
      };
      editorSection = editor(app, opp, draw);
      root.replaceChildren(picker, h('div', { class: 'coach-grid' }, h('div', null, editorSection, screenshotCard(app, opp, applyFields)), planCard));
    };
    const guard = ui.dirtyGuard(root, app, () => draw());
    draw();
    // vlastní zápisy překreslují samy, tady jen změny z druhého zařízení (a ty nesmí smazat rozepsané úpravy)
    app.watch(['opponent'], (e) => e && e.origin === 'remote' && guard.onRemote());
    app.onCleanup(() => running && running.abort());
  }

  FM27.screens.register({ id: 'soupere', hash: 'soupere', label: 'Analýza soupeře', order: 4, render });
})();
