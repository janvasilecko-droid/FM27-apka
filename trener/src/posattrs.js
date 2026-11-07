/* Které atributy rozhodují na které pozici (zadání majitele 6. 11. 2026: „výběr musí být podle daných atributů: obránce má vysokou obranu a zákroky,
   a může mít nižší útok… najdi, co na jakou pozici je nejlepší atribut“). Čistá data a výpočet bez DOM (test/posattrs.test.mjs).

   ODKUD JSOU DATA (průzkum 6. 11. 2026, docs/ANALYZA_SESTAVY_A_PRIPRAVY.md): veřejné komunitní příručky pro FM26 (slovník atributů a rolí je s FM27 shodný):
     VG  Vortex Gaming „FM26: Top 5 Key Attributes by Position“ (https://vortexgaming.io/en/postdetail/640375): pět nejdůležitějších atributů pro každou pozici
         a minimum 11 u základních atributů hráčů v poli;
     FD  FM Dossier „Key vs Preferable Attributes by Role“ (https://fmdossier.dev/guides/key-vs-preferable-attributes, aktualizace 1. 6. 2026): které atributy hra u role
         zvýrazňuje zeleně (klíčové) a modře (žádoucí);
     AM  AssMan.AI „Reading FM Attributes for Tactical Fit“ (https://assman.ai/guides/reading-fm-attributes, 1. 5. 2026): vlastní minima autora pro obránce a záložníky;
     DW  odhad autora této aplikace (původní tabulky DWRS v dwrs.js) tam, kde se zdroje k atributu nevyjadřují.
   Klíčové atributy se ve výpočtu počítají třikrát a žádoucí jednou (veřejně popsaný princip FM Dossier); ostatní atributy výsledek neovlivní. To je skupinový
   rozbor podle pozice místa, ne podle role: hra sama ukazuje klíčové atributy každé role v profilu hráče (zvýraznění řádků je automatické podle vybrané role a mění se podle fáze: s míčem zeleně a modře, bez míče růžově a fialově; ověřeno ve hře 7. 11. 2026), a to je
   spolehlivější než jakákoli tabulka. Zdroje se u pár atributů rozcházejí (u krajního obránce je Tackling a Positioning u jednoho klíčový, u druhého žádoucí):
   takové atributy jsou klíčové a u zdrojů je to poznamenané. ČÍSLA (váhy, prahy) jsou komunitní odhad, ne pravidlo FM27. Skryté údaje (CA, PA, osobnost) se nepoužívají. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./fm27cs.js'));
  else root.TrenerPosAttrs = factory(root.TrenerCore, root.TrenerFm27Cs);
})(typeof self !== 'undefined' ? self : this, function (core, CS) {
  'use strict';

  const VERSION = 'posattrs-1';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const plainKey = (s) => core.fold(String(s === null || s === undefined ? '' : s)).replace(/[^a-z0-9]/g, '');
  const attrKey = (s) => (CS ? CS.attrKey(s) : plainKey(s)); // české názvy atributů ze hry se převedou na kanonické anglické

  const SOURCES = Object.freeze({
    VG: { name: 'Vortex Gaming: FM26 Top 5 Key Attributes by Position', url: 'https://vortexgaming.io/en/postdetail/640375' },
    FD: { name: 'FM Dossier: Key vs Preferable Attributes by Role', url: 'https://fmdossier.dev/guides/key-vs-preferable-attributes' },
    AM: { name: 'AssMan.AI: Reading FM Attributes for Tactical Fit', url: 'https://assman.ai/guides/reading-fm-attributes' },
    DW: { name: 'Odhad autora aplikace (původní tabulky DWRS)', url: null },
  });

  const GROUP_CS = Object.freeze({ GK: 'brankář', CB: 'střední obránce', FB: 'krajní obránce a křídelní bek', DM: 'defenzivní záložník', CM: 'střední záložník', W: 'křídlo a krajní záložník', AM: 'ofenzivní záložník', ST: 'útočník' });
  const GROUPS = Object.freeze(Object.keys(GROUP_CS));

  // [atribut, zdroje]: klíčové (počítají se třikrát) a žádoucí (jednou)
  const RAW = {
    GK: {
      key: [['Aerial Reach', 'VG'], ['Agility', 'VG'], ['Handling', 'VG'], ['One On Ones', 'VG'], ['Reflexes', 'VG']],
      pref: [['Anticipation', 'VG'], ['Concentration', 'VG'], ['Command Of Area', 'DW'], ['Positioning', 'DW'], ['Decisions', 'DW'], ['Communication', 'DW']],
      note: 'Podle Vortex Gaming jsou nejdůležitější Aerial Reach a Agility; Handling, One On Ones a Reflexes hned za nimi; Anticipation a Concentration jsou důležité mentální atributy.',
    },
    CB: {
      key: [['Heading', 'VG+FD'], ['Marking', 'VG+FD'], ['Tackling', 'VG+FD'], ['Positioning', 'VG+FD'], ['Strength', 'VG+FD'], ['Jumping Reach', 'FD'], ['Acceleration', 'VG']],
      pref: [['Anticipation', 'FD'], ['Concentration', 'FD'], ['Bravery', 'VG'], ['Pace', 'VG'], ['Decisions', 'DW'], ['Composure', 'DW']],
      note: 'Heading, Marking a Tackling jsou podle obou zdrojů nezbytné; Acceleration je důležitější než Pace; Bravery zesiluje souboje a hlavičky.',
    },
    FB: {
      key: [['Acceleration', 'VG+FD'], ['Stamina', 'VG+FD'], ['Crossing', 'VG+FD'], ['Tackling', 'VG'], ['Positioning', 'VG']],
      pref: [['Pace', 'DW'], ['Work Rate', 'DW'], ['Marking', 'DW'], ['Dribbling', 'VG'], ['Anticipation', 'DW'], ['Teamwork', 'DW'], ['Decisions', 'DW'], ['Agility', 'DW'], ['Balance', 'DW']],
      note: 'Tackling, Positioning a Acceleration jsou podle Vortex Gaming důležité u každého krajního obránce; Crossing a Dribbling u útočícího, Positioning a Stamina u bránícího. FM Dossier má Tackling a Positioning jen jako žádoucí.',
    },
    DM: {
      key: [['Tackling', 'VG+AM'], ['Positioning', 'VG+AM'], ['Anticipation', 'AM'], ['Composure', 'VG'], ['Teamwork', 'VG'], ['Stamina', 'VG']],
      pref: [['Concentration', 'AM'], ['Passing', 'FD'], ['Decisions', 'FD'], ['Vision', 'FD'], ['First Touch', 'FD'], ['Technique', 'FD'], ['Work Rate', 'DW'], ['Marking', 'DW'], ['Strength', 'DW']],
      note: 'U bránícího defenzivního záložníka rozhoduje Tackling, Positioning, Teamwork, Stamina a Composure; u tvořícího (Deep-Lying Playmaker) jsou klíčové Passing, Vision, Technique, First Touch a Decisions.',
    },
    CM: {
      key: [['Passing', 'VG+FD'], ['Stamina', 'VG+FD'], ['Work Rate', 'FD'], ['Teamwork', 'VG'], ['First Touch', 'VG'], ['Composure', 'VG']],
      pref: [['Vision', 'VG'], ['Dribbling', 'VG'], ['Decisions', 'FD'], ['Off The Ball', 'FD'], ['Technique', 'DW'], ['Anticipation', 'DW'], ['Positioning', 'DW'], ['Tackling', 'DW']],
      note: 'Střední záložník potřebuje Passing a výdrž (Stamina, Work Rate) a Composure; Vision a Dribbling podle toho, jestli má tvořit hru.',
    },
    AM: {
      key: [['Vision', 'VG'], ['Passing', 'VG'], ['First Touch', 'VG'], ['Dribbling', 'VG']],
      pref: [['Technique', 'DW'], ['Decisions', 'DW'], ['Off The Ball', 'DW'], ['Composure', 'DW'], ['Flair', 'DW'], ['Finishing', 'VG'], ['Anticipation', 'DW'], ['Long Shots', 'DW'], ['Agility', 'DW']],
      note: 'Vision je podle Vortex Gaming nejdůležitější, Passing ji doplňuje; First Touch a Dribbling mají větší váhu než u středního záložníka. Finishing aspoň 10 až 12.',
    },
    W: {
      key: [['Acceleration', 'VG+FD'], ['Dribbling', 'VG+FD'], ['Agility', 'VG+FD'], ['Pace', 'VG'], ['Crossing', 'VG+FD']],
      pref: [['Finishing', 'VG+FD'], ['Positioning', 'VG'], ['Technique', 'FD'], ['Flair', 'FD'], ['Off The Ball', 'DW'], ['First Touch', 'DW'], ['Stamina', 'DW'], ['Work Rate', 'DW'], ['Balance', 'DW']],
      note: 'Acceleration, Dribbling a Agility rozhodují o schopnosti přejít obránce; Crossing nebo Finishing podle toho, jestli křídlo centruje, nebo míří dovnitř.',
    },
    ST: {
      key: [['Finishing', 'VG+FD'], ['Off The Ball', 'VG+FD'], ['Composure', 'VG+FD'], ['Acceleration', 'VG+FD'], ['Anticipation', 'FD'], ['Dribbling', 'VG'], ['Pace', 'VG']],
      pref: [['First Touch', 'DW'], ['Strength', 'DW'], ['Heading', 'FD'], ['Jumping Reach', 'FD'], ['Bravery', 'FD'], ['Technique', 'DW'], ['Decisions', 'DW'], ['Balance', 'DW'], ['Agility', 'DW']],
      note: 'Finishing a Off The Ball jsou nejdůležitější; Composure hlavně u mladých; Acceleration a Pace pro přechod obránců. U Target Forward jsou klíčové navíc Jumping Reach, Strength, Heading a Bravery.',
    },
  };

  const GROUP_DATA = {};
  for (const g of GROUPS) {
    const d = RAW[g];
    GROUP_DATA[g] = {
      group: g,
      cs: GROUP_CS[g],
      key: d.key.map(([attribute, src]) => ({ attribute, src })),
      pref: d.pref.map(([attribute, src]) => ({ attribute, src })),
      note: d.note,
    };
  }
  Object.freeze(GROUP_DATA);
  for (const g of GROUPS) {
    Object.freeze(GROUP_DATA[g]);
    Object.freeze(GROUP_DATA[g].key);
    Object.freeze(GROUP_DATA[g].pref);
    GROUP_DATA[g].key.forEach(Object.freeze);
    GROUP_DATA[g].pref.forEach(Object.freeze);
  }

  /** Základní atributy hráčů v poli, které podle Vortex Gaming nemají být pod 11 (komunitní odhad, ne pravidlo). */
  const UNIVERSAL_FLOOR = Object.freeze({ attributes: Object.freeze(['Passing', 'Decisions', 'Determination', 'Pace', 'Acceleration', 'Strength', 'Stamina']), min: 11, src: 'VG' });

  const WEIGHTS = Object.freeze({ key: 3, pref: 1 });

  /** Seznam atributů skupiny: klíčové a žádoucí s váhou. */
  function entriesOf(group, weights) {
    const d = GROUP_DATA[group];
    if (!d) return [];
    const w = Object.assign({}, WEIGHTS, isObj(weights) ? weights : {});
    return d.key.map((e) => ({ attribute: e.attribute, key: attrKey(e.attribute), level: 'key', weight: w.key, src: e.src })).concat(d.pref.map((e) => ({ attribute: e.attribute, key: attrKey(e.attribute), level: 'pref', weight: w.pref, src: e.src })));
  }

  /** keyNames(group, n) → názvy klíčových atributů (pro texty „hledej: …“). */
  function keyNames(group, n) {
    const d = GROUP_DATA[group];
    return d ? d.key.slice(0, Number.isInteger(n) && n > 0 ? n : d.key.length).map((e) => e.attribute) : [];
  }

  /** score(attrs, group, opts) → {score|null, partial|null, absolute, worst, best, missing[], contributions[], reason, group}.
      attrs je Map klíč atributu (malá písmena a číslice) → hodnota 1 až 20 (z dwrs.playerAttributes). Stupnice 0 až 100 mezi „všechny atributy 1“ a „všechny 20“
      při stejných vahách. Kompletní výsledek je jen tehdy, když hráč má všechny atributy skupiny; jinak je výsledek částečný s pokrytím váhy, nikdy ne nula. */
  function score(attrs, group, opts) {
    const empty = { score: null, partial: null, absolute: null, worst: null, best: null, missing: [], contributions: [], reason: '', group: group || null };
    if (!GROUP_DATA[group]) return Object.assign(empty, { reason: 'Neznámá skupina pozic.' });
    const map = attrs instanceof Map ? attrs : new Map();
    const entries = entriesOf(group, opts && opts.weights);
    const contributions = [];
    const missing = [];
    for (const e of entries) {
      const v = map.get(e.key);
      if (!isNum(v)) {
        missing.push(e.attribute);
        continue;
      }
      contributions.push({ attribute: e.attribute, level: e.level, weight: e.weight, value: v, points: e.weight * v, src: e.src });
    }
    const sum = (arr, f) => arr.reduce((t, c) => t + f(c), 0);
    const normalized = (list) => {
      const w = sum(list, (c) => c.weight);
      if (!(w > 0)) return null;
      const abs = sum(list, (c) => c.weight * c.value);
      return { abs, worst: w, best: 20 * w, score: r1(((abs - w) / (19 * w)) * 100) };
    };
    if (!missing.length) {
      const n = normalized(contributions);
      return { score: n.score, partial: null, absolute: n.abs, worst: n.worst, best: n.best, missing, contributions, reason: '', group };
    }
    const n = contributions.length ? normalized(contributions) : null;
    const usedW = sum(contributions, (c) => c.weight);
    const total = entries.reduce((t, e) => t + e.weight, 0);
    const partial = n ? { score: n.score, coverage: Math.round((usedW / total) * 100) / 100, used: contributions.length, total: entries.length } : null;
    return { score: null, partial, absolute: null, worst: null, best: null, missing, contributions, reason: `Hráči chybí atributy: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` a ${missing.length - 6} dalších` : ''}.`, group };
  }

  /** valueOf(result, allowPartial, minCoverage) → {value, partial}: úplný výsledek, nebo (jen na přání) částečný s dostatečným pokrytím. */
  function valueOf(result, allowPartial, minCoverage) {
    if (!result) return { value: null, partial: false };
    if (result.score !== null) return { value: result.score, partial: false };
    if (allowPartial && result.partial && result.partial.coverage >= (isNum(minCoverage) ? minCoverage : 0.8)) return { value: result.partial.score, partial: true };
    return { value: null, partial: false };
  }

  return { VERSION, SOURCES, GROUPS, GROUP_CS, GROUP_DATA, UNIVERSAL_FLOOR, WEIGHTS, attrKey, entriesOf, keyNames, score, valueOf };
});
