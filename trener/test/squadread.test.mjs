import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const SR = require('../src/squadread.js');
const source = readFileSync(new URL('../src/squadread.js', import.meta.url), 'utf8');

// Vzory jsou z pohledů soupisky české hry FM27 (průzkum 7. 11. 2026); jména a čísla jsou vymyšlená.

test('česká soupiska: pozice a atributy se převedou na kanonické kódy a názvy', () => {
  const r = SR.normalizeSquadRead({
    players: [
      { name: 'T. Svoboda', positions: ['O/KO/Z/OZ (P)'], age: 24, attributes: { Hlavičky: 8, 'Obranné zákroky': 15, Obsazování: 14, 'Poziční hra': 13 }, injured: null },
      { name: 'A. Kučera', positions: ['DZ, Z (S)'], age: 22, attributes: { Přihrávky: 16, Zpracování: 15 } },
      { name: 'J. Novotný', positions: ['B'], age: 29, attributes: {} },
    ],
  });
  assert.equal(r.proposals.length, 3);
  const [a, b, c] = r.proposals;
  assert.deepEqual(a.positions, ['DR', 'WBR', 'MR', 'AMR']);
  assert.deepEqual(a.attributes, { Heading: 8, Tackling: 15, Marking: 14, Positioning: 13 });
  assert.deepEqual(b.positions, ['DM', 'MC']);
  assert.deepEqual(b.attributes, { Passing: 16, 'First Touch': 15 });
  assert.deepEqual(c.positions, ['GK']);
  assert.equal(a.injured, false);
});

test('anglická soupiska a pozice jako samostatné prvky seznamu fungují dál', () => {
  const r = SR.normalizeSquadRead({ players: [{ name: 'John Smith', positions: ['GK', 'DC'], age: 30, attributes: { Finishing: 14, Pace: 99 } }] });
  assert.deepEqual(r.proposals[0].positions, ['GK', 'DC']);
  assert.deepEqual(r.proposals[0].attributes, { Finishing: 14 });
  assert.ok(r.issues.some((i) => /Pace/.test(i)), 'hodnota 99 se vynechá a řekne se to');
});

test('stejný hráč na dvou snímcích (jiné atributy) se sloučí, delší jméno vyhraje, rozpor se oznámí', () => {
  const r = SR.normalizeSquadRead({
    players: [
      { name: 'L. Horák', positions: ['O (L)'], age: null, attributes: { Rychlost: 15, Síla: 9 } },
      { name: 'Lukáš Horák', positions: ['O/KO (L)'], age: 25, attributes: { Výdrž: 14, Rychlost: 16 } },
      { name: 'M. Veselý', positions: ['DZ'], attributes: { Technika: 13 } },
    ],
  });
  assert.equal(r.proposals.length, 2);
  const h = r.proposals[0];
  assert.equal(h.name, 'Lukáš Horák');
  assert.deepEqual(h.attributes, { Pace: 15, Strength: 9, Stamina: 14 });
  assert.deepEqual(h.positions, ['DL', 'WBL']);
  assert.equal(h.age, 25);
  assert.ok(r.issues.some((i) => /Pace/.test(i) && /různou hodnotou/.test(i)));
});

test('neplatné řádky se zahodí a nečitelné pozice se oznámí', () => {
  const r = SR.normalizeSquadRead({ players: [{ name: '', positions: ['B'] }, null, { name: 'X Y', positions: ['něco divného'] }, { name: 'Z Z', positions: null }] });
  assert.equal(r.proposals.length, 2);
  assert.deepEqual(r.proposals[0].positions, []);
  assert.ok(r.issues.some((i) => /bez čitelného jména/.test(i)));
  assert.ok(r.issues.some((i) => /nepodařilo převést/.test(i)));
  assert.deepEqual(SR.normalizeSquadRead({}).proposals, []);
  assert.deepEqual(SR.normalizeSquadRead(null).proposals, []);
});

test('skryté údaje se do atributů nedostanou jen proto, že je model napíše pod nějakým názvem: číslo mimo 1 až 20 se zahodí', () => {
  const r = SR.normalizeSquadRead({ players: [{ name: 'Ab Cd', attributes: { Hlavičky: 120, Síla: 0, Výskok: 12.5, Rychlost: 12 } }] });
  assert.deepEqual(r.proposals[0].attributes, { Pace: 12 });
});

test('planWrites: nový hráč se přidá, známý se doplní o atributy (a změna se vypíše), beze změny se přeskočí', () => {
  const existing = [
    { id: 'p1', name: 'Tomáš Svoboda', positions: ['DR'], age: 24, attributes: { Heading: 8, Tackling: 15 }, flags: { injury: false } },
    { id: 'p2', name: 'Aleš Kučera', positions: [], age: null, attributes: {}, flags: { injury: false } },
    { id: 'p3', name: 'Jiří Novotný', positions: ['GK'], age: 29, attributes: { Reflexes: 14 }, flags: { injury: false } },
  ];
  const proposals = SR.normalizeSquadRead({
    players: [
      { name: 'T. Svoboda', positions: ['O (P)'], age: 24, attributes: { Hlavičky: 9, Rychlost: 13, 'Obranné zákroky': 15 }, injured: true },
      { name: 'A. Kučera', positions: ['DZ'], age: 22, attributes: { Přihrávky: 16 } },
      { name: 'J. Novotný', positions: ['B'], age: 29, attributes: {} },
      { name: 'N. Nový', positions: ['ÚT (S)'], age: 19, attributes: { Zakončování: 12 } },
    ],
  }).proposals;
  const plan = SR.planWrites(existing, proposals);
  assert.deepEqual(plan.add.map((p) => p.name), ['N. Nový']);
  assert.deepEqual(plan.same, ['Jiří Novotný']);
  assert.equal(plan.update.length, 2);
  const u1 = plan.update.find((u) => u.id === 'p1');
  assert.deepEqual(u1.patch.attributes, { Heading: 9, Tackling: 15, Pace: 13 }, 'Heading se přepsal novou hodnotou, Tackling zůstal, Pace přibyl');
  assert.equal(u1.patch.injury, true);
  assert.equal(u1.patch.positions, undefined, 'pozice už byly');
  assert.ok(u1.changes.includes('Heading: 8 → 9') && u1.changes.some((c) => /Pace: nově 13/.test(c)));
  const u2 = plan.update.find((u) => u.id === 'p2');
  assert.deepEqual(u2.patch.positions, ['DM']);
  assert.equal(u2.patch.age, 22);
  assert.deepEqual(u2.patch.attributes, { Passing: 16 });
});

test('prompt: popisuje českou obrazovku, zakazuje hádání a skryté údaje; modul je čistý', () => {
  assert.match(SR.PROMPT, /Poziční hra/);
  assert.match(SR.PROMPT, /O \(S\)/);
  assert.match(SR.PROMPT, /Nikdy nic nehádej/);
  assert.match(SR.PROMPT, /skryté údaje/);
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(withoutComments, /Math\.random|Date\.now|new Date|\bdocument\b|\bwindow\b|localStorage|fetch\s*\(/);
  assert.doesNotMatch(withoutComments, /\brequire\((?!'\.\/fm27cs\.js'\))/);
});
