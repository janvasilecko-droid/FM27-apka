/* LIVE COACH (zadání § 2): sleduje zápas po snímcích, skládá časovou osu, hlídá problémy a po změně ukáže, co se stalo.
   Ve stránce v Claude se nesmí zapnout sdílení obrazovky, takže se snímky vkládají (Ctrl+V), nahrají nebo vyfotí;
   v samostatné verzi jde obrazovku sdílet. Vše přečtené z obrazu je neověřené, dokud to uživatel nepotvrdí. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;
  const W = FM27.widgets;
  const A = () => window.TrenerAnalysis;

  const PROV_CHIP = { vision_unverified: ['inferred', 'přečteno z obrázku, neověřeno'], screenshot_verified: ['observed', 'ověřeno tebou podle snímku'], user_entered: ['user_entered', 'zadal jsi ručně'] };
  const VERDICT_CS = { higher: 'vyšší', lower: 'nižší', similar: 'podobné' };
  const STAT_FIELDS = [['possession', 'Držení míče (%)'], ['shots', 'Střely'], ['shotsOnTarget', 'Střely na bránu'], ['xg', 'xG']];
  let adviceCtl = null;

  const num = (v) => (v === null || v === undefined ? '–' : String(v).replace('.', ','));
  const sideLabel = (s) => (s === 'home' ? 'domácí' : s === 'away' ? 'hosté' : '?');

  // ------------------------------------------------------------------ nový zápas
  function setupCard(app, redraw) {
    const career = app.career();
    const opponents = app.store.list('opponent', (o) => o.careerId === career.id);
    const opp = ui.input({ id: 'liveOpp', maxlength: 80, placeholder: 'Např. Sparta Praha', list: 'liveOppList' });
    const comp = ui.input({ id: 'liveComp', maxlength: 80, value: career.competition || '' });
    const side = ui.select([['home', 'Hraju doma (jsem domácí)'], ['away', 'Hraju venku (jsem host)']], 'home', { id: 'liveSide' });
    const msg = h('p', { class: 'hint', id: 'liveSetupMsg' });
    const resumable = app.store.list('match', (m) => m.careerId === career.id && m.status === 'live');
    return h(
      'section',
      { class: 'card' },
      h('h2', { text: 'Nový zápas' }),
      h('p', { class: 'lead', text: 'Před zápasem řekni, s kým hraješ a jestli doma, nebo venku (bez toho nejde poznat, které statistiky jsou tvoje). Pak během zápasu vkládej snímky obrazovky a trenér z nich skládá průběh.' }),
      h('datalist', { id: 'liveOppList' }, opponents.map((o) => h('option', { value: o.name }))),
      h('div', { class: 'row' }, ui.field('Soupeř', opp, { grow: true }), ui.field('Soutěž (volitelné)', comp, { grow: true }), ui.field('Strana', side, { width: '230px' })),
      h('div', { class: 'actions' }, h('button', {
        class: 'btn primary',
        id: 'liveStart',
        type: 'button',
        text: 'Začít sledovat zápas',
        onclick: async () => {
          try {
            await FM27.live.createMatch(app, { opponent: opp.value, competition: comp.value, mySide: side.value });
            redraw();
          } catch (e) {
            msg.textContent = e.message || String(e);
          }
        },
      })),
      msg,
      resumable.length
        ? h('div', null, h('h3', { text: 'Rozehrané zápasy', style: 'margin-top:16px' }), h('div', { class: 'books' }, resumable.map((m) => h('div', { class: 'book' }, h('div', { class: 'meta' }, h('b', { text: `Soupeř: ${m.opponent}` }), h('span', { text: `${sideLabel(m.mySide)}, ${m.timeline.length} snímků, začátek ${ui.fmtDateTime(m.startedAt)}` })), h('button', { class: 'btn small', type: 'button', text: 'Pokračovat', onclick: () => (FM27.live.begin(app, m.id), redraw()) })))))
        : null
    );
  }

  // ------------------------------------------------------------------ jedno zjištění ze snímku
  function statLine(s) {
    const part = (side) => {
      const x = s.stats[side];
      return [x.possession !== null ? `${num(x.possession)} %` : null, x.shots !== null ? `${num(x.shots)} stř.` : null, x.shotsOnTarget !== null ? `${num(x.shotsOnTarget)} na br.` : null, x.xg !== null ? `xG ${num(x.xg)}` : null].filter(Boolean).join(', ') || 'bez statistik';
    };
    return `domácí: ${part('home')} | hosté: ${part('away')}`;
  }

  function snapshotForm(app, snap, onSave, prefix) {
    const P = prefix || 'lv';
    const f = (id, label, value, width) => ui.field(label, ui.input({ id, type: 'number', step: 'any', inputmode: 'decimal', value: value === null || value === undefined ? '' : value }), { width: width || '110px', noMargin: true });
    const minute = f(P + 'Minute', 'Minuta', snap && snap.minute);
    const sh = f(P + 'ScoreH', 'Skóre domácí', snap && snap.score ? snap.score.home : '');
    const sa = f(P + 'ScoreA', 'Skóre hosté', snap && snap.score ? snap.score.away : '');
    const fields = {};
    const rows = ['home', 'away'].map((side) =>
      h('div', { class: 'row', style: 'margin-top:8px' }, h('b', { text: sideLabel(side), style: 'width:64px;flex:none;align-self:center' }), ...STAT_FIELDS.map(([k, label]) => ((fields[side + k] = f(`${P}-${side}-${k}`, label, snap ? snap.stats[side][k] : '', '130px')), fields[side + k])))
    );
    const msg = h('p', { class: 'hint', id: P + 'Msg' });
    const read = (el) => {
      const v = el.querySelector('input').value.trim();
      return v === '' ? null : Number(String(v).replace(',', '.'));
    };
    const body = h('div', null, h('div', { class: 'row' }, minute, sh, sa), ...rows, msg, h('div', { class: 'actions' }, h('button', {
      class: 'btn primary',
      id: P + 'Save',
      type: 'button',
      text: snap ? 'Uložit úpravu' : 'Přidat snímek ručně',
      onclick: async () => {
        const sc = read(sh) === null && read(sa) === null ? null : { home: read(sh), away: read(sa) };
        const stats = { home: {}, away: {} };
        for (const side of ['home', 'away']) for (const [k] of STAT_FIELDS) stats[side][k] = read(fields[side + k]);
        const input = { minute: read(minute), score: sc, stats };
        try {
          const r = await onSave(input);
          if (r && r.status === 'unreadable') return (msg.textContent = r.message);
          ui.closeDrawer();
        } catch (e) {
          msg.textContent = e.message || String(e);
        }
      },
    })));
    return body;
  }

  // ------------------------------------------------------------------ zápas
  function matchView(app, redraw) {
    const live = FM27.live;
    const A_ = A();
    const header = h('section', { class: 'card', id: 'liveHeader' });
    const captureCard = h('section', { class: 'card', id: 'liveCapture' });
    const alertsCard = h('section', { class: 'card', id: 'liveAlerts' });
    const findingsCard = h('section', { class: 'card', id: 'liveFindings' });
    const adviceCard = h('section', { class: 'card', id: 'liveAdviceCard' });
    const changesCard = h('section', { class: 'card', id: 'liveChanges' });
    const timelineCard = h('section', { class: 'card', id: 'liveTimeline' });
    const status = h('p', { class: 'hint', id: 'liveStatus', 'aria-live': 'polite' });
    const adviceBox = h('div', { id: 'liveAdvice' });
    const steps = W.steps(FM27.advice.STEP_LABELS);
    const noteInput = ui.input({ id: 'liveNote', maxlength: 300, placeholder: 'Co řešíš? (nepovinné), třeba „soupeř nás přehrává ve středu“' });
    const getMatch = () => live.match(app);

    // ---- hlavička
    function drawHeader() {
      const m = getMatch();
      if (!m) return;
      const sorted = A_.sortTimeline(m.timeline);
      const last = [...sorted].reverse().find((s) => s.score) || null;
      const lastMin = sorted.length ? sorted[sorted.length - 1].minute : null;
      header.replaceChildren(
        h('h2', { text: `LIVE COACH: ${career(app).club} – ${m.opponent}` }),
        h('p', { class: 'lead', id: 'liveScore' }, `Hraješ za ${sideLabel(m.mySide)}. `, last ? `Poslední skóre ${last.score.home}:${last.score.away}` : 'Skóre zatím neznámé', lastMin !== null ? `, ${lastMin}. minuta.` : '.'),
        h('div', { class: 'actions' }, ui.confirmButton('Ukončit zápas', 'Opravdu ukončit?', async () => {
          const sc = last ? { home: last.score.home, away: last.score.away } : null;
          await live.finish(app, sc);
          live.end(app);
          toast('Zápas je uložený v Historii zápasů.');
          app.go('historie');
        }, { class: 'btn' }), ui.confirmButton('Zahodit zápas', 'Opravdu zahodit?', async () => {
          const id = m.id;
          live.end(app);
          await app.store.remove('match', id);
          redraw();
        }))
      );
    }
    const career = (a) => a.career();

    // ---- upozornění
    function drawAlerts() {
      const list = live.session.alerts;
      alertsCard.replaceChildren(
        h('h2', { text: 'Upozornění' }),
        list.length
          ? h('div', { class: 'books' }, list.slice(0, 6).map((a) => h('div', { class: 'book alertrow ' + a.finding.severity }, h('div', { class: 'meta' }, h('b', { text: a.finding.title }), h('span', { text: a.finding.text })), h('span', { class: 'chips' }, h('span', { class: 'chip t-' + (a.finding.severity === 'alert' ? 'unknown' : 'inferred'), text: a.finding.severity === 'alert' ? 'upozornění' : 'sleduj' }), a.spoken ? h('span', { class: 'chip t-observed', text: 'řečeno nahlas' }) : null))))
          : h('p', { class: 'hint', text: 'Zatím nic. Nová upozornění se ukážou tady a podle nastavení se přečtou nahlas.' })
      );
    }

    // ---- nálezy a rada
    function drawFindings() {
      const m = getMatch();
      const findings = live.findings(m);
      findingsCard.replaceChildren(
        h('h2', { text: 'Co aplikace vidí v číslech' }),
        h('p', { class: 'hint', text: 'Výpočet z přečtených čísel, ne diagnóza. Odchylka v číslech ještě není taktický problém, proto aplikace potřebuje víc snímků za sebou. Prahy jsou heuristiky aplikace, ne pravidla FM27.' }),
        findings.length
          ? h('div', { class: 'books' }, findings.map((f) => h('div', { class: 'book finding', 'data-kind': f.kind }, h('div', { class: 'meta' }, h('b', { text: f.title }), h('span', { text: f.text }), h('span', { text: 'Základ: ' + f.basis })), h('span', { class: 'chips' }, h('span', { class: 'chip t-' + (f.severity === 'alert' ? 'unknown' : 'inferred'), text: f.severity === 'alert' ? 'upozornění' : 'sleduj' }), ui.tierChip(f.evidenceTier === 'observed' ? 'observed' : 'inferred', f.evidenceTier === 'observed' ? 'ověřené snímky' : 'neověřené čtení')))))
          : h('p', { class: 'hint', id: 'liveNoFindings', text: m.timeline.length ? 'Zatím nic nápadného.' : 'Zatím žádný snímek.' })
      );
    }

    function drawAdviceCard() {
      const askBtn = h('button', { class: 'btn primary', id: 'liveAsk', type: 'button', text: 'Poradit, co změnit', disabled: !FM27.ai.available, onclick: ask });
      const stop = h('button', { class: 'btn', type: 'button', text: 'Zastavit', onclick: () => adviceCtl && adviceCtl.abort() });
      adviceCard.replaceChildren(
        h('h2', { text: 'Rada k zápasu' }),
        h('p', { class: 'lead', text: 'Trenér dostane tvůj tým a taktiku, průběh zápasu z časové osy, nálezy z čísel a tvoje knihy. Poradí jednu až dvě konkrétní změny a poctivě řekne, co neví.' }),
        ui.field('Co řešíš?', noteInput),
        h('div', { class: 'actions' }, askBtn, stop),
        steps.el,
        adviceBox
      );
    }

    async function ask() {
      const m = getMatch();
      if (!FM27.ai.available) return toast('Claude není dostupný.');
      if (!m.timeline.length && !noteInput.value.trim()) return toast('Vlož aspoň jeden snímek, nebo napiš, co řešíš.');
      adviceCtl = new AbortController();
      steps.reset(['plan', 'search', 'advice', 'check']);
      adviceBox.replaceChildren();
      $('#liveAsk').disabled = true;
      const res = await FM27.advice.ask(app, {
        question: noteInput.value || 'Co mám v tomhle zápase změnit?',
        observations: live.observations(m),
        signal: adviceCtl.signal,
        onStep: (id, cls, note) => steps.set(id, cls, note),
      });
      adviceCtl = null;
      $('#liveAsk').disabled = !FM27.ai.available;
      if (res.status === 'cancelled') return toast('Zastaveno.');
      if (res.status === 'ok') await FM27.advice.save(app, { question: noteInput.value || 'Rada k zápasu', advice: res.advice, ctx: res.ctx, verdict: res.verdict, source: 'live' });
      FM27.advice.render(app, adviceBox, res, {
        scroll: false,
        onRetry: ask,
        changeAction: res.status === 'ok' ? (item) => h('div', { class: 'actions' }, h('button', {
          class: 'btn small',
          type: 'button',
          'data-change': 'record',
          text: 'Provedl jsem tuhle změnu',
          onclick: async (ev) => {
            await live.recordChange(app, item, { recheckAfterMinutes: res.advice.measure.recheck_after_minutes });
            ev.target.disabled = true;
            ev.target.textContent = 'Změna je zaznamenaná';
            toast('Změna je zaznamenaná. Po pár minutách ji vyhodnotím podle dalších snímků.');
          },
        })) : null,
      });
    }

    // ---- změny a jejich vyhodnocení
    function evalNode(m, ch) {
      const ev = live.evaluate(m, ch);
      if (ev.status !== 'ready') {
        return h('div', null, h('span', { class: 'chip t-unknown', text: 'zatím nelze vyhodnotit' }), h('ul', { class: 'list' }, ev.notes.map((n) => h('li', { text: n }))));
      }
      const row = (label, d, unit) => h('div', null, h('span', { text: label }), h('span', { text: `${num(d.before)} → ${num(d.after)}${unit || ''} (${VERDICT_CS[d.verdict] || '–'})` }));
      return h(
        'div',
        null,
        h('div', { class: 'diag' }, row('Naše střely na 10 min', ev.deltas.mine.shots), row('Naše střely na bránu na 10 min', ev.deltas.mine.shotsOnTarget), row('Naše xG na 10 min', ev.deltas.mine.xg), row('Soupeřovy střely na 10 min', ev.deltas.opp.shots), row('Soupeřovo xG na 10 min', ev.deltas.opp.xg), h('div', null, h('span', { text: 'Změna našeho držení míče' }), h('span', { text: `${num(ev.deltas.possessionChangePp.before)} → ${num(ev.deltas.possessionChangePp.after)} p. b. (${VERDICT_CS[ev.deltas.possessionChangePp.verdict] || '–'})` }))),
        h('ul', { class: 'list' }, ev.notes.map((n) => h('li', { text: n }))),
        h('p', { class: 'banner warn', style: 'margin-top:8px', id: 'liveCausality', text: ev.causalityNote }),
        ui.tierChip(ev.evidenceTier === 'observed' ? 'observed' : 'inferred', ev.evidenceTier === 'observed' ? 'ověřené snímky' : 'neověřené čtení')
      );
    }
    function drawChanges() {
      const m = getMatch();
      changesCard.replaceChildren(
        h('h2', { text: 'Provedené změny a jejich účinek' }),
        m.changes.length
          ? h('div', { class: 'books' }, m.changes.map((ch) => h('div', { class: 'change-item', 'data-change-id': ch.id }, h('div', { class: 'what', text: `${ch.minute !== null ? ch.minute + '. min: ' : ''}${ch.summary}` }), evalNode(m, ch), h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Přidat do paměti kariéry', onclick: async () => { try { await FM27.context.addLesson(app, `Změna „${ch.summary}“ (${ch.minute !== null ? ch.minute + '. min' : 'minuta neznámá'}) proti ${m.opponent}: účinek jsem sledoval na snímcích, příčina není prokázaná.`, 'user', m.id); toast('Poznámka je v paměti kariéry.'); } catch (e) { toast(e.message || String(e)); } } })))))
          : h('p', { class: 'hint', text: 'Zatím žádná. Když v radě stiskneš „Provedl jsem tuhle změnu“, aplikace po dalších snímcích porovná dobu před a po. Časová souvislost ještě není důkaz příčiny.' })
      );
    }

    // ---- časová osa
    function drawTimeline() {
      const m = getMatch();
      const sorted = A_.sortTimeline(m.timeline).slice().reverse();
      timelineCard.replaceChildren(
        h('h2', { text: `Časová osa zápasu (${m.timeline.length})` }),
        sorted.length
          ? h('div', { class: 'books' }, sorted.map((s) => {
              const [tier, label] = PROV_CHIP[s.provenance] || PROV_CHIP.vision_unverified;
              return h(
                'div',
                { class: 'book snap', 'data-snap': s.id },
                h('div', { class: 'meta' }, h('b', { text: `${s.minute !== null ? s.minute + '. min' : 'minuta neznámá'}${s.score ? `, ${s.score.home}:${s.score.away}` : ''} (${s.screen})` }), h('span', { text: statLine(s) }), s.visibleText && s.visibleText.length ? h('span', { text: 'Přečtený text: ' + s.visibleText.join(' · ') }) : null, s.events && s.events.length ? h('span', { text: 'Události: ' + s.events.map((e) => `${e.minute !== null ? e.minute + '. ' : ''}${e.type}${e.text ? ' ' + e.text : ''}`).join('; ') }) : null, h('span', { class: 'chips' }, ui.tierChip(tier, label))),
                h('div', { class: 'row' }, s.provenance === 'vision_unverified' ? h('button', { class: 'btn small', type: 'button', 'data-act': 'verify', text: 'Potvrdit podle snímku', title: 'Potvrzuji, že čísla odpovídají snímku obrazovky', onclick: () => live.verify(app, s.id) }) : null, h('button', { class: 'btn small', type: 'button', text: 'Opravit', onclick: () => ui.openDrawer('Opravit snímek', [snapshotForm(app, s, (input) => live.edit(app, s.id, input), 'lve')]) }), ui.confirmButton('Smazat', 'Opravdu?', () => live.removeSnapshot(app, s.id)))
              );
            }))
          : h('p', { class: 'hint', id: 'liveEmptyTimeline', text: 'Zatím žádný snímek. Vlož první (Ctrl+V), nahraj soubor, vyfoť obrazovku, nebo zadej čísla ručně.' })
      );
    }

    // ---- příjem snímků
    function report(r, name) {
      if (r.status === 'added') {
        status.textContent = `Snímek ${name || ''} přečten${r.issues && r.issues.length ? ` (poznámky: ${r.issues.slice(0, 2).join(' ')})` : ''}.`;
        if (r.newFindings && r.newFindings.length) toast(`Nové upozornění: ${r.newFindings[0].title}`);
      } else status.textContent = `${name ? name + ': ' : ''}${r.message || r.reason}`;
    }
    async function handleFiles(files) {
      for (const f of [...files]) {
        if (!/^image\//.test(f.type)) {
          status.textContent = `${f.name}: tohle není obrázek.`;
          continue;
        }
        status.textContent = `Čtu ${f.name || 'snímek'}… (při prvním použití potvrď okno Claude)`;
        report(await live.ingest(app, f), f.name);
      }
    }
    const onPaste = (ev) => {
      const items = [...((ev.clipboardData && ev.clipboardData.items) || [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (!items.length) return;
      ev.preventDefault();
      handleFiles(items.map((i) => i.getAsFile()).filter(Boolean));
    };
    document.addEventListener('paste', onPaste);
    app.onCleanup(() => document.removeEventListener('paste', onPaste));

    function drawCapture() {
      const canShare = live.captureAvailable();
      const vision = FM27.ai.available && FM27.ai.imagesSupported;
      const drop = h('div', { class: 'drop', id: 'liveDrop', tabindex: 0, role: 'button', 'aria-label': 'Sem vlož nebo přetáhni snímek obrazovky' }, h('b', { text: 'Vlož snímek: Ctrl+V' }), h('span', { text: 'nebo ho sem přetáhni, nebo vyber soubor' }));
      drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        handleFiles(e.dataTransfer.files);
      });
      const file = h('input', { type: 'file', id: 'liveFile', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true });
      file.addEventListener('change', () => (handleFiles(file.files), (file.value = '')));
      const cam = h('input', { type: 'file', id: 'liveCamera', accept: 'image/*', capture: 'environment', hidden: true });
      cam.addEventListener('change', () => (handleFiles(cam.files), (cam.value = '')));

      const capStatus = h('p', { class: 'hint', id: 'liveCapStatus', 'aria-live': 'polite' });
      const share = canShare ? h('div', { class: 'actions' },
        h('button', { class: 'btn primary', id: 'liveShare', type: 'button', text: 'Sdílet obrazovku FM27', disabled: !vision, onclick: async () => {
          try {
            await live.startCapture(app, {
              onStatus: (t) => (capStatus.textContent = t),
              onResult: (r) => (report(r), drawAll()),
              onEnded: () => { $('#pillLive').hidden = true; capStatus.textContent = 'Sdílení skončilo.'; drawCapture(); },
            });
            $('#pillLive').hidden = false;
            capStatus.textContent = 'Sdílení běží. Vyber okno hry; snímky se posílají jen při změně obrazovky.';
            drawCapture();
          } catch (e) {
            capStatus.textContent = e && e.name === 'NotAllowedError' ? 'Sdílení jsi nepovolil, nic se nesleduje.' : (e && e.message) || String(e);
          }
        } }),
        h('button', { class: 'btn', id: 'livePause', type: 'button', text: live.session.capture && live.session.capture.paused ? 'Pokračovat' : 'Pozastavit', disabled: !live.session.capture, onclick: () => { const c = live.session.capture; if (c && c.paused) { live.resumeCapture(); $('#pillLive').hidden = false; } else { live.pauseCapture(); $('#pillLive').hidden = true; } drawCapture(); } }),
        h('button', { class: 'btn', id: 'liveStopShare', type: 'button', text: 'Zastavit sdílení', disabled: !live.session.capture, onclick: () => { live.stopCapture(); $('#pillLive').hidden = true; capStatus.textContent = 'Sdílení je zastavené.'; drawCapture(); } })
      ) : null;
      const stats = live.session.gate ? live.session.gate.stats() : null;
      captureCard.replaceChildren(
        h('h2', { text: 'Snímky obrazovky' }),
        canShare
          ? h('p', { class: 'lead', text: 'Sdílej okno hry (prohlížeč se zeptá a ukáže, že se sdílí). Aplikace pošle snímek jen když se obrazovka změní a ustálí, a nikdy nepřekročí limity z Nastavení. Zastavit jde kdykoli tady i tlačítkem prohlížeče.' })
          : h('p', { class: 'lead', text: 'Stránka v Claude nesmí sama snímat obrazovku ani mikrofon. Snímky vkládej ručně: ve Windows Win+Shift+S a pak tady Ctrl+V, na telefonu vyfoť obrazovku. Čtení souvislého sdílení obrazovky je v samostatné verzi aplikace.' }),
        share,
        capStatus,
        stats ? h('p', { class: 'hint', id: 'liveGate', text: `Zpracováno ${stats.processed}, odstup ${Math.round(stats.intervalMs / 1000)} s, limity ${stats.limits.perHour}/h a ${stats.limits.perMatch}/zápas.` }) : null,
        vision ? null : h('div', { class: 'banner warn' }, h('b', { text: 'Čtení snímků není dostupné' }), h('span', { text: 'Bez Claude s podporou obrázků se snímky číst nedají. Čísla můžeš zadat ručně níž.' })),
        h('div', { class: 'row' }, drop, h('div', { class: 'actions', style: 'margin-top:0' }, h('label', { class: 'btn', for: 'liveFile', style: 'cursor:pointer', text: 'Vybrat soubor' }), h('label', { class: 'btn', for: 'liveCamera', style: 'cursor:pointer', text: 'Vyfotit obrazovku' }), file, cam)),
        status,
        h('details', { class: 'manual' }, h('summary', { text: 'Zadat čísla ručně' }), snapshotForm(app, null, async (input) => live.addManual(app, input).then((r) => (r.status === 'added' ? (status.textContent = 'Ruční snímek je přidaný.', r) : r))))
      );
    }

    const drawAll = () => {
      if (!getMatch()) return;
      drawHeader();
      drawAlerts();
      drawFindings();
      drawChanges();
      drawTimeline();
    };
    drawCapture();
    drawAdviceCard();
    drawAll();
    app.watch(['match'], () => getMatch() && drawAll());
    app.onCleanup(() => {
      if (adviceCtl) adviceCtl.abort();
    });
    return h('div', { class: 'live-grid' }, h('div', null, header, captureCard, timelineCard), h('div', null, alertsCard, findingsCard, adviceCard, changesCard));
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    if (!A() || !FM27.advice || !FM27.live) {
      root.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Chybí modul Live Coache' })));
      return;
    }
    if (!app.requireCareer(root, 'Live Coach')) return;
    const draw = () => {
      let id = FM27.live.session.matchId;
      let m = id ? app.store.get('match', id) : null;
      if (!m || m.status !== 'live' || m.careerId !== app.career().id) {
        id = FM27.live.activeMatchId(app);
        if (id) FM27.live.begin(app, id);
        m = id ? app.store.get('match', id) : null;
      }
      if (!m) {
        FM27.live.end(app);
        root.replaceChildren(setupCard(app, draw));
        return;
      }
      root.replaceChildren(matchView(app, draw));
    };
    draw();
  }

  FM27.screens.register({ id: 'live', hash: 'live', label: 'LIVE COACH', order: 1, render });
})();
