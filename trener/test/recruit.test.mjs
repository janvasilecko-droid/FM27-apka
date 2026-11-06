import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const R = require('../src/recruit.js');
const SO = require('../src/squadopt.js');
const RF = require('../src/rolefit.js');
const DW = require('../src/dwrs.js');
const TI = require('../src/tableimport.js');
const source = readFileSync(new URL('../src/recruit.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------- pomůcky
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};
const mk = (name, key, pref) => {
  const r = RF.makeProfile({ name, key, pref, source: 'user' }, { now: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  return r.profile;
};
const P = (id, positions, attributes, extra) => Object.assign({ id, name: 'Hráč ' + id, positions, attributes }, extra || {});
const cand = (id, name, positions, attributes, extra) => {
  const n = R.normalizeCandidate(Object.assign({ id, name, positions, attributes }, extra || {}));
  assert.ok(n.ok, JSON.stringify(n));
  return n.candidate;
};
const mini = () => {
  const profiles = [mk('Střelec', ['Finishing'], ['Pace']), mk('Stoper', ['Tackling'], ['Strength'])];
  const slots = [{ key: 'st', pos: 'ST', role: 'Střelec' }, { key: 'cb', pos: 'DC', role: 'Stoper' }];
  const players = [
    P('s1', ['ST'], { Finishing: 16, Pace: 14, Tackling: 4, Strength: 8 }),
    P('s2', ['ST'], { Finishing: 12, Pace: 13, Tackling: 5, Strength: 9 }),
    P('s3', ['ST'], { Finishing: 9, Pace: 9, Tackling: 5, Strength: 5 }),
    P('c1', ['DC'], { Finishing: 4, Pace: 9, Tackling: 17, Strength: 15 }),
    P('c2', ['DC'], { Finishing: 5, Pace: 8, Tackling: 13, Strength: 13 }),
  ];
  return { slots, players, profiles };
};
const STAR = () => cand('n1', 'Hvězda', ['ST'], { Finishing: 20, Pace: 20, Tackling: 3, Strength: 10 });

// nezávislá věštírna: hrubá síla přes všechna přiřazení základní sestavy (počet obsazených míst, potom součet v desetinách bodu)
function bruteA(input) {
  const index = RF.profilesIndex(input.profiles);
  const cell = (slot, pl) => {
    const prof = index.get(RF.roleKey(slot.role));
    if (!prof) return null;
    if (!RF.eligibility(slot.pos, pl.positions, 'strict').ok) return null;
    const s = RF.roleFit(pl, prof, {}).score;
    return s === null ? null : Math.round(s * 10);
  };
  const slots = input.slots.filter((s) => typeof s.role === 'string' && s.role.trim());
  let best = [-1, -1];
  (function rec(k, used, cnt, tot) {
    if (k === slots.length) {
      if (cnt > best[0] || (cnt === best[0] && tot > best[1])) best = [cnt, tot];
      return;
    }
    rec(k + 1, used, cnt, tot);
    input.players.forEach((pl, j) => {
      if (used.has(j) || pl.injured) return;
      const v = cell(slots[k], pl);
      if (v === null) return;
      used.add(j);
      rec(k + 1, used, cnt + 1, tot + v);
      used.delete(j);
    });
  })(0, new Set(), 0, 0);
  return best;
}
const withPlayer = (input, pl) => Object.assign({}, input, { players: input.players.concat([pl]) });

// ---------------------------------------------------------------- peníze
test('parseMoney: čitelné částky se převedou a měna a období se zapíšou zvlášť', () => {
  const cases = [
    ['€12.5M', 12500000, '€', null], ['€12,5M', 12500000, '€', null], ['12.5 M', 12500000, '', null], ['12,5 M €', 12500000, '€', null],
    ['£750K', 750000, '£', null], ['750k', 750000, '', null], ['€1.2m', 1200000, '€', null], ['€12.5 Million', 12500000, '€', null], ['1.5 billion', 1500000000, '', null],
    ['12 500 000', 12500000, '', null], ['12,500,000', 12500000, '', null], ['12.500.000', 12500000, '', null], ["12'500'000", 12500000, '', null], ['12’500’000', 12500000, '', null],
    ['50000', 50000, '', null], ['50 000 Kč', 50000, 'Kč', null], ['1,5 mil. Kč', 1500000, 'Kč', null], ['3 tis. Kč', 3000, 'Kč', null], ['2 mld. €', 2000000000, '€', null],
    ['35K p/w', 35000, '', 'week'], ['€35,000 p/w', 35000, '€', 'week'], ['€35,000 per week', 35000, '€', 'week'], ['35 000 týdně', 35000, '', 'week'], ['€30K / week', 30000, '€', 'week'],
    ['€1.5M p/a', 1500000, '€', 'year'], ['€1,2M ročně', 1200000, '€', 'year'], ['0', 0, '', null], ['€0', 0, '€', null], ['  €12.5M  ', 12500000, '€', null],
    ['5 thousand', 5000, '', null], ['2.5B', 2500000000, '', null], ['10 mld. €', 10000000000, '€', null], ['12M EUR', 12000000, 'EUR', null], ['$5M', 5000000, '$', null], ['CZK 5 000 000', 5000000, 'CZK', null], ['1.234', 1234, '', null],
  ];
  for (const [text, value, currency, period] of cases) {
    const m = R.parseMoney(text);
    assert.deepEqual({ value: m.value, currency: m.currency, period: m.period, issue: m.issue }, { value, currency, period, issue: '' }, JSON.stringify(text));
  }
});

test('parseMoney: co není jedna čitelná částka, je neznámé (null), a když to vypadá jako částka, s důvodem', () => {
  for (const text of ['', '   ', '-', 'N/A', 'neprodejný', 'Not for sale', 'tis', null, undefined]) {
    const m = R.parseMoney(text);
    assert.equal(m.value, null, JSON.stringify(text));
    assert.equal(m.issue, '', JSON.stringify(text));
  }
  const withIssue = [
    ['€25M - €30M', /Rozsah/], ['10-20', /Rozsah/], ['€25M – €30M', /Rozsah/], ['12.5', /nejednoznačný/], ['1.234.56', /nejednoznačný/], ['12.5.3M', /nejednoznačný/], ['1 2M', /nejednoznačný/],
    ["1'5M", /nejednoznačný/], ['1.234,567', /nejednoznačný/], ['1 234.567', /nejednoznačný/], ['10.1 mld.', /mimo rozsah/], ['-5M', /nejde přečíst/], ['1e6', /nejde přečíst/], ['abc 12', /nejde přečíst/], ['12 abc', /nejde přečíst/], ['99999999999', /mimo rozsah/], ['20 mld. €', /mimo rozsah/],
  ];
  for (const [text, re] of withIssue) {
    const m = R.parseMoney(text);
    assert.equal(m.value, null, text);
    assert.match(m.issue, re, text);
  }
  // cokoli jiného než text a číslo je neznámé a nikdy se nepřevádí na text („[5]“ není částka 5)
  for (const odd of [{}, [5], ['12M'], true, () => 1, Symbol('x')]) {
    const m = R.parseMoney(odd);
    assert.deepEqual({ value: m.value, issue: m.issue }, { value: null, issue: '' }, String(typeof odd));
  }
  // čísla: celé a zaokrouhlené se berou, záporná, nekonečná a obří ne
  assert.equal(R.parseMoney(12500000).value, 12500000);
  assert.equal(R.parseMoney(12.6).value, 13);
  assert.equal(R.parseMoney(0).value, 0);
  assert.equal(R.parseMoney(1e10).value, 1e10);
  for (const bad of [-1, NaN, Infinity, 1e10 + 1]) {
    const m = R.parseMoney(bad);
    assert.equal(m.value, null);
    assert.match(m.issue, /mimo rozsah/);
  }
});

// ---------------------------------------------------------------- data a texty
test('isDate: jen skutečné kalendářní datum RRRR-MM-DD v rozumném rozsahu', () => {
  for (const ok of ['2026-02-28', '2028-02-29', '1900-01-01', '2200-12-31', '2026-12-31']) assert.equal(R.isDate(ok), true, ok);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '2026-1-1', ' 2026-01-01', '2026-01-01 ', '1899-12-31', '2201-01-01', '', null, undefined, 20260101, new Date(0)]) assert.equal(R.isDate(bad), false, String(bad));
});

test('text: řídicí a neviditelné znaky pryč, mezery sloučené, oříznuto, cokoli jiného než text se převede', () => {
  const cp = (...c) => String.fromCodePoint(...c);
  assert.equal(R.text('  Jan' + cp(0) + cp(7) + '   Novák\n\t', 60), 'Jan Novák');
  assert.equal(R.text('a' + cp(0x202e) + 'b' + cp(0x200b) + 'c' + cp(0xfeff) + 'd', 60), 'a b c d');
  assert.equal(R.text('x'.repeat(100), 10), 'xxxxxxxxxx');
  assert.equal(R.text('abc def', 4), 'abc');
  assert.equal(R.text(null, 10), '');
  assert.equal(R.text(undefined, 10), '');
  assert.equal(R.text(12, 10), '12');
  for (const odd of [{}, [], () => 1, true, NaN, Infinity, Symbol('x')]) assert.equal(R.text(odd, 10), '', String(typeof odd));
  assert.equal(R.text('ěščřžýáíé ŽŘ', 60), 'ěščřžýáíé ŽŘ');
});

// ---------------------------------------------------------------- kandidát
test('normalizeCandidate: nejmenší platný kandidát má jen jméno a bezpečné výchozí hodnoty', () => {
  const r = R.normalizeCandidate({ name: 'Jan Novák' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  const c = r.candidate;
  assert.equal(c.name, 'Jan Novák');
  assert.equal(c.age, null);
  assert.deepEqual(c.positions, []);
  assert.deepEqual(c.attributes, {});
  assert.equal(c.price, null);
  assert.equal(c.wage, null);
  assert.equal(c.club, '');
  assert.equal(c.currency, '');
  assert.deepEqual(c.origin, { type: 'manual', fileName: null, at: null });
  assert.deepEqual(c.deal, { status: 'watch', validUntil: null, note: '', at: null });
  assert.equal(c.careerId, null);
  assert.equal('id' in c, false);
});

test('normalizeCandidate: celý platný záznam (cena a mzda i jako text, původ z tabulky, stav jednání)', () => {
  const r = R.normalizeCandidate({
    id: 'k1', careerId: 'car1', name: ' Petr  Dvořák ', age: '27', positions: 'dc, DL', attributes: { Finishing: 12, Pace: '14' }, club: 'FC Test', price: '€12.5M', wage: '€35,000 p/w', contractEnd: '2029-06-30',
    notes: 'dobrý na hlavičky', origin: { type: 'table', fileName: 'export.csv', at: 5 }, deal: { status: 'offer', validUntil: '2027-01-31', note: 'čeká na odpověď', at: 7 },
  }, { now: 99 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.candidate, {
    id: 'k1', careerId: 'car1', name: 'Petr Dvořák', age: 27, positions: ['DC', 'DL'], attributes: { Finishing: 12, Pace: 14 }, club: 'FC Test', price: 12500000, wage: 35000, currency: '€',
    contractEnd: '2029-06-30', notes: 'dobrý na hlavičky', origin: { type: 'table', fileName: 'export.csv', at: 5 }, deal: { status: 'offer', validUntil: '2027-01-31', note: 'čeká na odpověď', at: 7 },
  });
  // čas změny jednání se bere z opts.now, když chybí
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', deal: { status: 'watch' } }, { now: 99 }).candidate.deal.at, 99);
  // číselná cena a mzda, vlastní měna
  const n = R.normalizeCandidate({ name: 'Jan Novák', price: 5000000, wage: 20000, currency: 'Kč' }).candidate;
  assert.deepEqual([n.price, n.wage, n.currency], [5000000, 20000, 'Kč']);
});

test('normalizeCandidate: neplatné jméno se nepřijme, ostatní vadná pole se zahodí s důvodem', () => {
  for (const bad of [undefined, null, 'text', 5, [], {}, { name: '' }, { name: 'X' }, { name: '   ' }, { name: 12345 }, { name: {} }, { name: ['Jan', 'Novák'] }, { name: true }]) {
    const r = R.normalizeCandidate(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.candidate, null);
    assert.ok(r.issues.length === 1);
  }
  assert.equal(R.normalizeCandidate({ name: 'Ab' }).ok, true);
  assert.equal(R.normalizeCandidate({ name: 'x'.repeat(61) }).candidate.name.length, R.LIMITS.nameMax);
  const r = R.normalizeCandidate({ name: 'Jan Novák', age: 13, price: '€25M - €30M', wage: 'abc 12', deal: { status: 'hotovo', validUntil: '31.1.2027' } });
  assert.equal(r.ok, true);
  assert.equal(r.candidate.age, null);
  assert.equal(r.candidate.price, null);
  assert.equal(r.candidate.wage, null);
  assert.equal(r.candidate.deal.status, 'watch');
  assert.equal(r.candidate.deal.validUntil, null);
  assert.equal(r.issues.length, 5);
  assert.match(r.issues.join('|'), /Věk musí být/);
  assert.match(r.issues.join('|'), /Cena: Rozsah/);
  assert.match(r.issues.join('|'), /Mzda: Částku nejde přečíst/);
  assert.match(r.issues.join('|'), /Stav jednání není známý/);
  assert.match(r.issues.join('|'), /Platnost jednání musí být datum/);
});

test('normalizeCandidate: věk jen 14 až 50 a celé číslo (číslo i text)', () => {
  const age = (v) => R.normalizeCandidate({ name: 'Jan Novák', age: v }).candidate.age;
  assert.equal(age(14), 14);
  assert.equal(age(50), 50);
  assert.equal(age('27'), 27);
  assert.equal(age(13), null);
  assert.equal(age(51), null);
  assert.equal(age(27.5), null);
  assert.equal(age('abc'), null);
  assert.equal(age(' 27 '), 27);
  assert.equal(age('027'), null); // čeká se jedno nebo dvě číslice
  assert.equal(age('1e1'), null);
  assert.equal(age(null), null);
  assert.equal(age(''), null);
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák' }).issues.length, 0);
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', age: 13 }).issues.length, 1);
});

test('normalizeCandidate: pozice jako kódy 1 až 4 písmen, velká písmena, bez duplicit, nejvýš čtyři', () => {
  const pos = (v) => R.normalizeCandidate({ name: 'Jan Novák', positions: v });
  assert.deepEqual(pos('st, amc').candidate.positions, ['ST', 'AMC']);
  assert.deepEqual(pos('ST/CF;ST').candidate.positions, ['ST', 'CF']);
  assert.deepEqual(pos(['dc', 'DC', ' mc ']).candidate.positions, ['DC', 'MC']);
  const odd = pos(['D (RLC)', 'ST', 'ABCDE']);
  assert.deepEqual(odd.candidate.positions, ['ST']);
  assert.equal(odd.issues.length, 2);
  assert.match(odd.issues[0], /není kód/);
  const four = pos('A,B,C,D');
  assert.deepEqual(four.candidate.positions, ['A', 'B', 'C', 'D']);
  assert.deepEqual(four.issues, []);
  const many = pos('A,B,C,D,E');
  assert.deepEqual(many.candidate.positions, ['A', 'B', 'C', 'D']);
  assert.match(many.issues.join(' '), /víc než 4/);
  assert.deepEqual(pos(undefined).candidate.positions, []);
  assert.deepEqual(pos(42).candidate.positions, []);
});

test('normalizeCandidate: atributy jen 1 až 20, skryté údaje se nepřebírají, nebezpečné klíče se zahodí', () => {
  const attrs = {
    Finishing: 12, Pace: '14', Passing: 0, Heading: 21, Vision: 5.5, Tackling: 'abc', 'Current Ability': 150, CA: 140, Consistency: 12, 'Injury Proneness': 8, __proto__: 5, constructor: 7, prototype: 9, '': 10, Strength: 20,
  };
  const r = R.normalizeCandidate({ name: 'Jan Novák', attributes: JSON.parse(JSON.stringify(attrs).replace('"__proto__"', '"__proto__"')) });
  const a = r.candidate.attributes;
  assert.deepEqual(Object.keys(a).sort(), ['Finishing', 'Pace', 'Strength']);
  assert.equal(a.Pace, 14);
  assert.equal(Object.getPrototypeOf(a), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.match(r.issues.join('|'), /Skryté údaje hry \(4\)/);
  assert.match(r.issues.join('|'), /mimo rozsah 1 až 20 nebo nečíselné \(4\)/);
  assert.deepEqual(R.normalizeCandidate({ name: 'Jan Novák', attributes: { Finishing: 1, Pace: 20, Passing: '1', Vision: '20' } }).candidate.attributes, { Finishing: 1, Pace: 20, Passing: 1, Vision: 20 });
  // dlouhý název se ořízne, víc než čtyřicet atributů se zahodí
  const long = R.normalizeCandidate({ name: 'Jan Novák', attributes: { ['A'.repeat(50)]: 10 } }).candidate.attributes;
  assert.deepEqual(Object.keys(long), ['A'.repeat(30)]);
  const many = Object.fromEntries(Array.from({ length: 45 }, (_, i) => ['Atr' + i, 10]));
  const m = R.normalizeCandidate({ name: 'Jan Novák', attributes: many });
  assert.equal(Object.keys(m.candidate.attributes).length, R.LIMITS.maxAttributes);
  assert.match(m.issues.join('|'), /víc než 40/);
  assert.deepEqual(R.normalizeCandidate({ name: 'Jan Novák', attributes: [1, 2] }).candidate.attributes, {});
  assert.deepEqual(R.normalizeCandidate({ name: 'Jan Novák', attributes: 'Finishing 12' }).candidate.attributes, {});
});

test('normalizeCandidate: pole s potenciálem, schopností nebo osobností se nikdy nepřevezmou a je to řečeno', () => {
  const r = R.normalizeCandidate({ name: 'Jan Novák', ca: 150, PA: 180, potential: 'high', 'Current Ability': 130, personality: 'driven', reputation: 5, ability: 3 });
  const keys = Object.keys(r.candidate).map((k) => k.toLowerCase());
  for (const k of ['ca', 'pa', 'potential', 'personality', 'reputation', 'ability']) assert.equal(keys.includes(k), false, k);
  assert.equal(JSON.stringify(r.candidate).includes('driven'), false);
  assert.equal(r.issues.filter((i) => /skrytý údaj hry/.test(i)).length, 7);
});

test('normalizeCandidate: jednání (stav, platnost, poznámka), původ a id se čistí', () => {
  for (const st of R.STATUSES) assert.equal(R.normalizeCandidate({ name: 'Jan Novák', deal: { status: st } }).candidate.deal.status, st);
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', deal: { validUntil: '2027-02-29' } }).candidate.deal.validUntil, null);
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', deal: { validUntil: '2028-02-29' } }).candidate.deal.validUntil, '2028-02-29');
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', deal: { note: 'x'.repeat(300) } }).candidate.deal.note.length, R.LIMITS.dealNoteMax);
  assert.deepEqual(R.normalizeCandidate({ name: 'Jan Novák', origin: { type: 'něco', fileName: '', at: 'x' } }).candidate.origin, { type: 'manual', fileName: null, at: null });
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', origin: { type: 'table', fileName: 'a'.repeat(200) } }).candidate.origin.fileName.length, 80);
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', id: 'a1_b.c~d:e@f+g-h' }).candidate.id, 'a1_b.c~d:e@f+g-h');
  for (const bad of ['má mezeru', '', 'x'.repeat(65), 'a/b', 'č', 5]) assert.equal('id' in R.normalizeCandidate({ name: 'Jan Novák', id: bad }).candidate, false, String(bad));
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', careerId: 7 }).candidate.careerId, null);
});

test('normalizeCandidate: texty bez řídicích znaků, uřízlé na meze; měna nejvýš čtyři znaky; cena s obdobím a roční mzda se odmítnou', () => {
  const cp = (...c) => String.fromCodePoint(...c);
  const c = R.normalizeCandidate({ name: 'Jan' + cp(0x202e) + 'Novák', club: 'K'.repeat(100), notes: 'n'.repeat(500), contractEnd: 'c'.repeat(50), price: 100, wage: 10, currency: 'ABCDEFGH' }).candidate;
  assert.equal(c.name, 'Jan Novák');
  assert.equal(c.club.length, R.LIMITS.clubMax);
  assert.equal(c.notes.length, R.LIMITS.notesMax);
  assert.equal(c.contractEnd.length, R.LIMITS.contractMax);
  assert.equal(c.currency, 'ABCD');
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', price: '€5M', currency: 'Kč' }).candidate.currency, 'Kč'); // výslovně zadaná měna má přednost před měnou z částky
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', price: '€5M' }).candidate.currency, '€');
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', wage: '£20K p/w' }).candidate.currency, '£');
  assert.equal(R.normalizeCandidate({ name: 'Jan Novák', price: '5000000', wage: '£20K p/w' }).candidate.currency, '£');
  const p = R.normalizeCandidate({ name: 'Jan Novák', price: '€2M p/w', wage: '€1.5M p/a' });
  assert.equal(p.candidate.price, null);
  assert.equal(p.candidate.wage, null);
  assert.match(p.issues.join('|'), /Cena: má uvedené období/);
  assert.match(p.issues.join('|'), /Mzda: je roční/);
  const w = R.normalizeCandidate({ name: 'Jan Novák', wage: '€35,000 p/w' });
  assert.equal(w.candidate.wage, 35000);
  assert.deepEqual(w.issues, []);
});

test('normalizeCandidate: vstup se nemění (ani zmrazený) a výsledek na něm nezávisí', () => {
  const raw = deepFreeze({ name: 'Jan Novák', positions: ['ST'], attributes: { Finishing: 12 }, origin: { type: 'table' }, deal: { status: 'offer' } });
  const r = R.normalizeCandidate(raw);
  assert.equal(r.ok, true);
  r.candidate.positions.push('DC');
  r.candidate.attributes.Pace = 5;
  assert.deepEqual(raw.positions, ['ST']);
  assert.deepEqual(raw.attributes, { Finishing: 12 });
});

test('toPlayer: id s předponou, kopie dat, bez zranění; kandidát bez id dostane „new“', () => {
  const c = cand('k7', 'Jan Novák', ['ST'], { Finishing: 12 }, { age: 24 });
  const p = R.toPlayer(c);
  assert.deepEqual(p, { id: 'cand:k7', name: 'Jan Novák', positions: ['ST'], attributes: { Finishing: 12 }, age: 24, injured: false, candidate: true });
  p.positions.push('DC');
  p.attributes.Pace = 9;
  assert.deepEqual(c.positions, ['ST']);
  assert.deepEqual(c.attributes, { Finishing: 12 });
  assert.equal(R.toPlayer(R.normalizeCandidate({ name: 'Jan Novák' }).candidate).id, 'cand:new');
  assert.equal(R.toPlayer({ name: 'Bez dat' }).age, null);
});

test('dealState: stav a platnost podle data ve hře; bez data ve hře se platnost nehlídá a říká se to', () => {
  const c = (status, validUntil) => ({ deal: { status, validUntil } });
  let s = R.dealState(c('offer', '2027-01-10'), '2027-01-01');
  assert.deepEqual({ open: s.open, expired: s.expired, daysLeft: s.daysLeft, label: s.label, note: s.note }, { open: true, expired: false, daysLeft: 9, label: 'nabídka podána', note: '' });
  s = R.dealState(c('offer', '2027-01-10'), '2027-01-10');
  assert.deepEqual([s.expired, s.daysLeft, s.note], [false, 0, '']);
  s = R.dealState(c('offer', '2027-01-10'), '2027-01-11');
  assert.deepEqual([s.expired, s.daysLeft], [true, -1]);
  assert.match(s.note, /před 1 dnem/);
  s = R.dealState(c('agreed', '2027-01-10'), '2027-01-12');
  assert.match(s.note, /před 2 dny/);
  // zavřené jednání po platnosti žádné varování nemá
  s = R.dealState(c('signed', '2027-01-10'), '2027-02-12');
  assert.deepEqual([s.open, s.expired, s.note], [false, true, '']);
  s = R.dealState(c('offer', '2027-01-10'), null);
  assert.deepEqual([s.expired, s.daysLeft], [null, null]);
  assert.match(s.note, /Platnost se nehlídá/);
  assert.deepEqual(R.dealState(c('offer', '2027-01-10'), '2027-02-30').expired, null);
  s = R.dealState(c('offer', null), '2027-01-01');
  assert.deepEqual([s.expired, s.daysLeft, s.note, s.validUntil], [null, null, '', null]);
  assert.equal(R.dealState(c('neznámý', null), null).status, 'watch');
  assert.equal(R.dealState(null, null).status, 'watch');
  // přestupný rok: 28. 2. 2028 → 1. 3. 2028 jsou dva dny
  assert.equal(R.dealState(c('offer', '2028-03-01'), '2028-02-28').daysLeft, 2);
  assert.equal(R.dealState(c('offer', '2029-03-01'), '2029-02-28').daysLeft, 1);
  for (const st of R.STATUSES) assert.equal(R.dealState(c(st, null), null).open, R.OPEN_STATUSES.includes(st));
});

// ---------------------------------------------------------------- z tabulky
const CSV = [
  'Name,Age,Position,Club,Asking Price,Wage,Contract Expires,Finishing,Pace,Tackling,Strength,Passing,Current Ability',
  'Jan Novák,24,ST,FC Test,€12.5M,"€35,000 p/w",2029-06-30,16,14,4,8,10,150',
  'Petr Dvořák,31,DC,Test United,€900K,€8K p/w,2027-06-30,5,9,17,15,9,120',
  'Karel Černý,19,ST,,Not for sale,,,12,13,5,9,8,90',
  'Jan Novák,24,ST,Duplikát,€1M,,,1,1,1,1,1,1',
  'Ota Malý,22,ST,Rozsah FC,€25M - €30M,€2M p/a,,11,12,6,7,6,100',
].join('\n');
function tableFrom(csv) {
  const t = TI.extractTable(csv);
  assert.ok(t.ok, JSON.stringify(t));
  return t;
}

test('suggestRoles: nepřiřazené sloupce dostanou návrh klub, cena, mzda a konec smlouvy podle názvu; návrh nepřepisuje a nic nemění', () => {
  const map = [
    { index: 0, header: 'Name', role: 'name', reason: '' }, { index: 1, header: 'Club', role: 'ignore', reason: '' }, { index: 2, header: 'Asking_Price', role: 'ignore', reason: '' },
    { index: 3, header: 'Value', role: 'ignore', reason: '' }, { index: 4, header: 'WAGE', role: 'ignore', reason: '' }, { index: 5, header: 'Contract Expires', role: 'ignore', reason: '' }, { index: 6, header: 'Nic', role: 'ignore', reason: '' },
  ];
  const frozen = deepFreeze(JSON.parse(JSON.stringify(map)));
  const out = R.suggestRoles(frozen);
  assert.deepEqual(out.map((c) => c.role), ['name', 'club', 'price', 'ignore', 'wage', 'contract', 'ignore']); // „Value“ je druhý sloupec s významem cena: první vyhrál
  assert.equal(out[1].reason, 'podle názvu sloupce');
  assert.notEqual(out, map);
  // už přiřazený význam se nepřepíše a nepřiřadí se podruhé
  const pre = [{ index: 0, header: 'X', role: 'price', reason: '' }, { index: 1, header: 'Price', role: 'ignore', reason: '' }, { index: 2, header: 'Club', role: 'attribute', reason: '' }];
  assert.deepEqual(R.suggestRoles(pre).map((c) => c.role), ['price', 'ignore', 'attribute']);
  assert.deepEqual(R.suggestRoles(undefined), []);
  assert.deepEqual(R.suggestRoles('x'), []);
});

test('candidatesFromTable: kandidáti z tabulky mají jméno, věk, pozice, atributy, klub, cenu, mzdu a konec smlouvy; skryté údaje a duplicity ne', () => {
  const table = tableFrom(CSV);
  const map = R.suggestRoles(TI.guessMapping(table));
  const roleOf = (h) => map.find((c) => c.header === h).role;
  assert.deepEqual(['Name', 'Age', 'Position', 'Club', 'Asking Price', 'Wage', 'Contract Expires', 'Finishing', 'Current Ability'].map(roleOf), ['name', 'age', 'positions', 'club', 'price', 'wage', 'contract', 'attribute', 'ignore']);
  const r = R.candidatesFromTable(table, map, { fileName: 'export.csv', now: 123 });
  assert.deepEqual(r.candidates.map((c) => c.name), ['Jan Novák', 'Petr Dvořák', 'Karel Černý', 'Ota Malý']);
  const [jan, petr, karel, ota] = r.candidates;
  assert.deepEqual({ age: jan.age, positions: jan.positions, club: jan.club, price: jan.price, wage: jan.wage, currency: jan.currency, contractEnd: jan.contractEnd }, { age: 24, positions: ['ST'], club: 'FC Test', price: 12500000, wage: 35000, currency: '€', contractEnd: '2029-06-30' });
  assert.deepEqual(Object.keys(jan.attributes).sort(), ['Finishing', 'Pace', 'Passing', 'Strength', 'Tackling']);
  assert.equal(jan.attributes.Finishing, 16);
  assert.equal(JSON.stringify(jan).includes('150'), false); // Current Ability se nenačetla
  assert.deepEqual([petr.price, petr.wage], [900000, 8000]);
  assert.deepEqual([karel.price, karel.wage, karel.club], [null, null, '']);
  assert.deepEqual([ota.price, ota.wage], [null, null]);
  assert.deepEqual(jan.origin, { type: 'table', fileName: 'export.csv', at: 123 });
  assert.deepEqual(jan.deal, { status: 'watch', validUntil: null, note: '', at: 123 });
  assert.equal(r.skipped.duplicates, 1);
  assert.match(r.issues.join('|'), /Cena: Rozsah/);
  assert.match(r.issues.join('|'), /Mzda: je roční/);
});

test('candidatesFromTable: už známá jména a mez počtu se respektují, chybějící sloupec se jménem je chyba', () => {
  const table = tableFrom(CSV);
  const map = R.suggestRoles(TI.guessMapping(table));
  const known = R.candidatesFromTable(table, map, { existingNames: ['petr dvořák'] });
  assert.deepEqual(known.candidates.map((c) => c.name), ['Jan Novák', 'Karel Černý', 'Ota Malý']);
  assert.equal(known.skipped.duplicates, 2);
  const two = R.candidatesFromTable(table, map, { max: 2 });
  assert.equal(two.candidates.length, 2);
  assert.equal(two.skipped.overLimit, 2);
  assert.equal(R.candidatesFromTable(table, map, { max: 0 }).candidates.length, 0);
  assert.equal(R.candidatesFromTable(table, map, { max: 99999 }).candidates.length, 4);
  const noName = R.candidatesFromTable(table, map.map((c) => (c.role === 'name' ? Object.assign({}, c, { role: 'ignore' }) : c)), {});
  assert.equal(noName.candidates.length, 0);
  assert.match(noName.issues.join(' '), /sloupec se jménem/);
  // bez sloupců s cenou a mzdou jsou obě neznámé
  const bare = R.candidatesFromTable(table, map.map((c) => (['price', 'wage', 'club'].includes(c.role) ? Object.assign({}, c, { role: 'ignore' }) : c)), {});
  assert.ok(bare.candidates.every((c) => c.price === null && c.wage === null && c.club === ''));
  assert.deepEqual(R.candidatesFromTable(null, null, {}).candidates, []);
  for (const bad of [null, undefined, {}, { rows: 'x' }, [], 'tabulka']) {
    const r = R.candidatesFromTable(bad, map, {});
    assert.deepEqual(r.candidates, []);
    assert.deepEqual(r.issues, ['Tabulka není platná.']);
    assert.deepEqual(r.skipped, { invalid: 0, duplicates: 0, noName: 0, overLimit: 0 });
  }
});

test('candidatesFromTable: nejvýš dvě stě kandidátů, zbytek se spočítá jako nad limit', () => {
  const rows = ['Name,Age,Position,Finishing,Pace,Tackling,Strength,Passing'];
  for (let i = 0; i < 230; i++) rows.push(`Hráč Číslo${i},2${i % 10},ST,10,10,10,10,10`);
  const table = tableFrom(rows.join('\n'));
  const r = R.candidatesFromTable(table, TI.guessMapping(table), { max: 5000 });
  assert.equal(r.candidates.length, R.LIMITS.maxCandidates);
  assert.equal(r.skipped.overLimit, 30);
  assert.equal(R.candidatesFromTable(table, TI.guessMapping(table), {}).candidates.length, R.LIMITS.maxCandidates);
});

test('candidatesFromTable: stejná poznámka se vypíše jednou s počtem, nikoli pro každý řádek', () => {
  const rows = ['Name,Age,Position,Asking Price,Finishing,Pace,Tackling,Strength,Passing'];
  for (let i = 0; i < 12; i++) rows.push(`Hráč Číslo${i},2${i % 10},ST,€1M - €2M,10,10,10,10,10`);
  const table = tableFrom(rows.join('\n'));
  const r = R.candidatesFromTable(table, R.suggestRoles(TI.guessMapping(table)), {});
  assert.equal(r.candidates.length, 12);
  const price = r.issues.filter((i) => /Cena: Rozsah/.test(i));
  assert.equal(price.length, 1);
  assert.match(price[0], /\(u 12 hráčů\)/);
});

// ---------------------------------------------------------------- dopad příchodu
test('arrival: lepší útočník přijde na místo A, vytlačí dosavadního a rozdíl součtu sedí s hrubou silou', () => {
  const input = mini();
  const star = STAR();
  const imp = R.arrival(input, {}, star);
  assert.equal(imp.ok, true);
  assert.equal(imp.candidateId, 'n1');
  assert.equal(imp.placements.length >= 1, true);
  const pl = imp.placements.find((p) => p.team === 'A');
  assert.equal(pl.slotKey, 'st');
  assert.equal(pl.pos, 'ST');
  assert.equal(pl.role, 'Střelec');
  assert.equal(pl.replaces.id, 's1');
  assert.ok(pl.fitDelta > 0);
  const before = bruteA(input);
  const after = bruteA(withPlayer(input, R.toPlayer(star)));
  assert.equal(imp.deltaA, (after[1] - before[1]) / 10);
  assert.equal(imp.a.before, before[1] / 10);
  assert.equal(imp.a.after, after[1] / 10);
  assert.ok(imp.deltaA > 0);
  assert.equal(imp.deltaB, Math.round((imp.b.after - imp.b.before) * 10) / 10);
  assert.match(imp.model, /jednoduchý vážený průměr/);
  assert.deepEqual(imp.issues, []);
  // vedlejší posuny: vytlačený útočník s1 se posune na lavičku B místo s2
  const knock = imp.others.find((c) => c.team === 'B' && c.slotKey === 'st');
  assert.ok(knock, JSON.stringify(imp.others));
  assert.equal(knock.from.id, 's2');
  assert.equal(knock.to.id, 's1');
  assert.ok(imp.others.every((c) => !(c.to && c.to.id === 'cand:n1')));
});

test('arrival: kandidát, který se nehodí (jiná pozice nebo chybějící atributy), nic nezmění a nikde nehraje', () => {
  const input = mini();
  const gk = cand('g1', 'Brankář', ['GK'], { Finishing: 20, Pace: 20, Tackling: 20, Strength: 20 });
  const a = R.arrival(input, {}, gk);
  assert.equal(a.ok, true);
  assert.deepEqual(a.placements, []);
  assert.equal(a.deltaA, 0);
  const noAttrs = cand('x1', 'Bez dat', ['ST'], { Pace: 20 });
  const b = R.arrival(input, {}, noAttrs);
  assert.deepEqual(b.placements, []);
  assert.equal(b.deltaA, 0);
  assert.equal(b.deltaB, 0);
});

test('arrival: kandidát, který už v soupisce je, se odmítne; chybějící vstup nespadne; vstup se nemění', () => {
  const input = mini();
  const dup = cand('s1', 'Jmenovec', ['ST'], { Finishing: 20, Pace: 20, Tackling: 20, Strength: 20 });
  // id kandidáta má předponu, takže se s hráčem soupisky nesrazí ani při stejném id
  assert.equal(R.arrival(input, {}, dup).ok, true);
  const same = withPlayer(input, R.toPlayer(dup));
  const r = R.arrival(same, {}, dup);
  assert.equal(r.ok, false);
  assert.match(r.issues[0], /už v soupisce/);
  for (const bad of [[undefined, STAR()], [null, STAR()], [input, null], [input, 'x']]) assert.equal(R.arrival(bad[0], {}, bad[1]).ok, false);
  const frozen = deepFreeze({ input: mini(), opts: { mode: 'strict' }, cand: STAR() });
  assert.equal(R.arrival(frozen.input, frozen.opts, frozen.cand).ok, true);
  assert.deepEqual(R.arrival(mini(), {}, STAR()), R.arrival(mini(), {}, STAR()));
});

test('arrival: zamčený hráč zůstane, kandidát ho nevytlačí; předpočítaný stav „před“ dá stejný výsledek', () => {
  const input = mini();
  const locked = R.arrival(input, { locks: { st: 's3' } }, STAR());
  const slotChange = locked.placements.find((p) => p.team === 'A' && p.slotKey === 'st');
  assert.equal(slotChange, undefined);
  assert.equal(locked.deltaA, 0);
  const before = SO.optimize(input, { quick: true });
  assert.deepEqual(R.arrival(input, {}, STAR(), before), R.arrival(input, {}, STAR()));
  // předaný stav se opravdu použije: s jiným výchozím stavem (s3 zamčený na útoku) vyjde jiný součet před příchodem
  const other = SO.optimize(input, { quick: true, locks: { st: 's3' } });
  const viaOther = R.arrival(input, {}, STAR(), other);
  assert.equal(viaOther.a.before, other.a.total);
  assert.notEqual(viaOther.a.before, R.arrival(input, {}, STAR()).a.before);
});

test('arrival: kandidát lepší jen než lavička se objeví na lavičce B a základní sestava se nezmění; staré problémy se nehlásí jako nové', () => {
  const input = mini();
  const good = POOL()[0]; // 15/15: horší než s1 (16/14), lepší než s2 (12/13)
  const imp = R.arrival(input, {}, good);
  assert.equal(imp.deltaA, 0);
  assert.equal(imp.placements.length, 1);
  assert.equal(imp.placements[0].team, 'B');
  assert.equal(imp.placements[0].slotKey, 'st');
  assert.equal(imp.placements[0].replaces.id, 's2');
  assert.ok(imp.deltaB > 0);
  // problém, který byl už před příchodem (zámek na hráče, který v soupisce není), se mezi novými nehlásí
  assert.deepEqual(R.arrival(input, { locks: { st: 'ghost' } }, STAR()).issues, []);
  assert.match(SO.optimize(input, { locks: { st: 'ghost' }, quick: true }).issues.join(' '), /zamčený hráč není v soupisce/);
});

test('arrival: příchod nikdy nesníží součet A a shoduje se s hrubou silou na 150 náhodných úlohách (i s kandidáty bez části atributů)', () => {
  const rand = rng(77);
  const pickOf = (list) => list[Math.floor(rand() * list.length)];
  const ATTRS = ['Finishing', 'Pace', 'Tackling', 'Strength', 'Passing'];
  let improved = 0;
  for (let it = 0; it < 150; it++) {
    const n = 1 + Math.floor(rand() * 3);
    const positions = ['ST', 'DC', 'MC'];
    const slots = Array.from({ length: n }, (_, i) => ({ key: 's' + i, pos: positions[i % 3], role: rand() > 0.1 ? 'R' + (i % 2) : '' }));
    const profiles = [mk('R0', ['Finishing', 'Pace'], ['Passing']), mk('R1', ['Tackling'], ['Strength'])];
    const gen = (id, withHoles) => {
      const attrs = {};
      for (const a of ATTRS) if (!(withHoles && rand() < 0.35)) attrs[a] = 1 + Math.floor(rand() * 20);
      return P(id, [pickOf(positions)], attrs, { injured: rand() < 0.1 });
    };
    const players = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, j) => gen('p' + j, rand() < 0.3));
    const input = { slots, players, profiles };
    const c = cand('c' + it, 'Kandidát ' + it, [pickOf(positions)], gen('x', rand() < 0.4).attributes);
    const imp = R.arrival(input, {}, c);
    assert.equal(imp.ok, true);
    const b = bruteA(input);
    const a = bruteA(withPlayer(input, R.toPlayer(c)));
    assert.ok(imp.deltaA >= 0, `úloha ${it}: součet A klesl o ${imp.deltaA}`);
    assert.equal(imp.deltaA, (a[1] - b[1]) / 10, `úloha ${it}`);
    if (imp.deltaA > 0) improved++;
  }
  assert.ok(improved > 20, `příchod zlepšil jen ${improved} úloh ze 150: zkouška by byla slabá`);
});

test('departure a swap: odchod i výměna se shodují s hrubou silou; neznámý hráč se odmítne', () => {
  const input = mini();
  const dep = R.departure(input, {}, 's1');
  assert.equal(dep.ok, true);
  assert.deepEqual(dep.player, { id: 's1', name: 'Hráč s1' });
  const reduced = Object.assign({}, input, { players: input.players.filter((p) => p.id !== 's1') });
  assert.equal(dep.deltaA, (bruteA(reduced)[1] - bruteA(input)[1]) / 10);
  assert.ok(dep.deltaA < 0);
  assert.ok(dep.changes.some((c) => c.slotKey === 'st' && c.from && c.from.id === 's1'));
  assert.equal(R.departure(input, {}, 'ghost').ok, false);
  const sw = R.swap(input, {}, STAR(), 's1');
  assert.equal(sw.ok, true);
  assert.deepEqual(sw.out, { id: 's1', name: 'Hráč s1' });
  const swapped = Object.assign({}, input, { players: reduced.players.concat([R.toPlayer(STAR())]) });
  assert.equal(sw.deltaA, (bruteA(swapped)[1] - bruteA(input)[1]) / 10);
  // s1 po výměně není ani na lavičce B (kdyby zůstal v soupisce, byl by součet B po příchodu hvězdy vyšší)
  assert.ok(sw.b.after < R.arrival(input, {}, STAR()).b.after);
  assert.equal(R.swap(input, {}, STAR(), 'ghost').ok, false);
  assert.equal(R.swap(input, {}, null, 's1').ok, false);
  assert.equal(R.swap(withPlayer(input, R.toPlayer(STAR())), {}, STAR(), 's1').ok, false);
  assert.equal(R.departure(null, {}, 's1').ok, false);
  deepFreeze(input);
  assert.equal(R.departure(input, {}, 's2').ok, true);
});

const FULL = (v, over) => Object.assign(Object.fromEntries(DW.OUTFIELD_ATTRIBUTES.map((a) => [a, v])), over || {});
test('similarCandidates: řadí kandidáty podle vzdálenosti v atributech, ti bez všech atributů jsou zvlášť, cíl bez atributů dá důvod', () => {
  const target = P('own', ['ST'], FULL(12, { Finishing: 17, Pace: 16 }));
  const near = cand('near', 'Skoro Stejný', ['ST'], FULL(12, { Finishing: 16, Pace: 16 }));
  const mid = cand('mid', 'Střední', ['ST'], FULL(12, { Finishing: 13, Pace: 12 }));
  const far = cand('far', 'Úplně Jiný', ['ST'], FULL(6, { Finishing: 4, Pace: 5 }));
  const holes = cand('holes', 'Neúplný', ['ST'], { Finishing: 17, Pace: 16 });
  const res = R.similarCandidates(target, [far, holes, mid, near], {});
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.group, 'ST');
  assert.deepEqual(res.rows.map((r) => r.id), ['near', 'mid', 'far']); // vzestupně podle vzdálenosti; id bez předpony
  assert.ok(res.rows[0].distance < res.rows[1].distance && res.rows[1].distance < res.rows[2].distance);
  assert.ok(res.rows[0].similarity > res.rows[1].similarity && res.rows[1].similarity > res.rows[2].similarity);
  assert.equal(res.rows[0].candidate, near);
  assert.deepEqual(res.unknown, [{ id: 'holes', name: 'Neúplný' }]);
  // shoda s podkladovou funkcí squadopt.similarPlayers (stejná čísla)
  const raw = SO.similarPlayers(target, [near, mid, far].map(R.toPlayer), {});
  assert.deepEqual(res.rows.map((r) => [r.similarity, r.distance]), raw.similar.map((r) => [r.similarity, r.distance]));
  // počet řádků
  assert.equal(R.similarCandidates(target, [far, mid, near], { n: 2 }).rows.length, 2);
  assert.equal(R.similarCandidates(target, [far, mid, near], { n: 0 }).rows.length, 3);
  assert.equal(R.similarCandidates(target, [far, mid, near], { n: 'x' }).rows.length, 3);
  // cíl bez všech atributů, bez cíle, bez kandidátů
  const bare = R.similarCandidates(P('own2', ['ST'], { Finishing: 17 }), [near], {});
  assert.equal(bare.ok, false);
  assert.match(bare.reason, /Hráči chybí atributy/);
  assert.deepEqual(bare.rows, []);
  assert.equal(R.similarCandidates(null, [near], {}).ok, false);
  assert.match(R.similarCandidates(null, [near], {}).reason, /Chybí hráč/);
  assert.deepEqual(R.similarCandidates(target, [], {}).rows, []);
  assert.deepEqual(R.similarCandidates(target, undefined, {}).rows, []);
  assert.equal(R.similarCandidates(P('nopos', [], FULL(12)), [near], {}).ok, false);
  assert.equal(R.similarCandidates(P('nopos', [], FULL(12)), [near], { group: 'ST' }).ok, true);
  // zmrazené vstupy
  deepFreeze({ target, list: [near, mid] });
  assert.equal(R.similarCandidates(target, [near, mid], {}).ok, true);
});

test('describeChange: součty a změny po místech s vhodností; bez změny to řekne; neúspěšný výsledek nemá řádky', () => {
  const input = mini();
  const dep = R.departure(input, {}, 's1');
  const lines = R.describeChange(dep);
  assert.match(lines[0], /^Součet A \d+(,\d)? → \d+(,\d)? \(-\d+(,\d)?\); součet B /);
  assert.ok(lines.some((l) => /^Základní sestava, ST Střelec: Hráč s1 \(\d+(,\d)?\) → Hráč s2 \(\d+(,\d)?\)\.$/.test(l)), lines.join('\n'));
  const sw = R.describeChange(R.swap(input, {}, STAR(), 's1'));
  assert.ok(sw.some((l) => /Hráč s1 \(\d+(,\d)?\) → Hvězda \(\d+(,\d)?\)\./.test(l)), sw.join('\n'));
  const none = R.describeChange(R.departure(input, {}, 's3'));
  assert.match(none[0], /^Součet A/);
  assert.ok(none.length >= 1);
  // odchod bez dopadu na sestavu (hráč není v A ani v B)
  const idle = R.describeChange({ ok: true, a: { before: 70, after: 70 }, b: null, deltaA: 0, deltaB: null, changes: [] });
  assert.deepEqual(idle, ['Součet A 70 → 70 (0).', 'Sestava A ani B se nezmění.']);
  const open = R.describeChange({ ok: true, a: null, changes: [{ team: 'B', pos: 'DC', role: '', from: null, to: { name: 'Nový', fit: null } }] });
  assert.deepEqual(open, ['Lavička B, DC: nikdo → Nový.']);
  assert.deepEqual(R.describeChange({ ok: false }), []);
  assert.deepEqual(R.describeChange(null), []);
  assert.deepEqual(R.describeChange('x'), []);
});

test('needs: neobsazené místo, slabé místo i tenká hloubka se ohlásí z výsledku sestavy', () => {
  const profiles = [mk('Střelec', ['Finishing'], ['Pace']), mk('Stoper', ['Tackling'], ['Strength']), mk('Tvůrce', ['Passing'], ['Vision'])];
  const slots = [
    { key: 'st', pos: 'ST', role: 'Střelec' }, { key: 'cb1', pos: 'DC', role: 'Stoper' }, { key: 'cb2', pos: 'DC', role: 'Stoper' }, { key: 'cb3', pos: 'DC', role: 'Stoper' }, { key: 'mc', pos: 'MC', role: 'Tvůrce' }, { key: 'free', pos: 'AMC', role: '' },
  ];
  const good = { Finishing: 18, Pace: 17, Tackling: 18, Strength: 17, Passing: 16, Vision: 15 };
  const players = [P('a', ['ST'], good), P('b', ['DC'], good), P('c', ['DC'], good), P('d', ['DC'], { Finishing: 5, Pace: 5, Tackling: 2, Strength: 2, Passing: 5, Vision: 5 })];
  const r = R.needs({ slots, players, profiles }, {});
  const kinds = r.needs.map((n) => `${n.kind}:${n.slotKey}`);
  assert.ok(kinds.includes('unfilled:mc'), kinds.join());
  assert.ok(kinds.includes('weak:cb3') || kinds.some((k) => k.startsWith('weak:cb')), kinds.join());
  assert.ok(r.needs.some((n) => n.kind === 'depth'), kinds.join());
  assert.equal(r.needs.find((n) => n.kind === 'unfilled').severity, 'high');
  const depth = (k) => r.needs.find((n) => n.kind === 'depth' && n.slotKey === k);
  assert.match(depth('st').text, /^Hloubka ST Střelec: hodí se jen jeden hráč\.$/);
  assert.equal(depth('st').severity, 'medium');
  assert.match(depth('mc').text, /^Hloubka MC Tvůrce: nikdo se na místo nehodí\.$/);
  assert.equal(depth('mc').severity, 'high');
  assert.equal(r.needs.find((n) => n.kind === 'weak').severity, 'medium');
  for (const k of ['cb1', 'cb2', 'cb3']) assert.equal(depth(k), undefined, 'místo s dostatečnou hloubkou se nehlásí: ' + k);
  assert.ok(r.needs.every((n) => n.text && n.slotKey), 'každá potřeba má text a místo');
  assert.ok(!kinds.some((k) => k.endsWith(':free')), 'místo bez role se nehlásí');
  assert.match(r.model, /jednoduchý vážený průměr/);
  // sestava bez nedostatků nehlásí nic podobného
  const fine = R.needs(mini(), {});
  assert.ok(fine.needs.every((n) => n.kind !== 'unfilled'));
  assert.deepEqual(R.needs({ slots: [], players: [], profiles: [] }, {}).needs, []);
});

// ---------------------------------------------------------------- hledání
const POOL = () => [
  cand('good', 'Dobrý Útočník', ['ST'], { Finishing: 15, Pace: 15, Tackling: 4, Strength: 8 }, { age: 25, price: 5000000, wage: 20000 }),
  cand('star', 'Hvězda', ['ST'], { Finishing: 20, Pace: 20, Tackling: 3, Strength: 10 }, { age: 31, price: 30000000, wage: 90000 }),
  cand('weak', 'Slabý Útočník', ['ST'], { Finishing: 6, Pace: 6, Tackling: 4, Strength: 8 }, { age: 19 }),
  cand('def', 'Stoper Navíc', ['DC'], { Finishing: 3, Pace: 8, Tackling: 19, Strength: 18 }, { age: 27, price: 8000000 }),
  cand('gk', 'Brankář', ['GK'], { Finishing: 3, Pace: 8, Tackling: 5, Strength: 10 }, { age: 29, price: 2000000, wage: 10000 }),
  cand('holes', 'Bez Atributů', ['ST'], { Pace: 18 }),
];

test('search: celý tým se řadí podle dopadu na součet A; neohodnotitelní jsou na konci s důvodem, ne s nulou', () => {
  const input = mini();
  const res = R.search(input, {}, POOL(), {});
  const order = res.rows.map((r) => r.id);
  assert.deepEqual(order.slice(0, 2), ['star', 'def']); // hvězda zlepší útok o nejvíc, stoper navíc zlepší obranu (c1 17/15 → 19/18)
  assert.equal(order.indexOf('good') < order.indexOf('weak'), true);
  const tail = res.rows.slice(-2).map((r) => r.id);
  assert.deepEqual(new Set(tail), new Set(['gk', 'holes']));
  for (const id of ['gk', 'holes']) {
    const row = res.rows.find((r) => r.id === id);
    assert.equal(row.known, false);
    assert.equal(row.bestFit, null);
    assert.ok(row.reasons.length > 0 && row.reasons.every((x) => typeof x === 'string' && x.length > 3), id);
  }
  const star = res.rows.find((r) => r.id === 'star');
  assert.equal(star.known, true);
  assert.equal(star.bestSlot.slotKey, 'st');
  assert.equal(star.impact.deltaA, R.arrival(input, {}, POOL()[1]).deltaA);
  assert.equal(res.total, 6);
  assert.equal(res.shown, 6);
  assert.match(res.model, /jednoduchý/);
  // slabý útočník nezlepší nikoho: dopad 0 a není to chyba
  const weak = res.rows.find((r) => r.id === 'weak');
  assert.equal(weak.known, true);
  assert.equal(weak.impact.deltaA, 0);
});

test('search: řazení při shodě je stabilní (dopad A, pak B, pak nejlepší vhodnost, pak jméno) a bez náhody', () => {
  const input = mini();
  const twin1 = cand('t1', 'Bratr B', ['ST'], { Finishing: 6, Pace: 6, Tackling: 4, Strength: 8 });
  const twin2 = cand('t2', 'Bratr A', ['ST'], { Finishing: 6, Pace: 6, Tackling: 4, Strength: 8 });
  const a = R.search(input, {}, [twin1, twin2], {});
  const b = R.search(input, {}, [twin2, twin1], {});
  assert.deepEqual(a.rows.map((r) => r.id), b.rows.map((r) => r.id));
  assert.deepEqual(a.rows.map((r) => r.name), ['Bratr A', 'Bratr B']);
  assert.deepEqual(JSON.parse(JSON.stringify(R.search(mini(), {}, POOL(), {}))), JSON.parse(JSON.stringify(R.search(mini(), {}, POOL(), {}))));
});

test('search: na jedno místo se řadí podle vhodnosti na roli, ukáže se současný hráč a rozdíl; kdo na místo nemá pozici, je na konci', () => {
  const input = mini();
  const res = R.search(input, {}, POOL(), { slotKey: 'st' });
  const order = res.rows.map((r) => r.id);
  assert.deepEqual(order.slice(0, 3), ['star', 'good', 'weak']);
  const star = res.rows[0];
  assert.equal(star.slot.slotKey, 'st');
  assert.equal(star.slot.pos, 'ST');
  assert.equal(star.slot.role, 'Střelec');
  assert.deepEqual({ id: star.slot.current.id, name: star.slot.current.name }, { id: 's1', name: 'Hráč s1' });
  assert.ok(star.slot.fit > star.slot.current.fit);
  assert.equal(star.slot.fitDelta, Math.round((star.slot.fit - star.slot.current.fit) * 10) / 10);
  // obránce a brankář na útočné místo nemají pozici: bez vhodnosti, na konci
  const def = res.rows.find((r) => r.id === 'def');
  assert.equal(def.slot.fit, null);
  assert.equal(def.slot.fitDelta, null);
  assert.ok(order.indexOf('def') > order.indexOf('weak'));
  // vhodnost na místě je ta samá, jakou ukáže rankForRole pro stejné hráče
  const rank = SO.rankForRole({ players: POOL().map(R.toPlayer), profile: input.profiles[0], slotPos: 'ST' }, {});
  for (const row of rank.filter((x) => x.fit !== null)) assert.equal(res.rows.find((r) => 'cand:' + r.id === row.id).slot.fit, row.fit, row.id);
  // klíč místa může být i číslo: hledá se podle textové podoby
  const numeric = Object.assign({}, input, { slots: input.slots.map((s, i) => Object.assign({}, s, { key: i + 7 })) });
  const num = R.search(numeric, {}, POOL(), { slotKey: 7 });
  assert.deepEqual(num.issues, []);
  assert.equal(num.rows[0].slot.pos, 'ST');
  assert.equal(R.search(numeric, {}, POOL(), { slotKey: '8' }).rows[0].slot.pos, 'DC');
  // místo, které v taktice není
  const missing = R.search(input, {}, POOL(), { slotKey: 'neni' });
  assert.match(missing.issues.join(' '), /Místo „neni“ v taktice není/);
  assert.equal(missing.rows.length, 6);
});

test('search: filtry věku, ceny, mzdy, pozic, stavu, jména a vyřazených; neznámé údaje se podle volby nechají s příznakem, nebo vyřadí', () => {
  const input = mini();
  const pool = POOL();
  const ids = (f) => R.search(input, {}, pool, f).rows.map((r) => r.id).sort();
  assert.deepEqual(ids({}), ['def', 'gk', 'good', 'holes', 'star', 'weak']);
  assert.deepEqual(ids({ maxAge: 27 }), ['def', 'good', 'holes', 'weak']); // star (31) a gk (29) jsou starší; holes nemá věk a zůstane s příznakem
  assert.deepEqual(ids({ minAge: 26 }), ['def', 'gk', 'holes', 'star']);
  // hranice jsou včetně: věk, cena i mzda přesně na mezi se nevyřadí
  const edge = cand('edge', 'Na Mezi', ['ST'], { Finishing: 10, Pace: 10, Tackling: 4, Strength: 8 }, { age: 26, price: 4000000, wage: 15000 });
  const eids = (f) => R.search(input, {}, [edge], f).rows.map((r) => r.id);
  for (const f of [{ minAge: 26 }, { maxAge: 26 }, { maxPrice: 4000000 }, { maxWage: 15000 }]) assert.deepEqual(eids(f), ['edge'], JSON.stringify(f));
  for (const f of [{ minAge: 27 }, { maxAge: 25 }, { maxPrice: 3999999 }, { maxWage: 14999 }]) assert.deepEqual(eids(f), [], JSON.stringify(f));
  // záporná nebo nečíselná mez se ignoruje (filtr se nezapne)
  for (const f of [{ maxPrice: -1 }, { maxWage: -1 }, { maxPrice: 'x' }, { minAge: 'x' }, { maxAge: 25.5 }]) assert.deepEqual(ids(f), ids({}), JSON.stringify(f));
  assert.deepEqual(ids({ maxAge: 27, unknownAge: 'drop' }), ['def', 'good', 'weak']);
  assert.deepEqual(ids({ maxPrice: 6000000 }), ['gk', 'good', 'holes', 'weak']); // star a def jsou dražší; weak a holes nemají cenu a zůstanou
  assert.deepEqual(ids({ maxPrice: 6000000, unknownPrice: 'drop' }), ['gk', 'good']);
  assert.deepEqual(ids({ maxWage: 50000 }), ['def', 'gk', 'good', 'holes', 'weak']);
  assert.deepEqual(ids({ maxWage: 50000, unknownWage: 'drop' }), ['gk', 'good']);
  assert.deepEqual(ids({ positions: ['dc'] }), ['def']);
  assert.deepEqual(ids({ positions: ['ST', 'GK'] }), ['gk', 'good', 'holes', 'star', 'weak']);
  const nopos = cand('np', 'Bez Pozice', [], { Finishing: 15, Pace: 15, Tackling: 4, Strength: 8 });
  assert.deepEqual(R.search(input, {}, pool.concat([nopos]), { positions: ['DC'] }).rows.map((r) => r.id).sort(), ['def', 'np']); // bez uvedené pozice se kandidát nevyřadí
  assert.deepEqual(ids({ query: 'HVĚZ' }), ['star']);
  assert.deepEqual(ids({ excludeIds: ['star', 'gk'] }), ['def', 'good', 'holes', 'weak']);
  const withStatus = pool.map((c) => (c.id === 'weak' ? Object.assign({}, c, { deal: Object.assign({}, c.deal, { status: 'rejected' }) }) : c.id === 'gk' ? Object.assign({}, c, { deal: Object.assign({}, c.deal, { status: 'signed' }) }) : c));
  const open = R.search(input, {}, withStatus, {});
  assert.deepEqual(open.rows.map((r) => r.id).sort(), ['def', 'good', 'holes', 'star']);
  assert.equal(open.skipped.status, 2);
  assert.equal(R.search(input, {}, withStatus, { statuses: 'all' }).rows.length, 6);
  assert.deepEqual(R.search(input, {}, withStatus, { statuses: ['rejected'] }).rows.map((r) => r.id), ['weak']);
  assert.equal(R.search(input, {}, withStatus, { statuses: [] }).rows.length, 0);
  const skip = R.search(input, {}, pool, { maxAge: 27, maxPrice: 6000000, positions: ['ST'], query: 'a', excludeIds: ['holes'] }).skipped;
  assert.deepEqual(Object.keys(skip).sort(), ['age', 'excluded', 'position', 'price', 'query', 'status', 'wage']);
});

test('search: příznaky neznámých údajů u každého řádku a částečný výpočet; počet řádků se omezí a total říká, kolik jich bylo', () => {
  const input = mini();
  const res = R.search(input, {}, POOL(), {});
  const flags = (id) => res.rows.find((r) => r.id === id).flags;
  assert.deepEqual(flags('weak'), ['cena neznámá (UNKNOWN)', 'mzda neznámá (UNKNOWN)']);
  assert.ok(flags('holes').includes('věk neuveden') && flags('holes').includes('cena neznámá (UNKNOWN)'));
  assert.deepEqual(flags('good'), []);
  const nopos = cand('np', 'Bez Pozice', [], { Finishing: 15, Pace: 15, Tackling: 4, Strength: 8 }, { age: 20 });
  assert.ok(R.search(input, {}, [nopos], {}).rows[0].flags.includes('pozice neuvedena'));
  const partial = R.search(input, { allowPartial: true, minCoverage: 0.3 }, [cand('p1', 'Částečný', ['ST'], { Finishing: 17 }, { age: 22, price: 1, wage: 1 })], {}).rows[0];
  assert.equal(partial.known, true);
  assert.ok(partial.flags.includes('část atributů chybí (částečný výpočet)'));
  const many = Array.from({ length: 70 }, (_, i) => cand('m' + i, 'Hráč ' + String(i).padStart(2, '0'), ['ST'], { Finishing: 5 + (i % 10), Pace: 8, Tackling: 4, Strength: 8 }));
  const lim = R.search(input, {}, many, {});
  assert.equal(lim.rows.length, R.LIMITS.maxRows);
  assert.equal(lim.total, 70);
  assert.equal(lim.shown, R.LIMITS.maxRows);
  assert.equal(R.search(input, {}, many, { maxRows: 5 }).rows.length, 5);
  assert.equal(R.search(input, {}, many, { maxRows: 5000 }).rows.length, 70);
  assert.equal(R.search(input, {}, many, { maxRows: 0 }).rows.length, R.LIMITS.maxRows);
  const huge = Array.from({ length: 230 }, (_, i) => cand('h' + i, 'Velký ' + i, ['ST'], { Finishing: 10, Pace: 10, Tackling: 4, Strength: 8 }));
  const hugeRes = R.search(input, {}, huge, { maxRows: 5000 });
  assert.equal(hugeRes.total, R.LIMITS.maxCandidates);
  assert.equal(hugeRes.rows.length, R.LIMITS.maxCandidates); // maxRows se ořízne na 200 a kandidátů se bere nejvýš 200
});

test('search: při stejné vhodnosti na dvou místech je nejlepším místem to s menším klíčem; důvody neohodnotitelnosti se nezdvojují a je jich nejvýš čtyři', () => {
  const profiles = [mk('Střelec', ['Finishing'], ['Pace'])];
  const two = { slots: [{ key: 'b', pos: 'ST', role: 'Střelec' }, { key: 'a', pos: 'ST', role: 'Střelec' }], players: [P('own1', ['ST'], { Finishing: 10, Pace: 10 }), P('own2', ['ST'], { Finishing: 12, Pace: 12 })], profiles };
  const row = R.search(two, {}, [cand('c', 'Kandidát', ['ST'], { Finishing: 15, Pace: 15 })], {}).rows[0];
  assert.equal(row.bestSlot.slotKey, 'a');
  // brankář na šest různých míst: pokaždé jiný důvod (jiná pozice místa), ukáže se nejvýš čtyři
  const posList = ['ST', 'DC', 'MC', 'AMC', 'DL', 'DR'];
  const slots = posList.map((pos, i) => ({ key: 's' + i, pos, role: 'Střelec' }));
  const gk = R.search({ slots, players: [P('p', ['ST'], { Finishing: 10, Pace: 10 })], profiles }, {}, [cand('g', 'Brankář', ['GK'], { Finishing: 10, Pace: 10 })], {}).rows[0];
  assert.equal(gk.known, false);
  assert.equal(gk.reasons.length, 4);
  assert.equal(new Set(gk.reasons).size, 4);
  // stejný důvod na všech místech se ukáže jednou
  const same = R.search({ slots: [{ key: 'x', pos: 'ST', role: 'Střelec' }, { key: 'y', pos: 'ST', role: 'Střelec' }], players: [], profiles }, {}, [cand('h', 'Bez Dat', ['ST'], { Pace: 10 })], {}).rows[0];
  assert.equal(same.reasons.length, 1);
  // bez profilu role se nemá s čím porovnat: pevná věta
  const noProfile = R.search({ slots: [{ key: 'x', pos: 'ST', role: 'Neznámá role' }], players: [], profiles: [] }, {}, [cand('i', 'Kdokoli', ['ST'], { Finishing: 10, Pace: 10 })], {}).rows[0];
  assert.equal(noProfile.known, false);
  assert.ok(noProfile.reasons.length >= 1);
  const noSlots = R.search({ slots: [], players: [], profiles: [] }, {}, [cand('j', 'Kdokoli', ['ST'], { Finishing: 10, Pace: 10 })], {}).rows[0];
  assert.deepEqual(noSlots.reasons, ['Žádné místo taktiky nemá roli s profilem, takže se nemá s čím porovnat.']);
});

test('search: na jedno místo při stejné vhodnosti rozhoduje dopad na celý tým (A, potom B)', () => {
  const input = mini();
  const solo = cand('x', 'Jen Útočník', ['ST'], { Finishing: 18, Pace: 18, Tackling: 3, Strength: 3 });
  const both = cand('y', 'Útočník i Stoper', ['ST', 'DC'], { Finishing: 18, Pace: 18, Tackling: 20, Strength: 20 });
  const rows = R.search(input, {}, [solo, both], { slotKey: 'st' }).rows;
  assert.equal(rows[0].slot.fit, rows[1].slot.fit); // na útočné místo stejně vhodní
  const dx = rows.find((r) => r.id === 'x').impact.deltaA;
  const dy = rows.find((r) => r.id === 'y').impact.deltaA;
  assert.notEqual(dx, dy, 'zkouška má smysl jen při různém dopadu');
  assert.deepEqual(rows.map((r) => r.id), dy > dx ? ['y', 'x'] : ['x', 'y']);
});

test('search: při shodě dopadu na A i B rozhoduje nejlepší vhodnost, potom jméno', () => {
  const input = mini();
  const a = cand('a', 'Zdeněk', ['ST'], { Finishing: 7, Pace: 7, Tackling: 4, Strength: 8 }); // nevejde se nikam
  const b = cand('b', 'Adam', ['ST'], { Finishing: 5, Pace: 5, Tackling: 4, Strength: 8 }); // nevejde se nikam, horší
  const rows = R.search(input, {}, [b, a], {}).rows;
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
  assert.equal(rows[0].impact.deltaA, 0);
  assert.equal(rows[1].impact.deltaA, 0);
  assert.ok(rows[0].bestFit > rows[1].bestFit);
});

test('search: vstupy se nemění; prázdné nebo vadné vstupy nespadnou', () => {
  const frozen = deepFreeze({ input: mini(), opts: { mode: 'strict' }, pool: POOL(), filters: { maxAge: 40, positions: ['ST'], statuses: ['watch'] } });
  const res = R.search(frozen.input, frozen.opts, frozen.pool, frozen.filters);
  assert.ok(res.rows.length > 0);
  for (const bad of [undefined, null, {}, { slots: [], players: [], profiles: [] }]) {
    const r = R.search(bad, {}, POOL(), {});
    assert.ok(Array.isArray(r.rows));
  }
  assert.deepEqual(R.search(mini(), {}, undefined, undefined).rows, []);
  assert.deepEqual(R.search(mini(), {}, [null, 5, 'x', undefined], {}).rows, []);
});

test('search: model DWRS se zapojí a dává stejné pořadí z hlediska dopadu pro zjevně lepšího hráče', () => {
  const full = (v) => Object.fromEntries(DW.OUTFIELD_ATTRIBUTES.map((a) => [a, v]));
  const profile = RF.makeProfile({ name: 'Střelec', key: ['Finishing', 'Composure'], pref: ['Pace'], source: 'user' }, { now: 1 });
  assert.ok(profile.ok, JSON.stringify(profile));
  Object.assign(profile.profile, { group: 'ST' });
  const input = { slots: [{ key: 'st', pos: 'ST', role: 'Střelec' }], players: [P('own', ['ST'], full(10))], profiles: [profile.profile] };
  const better = cand('b', 'Lepší', ['ST'], full(16), { age: 24 });
  const worse = cand('w', 'Horší', ['ST'], full(6), { age: 24 });
  const res = R.search(input, { model: 'dwrs' }, [worse, better], {});
  assert.deepEqual(res.rows.map((r) => r.id), ['b', 'w']);
  assert.match(res.model, /DWRS/);
  assert.ok(res.rows[0].impact.deltaA > 0);
  assert.equal(res.rows[1].impact.deltaA, 0);
});

// ---------------------------------------------------------------- vysvětlení a doporučení
test('explain: čísla, kterými se řadilo, původ ceny a mzdy a výhrada ke skrytým údajům; neohodnotitelný kandidát to řekne', () => {
  const input = mini();
  const row = R.search(input, {}, POOL(), { slotKey: 'st' }).rows[0];
  const text = R.explain(row).join('\n');
  assert.match(text, /Na místě ST \(Střelec\) má vhodnost \d+(,\d)?; nyní tam hraje Hráč s1 s vhodností \d+(,\d)? \(rozdíl \+\d+(,\d)?\)\./);
  assert.match(text, /Po příchodu by hrál: základní sestava, ST Střelec místo Hráč s1\./);
  assert.match(text, /Součet A \d+(,\d)? → \d+(,\d)? \(\+\d+(,\d)?\); součet B/);
  assert.match(text, /Cena: 30 000 000 \(zadal uživatel nebo je v souboru\); mzda: 90 000 \(zadal uživatel nebo je v souboru\)\./);
  assert.match(text, /Potenciál a další skryté údaje hry se nepoužívají/);
  const unknown = R.search(input, {}, POOL(), {}).rows.find((r) => r.id === 'holes');
  const t2 = R.explain(unknown).join('\n');
  assert.match(t2, /Vhodnost nejde spočítat: .* Nic se nedopočítává\./);
  assert.match(t2, /Cena: neznámá \(UNKNOWN\), neodhaduje se; mzda: neznámá \(UNKNOWN\), neodhaduje se\./);
  const bench = R.explain({ candidate: POOL()[2], known: true, bestSlot: { pos: 'ST', role: 'Střelec' }, bestFit: 40.5, impact: { ok: true, placements: [], a: { before: 70, after: 70 }, b: null, deltaA: 0, deltaB: null }, reasons: [], slot: null, flags: [] });
  assert.match(bench.join('\n'), /Nejlépe se hodí na místo ST \(Střelec\) s vhodností 40,5\./);
  assert.match(bench.join('\n'), /nevešel ani do základní sestavy, ani na lavičku B/);
  const onBench = R.explain(R.search(input, {}, [POOL()[0]], {}).rows[0]).join('\n');
  assert.match(onBench, /Po příchodu by hrál: lavička B, ST Střelec místo Hráč s2\./);
  assert.doesNotMatch(onBench, /základní sestava/);
  const vacant = { slots: input.slots, players: input.players.filter((p) => !p.positions.includes('ST')), profiles: input.profiles };
  const vrow = R.search(vacant, {}, [POOL()[0]], { slotKey: 'st' }).rows[0];
  assert.equal(vrow.slot.current, null);
  const vtext = R.explain(vrow).join('\n');
  assert.match(vtext, /; místo je dosud neobsazené\./);
  assert.match(vtext, /Po příchodu by hrál: základní sestava, ST Střelec \(dosud neobsazeno\)\./);
  const lower = R.search(input, {}, [POOL()[2]], { slotKey: 'st' }).rows[0];
  assert.ok(lower.slot.fitDelta < 0);
  assert.match(R.explain(lower).join('\n'), /\(rozdíl -\d+(,\d)?\)/);
  const eur = R.search(input, {}, [cand('e', 'Za Eura', ['ST'], { Finishing: 15, Pace: 15, Tackling: 4, Strength: 8 }, { price: '€1.5M', wage: '€20,000 p/w' })], {}).rows[0];
  assert.match(R.explain(eur).join('\n'), /Cena: 1 500 000 € \(zadal.*mzda: 20 000 € \(zadal/);
  assert.deepEqual(R.explain(null), []);
  assert.deepEqual(R.explain('x'), []);
});

test('buildRecommendation: záznam má kandidáta, místo, model, doklady, očekávaný přínos a prázdný výsledek; bez uloženého kandidáta ne', () => {
  const input = mini();
  const row = R.search(input, {}, POOL(), { slotKey: 'st' }).rows[0];
  const b = R.buildRecommendation(row, { careerId: 'car1', now: 1000, modelNote: 'jednoduchý vážený průměr' });
  assert.equal(b.ok, true);
  const rec = b.recommendation;
  assert.equal(rec.kind, 'transfer');
  assert.equal(rec.careerId, 'car1');
  assert.equal(rec.at, 1000);
  assert.equal(rec.candidateId, 'star');
  assert.equal(rec.candidateName, 'Hvězda');
  assert.deepEqual(rec.snapshot, { age: 31, positions: ['ST'], club: '', price: 30000000, wage: 90000, currency: '' });
  assert.deepEqual(rec.slot, { slotKey: 'st', pos: 'ST', role: 'Střelec' });
  assert.equal(rec.model, 'jednoduchý vážený průměr');
  assert.ok(rec.evidence.length >= 4 && rec.evidence.length <= 8);
  assert.ok(rec.expected.deltaA > 0);
  assert.equal(rec.expected.fit, row.slot.fit);
  assert.equal(rec.result, null);
  // očekávaná vhodnost je vždy ta z vybraného místa, ne nejlepší z jiného místa
  const versatile = cand('v', 'Univerzál', ['ST', 'DC'], { Finishing: 12, Pace: 12, Tackling: 20, Strength: 20 }, { age: 25 });
  const vrow = R.search(input, {}, [versatile], { slotKey: 'st' }).rows[0];
  assert.ok(vrow.bestFit > vrow.slot.fit, 'zkouška má smysl, jen když je nejlepší místo jiné než vybrané');
  assert.equal(R.buildRecommendation(vrow, {}).recommendation.expected.fit, vrow.slot.fit);
  // doporučení z hledání pro celý tým bere místo z místa, kde by kandidát hrál
  const whole = R.search(input, {}, POOL(), {}).rows[0];
  assert.equal(R.buildRecommendation(whole, {}).recommendation.slot.slotKey, 'st');
  assert.equal(R.buildRecommendation(whole, {}).recommendation.model, whole.impact.model);
  assert.equal(R.buildRecommendation(whole, {}).recommendation.careerId, null);
  assert.equal(R.buildRecommendation(whole, {}).recommendation.at, null);
  // kandidát bez id (neuložený) se nedoporučuje
  const noId = R.search(input, {}, [R.normalizeCandidate({ name: 'Bez Id', positions: ['ST'], attributes: { Finishing: 12, Pace: 12, Tackling: 4, Strength: 8 } }).candidate], {}).rows[0];
  assert.equal(R.buildRecommendation(noId, {}).ok, false);
  assert.equal(R.buildRecommendation(null, {}).ok, false);
  assert.equal(R.buildRecommendation({}, {}).ok, false);
});

test('setResult: výsledek se zapíše jen s platným rozhodnutím a hodnocením; původní záznam se nemění', () => {
  const rec = deepFreeze({ kind: 'transfer', candidateId: 'star', result: null });
  const ok = R.setResult(rec, { decision: 'signed', verdict: 'good', note: ' výborný ', at: 5 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.recommendation.result, { decision: 'signed', verdict: 'good', note: 'výborný', at: 5 });
  assert.equal(rec.result, null);
  assert.deepEqual(R.setResult(rec, { decision: 'passed' }).recommendation.result, { decision: 'passed', verdict: null, note: '', at: null });
  assert.equal(R.setResult(rec, { decision: 'lost', verdict: null }).ok, true);
  for (const bad of [undefined, null, {}, { decision: 'koupil' }, { decision: 'signed', verdict: 'skvělé' }, { decision: 'passed', verdict: 'good' }, { decision: 'lost', verdict: 'bad' }]) {
    const r = R.setResult(rec, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.issues.length === 1);
  }
  assert.equal(R.setResult(null, { decision: 'signed' }).ok, false);
  assert.equal(R.setResult(rec, { decision: 'signed', note: 'x'.repeat(500) }).recommendation.result.note.length, R.LIMITS.resultNoteMax);
});

test('recommendationStats: počty a podíl dobrých výsledků jen z hodnocených koupených hráčů; při malém počtu to říká', () => {
  const r = (decision, verdict) => ({ result: decision ? { decision, verdict: verdict || null } : null });
  assert.deepEqual(R.recommendationStats([]), { total: 0, open: 0, signed: 0, passed: 0, lost: 0, rated: 0, good: 0, neutral: 0, bad: 0, hitRate: null, note: 'Zatím není žádný koupený hráč s tvým hodnocením, úspěšnost nejde spočítat.' });
  const few = R.recommendationStats([r(null), r('signed', 'good'), r('signed', 'good'), r('signed', 'bad'), r('passed'), r('lost'), r('signed')]);
  assert.deepEqual({ total: few.total, open: few.open, signed: few.signed, passed: few.passed, lost: few.lost, rated: few.rated, good: few.good, bad: few.bad, hitRate: few.hitRate }, { total: 7, open: 1, signed: 4, passed: 1, lost: 1, rated: 3, good: 2, bad: 1, hitRate: 66.7 });
  assert.match(few.note, /jen 3.*66,7 %.*nic nedokazuje/);
  const many = R.recommendationStats(Array.from({ length: 10 }, (_, i) => r('signed', i < 7 ? 'good' : i < 9 ? 'neutral' : 'bad')));
  assert.equal(many.hitRate, 70);
  assert.match(many.note, /dopadlo dobře 7 z 10 koupených hráčů \(70 %\)\. Je to tvoje hodnocení, ne údaj hry\./);
  assert.equal(R.recommendationStats([r('signed', 'good'), r('signed', 'good'), r('signed', 'good'), r('signed', 'good'), r('signed', 'good')]).note.includes('nic nedokazuje'), false);
  assert.equal(R.recommendationStats([r('signed', 'good'), r('signed', 'good'), r('signed', 'good'), r('signed', 'good')]).note.includes('nic nedokazuje'), true);
  const odd = R.recommendationStats([{ result: { decision: 'passed', verdict: 'good' } }, { result: { decision: 'lost', verdict: 'bad' } }, { result: { decision: 'signed', verdict: 'good' } }]);
  assert.deepEqual([odd.rated, odd.good, odd.bad, odd.passed, odd.lost, odd.signed], [1, 1, 0, 1, 1, 1]); // hodnocení u nekoupeného hráče se nepočítá
  assert.equal(R.recommendationStats(undefined).total, 0);
  assert.equal(R.recommendationStats([null, 5, 'x']).total, 0);
  assert.equal(R.recommendationStats([{ result: 'divné' }]).open, 1); // vadný výsledek se nepočítá jako zapsaný: doporučení je dál otevřené
});

test('konstanty: stavy, rozhodnutí a hodnocení mají české popisky a meze jsou zmrazené', () => {
  for (const s of R.STATUSES) assert.ok(R.STATUS_CS[s], s);
  for (const d of R.DECISIONS) assert.ok(R.DECISION_CS[d], d);
  for (const v of R.VERDICTS) assert.ok(R.VERDICT_CS[v], v);
  assert.deepEqual(R.OPEN_STATUSES, ['watch', 'enquiry', 'offer', 'agreed']);
  assert.ok(Object.isFrozen(R.LIMITS) && Object.isFrozen(R.STATUSES) && Object.isFrozen(R.STATUS_CS));
  assert.deepEqual(R.CANDIDATE_ROLES, ['ignore', 'name', 'positions', 'age', 'club', 'price', 'wage', 'contract', 'attribute']);
  for (const r of R.CANDIDATE_ROLES) assert.ok(R.CANDIDATE_ROLE_LABEL[r], r);
  assert.deepEqual({ ...R.LIMITS }, { nameMin: 2, nameMax: 60, ageMin: 14, ageMax: 50, maxPositions: 4, maxAttributes: 40, attrNameMax: 30, clubMax: 60, notesMax: 400, dealNoteMax: 200, contractMax: 24, currencyMax: 4, maxCandidates: 200, maxRecommendations: 300, resultNoteMax: 300, moneyMax: 1e10, maxRows: 50, minHitCases: 5 });
});

// ---------------------------------------------------------------- zdroj
test('zdroj: čistý modul (žádný DOM, síť, úložiště, náhoda ani čas) a bez řídicích a přepínacích znaků (úplné hlídání neviditelných znaků je v sanitize.test.mjs)', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.|window\.|fetch\(|XMLHttpRequest|localStorage|Math\.random|Date\.now|new Date\(\)|crypto\./);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]'));
});
