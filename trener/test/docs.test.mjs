/* Dokument docs/ANALYZA_SESTAVY_A_PRIPRAVY.md popisuje pravidla, prahy a počty. Tahle zkouška hlídá, aby se s kódem nerozešel:
   tabulky pravidel (ID, název, zdroj úsudku, závažnost), prahy, počty ze slovníku hry a názvy atributů a rolí v tabulce rolí.
   Když se pravidlo přidá, přejmenuje nebo se změní práh, zkouška selže, dokud se nepřepíše i dokument. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const TA = require('../src/tacticanalysis.js');
const OA = require('../src/oppanalysis.js');
const SC = require('../src/squadcheck.js');
const TE = require('../src/tacteff.js');
const CS = require('../src/fm27cs.js');

const doc = readFileSync(new URL('../../docs/ANALYZA_SESTAVY_A_PRIPRAVY.md', import.meta.url), 'utf8');
const squadSource = readFileSync(new URL('../src/squadcheck.js', import.meta.url), 'utf8');

/** řádky tabulek: buňky bez okrajových svislítek, escapované svislítko \| se vrací jako | */
const rows = doc
  .split('\n')
  .filter((l) => l.startsWith('|'))
  .map((l) => l.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').split(/(?<!\\)\s\|\s/).map((c) => c.replace(/\\\|/g, '|').trim()));
const byId = (id) => rows.filter((r) => r[0] === id);

test('každé z 42 pravidel taktiky je v dokumentu přesně jednou se stejným názvem, oblastí, zdrojem úsudku, závažností a shodou zdrojů', () => {
  assert.equal(TA.RULES.length, 42);
  assert.match(doc, /### 6\.1 Rozbor taktiky: 42 pravidel/);
  for (const r of TA.RULES) {
    const found = byId(r.id);
    assert.equal(found.length, 1, `${r.id}: v dokumentu je ${found.length} řádků`);
    assert.deepEqual(found[0].slice(0, 6), [r.id, r.area, r.title, r.basis, TA.SEV_CS[r.sev], r.agree || ''], `${r.id}: řádek se liší od kódu`);
  }
});

test('každé z 17 pravidel soupeře je v dokumentu přesně jednou se stejným názvem, oblastí a zdrojem úsudku', () => {
  assert.equal(OA.RULES.length, 17);
  assert.match(doc, /## 7\. Příprava na zápas: 17 pravidel soupeře/);
  for (const r of OA.RULES) {
    const found = byId(r.id);
    assert.equal(found.length, 1, `${r.id}: v dokumentu je ${found.length} řádků`);
    assert.deepEqual(found[0].slice(0, 4), [r.id, r.area, r.title, r.basis], `${r.id}: řádek se liší od kódu`);
  }
});

test('rozbor sestavy: každý nález z kódu je v tabulce dokumentu a v dokumentu není nález, který kód nezná', () => {
  const ids = new Set([...squadSource.matchAll(/\bF\('([A-Z]\d)'/g)].map((m) => m[1]).concat([...squadSource.matchAll(/\bid: '([A-Z]\d)'/g)].map((m) => m[1])));
  assert.ok(ids.size >= 13, `v kódu je ${ids.size} nálezů`);
  for (const id of ids) assert.equal(byId(id).length, 1, `${id}: chybí v dokumentu`);
  const docIds = rows.map((r) => r[0]).filter((x) => /^[A-Z]\d$/.test(x));
  for (const id of docIds) assert.ok(ids.has(id), `${id}: v dokumentu je nález, který kód nemá`);
});

test('prahy v dokumentu jsou prahy z kódu (rozbor sestavy i soupeře)', () => {
  const o = OA.DEFAULTS;
  const must = [
    `atribut ≤ ${o.low} je nízký, ≥ ${o.high} vysoký`,
    `Heading a Jumping Reach stoperů ≤ ${o.aerialLow} = slabý vzduch`,
    `Pace i Acceleration ≥ ${o.fast} = rychlý hráč`,
    `Pace a Acceleration obránců ≤ ${o.slowDefence} = pomalá obrana`,
    `Passing, Vision a Technique ≥ ${o.playmaker} = tvůrce hry`,
    `≤ ${o.weakPasser} u obránce nebo brankáře = slabý rozehrávač`,
    `aspoň ${o.minKnown} hráčů sestavy`,
    `aspoň ${o.physicalCount} fyzické slabiny`,
    `rozdíl ${o.centreDiff} hráčů ve středu zálohy`,
  ];
  for (const m of must) assert.ok(doc.replace(/\s+/g, ' ').includes(m.replace(/\s+/g, ' ')), `v dokumentu chybí: ${m}`);
  assert.equal(o.maxChanges, 3);
  assert.equal(o.maxOi, 3);
  assert.ok(doc.replace(/\s+/g, ' ').includes('nejvýš tří změn nastavení'));
  assert.ok(doc.replace(/\s+/g, ' ').includes('nejvýš tří pokynů k soupeři'));
  const s = SC.DEFAULTS;
  const flat = doc.replace(/\s+/g, ' ');
  for (const m of [`\`perSlot\` ${s.perSlot} hráči na místo`, `\`cliffGap\` ${s.cliffGap} bodů`, `\`weakValue\` ${s.weakValue}`, `\`swapGain\` ${s.swapGain} body`, `\`veteranAge\` ${s.veteranAge}`, `\`successorMaxAge\` ${s.successorMaxAge}`, `\`minCoverage\` ${String(s.minCoverage).replace('.', ',')}`, `\`topAttrs\` ${s.topAttrs}`]) {
    assert.ok(flat.includes(m), `v dokumentu chybí: ${m}`);
  }
});

test('počty ze slovníku hry v dokumentu sedí na slovník', () => {
  const ins = Object.values(CS.INSTR);
  const inCount = ins.filter((x) => x.phase === 'in').length;
  const outCount = ins.filter((x) => x.phase === 'out').length;
  const flat = doc.replace(/\s+/g, ' ');
  const must = [
    `${CS.ATTR_PAIRS.length} českých názvů atributů`,
    `${CS.OPPOSITION_SLOT_CODES.length} míst pro pokyny k soupeři`,
    `${ins.length} týmových instrukcí** (${inCount} s míčem + ${outCount} bez míče)`,
    `${CS.STYLE_PAIRS.length} stylů`,
    `${CS.MENTALITY_PAIRS.length} mentalit`,
    `${CS.TWEAKS.length} Active Tactical Tweaks`,
    `${CS.TRAINING.tacticalUnderstanding.length} sezení Tactical Understanding`,
    `${CS.TRAINING.matchPreparation.length} sezení Zápasové přípravy`,
  ];
  for (const m of must) assert.ok(flat.includes(m), `v dokumentu chybí: ${m}`);
  for (const s of CS.TRAINING.matchPreparation) assert.ok(doc.includes(s), `sezení Zápasové přípravy chybí v dokumentu: ${s}`);
});

test('Tactical Effectiveness: čtyři pilíře, jejich názvy a 17 klíčových faktorů jsou v dokumentu stejné jako v kódu', () => {
  const r = TE.analyze({});
  assert.equal(r.pillars.length, 4);
  const total = r.pillars.reduce((a, p) => a + p.factors.length, 0);
  assert.equal(total, 17);
  assert.ok(doc.includes('17 klíčových faktorů'));
  assert.ok(doc.includes('u každého ze 17 faktorů'));
  for (const p of r.pillars) {
    assert.ok(doc.includes(p.name), `pilíř ${p.name} chybí v dokumentu`);
    for (const f of p.factors) assert.ok(doc.includes(f), `faktor ${f} chybí v dokumentu`);
  }
});

test('tabulka rolí: názvy rolí i atributů jsou názvy ze slovníku hry; fáze, kanonický název a sloupce sedí', () => {
  const table = rows.filter((r) => (r[0] === 's míčem' || r[0] === 'bez míče') && r.length === 5);
  assert.equal(table.length, 6, 'šest ověřených rolí');
  assert.equal(table.filter((r) => r[0] === 's míčem').length, 3);
  assert.equal(table.filter((r) => r[0] === 'bez míče').length, 3);
  const canonical = new Set(CS.ATTR_PAIRS.map((p) => p[1]));
  for (const [phase, cs, canon, key, pref] of table) {
    assert.equal(CS.canonRole(cs), canon, `${cs}: kanonický název`);
    const names = (s) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const k = names(key);
    const p = names(pref);
    assert.ok(k.length >= 3 && p.length >= 3, `${cs}: málo atributů`);
    for (const a of [...k, ...p]) assert.ok(canonical.has(a), `${cs} (${phase}): „${a}“ není kanonický název atributu`);
    assert.equal(new Set([...k, ...p]).size, k.length + p.length, `${cs}: atribut je zároveň klíčový a žádoucí, nebo je dvakrát`);
  }
});

test('dokument říká, že nic nepředpovídá a nepoužívá skrytá data; v textu nezůstaly zbytky šablony ani neprovedené zápisy znaků', () => {
  assert.match(doc, /Nepředpovídá výsledek/);
  assert.match(doc, /Nepoužívá skryté údaje hry\*\* \(CA, PA, osobnost, reputace\)/);
  assert.doesNotMatch(doc, /\\u[0-9a-fA-F]{4}/, 'v dokumentu zůstal neprovedený zápis znaku \\uXXXX');
  assert.doesNotMatch(doc, /\{\{[A-Z_]+\}\}/, 'v dokumentu zůstalo nenahrazené místo pro tabulku');
});
