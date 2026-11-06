/* FM27 Tactical Coach: taktiky bez DOM (formace, import a export ručního plánu, geometrie rozložení,
   kontrola kontejneru .fmf). Běží v prohlížeči (globál TrenerTactics) i v Node (module.exports).

   Poctivost: všechno tady je GEOMETRIE bodů, které si uživatel nakreslil, nebo metadata souboru. Nic z toho
   netvrdí, jak se hráči chovají ve FM27, a prahy jsou heuristiky této aplikace, ne pravidla hry. Role a povinnosti
   jsou volný text uživatele. Plán zadaný ručně je vždy `user_entered` (nejde o data načtená z FM27).

   Souřadnice: x 0–100 zleva doprava, y 0–100 shora dolů; y = 0 je branka soupeře, vlastní tým útočí nahoru
   (stejně jako reference/codex-2026-11-01/takticky-plan.json). Fáze: 'in' = s míčem (x, y), 'out' = bez míče (ox, oy).
   Čisté funkce: žádná síť, žádné hodiny, žádná náhoda; stejný vstup dá vždy stejný výstup. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerTactics = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  // ---------------------------------------------------------------- konstanty a pomůcky
  const PLAN_FORMAT = 'fm27-tactical-coach-manual-plan';
  const PLAN_VERSION = 1;
  const LABEL_USER = 'user_entered'; // štítky původu z core.LABELS
  const LABEL_HEURISTIC = 'heuristic_coach';
  const PHASES = ['in', 'out'];
  const PHASE_LABEL = { in: 's míčem', out: 'bez míče' };
  const PHASE_CAP = { in: 'S míčem', out: 'Bez míče' };
  const HALF_Y = 50; // půlící čára: „naše polovina“ je y > 50

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  // České číslo: desetinná čárka, typografické minus.
  const fmt = (v) => String(r1(v)).replace('.', ',').replace('-', '−');
  const signed = (v) => (v > 0 ? '+' : '') + fmt(v);
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  const nPlayers = (n) => `${n} ${plural(n, 'hráč', 'hráči', 'hráčů')}`;
  const jeJsou = (n) => (n >= 2 && n <= 4 ? 'jsou' : 'je'); // „je 1 hráč“, „jsou 3 hráči“, „je 5 hráčů“
  // Desetinné číslo se skloňuje jako 2. pád jednotného čísla („3,2 jednotky“), celé podle počtu.
  const units = (v) => {
    const n = r1(v);
    return `${fmt(n)} ${Number.isInteger(n) ? plural(n, 'jednotka', 'jednotky', 'jednotek') : 'jednotky'}`;
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const k of Object.keys(value)) deepFreeze(value[k]);
    }
    return value;
  }

  /** Úroveň důvěry štítku podle jádra (české znění ukáže obrazovka). */
  function provenanceOf(label) {
    const tier = (core && core.LABEL_TO_TIER && core.LABEL_TO_TIER[label]) || 'unknown';
    const text = (core && core.TIER_LABEL_CS && core.TIER_LABEL_CS[tier]) || tier;
    return { label, tier, text };
  }

  // ---------------------------------------------------------------- prahy
  // Každý práh je heuristika TÉTO aplikace, ne pravidlo FM27. Zkontrolované jsou na výchozích formacích níže:
  // žádná z nich při výchozích prahách nehlásí 'warn' (hlídá to test).
  const DEFAULT_THRESHOLDS = deepFreeze({
    // Řady se určují shlukováním podle y: nová řada začíná, když je mezi dvěma hráči (seřazenými podle y) mezera
    // větší než tohle. 8 je nad největším rozdílem uvnitř řady ve výchozích formacích (6: krajní obránce vs. stoper)
    // a pod nejmenší mezerou mezi řadami (10), takže řady vyjdou tak, jak jsou nakreslené.
    lineBreakY: 8,
    // line_gap: svislá mezera mezi sousedními řadami (od nejvyššího hráče zadní řady k nejhlubšímu hráči přední
    // řady), v jednotkách hřiště 0–100. Největší mezera ve výchozích formacích je 26; 30 je nad ní.
    lineGapY: 30,
    // isolated_forward: vzdálenost nejvíc vysunutého hráče od nejbližšího spoluhráče v poli. Ve výchozích
    // formacích je nejvýš 32,6 (osamělý útočník a křídlo); 40 nechává odstup.
    isolatedDistance: 40,
    // overlap: dva hráči blíž než 5 jednotek se na plánku skoro překrývají. Nejbližší dvojice ve výchozích
    // formacích (brankář a střední stoper) je od sebe 9 jednotek.
    overlapDistance: 5,
    // thin_rest_defence: nejmíň hráčů v poli za půlící čárou ve fázi s míčem. Číslo 3 je heuristika této aplikace
    // (ne norma ani pravidlo FM27); nic neříká o tom, kdo se při ztrátě míče skutečně vrací.
    minRestDefence: 3,
    // Půlící čára pro zajištění: hráč je „za ní“, když y > 50.
    restDefenceLineY: 50,
    // width_imbalance: nález se hlásí, až když je rozdíl počtu hráčů v poli vlevo (x < 50) a vpravo (x > 50) větší
    // než tohle; liché obsazení (např. 4 vs. 5) je u asymetrických sestav běžné.
    maxWidthImbalance: 1,
    // empty_channel: od kolika prázdných kanálů v obranné třetině je nález 'warn' (méně je 'watch').
    emptyChannelsWarn: 3,
    // Násobek prahu, od kterého se 'watch' mění na 'warn' (u malých vzdáleností dělení tímto číslem).
    warnFactor: 1.5,
    // opponentOverloads: soupeř musí mít v zóně (třetina × kanál) aspoň tolik hráčů v poli; jediný hráč přečíslení není.
    overloadMinOpp: 2,
    // opponentOverloads: a aspoň o tolik hráčů v poli víc než my.
    overloadMinDiff: 1,
  });

  function resolveThresholds(custom) {
    const out = Object.assign({}, DEFAULT_THRESHOLDS);
    if (isObj(custom)) for (const k of Object.keys(DEFAULT_THRESHOLDS)) if (isNum(custom[k])) out[k] = custom[k];
    return out;
  }

  // ---------------------------------------------------------------- formace
  // Výchozí souřadnice jsou šablony této aplikace, ne data z FM27. Drží se tří pravidel, aby byla geometrie čistá:
  //  - vlevo a vpravo zrcadlově (x a 100 − x) a žádný bod přesně na hranici kanálu (20/40/60/80), jinak by zrcadlový
  //    hráč mohl spadnout do jiného kanálu;
  //  - sousední hráči v řadě se liší v y nejvýš o 6, sousední řady aspoň o 10 (shlukování podle y pak vrátí řady
  //    z názvu formace);
  //  - pořadí slotů: brankář, potom řady zezadu, v řadě zprava doleva (jako v referenčním plánu).
  function formation(id, outfield) {
    const slots = [['GK', 50, 91]].concat(outfield).map(([pos, x, y]) => ({ pos, x, y }));
    return { id, label: id.replace(/-/g, '–'), slots };
  }

  const FORMATIONS = deepFreeze([
    formation('4-4-2', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['RM', 82, 54], ['RCM', 62, 56], ['LCM', 38, 56], ['LM', 18, 54],
      ['RST', 62, 30], ['LST', 38, 30],
    ]),
    formation('4-3-3', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['DM', 50, 66],
      ['RCM', 66, 54], ['LCM', 34, 54],
      ['RW', 82, 30], ['ST', 50, 24], ['LW', 18, 30],
    ]),
    formation('4-2-3-1', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['RDM', 62, 64], ['LDM', 38, 64],
      ['RAM', 82, 44], ['AM', 50, 42], ['LAM', 18, 44],
      ['ST', 50, 24],
    ]),
    formation('4-1-4-1', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['DM', 50, 66],
      ['RM', 82, 48], ['RCM', 62, 50], ['LCM', 38, 50], ['LM', 18, 48],
      ['ST', 50, 26],
    ]),
    formation('4-4-1-1', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['RM', 82, 56], ['RCM', 62, 58], ['LCM', 38, 58], ['LM', 18, 56],
      ['AM', 50, 40],
      ['ST', 50, 24],
    ]),
    formation('4-3-2-1', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['RCM', 70, 58], ['CM', 50, 60], ['LCM', 30, 58],
      ['RAM', 66, 42], ['LAM', 34, 42],
      ['ST', 50, 24],
    ]),
    formation('4-1-2-1-2', [
      ['RB', 81, 76], ['RCB', 62, 82], ['LCB', 38, 82], ['LB', 19, 76],
      ['DM', 50, 66],
      ['RCM', 70, 54], ['LCM', 30, 54],
      ['AM', 50, 42],
      ['RST', 62, 28], ['LST', 38, 28],
    ]),
    formation('3-5-2', [
      ['RCB', 70, 82], ['CB', 50, 82], ['LCB', 30, 82],
      ['RWB', 88, 58], ['RCM', 66, 56], ['CM', 50, 60], ['LCM', 34, 56], ['LWB', 12, 58],
      ['RST', 62, 30], ['LST', 38, 30],
    ]),
    formation('3-4-3', [
      ['RCB', 70, 82], ['CB', 50, 82], ['LCB', 30, 82],
      ['RWB', 88, 58], ['RCM', 62, 56], ['LCM', 38, 56], ['LWB', 12, 58],
      ['RW', 82, 30], ['ST', 50, 24], ['LW', 18, 30],
    ]),
    formation('5-3-2', [
      ['RWB', 86, 76], ['RCB', 70, 82], ['CB', 50, 82], ['LCB', 30, 82], ['LWB', 14, 76],
      ['RCM', 66, 56], ['CM', 50, 58], ['LCM', 34, 56],
      ['RST', 62, 30], ['LST', 38, 30],
    ]),
    formation('5-4-1', [
      ['RWB', 86, 76], ['RCB', 70, 82], ['CB', 50, 82], ['LCB', 30, 82], ['LWB', 14, 76],
      ['RM', 82, 52], ['RCM', 62, 54], ['LCM', 38, 54], ['LM', 18, 52],
      ['ST', 50, 28],
    ]),
  ]);

  const FORMATION_BY_ID = new Map(FORMATIONS.map((f) => [f.id, f]));
  const FORMATION_BY_DIGITS = new Map(FORMATIONS.map((f) => [f.id.replace(/-/g, ''), f.id]));

  /** '4–3–3', '433', '4 3 3', '4-2-3-1' → '4-3-3', '4-2-3-1'; co nejde přečíst nebo není v šablonách, vrátí null. */
  function normalizeFormationId(text) {
    if (typeof text === 'number' && Number.isFinite(text)) text = String(text);
    if (typeof text !== 'string') return null;
    const s = text.trim();
    // Jen číslice a oddělovače mezi nimi: „4-3-3 (diamant)“, text kolem ani rozepsané „4-3-3-“ se nehádá.
    if (!/^\d(?:[\d\s\-–—−‐‑‒―._/·:]*\d)?$/.test(s)) return null;
    const groups = s.split(/\D+/).filter(Boolean);
    let digits;
    if (groups.length === 1) digits = groups[0];
    else if (groups.length > 1 && groups.every((g) => g.length === 1)) digits = groups.join('');
    else return null;
    return FORMATION_BY_DIGITS.get(digits) || null;
  }

  function formationById(id) {
    const norm = normalizeFormationId(id);
    return norm ? FORMATION_BY_ID.get(norm) : null;
  }

  // Zařazení podle KÓDU pozice (jen pro barvy a popisky). Geometrie řad se bere ze souřadnic, ne z kódu.
  const LINE_BY_POS = {
    GK: 'gk',
    SW: 'def', CB: 'def', RCB: 'def', LCB: 'def', RB: 'def', LB: 'def', WB: 'def', RWB: 'def', LWB: 'def',
    DM: 'mid', CDM: 'mid', RDM: 'mid', LDM: 'mid', CM: 'mid', RCM: 'mid', LCM: 'mid', RM: 'mid', LM: 'mid',
    AM: 'mid', CAM: 'mid', RAM: 'mid', LAM: 'mid',
    RW: 'att', LW: 'att', ST: 'att', CF: 'att', SS: 'att', RST: 'att', LST: 'att', RF: 'att', LF: 'att', FW: 'att',
  };

  /** 'gk'|'def'|'mid'|'att' podle kódu pozice; neznámý kód vrátí null (nehádá se). */
  function lineOf(pos) {
    if (typeof pos !== 'string') return null;
    const key = pos.trim().toUpperCase();
    return has(LINE_BY_POS, key) ? LINE_BY_POS[key] : null;
  }

  /** Nová taktika z šablony formace. Neznámá formace → null (nikdy se tiše nedosadí jiná). */
  function makeTactic(input) {
    const o = isObj(input) ? input : {};
    const f = formationById(o.formation);
    if (!f) return null;
    return {
      id: typeof o.id === 'string' ? o.id : '',
      careerId: typeof o.careerId === 'string' ? o.careerId : null,
      name: typeof o.name === 'string' ? o.name : '',
      kind: o.kind === 'alternative' ? 'alternative' : 'primary',
      formation: f.id,
      mentality: '',
      teamInstructions: [],
      notes: '',
      slots: f.slots.map((s, i) => ({ key: 's' + (i + 1), pos: s.pos, x: s.x, y: s.y, ox: s.x, oy: s.y, playerId: null, role: '', duty: '' })),
      source: { type: 'manual', fileName: null, importedAt: null, fields: {} },
    };
  }

  // ---------------------------------------------------------------- import a export ručního plánu
  const DEFAULT_ATTRIBUTES = ['pace', 'stamina', 'passing', 'defending', 'finishing'];
  const MAX_PLAN_PLAYERS = 30; // v týmu je 11 hráčů; víc je poškozený soubor a rozbor dvojic by se zbytečně protáhl
  const INSTR_IN = 'S míčem: ';
  const INSTR_OUT = 'Bez míče: ';

  const cleanId = (raw) => String(raw === undefined || raw === null ? '' : raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  const pointOf = (src) => (isObj(src) && isNum(src.x) && isNum(src.y) ? { x: src.x, y: src.y } : null);
  const inRange = (p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

  /** Plán 'fm27-tactical-coach-manual-plan' v1 (objekt nebo text JSON) → {tactic, players, report}.
      Všechno z plánu je user_entered. Neplatný soubor: report.errors a tactic null, bez výjimky.
      opts (nepovinné): {now (uloží se jako source.importedAt), fileName, careerId, id, kind}. */
  function importPlanJson(input, opts) {
    const o = isObj(opts) ? opts : {};
    const report = { userEntered: [], unknown: [], warnings: [], errors: [], club: null, provenance: provenanceOf(LABEL_USER) };
    const failed = () => ({ tactic: null, players: [], report });
    const fail = (msg) => {
      report.errors.push(msg);
      return failed();
    };

    let plan = input;
    if (typeof input === 'string') {
      try {
        plan = JSON.parse(input);
      } catch (e) {
        return fail('Soubor není platný JSON.');
      }
    }
    if (!isObj(plan)) return fail('Plán musí být objekt JSON ve formátu „' + PLAN_FORMAT + '“.');
    if (plan.format !== PLAN_FORMAT) {
      return fail(`Neznámý formát souboru („${typeof plan.format === 'string' ? plan.format : '?'}“); očekává se „${PLAN_FORMAT}“.`);
    }
    if (plan.version !== PLAN_VERSION) {
      return fail(`Verze formátu (${plan.version === undefined ? 'chybí' : JSON.stringify(plan.version)}) není podporovaná; umím číslo ${PLAN_VERSION}.`);
    }

    const shapes = isObj(plan.phaseShapes) ? plan.phaseShapes : {};
    const inShape = isObj(shapes.in) ? shapes.in : null;
    const outShape = isObj(shapes.out) ? shapes.out : null;
    const byRawId = (shape) => {
      const map = new Map();
      if (shape && Array.isArray(shape.players)) for (const p of shape.players) if (isObj(p) && p.id !== undefined && p.id !== null) map.set(String(p.id), p);
      return map;
    };
    const inMap = byRawId(inShape);
    const outMap = byRawId(outShape);

    // Hlavní seznam hráčů; když chybí, vezmou se hráči z fáze „in“ (a řekne se to).
    let list = Array.isArray(plan.players) && plan.players.length ? plan.players : null;
    if (!list && inShape && Array.isArray(inShape.players) && inShape.players.length) {
      list = inShape.players;
      report.warnings.push('Plán nemá hlavní seznam hráčů; použiti hráči z fáze „in“ (s míčem).');
    }
    if (!list) return fail('Plán neobsahuje žádné hráče.');
    if (list.length > MAX_PLAN_PLAYERS) return fail(`Plán obsahuje příliš mnoho hráčů (${list.length}); povoleno nejvýš ${MAX_PLAN_PLAYERS}.`);

    const players = [];
    const slots = [];
    const seen = new Set();
    const noOut = [];
    let outCount = 0;
    const unknownPos = [];
    const provided = { name: 0, role: 0, foot: 0, attributes: 0, flags: 0, pos: 0 };

    list.forEach((p, i) => {
      const where = `Hráč č. ${i + 1}`;
      if (!isObj(p)) {
        report.errors.push(`${where} není objekt.`);
        return;
      }
      const rawId = p.id === undefined || p.id === null ? '' : String(p.id);
      let id = cleanId(rawId);
      if (!id) {
        id = 'p' + (i + 1);
        report.warnings.push(`${where} nemá použitelné id; přiděleno „${id}“.`);
      } else if (id !== rawId) {
        report.warnings.push(`Id hráče „${rawId}“ upraveno na „${id}“ (povoleno jen a–z a 0–9).`);
      }
      if (seen.has(id)) {
        report.errors.push(`Duplicitní id hráče „${id}“.`);
        return;
      }
      seen.add(id);

      // Souřadnice: fáze „in“ má přednost před hlavním seznamem. Bez platných souřadnic se hráč nedá nakreslit,
      // takže je to chyba souboru (hráč se nevynechává potichu).
      const inPt = pointOf(rawId ? inMap.get(rawId) : null) || pointOf(p);
      if (!inPt) {
        report.errors.push(`Hráč „${id}“ nemá platné souřadnice x a y (čísla 0–100).`);
        return;
      }
      if (!inRange(inPt)) {
        report.errors.push(`Hráč „${id}“ má souřadnice mimo hřiště (x ${inPt.x}, y ${inPt.y}); povoleno 0–100.`);
        return;
      }
      let outPt = pointOf(rawId ? outMap.get(rawId) : null);
      if (outPt && !inRange(outPt)) {
        report.errors.push(`Hráč „${id}“ má souřadnice bez míče mimo hřiště (x ${outPt.x}, y ${outPt.y}); povoleno 0–100.`);
        return;
      }
      if (outPt) outCount++;
      else {
        noOut.push(id);
        outPt = inPt;
      }

      const pos = typeof p.position === 'string' ? p.position.trim().toUpperCase() : '';
      if (pos) provided.pos++;
      else report.warnings.push(`Hráč „${id}“ nemá kód pozice.`);
      if (pos && lineOf(pos) === null) unknownPos.push(`„${pos}“ (${id})`);
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const role = typeof p.role === 'string' ? p.role.trim() : '';
      const foot = typeof p.foot === 'string' && p.foot.trim() ? p.foot.trim() : 'unknown';
      const attributes = {};
      if (isObj(p.attributes)) {
        for (const k of Object.keys(p.attributes)) {
          const v = p.attributes[k];
          if (isNum(v)) attributes[k] = v;
          else {
            attributes[k] = null;
            if (v !== null) report.warnings.push(`Atribut „${k}“ hráče „${id}“ není číslo; uložen jako neznámý (null).`);
          }
        }
      }
      // Plán bez atributů se uloží jako výchozí soubor (pět neznámých, null); export totéž píše, takže převod je stabilní.
      if (!Object.keys(attributes).length) for (const k of DEFAULT_ATTRIBUTES) attributes[k] = null;
      const attrKnown = Object.keys(attributes).some((k) => attributes[k] !== null);
      // Příznaky false/false jsou výchozí stav, ne zadání: za zadané (user_entered) platí jen skutečně označené.
      const flagsGiven = isObj(p.flags);
      const flagsMarked = flagsGiven && (p.flags.injury === true || p.flags.fatigue === true);
      if (name) provided.name++;
      if (role) provided.role++;
      if (foot !== 'unknown') provided.foot++;
      if (attrKnown) provided.attributes++;
      if (flagsMarked) provided.flags++;

      players.push({
        id,
        careerId: typeof o.careerId === 'string' ? o.careerId : null,
        name,
        positions: pos ? [pos] : [],
        role,
        duty: '',
        foot,
        age: null,
        attributes,
        strengths: [],
        weaknesses: [],
        flags: { injury: flagsGiven && p.flags.injury === true, fatigue: flagsGiven && p.flags.fatigue === true },
        notes: '',
        source: 'plan',
        prov: {
          name: name ? LABEL_USER : 'unknown',
          positions: pos ? LABEL_USER : 'unknown',
          role: role ? LABEL_USER : 'unknown',
          duty: 'unknown',
          foot: foot !== 'unknown' ? LABEL_USER : 'unknown',
          age: 'unknown',
          attributes: attrKnown ? LABEL_USER : 'unknown',
          flags: flagsMarked ? LABEL_USER : 'unknown',
          strengths: 'unknown',
          weaknesses: 'unknown',
        },
      });
      slots.push({ key: 's' + (slots.length + 1), pos, x: inPt.x, y: inPt.y, ox: outPt.x, oy: outPt.y, playerId: id, role, duty: '' });
    });

    if (report.errors.length) return failed();

    if (players.length !== 11) report.warnings.push(`Plán obsahuje ${players.length} ${plural(players.length, 'hráče', 'hráče', 'hráčů')} místo 11.`);
    if (unknownPos.length) {
      report.warnings.push(`Neznámý kód pozice: ${unknownPos.join(', ')}; v analýze se hráč počítá jako hráč v poli.`);
    }
    if (!outShape) {
      report.warnings.push('Plán neobsahuje fázi „out“ (bez míče); souřadnice bez míče jsou převzaté ze souřadnic s míčem (ox = x, oy = y).');
    } else if (noOut.length) {
      report.warnings.push(`Fáze „out“ (bez míče) nemá souřadnice pro ${noOut.map((id) => `„${id}“`).join(', ')}; použity souřadnice s míčem (ox = x, oy = y).`);
    }
    if (!inShape) report.warnings.push('Plán neobsahuje fázi „in“ (s míčem); souřadnice s míčem jsou z hlavního seznamu hráčů.');
    if (Array.isArray(plan.variants) && plan.variants.length) {
      report.warnings.push(`Plán obsahuje ${plan.variants.length} ${plural(plan.variants.length, 'variantu', 'varianty', 'variant')}; načteno je jen hlavní rozestavení, varianty se zatím nenačítají.`);
    }

    // Formace: hlavní text, jinak fáze. Nerozpoznaná formace se nehádá (rozestavení se přesto načte ze souřadnic).
    const fMain = normalizeFormationId(plan.formation);
    const fIn = inShape ? normalizeFormationId(inShape.formation) : null;
    const fOut = outShape ? normalizeFormationId(outShape.formation) : null;
    const formationId = fMain || fIn || fOut || '';
    const givenText = typeof plan.formation === 'string' ? plan.formation.trim() : '';
    if (!formationId) {
      report.warnings.push(
        `${givenText ? `Formace „${givenText}“ není mezi šablonami` : 'Plán neuvádí formaci'}; rozestavení je načtené ze souřadnic hráčů a formace zůstává neznámá.`
      );
    } else if (!fMain) {
      report.warnings.push(`Hlavní formaci v plánu${givenText ? ` („${givenText}“)` : ''} nelze přečíst; použita formace z fáze plánu („${formationId}“).`);
    } else if ((fIn && fIn !== fMain) || (fOut && fOut !== fMain)) {
      report.warnings.push(`Formace ve fázích plánu se liší od hlavní („${givenText}“, s míčem „${fIn || '?'}“, bez míče „${fOut || '?'}“); použita hlavní („${fMain}“).`);
    }

    // Pokyny jsou volný text po fázích; do taktiky jdou jako řádky s předponou fáze (export je podle ní vrátí).
    const instructionLines = (shape, prefix) => {
      const raw = shape ? shape.instructions : '';
      if (raw === undefined || raw === null || raw === '') return [];
      if (typeof raw !== 'string') {
        report.warnings.push(`Pokyny ve fázi „${prefix.trim().replace(/:$/, '')}“ nejsou text; přeskočeny.`);
        return [];
      }
      return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => prefix + s);
    };
    const teamInstructions = instructionLines(inShape, INSTR_IN).concat(instructionLines(outShape, INSTR_OUT));

    const name = typeof plan.tactic === 'string' ? plan.tactic.trim() : '';
    report.club = typeof plan.club === 'string' && plan.club.trim() ? plan.club.trim() : null;

    // Původ polí: co plán obsahoval, je user_entered; co formát nenese (mentalita, povinnost, věk…), je neznámé.
    const mark = (path, given) => (given ? report.userEntered : report.unknown).push(path);
    mark('tactic.name', !!name);
    mark('tactic.formation', !!formationId);
    mark('tactic.mentality', false);
    mark('tactic.teamInstructions', teamInstructions.length > 0);
    mark('slot.pos', provided.pos > 0);
    mark('slot.x', true);
    mark('slot.y', true);
    mark('slot.ox', outCount > 0);
    mark('slot.oy', outCount > 0);
    mark('slot.role', provided.role > 0);
    mark('slot.duty', false);
    mark('player.name', provided.name > 0);
    mark('player.positions', provided.pos > 0);
    mark('player.role', provided.role > 0);
    mark('player.duty', false);
    mark('player.foot', provided.foot > 0);
    mark('player.age', false);
    mark('player.attributes', provided.attributes > 0);
    mark('player.flags', provided.flags > 0);
    mark('player.strengths', false);
    mark('player.weaknesses', false);
    const fields = {};
    for (const path of report.userEntered) fields[path] = LABEL_USER;
    for (const path of report.unknown) fields[path] = 'unknown';

    const tactic = {
      id: typeof o.id === 'string' ? o.id : '',
      careerId: typeof o.careerId === 'string' ? o.careerId : null,
      name,
      kind: o.kind === 'alternative' ? 'alternative' : 'primary',
      formation: formationId,
      mentality: '',
      teamInstructions,
      notes: '',
      slots,
      source: {
        type: 'plan_json',
        fileName: typeof o.fileName === 'string' ? o.fileName : null,
        importedAt: o.now === undefined ? null : o.now,
        fields,
      },
    };
    return { tactic, players, report };
  }

  /** Taktika + hráči → plán 'fm27-tactical-coach-manual-plan' v1 (kruhově zpět importovatelný). Bez platné taktiky
      (každý slot má čísla x a y) vrátí null. Slot bez hráče se vyexportuje jako prázdný hráč s kódem pozice slotu;
      chybějící ox/oy se vezmou z x/y, jako to dělá makeTactic. */
  function exportPlanJson(tactic, playerList, opts) {
    if (!isObj(tactic) || !Array.isArray(tactic.slots) || !tactic.slots.length) return null;
    if (!tactic.slots.every((s) => isObj(s) && isNum(s.x) && isNum(s.y))) return null; // souřadnice se nevymýšlejí
    const o = isObj(opts) ? opts : {};
    const byId = new Map();
    if (playerList instanceof Map) for (const [k, v] of playerList) byId.set(String(k), v);
    else if (Array.isArray(playerList)) for (const p of playerList) if (isObj(p) && p.id !== undefined && p.id !== null) byId.set(String(p.id), p);

    const used = new Set();
    const rows = tactic.slots.map((slot, i) => {
      const player = slot.playerId !== undefined && slot.playerId !== null ? byId.get(String(slot.playerId)) || null : null;
      let id = player && typeof player.id === 'string' && player.id ? player.id : 'p' + (i + 1);
      if (used.has(id)) id = 'p' + (i + 1);
      used.add(id);
      const attributes = {};
      if (player && isObj(player.attributes) && Object.keys(player.attributes).length) {
        for (const k of Object.keys(player.attributes)) attributes[k] = isNum(player.attributes[k]) ? player.attributes[k] : null;
      } else for (const k of DEFAULT_ATTRIBUTES) attributes[k] = null;
      const flags = player && isObj(player.flags) ? player.flags : {};
      const { x, y } = slot;
      return {
        base: {
          id,
          name: player && typeof player.name === 'string' ? player.name : '',
          position: typeof slot.pos === 'string' && slot.pos ? slot.pos : player && Array.isArray(player.positions) && player.positions[0] ? String(player.positions[0]) : '',
          role: (typeof slot.role === 'string' && slot.role) || (player && typeof player.role === 'string' ? player.role : ''),
          foot: player && typeof player.foot === 'string' && player.foot ? player.foot : 'unknown',
          attributes,
          flags: { injury: flags.injury === true, fatigue: flags.fatigue === true },
        },
        x,
        y,
        ox: isNum(slot.ox) && isNum(slot.oy) ? slot.ox : x,
        oy: isNum(slot.ox) && isNum(slot.oy) ? slot.oy : y,
      };
    });
    const withPoint = (r, px, py) => Object.assign({}, r.base, { attributes: Object.assign({}, r.base.attributes), flags: Object.assign({}, r.base.flags), x: px, y: py });

    // Pokyny: řádek s předponou „Bez míče: “ patří do fáze out, ostatní do fáze in.
    const inLines = [];
    const outLines = [];
    for (const line of Array.isArray(tactic.teamInstructions) ? tactic.teamInstructions : []) {
      const text = String(line);
      if (text.startsWith(INSTR_OUT)) outLines.push(text.slice(INSTR_OUT.length));
      else inLines.push(text.startsWith(INSTR_IN) ? text.slice(INSTR_IN.length) : text);
    }
    const f = formationById(tactic.formation);
    const label = f ? f.label : '';
    return {
      format: PLAN_FORMAT,
      version: PLAN_VERSION,
      club: typeof o.club === 'string' ? o.club : '',
      tactic: typeof tactic.name === 'string' ? tactic.name : '',
      formation: label,
      players: rows.map((r) => withPoint(r, r.x, r.y)),
      phaseShapes: {
        in: { formation: label, players: rows.map((r) => withPoint(r, r.x, r.y)), instructions: inLines.join('\n') },
        out: { formation: label, players: rows.map((r) => withPoint(r, r.ox, r.oy)), instructions: outLines.join('\n') },
      },
      activePhase: 'in',
      currentVariant: null,
      variants: [],
      defaultPair: { in: null, out: null },
    };
  }

  // ---------------------------------------------------------------- geometrie: kanály, třetiny, řady
  // Kanály podle x (hranice 20/40/60/80) a třetiny podle y (33,3 / 66,7) jsou pevné; hráč přesně na hranici
  // patří do kanálu vpravo od ní (x = 20 je levý meziprostor, x = 80 pravé křídlo), takže body formací se hranic vyhýbají.
  const CHANNELS = deepFreeze([
    { id: 'left', label: 'levé křídlo', range: 'x < 20', slug: 'left' },
    { id: 'leftHalf', label: 'levý meziprostor', range: '20 ≤ x < 40', slug: 'left-half' },
    { id: 'centre', label: 'střed', range: '40 ≤ x < 60', slug: 'centre' },
    { id: 'rightHalf', label: 'pravý meziprostor', range: '60 ≤ x < 80', slug: 'right-half' },
    { id: 'right', label: 'pravé křídlo', range: 'x ≥ 80', slug: 'right' },
  ]);
  const THIRDS = deepFreeze([
    { id: 'def', label: 'obranná třetina', range: 'y > 66,7' },
    { id: 'mid', label: 'střední třetina', range: '33,3 ≤ y ≤ 66,7' },
    { id: 'att', label: 'útočná třetina', range: 'y < 33,3' },
  ]);
  const CHANNEL_IDS = CHANNELS.map((c) => c.id);
  const THIRD_IDS = THIRDS.map((t) => t.id);
  const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));
  const THIRD_BY_ID = new Map(THIRDS.map((t) => [t.id, t]));

  const channelOf = (x) => (x < 20 ? 'left' : x < 40 ? 'leftHalf' : x < 60 ? 'centre' : x < 80 ? 'rightHalf' : 'right');
  const thirdOf = (y) => (y < 33.3 ? 'att' : y > 66.7 ? 'def' : 'mid');

  /** Pojmenování řad podle pořadí zezadu: první obrana, poslední útok, mezi nimi záloha (nebo záloha 1, 2, …). */
  function lineNames(n) {
    if (n <= 0) return [];
    if (n === 1) return ['all'];
    const names = ['def'];
    const mids = n - 2;
    for (let i = 1; i <= mids; i++) names.push(mids === 1 ? 'mid' : 'mid' + i);
    names.push('att');
    return names;
  }
  const LINE_LABELS = { all: 'všichni v poli', def: 'obrana', mid: 'záloha', att: 'útok' };
  const lineLabel = (name) => LINE_LABELS[name] || String(name).replace(/^mid(\d+)$/, 'záloha $1');

  /** Body slotů pro fázi. Slot bez platných souřadnic se přeskočí (a vypíše se); ox/oy chybějící → x/y. */
  function readPoints(tactic, phase) {
    const slots = isObj(tactic) && Array.isArray(tactic.slots) ? tactic.slots : null;
    if (!slots) return { points: [], skipped: [], errors: ['Taktika nemá seznam slotů.'] };
    const points = [];
    const skipped = [];
    slots.forEach((s, i) => {
      const key = isObj(s) && typeof s.key === 'string' && s.key ? s.key : 's' + (i + 1);
      if (!isObj(s)) {
        skipped.push(key);
        return;
      }
      let x = s.x;
      let y = s.y;
      if (phase === 'out' && isNum(s.ox) && isNum(s.oy)) {
        x = s.ox;
        y = s.oy;
      }
      if (!isNum(x) || !isNum(y)) {
        skipped.push(key);
        return;
      }
      const pos = typeof s.pos === 'string' ? s.pos.trim().toUpperCase() : '';
      points.push({ key, pos, x, y, gk: lineOf(pos) === 'gk', order: i });
    });
    return { points, skipped, errors: [] };
  }

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const tag = (p) => `${p.pos || '?'} (${p.key})`;

  /** Vnitřní měření: analýza + body, aby je findConflicts nemusel počítat podruhé. */
  function measure(tactic, opts) {
    const o = isObj(opts) ? opts : {};
    const phase = o.phase === 'out' ? 'out' : 'in';
    const th = resolveThresholds(o.thresholds);
    const read = readPoints(tactic, phase);
    const pts = read.points;
    const field = pts.filter((p) => !p.gk);
    const warnings = [];
    const errors = read.errors.slice();
    if (o.phase !== undefined && !PHASES.includes(o.phase)) warnings.push(`Neznámá fáze „${o.phase}“; použita fáze „in“ (s míčem).`);
    if (read.skipped.length) warnings.push(`Sloty bez platných souřadnic se do rozboru nepočítají: ${read.skipped.join(', ')}.`);
    if (!errors.length && !pts.length) errors.push('Rozestavení nemá žádného hráče s platnými souřadnicemi.');

    // Třetiny, kanály a zóny popisují, KDE hráči stojí, proto se počítá všech 11 včetně brankáře.
    const thirds = { def: 0, mid: 0, att: 0 };
    const channels = { left: 0, leftHalf: 0, centre: 0, rightHalf: 0, right: 0 };
    const zones = {};
    for (const t of THIRD_IDS) for (const c of CHANNEL_IDS) zones[`${t}/${c}`] = 0;
    for (const p of pts) {
      const t = thirdOf(p.y);
      const c = channelOf(p.x);
      thirds[t]++;
      channels[c]++;
      zones[`${t}/${c}`]++;
    }

    // Řady: hráči v poli (bez brankáře) seřazení podle y od nejhlubšího, řez tam, kde je mezera větší než práh.
    const sorted = field.slice().sort((a, b) => b.y - a.y || a.order - b.order);
    const groups = [];
    for (const p of sorted) {
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1].y - p.y <= th.lineBreakY) last.push(p);
      else groups.push([p]);
    }
    const names = lineNames(groups.length);
    const keysByX = (list) => list.slice().sort((a, b) => a.x - b.x || a.order - b.order).map((p) => p.key);
    const info = groups.map((g, i) => {
      const ys = g.map((p) => p.y);
      return {
        name: names[i],
        label: lineLabel(names[i]),
        players: g,
        keys: keysByX(g),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        avgY: ys.reduce((a, b) => a + b, 0) / ys.length,
      };
    });
    const xRange = (list) => (list.length ? Math.max(...list.map((p) => p.x)) - Math.min(...list.map((p) => p.x)) : 0);
    const lines = info.map((l) => ({
      name: l.name,
      label: l.label,
      keys: l.keys,
      count: l.players.length,
      avgY: r1(l.avgY),
      minY: r1(l.minY),
      maxY: r1(l.maxY),
    }));
    const gaps = [];
    for (let i = 0; i < info.length - 1; i++) {
      // Mezera mezi řadami: od nejvyššího hráče zadní řady k nejhlubšímu hráči přední řady; vedle ní i střed–střed.
      gaps.push({
        between: [info[i].name, info[i + 1].name],
        gap: r1(info[i].minY - info[i + 1].maxY),
        centreGap: r1(info[i].avgY - info[i + 1].avgY),
      });
    }
    const perLine = {};
    for (const l of info) perLine[l.name] = r1(xRange(l.players));
    const depth = field.length ? r1(Math.max(...field.map((p) => p.y)) - Math.min(...field.map((p) => p.y))) : 0;
    const width = r1(xRange(field));
    const restDefence = field.filter((p) => p.y > th.restDefenceLineY).length;

    const analysis = {
      ok: errors.length === 0,
      errors,
      warnings,
      phase,
      thresholds: th,
      counts: { players: pts.length, outfield: field.length, goalkeepers: pts.length - field.length },
      skipped: read.skipped,
      lines,
      gaps,
      width: { overall: width, perLine },
      depth,
      thirds,
      channels,
      zones,
      restDefence,
      balance: { left: field.filter((p) => p.x < 50).length, centre: field.filter((p) => p.x === 50).length, right: field.filter((p) => p.x > 50).length },
      // Totéž co hloubka a šířka, jen pod názvem pro obrazovku „kompaktnost“.
      compactness: { depth, width },
    };
    return { analysis, pts, field, info, th, phase };
  }

  /** Rozbor tvaru jedné fáze. Čistá geometrie nakreslených bodů; nic o chování hráčů ve hře. */
  function analyzeShape(tactic, opts) {
    return measure(tactic, opts).analysis;
  }

  const FACT_BASIS = (phase) =>
    `Spočteno z nakreslených pozic hráčů (${PHASE_LABEL[phase]}); popisuje rozložení, které sis nakreslil, ne chování hráčů ve hře.`;

  /** Popisná fakta o tvaru (jen geometrie, všechna 'info'). */
  function shapeFacts(analysis, opts) {
    if (!isObj(analysis) || !analysis.ok) return [];
    const o = isObj(opts) ? opts : {};
    const phase = PHASES.includes(o.phase) ? o.phase : analysis.phase === 'out' ? 'out' : 'in';
    const P = PHASE_CAP[phase];
    const basis = FACT_BASIS(phase);
    const facts = [];
    const add = (id, kind, text, values) => facts.push({ id, kind, severity: 'info', text, values, basis });

    if (analysis.lines.length) {
      add(
        'geo-shape-lines',
        'shape_lines',
        `${P}: řady podle nakreslené svislé polohy, zezadu: ${analysis.lines.map((l) => `${l.label}: ${l.count}`).join(', ')} (hráči v poli bez brankáře).`,
        { counts: analysis.lines.map((l) => l.count), names: analysis.lines.map((l) => l.name) }
      );
      add('geo-shape-size', 'shape_size', `${P}: hloubka týmu je ${fmt(analysis.depth)} a šířka ${units(analysis.width.overall)} (hráči v poli bez brankáře).`, {
        depth: analysis.depth,
        width: analysis.width.overall,
      });
    }
    const t = analysis.thirds;
    add('geo-shape-thirds', 'shape_thirds', `${P}: hráči podle třetin hřiště: obranná ${t.def}, střední ${t.mid}, útočná ${t.att} (včetně brankáře).`, Object.assign({}, t));
    const c = analysis.channels;
    add(
      'geo-shape-channels',
      'shape_channels',
      `${P}: hráči podle kanálů zleva doprava: levé křídlo ${c.left}, levý meziprostor ${c.leftHalf}, střed ${c.centre}, pravý meziprostor ${c.rightHalf}, pravé křídlo ${c.right} (včetně brankáře).`,
      Object.assign({}, c)
    );
    const lineY = analysis.thresholds ? analysis.thresholds.restDefenceLineY : HALF_Y;
    add('geo-shape-rest', 'shape_rest', `${P}: za půlící čárou (y > ${fmt(lineY)}) ${jeJsou(analysis.restDefence)} ${nPlayers(analysis.restDefence)} v poli.`, {
      restDefence: analysis.restDefence,
    });
    if (analysis.gaps.length) {
      const big = analysis.gaps.reduce((best, g) => (g.gap > best.gap ? g : best));
      const label = (name) => (analysis.lines.find((l) => l.name === name) || { label: name }).label;
      add('geo-shape-gap', 'shape_gap', `${P}: největší svislá mezera mezi řadami je ${units(big.gap)}, mezi „${label(big.between[0])}“ a „${label(big.between[1])}“.`, {
        gap: big.gap,
        between: big.between.slice(),
      });
    }
    return facts;
  }

  // ---------------------------------------------------------------- nálezy (konflikty v rozložení)
  const KIND_ORDER = ['line_gap', 'isolated_forward', 'overlap', 'empty_channel', 'thin_rest_defence', 'width_imbalance'];
  const SEVERITY_RANK = { warn: 2, watch: 1, info: 0 };
  const sevOver = (value, thr, th) => (value > thr * th.warnFactor ? 'warn' : 'watch');
  const sevUnder = (value, thr, th) => (value < thr / th.warnFactor ? 'warn' : 'watch');

  /** Nálezy geometrie: line_gap, isolated_forward, overlap, empty_channel, thin_rest_defence, width_imbalance.
      Každý nález říká, z čeho plyne (basis) a že práh je heuristika aplikace. */
  function findConflicts(tactic, opts) {
    return conflictsOf(measure(tactic, opts));
  }

  function conflictsOf(m) {
    if (!m.analysis.ok) return [];
    const { analysis: a, pts, field, info, th, phase } = m;
    const P = PHASE_CAP[phase];
    const where = `Počítá se z nakreslených pozic (${PHASE_LABEL[phase]}), ne z chování hráčů ve hře.`;
    const out = [];

    // line_gap
    for (let i = 0; i < info.length - 1; i++) {
      const back = info[i];
      const front = info[i + 1];
      const gap = back.minY - front.maxY;
      if (!(gap > th.lineGapY)) continue;
      const nearBack = back.players.reduce((best, p) => (p.y < best.y ? p : best));
      const nearFront = front.players.reduce((best, p) => (p.y > best.y ? p : best));
      out.push({
        id: `geo-line-gap-${back.name}-${front.name}`,
        kind: 'line_gap',
        severity: sevOver(gap, th.lineGapY, th),
        text: `${P}: mezi řadami „${back.label}“ a „${front.label}“ je svislá mezera ${units(gap)} (práh ${fmt(th.lineGapY)}); nejbližší hráči jsou ${tag(nearBack)} a ${tag(nearFront)}.`,
        slots: back.keys.concat(front.keys),
        values: { from: back.name, to: front.name, gap: r1(gap), centreGap: r1(back.avgY - front.avgY), threshold: th.lineGapY },
        basis: `${where} Řady jsou shluky hráčů v poli (bez brankáře) podle y, nová řada začíná při mezeře větší než ${fmt(th.lineBreakY)}. Mezera je svislá vzdálenost nejbližších hráčů dvou sousedních řad. Prahy ${fmt(th.lineBreakY)} a ${fmt(th.lineGapY)} jsou heuristiky této aplikace, ne pravidla FM27.`,
      });
    }

    // isolated_forward: nejvíc vysunutý hráč v poli a jeho nejbližší spoluhráč v poli
    if (field.length >= 2) {
      const frontY = Math.min(...field.map((p) => p.y));
      let best = null;
      for (const p of field) {
        if (p.y !== frontY) continue;
        let near = null;
        let nd = Infinity;
        for (const q of field) {
          if (q === p) continue;
          const d = dist(p, q);
          if (d < nd) {
            nd = d;
            near = q;
          }
        }
        if (!best || nd > best.nd) best = { p, near, nd };
      }
      if (best && best.nd > th.isolatedDistance) {
        out.push({
          id: 'geo-isolated-forward',
          kind: 'isolated_forward',
          severity: sevOver(best.nd, th.isolatedDistance, th),
          text: `${P}: nejvíc vysunutý hráč ${tag(best.p)} je od nejbližšího spoluhráče ${tag(best.near)} vzdálený ${units(best.nd)} (práh ${fmt(th.isolatedDistance)}).`,
          slots: [best.p.key, best.near.key],
          values: { distance: r1(best.nd), threshold: th.isolatedDistance, forward: best.p.key, nearest: best.near.key },
          basis: `${where} Měří se vzdálenost v jednotkách hřiště 0–100 mezi nejvíc vysunutým hráčem v poli (nejmenší y) a jeho nejbližším spoluhráčem v poli. Práh ${fmt(th.isolatedDistance)} je heuristika této aplikace, ne pravidlo FM27.`,
        });
      }
    }

    // overlap: dva hráči (včetně brankáře) blíž než práh
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = dist(pts[i], pts[j]);
        if (!(d < th.overlapDistance)) continue;
        const [p, q] = [pts[i], pts[j]];
        out.push({
          id: `geo-overlap-${p.key}-${q.key}`,
          kind: 'overlap',
          severity: sevUnder(d, th.overlapDistance, th),
          text: `${P}: hráči ${tag(p)} a ${tag(q)} ${d === 0 ? 'stojí na stejném místě' : `jsou od sebe jen ${units(d)}`} (práh ${fmt(th.overlapDistance)}).`,
          slots: [p.key, q.key],
          values: { distance: r1(d), threshold: th.overlapDistance },
          basis: `${where} Měří se vzdálenost středů dvou bodů v jednotkách hřiště 0–100. Práh ${fmt(th.overlapDistance)} je heuristika této aplikace, ne pravidlo FM27.`,
        });
      }
    }

    // empty_channel: obranná třetina bez hráče v kanálu (brankář se počítá, stojí ve středu)
    const defCount = {};
    for (const c of CHANNEL_IDS) defCount[c] = 0;
    for (const p of pts) if (thirdOf(p.y) === 'def') defCount[channelOf(p.x)]++;
    const empty = CHANNEL_IDS.filter((c) => defCount[c] === 0);
    for (const c of empty) {
      const ch = CHANNEL_BY_ID.get(c);
      out.push({
        id: `geo-empty-channel-def-${ch.slug}`,
        kind: 'empty_channel',
        severity: empty.length >= th.emptyChannelsWarn ? 'warn' : 'watch',
        text: `${P}: v obranné třetině (${THIRD_BY_ID.get('def').range}) není nikdo v kanálu „${ch.label}“ (${ch.range}).`,
        slots: [],
        values: { channel: c, third: 'def', emptyChannels: empty.length, warnFrom: th.emptyChannelsWarn },
        basis: `${where} Kanály jsou pevné pásy podle x (hranice 20/40/60/80), obranná třetina je y > 66,7; počítá se i brankář. Prázdný kanál je jen geometrický fakt, jeho význam záleží na tom, co hráči kolem dělají. Hranice ${th.emptyChannelsWarn} prázdných kanálů pro vyšší závažnost je heuristika této aplikace, ne pravidlo FM27.`,
      });
    }

    // thin_rest_defence: jen ve fázi s míčem
    if (phase === 'in' && a.restDefence < th.minRestDefence) {
      out.push({
        id: 'geo-thin-rest-defence',
        kind: 'thin_rest_defence',
        severity: a.restDefence <= th.minRestDefence - 2 ? 'warn' : 'watch',
        text: `S míčem: za půlící čárou (y > ${fmt(th.restDefenceLineY)}) ${jeJsou(a.restDefence)} jen ${nPlayers(a.restDefence)} v poli (práh: aspoň ${th.minRestDefence}).`,
        slots: field.filter((p) => p.y > th.restDefenceLineY).map((p) => p.key),
        values: { restDefence: a.restDefence, threshold: th.minRestDefence, lineY: th.restDefenceLineY },
        basis: `${where} Počítají se hráči v poli (bez brankáře) s y > ${fmt(th.restDefenceLineY)} v nakreslené poloze s míčem; nic z toho neříká, kdo se při ztrátě míče vrací. Hodnota ${th.minRestDefence} je heuristika této aplikace, ne pravidlo FM27.`,
      });
    }

    // width_imbalance: hráči v poli vlevo a vpravo od osy (x = 50 na osu)
    const diff = Math.abs(a.balance.left - a.balance.right);
    if (diff > th.maxWidthImbalance) {
      const heavy = a.balance.left > a.balance.right ? 'left' : 'right';
      out.push({
        id: 'geo-width-imbalance',
        kind: 'width_imbalance',
        severity: diff >= th.maxWidthImbalance + 2 ? 'warn' : 'watch',
        text: `${P}: vlevo od osy (x < 50) ${jeJsou(a.balance.left)} ${nPlayers(a.balance.left)} v poli, vpravo ${a.balance.right}; rozdíl ${diff} (práh ${th.maxWidthImbalance}).`,
        slots: field.filter((p) => (heavy === 'left' ? p.x < 50 : p.x > 50)).map((p) => p.key),
        values: { left: a.balance.left, right: a.balance.right, centre: a.balance.centre, difference: diff, threshold: th.maxWidthImbalance, heavierSide: heavy },
        basis: `${where} Počítají se hráči v poli (bez brankáře) podle strany osy hřiště, hráči přesně na ose (x = 50) se nepočítají. Práh ${th.maxWidthImbalance} je heuristika této aplikace, ne pravidlo FM27.`,
      });
    }

    return out
      .map((f, i) => ({ f, i }))
      .sort((p, q) => SEVERITY_RANK[q.f.severity] - SEVERITY_RANK[p.f.severity] || KIND_ORDER.indexOf(p.f.kind) - KIND_ORDER.indexOf(q.f.kind) || p.i - q.i)
      .map((e) => e.f);
  }

  // ---------------------------------------------------------------- porovnání dvou taktik
  const COMPARE_NOTE = 'Porovnání je jen geometrie nakreslených pozic; neříká nic o účinku v zápase ani o tom, jak se hráči chovají ve FM27.';

  function metricsOf(m, conflicts) {
    const a = m.analysis;
    return {
      lineCount: a.lines.length,
      lineSizes: a.lines.map((l) => l.count),
      depth: a.depth,
      width: a.width.overall,
      restDefence: a.restDefence,
      maxLineGap: a.gaps.length ? Math.max(...a.gaps.map((g) => g.gap)) : 0,
      thirdsDef: a.thirds.def,
      thirdsMid: a.thirds.mid,
      thirdsAtt: a.thirds.att,
      channelsLeft: a.channels.left,
      channelsLeftHalf: a.channels.leftHalf,
      channelsCentre: a.channels.centre,
      channelsRightHalf: a.channels.rightHalf,
      channelsRight: a.channels.right,
      conflicts: conflicts.length,
      conflictsWarn: conflicts.filter((c) => c.severity === 'warn').length,
    };
  }

  /** Porovná geometrii dvou taktik ve stejné fázi. newConflicts jsou nálezy jen v b, resolvedConflicts jen v a. */
  function compareTactics(a, b, opts) {
    const o = isObj(opts) ? opts : {};
    const phase = o.phase === 'out' ? 'out' : 'in';
    const ma = measure(a, o);
    const mb = measure(b, o);
    if (!ma.analysis.ok || !mb.analysis.ok) {
      const errors = [].concat(ma.analysis.ok ? [] : ma.analysis.errors.map((e) => `První taktika: ${e}`), mb.analysis.ok ? [] : mb.analysis.errors.map((e) => `Druhá taktika: ${e}`));
      return { phase, ok: false, errors, summary: ['Taktiky nejde porovnat: ' + errors.join(' ')], metrics: { a: null, b: null, delta: null }, newConflicts: [], resolvedConflicts: [], note: COMPARE_NOTE };
    }
    const ca = conflictsOf(ma);
    const cb = conflictsOf(mb);
    const xa = metricsOf(ma, ca);
    const xb = metricsOf(mb, cb);
    const delta = {};
    for (const k of Object.keys(xa)) if (isNum(xa[k])) delta[k] = r1(xb[k] - xa[k]);

    const summary = [];
    const nameOf = (t) => {
      const f = isObj(t) ? formationById(t.formation) : null;
      return f ? f.label : null;
    };
    const fa = nameOf(a);
    const fb = nameOf(b);
    if (fa && fb && fa !== fb) summary.push(`Formace: ${fa} → ${fb}.`);
    if (xa.lineSizes.join() !== xb.lineSizes.join()) {
      summary.push(`Řady zezadu podle nakreslené polohy (${PHASE_LABEL[phase]}): ${xa.lineSizes.join(' – ')} → ${xb.lineSizes.join(' – ')}.`);
    }
    const numeric = [
      ['depth', 'Hloubka týmu (hráči v poli)'],
      ['width', 'Šířka týmu (hráči v poli)'],
      ['restDefence', 'Hráči v poli za půlící čárou'],
      ['maxLineGap', 'Největší svislá mezera mezi řadami'],
    ];
    for (const [k, label] of numeric) if (delta[k] !== 0) summary.push(`${label}: ${fmt(xa[k])} → ${fmt(xb[k])} (${signed(delta[k])}).`);
    const t = (x) => [x.thirdsDef, x.thirdsMid, x.thirdsAtt].join('/');
    if (t(xa) !== t(xb)) summary.push(`Hráči podle třetin (obranná/střední/útočná): ${t(xa)} → ${t(xb)}.`);
    const ch = (x) => [x.channelsLeft, x.channelsLeftHalf, x.channelsCentre, x.channelsRightHalf, x.channelsRight].join('/');
    if (ch(xa) !== ch(xb)) summary.push(`Hráči podle kanálů (levé křídlo/levý meziprostor/střed/pravý meziprostor/pravé křídlo): ${ch(xa)} → ${ch(xb)}.`);

    const idsA = new Set(ca.map((c) => c.id));
    const idsB = new Set(cb.map((c) => c.id));
    const newConflicts = cb.filter((c) => !idsA.has(c.id));
    const resolvedConflicts = ca.filter((c) => !idsB.has(c.id));
    if (xa.conflicts !== xb.conflicts) summary.push(`Počet nálezů geometrie: ${xa.conflicts} → ${xb.conflicts}.`);
    for (const c of newConflicts) summary.push(`Nový nález: ${c.text}`);
    for (const c of resolvedConflicts) summary.push(`Vyřešený nález: ${c.text}`);
    if (!summary.length) summary.push('Sledované míry geometrie jsou u obou rozložení stejné.');

    return { phase, ok: true, errors: [], summary, metrics: { a: xa, b: xb, delta }, newConflicts, resolvedConflicts, note: COMPARE_NOTE };
  }

  // ---------------------------------------------------------------- přečíslení soupeřem
  /** Soupeřova formace s míčem (fáze in) otočená o 180° do našeho rámce (x' = 100 − x, y' = 100 − y) proti našemu
      tvaru bez míče (fáze out), jen v naší polovině (y > 50), po zónách třetina × kanál. Brankáře nepočítáme.
      Parametr phase se nepoužívá: porovnává se vždy „soupeř s míčem proti nám bez míče“. */
  function opponentOverloads(own, opp, opts) {
    const th = resolveThresholds(isObj(opts) ? opts.thresholds : null);
    const mine = readPoints(own, 'out').points.filter((p) => !p.gk && p.y > HALF_Y);
    const theirs = readPoints(opp, 'in')
      .points.filter((p) => !p.gk)
      .map((p) => Object.assign({}, p, { x: 100 - p.x, y: 100 - p.y }))
      .filter((p) => p.y > HALF_Y);
    const basis =
      'Počty hráčů v poli (bez brankáře) v nakreslených pozicích: soupeř s míčem (otočený o 180°) proti nám bez míče, jen v naší polovině (y > 50), po pevných kanálech a třetinách. ' +
      'Hranice kanálů (20/40/60/80) a prahy jsou heuristiky této aplikace, ne pravidla FM27; hráč u hranice se počítá do jednoho kanálu. Není to simulace zápasu ani tvrzení o chování hráčů.';
    const out = [];
    for (const third of ['def', 'mid']) {
      for (const channel of CHANNEL_IDS) {
        const inZone = (p) => thirdOf(p.y) === third && channelOf(p.x) === channel;
        const ownIn = mine.filter(inZone);
        const oppIn = theirs.filter(inZone);
        const diff = oppIn.length - ownIn.length;
        if (oppIn.length < th.overloadMinOpp || diff < th.overloadMinDiff) continue;
        const ch = CHANNEL_BY_ID.get(channel);
        out.push({
          id: `ovl-${third}-${ch.slug}`,
          channel,
          third,
          own: ownIn.length,
          opp: oppIn.length,
          diff,
          text: `V naší polovině (${THIRD_BY_ID.get(third).label}), kanál „${ch.label}“, hráčů v poli: soupeř s míčem ${oppIn.length}, my bez míče ${ownIn.length} (rozdíl +${diff}).`,
          ownSlots: ownIn.map((p) => p.key),
          oppSlots: oppIn.map((p) => p.key),
          basis,
        });
      }
    }
    return out.sort((p, q) => q.diff - p.diff || (p.third === q.third ? 0 : p.third === 'def' ? -1 : 1) || CHANNEL_IDS.indexOf(p.channel) - CHANNEL_IDS.indexOf(q.channel));
  }

  // ---------------------------------------------------------------- nálezy → pozorování pro poradce
  const OBS_ID = /[^A-Za-z0-9_.:-]/g;

  /** Nálezy, fakta nebo přečíslení → pozorování se štítkem heuristic_coach (id podle core.normalizeObservations). */
  function factsToObservations(items, opts) {
    const prefix = String(isObj(opts) && opts.prefix ? opts.prefix : '');
    const seen = new Set();
    const out = [];
    (Array.isArray(items) ? items : []).forEach((it, i) => {
      if (!isObj(it) || typeof it.text !== 'string' || !it.text.trim()) return;
      let id = (prefix + String(it.id || 'geo-' + (i + 1))).replace(OBS_ID, '-').slice(0, 40);
      for (let n = 2; seen.has(id); n++) {
        const suffix = '-' + n;
        id = id.slice(0, 40 - suffix.length) + suffix;
      }
      seen.add(id);
      const basis = typeof it.basis === 'string' && it.basis.trim() ? ` (Základ: ${it.basis.trim()})` : '';
      out.push({ id, label: LABEL_HEURISTIC, minute: null, text: (it.text.trim() + basis).slice(0, 1500) });
    });
    return out;
  }

  // ---------------------------------------------------------------- kontrola kontejneru .fmf (port fmf_research/fmf_inspect_v2.py)
  // Pozorovaná hlavička pochází z JEDNOHO vzorku exportu, není to specifikace formátu. Nic se nehádá a nic se
  // nedekóduje: vrací se jen název (odhad) a jména zdrojů z manifestu. Rozbalení zstd dodává volající.
  const FMF = deepFreeze({
    OBSERVED_PREFIX: [0x02, 0x01, 0x61, 0x66, 0x65, 0x2e],
    ZSTD_MAGIC: [0x28, 0xb5, 0x2f, 0xfd],
    MAX_INPUT_BYTES: 5 * 1024 * 1024,
    MAX_MANIFEST_BYTES: 1024 * 1024,
    MAX_CANDIDATES: 16, // hodně falešných magic hlaviček nesmí způsobit neomezenou práci
    MAX_TOKEN_LENGTH: 96,
    MAX_TOKENS_RETURNED: 200,
    RESOURCE_EXTENSIONS: ['.tac', '.img', '.aom'],
  });
  const FMF_UNKNOWN = [
    'formace',
    'hráčské pozice',
    'role a povinnosti',
    'týmové instrukce',
    'individuální instrukce',
    'mentalita',
    'intenzita, komplexita a efektivita',
  ];

  function toBytes(input) {
    if (input === null || input === undefined) return null;
    // Bez instanceof: hodnota může přijít z jiného kontextu (jiný realm), kde by Uint8Array nesedělo.
    const tagName = Object.prototype.toString.call(input);
    if (tagName === '[object Uint8Array]') return input;
    if (tagName === '[object ArrayBuffer]') return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input) && input.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return Uint8Array.from(input);
    return null;
  }
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
  const startsWith = (bytes, prefix) => bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

  function findAll(bytes, magic) {
    const found = [];
    const first = magic[0];
    for (let i = 0; i + magic.length <= bytes.length; i++) {
      if (bytes[i] !== first) continue;
      let ok = true;
      for (let j = 1; j < magic.length; j++) {
        if (bytes[i + j] !== magic[j]) {
          ok = false;
          break;
        }
      }
      if (ok) found.push(i);
    }
    return found;
  }

  /** Ohraničená ASCII pole, jejichž předchozí 4bajtová little-endian délka sedí (jako v Pythonu). */
  function lengthPrefixedTokens(bytes) {
    const tokens = [];
    for (let off = 0; off + 5 <= bytes.length; off++) {
      const len = (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
      if (len < 1 || len > FMF.MAX_TOKEN_LENGTH || off + 4 + len > bytes.length) continue;
      let text = '';
      let ok = true;
      for (let k = 0; k < len; k++) {
        const b = bytes[off + 4 + k];
        if (b < 0x20 || b > 0x7e) {
          ok = false;
          break;
        }
        text += String.fromCharCode(b);
      }
      if (ok) tokens.push(text);
    }
    return tokens;
  }

  /** Zkontroluje soubor .fmf bez dekódování nastavení taktiky. opts.decompress(bytes, maxBytes) → Uint8Array|null
      rozbalí první zstd rámec od začátku `bytes` (nejvýš maxBytes; null = nejde; chyba s kódem 'limit' = rámec je větší než maxBytes);
      dodává ho volající (fmfglue.js nad zstd.js), modul sám nic nerozbaluje. Cizí nebo nečitelný soubor: ok:false s českým důvodem, bez výjimky. */
  function inspectFmf(input, opts) {
    const decompress = isObj(opts) && typeof opts.decompress === 'function' ? opts.decompress : null;
    const result = {
      ok: false,
      size: 0,
      header: { hex: '', matchesObserved: false },
      candidates: { found: 0, tried: 0, limit: FMF.MAX_CANDIDATES },
      frames: [],
      manifest: null,
      tacticFields: { status: 'not_decoded' },
      verified: [],
      unknown: FMF_UNKNOWN.slice(),
      warnings: [],
      errors: [],
      reason: '',
    };
    const fail = (msg) => {
      result.errors.push(msg);
      result.reason = msg;
      return result;
    };

    const bytes = toBytes(input);
    if (!bytes) return fail('Vstup není binární soubor.');
    result.size = bytes.length;
    if (!bytes.length) return fail('Soubor je prázdný.');
    result.header = { hex: hex(bytes.subarray(0, FMF.OBSERVED_PREFIX.length)), matchesObserved: startsWith(bytes, FMF.OBSERVED_PREFIX) };
    if (bytes.length > FMF.MAX_INPUT_BYTES) return fail('Soubor překračuje limit 5 MiB.');
    if (!result.header.matchesObserved) {
      // Pozorovaná hlavička je z jednoho vzorku: jiná hlavička nemusí znamenat cizí soubor, jen že ho tahle kontrola neumí číst.
      result.warnings.push('Pozorovaná hlavička pochází z jednoho vzorku exportu, ne ze specifikace; jiná hlavička tedy nemusí znamenat, že soubor není export FM27, jen že ho tato kontrola neumí číst.');
      return fail('Hlavička neodpovídá pozorovanému prefixu FM27 exportu; soubor nebyl interpretován.');
    }

    const offsets = findAll(bytes, FMF.ZSTD_MAGIC);
    result.candidates.found = offsets.length;
    if (!offsets.length) return fail('V souboru nebyl nalezen Zstandard manifest známý z dodaného exportu.');
    if (!decompress) return fail('Chybí funkce pro rozbalení Zstandard rámců (decompress); modul sám nic nerozbaluje, a tak manifest nelze zkontrolovat.');

    // Od posledního rámce k prvnímu (tak vypadal jediný pozorovaný vzorek); přijme se první, jehož obsah vypadá jako manifest.
    const ordered = offsets.slice().reverse().slice(0, FMF.MAX_CANDIDATES);
    let accepted = null;
    let oversize = false;
    for (const offset of ordered) {
      const frame = { offset, ok: false, size: null, manifestLike: false };
      result.frames.push(frame);
      result.candidates.tried++;
      let out = null;
      try {
        out = decompress(bytes.subarray(offset), FMF.MAX_MANIFEST_BYTES + 1);
      } catch (e) {
        out = null;
        if (e && e.code === 'limit') {
          // rozbalovač řekl, že rámec má víc výstupu, než povoluje strop: je to „příliš velký“, ne „nejde rozbalit“
          frame.reason = 'překročil limit 1 MiB';
          oversize = true;
          continue;
        }
      }
      const content = toBytes(out);
      if (!content) {
        frame.reason = 'nejde rozbalit';
        continue;
      }
      frame.size = content.length;
      if (content.length > FMF.MAX_MANIFEST_BYTES) {
        frame.reason = 'překročil limit 1 MiB';
        oversize = true;
        continue;
      }
      frame.ok = true;
      const tokens = lengthPrefixedTokens(content);
      if (!tokens.some((t) => FMF.RESOURCE_EXTENSIONS.includes(t))) {
        frame.reason = 'nevypadá jako manifest (chybí .tac, .img ani .aom)';
        continue;
      }
      frame.manifestLike = true;
      accepted = { offset, size: content.length, tokens };
      break;
    }

    if (!accepted) {
      return fail(
        oversize
          ? 'Manifest překročil limit 1 MiB.'
          : 'Žádný nalezený Zstandard rámec nevypadá jako manifest známý z dodaného exportu (chybí tokeny .tac/.img/.aom). Soubor nebyl interpretován.'
      );
    }

    const tokens = accepted.tokens;
    const resources = [];
    tokens.forEach((t, i) => {
      if (FMF.RESOURCE_EXTENSIONS.includes(t) && i) resources.push(tokens[i - 1] + t);
    });
    const tacIndex = tokens.findIndex((t, i) => t === '.tac' && i > 0);
    const guess = tacIndex > 0 ? tokens[tacIndex - 1] : null;
    result.ok = true;
    result.manifest = {
      offset: accepted.offset,
      size: accepted.size,
      tokenCount: tokens.length,
      tokens: tokens.slice(0, FMF.MAX_TOKENS_RETURNED),
      resources,
      tacticNameGuess: guess,
      tacticNameBasis: guess ? 'token před prvním „.tac“' : null,
      tacticNameConfidence: guess ? 'low' : null,
    };
    result.warnings.push(
      `Hlavička „${result.header.hex}“ je pozorování z jednoho vzorku exportu, ne specifikace formátu FMF; shoda hlavičky nedokazuje, že jde o platný export FM27.`
    );
    if (guess) result.warnings.push('Název taktiky je jen odhad: token před prvním „.tac“ v manifestu (heuristika z jednoho vzorku, nízká důvěra).');
    result.warnings.push('Pole taktiky (formace, pozice, role, instrukce, mentalita) nebyla dekódována a nic z nich není ověřeno; doplň je ručně nebo ze snímku obrazovky.');
    if (accepted.offset !== offsets[offsets.length - 1]) result.warnings.push(`Manifest nebyl v posledním nalezeném rámci; přijat starší kandidát na offsetu ${accepted.offset}.`);
    const failedFrames = result.frames.filter((f) => !f.manifestLike).length;
    if (failedFrames) {
      result.warnings.push(`Z ${result.candidates.tried} zkoušených rámců byl manifestem jen jeden; ostatní (${failedFrames}) se nepodařilo rozbalit nebo nevypadaly jako manifest.`);
    }
    if (offsets.length > FMF.MAX_CANDIDATES) result.warnings.push(`V souboru je ${offsets.length} kandidátů na rámec; zkoušeno jen posledních ${FMF.MAX_CANDIDATES}.`);
    return result;
  }

  // ---------------------------------------------------------------- taktika přečtená z obrazovky hry
  // Model přepíše, co je na obrazovce taktiky vidět (formace, mentalita, instrukce, role). Je to jen NÁVRH: nic se nevytvoří,
  // dokud ho uživatel nepotvrdí podle snímku. Názvy rolí a instrukcí se přebírají přesně tak, jak je hra píše (aplikace jejich
  // oficiální názvy nezná a nic nepřekládá ani nedoplňuje). Neznámá formace se nikdy tiše nenahradí jinou.
  const TAC_TEXT = 90;
  const TAC_MAX_INSTRUCTIONS = 24;
  const TAC_MAX_ROLES = 14;
  // řídicí znaky, oddělovače řádků, všechny formátovací znaky Unicode, všechny znaky ignorované při zobrazení (Default_Ignorable_Code_Point), prázdné braillské písmeno a náhradní znak objektu; zapsáno přes RegExp, aby ve zdrojích nebyly doslovné znaky
  const HIDDEN_CHARS = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\ufffc]+', 'gu');
  const oneLineText = (v, n) => (typeof v === 'string' ? v.replace(HIDDEN_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

  /** normalizeTacticExtraction(raw) → {ok, read: {name, formation (id šablony|null), formationRaw, mentality, instructions: [text], roles: [{pos, role, duty, player}], notes}, issues}.
      Cokoli podezřelého se zahodí a řekne se to v `issues`. `ok` je true, jen když je přečtené aspoň něco. */
  function normalizeTacticExtraction(raw) {
    const issues = [];
    const read = { name: '', formation: null, formationRaw: '', mentality: '', instructions: [], roles: [], notes: '' };
    if (!isObj(raw)) return { ok: false, read, issues: ['Odpověď nemá očekávaný tvar.'] };
    read.name = oneLineText(raw.name, 60);
    const fr = typeof raw.formation === 'string' || isNum(raw.formation) ? oneLineText(String(raw.formation), 30) : '';
    read.formationRaw = fr;
    if (fr) {
      read.formation = normalizeFormationId(fr);
      if (!read.formation) issues.push(`Formace „${fr}“ není mezi šablonami aplikace (nebo ji nejde jednoznačně přečíst), vyber ji ručně.`);
    }
    read.mentality = oneLineText(raw.mentality, TAC_TEXT);
    const seen = new Set();
    let dropped = 0;
    for (const item of Array.isArray(raw.instructions) ? raw.instructions : []) {
      let text = '';
      if (typeof item === 'string') text = oneLineText(item, 120);
      else if (isObj(item)) {
        const g = oneLineText(item.group, 40);
        const t = oneLineText(item.text, 100);
        text = t ? (g ? `${g}: ${t}` : t) : '';
      }
      const key = text.toLowerCase();
      if (!text) {
        dropped++;
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      if (read.instructions.length < TAC_MAX_INSTRUCTIONS) read.instructions.push(text);
      else dropped++;
    }
    if (dropped) issues.push(`Instrukcí vynechaných jako prázdné nebo nad limit ${TAC_MAX_INSTRUCTIONS}: ${dropped}.`);
    for (const r of (Array.isArray(raw.roles) ? raw.roles : []).slice(0, TAC_MAX_ROLES)) {
      if (!isObj(r)) continue;
      const role = oneLineText(r.role, 60);
      const duty = oneLineText(r.duty, 40);
      const player = oneLineText(r.player, 60);
      const posRaw = oneLineText(r.position, 8).toUpperCase();
      const pos = /^[A-Z]{1,4}$/.test(posRaw) ? posRaw : '';
      if (!role && !duty) continue;
      read.roles.push({ pos, role, duty, player });
    }
    read.notes = oneLineText(raw.notes, 200);
    const ok = !!(read.formation || read.mentality || read.instructions.length || read.roles.length);
    if (!ok) issues.push('Na obrázku jsem nenašel nic čitelného z taktiky.');
    return { ok, read, issues };
  }

  /** tacticFromExtraction(read, opts) → {tactic|null, unplaced: [text], issues}. Role se přiřadí jen k pozici, kterou má
      v rozestavení přesně jeden hráč a na obrázku je k ní přesně jedna role; ostatní skončí v poznámce (nehádá se pořadí
      hráčů se stejnou pozicí). Bez rozpoznané formace se taktika nevytvoří. opts: {name, careerId, kind, fileName, now}. */
  function tacticFromExtraction(read, opts) {
    const o = isObj(opts) ? opts : {};
    const issues = [];
    if (!isObj(read) || !read.formation) return { tactic: null, unplaced: [], issues: ['Bez formace taktiku vytvořit nejde: vyber ji ručně.'] };
    const name = oneLineText(o.name, 60) || read.name || `Taktika ${read.formation}`;
    const t = makeTactic({ formation: read.formation, name, kind: o.kind, careerId: o.careerId });
    if (!t) return { tactic: null, unplaced: [], issues: [`Formace „${read.formation}“ není mezi šablonami.`] };
    t.mentality = read.mentality || '';
    t.teamInstructions = Array.isArray(read.instructions) ? read.instructions.slice(0, TAC_MAX_INSTRUCTIONS) : [];
    const unplaced = [];
    for (const r of Array.isArray(read.roles) ? read.roles : []) {
      const label = `${r.pos ? r.pos + ': ' : ''}${r.role || '?'}${r.duty ? ' (' + r.duty + ')' : ''}${r.player ? ' – ' + r.player : ''}`;
      const slots = r.pos ? t.slots.filter((s) => s.pos === r.pos) : [];
      const same = r.pos ? read.roles.filter((x) => x.pos === r.pos) : [];
      if (slots.length === 1 && same.length === 1) {
        slots[0].role = r.role || '';
        slots[0].duty = r.duty || '';
      } else unplaced.push(label);
    }
    const notes = [];
    if (unplaced.length) notes.push(`Role z obrazovky, které se nepodařilo bezpečně přiřadit k pozici: ${unplaced.join('; ')}.`);
    if (read.notes) notes.push(read.notes);
    t.notes = notes.join(' ').slice(0, 400);
    const fields = {
      formation: 'screenshot_verified',
      mentality: read.mentality ? 'screenshot_verified' : 'unknown',
      instructions: read.instructions && read.instructions.length ? 'screenshot_verified' : 'unknown',
      roles: read.roles && read.roles.length ? 'screenshot_verified' : 'unknown',
    };
    t.source = { type: 'screenshot', fileName: oneLineText(o.fileName, 80) || null, importedAt: isNum(o.now) ? o.now : null, fields };
    return { tactic: t, unplaced, issues };
  }

  return {
    PLAN_FORMAT, PLAN_VERSION, PHASES, CHANNELS, THIRDS, FMF,
    FORMATIONS, DEFAULT_THRESHOLDS,
    normalizeFormationId, formationById, makeTactic, lineOf, channelOf, thirdOf,
    importPlanJson, exportPlanJson, normalizeTacticExtraction, tacticFromExtraction,
    analyzeShape, shapeFacts, findConflicts, compareTactics, opponentOverloads, factsToObservations,
    inspectFmf,
  };
});
