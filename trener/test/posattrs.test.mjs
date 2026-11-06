import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const PA = require('../src/posattrs.js');
const D = require('../src/dwrs.js');
const source = readFileSync(new URL('../src/posattrs.js', import.meta.url), 'utf8');

const attrsOf = (group) => (group === 'GK' ? D.GK_ATTRIBUTES : D.OUTFIELD_ATTRIBUTES);
const mapOf = (obj) => new Map(Object.entries(obj).map(([k, v]) => [PA.attrKey(k), v]));
const all = (group, v) => Object.fromEntries(attrsOf(group).map((a) => [a, v]));
const keyOf = (g) => PA.GROUP_DATA[g].key.map((e) => PA.attrKey(e.attribute));

test('všech osm skupin pozic má klíčové i žádoucí atributy, bez duplicit a bez překryvu', () => {
  assert.deepEqual([...PA.GROUPS].sort(), ['AM', 'CB', 'CM', 'DM', 'FB', 'GK', 'ST', 'W']);
  assert.deepEqual([...PA.GROUPS].sort(), [...D.GROUPS].sort(), 'stejné skupiny jako DWRS, aby šlo místo zařadit');
  for (const g of PA.GROUPS) {
    const d = PA.GROUP_DATA[g];
    assert.ok(d.key.length >= 4 && d.pref.length >= 5, g);
    const keys = d.key.map((e) => PA.attrKey(e.attribute));
    const prefs = d.pref.map((e) => PA.attrKey(e.attribute));
    assert.equal(new Set(keys).size, keys.length, `${g}: duplicitní klíčový atribut`);
    assert.equal(new Set(prefs).size, prefs.length, `${g}: duplicitní žádoucí atribut`);
    assert.ok(!keys.some((k) => prefs.includes(k)), `${g}: atribut je klíčový i žádoucí`);
    assert.ok(d.note.length > 30 && d.cs);
  }
});

test('každý atribut je skutečný viditelný atribut hry pro danou skupinu (překlep by tiše vynuloval váhu)', () => {
  for (const g of PA.GROUPS) {
    const valid = new Set(attrsOf(g).map((a) => PA.attrKey(a)));
    for (const e of PA.GROUP_DATA[g].key.concat(PA.GROUP_DATA[g].pref)) assert.ok(valid.has(PA.attrKey(e.attribute)), `${g}: neznámý atribut ${e.attribute}`);
  }
  for (const a of PA.UNIVERSAL_FLOOR.attributes) assert.ok(new Set(D.OUTFIELD_ATTRIBUTES.map((x) => PA.attrKey(x))).has(PA.attrKey(a)), a);
});

test('skryté údaje (CA, PA, potenciál, osobnost) mezi atributy nejsou', () => {
  const bad = /^(ca|pa|currentability|potentialability|potential|reputation|personality|ambition|loyalty|professionalism|consistency|importantmatches)$/;
  for (const g of PA.GROUPS) for (const e of PA.GROUP_DATA[g].key.concat(PA.GROUP_DATA[g].pref)) assert.ok(!bad.test(PA.attrKey(e.attribute)), e.attribute);
});

test('zdroje: každý atribut cituje známé zdroje a zdroje mají název a adresu (kromě odhadu autora)', () => {
  for (const [id, s] of Object.entries(PA.SOURCES)) {
    assert.ok(s.name.length > 10, id);
    if (id !== 'DW') assert.match(s.url, /^https:\/\//, id);
    else assert.equal(s.url, null);
  }
  for (const g of PA.GROUPS) {
    for (const e of PA.GROUP_DATA[g].key.concat(PA.GROUP_DATA[g].pref)) {
      for (const tok of e.src.split('+')) assert.ok(PA.SOURCES[tok], `${g} ${e.attribute}: neznámý zdroj ${tok}`);
    }
  }
  // klíčové atributy se nesmějí opírat jen o odhad autora: u každého je aspoň jeden skutečný zdroj
  for (const g of PA.GROUPS) for (const e of PA.GROUP_DATA[g].key) assert.ok(e.src.split('+').some((t) => t !== 'DW'), `${g} ${e.attribute}`);
});

test('co zdroje tvrdí: obránce má klíčové obranné atributy, útočník zakončení a pohyb, brankář vzdušnou jistotu a obratnost', () => {
  const has = (g, names) => names.every((n) => keyOf(g).includes(PA.attrKey(n)));
  assert.ok(has('CB', ['Heading', 'Marking', 'Tackling', 'Positioning', 'Strength']));
  assert.ok(has('GK', ['Aerial Reach', 'Agility', 'Handling', 'One On Ones', 'Reflexes']));
  assert.ok(has('ST', ['Finishing', 'Off The Ball', 'Composure', 'Acceleration']));
  assert.ok(has('DM', ['Tackling', 'Positioning']));
  assert.ok(has('W', ['Acceleration', 'Dribbling', 'Agility']));
  assert.ok(has('AM', ['Vision', 'Passing', 'First Touch', 'Dribbling']));
  assert.ok(has('FB', ['Acceleration', 'Stamina', 'Crossing']));
  assert.ok(has('CM', ['Passing', 'Stamina']));
});

test('majitelův příklad: obránce může mít nízký útok. Zakončení stopera na skóre nemá vliv, obranu útočníka také ne', () => {
  const base = all('CB', 12);
  const lowAttack = mapOf({ ...base, Finishing: 1, Dribbling: 1, Crossing: 1, 'Off The Ball': 1 });
  const highAttack = mapOf({ ...base, Finishing: 20, Dribbling: 20, Crossing: 20, 'Off The Ball': 20 });
  assert.equal(PA.score(lowAttack, 'CB').score, PA.score(highAttack, 'CB').score);
  const st = all('ST', 12);
  const lowDef = mapOf({ ...st, Marking: 1, Tackling: 1, Positioning: 1, Concentration: 1 });
  const highDef = mapOf({ ...st, Marking: 20, Tackling: 20, Positioning: 20, Concentration: 20 });
  assert.equal(PA.score(lowDef, 'ST').score, PA.score(highDef, 'ST').score);
  // a naopak: slabá obrana stopera skóre sráží, silná zvedá
  const weakD = mapOf({ ...base, Marking: 4, Tackling: 4, Heading: 4 });
  const strongD = mapOf({ ...base, Marking: 18, Tackling: 18, Heading: 18 });
  assert.ok(PA.score(strongD, 'CB').score > PA.score(mapOf(base), 'CB').score && PA.score(mapOf(base), 'CB').score > PA.score(weakD, 'CB').score);
});

test('výpočet: všechno na 20 je 100, všechno na 1 je 0 a ručně spočítaný příklad sedí na desetinu', () => {
  for (const g of PA.GROUPS) {
    assert.equal(PA.score(mapOf(all(g, 20)), g).score, 100, g);
    assert.equal(PA.score(mapOf(all(g, 1)), g).score, 0, g);
  }
  // CB: 7 klíčových × 3 = 21, 6 žádoucích × 1 = 6, součet vah 27; klíčové 15, žádoucí 10, ostatní 3 (neovlivní)
  const d = PA.GROUP_DATA.CB;
  const attrs = all('CB', 3);
  for (const e of d.key) attrs[e.attribute] = 15;
  for (const e of d.pref) attrs[e.attribute] = 10;
  const r = PA.score(mapOf(attrs), 'CB');
  const expected = Math.round(((21 * 15 + 6 * 10 - 27) / (19 * 27)) * 1000) / 10;
  assert.equal(r.score, expected);
  assert.equal(r.score, 67.8);
  assert.equal(r.worst, 27);
  assert.equal(r.best, 540);
  assert.equal(r.contributions.length, 13);
  assert.equal(r.contributions.filter((c) => c.level === 'key').length, 7);
});

test('klíčový atribut má třikrát větší váhu než žádoucí a ostatní atributy nemají váhu žádnou', () => {
  const base = all('ST', 10);
  const s0 = PA.score(mapOf(base), 'ST');
  // váha se ukáže přesně v součtu vážených hodnot (výsledek na stupnici je zaokrouhlený na desetinu)
  const keyUp = PA.score(mapOf({ ...base, Finishing: 11 }), 'ST').absolute - s0.absolute;
  const prefUp = PA.score(mapOf({ ...base, 'First Touch': 11 }), 'ST').absolute - s0.absolute;
  assert.equal(keyUp, 3);
  assert.equal(prefUp, 1);
  const otherUp = PA.score(mapOf({ ...base, Corners: 20, 'Free Kick Taking': 20, 'Long Throws': 20 }), 'ST').absolute - s0.absolute;
  assert.equal(otherUp, 0);
  const custom = PA.score(mapOf(base), 'ST', { weights: { key: 1, pref: 1 } });
  assert.ok(custom.score !== null);
});

test('chybějící atributy: částečný výsledek s pokrytím váhy, nikdy nula; valueOf respektuje práh pokrytí', () => {
  const attrs = all('ST', 14);
  delete attrs.Finishing; // klíčový, váha 3
  const r = PA.score(mapOf(attrs), 'ST');
  assert.equal(r.score, null);
  assert.deepEqual(r.missing, ['Finishing']);
  assert.ok(r.partial && r.partial.score > 0 && r.partial.used === 15 && r.partial.total === 16);
  const total = 7 * 3 + 9;
  assert.equal(r.partial.coverage, Math.round(((total - 3) / total) * 100) / 100);
  assert.equal(PA.valueOf(r, false).value, null);
  assert.equal(PA.valueOf(r, true, 0.99).value, null);
  assert.deepEqual(PA.valueOf(r, true, 0.8), { value: r.partial.score, partial: true });
  const none = PA.score(new Map(), 'ST');
  assert.equal(none.score, null);
  assert.equal(none.partial, null);
  assert.equal(PA.valueOf(none, true, 0).value, null);
  assert.equal(PA.valueOf(null, true, 0).value, null);
});

test('vstupy: neznámá skupina, špatný typ atributů a neplatné hodnoty nehodí výjimku a nic nehádají', () => {
  assert.equal(PA.score(new Map(), 'XX').score, null);
  assert.match(PA.score(new Map(), 'XX').reason, /Neznámá skupina/);
  assert.equal(PA.score(null, 'CB').score, null);
  assert.equal(PA.score({ Marking: 20 }, 'CB').partial, null, 'obyčejný objekt se za mapu atributů nebere');
  const withJunk = mapOf({ ...all('CB', 12), Marking: 'moc', Tackling: NaN });
  const r = PA.score(withJunk, 'CB');
  assert.equal(r.score, null);
  assert.deepEqual(r.missing.sort(), ['Marking', 'Tackling']);
});

test('keyNames a entriesOf: názvy klíčových atributů pro texty a váhy', () => {
  assert.deepEqual(PA.keyNames('CB', 3), ['Heading', 'Marking', 'Tackling']);
  assert.equal(PA.keyNames('CB').length, 7);
  assert.deepEqual(PA.keyNames('XX'), []);
  const e = PA.entriesOf('GK');
  assert.ok(e.every((x) => (x.level === 'key' ? x.weight === 3 : x.weight === 1)));
  assert.deepEqual(PA.entriesOf('XX'), []);
});

test('data jsou zmrazená a výpočet je čistý (vstup se nemění, stejný vstup dá stejný výstup)', () => {
  assert.ok(Object.isFrozen(PA.GROUP_DATA) && Object.isFrozen(PA.GROUP_DATA.CB) && Object.isFrozen(PA.GROUP_DATA.CB.key[0]));
  const m = mapOf(all('CB', 13));
  const before = JSON.stringify([...m]);
  const a = PA.score(m, 'CB');
  const b = PA.score(m, 'CB');
  assert.equal(JSON.stringify([...m]), before);
  assert.deepEqual(a, b);
});

test('modul je čisté UMD: v prohlížeči se přihlásí do globálního objektu, když je načtené jádro', () => {
  const ctx = { self: {} };
  for (const f of ['core.js', 'posattrs.js']) vm.runInNewContext(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), ctx);
  assert.equal(typeof ctx.self.TrenerPosAttrs.score, 'function');
});

test('zdroj neobsahuje neviditelné ani řídicí znaky kromě odřádkování', () => {
  const bad = source.match(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu) || [];
  assert.deepEqual(bad.filter((ch) => ch !== '\n'), []);
});
