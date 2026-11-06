/* Rozbor sestavy (zadání majitele 6. 11. 2026: „analyzuj sestavu, najdi slabá místa a poraď, koho a jak vylepšit“).
   Čistá logika bez DOM, sítě a AI (test/squadcheck.test.mjs): stejný vstup dá vždy stejný výstup, vstupy se nemění.

   CO TO DĚLÁ: pro místa taktiky spočítá z VIDITELNÝCH atributů hráčů vhodnost na skupinu pozic (DWRS po skupinách, bez ručního popisu rolí),
   najde nejlepší jedenáctku (přesné přiřazení, maďarský algoritmus), porovná ji s jedenáctkou, kterou uživatel v taktice zadal, a hledá
   slabá místa PODLE PRAVIDEL, ne podle pořadí. Pozice se hlásí jen tehdy, když platí aspoň jedna z podmínek:
     1. málo hráčů na skupinu pozic proti cíli (2 hráči na místo; jeden hráč bez zálohy je „jediná možnost“, žádný je „díra“),
     2. kvalitní útes: základní hráč je o `cliffGap` bodů nad nejlepší zálohou (silný základ a slabá záloha),
     3. základní hráč má viditelnou slabinu v nejdůležitějších atributech své skupiny (hodnota 9 a méně),
     4. stárnoucí základní hráč bez mladšího nástupce, zraněný hráč v sestavě.
   Důvod: „o osm bodů pod mediánem“ najde slabé místo v každém kádru (něco je vždy nejslabší), takže nic neříká. Princip tří podmínek a cíl
   dvou hráčů na místo jsou z veřejného popisu nástroje FM Dossier (jen princip, žádný kód ani tabulka); komunitní prahy věku a atributů
   jsou odhady a dají se posunout (`opts`).

   POCTIVOST: vhodnost je ESTIMATED (tabulky DWRS jsou odhad autora, ne pravidlo FM27); u hráče s neúplnými atributy se uvede pokrytí nebo se
   hráč neohodnotí (nikdy nula); hráč bez věku se nezapočítá do věkových pravidel a řekne se to; CA, PA, potenciál ani osobnost se nepoužívají.
   Rozbor neřadí hráče podle „kvality“ napříč pozicemi a nepředpovídá výsledek zápasu. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rolefit.js'), require('./dwrs.js'), require('./fm27know.js'));
  else root.TrenerSquadCheck = factory(root.TrenerRoleFit, root.TrenerDwrs, root.TrenerFm27Know);
})(typeof self !== 'undefined' ? self : this, function (RF, D, K) {
  'use strict';

  const VERSION = 'squadcheck-1';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const cz = (v) => String(r1(v)).replace('.', ',');
  const SEV_RANK = { error: 0, warn: 1, note: 2, info: 3, good: 4 };
  const SEV_CS = { error: 'Vážný nález', warn: 'Upozornění', note: 'Poznámka', info: 'K vědomí', good: 'Silná stránka' };
  const BASIS_CS = { ODHAD: 'odhad autora aplikace (DWRS tabulky a prahy jsou odhad)', KOMUNITA: 'názor komunitních průvodců', VYPOCET: 'výpočet z tvých dat' };

  const DEFAULTS = Object.freeze({
    perSlot: 2, // cíl hloubky: hráčů na místo
    cliffGap: 12, // body (stupnice 0 až 100), o kolik je základní hráč nad nejlepší zálohou
    weakValue: 9, // atribut z nejdůležitějších kategorií skupiny na téhle hodnotě a níž je viditelná slabina
    swapGain: 4, // o kolik bodů musí být jiný hráč lepší, aby se výměna navrhla
    veteranAge: 31, // základní hráč od tohoto věku potřebuje nástupce
    successorMaxAge: 27, // nástupce je mladší nebo roven
    minCoverage: 0.6, // pokrytí váhy atributů, od kterého se částečně vyplněný hráč ohodnotí
    topAttrs: 3, // kolik slabin atributů u hráče se vypíše
  });

  const gname = (g) => D.GROUP_CS[g] || g;
  const posOfSlot = (s) => String(s.pos || '').toUpperCase();

  // ---------------------------------------------------------------- vstupy
  function prepare(tactic, players, opts) {
    const o = Object.assign({}, DEFAULTS, isObj(opts) ? opts : {});
    const wp = isObj(o.wp) ? o.wp : undefined;
    const slots = (isObj(tactic) && Array.isArray(tactic.slots) ? tactic.slots : []).filter((s) => isObj(s) && s.pos).map((s) => ({ key: s.key, pos: posOfSlot(s), group: D.groupOfPosition(s.pos), playerId: s.playerId || null }));
    const list = (Array.isArray(players) ? players : []).filter((p) => isObj(p) && p.id);
    const info = list.map((p) => {
      const injured = !!(p.flags && p.flags.injury) || (Array.isArray(o.unavailable) && o.unavailable.includes(p.id));
      return {
        id: p.id,
        name: String(p.name || '?'),
        age: isNum(p.age) && p.age >= 14 && p.age <= 50 ? p.age : null,
        positions: Array.isArray(p.positions) ? p.positions : [],
        injured,
        tired: !!(p.flags && p.flags.fatigue),
        player: p,
        attrsCount: D.playerAttributes(p).size,
      };
    });
    const cell = new Map(); // `${slotKey}|${playerId}` → {value, partial, coverage, contributions, eligible, flag}
    for (const s of slots) {
      for (const pl of info) {
        const el = RF.eligibility(s.pos, pl.positions, 'strict');
        let res = null;
        let value = null;
        let partial = false;
        let coverage = 1;
        if (s.group) {
          res = D.score(pl.player, null, s.group, wp);
          const v = D.valueOf(res, true, o.minCoverage);
          value = v.value;
          partial = v.partial;
          if (partial && res.partial) coverage = res.partial.coverage;
        }
        cell.set(`${s.key}|${pl.id}`, { value, partial, coverage, contributions: res ? res.contributions : [], eligible: el.ok, flag: el.flag, natural: el.ok && !el.flag });
      }
    }
    return { o, slots, info, cell, wp };
  }

  const cellOf = (ctx, slot, pl) => ctx.cell.get(`${slot.key}|${pl.id}`);
  const usable = (c) => c && c.eligible && c.value !== null;

  // ---------------------------------------------------------------- nejlepší jedenáctka (přesné přiřazení)
  /** bestEleven(ctx, locked) → [{slot, player|null}] pro každé místo. `locked` (Map klíč místa → hráč) jsou místa, která uživatel obsadil sám:
      ta se nemění a jejich hráči se jinde nepoužijí; zbylá místa se obsadí přesně (maďarský algoritmus). */
  function bestEleven(ctx, locked) {
    const { slots, info } = ctx;
    if (!slots.length) return [];
    const lockedIds = new Set([...locked.values()].filter(Boolean).map((p) => p.id));
    const free = slots.filter((s) => !locked.has(s.key));
    const avail = info.filter((p) => !p.injured && !lockedIds.has(p.id));
    // sloupce: dostupní hráči + prázdná místa (místo bez použitelného hráče); zisk je fit × 10 + 1, prázdné místo 0
    const gain = free.map((s) => [...avail.map((p) => (usable(cellOf(ctx, s, p)) ? Math.round(cellOf(ctx, s, p).value * 10) + 1 : 0)), ...free.map(() => 0)]);
    const pick = free.length ? RF.hungarianMax(gain) : [];
    const chosen = new Map();
    free.forEach((s, i) => {
      const j = pick[i];
      chosen.set(s.key, j < avail.length && gain[i][j] > 0 ? avail[j] : null);
    });
    return slots.map((s) => ({ slot: s, player: locked.has(s.key) ? locked.get(s.key) : chosen.get(s.key) || null }));
  }

  // ---------------------------------------------------------------- skupiny pozic a hloubka
  function groupDepth(ctx, xiMap) {
    const out = [];
    const groups = [...new Set(ctx.slots.map((s) => s.group).filter(Boolean))];
    for (const g of groups) {
      const gs = ctx.slots.filter((s) => s.group === g);
      const eligible = ctx.info.filter((p) => !p.injured && gs.some((s) => usable(cellOf(ctx, s, p))));
      const natural = eligible.filter((p) => gs.some((s) => usable(cellOf(ctx, s, p)) && cellOf(ctx, s, p).natural));
      const target = gs.length * ctx.o.perSlot;
      const starters = new Set(gs.map((s) => (xiMap.get(s.key) || {}).id).filter(Boolean));
      const backups = eligible.filter((p) => !starters.has(p.id));
      let state = 'ok';
      if (eligible.length < gs.length) state = 'gap';
      else if (eligible.length === gs.length) state = 'single';
      else if (eligible.length < target) state = 'thin';
      out.push({ group: g, slots: gs.map((s) => s.key), positions: gs.map((s) => s.pos), target, eligible: eligible.length, natural: natural.length, backups: backups.length, state });
    }
    return out;
  }

  // ---------------------------------------------------------------- hlavní rozbor
  /** analyze(tactic, players, opts) → rozbor sestavy. opts: {wp, perSlot, cliffGap, weakValue, swapGain, veteranAge, successorMaxAge, minCoverage, unavailable: [id]}. */
  function analyze(tactic, players, opts) {
    const ctx = prepare(tactic, players, opts);
    const { o, slots, info } = ctx;
    const res = {
      version: VERSION,
      formation: isObj(tactic) ? tactic.formation || null : null,
      model: 'DWRS po skupinách pozic (ESTIMATED), bez rolí',
      usable: false,
      coverage: { players: info.length, complete: 0, partial: 0, none: 0, withAge: 0, injured: info.filter((p) => p.injured).length },
      xi: [],
      user: { picked: 0, avg: null, bestAvg: null },
      swaps: [],
      depth: [],
      findings: [],
      strengths: [],
      age: null,
      notes: [],
    };
    for (const p of info) {
      if (p.age !== null) res.coverage.withAge++;
      const any = slots.some((s) => cellOf(ctx, s, p) && cellOf(ctx, s, p).value !== null);
      if (!p.attrsCount) res.coverage.none++;
      else if (any && slots.some((s) => cellOf(ctx, s, p) && cellOf(ctx, s, p).value !== null && !cellOf(ctx, s, p).partial)) res.coverage.complete++;
      else res.coverage.partial++;
    }
    if (!slots.length) {
      res.notes.push('Taktika nemá žádná místa.');
      return res;
    }
    if (!info.length) {
      res.notes.push('Soupiska je prázdná: přidej hráče v Můj tým nebo je načti ze snímku či tabulky.');
      return res;
    }
    if (slots.every((s) => !s.group)) {
      res.notes.push('Žádnou pozici taktiky nejde zařadit do skupiny pozic.');
      return res;
    }
    const best = bestEleven(ctx, new Map()); // nejlepší jedenáctka podle modelu bez ohledu na to, koho uživatel zadal
    const userMap = new Map();
    for (const s of slots) if (s.playerId) userMap.set(s.key, info.find((p) => p.id === s.playerId) || null);
    const locked = new Map([...userMap].filter(([, p]) => p));
    const xiMap = new Map(bestEleven(ctx, locked).map((b) => [b.slot.key, b.player])); // základní jedenáctka: co uživatel zadal, zbytek doplní model
    res.usable = best.some((b) => b.player);

    // jedenáctka po místech: nejlepší podle modelu, a co v taktice zadal uživatel
    for (const b of best) {
      const s = b.slot;
      const entry = (p) => {
        if (!p) return null;
        const c = cellOf(ctx, s, p);
        return { id: p.id, name: p.name, score: c && c.value !== null ? r1(c.value) : null, partial: !!(c && c.partial), coverage: c && c.partial ? c.coverage : 1, natural: !!(c && c.natural), injured: p.injured, age: p.age };
      };
      const u = userMap.get(s.key);
      const st = xiMap.get(s.key);
      res.xi.push({ slotKey: s.key, pos: s.pos, group: s.group, groupCs: s.group ? gname(s.group) : null, best: entry(b.player), user: s.playerId ? entry(u) || { id: s.playerId, name: '?', score: null } : null, starter: entry(st), source: userMap.get(s.key) ? 'user' : 'model' });
    }
    const avgOf = (list) => {
      const v = list.filter((e) => e && isNum(e.score)).map((e) => e.score);
      return v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null;
    };
    res.user.picked = res.xi.filter((e) => e.user).length;
    res.user.avg = res.user.picked === res.xi.length ? avgOf(res.xi.map((e) => e.user)) : null;
    res.user.bestAvg = avgOf(res.xi.map((e) => e.best));

    // výměny: jen když má uživatel místo obsazené a model našel hráče o `swapGain` bodů lepšího
    if (res.user.picked === res.xi.length) {
      for (const e of res.xi) {
        if (!e.user || !e.best || e.user.id === e.best.id) continue;
        const gain = (e.best.score || 0) - (e.user.score === null ? 0 : e.user.score);
        if (e.user.score !== null && gain >= o.swapGain) res.swaps.push({ slotKey: e.slotKey, pos: e.pos, current: e.user, better: e.best, gain: r1(gain) });
        else if (e.user.score === null && e.best.score !== null) res.swaps.push({ slotKey: e.slotKey, pos: e.pos, current: e.user, better: e.best, gain: null });
      }
      res.swaps.sort((a, b) => (b.gain === null ? 1e9 : b.gain) - (a.gain === null ? 1e9 : a.gain));
    }

    // hloubka po skupinách
    res.depth = groupDepth(ctx, xiMap);
    const findings = [];
    const F = (id, sev, area, basis, agree, title, why, fix, ev, extra) => findings.push(Object.assign({ id, sev, area, basis, basisCs: BASIS_CS[basis], agree, title, why, fix, ev: ev.filter(Boolean), slots: [], players: [] }, extra || {}));
    const nameOf = (id) => (info.find((p) => p.id === id) || {}).name || '?';

    for (const d of res.depth) {
      const posText = [...new Set(d.positions)].join(', ');
      const free = ctx.info.filter((p) => !p.injured && !d.slots.some((k) => usable(cellOf(ctx, slots.find((s) => s.key === k), p))) && d.slots.some((k) => { const c = cellOf(ctx, slots.find((s) => s.key === k), p); return c && c.value !== null; }));
      const rank = (p) => Math.max(...d.slots.map((k) => { const c = cellOf(ctx, slots.find((s) => s.key === k), p); return c && c.value !== null ? c.value : -1; }));
      const ideas = free.sort((a, b) => rank(b) - rank(a)).slice(0, 2).map((p) => `${p.name} (hraje jinde, podle atributů by se na ${gname(d.group)} hodil na ${cz(rank(p))} bodů, odhad)`);
      const need = D.DEFAULT_TABLES[d.group] ? D.DEFAULT_TABLES[d.group].extreme.join(', ') : '';
      if (d.state === 'gap') {
        F('G1', 'error', 'Hloubka', 'VYPOCET', 'výpočet',
          `${gname(d.group)} (${posText}): chybí hráči i na základ`,
          `Na ${d.slots.length} ${ui2(d.slots.length)} máš ${d.eligible} ${ui3(d.eligible)} s použitelným ohodnocením. Aplikace nepoužije hráče, kterému chybí atributy, ani hráče z jiné pozice bez tvého svolení.`,
          [`Doplnit hráče na pozici ${posText} (hledej podle nejdůležitějších atributů: ${need})`, ...(ideas.length ? [`Nebo zkusit z jiné pozice: ${ideas.join('; ')}`] : []), 'Zkontroluj, jestli hráčům na téhle pozici nechybí atributy nebo pozice v Můj tým'],
          [`míst: ${d.slots.length}`, `použitelných hráčů: ${d.eligible}`], { slots: d.slots });
      } else if (d.state === 'single') {
        F('G2', 'warn', 'Hloubka', 'KOMUNITA', 'komunitní cíl 2 hráči na místo',
          `${gname(d.group)} (${posText}): žádná záloha`,
          `Máš přesně tolik použitelných hráčů (${d.eligible}), kolik je míst (${d.slots.length}). Zraněný nebo unavený hráč na téhle pozici nemá kým být nahrazen. Komunitní cíl je dva hráči na místo.`,
          [`Přivést ${Math.max(1, d.target - d.eligible)} ${ui3(Math.max(1, d.target - d.eligible))} na pozici ${posText} (hledej: ${need})`, ...(ideas.length ? [`Nebo využít hráče z jiné pozice: ${ideas.join('; ')}`] : []), 'V Můj tým → Přestupy můžeš hledat kandidáty a vidět dopad příchodu na sestavu'],
          [`míst: ${d.slots.length}`, `použitelných hráčů: ${d.eligible}`, `cíl: ${d.target}`], { slots: d.slots });
      } else if (d.state === 'thin') {
        F('G3', 'note', 'Hloubka', 'KOMUNITA', 'komunitní cíl 2 hráči na místo',
          `${gname(d.group)} (${posText}): hloubka pod cílem`,
          `Použitelných hráčů je ${d.eligible}, cíl je ${d.target} (dva na místo). Záloha existuje, ale je tenká.`,
          [`Zvážit dalšího hráče na pozici ${posText} (hledej: ${need})`],
          [`míst: ${d.slots.length}`, `použitelných hráčů: ${d.eligible}`, `cíl: ${d.target}`], { slots: d.slots });
      } else if (d.natural < d.target && d.natural < d.eligible) {
        F('G4', 'note', 'Hloubka', 'KOMUNITA', 'komunitní průvodce',
          `${gname(d.group)} (${posText}): málo přirozených hráčů`,
          `Hráčů celkem je dost, ale jen ${d.natural} má tuhle pozici jako svou; ostatní by tam hráli s nižší jistotou.`,
          [`Ověř v Můj tým pozice hráčů; případně doplnit přirozeného hráče na pozici ${posText}`],
          [`přirozených: ${d.natural}`, `použitelných celkem: ${d.eligible}`, `cíl: ${d.target}`], { slots: d.slots });
      }
    }

    // kvalita základních hráčů a kvalitní útes
    for (const e of res.xi) {
      const s = slots.find((x) => x.key === e.slotKey);
      if (!e.starter || !s.group) continue;
      const p = info.find((x) => x.id === e.starter.id);
      const c = cellOf(ctx, s, p);
      // hráč mimo svou pozici nebo s neznámou pozicí: skóre je jen odhad podle atributů skupiny
      if (!c.natural) {
        const known = p.positions.length > 0;
        F('P1', 'note', 'Pozice', 'VYPOCET', 'výpočet z tvých dat',
          known ? `${e.pos}: ${p.name} hraje mimo své pozice` : `${e.pos}: u hráče ${p.name} není známá pozice`,
          known ? `V Můj tým má hráč pozice ${p.positions.join(', ')}, ale taktika ho staví na ${e.pos}. Skóre je odhad podle atributů skupiny pozic; jistota pozice ve hře může být nižší.` : 'Hráč nemá v Můj tým uvedenou pozici, takže nejde ověřit, jestli na místo patří. Skóre je odhad podle atributů.',
          [known ? 'Nasaď ho na přirozené místo, nebo si ve hře ověř jeho jistotu na téhle pozici' : 'Doplň pozici hráče v Můj tým'],
          [known ? `pozice hráče: ${p.positions.join(', ')}` : 'pozice neznámá'], { slots: [s.key], players: [p.id] });
      }
      // viditelná slabina v nejdůležitějších atributech skupiny
      const weak = (c.contributions || []).filter((x) => (x.tier === 'extreme' || x.tier === 'important') && x.value <= o.weakValue).sort((a, b) => (a.tier === b.tier ? a.value - b.value : a.tier === 'extreme' ? -1 : 1));
      if (weak.length) {
        const ext = weak.some((x) => x.tier === 'extreme');
        F('Q1', ext ? 'warn' : 'note', 'Kvalita', 'ODHAD', 'odhad (tabulky DWRS)',
          `${e.pos}: ${p.name} má slabé atributy, na kterých u téhle pozice nejvíc záleží`,
          `Podle tabulek DWRS (odhad autora; skupina pozic: ${gname(s.group)}) patří tyhle atributy mezi ${ext ? 'nejdůležitější' : 'důležité'}; hráč má v nich nízkou hodnotu. Je to viditelná slabina, ne pravidlo hry.`,
          [`Zlepšit individuálním tréninkem: ${weak.slice(0, o.topAttrs).map((x) => x.attribute).join(', ')}`, 'Nebo zvážit jiného hráče na toto místo (viz výměny níž a hloubka)', 'Při zápase kryjte slabinu taktikou (jiná role nebo instrukce)'],
          weak.slice(0, o.topAttrs).map((x) => `${x.attribute}: ${x.value}`), { slots: [s.key], players: [p.id] });
      }
      // kvalitní útes: záloha je o `cliffGap` bodů pod základem
      const rest = info.filter((x) => x.id !== p.id && !x.injured && ![...xiMap.values()].some((q) => q && q.id === x.id)).map((x) => ({ x, v: usable(cellOf(ctx, s, x)) ? cellOf(ctx, s, x).value : null })).filter((z) => z.v !== null).sort((a, b) => b.v - a.v);
      if (rest.length && e.starter.score !== null && e.starter.score - rest[0].v >= o.cliffGap) {
        F('Q2', 'note', 'Hloubka', 'ODHAD', 'odhad (rozdíl bodů DWRS)',
          `${e.pos}: velký propad mezi ${p.name} a zálohou`,
          `Základní hráč má podle modelu ${cz(e.starter.score)} bodů, nejlepší záloha ${nameOf(rest[0].x.id)} ${cz(rest[0].v)}. Při výpadku hráče je to propad o ${cz(e.starter.score - rest[0].v)} bodů.`,
          [`Přivést kvalitnější zálohu na pozici ${e.pos} (hledej: ${D.DEFAULT_TABLES[s.group].extreme.join(', ')})`, 'Nebo hráče střídat dřív a šetřit (únava)'],
          [`${p.name}: ${cz(e.starter.score)}`, `${nameOf(rest[0].x.id)}: ${cz(rest[0].v)}`], { slots: [s.key], players: [p.id, rest[0].x.id] });
      }
    }

    // věk: stárnoucí základní hráč bez nástupce
    const unknownAge = res.xi.filter((e) => e.starter && e.starter.age === null).length;
    for (const e of res.xi) {
      if (!e.starter || e.starter.age === null || e.starter.age < o.veteranAge) continue;
      const s = slots.find((x) => x.key === e.slotKey);
      const heirs = info.filter((x) => x.age !== null && x.age <= o.successorMaxAge && !x.injured && slots.some((t) => t.group === s.group && usable(cellOf(ctx, t, x))));
      if (!heirs.length) {
        F('A1', 'note', 'Věk', 'KOMUNITA', 'komunitní průvodce (věkové křivky jsou odhad)',
          `${e.pos}: ${e.starter.name} (${e.starter.age}) nemá mladšího nástupce`,
          `Základní hráč je od ${o.veteranAge} let a mezi hráči téhle skupiny pozic (${gname(s.group)}) není nikdo do ${o.successorMaxAge} let. Věk, od kterého výkon klesá, se liší podle pozice; je to komunitní odhad, ne pravidlo hry.`,
          [`Najít nástupce do ${o.successorMaxAge} let na pozici ${e.pos} (hledej: ${D.DEFAULT_TABLES[s.group].extreme.join(', ')})`, 'Hlídej smlouvu a formu hráče (smlouvy aplikace zatím nezná)'],
          [`věk: ${e.starter.age}`], { slots: [s.key], players: [e.starter.id] });
      }
    }
    if (res.coverage.withAge > 0) {
      const ages = res.xi.filter((e) => e.starter && e.starter.age !== null).map((e) => e.starter.age);
      if (ages.length) {
        const avg = ages.reduce((t, v) => t + v, 0) / ages.length;
        const all = info.filter((p) => p.age !== null).map((p) => p.age);
        res.age = { avgXi: r1(avg), xiKnown: ages.length, buckets: { u21: all.filter((a) => a <= 21).length, mid: all.filter((a) => a >= 22 && a <= 29).length, o30: all.filter((a) => a >= 30).length }, unknownXi: unknownAge };
      }
    }
    // zranění v zadané jedenáctce
    for (const s of slots) {
      const u = userMap.get(s.key);
      if (u && u.injured) {
        F('I1', 'warn', 'Dostupnost', 'VYPOCET', 'výpočet z tvých dat',
          `${s.pos}: ${u.name} je v sestavě, ale je označený jako zraněný`,
          'V Můj tým je u hráče příznak zranění; do nejlepší jedenáctky se takový hráč nedává.',
          [`Vyměnit za ${xiMap.get(s.key) ? xiMap.get(s.key).name : 'dostupného hráče'}`, 'Nebo příznak zranění v Můj tým zrušit, když už je hráč zdravý'],
          [`${u.name}: zraněn`], { slots: [s.key], players: [u.id] });
      }
    }

    // silné stránky
    const strong = res.xi.filter((e) => e.starter && e.starter.score !== null).map((e) => {
      const s = slots.find((x) => x.key === e.slotKey);
      const c = cellOf(ctx, s, info.find((x) => x.id === e.starter.id));
      const top = (c.contributions || []).filter((x) => (x.tier === 'extreme' || x.tier === 'important') && x.value >= 15).sort((a, b) => b.value - a.value);
      return { e, top };
    }).filter((z) => z.top.length >= 2).sort((a, b) => b.top.length - a.top.length || b.e.starter.score - a.e.starter.score).slice(0, 4);
    for (const z of strong) {
      findings.push({
        id: 'S1', sev: 'good', area: 'Kvalita', basis: 'ODHAD', basisCs: BASIS_CS.ODHAD, agree: 'odhad (tabulky DWRS)',
        title: `${z.e.pos}: ${z.e.starter.name} je silný v nejdůležitějších atributech pozice`,
        why: `Má aspoň dva z nejdůležitějších atributů své skupiny pozic (${gname(z.e.group)}) na 15 a víc. Je to viditelná silná stránka podle odhadu DWRS, ne pravidlo hry.`,
        fix: [], ev: z.top.slice(0, 3).map((x) => `${x.attribute}: ${x.value}`), slots: [z.e.slotKey], players: [z.e.starter.id],
      });
    }
    for (const d of res.depth) {
      if (d.state === 'ok' && d.natural >= d.target) {
        findings.push({ id: 'S2', sev: 'good', area: 'Hloubka', basis: 'KOMUNITA', basisCs: BASIS_CS.KOMUNITA, agree: 'komunitní cíl 2 hráči na místo', title: `${gname(d.group)} (${[...new Set(d.positions)].join(', ')}): hloubka je v pořádku`, why: `Na ${d.slots.length} ${ui2(d.slots.length)} máš ${d.natural} přirozených hráčů (cíl ${d.target}).`, fix: [], ev: [`použitelných hráčů: ${d.eligible}`], slots: d.slots, players: [] });
      }
    }
    if (res.age && res.age.avgXi >= 25 && res.age.avgXi <= 28 && res.age.xiKnown === res.xi.filter((e) => e.starter).length) {
      findings.push({ id: 'S3', sev: 'good', area: 'Věk', basis: 'KOMUNITA', basisCs: BASIS_CS.KOMUNITA, agree: 'komunitní průvodce', title: `Průměrný věk jedenáctky je ${cz(res.age.avgXi)}`, why: 'Komunitní průvodci doporučují průměr základního týmu 25 až 28 let. Je to odhad, ne pravidlo.', fix: [], ev: [`věk: ${cz(res.age.avgXi)}`], slots: [], players: [] });
    }

    findings.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.id.localeCompare(b.id));
    res.findings = findings.filter((f) => f.sev !== 'good');
    res.strengths = findings.filter((f) => f.sev === 'good');
    if (res.coverage.none) res.notes.push(`${res.coverage.none} ${ui3(res.coverage.none)} nemá žádné atributy, takže se neohodnotí.`);
    if (unknownAge) res.notes.push(`U ${unknownAge} ${ui3(unknownAge)} v jedenáctce chybí věk, věkové kontroly je nezahrnují.`);
    res.notes.push('Smlouvy, morálku ani formu aplikace zatím nezná, proto je v rozboru nehlídá.');
    return res;
  }

  // malé pomocné skloňování (jen pro texty tohoto modulu)
  function ui2(n) {
    return n === 1 ? 'místo' : n >= 2 && n <= 4 ? 'místa' : 'míst';
  }
  function ui3(n) {
    return n >= 1 && n <= 4 ? 'hráče' : 'hráčů';
  }

  /** Souhrn jako řádky textu (kopírování, kontext pro Osobního trenéra). */
  function summaryLines(r) {
    const lines = [];
    lines.push(`Rozbor sestavy ${r.formation || '?'}: hráčů ${r.coverage.players} (úplné atributy ${r.coverage.complete}, částečné ${r.coverage.partial}, žádné ${r.coverage.none}); model ${r.model}.`);
    if (r.user.avg !== null) lines.push(`Průměr tvé jedenáctky ${cz(r.user.avg)} bodu na místo, nejlepší podle modelu ${cz(r.user.bestAvg)} (odhad).`);
    for (const f of r.findings) lines.push(`${SEV_CS[f.sev]} [${f.id}] ${f.title}: ${f.ev.join('; ')}. Co udělat: ${f.fix.join(' / ')}`);
    for (const f of r.strengths) lines.push(`Silná stránka [${f.id}] ${f.title}`);
    for (const s of r.swaps) lines.push(`Výměna ${s.pos}: ${s.current.name} → ${s.better.name}${s.gain === null ? '' : ` (+${cz(s.gain)} bodů)`}`);
    return lines;
  }

  return { VERSION, DEFAULTS, SEV_CS, BASIS_CS, analyze, summaryLines };
});
