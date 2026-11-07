import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const core = require('../src/core.js');
const cs = require('../src/fm27cs.js');
const T = require('../src/tactics.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sourcePath = path.join(here, '..', 'src', 'tactics.js');
const source = readFileSync(sourcePath, 'utf8');
const plan = JSON.parse(readFileSync(path.join(root, 'reference/codex-2026-11-01/takticky-plan.json'), 'utf8'));

// ------------------------------------------------------------------ pomůcky
const clone = (v) => JSON.parse(JSON.stringify(v));
const make = (formation) => T.makeTactic({ id: 'abc', name: `Test ${formation}`, formation });
/** Kopie taktiky s přesunutými sloty: patch {klíč: [x, y]}; phase 'out' mění ox/oy. */
function edit(tactic, patch, phase = 'in') {
  const t = clone(tactic);
  for (const [key, [x, y]] of Object.entries(patch)) {
    const slot = t.slots.find((s) => s.key === key);
    assert.ok(slot, `slot ${key} existuje`);
    if (phase === 'out') Object.assign(slot, { ox: x, oy: y });
    else Object.assign(slot, { x, y });
  }
  return t;
}
const mod = (fn) => {
  const p = clone(plan);
  fn(p);
  return p;
};
const byKind = (list, kind) => list.filter((c) => c.kind === kind);
const ids = (list) => list.map((c) => c.id);

// Pomůcky pro kontejner .fmf (syntetický soubor: pozorovaná hlavička + zstd rámce, kde rámec = magic + obsah)
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const PREFIX = [0x02, 0x01, 0x61, 0x66, 0x65, 0x2e];
const TOKENS = ['MojeTaktika', '.tac', 'logo', '.img', 'x', '.aom'];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const manifest = (tokens) => Uint8Array.from(tokens.flatMap((t) => [...u32(t.length), ...Buffer.from(t, 'ascii')]));
const frame = (content) => Uint8Array.from([...MAGIC, ...content]);
const fmfFile = (...parts) => Uint8Array.from([...PREFIX, ...new Array(40).fill(0), ...parts.flatMap((p) => [...p])]);
const filler = (n, byte = 0xaa) => new Array(n).fill(byte);

/** Falešná dekomprese: rámec = magic + obsah až do dalšího magic (nebo do konce souboru); 0xff na začátku = poškozený rámec. */
function fakeDecompress(bytes) {
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return null;
  let end = bytes.length;
  for (let i = 4; i + 4 <= bytes.length; i++) {
    if (MAGIC.every((b, k) => bytes[i + k] === b)) {
      end = i;
      break;
    }
  }
  const content = bytes.subarray(4, end);
  return content.length && content[0] === 0xff ? null : content;
}

const FORMATION_IDS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-4-1-1', '4-3-2-1', '4-1-2-1-2', '3-5-2', '3-4-3', '5-3-2', '5-4-1'];
// Řady podle y výchozích šablon (zezadu), jak je vrací shlukování s výchozím prahem.
const ROWS = {
  '4-4-2': [4, 4, 2],
  '4-3-3': [4, 1, 2, 3],
  '4-2-3-1': [4, 2, 3, 1],
  '4-1-4-1': [4, 1, 4, 1],
  '4-4-1-1': [4, 4, 1, 1],
  '4-3-2-1': [4, 3, 2, 1],
  '4-1-2-1-2': [4, 1, 2, 1, 2],
  '3-5-2': [3, 5, 2],
  '3-4-3': [3, 4, 3],
  '5-3-2': [5, 3, 2],
  '5-4-1': [5, 4, 1],
};
const MIRROR_CHANNEL = { left: 'right', leftHalf: 'rightHalf', centre: 'centre', rightHalf: 'leftHalf', right: 'left' };
const mirrorPos = (pos) => (pos.startsWith('R') ? 'L' + pos.slice(1) : pos.startsWith('L') ? 'R' + pos.slice(1) : pos);

// ------------------------------------------------------------------ formace
test('FORMATIONS: 11 formací z kontraktu, každá s 11 sloty, jedním brankářem a platnými souřadnicemi', () => {
  assert.deepEqual(T.FORMATIONS.map((f) => f.id), FORMATION_IDS);
  for (const f of T.FORMATIONS) {
    assert.equal(f.slots.length, 11, f.id);
    assert.equal(f.label, f.id.replaceAll('-', '–'), f.id);
    const gks = f.slots.filter((s) => s.pos === 'GK');
    assert.equal(gks.length, 1, f.id);
    assert.deepEqual([gks[0].x, gks[0].y], [50, 91], f.id);
    assert.equal(f.slots[0].pos, 'GK', `${f.id}: brankář je první`);
    assert.equal(f.id.split('-').map(Number).reduce((a, b) => a + b, 0), 10, `${f.id}: součet řad je 10 hráčů v poli`);
    for (const s of f.slots) {
      assert.ok(s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100, `${f.id} ${s.pos}`);
      // Kódy pozic jsou obecné zkratky (ne názvy rolí z FM27) a každá se dá zařadit do řady.
      assert.match(s.pos, /^[A-Z]{2,3}$/, `${f.id}: ${s.pos}`);
      assert.ok(T.lineOf(s.pos), `${f.id}: lineOf(${s.pos})`);
      // Žádný bod přesně na hranici kanálu, jinak by zrcadlový hráč mohl padnout do jiného kanálu.
      assert.ok(![20, 40, 60, 80].includes(s.x), `${f.id} ${s.pos}: x ${s.x} je na hranici kanálu`);
    }
  }
});

test('FORMATIONS: levá a pravá strana jsou zrcadlově souměrné (pozice, souřadnice i kanál)', () => {
  for (const f of T.FORMATIONS) {
    for (const s of f.slots) {
      const twin = f.slots.find((o) => o.pos === mirrorPos(s.pos) && o.x === 100 - s.x && o.y === s.y);
      assert.ok(twin, `${f.id}: ${s.pos} (${s.x},${s.y}) nemá zrcadlový protějšek`);
      assert.equal(T.channelOf(100 - s.x), MIRROR_CHANNEL[T.channelOf(s.x)], `${f.id} ${s.pos}`);
      if (mirrorPos(s.pos) === s.pos) assert.equal(s.x, 50, `${f.id}: ${s.pos} je ve středu`);
    }
  }
});

test('FORMATIONS: šablony jsou zmrazené a makeTactic z nich bere kopii', () => {
  assert.ok(Object.isFrozen(T.FORMATIONS) && Object.isFrozen(T.FORMATIONS[0]) && Object.isFrozen(T.FORMATIONS[0].slots[0]));
  const t = make('4-4-2');
  t.slots[1].x = 1;
  assert.equal(T.formationById('4-4-2').slots[1].x, 81);
  assert.equal(make('4-4-2').slots[1].x, 81);
});

test('FORMATIONS: výchozí šablony dávají řady podle názvu a při výchozích prazích žádný „warn“', () => {
  for (const f of T.FORMATIONS) {
    const t = make(f.id);
    assert.deepEqual(T.analyzeShape(t).lines.map((l) => l.count), ROWS[f.id], f.id);
    for (const phase of ['in', 'out']) {
      const found = T.findConflicts(t, { phase });
      assert.ok(found.every((c) => c.severity !== 'warn'), `${f.id}/${phase}: ${ids(found)}`);
      if (f.id === '3-5-2' || f.id === '3-4-3') {
        // Křídelní obránci stojí na úrovni zálohy, takže křídla v obranné třetině jsou prázdná (jen „watch“).
        assert.deepEqual(ids(found), ['geo-empty-channel-def-left', 'geo-empty-channel-def-right'], `${f.id}/${phase}`);
        assert.ok(found.every((c) => c.severity === 'watch'));
      } else {
        assert.deepEqual(found, [], `${f.id}/${phase}`);
      }
    }
  }
});

test('normalizeFormationId: zápisy čísel i oddělovačů', () => {
  const ok = {
    '4–3–3': '4-3-3', '4-3-3': '4-3-3', '433': '4-3-3', '4 3 3': '4-3-3', ' 4 – 3 – 3 ': '4-3-3', '4—3—3': '4-3-3', '4−3−3': '4-3-3',
    '4-2-3-1': '4-2-3-1', '4231': '4-2-3-1', '4–2–3–1': '4-2-3-1', '4 2 3 1': '4-2-3-1',
    '442': '4-4-2', '4-1-4-1': '4-1-4-1', '4411': '4-4-1-1', '4321': '4-3-2-1', '41212': '4-1-2-1-2', '4-1-2-1-2': '4-1-2-1-2',
    '352': '3-5-2', '3/5/2': '3-5-2', '3.4.3': '3-4-3', '532': '5-3-2', '5-4-1': '5-4-1',
  };
  for (const [input, expected] of Object.entries(ok)) assert.equal(T.normalizeFormationId(input), expected, JSON.stringify(input));
  assert.equal(T.normalizeFormationId(433), '4-3-3');
  assert.equal(T.normalizeFormationId(4231), '4-2-3-1');
});

test('normalizeFormationId: co nejde přečíst, vrací null (nehádá se)', () => {
  for (const input of ['9-9-9', '4-1-3-2', '', '   ', 'abc', '4-3-3 (diamant)', 'diamant 4-4-2', '4-33', '4-3-3-', '43', '4.33', null, undefined, {}, [], NaN, true, 4.33]) {
    assert.equal(T.normalizeFormationId(input), null, JSON.stringify(input));
  }
});

test('formationById a makeTactic: klíče s1…s11, výchozí hodnoty, neznámá formace → null', () => {
  assert.equal(T.formationById('4-3-3').id, '4-3-3');
  assert.equal(T.formationById('433').id, '4-3-3');
  assert.equal(T.formationById('9-9-9'), null);
  assert.equal(T.formationById(undefined), null);

  const t = T.makeTactic({ id: 'abc', name: 'Základ', formation: '4–3–3', kind: 'alternative' });
  assert.equal(t.id, 'abc');
  assert.equal(t.name, 'Základ');
  assert.equal(t.kind, 'alternative');
  assert.equal(t.formation, '4-3-3');
  assert.equal(t.mentality, '');
  assert.deepEqual(t.teamInstructions, []);
  assert.deepEqual(t.slots.map((s) => s.key), Array.from({ length: 11 }, (_, i) => `s${i + 1}`));
  assert.equal(new Set(t.slots.map((s) => s.key)).size, 11);
  for (const s of t.slots) {
    assert.equal(s.ox, s.x);
    assert.equal(s.oy, s.y);
    assert.equal(s.playerId, null);
    assert.equal(s.role, '');
    assert.equal(s.duty, '');
  }
  assert.deepEqual(t.source, { type: 'manual', fileName: null, importedAt: null, fields: {} });
  assert.equal(make('5-4-1').kind, 'primary');
  assert.equal(T.makeTactic({ formation: '4-4-2', kind: 'nesmysl' }).kind, 'primary');

  for (const input of [{ formation: '9-9-9' }, { formation: '' }, {}, null, undefined, 'x']) {
    assert.equal(T.makeTactic(input), null, JSON.stringify(input));
  }
});

test('lineOf: zařazení podle kódu pozice, neznámé → null', () => {
  const table = {
    GK: 'gk', RB: 'def', LB: 'def', CB: 'def', RCB: 'def', LCB: 'def', RWB: 'def', LWB: 'def',
    DM: 'mid', RDM: 'mid', LDM: 'mid', CM: 'mid', RCM: 'mid', LCM: 'mid', RM: 'mid', LM: 'mid', AM: 'mid', RAM: 'mid', LAM: 'mid',
    RW: 'att', LW: 'att', ST: 'att', RST: 'att', LST: 'att',
  };
  for (const [pos, line] of Object.entries(table)) assert.equal(T.lineOf(pos), line, pos);
  assert.equal(T.lineOf(' rcb '), 'def');
  for (const input of ['', 'XYZ', 'Střední obránce', null, undefined, 5, {}, 'toString', 'constructor']) assert.equal(T.lineOf(input), null, String(input));
});

// ------------------------------------------------------------------ import a export plánu
test('importPlanJson: skutečný takticky-plan.json (11 hráčů, 4-3-3, vše user_entered)', () => {
  const { tactic, players, report } = T.importPlanJson(plan, { now: 1234, fileName: 'takticky-plan.json', careerId: 'kariera1' });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(tactic.formation, '4-3-3');
  assert.equal(tactic.name, 'Základní 4–3–3');
  assert.equal(tactic.kind, 'primary');
  assert.equal(tactic.careerId, 'kariera1');
  assert.equal(players.length, 11);
  assert.equal(tactic.slots.length, 11);
  assert.deepEqual(tactic.slots.map((s) => s.key), Array.from({ length: 11 }, (_, i) => `s${i + 1}`));
  assert.equal(report.club, 'Můj klub');

  const out = new Map(plan.phaseShapes.out.players.map((p) => [p.id, p]));
  plan.players.forEach((p, i) => {
    const slot = tactic.slots[i];
    assert.deepEqual(
      [slot.pos, slot.x, slot.y, slot.ox, slot.oy, slot.playerId, slot.role, slot.duty],
      [p.position, p.x, p.y, out.get(p.id).x, out.get(p.id).y, p.id, p.role, ''],
      p.id
    );
    const player = players[i];
    assert.equal(player.id, p.id);
    assert.equal(player.name, p.name);
    assert.deepEqual(player.positions, [p.position]);
    assert.equal(player.role, p.role);
    assert.equal(player.foot, 'unknown');
    assert.equal(player.source, 'plan');
    assert.equal(player.careerId, 'kariera1');
    assert.deepEqual(player.attributes, p.attributes);
    assert.deepEqual(player.flags, p.flags);
    assert.equal(player.age, null);
    assert.deepEqual(player.strengths, []);
    assert.equal(player.prov.name, 'user_entered');
    assert.equal(player.prov.attributes, 'unknown', 'atributy jsou samé null, tedy neznámé');
    assert.equal(player.prov.foot, 'unknown');
    assert.equal(player.prov.flags, 'unknown');
  });

  // Původ polí: co plán obsahoval, je user_entered; co formát nenese, je neznámé. Nic není ověřené ani pozorované.
  for (const field of ['tactic.name', 'tactic.formation', 'slot.pos', 'slot.x', 'slot.y', 'slot.ox', 'slot.oy', 'slot.role', 'player.name', 'player.positions', 'player.role']) {
    assert.ok(report.userEntered.includes(field), field);
  }
  // Příznaky zranění a únavy jsou ve výchozím plánu false/false, tedy neoznačené: nezadal je nikdo.
  for (const field of ['tactic.mentality', 'tactic.teamInstructions', 'slot.duty', 'player.duty', 'player.age', 'player.foot', 'player.attributes', 'player.flags', 'player.strengths', 'player.weaknesses']) {
    assert.ok(report.unknown.includes(field), field);
  }
  assert.equal(report.userEntered.filter((f) => report.unknown.includes(f)).length, 0);
  assert.equal(tactic.source.type, 'plan_json');
  assert.equal(tactic.source.fileName, 'takticky-plan.json');
  assert.equal(tactic.source.importedAt, 1234);
  assert.deepEqual(new Set(Object.values(tactic.source.fields)), new Set(['user_entered', 'unknown']));
  assert.ok(core.LABELS.includes('user_entered'));
  for (const player of players) for (const label of Object.values(player.prov)) assert.ok(['user_entered', 'unknown'].includes(label), label);
  assert.deepEqual(report.provenance, { label: 'user_entered', tier: 'user_entered', text: core.TIER_LABEL_CS.user_entered });
});

test('importPlanJson: totéž z textu JSON a bez nepovinných voleb', () => {
  const fromObject = T.importPlanJson(plan);
  const fromText = T.importPlanJson(JSON.stringify(plan));
  assert.deepEqual(fromText, fromObject);
  assert.equal(fromObject.tactic.id, '');
  assert.equal(fromObject.tactic.careerId, null);
  assert.equal(fromObject.tactic.source.importedAt, null);
  assert.equal(fromObject.tactic.source.fileName, null);
});

test('plán: kruhový export(import(plan)) vrátí celý původní soubor, hráče, pozice i role', () => {
  const { tactic, players, report } = T.importPlanJson(plan);
  const back = T.exportPlanJson(tactic, players, { club: report.club });
  assert.deepEqual(back, plan);
  const again = T.importPlanJson(back);
  assert.deepEqual(again.tactic, tactic);
  assert.deepEqual(again.players, players);
});

test('plán: změny v taktice a pokyny přežijí export a import', () => {
  const withText = mod((p) => {
    p.phaseShapes.in.instructions = 'Pomalu\nTlačit na bránu';
    p.phaseShapes.out.instructions = 'Nízký blok';
    p.phaseShapes.out.players[8].x = 70; // jiná poloha křídla bez míče
    p.phaseShapes.out.players[8].y = 50;
    p.players[1].attributes.pace = 14;
    p.players[1].flags.injury = true;
    p.players[1].foot = 'right';
  });
  const first = T.importPlanJson(withText);
  assert.deepEqual(first.report.errors, []);
  assert.deepEqual(first.tactic.teamInstructions, ['S míčem: Pomalu', 'S míčem: Tlačit na bránu', 'Bez míče: Nízký blok']);
  assert.ok(first.report.userEntered.includes('tactic.teamInstructions'));
  assert.ok(!first.report.unknown.includes('tactic.teamInstructions'));
  assert.equal(first.tactic.slots[8].ox, 70);
  assert.equal(first.tactic.slots[8].oy, 50);
  assert.equal(first.tactic.slots[8].x, 82);
  assert.equal(first.players[1].attributes.pace, 14);
  assert.equal(first.players[1].prov.attributes, 'user_entered');
  assert.equal(first.players[1].prov.foot, 'user_entered');
  assert.equal(first.players[1].flags.injury, true);
  assert.equal(first.players[1].prov.flags, 'user_entered', 'skutečně označený příznak je zadání uživatele');
  assert.ok(first.report.userEntered.includes('player.flags'));
  assert.ok(!first.report.unknown.includes('player.flags'));

  // Uživatel v laboratoři přesune hráče a přepíše roli; export to musí nést.
  const edited = edit(first.tactic, { s4: [30, 70] });
  edited.slots[3].role = 'Vlastní popis role';
  const exported = T.exportPlanJson(edited, first.players, { club: 'Můj klub' });
  assert.equal(exported.phaseShapes.in.instructions, 'Pomalu\nTlačit na bránu');
  assert.equal(exported.phaseShapes.out.instructions, 'Nízký blok');
  const second = T.importPlanJson(exported);
  assert.deepEqual(second.report.errors, []);
  assert.deepEqual(second.tactic.slots, edited.slots);
  // Plán nese jednu roli na hráče (roli v této taktice), takže ji po novém importu má i hráč.
  const expectedPlayers = clone(first.players);
  expectedPlayers[3].role = 'Vlastní popis role';
  assert.deepEqual(second.players, expectedPlayers);
  assert.deepEqual(second.tactic.teamInstructions, first.tactic.teamInstructions);
  assert.equal(second.tactic.slots[3].role, 'Vlastní popis role');
  assert.deepEqual([second.tactic.slots[3].x, second.tactic.slots[3].y], [30, 70]);
});

test('plán: export taktiky bez hráčů a neplatné vstupy exportu', () => {
  const t = make('4-3-3');
  const exported = T.exportPlanJson(t, [], { club: 'Klub' });
  assert.equal(exported.format, 'fm27-tactical-coach-manual-plan');
  assert.equal(exported.version, 1);
  assert.equal(exported.club, 'Klub');
  assert.equal(exported.formation, '4–3–3');
  assert.equal(exported.players.length, 11);
  assert.deepEqual(exported.players.map((p) => p.id), Array.from({ length: 11 }, (_, i) => `p${i + 1}`));
  assert.equal(exported.players[0].position, 'GK');
  const back = T.importPlanJson(exported);
  assert.deepEqual(back.report.errors, []);
  assert.deepEqual(back.tactic.slots.map((s) => [s.pos, s.x, s.y, s.ox, s.oy]), t.slots.map((s) => [s.pos, s.x, s.y, s.ox, s.oy]));
  assert.ok(back.report.unknown.includes('player.name'));
  assert.ok(back.report.unknown.includes('slot.role'));

  const broken = clone(t);
  broken.slots[2].y = NaN;
  const noCoordinate = clone(t);
  delete noCoordinate.slots[0].x;
  for (const input of [null, undefined, {}, { slots: [] }, 'x', broken, noCoordinate]) assert.equal(T.exportPlanJson(input, []), null);
  // Chybějící ox/oy se vezmou z x/y.
  const noOut = clone(t);
  delete noOut.slots[1].ox;
  const e2 = T.exportPlanJson(noOut, []);
  assert.deepEqual([e2.phaseShapes.out.players[1].x, e2.phaseShapes.out.players[1].y], [t.slots[1].x, t.slots[1].y]);
});

test('importPlanJson: chybějící fáze „out“ → ox = x, oy = y a varování', () => {
  const noOut = mod((p) => {
    delete p.phaseShapes.out;
  });
  const r = T.importPlanJson(noOut);
  assert.deepEqual(r.report.errors, []);
  assert.equal(r.report.warnings.length, 1);
  assert.match(r.report.warnings[0], /fázi „out“/);
  assert.ok(r.tactic.slots.every((s) => s.ox === s.x && s.oy === s.y));
  assert.ok(r.report.unknown.includes('slot.ox') && r.report.unknown.includes('slot.oy'));
  assert.ok(!r.report.userEntered.includes('slot.ox'));

  // Jen u jednoho hráče chybí poloha bez míče: ostatní ji mají ze souboru.
  const partial = mod((p) => {
    p.phaseShapes.out.players = p.phaseShapes.out.players.filter((q) => q.id !== 'p4');
    p.phaseShapes.out.players.find((q) => q.id === 'p5').x = 33;
  });
  const q = T.importPlanJson(partial);
  assert.match(q.report.warnings.join('\n'), /„p4“/);
  assert.deepEqual([q.tactic.slots[3].ox, q.tactic.slots[3].oy], [q.tactic.slots[3].x, q.tactic.slots[3].y]);
  assert.equal(q.tactic.slots[4].ox, 33);
  assert.ok(q.report.userEntered.includes('slot.ox'));

  // Chybí fáze „in“: souřadnice s míčem jsou z hlavního seznamu hráčů.
  const noIn = mod((p) => {
    delete p.phaseShapes.in;
  });
  const n = T.importPlanJson(noIn);
  assert.deepEqual(n.report.errors, []);
  assert.match(n.report.warnings.join('\n'), /fázi „in“/);
  assert.deepEqual(n.tactic.slots.map((s) => [s.x, s.y]), plan.players.map((p) => [p.x, p.y]));
});

test('importPlanJson: neplatný soubor → report.errors, tactic null, žádná výjimka', () => {
  const duplicate = mod((p) => {
    p.players[1].id = 'p1';
  });
  const cases = {
    null: null,
    undefined: undefined,
    číslo: 42,
    pole: [],
    'prázdný objekt': {},
    'prázdný text': '',
    'nečitelný JSON': '{nope',
    'JSON s číslem': '5',
    'cizí formát': { format: 'jiny-format', version: 1, players: [] },
    'jiná verze': mod((p) => {
      p.version = 2;
    }),
    'verze jako text': mod((p) => {
      p.version = '1';
    }),
    'bez verze': mod((p) => {
      delete p.version;
    }),
    'bez hráčů': mod((p) => {
      p.players = [];
      p.phaseShapes = {};
    }),
    'příliš mnoho hráčů': mod((p) => {
      p.players = Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, x: 10, y: 10 }));
    }),
    'hráči nejsou pole': mod((p) => {
      p.players = 'x';
      p.phaseShapes = {};
    }),
    'hráč není objekt': mod((p) => {
      p.players[3] = 'x';
    }),
    'hráč bez souřadnic': mod((p) => {
      delete p.players[2].x;
      delete p.phaseShapes.in.players[2].x;
    }),
    'souřadnice jako text': mod((p) => {
      p.players[0].y = '91';
      p.phaseShapes.in.players[0].y = '91';
    }),
    'souřadnice mimo hřiště': mod((p) => {
      p.players[0].x = 120;
      p.phaseShapes.in.players[0].x = 120;
    }),
    'záporná souřadnice bez míče': mod((p) => {
      p.phaseShapes.out.players[0].y = -1;
    }),
    'souřadnice null': mod((p) => {
      p.players[0].x = null;
      p.phaseShapes.in.players[0].x = null;
    }),
    'duplicitní id': duplicate,
  };
  for (const [name, input] of Object.entries(cases)) {
    let r;
    assert.doesNotThrow(() => {
      r = T.importPlanJson(input);
    }, name);
    assert.equal(r.tactic, null, name);
    assert.deepEqual(r.players, [], name);
    assert.ok(r.report.errors.length >= 1 && r.report.errors.every((e) => typeof e === 'string' && e.length > 5), name);
    assert.deepEqual(r.report.userEntered, [], name);
  }
  // Jinak platný plán s cizím formátem (nebo bez něj) se odmítne kvůli formátu, ne kvůli něčemu jinému.
  for (const format of ['jiny-format', undefined, 7]) {
    const r = T.importPlanJson(mod((p) => { p.format = format; }));
    assert.equal(r.tactic, null);
    assert.match(r.report.errors[0], /Neznámý formát souboru/);
    assert.match(r.report.errors[0], /fm27-tactical-coach-manual-plan/);
  }
  assert.match(T.importPlanJson(mod((p) => { p.version = 2; })).report.errors[0], /Verze formátu \(2\)/);
  assert.match(T.importPlanJson(mod((p) => { p.version = '1'; })).report.errors[0], /Verze formátu \("1"\)/);
  assert.match(T.importPlanJson(mod((p) => { delete p.version; })).report.errors[0], /Verze formátu \(chybí\)/);
  // U hráče bez souřadnic chyba říká, kdo to je.
  assert.match(T.importPlanJson(cases['hráč bez souřadnic']).report.errors[0], /„p3“.*souřadnice/);
  assert.match(T.importPlanJson(cases['duplicitní id']).report.errors[0], /Duplicitní id hráče „p1“/);
  assert.match(T.importPlanJson(cases['příliš mnoho hráčů']).report.errors[0], /příliš mnoho hráčů \(31\); povoleno nejvýš 30/);
  // Souřadnice z fáze „in“ stačí, i když v hlavním seznamu chybí.
  const onlyPhase = mod((p) => {
    delete p.players[2].x;
  });
  const ok = T.importPlanJson(onlyPhase);
  assert.deepEqual(ok.report.errors, []);
  assert.equal(ok.tactic.slots[2].x, 62);
});

test('importPlanJson: neznámá formace se nehádá, rozestavení se načte ze souřadnic', () => {
  const unknown = mod((p) => {
    p.formation = '4-1-3-2';
    p.phaseShapes.in.formation = '4-1-3-2';
    p.phaseShapes.out.formation = 'něco jiného';
  });
  const r = T.importPlanJson(unknown);
  assert.deepEqual(r.report.errors, []);
  assert.equal(r.tactic.formation, '');
  assert.equal(r.tactic.slots.length, 11);
  assert.match(r.report.warnings.join('\n'), /„4-1-3-2“ není mezi šablonami/);
  assert.ok(r.report.unknown.includes('tactic.formation'));
  assert.ok(!r.report.userEntered.includes('tactic.formation'));
  assert.equal(r.tactic.source.fields['tactic.formation'], 'unknown');

  const missing = mod((p) => {
    delete p.formation;
    delete p.phaseShapes;
  });
  const m = T.importPlanJson(missing);
  assert.equal(m.tactic.formation, '');
  assert.match(m.report.warnings.join('\n'), /neuvádí formaci/);

  // Zápis čísel se normalizuje; hlavní formace se čte i z fáze, když je hlavní text nečitelný.
  assert.equal(T.importPlanJson(mod((p) => { p.formation = '433'; })).tactic.formation, '4-3-3');
  const fromPhase = T.importPlanJson(mod((p) => { p.formation = 'nic'; }));
  assert.equal(fromPhase.tactic.formation, '4-3-3');
  assert.match(fromPhase.report.warnings.join('\n'), /Hlavní formaci v plánu \(„nic“\) nelze přečíst/);
  const differing = T.importPlanJson(mod((p) => { p.phaseShapes.out.formation = '4–4–2'; }));
  assert.equal(differing.tactic.formation, '4-3-3');
  assert.match(differing.report.warnings.join('\n'), /liší od hlavní/);
});

test('importPlanJson: id hráčů, neznámé pozice, počet hráčů, varianty a atributy', () => {
  const odd = mod((p) => {
    for (const list of [p.players, p.phaseShapes.in.players, p.phaseShapes.out.players]) list[1].id = 'P-2';
    delete p.players[2].id; // chybí id: přidělí se p3, souřadnice jsou z hlavního seznamu
    p.players[3].position = 'XYZ';
    p.players[4].attributes.pace = 'rychlý';
    p.variants = [{ name: 'varianta' }];
  });
  const r = T.importPlanJson(odd);
  assert.deepEqual(r.report.errors, []);
  const text = r.report.warnings.join('\n');
  assert.match(text, /Id hráče „P-2“ upraveno na „p2“/);
  assert.match(text, /nemá použitelné id; přiděleno „p3“/);
  assert.match(text, /Neznámý kód pozice: „XYZ“ \(p4\)/);
  assert.match(text, /Atribut „pace“ hráče „p5“ není číslo/);
  assert.match(text, /1 variantu;/);
  assert.equal(r.players[1].id, 'p2');
  assert.equal(r.players[2].id, 'p3');
  assert.equal(r.players[4].attributes.pace, null);
  assert.equal(r.tactic.slots[3].pos, 'XYZ');
  assert.equal(r.tactic.slots[1].playerId, 'p2');

  const ten = mod((p) => {
    p.players.pop();
    p.phaseShapes.in.players.pop();
    p.phaseShapes.out.players.pop();
  });
  const t = T.importPlanJson(ten);
  assert.equal(t.tactic.slots.length, 10);
  assert.match(t.report.warnings.join('\n'), /10 hráčů místo 11/);

  const lower = T.importPlanJson(mod((p) => { p.players[1].position = ' rb '; }));
  assert.equal(lower.tactic.slots[1].pos, 'RB');
  assert.deepEqual(lower.players[1].positions, ['RB']);
});

// ------------------------------------------------------------------ analyzeShape
test('analyzeShape: 4-4-2 (řady, mezery, třetiny, kanály, zóny, šířka, hloubka)', () => {
  const a = T.analyzeShape(make('4-4-2'));
  assert.equal(a.ok, true);
  assert.deepEqual(a.errors, []);
  assert.equal(a.phase, 'in');
  assert.deepEqual(a.counts, { players: 11, outfield: 10, goalkeepers: 1 });
  assert.deepEqual(a.lines.map((l) => [l.name, l.count]), [['def', 4], ['mid', 4], ['att', 2]]);
  assert.deepEqual(a.lines.map((l) => [l.avgY, l.minY, l.maxY]), [[79, 76, 82], [55, 54, 56], [30, 30, 30]]);
  assert.deepEqual(a.lines[0].keys, ['s5', 's4', 's3', 's2']); // zleva doprava
  assert.deepEqual(a.lines[2].keys, ['s11', 's10']);
  assert.ok(!a.lines.some((l) => l.keys.includes('s1')), 'brankář není v žádné řadě');
  assert.deepEqual(a.gaps.map((g) => [g.between, g.gap]), [[['def', 'mid'], 20], [['mid', 'att'], 24]]);
  assert.deepEqual(a.thirds, { def: 5, mid: 4, att: 2 });
  assert.deepEqual(a.channels, { left: 2, leftHalf: 3, centre: 1, rightHalf: 3, right: 2 });
  assert.equal(a.restDefence, 8);
  assert.equal(a.depth, 52);
  assert.deepEqual(a.width, { overall: 64, perLine: { def: 62, mid: 64, att: 24 } });
  assert.deepEqual(a.compactness, { depth: 52, width: 64 });
  assert.deepEqual(a.balance, { left: 5, centre: 0, right: 5 });
  assert.equal(Object.keys(a.zones).length, 15);
  assert.equal(Object.values(a.zones).reduce((x, y) => x + y, 0), 11);
  assert.equal(a.zones['def/centre'], 1);
  assert.equal(a.zones['mid/leftHalf'], 1);
  assert.equal(a.zones['att/centre'], 0);
  assert.equal(a.zones['att/rightHalf'], 1);
});

test('analyzeShape: 4-3-3 (jiné řady než 4-3-3 podle názvu: kotva je zvlášť řada)', () => {
  const a = T.analyzeShape(make('4-3-3'));
  assert.deepEqual(a.lines.map((l) => [l.name, l.count]), [['def', 4], ['mid1', 1], ['mid2', 2], ['att', 3]]);
  assert.deepEqual(a.lines.map((l) => l.label), ['obrana', 'záloha 1', 'záloha 2', 'útok']);
  assert.deepEqual(a.gaps.map((g) => g.gap), [10, 12, 24]);
  assert.deepEqual(a.gaps.map((g) => g.between), [['def', 'mid1'], ['mid1', 'mid2'], ['mid2', 'att']]);
  assert.deepEqual(a.thirds, { def: 5, mid: 3, att: 3 });
  assert.deepEqual(a.channels, { left: 2, leftHalf: 2, centre: 3, rightHalf: 2, right: 2 });
  assert.equal(a.restDefence, 7);
  assert.equal(a.depth, 58);
  assert.equal(a.width.overall, 64);
  assert.deepEqual(a.width.perLine, { def: 62, mid1: 0, mid2: 32, att: 64 });
  assert.deepEqual(a.balance, { left: 4, centre: 2, right: 4 });
  assert.equal(a.zones['def/centre'], 1);
  assert.equal(a.zones['mid/centre'], 1);
  assert.equal(a.zones['att/centre'], 1);
});

test('analyzeShape: řady se určují podle y, ne podle kódu pozice; brankář je mimo řady', () => {
  const t = make('4-4-2');
  // Pravý obránce (kód „def“) vyběhne do zálohy a brankář vyjde z brány: řady se řídí souřadnicemi.
  const moved = edit(t, { s2: [81, 50], s1: [50, 60] });
  const a = T.analyzeShape(moved);
  assert.deepEqual(a.lines.map((l) => l.count), [3, 5, 2]);
  assert.ok(a.lines[1].keys.includes('s2'), 'RB je v záložní řadě');
  assert.ok(!a.lines.some((l) => l.keys.includes('s1')));
  assert.equal(a.counts.goalkeepers, 1);
  assert.equal(a.depth, 52, 'hloubka se měří jen mezi hráči v poli');

  // Práh shlukování jde změnit; neplatné hodnoty a neznámé klíče se ignorují.
  const wide = T.analyzeShape(make('4-3-3'), { thresholds: { lineBreakY: 15 } });
  assert.deepEqual(wide.lines.map((l) => [l.name, l.count]), [['def', 7], ['att', 3]]);
  assert.equal(wide.thresholds.lineBreakY, 15);
  const ignored = T.analyzeShape(make('4-3-3'), { thresholds: { lineBreakY: 'x', neznamy: 1, lineGapY: NaN } });
  assert.deepEqual(ignored.thresholds, T.DEFAULT_THRESHOLDS);
});

test('analyzeShape: fáze „out“ čte ox/oy, jinak x/y; neznámá fáze se řekne', () => {
  const t = edit(make('4-4-2'), { s10: [62, 12], s11: [38, 12] }, 'out');
  const inShape = T.analyzeShape(t, { phase: 'in' });
  const outShape = T.analyzeShape(t, { phase: 'out' });
  assert.equal(inShape.phase, 'in');
  assert.equal(outShape.phase, 'out');
  assert.equal(inShape.depth, 52);
  assert.equal(outShape.depth, 70);
  assert.deepEqual(outShape.thirds, { def: 5, mid: 4, att: 2 });
  assert.equal(T.analyzeShape(t).depth, 52, 'bez voleb je fáze „in“');
  const unknownPhase = T.analyzeShape(t, { phase: 'xyz' });
  assert.equal(unknownPhase.phase, 'in');
  assert.match(unknownPhase.warnings.join(), /Neznámá fáze „xyz“/);
  // Slot bez ox/oy se ve fázi „out“ bere z x/y.
  const legacy = make('4-4-2');
  for (const s of legacy.slots) {
    delete s.ox;
    delete s.oy;
  }
  assert.deepEqual(T.analyzeShape(legacy, { phase: 'out' }).lines, T.analyzeShape(legacy, { phase: 'in' }).lines);
});

test('analyzeShape: hráč bez souřadnic se přeskočí a řekne se to; prázdný vstup nespadne', () => {
  const t = make('4-4-2');
  delete t.slots[3].x;
  t.slots[6].y = 'padesát';
  const a = T.analyzeShape(t);
  assert.equal(a.ok, true);
  assert.deepEqual(a.skipped, ['s4', 's7']);
  assert.equal(a.counts.players, 9);
  assert.match(a.warnings.join(), /s4, s7/);
  assert.equal(Object.values(a.thirds).reduce((x, y) => x + y, 0), 9);

  for (const input of [null, undefined, {}, { slots: [] }, { slots: 'x' }, 'x', 5, { slots: [null, {}, { key: 's1', x: NaN, y: 1 }] }]) {
    let r;
    assert.doesNotThrow(() => {
      r = T.analyzeShape(input);
    });
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.ok(r.errors.length >= 1);
    assert.deepEqual(r.lines, []);
    assert.deepEqual(r.gaps, []);
    assert.equal(r.depth, 0);
    assert.deepEqual(T.findConflicts(input), []);
    assert.deepEqual(T.shapeFacts(r), []);
  }
  // Jediný hráč nebo samí brankáři: žádné řady ani mezery, ale bez chyby.
  const lone = { slots: [{ key: 'a', pos: 'ST', x: 50, y: 20 }] };
  const one = T.analyzeShape(lone);
  assert.equal(one.ok, true);
  assert.deepEqual(one.lines.map((l) => [l.name, l.count]), [['all', 1]]);
  assert.deepEqual(one.gaps, []);
  const loneKinds = new Set(T.findConflicts(lone).map((c) => c.kind));
  for (const kind of ['line_gap', 'isolated_forward', 'overlap', 'width_imbalance']) assert.ok(!loneKinds.has(kind), kind);
});

test('shapeFacts: popisná fakta o tvaru, jen geometrie', () => {
  const a = T.analyzeShape(make('4-4-2'));
  const facts = T.shapeFacts(a);
  assert.deepEqual(ids(facts), ['geo-shape-lines', 'geo-shape-size', 'geo-shape-thirds', 'geo-shape-channels', 'geo-shape-rest', 'geo-shape-gap']);
  assert.ok(facts.every((f) => f.severity === 'info' && typeof f.kind === 'string' && typeof f.values === 'object' && f.basis.includes('nakreslil')));
  const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
  assert.match(byId['geo-shape-lines'].text, /^S míčem: řady podle nakreslené svislé polohy, zezadu: obrana: 4, záloha: 4, útok: 2/);
  assert.deepEqual(byId['geo-shape-lines'].values.counts, [4, 4, 2]);
  assert.match(byId['geo-shape-size'].text, /hloubka týmu je 52 a šířka 64 jednotek/);
  assert.match(byId['geo-shape-thirds'].text, /obranná 5, střední 4, útočná 2/);
  assert.match(byId['geo-shape-channels'].text, /levé křídlo 2, levý meziprostor 3, střed 1, pravý meziprostor 3, pravé křídlo 2/);
  assert.match(byId['geo-shape-rest'].text, /y > 50\) je 8 hráčů v poli/);
  assert.match(byId['geo-shape-gap'].text, /největší svislá mezera mezi řadami je 24 jednotek, mezi „záloha“ a „útok“/);
  // Fáze se bere z rozboru, nebo z voleb.
  assert.match(T.shapeFacts(T.analyzeShape(make('4-4-2'), { phase: 'out' }))[0].text, /^Bez míče:/);
  assert.match(T.shapeFacts(a, { phase: 'out' })[0].text, /^Bez míče:/);
  assert.match(byId['geo-shape-rest'].text, /^S míčem:/);
  const three = edit(make('4-4-2'), { s5: [19, 40], s6: [82, 40], s7: [62, 40], s8: [38, 40], s9: [18, 40] });
  assert.match(T.shapeFacts(T.analyzeShape(three)).find((f) => f.id === 'geo-shape-rest').text, /jsou 3 hráči v poli/);
});

// ------------------------------------------------------------------ findConflicts
function checkFinding(c, tactic) {
  const keys = tactic.slots.map((s) => s.key);
  for (const field of ['id', 'kind', 'severity', 'text', 'basis']) assert.equal(typeof c[field], 'string', `${c.id}: ${field}`);
  assert.match(c.id, /^[a-z0-9-]+$/, c.id);
  assert.ok(c.id.length <= 32, c.id);
  assert.ok(['line_gap', 'isolated_forward', 'overlap', 'empty_channel', 'thin_rest_defence', 'width_imbalance'].includes(c.kind), c.kind);
  assert.ok(['watch', 'warn'].includes(c.severity), c.severity);
  assert.ok(Array.isArray(c.slots) && c.slots.every((k) => keys.includes(k)), `${c.id}: slots`);
  assert.ok(c.values && typeof c.values === 'object', `${c.id}: values`);
  assert.match(c.text, /\d/, `${c.id}: text má konkrétní čísla`);
  assert.match(c.text, /^(S míčem|Bez míče):/, c.id);
  assert.match(c.basis, /heuristik/, `${c.id}: basis říká, že práh je heuristika`);
  assert.match(c.basis, /FM27/, c.id);
  assert.match(c.basis, /nakreslen/, c.id);
}

test('findConflicts: útočník daleko před zbytkem (isolated_forward)', () => {
  const t = edit(make('4-3-3'), { s10: [50, 2] });
  const found = T.findConflicts(t);
  assert.deepEqual(ids(found), ['geo-isolated-forward']);
  const [c] = found;
  checkFinding(c, t);
  assert.equal(c.severity, 'watch');
  assert.deepEqual(c.slots, ['s10', 's9']);
  assert.deepEqual(c.values, { distance: 42.5, threshold: 40, forward: 's10', nearest: 's9' });
  assert.match(c.text, /ST \(s10\).*RW \(s9\).*42,5 jednotky \(práh 40\)/);
  // Mnohem dál: warn.
  const farther = edit(make('4-3-3'), { s10: [50, 2], s9: [82, 60], s11: [18, 60], s7: [66, 60], s8: [34, 60], s6: [50, 70] });
  assert.equal(byKind(T.findConflicts(farther), 'isolated_forward')[0].severity, 'warn');
  // Dvojice útočníků vedle sebe není izolovaná, i když je daleko před zbytkem.
  const pair = edit(make('4-4-2'), { s10: [62, 4], s11: [38, 4] });
  assert.deepEqual(byKind(T.findConflicts(pair), 'isolated_forward'), []);
});

test('findConflicts: velká mezera mezi řadami (line_gap)', () => {
  const t = edit(make('4-4-2'), { s10: [62, 6], s11: [38, 6] });
  const found = T.findConflicts(t);
  assert.deepEqual(ids(found), ['geo-line-gap-mid-att']);
  const [c] = found;
  checkFinding(c, t);
  assert.equal(c.severity, 'warn');
  assert.deepEqual(c.slots, ['s9', 's8', 's7', 's6', 's11', 's10']);
  assert.deepEqual(c.values, { from: 'mid', to: 'att', gap: 48, centreGap: 49, threshold: 30 });
  assert.match(c.text, /mezi řadami „záloha“ a „útok“ je svislá mezera 48 jednotek \(práh 30\); nejbližší hráči jsou RM \(s6\) a RST \(s10\)/);
  // Mírnější mezera je jen „watch“; práh jde změnit a text i základ ho pak nesou.
  const mild = edit(make('4-4-2'), { s10: [62, 18], s11: [38, 18] });
  assert.equal(T.findConflicts(mild)[0].severity, 'watch');
  assert.equal(T.findConflicts(mild)[0].values.gap, 36);
  const strict = T.findConflicts(make('4-4-2'), { thresholds: { lineGapY: 10 } });
  assert.deepEqual(ids(strict), ['geo-line-gap-def-mid', 'geo-line-gap-mid-att']);
  assert.match(strict[0].text, /práh 10/);
  assert.match(strict[0].basis, /Prahy 8 a 10 jsou heuristiky/);
  assert.equal(T.findConflicts(make('4-4-2'), { thresholds: { lineGapY: 100 } }).length, 0);
});

test('findConflicts: dva hráči na jednom místě (overlap)', () => {
  const same = edit(make('4-4-2'), { s8: [62, 56] });
  const [overlap] = byKind(T.findConflicts(same), 'overlap');
  checkFinding(overlap, same);
  assert.equal(overlap.id, 'geo-overlap-s7-s8');
  assert.equal(overlap.severity, 'warn');
  assert.deepEqual(overlap.slots, ['s7', 's8']);
  assert.equal(overlap.values.distance, 0);
  assert.match(overlap.text, /RCM \(s7\) a LCM \(s8\) stojí na stejném místě \(práh 5\)/);
  // Blízko, ale ne na sobě: 3 jednotky je pořád warn, 4 jednotky je watch, 6 už nic.
  const sev = (dy) => byKind(T.findConflicts(edit(make('4-4-2'), { s8: [62, 56 + dy] })), 'overlap');
  assert.equal(sev(3)[0].severity, 'warn');
  assert.match(sev(3)[0].text, /jsou od sebe jen 3 jednotky/);
  assert.equal(sev(4)[0].severity, 'watch');
  assert.deepEqual(sev(6), []);
  // Brankář se počítá: stopér, který stojí na brankáři.
  assert.deepEqual(ids(byKind(T.findConflicts(edit(make('4-4-2'), { s3: [50, 90] })), 'overlap')), ['geo-overlap-s1-s3']);
});

test('findConflicts: prázdný kanál v obranné třetině (empty_channel)', () => {
  const one = edit(make('4-4-2'), { s5: [30, 76] });
  const found = T.findConflicts(one);
  assert.deepEqual(ids(found), ['geo-empty-channel-def-left']);
  checkFinding(found[0], one);
  assert.equal(found[0].severity, 'watch');
  assert.deepEqual(found[0].slots, []);
  assert.deepEqual(found[0].values, { channel: 'left', third: 'def', emptyChannels: 1, warnFrom: 3 });
  assert.match(found[0].text, /v obranné třetině \(y > 66,7\) není nikdo v kanálu „levé křídlo“ \(x < 20\)/);
  assert.match(found[0].basis, /počítá se i brankář/);

  // Čtyři obránci namačkaní u osy: čtyři prázdné kanály, tedy „warn“.
  const narrow = edit(make('4-4-2'), { s2: [46, 76], s5: [54, 76], s3: [47, 82], s4: [53, 82] });
  const empties = byKind(T.findConflicts(narrow), 'empty_channel');
  assert.deepEqual(ids(empties), ['geo-empty-channel-def-left', 'geo-empty-channel-def-left-half', 'geo-empty-channel-def-right-half', 'geo-empty-channel-def-right']);
  assert.ok(empties.every((c) => c.severity === 'warn' && c.values.emptyChannels === 4));
  // Brankář stojí ve středu, proto střed prázdný není ani při dvou stoperech v meziprostorech.
  assert.ok(!ids(T.findConflicts(make('4-4-2'))).some((id) => id.includes('centre')));
});

test('findConflicts: slabé zajištění za půlící čárou (thin_rest_defence) jen ve fázi s míčem', () => {
  const attack = { s2: [81, 44], s5: [19, 44], s6: [82, 36], s7: [62, 42], s8: [38, 42], s9: [18, 36] };
  const thin = edit(make('4-4-2'), attack);
  const [c] = byKind(T.findConflicts(thin, { phase: 'in' }), 'thin_rest_defence');
  checkFinding(c, thin);
  assert.equal(c.id, 'geo-thin-rest-defence');
  assert.equal(c.severity, 'watch');
  assert.deepEqual(c.slots, ['s3', 's4']);
  assert.deepEqual(c.values, { restDefence: 2, threshold: 3, lineY: 50 });
  assert.match(c.text, /^S míčem: za půlící čárou \(y > 50\) jsou jen 2 hráči v poli \(práh: aspoň 3\)/);
  assert.equal(T.analyzeShape(thin).restDefence, 2);
  // Jen jeden: warn. Ve fázi bez míče se zajištění nehlásí vůbec (a text by řekl „S míčem“).
  const thinner = edit(thin, { s4: [38, 48] });
  const [w] = byKind(T.findConflicts(thinner, { phase: 'in' }), 'thin_rest_defence');
  assert.equal(w.severity, 'warn');
  assert.match(w.text, /je jen 1 hráč v poli/);
  const outOnly = edit(make('4-4-2'), attack, 'out');
  assert.deepEqual(byKind(T.findConflicts(outOnly, { phase: 'out' }), 'thin_rest_defence'), []);
  assert.equal(byKind(T.findConflicts(outOnly, { phase: 'in' }), 'thin_rest_defence').length, 0, 'tvar s míčem je výchozí');
  assert.equal(byKind(T.findConflicts(edit(make('4-4-2'), attack, 'out'), { phase: 'out' }), 'thin_rest_defence').length, 0);
  // Práh jde zvýšit: i výchozí 4-4-2 (8 hráčů za čárou) pak hlásí.
  assert.equal(byKind(T.findConflicts(make('4-4-2'), { thresholds: { minRestDefence: 9 } }), 'thin_rest_defence').length, 1);
});

test('findConflicts: nerovnováha stran (width_imbalance)', () => {
  const mild = edit(make('4-4-2'), { s2: [27, 76] });
  const [c] = byKind(T.findConflicts(mild), 'width_imbalance');
  checkFinding(c, mild);
  assert.equal(c.id, 'geo-width-imbalance');
  assert.equal(c.severity, 'watch');
  assert.deepEqual(c.values, { left: 6, right: 4, centre: 0, difference: 2, threshold: 1, heavierSide: 'left' });
  assert.deepEqual(c.slots, ['s2', 's4', 's5', 's8', 's9', 's11']);
  assert.match(c.text, /vlevo od osy \(x < 50\) je 6 hráčů v poli, vpravo 4; rozdíl 2 \(práh 1\)/);
  const strong = edit(make('4-4-2'), { s2: [27, 76], s6: [27, 54] });
  assert.equal(byKind(T.findConflicts(strong), 'width_imbalance')[0].severity, 'warn');
  assert.equal(byKind(T.findConflicts(strong), 'width_imbalance')[0].values.difference, 4);
  // Rozdíl 1 je v pořádku (hráč na ose se nepočítá).
  const odd = edit(make('4-4-2'), { s6: [30, 54] });
  assert.equal(T.analyzeShape(odd).balance.left, 6);
  assert.deepEqual(byKind(T.findConflicts(edit(make('4-4-2'), { s10: [50, 30] })), 'width_imbalance'), []);
});

test('findConflicts: záměrně vadné rozložení hlásí všechny druhy, nejzávažnější první', () => {
  const t = edit(make('4-3-3'), { s10: [50, 2], s7: [34, 54], s8: [34, 54], s2: [60, 60] });
  const found = T.findConflicts(t);
  for (const c of found) checkFinding(c, t);
  assert.deepEqual(new Set(found.map((c) => c.kind)), new Set(['overlap', 'isolated_forward', 'empty_channel', 'width_imbalance']));
  const rank = { warn: 2, watch: 1 };
  for (let i = 1; i < found.length; i++) assert.ok(rank[found[i - 1].severity] >= rank[found[i].severity], 'seřazeno podle závažnosti');
  assert.equal(found[0].id, 'geo-overlap-s7-s8');
  assert.equal(new Set(ids(found)).size, found.length, 'id jsou jedinečná');
  // Totéž rozložení je deterministické.
  assert.deepEqual(T.findConflicts(t), found);
});

test('findConflicts: zdravé rozložení nehlásí nic, ani s míčem, ani bez míče', () => {
  for (const f of ['4-4-2', '4-3-3']) {
    for (const phase of ['in', 'out']) assert.deepEqual(T.findConflicts(make(f), { phase }), [], `${f}/${phase}`);
  }
  // Pár posunů v rámci šablony (křídla o pár jednotek výš, záloha o 4 níž) pořád nic závažného nehlásí.
  const tweaked = edit(make('4-4-2'), { s6: [84, 50], s9: [16, 50], s7: [60.5, 60], s8: [39.5, 60] });
  assert.ok(T.findConflicts(tweaked).every((c) => c.severity !== 'warn'));
});

test('hranice prahů: přesně na prahu se nehlásí, o kousek za ním ano', () => {
  const custom = (points) => ({ slots: points.map(([pos, px, py], i) => ({ key: `s${i + 1}`, pos, x: px, y: py, ox: px, oy: py })) });
  const GK = ['GK', 50, 91];
  // Řady: nová řada začíná až při mezeře VĚTŠÍ než 8.
  const rows = (gap) => T.analyzeShape(custom([GK, ['CB', 30, 60], ['CB', 70, 60], ['CM', 30, 60 - gap], ['CM', 70, 60 - gap]])).lines.map((l) => l.count);
  assert.deepEqual(rows(8), [4]);
  assert.deepEqual(rows(8.5), [2, 2]);
  // line_gap: větší než 30 je watch, větší než 45 (1,5 × práh) je warn.
  const gapAt = (g) => byKind(T.findConflicts(custom([GK, ['CB', 30, 80], ['CB', 70, 80], ['ST', 30, 80 - g], ['ST', 70, 80 - g]])), 'line_gap');
  assert.deepEqual(gapAt(30), []);
  assert.equal(gapAt(30.5)[0].severity, 'watch');
  assert.equal(gapAt(45)[0].severity, 'watch');
  assert.equal(gapAt(45.5)[0].severity, 'warn');
  // isolated_forward: vzdálenost větší než 40 je watch, větší než 60 je warn.
  const isoAt = (d) => byKind(T.findConflicts(custom([GK, ['ST', 50, 10], ['CM', 50, 10 + d], ['CM', 30, 11 + d]])), 'isolated_forward');
  assert.deepEqual(isoAt(40), []);
  assert.equal(isoAt(40.5)[0].severity, 'watch');
  assert.equal(isoAt(60)[0].severity, 'watch');
  assert.equal(isoAt(60.5)[0].severity, 'warn');
  // overlap: blíž než 5 je watch, blíž než 5 / 1,5 je warn.
  const overlapAt = (d) => byKind(T.findConflicts(custom([GK, ['CM', 40, 50], ['CM', 40 + d, 50]])), 'overlap');
  assert.deepEqual(overlapAt(5), []);
  assert.equal(overlapAt(4.9)[0].severity, 'watch');
  assert.equal(overlapAt(3.4)[0].severity, 'watch');
  assert.equal(overlapAt(3.3)[0].severity, 'warn');
  const strictOverlap = (d) => byKind(T.findConflicts(custom([GK, ['CM', 40, 50], ['CM', 40 + d, 50]]), { thresholds: { overlapDistance: 6 } }), 'overlap');
  assert.equal(strictOverlap(4)[0].severity, 'watch');
  assert.equal(strictOverlap(3.9)[0].severity, 'warn');
  // Zajištění: hráč přesně na půlící čáře (y = 50) za ní není.
  const rest = (py) => T.analyzeShape(custom([GK, ['CB', 30, py], ['CB', 70, 82]])).restDefence;
  assert.equal(rest(50), 1);
  assert.equal(rest(50.1), 2);
  // thin_rest_defence: 3 stačí, 2 je watch, 1 je warn.
  const restAt = (n) => byKind(T.findConflicts(custom([GK, ...Array.from({ length: 4 }, (_, i) => ['CB', 20 + i * 20, i < n ? 70 : 40])])), 'thin_rest_defence');
  assert.deepEqual(restAt(3), []);
  assert.equal(restAt(2)[0].severity, 'watch');
  assert.equal(restAt(1)[0].severity, 'warn');
});

// ------------------------------------------------------------------ compareTactics
test('compareTactics: 4-4-2 proti 4-3-3 (míry, rozdíly, shrnutí)', () => {
  const c = T.compareTactics(make('4-4-2'), make('4-3-3'));
  assert.equal(c.ok, true);
  assert.equal(c.phase, 'in');
  assert.deepEqual(c.metrics.a.lineSizes, [4, 4, 2]);
  assert.deepEqual(c.metrics.b.lineSizes, [4, 1, 2, 3]);
  assert.equal(c.metrics.a.depth, 52);
  assert.equal(c.metrics.b.depth, 58);
  assert.equal(c.metrics.delta.depth, 6);
  assert.equal(c.metrics.delta.lineCount, 1);
  assert.equal(c.metrics.delta.restDefence, -1);
  assert.equal(c.metrics.delta.thirdsAtt, 1);
  assert.equal(c.metrics.delta.channelsCentre, 2);
  assert.equal(c.metrics.delta.conflicts, 0);
  assert.equal(c.metrics.delta.lineSizes, undefined, 'rozdíl je jen u čísel');
  assert.deepEqual(c.newConflicts, []);
  assert.deepEqual(c.resolvedConflicts, []);
  const text = c.summary.join('\n');
  assert.match(text, /Formace: 4–4–2 → 4–3–3\./);
  assert.match(text, /Řady zezadu podle nakreslené polohy \(s míčem\): 4 – 4 – 2 → 4 – 1 – 2 – 3\./);
  assert.match(text, /Hloubka týmu \(hráči v poli\): 52 → 58 \(\+6\)\./);
  assert.match(text, /Hráči v poli za půlící čárou: 8 → 7 \(−1\)\./);
  assert.match(text, /Hráči podle třetin \(obranná\/střední\/útočná\): 5\/4\/2 → 5\/3\/3\./);
  assert.match(c.note, /jen geometrie/);
  assert.ok(!/Šířka týmu/.test(text), 'šířka se nezměnila, tak se nepíše');
});

test('compareTactics: nové a vyřešené nálezy, stejné taktiky, fáze, neplatný vstup', () => {
  const good = make('4-4-2');
  const bad = edit(good, { s10: [62, 6], s11: [38, 6] });
  const worse = T.compareTactics(good, bad);
  assert.deepEqual(ids(worse.newConflicts), ['geo-line-gap-mid-att']);
  assert.deepEqual(worse.resolvedConflicts, []);
  assert.equal(worse.metrics.delta.conflicts, 1);
  assert.equal(worse.metrics.delta.conflictsWarn, 1);
  assert.match(worse.summary.join('\n'), /Nový nález: S míčem: mezi řadami „záloha“ a „útok“ je svislá mezera 48 jednotek/);
  const better = T.compareTactics(bad, good);
  assert.deepEqual(better.newConflicts, []);
  assert.deepEqual(ids(better.resolvedConflicts), ['geo-line-gap-mid-att']);
  assert.match(better.summary.join('\n'), /Vyřešený nález: /);
  assert.match(better.summary.join('\n'), /Největší svislá mezera mezi řadami: 48 → 24 \(−24\)\./);

  const same = T.compareTactics(good, make('4-4-2'));
  assert.deepEqual(same.summary, ['Sledované míry geometrie jsou u obou rozložení stejné.']);
  assert.ok(Object.values(same.metrics.delta).every((v) => v === 0));

  // Změna jen ve fázi bez míče je vidět jen ve fázi „out“.
  const outEdit = edit(good, { s10: [62, 6], s11: [38, 6] }, 'out');
  assert.equal(T.compareTactics(good, outEdit, { phase: 'in' }).summary[0], 'Sledované míry geometrie jsou u obou rozložení stejné.');
  const out = T.compareTactics(good, outEdit, { phase: 'out' });
  assert.equal(out.phase, 'out');
  assert.deepEqual(ids(out.newConflicts), ['geo-line-gap-mid-att']);
  assert.match(out.summary.join('\n'), /Bez míče: mezi řadami/);

  for (const [a, b] of [[good, null], [null, good], [null, null], [{}, {}], [good, { slots: [] }]]) {
    let r;
    assert.doesNotThrow(() => {
      r = T.compareTactics(a, b);
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 1);
    assert.equal(r.metrics.a, null);
    assert.match(r.summary[0], /nejde porovnat/);
    assert.deepEqual([r.newConflicts, r.resolvedConflicts], [[], []]);
  }
});

// ------------------------------------------------------------------ opponentOverloads
function overloadFields(list) {
  return list.map((o) => [o.id, o.third, o.channel, o.own, o.opp, o.diff]);
}

test('opponentOverloads: soupeř 3-5-2 proti naší 4-4-2 ukáže přečíslení ve středu', () => {
  const own = make('4-4-2');
  const opp = make('3-5-2');
  // Výchozí šablona stojí v soupeřově polovině, takže v naší polovině žádné přečíslení nevzniká.
  assert.deepEqual(T.opponentOverloads(own, opp), []);

  // Soupeř s míčem tlačí tři střední záložníky (RCM, CM, LCM) k půlící čáře do středního pásu: y 40 u nich
  // je y' = 60 v našem rámci, tedy střední třetina naší poloviny. Naši dva střední záložníci stojí v meziprostorech.
  const pushed = edit(opp, { s6: [56, 40], s7: [50, 40], s8: [44, 40] });
  const found = T.opponentOverloads(own, pushed);
  assert.deepEqual(overloadFields(found), [['ovl-mid-centre', 'mid', 'centre', 0, 3, 3]]);
  const [o] = found;
  assert.deepEqual(o.oppSlots, ['s6', 's7', 's8']);
  assert.deepEqual(o.ownSlots, []);
  assert.match(o.text, /V naší polovině \(střední třetina\), kanál „střed“, hráčů v poli: soupeř s míčem 3, my bez míče 0 \(rozdíl \+3\)/);
  assert.match(o.basis, /heuristik/);
  assert.match(o.basis, /otočený o 180°/);
  assert.match(o.basis, /bez brankáře/);

  // Naši dva střední záložníci ve středním pásu bez míče: zůstane klasické 3 proti 2.
  const compact = edit(own, { s7: [56, 56], s8: [44, 56] }, 'out');
  assert.deepEqual(overloadFields(T.opponentOverloads(compact, pushed)), [['ovl-mid-centre', 'mid', 'centre', 2, 3, 1]]);
  // Naše tvar „s míčem“ se nepoužívá: kdo je ve fázi „in“ ve středu, bez míče nic nemění.
  const inOnly = edit(own, { s7: [56, 56], s8: [44, 56] }, 'in');
  assert.deepEqual(overloadFields(T.opponentOverloads(inOnly, pushed)), [['ovl-mid-centre', 'mid', 'centre', 0, 3, 3]]);
  // Soupeřova fáze „out“ se nepoužívá: kdo je jen „bez míče“ vysunutý, nepřečísluje.
  const outOnly = edit(opp, { s6: [56, 40], s7: [50, 40], s8: [44, 40] }, 'out');
  assert.deepEqual(T.opponentOverloads(own, outOnly), []);
});

test('opponentOverloads: otočení o 180° (x\' = 100 − x, y\' = 100 − y) a pravidla „aspoň 2 a aspoň o 1 víc“', () => {
  const own = make('4-3-3');
  // Dva soupeři vpředu uprostřed: (55,22) a (45,22) v jejich rámci jsou (45,78) a (55,78) v našem, tedy střed obranné třetiny.
  const opp = edit(make('4-3-3'), { s9: [55, 22], s10: [45, 22] });
  assert.deepEqual(overloadFields(T.opponentOverloads(own, opp)), [['ovl-def-centre', 'def', 'centre', 0, 2, 2]]);
  // Jeden hráč přečíslení není, ani proti nikomu.
  assert.deepEqual(T.opponentOverloads(own, make('4-3-3')), []);
  // Stejný počet nebo víc u nás: nic. Naši dva v témže pásu srovnají 2 : 2.
  const ours = edit(own, { s3: [56, 82], s4: [44, 82] }, 'out');
  assert.deepEqual(T.opponentOverloads(ours, opp), []);
  // Zrcadlení kanálů: soupeř vpravo v jeho rámci je u nás vlevo.
  const wing = edit(make('4-4-2'), { s6: [88, 30], s7: [90, 28] });
  const flank = T.opponentOverloads(make('4-4-2'), wing);
  assert.deepEqual(overloadFields(flank), [['ovl-def-left', 'def', 'left', 1, 2, 1]]);
  assert.equal(flank[0].third, 'def');
  // Brankář soupeře se nepočítá, i když ho uživatel vysune do naší poloviny.
  const sweeper = edit(make('4-3-3'), { s1: [50, 30], s10: [45, 22], s9: [55, 22] });
  assert.deepEqual(overloadFields(T.opponentOverloads(own, sweeper)), [['ovl-def-centre', 'def', 'centre', 0, 2, 2]]);
  // Práh jde změnit.
  assert.equal(T.opponentOverloads(own, opp, { thresholds: { overloadMinOpp: 3 } }).length, 0);
  assert.equal(T.opponentOverloads(ours, opp, { thresholds: { overloadMinDiff: 0 } }).length, 1);
  // Řazení: větší rozdíl první, při shodě obranná třetina před střední.
  const both = edit(make('4-3-3'), { s9: [55, 22], s10: [45, 22], s7: [56, 40], s8: [44, 40], s6: [50, 40] });
  const sorted = T.opponentOverloads(make('4-4-2'), both);
  assert.deepEqual(sorted.map((x) => [x.id, x.diff]), [['ovl-mid-centre', 3], ['ovl-def-centre', 2]]);
  // Naše kotva (DM) je ve středu střední třetiny: rozdíly se srovnají a obranná třetina jde první.
  assert.deepEqual(T.opponentOverloads(own, both).map((x) => [x.id, x.diff]), [['ovl-def-centre', 2], ['ovl-mid-centre', 2]]);
});

test('opponentOverloads: neplatný vstup nespadne', () => {
  for (const [a, b] of [[null, null], [make('4-4-2'), null], [null, make('4-4-2')], [{}, {}], [{ slots: [] }, { slots: [] }], [make('4-4-2'), 'x']]) {
    assert.deepEqual(T.opponentOverloads(a, b), []);
  }
  assert.deepEqual(T.opponentOverloads(make('4-4-2'), make('3-5-2'), { phase: 'in' }), [], 'volba phase se nepoužívá');
});

// ------------------------------------------------------------------ factsToObservations
test('factsToObservations: štítek heuristic_coach, bezpečná id, základ v textu', () => {
  const t = edit(make('4-3-3'), { s10: [50, 2], s7: [34, 54], s8: [34, 54] });
  const items = [].concat(T.findConflicts(t), T.shapeFacts(T.analyzeShape(t)));
  const obs = T.factsToObservations(items, { prefix: 'in-' });
  assert.equal(obs.length, items.length);
  assert.ok(obs.every((o) => o.label === 'heuristic_coach' && o.minute === null));
  assert.ok(obs.every((o) => o.id.startsWith('in-') && o.id.length <= 40));
  assert.equal(new Set(obs.map((o) => o.id)).size, obs.length);
  assert.ok(core.LABELS.includes('heuristic_coach'));
  assert.equal(core.LABEL_TO_TIER.heuristic_coach, 'inferred', 'nálezy jsou nejvýš odhad');
  // Projdou kontrolou jádra bez výjimky (id, štítky, počet) a text nese i základ nálezu.
  const normalized = core.normalizeObservations(obs);
  assert.equal(normalized.length, obs.length);
  const overlap = obs.find((o) => o.id === 'in-geo-overlap-s7-s8');
  assert.match(overlap.text, /stojí na stejném místě.*\(Základ: .*heuristika této aplikace/);
  assert.ok(obs.every((o) => o.text.length <= 1500));
  // Bez voleb se id nemění; fakta s id a textem projdou.
  assert.deepEqual(T.factsToObservations(T.shapeFacts(T.analyzeShape(make('4-4-2'))))[0].id, 'geo-shape-lines');
  // Přečíslení jde stejnou cestou.
  const ovl = T.opponentOverloads(make('4-3-3'), edit(make('4-3-3'), { s9: [55, 22], s10: [45, 22] }));
  assert.equal(T.factsToObservations(ovl, { prefix: 'opp-' })[0].id, 'opp-ovl-def-centre');
});

test('factsToObservations: duplicity, dlouhá a špatná id, nevhodné položky', () => {
  const long = 'a'.repeat(60);
  const obs = T.factsToObservations([{ id: long, text: 'jedna' }, { id: long, text: 'dvě' }, { id: long, text: 'tři' }, { id: 'zlé id!', text: 'čtyři' }, { text: 'bez id' }], { prefix: 'p-' });
  assert.equal(obs.length, 5);
  assert.ok(obs.every((o) => o.id.length <= 40 && /^[A-Za-z0-9_.:-]+$/.test(o.id)));
  assert.equal(new Set(obs.map((o) => o.id)).size, 5);
  assert.deepEqual(obs.slice(0, 3).map((o) => o.id.slice(-3)), ['aaa', 'a-2', 'a-3']);
  assert.equal(obs[3].id, 'p-zlé-id-'.replace('é', '-'));
  assert.equal(obs[4].id, 'p-geo-5');
  assert.deepEqual(T.factsToObservations([null, 5, 'x', {}, { id: 'a' }, { id: 'b', text: '   ' }, { id: 'c', text: 5 }]), []);
  assert.deepEqual(T.factsToObservations(null), []);
  assert.deepEqual(T.factsToObservations(undefined, { prefix: 'x' }), []);
  assert.equal(T.factsToObservations([{ id: 'a', text: 'x'.repeat(3000) }])[0].text.length, 1500);
});

// ------------------------------------------------------------------ poctivost textů
test('texty nikdy netvrdí, jak se hráči chovají ve FM27, ani nevymýšlejí mechaniky', () => {
  const texts = [];
  const bad = edit(make('4-3-3'), { s10: [50, 2], s7: [34, 54], s8: [34, 54], s2: [60, 60], s5: [30, 40] });
  const found = T.findConflicts(bad);
  const narrow = T.findConflicts(edit(make('4-4-2'), { s2: [46, 76], s5: [54, 76], s3: [47, 82], s4: [53, 82] }));
  const thin = T.findConflicts(edit(make('4-4-2'), { s2: [81, 44], s5: [19, 44], s6: [82, 36], s7: [62, 42], s8: [38, 42], s9: [18, 36], s4: [38, 48] }));
  const gap = T.findConflicts(edit(make('4-4-2'), { s10: [62, 6], s11: [38, 6] }));
  const overloads = T.opponentOverloads(make('4-4-2'), edit(make('3-5-2'), { s6: [56, 40], s7: [50, 40], s8: [44, 40] }));
  const compare = T.compareTactics(make('4-4-2'), bad);
  const imports = [
    T.importPlanJson(plan),
    T.importPlanJson(mod((p) => { delete p.phaseShapes.out; p.formation = '1-2-3'; p.variants = [1]; p.players[2].position = 'XYZ'; })),
    T.importPlanJson(null),
  ];
  for (const list of [found, narrow, thin, gap, overloads]) for (const f of list) texts.push(f.text, f.basis);
  for (const f of T.shapeFacts(T.analyzeShape(bad))) texts.push(f.text, f.basis);
  texts.push(...compare.summary, compare.note);
  for (const r of imports) texts.push(...r.report.warnings, ...r.report.errors, r.report.provenance.text);
  const fmfSample = Uint8Array.from([...PREFIX, ...new Array(20).fill(0), ...frame(manifest(TOKENS))]);
  const info = T.inspectFmf(fmfSample, { decompress: fakeDecompress });
  texts.push(...info.warnings, ...info.errors, ...info.unknown, ...T.inspectFmf(new Uint8Array(3)).errors);
  assert.ok(texts.length > 60);
  for (const text of texts) {
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 5, text);
    assert.doesNotMatch(text, /\bvždy\b/i, text);
    assert.doesNotMatch(text, /\bnikdy\b/i, text);
    assert.doesNotMatch(text, /FM27 hráč/i, text);
    assert.equal(core.scanMechanics(text), null, `mechanika FM27 v textu: ${text}`);
  }
  // Nález, který nese práh, říká, že je to heuristika aplikace, ne pravidlo FM27.
  for (const f of [...found, ...narrow, ...thin, ...gap]) assert.match(f.basis, /heuristik\w* této aplikace, ne pravidl\w+ FM27/, f.id);
});

// ------------------------------------------------------------------ prahy, UMD a čistota modulu
test('DEFAULT_THRESHOLDS: zmrazené, číselné a každý práh má v kódu svůj komentář', () => {
  assert.ok(Object.isFrozen(T.DEFAULT_THRESHOLDS));
  for (const [key, value] of Object.entries(T.DEFAULT_THRESHOLDS)) assert.ok(Number.isFinite(value), key);
  assert.deepEqual(
    Object.keys(T.DEFAULT_THRESHOLDS),
    ['lineBreakY', 'lineGapY', 'isolatedDistance', 'overlapDistance', 'minRestDefence', 'restDefenceLineY', 'maxWidthImbalance', 'emptyChannelsWarn', 'warnFactor', 'overloadMinOpp', 'overloadMinDiff']
  );
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes('const DEFAULT_THRESHOLDS'));
  assert.ok(start > 0);
  for (const key of Object.keys(T.DEFAULT_THRESHOLDS)) {
    const at = lines.findIndex((l, i) => i > start && l.trim().startsWith(`${key}:`));
    assert.ok(at > start, key);
    assert.match(lines[at - 1].trim(), /^\/\//, `práh ${key} nemá komentář nad sebou`);
  }
  // Hodnoty z kontraktu: zajištění 3 hráči za půlící čárou, nerovnováha stran nad 1, přečíslení aspoň 2 a o 1.
  assert.equal(T.DEFAULT_THRESHOLDS.minRestDefence, 3);
  assert.equal(T.DEFAULT_THRESHOLDS.restDefenceLineY, 50);
  assert.equal(T.DEFAULT_THRESHOLDS.maxWidthImbalance, 1);
  assert.equal(T.DEFAULT_THRESHOLDS.overloadMinOpp, 2);
  assert.equal(T.DEFAULT_THRESHOLDS.overloadMinDiff, 1);
});

test('kanály a třetiny: hranice podle zadání', () => {
  const channels = [[0, 'left'], [19.9, 'left'], [20, 'leftHalf'], [39.9, 'leftHalf'], [40, 'centre'], [59.9, 'centre'], [60, 'rightHalf'], [79.9, 'rightHalf'], [80, 'right'], [100, 'right']];
  for (const [x, id] of channels) assert.equal(T.channelOf(x), id, String(x));
  const thirds = [[0, 'att'], [33.2, 'att'], [33.3, 'mid'], [50, 'mid'], [66.7, 'mid'], [66.8, 'def'], [100, 'def']];
  for (const [y, id] of thirds) assert.equal(T.thirdOf(y), id, String(y));
  assert.deepEqual(T.CHANNELS.map((c) => c.id), ['left', 'leftHalf', 'centre', 'rightHalf', 'right']);
  assert.deepEqual(T.THIRDS.map((c) => c.id), ['def', 'mid', 'att']);
});

test('modul: UMD v prohlížeči, determinismus, žádné DOM, čas ani náhoda', () => {
  // Bez `module` se zaregistruje globál TrenerTactics a vezmou se TrenerCore a TrenerFm27Cs z globálu.
  const sandbox = { TrenerCore: core, TrenerFm27Cs: cs };
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.TrenerTactics.makeTactic, 'function');
  assert.deepEqual(Object.keys(sandbox.TrenerTactics).sort(), Object.keys(T).sort());
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.TrenerTactics.makeTactic({ id: 'a', formation: '433' }))), T.makeTactic({ id: 'a', formation: '433' }));
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.TrenerTactics.importPlanJson(plan))), T.importPlanJson(plan));
  // Soubor z jiného kontextu (jiný realm) se pozná jako binární.
  const fmf = Uint8Array.from([...PREFIX, ...frame(manifest(TOKENS))]);
  assert.equal(sandbox.TrenerTactics.inspectFmf(fmf, { decompress: fakeDecompress }).ok, true);

  assert.deepEqual(T.analyzeShape(make('4-2-3-1')), T.analyzeShape(make('4-2-3-1')));
  assert.deepEqual(T.importPlanJson(plan), T.importPlanJson(plan));
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(withoutComments, /Math\.random|Date\.now|new Date|performance\.now|\bdocument\b|\bwindow\b|localStorage|fetch\s*\(|XMLHttpRequest/);
  assert.doesNotMatch(withoutComments, /\brequire\((?!'\.\/(?:core|fm27cs)\.js'\))/, 'jediné závislosti jsou core.js a fm27cs.js (obojí čisté moduly)');
});

// ------------------------------------------------------------------ náhodné vstupy (deterministicky, vlastní generátor)
function lcg(seed) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const POS_CODES = ['GK', 'RB', 'LB', 'CB', 'RCB', 'LCB', 'DM', 'CM', 'RCM', 'LCM', 'AM', 'RW', 'LW', 'ST', 'XYZ', ''];
function finiteEverywhere(value, where = '') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), where);
  else if (value && typeof value === 'object') for (const k of Object.keys(value)) finiteEverywhere(value[k], `${where}.${k}`);
}

test('náhodné platné taktiky: invarianty rozboru, nálezů, porovnání a přečíslení', () => {
  const rnd = lcg(987);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const coord = () => (rnd() < 0.1 ? pick([0, 100, 50, 20, 40, 60, 80, 33.3, 66.7]) : Math.round(rnd() * 1000) / 10);
  const random = (n) => ({ slots: Array.from({ length: n }, (_, k) => ({ key: `s${k + 1}`, pos: pick(POS_CODES), x: coord(), y: coord(), ox: coord(), oy: coord() })) });
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(rnd() * 14);
    const a = random(n);
    const b = random(1 + Math.floor(rnd() * 14));
    for (const phase of ['in', 'out']) {
      const an = T.analyzeShape(a, { phase });
      assert.equal(an.ok, true);
      finiteEverywhere(Object.assign({}, an, { thresholds: null }), 'analysis');
      assert.equal(an.lines.reduce((sum, l) => sum + l.count, 0), an.counts.outfield);
      for (const group of [an.thirds, an.channels, an.zones]) assert.equal(Object.values(group).reduce((sum, v) => sum + v, 0), n);
      assert.equal(an.gaps.length, Math.max(0, an.lines.length - 1));
      assert.equal(an.balance.left + an.balance.centre + an.balance.right, an.counts.outfield);
      assert.ok(an.restDefence <= an.counts.outfield);
      for (let k = 1; k < an.lines.length; k++) assert.ok(an.lines[k - 1].avgY >= an.lines[k].avgY, 'řady jdou zezadu dopředu');
      for (const g of an.gaps) assert.ok(g.gap > an.thresholds.lineBreakY - 1e-9, 'mezera mezi řadami je nad prahem shluku');

      const found = T.findConflicts(a, { phase });
      assert.equal(new Set(ids(found)).size, found.length, 'id nálezů jsou jedinečná');
      const keys = a.slots.map((s) => s.key);
      for (const c of found) {
        assert.ok(['watch', 'warn'].includes(c.severity));
        assert.ok(c.slots.every((k) => keys.includes(k)));
        assert.match(c.text, /\d/);
        assert.match(c.basis, /heuristik/);
        finiteEverywhere(c.values, c.id);
      }
      const facts = T.shapeFacts(an);
      assert.ok(facts.length >= 3);
      const cmp = T.compareTactics(a, b, { phase });
      assert.equal(cmp.ok, true);
      assert.ok(cmp.summary.length >= 1);
      finiteEverywhere(cmp.metrics.delta, 'delta');
      for (const o of T.opponentOverloads(a, b)) {
        assert.equal(o.diff, o.opp - o.own);
        assert.ok(o.opp >= 2 && o.diff >= 1 && o.own >= 0);
        assert.equal(o.ownSlots.length, o.own);
        assert.equal(o.oppSlots.length, o.opp);
      }
      const obs = T.factsToObservations(found.concat(facts), { prefix: 'p-' });
      assert.equal(obs.length, found.length + facts.length);
      assert.equal(new Set(ids(obs)).size, obs.length);
      assert.doesNotThrow(() => core.normalizeObservations(obs.slice(0, 40)));
    }
    // Zrcadlení zleva doprava nemění počty ani rozměry.
    const mirrored = clone(a);
    for (const s of mirrored.slots) {
      s.x = 100 - s.x;
      s.ox = 100 - s.ox;
    }
    const m = T.analyzeShape(mirrored);
    const o = T.analyzeShape(a);
    assert.deepEqual(m.lines.map((l) => l.count), o.lines.map((l) => l.count));
    assert.deepEqual([m.depth, m.width.overall, m.thirds], [o.depth, o.width.overall, o.thirds]);
  }
});

test('náhodné platné plány: import → export → import je stabilní', () => {
  const rnd = lcg(4242);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const coord = () => Math.round(rnd() * 1000) / 10;
  for (let i = 0; i < 300; i++) {
    const p = clone(plan);
    const players = Array.from({ length: 3 + Math.floor(rnd() * 10) }, (_, k) => ({
      id: `q${k}`,
      name: pick(['', `Jméno ${k}`]),
      position: pick(POS_CODES),
      role: pick(['', `Role ${k}`]),
      foot: pick(['unknown', 'left', 'right']),
      attributes: pick([{}, { pace: 12, stamina: null }, { a: 'x' }]),
      flags: pick([undefined, {}, { injury: true }]),
      x: coord(),
      y: coord(),
    }));
    p.players = players;
    p.phaseShapes.in.players = players.map((q) => ({ ...q, x: coord(), y: coord() }));
    p.phaseShapes.out.players = pick([players, players.slice(1)]).map((q) => ({ ...q, x: coord(), y: coord() }));
    p.phaseShapes.in.instructions = pick(['', 'Jedna\nDvě', ' mezery  ']);
    p.phaseShapes.out.instructions = pick(['', 'Out 1']);
    p.formation = pick(['4-4-2', '433', 'nic', '3–5–2']);

    const first = T.importPlanJson(p);
    assert.deepEqual(first.report.errors, [], JSON.stringify(first.report.errors));
    assert.equal(first.tactic.slots.length, first.players.length);
    assert.ok(first.tactic.slots.every((s, k) => s.playerId === first.players[k].id && s.x >= 0 && s.x <= 100 && s.oy >= 0 && s.oy <= 100));
    const second = T.importPlanJson(T.exportPlanJson(first.tactic, first.players, { club: first.report.club || '' }));
    assert.deepEqual(second.report.errors, []);
    assert.deepEqual(second.tactic, first.tactic);
    assert.deepEqual(second.players, first.players);
  }
});

test('náhodně poškozené vstupy nikdy nevyhodí výjimku', () => {
  const rnd = lcg(12345);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const junk = () => pick([null, undefined, NaN, Infinity, -Infinity, -1, 0, 1, 50, 100, 101, 1e9, '', 'x', '50', '4-3-3', true, false, [], {}, [1, 2], { x: 1 }, 'GK', 'ST', 0.1, { slots: [] }, () => 1]);
  function mutate(value) {
    if (Array.isArray(value)) {
      const copy = value.slice();
      if (copy.length && rnd() < 0.5) copy[Math.floor(rnd() * copy.length)] = rnd() < 0.5 ? junk() : mutate(copy[Math.floor(rnd() * copy.length)]);
      if (rnd() < 0.1) copy.length = Math.floor(rnd() * copy.length);
      return copy;
    }
    if (value && typeof value === 'object') {
      const copy = { ...value };
      const keys = Object.keys(copy);
      if (keys.length) {
        const k = pick(keys);
        const r = rnd();
        if (r < 0.3) delete copy[k];
        else if (r < 0.6) copy[k] = junk();
        else copy[k] = mutate(copy[k]);
      }
      return copy;
    }
    return junk();
  }
  const randomTactic = () => {
    let t = T.makeTactic({ id: 'a', name: 'n', formation: pick(T.FORMATIONS).id });
    for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) t = mutate(t);
    return rnd() < 0.1 ? junk() : t;
  };
  const decompressors = [null, undefined, () => null, () => { throw new Error('x'); }, (b) => b.subarray(4), () => new Uint8Array(0), () => 'abc', () => ({}), () => manifest(['A', '.tac', 'b', '.img'])];
  for (let i = 0; i < 400; i++) {
    const a = randomTactic();
    const b = randomTactic();
    const opts = { phase: pick(['in', 'out', 'x', undefined, null, 5]), thresholds: rnd() < 0.5 ? mutate({ lineBreakY: 8, lineGapY: 30, overlapDistance: 5, minRestDefence: 3 }) : junk() };
    assert.doesNotThrow(() => {
      const analysis = T.analyzeShape(a, opts);
      JSON.stringify(analysis);
      T.shapeFacts(analysis, opts);
      T.shapeFacts(junk(), opts);
      JSON.stringify(T.findConflicts(a, opts));
      JSON.stringify(T.compareTactics(a, b, opts));
      JSON.stringify(T.opponentOverloads(a, b, opts));
      T.factsToObservations(rnd() < 0.5 ? T.findConflicts(a, opts) : mutate([{ id: 'a', text: 'b' }]), mutate({ prefix: 'x' }));
      const exported = T.exportPlanJson(a, mutate([{ id: 'p1', name: 'n' }]), junk());
      if (exported) JSON.stringify(exported);
      T.normalizeFormationId(junk());
      T.formationById(junk());
      T.makeTactic(junk());
      T.makeTactic({ formation: junk(), id: junk(), kind: junk() });
      T.lineOf(junk());
    }, `taktika ${i}`);
    const corrupted = mutate(mutate(plan));
    assert.doesNotThrow(() => {
      const r = T.importPlanJson(rnd() < 0.2 ? JSON.stringify(corrupted) : corrupted, mutate({ now: 1 }));
      JSON.stringify(r);
      if (r.tactic) {
        assert.deepEqual(r.report.errors, []);
        T.analyzeShape(r.tactic);
        T.exportPlanJson(r.tactic, r.players);
      } else {
        assert.ok(r.report.errors.length >= 1);
      }
    }, `plán ${i}`);
    const bytes = Uint8Array.from({ length: Math.floor(rnd() * 200) }, () => pick([0, 1, 2, 0x28, 0xb5, 0x2f, 0xfd, 0x61, 0x66, 0x65, 0x2e, 255, 4]));
    const file = rnd() < 0.7 ? Uint8Array.from([...PREFIX, ...bytes]) : bytes;
    assert.doesNotThrow(() => JSON.stringify(T.inspectFmf(rnd() < 0.1 ? junk() : file, rnd() < 0.9 ? { decompress: pick(decompressors) } : junk())), `fmf ${i}`);
  }
});

// ------------------------------------------------------------------ inspectFmf (kontejner .fmf)
test('inspectFmf: platný kontejner dá název (odhad) a zdroje, nic z taktiky nedekóduje', () => {
  const data = fmfFile(frame(manifest(TOKENS)));
  let calls = 0;
  const r = T.inspectFmf(data, { decompress: (b, max) => (calls++, assert.equal(max, 1024 * 1024 + 1), fakeDecompress(b)) });
  assert.equal(r.ok, true);
  assert.equal(calls, 1);
  assert.equal(r.size, data.length);
  assert.deepEqual(r.header, { hex: '02 01 61 66 65 2e', matchesObserved: true });
  assert.deepEqual(r.manifest.tokens, TOKENS);
  assert.equal(r.manifest.tacticNameGuess, 'MojeTaktika');
  assert.equal(r.manifest.tacticNameConfidence, 'low');
  assert.match(r.manifest.tacticNameBasis, /před prvním „\.tac“/);
  assert.deepEqual(r.manifest.resources, ['MojeTaktika.tac', 'logo.img', 'x.aom']);
  assert.equal(r.manifest.offset, 46);
  assert.deepEqual(r.frames, [{ offset: 46, ok: true, size: manifest(TOKENS).length, manifestLike: true }]);
  assert.deepEqual(r.tacticFields, { status: 'not_decoded' });
  assert.deepEqual(r.verified, []);
  for (const field of ['formace', 'hráčské pozice', 'role a povinnosti', 'týmové instrukce', 'individuální instrukce', 'mentalita']) assert.ok(r.unknown.includes(field), field);
  assert.deepEqual(r.errors, []);
  assert.equal(r.reason, '');
  const warnings = r.warnings.join('\n');
  assert.match(warnings, /z jednoho vzorku exportu, ne specifikace formátu FMF/);
  assert.match(warnings, /Název taktiky je jen odhad/);
  assert.match(warnings, /nebyla dekódována a nic z nich není ověřeno/);
});

test('inspectFmf: kandidát z konce není manifest, ale dřívější ano → najde ho', () => {
  const data = fmfFile(frame([...manifest(TOKENS), 0x11, 0x11]), frame(filler(300)));
  const r = T.inspectFmf(data, { decompress: fakeDecompress });
  assert.equal(r.ok, true);
  assert.equal(r.manifest.tacticNameGuess, 'MojeTaktika');
  assert.equal(r.manifest.offset, 46);
  assert.equal(r.candidates.found, 2);
  assert.equal(r.candidates.tried, 2);
  assert.deepEqual(r.frames.map((f) => [f.manifestLike, f.ok]), [[false, true], [true, true]], 'zkouší se odzadu');
  assert.ok(r.frames[0].offset > r.frames[1].offset);
  assert.equal(r.frames[0].size, 300);
  assert.match(r.frames[0].reason, /nevypadá jako manifest/);
  assert.match(r.warnings.join('\n'), /nebyl v posledním nalezeném rámci; přijat starší kandidát na offsetu 46/);
  assert.match(r.warnings.join('\n'), /Z 2 zkoušených rámců byl manifestem jen jeden; ostatní \(1\) se nepodařilo/);
  // Falešná magic hlavička za manifestem: zkusí se a přeskočí.
  const falseMagic = Uint8Array.from([...fmfFile(frame(manifest(TOKENS))), 0, 0, ...MAGIC, 1, 2, 3]);
  const f = T.inspectFmf(falseMagic, { decompress: fakeDecompress });
  assert.equal(f.ok, true);
  assert.equal(f.candidates.found, 2);
  assert.equal(f.manifest.tacticNameGuess, 'MojeTaktika');
  // Rámec, který nejde rozbalit (decompress vrátí null nebo vyhodí výjimku), se přeskočí.
  const broken = fmfFile(frame(manifest(TOKENS)), frame([0xff, 1, 2, 3]));
  assert.equal(T.inspectFmf(broken, { decompress: fakeDecompress }).ok, true);
  assert.equal(T.inspectFmf(broken, { decompress: fakeDecompress }).frames[0].reason, 'nejde rozbalit');
  let first = true;
  const throwing = (b) => {
    if (first) {
      first = false;
      throw new Error('boom');
    }
    return fakeDecompress(b);
  };
  const t = T.inspectFmf(fmfFile(frame(manifest(TOKENS)), frame(filler(20))), { decompress: throwing });
  assert.equal(t.ok, true);
  assert.equal(t.frames[0].ok, false);
});

test('inspectFmf: žádný kandidát nevypadá jako manifest → ok:false s českým důvodem', () => {
  const payloadOnly = T.inspectFmf(fmfFile(frame(filler(500))), { decompress: fakeDecompress });
  assert.equal(payloadOnly.ok, false);
  assert.match(payloadOnly.reason, /nevypadá jako manifest/);
  assert.match(payloadOnly.reason, /Soubor nebyl interpretován/);
  assert.deepEqual(payloadOnly.errors, [payloadOnly.reason]);
  assert.equal(payloadOnly.manifest, null);
  assert.deepEqual(payloadOnly.tacticFields, { status: 'not_decoded' });
  assert.deepEqual(payloadOnly.verified, []);
  assert.equal(payloadOnly.frames.length, 1);

  const undecodable = T.inspectFmf(fmfFile(frame([0xff, 1]), frame([0xff, 2])), { decompress: fakeDecompress });
  assert.equal(undecodable.ok, false);
  assert.equal(undecodable.frames.length, 2);
  assert.ok(undecodable.frames.every((f) => !f.ok && f.size === null && f.reason === 'nejde rozbalit'));
  const returnsNull = T.inspectFmf(fmfFile(frame(manifest(TOKENS))), { decompress: () => null });
  assert.equal(returnsNull.ok, false);
  const wrongType = T.inspectFmf(fmfFile(frame(manifest(TOKENS))), { decompress: () => 'text' });
  assert.equal(wrongType.ok, false);

  // Žádná magic hlavička zstd.
  const noMagic = T.inspectFmf(Uint8Array.from([...PREFIX, ...filler(200, 0)]), { decompress: fakeDecompress });
  assert.equal(noMagic.ok, false);
  assert.match(noMagic.reason, /nebyl nalezen Zstandard manifest/);
  assert.equal(noMagic.candidates.found, 0);
  // Bez dekomprese modul sám nic nerozbaluje a řekne to.
  const noDecompress = T.inspectFmf(fmfFile(frame(manifest(TOKENS))));
  assert.equal(noDecompress.ok, false);
  assert.match(noDecompress.reason, /decompress/);
  assert.equal(noDecompress.candidates.found, 1);
  assert.deepEqual(noDecompress.frames, []);
});

test('inspectFmf: rozbalovač, který hlásí chybu s kódem limit, znamená „příliš velký“, ne „nejde rozbalit“; jiná chyba zůstává „nejde rozbalit“', () => {
  const tooLarge = T.inspectFmf(fmfFile(frame(manifest(TOKENS))), { decompress: () => { const e = new Error('víc než strop'); e.code = 'limit'; throw e; } });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.frames[0].reason, 'překročil limit 1 MiB');
  assert.match(tooLarge.reason, /Manifest překročil limit 1 MiB/);
  const plain = T.inspectFmf(fmfFile(frame(manifest(TOKENS))), { decompress: () => { throw new Error('jiná chyba'); } });
  assert.equal(plain.frames[0].reason, 'nejde rozbalit');
  assert.doesNotMatch(plain.reason, /překročil limit/);
  // jiné kódy chyb dekodéru (obří okno, příliš mnoho bloků, odkaz za okno, vadný proud) nejsou „překročil limit 1 MiB“: tohle hlášení patří jen kódu limit
  for (const code of ['bigwindow', 'blocks', 'window', 'blocksize', 'litend', 'inexact', 'overread', 'corrupt', 'dictionary', 'magic', 'input', 'internal', undefined]) {
    const r = T.inspectFmf(fmfFile(frame(manifest(TOKENS))), { decompress: () => { const e = new Error('chyba dekodéru'); e.code = code; throw e; } });
    assert.equal(r.frames[0].reason, 'nejde rozbalit', 'kód ' + code);
    assert.doesNotMatch(r.reason, /překročil limit/, 'kód ' + code);
  }
});

test('inspectFmf: limity (soubor 5 MiB, manifest 1 MiB, nejvýš 16 kandidátů)', () => {
  let calls = 0;
  const spy = (b) => (calls++, fakeDecompress(b));
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(PREFIX);
  const tooBig = T.inspectFmf(big, { decompress: spy });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /překračuje limit 5 MiB/);
  assert.equal(tooBig.size, 5 * 1024 * 1024 + 1);
  assert.equal(calls, 0, 'velký soubor se vůbec nerozbaluje');
  // Přesně 5 MiB je ještě v limitu (jen v něm není žádný rámec).
  const edge = new Uint8Array(5 * 1024 * 1024);
  edge.set(PREFIX);
  assert.match(T.inspectFmf(edge, { decompress: spy }).reason, /nebyl nalezen Zstandard manifest/);

  // Manifest nad 1 MiB se odmítne; přesně 1 MiB projde.
  const oversize = T.inspectFmf(fmfFile(frame([1])), { decompress: () => new Uint8Array(1024 * 1024 + 1) });
  assert.equal(oversize.ok, false);
  assert.equal(oversize.reason, 'Manifest překročil limit 1 MiB.');
  assert.match(oversize.frames[0].reason, /limit 1 MiB/);
  assert.equal(oversize.frames[0].ok, false);
  const exact = new Uint8Array(1024 * 1024);
  exact.set(manifest(TOKENS));
  const atLimit = T.inspectFmf(fmfFile(frame([1])), { decompress: () => exact });
  assert.equal(atLimit.ok, true);
  assert.equal(atLimit.manifest.size, 1024 * 1024);
  assert.equal(atLimit.manifest.tacticNameGuess, 'MojeTaktika');

  // Hodně falešných magic hlaviček za manifestem: zkoušeno jen posledních 16, platný rámec je dál.
  const junk = Array.from({ length: 48 }, () => [...MAGIC, 0]).flat();
  const capped = T.inspectFmf(fmfFile(frame(manifest(TOKENS)), junk), { decompress: fakeDecompress });
  assert.equal(capped.ok, false);
  assert.equal(capped.candidates.found, 49);
  assert.equal(capped.candidates.tried, 16);
  assert.equal(capped.candidates.limit, 16);
  assert.equal(capped.frames.length, 16);
  // S menším počtem kandidátů se najde a varování řekne, kolik jich je.
  const fifteen = Array.from({ length: 15 }, () => [...MAGIC, 0]).flat();
  const found = T.inspectFmf(fmfFile(frame(manifest(TOKENS)), fifteen), { decompress: fakeDecompress });
  assert.equal(found.ok, true);
  assert.equal(found.candidates.tried, 16);
  const sixteenPlus = T.inspectFmf(fmfFile(frame(manifest(TOKENS)), fifteen, [...MAGIC, 0]), { decompress: fakeDecompress });
  assert.equal(sixteenPlus.ok, false);
});

test('inspectFmf: cizí soubor, prázdný vstup a nebinární vstup → ok:false, žádná výjimka', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...MAGIC, ...manifest(TOKENS)]);
  const foreign = T.inspectFmf(png, { decompress: fakeDecompress });
  assert.equal(foreign.ok, false);
  assert.match(foreign.reason, /^Hlavička neodpovídá pozorovanému prefixu FM27 exportu; soubor nebyl interpretován\.$/);
  assert.deepEqual(foreign.header, { hex: '89 50 4e 47 0d 0a', matchesObserved: false });
  assert.deepEqual(foreign.frames, []);
  assert.equal(foreign.manifest, null);
  assert.match(foreign.warnings.join('\n'), /pochází z jednoho vzorku exportu, ne ze specifikace; jiná hlavička tedy nemusí znamenat/);
  assert.equal(T.inspectFmf(Buffer.from('Toto je obyčejný text, ne export taktiky.'), { decompress: fakeDecompress }).ok, false);
  assert.equal(T.inspectFmf(Uint8Array.from(PREFIX.slice(0, 3)), { decompress: fakeDecompress }).ok, false, 'krátký soubor');

  for (const input of [new Uint8Array(0), [], new ArrayBuffer(0)]) {
    const r = T.inspectFmf(input, { decompress: fakeDecompress });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Soubor je prázdný.');
    assert.equal(r.size, 0);
  }
  for (const input of [null, undefined, 'text', 42, {}, { length: 3 }, [1, 2, 300], [1.5]]) {
    let r;
    assert.doesNotThrow(() => {
      r = T.inspectFmf(input, { decompress: fakeDecompress });
    }, JSON.stringify(input));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'Vstup není binární soubor.');
  }
  // Různé typy binárních vstupů se berou stejně.
  const bytes = fmfFile(frame(manifest(TOKENS)));
  for (const input of [bytes, Buffer.from(bytes), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), Array.from(bytes)]) {
    assert.equal(T.inspectFmf(input, { decompress: fakeDecompress }).ok, true);
  }
  // Bez voleb ani jako parametr nespadne.
  assert.equal(T.inspectFmf(bytes).ok, false);
  assert.equal(T.inspectFmf(bytes, null).ok, false);
  assert.equal(T.inspectFmf(bytes, { decompress: 'ne funkce' }).ok, false);
});

test('inspectFmf: .tac na prvním místě → zdroje bez názvu; hodně tokenů se ořízne', () => {
  const tacFirst = T.inspectFmf(fmfFile(frame(manifest(['.tac', 'MojeTaktika', 'logo', '.img']))), { decompress: fakeDecompress });
  assert.equal(tacFirst.ok, true);
  assert.equal(tacFirst.manifest.tacticNameGuess, null);
  assert.equal(tacFirst.manifest.tacticNameBasis, null);
  assert.equal(tacFirst.manifest.tacticNameConfidence, null);
  assert.deepEqual(tacFirst.manifest.resources, ['logo.img']);
  assert.ok(!tacFirst.warnings.join().includes('Název taktiky je jen odhad'));

  // Jako v Pythonu: název je token před prvním „.tac“, které NENÍ na indexu 0.
  const twoTac = T.inspectFmf(fmfFile(frame(manifest(['.tac', 'Prvni', '.tac', 'Druhy', '.img']))), { decompress: fakeDecompress });
  assert.equal(twoTac.manifest.tacticNameGuess, 'Prvni');
  assert.deepEqual(twoTac.manifest.resources, ['Prvni.tac', 'Druhy.img']);

  const many = ['PrvniNazev', '.tac', ...Array.from({ length: 400 }, (_, i) => `polozka${i}`)];
  const r = T.inspectFmf(fmfFile(frame(manifest(many))), { decompress: fakeDecompress });
  assert.equal(r.ok, true);
  assert.equal(r.manifest.tokens.length, 200);
  assert.ok(r.manifest.tokenCount >= 402);
  assert.equal(r.manifest.tacticNameGuess, 'PrvniNazev');
});

const hasZstd = typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function';
test('inspectFmf: skutečný zstd z Node (jen kontrola, že kontrakt decompress sedí)', { skip: !hasZstd && 'tento Node nemá zlib.zstd' }, () => {
  const realDecompress = (bytes) => {
    try {
      return zlib.zstdDecompressSync(bytes);
    } catch {
      return null;
    }
  };
  const compressed = zlib.zstdCompressSync(Buffer.from(manifest(TOKENS)));
  assert.deepEqual([...compressed.subarray(0, 4)], MAGIC, 'hlavička zstd rámce je 28 b5 2f fd');
  const single = T.inspectFmf(Uint8Array.from([...PREFIX, ...new Array(40).fill(0), ...compressed]), { decompress: realDecompress });
  assert.equal(single.ok, true);
  assert.equal(single.manifest.tacticNameGuess, 'MojeTaktika');
  assert.deepEqual(single.manifest.resources, ['MojeTaktika.tac', 'logo.img', 'x.aom']);
  // Za manifestem další rámec s daty: poslední kandidát není manifest, první ano.
  const payload = zlib.zstdCompressSync(Buffer.alloc(1500, 0xaa));
  const two = T.inspectFmf(Uint8Array.from([...PREFIX, ...new Array(10).fill(0), ...compressed, 0x11, 0x11, ...payload]), { decompress: realDecompress });
  assert.equal(two.ok, true);
  assert.equal(two.manifest.tacticNameGuess, 'MojeTaktika');
  assert.equal(two.frames.length, 2);
  assert.equal(two.frames[0].manifestLike, false);
});

// ---------------------------------------------------------------- taktika přečtená z obrazovky hry
const READ_OK = {
  name: 'Hlavní',
  formation: '4-2-3-1',
  mentality: 'Positive',
  instructions: [{ group: 'S míčem', text: 'Shorter passing' }, { group: 'Bez míče', text: 'Higher defensive line' }, 'Counter-press', 'Counter-press'],
  roles: [
    { position: 'ST', role: 'Advanced Forward', duty: 'Attack' },
    { position: 'GK', role: 'Sweeper Keeper', duty: 'Support' },
    { position: 'CB', role: 'Ball Playing Defender', duty: 'Defend' },
  ],
  notes: 'Čitelné.',
};

test('normalizeTacticExtraction: čistá odpověď → formace jako id šablony, instrukce bez duplicit', () => {
  const r = T.normalizeTacticExtraction(READ_OK);
  assert.equal(r.ok, true);
  assert.equal(r.read.formation, '4-2-3-1');
  assert.equal(r.read.mentality, 'Positive');
  assert.deepEqual(r.read.instructions, ['S míčem: Shorter passing', 'Bez míče: Higher defensive line', 'Counter-press']);
  assert.equal(r.read.roles.length, 3);
  assert.deepEqual(r.issues, []);
});

test('normalizeTacticExtraction: neznámá nebo nejednoznačná formace se nenahradí jinou, jen se řekne', () => {
  for (const f of ['3-4-2-1-0', 'Diamond', '4-3', 'abc', '4-4-2 (úzká)']) {
    const r = T.normalizeTacticExtraction({ formation: f, mentality: 'Balanced' });
    assert.equal(r.read.formation, null, f);
    assert.ok(r.issues.some((i) => /není mezi šablonami/.test(i)), f);
    assert.equal(r.ok, true); // mentalita se přečetla
  }
  assert.equal(T.normalizeTacticExtraction({ formation: 433 }).read.formation, '4-3-3');
});

test('normalizeTacticExtraction: nesmysly, prázdno a špatné typy dají ok=false bez výjimky', () => {
  for (const bad of [null, undefined, 'x', 5, [], { formation: null, mentality: null, instructions: [], roles: [] }, { instructions: 'text', roles: 'text' }]) {
    const r = T.normalizeTacticExtraction(bad);
    assert.equal(r.ok, false);
    assert.ok(r.issues.length >= 1);
  }
});

test('normalizeTacticExtraction: text z obrázku se čistí (řídicí znaky, délky, limity), role bez názvu a pozice divného tvaru se hlídají', () => {
  const long = 'x'.repeat(500);
  const r = T.normalizeTacticExtraction({
    name: 'A\nB\u0000C' + long,
    formation: '4-3-3',
    mentality: long,
    instructions: Array.from({ length: 60 }, (_, i) => `Instrukce ${i}`).concat([{ text: '' }, 7, null]),
    roles: [{ position: 'st', role: 'R1' }, { position: 'Útočník vpravo', role: 'R2', duty: 'D' }, { position: 'CB' }, 'x', null, { role: '', duty: '' }],
  });
  assert.ok(r.read.name.length <= 60 && !/[\u0000\n]/.test(r.read.name));
  assert.ok(r.read.mentality.length <= 90);
  assert.equal(r.read.instructions.length, 40);
  assert.ok(r.issues.some((i) => /nad limit/.test(i)));
  assert.deepEqual(r.read.roles.map((x) => [x.pos, x.role]), [['ST', 'R1'], ['', 'R2']]); // „st“ se opraví na velká písmena, divná pozice se zahodí, role bez názvu a povinnosti také
  const max = T.normalizeTacticExtraction({ roles: Array.from({ length: 30 }, (_, i) => ({ position: 'ST', role: 'R' + i })) });
  assert.equal(max.read.roles.length, 14);
});

test('tacticFromExtraction: vytvoří taktiku z šablony, role dosadí jen k jednoznačným pozicím, zbytek dá do poznámky', () => {
  const { read } = T.normalizeTacticExtraction(READ_OK);
  const r = T.tacticFromExtraction(read, { careerId: 'c1', kind: 'primary', fileName: 'taktika.png', now: 1234 });
  assert.ok(r.tactic);
  const t = r.tactic;
  assert.equal(t.formation, '4-2-3-1');
  assert.equal(t.name, 'Hlavní');
  assert.equal(t.careerId, 'c1');
  assert.equal(t.mentality, 'Positive');
  assert.deepEqual(t.teamInstructions, ['S míčem: Shorter passing', 'Bez míče: Higher defensive line', 'Counter-press']);
  const st = t.slots.filter((s) => s.pos === 'ST');
  const gk = t.slots.filter((s) => s.pos === 'GK');
  assert.equal(st.length, 1);
  assert.equal(st[0].role, 'Advanced Forward');
  assert.equal(st[0].duty, 'Attack');
  assert.equal(gk[0].role, 'Sweeper Keeper');
  // dva stoperi, jedna role v odpovědi: pořadí se nehádá
  assert.ok(t.slots.filter((s) => s.pos === 'CB').length >= 2 || t.slots.filter((s) => s.pos === 'CB').every((s) => !s.role));
  assert.ok(t.slots.filter((s) => s.pos === 'CB').every((s) => s.role === ''));
  assert.deepEqual(r.unplaced, ['CB: Ball Playing Defender (Defend)']);
  assert.match(t.notes, /nepodařilo bezpečně přiřadit.*CB: Ball Playing Defender/);
  assert.match(t.notes, /Čitelné\./);
  assert.deepEqual(t.source, { type: 'screenshot', fileName: 'taktika.png', importedAt: 1234, fields: { formation: 'screenshot_verified', mentality: 'screenshot_verified', style: 'unknown', instructions: 'screenshot_verified', roles: 'screenshot_verified' } });
});

test('tacticFromExtraction: dvě role se stejnou pozicí v odpovědi se nepřiřadí ani k jedinému hráči; role bez pozice jde do poznámky', () => {
  const { read } = T.normalizeTacticExtraction({ formation: '4-3-3', roles: [{ position: 'ST', role: 'A' }, { position: 'ST', role: 'B' }, { role: 'Bez pozice' }] });
  const r = T.tacticFromExtraction(read, {});
  assert.ok(r.tactic.slots.filter((s) => s.pos === 'ST').every((s) => s.role === ''));
  assert.equal(r.unplaced.length, 3);
});

test('tacticFromExtraction: bez rozpoznané formace taktika nevznikne, neplatný vstup nevyhodí výjimku', () => {
  const noFormation = T.tacticFromExtraction(T.normalizeTacticExtraction({ mentality: 'Balanced' }).read, {});
  assert.equal(noFormation.tactic, null);
  assert.match(noFormation.issues[0], /Bez formace/);
  for (const bad of [null, undefined, 'x', {}, { formation: 'neplatná' }]) assert.equal(T.tacticFromExtraction(bad, {}).tactic, null);
});

test('tacticFromExtraction: pole, která se nepřečetla, jsou ve zdroji „neznámé“ a název se vezme z volby nebo z formace', () => {
  const { read } = T.normalizeTacticExtraction({ formation: '4-4-2' });
  const r = T.tacticFromExtraction(read, {});
  assert.equal(r.tactic.name, 'Taktika 4-4-2');
  assert.deepEqual(r.tactic.source.fields, { formation: 'screenshot_verified', mentality: 'unknown', style: 'unknown', instructions: 'unknown', roles: 'unknown' });
  assert.equal(T.tacticFromExtraction(read, { name: 'Moje' }).tactic.name, 'Moje');
});
