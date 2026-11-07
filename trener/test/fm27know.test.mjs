import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const K = require('../src/fm27know.js');
const source = readFileSync(new URL('../src/fm27know.js', import.meta.url), 'utf8');

test('slovník FM27: počty odpovídají průzkumu (7 mentalit, 11 stylů, 29 instrukcí = 20 + 9 vč. jedné jen z české hry, 40 rolí s míčem, 39 bez míče)', () => {
  assert.equal(K.MENTALITIES.length, 7);
  assert.equal(K.STYLES.length, 11);
  assert.equal(K.TEAM_INSTRUCTIONS.length, 29);
  assert.equal(K.TEAM_INSTRUCTIONS.filter((t) => t.phase === 'in').length, 20);
  assert.equal(K.TEAM_INSTRUCTIONS.filter((t) => t.phase === 'out').length, 9);
  const distinct = (table) => new Set(Object.values(table).flat()).size;
  assert.equal(distinct(K.ROLES_IN), 40);
  assert.equal(distinct(K.ROLES_OUT), 39);
});

test('slovník: každá instrukce má jedinečné id a název, výchozí hodnotu uvnitř hodnot a hodnoty bez duplicit', () => {
  const ids = new Set();
  const names = new Set();
  for (const t of K.TEAM_INSTRUCTIONS) {
    assert.ok(!ids.has(t.id) && !names.has(t.name), `duplicita ${t.id}`);
    ids.add(t.id);
    names.add(t.name);
    assert.ok(t.values.includes(t.default), `${t.id}: výchozí hodnota není mezi hodnotami`);
    assert.equal(new Set(t.values).size, t.values.length, `${t.id}: duplicitní hodnota`);
    assert.ok(['in', 'out'].includes(t.phase));
    assert.ok(K.TEAM_BY_ID.get(t.id) === t);
  }
});

test('styly nesou doporučenou mentalitu, která je ve slovníku mentalit (jedenáctý styl ze hry, Clean Sheet, ji nemá: hra ji neukázala)', () => {
  for (const s of K.STYLES) {
    if (s.name === 'Clean Sheet') assert.equal(s.mentality, null);
    else assert.ok(K.MENTALITIES.includes(s.mentality), s.name);
  }
});

test('všechny role ve vlastnostech jsou skutečné role slovníku (překlep by tiše vypnul pravidlo)', () => {
  const all = new Set([...Object.values(K.ROLES_IN).flat(), ...Object.values(K.ROLES_OUT).flat()].map(K.norm));
  for (const [trait, list] of Object.entries(K.TRAITS)) {
    for (const role of list) assert.ok(all.has(K.norm(role)), `${trait}: neznámá role ${role}`);
  }
});

test('vlastnosti rolí: s míčem jsou jen role s míčem a bez míče jen role bez míče', () => {
  const inSet = new Set(Object.values(K.ROLES_IN).flat().map(K.norm));
  const outSet = new Set(Object.values(K.ROLES_OUT).flat().map(K.norm));
  const outTraits = ['outlet', 'screening', 'pressing', 'holding', 'stopper', 'coverer'];
  for (const [trait, list] of Object.entries(K.TRAITS)) {
    for (const role of list) {
      if (outTraits.includes(trait)) assert.ok(outSet.has(K.norm(role)), `${trait}: ${role} není role bez míče`);
      else assert.ok(inSet.has(K.norm(role)), `${trait}: ${role} není role s míčem`);
    }
  }
});

test('norm: bez rozdílu velikosti písmen, mezer, pomlček a diakritiky', () => {
  assert.equal(K.norm('Box-To-Box Midfielder'), K.norm('box to box  midfielder'));
  assert.equal(K.norm('Pŕesah'), 'presah');
  assert.equal(K.norm(null), '');
  assert.equal(K.norm(undefined), '');
});

test('groupOfPos a sideOfPos: všechny kódy pozic ze šablon formací jsou zařazené, neznámý kód se nehádá', () => {
  const T = require('../src/tactics.js');
  for (const f of T.FORMATIONS) {
    for (const s of f.slots) {
      assert.ok(K.groupOfPos(s.pos), `${f.id} ${s.pos}: pozice bez skupiny rolí`);
      assert.ok(['L', 'R', 'C'].includes(K.sideOfPos(s.pos)));
      // skupina musí mít role s míčem i bez míče
      assert.ok(K.ROLES_IN[K.groupOfPos(s.pos)].length && K.ROLES_OUT[K.groupOfPos(s.pos)].length);
    }
  }
  assert.equal(K.groupOfPos('RCB'), 'D (C)');
  assert.equal(K.groupOfPos('LW'), 'AM (L/R)');
  assert.equal(K.groupOfPos('XYZ'), null);
  assert.equal(K.sideOfPos('XYZ'), null);
  assert.equal(K.sideOfPos('LB'), 'L');
  assert.equal(K.sideOfPos('ST'), 'C');
});

test('findRole: rozliší fázi, toleruje zápis a nehádá', () => {
  assert.equal(K.findRole('ball playing centre back', 'in').name, 'Ball-Playing Centre-Back');
  assert.equal(K.findRole('Sweeper Keeper', 'out').name, 'Sweeper Keeper');
  assert.equal(K.findRole('Sweeper Keeper', 'in'), null);
  assert.equal(K.findRole('Ball Playing Defender', 'in'), null, 'role z FM24 se nepřekládá na odhad');
  assert.equal(K.findRole('', 'in'), null);
  assert.deepEqual(K.findRole('Wing-Back', 'in').groups.sort(), ['D (L/R)', 'WB (L/R)']);
});

test('parseInstruction: čte běžné tvary zápisu a vybere delší hodnotu a delší název', () => {
  const cases = [
    ['Defensive Line: Higher', 'defensiveLine', 'Higher'],
    ['Higher Defensive Line', 'defensiveLine', 'Higher'],
    ['Defensive Line – Much Higher', 'defensiveLine', 'Much Higher'],
    ['Defensive Line Behaviour: Step Up More', 'defensiveLineBehaviour', 'Step Up More'],
    ['Tempo: Much Higher', 'tempo', 'Much Higher'],
    ['Trigger Press: Much More Often', 'triggerPress', 'Much More Often'],
    ['S míčem: Attacking Width Wider', 'attackingWidth', 'Wider'],
    ['GK Distribution (Speed): Distribute Quickly', 'gkDistributionSpeed', 'Distribute Quickly'],
    ['GK Distribution: Centre-Backs', 'gkDistribution', 'Centre-Backs'],
    ['Progress Through: Middle', 'progressThrough', 'Middle'],
    ['Short Goalkeeper Distribution: Yes', 'shortGkDistribution', 'Yes'],
    ['Play for Set Pieces', 'playForSetPieces', 'Play For Set Pieces'],
    ['Out of Possession: Counter-Press', 'defensiveTransition', 'Counter-Press'],
    ['Get Stuck In', 'tackling', 'Get Stuck In'],
  ];
  for (const [text, id, value] of cases) {
    const p = K.parseInstruction(text);
    assert.ok(p, text);
    assert.equal(p.id, id, text);
    assert.equal(p.value, value, text);
  }
});

test('parseInstruction: obecná hodnota bez názvu instrukce se nepozná (nehádá se, kam patří)', () => {
  for (const text of ['Higher', 'Standard', 'Balanced', 'Short', 'Encourage', 'Left', 'Yes', '', null, undefined, 'něco úplně jiného']) {
    assert.equal(K.parseInstruction(text), null, String(text));
  }
});

test('parseInstruction: každá dvojice (název, hodnota) ze slovníku se pozná ve tvaru „Název: Hodnota“', () => {
  for (const t of K.TEAM_INSTRUCTIONS) {
    for (const v of t.values) {
      const p = K.parseInstruction(`${t.name}: ${v}`);
      assert.ok(p, `${t.name}: ${v}`);
      assert.equal(p.id, t.id, `${t.name}: ${v}`);
      assert.equal(p.value, v, `${t.name}: ${v}`);
    }
  }
});

test('parseMentality: delší název vyhraje (Very Attacking před Attacking) a nic se nehádá', () => {
  assert.equal(K.parseMentality('Very Attacking'), 'Very Attacking');
  assert.equal(K.parseMentality('Mentality: Attacking'), 'Attacking');
  assert.equal(K.parseMentality('Cautious'), 'Cautious');
  assert.equal(K.parseMentality('Standard'), null);
  assert.equal(K.parseMentality(''), null);
});

test('stepOf: pořadí hodnot od nejpasivnější po nejaktivnější; neznámé → null', () => {
  assert.equal(K.stepOf('defensiveLine', 'Much Lower'), 0);
  assert.equal(K.stepOf('defensiveLine', 'Much Higher'), 4);
  assert.equal(K.stepOf('defensiveLine', 'Hmm'), null);
  assert.equal(K.stepOf('neexistuje', 'Higher'), null);
});

test('modul je čisté UMD: v prohlížeči se přihlásí do globálního objektu a nepotřebuje nic dalšího', () => {
  const sandbox = { self: {} };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.self.TrenerFm27Know.parseInstruction, 'function');
});

test('zdroj neobsahuje neviditelné ani řídicí znaky kromě odřádkování', () => {
  const bad = source.match(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu) || [];
  assert.deepEqual(bad.filter((ch) => ch !== '\n'), []);
});
