/* FM27 Tactical Coach: nejlepší sestava A a B, omezení, hloubka, dopad změn (čistý modul bez DOM, sítě a AI).

   METODA: přiřazení hráčů k místům taktiky maďarským algoritmem (přesné optimum, ne odhad postupu). Sestava A (základní jedenáctka) a sestava B (druhá jedenáctka, „nejlepší lavička“)
   se počítají v JEDNÉ úloze s přísným pořadím cílů: 1) co nejvíc obsazených míst A, 2) největší součet vhodnosti A, 3) co nejvíc obsazených míst B, 4) největší součet B.
   Pořadí je vynucené celočíselným kódováním zisků (každá úroveň je větší než součet všech nižších), takže B nikdy nepřebije A, ale při shodě v A vybere nejlepší B.
   Zdroj principu (strategie „A potom B“, přísné pořadí, simulace příchodu hráče jako přepočet) je veřejně popsaná metoda projektu FM Player Analyzer (GPL-3.0) a omezení hráčů
   (zámky, vyřazení, zranění, náhrady s upozorněním „naruší jiné místo“) princip projektu FM AI Assistent (bez licence): odtud je jen myšlenka, žádný kód ani tabulka. Kód je vlastní.

   Model hodnocení: 'simple' (vážený průměr klíčových a žádoucích atributů role, rolefit.js) nebo 'dwrs' (kategorie atributů a násobiče role, dwrs.js). Obě čísla jsou HEURISTIKA TÉTO
   APLIKACE, ne pravidlo FM27; DWRS tabulky jsou ESTIMATED a dají se upravit. Prahy (slabé místo, závažnost zranění) jsou CUSTOM MODEL a jdou nastavit.

   POCTIVOST: kdo nejde ohodnotit (chybí atribut, chybí profil role, neznámá skupina pozic), nedostane nulu, ale „nedostupné“ s důvodem. Zraněný hráč nebo hráč vyřazený uživatelem se do sestavy
   nedává. Zámek je rozhodnutí uživatele a drží vždycky (i mimo pozici, s příznakem); nepoužitelný zámek se nepřijme a je to napsané. Nic se v taktice nezmění samo: tahle vrstva jen počítá.
   Skryté údaje hry (CA, PA, osobnost, reputace) se nikdy nečtou. Čisté funkce: stejný vstup dá vždy stejný výstup, vstupy se nemění. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rolefit.js'), require('./dwrs.js'));
  else root.TrenerSquadOpt = factory(root.TrenerRoleFit, root.TrenerDwrs);
})(typeof self !== 'undefined' ? self : this, function (RF, DW) {
  'use strict';

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const cz = (v) => String(v).replace('.', ',');
  const V = 1000; // vhodnost 0 až 100,0 v desetinách bodu
  const MODELS = Object.freeze(['simple', 'dwrs']);
  const MODEL_CS = Object.freeze({
    simple: 'jednoduchý vážený průměr (klíčové atributy 2, žádoucí 1), heuristika aplikace',
    dwrs: 'DWRS: kategorie atributů a násobiče role (vlastní odhad aplikace, ESTIMATED)',
  });
  const DEFAULT_SEVERITY = Object.freeze({ critical: 15, medium: 6 }); // body součtu A (CUSTOM MODEL)
  const DEFAULT_WEAK_GAP = 8; // jako ve weakSpots v rolefit.js
  const SAFE_LIMIT = 2 ** 50;

  // ---------------------------------------------------------------- volby
  function cleanOpts(raw) {
    const o = isObj(raw) ? raw : {};
    const issues = [];
    const model = o.model === 'dwrs' ? 'dwrs' : 'simple';
    let wp = null;
    if (model === 'dwrs') {
      const n = DW.normalizeProfile(o.wp === undefined || o.wp === null ? DW.defaultProfile() : o.wp);
      wp = n.profile;
      issues.push(...n.issues);
    }
    const list = (v) => (Array.isArray(v) ? v.filter((x) => x !== undefined && x !== null) : []);
    return {
      model,
      wp,
      mode: o.mode === 'free' ? 'free' : 'strict',
      allowPartial: !!o.allowPartial,
      minCoverage: isNum(o.minCoverage) ? o.minCoverage : 0.8,
      weights: Object.assign({}, RF.DEFAULT_WEIGHTS, isObj(o.weights) ? o.weights : {}),
      bench: o.bench !== false,
      quick: !!o.quick,
      respectInjuries: o.respectInjuries !== false,
      locks: isObj(o.locks) ? o.locks : {},
      exclude: list(o.exclude),
      unavailable: list(o.unavailable),
      altCount: Number.isInteger(o.altCount) && o.altCount >= 0 && o.altCount <= 6 ? o.altCount : 3,
      weakGap: isNum(o.weakGap) ? o.weakGap : DEFAULT_WEAK_GAP,
      issues,
    };
  }

  // ---------------------------------------------------------------- hodnocení jedné dvojice místo × hráč
  /** Skupina pozic pro DWRS: výslovná u profilu role, jinak podle pozice místa (kde hráč stojí), jinak odhad z názvu role. */
  function groupFor(slot, profile) {
    if (profile && DW.GROUPS.includes(profile.group)) return profile.group;
    return DW.groupOfPosition(slot.pos) || DW.groupOfRole(profile) || null;
  }

  function cellFor(si, pl, o, ignorePosition) {
    if (!si.profile) return null;
    let flag = '';
    if (ignorePosition) {
      const el = RF.eligibility(si.slot.pos, pl.positions, 'strict');
      flag = el.ok ? el.flag : 'hráč nemá pozici místa (zamčeno uživatelem)';
    } else {
      const el = RF.eligibility(si.slot.pos, pl.positions, o.mode);
      if (!el.ok) return { eligible: false };
      flag = el.flag;
    }
    let fit;
    let value;
    let partial = false;
    if (o.model === 'dwrs') {
      if (!si.group) {
        fit = { score: null, partial: null, missing: [], contributions: [], reason: 'Skupinu pozic role nejde určit: nastav ji u profilu role.' };
        return { eligible: true, flag, fit, value: null, partial: false };
      }
      fit = DW.score(pl, si.profile, si.group, o.wp);
      const v = DW.valueOf(fit, o.allowPartial, o.minCoverage);
      value = v.value;
      partial = v.partial;
    } else {
      fit = RF.roleFit(pl, si.profile, { weights: o.weights });
      value = fit.score;
      if (value === null && o.allowPartial && fit.partial && fit.partial.coverage >= o.minCoverage) {
        value = fit.partial.score;
        partial = true;
      }
    }
    return { eligible: true, flag, fit, value, partial };
  }

  /** Příprava: vstupy a matice hodnocení (počítá se jednou, simulace ji používají znovu). */
  function prepare(input, rawOpts) {
    const o = cleanOpts(rawOpts);
    const src = isObj(input) ? input : {};
    const slots = (Array.isArray(src.slots) ? src.slots : []).filter(isObj);
    const seen = new Set();
    const players = (Array.isArray(src.players) ? src.players : []).filter((p) => {
      if (!isObj(p) || p.id === undefined || p.id === null || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    const index = RF.profilesIndex(src.profiles);
    const slotInfo = slots.map((s, i) => {
      const hasRole = typeof s.role === 'string' && s.role.trim() !== '';
      const profile = hasRole ? index.get(RF.roleKey(s.role)) || null : null;
      return { slot: s, key: s.key !== undefined && s.key !== null ? s.key : String(i), profile, hasRole, group: profile ? groupFor(s, profile) : null };
    });
    const cells = slotInfo.map((si) => players.map((pl) => cellFor(si, pl, o, false)));
    return { o, slots, players, slotInfo, cells, locked: new Map(), issues: o.issues.slice(), idIndex: new Map(players.map((p, j) => [p.id, j])) };
  }

  /** Hodnota dvojice v sestavě: u zamčené dvojice se pozice neposuzuje (zámek je rozhodnutí uživatele), jinak je to hodnota z matice. */
  function lockedCell(ctx, i, j) {
    const key = i + ':' + j;
    if (!ctx.locked.has(key)) ctx.locked.set(key, cellFor(ctx.slotInfo[i], ctx.players[j], ctx.o, true));
    return ctx.locked.get(key);
  }
  const cellOf = (ctx, cons, i, j) => (cons.locks.get(i) === j ? lockedCell(ctx, i, j) : ctx.cells[i][j]);
  const valueOf = (c) => (c && c.eligible && c.value !== null ? c.value : null);

  // ---------------------------------------------------------------- omezení: zámky, vyřazení, zranění
  const nameOf = (ctx, j) => (j === undefined ? 'neznámý hráč' : String(ctx.players[j].name || ctx.players[j].id).slice(0, 40));

  /** Omezení se ověří a nepoužitelné se nepřijme s vysvětlením (nikdy se nepředstírá, že platí). */
  function resolveConstraints(ctx, o) {
    const issues = [];
    const off = new Map();
    const reasonLabel = { excluded: 'vyřazen uživatelem', injured: 'zraněný nebo nedostupný' };
    for (const id of o.exclude) {
      const j = ctx.idIndex.get(id);
      if (j === undefined) issues.push('Vyřazený hráč není v soupisce, přeskočeno.');
      else off.set(j, 'excluded');
    }
    for (const id of o.unavailable) {
      const j = ctx.idIndex.get(id);
      if (j === undefined) issues.push('Nedostupný hráč není v soupisce, přeskočeno.');
      else if (!off.has(j)) off.set(j, 'injured');
    }
    if (o.respectInjuries) ctx.players.forEach((p, j) => { if (p.injured === true && !off.has(j)) off.set(j, 'injured'); });
    const locks = new Map();
    const lockedPlayers = new Set();
    for (const [slotKey, id] of Object.entries(o.locks)) {
      const i = ctx.slotInfo.findIndex((si) => String(si.key) === String(slotKey));
      if (i < 0) {
        issues.push(`Zámek na místo „${String(slotKey).slice(0, 20)}“: takové místo taktika nemá, zámek se ignoruje.`);
        continue;
      }
      const j = ctx.idIndex.get(id);
      if (j === undefined) {
        issues.push(`Zámek na místo ${ctx.slotInfo[i].slot.pos || slotKey}: zamčený hráč není v soupisce, zámek se ignoruje.`);
        continue;
      }
      if (off.has(j)) {
        issues.push(`Zámek ${nameOf(ctx, j)} na místo ${ctx.slotInfo[i].slot.pos || slotKey}: hráč je ${reasonLabel[off.get(j)]}, zámek se ignoruje.`);
        continue;
      }
      if (lockedPlayers.has(j)) {
        issues.push(`Hráč ${nameOf(ctx, j)} je zamčený na dvou místech, platí první.`);
        continue;
      }
      locks.set(i, j);
      lockedPlayers.add(j);
    }
    return { off, locks, lockedPlayers, issues };
  }
  const withLock = (cons, i, j) => {
    const locks = new Map(cons.locks);
    locks.set(i, j);
    return { off: cons.off, locks, lockedPlayers: new Set(locks.values()), issues: [] };
  };
  const withOff = (cons, j, why) => {
    const off = new Map(cons.off);
    off.set(j, why);
    const locks = new Map([...cons.locks].filter(([, lj]) => lj !== j));
    return { off, locks, lockedPlayers: new Set(locks.values()), issues: [] };
  };

  // ---------------------------------------------------------------- jádro: A a B v jedné úloze
  /** Pořadí cílů je v kódování zisků: tie-break (nejnižší) < součet B < počet obsazených B < součet A < počet obsazených A.
      Každá úroveň je větší než součet všech nižších, takže ji nelze přebít. Čísla zůstávají celá a hluboko pod 2^53. */
  function solve(ctx, cons, bench) {
    const n = ctx.slots.length;
    const cols = [];
    ctx.players.forEach((p, j) => {
      if (!cons.off.has(j) && !cons.lockedPlayers.has(j)) cols.push(j);
    });
    const rows = [];
    for (let i = 0; i < n; i++) if (!cons.locks.has(i)) rows.push({ i, kind: 'A' });
    if (bench) for (let i = 0; i < n; i++) rows.push({ i, kind: 'B' });
    const a = new Array(n).fill(null);
    const b = bench ? new Array(n).fill(null) : null;
    for (const [i, j] of cons.locks) a[i] = j;
    if (!rows.length) return { a, b };
    const total = ctx.players.length;
    const S0 = rows.length * (total + 1) + 1;
    const S1 = S0 * (n * V + 1);
    const S2 = S1 * (n + 1);
    const S3 = S2 * (n * V + 1);
    if (!(rows.length * (S3 + V * S2 + total) < SAFE_LIMIT)) throw new RangeError('Úloha je příliš velká (míst a hráčů je tolik, že by přesný součet přetekl).');
    const m = Math.max(cols.length, rows.length);
    const gain = rows.map((row) => {
      const out = new Array(m).fill(0);
      cols.forEach((j, c) => {
        const v = valueOf(ctx.cells[row.i][j]);
        if (v === null) return;
        const t = total - j; // při úplné shodě vyhrává hráč dřív v seznamu: výsledek je stálý
        out[c] = row.kind === 'A' ? t + S2 * Math.round(v * 10) + S3 : t + S0 * Math.round(v * 10) + S1;
      });
      return out;
    });
    const pick = RF.hungarianMax(gain);
    rows.forEach((row, r) => {
      const c = pick[r];
      const j = c >= 0 && c < cols.length && gain[r][c] > 0 ? cols[c] : null;
      if (row.kind === 'A') a[row.i] = j;
      else b[row.i] = j;
    });
    return { a, b };
  }

  /** Součty v desetinách bodu (celá čísla, přesné porovnání) a počty. */
  function tally(ctx, cons, sol) {
    const t = { aT: 0, aV: 0, aF: 0, bT: 0, bV: 0, bF: 0 };
    for (const [list, tk, vk, fk] of [[sol.a, 'aT', 'aV', 'aF'], [sol.b, 'bT', 'bV', 'bF']]) {
      if (!list) continue;
      list.forEach((j, i) => {
        if (j === null) return;
        t[fk]++;
        const v = valueOf(cellOf(ctx, cons, i, j));
        if (v !== null) {
          t[tk] += Math.round(v * 10);
          t[vk]++;
        }
      });
    }
    return t;
  }

  // ---------------------------------------------------------------- výsledek
  function placementMap(sol) {
    const m = new Map();
    sol.a.forEach((j, i) => { if (j !== null) m.set(j, { team: 'A', i }); });
    if (sol.b) sol.b.forEach((j, i) => { if (j !== null) m.set(j, { team: 'B', i }); });
    return m;
  }

  function unfilledReason(ctx, cons, i, kind, sol) {
    const si = ctx.slotInfo[i];
    if (!si.hasRole) return 'Místo nemá zadanou roli.';
    if (!si.profile) return `Chybí profil role „${String(si.slot.role).trim()}“: přečti ji z obrazovky role ve hře.`;
    if (ctx.o.model === 'dwrs' && !si.group) return 'Skupinu pozic role nejde určit: nastav ji u profilu role.';
    const eligible = ctx.players.map((p, j) => ({ j, c: ctx.cells[i][j] })).filter((x) => x.c && x.c.eligible);
    if (!eligible.length) return `Žádný hráč nemá pozici místa (${si.slot.pos || '?'}).`;
    const valued = eligible.filter((x) => x.c.value !== null);
    if (!valued.length) {
      const sample = eligible.map((x) => x.c.fit.missing).find((x) => x && x.length);
      return `Žádný vhodný hráč nemá všechny atributy role${sample ? ` (chybí například ${sample.slice(0, 3).join(', ')})` : ''}.`;
    }
    const usable = valued.filter((x) => !cons.off.has(x.j) && !cons.lockedPlayers.has(x.j));
    if (!usable.length) {
      const why = [...new Set(valued.map((x) => (cons.off.has(x.j) ? (cons.off.get(x.j) === 'injured' ? 'zranění' : 'vyřazení') : 'zamčení jinde')))];
      return `Všichni vhodní hráči jsou ${why.join(' nebo ')}.`;
    }
    void sol;
    return kind === 'A' ? 'Všichni způsobilí hráči jsou obsazeni na jiných místech.' : 'Na lavičku už nezbyl žádný způsobilý hráč.';
  }

  function mkAssignment(ctx, cons, sol, i, j, kind) {
    const si = ctx.slotInfo[i];
    const locked = kind === 'A' && cons.locks.get(i) === j && j !== null;
    const c = j !== null ? cellOf(ctx, cons, i, j) : null;
    const v = valueOf(c);
    const pl = j !== null ? ctx.players[j] : null;
    const a = {
      slotKey: si.key,
      pos: si.slot.pos || '',
      role: typeof si.slot.role === 'string' ? si.slot.role : '',
      duty: typeof si.slot.duty === 'string' ? si.slot.duty : '',
      kind,
      profile: si.profile ? si.profile.name : null,
      profileSource: si.profile ? si.profile.source : null,
      group: ctx.o.model === 'dwrs' ? si.group : null,
      player: pl ? { id: pl.id, name: pl.name } : null,
      fit: v,
      partial: v !== null ? c.partial : false,
      flag: pl && c ? c.flag : '',
      locked,
      contributions: v !== null ? c.fit.contributions : [],
      missing: c && c.eligible && c.fit ? c.fit.missing : [],
      detail: v !== null && ctx.o.model === 'dwrs' ? { absolute: c.fit.absolute, worst: c.fit.worst, best: c.fit.best, ignoredRoleAttributes: c.fit.ignoredRoleAttributes || [] } : null,
      alternatives: [],
      reason: '',
    };
    if (!pl) a.reason = unfilledReason(ctx, cons, i, kind, sol);
    else if (v === null) a.reason = `Zamčeno uživatelem, ale vhodnost nejde spočítat${c && c.fit && c.fit.reason ? ': ' + c.fit.reason.replace(/\.$/, '') : ''}.`;
    return a;
  }

  function totalsOf(list) {
    const filled = list.filter((a) => a.player);
    const valued = filled.filter((a) => a.fit !== null);
    const tenths = valued.reduce((s, a) => s + Math.round(a.fit * 10), 0);
    return { assignments: list, filled: filled.length, valued: valued.length, unfilled: list.length - filled.length, total: tenths / 10, avg: valued.length ? r1(tenths / 10 / valued.length) : null, tenths };
  }

  function build(ctx, cons, sol) {
    const n = ctx.slots.length;
    const aList = [];
    for (let i = 0; i < n; i++) aList.push(mkAssignment(ctx, cons, sol, i, sol.a[i], 'A'));
    const a = totalsOf(aList);
    let b = null;
    if (sol.b) {
      const bList = [];
      for (let i = 0; i < n; i++) bList.push(mkAssignment(ctx, cons, sol, i, sol.b[i], 'B'));
      b = totalsOf(bList);
    }
    return { model: ctx.o.model, modelInfo: MODEL_CS[ctx.o.model], options: publicOptions(ctx.o), a, b };
  }

  function publicOptions(o) {
    return { model: o.model, mode: o.mode, allowPartial: o.allowPartial, minCoverage: o.minCoverage, weights: Object.assign({}, o.weights), bench: o.bench, respectInjuries: o.respectInjuries, wpName: o.wp ? o.wp.name : null };
  }

  // ---------------------------------------------------------------- náhrady s dopadem, hloubka, kdo zbyl
  const deltaText = (d) => (d === 0 ? 'beze změny' : `${d > 0 ? 'vzroste' : 'klesne'} o ${cz(Math.abs(d))}`);

  function alternativesFor(ctx, cons, sol, base, i) {
    if (!ctx.o.altCount) return [];
    const placement = placementMap(sol);
    const cands = [];
    ctx.players.forEach((p, j) => {
      if (j === sol.a[i] || cons.off.has(j) || (cons.lockedPlayers.has(j) && cons.locks.get(i) !== j)) return;
      const c = ctx.cells[i][j];
      if (valueOf(c) === null) return;
      cands.push({ j, c });
    });
    cands.sort((x, y) => y.c.value - x.c.value || x.j - y.j);
    return cands.slice(0, ctx.o.altCount).map(({ j, c }) => {
      const cons2 = withLock(cons, i, j);
      // zámek nahradí případný starý zámek tohoto místa: hráč, který byl zamčený jinde, sem nepatří
      if (cons.locks.get(i) !== undefined && cons.locks.get(i) !== j) cons2.lockedPlayers = new Set(cons2.locks.values());
      const sol2 = solve(ctx, cons2, ctx.o.bench);
      const t2 = tally(ctx, cons2, sol2);
      const where = placement.get(j) || null;
      const status = !where ? 'free' : where.team === 'A' ? 'startsElsewhere' : 'bench';
      const at = where ? ctx.slotInfo[where.i].key : null;
      const deltaA = (t2.aT - base.aT) / 10;
      const deltaB = ctx.o.bench ? (t2.bT - base.bT) / 10 : null;
      const p = ctx.players[j];
      const who = `${p.name} (vhodnost ${cz(c.value)}${c.partial ? ', částečná data' : ''})`;
      const where2 = status === 'startsElsewhere' ? `, ale hraje jinde (${ctx.slotInfo[where.i].slot.pos || at}), takže se naruší to místo` : status === 'bench' ? ', teď je na lavičce' : ', teď nehraje';
      return {
        id: p.id, name: p.name, fit: c.value, partial: c.partial, status, at,
        disrupts: status === 'startsElsewhere' ? at : null,
        deltaA, deltaB, filledA: t2.aV - base.aV,
        text: `${who}${where2}; součet sestavy A ${deltaText(deltaA)}${t2.aV !== base.aV ? ` (obsazených míst ${t2.aV > base.aV ? 'víc' : 'méně'})` : ''}.`,
      };
    });
  }

  function depthOf(ctx, cons) {
    return ctx.slotInfo.map((si, i) => {
      const list = [];
      ctx.players.forEach((p, j) => {
        if (cons.off.has(j) || (cons.lockedPlayers.has(j) && cons.locks.get(i) !== j)) return;
        const v = valueOf(ctx.cells[i][j]);
        if (v !== null) list.push({ j, id: p.id, name: p.name, fit: v, partial: ctx.cells[i][j].partial });
      });
      list.sort((x, y) => y.fit - x.fit || x.j - y.j);
      const injured = ctx.players.filter((p, j) => cons.off.get(j) === 'injured' && valueOf(ctx.cells[i][j]) !== null).length;
      return {
        slotKey: si.key, pos: si.slot.pos || '', role: typeof si.slot.role === 'string' ? si.slot.role : '',
        candidates: list.length,
        coverage: list.length === 0 ? 'gap' : list.length === 1 ? 'thin' : 'covered',
        best: list.slice(0, 3).map(({ id, name, fit, partial }) => ({ id, name, fit, partial })),
        injuredCandidates: injured,
      };
    });
  }

  function leftOutOf(ctx, cons, sol) {
    const placement = placementMap(sol);
    const out = [];
    ctx.players.forEach((p, j) => {
      if (placement.has(j)) return;
      let code;
      let text;
      if (cons.off.has(j)) {
        code = cons.off.get(j);
        text = code === 'injured' ? 'zraněný nebo nedostupný, do sestavy se nedává' : 'vyřazen uživatelem';
      } else {
        let anyProfile = false;
        let anyEligible = false;
        let anyValue = false;
        let sample = null;
        ctx.slotInfo.forEach((si, i) => {
          if (!si.profile) return;
          anyProfile = true;
          const c = ctx.cells[i][j];
          if (!c || !c.eligible) return;
          anyEligible = true;
          if (c.value !== null) anyValue = true;
          else if (!sample && c.fit && c.fit.missing && c.fit.missing.length) sample = c.fit.missing;
        });
        if (!anyProfile) [code, text] = ['noProfile', 'v taktice není místo s profilem role'];
        else if (!anyEligible) [code, text] = ['noSlot', 'nemá pozici žádného místa v téhle taktice'];
        else if (!anyValue) [code, text] = ['noValue', `nejde ohodnotit${sample ? ` (chybí například ${sample.slice(0, 3).join(', ')})` : ''}`];
        else [code, text] = ['surplus', 'na A ani B se nevešel, každé místo má lepšího hráče'];
      }
      out.push({ id: p.id, name: p.name, code, text });
    });
    return out;
  }

  function extras(ctx, cons, sol, out, base) {
    out.a.assignments.forEach((a, i) => { a.alternatives = alternativesFor(ctx, cons, sol, base, i); });
    out.weak = RF.weakSpots({ assignments: out.a.assignments }, { gap: ctx.o.weakGap });
    out.depth = depthOf(ctx, cons);
    out.leftOut = leftOutOf(ctx, cons, sol);
    out.unavailable = ctx.players.map((p, j) => ({ id: p.id, name: p.name, code: cons.off.get(j) })).filter((x) => x.code);
    out.missingProfiles = [...new Set(ctx.slotInfo.filter((si) => si.hasRole && !si.profile).map((si) => String(si.slot.role).trim()))];
  }

  /** optimize({slots, players, profiles}, opts) → sestava A (a) a B (b), slabá místa, hloubka, kdo zbyl, omezení s vysvětlením.
      opts: {model:'simple'|'dwrs', wp, mode:'strict'|'free', allowPartial, minCoverage, weights, bench:true, locks:{slotKey:playerId}, exclude:[id], unavailable:[id],
             respectInjuries:true (hráč s injured:true se nepoužije), altCount:3, weakGap:8, quick:false (bez náhrad a hloubky)}. */
  function optimize(input, rawOpts) {
    const ctx = prepare(input, rawOpts);
    const cons = resolveConstraints(ctx, ctx.o);
    const sol = solve(ctx, cons, ctx.o.bench);
    const out = build(ctx, cons, sol);
    out.issues = ctx.issues.concat(cons.issues);
    out.locks = [...cons.locks].map(([i, j]) => ({ slotKey: ctx.slotInfo[i].key, playerId: ctx.players[j].id }));
    if (!ctx.o.quick) extras(ctx, cons, sol, out, tally(ctx, cons, sol));
    return out;
  }

  // ---------------------------------------------------------------- změna a její dopad
  const placeOf = (list) => new Map(list.map((a) => [a.slotKey, a]));
  const brief = (a) => (a && a.player ? { id: a.player.id, name: a.player.name, fit: a.fit } : null);

  /** diffResults(before, after) → rozdíl součtů a změny po místech (kdo kde přibyl, ubyl, o kolik se změnila vhodnost). */
  function diffResults(before, after) {
    const team = (x, y) => (x && y ? { totalBefore: x.total, totalAfter: y.total, delta: r1(y.total - x.total), filledBefore: x.valued, filledAfter: y.valued } : null);
    const changes = [];
    for (const which of ['a', 'b']) {
      if (!before[which] || !after[which]) continue;
      const bm = placeOf(before[which].assignments);
      for (const y of after[which].assignments) {
        const x = bm.get(y.slotKey);
        const same = x && ((x.player && y.player && x.player.id === y.player.id) || (!x.player && !y.player));
        if (same) continue;
        const from = brief(x);
        const to = brief(y);
        changes.push({ team: which.toUpperCase(), slotKey: y.slotKey, pos: y.pos, role: y.role, from, to, delta: from && to && from.fit !== null && to.fit !== null ? r1(to.fit - from.fit) : null });
      }
    }
    return { a: team(before.a, after.a), b: team(before.b, after.b), changes };
  }

  /** simulateChange(input, opts, change) → {ok, before, after, diff, issues}. change: {type:'lock', slotKey, playerId} | {type:'unlock', slotKey} | {type:'exclude', playerId}
      | {type:'injure', playerId} | {type:'add', player} (příchod hráče) | {type:'remove', playerId} (odchod). Nic se nemění v taktice ani v soupisce. */
  function simulateChange(input, rawOpts, change) {
    const base = Object.assign({}, isObj(rawOpts) ? rawOpts : {}, { quick: true });
    const src = isObj(input) ? input : {};
    const c = isObj(change) ? change : {};
    let inp = src;
    const o2 = Object.assign({}, base);
    const players = Array.isArray(src.players) ? src.players : [];
    switch (c.type) {
      case 'lock':
        o2.locks = Object.assign({}, base.locks, { [String(c.slotKey)]: c.playerId });
        break;
      case 'unlock': {
        o2.locks = Object.assign({}, base.locks);
        delete o2.locks[String(c.slotKey)];
        break;
      }
      case 'exclude':
        o2.exclude = (Array.isArray(base.exclude) ? base.exclude : []).concat([c.playerId]);
        break;
      case 'injure':
        o2.unavailable = (Array.isArray(base.unavailable) ? base.unavailable : []).concat([c.playerId]);
        break;
      case 'add':
        if (!isObj(c.player) || c.player.id === undefined || c.player.id === null) return { ok: false, issues: ['Nový hráč nemá id.'] };
        if (players.some((p) => isObj(p) && p.id === c.player.id)) return { ok: false, issues: ['Hráč s tímhle id už v soupisce je.'] };
        inp = Object.assign({}, src, { players: players.concat([c.player]) });
        break;
      case 'remove':
        if (!players.some((p) => isObj(p) && p.id === c.playerId)) return { ok: false, issues: ['Hráč není v soupisce.'] };
        inp = Object.assign({}, src, { players: players.filter((p) => !(isObj(p) && p.id === c.playerId)) });
        break;
      default:
        return { ok: false, issues: ['Neznámý druh změny.'] };
    }
    const before = optimize(src, base);
    const after = optimize(inp, o2);
    return { ok: true, before, after, diff: diffResults(before, after), issues: after.issues.filter((x) => !before.issues.includes(x)) };
  }

  /** injuryImpact(input, opts, {critical, medium}) → pro každého hráče základní sestavy: co se stane, když vypadne (kdo ho nahradí, o kolik klesne součet A). */
  function injuryImpact(input, rawOpts, iopts) {
    const sev = Object.assign({}, DEFAULT_SEVERITY, isObj(iopts) ? iopts : {});
    const ctx = prepare(input, Object.assign({}, isObj(rawOpts) ? rawOpts : {}, { quick: true }));
    const cons = resolveConstraints(ctx, ctx.o);
    const sol = solve(ctx, cons, ctx.o.bench);
    const base = tally(ctx, cons, sol);
    const rank = { critical: 0, medium: 1, low: 2 };
    const out = [];
    sol.a.forEach((j, i) => {
      if (j === null) return;
      const cons2 = withOff(cons, j, 'injured');
      const sol2 = solve(ctx, cons2, ctx.o.bench);
      const t2 = tally(ctx, cons2, sol2);
      const deltaA = (t2.aT - base.aT) / 10;
      const filledDrop = base.aV - t2.aV;
      const severity = filledDrop > 0 || deltaA <= -sev.critical ? 'critical' : deltaA <= -sev.medium ? 'medium' : 'low';
      const replacements = [];
      sol.a.forEach((jb, k) => {
        const ja = sol2.a[k];
        if (jb === ja) return;
        const vb = jb !== null ? valueOf(cellOf(ctx, cons, k, jb)) : null;
        const va = ja !== null ? valueOf(cellOf(ctx, cons2, k, ja)) : null;
        replacements.push({
          slotKey: ctx.slotInfo[k].key, pos: ctx.slotInfo[k].slot.pos || '', role: typeof ctx.slotInfo[k].slot.role === 'string' ? ctx.slotInfo[k].slot.role : '',
          from: jb !== null ? { id: ctx.players[jb].id, name: ctx.players[jb].name, fit: vb } : null,
          to: ja !== null ? { id: ctx.players[ja].id, name: ctx.players[ja].name, fit: va } : null,
        });
      });
      out.push({
        playerId: ctx.players[j].id, name: ctx.players[j].name, slotKey: ctx.slotInfo[i].key, pos: ctx.slotInfo[i].slot.pos || '', role: typeof ctx.slotInfo[i].slot.role === 'string' ? ctx.slotInfo[i].slot.role : '',
        aTotalBefore: base.aT / 10, aTotalAfter: t2.aT / 10, deltaA, filledDrop, severity, replacements,
      });
    });
    return out.sort((x, y) => rank[x.severity] - rank[y.severity] || x.deltaA - y.deltaA || (x.name < y.name ? -1 : 1));
  }

  // ---------------------------------------------------------------- hráč: kde se hodí, pořadí v týmu, podobní hráči
  /** playerSlotFits(input, opts, playerId) → vhodnost jednoho hráče na každé místo taktiky (jen místa s profilem role): {slotKey, pos, role, fit|null, partial, eligible, flag, reason}. */
  function playerSlotFits(input, rawOpts, playerId) {
    const ctx = prepare(input, Object.assign({}, isObj(rawOpts) ? rawOpts : {}, { quick: true }));
    const j = ctx.idIndex.get(playerId);
    if (j === undefined) return [];
    return ctx.slotInfo.map((si, i) => {
      const base = { slotKey: si.key, pos: si.slot.pos || '', role: typeof si.slot.role === 'string' ? si.slot.role : '' };
      const c = ctx.cells[i][j];
      if (!si.hasRole) return Object.assign(base, { fit: null, partial: false, eligible: null, flag: '', reason: 'Místo nemá zadanou roli.' });
      if (!si.profile) return Object.assign(base, { fit: null, partial: false, eligible: null, flag: '', reason: `Chybí profil role „${String(si.slot.role).trim()}“.` });
      if (!c.eligible) return Object.assign(base, { fit: null, partial: false, eligible: false, flag: '', reason: `Hráč nemá pozici místa (${si.slot.pos || '?'}).` });
      return Object.assign(base, { fit: c.value, partial: c.partial, eligible: true, flag: c.flag, reason: c.value === null ? c.fit.reason || '' : '', contributions: c.fit.contributions, missing: c.fit.missing });
    });
  }

  /** rankForRole({players, profile, slotPos, group}, opts) → hráči seřazení podle vhodnosti na jednu roli (kdo nejde ohodnotit, je na konci s důvodem). */
  function rankForRole(input, rawOpts) {
    const src = isObj(input) ? input : {};
    const o = cleanOpts(rawOpts);
    const profile = isObj(src.profile) ? src.profile : null;
    const slot = { pos: typeof src.slotPos === 'string' ? src.slotPos : '', role: profile ? profile.name : '' };
    const group = DW.GROUPS.includes(src.group) ? src.group : profile ? groupFor(slot, profile) : null;
    const si = { slot, profile, hasRole: !!profile, group };
    const rows = [];
    for (const [j, pl] of (Array.isArray(src.players) ? src.players : []).entries()) {
      if (!isObj(pl) || pl.id === undefined) continue;
      const c = cellFor(si, pl, o, false);
      const v = valueOf(c);
      rows.push({ id: pl.id, name: pl.name, fit: v, partial: v !== null ? c.partial : false, eligible: c ? c.eligible : null, injured: pl.injured === true, reason: !c ? 'Chybí profil role.' : !c.eligible ? 'Nemá pozici místa.' : v === null ? (c.fit && c.fit.reason) || 'Nelze ohodnotit.' : '', j });
    }
    rows.sort((x, y) => (x.fit === null) - (y.fit === null) || (y.fit || 0) - (x.fit || 0) || x.j - y.j);
    let rank = 0;
    for (const r of rows) {
      r.rank = r.fit !== null ? ++rank : null;
      delete r.j;
    }
    return rows;
  }

  /** similarPlayers(target, pool, {group, role, wp, n}) → nejpodobnější hráči podle rozdílu v atributech vážených jako v DWRS pro skupinu (vzdálenost 0 = stejný).
      Hráč, kterému chybí atribut s váhou, se neřadí (zvlášť je v `unknown`). CUSTOM MODEL: míra podobnosti je vlastní, ne údaj hry. */
  function similarPlayers(target, pool, opts) {
    const o = isObj(opts) ? opts : {};
    const group = DW.GROUPS.includes(o.group) ? o.group : DW.groupsOfPlayer(target)[0] || null;
    if (!group) return { ok: false, reason: 'Skupinu pozic nejde určit: zadej ji.', similar: [], unknown: [], group: null };
    const wp = DW.normalizeProfile(o.wp === undefined ? DW.defaultProfile() : o.wp).profile;
    const plan = DW.plan(group, isObj(o.role) ? o.role : null, wp);
    const weighted = plan.entries.filter((e) => e.weight > 0);
    const tAttrs = DW.playerAttributes(target);
    const missingT = weighted.filter((e) => !tAttrs.has(e.key)).map((e) => e.attribute);
    if (missingT.length) return { ok: false, reason: `Hráči chybí atributy: ${missingT.slice(0, 6).join(', ')}${missingT.length > 6 ? ' a další' : ''}.`, similar: [], unknown: [], group };
    const wSum = weighted.reduce((s, e) => s + e.weight, 0);
    const similar = [];
    const unknown = [];
    for (const p of Array.isArray(pool) ? pool : []) {
      if (!isObj(p) || p === target || (p.id !== undefined && target && p.id === target.id)) continue;
      const a = DW.playerAttributes(p);
      if (weighted.some((e) => !a.has(e.key))) {
        unknown.push({ id: p.id, name: p.name });
        continue;
      }
      const d = Math.sqrt(weighted.reduce((s, e) => s + e.weight * (tAttrs.get(e.key) - a.get(e.key)) ** 2, 0) / wSum);
      similar.push({ id: p.id, name: p.name, distance: Math.round(d * 100) / 100, similarity: r1(Math.max(0, 100 * (1 - d / 19))) });
    }
    similar.sort((x, y) => x.distance - y.distance || (x.name < y.name ? -1 : 1));
    return { ok: true, group, similar: similar.slice(0, Number.isInteger(o.n) && o.n > 0 ? o.n : 5), unknown, reason: '' };
  }

  // ---------------------------------------------------------------- skupina role z použití v taktikách
  /** inferRoleGroups(profiles, tacticsSlots) → Map klíč role → {group|null, source:'explicit'|'tactic'|'name'|null, ambiguous}.
      Pořadí: výslovná skupina u profilu, pak jednoznačné použití v taktikách (pozice místa), pak odhad z anglického názvu role. */
  function inferRoleGroups(profiles, slotLists) {
    const usage = new Map();
    for (const list of Array.isArray(slotLists) ? slotLists : []) {
      for (const s of Array.isArray(list) ? list : []) {
        if (!isObj(s) || typeof s.role !== 'string' || !s.role.trim()) continue;
        const g = DW.groupOfPosition(s.pos);
        if (!g) continue;
        const k = RF.roleKey(s.role);
        if (!usage.has(k)) usage.set(k, new Set());
        usage.get(k).add(g);
      }
    }
    const out = new Map();
    for (const p of Array.isArray(profiles) ? profiles : []) {
      if (!isObj(p) || typeof p.name !== 'string') continue;
      const k = RF.roleKey(p.name);
      if (DW.GROUPS.includes(p.group)) {
        out.set(k, { group: p.group, source: 'explicit', ambiguous: false });
        continue;
      }
      const used = usage.get(k);
      if (used && used.size === 1) {
        out.set(k, { group: [...used][0], source: 'tactic', ambiguous: false });
        continue;
      }
      const byName = DW.groupOfRole(Object.assign({}, p, { group: undefined }));
      out.set(k, { group: byName, source: byName ? 'name' : null, ambiguous: !!(used && used.size > 1) });
    }
    return out;
  }

  /** Kopie profilů se skupinou pozic doplněnou z inferRoleGroups (pro DW.analyzePlayer); nic se tím neukládá. */
  function withGroups(profiles, groups) {
    return (Array.isArray(profiles) ? profiles : []).map((p) => {
      if (!isObj(p)) return p;
      const g = groups.get(RF.roleKey(p.name));
      return g && g.group ? Object.assign({}, p, { group: g.group }) : Object.assign({}, p);
    });
  }

  // ---------------------------------------------------------------- rizika soupisky
  const GK_GROUP = 'GK';

  /** squadRisks(result, impact, players) → [{id, severity:'high'|'medium'|'info', kind, text}] jen z toho, co aplikace opravdu spočítala a zná. */
  function squadRisks(result, impact, players) {
    const out = [];
    if (!isObj(result) || !isObj(result.a)) return out;
    for (const d of result.depth || []) {
      if (d.coverage === 'gap') out.push({ id: 'gap:' + d.slotKey, severity: 'high', kind: 'gap', text: `${d.pos} ${d.role || ''}: nikdo se nedá ohodnotit na tuhle roli.`.replace(/\s+/g, ' ') });
      else if (d.coverage === 'thin') out.push({ id: 'thin:' + d.slotKey, severity: 'medium', kind: 'thin', text: `${d.pos} ${d.role || ''}: hodí se jediný hráč, za případné zranění není náhrada.`.replace(/\s+/g, ' ') });
    }
    for (const x of Array.isArray(impact) ? impact : []) {
      if (x.severity === 'critical') out.push({ id: 'single:' + x.playerId, severity: 'high', kind: 'single', text: `Výpadek ${x.name} (${x.pos}) by stál ${cz(Math.abs(x.deltaA))} bodů ze součtu sestavy A${x.filledDrop ? ` a jedno obsazené místo` : ''}.` });
    }
    const list = Array.isArray(players) ? players : [];
    const gks = list.filter((p) => isObj(p) && DW.groupsOfPlayer(p).includes(GK_GROUP) && p.injured !== true);
    const known = list.filter((p) => isObj(p) && Array.isArray(p.positions) && p.positions.length);
    if (known.length && gks.length < 2) out.push({ id: 'gk', severity: 'high', kind: 'gk', text: gks.length ? 'V soupisce je jediný použitelný brankář.' : 'V soupisce není žádný použitelný brankář.' });
    const noData = result.leftOut ? result.leftOut.filter((x) => x.code === 'noValue') : [];
    if (noData.length) out.push({ id: 'data', severity: 'info', kind: 'data', text: `${noData.length} ${noData.length === 1 ? 'hráč nejde ohodnotit' : noData.length < 5 ? 'hráči nejdou ohodnotit' : 'hráčů nejde ohodnotit'} (chybí atributy), takže se do sestavy nedostanou: ${noData.slice(0, 4).map((x) => x.name).join(', ')}${noData.length > 4 ? ' a další' : ''}.` });
    const order = { high: 0, medium: 1, info: 2 };
    return out.sort((x, y) => order[x.severity] - order[y.severity]);
  }

  // ---------------------------------------------------------------- řádky pro AI trenéra
  function summaryLines(result) {
    if (!isObj(result) || !isObj(result.a)) return [];
    const lines = [`Nejlepší sestava A a B (model: ${result.modelInfo}). Jsou to čísla aplikace, ne pravidla FM27; pořadí cílů: obsazená místa A, součet A, obsazená místa B, součet B.`];
    for (const a of result.a.assignments) {
      if (!a.player && !a.role.trim()) continue;
      const b = result.b ? result.b.assignments.find((x) => x.slotKey === a.slotKey) : null;
      lines.push(a.player
        ? `${a.pos} ${a.role || '(bez role)'}: ${a.player.name}${a.fit !== null ? `, vhodnost ${cz(a.fit)}` : ', vhodnost nejde spočítat'}${a.partial ? ' (částečná data)' : ''}${a.locked ? ' (zamčeno uživatelem)' : ''}${b && b.player ? `; B: ${b.player.name}${b.fit !== null ? ' ' + cz(b.fit) : ''}` : ''}`
        : `${a.pos} ${a.role || '(bez role)'}: neobsazeno (${a.reason})`);
    }
    lines.push(`Součet A ${cz(result.a.total)} (${result.a.valued} míst)${result.b ? `, součet B ${cz(result.b.total)} (${result.b.valued} míst)` : ''}.`);
    for (const w of result.weak || []) if (w.kind === 'weak') lines.push('Slabší místo: ' + w.text);
    for (const d of result.depth || []) if (d.coverage !== 'covered' && result.a.assignments.find((a) => a.slotKey === d.slotKey && (a.player || a.role.trim()))) lines.push(`Hloubka ${d.pos} ${d.role || ''}: ${d.coverage === 'gap' ? 'nikdo' : 'jediný hráč'}.`.replace(/\s+/g, ' '));
    for (const u of result.unavailable || []) lines.push(`${u.name}: ${u.code === 'injured' ? 'zraněný nebo nedostupný' : 'vyřazen uživatelem'}, v sestavě není.`);
    return lines.slice(0, 40);
  }

  return {
    MODELS, MODEL_CS, DEFAULT_SEVERITY, DEFAULT_WEAK_GAP,
    prepare, resolveConstraints, solve, tally, optimize, diffResults, simulateChange, injuryImpact, playerSlotFits, rankForRole, similarPlayers,
    inferRoleGroups, withGroups, squadRisks, summaryLines, groupFor,
  };
});
