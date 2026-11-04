/* Osobní trenér: ptáš se, trenér prohledá tvoje knihy, poradí desetibodově a poctivě řekne, co neví.
   Průběh volání a vykreslení rady je v advice.js (sdílí ho Live Coach); tady je formulář, pozorování a historie. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;
  const W = FM27.widgets;

  // ------------------------------------------------------------------ rozpracovaný dotaz (přežije přepnutí sekce)
  const draft = { question: '', obs: [], images: [], deep: null, spoken: false };
  let run = null; // {ctl} běžící dotaz

  const OBS_LABEL_CS = { user_entered: 'moje poznámka', screenshot_verified: 'ověřený screenshot', ocr_unverified: 'strojově vyčteno', heuristic_coach: 'výpočet aplikace', vision_unverified: 'přečteno z obrázku' };

  // ------------------------------------------------------------------ pozorování
  function renderObs() {
    const list = $('#obsList');
    if (!list) return;
    list.replaceChildren();
    for (const o of draft.obs) {
      list.append(
        h(
          'li',
          { class: 'obs-item' },
          h('span', { class: 'mono', text: o.id }),
          h('span', { class: 't' }, h('span', { class: 'chip t-' + C.LABEL_TO_TIER[o.label], text: OBS_LABEL_CS[o.label] || o.label }), ' ', o.minute !== null ? `${o.minute}'. ` : '', o.text),
          h('button', { type: 'button', 'aria-label': 'Odebrat pozorování ' + o.id, onclick: () => ((draft.obs = draft.obs.filter((x) => x !== o)), renderObs()), text: '×' })
        )
      );
    }
  }
  function nextObsId(prefix) {
    let n = 1;
    while (draft.obs.some((o) => o.id === `${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  }
  function addObservation(label, minute, text, prefix) {
    text = String(text || '').trim();
    if (!text) return false;
    if (draft.obs.length >= 30) {
      toast('Víc než 30 pozorování se nevejde.');
      return false;
    }
    draft.obs.push({ id: nextObsId(prefix || 'obs'), label, minute: Number.isInteger(minute) ? minute : null, text: text.slice(0, 400) });
    renderObs();
    return true;
  }
  FM27.coachAddObservation = addObservation;

  // ------------------------------------------------------------------ průběh
  const stepsUi = W.steps(FM27.advice.STEP_LABELS);
  function setBusy(on) {
    const ask = $('#askBtn');
    if (ask) ask.disabled = on || !FM27.ai.available;
    const stop = $('#stopBtn');
    if (stop) stop.hidden = !on;
  }

  async function runCoach(app, opts) {
    opts = opts || {};
    if (!FM27.ai.available) return toast('Claude není dostupný.');
    const question = ($('#question') && $('#question').value.trim()) || draft.question.trim();
    draft.question = question;
    const ctl = new AbortController();
    run = { ctl };
    setBusy(true);
    $('#resultEmpty').hidden = true;
    $('#result').replaceChildren();
    stepsUi.reset(['plan', 'search', 'advice', 'check']);
    const res = await FM27.advice.ask(app, {
      question,
      observations: draft.obs,
      images: draft.images,
      deep: $('#deepMode').checked,
      previousAdvice: opts.previousAdvice,
      signal: ctl.signal,
      onStep: (id, cls, note) => stepsUi.set(id, cls, note),
    });
    run = null;
    setBusy(false);
    if (res.status === 'cancelled') {
      stepsUi.set('advice', 'fail', 'zastaveno');
      toast('Zastaveno.');
      return;
    }
    if (res.status === 'error' && !res.retry && /Napiš, co řešíš/.test(res.message || '')) {
      $('#resultEmpty').hidden = false;
      stepsUi.el.hidden = true;
      return toast(res.message);
    }
    if (res.status === 'error') stepsUi.set('advice', 'fail');
    if (res.status === 'ok') {
      await FM27.advice.save(app, { question, advice: res.advice, ctx: res.ctx, verdict: res.verdict, source: 'trener' });
      if (draft.spoken && FM27.voice.available() && !app.settings().voice.quiet) FM27.voice.say(FM27.advice.spokenSummary(res.advice), app.settings().voice);
    }
    draft.spoken = false;
    FM27.advice.render(app, $('#result'), res, {
      onRetry: () => runCoach(app),
      onFollowUp: (given, previousText) => {
        for (const g of given) addObservation('user_entered', null, g, 'dop');
        runCoach(app, { previousAdvice: previousText });
      },
    });
  }

  // ------------------------------------------------------------------ historie rad
  /** Rady z první verze stránky (localStorage) se jednou přenesou do úložiště, aby se neztratily. */
  async function migrateOldHistory(app) {
    if (ui.lsGet('fm27.historyMigrated', false)) return;
    const old = ui.lsGet('fm27.history', []);
    if (Array.isArray(old)) {
      for (const e of old.slice(0, 15)) {
        if (!e || !e.advice) continue;
        const light = {};
        for (const [id, p] of Object.entries(e.passages || {})) light[id] = { id, title: p.title, where: p.where };
        if (e.passages) W.snapPut(e.passages);
        await app.store.put('advice', { careerId: null, at: e.at || Date.now(), question: e.question || '', advice: e.advice, passages: light, observations: e.observations || {}, warnings: e.warnings || [], needs_verification: !!e.needs_verification, source: 'trener' });
      }
    }
    ui.lsSet('fm27.historyMigrated', true);
  }

  function renderHistory(app) {
    const ul = $('#historyList');
    if (!ul) return;
    const career = app.career();
    const list = app.store.list('advice', (a) => !career || a.careerId === career.id || a.careerId === null).sort((a, b) => b.at - a.at).slice(0, 15);
    ul.replaceChildren();
    for (const entry of list) {
      ul.append(
        h(
          'li',
          null,
          h('span', { class: 'q', text: entry.question || '(bez dotazu)' }),
          h('span', { class: 'd', text: ui.fmtDateTime(entry.at) }),
          h('button', {
            class: 'btn small',
            type: 'button',
            text: 'Otevřít',
            onclick: () => {
              $('#resultEmpty').hidden = true;
              FM27.advice.render(app, $('#result'), { status: 'ok', advice: entry.advice, verdict: { warnings: entry.warnings || [], needs_verification: !!entry.needs_verification }, ctx: { passages: entry.passages || {}, observations: entry.observations || {}, notes: ['Uložená rada z ' + new Date(entry.at).toLocaleString('cs-CZ')] } }, {});
            },
          })
        )
      );
    }
    $('#historyEmpty').hidden = list.length > 0;
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    const ai = FM27.ai;
    const limits = ai.limitsInfo;
    if (draft.deep === null) draft.deep = !!(app.settings().coach.deep || ui.lsGet('fm27.deep', false));

    const question = h('textarea', { id: 'question', placeholder: 'Např.: Útočník je od 25. minuty bez podpory a soupeř nás přehrává ve středu hřiště.' });
    question.value = draft.question;
    question.addEventListener('input', () => (draft.question = question.value));

    const obsLabel = ui.select(
      [
        ['user_entered', 'Moje poznámka'],
        ['screenshot_verified', 'Ověřený screenshot (popsal jsem ho já)'],
        ['ocr_unverified', 'Strojově vyčteno ze screenshotu'],
      ],
      'user_entered',
      { id: 'obsLabel' }
    );
    const obsMinute = ui.input({ id: 'obsMinute', type: 'number', min: 0, max: 130, inputmode: 'numeric', placeholder: '–' });
    const obsText = ui.input({ id: 'obsText', maxlength: 400, placeholder: 'Např.: střely 11:3, držení míče 62 %' });
    const addFromForm = () => {
      const raw = obsMinute.value.trim();
      if (addObservation(obsLabel.value, raw === '' ? null : Number(raw), obsText.value)) {
        obsText.value = '';
        obsMinute.value = '';
        obsText.focus();
      }
    };
    obsText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addFromForm();
      }
    });

    const imageInfo = h('p', { class: 'hint', id: 'imageInfo' });
    const imageText = (names) => (names.length ? `Vybráno: ${names.join(', ')}. Pošle se jen po stisknutí „Poradit“. Co z něj Claude přečte, bere trenér jako neověřené.` : 'Obrázek se pošle ke Claude jen po stisknutí „Poradit“. Co z něj Claude přečte, bere trenér jako neověřené.');
    imageInfo.textContent = imageText(draft.images.map((f) => f.name));
    const imageInput = h('input', { type: 'file', id: 'imageInput', accept: limits && limits.images ? limits.images.mediaTypes.join(',') : 'image/png,image/jpeg,image/webp', multiple: true });
    imageInput.addEventListener('change', () => {
      const files = [...imageInput.files];
      const max = (limits && limits.images && limits.images.maxCount) || 0;
      draft.images = files.slice(0, max);
      imageInfo.textContent = imageText(draft.images.map((f) => f.name));
      if (files.length > draft.images.length) toast(`Najednou jde poslat nejvýš ${max} obrázků.`);
    });
    const imageField = h('div', { class: 'field', id: 'imageField', hidden: !ai.imagesSupported }, h('label', { for: 'imageInput', text: 'Screenshot (volitelné)' }), imageInput, imageInfo);

    const deepBox = h('input', { type: 'checkbox', id: 'deepMode', checked: draft.deep });
    deepBox.addEventListener('change', () => {
      draft.deep = deepBox.checked;
      app.updateSettings({ coach: { deep: deepBox.checked } }).catch(() => {});
    });

    // Hlasový vstup: jen v samostatné verzi (stránka v Claude mikrofon nepouští). Rozpoznání řeči zajišťuje prohlížeč.
    let listening = null;
    const mic = app.standalone && FM27.voice && FM27.voice.recognitionAvailable()
      ? h('button', {
          class: 'btn',
          id: 'micBtn',
          type: 'button',
          text: 'Mluvit',
          onclick: () => {
            if (listening) {
              listening.stop();
              return;
            }
            mic.textContent = 'Poslouchám… (stiskni pro zastavení)';
            listening = FM27.voice.listen({
              onResult: (t) => {
                question.value = t;
                draft.question = t;
                draft.spoken = true;
              },
              onError: (code) => toast(code === 'not-allowed' ? 'Mikrofon jsi nepovolil.' : 'Hlas se nepodařilo rozpoznat (' + code + ').'),
              onEnd: () => {
                listening = null;
                mic.textContent = 'Mluvit';
              },
            });
          },
        })
      : null;
    const askBtn = h('button', { class: 'btn primary', id: 'askBtn', type: 'button', text: 'Poradit', disabled: !ai.available, onclick: () => runCoach(app) });
    const stopBtn = h('button', { class: 'btn', id: 'stopBtn', type: 'button', text: 'Zastavit', hidden: true, onclick: () => run && run.ctl.abort() });
    const hint = ai.available ? (ai.kind === 'claude-sample' ? 'Při prvním použití tě Claude požádá o povolení.' : 'Volání jde přes tvůj vlastní klíč.') : 'Tahle stránka nemá přístup ke Claude. Otevři ji v aplikaci Claude nebo na claude.ai, případně v nastavení zadej vlastní klíč.';

    const career = app.career();
    const ctxNote = h('p', { class: 'hint', id: 'ctxNote', text: career ? FM27.context.describe(app) : 'Bez kariéry trenér nezná tvůj tým ani taktiku. Založ ji nahoře a vyplň Můj tým a Moje taktiky.' });

    const left = h(
      'div',
      null,
      h(
        'div',
        { class: 'card' },
        h('h2', { text: 'Co řešíš?' }),
        h('p', { class: 'lead', text: 'Popiš, co se ve hře děje. Trenér prohledá tvoje knihy, poradí a výslovně řekne, co neví.' }),
        ui.field('Problém nebo otázka', question),
        ctxNote,
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label', text: 'Pozorování: jen to, co jsi opravdu viděl' }),
          h('div', { class: 'row' }, ui.field('Původ', obsLabel, { noMargin: true }), ui.field('Minuta', obsMinute, { noMargin: true, width: '92px' }), ui.field('Co jsi viděl', obsText, { noMargin: true, grow: true }), h('button', { class: 'btn', id: 'obsAdd', type: 'button', text: 'Přidat', onclick: addFromForm })),
          h('ul', { class: 'obs-list', id: 'obsList' }),
          h('p', { class: 'hint', text: 'Trenér z pozorování dělá důkazy. Strojově vyčtený text bere jen jako odhad, ne jako fakt.' })
        ),
        imageField,
        h('label', { class: 'checkline' }, deepBox, h('span', { text: 'Důkladný režim: pomalejší a spotřebuje víc tvého limitu Claude, hodí se u těžkých rozhodnutí.' })),
        h('div', { class: 'actions' }, askBtn, mic, stopBtn, h('span', { class: 'hint', id: 'askHint', text: hint })),
        (stepsUi.el.id = 'steps', stepsUi.el)
      ),
      h('div', { class: 'card' }, h('h3', { text: 'Historie rad' }), h('ul', { class: 'history', id: 'historyList' }), h('p', { class: 'hint', id: 'historyEmpty', text: 'Zatím nic. Rady se ukládají ke kariéře a synchronizují se mezi zařízeními (bez textů knih).' }))
    );

    const right = h(
      'div',
      { id: 'resultCol', 'aria-live': 'polite' },
      h(
        'div',
        { class: 'card', id: 'resultEmpty' },
        h('h2', { text: 'Rada se zobrazí tady' }),
        h('p', { class: 'lead', text: 'Každá rada má deset částí: kontext, dva důkazy, jistotu, diagnózu, konkrétní změnu, jak ji změřit, rizika, jak ji vrátit a co trenér neví. U každého tvrzení uvidíš, odkud je.' }),
        h(
          'ul',
          { class: 'list' },
          h('li', null, h('span', { class: 'chip t-observed', text: 'pozorováno' }), ' viděl jsi to na ověřeném screenshotu'),
          h('li', null, h('span', { class: 'chip t-user_entered', text: 'zadal uživatel' }), ' tvoje slova'),
          h('li', null, h('span', { class: 'chip t-inferred', text: 'odhad' }), ' strojové čtení, výpočet aplikace nebo úvaha, neověřeno'),
          h('li', null, h('span', { class: 'chip t-unknown', text: 'neznámé' }), ' trenér to neví a řekne, co ověřit')
        )
      ),
      h('div', { id: 'result' })
    );

    stepsUi.el.hidden = true;
    stepsUi.el.replaceChildren();
    root.replaceChildren(h('div', { class: 'coach-grid' }, left, right));
    renderObs();
    migrateOldHistory(app)
      .catch(() => {})
      .then(() => renderHistory(app));
    app.watch(['advice'], () => renderHistory(app));
  }

  FM27.screens.register({ id: 'trener', hash: 'trener', label: 'Osobní trenér', order: 8, render });
})();
