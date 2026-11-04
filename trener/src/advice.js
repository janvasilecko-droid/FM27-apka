/* Rada trenéra jako samostatná služba (bez pevných prvků stránky): zeptá se, prohledá knihy, zkontroluje poctivost,
   jednou opraví a vykreslí desetibodový výsledek do libovolného prvku. Používá ji Osobní trenér i Live Coach.
   Pravidla, co v radě smí stát, jsou v core.js (validateAdvice10). */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, toast } = ui;
  const W = FM27.widgets;

  const advice = (FM27.advice = {});

  advice.STEP_LABELS = {
    plan: 'Plánuji hledání v knihách',
    search: 'Hledám v knihovně',
    advice: 'Skládám radu',
    check: 'Kontroluji poctivost',
    repair: 'Opravuji radu podle kontroly',
  };

  // ------------------------------------------------------------------ dotaz na radu
  /** o: {question, observations: [{id,label,minute,text}], images: File[], deep, previousAdvice, signal, onStep(id, cls, note), includeCareer (výchozí true)}
      Vrací {status: 'ok'|'needs_more_info'|'error', advice, verdict, ctx, message, retry}. Výjimky kromě zastavení nevyhazuje. */
  advice.ask = async function ask(app, o) {
    const ai = FM27.ai;
    const step = o.onStep || (() => {});
    const notes = [];
    if (!ai.available) return { status: 'error', message: 'Claude není dostupný.', retry: false, ctx: { notes } };
    let observations;
    try {
      observations = C.normalizeObservations((o.observations || []).map((x) => ({ ...x })));
    } catch (e) {
      return { status: 'error', message: e.message, retry: false, ctx: { notes } };
    }
    const obsMap = {};
    for (const x of observations) obsMap[x.id] = { label: x.label, text: x.text };
    if (o.includeCareer !== false) {
      for (const x of FM27.context.observations(FM27.app)) {
        if (obsMap[x.id]) continue;
        observations.push(x);
        obsMap[x.id] = { label: x.label, text: x.text };
      }
    }
    const images = ai.imagesSupported && o.images ? o.images.slice() : [];
    const imageIds = images.map((_, i) => `img-${i + 1}`);
    for (const id of imageIds) {
      observations.push({ id, label: 'vision_unverified', minute: null, text: '(obrázek předaný modelu)' });
      obsMap[id] = { label: 'vision_unverified', text: '(obrázek předaný modelu)' };
    }
    const question = String(o.question || '').trim();
    if (!question && !observations.length) return { status: 'error', message: 'Napiš, co řešíš, nebo přidej pozorování.', retry: false, ctx: { notes } };

    try {
      // 1) plán hledání, 2) hledání v knihovně
      const lib = FM27.library;
      let hits = [];
      let queries = [];
      if (lib.size) {
        step('plan', 'run', 'při prvním použití potvrď okno Claude');
        let raw = null;
        try {
          raw = await ai.json(C.buildPlannerPrompt(question, observations, lib.languages()), { modelTier: 'quick', signal: o.signal, purpose: 'plán hledání' });
        } catch (e) {
          if (e && (e.code === 'cancelled' || ai.NO_RETRY.includes(e.code))) throw e;
          notes.push('Plán hledání se nepovedl, hledal jsem podle tvého zadání.');
        }
        const fallback = [question, ...observations.map((x) => x.text)].join(' ').slice(0, 300);
        queries = C.sanitizeQueries(raw, fallback);
        step('plan', 'done', `${queries.length} ${ui.plural(queries.length, 'dotaz', 'dotazy', 'dotazů')}`);
        step('search', 'run');
        hits = C.multiSearch(lib.index, queries, { k: 10, perBook: 3 });
        step('search', 'done', `${hits.length} ${ui.plural(hits.length, 'úryvek', 'úryvky', 'úryvků')}`);
      } else {
        step('plan', 'skip', 'knihovna je prázdná');
        step('search', 'skip');
        notes.push('Knihovna je prázdná, rada nevychází z knih.');
      }
      const passageCtx = {};
      for (const hit of hits) {
        const book = lib.bookById(hit.bookId);
        passageCtx[hit.id] = { id: hit.id, bookId: hit.bookId, title: book ? book.title : '?', where: book ? lib.whereLabel(book, hit) : '?', text: hit.text.slice(0, 1000) };
      }
      W.snapPut(passageCtx);

      // 3) rada, 4) kontrola, 5) jedno opravné kolo
      step('advice', 'run', 'může trvat desítky vteřin');
      const turns = C.buildAdviceTurns({ question, observations, passages: Object.values(passageCtx), sourcesDigest: app.registry.digest(), previousAdvice: o.previousAdvice || '', imageIds });
      const result = await ai.structured({
        turns,
        validate: (x) => C.validateAdvice10(x, { observations: obsMap, registry: app.registry, passages: new Set(Object.keys(passageCtx)) }),
        tier: o.deep ? 'complex' : 'default',
        images,
        signal: o.signal,
        purpose: 'rada',
        onStep(s, state, note) {
          step(s === 'ask' ? 'advice' : s, state, note);
        },
      });
      const ctx = { passages: passageCtx, observations: obsMap, queries, notes };
      if (result.status === 'ok') return { status: 'ok', advice: result.value, verdict: result.verdict, ctx };
      return { status: 'needs_more_info', verdict: result.verdict, ctx };
    } catch (e) {
      if (e && e.code === 'cancelled') return { status: 'cancelled', ctx: { notes } };
      return { status: 'error', message: ai.errorText(e), retry: !(e && ai.NO_RETRY.includes(e.code)), ctx: { notes } };
    }
  };

  /** Uloží radu do historie (synchronizuje se, bez textů knih). */
  advice.save = async function save(app, entry) {
    const light = {};
    for (const [id, p] of Object.entries(entry.ctx.passages || {})) light[id] = { id, title: p.title, where: p.where };
    const career = app.career();
    const saved = await app.store.put('advice', {
      careerId: career ? career.id : null,
      at: Date.now(),
      question: entry.question,
      advice: entry.advice,
      passages: light,
      observations: entry.ctx.observations || {},
      warnings: entry.verdict.warnings || [],
      needs_verification: !!entry.verdict.needs_verification,
      source: entry.source || 'trener',
    });
    const all = app.store.list('advice').sort((a, b) => b.at - a.at);
    for (const old of all.slice(40)) await app.store.remove('advice', old.id);
    return saved;
  };

  /** Krátká mluvená verze rady: diagnóza, první změna a hlavní riziko. Čtení trvá pár vteřin, ne minutu. */
  advice.spokenSummary = function spokenSummary(a) {
    const item = a.change.items[0];
    const parts = [`Diagnóza: ${a.diagnosis.text}`, item ? `Navrhuji změnu: ${item.player}, ${item.setting}, z ${item.from} na ${item.to}.` : '', a.risk.items[0] ? `Pozor: ${a.risk.items[0]}.` : ''];
    const raw = parts.filter(Boolean).join(' ');
    return window.TrenerAlerts ? window.TrenerAlerts.shortenForSpeech(raw, 320) : raw.slice(0, 320);
  };

  // ------------------------------------------------------------------ vykreslení
  /** Vykreslí výsledek do `container`. opts: {onRetry, onFollowUp(previousAdviceText), changeAction(item, index) → uzel|null, scroll} */
  advice.render = function render(app, container, res, opts) {
    const o = opts || {};
    container.replaceChildren();
    const ctx = res.ctx || {};
    if (res.status === 'cancelled') return;
    if (res.status === 'error') {
      container.append(h('div', { class: 'banner bad' }, h('b', { text: 'Rada se nepovedla' }), h('span', { text: res.message }), res.retry && o.onRetry ? W.retryButton(o.onRetry) : null));
      return;
    }
    if (res.status === 'needs_more_info') {
      container.append(W.failedCheckBanner(res.verdict, 'Trenér nedodal radu, která by prošla kontrolou poctivosti', o.onRetry));
      return;
    }
    const a = res.advice;
    const verdict = res.verdict;
    const banner = h('div', { class: 'banner ok' }, h('b', { text: 'Rada prošla kontrolou poctivosti' }));
    const notes = [...(ctx.notes || []), ...verdict.warnings.filter((w) => !(verdict.needs_verification && /nejsou ověřené ve hře/.test(w)))];
    if (verdict.needs_verification) banner.append(h('p', { text: 'Názvy nastavení a cesty v menu FM27 jsou neověřené. Než změnu provedeš, ověř je ve hře (viz bod 10).' }));
    if (notes.length) banner.append(h('ul', { class: 'list' }, notes.map((n) => h('li', { text: W.humanize(n) }))));
    if (ctx.queries && ctx.queries.length) banner.append(h('p', { class: 'hint', text: 'Hledáno: ' + ctx.queries.map((q) => (q.length > 70 ? q.slice(0, 67) + '…' : q)).join(' · ') }));
    container.append(banner);

    const list = h('div', { class: 'advice' });
    const tiered = (no, title, key) => W.claim(no, title, a[key], ctx, app);
    list.append(tiered(1, 'Kontext', 'context'), tiered(2, 'Důkaz A', 'evidenceA'), tiered(3, 'Důkaz B', 'evidenceB'));
    list.append(W.sec(4, 'Jistota', h('span', { class: 'chip t-' + (a.confidence.level === 'high' ? 'observed' : a.confidence.level === 'medium' ? 'inferred' : 'unknown'), text: C.LEVEL_CS[a.confidence.level] }), h('p', { text: a.confidence.text })));
    list.append(tiered(5, 'Diagnóza', 'diagnosis'));

    const changeSec = W.sec(6, 'Co změnit a kde', null, h('p', { text: a.change.text }));
    changeSec.classList.add('key');
    a.change.items.forEach((item, i) => {
      changeSec.append(
        h(
          'div',
          { class: 'change-item' },
          h('div', { class: 'what' }, `${item.player}: ${item.setting}`),
          h('div', null, `z „${item.from}“ `, h('span', { class: 'arrow', text: '→' }), ` na „${item.to}“`),
          h('div', { class: 'hint' }, 'Kde ve hře: ', ui.tierChip(item.where_tier)),
          h('ol', null, item.where.map((s) => h('li', { text: s }))),
          W.refsRow(item.refs, ctx, app),
          o.changeAction ? o.changeAction(item, i) : null
        )
      );
    });
    list.append(changeSec);

    const minutes = a.measure.recheck_after_minutes;
    list.append(W.sec(7, 'Jak změřit', null, h('p', { text: a.measure.text }), h('ul', null, a.measure.checks.map((c) => h('li', { text: c }))), h('p', { class: 'hint', text: minutes ? `Znovu vyhodnotit za ${minutes} min.` : 'Čas dalšího vyhodnocení není určen.' })));
    list.append(W.sec(8, 'Rizika', null, h('p', { text: a.risk.text }), h('ul', null, a.risk.items.map((c) => h('li', { text: c })))));
    list.append(W.sec(9, 'Jak změnu vrátit zpět', null, h('p', { text: a.reversal.text })));

    const unknown = a.unknown;
    const answers = [];
    const unknownSec = W.sec(10, 'Co trenér neví', ui.tierChip('unknown'), h('p', { text: unknown.text }));
    if (unknown.items.length) {
      const form = h('div', { class: 'followup' });
      for (const item of unknown.items) {
        const input = h('input', { type: 'text', maxlength: 400, 'aria-label': 'Doplnění: ' + item, placeholder: 'Tvoje odpověď (nepovinné)' });
        answers.push([item, input]);
        form.append(h('label', { text: item }), input);
      }
      if (o.onFollowUp) {
        form.append(
          h('div', { class: 'actions' }, h('button', {
            class: 'btn',
            type: 'button',
            text: 'Poradit znovu s doplněním',
            onclick: () => {
              const given = answers.filter(([, input]) => input.value.trim()).map(([item, input]) => `${item} → ${input.value.trim()}`);
              if (!given.length) return toast('Doplň aspoň jednu odpověď.');
              o.onFollowUp(given, C.adviceToText(a));
            },
          }))
        );
      }
      unknownSec.append(form);
    }
    list.append(unknownSec);
    container.append(list);
    const speakBtn =
      FM27.voice && FM27.voice.available()
        ? h('button', {
            class: 'btn small',
            type: 'button',
            'data-act': 'speak',
            text: 'Přečíst radu nahlas',
            onclick: () => {
              const v = app.settings().voice;
              if (v.quiet) return toast('Tichý režim je zapnutý. Vypni ho v Nastavení, ať trenér mluví.');
              FM27.voice.say(advice.spokenSummary(a), v);
            },
          })
        : null;
    container.append(h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Kopírovat radu', onclick: () => ui.copyText(C.adviceToText(a), 'Rada je zkopírovaná.') }), speakBtn));
    if (o.scroll !== false) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
})();
