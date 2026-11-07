/* Slovník české (a míchané česko-anglické) obrazovky FM27: jak hra opravdu píše názvy atributů, pozic, instrukcí, mentalit a stylů.
   Čistá data a malé pomocné funkce bez DOM (test/fm27cs.test.mjs).

   ODKUD JSOU DATA: z běžící hry FM27 majitele (čeština, Steam), kterou 7. 11. 2026 prošla jiná relace Claude přes ovládání počítače
   (docs/FM27_PRUZKUM_VE_HRE.md). Vše, co je tady označené `seen: true`, bylo VIDĚT na obrazovce hry (názvy, ne hodnoty hráčů z cizí hry).
   Co vidět nebylo (`seen: false`), je odvozeno ze vzoru pozorovaných názvů („Mnohem kratší“ → „Kratší“) nebo z anglického slovníku a je to
   tak označené: přepis na kanonický anglický název se u takové hodnoty neprovádí jako fakt, jen jako nápověda. Co aplikace nepozná, zůstane
   nepoznané (nikdy se nehádá). Skryté údaje hry (CA, PA, osobnost, reputace) se tu nevyskytují.

   PROČ TO JE: aplikace počítá s kanonickými anglickými názvy (Tempo: Higher, Heading, DC). Hra uživatele je česky, takže se tu názvy
   z obrazovky převádějí na kanonické; opačným směrem (labelCs, valueCs) se doporučení ukazují tak, jak je uživatel najde ve své hře. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerFm27Cs = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const VERSION = 'fm27cs-1';
  const OBSERVED_ON = '2026-11-07';

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  /** Klíč pro porovnání názvů bez rozdílu velikosti písmen, diakritiky, mezer a interpunkce („Obranné zákroky“ = „obranne zakroky“). */
  const key = (s) => core.fold(str(s)).replace(/[^a-z0-9]/g, '');

  // ---------------------------------------------------------------- atributy hráčů (36 hráčů z pole viděno na profilu hráče)
  // [česky tak, jak to píše hra, kanonický anglický název]. „Fyzička“ je v profilu atribut Natural Fitness (a zároveň nadpis skupiny).
  const ATTR_PAIRS = deepFreeze([
    // technika
    ['Centry', 'Crossing'], ['Hlavičky', 'Heading'], ['Obranné zákroky', 'Tackling'], ['Obsazování', 'Marking'], ['Přihrávky', 'Passing'],
    ['Střely z dálky', 'Long Shots'], ['Technika', 'Technique'], ['Vedení míče', 'Dribbling'], ['Zakončování', 'Finishing'], ['Zpracování', 'First Touch'],
    // standardní situace
    ['Dlouhé hody', 'Long Throws'], ['Penalty', 'Penalty Taking'], ['Rohy', 'Corners'], ['Volné kopy', 'Free Kick Taking'],
    // psychika
    ['Agresivita', 'Aggression'], ['Bez míče', 'Off The Ball'], ['Koncentrace', 'Concentration'], ['Nasazení', 'Work Rate'], ['Nepředvídatelnost', 'Flair'],
    ['Odhodlání', 'Determination'], ['Odvaha', 'Bravery'], ['Poziční hra', 'Positioning'], ['Představivost', 'Vision'], ['Předvídavost', 'Anticipation'],
    ['Rozhodování', 'Decisions'], ['Týmová hra', 'Teamwork'], ['Vůdcovství', 'Leadership'], ['Vyrovnanost', 'Composure'],
    // fyzička
    ['Fyzička', 'Natural Fitness'], ['Hbitost', 'Agility'], ['Rovnováha', 'Balance'], ['Rychlost', 'Pace'], ['Síla', 'Strength'], ['Výdrž', 'Stamina'],
    ['Výskok', 'Jumping Reach'], ['Zrychlení', 'Acceleration'],
    // brankářské: viděny jen tři názvy (ze zprávy o soupeři); ostatní brankářské názvy v češtině NEZJIŠTĚNY
    ['Komunikace', 'Communication'], ['Výstřednost', 'Eccentricity'], ['Vyrážení', 'Punching'],
  ]);
  const ATTR_BY_KEY = new Map(ATTR_PAIRS.map(([cs, en]) => [key(cs), en]));
  const ATTR_ENGLISH = new Set(ATTR_PAIRS.map(([, en]) => key(en)));

  /** canonAttr('Hlavičky') → 'Heading'; anglický a neznámý název vrací beze změny (jen ořezaný). */
  function canonAttr(name) {
    const raw = str(name).trim();
    return ATTR_BY_KEY.get(key(raw)) || raw;
  }
  /** Klíč atributu po převodu na kanonický název: „Hlavičky“, „Heading“ i „heading“ dají totéž. */
  const attrKey = (name) => key(canonAttr(name));
  /** Je to název atributu, který tenhle slovník zná (česky nebo anglicky)? */
  const isKnownAttr = (name) => ATTR_BY_KEY.has(key(name)) || ATTR_ENGLISH.has(key(name));

  /** Skupiny atributů v profilu hráče a v pohledech soupisky (jak je hra píše). */
  const ATTR_GROUPS_CS = deepFreeze({ profile: ['Technika', 'Psychika', 'Fyzička', 'Brankářské'], squadViews: ['Fyzické atributy', 'Psychika', 'Technické', 'Brankářské', 'Obrana', 'Útok'] });

  // ---------------------------------------------------------------- jména hráčů: „L. Horníček“ = „Lukáš Horníček“
  const nameTokens = (s) => core.fold(str(s)).split(/[^a-z]+/).filter(Boolean);
  /** Jméno z obrazovky („L. Horníček“) sedí na jméno v kádru („Lukáš Horníček“): každé slovo kratšího jména je shodné nebo je iniciála slova
      delšího jména a aspoň jedno slovo (příjmení) je shodné celé a má aspoň tři písmena. Bez příjmení se nepáruje. */
  function sameName(a, b) {
    const A = nameTokens(a);
    const B = nameTokens(b);
    if (!A.length || !B.length) return false;
    const [short, long] = A.length <= B.length ? [A, B] : [B, A];
    const used = new Set();
    let full = false;
    for (const tok of short) {
      const i = long.findIndex((x, k) => !used.has(k) && (x === tok || (tok.length === 1 && x.startsWith(tok)) || (x.length === 1 && tok.startsWith(x))));
      if (i < 0) return false;
      used.add(i);
      if (tok.length >= 3 && long[i] === tok) full = true;
    }
    return full;
  }

  // ---------------------------------------------------------------- pozice: seznamy „O/KO/Z/OZ (P)“ a kódy míst „OZSP“
  // Pozice se v tabulkách píše dvěma způsoby: v sloupci Pozice a na hřišti „O (S)“, „DZ, Z (S)“, „OZ (LS), ÚT (S)“ (písmena ve
  // závorce = strany P pravá, L levá, S střední; každé písmeno je zvláštní pozice) a v seznamu míst pokynů k soupeři „OSP“, „DZSL“
  // (kód místa v rozestavení; „SP“ = střed vpravo, „SL“ = střed vlevo). Výsledek jsou kódy pozic, které aplikace zná (GK, DC, WBL, AMR…).
  const ROLE_CS = { B: 'GK', O: 'D', KO: 'WB', DZ: 'DM', Z: 'M', OZ: 'AM', UT: 'ST' };
  const SIDE_LETTER = { P: 'R', L: 'L', S: 'C', R: 'R', C: 'C' };
  const FM_BY_ROLE_SIDE = {
    GK: { '': 'GK' },
    D: { R: 'DR', L: 'DL', C: 'DC' },
    WB: { R: 'WBR', L: 'WBL' },
    DM: { '': 'DM', C: 'DM', R: 'DM', L: 'DM' },
    M: { R: 'MR', L: 'ML', C: 'MC' },
    AM: { R: 'AMR', L: 'AML', C: 'AMC' },
    ST: { '': 'ST', C: 'ST', R: 'ST', L: 'ST' },
  };
  const ROLE_ALIASES = { GK: 'GK', B: 'GK', D: 'D', O: 'D', WB: 'WB', KO: 'WB', DM: 'DM', DZ: 'DM', M: 'M', Z: 'M', AM: 'AM', OZ: 'AM', ST: 'ST', UT: 'ST', SW: 'SW' };
  const FM_CODES = new Set(['GK', 'SW', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST']);
  const upperAscii = (s) => core.fold(str(s)).toUpperCase().replace(/[^A-Z]/g, '');

  /** parsePositions('O/KO/Z/OZ (P)') → {codes: ['DR','WBR','MR','AMR'], unknown: []}. Funguje i na anglické kódy (GK, DC, „D (RC)“). */
  function parsePositions(text) {
    const codes = [];
    const unknown = [];
    const add = (c) => c && !codes.includes(c) && codes.push(c);
    for (const partRaw of str(text).split(/[;,]/)) {
      const part = partRaw.trim();
      if (!part) continue;
      const bare = upperAscii(part);
      if (FM_CODES.has(bare) && !/[(/]/.test(part)) {
        add(bare);
        continue;
      }
      if (/^S\d$/i.test(part)) continue; // lavička S1 až S9 není pozice
      const m = part.match(/^([^()]+?)\s*(?:\(([^)]*)\))?$/);
      if (!m) {
        unknown.push(part);
        continue;
      }
      const sides = upperAscii(m[2] || '').split('').filter(Boolean);
      for (const roleRaw of m[1].split('/')) {
        const role = ROLE_ALIASES[upperAscii(roleRaw)];
        if (!role) {
          unknown.push(roleRaw.trim());
          continue;
        }
        const table = FM_BY_ROLE_SIDE[role];
        if (!table) {
          if (role === 'SW') add('SW');
          continue;
        }
        if (table['']) {
          add(table['']);
          continue;
        }
        if (!sides.length) {
          unknown.push(`${roleRaw.trim()} bez strany`);
          continue;
        }
        for (const s of sides) {
          const side = SIDE_LETTER[s];
          const c = side && table[side];
          if (c) add(c);
          else unknown.push(`${roleRaw.trim()} (${s})`);
        }
      }
    }
    return { codes, unknown };
  }

  /** parseSlotCode('OZSP') → {fm: 'AMC', side: 'RC', code: 'OZSP'} | null. Kód místa v rozestavení soupeře (pokyny k soupeři). */
  function parseSlotCode(text) {
    const raw = upperAscii(text);
    const m = raw.match(/^(KO|DZ|OZ|UT|B|O|Z)([PLS]{0,2})$/);
    if (!m) return null;
    const role = ROLE_CS[m[1]];
    const letters = m[2];
    let side = '';
    if (letters === 'P') side = 'R';
    else if (letters === 'L') side = 'L';
    else if (letters === 'S') side = 'C';
    else if (letters === 'SP') side = 'RC';
    else if (letters === 'SL') side = 'LC';
    else if (letters === '') side = '';
    else return null;
    const table = FM_BY_ROLE_SIDE[role];
    const sideBase = side.length === 2 ? 'C' : side;
    const fm = table && (table[sideBase] || (sideBase === '' ? table[''] : undefined));
    if (!fm) return null;
    return { fm, side: side || (role === 'GK' ? '' : 'C'), code: m[0] };
  }

  /** Kódy míst v rozestavení aplikace (RB, LCB, DM…), kterým odpovídá kód pozice (DC → CB, RCB, LCB). Pořadí od středu ke krajům. */
  const SLOTS_BY_FM = deepFreeze({
    GK: ['GK'], DR: ['RB'], DL: ['LB'], DC: ['CB', 'RCB', 'LCB'], WBR: ['RWB'], WBL: ['LWB'], DM: ['DM', 'RDM', 'LDM'], MC: ['CM', 'RCM', 'LCM'], MR: ['RM'], ML: ['LM'],
    AMR: ['RAM', 'RW'], AML: ['LAM', 'LW'], AMC: ['AM'], ST: ['ST', 'RST', 'LST'],
  });

  /** Kód pozice (FM kód) míst z rozestavení aplikace: RCB → DC, RW → AMR… Neznámé místo → null. */
  const FM_OF_SLOT = (() => {
    const m = {};
    for (const [fm, slots] of Object.entries(SLOTS_BY_FM)) for (const sl of slots) m[sl] = fm;
    return Object.freeze(m);
  })();
  const fmOfSlot = (pos) => FM_OF_SLOT[str(pos).trim().toUpperCase()] || null;

  /** Všech 22 míst, která hra nabízí v pokynech k soupeři (záložka „Všechny pozice“), v pořadí obrazovky. */
  const OPPOSITION_SLOT_CODES = deepFreeze(['B', 'OP', 'OL', 'OS', 'OSL', 'OSP', 'KOP', 'KOL', 'DZS', 'DZSL', 'DZSP', 'ZP', 'ZL', 'ZS', 'ZSL', 'ZSP', 'OZP', 'OZL', 'OZS', 'OZSL', 'OZSP', 'ÚTS']);

  /** normalizePositions(['O/KO/Z/OZ (P)', 'GK']) → {codes, unknown}. Přijme pole textů nebo jeden text; česky i anglicky. */
  function normalizePositions(value) {
    const list = Array.isArray(value) ? value : [value];
    return parsePositions(list.filter((x) => typeof x === 'string').join(', '));
  }

  /** normalizeAttributes({'Hlavičky': 15, 'Heading': 14}) → {attributes: {Heading: 15}, issues}. Názvy se převedou na kanonické anglické,
      hodnoty jen celá čísla 1 až 20; dvě různé hodnoty téhož atributu se nesloučí (první vyhrává) a řekne se to v issues. */
  function normalizeAttributes(obj, opts) {
    const o = opts || {};
    const max = Number.isInteger(o.max) ? o.max : 40;
    const attributes = {};
    const issues = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { attributes, issues };
    for (const [k, v] of Object.entries(obj).slice(0, max)) {
      const name = canonAttr(k).slice(0, 30);
      if (!name) continue;
      if (!(Number.isInteger(v) && v >= 1 && v <= 20)) {
        issues.push(`atribut „${k}“ má nečitelnou hodnotu, vynechal se`);
        continue;
      }
      const exists = Object.keys(attributes).find((x) => key(x) === key(name));
      if (exists !== undefined) {
        if (attributes[exists] !== v) issues.push(`atribut „${name}“ je na obrázku dvakrát s různou hodnotou (${attributes[exists]} a ${v}), platí první`);
        continue;
      }
      attributes[name] = v;
    }
    return { attributes, issues };
  }

  // ---------------------------------------------------------------- týmové instrukce: české názvy a hodnoty
  // [id, české názvy (první je hlavní; ostatní jsou psaní, které hra používá na jiné obrazovce), fáze]. Obrazovka „Týmové instrukce“:
  // s míčem 18 různých názvů (sekce Přehled, Závěrečná třetina, Postup, Rozehrávka), bez míče 9 (Přehled, Vysoký presink, Střední blok, Nízký blok).
  const INSTR_RAW = [
    ['passingDirectness', ['Přímočarost přihrávek'], 'in'],
    ['tempo', ['Tempo'], 'in'],
    ['attackingWidth', ['Šířka při útočení'], 'in'],
    ['attackingTransition', ['Přechod do útoku'], 'in'],
    ['creativeFreedom', ['Tvůrčí volnost'], 'in'],
    ['timeWasting', ['Šetření času'], 'in'],
    ['playForSetPieces', ['Hrát na standardky'], 'in'],
    ['patience', ['Trpělivost'], 'in'],
    ['shotsFromDistance', ['Střely z dálky'], 'in'],
    ['crossingStyle', ['Styl centrování'], 'in'],
    ['dribbling', ['Vedení míče'], 'in'],
    ['supportActions', ['Doprovodné akce'], 'in'],
    ['progressThrough', ['Pokrok prostřednictvím'], 'in'],
    ['passReception', ['Příjem přihrávek'], 'in'],
    ['buildUpStrategy', ['Strategie výstavby'], 'in'],
    ['goalKicks', ['Odkopy od brány'], 'in'],
    ['gkDistributionSpeed', ['BR rozehrávka (rychlost)', 'BR Rozehrávka rychlost', 'Rozehrávka brankáře (rychlost)'], 'in'],
    ['gkDistribution', ['Rozehrávka brankáře'], 'in'],
    ['lineOfEngagement', ['Linie napadání'], 'out'],
    ['defensiveLine', ['Výška obranná linie', 'Výška obranné linie'], 'out'],
    ['defensiveLineBehaviour', ['Chování obranné linie', 'Chování obranná linie'], 'out'],
    ['triggerPress', ['Napadání'], 'out'],
    ['defensiveTransition', ['Obranný přechod'], 'out'],
    ['tackling', ['Obranný zákrok'], 'out'],
    ['shortGkDistribution', ['Krátká rozehrávka brankáře', 'Krátká rozehrávka BR'], 'out'],
    ['pressingTrap', ['Presinková past'], 'out'],
    ['crossEngagement', ['Zapojení centrů'], 'out'],
  ];
  const INSTR = deepFreeze(INSTR_RAW.map(([id, labels, phase]) => ({ id, label: labels[0], labels, phase })));
  const INSTR_LABEL_KEYS = [];
  for (const i of INSTR) for (const l of i.labels) INSTR_LABEL_KEYS.push({ id: i.id, key: key(l) });
  INSTR_LABEL_KEYS.sort((a, b) => b.key.length - a.key.length); // delší název má přednost („Linie napadání“ před „Napadání“)
  const INSTR_BY_LABEL = new Map(INSTR_LABEL_KEYS.map((e) => [e.key, e.id]));

  // [česky, kanonický anglický název hodnoty (jak je v fm27know), seen]. seen=false: odvozeno ze vzoru, v české hře nepozorováno.
  const V = (cs, en, seen) => ({ cs, en, seen: seen === true });
  const VALUE_RAW = {
    passingDirectness: [V('Mnohem kratší', 'Much Shorter', true), V('Kratší', 'Shorter'), V('Standardní', 'Standard'), V('Přímější', 'More Direct'), V('Mnohem přímější', 'Much More Direct')],
    tempo: [V('Mnohem nižší', 'Much Lower'), V('Nižší', 'Lower'), V('Standardní', 'Standard'), V('Vyšší', 'Higher', true), V('Mnohem vyšší', 'Much Higher')],
    attackingWidth: [V('Mnohem užší', 'Much Narrower'), V('Užší', 'Narrower', true), V('Standardní', 'Standard'), V('Širší', 'Wider', true), V('Mnohem širší', 'Much Wider')],
    attackingTransition: [V('Protiútok', 'Counter-Attack', true)],
    creativeFreedom: [V('Vyrovnaný', 'Balanced', true)],
    timeWasting: [V('Standardní', 'Standard', true)],
    playForSetPieces: [V('Udržet míč ve hře', 'Keep Ball in Play', true), V('Hrát na standardky', 'Play For Set Pieces', true)],
    patience: [V('Standardní', 'Standard', true)],
    shotsFromDistance: [V('Povzbuzovat', 'Encourage', true)],
    crossingStyle: [V('Načechrané centry', 'Floated Crosses', true)],
    dribbling: [V('Vyvážený', 'Balanced', true)],
    supportActions: [V('Vyvážené', 'Balanced', true), V('Obě strany', 'Both Flanks', true)],
    progressThrough: [V('Levá', 'Left', true), V('Obě strany', 'Both Flanks', true)],
    passReception: [V('Přihrávat do prostoru', 'Pass Into Space', true)],
    buildUpStrategy: [V('Obejít pressink', 'Bypass Press', true)],
    goalKicks: [V('Krátké', 'Short', true)],
    gkDistributionSpeed: [V('Vyvážená', 'Balanced', true)],
    gkDistribution: [V('Vyvážený', 'Balanced', true)],
    lineOfEngagement: [V('Nízký blok', 'Low Block', true), V('Střední blok', 'Mid Block', true), V('Vysoký presink', 'High Press', true)],
    defensiveLine: [V('Mnohem nižší', 'Much Lower'), V('Nižší', 'Lower'), V('Standardní', 'Standard'), V('Vyšší', 'Higher', true), V('Mnohem vyšší', 'Much Higher')],
    defensiveLineBehaviour: [V('Vyvážené', 'Balanced', true)],
    triggerPress: [V('Mnohem méně často', 'Much Less Often'), V('Méně často', 'Less Often'), V('Standardní', 'Standard'), V('Častěji', 'More Often', true), V('Mnohem častěji', 'Much More Often')],
    defensiveTransition: [V('Kontrapresink', 'Counter-Press', true)],
    tackling: [V('Standardní', 'Standard', true), V('Přitvrdit hru', 'Get Stuck In', true)],
    shortGkDistribution: [V('Ne', 'No', true), V('Ano', 'Yes')],
    pressingTrap: [V('Past na krajích', 'Trap Outside', true)],
    crossEngagement: [],
  };
  const VALUES = deepFreeze(VALUE_RAW);
  const VALUE_BY_KEY = {};
  const VALUE_BY_EN = {};
  for (const [id, list] of Object.entries(VALUE_RAW)) {
    VALUE_BY_KEY[id] = new Map(list.map((v) => [key(v.cs), v]));
    VALUE_BY_EN[id] = new Map(list.map((v) => [key(v.en), v]));
  }

  /** parseInstruction('Šířka při útočení: Užší') → {id, value: 'Narrower', label, seen} | null. Tvary: „Název: Hodnota“, „Název Hodnota“ (přehled vpravo),
      „S míčem: Název Hodnota“. Nezná-li název nebo hodnotu (česky), vrací null: nic se nehádá. */
  function parseInstruction(text) {
    const raw = str(text).trim();
    if (!raw) return null;
    const colon = raw.indexOf(':');
    const attempts = [];
    if (colon > 0) {
      attempts.push({ label: raw.slice(0, colon), value: raw.slice(colon + 1) });
      attempts.push({ whole: raw.slice(colon + 1) });
    }
    attempts.push({ whole: raw });
    for (const a of attempts) {
      if (a.label !== undefined) {
        const id = INSTR_BY_LABEL.get(key(a.label));
        const v = id && VALUE_BY_KEY[id].get(key(a.value));
        if (v) return { id, value: v.en, label: a.label.trim(), seen: v.seen };
        continue;
      }
      const k = key(a.whole);
      for (const e of INSTR_LABEL_KEYS) {
        if (!k.startsWith(e.key)) continue;
        const v = VALUE_BY_KEY[e.id].get(k.slice(e.key.length));
        if (v) return { id: e.id, value: v.en, label: e.key, seen: v.seen };
      }
    }
    return null;
  }

  /** Český název instrukce podle id (pro doporučení v jazyce hry), nebo null. */
  function labelCs(id) {
    const i = INSTR.find((x) => x.id === id);
    return i ? i.label : null;
  }
  /** Česká hodnota instrukce podle id a anglické hodnoty, nebo null, když ji hra v češtině neukázala a nedá se odvodit. */
  function valueCs(id, en) {
    const m = VALUE_BY_EN[id];
    const v = m && m.get(key(en));
    return v ? v.cs : null;
  }
  /** Je česká hodnota opravdu viděná ve hře (true), nebo odvozená ze vzoru (false), nebo neznámá (null)? */
  function valueSeen(id, en) {
    const m = VALUE_BY_EN[id];
    const v = m && m.get(key(en));
    return v ? v.seen : null;
  }

  // ---------------------------------------------------------------- mentalita a styl hry
  // Mentalita: pole „Herní systém“ v horní liště taktiky (sedm voleb, každá s ikonou), v pořadí od nejobrannější.
  const MENTALITY_PAIRS = deepFreeze([['Velmi defenzivní', 'Very Defensive'], ['Obranný', 'Defensive'], ['Opatrný', 'Cautious'], ['Vyvážený', 'Balanced'], ['Aktivní', 'Positive'], ['Útočný', 'Attacking'], ['Velmi útočný', 'Very Attacking']]);
  // Styl hry: pole „Styl“ (11 voleb; poslední, „Čistý štít“, je navíc proti desíti stylům z veřejných zdrojů).
  const STYLE_PAIRS = deepFreeze([
    ['Držení míče', 'Control Possession'], ['Gegenpress', 'Gegenpress'], ['Tiki-taka', 'Tiki-Taka'], ['Vertikální tiki-taka', 'Vertical Tiki-Taka'], ['Hra na křídla', 'Wing Play'],
    ['Nakopávané míče', 'Route One'], ['Plynulý protiútok', 'Fluid Counter-Attack'], ['Přímočarý protiútok', 'Direct Counter-Attack'], ['Catenaccio', 'Catenaccio'],
    ['Zaparkovaný autobus', 'Park the Bus'], ['Čistý štít', 'Clean Sheet'],
  ]);
  function bestPair(text, pairs) {
    const k = key(text);
    if (!k) return null;
    let best = null;
    for (const [cs, en] of pairs) {
      for (const name of [cs, en]) {
        const nk = key(name);
        if (nk && k.includes(nk) && (!best || nk.length > best.len)) best = { en, len: nk.length };
      }
    }
    return best ? best.en : null;
  }
  /** parseMentality('Vyvážený Herní systém') → 'Balanced' | null (česky i anglicky). */
  const parseMentality = (text) => bestPair(text, MENTALITY_PAIRS);
  /** parseStyle('Čistý štít Styl') → 'Clean Sheet' | null. */
  const parseStyle = (text) => bestPair(text, STYLE_PAIRS);

  // ---------------------------------------------------------------- role (jen ty, které byly vidět v profilu hráče: pomocný překlad na kanonické anglické názvy)
  // Pro střední obránce, defenzivní záložníky a útočníka byly vidět celé seznamy rolí s míčem i bez míče. U ostatních míst české názvy
  // rolí NEZJIŠTĚNY (nikdo je neotevřel), proto je tu nejsou: nepoznaná role zůstane v textu a pravidla pro ni se nevyhodnotí.
  const R = (cs, en) => [cs, en];
  const ROLE_CS_IN = deepFreeze([
    R('Střední obránce', 'Centre-Back'), R('Rozehrávající stoper', 'Ball-Playing Centre-Back'), R('Jednoduchý stoper', 'No-Nonsense Centre-Back'),
    R('Krajní stoper', 'Wide Centre-Back'), R('Překrývající stoper', 'Overlapping Centre-Back'), R('Vysunutý stoper', 'Advanced Centre-Back'),
    R('Defenzivní záložník', 'Defensive Midfielder'), R('Halvbek', 'Half Back'), R('Zatažený tvůrce hry', 'Deep-Lying Playmaker'),
    R('Běhavý záložník', 'Box-To-Box Midfielder'), R('Běhavý tvůrce hry', 'Box-To-Box Playmaker'),
    R('Střední útočník', 'Centre Forward'), R('Snajpr', 'Poacher'), R('Hrotový útočník', 'Target Forward'), R('Zatažený útočník', 'Deep-Lying Forward'),
    R('Falešná devítka', 'False Nine'), R('Meziprostorový útočník', 'Channel Forward'),
  ]);
  const ROLE_CS_OUT = deepFreeze([
    R('Střední obránce', 'Centre-Back'), R('Zajišťující stoper', 'Covering Centre-Back'), R('Vystupující stoper', 'Stopping Centre-Back'), R('Široký stoper', 'Wide Centre-Back'),
    R('Zajišťující krajní stoper', 'Covering Wide Centre-Back'), R('Vystupující krajní stoper', 'Stopping Wide Centre-Back'),
    R('Defenzivní záložník', 'Defensive Midfielder'), R('Krycí defenzivní záložník', 'Screening Defensive Midfielder'), R('Presující defenzivní záložník', 'Pressing Defensive Midfielder'),
    R('Zatažený defenzivní záložník', 'Dropping Defensive Midfielder'), R('Široký zajišťující defenzivní záložník', 'Wide Covering Defensive Midfielder'),
    R('Střední útočník', 'Centre Forward'), R('Navazující střední útočník', 'Tracking Centre Forward'), R('Střední brejkový útočník', 'Central Outlet Centre Forward'),
    R('Rozbíhavý brejkový útočník', 'Splitting Outlet Centre Forward'),
  ]);
  const ROLE_IN_BY_KEY = new Map(ROLE_CS_IN.map(([cs, en]) => [key(cs), en]));
  const ROLE_OUT_BY_KEY = new Map(ROLE_CS_OUT.map(([cs, en]) => [key(cs), en]));
  /** canonRole('Rozehrávající stoper', 'in') → 'Ball-Playing Centre-Back'; neznámý název vrací beze změny. */
  function canonRole(name, phase) {
    const raw = str(name).trim();
    const m = phase === 'out' ? ROLE_OUT_BY_KEY : ROLE_IN_BY_KEY;
    return m.get(key(raw)) || raw;
  }
  // Zkratky na štítcích rolí v tabulce „Tvar týmu“. Jen dvojice, které se daly ověřit u téhož hráče (profil hráče nebo nabídka rolí proti štítku
  // v tabulce): GK je základní role brankáře; CB s míčem potvrzuje zaškrtnutá „Střední obránce“ v nabídce rolí u téhož místa; BCB a CB bez míče
  // potvrdil profil stopera; CFD potvrdil profil útočníka. Ostatní zkratky (O, KO, DZ, ZTH, PHH, FR, IW, KH s míčem; FB, TWM, AM, DM bez míče)
  // se ODHADEM nepřekládají: role zůstane nepoznaná a pravidla pro ni se nevyhodnotí.
  const ABBR_RAW = deepFreeze([
    { abbr: 'GK', phase: 'in', en: 'Goalkeeper', verified: true },
    { abbr: 'GK', phase: 'out', en: 'Goalkeeper', verified: true },
    { abbr: 'CB', phase: 'in', en: 'Centre-Back', verified: true },
    { abbr: 'BCB', phase: 'in', en: 'Ball-Playing Centre-Back', verified: true },
    { abbr: 'CB', phase: 'out', en: 'Centre-Back', verified: true },
    { abbr: 'CFD', phase: 'out', en: 'Centre Forward', verified: true },
  ]);
  const ABBR = new Map(ABBR_RAW.map((a) => [`${a.phase}:${key(a.abbr)}`, a]));
  /** roleFromChip('BCB', 'in') → 'Ball-Playing Centre-Back' | null. Jen ověřené zkratky; ostatní vrací null. */
  function roleFromChip(chip, phase) {
    const a = ABBR.get(`${phase === 'out' ? 'out' : 'in'}:${key(chip)}`);
    return a && a.verified ? a.en : null;
  }

  // ---------------------------------------------------------------- Tactical Effectiveness, měřidla a trénink (názvy z hry)
  const TE = deepFreeze({
    gauges: ['Intenzita', 'Complexity', 'Effectiveness'], // vpravo nahoře na obrazovce Taktika; bez čísel a slov, jen barevný ukazatel
    overall: 'Celková efektivita',
    pillars: [
      { id: 'understanding', name: 'Tactical Understanding', factors: ['In Possession Shape', 'Passing Style', 'Build Up', 'Chance Creation', 'Out Of Possession Shape', 'Line of Engagement', 'Pressing Intensity', 'Pressing Trap', 'Player Tactical Ability', 'Tactical Complexity'] },
      { id: 'ability', name: 'Player Ability', factors: ['Player Capability', 'Player Role Suitability'] },
      { id: 'buyIn', name: 'Player Buy-In', factors: ['Managerial Support', 'Teammates and Staff Relationships', 'Manager Tendencies'] },
      { id: 'nextMatch', name: 'Next Match Info', factors: ['Quality of Next Opposition Report', 'Opposition Player Knowledge'] },
    ],
  });
  // Tréninkový rozvrh (sezení v kalendáři): pět kategorií; názvy tak, jak je hra píše (část česky, část anglicky).
  const TRAINING = deepFreeze({
    categories: ['Tactical Understanding', 'Zápasová příprava', 'Footballing Development', 'Physical and Recovery', 'Mimofotbalové aktivity'],
    tacticalUnderstanding: ['Passing Style', 'Build Up', 'Vytvoření šancí', 'In Possession Shape', 'Line of Engagement', 'Pressing Intensity', 'Pressing Trap', 'Out Of Possession Shape'],
    matchPreparation: ['Press Avoidance', 'Defensive Block', 'Defensive Positioning', 'Defensive Engagement', 'Corners', 'Free Kicks', 'Penalty'],
    footballingDevelopment: ['Individual Development', 'Attacking Ball Work', 'Defensive Ball Work', 'Possession Ball Work'],
    physicalAndRecovery: ['Odpočinek', 'Regenerace', 'Light Conditioning', 'Conditioning', 'Heavy Conditioning'],
    nonFootball: ['Týmová soudržnost', 'Práce s místní komunitou'],
    impacts: ['Tactical Understanding', 'Riziko zranění', 'Kondice', 'Únava', 'Připravenost na zápas', 'Spokojenost'],
  });
  // Taktické úpravy v zápase („Active Tactical Tweaks“, záložky Tým a Individual): 15 týmových balíčků (anglicky i v české hře).
  const TWEAKS = deepFreeze([
    'Swap Wings', 'Go Long', 'Play Out From the Back', 'Play With More Urgency', 'Play With More Patience', 'Get Physical', 'Take a Breather', 'Exploit the Width',
    'Go Narrower', 'Disrupt', 'Press Aggressively', 'Press Less Aggressively', 'GK To Go Up For Set Pieces', 'Throw the Kitchen Sink', 'Shut Up Shop',
  ]);
  // Sloupce pokynů k soupeři (Taktika › Opposition › Opposition): u každého hráče rozbalovací seznam. Nabídky ověřeny jen u prvních dvou sloupců.
  const OPPOSITION_COLUMNS = deepFreeze([
    { id: 'tightMarking', label: 'Těsné obsazování', values: ['-', 'Nikdy', 'Vždy'], valuesSeen: true },
    { id: 'closingDown', label: 'Napadání', values: ['-', 'Nikdy', 'Vždy'], valuesSeen: true },
    { id: 'tackling', label: 'Obranné zákroky', values: [], valuesSeen: false },
    { id: 'showOntoFoot', label: 'Nutit hrát nohou', values: [], valuesSeen: false },
  ]);

  return {
    VERSION, OBSERVED_ON, key, ATTR_PAIRS, ATTR_GROUPS_CS, canonAttr, attrKey, isKnownAttr, sameName,
    parsePositions, normalizePositions, normalizeAttributes, parseSlotCode, SLOTS_BY_FM, fmOfSlot, OPPOSITION_SLOT_CODES,
    INSTR, VALUES, parseInstruction, labelCs, valueCs, valueSeen,
    MENTALITY_PAIRS, STYLE_PAIRS, parseMentality, parseStyle,
    ROLE_CS_IN, ROLE_CS_OUT, canonRole, roleFromChip,
    TE, TRAINING, TWEAKS, OPPOSITION_COLUMNS,
  };
});
