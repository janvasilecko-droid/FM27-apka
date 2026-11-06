import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const SO = require('../src/squadopt.js');
const RF = require('../src/rolefit.js');
const DW = require('../src/dwrs.js');
const source = readFileSync(new URL('../src/squadopt.js', import.meta.url), 'utf8');

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
const mk = (name, key, pref, extra) => {
  const r = RF.makeProfile({ name, key, pref, source: 'user' }, { now: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  return Object.assign(r.profile, extra || {});
};
const P = (id, positions, attributes, extra) => Object.assign({ id, name: 'Hráč ' + id, positions, attributes }, extra || {});
const OUT = DW.OUTFIELD_ATTRIBUTES;
const full = (v) => Object.fromEntries(OUT.map((a) => [a, v]));
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// ---------------------------------------------------------------- nezávislá věštírna: hrubá síla přes všechna přiřazení
/** val[i][j] = desetiny bodu, nebo null; locks Map i → j; off Set j; lockedVal[i] = hodnota zamčené dvojice (bez ohledu na pozici) nebo null.
    Vrací nejlepší čtveřici [obsazená místa A, součet A, obsazená místa B, součet B] v pořadí důležitosti. */
function brute(n, m, val, locks, off, lockedVal, bench) {
  const lockedPlayers = new Set(locks.values());
  const free = [];
  for (let j = 0; j < m; j++) if (!off.has(j) && !lockedPlayers.has(j)) free.push(j);
  let lockedN = 0;
  let lockedT = 0;
  for (const [i] of locks) {
    if (lockedVal[i] !== null) {
      lockedN++;
      lockedT += lockedVal[i];
    }
  }
  const aRows = [];
  for (let i = 0; i < n; i++) if (!locks.has(i)) aRows.push(i);
  const cmp = (x, y) => {
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k];
    return 0;
  };
  // nejlepší [počet, součet] pro řádky rows z volných hráčů mimo `used`
  function bestTeam(rows, used) {
    let best = [-1, -1];
    (function rec(k, usedNow, cnt, tot) {
      if (k === rows.length) {
        if (cmp([cnt, tot], best) > 0) best = [cnt, tot];
        return;
      }
      rec(k + 1, usedNow, cnt, tot); // místo zůstane prázdné
      for (const j of free) {
        if (usedNow.has(j) || val[rows[k]][j] === null) continue;
        usedNow.add(j);
        rec(k + 1, usedNow, cnt + 1, tot + val[rows[k]][j]);
        usedNow.delete(j);
      }
    })(0, new Set(used), 0, 0);
    return best;
  }
  const allRows = [];
  for (let i = 0; i < n; i++) allRows.push(i);
  let best = null;
  (function recA(k, used, cnt, tot) {
    if (k === aRows.length) {
      const b = bench ? bestTeam(allRows, used) : [0, 0];
      const cand = [cnt + lockedN, tot + lockedT, b[0], b[1]];
      if (!best || cmp(cand, best) > 0) best = cand;
      return;
    }
    recA(k + 1, used, cnt, tot);
    for (const j of free) {
      if (used.has(j) || val[aRows[k]][j] === null) continue;
      used.add(j);
      recA(k + 1, used, cnt + 1, tot + val[aRows[k]][j]);
      used.delete(j);
    }
  })(0, new Set(), 0, 0);
  return best;
}

// ---------------------------------------------------------------- náhodné úlohy
const FM_POS = ['DR', 'DC', 'DM', 'ST', 'ST', 'DC', 'GK', 'AML'];
const SLOT_POS = ['RB', 'RCB', 'LCB', 'DM', 'ST', 'ST', 'GK', 'LW'];
const SIMPLE_ATTRS = ['Finishing', 'Pace', 'Tackling', 'Strength', 'Passing', 'Vision', 'Marking', 'Heading', 'Dribbling'];

function randomCase(rand, model) {
  const n = 1 + Math.floor(rand() * 3);
  const m = n + 1 + Math.floor(rand() * 4); // aspoň o jednoho hráče víc než míst: lavička se obsazuje opravdu často
  const slots = [];
  const profiles = [];
  for (let i = 0; i < n; i++) {
    const hasRole = rand() > 0.12;
    const pos = pick(rand, SLOT_POS);
    const role = 'Role ' + (i % 2);
    slots.push({ key: 's' + i, pos, role: hasRole ? role : '', duty: 'Support' });
  }
  for (let r = 0; r < 2; r++) {
    const key = [pick(rand, SIMPLE_ATTRS), pick(rand, SIMPLE_ATTRS)];
    const pref = [pick(rand, SIMPLE_ATTRS)];
    if (rand() > 0.15) profiles.push(mk('Role ' + r, [...new Set(key)], pref.filter((x) => !key.includes(x)), model === 'dwrs' ? {} : {}));
  }
  const players = [];
  for (let j = 0; j < m; j++) {
    const attributes = {};
    const names = model === 'dwrs' ? OUT : SIMPLE_ATTRS;
    for (const a of names) if (model === 'dwrs' ? true : rand() > 0.08) attributes[a] = 1 + Math.floor(rand() * 20);
    if (model === 'dwrs' && rand() > 0.8) delete attributes[pick(rand, OUT)];
    const positions = rand() > 0.1 ? [pick(rand, FM_POS), ...(rand() > 0.6 ? [pick(rand, FM_POS)] : [])] : [];
    players.push(P('p' + j, positions, attributes, { injured: rand() > 0.85 }));
  }
  const opts = {
    model,
    mode: rand() > 0.7 ? 'free' : 'strict',
    allowPartial: rand() > 0.6,
    minCoverage: 0.5,
    wp: model === 'dwrs' ? pick(rand, DW.presets()) : undefined,
    exclude: [],
    locks: {},
  };
  for (const p of players) if (rand() > 0.88) opts.exclude.push(p.id);
  const lockedTaken = new Set();
  slots.forEach((s, i) => {
    if (rand() > 0.82) {
      const p = pick(rand, players);
      if (!lockedTaken.has(p.id) && !opts.exclude.includes(p.id) && p.injured !== true) {
        opts.locks[s.key] = p.id;
        lockedTaken.add(p.id);
      }
    }
  });
  return { input: { slots, players, profiles }, opts };
}

/** Matice hodnot a zamčených hodnot počítaná přímo z rolefit.js a dwrs.js (ne přes squadopt). */
function oracleMatrix(input, opts) {
  const idx = RF.profilesIndex(input.profiles);
  const val = [];
  const lockedFn = [];
  input.slots.forEach((s) => {
    const profile = typeof s.role === 'string' && s.role.trim() ? idx.get(RF.roleKey(s.role)) || null : null;
    const group = profile ? DW.groupOfPosition(s.pos) || DW.groupOfRole(profile) : null;
    const compute = (pl) => {
      if (!profile) return null;
      let value;
      if (opts.model === 'dwrs') {
        if (!group) return null;
        const r = DW.score(pl, profile, group, opts.wp);
        value = DW.valueOf(r, opts.allowPartial, opts.minCoverage).value;
      } else {
        const r = RF.roleFit(pl, profile, {});
        value = r.score;
        if (value === null && opts.allowPartial && r.partial && r.partial.coverage >= opts.minCoverage) value = r.partial.score;
      }
      return value === null ? null : Math.round(value * 10);
    };
    val.push(input.players.map((pl) => {
      if (!RF.eligibility(s.pos, pl.positions, opts.mode).ok) return null;
      return compute(pl);
    }));
    lockedFn.push(compute);
  });
  return { val, lockedFn };
}

function checkAgainstBrute(model, seeds, bench) {
  let withLocks = 0;
  let withB = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rand = rng(seed * 7919 + (model === 'dwrs' ? 17 : 3));
    const { input, opts } = randomCase(rand, model);
    opts.bench = bench;
    const res = SO.optimize(input, Object.assign({}, opts, { quick: true }));
    const { val, lockedFn } = oracleMatrix(input, opts);
    const idIndex = new Map(input.players.map((p, j) => [p.id, j]));
    const off = new Set();
    input.players.forEach((p, j) => { if (p.injured === true || opts.exclude.includes(p.id)) off.add(j); });
    const locks = new Map();
    for (const [key, id] of Object.entries(opts.locks)) locks.set(input.slots.findIndex((s) => s.key === key), idIndex.get(id));
    const lockedVal = input.slots.map((s, i) => (locks.has(i) ? lockedFn[i](input.players[locks.get(i)]) : null));
    const expected = brute(input.slots.length, input.players.length, val, locks, off, lockedVal, bench);
    const got = [res.a.valued, res.a.tenths, res.b ? res.b.valued : 0, res.b ? res.b.tenths : 0];
    assert.deepEqual(got, expected, `seed ${seed} ${model}: ${JSON.stringify({ got, expected, locks: opts.locks, exclude: opts.exclude })}`);
    if (locks.size) withLocks++;
    if (res.b && res.b.valued) withB++;
    // stavba výsledku: nikdo dvakrát, zamčení na svých místech, vyřazení a zranění nikde, hodnoty sedí na věštírnu
    const seen = new Set();
    for (const [list, team] of [[res.a.assignments, 'A'], [res.b ? res.b.assignments : [], 'B']]) {
      list.forEach((a, i) => {
        if (!a.player) return;
        assert.ok(!seen.has(a.player.id), `seed ${seed}: hráč ${a.player.id} dvakrát`);
        seen.add(a.player.id);
        const j = idIndex.get(a.player.id);
        assert.ok(!off.has(j), `seed ${seed}: nedostupný hráč v sestavě`);
        if (team === 'A' && locks.has(i)) assert.equal(j, locks.get(i), `seed ${seed}: zámek nedrží`);
        else if (team === 'A' || locks.get(i) !== j) assert.equal(a.fit === null ? null : Math.round(a.fit * 10), val[i][j], `seed ${seed}: hodnota ${team}${i}`);
      });
    }
    for (const [i, j] of locks) assert.equal(res.a.assignments[i].player.id, input.players[j].id);
    for (const [i, j] of locks) for (let k = 0; k < input.slots.length; k++) if (res.b) assert.notEqual(res.b.assignments[k].player && res.b.assignments[k].player.id, input.players[j].id, `seed ${seed}: zamčený i na lavičce (${i})`);
  }
  return { withLocks, withB };
}

// ---------------------------------------------------------------- správnost proti hrubé síle
test('jednoduchý model: sestava A + B je přesně optimální v přísném pořadí (240 náhodných úloh, zámky, vyřazení, zranění)', () => {
  const r = checkAgainstBrute('simple', 240, true);
  assert.ok(r.withLocks > 20 && r.withB > 80, JSON.stringify(r)); // zkouška opravdu prošla i zámky a lavičkou
});

test('DWRS: sestava A + B je přesně optimální v přísném pořadí (150 náhodných úloh s přednastaveními vah)', () => {
  const r = checkAgainstBrute('dwrs', 150, true);
  assert.ok(r.withLocks > 10 && r.withB > 50, JSON.stringify(r));
});

test('bez lavičky (bench:false) je to optimum jen pro A', () => {
  checkAgainstBrute('simple', 120, false);
  checkAgainstBrute('dwrs', 60, false);
});

test('shoda se starou funkcí assignBest: stejný počet obsazených míst a stejný součet pro A bez omezení', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rand = rng(seed * 104729);
    const { input, opts } = randomCase(rand, 'simple');
    const clean = { model: 'simple', mode: opts.mode, allowPartial: opts.allowPartial, minCoverage: opts.minCoverage, bench: false, respectInjuries: false };
    const a = SO.optimize(input, clean);
    const b = RF.assignBest(input, { mode: opts.mode, allowPartial: opts.allowPartial, minCoverage: opts.minCoverage });
    assert.equal(a.a.valued, b.filled, `seed ${seed}`);
    assert.equal(a.a.total, b.total, `seed ${seed}`);
  }
});

test('B nikdy nepřebije A: stejné A jako bez lavičky, lavička jen z těch, kdo zbyli', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rand = rng(seed * 6007);
    const { input, opts } = randomCase(rand, 'simple');
    const withB = SO.optimize(input, Object.assign({}, opts, { bench: true, quick: true }));
    const noB = SO.optimize(input, Object.assign({}, opts, { bench: false, quick: true }));
    assert.equal(withB.a.valued, noB.a.valued, `seed ${seed}`);
    assert.equal(withB.a.tenths, noB.a.tenths, `seed ${seed}`);
  }
});

test('pořadí cílů: A se neobětuje kvůli B, ale při shodě v A se vybere nejlepší B', () => {
  // dva útočníci na jedno místo A: oba mají stejnou vhodnost pro A, ale jen jeden se hodí i na místo B (druhé místo)
  const profiles = [mk('Střelec', ['Finishing'], []), mk('Tvůrce', ['Vision'], [])];
  const slots = [{ key: 'a', pos: 'ST', role: 'Střelec' }, { key: 'b', pos: 'AM', role: 'Tvůrce' }];
  const players = [
    P('x', ['ST', 'AMC'], { Finishing: 15, Vision: 5 }),
    P('y', ['ST', 'AMC'], { Finishing: 15, Vision: 18 }),
    P('z', ['AMC'], { Finishing: 3, Vision: 12 }),
  ];
  const r = SO.optimize({ slots, players, profiles }, { bench: true, quick: true });
  // optimum A: x nebo y na ST (75), nejlepší tvůrce na AM je y (90); y má jít na AM, x na ST: součet A 75 + 90 = 165 není dosažitelný,
  // protože ST obsadí x (75) a AM obsadí y (90); jiné rozdělení (y na ST, z na AM 60) dává jen 135
  assert.equal(r.a.assignments[0].player.id, 'x');
  assert.equal(r.a.assignments[1].player.id, 'y');
  assert.equal(r.a.total, 165);
  assert.equal(r.b.assignments[1].player.id, 'z'); // z jediný zbyl: lavička se nedělá z těch, kdo už hrají v A
});

test('shoda v A rozhodne B: dva různé způsoby sestavení A se stejným součtem, vybere se ten s lepší lavičkou', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const slots = [{ key: 'a', pos: 'ST', role: 'R' }];
  const players = [
    P('p1', ['ST'], { Pace: 10 }),
    P('p2', ['ST'], { Pace: 10 }), // stejná vhodnost jako p1 → A je shoda
    P('p3', ['ST'], { Pace: 4 }),
  ];
  const r = SO.optimize({ slots, players, profiles }, { quick: true });
  assert.equal(r.a.total, r.a.assignments[0].fit);
  assert.equal(r.b.assignments[0].fit, 50); // druhý z dvojice 10/10 je lavička, ne hráč s 4
});

test('obsazená místa mají přednost před součtem: v A i v B se raději obsadí dvě místa slabšími hráči než jedno silnějším', () => {
  const profiles = [mk('R1', ['Finishing'], []), mk('R2', ['Tackling'], [])];
  const slots = [{ key: 's1', pos: 'ST', role: 'R1' }, { key: 's2', pos: 'DC', role: 'R2' }];
  const x = P('x', ['ST', 'DC'], { Finishing: 16, Tackling: 2 }); // R1 80, R2 10
  const y = P('y', ['ST'], { Finishing: 10, Tackling: 1 }); // R1 50
  // jen x a y: nejvyšší součet (x na s1 = 80, s2 prázdné) by obsadil jedno místo; správně je y na s1 (50) a x na s2 (10): dvě místa
  const a = SO.optimize({ slots, players: [x, y], profiles }, { bench: false, quick: true });
  assert.equal(a.a.valued, 2);
  assert.equal(a.a.total, 60);
  assert.deepEqual(a.a.assignments.map((q) => q.player.id), ['y', 'x']);
  // totéž v lavičce: A obsadí a1 a a2 (po 100), B má stejnou volbu mezi 80 a jedním místem a 50 + 10 se dvěma místy
  const a1 = P('a1', ['ST'], { Finishing: 20 });
  const a2 = P('a2', ['DC'], { Tackling: 20 });
  const r = SO.optimize({ slots, players: [a1, a2, x, y], profiles }, { quick: true });
  assert.deepEqual(r.a.assignments.map((q) => q.player.id), ['a1', 'a2']);
  assert.equal(r.a.total, 200);
  assert.equal(r.b.valued, 2);
  assert.equal(r.b.total, 60);
});

test('při úplné shodě rozhoduje pořadí v seznamu hráčů (výsledek je stálý a předvídatelný)', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const slots = [{ key: 'a', pos: 'ST', role: 'R' }];
  const eq = (id) => P(id, ['ST'], { Pace: 10 });
  const r1 = SO.optimize({ slots, players: [eq('p1'), eq('p2'), eq('p3')], profiles }, { quick: true });
  assert.equal(r1.a.assignments[0].player.id, 'p1');
  assert.equal(r1.b.assignments[0].player.id, 'p2');
  const r2 = SO.optimize({ slots, players: [eq('p3'), eq('p2'), eq('p1')], profiles }, { quick: true });
  assert.equal(r2.a.assignments[0].player.id, 'p3');
  assert.equal(r2.b.assignments[0].player.id, 'p2');
});

test('stálost: stejný vstup dá stejný výstup a vstup se nezmění (zmrazený vstup nespadne)', () => {
  const rand = rng(99);
  const { input, opts } = randomCase(rand, 'dwrs');
  const frozen = deepFreeze(JSON.parse(JSON.stringify({ input, opts })));
  const a = SO.optimize(frozen.input, frozen.opts);
  const b = SO.optimize(frozen.input, frozen.opts);
  assert.deepEqual(a, b);
  const sim = SO.simulateChange(frozen.input, frozen.opts, { type: 'exclude', playerId: frozen.input.players[0].id });
  assert.ok(sim.ok);
  SO.injuryImpact(frozen.input, frozen.opts);
});

test('prázdné vstupy nespadnou: žádná místa, žádní hráči, žádné profily', () => {
  for (const input of [undefined, null, {}, { slots: [], players: [], profiles: [] }, { slots: [{ key: 'a', pos: 'ST', role: 'R' }], players: [], profiles: [] }]) {
    const r = SO.optimize(input, {});
    assert.ok(r.a && Array.isArray(r.a.assignments));
    assert.equal(r.a.valued, 0);
    assert.ok(Array.isArray(r.leftOut));
  }
  const r = SO.optimize({ slots: [{ key: 'a', pos: 'ST', role: 'R' }], players: [P('p', ['ST'], { Pace: 10 })], profiles: [] }, {});
  assert.equal(r.a.assignments[0].player, null);
  assert.match(r.a.assignments[0].reason, /Chybí profil role/);
  assert.deepEqual(r.missingProfiles, ['R']);
});

test('příliš velká úloha: kódování by přetéklo, a proto se odmítne místo špatného výsledku', () => {
  const slots = Array.from({ length: 100 }, (_, i) => ({ key: 's' + i, pos: 'ST', role: 'R' }));
  const players = Array.from({ length: 100 }, (_, j) => P('p' + j, ['ST'], { Pace: 10 }));
  assert.throws(() => SO.optimize({ slots, players, profiles: [mk('R', ['Pace'], [])] }, { quick: true }), RangeError);
});

test('rychlost: jedenáct míst a čtyřicet hráčů s lavičkou, náhradami a dopadem zranění se spočítá pod dvě sekundy', () => {
  const rand = rng(5);
  const profiles = [mk('R1', ['Pace', 'Finishing'], ['Strength']), mk('R2', ['Tackling'], ['Marking'])];
  const slots = Array.from({ length: 11 }, (_, i) => ({ key: 's' + i, pos: i < 4 ? 'RCB' : 'ST', role: i < 4 ? 'R2' : 'R1' }));
  const players = Array.from({ length: 40 }, (_, j) => P('p' + j, [rand() > 0.5 ? 'DC' : 'ST'], Object.fromEntries(SIMPLE_ATTRS.map((a) => [a, 1 + Math.floor(rand() * 20)]))));
  const t0 = Date.now();
  const r = SO.optimize({ slots, players, profiles }, {});
  SO.injuryImpact({ slots, players, profiles }, {});
  assert.ok(Date.now() - t0 < 2000, `trvalo ${Date.now() - t0} ms`);
  assert.equal(r.a.assignments.length, 11);
});

// ---------------------------------------------------------------- omezení
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

test('zámek drží: hráč je na svém místě i když by optimum bylo jiné, a nikde jinde (ani na lavičce)', () => {
  const input = mini();
  const r = SO.optimize(input, { locks: { st: 's3' } });
  assert.equal(r.a.assignments[0].player.id, 's3');
  assert.equal(r.a.assignments[0].locked, true);
  assert.ok(r.b.assignments.every((a) => !a.player || a.player.id !== 's3'));
  assert.deepEqual(r.locks, [{ slotKey: 'st', playerId: 's3' }]);
});

test('zámek mimo pozici platí s příznakem a hodnota se spočte; bez hodnoty je to řečeno', () => {
  const input = mini();
  const r = SO.optimize(input, { locks: { cb: 's1' } });
  const cb = r.a.assignments[1];
  assert.equal(cb.player.id, 's1');
  assert.match(cb.flag, /nemá pozici místa/);
  // Tackling 4 (klíčový, váha 2) a Strength 8 (žádoucí, váha 1): (4·2 + 8·1) / (20·3) = 26,7; počítáno nezávisle přímo z rolefit.js
  assert.equal(cb.fit, RF.roleFit(input.players[0], input.profiles[1]).score);
  assert.equal(cb.fit, 26.7);
});

test('zámek bez spočitatelné vhodnosti: hráč je na místě, vhodnost je null a důvod je v textu', () => {
  const input = mini();
  input.players.push(P('nodata', ['DC'], { Pace: 10 }));
  const r = SO.optimize(input, { locks: { cb: 'nodata' } });
  const cb = r.a.assignments[1];
  assert.equal(cb.player.id, 'nodata');
  assert.equal(cb.fit, null);
  assert.match(cb.reason, /Zamčeno uživatelem, ale vhodnost nejde spočítat/);
  assert.match(cb.reason, /chybí atributy/i);
  assert.equal(r.a.valued, 1);
  assert.equal(r.a.filled, 2);
});

test('nepoužitelné zámky se nepřijmou a je to řečeno: neznámé místo, neznámý hráč, zraněný, vyřazený, dvakrát stejný hráč', () => {
  const input = mini();
  input.players[0].injured = true;
  const r = SO.optimize(input, { locks: { nope: 's2', st: 'ghost', cb: 's1' }, exclude: [] });
  assert.equal(r.locks.length, 0);
  assert.ok(r.issues.some((x) => /takové místo taktika nemá/.test(x)));
  assert.ok(r.issues.some((x) => /není v soupisce/.test(x)));
  assert.ok(r.issues.some((x) => /zraněný nebo nedostupný, zámek se ignoruje/.test(x)));
  const r2 = SO.optimize(mini(), { locks: { st: 's2', cb: 's2' }, exclude: ['s2'] });
  assert.equal(r2.locks.length, 0);
  assert.ok(r2.issues.some((x) => /vyřazen uživatelem, zámek se ignoruje/.test(x)));
  const r3 = SO.optimize(mini(), { locks: { st: 's2', cb: 's2' } });
  assert.equal(r3.locks.length, 1);
  assert.ok(r3.issues.some((x) => /dvou místech/.test(x)));
});

test('zranění a vyřazení: takový hráč není v A ani v B, je vidět proč a respectInjuries:false zranění ignoruje', () => {
  const input = mini();
  input.players[0].injured = true; // nejlepší útočník
  const r = SO.optimize(input, { exclude: ['c1'] });
  const ids = [...r.a.assignments, ...r.b.assignments].filter((a) => a.player).map((a) => a.player.id);
  assert.ok(!ids.includes('s1') && !ids.includes('c1'));
  assert.deepEqual(r.leftOut.filter((x) => x.code === 'injured').map((x) => x.id), ['s1']);
  assert.deepEqual(r.leftOut.filter((x) => x.code === 'excluded').map((x) => x.id), ['c1']);
  assert.deepEqual(r.unavailable.map((x) => x.id).sort(), ['c1', 's1']);
  const ignore = SO.optimize(input, { respectInjuries: false });
  assert.equal(ignore.a.assignments[0].player.id, 's1');
  const byList = SO.optimize(mini(), { unavailable: ['s1'] });
  assert.equal(byList.a.assignments[0].player.id, 's2');
  assert.ok(SO.optimize(mini(), { unavailable: ['ghost'] }).issues.some((x) => /není v soupisce/.test(x)));
});

test('důvody neobsazení: bez role, bez profilu, bez pozice, bez atributů, všichni zranění, všichni obsazení jinde', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const p = (id, pos, attrs, extra) => P(id, pos, attrs, extra);
  const base = (slots, players) => SO.optimize({ slots, players, profiles }, { bench: false, quick: true }).a.assignments.map((a) => a.reason);
  assert.match(base([{ key: 'a', pos: 'ST', role: '' }], [p('x', ['ST'], { Pace: 10 })])[0], /nemá zadanou roli/);
  assert.match(base([{ key: 'a', pos: 'ST', role: 'Neznámá' }], [p('x', ['ST'], { Pace: 10 })])[0], /Chybí profil role „Neznámá“/);
  assert.match(base([{ key: 'a', pos: 'ST', role: 'R' }], [p('x', ['DC'], { Pace: 10 })])[0], /nemá pozici místa \(ST\)/);
  assert.match(base([{ key: 'a', pos: 'ST', role: 'R' }], [p('x', ['ST'], { Strength: 10 })])[0], /nemá všechny atributy role \(chybí například Pace\)/);
  assert.match(base([{ key: 'a', pos: 'ST', role: 'R' }], [p('x', ['ST'], { Pace: 10 }, { injured: true })])[0], /zranění/);
  assert.match(base([{ key: 'a', pos: 'ST', role: 'R' }, { key: 'b', pos: 'ST', role: 'R' }], [p('x', ['ST'], { Pace: 10 })])[1], /obsazeni na jiných místech/);
});

// ---------------------------------------------------------------- náhrady, hloubka, kdo zbyl
test('náhrady: stav (volný, lavička, hraje jinde), naruší jiné místo a dopad na součet odpovídá přepočtu se zámkem', () => {
  const input = mini();
  const r = SO.optimize(input, {});
  const st = r.a.assignments[0];
  assert.equal(st.player.id, 's1');
  const byId = Object.fromEntries(st.alternatives.map((a) => [a.id, a]));
  assert.equal(byId.s2.status, 'bench');
  assert.equal(byId.s3.status, 'free');
  for (const alt of st.alternatives) {
    const locked = SO.optimize(input, { locks: { st: alt.id }, quick: true });
    assert.equal(alt.deltaA, r1(locked.a.total - r.a.total), alt.id);
    assert.equal(alt.deltaB, r1(locked.b.total - r.b.total), alt.id);
    assert.ok(alt.deltaA <= 0);
  }
  // hráč, který hraje jinde: lock ho přesune a naruší druhé místo
  const prof2 = [mk('Univerzál', ['Pace'], [])];
  const slots2 = [{ key: 'l', pos: 'RW', role: 'Univerzál' }, { key: 'r', pos: 'LW', role: 'Univerzál' }];
  const players2 = [P('w1', ['AMR', 'AML'], { Pace: 18 }), P('w2', ['AMR', 'AML'], { Pace: 15 })];
  const r2 = SO.optimize({ slots: slots2, players: players2, profiles: prof2 }, {});
  const alt = r2.a.assignments.find((a) => a.player.id === 'w2').alternatives.find((x) => x.id === 'w1');
  assert.equal(alt.status, 'startsElsewhere');
  assert.equal(alt.disrupts, r2.a.assignments.find((a) => a.player.id === 'w1').slotKey);
  assert.match(alt.text, /naruší to místo/);
});
function r1(v) { return Math.round(v * 10) / 10; }

test('hloubka: nikdo / jediný hráč / pokryto a zranění kandidáti', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const slots = [{ key: 'a', pos: 'ST', role: 'R' }, { key: 'g', pos: 'GK', role: 'R' }, { key: 'd', pos: 'DC', role: 'R' }];
  const players = [P('s1', ['ST'], { Pace: 10 }), P('s2', ['ST'], { Pace: 12 }), P('g1', ['GK'], { Pace: 9 }), P('s3', ['ST'], { Pace: 11 }, { injured: true })];
  const r = SO.optimize({ slots, players, profiles }, {});
  const d = Object.fromEntries(r.depth.map((x) => [x.slotKey, x]));
  assert.equal(d.a.coverage, 'covered');
  assert.equal(d.a.candidates, 2);
  assert.equal(d.a.injuredCandidates, 1);
  assert.equal(d.g.coverage, 'thin');
  assert.equal(d.d.coverage, 'gap');
});

test('kdo zbyl: důvody noSlot, noValue, noProfile, surplus', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const slots = [{ key: 'a', pos: 'ST', role: 'R' }];
  const players = [P('best', ['ST'], { Pace: 15 }), P('second', ['ST'], { Pace: 12 }), P('third', ['ST'], { Pace: 10 }), P('def', ['DC'], { Pace: 15 }), P('blank', ['ST'], { Strength: 10 })];
  const r = SO.optimize({ slots, players, profiles }, {});
  const by = Object.fromEntries(r.leftOut.map((x) => [x.id, x.code]));
  assert.deepEqual(by, { third: 'surplus', def: 'noSlot', blank: 'noValue' });
  const r2 = SO.optimize({ slots: [{ key: 'a', pos: 'ST', role: '' }], players, profiles }, {});
  assert.ok(r2.leftOut.every((x) => x.code === 'noProfile'));
});

test('slabá místa a součty: weakSpots z A, součty v desetinách přesné', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const slots = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, pos: 'ST', role: 'R' }));
  const players = [P('1', ['ST'], { Pace: 18 }), P('2', ['ST'], { Pace: 17 }), P('3', ['ST'], { Pace: 16 }), P('4', ['ST'], { Pace: 5 })];
  const r = SO.optimize({ slots, players, profiles }, { bench: false });
  assert.equal(r.a.total, 90 + 85 + 80 + 25);
  assert.ok(r.weak.some((w) => w.kind === 'weak' && w.gap >= 8));
  assert.equal(r.b, null);
});

// ---------------------------------------------------------------- dopad změn
test('injuryImpact: odpovídá přepočtu bez hráče, řadí nejhorší výpadky první a rozlišuje závažnost', () => {
  const input = mini();
  const impact = SO.injuryImpact(input, {});
  const base = SO.optimize(input, { quick: true });
  assert.equal(impact.length, 2);
  for (const x of impact) {
    const without = SO.optimize(input, { exclude: [x.playerId], quick: true });
    assert.equal(x.aTotalBefore, base.a.total);
    assert.equal(x.aTotalAfter, without.a.total);
    assert.equal(x.deltaA, r1(without.a.total - base.a.total));
  }
  assert.ok(impact[0].deltaA <= impact[1].deltaA || impact[0].severity !== impact[1].severity);
  // brankář bez náhrady: výpadek stojí obsazené místo a je to kritické
  const profiles = [mk('G', ['Handling'], [])];
  const r = SO.injuryImpact({ slots: [{ key: 'g', pos: 'GK', role: 'G' }], players: [P('g1', ['GK'], { Handling: 15 })], profiles }, {});
  assert.equal(r[0].severity, 'critical');
  assert.equal(r[0].filledDrop, 1);
  assert.equal(r[0].replacements[0].to, null);
  // prahy se dají nastavit
  const loose = SO.injuryImpact(input, {}, { critical: 1000, medium: 1000 });
  assert.ok(loose.every((x) => x.severity === 'low'));
  assert.ok(impact[0].replacements.length >= 1);
});

test('injuryImpact: výpadek, po kterém se místo neobsadí, je kritický i když by bylo číslo malé', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const weak = P('weak', ['ST'], { Pace: 2 }); // vhodnost 10: výpadek stojí jen 10 bodů, ale místo zůstane prázdné
  const r = SO.injuryImpact({ slots: [{ key: 'a', pos: 'ST', role: 'R' }], players: [weak], profiles }, {});
  assert.equal(r[0].deltaA, -10);
  assert.equal(r[0].filledDrop, 1);
  assert.equal(r[0].severity, 'critical');
  const covered = SO.injuryImpact({ slots: [{ key: 'a', pos: 'ST', role: 'R' }], players: [weak, P('same', ['ST'], { Pace: 2 })], profiles }, {});
  assert.equal(covered[0].filledDrop, 0);
  assert.equal(covered[0].severity, 'low');
});

test('injuryImpact se zámkem: výpadek zamčeného hráče zámek uvolní', () => {
  const input = mini();
  const impact = SO.injuryImpact(input, { locks: { st: 's3' } });
  const x = impact.find((y) => y.playerId === 's3');
  assert.ok(x);
  assert.equal(x.replacements.find((q) => q.slotKey === 'st').to.id, 's1');
});

test('simulateChange: příchod hráče (add) změní sestavu a ukáže rozdíl; odchod, zámek, odemčení, vyřazení, zranění', () => {
  const input = mini();
  const star = P('new', ['ST'], { Finishing: 20, Pace: 20, Tackling: 3, Strength: 10 });
  const add = SO.simulateChange(input, {}, { type: 'add', player: star });
  assert.ok(add.ok);
  assert.ok(add.diff.a.delta > 0);
  assert.equal(add.after.a.assignments[0].player.id, 'new');
  const ch = add.diff.changes.find((c) => c.team === 'A' && c.slotKey === 'st');
  assert.equal(ch.from.id, 's1');
  assert.equal(ch.to.id, 'new');
  assert.ok(ch.delta > 0);
  assert.equal(SO.simulateChange(input, {}, { type: 'add', player: P('s1', ['ST'], {}) }).ok, false);
  assert.equal(SO.simulateChange(input, {}, { type: 'add', player: { name: 'bez id' } }).ok, false);
  const rm = SO.simulateChange(input, {}, { type: 'remove', playerId: 's1' });
  assert.ok(rm.diff.a.delta < 0);
  assert.equal(SO.simulateChange(input, {}, { type: 'remove', playerId: 'ghost' }).ok, false);
  const lock = SO.simulateChange(input, {}, { type: 'lock', slotKey: 'st', playerId: 's3' });
  assert.equal(lock.after.a.assignments[0].player.id, 's3');
  const un = SO.simulateChange(input, { locks: { st: 's3' } }, { type: 'unlock', slotKey: 'st' });
  assert.equal(un.before.a.assignments[0].player.id, 's3');
  assert.equal(un.after.a.assignments[0].player.id, 's1');
  assert.equal(SO.simulateChange(input, {}, { type: 'exclude', playerId: 's1' }).after.a.assignments[0].player.id, 's2');
  assert.equal(SO.simulateChange(input, {}, { type: 'injure', playerId: 's1' }).after.a.assignments[0].player.id, 's2');
  assert.equal(SO.simulateChange(input, {}, { type: 'smaz' }).ok, false);
  // vstup se nezměnil
  assert.equal(input.players.length, 5);
});

test('diffResults: stejné sestavy nemají žádné změny a nulový rozdíl', () => {
  const r = SO.optimize(mini(), { quick: true });
  const d = SO.diffResults(r, r);
  assert.deepEqual(d.changes, []);
  assert.equal(d.a.delta, 0);
  assert.equal(d.b.delta, 0);
  const noB = SO.optimize(mini(), { quick: true, bench: false });
  assert.equal(SO.diffResults(noB, noB).b, null);
});

// ---------------------------------------------------------------- hráč: místa, pořadí, podobnost
test('playerSlotFits: vhodnost hráče na každé místo s důvodem u těch, kde nejde', () => {
  const input = mini();
  const fits = SO.playerSlotFits(input, {}, 's1');
  assert.equal(fits.length, 2);
  assert.equal(fits[0].eligible, true);
  assert.equal(typeof fits[0].fit, 'number');
  assert.equal(fits[1].eligible, false);
  assert.match(fits[1].reason, /nemá pozici místa/);
  assert.deepEqual(SO.playerSlotFits(input, {}, 'ghost'), []);
  const noRole = SO.playerSlotFits({ slots: [{ key: 'a', pos: 'ST', role: '' }, { key: 'b', pos: 'ST', role: 'Cizí' }], players: input.players, profiles: input.profiles }, {}, 's1');
  assert.match(noRole[0].reason, /nemá zadanou roli/);
  assert.match(noRole[1].reason, /Chybí profil role/);
});

test('rankForRole: pořadí podle vhodnosti, nehodnotitelní na konci, shoda dostane pořadí podle seznamu', () => {
  const input = mini();
  const rows = SO.rankForRole({ players: input.players, profile: input.profiles[0], slotPos: 'ST' }, {});
  assert.deepEqual(rows.slice(0, 3).map((x) => x.id), ['s1', 's2', 's3']);
  assert.deepEqual(rows.slice(0, 3).map((x) => x.rank), [1, 2, 3]);
  assert.ok(rows.slice(3).every((x) => x.fit === null && x.rank === null));
  assert.match(rows[3].reason, /Nemá pozici místa/);
  const dw = SO.rankForRole({ players: [P('f', ['DC'], full(14)), P('g', ['DC'], full(8))], profile: mk('Stoper', ['Marking'], [], { group: 'CB' }), slotPos: 'DC' }, { model: 'dwrs' });
  assert.deepEqual(dw.map((x) => x.id), ['f', 'g']);
});

test('similarPlayers: nejmenší vzdálenost je nejpodobnější, chybějící atributy se nehádají, cíl bez atributů nejde', () => {
  const a = P('a', ['ST'], full(12));
  const near = P('near', ['ST'], { ...full(12), Finishing: 13 });
  const far = P('far', ['ST'], full(5));
  const blank = P('blank', ['ST'], { Finishing: 12 });
  const r = SO.similarPlayers(a, [a, far, near, blank], { n: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.group, 'ST');
  assert.deepEqual(r.similar.map((x) => x.id), ['near', 'far']);
  assert.ok(r.similar[0].similarity > r.similar[1].similarity);
  assert.deepEqual(r.unknown.map((x) => x.id), ['blank']);
  const same = SO.similarPlayers(a, [P('twin', ['ST'], full(12))], {});
  assert.equal(same.similar[0].distance, 0);
  assert.equal(same.similar[0].similarity, 100);
  const bad = SO.similarPlayers(blank, [a], {});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /chybí atributy/);
  assert.equal(SO.similarPlayers(P('x', [], full(10)), [a], {}).ok, false);
  assert.equal(SO.similarPlayers(a, [near], { group: 'CB' }).group, 'CB');
});

// ---------------------------------------------------------------- skupina role
test('inferRoleGroups: výslovná skupina, pak jednoznačné použití v taktikách, pak název; dvojznačnost se nehádá', () => {
  const profiles = [
    mk('Moje role A', ['Pace'], [], { group: 'FB' }),
    mk('Moje role B', ['Pace'], []),
    mk('Moje role C', ['Pace'], []),
    mk('Poacher', ['Finishing'], []),
    mk('Nic neříkající', ['Pace'], []),
  ];
  const tactics = [
    [{ pos: 'RW', role: 'Moje role B' }, { pos: 'LW', role: 'Moje role B' }, { pos: 'ST', role: 'Moje role C' }],
    [{ pos: 'AM', role: 'Moje role C' }, { pos: 'DC', role: 'Moje role A' }],
  ];
  const g = SO.inferRoleGroups(profiles, tactics);
  assert.deepEqual(g.get(RF.roleKey('Moje role A')), { group: 'FB', source: 'explicit', ambiguous: false });
  assert.deepEqual(g.get(RF.roleKey('Moje role B')), { group: 'W', source: 'tactic', ambiguous: false });
  assert.equal(g.get(RF.roleKey('Moje role C')).group, null);
  assert.equal(g.get(RF.roleKey('Moje role C')).ambiguous, true);
  assert.deepEqual(g.get(RF.roleKey('Poacher')), { group: 'ST', source: 'name', ambiguous: false });
  assert.equal(g.get(RF.roleKey('Nic neříkající')).group, null);
  const w = SO.withGroups(profiles, g);
  assert.equal(w[1].group, 'W');
  assert.equal(w[2].group, undefined);
  assert.equal(profiles[1].group, undefined); // původní profil se nemění
});

test('skupina pozic v DWRS: výslovná u profilu, jinak podle pozice místa, jinak z názvu role', () => {
  assert.equal(SO.groupFor({ pos: 'RB' }, mk('Wing', ['Pace'], [], { group: 'W' })), 'W');
  assert.equal(SO.groupFor({ pos: 'RB' }, mk('Cokoliv', ['Pace'], [])), 'FB');
  assert.equal(SO.groupFor({ pos: '' }, mk('Advanced Forward', ['Pace'], [])), 'ST');
  assert.equal(SO.groupFor({ pos: '' }, mk('Cokoliv', ['Pace'], [])), null);
});

test('DWRS bez skupiny pozic: místo se neobsadí a důvod je řečený', () => {
  const profiles = [mk('Cokoliv', ['Pace'], [])];
  const r = SO.optimize({ slots: [{ key: 'a', pos: '', role: 'Cokoliv' }], players: [P('x', [], full(10))], profiles }, { model: 'dwrs', mode: 'free', bench: false });
  assert.equal(r.a.assignments[0].player, null);
  assert.match(r.a.assignments[0].reason, /Skupinu pozic role nejde určit/);
});

test('DWRS: výsledek nese rozpis a model je v textu; profil vah se ověří a špatné hodnoty se vrátí s upozorněním', () => {
  const profiles = [mk('Stoper', ['Marking', 'Tackling'], ['Heading'])];
  const slots = [{ key: 'cb', pos: 'RCB', role: 'Stoper' }];
  const r = SO.optimize({ slots, players: [P('c', ['DC'], full(14))], profiles }, { model: 'dwrs', wp: { name: 'Vlastní', categoryWeights: { extreme: -5 } }, bench: false });
  assert.equal(r.model, 'dwrs');
  assert.match(r.modelInfo, /DWRS/);
  assert.equal(r.a.assignments[0].group, 'CB');
  assert.ok(r.a.assignments[0].contributions.length >= 30);
  assert.ok(r.a.assignments[0].detail.worst > 0);
  assert.ok(r.issues.some((x) => /Váha kategorie/.test(x)));
  assert.equal(r.options.wpName, 'Vlastní');
});

// ---------------------------------------------------------------- rizika a řádky pro AI
test('squadRisks: chybějící druhý brankář, mezera, tenká hloubka, kritický výpadek, hráči bez dat', () => {
  const profiles = [mk('R', ['Pace'], [])];
  const slots = [{ key: 'a', pos: 'ST', role: 'R' }, { key: 'g', pos: 'GK', role: 'R' }, { key: 'd', pos: 'DC', role: 'R' }];
  const players = [P('s1', ['ST'], { Pace: 10 }), P('s2', ['ST'], { Pace: 12 }), P('g1', ['GK'], { Pace: 9 }), P('x', ['ST'], { Strength: 5 })];
  const input = { slots, players, profiles };
  const r = SO.optimize(input, {});
  const impact = SO.injuryImpact(input, {});
  const risks = SO.squadRisks(r, impact, players);
  const kinds = risks.map((x) => x.kind);
  assert.ok(kinds.includes('gap') && kinds.includes('thin') && kinds.includes('single') && kinds.includes('gk') && kinds.includes('data'));
  assert.equal(risks[risks.length - 1].severity, 'info');
  assert.equal(risks[0].severity, 'high');
  assert.deepEqual(SO.squadRisks(null, [], []), []);
  const ok = SO.squadRisks(r, [], [P('g1', ['GK'], {}), P('g2', ['GK'], {})]);
  assert.ok(!ok.some((x) => x.kind === 'gk'));
});

test('summaryLines: model, každé místo, součty, zámek, zranění a nápis, že jde o čísla aplikace', () => {
  const input = mini();
  input.players[3].injured = true;
  const r = SO.optimize(input, { locks: { st: 's2' } });
  const lines = SO.summaryLines(r);
  assert.match(lines[0], /ne pravidla FM27/);
  assert.ok(lines.some((l) => /zamčeno uživatelem/.test(l)));
  assert.ok(lines.some((l) => /zraněný nebo nedostupný, v sestavě není/.test(l)));
  assert.ok(lines.some((l) => /^Součet A /.test(l)));
  assert.deepEqual(SO.summaryLines(null), []);
  assert.ok(lines.length <= 40);
  // záloha a počet míst bez role mají stejný tvar jako u staré funkce summaryLines v rolefit.js (AI trenér a zkouška 18 na ně spoléhají)
  assert.ok(lines.some((l) => /; záloha \S+/.test(l)), lines.join(' | '));
  const withBlank = SO.summaryLines(SO.optimize({ slots: [{ key: 'a', pos: 'ST', role: '' }, { key: 'b', pos: 'ST', role: '' }, { key: 'c', pos: 'ST', role: 'Střelec' }], players: mini().players, profiles: mini().profiles }, { bench: false }));
  assert.ok(withBlank.some((l) => /^2 místa nemají zadanou roli, proto se nehodnotí\.$/.test(l)), withBlank.join(' | '));
});

// ---------------------------------------------------------------- zdroj
test('zdroj: žádný DOM, žádná síť, žádné skryté údaje, žádný řídicí ani přepínací znak (úplné hlídání neviditelných znaků je v sanitize.test.mjs), čistá funkce bez Math.random a Date', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.|window\.|fetch\(|XMLHttpRequest|localStorage/);
  assert.doesNotMatch(code, /Math\.random|Date\.now|new Date/);
  assert.doesNotMatch(code, /\bCA\b|\bPA\b|current ability|potential ability|consistency|injury proneness/i);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]'));
});
