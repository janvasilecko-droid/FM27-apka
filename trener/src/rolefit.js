/* FM27 Tactical Coach: vhodnost hráče na roli, nejlepší sestava a slabá místa (čistý modul bez DOM, sítě a AI).
   Zdroj vah je PROFIL ROLE: klíčové a žádoucí atributy role, které aplikace přečte z obrazovky role ve hře (uživatel přepis potvrdí) nebo které zadá ručně.
   Nic se tu nebere z cizích projektů: metoda je obecná (vážený průměr viditelných atributů, politika „nedostupné místo nuly“ a přiřazení hráčů k místům
   maďarským algoritmem), napsaná samostatně.
   Poctivost: skóre je HEURISTIKA TÉTO APLIKACE, ne pravidlo FM27. Váhy 2 (klíčový atribut) a 1 (žádoucí) jsou volba aplikace, hra žádné číslo neuvádí.
   Chybí-li hráči atribut, který profil požaduje, je výsledek „nedostupné“ (nikdy nula a nikdy se nic nedopočítává); částečný výpočet je označený a jde
   použít jen výslovně. Skryté údaje hry (CA a PA, skryté atributy, osobnost) se do profilů nepouštějí a nikdy se nečtou.
   Čisté funkce: stejný vstup dá vždy stejný výstup, vstupy se nemění. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./tableimport.js'));
  else root.TrenerRoleFit = factory(root.TrenerCore, root.TrenerTableImport);
})(typeof self !== 'undefined' ? self : this, function (core, TI) {
  'use strict';

  const DEFAULT_WEIGHTS = Object.freeze({ key: 2, pref: 1 });
  const MAX_LIST = 20;
  const MAX_NAME = 60;
  const MAX_ATTR_NAME = 30;
  const SOURCES = Object.freeze(['screenshot', 'user']);
  const SOURCE_CS = Object.freeze({ screenshot: 'přečteno z obrazovky role ve hře, potvrzeno tebou', user: 'zadal uživatel' });

  // Kódy míst v šablonách formací této aplikace → kódy pozic, jak je píše hra a nástroje kolem ní (GK, DL, DC, DR, WBL, WBR, DM, ML, MC, MR, AML, AMC, AMR, ST).
  // Jde o běžné pojmenování stran a řad ve FM, ne o údaj z FM27.
  const SLOT_FM_POS = Object.freeze({
    GK: 'GK', RB: 'DR', LB: 'DL', RCB: 'DC', LCB: 'DC', CB: 'DC', RWB: 'WBR', LWB: 'WBL', DM: 'DM', RDM: 'DM', LDM: 'DM',
    RCM: 'MC', LCM: 'MC', CM: 'MC', RM: 'MR', LM: 'ML', RW: 'AMR', LW: 'AML', RAM: 'AMR', LAM: 'AML', AM: 'AMC', ST: 'ST', RST: 'ST', LST: 'ST',
  });
  const FM_POS = new Set(['GK', 'SW', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST']);

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  // řídicí znaky, oddělovače řádků, všechny formátovací znaky Unicode (nulová šířka, řízení směru písma včetně izolátů, měkký spojovník, značky) a všechny znaky, které se mají při zobrazení ignorovat (Default_Ignorable_Code_Point: výplně, selektory variant, neviditelné samohlásky), plus prázdné braillské písmeno a náhradní znak objektu; zapsáno přes RegExp, aby ve zdrojích nebyly doslovné znaky
  const INVISIBLE = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\ufffc]+', 'gu');
  const oneLine = (v, n) => (typeof v === 'string' ? v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const r1 = (v) => Math.round(v * 10) / 10;
  const cz = (v) => String(v).replace('.', ','); // české desetinné číslo do textů

  /** Klíč pro porovnání názvů bez ohledu na velikost písmen, diakritiku, mezery a interpunkci („Off The Ball“ = „Off the ball“ = „offtheball“). */
  const attrKey = (s) => core.fold(String(s === null || s === undefined ? '' : s)).replace(/[^a-z0-9]/g, '');
  const roleKey = attrKey;

  // ---------------------------------------------------------------- profil role z obrazovky
  function cleanList(v, issues) {
    const out = [];
    const seen = new Set();
    if (!Array.isArray(v)) return out;
    for (const x of v.slice(0, MAX_LIST * 2)) {
      const name = oneLine(x, MAX_ATTR_NAME);
      if (name.length < 2) continue;
      if (TI && TI.isHiddenName && TI.isHiddenName(name)) {
        issues.push(`„${name}“ je skrytý údaj hry, do profilu role se nebere.`);
        continue;
      }
      const k = attrKey(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
      if (out.length >= MAX_LIST) break;
    }
    return out;
  }

  /** Společné čištění polí profilu (odpověď modelu i ruční zadání). → {name, phase, duty, key[], pref[], issues[]} */
  function cleanFields(f) {
    const issues = [];
    const src = isObj(f) ? f : {};
    const name = oneLine(src.role !== undefined ? src.role : src.name, MAX_NAME);
    const key = cleanList(src.key, issues);
    const keyKeys = new Set(key.map(attrKey));
    const pref = cleanList(src.pref !== undefined ? src.pref : src.preferred, issues).filter((p) => {
      if (keyKeys.has(attrKey(p))) {
        issues.push(`„${p}“ je klíčový i žádoucí, počítá se jako klíčový.`);
        return false;
      }
      return true;
    });
    return { name, phase: oneLine(src.phase, 30), duty: oneLine(src.duty, 30), key, pref, issues };
  }

  /** normalizeRoleExtraction(raw) → {ok, read:{role, phase, duty, key[], pref[]}|null, issues}. Odpověď modelu se bere jako návrh. */
  function normalizeRoleExtraction(raw) {
    if (!isObj(raw)) return { ok: false, read: null, issues: ['Odpověď není objekt, nic se nepřečetlo.'] };
    const c = cleanFields({ role: raw.role, phase: raw.phase, duty: raw.duty, key: raw.key !== undefined ? raw.key : raw.keyAttributes, pref: raw.preferred !== undefined ? raw.preferred : raw.pref });
    const issues = c.issues.slice();
    if (!c.name) issues.push('Na obrázku není čitelný název role.');
    else if (!c.key.length && !c.pref.length) issues.push('Na obrázku nejsou čitelné klíčové ani žádoucí atributy.');
    const ok = !!c.name && c.key.length + c.pref.length > 0;
    return { ok, read: ok ? { role: c.name, phase: c.phase, duty: c.duty, key: c.key, pref: c.pref } : null, issues };
  }

  /** makeProfile({name, key, pref, source, phase, duty, note}, {now}) → {ok, profile, issues}. Jeden profil na název role (nový přepíše starý). */
  function makeProfile(fields, opts) {
    const o = isObj(opts) ? opts : {};
    const c = cleanFields(fields);
    const f = isObj(fields) ? fields : {};
    const issues = c.issues.slice();
    if (!c.name) return { ok: false, profile: null, issues: issues.concat('Chybí název role.') };
    if (!c.key.length && !c.pref.length) return { ok: false, profile: null, issues: issues.concat('Profil potřebuje aspoň jeden atribut.') };
    const k = roleKey(c.name);
    if (!k) return { ok: false, profile: null, issues: issues.concat('Název role nemá žádné písmeno ani číslici.') };
    const profile = {
      id: ('r' + k).slice(0, 40),
      name: c.name,
      key: c.key,
      pref: c.pref,
      source: SOURCES.includes(f.source) ? f.source : 'user',
      phase: c.phase,
      duty: c.duty,
      note: oneLine(f.note, 200),
      at: isNum(o.now) ? o.now : null,
    };
    return { ok: true, profile, issues };
  }

  const profilesIndex = (profiles) => {
    const m = new Map();
    for (const p of Array.isArray(profiles) ? profiles : []) if (isObj(p) && typeof p.name === 'string') m.set(roleKey(p.name), p);
    return m;
  };

  // ---------------------------------------------------------------- vhodnost hráče na roli
  /** roleFit(player, profile, {weights}) → {score|null, partial|null, missing[], contributions[], reason, ignoredHidden[]}.
      score = Σ(hodnota × váha) / Σ(20 × váha) × 100 přes všechny atributy profilu; chybí-li některý, score je null. */
  function roleFit(player, profile, opts) {
    const w = Object.assign({}, DEFAULT_WEIGHTS, isObj(opts) && isObj(opts.weights) ? opts.weights : {});
    const attrs = new Map();
    if (isObj(player) && isObj(player.attributes)) for (const [k, v] of Object.entries(player.attributes)) if (isNum(v) && Number.isInteger(v) && v >= 1 && v <= 20) attrs.set(attrKey(k), v);
    const empty = { score: null, partial: null, missing: [], contributions: [], reason: '', ignoredHidden: [] };
    if (!isObj(profile)) return Object.assign(empty, { reason: 'Chybí profil role.' });
    const ignoredHidden = [];
    const wanted = [];
    for (const [level, list] of [['key', profile.key], ['pref', profile.pref]]) {
      for (const name of Array.isArray(list) ? list : []) {
        if (typeof name !== 'string') continue;
        if (TI && TI.isHiddenName && TI.isHiddenName(name)) {
          ignoredHidden.push(name);
          continue;
        }
        wanted.push({ attribute: name, level, weight: w[level] });
      }
    }
    if (!wanted.length) return Object.assign(empty, { ignoredHidden, reason: 'Profil role nemá žádný použitelný atribut.' });
    const contributions = [];
    const missing = [];
    for (const x of wanted) {
      const value = attrs.get(attrKey(x.attribute));
      if (value === undefined) missing.push(x.attribute);
      else contributions.push({ attribute: x.attribute, level: x.level, weight: x.weight, value, points: value * x.weight, maxPoints: 20 * x.weight });
    }
    const sum = (arr, k) => arr.reduce((s, c) => s + c[k], 0);
    const totalWeight = wanted.reduce((s, x) => s + x.weight, 0);
    if (!missing.length) {
      return { score: r1((sum(contributions, 'points') / sum(contributions, 'maxPoints')) * 100), partial: null, missing, contributions, reason: '', ignoredHidden };
    }
    const usedWeight = sum(contributions, 'weight');
    const partial = contributions.length ? { score: r1((sum(contributions, 'points') / sum(contributions, 'maxPoints')) * 100), coverage: Math.round((usedWeight / totalWeight) * 100) / 100, used: contributions.length, total: wanted.length } : null;
    return { score: null, partial, missing, contributions, reason: `Hráči chybí atributy: ${missing.join(', ')}.`, ignoredHidden };
  }

  // ---------------------------------------------------------------- způsobilost podle pozice
  /** Může hráč podle pozic stát na místě? mode 'strict': musí mít pozici místa, neznámé pozice projdou s příznakem; 'free': pozice se nehlídají. */
  function eligibility(slotPos, playerPositions, mode) {
    if (mode === 'free') return { ok: true, flag: '' };
    const code = String(slotPos || '').toUpperCase();
    const fm = SLOT_FM_POS[code] || (FM_POS.has(code) ? code : null);
    if (!fm) return { ok: true, flag: 'pozici místa nejde porovnat' };
    const ps = (Array.isArray(playerPositions) ? playerPositions : []).map((p) => String(p).toUpperCase().trim()).filter(Boolean);
    if (!ps.length) return { ok: true, flag: 'pozice hráče je neznámá' };
    return ps.some((p) => p === fm || SLOT_FM_POS[p] === fm) ? { ok: true, flag: '' } : { ok: false, flag: '' };
  }

  // ---------------------------------------------------------------- přiřazení (maďarský algoritmus, maximalizace)
  /** gain: n × m (n ≤ m) nezáporná celá čísla; vrací pro každý řádek index sloupce. Přesný optimální součet. */
  function hungarianMax(gain) {
    const n = gain.length;
    if (!n) return [];
    const m = gain[0].length;
    let top = 0;
    for (const row of gain) for (const g of row) if (g > top) top = g;
    const cost = (i, j) => top - gain[i - 1][j - 1];
    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0);
    const way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(Infinity);
      const used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = Infinity;
        let j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = cost(i0, j) - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const out = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
    return out;
  }

  const BIG = 1000000; // obsazené místo je vždy cennější než jakýkoli rozdíl ve skóre
  const SCALE = 100000; // pořadí hráčů rozhoduje jen při úplné shodě (součet rozlišovačů je pod SCALE)

  /** assignBest({slots, players, profiles}, {mode, allowPartial, minCoverage, weights}) → výsledek s přiřazením, zálohami a vysvětlením.
      Cíl: nejdřív co nejvíc míst s úplně spočtenou vhodností, pak největší součet. Místo bez profilu role se neobsazuje (nehodnotilo by se). */
  function assignBest(input, opts) {
    const o = Object.assign({ mode: 'strict', allowPartial: false, minCoverage: 0.8, weights: DEFAULT_WEIGHTS }, isObj(opts) ? opts : {});
    const slots = (isObj(input) && Array.isArray(input.slots) ? input.slots : []).filter(isObj);
    const seenIds = new Set();
    const players = (isObj(input) && Array.isArray(input.players) ? input.players : []).filter((p) => {
      if (!isObj(p) || p.id === undefined || p.id === null || seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });
    const index = profilesIndex(isObj(input) ? input.profiles : []);
    const slotInfo = slots.map((s) => {
      const hasRole = typeof s.role === 'string' && s.role.trim() !== '';
      const profile = hasRole ? index.get(roleKey(s.role)) || null : null;
      return { slot: s, profile, hasRole };
    });
    // matice hodnocení: null = nelze (profil chybí, pozice nesedí, chybí atributy)
    const cells = slotInfo.map((si) =>
      players.map((pl, pi) => {
        if (!si.profile) return null;
        const el = eligibility(si.slot.pos, pl.positions, o.mode);
        if (!el.ok) return { eligible: false };
        const fit = roleFit(pl, si.profile, { weights: o.weights });
        let value = fit.score;
        let partial = false;
        if (value === null && o.allowPartial && fit.partial && fit.partial.coverage >= o.minCoverage) {
          value = fit.partial.score;
          partial = true;
        }
        return { eligible: true, flag: el.flag, fit, value, partial, pi };
      })
    );
    const n = slots.length;
    const m = Math.max(players.length, n);
    const gain = slotInfo.map((si, i) => {
      const row = new Array(m).fill(0);
      players.forEach((pl, j) => {
        const c = cells[i][j];
        if (c && c.eligible && c.value !== null) row[j] = (BIG + Math.round(c.value * 10)) * SCALE + (1000 - Math.min(j, 999));
      });
      return row;
    });
    const pick = n ? hungarianMax(gain) : [];
    const assignments = slotInfo.map((si, i) => {
      const j = pick[i];
      const c = j >= 0 && j < players.length ? cells[i][j] : null;
      const ok = !!(c && c.eligible && c.value !== null && gain[i][j] > 0);
      // záloha: nejlepší jiní způsobilí hráči s vypočtenou vhodností
      const alts = [];
      players.forEach((pl, pj) => {
        const x = cells[i][pj];
        if (!x || !x.eligible || x.value === null || (ok && pj === j)) return;
        alts.push({ id: pl.id, name: pl.name, fit: x.value, partial: x.partial });
      });
      alts.sort((a, b) => b.fit - a.fit);
      let reason = '';
      if (!ok) {
        if (!si.hasRole) reason = 'Místo nemá zadanou roli.';
        else if (!si.profile) reason = `Chybí profil role „${String(si.slot.role).trim()}“: přečti ji z obrazovky role ve hře.`;
        else if (!players.some((pl, pj) => cells[i][pj] && cells[i][pj].eligible)) reason = `Žádný hráč nemá pozici místa (${si.slot.pos || '?'}).`;
        else if (!alts.length) {
          const sample = players.map((pl, pj) => (cells[i][pj] && cells[i][pj].eligible ? cells[i][pj].fit.missing : null)).find((x) => x && x.length);
          reason = `Žádný vhodný hráč nemá všechny atributy role${sample ? ` (chybí například ${sample.slice(0, 3).join(', ')})` : ''}.`;
        } else reason = 'Všichni způsobilí hráči jsou obsazeni na jiných místech.';
      }
      return {
        slotKey: si.slot.key !== undefined ? si.slot.key : String(i),
        pos: si.slot.pos || '',
        role: typeof si.slot.role === 'string' ? si.slot.role : '',
        duty: typeof si.slot.duty === 'string' ? si.slot.duty : '',
        profile: si.profile ? si.profile.name : null,
        profileSource: si.profile ? si.profile.source : null,
        player: ok ? { id: players[j].id, name: players[j].name } : null,
        fit: ok ? c.value : null,
        partial: ok ? c.partial : false,
        flag: ok ? c.flag : '',
        contributions: ok ? c.fit.contributions : [],
        missing: ok ? c.fit.missing : [],
        alternatives: alts.slice(0, 2),
        reason,
      };
    });
    const filled = assignments.filter((a) => a.player);
    const total = r1(filled.reduce((s, a) => s + a.fit, 0));
    const missingProfiles = [...new Set(slotInfo.filter((si) => si.hasRole && !si.profile).map((si) => String(si.slot.role).trim()))];
    const result = { assignments, filled: filled.length, unfilled: assignments.length - filled.length, total, missingProfiles, options: { mode: o.mode, allowPartial: !!o.allowPartial, minCoverage: o.minCoverage, weights: Object.assign({}, DEFAULT_WEIGHTS, o.weights) } };
    result.weak = weakSpots(result);
    return result;
  }

  // ---------------------------------------------------------------- slabá místa
  /** weakSpots(result, {gap}) → [{slotKey, pos, role, kind: 'unfilled'|'weak', fit, median, gap, text}]. Práh `gap` (výchozí 8 bodů pod mediánem obsazených míst)
      je heuristika této aplikace, ne pravidlo FM27. */
  function weakSpots(result, opts) {
    const gapLimit = isObj(opts) && isNum(opts.gap) ? opts.gap : 8;
    const list = isObj(result) && Array.isArray(result.assignments) ? result.assignments : [];
    const fits = list.filter((a) => a.player).map((a) => a.fit).sort((a, b) => a - b);
    const median = fits.length ? (fits.length % 2 ? fits[(fits.length - 1) / 2] : (fits[fits.length / 2 - 1] + fits[fits.length / 2]) / 2) : null;
    const out = [];
    for (const a of list) {
      if (!a.player && !a.role.trim()) continue; // místo bez zadané role se nehodnotí, není to slabé místo
      if (!a.player) out.push({ slotKey: a.slotKey, pos: a.pos, role: a.role, kind: 'unfilled', fit: null, median, gap: null, text: `${a.pos || 'místo'} ${a.role || ''}: nikdo se nehodí. ${a.reason}`.replace(/\s+/g, ' ').trim() });
      else if (median !== null && fits.length >= 3 && median - a.fit >= gapLimit) out.push({ slotKey: a.slotKey, pos: a.pos, role: a.role, kind: 'weak', fit: a.fit, median, gap: r1(median - a.fit), text: `${a.pos} ${a.role}: nejlepší hráč ${a.player.name} má vhodnost ${cz(a.fit)}, o ${cz(r1(median - a.fit))} méně než medián sestavy (${cz(r1(median))}).`.replace(/\s+/g, ' ') });
    }
    return out.sort((a, b) => (a.kind === b.kind ? (b.gap || 0) - (a.gap || 0) : a.kind === 'unfilled' ? -1 : 1));
  }

  /** Řádky pro AI trenéra: stručný výsledek s nápisem, že jde o heuristiku. */
  function summaryLines(result) {
    if (!isObj(result) || !Array.isArray(result.assignments)) return [];
    const lines = ['Nejlepší sestava podle vhodnosti na role je heuristika aplikace (váha klíčového atributu 2, žádoucího 1; profily rolí viz zdroj), ne pravidlo FM27.'];
    const noRole = result.assignments.filter((a) => !a.player && !a.role.trim()).length;
    for (const a of result.assignments) if (a.player || a.role.trim()) lines.push(a.player ? `${a.pos} ${a.role || '(bez role)'}: ${a.player.name}, vhodnost ${cz(a.fit)}${a.partial ? ' (částečná data)' : ''}${a.alternatives[0] ? `; záloha ${a.alternatives[0].name} ${cz(a.alternatives[0].fit)}` : ''}` : `${a.pos} ${a.role || '(bez role)'}: neobsazeno (${a.reason})`);
    if (noRole) lines.push(`${noRole} ${noRole === 1 ? 'místo nemá' : noRole < 5 ? 'místa nemají' : 'míst nemá'} zadanou roli, proto se nehodnotí.`);
    for (const w of result.weak) if (w.kind === 'weak') lines.push('Slabší místo: ' + w.text);
    return lines;
  }

  return { DEFAULT_WEIGHTS, SOURCES, SOURCE_CS, SLOT_FM_POS, attrKey, roleKey, normalizeRoleExtraction, makeProfile, profilesIndex, roleFit, eligibility, hungarianMax, assignBest, weakSpots, summaryLines };
});
