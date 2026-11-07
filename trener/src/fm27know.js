/* Znalostní základ FM27 pro rozbor taktiky a přípravu na zápas: slovník (mentality, styly, týmové instrukce, role s míčem a bez míče)
   a vlastnosti rolí, které potřebují pravidla. Čistá data a malé pomocné funkce bez DOM (test/fm27know.test.mjs).

   ODKUD JSOU DATA (průzkum 6. 11. 2026, docs/ANALYZA_SESTAVY_A_PRIPRAVY.md): názvy a hodnoty jsou ze dvou nezávislých veřejných zdrojů
   (data nástroje FM Scout Tactic Creator, který je uvádí jako data z FM27, a 24 jeho veřejných rozborů taktik FM27; názvy rolí a instrukcí
   dále potvrzuje Guide to Football pro FM26, jehož slovník je s FM27 shodný). Žádný údaj z nich není čtený z paměti hry. Oficiální manuál
   Sports Interactive nebyl dostupný (403), takže názvy jsou opis třetí strany a ve hře se ověřují: co aplikace nepozná, řekne jako
   „nerozpoznáno“, nehádá. Vlastnosti rolí (kdo drží šířku, kdo je tvůrce, kdo je Outlet) jsou z popisů rolí v Guide to Football FM26
   (Role Explorer) a z komunitních průvodců; práce „držák / běžec / tvůrce“ je klasifikace autora podle těch popisů (ODHAD).
   FM26 a FM27 mají dvě sady rolí (s míčem a bez míče) a žádné povinnosti (Defend / Support / Attack).

   OVĚŘENÍ VE HŘE (7. 11. 2026, česká hra majitele, docs/FM27_PRUZKUM_VE_HRE.md): obrazovka Týmové instrukce ukazuje s míčem 18 různých názvů a bez míče 9.
   Všech 9 instrukcí bez míče a 17 z 18 instrukcí s míčem sedí na slovník níž; „Doprovodné akce“ (hodnoty Vyvážené / Obě strany) je jedno nastavení, které
   veřejné zdroje dělí na Overlap a Underlap, proto je tu jako samostatné id `supportActions` (gameOnly). Role a styly: u středních obránců, defenzivních
   záložníků a útočníka viděl průzkum celé české seznamy a sedí na role níž (6 + 6, 5 + 5, 6 + 4); styl hry má ve hře 11 voleb, o jedenáctou
   („Čistý štít“ = Clean Sheet) je slovník rozšířen, doporučenou mentalitu k ní hra nikde neukázala. České názvy a převod jsou v fm27cs.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fm27cs.js'));
  else root.TrenerFm27Know = factory(root.TrenerFm27Cs);
})(typeof self !== 'undefined' ? self : this, function (CS) {
  'use strict';

  const VERSION = 'FM27-2026-11-06';

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  /** Srovnání bez rozdílu velikosti písmen, diakritiky, mezer, pomlček a interpunkce: „Box-To-Box“ = „box to box“ = „BoxToBox“. */
  function norm(s) {
    return String(s === null || s === undefined ? '' : s)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  // ---------------------------------------------------------------- mentality a styly
  const MENTALITIES = deepFreeze(['Very Defensive', 'Defensive', 'Cautious', 'Balanced', 'Positive', 'Attacking', 'Very Attacking']);

  /** Styly hry a mentalita, kterou k nim hra doporučuje (data nástroje FM Scout Tactic Creator). */
  const STYLES = deepFreeze([
    { name: 'Control Possession', mentality: 'Positive' },
    { name: 'Gegenpress', mentality: 'Balanced' },
    { name: 'Tiki-Taka', mentality: 'Positive' },
    { name: 'Vertical Tiki-Taka', mentality: 'Balanced' },
    { name: 'Wing Play', mentality: 'Balanced' },
    { name: 'Route One', mentality: 'Balanced' },
    { name: 'Fluid Counter-Attack', mentality: 'Cautious' },
    { name: 'Direct Counter-Attack', mentality: 'Cautious' },
    { name: 'Catenaccio', mentality: 'Defensive' },
    { name: 'Park the Bus', mentality: 'Defensive' },
    { name: 'Clean Sheet', mentality: null }, // 11. styl ze hry (7. 11. 2026); doporučenou mentalitu hra neukázala
  ]);

  // ---------------------------------------------------------------- týmové instrukce (28): id, název, fáze, hodnoty od nejpasivnější po nejaktivnější, výchozí
  const TEAM_RAW = [
    // s míčem (19 z veřejných zdrojů + 1 jen z české hry)
    ['passingDirectness', 'Passing Directness', 'in', ['Much Shorter', 'Shorter', 'Standard', 'More Direct', 'Much More Direct'], 'Standard'],
    ['tempo', 'Tempo', 'in', ['Much Lower', 'Lower', 'Standard', 'Higher', 'Much Higher'], 'Standard'],
    ['attackingWidth', 'Attacking Width', 'in', ['Much Narrower', 'Narrower', 'Standard', 'Wider', 'Much Wider'], 'Standard'],
    ['attackingTransition', 'Attacking Transition', 'in', ['Hold Shape', 'Standard', 'Counter-Attack'], 'Standard'],
    ['creativeFreedom', 'Creative Freedom', 'in', ['More Disciplined', 'Balanced', 'More Expressive'], 'Balanced'],
    ['timeWasting', 'Time Wasting', 'in', ['Less Often', 'Standard', 'More Often'], 'Less Often'],
    ['playForSetPieces', 'Play for Set Pieces', 'in', ['Keep Ball in Play', 'Play For Set Pieces'], 'Keep Ball in Play'],
    ['buildUpStrategy', 'Build-Up Strategy', 'in', ['Play Through Press', 'Balanced', 'Bypass Press'], 'Balanced'],
    ['goalKicks', 'Goal Kicks', 'in', ['Short', 'Mixed', 'Long'], 'Mixed'],
    ['gkDistributionSpeed', 'GK Distribution (Speed)', 'in', ['Slow Pace Down', 'Balanced', 'Distribute Quickly'], 'Balanced'],
    ['gkDistribution', 'GK Distribution', 'in', ['Over Opposition Defence', 'Target Forward', 'Playmaker', 'Centre-Backs', 'Balanced', 'Flanks', 'Full-Backs'], 'Balanced'],
    ['dribbling', 'Dribbling', 'in', ['Discourage', 'Balanced', 'Encourage'], 'Balanced'],
    ['passReception', 'Pass Reception', 'in', ['Pass to Feet', 'Balanced', 'Pass Into Space'], 'Balanced'],
    ['patience', 'Patience', 'in', ['Hit Early Crosses', 'Standard', 'Work Ball Into Box'], 'Standard'],
    ['shotsFromDistance', 'Shots from Distance', 'in', ['Discourage', 'Balanced', 'Encourage'], 'Balanced'],
    ['crossingStyle', 'Crossing Style', 'in', ['Balanced', 'Floated Crosses', 'Whipped Crosses', 'Low Crosses'], 'Balanced'],
    ['overlap', 'Overlap', 'in', ['Balanced', 'Left', 'Right', 'Both Flanks'], 'Balanced'],
    ['underlap', 'Underlap', 'in', ['Balanced', 'Left', 'Right', 'Both Flanks'], 'Balanced'],
    ['progressThrough', 'Progress Through', 'in', ['Balanced', 'Left', 'Middle', 'Right', 'Both Flanks'], 'Balanced'],
    // jen z české hry: „Doprovodné akce“ (anglický název NEZJIŠTĚN); hodnoty Vyvážené a Obě strany viděny, Levá a Pravá odvozeny
    ['supportActions', 'Doprovodné akce', 'in', ['Balanced', 'Left', 'Right', 'Both Flanks'], 'Balanced', true],
    // bez míče (9)
    ['lineOfEngagement', 'Line of Engagement', 'out', ['Low Block', 'Mid Block', 'High Press'], 'Mid Block'],
    ['defensiveLine', 'Defensive Line', 'out', ['Much Lower', 'Lower', 'Standard', 'Higher', 'Much Higher'], 'Standard'],
    ['defensiveLineBehaviour', 'Defensive Line Behaviour', 'out', ['Step Up More', 'Balanced', 'Drop Off More'], 'Balanced'],
    ['triggerPress', 'Trigger Press', 'out', ['Much Less Often', 'Less Often', 'Standard', 'More Often', 'Much More Often'], 'Standard'],
    ['defensiveTransition', 'Defensive Transition', 'out', ['Regroup', 'Standard', 'Counter-Press'], 'Standard'],
    ['tackling', 'Tackling', 'out', ['Stay On Feet', 'Standard', 'Get Stuck In'], 'Standard'],
    ['crossEngagement', 'Cross Engagement', 'out', ['Stop Crosses', 'Balanced', 'Invite Crosses'], 'Balanced'],
    ['pressingTrap', 'Pressing Trap', 'out', ['Trap Inside', 'Balanced', 'Trap Outside'], 'Balanced'],
    ['shortGkDistribution', 'Short Goalkeeper Distribution', 'out', ['No', 'Yes'], 'No'],
  ];
  const TEAM_INSTRUCTIONS = deepFreeze(TEAM_RAW.map(([id, name, phase, values, def, gameOnly]) => ({ id, name, phase, values, default: def, gameOnly: gameOnly === true })));
  const TEAM_BY_ID = new Map(TEAM_INSTRUCTIONS.map((t) => [t.id, t]));
  /** Instrukce, které obrazovka FM27 nenabízí jako samostatné nastavení (jen veřejné zdroje je dělí; ve hře je jedno „Doprovodné akce“).
      Pravidla je dál umějí vyhodnotit, ale v pokrytí „kolik z kolika instrukcí je načteno“ se nepočítají. */
  const THIRD_PARTY_ONLY = deepFreeze(['overlap', 'underlap']);
  /** Počet nastavení, která má taktika ve hře FM27 (18 s míčem + 9 bez míče, ověřeno 7. 11. 2026). */
  const GAME_INSTRUCTION_COUNT = TEAM_INSTRUCTIONS.filter((t) => !THIRD_PARTY_ONLY.includes(t.id)).length;

  // ---------------------------------------------------------------- role po pozicích a fázích
  const ROLES_IN = deepFreeze({
    GK: ['Goalkeeper', 'Ball-Playing Goalkeeper', 'No-Nonsense Goalkeeper'],
    'D (C)': ['Centre-Back', 'Ball-Playing Centre-Back', 'No-Nonsense Centre-Back', 'Wide Centre-Back', 'Overlapping Centre-Back', 'Advanced Centre-Back'],
    'D (L/R)': ['Full-Back', 'Inside Full-Back', 'Wing-Back', 'Inside Wing-Back', 'Playmaking Wing-Back'],
    'WB (L/R)': ['Wing-Back', 'Advanced Wing-Back', 'Inside Wing-Back', 'Playmaking Wing-Back'],
    DM: ['Defensive Midfielder', 'Half Back', 'Deep-Lying Playmaker', 'Box-To-Box Midfielder', 'Box-To-Box Playmaker'],
    'M (C)': ['Central Midfielder', 'Attacking Midfielder', 'Advanced Playmaker', 'Midfield Playmaker', 'Channel Midfielder', 'Wide Central Midfielder'],
    'M (L/R)': ['Wide Midfielder', 'Winger', 'Inside Winger', 'Playmaking Winger'],
    'AM (C)': ['Attacking Midfielder', 'Advanced Playmaker', 'Channel Midfielder', 'Free Role', 'Second Striker'],
    'AM (L/R)': ['Winger', 'Inside Winger', 'Playmaking Winger', 'Wide Forward', 'Inside Forward'],
    'ST (C)': ['Centre Forward', 'Poacher', 'Target Forward', 'Deep-Lying Forward', 'False Nine', 'Channel Forward'],
  });
  const ROLES_OUT = deepFreeze({
    GK: ['Goalkeeper', 'Sweeper Keeper', 'Line-Holding Keeper'],
    'D (C)': ['Centre-Back', 'Covering Centre-Back', 'Stopping Centre-Back', 'Wide Centre-Back', 'Covering Wide Centre-Back', 'Stopping Wide Centre-Back'],
    'D (L/R)': ['Full-Back', 'Holding Full-Back', 'Pressing Full-Back'],
    'WB (L/R)': ['Wing-Back', 'Holding Wing-Back', 'Pressing Wing-Back'],
    DM: ['Defensive Midfielder', 'Screening Defensive Midfielder', 'Pressing Defensive Midfielder', 'Dropping Defensive Midfielder', 'Wide Covering Defensive Midfielder'],
    'M (C)': ['Central Midfielder', 'Screening Central Midfielder', 'Pressing Central Midfielder', 'Wide Covering Central Midfielder'],
    'M (L/R)': ['Wide Midfielder', 'Tracking Wide Midfielder', 'Wide Outlet Wide Midfielder'],
    'AM (C)': ['Attacking Midfielder', 'Tracking Attacking Midfielder', 'Central Outlet Attacking Midfielder', 'Splitting Outlet Attacking Midfielder'],
    'AM (L/R)': ['Winger', 'Tracking Winger', 'Wide Outlet Winger', 'Inside Outlet Winger'],
    'ST (C)': ['Centre Forward', 'Tracking Centre Forward', 'Central Outlet Centre Forward', 'Splitting Outlet Centre Forward'],
  });

  /** Skupina rolí podle kódu pozice v šabloně formace této aplikace (RCB → „D (C)“). Neznámý kód → null (nehádá se). */
  const GROUP_BY_POS = deepFreeze({
    GK: 'GK',
    CB: 'D (C)', RCB: 'D (C)', LCB: 'D (C)',
    RB: 'D (L/R)', LB: 'D (L/R)',
    RWB: 'WB (L/R)', LWB: 'WB (L/R)',
    DM: 'DM', RDM: 'DM', LDM: 'DM',
    CM: 'M (C)', RCM: 'M (C)', LCM: 'M (C)',
    RM: 'M (L/R)', LM: 'M (L/R)',
    AM: 'AM (C)',
    RAM: 'AM (L/R)', LAM: 'AM (L/R)', RW: 'AM (L/R)', LW: 'AM (L/R)',
    ST: 'ST (C)', RST: 'ST (C)', LST: 'ST (C)',
  });
  const SIDE_BY_POS = deepFreeze({ RB: 'R', LB: 'L', RCB: 'R', LCB: 'L', RWB: 'R', LWB: 'L', RDM: 'R', LDM: 'L', RCM: 'R', LCM: 'L', RM: 'R', LM: 'L', RAM: 'R', LAM: 'L', RW: 'R', LW: 'L', RST: 'R', LST: 'L' });

  function groupOfPos(pos) {
    const k = String(pos === null || pos === undefined ? '' : pos).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(GROUP_BY_POS, k) ? GROUP_BY_POS[k] : null;
  }
  function sideOfPos(pos) {
    const k = String(pos === null || pos === undefined ? '' : pos).trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(SIDE_BY_POS, k)) return SIDE_BY_POS[k];
    return groupOfPos(k) ? 'C' : null;
  }

  // rejstřík všech rolí: normalizovaný název → {name, phase, groups}
  function buildRoleIndex() {
    const idx = { in: new Map(), out: new Map() };
    for (const [phase, table] of [['in', ROLES_IN], ['out', ROLES_OUT]]) {
      for (const [group, names] of Object.entries(table)) {
        for (const name of names) {
          const k = norm(name);
          const e = idx[phase].get(k) || { name, phase, groups: [] };
          if (!e.groups.includes(group)) e.groups.push(group);
          idx[phase].set(k, e);
        }
      }
    }
    return idx;
  }
  const ROLE_INDEX = buildRoleIndex();

  /** findRole(text, phase) → {name, phase, groups} | null. Bez rozdílu v pomlčkách a velikosti písmen; nepozná-li, vrací null. */
  function findRole(text, phase) {
    const k = norm(text);
    if (!k) return null;
    const ph = phase === 'out' ? 'out' : 'in';
    const e = ROLE_INDEX[ph].get(k);
    if (e) return e;
    if (!CS) return null;
    // česky („Rozehrávající stoper“) a ověřená zkratka z tabulky Tvar týmu („BCB“); co se nepozná, vrací null (nehádá se)
    const en = CS.canonRole(text, ph);
    const viaName = en && en !== String(text).trim() ? ROLE_INDEX[ph].get(norm(en)) : null;
    if (viaName) return viaName;
    const chip = CS.roleFromChip(text, ph);
    return chip ? ROLE_INDEX[ph].get(norm(chip)) || null : null;
  }

  // ---------------------------------------------------------------- vlastnosti rolí pro pravidla
    const TRAITS = deepFreeze({
    // s míčem (klasifikace podle popisů rolí v Guide to Football FM26 a komunitních průvodců; „práce“ je ODHAD autora)
    staysWide: ['Full-Back', 'Wing-Back', 'Advanced Wing-Back', 'Wide Midfielder', 'Winger', 'Wide Forward', 'Wide Centre-Back', 'Overlapping Centre-Back'],
    runsWide: ['Wide Forward', 'Wing-Back', 'Advanced Wing-Back', 'Overlapping Centre-Back'],
    movesInside: ['Inside Winger', 'Inside Forward', 'Playmaking Winger', 'Inside Full-Back', 'Inside Wing-Back', 'Playmaking Wing-Back'],
    expressive: ['Deep-Lying Playmaker', 'Midfield Playmaker', 'Advanced Playmaker', 'Box-To-Box Playmaker', 'Playmaking Wing-Back', 'Playmaking Winger', 'Free Role', 'Ball-Playing Centre-Back', 'Ball-Playing Goalkeeper'],
    holder: ['Defensive Midfielder', 'Half Back'],
    runner: ['Box-To-Box Midfielder', 'Channel Midfielder', 'Wide Central Midfielder', 'Second Striker'],
    creator: ['Deep-Lying Playmaker', 'Midfield Playmaker', 'Advanced Playmaker', 'Box-To-Box Playmaker'],
    linkForward: ['Deep-Lying Forward', 'False Nine'],
    runnerForward: ['Channel Forward', 'Poacher', 'Centre Forward'],
    linkBehindStriker: ['Attacking Midfielder', 'Advanced Playmaker', 'Second Striker', 'Channel Midfielder'],
    innerWinger: ['Inside Winger', 'Inside Forward', 'Playmaking Winger'],
    wideBack: ['Full-Back', 'Wing-Back', 'Advanced Wing-Back'],
    attackingBack: ['Wing-Back', 'Advanced Wing-Back'],
    insideBack: ['Inside Full-Back', 'Inside Wing-Back', 'Playmaking Wing-Back'],
    careful: ['No-Nonsense Goalkeeper', 'No-Nonsense Centre-Back', 'Defensive Midfielder', 'Half Back'],
    ballPlayingBack: ['Ball-Playing Centre-Back', 'Ball-Playing Goalkeeper'],
    noNonsense: ['No-Nonsense Centre-Back', 'No-Nonsense Goalkeeper'],
    // bez míče
    outlet: ['Wide Outlet Wide Midfielder', 'Wide Outlet Winger', 'Inside Outlet Winger', 'Central Outlet Attacking Midfielder', 'Splitting Outlet Attacking Midfielder', 'Central Outlet Centre Forward', 'Splitting Outlet Centre Forward'],
    screening: ['Screening Defensive Midfielder', 'Screening Central Midfielder', 'Dropping Defensive Midfielder'],
    pressing: ['Pressing Full-Back', 'Pressing Wing-Back', 'Pressing Defensive Midfielder', 'Pressing Central Midfielder', 'Stopping Centre-Back', 'Stopping Wide Centre-Back'],
    holding: ['Holding Full-Back', 'Holding Wing-Back', 'Screening Defensive Midfielder', 'Screening Central Midfielder', 'Covering Centre-Back', 'Covering Wide Centre-Back'],
    stopper: ['Stopping Centre-Back', 'Stopping Wide Centre-Back'],
    coverer: ['Covering Centre-Back', 'Covering Wide Centre-Back'],
  });
  const TRAIT_SETS = {};
  for (const [k, list] of Object.entries(TRAITS)) TRAIT_SETS[k] = new Set(list.map(norm));

  /** hasTrait(roleName, trait) → bool. Bez rozdílu v zápisu názvu. */
  function hasTrait(role, trait) {
    const set = TRAIT_SETS[trait];
    return !!set && set.has(norm(role));
  }

  // ---------------------------------------------------------------- rozpoznání instrukce z textu
  // Pomocný index: pro každou instrukci všechny dvojice (název, hodnota), seřazené tak, aby delší název a delší hodnota vyhrály.
  const NAME_KEYS = TEAM_INSTRUCTIONS.map((t) => ({ t, key: norm(t.name) })).sort((a, b) => b.key.length - a.key.length);

  /** findValue(instr, text) → hodnota z instr.values, která v textu je (delší vyhrává: „Much Higher“ před „Higher“), nebo null. */
  function findValue(instr, text) {
    const k = norm(text);
    let best = null;
    for (const v of instr.values) {
      const vk = norm(v);
      if (vk && k.includes(vk) && (!best || vk.length > norm(best).length)) best = v;
    }
    return best;
  }

  // Hodnota, která je v celém slovníku jen u jedné instrukce („Counter-Press“, „Get Stuck In“, „Bypass Press“), se pozná i bez názvu instrukce,
  // ale jen když je celý text přesně ta hodnota (obrázek často ukáže jen „Out of Possession: Counter-Press“). Krátké a obecné hodnoty
  // („Short“, „Standard“, „Encourage“) se tak nepoznají nikdy.
  const UNIQUE_VALUE = (() => {
    const seen = new Map();
    for (const t of TEAM_INSTRUCTIONS) {
      for (const v of t.values) {
        const k = norm(v);
        const e = seen.get(k);
        if (e) e.count++;
        else seen.set(k, { t, value: v, count: 1 });
      }
    }
    const out = new Map();
    for (const [k, e] of seen) if (e.count === 1 && k.length >= 7) out.set(k, e);
    return out;
  })();

  /** parseInstruction(text) → {id, name, value, phase} | null.
      Čte tvary „Defensive Line: Higher“, „Higher Defensive Line“, „Defensive Line – Higher“, „S míčem: Passing Directness Shorter“.
      Hodnota bez názvu instrukce (jen „Higher“) se nepozná, protože není jasné, které instrukce patří. Nepozná-li, vrací null. */
  function parseInstruction(text) {
    const raw = String(text === null || text === undefined ? '' : text);
    if (CS) {
      const cz = CS.parseInstruction(raw);
      const t = cz && TEAM_BY_ID.get(cz.id);
      if (t && t.values.includes(cz.value)) return { id: t.id, name: t.name, value: cz.value, phase: t.phase };
    }
    const colon = raw.indexOf(':');
    const candidates = colon > 0 ? [raw.slice(colon + 1), raw] : [raw];
    for (const cand of candidates) {
      const k = norm(cand);
      if (!k) continue;
      // Nejdelší název první; název, který v textu je, se z něj „spotřebuje“: „Defensive Line“ je i uvnitř „Defensive Line Behaviour“, takže když pro delší název
      // hodnota nesedí („Defensive Line Behaviour: Higher“), kratší název nesmí převzít hodnotu, která patří jiné instrukci.
      let work = k;
      for (const { t, key } of NAME_KEYS) {
        if (!work.includes(key)) continue;
        const rest = work.split(key).join('');
        const probe = { values: t.values };
        const value = findValue(probe, rest) || findValue(probe, k);
        if (value) return { id: t.id, name: t.name, value, phase: t.phase };
        work = rest;
      }
      const only = UNIQUE_VALUE.get(k);
      if (only) {
        // Název před dvojtečkou, který patří jiné instrukci než hodnota („Tackling: Counter-Press“), je rozpor: nehádá se, o kterou z nich jde.
        if (colon > 0 && namesIn(norm(raw.slice(0, colon))).some((id) => id !== only.t.id)) continue;
        return { id: only.t.id, name: only.t.name, value: only.value, phase: only.t.phase };
      }
    }
    return null;
  }

  /** Instrukce, jejichž název v (normalizovaném) textu je; nejdelší název první a nalezený název se z textu odebere. */
  function namesIn(k) {
    const found = [];
    let work = k;
    for (const { t, key } of NAME_KEYS) {
      if (!work.includes(key)) continue;
      found.push(t.id);
      work = work.split(key).join('');
    }
    return found;
  }

  /** parseMentality(text) → název mentality | null. */
  function parseMentality(text) {
    const k = norm(text);
    if (!k) return null;
    const cz = CS ? CS.parseMentality(text) : null;
    if (cz && MENTALITIES.includes(cz)) return cz;
    let best = null;
    for (const m of MENTALITIES) {
      const mk = norm(m);
      if (k.includes(mk) && (!best || mk.length > norm(best).length)) best = m;
    }
    return best;
  }

  /** parseStyle(text) → název stylu hry ze slovníku | null (česky i anglicky: „Čistý štít“ → „Clean Sheet“). */
  function parseStyle(text) {
    const k = norm(text);
    if (!k) return null;
    const cz = CS ? CS.parseStyle(text) : null;
    if (cz && STYLES.some((x) => x.name === cz)) return cz;
    let best = null;
    for (const st of STYLES) {
      const sk = norm(st.name);
      if (k.includes(sk) && (!best || sk.length > norm(best).length)) best = st.name;
    }
    return best;
  }

  /** Index hodnoty instrukce od nejpasivnější (0) po nejaktivnější; null, když instrukce nebo hodnota není známá. */
  function stepOf(id, value) {
    const t = TEAM_BY_ID.get(id);
    if (!t) return null;
    const i = t.values.indexOf(value);
    return i < 0 ? null : i;
  }

  return {
    VERSION, MENTALITIES, STYLES, TEAM_INSTRUCTIONS, TEAM_BY_ID, THIRD_PARTY_ONLY, GAME_INSTRUCTION_COUNT, ROLES_IN, ROLES_OUT, GROUP_BY_POS, TRAITS,
    norm, groupOfPos, sideOfPos, findRole, hasTrait, findValue, parseInstruction, parseMentality, parseStyle, stepOf,
    // české názvy a údaje ze hry (fm27cs.js); bez modulu fm27cs jsou null
    labelCs: CS ? CS.labelCs : () => null,
    valueCs: CS ? CS.valueCs : () => null,
    TE: CS ? CS.TE : null,
    TRAINING: CS ? CS.TRAINING : null,
    TWEAKS: CS ? CS.TWEAKS : null,
    OPPOSITION_COLUMNS: CS ? CS.OPPOSITION_COLUMNS : null,
  };
});
