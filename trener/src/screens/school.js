/* Škola taktiky, Trenér rozhodování a Osobní rozvoj (zadání § 9, § 10, etapa 7).
   Lekce se skládají z úryvků tvých knih. Princip z knihy je teorie obecného fotbalu; příklad z FM27 je vždy označený
   jako neověřený a říká, co si ověřit ve hře. Pokrok (hodnocení témat, obtížnost) se synchronizuje, texty lekcí ne. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;
  const W = FM27.widgets;
  const S = () => window.TrenerSchool;

  const LESSONS_KEY = 'fm27.lessons'; // jen v tomto zařízení: obsah vzniká z knih, které se nesynchronizují
  let selectedId = null;
  let running = null;
  const LEVEL_CS = { 1: 'začátečník', 2: 'středně pokročilý', 3: 'pokročilý' };
  const STEPS = { search: 'Hledám v knihách', ask: 'Skládám lekci', check: 'Kontroluji poctivost', repair: 'Opravuji podle kontroly' };
  const SC_STEPS = { search: 'Hledám v knihách', ask: 'Skládám scénář', check: 'Kontroluji poctivost', repair: 'Opravuji podle kontroly' };

  // ------------------------------------------------------------------ pokrok (synchronizovaný dokument `progress`)
  function loadProgress(app) {
    const doc = app.store.get('progress', 'progress');
    return doc && doc.v ? doc : S().newProgress();
  }
  async function saveProgress(app, progress) {
    return app.store.put('progress', Object.assign({}, progress, { id: 'progress' }));
  }

  const savedLessons = () => ui.lsGet(LESSONS_KEY, {});
  function saveLesson(id, entry) {
    const all = savedLessons();
    all[id] = entry;
    ui.lsSet(LESSONS_KEY, all);
  }

  // ------------------------------------------------------------------ knihy k tématu
  function passagesFor(queries, k) {
    const lib = FM27.library;
    if (!lib.size) return {};
    const hits = C.multiSearch(lib.index, queries, { k: k || 8, perBook: 3 });
    const ctx = {};
    for (const hit of hits) {
      const book = lib.bookById(hit.bookId);
      ctx[hit.id] = { id: hit.id, bookId: hit.bookId, title: book ? book.title : '?', where: book ? lib.whereLabel(book, hit) : '?', text: hit.text.slice(0, 900) };
    }
    W.snapPut(ctx);
    return ctx;
  }

  // ------------------------------------------------------------------ vykreslení lekce
  function lessonView(app, lesson, ctx, meta, onQuizDone) {
    const Sc = S();
    const box = h('div', { class: 'advice', id: 'lessonView' });
    box.append(W.claim(1, 'Princip', lesson.principle, ctx, app));

    const ex = lesson.fm27Example;
    box.append(
      W.sec(2, 'Příklad z FM27', ui.tierChip(ex.tier, 'neověřeno: příklad k vyzkoušení'), h('p', { text: ex.text }), W.refsRow(ex.refs, ctx, app), h('div', { class: 'hint' }, h('b', { text: 'Ověř si ve hře:' }), h('ul', { class: 'list' }, ex.verify.map((v) => h('li', { text: v })))))
    );

    const svgHost = h('div', { class: 'diagram', id: 'lessonDiagram', role: 'group' });
    svgHost.innerHTML = Sc.renderDiagramSvg(lesson.diagram, { width: 480 }); // SVG skládá modul a všechny texty z modelu v něm escapuje
    box.append(W.sec(3, 'Grafické znázornění', null, svgHost));

    box.append(W.sec(4, 'Konkrétní použití ve hře', null, h('p', { text: lesson.usage.text }), h('ol', null, lesson.usage.steps.map((s) => h('li', { text: s })))));
    box.append(W.sec(5, 'Nejčastější chyby', null, h('ul', null, lesson.mistakes.map((m) => h('li', { text: m })))));
    box.append(
      W.sec(6, 'Praktické cvičení', null, h('p', { text: lesson.exercise.task }), h('details', null, h('summary', { text: 'Nápověda' }), h('p', { text: lesson.exercise.hint })), h('details', null, h('summary', { text: 'Jak může vypadat řešení' }), h('p', { text: lesson.exercise.solutionOutline })))
    );

    // ověření znalostí
    const chosen = lesson.quiz.map(() => null);
    const resultBox = h('div', { id: 'quizResult', 'aria-live': 'polite' });
    const questions = lesson.quiz.map((q, i) =>
      h(
        'fieldset',
        { class: 'quiz-q', 'data-q': String(i) },
        h('legend', { text: `${i + 1}. ${q.q}` }),
        q.options.map((o, j) =>
          h('label', { class: 'checkline' }, h('input', { type: 'radio', name: `quiz-${i}`, value: String(j), id: `quiz-${i}-${j}`, onchange: () => (chosen[i] = j) }), h('span', { text: o }))
        )
      )
    );
    const submit = h('button', {
      class: 'btn primary',
      id: 'quizSubmit',
      type: 'button',
      text: 'Vyhodnotit odpovědi',
      onclick: async () => {
        const g = Sc.gradeQuiz(lesson.quiz, chosen);
        if (chosen.some((c) => c === null)) return toast('Odpověz na všechny otázky.');
        resultBox.replaceChildren(
          h('div', { class: 'banner ' + (g.score >= Sc.PASS_SCORE ? 'ok' : 'warn') }, h('b', { text: `Správně ${g.correct} z ${g.total} (${g.score} %)` }), h('span', { text: g.score >= Sc.PASS_SCORE ? 'Lekce je probraná.' : `Na probrání je potřeba aspoň ${Sc.PASS_SCORE} %. Projdi vysvětlení a zkus to znovu.` })),
          h('ul', { class: 'list' }, g.perQuestion.map((p, i) => h('li', { class: p.ok ? 'quiz-ok' : 'quiz-bad' }, `${i + 1}. ${p.ok ? 'správně' : 'špatně'}. ${p.explanation}`)))
        );
        submit.disabled = true;
        await onQuizDone(g);
      },
    });
    box.append(W.sec(7, 'Ověření znalostí', null, ...questions, h('div', { class: 'actions' }, submit), resultBox));
    if (meta && meta.note) box.prepend(h('div', { class: 'banner warn' }, h('span', { text: meta.note })));
    return box;
  }

  // ------------------------------------------------------------------ vytvoření lekce
  async function generateLesson(app, lessonDef, level, box, steps, button, redraw) {
    const ai = FM27.ai;
    const Sc = S();
    if (!ai.available) return toast('Claude není dostupný.');
    const ctl = new AbortController();
    running = ctl;
    button.disabled = true;
    box.replaceChildren();
    steps.reset(['search', 'ask', 'check']);
    try {
      steps.set('search', 'run');
      const ctx = passagesFor(Sc.lessonQueries(lessonDef), 8);
      const n = Object.keys(ctx).length;
      steps.set('search', n ? 'done' : 'skip', n ? `${n} ${ui.plural(n, 'úryvek', 'úryvky', 'úryvků')}` : 'knihovna nic nevrátila');
      const careerObs = FM27.context.observations(app, { memory: false });
      const careerContext = careerObs.length ? careerObs.map((o) => o.text).join('\n').slice(0, 1800) : '';
      const turns = Sc.buildLessonPrompt({ lesson: lessonDef, passages: Object.values(ctx), careerContext, level });
      const result = await ai.structured({
        turns,
        validate: (x) => Sc.validateLesson(x, { passages: new Set(Object.keys(ctx)) }),
        tier: 'default',
        signal: ctl.signal,
        purpose: 'lekce',
        onStep: (s, st, note) => steps.set(s, st, note),
      });
      if (result.status === 'ok') {
        saveLesson(lessonDef.id, { lesson: result.value, at: Date.now(), level, passages: Object.fromEntries(Object.entries(ctx).map(([id, p]) => [id, { id, title: p.title, where: p.where }])), fromBooks: n > 0 });
        redraw();
      } else box.append(W.failedCheckBanner(result.verdict, 'Lekce neprošla kontrolou poctivosti', () => generateLesson(app, lessonDef, level, box, steps, button, redraw)));
    } catch (e) {
      if (e && e.code === 'cancelled') toast('Zastaveno.');
      else box.append(W.errorBanner(ai.errorText(e), !(e && ai.NO_RETRY.includes(e.code)) ? () => generateLesson(app, lessonDef, level, box, steps, button, redraw) : null));
    } finally {
      running = null;
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------------ trenér rozhodování
  function scenarioCard(app, getProgress, setProgress) {
    const Sc = S();
    const out = h('div', { id: 'scenarioBox' });
    const steps = W.steps(SC_STEPS);
    const next = h('button', { class: 'btn primary', id: 'scenarioNext', type: 'button', text: 'Další scénář', disabled: !FM27.ai.available, onclick: () => load() });
    const status = h('p', { class: 'hint', id: 'scenarioStatus' });

    function showScenario(def, scenario, ctx) {
      const progress = getProgress();
      out.replaceChildren();
      let answered = false;
      const reveal = h('div', { id: 'scenarioReveal' });
      const optionNodes = scenario.options.map((o) =>
        h('button', {
          class: 'btn option',
          type: 'button',
          'data-option': o.id,
          text: o.text,
          onclick: async () => {
            if (answered) return;
            answered = true;
            const correct = o.id === scenario.best;
            for (const b of optionNodes) {
              b.disabled = true;
              if (b.getAttribute('data-option') === scenario.best) b.classList.add('best');
              else if (b === optionNodes.find((x) => x.getAttribute('data-option') === o.id)) b.classList.add('wrong');
            }
            const rated = Sc.recordDecision(progress, { scenarioId: def.id, topic: def.topic, difficulty: def.difficulty, correct, at: Date.now() });
            setProgress(rated);
            reveal.replaceChildren(
              h('div', { class: 'banner ' + (correct ? 'ok' : 'warn') }, h('b', { text: correct ? 'Tvoje volba odpovídá doporučenému postupu.' : 'Doporučený postup je jiný.' }), h('span', { text: `Doporučeno: ${scenario.options.find((x) => x.id === scenario.best).text}` })),
              h('div', { class: 'advice' }, W.claim(null, 'Proč', scenario.why, ctx, app), scenario.commonMistake ? W.sec(null, 'Častá chyba', null, h('p', { text: scenario.commonMistake })) : null, scenario.followUp ? W.sec(null, 'Co dál', null, h('p', { text: scenario.followUp })) : null),
              h('p', { class: 'hint', text: scenario.why.refs && scenario.why.refs.length ? '' : 'Vysvětlení nemá oporu v tvých knihách, ber ho jako odhad.' })
            );
            await saveProgress(app, rated);
          },
        })
      );
      out.append(h('div', { class: 'card inner' }, h('b', { text: `${def.title} (obtížnost ${def.difficulty} z 3)` }), h('p', { text: scenario.situation, id: 'scenarioSituation' }), h('p', { class: 'hint', text: 'Nejdřív vyber, co uděláš. Vysvětlení se ukáže až potom.' }), h('div', { class: 'options' }, optionNodes), reveal));
    }

    async function load() {
      const ai = FM27.ai;
      if (!ai.available) return toast('Claude není dostupný.');
      const progress = getProgress();
      const def = Sc.chooseScenario(progress, Sc.SCENARIOS, { now: Date.now(), rand: Math.random });
      if (!def) return toast('Žádný scénář k dispozici.');
      const lessonDef = Sc.lessonById(def.topic);
      const ctl = new AbortController();
      running = ctl;
      next.disabled = true;
      out.replaceChildren();
      steps.reset(['search', 'ask', 'check']);
      try {
        steps.set('search', 'run');
        const ctx = passagesFor(lessonDef ? Sc.lessonQueries(lessonDef) : [def.title], 6);
        steps.set('search', 'done', `${Object.keys(ctx).length} úryvků`);
        const careerObs = FM27.context.observations(app, { memory: false });
        const turns = Sc.buildScenarioPrompt({ scenario: def, difficulty: def.difficulty, passages: Object.values(ctx), careerContext: careerObs.map((o) => o.text).join('\n').slice(0, 1200) });
        const result = await ai.structured({
          turns,
          validate: (x) => Sc.validateScenario(x, { passages: new Set(Object.keys(ctx)) }),
          tier: 'default',
          signal: ctl.signal,
          purpose: 'scénář rozhodování',
          onStep: (s, st, note) => steps.set(s, st, note),
        });
        if (result.status === 'ok') showScenario(def, result.value, ctx);
        else out.append(W.failedCheckBanner(result.verdict, 'Scénář neprošel kontrolou poctivosti', load));
      } catch (e) {
        if (e && e.code === 'cancelled') toast('Zastaveno.');
        else out.append(W.errorBanner(ai.errorText(e), !(e && ai.NO_RETRY.includes(e.code)) ? load : null));
      } finally {
        running = null;
        next.disabled = !ai.available;
      }
    }

    return h('section', { class: 'card', id: 'scenarioCard' }, h('h2', { text: 'Trenér rozhodování' }), h('p', { class: 'lead', text: 'Dostaneš situaci ze zápasu a nejdřív sám vybereš, co uděláš. Teprve potom uvidíš doporučený postup a proč. Slabší témata a chyby se vracejí častěji a obtížnost se přizpůsobuje tvým výsledkům.' }), h('div', { class: 'actions' }, next, h('span', { class: 'hint', text: FM27.ai.available ? 'Každý scénář spotřebuje jedno volání Claude.' : 'Bez Claude se scénář sestavit nedá.' })), status, steps.el, out);
  }

  // ------------------------------------------------------------------ osobní rozvoj
  function progressCard(app, progress) {
    const Sc = S();
    const all = Sc.allLessons();
    const done = all.filter((l) => (progress.school.lessons[l.id] || {}).status === 'done').length;
    const rec = Sc.recommendNext(progress, { now: Date.now() });
    const groupRows = Sc.CURRICULUM.groups.map((g) => {
      const ls = g.lessons;
      const d = ls.filter((l) => (progress.school.lessons[l.id] || {}).status === 'done').length;
      const ratings = ls.map((l) => Sc.topicRating(progress, l.id));
      const avg = Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);
      return h('div', null, h('span', { text: `${g.id}: ${g.title}` }), h('span', { text: `${d} z ${ls.length} probráno, hodnocení ${avg} %` }));
    });
    const rulesOpen = h('details', null, h('summary', { text: 'Jak se počítá hodnocení a obtížnost' }), h('ul', { class: 'list' }, [
      `Lekce je probraná od ${Sc.PROGRESS_RULES.passScore} % správných odpovědí.`,
      `Hodnocení tématu začíná na ${Sc.PROGRESS_RULES.ratingStart} % a je klouzavý průměr výsledků (nejnovější váží ${Math.round(Sc.PROGRESS_RULES.ratingAlpha * 100)} %).`,
      `Obtížnost scénářů stoupne po ${Sc.PROGRESS_RULES.levelUpAfter} správných v řadě a klesne po ${Sc.PROGRESS_RULES.levelDownAfter} chybách v řadě.`,
      `Téma se doporučí k opakování, když hodnocení klesne pod ${Sc.PROGRESS_RULES.reviewRatingBelow} %, nebo když chyba zůstala ${Sc.PROGRESS_RULES.reviewAfterDays} dny bez nápravy.`,
    ].map((t) => h('li', { text: t }))));
    return h('section', { class: 'card', id: 'progressCard' }, h('h2', { text: 'Osobní rozvoj' }), h('p', { class: 'lead', id: 'progressNext', text: rec.reason }), h('div', { class: 'diag' }, h('div', null, h('span', { text: 'Probrané lekce' }), h('span', { text: `${done} z ${all.length}` })), h('div', null, h('span', { text: 'Rozhodnutí ve scénářích' }), h('span', { text: String(Object.values(progress.skills).reduce((a, s) => a + (s.seen || 0), 0)) })), ...groupRows), rec.reviewTopics && rec.reviewTopics.length ? h('p', { class: 'hint', text: 'K opakování: ' + rec.reviewTopics.map((id) => { const l = Sc.lessonById(id); return l ? `${l.title} (${l.id})` : id; }).join(', ') }) : null, rulesOpen);
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    if (!S() || !FM27.advice) {
      root.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul školy' })));
      return;
    }
    const Sc = S();
    const state = { progress: loadProgress(app) };
    const getProgress = () => state.progress;
    const setProgress = (p) => {
      state.progress = p;
      const card = $('#progressCard');
      if (card) card.replaceWith(progressCard(app, p));
    };

    const draw = () => {
      state.progress = loadProgress(app);
      const rec = Sc.recommendNext(state.progress, { now: Date.now() });
      if (!selectedId) selectedId = rec.lessonId || 'A1';
      const def = Sc.lessonById(selectedId);
      const stored = savedLessons()[selectedId];

      const list = h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Škola taktiky' }),
        h('p', { class: 'lead', text: 'Osnova od základů po pokročilou taktiku. Každou lekci složí trenér z úryvků tvých knih: princip, příklad z FM27 (neověřený, s pokyny k ověření), schéma, použití, chyby, cvičení a ověření znalostí.' }),
        ...Sc.CURRICULUM.groups.map((g) =>
          h('div', { class: 'group' }, h('h3', { text: `${g.id}. ${g.title}` }), h('div', { class: 'books', id: 'schoolList-' + g.id }, g.lessons.map((l) => {
            const pr = state.progress.school.lessons[l.id];
            return h('div', { class: 'book lesson-row' + (l.id === selectedId ? ' selected' : ''), 'data-id': l.id }, h('div', { class: 'meta' }, h('b', { text: `${l.id} ${l.title}` }), h('span', { class: 'chips' }, ui.chip('neutral', LEVEL_CS[l.level]), pr && pr.status === 'done' ? ui.chip('good', `probráno ${pr.bestScore} %`) : null, l.id === rec.lessonId ? ui.chip('accent', 'doporučeno') : null, savedLessons()[l.id] ? ui.chip('neutral', 'lekce složená') : null)), h('button', { class: 'btn small', type: 'button', text: l.id === selectedId ? 'Otevřeno' : 'Otevřít', onclick: () => ((selectedId = l.id), draw()) }));
          })))
        )
      );

      const lessonBox = h('div', { id: 'lessonBox' });
      const steps = W.steps(STEPS);
      const level = def.level;
      const genBtn = h('button', { class: 'btn primary', id: 'lessonGen', type: 'button', text: stored ? 'Složit lekci znovu' : 'Složit lekci z mých knih', disabled: !FM27.ai.available, onclick: () => generateLesson(app, def, level, lessonBox, steps, genBtn, draw) });
      if (stored) {
        const ctx = { passages: stored.passages || {}, observations: {} };
        const note = stored.fromBooks ? '' : 'Tahle lekce nevychází z tvých knih (knihovna k tématu nic nevrátila). Je to jen obecná znalost modelu, ber ji jako odhad.';
        lessonBox.append(
          lessonView(app, stored.lesson, ctx, { note }, async (g) => {
            const p = Sc.recordLessonResult(state.progress, def.id, { correct: g.correct, total: g.total, at: Date.now() });
            await saveProgress(app, p);
            setProgress(p);
            const row = $(`.lesson-row[data-id="${def.id}"] .chips`);
            if (row && g.score >= Sc.PASS_SCORE) row.append(ui.chip('good', `probráno ${g.score} %`));
          })
        );
      }
      const lessonCard = h('section', { class: 'card', id: 'lessonCard' }, h('h2', { text: `${def.id} ${def.title}` }), h('p', { class: 'hint', text: `Úroveň: ${LEVEL_CS[def.level]}. Předpoklady: ${def.prerequisites.length ? def.prerequisites.join(', ') : 'žádné'}.` }), h('div', { class: 'actions' }, genBtn, h('button', { class: 'btn', type: 'button', text: 'Zastavit', onclick: () => running && running.abort() }), h('span', { class: 'hint', text: FM27.ai.available ? 'Složení lekce spotřebuje jedno až dvě volání Claude.' : 'Bez Claude se lekce sestavit nedá.' })), steps.el, lessonBox);

      root.replaceChildren(h('div', { class: 'coach-grid' }, h('div', null, progressCard(app, state.progress), list), h('div', null, lessonCard, scenarioCard(app, getProgress, setProgress))));
    };
    draw();
    app.watch(['progress'], (e) => e && e.origin === 'remote' && draw());
    app.onCleanup(() => running && running.abort());
  }

  FM27.screens.register({ id: 'skola', hash: 'skola', label: 'Škola taktiky', order: 6, render });
})();
