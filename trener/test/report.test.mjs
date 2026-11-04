import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../src/report.js');

const ctx = () => ({
  observations: {
    'snap-1': { label: 'vision_unverified', text: 'minuta 30, střely 5:1' },
    'snap-2': { label: 'user_entered', text: 'minuta 60, střely 9:4' },
    'chg-1': { label: 'heuristic_coach', text: 'po změně v 35. minutě: střely na 10 min 2,0 → 3,5' },
  },
  passages: new Set(['bk:x:1:1']),
  changeStatus: { 'chg-1': 'ready', 'chg-2': 'insufficient_data' },
  knownPlayers: ['Jan Novák', 'Petr Svoboda'],
  dataLimited: true,
});
const good = () => ({
  worked: [{ text: 'V první půlhodině jsme měli víc střel.', tier: 'inferred', refs: ['snap-1'] }],
  didntWork: [],
  changesHelped: [{ changeId: 'chg-1', text: 'Po změně v 35. minutě se naše střely na 10 minut zvýšily, nemusí to souviset.', tier: 'inferred', refs: ['chg-1'] }],
  changesHurt: [],
  players: [{ name: 'Novák', text: 'Podle zadaných údajů dostával víc míčů.', tier: 'user_entered', refs: ['snap-2'] }],
  opponentEdge: [],
  repeatedMistakes: [],
  nextMatch: { text: 'Příště hrát podobně.', items: [{ what: 'Nechat záložníka blíž k útočníkovi', why: 'Pomohlo to podle zadaných statistik', tier: 'inferred', refs: ['chg-1'] }] },
  limits: { text: 'Údaje jsou jen z několika snímků.', items: ['Jen dva snímky, jeden přečtený z obrázku'] },
});
const errorsOf = (r, c) => R.validateReport(r, c || ctx()).errors.join(' | ');

test('platná zpráva projde a jde vypsat jako text', () => {
  const v = R.validateReport(good(), ctx());
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
  const t = R.reportToText(good());
  assert.match(t, /Co fungovalo:/);
  assert.match(t, /Příští utkání: Příště hrát podobně/);
  assert.match(t, /Omezení zprávy:/);
});

test('chybějící sekce a neobjekt', () => {
  const r = good();
  delete r.limits;
  assert.match(errorsOf(r), /Chybí sekce: limits/);
  assert.match(errorsOf(7), /není JSON objekt/);
  const r2 = good();
  r2.worked = 'nic';
  assert.match(errorsOf(r2), /worked: musí být seznam/);
});

test('časová souvislost není důkaz příčiny: příčinná slovesa a chybějící opatrnost', () => {
  let r = good();
  r.changesHelped[0].text = 'Změna způsobila nárůst střel.';
  assert.match(errorsOf(r), /časová souvislost není důkaz příčiny/);
  r = good();
  r.worked[0].text = 'Díky této změně jsme hráli lépe.';
  assert.match(errorsOf(r), /worked\[1\]: časová souvislost/);
  r = good();
  r.changesHelped[0].text = 'Naše střely na 10 minut vzrostly z 2,0 na 3,5.';
  assert.match(errorsOf(r), /formuluj opatrně/);
  r = good();
  r.changesHelped[0].text = 'Za to může nová role záložníka.';
  assert.match(errorsOf(r), /časová souvislost/);
});

test('změna musí existovat a mít dost dat; důkaz musí být pozorování', () => {
  let r = good();
  r.changesHelped[0].changeId = 'chg-9';
  assert.match(errorsOf(r), /neodpovídá žádné změně/);
  r = good();
  r.changesHelped[0].changeId = 'chg-2';
  r.changesHelped[0].refs = ['snap-1'];
  assert.match(errorsOf(r), /nemá dost dat pro srovnání/);
  r = good();
  r.changesHelped[0].refs = ['bk:x:1:1'];
  assert.match(errorsOf(r), /alespoň jedno pozorování/);
});

test('hráči jen ze soupisky, tvrzení o zápase nikdy „ověřeno“', () => {
  let r = good();
  r.players[0].name = 'Dvořák';
  assert.match(errorsOf(r), /hráč „Dvořák“ není v soupisce/);
  r = good();
  r.worked[0].tier = 'verified';
  r.worked[0].refs = ['snap-1'];
  assert.match(errorsOf(r), /nelze tvrdit „ověřeno oficiálním zdrojem“|silnější/);
});

test('tier a odkazy (společná kontrola z jádra)', () => {
  let r = good();
  r.worked[0].tier = 'observed'; // snap-1 je jen čtení z obrázku
  assert.match(errorsOf(r), /silnější než nejslabší/);
  r = good();
  r.worked[0].refs = ['snap-neexistuje'];
  assert.match(errorsOf(r), /neodpovídá žádnému/);
  r = good();
  r.didntWork = [{ text: 'Soupeř má silné CA a PA, proto vyhrál.', tier: 'inferred', refs: ['snap-2'] }];
  assert.match(errorsOf(r), /interní mechanice/);
});

test('příští utkání: konkrétní věci, nejvýš tři; omezení povinné, když jsou data slabá', () => {
  let r = good();
  r.nextMatch.items = [];
  assert.match(errorsOf(r), /aspoň jednu konkrétní věc/);
  r = good();
  r.nextMatch.items = Array.from({ length: 4 }, (_, i) => ({ what: `Konkrétní změna číslo ${i}`, why: 'Protože to vyšlo ze statistik', tier: 'inferred', refs: ['snap-2'] }));
  assert.match(errorsOf(r), /nejvýš tři věci/);
  r = good();
  r.nextMatch.items = [{ what: 'Změna', why: 'x', tier: 'inferred', refs: [] }];
  assert.match(errorsOf(r), /vyplň konkrétně co a proč/);
  r = good();
  r.limits.items = [];
  assert.match(errorsOf(r), /dat bylo málo/);
  const c = ctx();
  c.dataLimited = false;
  assert.equal(errorsOf(r, c), '');
});

test('nejvýš pět položek v sekci', () => {
  const r = good();
  r.worked = Array.from({ length: 6 }, (_, i) => ({ text: `Něco fungovalo číslo ${i}`, tier: 'inferred', refs: ['snap-1'] }));
  assert.match(errorsOf(r), /worked: nejvýš 5 položek/);
});

test('prompt obsahuje pravidla, tvar a pozorování', () => {
  const t = R.buildReportTurns({ observations: [{ id: 'chg-1', label: 'heuristic_coach', minute: 35, text: 'Vyhodnocení' }], passages: [], sourcesDigest: '(registr)' });
  assert.match(t[0].content, /ČASOVÁ SOUVISLOST NENÍ DŮKAZ PŘÍČINY/);
  assert.match(t[0].content, /chg-1 \| heuristic_coach \| 35'/);
  assert.match(t[0].content, /"changesHelped"/);
});

test('změna musí odkazovat na své vyhodnocení a nemůže být „zadal uživatel“ přes cizí pozorování', () => {
  const r = good();
  r.changesHelped[0] = { changeId: 'chg-1', text: 'Po změně se střely zvýšily, nemusí to souviset.', tier: 'user_entered', refs: ['snap-2'] };
  const e = errorsOf(r);
  assert.match(e, /musí odkazovat na její vyhodnocení před a po/);
  const ok = good();
  ok.changesHelped[0].refs = ['chg-1', 'snap-1'];
  assert.equal(errorsOf(ok), '');
});

test('příčinné formulace, které prošly dřív: „díky ní“, „zapříčinila“, „v důsledku změny“, „přinesl“, „pomohla“', () => {
  const phrases = [
    'Po změně jsme díky ní dominovali, nemusí to souviset.',
    'Změna zapříčinila obrat, po změně.',
    'V důsledku změny jsme po změně vyrovnali.',
    'Po změně: přechod na 4-4-2 přinesl gól, nemusí to souviset.',
    'Změna pomohla, po změně víc střel.',
  ];
  for (const text of phrases) {
    const r = good();
    r.changesHelped[0].text = text;
    assert.match(errorsOf(r), /časová souvislost není důkaz příčiny/, text);
  }
  // opatrná věta bez přisouzení příčiny dál projde
  const fine = good();
  fine.changesHelped[0].text = 'Po změně se naše střely na 10 minut zvýšily z 2,0 na 3,5; nemusí to souviset.';
  assert.equal(errorsOf(fine), '');
});

test('příčina se hlídá i v doporučení pro příští utkání', () => {
  const r = good();
  r.nextMatch.items[0].why = 'Protože změna zapříčinila obrat zápasu.';
  assert.match(errorsOf(r), /nextMatch\[1\]: časová souvislost není důkaz příčiny/);
});

test('hráč musí být ve soupisce celým slovem: cizí křestní jméno, část slova ani obecný text neprojdou', () => {
  for (const name of ['Pavel Novák', 'Nov', 'a', 'hrotový útočník']) {
    const r = good();
    r.players[0].name = name;
    assert.match(errorsOf(r), /není v soupisce/, name);
  }
  for (const name of ['Novák', 'Jan Novák', 'Svoboda']) {
    const r = good();
    r.players[0].name = name;
    assert.equal(errorsOf(r), '', name);
  }
});
