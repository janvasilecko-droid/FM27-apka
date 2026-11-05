/* FM27 Tactical Coach: DWRS, vážené hodnocení hráče na roli (čistý modul bez DOM, sítě a AI).

   METODA (veřejně popsaná, SOURCE-BASED): v každé kategorii důležitosti se atributy po vynásobení násobičem role zprůměrují, průměry se sečtou s váhami kategorií
   a výsledek se přepočte na 0 až 100 mezi teoretickým minimem (všechny atributy 1) a maximem (všechny 20) při stejném vážení. Popis je z komentářů ve zdroji FM Player Analyzer
   (GPL-3.0); odtud je jen matematika a čísla (váhy kategorií 8 / 4 / 2 / 1 / 0,2, násobiče 1,5 / 1,2 / 1,0). Žádný kód ani tabulka nepřevzata, vše je napsáno samostatně.

   DATA (ESTIMATED): tabulky „který atribut je v jaké kategorii“ jsou vlastní odhad autora této aplikace z komunitní zkušenosti, ne pravidlo FM27 a nebyly ověřeny proti enginu.
   Proto jsou po skupinách pozic (ne jedna tabulka pro všechny), mají přednastavené profily (kontextové násobiče podle stylu hry), dají se upravit (kategorie atributu, váhy kategorií,
   násobiče role, kontextové násobiče) a každý výsledek se rozepíše po atributech (atribut, kategorie, násobič role, kontextový násobič, váha, body).
   Role (klíčové a žádoucí atributy) se berou z PROFILU ROLE, který uživatel přečte z obrazovky role ve hře nebo zadá ručně (viz rolefit.js).

   POCTIVOST: chybí-li hráči atribut z tabulky, výsledek je „nedostupné“ (UNKNOWN), nikdy nula; částečný výpočet je výslovně označený a má pokrytí váhy.
   Skryté údaje hry (CA, PA, osobnost, reputace) se nikdy nepoužijí. Čisté funkce: stejný vstup dá vždy stejný výstup, vstupy se nemění. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rolefit.js'), require('./tableimport.js'));
  else root.TrenerDwrs = factory(root.TrenerRoleFit, root.TrenerTableImport);
})(typeof self !== 'undefined' ? self : this, function (RF, TI) {
  'use strict';

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const attrKey = RF.attrKey;

  // ---------------------------------------------------------------- kategorie důležitosti
  const TIERS = Object.freeze(['minor', 'decent', 'good', 'important', 'extreme']); // vzestupně
  const TIER_CS = Object.freeze({ extreme: 'extrémně důležitý', important: 'důležitý', good: 'dobrý', decent: 'přijatelný', minor: 'téměř nepodstatný' });
  const DEFAULT_CATEGORY_WEIGHTS = Object.freeze({ extreme: 8, important: 4, good: 2, decent: 1, minor: 0.2 }); // SOURCE-BASED (hráči z pole)
  const DEFAULT_GK_CATEGORY_WEIGHTS = Object.freeze({ extreme: 3, important: 2, good: 1, decent: 0.5, minor: 0.2 }); // jiná stupnice než u hráčů z pole (brankář má vlastní model)
  const DEFAULT_MULTIPLIERS = Object.freeze({ key: 1.5, pref: 1.2, other: 1 }); // SOURCE-BASED

  const GROUPS = Object.freeze(['GK', 'CB', 'FB', 'DM', 'CM', 'W', 'AM', 'ST']);
  const GROUP_CS = Object.freeze({ GK: 'brankář', CB: 'střední obránce', FB: 'krajní obránce', DM: 'defenzivní záložník', CM: 'střední záložník', W: 'křídlo, krajní záložník', AM: 'ofenzivní záložník', ST: 'útočník' });
  // FM kód pozice → skupina. Kódy míst z formací této aplikace (RB, LCB, …) se nejdřív převedou na FM kódy přes RF.SLOT_FM_POS.
  const FM_TO_GROUP = Object.freeze({ GK: 'GK', DC: 'CB', SW: 'CB', DL: 'FB', DR: 'FB', WBL: 'FB', WBR: 'FB', DM: 'DM', MC: 'CM', ML: 'W', MR: 'W', AML: 'W', AMR: 'W', AMC: 'AM', ST: 'ST' });

  function groupOfPosition(code) {
    const c = String(code === undefined || code === null ? '' : code).toUpperCase().trim();
    if (!c) return null;
    const fm = RF.SLOT_FM_POS[c] || c;
    return FM_TO_GROUP[fm] || null;
  }

  // ---------------------------------------------------------------- atributy a výchozí tabulky (ODHAD, viz hlavička)
  const OUTFIELD_ATTRIBUTES = Object.freeze([
    'Corners', 'Crossing', 'Dribbling', 'Finishing', 'First Touch', 'Free Kick Taking', 'Heading', 'Long Shots', 'Long Throws', 'Marking', 'Passing', 'Penalty Taking', 'Tackling', 'Technique',
    'Aggression', 'Anticipation', 'Bravery', 'Composure', 'Concentration', 'Decisions', 'Determination', 'Flair', 'Leadership', 'Off The Ball', 'Positioning', 'Teamwork', 'Vision', 'Work Rate',
    'Acceleration', 'Agility', 'Balance', 'Jumping Reach', 'Natural Fitness', 'Pace', 'Stamina', 'Strength',
  ]);
  const GK_ATTRIBUTES = Object.freeze([
    'Aerial Reach', 'Command Of Area', 'Communication', 'Eccentricity', 'Handling', 'Kicking', 'One On Ones', 'Punching', 'Reflexes', 'Rushing Out', 'Throwing',
    'Anticipation', 'Concentration', 'Decisions', 'Positioning', 'Agility', 'Balance', 'Composure', 'Bravery', 'First Touch', 'Passing', 'Determination', 'Leadership', 'Teamwork', 'Vision',
    'Acceleration', 'Jumping Reach', 'Pace', 'Strength', 'Natural Fitness',
  ]);
  // Výčet jen čtyř horních kategorií; „téměř nepodstatné“ jsou všechny ostatní atributy skupiny (každý atribut je v každé skupině přesně v jedné kategorii).
  const DEFAULT_TABLES = Object.freeze({
    CB: { extreme: ['Marking', 'Tackling', 'Positioning', 'Heading'], important: ['Anticipation', 'Concentration', 'Decisions', 'Jumping Reach', 'Strength', 'Pace'], good: ['Composure', 'Bravery', 'Aggression', 'Acceleration', 'Determination', 'Teamwork'], decent: ['Passing', 'First Touch', 'Technique', 'Agility', 'Balance', 'Work Rate', 'Leadership', 'Stamina'] },
    FB: { extreme: ['Pace', 'Acceleration', 'Stamina'], important: ['Work Rate', 'Marking', 'Tackling', 'Positioning', 'Crossing'], good: ['Anticipation', 'Concentration', 'Decisions', 'Passing', 'Dribbling', 'Agility', 'Teamwork', 'Balance'], decent: ['Technique', 'First Touch', 'Strength', 'Determination', 'Aggression', 'Bravery', 'Off The Ball', 'Vision', 'Heading'] },
    DM: { extreme: ['Positioning', 'Tackling', 'Anticipation'], important: ['Decisions', 'Concentration', 'Passing', 'Teamwork', 'Work Rate', 'Marking', 'Stamina', 'Strength'], good: ['First Touch', 'Composure', 'Vision', 'Aggression', 'Determination', 'Technique', 'Balance', 'Bravery'], decent: ['Heading', 'Jumping Reach', 'Agility', 'Acceleration', 'Pace', 'Dribbling', 'Leadership', 'Long Shots'] },
    CM: { extreme: ['Passing', 'Decisions', 'Vision'], important: ['First Touch', 'Technique', 'Stamina', 'Work Rate', 'Teamwork', 'Composure', 'Positioning', 'Anticipation'], good: ['Tackling', 'Dribbling', 'Off The Ball', 'Concentration', 'Determination', 'Balance', 'Agility', 'Strength'], decent: ['Acceleration', 'Pace', 'Long Shots', 'Marking', 'Flair', 'Bravery', 'Aggression', 'Leadership'] },
    W: { extreme: ['Pace', 'Acceleration', 'Dribbling'], important: ['Crossing', 'Technique', 'First Touch', 'Agility', 'Stamina', 'Work Rate', 'Off The Ball', 'Balance'], good: ['Passing', 'Flair', 'Vision', 'Decisions', 'Anticipation', 'Finishing', 'Composure'], decent: ['Teamwork', 'Determination', 'Long Shots', 'Strength', 'Concentration', 'Positioning', 'Tackling', 'Bravery'] },
    AM: { extreme: ['Technique', 'Passing', 'Vision'], important: ['First Touch', 'Dribbling', 'Decisions', 'Off The Ball', 'Composure', 'Flair', 'Anticipation', 'Agility'], good: ['Acceleration', 'Pace', 'Finishing', 'Long Shots', 'Teamwork', 'Work Rate', 'Balance', 'Determination'], decent: ['Stamina', 'Concentration', 'Positioning', 'Strength', 'Tackling', 'Crossing', 'Bravery'] },
    ST: { extreme: ['Finishing', 'Acceleration', 'Pace'], important: ['Off The Ball', 'Composure', 'Anticipation', 'First Touch'], good: ['Dribbling', 'Technique', 'Strength', 'Balance', 'Agility', 'Decisions', 'Determination', 'Heading', 'Jumping Reach', 'Stamina'], decent: ['Passing', 'Vision', 'Work Rate', 'Teamwork', 'Long Shots', 'Concentration', 'Bravery', 'Aggression', 'Flair'] },
    GK: { extreme: ['Positioning', 'Aerial Reach', 'Handling'], important: ['Reflexes', 'Agility', 'Anticipation', 'Command Of Area'], good: ['Concentration', 'Decisions', 'Kicking', 'One On Ones', 'Communication'], decent: ['Throwing', 'Rushing Out', 'Composure', 'Bravery', 'Balance', 'First Touch', 'Passing'] },
  });

  const attributesOf = (group) => (group === 'GK' ? GK_ATTRIBUTES : OUTFIELD_ATTRIBUTES);
  const canonical = (group) => {
    const m = new Map();
    for (const a of attributesOf(group)) m.set(attrKey(a), a);
    return m;
  };

  /** Výchozí kategorie atributu ve skupině: Map klíč → {attribute, tier}. */
  function defaultTiers(group) {
    const out = new Map();
    const table = DEFAULT_TABLES[group];
    if (!table) return out;
    const listed = new Set();
    for (const tier of ['extreme', 'important', 'good', 'decent']) {
      for (const a of table[tier]) {
        out.set(attrKey(a), { attribute: a, tier });
        listed.add(attrKey(a));
      }
    }
    for (const a of attributesOf(group)) if (!listed.has(attrKey(a))) out.set(attrKey(a), { attribute: a, tier: 'minor' });
    return out;
  }

  // ---------------------------------------------------------------- profil vah (přednastavené i vlastní)
  /** Přednastavení = kontextové násobiče atributů podle stylu hry (ODHAD autora, ne pravidlo FM27). Násobič se vynásobí s váhou atributu; normalizace 0 až 100
      zůstává (stejné váhy se použijí pro minimum i maximum). Každé přednastavení vysvětlí, co přesně změnilo (describeProfile). Hráčů z pole se týkají všechna,
      brankáře ne. Posun kategorie by tu nefungoval: přesunem atributu do kategorie „extrémně důležitý“ by se průměr v ní ředil a ostatní atributy by váhu ztratily. */
  const PRESET_DEFS = Object.freeze([
    { id: 'universal', name: 'Univerzální analytik', note: 'Výchozí odhad autora aplikace (ESTIMATED): žádný kontextový násobič, žádný styl hry.', context: {} },
    { id: 'speed', name: 'Rychlostní fotbal', note: 'Pro hru na rychlost a prostor za obranou: tempo a vytrvalost mají větší váhu.', context: { Pace: 1.5, Acceleration: 1.5, Agility: 1.2, Stamina: 1.2, 'Work Rate': 1.2 } },
    { id: 'positional', name: 'Poziční fotbal', note: 'Pro kontrolu míče a pozic: myšlení a práce s míčem mají větší váhu, čisté tempo menší.', context: { Passing: 1.3, Vision: 1.3, Decisions: 1.3, Positioning: 1.2, Teamwork: 1.2, 'First Touch': 1.2, Technique: 1.2, Composure: 1.2, Anticipation: 1.2, Pace: 0.8, Acceleration: 0.8 } },
    { id: 'pressing', name: 'Pressing', note: 'Pro vysoké napadání: nasazení, čtení hry a vytrvalost mají větší váhu.', context: { 'Work Rate': 1.4, Stamina: 1.4, Aggression: 1.3, Anticipation: 1.2, Teamwork: 1.2, Determination: 1.2, Acceleration: 1.2 } },
    { id: 'counter', name: 'Protiútoky', note: 'Pro rychlé přechody: tempo, zakončení a pohyb bez míče mají větší váhu.', context: { Pace: 1.4, Acceleration: 1.4, Finishing: 1.2, 'Off The Ball': 1.2, Composure: 1.2, Decisions: 1.2, 'First Touch': 1.2 } },
    { id: 'technical', name: 'Technický fotbal', note: 'Pro kombinační hru: technika a tvořivost mají větší váhu, tělesná síla menší.', context: { Technique: 1.4, 'First Touch': 1.3, Passing: 1.3, Dribbling: 1.3, Vision: 1.2, Flair: 1.2, Composure: 1.2, Strength: 0.8, 'Jumping Reach': 0.8, Heading: 0.8 } },
  ]);

  const emptyOverrides = () => ({});

  /** Profil vah z přednastavení (kdo chce vlastní profil, upravuje kopii). */
  function presetProfile(id) {
    const def = PRESET_DEFS.find((p) => p.id === id);
    if (!def) return null;
    return {
      id: def.id,
      name: def.name,
      base: 'universal',
      note: def.note,
      categoryWeights: Object.assign({}, DEFAULT_CATEGORY_WEIGHTS),
      gkCategoryWeights: Object.assign({}, DEFAULT_GK_CATEGORY_WEIGHTS),
      multipliers: Object.assign({}, DEFAULT_MULTIPLIERS),
      overrides: emptyOverrides(),
      context: Object.assign({}, def.context),
    };
  }
  const presets = () => PRESET_DEFS.map((p) => presetProfile(p.id));
  const defaultProfile = () => presetProfile('universal');

  const validWeight = (v) => isNum(v) && v >= 0 && v <= 100;
  /** Ověří a doplní profil vah: neplatné hodnoty se vrátí na výchozí (a zapíšou do issues), neznámé atributy a kategorie se zahodí. */
  function normalizeProfile(raw) {
    const issues = [];
    const src = isObj(raw) ? raw : {};
    const out = defaultProfile();
    out.id = typeof src.id === 'string' && src.id.trim() ? src.id.trim().slice(0, 40) : 'vlastni';
    out.name = typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 60) : 'Vlastní profil';
    out.base = typeof src.base === 'string' ? src.base.slice(0, 40) : 'universal';
    out.note = typeof src.note === 'string' ? src.note.slice(0, 300) : '';
    for (const [field, defaults] of [['categoryWeights', DEFAULT_CATEGORY_WEIGHTS], ['gkCategoryWeights', DEFAULT_GK_CATEGORY_WEIGHTS]]) {
      if (isObj(src[field])) {
        for (const tier of TIERS) {
          if (src[field][tier] === undefined) continue;
          if (validWeight(src[field][tier])) out[field][tier] = src[field][tier];
          else issues.push(`Váha kategorie „${TIER_CS[tier]}“ musí být číslo od 0 do 100, vrácena výchozí ${defaults[tier]}.`);
        }
      }
    }
    if (isObj(src.multipliers)) {
      for (const k of ['key', 'pref']) {
        if (src.multipliers[k] === undefined) continue;
        if (isNum(src.multipliers[k]) && src.multipliers[k] >= 1 && src.multipliers[k] <= 3) out.multipliers[k] = src.multipliers[k];
        else issues.push(`Násobič ${k === 'key' ? 'klíčového' : 'žádoucího'} atributu musí být od 1 do 3, vrácen výchozí ${DEFAULT_MULTIPLIERS[k]}.`);
      }
    }
    out.context = {};
    if (isObj(src.context)) {
      const known = new Map(OUTFIELD_ATTRIBUTES.map((a) => [attrKey(a), a]));
      for (const [name, factor] of Object.entries(src.context)) {
        const k = attrKey(name);
        if (!known.has(k)) {
          issues.push(`Atribut „${String(name).slice(0, 30)}“ v kontextu není mezi atributy hráčů z pole, přeskočeno.`);
          continue;
        }
        if (!(isNum(factor) && factor >= 0.1 && factor <= 5)) {
          issues.push(`Kontextový násobič atributu ${known.get(k)} musí být číslo od 0,1 do 5, přeskočeno.`);
          continue;
        }
        if (factor !== 1) out.context[known.get(k)] = factor;
      }
    }
    out.overrides = emptyOverrides();
    if (isObj(src.overrides)) {
      for (const group of GROUPS) {
        const given = src.overrides[group];
        if (!isObj(given)) continue;
        const known = canonical(group);
        const base = defaultTiers(group);
        for (const [name, tier] of Object.entries(given)) {
          const k = attrKey(name);
          if (!known.has(k)) {
            issues.push(`Atribut „${String(name).slice(0, 30)}“ ve skupině ${group} není, přeskočeno.`);
            continue;
          }
          if (!TIERS.includes(tier)) {
            issues.push(`Kategorie „${String(tier).slice(0, 20)}“ u atributu ${known.get(k)} není platná, přeskočeno.`);
            continue;
          }
          if (base.get(k).tier !== tier) (out.overrides[group] = out.overrides[group] || {})[known.get(k)] = tier;
        }
      }
    }
    return { profile: out, issues };
  }

  /** Efektivní kategorie atributů ve skupině po použití profilu: Map klíč → {attribute, tier, changed}. */
  function tiersFor(group, wp) {
    const map = defaultTiers(group);
    const ov = isObj(wp) && isObj(wp.overrides) && isObj(wp.overrides[group]) ? wp.overrides[group] : {};
    const out = new Map();
    for (const [k, v] of map) out.set(k, { attribute: v.attribute, tier: v.tier, changed: false });
    for (const [name, tier] of Object.entries(ov)) {
      const k = attrKey(name);
      if (out.has(k) && TIERS.includes(tier)) {
        const e = out.get(k);
        if (e.tier !== tier) {
          e.tier = tier;
          e.changed = true;
        }
      }
    }
    return out;
  }

  /** Co profil změnil oproti výchozímu odhadu: řádky pro uživatele (po skupinách, váhy kategorií, násobiče). */
  function describeProfile(wp) {
    const p = isObj(wp) ? wp : defaultProfile();
    const lines = [];
    for (const tier of TIERS.slice().reverse()) {
      const w = isObj(p.categoryWeights) && isNum(p.categoryWeights[tier]) ? p.categoryWeights[tier] : DEFAULT_CATEGORY_WEIGHTS[tier];
      if (w !== DEFAULT_CATEGORY_WEIGHTS[tier]) lines.push(`Váha kategorie „${TIER_CS[tier]}“ (hráči z pole): ${DEFAULT_CATEGORY_WEIGHTS[tier]} → ${w}.`);
      const g = isObj(p.gkCategoryWeights) && isNum(p.gkCategoryWeights[tier]) ? p.gkCategoryWeights[tier] : DEFAULT_GK_CATEGORY_WEIGHTS[tier];
      if (g !== DEFAULT_GK_CATEGORY_WEIGHTS[tier]) lines.push(`Váha kategorie „${TIER_CS[tier]}“ (brankář): ${DEFAULT_GK_CATEGORY_WEIGHTS[tier]} → ${g}.`);
    }
    for (const k of ['key', 'pref']) {
      const m = isObj(p.multipliers) && isNum(p.multipliers[k]) ? p.multipliers[k] : DEFAULT_MULTIPLIERS[k];
      if (m !== DEFAULT_MULTIPLIERS[k]) lines.push(`Násobič ${k === 'key' ? 'klíčového' : 'žádoucího'} atributu role: ${DEFAULT_MULTIPLIERS[k]} → ${m}.`);
    }
    for (const name of Object.keys(isObj(p.context) ? p.context : {}).sort()) {
      const f = p.context[name];
      if (isNum(f) && f !== 1) lines.push(`${name}: kontextový násobič 1 → ${f} (hráči z pole, ne brankář).`);
    }
    for (const group of GROUPS) {
      const base = defaultTiers(group);
      for (const e of tiersFor(group, p).values()) {
        if (!e.changed) continue;
        lines.push(`${e.attribute} (${GROUP_CS[group]}): ${TIER_CS[base.get(attrKey(e.attribute)).tier]} → ${TIER_CS[e.tier]}.`);
      }
    }
    return { name: p.name, note: p.note || '', lines, changed: lines.length };
  }

  // ---------------------------------------------------------------- výpočet
  /** Atributy hráče: jen celá čísla 1 až 20; skryté údaje hry se nikdy nebere. */
  function playerAttributes(player) {
    const m = new Map();
    if (!isObj(player) || !isObj(player.attributes)) return m;
    for (const [name, v] of Object.entries(player.attributes)) {
      if (TI && TI.isHiddenName && TI.isHiddenName(name)) continue;
      if (isNum(v) && Number.isInteger(v) && v >= 1 && v <= 20) m.set(attrKey(name), v);
    }
    return m;
  }

  /** plan(group, role, wp) → {group, entries: [{attribute, tier, categoryWeight, multiplier, context, level, weight}], totalWeight, ignoredRoleAttributes}.
      Atribut role, který v tabulce skupiny není (třeba útočný atribut u brankáře), se nepočítá a je v ignoredRoleAttributes.
      weight = váha kategorie × násobič role × kontextový násobič profilu / počet atributů v kategorii (to je „průměr v kategorii“ rozepsaný po atributech). */
  function plan(group, role, wp) {
    const profile = isObj(wp) ? wp : defaultProfile();
    const weights = group === 'GK' ? Object.assign({}, DEFAULT_GK_CATEGORY_WEIGHTS, profile.gkCategoryWeights) : Object.assign({}, DEFAULT_CATEGORY_WEIGHTS, profile.categoryWeights);
    const mult = Object.assign({}, DEFAULT_MULTIPLIERS, profile.multipliers);
    const tiers = tiersFor(group, profile);
    const counts = {};
    for (const e of tiers.values()) counts[e.tier] = (counts[e.tier] || 0) + 1;
    const ctx = new Map();
    if (group !== 'GK' && isObj(profile.context)) for (const [name, f] of Object.entries(profile.context)) if (isNum(f) && f > 0) ctx.set(attrKey(name), f);
    const keyList = new Set(isObj(role) && Array.isArray(role.key) ? role.key.map(attrKey) : []);
    const prefList = new Set(isObj(role) && Array.isArray(role.pref) ? role.pref.map(attrKey) : []);
    const entries = [];
    let totalWeight = 0;
    for (const [k, e] of tiers) {
      const level = keyList.has(k) ? 'key' : prefList.has(k) ? 'pref' : 'other';
      const categoryWeight = weights[e.tier];
      const multiplier = mult[level];
      const context = ctx.get(k) || 1;
      const weight = (categoryWeight * multiplier * context) / counts[e.tier];
      totalWeight += weight;
      entries.push({ attribute: e.attribute, key: k, tier: e.tier, categoryWeight, multiplier, context, level, weight });
    }
    const roleNames = [...(isObj(role) && Array.isArray(role.key) ? role.key : []), ...(isObj(role) && Array.isArray(role.pref) ? role.pref : [])].filter((x) => typeof x === 'string');
    const ignored = [...new Set(roleNames.filter((n) => !tiers.has(attrKey(n))))];
    return { group, entries, totalWeight, ignoredRoleAttributes: ignored };
  }

  /** score(player, role, group, wp) → {score|null, partial|null, absolute, worst, best, missing[], contributions[], reason}.
      score = (Σ w·hodnota − Σ w) / (19 · Σ w) · 100 (rozepsaný „průměr v kategorii“ a přepočet 1 → 0, 20 → 100). */
  function score(player, role, group, wp, opts) {
    const empty = { score: null, partial: null, absolute: null, worst: null, best: null, missing: [], contributions: [], reason: '', group: group || null, ignoredRoleAttributes: [] };
    void opts; // volby (pokrytí) se uplatňují až ve valueOf: tady se vždy vrací úplný výsledek, nebo částečný s pokrytím
    if (!GROUPS.includes(group)) return Object.assign(empty, { reason: 'Neznámá skupina pozic: nastav ji u role nebo u místa v taktice.' });
    const p = plan(group, role, wp);
    if (!(p.totalWeight > 0)) return Object.assign(empty, { reason: 'Všechny váhy jsou nulové, nelze počítat.' });
    const attrs = playerAttributes(player);
    const contributions = [];
    const missing = [];
    for (const e of p.entries) {
      if (e.weight === 0) continue;
      const value = attrs.get(e.key);
      if (value === undefined) {
        missing.push(e.attribute);
        continue;
      }
      contributions.push({ attribute: e.attribute, tier: e.tier, level: e.level, categoryWeight: e.categoryWeight, multiplier: e.multiplier, context: e.context, weight: e.weight, value, points: e.weight * value });
    }
    const sum = (arr, f) => arr.reduce((s, c) => s + f(c), 0);
    const normalized = (list) => {
      const w = sum(list, (c) => c.weight);
      if (!(w > 0)) return null;
      const abs = sum(list, (c) => c.weight * c.value);
      return { abs, worst: w, best: 20 * w, score: r1(((abs - w) / (19 * w)) * 100) };
    };
    if (!missing.length) {
      const n = normalized(contributions);
      return { score: n.score, partial: null, absolute: n.abs, worst: n.worst, best: n.best, missing, contributions, reason: '', group, ignoredRoleAttributes: p.ignoredRoleAttributes };
    }
    const n = contributions.length ? normalized(contributions) : null;
    const usedW = sum(contributions, (c) => c.weight);
    const allW = p.entries.reduce((s, e) => s + e.weight, 0);
    const partial = n ? { score: n.score, coverage: Math.round((usedW / allW) * 100) / 100, used: contributions.length, total: contributions.length + missing.length } : null;
    return { score: null, partial, absolute: null, worst: null, best: null, missing, contributions, reason: `Hráči chybí atributy: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` a ${missing.length - 6} dalších` : ''}.`, group, ignoredRoleAttributes: p.ignoredRoleAttributes };
  }

  /** Hodnota pro přiřazení: úplný výsledek, nebo (jen na přání) částečný s dostatečným pokrytím. */
  function valueOf(result, allowPartial, minCoverage) {
    if (!result) return { value: null, partial: false };
    if (result.score !== null) return { value: result.score, partial: false };
    if (allowPartial && result.partial && result.partial.coverage >= (isNum(minCoverage) ? minCoverage : 0.8)) return { value: result.partial.score, partial: true };
    return { value: null, partial: false };
  }

  /** Silné stránky a mezery z rozpisu: n atributů s nejvyšším a n s nejnižším příspěvkem k výsledku (podle váhy × odchylka od průměru 10,5), bez překryvu. */
  function strengthsGaps(contributions, n) {
    const limit = Number.isInteger(n) && n > 0 ? n : 3;
    const list = (Array.isArray(contributions) ? contributions : []).filter((c) => isObj(c) && isNum(c.value) && isNum(c.weight) && c.weight > 0);
    const impact = (c) => c.weight * (c.value - 10.5);
    const byName = (a, b) => (a.attribute < b.attribute ? -1 : a.attribute > b.attribute ? 1 : 0);
    const strengths = list.filter((c) => c.value >= 12).sort((a, b) => impact(b) - impact(a) || byName(a, b)).slice(0, limit);
    const taken = new Set(strengths.map((c) => c.attribute));
    const gaps = list.filter((c) => c.value <= 9 && !taken.has(c.attribute)).sort((a, b) => impact(a) - impact(b) || byName(a, b)).slice(0, limit);
    const pick = (c) => ({ attribute: c.attribute, value: c.value, level: c.level, tier: c.tier });
    return { strengths: strengths.map(pick), gaps: gaps.map(pick) };
  }

  // ---------------------------------------------------------------- skupina role a rozbor hráče
  const ROLE_GROUP_WORDS = Object.freeze([
    ['GK', ['goalkeeper', 'sweeper keeper', 'brankar']],
    ['CB', ['centre-back', 'center-back', 'central defender', 'ball playing defender', 'libero', 'limited defender', 'no-nonsense']],
    ['FB', ['wing-back', 'wingback', 'full-back', 'fullback']],
    ['AM', ['attacking midfielder', 'trequartista', 'enganche']],
    ['DM', ['defensive midfielder', 'anchor', 'half back', 'regista']],
    ['CM', ['central midfielder', 'box-to-box', 'mezzala', 'carrilero']],
    ['ST', ['striker', 'forward', 'poacher', 'target man', 'false nine']],
    ['W', ['winger', 'wide midfielder', 'inside forward', 'raumdeuter']],
  ]);

  /** Skupina pozic role: zadaná u profilu, jinak jen z jednoznačných anglických názvů (jinak null a uživatel ji nastaví). */
  function groupOfRole(profile) {
    if (!isObj(profile)) return null;
    if (GROUPS.includes(profile.group)) return profile.group;
    const name = String(profile.name || '').toLowerCase();
    // „inside forward“ je křídlo, ne útočník: delší a přesnější názvy se zkoušejí dřív než obecné „forward“
    const hits = ROLE_GROUP_WORDS.filter(([, words]) => words.some((w) => name.includes(w))).map(([g]) => g);
    if (hits.length === 1) return hits[0];
    if (hits.includes('W') && hits.includes('ST') && /inside forward/.test(name)) return 'W';
    return null;
  }

  /** Skupiny pozic, na kterých hráč podle svých pozic může hrát. */
  function groupsOfPlayer(player) {
    const out = new Set();
    for (const p of isObj(player) && Array.isArray(player.positions) ? player.positions : []) {
      const g = groupOfPosition(p);
      if (g) out.add(g);
    }
    return [...out];
  }

  /** analyzePlayer(player, profiles, wp, {minCoverage, allowPartial}) → hodnocení všech rolí s profilem a jejich pořadí.
      best = nejlepší tři role; worst = nejhorší tři role z těch, které na pozicích hráče dávají smysl; unavailable = role bez výsledku s důvodem. */
  function analyzePlayer(player, profiles, wp, opts) {
    const o = isObj(opts) ? opts : {};
    const roles = [];
    const unavailable = [];
    const playerGroups = groupsOfPlayer(player);
    for (const profile of Array.isArray(profiles) ? profiles : []) {
      if (!isObj(profile)) continue;
      const group = groupOfRole(profile);
      if (!group) {
        unavailable.push({ role: profile.name, reason: 'Skupina pozic role není známá: nastav ji u profilu role.' });
        continue;
      }
      const r = score(player, profile, group, wp);
      const v = valueOf(r, !!o.allowPartial, o.minCoverage);
      if (v.value === null) {
        unavailable.push({ role: profile.name, group, reason: r.reason || 'Výsledek není k dispozici.' });
        continue;
      }
      roles.push({ role: profile.name, duty: profile.duty || '', phase: profile.phase || '', group, score: v.value, partial: v.partial, relevant: !playerGroups.length || playerGroups.includes(group), result: r });
    }
    roles.sort((a, b) => b.score - a.score || (a.role < b.role ? -1 : 1));
    const best = roles.slice(0, 3);
    // nejhorší tři z rolí, které na pozicích hráče dávají smysl; role z nejlepších tří se tu neopakují (při málo rolích je seznam krátký nebo prázdný)
    const worst = roles.filter((r) => r.relevant && !best.includes(r)).slice(-3).reverse();
    return { roles, best, worst, unavailable, playerGroups };
  }

  return {
    TIERS, TIER_CS, DEFAULT_CATEGORY_WEIGHTS, DEFAULT_GK_CATEGORY_WEIGHTS, DEFAULT_MULTIPLIERS, GROUPS, GROUP_CS, OUTFIELD_ATTRIBUTES, GK_ATTRIBUTES, DEFAULT_TABLES,
    groupOfPosition, groupOfRole, groupsOfPlayer, defaultTiers, tiersFor, presets, presetProfile, defaultProfile, normalizeProfile, describeProfile,
    plan, score, valueOf, strengthsGaps, analyzePlayer, playerAttributes,
  };
});
