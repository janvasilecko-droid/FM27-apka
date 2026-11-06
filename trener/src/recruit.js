/* FM27 Tactical Coach: přestupový poradce (čistý modul bez DOM, sítě a AI).

   CO TO JE: kandidát na přestup je CIZÍ hráč, kterého zadal uživatel (ručně nebo z exportu tabulky). Modul ho umí zkontrolovat, přečíst z tabulky cenu a mzdu (jen když je v souboru čitelná),
   spočítat, jak by příchod změnil sestavu A + B (přesně, ne odhadem: znovu se najde nejlepší sestava s hráčem navíc, squadopt.js), seřadit kandidáty podle role nebo podle dopadu na celý tým,
   spočítat dopad odchodu vlastního hráče a vytvořit doporučení, u kterého se později zapíše skutečný výsledek.

   POCTIVOST (platí pro každé číslo odsud):
   - Vhodnost a dopad jsou DWRS nebo jednoduchý vážený průměr (ESTIMATED, heuristika této aplikace), ne pravidlo FM27. Vždy se píše podle jakého modelu vznikly.
   - Cena a mzda jsou JEN to, co zadal uživatel nebo co stálo v souboru. Chybí-li, je to „neznámé“ (null, UNKNOWN), nikdy se neodhadují a nikdy se nepočítají jako nula. Měna se nepřepočítává.
   - Chybí-li kandidátovi atribut, který role potřebuje, vhodnost je „nedostupná“ s důvodem; nikdy se nedopočítává. Skryté údaje hry (CA, PA, potenciál, osobnost, skryté atributy) se nikdy nečtou:
     modul nic netvrdí o budoucím růstu hráče.
   - Doporučení je návrh k rozhodnutí uživatele; nic se v soupisce ani v taktice nezmění samo. Úspěšnost doporučení je podle HODNOCENÍ uživatele, ne podle hry, a při malém počtu případů to modul říká.
   Čisté funkce: stejný vstup dá vždy stejný výstup, vstupy se nemění. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rolefit.js'), require('./dwrs.js'), require('./squadopt.js'), require('./tableimport.js'));
  else root.TrenerRecruit = factory(root.TrenerRoleFit, root.TrenerDwrs, root.TrenerSquadOpt, root.TrenerTableImport);
})(typeof self !== 'undefined' ? self : this, function (RF, DW, SO, TI) {
  'use strict';

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const cz = (v) => String(v).replace('.', ',');
  const signed = (v) => (v > 0 ? '+' : '') + cz(v);

  const STATUSES = Object.freeze(['watch', 'enquiry', 'offer', 'agreed', 'signed', 'rejected', 'dropped']);
  const STATUS_CS = Object.freeze({
    watch: 'sleduji',
    enquiry: 'zjišťuji podmínky',
    offer: 'nabídka podána',
    agreed: 'dohodnuto',
    signed: 'podepsáno',
    rejected: 'odmítnuto',
    dropped: 'už nezajímá',
  });
  const OPEN_STATUSES = Object.freeze(['watch', 'enquiry', 'offer', 'agreed']);
  const DECISIONS = Object.freeze(['signed', 'passed', 'lost']);
  const DECISION_CS = Object.freeze({ signed: 'koupeno', passed: 'nekoupeno (rozhodl jsem se nekoupit)', lost: 'nepodařilo se získat' });
  const VERDICTS = Object.freeze(['good', 'neutral', 'bad']);
  const VERDICT_CS = Object.freeze({ good: 'dopadlo dobře', neutral: 'bez většího vlivu', bad: 'dopadlo špatně' });
  const LIMITS = Object.freeze({
    nameMin: 2, nameMax: 60, ageMin: 14, ageMax: 50, maxPositions: 4, maxAttributes: 40, attrNameMax: 30, clubMax: 60, notesMax: 400, dealNoteMax: 200,
    contractMax: 24, currencyMax: 4, maxCandidates: 200, maxRecommendations: 300, resultNoteMax: 300, moneyMax: 1e10, maxRows: 50, minHitCases: 5,
  });
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const ID_RE = /^[A-Za-z0-9_.~:@+-]{1,64}$/;
  const HIDDEN_FIELDS = Object.freeze(['ca', 'pa', 'currentability', 'potentialability', 'potential', 'ability', 'personality', 'reputation']);

  // ---------------------------------------------------------------- texty ze souboru nebo od uživatele
  // řídicí znaky, oddělovače řádků, všechny formátovací znaky Unicode (nulová šířka, řízení směru písma včetně izolátů, měkký spojovník, značky) a všechny znaky, které se mají při zobrazení ignorovat (Default_Ignorable_Code_Point: výplně, selektory variant, neviditelné samohlásky), plus prázdné braillské písmeno a náhradní znak objektu; zapsáno přes RegExp, aby ve zdrojích nebyly doslovné znaky
  const CONTROL = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\ufffc]+', 'gu');
  /** Jednořádkový text bez řídicích a neviditelných znaků, oříznutý na n znaků. Převádí se jen text a konečné číslo; objekt, pole, funkce a podobně dají prázdný text (nikdy „[object Object]“). */
  function text(v, n) {
    const raw = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    const s = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n).trim() : s;
  }

  /** Datum ve tvaru RRRR-MM-DD, které opravdu existuje v kalendáři. */
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const year = Number(s.slice(0, 4));
    if (year < 1900 || year > 2200) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  const dayNumber = (s) => Math.floor(new Date(s + 'T00:00:00Z').getTime() / 86400000);

  // ---------------------------------------------------------------- peníze
  const CURRENCY_RE = /(€|£|\$|Kč|\bCZK\b|\bEUR\b|\bGBP\b|\bUSD\b)/i;
  const PER_WEEK_RE = /(\bp\/w\b|\/\s*w\b|\bper\s+week\b|\bweekly\b|týdně|\/\s*týden|\bza\s+týden|\/\s*week\b|\ba\s+week\b)/i;
  const PER_YEAR_RE = /(\bp\/a\b|\bper\s+annum\b|\byearly\b|\bannual(?:ly)?\b|ročně|\/\s*rok\b|\/\s*year\b|\ba\s+year\b)/i;
  const SUFFIX = { k: 1e3, tis: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6, b: 1e9, mld: 1e9, billion: 1e9 };

  /** parseMoney(text) → {value: číslo|null, currency: text, period: 'week'|'year'|null, issue: text}.
      Čte jen jednu čitelnou částku: „€12.5M“, „12,5 M €“, „£750K“, „12 500 000“, „35K p/w“. Rozsah („€25M - €30M“), slovo („neprodejný“), nejednoznačný zápis nebo nesmyslná hodnota dají value null
      a důvod v issue: částka se nikdy neodhaduje. Měna se jen zapíše, nepřepočítává se. */
  function parseMoney(raw) {
    const out = { value: null, currency: '', period: null, issue: '' };
    if (typeof raw === 'number') {
      if (Number.isFinite(raw) && raw >= 0 && raw <= LIMITS.moneyMax) out.value = Math.round(raw);
      else out.issue = 'Částka je mimo rozsah.';
      return out;
    }
    if (typeof raw !== 'string') return out; // jen text nebo číslo; objekt, pole a podobně je neznámé (nikdy se nepřevádí na text)
    const s0 = raw.replace(CONTROL, ' ').trim();
    if (!s0) return out;
    const cur = CURRENCY_RE.exec(s0);
    if (cur) out.currency = cur[1];
    out.period = PER_WEEK_RE.test(s0) ? 'week' : PER_YEAR_RE.test(s0) ? 'year' : null;
    let s = s0.replace(new RegExp(PER_WEEK_RE.source, 'gi'), ' ').replace(new RegExp(PER_YEAR_RE.source, 'gi'), ' ').replace(new RegExp(CURRENCY_RE.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    if (!/\d/.test(s)) return out; // slovo bez čísla („neprodejný“, „N/A“, „-“): neznámé bez hlášení
    if (/\d\s*(?:[kmb]|tis\.?|mil\.?|mld\.?)?\s*[-–—]\s*\d/i.test(s)) {
      out.issue = 'Rozsah cen se nepřebírá (částka není jedna).';
      return out;
    }
    const m = /^([0-9][0-9\s.,'’]*?)\s*(k|m|b|tis\.?|mil\.?|mld\.?|thousand|million|billion)?$/i.exec(s);
    if (!m) {
      out.issue = 'Částku nejde přečíst.';
      return out;
    }
    const suffix = m[2] ? m[2].toLowerCase().replace(/\.$/, '') : '';
    const body = m[1].trim();
    let num = null;
    if (suffix) {
      // zkratka: oddělovač je desetinný (tisíce se ve zkratce nepíšou); víc oddělovačů je nejednoznačné a mezera nebo apostrof uvnitř čísla ho Number() odmítne (NaN)
      const seps = body.match(/[.,]/g) || [];
      if (seps.length === 0) num = Number(body);
      else if (seps.length === 1 && /^\d+[.,]\d+$/.test(body)) num = Number(body.replace(',', '.'));
    } else if (/^\d+$/.test(body)) num = Number(body);
    else if (/^\d{1,3}([\s.,'’]\d{3})+$/.test(body) && new Set(body.match(/[\s.,'’]/g)).size === 1) num = Number(body.replace(/[\s.,'’]/g, ''));
    if (num === null || !Number.isFinite(num)) {
      out.issue = 'Zápis částky je nejednoznačný.';
      return out;
    }
    const value = Math.round(num * (suffix ? SUFFIX[suffix] : 1));
    if (!(value >= 0) || value > LIMITS.moneyMax) {
      out.issue = 'Částka je mimo rozsah.';
      return out;
    }
    out.value = value;
    return out;
  }

  // ---------------------------------------------------------------- kandidát
  const ageOf = (v) => {
    if (v === undefined || v === null || v === '') return { age: null, bad: false };
    const n = typeof v === 'number' ? v : /^\d{1,2}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
    return Number.isInteger(n) && n >= LIMITS.ageMin && n <= LIMITS.ageMax ? { age: n, bad: false } : { age: null, bad: true };
  };

  function positionsOf(v, issues) {
    const parts = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,/;]+/) : [];
    const out = [];
    for (const p of parts) {
      const code = text(p, 8).toUpperCase();
      if (!code) continue;
      if (!/^[A-Z]{1,4}$/.test(code)) {
        issues.push(`Pozice „${code.slice(0, 8)}“ není kód (1 až 4 písmena), nepřevzato.`);
        continue;
      }
      if (!out.includes(code)) out.push(code);
    }
    if (out.length > LIMITS.maxPositions) {
      issues.push(`Pozic je víc než ${LIMITS.maxPositions}, přebytek se zahodil.`);
      out.length = LIMITS.maxPositions;
    }
    return out;
  }

  function attributesOf(v, issues) {
    const out = {};
    if (!isObj(v)) return out;
    let hidden = 0;
    let bad = 0;
    let over = 0;
    for (const [k, val] of Object.entries(v)) {
      const key = text(k, LIMITS.attrNameMax);
      if (!key || FORBIDDEN_KEYS.has(key)) continue;
      if (TI && TI.isHiddenName && TI.isHiddenName(key)) {
        hidden++;
        continue;
      }
      const n = typeof val === 'number' ? val : typeof val === 'string' && /^\d{1,2}$/.test(val.trim()) ? Number(val.trim()) : NaN;
      if (!(Number.isInteger(n) && n >= 1 && n <= 20)) {
        bad++;
        continue;
      }
      if (Object.keys(out).length >= LIMITS.maxAttributes) {
        over++;
        continue;
      }
      out[key] = n;
    }
    if (hidden) issues.push(`Skryté údaje hry (${hidden}) se nepřebírají: trenér s nimi nepočítá.`);
    if (bad) issues.push(`Atributy mimo rozsah 1 až 20 nebo nečíselné (${bad}) se nepřevzaly.`);
    if (over) issues.push(`Atributů je víc než ${LIMITS.maxAttributes}, přebytek se zahodil.`);
    return out;
  }

  /** Částka ze zadání: mzda se čeká týdenní (roční se nepřepočítává, ale odmítne), cena nemá mít období. Cokoli sporného je „neznámé“ s důvodem. */
  function moneyField(raw, label, issues, kind) {
    if (raw === undefined || raw === null || raw === '') return { value: null, currency: '', period: null };
    const m = parseMoney(raw);
    if (m.issue) issues.push(`${label}: ${m.issue}`);
    else if (m.value !== null && kind === 'wage' && m.period === 'year') {
      issues.push('Mzda: je roční, aplikace čeká týdenní a nic nepřepočítává; nepřevzato.');
      return Object.assign({}, m, { value: null });
    } else if (m.value !== null && kind === 'price' && m.period) {
      issues.push('Cena: má uvedené období (týdně nebo ročně), to u ceny nedává smysl; nepřevzato.');
      return Object.assign({}, m, { value: null });
    }
    return m;
  }

  /** normalizeCandidate(raw, opts) → {ok, candidate, issues}. Neplatné jméno = nepřijato. Ostatní vadná pole se zahodí a je to napsané v issues (nic se neodhaduje).
      opts: {now (číslo, uloží se jako deal.at, když chybí)}. Pole s potenciálem, schopností nebo osobností (CA, PA, …) se nikdy nepřebírají. */
  function normalizeCandidate(raw, opts) {
    const o = isObj(opts) ? opts : {};
    if (!isObj(raw)) return { ok: false, candidate: null, issues: ['Kandidát není objekt.'] };
    const issues = [];
    const name = typeof raw.name === 'string' ? text(raw.name, LIMITS.nameMax) : '';
    if (name.length < LIMITS.nameMin) return { ok: false, candidate: null, issues: ['Jméno kandidáta chybí nebo je příliš krátké.'] };
    for (const k of Object.keys(raw)) if (HIDDEN_FIELDS.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) issues.push(`Pole „${text(k, 20)}“ je skrytý údaj hry a nepřebírá se.`);
    const a = ageOf(raw.age);
    if (a.bad) issues.push(`Věk musí být celé číslo ${LIMITS.ageMin} až ${LIMITS.ageMax}, nepřevzato.`);
    const price = moneyField(raw.price, 'Cena', issues, 'price');
    const wage = moneyField(raw.wage, 'Mzda', issues, 'wage');
    const currency = text(raw.currency, LIMITS.currencyMax) || price.currency || wage.currency || '';
    const rawOrigin = isObj(raw.origin) ? raw.origin : {};
    const rawDeal = isObj(raw.deal) ? raw.deal : {};
    let status = 'watch';
    if (rawDeal.status !== undefined) {
      if (STATUSES.includes(rawDeal.status)) status = rawDeal.status;
      else issues.push('Stav jednání není známý, platí „sleduji“.');
    }
    let validUntil = null;
    if (rawDeal.validUntil !== undefined && rawDeal.validUntil !== null && rawDeal.validUntil !== '') {
      if (isDate(rawDeal.validUntil)) validUntil = rawDeal.validUntil;
      else issues.push('Platnost jednání musí být datum RRRR-MM-DD, nepřevzato.');
    }
    const atRaw = isNum(rawDeal.at) ? rawDeal.at : isNum(o.now) ? o.now : null;
    const candidate = {
      id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : undefined,
      careerId: typeof raw.careerId === 'string' ? raw.careerId : null,
      name,
      age: a.age,
      positions: positionsOf(raw.positions, issues),
      attributes: attributesOf(raw.attributes, issues),
      club: text(raw.club, LIMITS.clubMax),
      price: price.value,
      wage: wage.value,
      currency,
      contractEnd: text(raw.contractEnd, LIMITS.contractMax),
      notes: text(raw.notes, LIMITS.notesMax),
      origin: {
        type: rawOrigin.type === 'table' ? 'table' : 'manual',
        fileName: typeof rawOrigin.fileName === 'string' && rawOrigin.fileName ? text(rawOrigin.fileName, 80) : null,
        at: isNum(rawOrigin.at) ? rawOrigin.at : null,
      },
      deal: { status, validUntil, note: text(rawDeal.note, LIMITS.dealNoteMax), at: atRaw },
    };
    if (candidate.id === undefined) delete candidate.id;
    return { ok: true, candidate, issues };
  }

  /** Kandidát jako hráč pro optimalizaci sestavy: id dostane předponu, aby se nikdy nesrazilo s hráčem soupisky. */
  function toPlayer(c) {
    return { id: 'cand:' + (c && c.id !== undefined ? c.id : 'new'), name: c.name, positions: (c.positions || []).slice(), attributes: Object.assign({}, c.attributes), age: c.age === undefined ? null : c.age, injured: false, candidate: true };
  }

  /** Stav jednání k danému datu ve hře (RRRR-MM-DD nebo null, když ho uživatel nezadal). Bez data ve hře se platnost NEHLÍDÁ a je to řečeno. */
  function dealState(c, gameDate) {
    const d = isObj(c) && isObj(c.deal) ? c.deal : { status: 'watch', validUntil: null };
    const status = STATUSES.includes(d.status) ? d.status : 'watch';
    const out = { status, label: STATUS_CS[status], open: OPEN_STATUSES.includes(status), validUntil: d.validUntil || null, expired: null, daysLeft: null, note: '' };
    if (!out.validUntil) return out;
    if (!isDate(gameDate)) {
      out.note = 'Platnost se nehlídá: není zadané dnešní datum ve hře.';
      return out;
    }
    out.daysLeft = dayNumber(out.validUntil) - dayNumber(gameDate);
    out.expired = out.daysLeft < 0;
    if (out.expired && out.open) out.note = `Platnost jednání skončila před ${-out.daysLeft} ${-out.daysLeft === 1 ? 'dnem' : 'dny'} (podle data ve hře, které zadal uživatel).`;
    return out;
  }

  // ---------------------------------------------------------------- z tabulky
  const EXTRA_ROLES = Object.freeze(['club', 'price', 'wage', 'contract']);
  const CANDIDATE_ROLES = Object.freeze(['ignore', 'name', 'positions', 'age', 'club', 'price', 'wage', 'contract', 'attribute']);
  const CANDIDATE_ROLE_LABEL = Object.freeze({
    ignore: 'Ignorovat', name: 'Jméno', positions: 'Pozice', age: 'Věk', club: 'Klub', price: 'Cena (jak je v souboru)', wage: 'Mzda (jak je v souboru)', contract: 'Konec smlouvy', attribute: 'Atribut (1 až 20)',
  });
  const SYN = {
    club: ['club', 'team', 'klub', 'tým', 'tym', 'current club'],
    price: ['price', 'asking price', 'value', 'transfer value', 'fee', 'cena', 'hodnota', 'market value'],
    wage: ['wage', 'wages', 'salary', 'wage p/w', 'weekly wage', 'mzda', 'plat'],
    contract: ['contract', 'contract expires', 'contract end', 'contract expiry', 'expires', 'smlouva', 'konec smlouvy'],
  };
  const normHeader = (h) => String(h === undefined || h === null ? '' : h).toLowerCase().replace(/[_\s]+/g, ' ').trim();

  /** suggestRoles(mapping) → nový seznam sloupců, kde dosud nepřiřazené sloupce dostanou návrh klub / cena / mzda / konec smlouvy podle názvu sloupce (každý význam nejvýš jednou). Jen návrh: uživatel ho potvrzuje. */
  function suggestRoles(mapping) {
    const out = (Array.isArray(mapping) ? mapping : []).map((c) => Object.assign({}, c));
    const taken = new Set(out.filter((c) => EXTRA_ROLES.includes(c.role)).map((c) => c.role));
    for (const role of EXTRA_ROLES) {
      if (taken.has(role)) continue;
      const hit = out.find((c) => c.role === 'ignore' && SYN[role].includes(normHeader(c.header)));
      if (hit) {
        hit.role = role;
        hit.reason = 'podle názvu sloupce';
        taken.add(role);
      }
    }
    return out;
  }

  /** candidatesFromTable(table, mapping, opts) → {candidates, issues, skipped}. Jméno, pozice, věk a atributy čte tableimport.js (rowsToPlayers: skryté údaje se nenačítají);
      klub, cenu, mzdu a konec smlouvy čte tenhle modul ze sloupců s odpovídajícím významem. opts: {existingNames, max, fileName, now}. */
  function candidatesFromTable(table, mapping, opts) {
    const o = isObj(opts) ? opts : {};
    const max = Number.isInteger(o.max) && o.max >= 0 ? Math.min(o.max, LIMITS.maxCandidates) : LIMITS.maxCandidates;
    const map = Array.isArray(mapping) ? mapping : [];
    if (!isObj(table) || !Array.isArray(table.rows)) return { candidates: [], issues: ['Tabulka není platná.'], skipped: { invalid: 0, duplicates: 0, noName: 0, overLimit: 0 } };
    const base = TI.rowsToPlayers(table, map, { max, existingNames: o.existingNames });
    const issues = base.issues.slice();
    const skipped = Object.assign({ invalid: 0 }, base.skipped);
    const col = (role) => map.find((m) => m.role === role);
    const nameCol = col('name');
    const extras = new Map();
    if (nameCol && table && Array.isArray(table.rows)) {
      for (const row of table.rows) {
        const nm = TI.cellText(row[nameCol.index]).toLowerCase();
        if (!extras.has(nm)) extras.set(nm, row);
      }
    }
    const candidates = [];
    const noteCounts = new Map(); // stejná poznámka se u stovek řádků neopakuje: vypíše se jednou s počtem
    for (const p of base.players) {
      const row = extras.get(String(p.name).toLowerCase()) || [];
      const cell = (role) => {
        const c = col(role);
        return c ? TI.cellText(row[c.index]) : '';
      };
      const n = normalizeCandidate({
        name: p.name, age: p.age, positions: p.positions, attributes: p.attributes, club: cell('club'), price: cell('price'), wage: cell('wage'), contractEnd: cell('contract'),
        notes: p.notes, origin: { type: 'table', fileName: o.fileName || null, at: isNum(o.now) ? o.now : null }, deal: { status: 'watch', at: isNum(o.now) ? o.now : null },
      });
      if (!n.ok) {
        skipped.invalid++;
        continue;
      }
      for (const i of n.issues) noteCounts.set(i, (noteCounts.get(i) || 0) + 1);
      candidates.push(n.candidate);
    }
    for (const [note, count] of noteCounts) issues.push(count > 1 ? `${note} (u ${count} hráčů)` : note);
    return { candidates, issues, skipped };
  }

  // ---------------------------------------------------------------- dopad příchodu a odchodu
  const idOf = (c) => 'cand:' + (c && c.id !== undefined ? c.id : 'new');
  const MODEL_NOTE = (res) => (res && res.model === 'dwrs' ? 'DWRS (odhad aplikace, ESTIMATED)' : 'jednoduchý vážený průměr (heuristika aplikace)');
  const squadOf = (input) => (isObj(input) && Array.isArray(input.players) ? input.players.filter(isObj) : []);
  const soOpts = (raw) => Object.assign({}, isObj(raw) ? raw : {}, { quick: true });

  function teamNums(diff, which) {
    const t = diff && diff[which];
    return t ? { before: t.totalBefore, after: t.totalAfter, delta: t.delta, filledBefore: t.filledBefore, filledAfter: t.filledAfter } : null;
  }

  /** arrival(input, opts, candidate, before?) → dopad příchodu: {ok, a, b, deltaA, deltaB, placements, others, issues, model}.
      input = {slots, players, profiles} jako u squadopt.optimize; before = už spočítaný výsledek bez kandidáta (pro hromadné hledání se počítá jednou). Nic se nemění. */
  function arrival(input, rawOpts, candidate, before) {
    if (!isObj(input) || !isObj(candidate)) return { ok: false, issues: ['Chybí vstup nebo kandidát.'] };
    const p = toPlayer(candidate);
    const players = squadOf(input);
    if (players.some((x) => x.id === p.id)) return { ok: false, issues: ['Kandidát už v soupisce je.'] };
    const o = soOpts(rawOpts);
    const base = before || SO.optimize(input, o);
    const after = SO.optimize(Object.assign({}, input, { players: players.concat([p]) }), o);
    const diff = SO.diffResults(base, after);
    const placements = diff.changes
      .filter((c) => c.to && c.to.id === p.id)
      .map((c) => ({ team: c.team, slotKey: c.slotKey, pos: c.pos, role: c.role, fit: c.to.fit, replaces: c.from ? { id: c.from.id, name: c.from.name, fit: c.from.fit } : null, fitDelta: c.delta }));
    const others = diff.changes.filter((c) => !(c.to && c.to.id === p.id));
    return {
      ok: true,
      candidateId: candidate.id,
      a: teamNums(diff, 'a'),
      b: teamNums(diff, 'b'),
      deltaA: diff.a ? diff.a.delta : null,
      deltaB: diff.b ? diff.b.delta : null,
      placements,
      others,
      issues: after.issues.filter((x) => !base.issues.includes(x)),
      model: MODEL_NOTE(after),
    };
  }

  /** departure(input, opts, playerId) → dopad odchodu vlastního hráče: {ok, player, a, b, deltaA, deltaB, changes, issues}. */
  function departure(input, rawOpts, playerId) {
    const who = squadOf(input).find((p) => p.id === playerId);
    if (!who) return { ok: false, issues: ['Hráč není v soupisce.'] };
    const sim = SO.simulateChange(input, rawOpts, { type: 'remove', playerId });
    if (!sim.ok) return sim;
    return {
      ok: true,
      player: { id: who.id, name: who.name },
      a: teamNums(sim.diff, 'a'),
      b: teamNums(sim.diff, 'b'),
      deltaA: sim.diff.a ? sim.diff.a.delta : null,
      deltaB: sim.diff.b ? sim.diff.b.delta : null,
      changes: sim.diff.changes,
      issues: sim.issues,
      model: MODEL_NOTE(sim.after),
    };
  }

  /** swap(input, opts, candidate, outPlayerId) → příchod kandidáta a zároveň odchod vlastního hráče (jedna změna sestavy). */
  function swap(input, rawOpts, candidate, outPlayerId) {
    const players = squadOf(input);
    const who = players.find((p) => p.id === outPlayerId);
    if (!who) return { ok: false, issues: ['Hráč není v soupisce.'] };
    if (!isObj(candidate)) return { ok: false, issues: ['Chybí kandidát.'] };
    const o = soOpts(rawOpts);
    const p = toPlayer(candidate);
    if (players.some((x) => x.id === p.id)) return { ok: false, issues: ['Kandidát už v soupisce je.'] };
    const base = SO.optimize(input, o);
    const after = SO.optimize(Object.assign({}, input, { players: players.filter((x) => x.id !== outPlayerId).concat([p]) }), o);
    const diff = SO.diffResults(base, after);
    return { ok: true, out: { id: who.id, name: who.name }, a: teamNums(diff, 'a'), b: teamNums(diff, 'b'), deltaA: diff.a ? diff.a.delta : null, deltaB: diff.b ? diff.b.delta : null, changes: diff.changes, issues: after.issues.filter((x) => !base.issues.includes(x)), model: MODEL_NOTE(after) };
  }

  /** similarCandidates(target, candidates, opts) → {ok, reason, group, rows, unknown}: kandidáti nejpodobnější hráči soupisky podle míry z squadopt.similarPlayers (vzdálenost v atributech vážených jako v DWRS pro skupinu pozic).
      opts: {group, wp, n (výchozí 5, nejvýš 50)}. rows: [{id, name, similarity, distance, candidate}]; kdo nemá všechny atributy s váhou, je v unknown a neřadí se. Cíl bez těchto atributů nebo bez skupiny pozic
      dá ok false s důvodem: nic se nehádá. CUSTOM MODEL: míra podobnosti je vlastní, ne údaj hry. */
  function similarCandidates(target, candidates, opts) {
    const o = isObj(opts) ? opts : {};
    if (!isObj(target)) return { ok: false, reason: 'Chybí hráč, ke kterému se hledají podobní.', group: null, rows: [], unknown: [] };
    const list = (Array.isArray(candidates) ? candidates : []).filter(isObj).slice(0, LIMITS.maxCandidates);
    const byId = new Map(list.map((c) => [idOf(c), c]));
    const n = Number.isInteger(o.n) && o.n > 0 ? Math.min(o.n, 50) : 5;
    const res = SO.similarPlayers(target, list.map(toPlayer), { group: o.group, wp: o.wp, n });
    return {
      ok: !!res.ok,
      reason: res.reason || '',
      group: res.group || null,
      rows: res.similar.map((x) => ({ id: byId.get(x.id).id, name: x.name, similarity: x.similarity, distance: x.distance, candidate: byId.get(x.id) })),
      unknown: res.unknown.map((x) => ({ id: byId.get(x.id).id, name: x.name })),
    };
  }

  /** needs(input, opts) → kde se hodí posila: neobsazená a slabá místa (z weakSpots) a tenká nebo chybějící hloubka (z optimize). Nic se nevymýšlí a neodhaduje. */
  function needs(input, rawOpts) {
    const o = Object.assign({}, isObj(rawOpts) ? rawOpts : {}, { quick: false });
    const res = SO.optimize(input, o);
    const out = [];
    for (const w of res.weak || []) out.push({ kind: w.kind, slotKey: w.slotKey, pos: w.pos, role: w.role, text: w.text, severity: w.kind === 'unfilled' ? 'high' : 'medium' });
    const placed = new Map(res.a.assignments.map((a) => [a.slotKey, a]));
    for (const d of res.depth || []) {
      if (d.coverage === 'covered') continue;
      const a = placed.get(d.slotKey);
      if (!a || !(a.player || (a.role && a.role.trim()))) continue;
      out.push({ kind: 'depth', slotKey: d.slotKey, pos: d.pos, role: d.role, text: `Hloubka ${d.pos} ${d.role || ''}: ${d.coverage === 'gap' ? 'nikdo se na místo nehodí' : 'hodí se jen jeden hráč'}.`.replace(/\s+/g, ' '), severity: d.coverage === 'gap' ? 'high' : 'medium' });
    }
    return { needs: out, model: MODEL_NOTE(res), issues: res.issues || [] };
  }

  // ---------------------------------------------------------------- hledání
  function cleanFilters(raw) {
    const f = isObj(raw) ? raw : {};
    const num = (v) => (isNum(v) && v >= 0 ? v : null);
    return {
      slotKey: f.slotKey === undefined || f.slotKey === null || f.slotKey === '' ? null : String(f.slotKey),
      minAge: Number.isInteger(f.minAge) ? f.minAge : null,
      maxAge: Number.isInteger(f.maxAge) ? f.maxAge : null,
      maxPrice: num(f.maxPrice),
      maxWage: num(f.maxWage),
      unknownAge: f.unknownAge === 'drop' ? 'drop' : 'keep',
      unknownPrice: f.unknownPrice === 'drop' ? 'drop' : 'keep',
      unknownWage: f.unknownWage === 'drop' ? 'drop' : 'keep',
      positions: Array.isArray(f.positions) ? f.positions.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : [],
      statuses: f.statuses === 'all' ? 'all' : Array.isArray(f.statuses) ? f.statuses.filter((x) => STATUSES.includes(x)) : OPEN_STATUSES.slice(),
      query: text(f.query, 60).toLowerCase(),
      excludeIds: Array.isArray(f.excludeIds) ? f.excludeIds : [],
      maxRows: Number.isInteger(f.maxRows) && f.maxRows > 0 ? f.maxRows : LIMITS.maxRows,
    };
  }

  /** Proč se kandidát nehodí do výběru (null = hodí). Neznámý věk, cena nebo mzda neznamená vyřazení, dokud to uživatel nechce (unknownAge, unknownPrice, unknownWage: 'drop'); kandidát se pak jen označí. */
  function filterReason(c, f) {
    if (f.statuses !== 'all' && !f.statuses.includes(c.deal && c.deal.status)) return 'status';
    if (f.excludeIds.includes(c.id)) return 'excluded';
    if (f.query && !String(c.name).toLowerCase().includes(f.query)) return 'query';
    if (f.minAge !== null || f.maxAge !== null) {
      if (c.age === null || c.age === undefined) {
        if (f.unknownAge === 'drop') return 'age';
      } else if ((f.minAge !== null && c.age < f.minAge) || (f.maxAge !== null && c.age > f.maxAge)) return 'age';
    }
    if (f.positions.length && (c.positions || []).length && !c.positions.some((x) => f.positions.includes(x))) return 'position';
    if (f.maxPrice !== null) {
      if (c.price === null || c.price === undefined) {
        if (f.unknownPrice === 'drop') return 'price';
      } else if (c.price > f.maxPrice) return 'price';
    }
    if (f.maxWage !== null) {
      if (c.wage === null || c.wage === undefined) {
        if (f.unknownWage === 'drop') return 'wage';
      } else if (c.wage > f.maxWage) return 'wage';
    }
    return null;
  }

  const FLAG_TEXT = {
    price: 'cena neznámá (UNKNOWN)',
    wage: 'mzda neznámá (UNKNOWN)',
    age: 'věk neuveden',
    positions: 'pozice neuvedena',
  };

  /** search(input, opts, candidates, filters) → {rows, total, skipped, model, issues}. Pro každého kandidáta: nejlepší vhodnost na místo, dopad příchodu na A a B, příznaky neznámých údajů.
      filters.slotKey: hledá se jen na jedno místo (řazení podle vhodnosti na roli a rozdílu proti současnému hráči); jinak se řadí podle dopadu na celý tým (součet A, potom B).
      Kandidát, kterého nejde ohodnotit (chybí atribut, místo nemá roli, nemá pozici), je na konci s důvodem, nikdy s nulou. */
  function search(input, rawOpts, candidates, rawFilters) {
    const f = cleanFilters(rawFilters);
    const o = soOpts(rawOpts);
    const list = (Array.isArray(candidates) ? candidates : []).filter(isObj).slice(0, LIMITS.maxCandidates);
    const skipped = { status: 0, excluded: 0, query: 0, age: 0, position: 0, price: 0, wage: 0 };
    const base = SO.optimize(input, o);
    const slotInfo = f.slotKey !== null ? base.a.assignments.find((a) => String(a.slotKey) === f.slotKey) || null : null;
    const issues = base.issues.slice();
    if (f.slotKey !== null && !slotInfo) issues.push(`Místo „${f.slotKey}“ v taktice není.`);
    const rows = [];
    for (const c of list) {
      const why = filterReason(c, f);
      if (why) {
        skipped[why]++;
        continue;
      }
      const imp = arrival(input, o, c, base);
      const id = idOf(c);
      const withCand = Object.assign({}, input, { players: squadOf(input).concat([toPlayer(c)]) });
      const fits = SO.playerSlotFits(withCand, o, id);
      const valued = fits.filter((x) => x.fit !== null);
      const best = valued.slice().sort((x, y) => y.fit - x.fit || (String(x.slotKey) < String(y.slotKey) ? -1 : 1))[0] || null;
      const flags = [];
      if (c.price === null || c.price === undefined) flags.push(FLAG_TEXT.price);
      if (c.wage === null || c.wage === undefined) flags.push(FLAG_TEXT.wage);
      if (c.age === null || c.age === undefined) flags.push(FLAG_TEXT.age);
      if (!(c.positions || []).length) flags.push(FLAG_TEXT.positions);
      if (valued.some((x) => x.partial)) flags.push('část atributů chybí (částečný výpočet)');
      const row = { id: c.id, name: c.name, candidate: c, impact: imp.ok ? imp : null, bestFit: best ? best.fit : null, bestSlot: best ? { slotKey: best.slotKey, pos: best.pos, role: best.role } : null, slot: null, known: !!best, flags, reasons: [] };
      if (!best) {
        const why1 = fits.map((x) => x.reason).filter(Boolean);
        row.reasons = [...new Set(why1)].slice(0, 4);
        if (!row.reasons.length) row.reasons = ['Žádné místo taktiky nemá roli s profilem, takže se nemá s čím porovnat.'];
      }
      if (slotInfo) {
        const mine = fits.find((x) => String(x.slotKey) === f.slotKey) || null;
        const currentFit = slotInfo.fit !== undefined ? slotInfo.fit : null;
        row.slot = {
          slotKey: slotInfo.slotKey, pos: slotInfo.pos, role: slotInfo.role,
          fit: mine ? mine.fit : null,
          reason: mine ? mine.reason || '' : '',
          current: slotInfo.player ? { id: slotInfo.player.id, name: slotInfo.player.name, fit: currentFit } : null,
          fitDelta: mine && mine.fit !== null && currentFit !== null && slotInfo.player ? r1(mine.fit - currentFit) : null,
        };
      }
      rows.push(row);
    }
    const key = (r) => (f.slotKey !== null ? (r.slot && r.slot.fit !== null ? r.slot.fit : null) : r.impact && r.known ? r.impact.deltaA : null);
    rows.sort((x, y) => {
      const kx = key(x);
      const ky = key(y);
      if ((kx === null) !== (ky === null)) return kx === null ? 1 : -1;
      if (kx !== ky) return ky - kx;
      const ax = x.impact && x.known ? x.impact.deltaA : null;
      const ay = y.impact && y.known ? y.impact.deltaA : null;
      if ((ax === null) !== (ay === null)) return ax === null ? 1 : -1;
      if (ax !== ay) return ay - ax;
      const bx = x.impact && x.known ? x.impact.deltaB : null;
      const by = y.impact && y.known ? y.impact.deltaB : null;
      if ((bx === null) !== (by === null)) return bx === null ? 1 : -1;
      if (bx !== by) return by - bx;
      if ((x.bestFit === null) !== (y.bestFit === null)) return x.bestFit === null ? 1 : -1;
      if (x.bestFit !== y.bestFit) return y.bestFit - x.bestFit;
      return String(x.name).localeCompare(String(y.name), 'cs') || String(x.id).localeCompare(String(y.id));
    });
    const total = rows.length;
    return { rows: rows.slice(0, f.maxRows), total, shown: Math.min(total, f.maxRows), skipped, model: MODEL_NOTE(base), issues, filters: f };
  }

  // ---------------------------------------------------------------- vysvětlení
  /** describeChange(res) → řádky o odchodu nebo výměně (výsledek departure nebo swap): součty A a B před a po a změny po místech (kdo kam, s vhodností). */
  function describeChange(res) {
    if (!isObj(res) || !res.ok) return [];
    const lines = [];
    if (res.a) lines.push(`Součet A ${cz(res.a.before)} → ${cz(res.a.after)} (${signed(res.deltaA)})${res.b ? `; součet B ${cz(res.b.before)} → ${cz(res.b.after)} (${signed(res.deltaB)})` : ''}.`);
    const fitOf = (x) => (x && x.fit !== null && x.fit !== undefined ? ` (${cz(x.fit)})` : '');
    for (const c of res.changes || []) {
      lines.push(`${c.team === 'A' ? 'Základní sestava' : 'Lavička B'}, ${c.pos}${c.role ? ' ' + c.role : ''}: ${c.from ? c.from.name + fitOf(c.from) : 'nikdo'} → ${c.to ? c.to.name + fitOf(c.to) : 'nikdo'}.`);
    }
    if (!(res.changes || []).length) lines.push('Sestava A ani B se nezmění.');
    return lines;
  }

  const moneyText = (v, cur) => `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${cur ? ' ' + cur : ''}`;

  /** explain(row) → řádky vysvětlení pro obrazovku a pro doporučení: čísla jsou ta, ze kterých se řadilo, a každé má původ. */
  function explain(row) {
    const lines = [];
    if (!isObj(row)) return lines;
    const c = row.candidate || {};
    const imp = row.impact;
    if (row.slot && row.slot.fit !== null) {
      const cur = row.slot.current;
      lines.push(`Na místě ${row.slot.pos}${row.slot.role ? ' (' + row.slot.role + ')' : ''} má vhodnost ${cz(row.slot.fit)}${cur ? `; nyní tam hraje ${cur.name}${cur.fit !== null ? ' s vhodností ' + cz(cur.fit) : ''}${row.slot.fitDelta !== null ? ` (rozdíl ${signed(row.slot.fitDelta)})` : ''}` : '; místo je dosud neobsazené'}.`);
    } else if (row.bestSlot) lines.push(`Nejlépe se hodí na místo ${row.bestSlot.pos}${row.bestSlot.role ? ' (' + row.bestSlot.role + ')' : ''} s vhodností ${cz(row.bestFit)}.`);
    if (row.known && imp && imp.ok) {
      if (imp.placements.length) {
        const pl = imp.placements.map((p) => `${p.team === 'A' ? 'základní sestava' : 'lavička B'}, ${p.pos}${p.role ? ' ' + p.role : ''}${p.replaces ? ` místo ${p.replaces.name}` : ' (dosud neobsazeno)'}`).join('; ');
        lines.push(`Po příchodu by hrál: ${pl}.`);
      } else lines.push('Po příchodu by se nevešel ani do základní sestavy, ani na lavičku B.');
      if (imp.a) lines.push(`Součet A ${cz(imp.a.before)} → ${cz(imp.a.after)} (${signed(imp.deltaA)})${imp.b ? `; součet B ${cz(imp.b.before)} → ${cz(imp.b.after)} (${signed(imp.deltaB)})` : ''}.`);
    } else if (!row.known) lines.push('Vhodnost nejde spočítat: ' + (row.reasons.join(' ') || 'chybí údaje') + ' Nic se nedopočítává.');
    lines.push(`Cena: ${c.price !== null && c.price !== undefined ? moneyText(c.price, c.currency) + ' (zadal uživatel nebo je v souboru)' : 'neznámá (UNKNOWN), neodhaduje se'}; mzda: ${c.wage !== null && c.wage !== undefined ? moneyText(c.wage, c.currency) + ' (zadal uživatel nebo je v souboru)' : 'neznámá (UNKNOWN), neodhaduje se'}.`);
    lines.push('Potenciál a další skryté údaje hry se nepoužívají: o budoucím růstu hráče aplikace nic netvrdí.');
    return lines;
  }

  // ---------------------------------------------------------------- doporučení a jejich výsledky
  /** buildRecommendation(row, ctx) → záznam doporučení k uložení. ctx: {careerId, now, modelNote}. Výsledek (result) je null, dokud ho uživatel nezapíše. */
  function buildRecommendation(row, ctx) {
    const c = isObj(ctx) ? ctx : {};
    if (!isObj(row) || !isObj(row.candidate) || row.candidate.id === undefined) return { ok: false, issues: ['Doporučení potřebuje uloženého kandidáta.'] };
    const cand = row.candidate;
    const imp = row.impact && row.impact.ok ? row.impact : null;
    const placed = imp && imp.placements.length ? imp.placements[0] : null;
    const rec = {
      careerId: typeof c.careerId === 'string' ? c.careerId : null,
      kind: 'transfer',
      at: isNum(c.now) ? c.now : null,
      candidateId: cand.id,
      candidateName: text(cand.name, LIMITS.nameMax),
      snapshot: { age: cand.age === undefined ? null : cand.age, positions: (cand.positions || []).slice(), club: cand.club || '', price: cand.price === undefined ? null : cand.price, wage: cand.wage === undefined ? null : cand.wage, currency: cand.currency || '' },
      slot: row.slot ? { slotKey: String(row.slot.slotKey), pos: row.slot.pos, role: row.slot.role } : placed ? { slotKey: String(placed.slotKey), pos: placed.pos, role: placed.role } : null,
      model: text(c.modelNote || (imp ? imp.model : ''), 120),
      evidence: explain(row).slice(0, 8).map((x) => text(x, 400)),
      expected: { deltaA: imp ? imp.deltaA : null, deltaB: imp ? imp.deltaB : null, fit: row.slot && row.slot.fit !== null ? row.slot.fit : row.bestFit },
      result: null,
    };
    return { ok: true, recommendation: rec, issues: [] };
  }

  /** setResult(rec, outcome) → {ok, recommendation, issues}: zapíše skutečný výsledek. outcome: {decision, verdict|null, note, at}. Rozhodnutí „koupeno“ a hodnocení jsou slova uživatele, ne údaj hry. */
  function setResult(rec, outcome) {
    if (!isObj(rec)) return { ok: false, issues: ['Chybí doporučení.'] };
    const o = isObj(outcome) ? outcome : {};
    if (!DECISIONS.includes(o.decision)) return { ok: false, issues: ['Rozhodnutí musí být koupeno, nekoupeno nebo nepodařilo se získat.'] };
    if (o.verdict !== undefined && o.verdict !== null && !VERDICTS.includes(o.verdict)) return { ok: false, issues: ['Hodnocení musí být dopadlo dobře, bez většího vlivu nebo dopadlo špatně.'] };
    if (o.verdict && o.decision !== 'signed') return { ok: false, issues: ['Hodnotit výsledek jde jen u koupeného hráče.'] };
    const result = { decision: o.decision, verdict: o.verdict || null, note: text(o.note, LIMITS.resultNoteMax), at: isNum(o.at) ? o.at : null };
    return { ok: true, recommendation: Object.assign({}, rec, { result }), issues: [] };
  }

  /** recommendationStats(list) → počty a podíl dobrých výsledků. Podíl je podle HODNOCENÍ uživatele a bere se jen z hodnocených koupených hráčů; pod minHitCases případů se výslovně říká, že nic nedokazuje. */
  function recommendationStats(list) {
    const recs = (Array.isArray(list) ? list : []).filter(isObj);
    const out = { total: recs.length, open: 0, signed: 0, passed: 0, lost: 0, rated: 0, good: 0, neutral: 0, bad: 0, hitRate: null, note: '' };
    for (const r of recs) {
      if (!isObj(r.result)) {
        out.open++;
        continue;
      }
      if (DECISIONS.includes(r.result.decision)) out[r.result.decision]++;
      if (r.result.decision === 'signed' && VERDICTS.includes(r.result.verdict)) {
        out.rated++;
        out[r.result.verdict]++;
      }
    }
    if (out.rated > 0) out.hitRate = Math.round((out.good / out.rated) * 1000) / 10;
    out.note = out.rated === 0
      ? 'Zatím není žádný koupený hráč s tvým hodnocením, úspěšnost nejde spočítat.'
      : out.rated < LIMITS.minHitCases
        ? `Hodnocených případů je jen ${out.rated}: úspěšnost ${cz(out.hitRate)} % je podle tvého hodnocení a při tak malém počtu nic nedokazuje.`
        : `Podle tvého hodnocení dopadlo dobře ${out.good} z ${out.rated} koupených hráčů (${cz(out.hitRate)} %). Je to tvoje hodnocení, ne údaj hry.`;
    return out;
  }

  return {
    STATUSES, STATUS_CS, OPEN_STATUSES, DECISIONS, DECISION_CS, VERDICTS, VERDICT_CS, LIMITS, CANDIDATE_ROLES, CANDIDATE_ROLE_LABEL, EXTRA_ROLES,
    text, isDate, parseMoney, normalizeCandidate, toPlayer, dealState, suggestRoles, candidatesFromTable,
    arrival, departure, swap, similarCandidates, needs, search, explain, describeChange, buildRecommendation, setResult, recommendationStats,
  };
});
