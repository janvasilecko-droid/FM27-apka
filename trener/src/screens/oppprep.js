/* Karty „Příprava na zápas“ na obrazovce Analýza soupeře (zadání majitele 7. 11. 2026: „analýza soupeře, chci seznam konkrétních doporučení a úprav taktiky,
   kterou mám, najít slabá místa soupeře, poradit hráčům“). Tři karty:
   1. Zpráva o soupeři ze hry: přečtení snímků české zprávy o týmu (Přehled, Analýza formace, Standardky) a Předpokládané sestavy do strukturovaného profilu.
   2. Soupiska soupeře: atributy soupeřových hráčů ze snímků jeho soupisky (jen to, co hra ukazuje).
   3. Příprava na zápas: jedno tlačítko, které z toho, z tvé aktivní taktiky a z tvého kádru udělá seznam doporučení (bez AI, v tomhle zařízení).
   Všechno z obrázku je návrh, dokud ho uživatel nepotvrdí. Výpočet je v oppanalysis.js; tady je jen obrazovka. Doporučení nic nepředpovídá a nic v taktice nemění. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h, toast } = ui;
  const W = FM27.widgets;
  const OR = () => window.TrenerOppRead;
  const OA = () => window.TrenerOppAnalysis;
  const SR = () => window.TrenerSquadRead;
  const SEV_CHIP = { doporuceno: 'good', zvaz: 'warn', info: 'neutral' };

  const reportOf = (opp) => (opp.structured && opp.structured.report) || null;
  const playersOf = (opp) => (opp.structured && Array.isArray(opp.structured.players) ? opp.structured.players : []);
  async function saveStructured(app, opp, patch) {
    const cur = app.store.draft(app.store.get('opponent', opp.id) || opp);
    cur.structured = Object.assign({}, cur.structured || {}, patch, { updatedAt: Date.now() });
    return app.store.put('opponent', cur);
  }

  /** Řádky přehledu načteného profilu (pro náhled i pro uložený profil). */
  function reportLines(r) {
    const lines = [];
    if (r.team || r.summary) lines.push(`Tým: ${[r.team, r.leaguePosition ? `${r.leaguePosition}. místo` : null, r.matchDate].filter(Boolean).join(', ')}${r.summary ? ` — ${r.summary}` : ''}`);
    const m = r.manager || {};
    if (m.preferredFormation || m.mentality || m.pressing || m.marking) lines.push(`Trenér: ${[m.preferredFormation && `formace ${m.preferredFormation}`, m.mentality && `mentalita ${m.mentality}`, m.pressing && `styl pressingu ${m.pressing}`, m.marking && `styl obsazování ${m.marking}`].filter(Boolean).join(', ')}`);
    if (r.staffAnalysis) lines.push(`Analýza hodnocení zaměstnanců: ${r.staffAnalysis}`);
    if (r.formations && (r.formations.ip.length || r.formations.oop.length)) lines.push(`Formace: s míčem ${r.formations.ip.map((f) => `${f.formation}${f.share !== null ? ` (${String(f.share).replace('.', ',')} %)` : ''}`).join(', ') || '–'}; bez míče ${r.formations.oop.map((f) => `${f.formation}${f.share !== null ? ` (${String(f.share).replace('.', ',')} %)` : ''}`).join(', ') || '–'}`);
    if (r.weaknesses.length) lines.push(`Slabiny (${r.weaknesses.length}): ${r.weaknesses.map((w) => w.area || w.text.slice(0, 30)).join(', ')}`);
    if (r.strengths.length) lines.push(`Silné stránky (${r.strengths.length}): ${r.strengths.map((w) => w.area || w.text.slice(0, 30)).join(', ')}`);
    if (r.absences.length) lines.push(`Výpadky: ${r.absences.map((a) => `${a.name} (${a.status === 'out' ? 'nehraje' : 'nejistý'})`).join(', ')}`);
    if (r.keyPlayers.length) lines.push(`Významní hráči: ${r.keyPlayers.map((k) => `${k.name} (${{ topScorer: 'střelec', topAssists: 'asistent', topRating: 'hodnocení' }[k.kind]})`).join(', ')}`);
    if (r.setPieces && (r.setPieces.attack.length || r.setPieces.defence.length)) lines.push(`Standardky: ${r.setPieces.attack.length} postřehů o útoku, ${r.setPieces.defence.length} o obraně`);
    if (r.lineup.length) lines.push(`Předpokládaná sestava (${r.lineup.length}): ${r.lineup.map((l) => `${l.code || l.slot || l.position || '?'} ${l.name}`).join('; ')}`);
    if (r.verdicts.length) lines.push(`Verdikty hry: ${r.verdicts.map((v) => `${v.area}: ${v.verdict}`).join('; ')}`);
    return lines;
  }

  function lineList(lines, id) {
    return h('ul', { class: 'list', id }, lines.map((l) => h('li', { text: l })));
  }

  // ------------------------------------------------------------------ 1) zpráva o soupeři ze hry
  function reportCard(app, opp, redraw) {
    const ai = FM27.ai;
    const stored = reportOf(opp);
    const card = h('section', { class: 'card', id: 'oppRepCard' }, h('h2', { text: 'Zpráva o soupeři ze hry' }));
    card.append(h('p', { class: 'lead', text: 'Ve hře otevři zprávu o týmu soupeře (Report soupeře: záložky Přehled, Analýza formace › Očekávaná taktika, Analýza standardek) a Taktika › Opposition › Předpokládaná sestava a vyfoť je. Jeden snímek může být jedna záložka. Hra sama píše silné a slabé stránky soupeře: aplikace je přepíše a převede na konkrétní kroky. Co přečte, je jen návrh, dokud ho nepotvrdíš.' }));
    if (stored) {
      card.append(h('div', { class: 'banner ok', id: 'oppRepStored' }, h('b', { text: 'Uložená zpráva' }), h('span', { text: ` (neověřeno, přepsáno ze snímků ${ui.fmtDateTime(opp.structured.updatedAt)})` })), lineList(reportLines(stored), 'oppRepLines'));
      card.append(h('div', { class: 'actions' }, ui.confirmButton('Smazat načtenou zprávu', 'Opravdu smazat?', async () => {
        await saveStructured(app, opp, { report: null });
        toast('Načtená zpráva je smazaná.');
        redraw();
      })));
    } else card.append(h('p', { class: 'hint', id: 'oppRepEmpty', text: 'Zatím není načtená žádná zpráva o tomhle soupeři.' }));
    if (!ai.imagesSupported) {
      card.append(h('p', { class: 'hint', text: 'Čtení obrázků tady není dostupné (potřebuje Claude s podporou obrázků).' }));
      return card;
    }
    const input = h('input', { type: 'file', id: 'oppRepShot', accept: ai.limitsInfo.images.mediaTypes.join(','), multiple: true });
    const status = h('p', { class: 'hint', id: 'oppRepStatus', 'aria-live': 'polite' });
    const out = h('div', { id: 'oppRepOut' });
    let grabbed = [];
    const grab = W.frameGrabButton((blob) => {
      grabbed = [blob];
      status.textContent = 'Snímek okna hry je připravený. Klikni na „Přečíst zprávu ze screenshotu“.';
    }, { id: 'oppRepGrab' });
    const read = h('button', {
      class: 'btn primary',
      id: 'oppRepRead',
      type: 'button',
      text: 'Přečíst zprávu ze screenshotu',
      onclick: async () => {
        const files = [...input.files, ...grabbed].slice(0, ai.limitsInfo.images.maxCount);
        if (!files.length) return (status.textContent = 'Vyber aspoň jeden obrázek.');
        read.disabled = true;
        status.textContent = 'Čtu obrázek… (při prvním použití potvrď okno Claude)';
        out.replaceChildren();
        try {
          const raw = await ai.json(OR().PROMPT, { modelTier: 'quick', images: files, cache: false, purpose: 'čtení zprávy o soupeři' });
          const r = OR().normalizeReport(raw);
          status.textContent = r.ok ? 'Přečteno. Je to jen návrh: nic se neuloží, dokud nepotvrdíš, že odpovídá obrazovce.' : r.issues[0] || 'Nic čitelného jsem nenašel.';
          if (r.ok) renderPreview(r);
          else if (r.issues.length) out.append(h('p', { class: 'hint', text: r.issues.join(' ') }));
        } catch (e) {
          status.textContent = ai.errorText(e);
        } finally {
          read.disabled = false;
        }
      },
    });
    function renderPreview(r) {
      const confirm = h('input', { type: 'checkbox', id: 'oppRepConfirm' });
      out.append(
        r.issues.length ? h('p', { class: 'hint', text: r.issues.join(' ') }) : null,
        h('b', { text: 'Přečtený návrh' }),
        lineList(reportLines(r.report), 'oppRepPreview'),
        stored ? h('p', { class: 'hint', text: 'Uložení se sloučí s tím, co už je načtené: prázdné údaje se doplní, seznamy se sjednotí.' }) : null,
        h('label', { class: 'checkline' }, confirm, h('span', { text: 'Zkontroloval jsem návrh podle obrazovky hry a odpovídá jí.' })),
        h('div', { class: 'actions' }, h('button', {
          class: 'btn primary',
          id: 'oppRepSave',
          type: 'button',
          text: 'Uložit do profilu soupeře (neověřeno)',
          onclick: async () => {
            if (!confirm.checked) return toast('Nejdřív potvrď, že návrh odpovídá obrazovce.');
            const merged = OR().mergeReports(reportOf(app.store.get('opponent', opp.id) || opp), r.report);
            await saveStructured(app, opp, { report: merged });
            toast('Zpráva o soupeři je uložená (neověřeno).');
            redraw();
          },
        }))
      );
    }
    card.append(ui.field('Screenshot zprávy o soupeři', input), h('div', { class: 'actions' }, grab, read), status, out);
    return card;
  }

  // ------------------------------------------------------------------ 2) soupiska soupeře (atributy)
  function squadCard(app, opp, redraw) {
    const ai = FM27.ai;
    const players = playersOf(opp);
    const card = h('section', { class: 'card', id: 'oppSqCard' }, h('h2', { text: 'Soupiska soupeře (atributy)' }));
    card.append(h('p', { class: 'lead', text: 'Kdo je v očekávané sestavě, zjistí aplikace ze zprávy. Aby uměla posoudit rychlost, vzduch nebo rozehru jeho hráčů, potřebuje jejich atributy: otevři soupisku soupeře (jeho klub › A-tým) v pohledech Technické, Psychika, Fyzické atributy, Obrana a Útok a vyfoť je. Aplikace čte jen to, co hra ukazuje; o hráčích soupeře, které skaut nezná, může hra ukazovat jen rozmezí a pak je aplikace nevyhodnotí.' }));
    card.append(players.length
      ? h('p', { class: 'hint', id: 'oppSqStored', text: `Načteno hráčů soupeře: ${players.length}, s atributy u ${players.filter((p) => Object.keys(p.attributes || {}).length).length}.` })
      : h('p', { class: 'hint', id: 'oppSqEmpty', text: 'Zatím nejsou načtené atributy žádného soupeřova hráče: rozbor podle atributů se nedělá.' }));
    if (!ai.imagesSupported) return card;
    const input = h('input', { type: 'file', id: 'oppSqShot', accept: ai.limitsInfo.images.mediaTypes.join(','), multiple: true });
    const status = h('p', { class: 'hint', id: 'oppSqStatus', 'aria-live': 'polite' });
    const out = h('div', { id: 'oppSqOut' });
    let grabbed = [];
    const grab = W.frameGrabButton((blob) => {
      grabbed = [blob];
      status.textContent = 'Snímek okna hry je připravený. Klikni na „Přečíst soupisku soupeře“.';
    }, { id: 'oppSqGrab' });
    const read = h('button', {
      class: 'btn',
      id: 'oppSqRead',
      type: 'button',
      text: 'Přečíst soupisku soupeře',
      onclick: async () => {
        const files = [...input.files, ...grabbed].slice(0, ai.limitsInfo.images.maxCount);
        if (!files.length) return (status.textContent = 'Vyber aspoň jeden obrázek.');
        read.disabled = true;
        status.textContent = 'Čtu obrázek… (při prvním použití potvrď okno Claude)';
        out.replaceChildren();
        try {
          const raw = await ai.json(SR().PROMPT, { modelTier: 'quick', images: files, cache: false, purpose: 'čtení soupisky soupeře' });
          const { proposals, issues } = SR().normalizeSquadRead(raw);
          status.textContent = proposals.length ? `Přečetl jsem ${proposals.length} hráčů. Je to jen návrh: nic se neuloží, dokud nepotvrdíš.` : 'Nic čitelného jsem nenašel.';
          if (issues.length) out.append(h('p', { class: 'hint', text: 'Poznámky ke čtení: ' + [...new Set(issues)].slice(0, 4).join(' ') }));
          if (proposals.length) renderPreview(proposals);
        } catch (e) {
          status.textContent = ai.errorText(e);
        } finally {
          read.disabled = false;
        }
      },
    });
    function renderPreview(proposals) {
      const existing = playersOf(app.store.get('opponent', opp.id) || opp).map((p, i) => Object.assign({ id: p.id || `op${i + 1}` }, p));
      const plan = SR().planWrites(existing, proposals);
      const confirm = h('input', { type: 'checkbox', id: 'oppSqConfirm' });
      const desc = (p) => [(p.positions || []).join('/') || 'pozice nečitelná', Object.keys(p.attributes || {}).length ? `${Object.keys(p.attributes).length} atributů` : null].filter(Boolean).join(' · ');
      out.append(
        plan.add.length ? h('div', null, h('b', { text: 'Noví hráči soupeře' }), h('ul', { class: 'list', id: 'oppSqNew' }, plan.add.map((p) => h('li', { text: `${p.name}: ${desc(p)}` })))) : null,
        plan.update.length ? h('div', null, h('b', { text: 'Už načtení: doplnit atributy' }), h('ul', { class: 'list', id: 'oppSqUpdate' }, plan.update.map((u) => h('li', { text: `${u.name}: ${u.changes.slice(0, 6).join(' · ')}` })))) : null,
        h('label', { class: 'checkline' }, confirm, h('span', { text: 'Zkontroloval jsem návrh podle obrazovky hry a odpovídá jí.' })),
        h('div', { class: 'actions' }, h('button', {
          class: 'btn primary',
          id: 'oppSqSave',
          type: 'button',
          text: 'Uložit k soupeři (neověřeno)',
          onclick: async () => {
            if (!confirm.checked) return toast('Nejdřív potvrď, že návrh odpovídá obrazovce.');
            const list = playersOf(app.store.get('opponent', opp.id) || opp).map((p, i) => Object.assign({}, p, { id: p.id || `op${i + 1}` }));
            for (const p of plan.add) list.push({ id: `op${list.length + 1}`, name: p.name, positions: p.positions, age: p.age, attributes: p.attributes });
            for (const u of plan.update) {
              const rec = list.find((x) => x.id === u.id);
              if (!rec) continue;
              if (u.patch.attributes) rec.attributes = u.patch.attributes;
              if (u.patch.positions) rec.positions = u.patch.positions;
              if (u.patch.age !== undefined) rec.age = u.patch.age;
            }
            await saveStructured(app, opp, { players: list.slice(0, 60) });
            toast('Soupiska soupeře je uložená (neověřeno).');
            redraw();
          },
        }))
      );
    }
    card.append(ui.field('Screenshot soupisky soupeře', input), h('div', { class: 'actions' }, grab, read), status, out);
    return card;
  }

  // ------------------------------------------------------------------ 3) příprava na zápas
  const changeLine = (c) => `${c.label} → ${c.value}${c.valueSeen || c.value === c.to ? '' : ` (${c.to})`}`;

  function recEl(r) {
    const todo = r.changes.filter((c) => !c.already);
    const done = r.changes.filter((c) => c.already);
    return h(
      'div',
      { class: 'book finding', 'data-rule': r.id, 'data-sev': r.sev, 'data-optional': r.optional ? '1' : '0' },
      h(
        'div',
        { class: 'meta' },
        h('b', { text: r.title }),
        h('span', { class: 'chips' }, ui.chip(SEV_CHIP[r.sev], r.sevCs), ui.chip('neutral', r.basisCs), r.optional ? ui.chip('warn', 'volitelné: přes rozpočet změn') : null, r.cost.settings ? ui.chip('accent', `změn nastavení: ${r.cost.settings}`) : null, r.cost.oi ? ui.chip('accent', `pokynů k soupeři: ${r.cost.oi}`) : null),
        h('span', { text: r.text }),
        todo.length ? h('div', null, h('b', { text: 'Co přenastavit v taktice' }), h('ul', { class: 'list', 'data-role': 'changes' }, todo.map((c) => h('li', { text: `${changeLine(c)}${c.known ? ` (teď: ${c.fromCs})` : ' (tvoje nastavení nemám načtené: ověř)'}` })))) : null,
        done.length ? h('p', { class: 'hint', text: `Už máš nastaveno: ${done.map((c) => `${c.label}: ${c.fromCs}`).join(', ')}.` }) : null,
        r.who.length ? h('div', null, h('b', { text: 'Koho dát do sestavy' }), h('ul', { class: 'list' }, r.who.map((w) => h('li', { text: `${w.name}: ${w.why}` })))) : null,
        r.tweak ? h('p', { class: 'hint', text: r.tweak }) : null,
        r.ev.length ? h('details', null, h('summary', { text: 'Podle čeho' }), h('ul', { class: 'list' }, r.ev.map((e) => h('li', { text: e })))) : null,
        r.risks.length ? h('details', null, h('summary', { text: 'Riziko a cena' }), h('ul', { class: 'list' }, r.risks.map((e) => h('li', { text: e })))) : null,
        r.watch ? h('p', { class: 'hint', text: `Co sledovat: ${r.watch}` }) : null
      )
    );
  }

  function resultEl(r, copyLines) {
    const box = h('div', { id: 'oppPrepResult' });
    if (!r.usable) {
      box.append(h('div', { class: 'banner warn', id: 'oppPrepUnusable' }, h('b', { text: 'Není z čeho počítat' }), h('span', { text: 'O tomhle soupeři není načtená zpráva ze hry (silné a slabé stránky, sestava, trenér). Přečti ji ve kartě výše.' })));
      return box;
    }
    const i = r.inputs;
    box.append(
      h('p', { class: 'hint', id: 'oppPrepInputs', text: `Z čeho se počítalo: zpráva o soupeři (${i.weaknesses} slabin, ${i.strengths} silných stránek, sestava ${i.lineup}, atributy u ${i.lineupWithAttributes}), ${i.tactic ? `tvoje aktivní taktika (${i.tacticInstructions} přečtených instrukcí)` : 'tvoje taktika NENÍ načtená, takže nevím, co už máš nastavené'}, kádr ${i.squad} hráčů.` }),
      r.budget.over
        ? h('div', { class: 'banner warn', id: 'oppPrepBudget' }, h('b', { text: `Nabízím ${r.budget.offered} změn nastavení, doporučuji nejvýš ${r.budget.max}` }), h('span', { text: 'Každá změna taktiky snižuje porozumění taktice. Přednost mají doporučení nahoře; ostatní jsou označená jako volitelná.' }))
        : h('p', { class: 'hint', id: 'oppPrepBudget', text: `Změn nastavení celkem: ${r.budget.settings} (doporučený strop ${r.budget.max}).` }),
      r.oneChange ? h('div', { class: 'banner ok', id: 'oppOne' }, h('b', { text: 'Jedna testovatelná změna' }), h('span', { text: r.oneChange.text }), h('p', { class: 'hint', text: `Co sledovat: ${r.oneChange.watch}` }), h('p', { class: 'hint', text: r.oneChange.revert })) : null,
      h('div', { class: 'advice', id: 'oppRecs' }, r.recs.length ? r.recs.map(recEl) : h('p', { class: 'hint', text: 'Žádné pravidlo nic nenašlo. To neznamená, že proti soupeři nemáš co zlepšit: níž je, co se nevyhodnotilo.' }))
    );
    if (r.oi.length) {
      box.append(
        h('h3', { text: 'Pokyny k soupeři (Taktika › Opposition)' }),
        h('div', { class: 'tblscroll' }, h('table', { class: 'tbl', id: 'oppOi' }, h('thead', null, h('tr', null, ['Místo', 'Hráč', 'Sloupec', 'Hodnota', 'Proč'].map((t) => h('th', { text: t })))), h('tbody', null, r.oi.map((o) => h('tr', { 'data-name': o.name }, h('td', { text: o.code || o.hint || '?' }), h('td', { text: o.name }), h('td', { text: o.column }), h('td', { text: o.value }), h('td', { text: o.why })))))),
        h('p', { class: 'hint', text: 'Nikdo neměřil, že pokyny k soupeři zlepší výsledek. Nastav je až na sestavu v den zápasu a nejvýš tři.' })
      );
    }
    if (r.training.length) {
      box.append(h('h3', { text: 'Zápasová příprava (Trénink › Tréninkový rozvrh)' }), h('ul', { class: 'list', id: 'oppTrain' }, r.training.map((t) => h('li', { 'data-session': t.session }, h('b', { text: t.session }), h('span', { text: ` — ${t.why}. ` }), h('span', { class: 'hint', text: t.note })))));
    }
    if (r.playerNotes.length) box.append(h('h3', { text: 'Rady k hráčům tvého kádru' }), h('ul', { class: 'list', id: 'oppPlayerNotes' }, r.playerNotes.map((n) => h('li', null, h('b', { text: n.name }), h('span', { text: `: ${n.text}` })))));
    box.append(
      h('h3', { text: 'Co si pamatovat' }),
      h('ul', { class: 'list', id: 'oppWarnings' }, r.warnings.map((w) => h('li', { text: w }))),
      r.notChecked.length ? h('details', { id: 'oppNotChecked' }, h('summary', { text: `Nevyhodnoceno kvůli chybějícím údajům (${r.notChecked.length})` }), h('ul', { class: 'list' }, r.notChecked.map((x) => h('li', { text: `${x.id}: ${x.title}` }))), h('p', { class: 'hint', text: 'Chybějící údaj se nehádá. Co dodat: načti zprávu o soupeři, jeho soupisku s atributy a svou taktiku.' })) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn small', id: 'oppPrepCopy', type: 'button', text: 'Kopírovat souhrn', onclick: () => ui.copyText(copyLines.join('\n'), 'Souhrn je zkopírovaný.') }))
    );
    return box;
  }

  function prepCard(app, opp) {
    const card = h('section', { class: 'card', id: 'oppPrepCard' }, h('h2', { text: 'Příprava na zápas' }));
    card.append(h('p', { class: 'lead', text: 'Jedno tlačítko: z načtené zprávy o soupeři, z tvé aktivní taktiky a z tvého kádru vznikne seřazený seznam konkrétních úprav taktiky (česky, jak je najdeš ve hře), pokynů k soupeři, sezení Zápasové přípravy a rad k hráčům. Počítá se v tomhle zařízení bez AI. Každé doporučení říká, odkud je (hra, komunita, odhad), kolik stojí změn a co sledovat. Nic se nepředpovídá a nic se v taktice samo nemění.' }));
    const out = h('div', { id: 'oppPrepOut' });
    const run = h('button', {
      class: 'btn primary',
      id: 'oppPrepBtn',
      type: 'button',
      text: 'Připravit zápas',
      onclick: () => {
        const cur = app.store.get('opponent', opp.id) || opp;
        const career = app.career();
        const tactics = FM27.context.tactics(app);
        const tactic = tactics.find((t) => t.id === career.activeTacticId) || tactics[0] || null;
        const squad = FM27.context.players(app);
        const result = OA().analyze({ report: reportOf(cur), oppPlayers: playersOf(cur), tactic, squad });
        out.replaceChildren(resultEl(result, OA().summaryLines(result)));
        last.set(opp.id, { at: Date.now(), result });
      },
    });
    card.append(h('div', { class: 'actions' }, run), out);
    return card;
  }
  const last = new Map();

  /** Karty pro vybraného soupeře; `redraw` překreslí obrazovku po uložení. */
  function cards(app, opp, redraw) {
    if (!OR() || !OA() || !SR()) return [];
    return [reportCard(app, opp, redraw), squadCard(app, opp, redraw), prepCard(app, opp)];
  }

  FM27.oppPrepUI = { cards, reportLines };
})();
