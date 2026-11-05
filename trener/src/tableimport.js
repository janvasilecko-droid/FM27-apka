/* FM27 Tactical Coach: načtení tabulky z exportu nástroje (čistý modul bez DOM, bez sítě a bez AI).
   Nástroje kolem hry (čtečky uložené hry, editory, zásuvné moduly) umějí uložit tabulku hráčů do souboru: CSV, TSV, webovou stránku (HTML)
   nebo JSON. Takový soubor je přesnější než čtení snímku obrazovky a nestojí žádné volání AI. Přesné sloupce cizích nástrojů aplikace
   zná jen u čtečky `fmsave` (podle její dokumentace; názvy jako `attributes_finishing`, `name`, `age`), u ostatních NEHÁDÁ: najde tabulku
   v jakémkoli HTML, CSV, TSV, textu s oddělovači nebo JSON, navrhne, který sloupec je jméno, pozice, věk a které jsou atributy, a uživatel
   návrh před načtením potvrdí a může ho změnit.
   Co se načte, je „zadal uživatel“ (soubor od něj), ne „ověřeno hrou“. Atributy se berou jen jako čísla 1 až 20. Skryté údaje hry
   (CA a PA, skryté atributy jako Consistency nebo Injury Proneness, osobnost) se NEČTOU: trenér s nimi nepočítá a o skrytých mechanikách FM27 nic netvrdí.
   Pozice ve tvaru „D (RLC)“ se nepřevádějí (aplikace by hádala význam), uloží se jako text do poznámky. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerTableImport = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_ROWS = 400;
  const MAX_COLS = 80;
  const MAX_CELL = 200;
  const ROLES = Object.freeze(['ignore', 'name', 'positions', 'age', 'role', 'duty', 'injured', 'attribute']);
  const ROLE_LABEL = Object.freeze({ ignore: 'Ignorovat', name: 'Jméno', positions: 'Pozice', age: 'Věk', role: 'Role', duty: 'Povinnost', injured: 'Zraněný', attribute: 'Atribut (1 až 20)' });

  const isInt = (s) => /^\d{1,3}$/.test(String(s).trim());
  const norm = (s) => core.fold(String(s === null || s === undefined ? '' : s)).replace(/[^a-z0-9#]+/g, ' ').trim();

  // ---------------------------------------------------------------- bajty → text
  /** Soubor z Windows bývá UTF-8 (s BOM nebo bez), UTF-16 (s BOM) nebo stará česká znaková sada. Bez nutnosti hádat podle jazyka:
      BOM rozhodne, jinak se zkusí přísné UTF-8 a teprve když selže, windows-1250. */
  function decodeBytes(input) {
    let u8;
    if (input instanceof Uint8Array) u8 = input;
    else if (input instanceof ArrayBuffer) u8 = new Uint8Array(input);
    else return { ok: false, error: 'Soubor se nepodařilo přečíst.' };
    if (!u8.length) return { ok: false, error: 'Soubor je prázdný.' };
    if (u8.length > MAX_BYTES) return { ok: false, error: `Soubor je větší než ${MAX_BYTES / 1048576} MB, na tabulku z hry je to moc.` };
    const dec = (label, fatal) => new TextDecoder(label, { fatal: !!fatal }).decode(u8);
    try {
      if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return { ok: true, text: dec('utf-16le').replace(/^﻿/, ''), encoding: 'UTF-16' };
      if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return { ok: true, text: dec('utf-16be').replace(/^﻿/, ''), encoding: 'UTF-16' };
      if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { ok: true, text: dec('utf-8').replace(/^﻿/, ''), encoding: 'UTF-8' };
      try {
        return { ok: true, text: dec('utf-8', true), encoding: 'UTF-8' };
      } catch (e) {
        return { ok: true, text: dec('windows-1250'), encoding: 'windows-1250' };
      }
    } catch (e) {
      return { ok: false, error: 'Kódování souboru se nepodařilo přečíst.' };
    }
  }

  // ---------------------------------------------------------------- HTML tabulky
  const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function cellText(html) {
    let t = String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
    t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITY[e.toLowerCase()] !== undefined ? ENTITY[e.toLowerCase()] : m;
    });
    t = t.replace(/[<>]/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > MAX_CELL ? t.slice(0, MAX_CELL) : t;
  }

  /** Všechny tabulky v HTML jako pole řádků po buňkách. Skripty, styly a komentáře se vyhodí; vnořené tabulky se nerozebírají. */
  function parseHtmlTables(html) {
    const clean = String(html || '')
      .replace(/<!\-\-[\s\S]*?\-\->/g, ' ') // zápis s rozděleným začátkem komentáře: doslovný začátek by v bloku skriptu ukončil stránku
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
    const tables = [];
    for (const t of clean.match(/<table\b[\s\S]*?<\/table\s*>/gi) || []) {
      const rows = [];
      for (const tr of t.match(/<tr\b[\s\S]*?<\/tr\s*>/gi) || []) {
        const cells = [];
        const re = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
        let m;
        while ((m = re.exec(tr))) cells.push(cellText(m[2]));
        if (cells.some(Boolean)) rows.push(cells.slice(0, MAX_COLS));
        if (rows.length >= MAX_ROWS + 1) break;
      }
      if (rows.length) tables.push(rows);
    }
    return tables;
  }

  // ---------------------------------------------------------------- CSV, TSV, text
  const DELIMS = ['\t', ';', '|', ','];

  function splitRecords(text, delim) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const n = text.length;
    for (let i = 0; i < n; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += c;
        continue;
      }
      if (c === '"' && !cell.trim()) {
        quoted = true;
        cell = '';
      } else if (c === delim) {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
      if (rows.length > MAX_ROWS + 5) break;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  /** Oddělovač se pozná podle toho, kolik sloupců mají řádky souvisle: vyhrává ten, který dává nejvíc řádků se stejným počtem (aspoň 2 sloupce). */
  function detectDelimiter(text) {
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 30);
    let best = null;
    for (const d of DELIMS) {
      const counts = lines.map((l) => l.split(d).length - 1);
      const freq = new Map();
      for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) || 0) + 1);
      for (const [c, k] of freq) {
        const score = k * 1000 + c;
        if (k >= 2 && (!best || score > best.score)) best = { d, score, columns: c + 1 };
      }
    }
    return best ? best.d : null;
  }

  /** Text bez zjevného oddělovače, ale se sloupci oddělenými aspoň dvěma mezerami (zarovnaný textový výpis). */
  function splitSpaced(text) {
    return text
      .split(/\r\n|\n|\r/)
      .filter((l) => l.trim())
      .slice(0, MAX_ROWS + 5)
      .map((l) => l.trim().split(/\s{2,}/).slice(0, MAX_COLS));
  }

  function parseDelimited(text) {
    const t = String(text || '').replace(/^﻿/, '');
    const d = detectDelimiter(t);
    if (d) return { rows: splitRecords(t, d).map((r) => r.map((c) => c.trim().slice(0, MAX_CELL)).slice(0, MAX_COLS)), kind: { '\t': 'tsv', ';': 'csv-strednik', '|': 'svislitka', ',': 'csv' }[d] };
    const spaced = splitSpaced(t);
    const wide = spaced.filter((r) => r.length >= 3).length;
    if (wide >= 3) return { rows: spaced, kind: 'zarovnany-text' };
    return { rows: [], kind: 'nic' };
  }

  // ---------------------------------------------------------------- JSON a JSON Lines
  const RECORD_KEYS = ['players', 'squad', 'rows', 'items', 'records', 'data', 'results', 'finances'];

  /** Vnořené skupiny se rozbalí na `skupina_pole` (jako dělá `fmsave` při exportu do CSV); pole prostých hodnot se spojí středníky,
      cokoli složitějšího se zapíše jako zkrácený text JSON. Hloubka nejvýš 2, ať nic neroste do nekonečna. */
  function flattenRecord(obj, prefix, depth, out) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix + k;
      if (v === null || v === undefined) out[key] = '';
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = String(v);
      else if (Array.isArray(v)) out[key] = v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? v.join(';') : JSON.stringify(v).slice(0, MAX_CELL);
      else if (typeof v === 'object') {
        if (depth < 2) flattenRecord(v, key + '_', depth + 1, out);
        else out[key] = JSON.stringify(v).slice(0, MAX_CELL);
      }
    }
    return out;
  }

  function findRecords(value, depth) {
    if (Array.isArray(value)) return value.length && value.every((x) => x && typeof x === 'object' && !Array.isArray(x)) ? value : null;
    if (!value || typeof value !== 'object' || depth > 2) return null;
    for (const k of RECORD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        const r = findRecords(value[k], depth + 1);
        if (r) return r;
      }
    }
    for (const v of Object.values(value)) {
      const r = findRecords(v, depth + 1);
      if (r) return r;
    }
    return null;
  }

  /** JSON (pole objektů, nebo objekt s polem záznamů) nebo JSON Lines (jeden objekt na řádek) → řádky tabulky; jinak null. */
  function parseJsonRows(text) {
    const t = String(text || '').trim();
    if (!/^[\[{]/.test(t)) return null;
    let records = null;
    let kind = 'json';
    try {
      records = findRecords(JSON.parse(t), 0);
    } catch (e) {
      const parsed = [];
      for (const line of t.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o && typeof o === 'object' && !Array.isArray(o)) parsed.push(o);
          else return null;
        } catch (e2) {
          return null;
        }
        if (parsed.length > MAX_ROWS) break;
      }
      records = parsed.length ? parsed : null;
      kind = 'jsonl';
    }
    if (!records) return null;
    const flat = records.slice(0, MAX_ROWS).map((r) => flattenRecord(r, '', 0, {}));
    const headers = [];
    const seen = new Set();
    for (const r of flat) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k) && headers.length < MAX_COLS) {
          seen.add(k);
          headers.push(k);
        }
      }
    }
    if (!headers.length) return null;
    return { kind, headers, rows: flat.map((r) => headers.map((h) => String(r[h] === undefined ? '' : r[h]).slice(0, MAX_CELL))) };
  }

  // ---------------------------------------------------------------- tabulka z jakéhokoli souboru
  /** extractTable(text) → {ok, kind, headers, rows, headerless, columns} nebo {ok:false, error}. Hlavička je první řádek, který nejsou čísla
      (u JSON jsou hlavičkou názvy polí). */
  function extractTable(text) {
    const raw = String(text || '');
    const json = parseJsonRows(raw);
    if (json) {
      if (json.rows.length < 1) return { ok: false, error: 'V souboru JSON nejsou žádné záznamy.' };
      return { ok: true, kind: json.kind, headers: json.headers, rows: json.rows, headerless: false, columns: json.headers.length };
    }
    let rows = [];
    let kind = 'nic';
    if (/<table\b/i.test(raw)) {
      const tables = parseHtmlTables(raw).filter((t) => t.length >= 2);
      tables.sort((a, b) => b.length * Math.max(...b.map((r) => r.length)) - a.length * Math.max(...a.map((r) => r.length)));
      if (tables.length) {
        rows = tables[0];
        kind = 'html';
      }
    }
    if (!rows.length) {
      const p = parseDelimited(raw);
      rows = p.rows;
      kind = p.kind;
    }
    rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (rows.length < 2) return { ok: false, error: 'V souboru jsem nenašel tabulku (aspoň hlavičku a jeden řádek). Zkus uložit pohled z hry jako webovou stránku, CSV nebo text.' };
    const columns = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
    rows = rows.map((r) => Array.from({ length: columns }, (_, i) => (r[i] === undefined ? '' : String(r[i]))));
    // hlavička: první řádek (z prvních pěti), kde je většina neprázdných buněk text a ne číslo
    let headerIndex = -1;
    for (let i = 0; i < Math.min(5, rows.length - 1); i++) {
      const filled = rows[i].filter((c) => c.trim());
      if (filled.length >= 2 && filled.filter((c) => !/^[\d.,\s%+-]+$/.test(c)).length / filled.length >= 0.8) {
        headerIndex = i;
        break;
      }
    }
    const headerless = headerIndex < 0;
    const headers = headerless ? Array.from({ length: columns }, (_, i) => `Sloupec ${i + 1}`) : rows[headerIndex].map((c, i) => c.trim() || `Sloupec ${i + 1}`);
    const data = rows.slice(headerless ? 0 : headerIndex + 1).slice(0, MAX_ROWS);
    if (!data.length) return { ok: false, error: 'Tabulka nemá žádné řádky s daty.' };
    return { ok: true, kind, headers, rows: data, headerless, columns };
  }

  // ---------------------------------------------------------------- návrh významu sloupců
  const SYN = {
    name: ['name', 'player', 'player name', 'full name', 'jmeno', 'hrac', 'jmeno hrace', 'nazev', 'nom', 'nombre'],
    positions: ['position', 'positions', 'pos', 'pozice', 'poz'],
    age: ['age', 'vek'],
    role: ['role', 'rola'],
    duty: ['duty', 'povinnost'],
    injured: ['injury', 'injured', 'inj', 'zraneni', 'zranen', 'zraneny'],
  };
  // Čísla 1 až 20, která atributy nejsou (zápasy, góly, číslo dresu, hodnocení). Zkratky CA a PA hra běžně neukazuje a aplikace o nich nic netvrdí.
  const NOT_ATTRIBUTE = new Set(['apps', 'appearances', 'app', 'goals', 'gls', 'gl', 'ast', 'assists', 'mins', 'minutes', 'wage', 'value', 'kgl', 'num', 'no', 'number', '#', 'rating', 'av rat', 'avg rat', 'ca', 'pa', 'cur', 'pot', 'current ability', 'potential ability', 'zapasy', 'goly', 'asistence', 'cislo', 'id', 'uid', 'unique id', 'player id', 'pid']);

  // Skryté údaje hry: aplikace je neotevírá a nepočítá s nimi (zadání zakazuje vymýšlet mechaniky FM27, CA/PA a skryté atributy jsou přesně to).
  const HIDDEN = ['ability current', 'ability potential', 'current ability', 'potential ability', 'consistency', 'dirtiness', 'important matches', 'injury proneness', 'versatility',
    'adaptability', 'ambition', 'loyalty', 'pressure', 'professionalism', 'sportsmanship', 'temperament', 'controversy'];
  // Zkratky CA a PA (schopnost): jen přesná shoda, aby se nezachytily jiné názvy, které na ně končí.
  const HIDDEN_ABBR = new Set(['ca', 'pa']);
  const isHidden = (headerNorm) => HIDDEN_ABBR.has(headerNorm) || HIDDEN.some((x) => headerNorm === x || headerNorm.endsWith(' ' + x));
  // Skupiny sloupců `fmsave`, které nejsou atributy (čísla bývají také v rozsahu 1 až 20: ocenění pozic, osobnost, pověst, surové hodnoty).
  const NOT_ATTRIBUTE_PREFIX = /^(positions|personality|reputation|ability|raw|contract|club|team|loan|height|transfer)[ _]/;

  /** Je to výstup čtečky `fmsave` (podle dokumentace: ploché sloupce `attributes_finishing`, `ability_current`, `contract_wage`)? */
  const isFmsave = (headers) => headers.some((h) => /^attributes_/.test(String(h))) && headers.includes('name');

  /** Hezký název atributu z hlavičky: `attributes_off_the_ball` → „Off the ball“; ostatní hlavičky zůstanou, jak jsou. */
  function prettyAttrName(header) {
    const h = String(header).trim();
    const stripped = h.replace(/^attributes_/, '');
    if (/^[a-z0-9_]+$/.test(stripped) && stripped.includes('_') || /^attributes_/.test(h)) {
      const t = stripped.replace(/_/g, ' ');
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return h;
  }

  /** guessMapping(table) → [{index, header, role, reason}]. Nic se nehádá potichu: u každého sloupce je důvod a uživatel ho změní. */
  function guessMapping(table) {
    const { headers, rows } = table;
    const col = (i) => rows.map((r) => String(r[i] === undefined ? '' : r[i]).trim()).filter(Boolean);
    const numericShare = (i, lo, hi) => {
      const v = col(i);
      if (v.length < 2) return 0;
      return v.filter((x) => isInt(x) && Number(x) >= lo && Number(x) <= hi).length / v.length;
    };
    const used = new Set();
    const out = headers.map((header, index) => ({ index, header, role: 'ignore', reason: '' }));
    if (isFmsave(headers)) {
      // Výstup `fmsave`: názvy sloupců jsou doložené jeho dokumentací, takže se berou přesně a skryté údaje se vynechají.
      for (const c of out) {
        const n = norm(c.header);
        if (c.header === 'name') Object.assign(c, { role: 'name', reason: 'sloupec `name` z fmsave' });
        else if (c.header === 'age') Object.assign(c, { role: 'age', reason: 'sloupec `age` z fmsave' });
        else if (c.header === 'natural_positions') Object.assign(c, { role: 'positions', reason: 'sloupec `natural_positions` z fmsave' });
        else if (/^attributes_/.test(c.header)) {
          if (isHidden(n)) Object.assign(c, { role: 'ignore', reason: 'skrytý údaj hry, aplikace s ním nepočítá' });
          else Object.assign(c, { role: 'attribute', reason: 'atribut z fmsave' });
        } else if (isHidden(n)) c.reason = 'skrytý údaj hry, aplikace s ním nepočítá';
        else c.reason = 'nepoužito';
      }
      return out;
    }
    const claim = (role, test, why) => {
      if (used.has(role)) return;
      const hit = out.find((c) => c.role === 'ignore' && test(norm(c.header), c.index));
      if (hit) {
        hit.role = role;
        hit.reason = why;
        used.add(role);
      }
    };
    for (const role of ['name', 'positions', 'age', 'role', 'duty', 'injured']) claim(role, (h) => SYN[role].includes(h), 'podle názvu sloupce');
    if (!used.has('name')) {
      const textual = out.find((c) => c.role === 'ignore' && col(c.index).length >= 2 && col(c.index).filter((x) => !/^[\d.,\s%+-]+$/.test(x)).length / col(c.index).length >= 0.9 && new Set(col(c.index).map((x) => x.toLowerCase())).size >= Math.min(col(c.index).length, 2));
      if (textual) {
        textual.role = 'name';
        textual.reason = 'první sloupec s texty';
        used.add('name');
      }
    }
    const cands = out.filter((c) => c.role === 'ignore' && !NOT_ATTRIBUTE.has(norm(c.header)) && !isHidden(norm(c.header)) && !NOT_ATTRIBUTE_PREFIX.test(norm(c.header)) && numericShare(c.index, 1, 20) >= 0.9);
    for (const c of cands) {
      if (cands.length >= 5) {
        c.role = 'attribute';
        c.reason = 'čísla 1 až 20';
      } else c.reason = 'čísla 1 až 20, ale je jich málo na atributy (zapni ručně)';
    }
    for (const c of out) {
      if (c.role === 'ignore' && !c.reason) c.reason = isHidden(norm(c.header)) ? 'skrytý údaj hry, aplikace s ním nepočítá' : NOT_ATTRIBUTE.has(norm(c.header)) || NOT_ATTRIBUTE_PREFIX.test(norm(c.header)) ? 'číslo, které není atribut' : 'nepoznáno';
    }
    return out;
  }

  // ---------------------------------------------------------------- řádky → hráči
  const FALSEY = new Set(['', '-', '--', 'ne', 'no', 'none', 'false', '0', 'fit', 'healthy', 'zdravy', 'zdrav', 'ok', 'n/a']);
  const clip = (s, n) => String(s).trim().slice(0, n);

  /** rowsToPlayers(table, mapping, {max, existingNames}) → {players, issues, skipped:{duplicates, noName, overLimit}}. */
  function rowsToPlayers(table, mapping, opts) {
    const o = opts || {};
    const max = Number.isInteger(o.max) ? o.max : 60;
    const existing = new Set([...(o.existingNames || [])].map((n) => String(n).trim().toLowerCase()));
    const byRole = (role) => mapping.find((m) => m.role === role);
    const nameCol = byRole('name');
    const issues = [];
    const skipped = { duplicates: 0, noName: 0, overLimit: 0 };
    if (!nameCol) return { players: [], issues: ['Chybí sloupec se jménem hráče.'], skipped };
    const seen = new Set();
    const players = [];
    const counters = { age: 0, attr: new Map(), pos: 0 };
    for (const row of table.rows) {
      const name = cellText(row[nameCol.index]);
      if (name.length < 2 || name.length > 60) {
        skipped.noName++;
        continue;
      }
      const key = name.toLowerCase();
      if (seen.has(key) || existing.has(key)) {
        skipped.duplicates++;
        continue;
      }
      if (players.length >= max) {
        skipped.overLimit++;
        continue;
      }
      seen.add(key);
      const p = { name, positions: [], age: null, role: '', duty: '', attributes: {}, injured: false, notes: '' };
      const posCol = byRole('positions');
      if (posCol) {
        const rawPos = clip(row[posCol.index] || '', 60);
        const parts = rawPos.split(/[,/;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
        if (parts.length && parts.every((x) => /^[A-Z]{1,4}$/.test(x))) p.positions = [...new Set(parts)].slice(0, 4);
        else if (rawPos) {
          p.notes = `Pozice v exportu: ${rawPos}`;
          counters.pos++;
        }
      }
      const ageCol = byRole('age');
      if (ageCol) {
        const a = String(row[ageCol.index] || '').trim();
        if (a !== '') {
          if (isInt(a) && Number(a) >= 14 && Number(a) <= 50) p.age = Number(a);
          else counters.age++;
        }
      }
      const roleCol = byRole('role');
      if (roleCol) p.role = clip(cellText(row[roleCol.index]), 60);
      const dutyCol = byRole('duty');
      if (dutyCol) p.duty = clip(cellText(row[dutyCol.index]), 40);
      const injCol = byRole('injured');
      if (injCol) p.injured = !FALSEY.has(norm(row[injCol.index]));
      for (const m of mapping.filter((x) => x.role === 'attribute')) {
        const v = String(row[m.index] === undefined ? '' : row[m.index]).trim();
        if (v === '') continue;
        if (isInt(v) && Number(v) >= 1 && Number(v) <= 20) {
          if (Object.keys(p.attributes).length < 40) p.attributes[clip(prettyAttrName(m.header), 30)] = Number(v);
        } else counters.attr.set(prettyAttrName(m.header), (counters.attr.get(prettyAttrName(m.header)) || 0) + 1);
      }
      players.push(p);
    }
    if (counters.pos) issues.push(counters.pos === 1 ? 'Pozice u 1 hráče není prostá zkratka (třeba „D (RLC)“), aplikace ji nepřevádí a uložila ji do poznámky.' : `Pozice u ${counters.pos} hráčů nejsou prosté zkratky (třeba „D (RLC)“), aplikace je nepřevádí a uložila je do poznámky.`);
    if (counters.age) issues.push(counters.age === 1 ? 'Věk u 1 hráče není celé číslo 14 až 50, vynechal se.' : `Věk u ${counters.age} hráčů není celé číslo 14 až 50, vynechal se.`);
    for (const [h, n] of counters.attr) issues.push(n === 1 ? `Atribut „${h}“: 1 hodnota není celé číslo 1 až 20, vynechala se.` : `Atribut „${h}“: ${n} hodnot není celé číslo 1 až 20, vynechaly se.`);
    if (skipped.noName) issues.push(`Řádků bez čitelného jména: ${skipped.noName} (vynechány).`);
    return { players, issues, skipped };
  }

  return { MAX_BYTES, MAX_ROWS, ROLES, ROLE_LABEL, decodeBytes, cellText, parseHtmlTables, detectDelimiter, parseDelimited, parseJsonRows, extractTable, isFmsave, isHidden, prettyAttrName, guessMapping, rowsToPlayers };
});
