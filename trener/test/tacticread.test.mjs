import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../src/tactics.js');
const K = require('../src/fm27know.js');
const TA = require('../src/tacticanalysis.js');

// Čtení české obrazovky „Tvar týmu“ a „Týmové instrukce“ (rozložení z průzkumu 7. 11. 2026; jména jsou vymyšlená).
const ROWS = [
  { slot: 'B', role: 'GK', oopRole: 'GK', player: 'J. Novotný' },
  { slot: 'O (P)', role: 'O', oopRole: 'FB', player: 'T. Svoboda' },
  { slot: 'O (S)', role: 'CB', oopRole: 'CB', player: 'R. Dvořák' },
  { slot: 'O (S)', role: 'BCB', oopRole: 'CB', player: 'S. Procházka' },
  { slot: 'O (L)', role: 'KO', oopRole: 'FB', player: 'L. Horák' },
  { slot: 'DZ', role: 'DZ', oopRole: 'DM', player: 'A. Kučera' },
  { slot: 'DZ', role: 'ZTH', oopRole: 'DM', player: 'M. Veselý' },
  { slot: 'OZ (P)', role: 'PHH', oopRole: 'TWM', player: 'W. Král' },
  { slot: 'OZ (S)', role: 'FR', oopRole: 'AM', player: 'N. Pospíšil' },
  { slot: 'OZ (L)', role: 'IW', oopRole: 'TWM', player: 'G. Marek' },
  { slot: 'ÚT (S)', role: 'KH', oopRole: 'CFD', player: 'G. Jelínek' },
  { slot: 'S1', role: 'GK', oopRole: 'GK', player: 'N. Rezerva' }, // lavička se vynechá
];
const INSTR = [
  { label: 'Přímočarost přihrávek', value: 'Mnohem kratší', phase: 'in' },
  { label: 'Tempo', value: 'Vyšší', phase: 'in' },
  { label: 'Šířka při útočení', value: 'Užší', phase: 'in' },
  { label: 'Linie napadání', value: 'Nízký blok', phase: 'out' },
  { label: 'Výška obranná linie', value: 'Vyšší', phase: 'out' },
  { label: 'Napadání', value: 'Častěji', phase: 'out' },
  { label: 'Obranný přechod', value: 'Kontrapresink', phase: 'out' },
];
const RAW = { name: 'Moje taktika', formation: null, style: 'Čistý štít', mentality: 'Vyvážený', instructions: INSTR, roles: ROWS, notes: '' };

test('české čtení: z jedenácti míst tabulky se odvodí formace 4-2-3-1 (lavička se vynechá) a řekne se to', () => {
  const r = T.normalizeTacticExtraction(RAW);
  assert.equal(r.ok, true);
  assert.equal(r.read.roles.length, 11, 'řádek lavičky S1 se nebere');
  assert.equal(r.read.formation, '4-2-3-1');
  assert.deepEqual(r.read.formationCandidates, ['4-2-3-1']);
  assert.ok(r.issues.some((i) => /odvozená z jedenácti míst/.test(i)));
  assert.equal(r.read.style, 'Čistý štít');
  assert.equal(r.read.mentality, 'Vyvážený');
  assert.deepEqual(r.read.roles[0], { pos: '', slot: 'B', fm: 'GK', role: 'GK', oopRole: 'GK', duty: '', player: 'J. Novotný' });
  assert.equal(r.read.roles[2].fm, 'DC');
  assert.equal(r.read.roles[5].fm, 'DM');
  assert.equal(r.read.roles[10].fm, 'ST');
});

test('české čtení: formace napsaná na obrazovce má přednost před odvozenou a špatná se neodvodí', () => {
  const r = T.normalizeTacticExtraction({ ...RAW, formation: '4-3-3' });
  assert.equal(r.read.formation, '4-3-3');
  assert.ok(!r.issues.some((i) => /odvozená/.test(i)));
  // deset míst: nic se neodvozuje
  const few = T.normalizeTacticExtraction({ ...RAW, roles: ROWS.slice(0, 10) });
  assert.equal(few.read.formation, null);
  assert.deepEqual(few.read.formationCandidates, []);
  // místa, která nesedí na žádnou šablonu
  const odd = ROWS.slice(0, 11).map((x) => ({ ...x, slot: 'ÚT (S)' }));
  const o = T.normalizeTacticExtraction({ ...RAW, roles: odd });
  assert.equal(o.read.formation, null);
  assert.ok(o.issues.some((i) => /nesedí na žádnou šablonu/.test(i)));
});

test('formationsBySlotCodes: stejná množina pozic dá šablonu(y), jiná nic', () => {
  assert.deepEqual(T.formationsBySlotCodes(['GK', 'DR', 'DC', 'DC', 'DL', 'DM', 'DM', 'AMR', 'AMC', 'AML', 'ST']), ['4-2-3-1']);
  assert.deepEqual(T.formationsBySlotCodes(['GK', 'DR', 'DC', 'DC', 'DL', 'MR', 'MC', 'MC', 'ML', 'ST', 'ST']), ['4-4-2']);
  assert.deepEqual(T.formationsBySlotCodes(['GK']), []);
  assert.deepEqual(T.formationsBySlotCodes(null), []);
});

test('instrukce {label, value, phase} se zapíšou jako „Název: Hodnota“ a slovník je pozná česky', () => {
  const r = T.normalizeTacticExtraction(RAW);
  assert.equal(r.read.instructions[0], 'Přímočarost přihrávek: Mnohem kratší');
  const ids = r.read.instructions.map((t) => K.parseInstruction(t));
  assert.ok(ids.every(Boolean), 'všechny přečtené instrukce se poznají');
  assert.deepEqual(ids.map((p) => `${p.id}=${p.value}`), ['passingDirectness=Much Shorter', 'tempo=Higher', 'attackingWidth=Narrower', 'lineOfEngagement=Low Block', 'defensiveLine=Higher', 'triggerPress=More Often', 'defensiveTransition=Counter-Press']);
  // starý tvar {group, text} dál funguje
  const old = T.normalizeTacticExtraction({ instructions: [{ group: 'S míčem', text: 'Tempo: Higher' }, 'Bez míče: Counter-Press'] });
  assert.deepEqual(old.read.instructions, ['S míčem: Tempo: Higher', 'Bez míče: Counter-Press']);
});

test('tacticFromExtraction: role s míčem i bez míče se přiřadí k místům šablony, dvojice na téže pozici zprava doleva, s poznámkou o odhadu', () => {
  const r = T.normalizeTacticExtraction(RAW);
  const made = T.tacticFromExtraction(r.read, { name: 'Z obrazovky', careerId: 'c1', now: 1000 });
  assert.ok(made.tactic);
  assert.deepEqual(made.unplaced, []);
  const t = made.tactic;
  const by = (pos) => t.slots.find((s) => s.pos === pos);
  assert.equal(by('GK').role, 'GK');
  assert.equal(by('RB').role, 'O');
  assert.equal(by('RB').oopRole, 'FB');
  assert.equal(by('LB').role, 'KO');
  // dva stopeři: první řádek tabulky dostane pravého (RCB), druhý levého (LCB)
  assert.equal(by('RCB').role, 'CB');
  assert.equal(by('LCB').role, 'BCB');
  assert.equal(by('RDM').role, 'DZ');
  assert.equal(by('LDM').role, 'ZTH');
  assert.equal(by('RAM').role, 'PHH');
  assert.equal(by('AM').oopRole, 'AM');
  assert.equal(by('ST').oopRole, 'CFD');
  assert.equal(by('RCB').readPlayer, 'R. Dvořák');
  assert.match(t.notes, /Pořadí hráčů na téže pozici .* odhad/);
  assert.equal(t.style, 'Čistý štít');
  assert.equal(t.mentality, 'Vyvážený');
  assert.equal(t.teamInstructions.length, 7);
  assert.equal(t.source.fields.style, 'screenshot_verified');
  // analýza vidí jen ověřené role: BCB a CFD (a GK) ano, ostatní zkratky jsou nerozpoznané, nikoli odhadnuté
  const a = TA.analyze(t, {});
  assert.equal(a.coverage.settingsKnown, 7);
  assert.equal(a.coverage.rolesIn.known, 3, 'GK, CB a BCB s míčem'); // ostatní zkratky nejsou ověřené, role zůstaly nepoznané
  assert.equal(a.coverage.rolesOut.known, 4, 'GK, dvakrát CB a CFD bez míče');
  assert.equal(a.mentality, 'Balanced');
});

test('tacticFromExtraction: počet řádků na pozici se nerovná počtu míst → bez hádání do poznámky', () => {
  const rows = ROWS.filter((x) => x.slot !== 'O (S)'); // chybí oba stopeři, takže zbývá devět míst
  const r = T.normalizeTacticExtraction({ ...RAW, formation: '4-2-3-1', roles: rows });
  const made = T.tacticFromExtraction(r.read, { name: 'X' });
  assert.ok(made.tactic);
  const rcb = made.tactic.slots.find((s) => s.pos === 'RCB');
  assert.equal(rcb.role, '');
  // jeden stoper z obrazovky na dvě místa: nepřiřadí se (nehádá se, který)
  const one = T.normalizeTacticExtraction({ ...RAW, formation: '4-2-3-1', roles: ROWS.filter((x) => x.slot !== 'O (S)' || x.role === 'CB') });
  const m2 = T.tacticFromExtraction(one.read, { name: 'Y' });
  assert.equal(m2.tactic.slots.find((s) => s.pos === 'RCB').role, '');
  assert.ok(m2.unplaced.some((u) => /O \(S\)/.test(u)));
});

test('staré čtení rolí (zkratka pozice shodná s místem šablony) funguje dál, včetně oopRole', () => {
  const r = T.normalizeTacticExtraction({ formation: '4-4-2', roles: [{ position: 'GK', role: 'Goalkeeper', duty: 'Defend' }, { position: 'RB', role: 'Full-Back', oopRole: 'Holding Full-Back', duty: '' }] });
  const made = T.tacticFromExtraction(r.read, { name: 'Starý' });
  assert.equal(made.tactic.slots.find((s) => s.pos === 'GK').role, 'Goalkeeper');
  assert.equal(made.tactic.slots.find((s) => s.pos === 'RB').oopRole, 'Holding Full-Back');
});

test('sameName: iniciála a příjmení sedí, jiná jména ne', () => {
  assert.equal(T.sameName('L. Horníček', 'Lukáš Horníček'), true);
  assert.equal(T.sameName('Lukáš Horníček', 'L. Horníček'), true);
  assert.equal(T.sameName('William Gomes', 'William Gomes'), true);
  assert.equal(T.sameName('N. Paz', 'Nico Paz'), true);
  assert.equal(T.sameName('G. Prestianni', 'Giovanni Prestianni'), true);
  assert.equal(T.sameName('L. Horníček', 'Jan Horníček'), false, 'jiná iniciála');
  assert.equal(T.sameName('Novák', 'Novotný'), false);
  assert.equal(T.sameName('J. N.', 'Jan Novák'), false, 'bez příjmení se nepárujeme');
  assert.equal(T.sameName('', 'Jan Novák'), false);
});

test('assignReadPlayers: jednoznačná jména dostanou playerId, nejednoznačná a neznámá ne; readPlayer se odstraní', () => {
  const r = T.normalizeTacticExtraction(RAW);
  const made = T.tacticFromExtraction(r.read, { name: 'Z obrazovky' });
  const squad = [
    { id: 'p1', name: 'Jiří Novotný' },
    { id: 'p2', name: 'Tomáš Svoboda' },
    { id: 'p3', name: 'Radek Dvořák' },
    { id: 'p4', name: 'Marek Veselý' },
    { id: 'p5', name: 'Martin Veselý' }, // druhý „M. Veselý“: nejednoznačné
    { id: 'p6', name: 'Gabriel Jelínek' },
  ];
  const out = T.assignReadPlayers(made.tactic, squad);
  const by = (pos) => out.tactic.slots.find((s) => s.pos === pos);
  assert.equal(by('GK').playerId, 'p1');
  assert.equal(by('RB').playerId, 'p2');
  assert.equal(by('RCB').playerId, 'p3');
  assert.equal(by('LDM').playerId, null, 'M. Veselý sedí na dva hráče');
  assert.ok(out.ambiguous.includes('M. Veselý'));
  assert.equal(by('ST').playerId, 'p6');
  assert.ok(out.unmatched.includes('S. Procházka'));
  assert.ok(out.tactic.slots.every((s) => !('readPlayer' in s)));
  assert.ok(made.tactic.slots.some((s) => s.readPlayer), 'původní taktika se nemění');
  assert.equal(out.assigned.length, 4);
});
