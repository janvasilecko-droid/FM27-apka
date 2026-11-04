import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../src/labexplain.js');

const ctx = () => ({
  observations: { 'geo-shape-lines': { label: 'heuristic_coach' }, 'geo-line-gap-def-mid': { label: 'heuristic_coach' }, 'geo-overlap-s8-s9': { label: 'heuristic_coach' } },
  passages: new Set(['bk:x:1:1']),
  slotKeys: ['s1', 's8', 's9', 's10'],
});
const good = () => ({
  summary: { text: 'Podle nakresleného rozložení jsou čtyři řady a útočník vysoko před zbytkem.', tier: 'inferred', refs: ['geo-shape-lines'] },
  worksWell: [{ text: 'Obě pozice v záloze pokrývají střed, v teorii z knihy se tomu říká krytí.', tier: 'inferred', refs: ['geo-shape-lines', 'bk:x:1:1'], slots: ['s8', 's9'] }],
  conflicts: [{ text: 'Dva hráči stojí na stejném místě, takže se jejich prostor překrývá.', tier: 'inferred', refs: ['geo-overlap-s8-s9'], slots: ['s8', 's9'] }],
  unknown: { text: 'Role jsou jen tvůj text, jejich skutečný pohyb nevím.', items: ['Ověř ve hře, co daná role dělá'] },
});
const errorsOf = (x, c) => L.validateExplain(x, c || ctx()).errors.join(' | ');

test('platné vysvětlení projde', () => {
  const r = L.validateExplain(good(), ctx());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('chybějící sekce, neobjekt, seznamy', () => {
  const x = good();
  delete x.conflicts;
  assert.match(errorsOf(x), /Chybí sekce: conflicts/);
  assert.match(errorsOf(5), /není JSON objekt/);
  const y = good();
  y.worksWell = 'nic';
  assert.match(errorsOf(y), /worksWell: musí být seznam/);
  const z = good();
  z.worksWell = Array.from({ length: 4 }, () => good().worksWell[0]);
  assert.match(errorsOf(z), /worksWell: nejvýš 3 položky/);
});

test('tier nikdy nad odhad, odkazy musí existovat', () => {
  let x = good();
  x.summary.tier = 'observed';
  assert.match(errorsOf(x), /summary: úroveň observed tady není povolená/);
  x = good();
  x.worksWell[0].tier = 'user_entered';
  assert.match(errorsOf(x), /worksWell\[1\]: úroveň user_entered tady není povolená/);
  x = good();
  x.summary.refs = ['geo-nic'];
  assert.match(errorsOf(x), /neodpovídá žádnému/);
});

test('sloty musí existovat a konflikt musí mít nález', () => {
  let x = good();
  x.conflicts[0].slots = ['s99'];
  assert.match(errorsOf(x), /slot „s99“ v rozložení není/);
  x = good();
  x.conflicts[0].refs = ['bk:x:1:1'];
  assert.match(errorsOf(x), /konflikt musí odkazovat na nález/);
  x = good();
  x.worksWell[0].slots = [];
  const r = L.validateExplain(x, ctx());
  assert.ok(r.warnings.some((w) => /bez uvedených slotů/.test(w)));
});

test('mechaniky FM27 se odmítnou', () => {
  const x = good();
  x.worksWell[0].text = 'Hráč s vysokým CA to zvládne díky match engine.';
  assert.match(errorsOf(x), /interní mechanice/);
});

test('prompt: sloty, fakta, úryvky a pravidla', () => {
  const tactic = { name: 'Hlavní', formation: '4-4-2', slots: [{ key: 's1', pos: 'GK', x: 50, y: 91, ox: 50, oy: 91, playerId: 'p1', role: 'Brankář', duty: '' }] };
  const t = L.buildExplainTurns({ tactic, phase: 'in', facts: [{ id: 'geo-shape-lines', text: 'S míčem: řady 4-4-2.' }], passages: [{ id: 'bk:x:1:1', title: 'Kniha', where: 'list PDF č. 1', text: 'Text.' }], playerNames: { p1: 'Novák' } });
  assert.match(t[0].content, /s1 \| GK \| Novák \| role: Brankář/);
  assert.match(t[0].content, /geo-shape-lines \| S míčem: řady 4-4-2\./);
  assert.match(t[0].content, /bk:x:1:1 \| Kniha \| list PDF č\. 1/);
  assert.match(t[0].content, /Fakta jsou geometrie bodů/);
  const out = L.buildExplainTurns({ tactic, phase: 'out' });
  assert.match(out[0].content, /fáze bez míče/);
  assert.match(out[0].content, /\(žádná\)/);
});

test('konflikt nemůže stát na neutrálním faktu o tvaru (geo-shape-…)', () => {
  const x = good();
  x.conflicts[0].refs = ['geo-shape-lines'];
  assert.match(errorsOf(x), /konflikt musí odkazovat na nález konfliktu/);
  // s výčtem skutečných konfliktů z aplikace se kontroluje přesně
  const c = ctx();
  c.conflictIds = ['geo-overlap-s8-s9'];
  const ok = good();
  assert.equal(L.validateExplain(ok, c).errors.join(' | '), '');
  const bad = good();
  bad.conflicts[0].refs = ['geo-line-gap-def-mid'];
  assert.match(L.validateExplain(bad, c).errors.join(' | '), /konflikt musí odkazovat/);
});

test('sloty musí být seznam textů, ne text nebo čísla', () => {
  const a = good();
  a.worksWell[0].slots = 's8';
  assert.match(errorsOf(a), /slots musí být seznam textů/);
  const b = good();
  b.conflicts[0].slots = [8, null];
  assert.match(errorsOf(b), /slots musí být seznam textů/);
});
