import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const D = require('../src/dwrs.js');
const RF = require('../src/rolefit.js');
const TI = require('../src/tableimport.js');
const source = readFileSync(new URL('../src/dwrs.js', import.meta.url), 'utf8');

const attrsOf = (group) => (group === 'GK' ? D.GK_ATTRIBUTES : D.OUTFIELD_ATTRIBUTES);
const fill = (group, v) => Object.fromEntries(attrsOf(group).map((a) => [a, v]));
const player = (group, attributes, positions) => ({ id: 'p', name: 'Hráč', positions: positions || [group === 'FB' ? 'DR' : group === 'CB' ? 'DC' : group === 'W' ? 'AMR' : group === 'AM' ? 'AMC' : group === 'CM' ? 'MC' : group], attributes });
const role = (name, key, pref, group) => ({ name, key, pref, group });

// pseudonáhodná čísla se zadaným zrnem: zkouška je opakovatelná
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- konstanty a tabulky
test('konstanty: váhy kategorií hráčů z pole 8 / 4 / 2 / 1 / 0,2, násobiče role 1,5 / 1,2 / 1, brankář má vlastní stupnici', () => {
  assert.deepEqual({ ...D.DEFAULT_CATEGORY_WEIGHTS }, { extreme: 8, important: 4, good: 2, decent: 1, minor: 0.2 });
  assert.deepEqual({ ...D.DEFAULT_MULTIPLIERS }, { key: 1.5, pref: 1.2, other: 1 });
  assert.notDeepEqual({ ...D.DEFAULT_GK_CATEGORY_WEIGHTS }, { ...D.DEFAULT_CATEGORY_WEIGHTS });
  assert.deepEqual([...D.GROUPS], ['GK', 'CB', 'FB', 'DM', 'CM', 'W', 'AM', 'ST']);
});

test('každá skupina má v tabulce každý svůj atribut právě jednou a žádný navíc', () => {
  for (const g of D.GROUPS) {
    const m = D.defaultTiers(g);
    const expected = attrsOf(g).map(RF.attrKey).sort();
    assert.deepEqual([...m.keys()].sort(), expected, g);
    const listed = Object.values(D.DEFAULT_TABLES[g]).flat().map(RF.attrKey);
    assert.equal(new Set(listed).size, listed.length, `${g}: atribut je ve dvou kategoriích`);
    for (const a of listed) assert.ok(m.has(a), `${g}: ${a} není mezi atributy skupiny`);
  }
  assert.equal(D.OUTFIELD_ATTRIBUTES.length, 36);
});

test('tabulky nepoužívají žádný skrytý údaj hry (CA, PA, osobnost, reputace)', () => {
  for (const a of [...D.OUTFIELD_ATTRIBUTES, ...D.GK_ATTRIBUTES]) assert.ok(!TI.isHiddenName(a), a);
});

test('tabulky nejsou jedna pro všechny skupiny (rozdíly mezi skupinami jsou vidět)', () => {
  const tier = (g, a) => D.defaultTiers(g).get(RF.attrKey(a)).tier;
  assert.equal(tier('ST', 'Finishing'), 'extreme');
  assert.notEqual(tier('CB', 'Finishing'), 'extreme');
  assert.equal(tier('CB', 'Marking'), 'extreme');
  assert.notEqual(tier('ST', 'Marking'), 'extreme');
  assert.equal(tier('W', 'Dribbling'), 'extreme');
  assert.equal(tier('GK', 'Handling'), 'extreme');
});

// ---------------------------------------------------------------- váhy atributů (rozpis „průměr v kategorii“)
test('plán: váha atributu = váha kategorie × násobič / počet atributů v kategorii', () => {
  const p = D.plan('ST', role('Role', ['Finishing'], ['Off The Ball']), null);
  const w = (a) => p.entries.find((e) => e.attribute === a);
  assert.equal(w('Finishing').weight, (8 * 1.5) / 3); // extrémně důležitý, klíčový, kategorie má 3 atributy
  assert.equal(w('Finishing').level, 'key');
  assert.equal(w('Off The Ball').weight, (4 * 1.2) / 4); // důležitý, žádoucí, 4 atributy
  assert.equal(w('Composure').weight, (4 * 1) / 4);
  assert.equal(w('Pace').weight, 8 / 3);
  assert.equal(w('Corners').weight, 0.2 / 10); // téměř nepodstatný, 10 atributů
  assert.equal(p.totalWeight, p.entries.reduce((s, e) => s + e.weight, 0));
  assert.deepEqual(p.ignoredRoleAttributes, []);
});

test('plán: bez role mají všechny atributy násobič 1; klíčový atribut váží přesně 1,5krát víc než týž atribut bez role', () => {
  const plain = D.plan('CM', null, null);
  const withRole = D.plan('CM', role('Role', ['Passing'], []), null);
  const a = plain.entries.find((e) => e.attribute === 'Passing');
  const b = withRole.entries.find((e) => e.attribute === 'Passing');
  assert.ok(plain.entries.every((e) => e.multiplier === 1 && e.level === 'other'));
  assert.equal(b.weight, a.weight * 1.5);
});

test('plán: atribut role mimo tabulku skupiny se nepočítá a je vidět v ignoredRoleAttributes', () => {
  const p = D.plan('GK', role('Brankář', ['Handling', 'Finishing'], ['Dribbling']), null);
  assert.deepEqual(p.ignoredRoleAttributes.sort(), ['Dribbling', 'Finishing']);
  assert.equal(p.entries.find((e) => e.attribute === 'Handling').level, 'key');
});

// ---------------------------------------------------------------- normalizace a výpočet
test('normalizace: všechny atributy 1 dají 0, všechny 20 dají 100, všechny 10 dají 47,4 (u každé skupiny a role)', () => {
  const r = role('Role', ['Passing', 'Vision'], ['Technique']);
  for (const g of D.GROUPS) {
    assert.equal(D.score(player(g, fill(g, 1)), r, g, null).score, 0, g);
    assert.equal(D.score(player(g, fill(g, 20)), r, g, null).score, 100, g);
    assert.equal(D.score(player(g, fill(g, 10)), null, g, null).score, 47.4, g);
    assert.equal(D.score(player(g, fill(g, 11)), r, g, null).score, 52.6, g);
  }
});

test('normalizace platí i s každým přednastavením (kontextové násobiče se použijí pro minimum i maximum)', () => {
  for (const wp of D.presets()) {
    for (const g of D.GROUPS) {
      assert.equal(D.score(player(g, fill(g, 1)), null, g, wp).score, 0, `${wp.id} ${g}`);
      assert.equal(D.score(player(g, fill(g, 20)), null, g, wp).score, 100, `${wp.id} ${g}`);
    }
  }
});

test('výpočet odpovídá samostatně zapsanému vzorci z popisu metody (průměr v kategorii × váha kategorie, přepočet mezi všemi 1 a všemi 20)', () => {
  const rand = rng(12345);
  const wp = D.defaultProfile();
  for (let i = 0; i < 300; i++) {
    const g = D.GROUPS[Math.floor(rand() * D.GROUPS.length)];
    const attrs = attrsOf(g);
    const values = Object.fromEntries(attrs.map((a) => [a, 1 + Math.floor(rand() * 20)]));
    const pick = () => attrs.filter(() => rand() < 0.15);
    const key = pick();
    const pref = pick().filter((a) => !key.includes(a));
    const r = role('R', key, pref);
    // nezávislý výpočet po kategoriích
    const tiers = D.defaultTiers(g);
    const weights = g === 'GK' ? D.DEFAULT_GK_CATEGORY_WEIGHTS : D.DEFAULT_CATEGORY_WEIGHTS;
    let abs = 0;
    let worst = 0;
    let best = 0;
    for (const tier of D.TIERS) {
      const list = [...tiers.values()].filter((t) => t.tier === tier).map((t) => t.attribute);
      if (!list.length) continue;
      const mult = (a) => (key.includes(a) ? 1.5 : pref.includes(a) ? 1.2 : 1);
      const avg = (f) => list.reduce((s, a) => s + f(a), 0) / list.length;
      abs += weights[tier] * avg((a) => values[a] * mult(a));
      worst += weights[tier] * avg((a) => 1 * mult(a));
      best += weights[tier] * avg((a) => 20 * mult(a));
    }
    const expected = Math.round(((abs - worst) / (best - worst)) * 1000) / 10;
    const got = D.score(player(g, values), r, g, wp);
    assert.ok(Math.abs(got.score - expected) <= 0.100001, `${g} ${i}: ${got.score} proti ${expected}`);
    assert.ok(Math.abs(got.absolute - abs) < 1e-9 && Math.abs(got.worst - worst) < 1e-9 && Math.abs(got.best - best) < 1e-9, 'absolutní, nejhorší a nejlepší hodnota');
  }
});

test('zvýšení kteréhokoli atributu výsledek nikdy nesnižuje a (každý atribut tabulky má váhu) ho zvýší', () => {
  const rand = rng(777);
  for (const g of D.GROUPS) {
    const attrs = attrsOf(g);
    const base = Object.fromEntries(attrs.map((a) => [a, 5 + Math.floor(rand() * 10)]));
    const before = D.score(player(g, base), null, g, null);
    for (const a of attrs) {
      const up = { ...base, [a]: 20 };
      const after = D.score(player(g, up), null, g, null);
      const c = before.contributions.find((x) => x.attribute === a);
      assert.ok(after.absolute > before.absolute || base[a] === 20, `${g} ${a}`);
      assert.ok(after.score >= before.score - 1e-9, `${g} ${a}: pokles`);
      assert.ok(c.weight > 0);
    }
  }
});

test('rozpis: každý příspěvek má atribut, kategorii, úroveň role, váhu kategorie, násobič, váhu a hodnotu; součty sedí', () => {
  const r = D.score(player('ST', fill('ST', 12)), role('AF', ['Finishing'], ['Pace']), 'ST', null);
  assert.equal(r.contributions.length, 36);
  for (const c of r.contributions) {
    assert.ok(c.attribute && D.TIERS.includes(c.tier) && ['key', 'pref', 'other'].includes(c.level));
    assert.ok(c.categoryWeight > 0 && c.multiplier >= 1 && c.weight > 0 && c.value === 12);
  }
  const sumW = r.contributions.reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(r.worst - sumW) < 1e-9);
  assert.ok(Math.abs(r.best - 20 * sumW) < 1e-9);
  assert.ok(Math.abs(r.absolute - 12 * sumW) < 1e-9);
});

test('role se liší: hráč silný v klíčových atributech jedné role má u ní víc než u role s jinými klíčovými atributy', () => {
  const values = { ...fill('ST', 10), Finishing: 19, 'Off The Ball': 18, Heading: 6, Strength: 6, 'Jumping Reach': 6 };
  const poacher = role('Poacher', ['Finishing', 'Off The Ball'], ['Anticipation'], 'ST');
  const target = role('Target Man', ['Heading', 'Strength', 'Jumping Reach'], ['Finishing'], 'ST');
  const a = D.score(player('ST', values), poacher, 'ST', null).score;
  const b = D.score(player('ST', values), target, 'ST', null).score;
  assert.ok(a > b + 2, `${a} proti ${b}`);
});

// ---------------------------------------------------------------- chybějící a neplatné atributy
test('chybějící atribut: výsledek je nedostupný (ne nula), je vidět co chybí a částečný výsledek má pokrytí', () => {
  const half = Object.fromEntries(D.OUTFIELD_ATTRIBUTES.filter((_, i) => i % 2 === 0).map((a) => [a, 14]));
  const r = D.score(player('ST', half), null, 'ST', null);
  assert.equal(r.score, null);
  assert.ok(r.missing.length === 18 && r.reason.startsWith('Hráči chybí atributy'));
  assert.ok(r.partial && r.partial.coverage > 0 && r.partial.coverage < 1);
  assert.equal(r.partial.used + r.missing.length, r.partial.total);
  assert.equal(r.partial.score, 100 * (14 - 1) / 19 === r.partial.score ? r.partial.score : r.partial.score); // všechny dostupné hodnoty jsou stejné, takže částečné skóre je 68,4
  assert.equal(r.partial.score, 68.4);
});

test('částečný výsledek se použije jen na výslovné přání a při dostatečném pokrytí váhy', () => {
  const almost = fill('ST', 14);
  delete almost.Corners;
  delete almost['Long Throws'];
  const r = D.score(player('ST', almost), null, 'ST', null);
  assert.equal(r.score, null);
  assert.equal(D.valueOf(r, false).value, null);
  assert.equal(D.valueOf(r, true, 0.8).value, 68.4);
  assert.equal(D.valueOf(r, true, 0.8).partial, true);
  const few = { Finishing: 20 };
  const f = D.score(player('ST', few), null, 'ST', null);
  assert.equal(D.valueOf(f, true, 0.8).value, null); // malé pokrytí: ani na přání
  assert.ok(f.partial.coverage < 0.8);
});

test('žádný atribut: nedostupné bez částečného výsledku', () => {
  const r = D.score(player('ST', {}), null, 'ST', null);
  assert.equal(r.score, null);
  assert.equal(r.partial, null);
  assert.equal(r.missing.length, 36);
});

test('neplatné hodnoty (0, 21, desetinné, text, NaN, null) se berou jako chybějící, nikdy jako číslo', () => {
  const bad = { ...fill('ST', 12), Finishing: 0, Pace: 21, Acceleration: 15.5, Passing: '12', Vision: NaN, Dribbling: null };
  const r = D.score(player('ST', bad), null, 'ST', null);
  assert.equal(r.score, null);
  assert.deepEqual(r.missing.sort(), ['Acceleration', 'Dribbling', 'Finishing', 'Pace', 'Passing', 'Vision']);
});

test('skryté údaje hry se do výpočtu nikdy nedostanou a nic nezmění', () => {
  const clean = fill('ST', 12);
  const withHidden = { ...clean, 'Current Ability': 190, 'Potential Ability': 195, Consistency: 20, 'Important Matches': 20, Professionalism: 20, Reputation: 9000 };
  const a = D.score(player('ST', clean), null, 'ST', null);
  const b = D.score(player('ST', withHidden), null, 'ST', null);
  assert.equal(a.score, b.score);
  assert.equal(D.playerAttributes(player('ST', withHidden)).has(RF.attrKey('Current Ability')), false);
  assert.ok(!JSON.stringify(b.contributions).includes('Current Ability'));
});

test('neznámá skupina pozic: nedostupné s důvodem', () => {
  const r = D.score(player('ST', fill('ST', 12)), null, 'XX', null);
  assert.equal(r.score, null);
  assert.match(r.reason, /Neznámá skupina/);
});

// ---------------------------------------------------------------- brankář
test('brankář má vlastní model: útočné atributy jeho výsledek nemění a brankářské atributy se do útočníka nepočítají', () => {
  const gk = { ...fill('GK', 12), Finishing: 1, Dribbling: 1, Crossing: 1 };
  const gk2 = { ...fill('GK', 12), Finishing: 20, Dribbling: 20, Crossing: 20 };
  assert.equal(D.score(player('GK', gk), null, 'GK', null).score, D.score(player('GK', gk2), null, 'GK', null).score);
  const st1 = { ...fill('ST', 12), Handling: 1, Reflexes: 1 };
  const st2 = { ...fill('ST', 12), Handling: 20, Reflexes: 20 };
  assert.equal(D.score(player('ST', st1), null, 'ST', null).score, D.score(player('ST', st2), null, 'ST', null).score);
});

test('brankář: nejdůležitější atributy (pozice, vzdušnost, chytání) mají největší váhu a váhy kategorií jsou jiné než u hráčů z pole', () => {
  const p = D.plan('GK', null, null);
  const top = ['Positioning', 'Aerial Reach', 'Handling'].map((a) => p.entries.find((e) => e.attribute === a));
  for (const e of top) {
    assert.equal(e.tier, 'extreme');
    assert.equal(e.categoryWeight, 3);
  }
  assert.ok(Math.max(...p.entries.filter((e) => e.tier !== 'extreme').map((e) => e.weight)) < Math.min(...top.map((e) => e.weight)));
  const weak = fill('GK', 10);
  const strongTop = { ...weak, Positioning: 18, 'Aerial Reach': 18, Handling: 18 };
  const strongMinor = { ...weak, Punching: 18, Eccentricity: 18, Leadership: 18 };
  assert.ok(D.score(player('GK', strongTop), null, 'GK', null).score > D.score(player('GK', strongMinor), null, 'GK', null).score + 3);
});

// ---------------------------------------------------------------- profily vah
test('přednastavení: šest profilů, každý má popis, platné atributy a kategorie, a profil univerzální nic nemění', () => {
  const list = D.presets();
  assert.deepEqual(list.map((p) => p.id), ['universal', 'speed', 'positional', 'pressing', 'counter', 'technical']);
  assert.equal(D.describeProfile(list[0]).changed, 0);
  for (const p of list.slice(1)) {
    const d = D.describeProfile(p);
    assert.ok(d.changed === Object.keys(p.context).length && d.changed > 0 && d.note.length > 10, p.id);
    const n = D.normalizeProfile(p);
    assert.deepEqual(n.issues, [], p.id);
    assert.deepEqual(n.profile.context, p.context, p.id);
    for (const [a, f] of Object.entries(p.context)) assert.ok(D.OUTFIELD_ATTRIBUTES.includes(a) && f >= 0.1 && f <= 5 && f !== 1, `${p.id} ${a}`);
    assert.deepEqual(p.overrides, {}, 'přednastavení nemění kategorie atributů, jen kontextové násobiče');
  }
});

test('přednastavení mění výsledky očekávaným směrem: rychlostní zvýhodní rychlého křídla, poziční nahrávače a technický technika', () => {
  const fast = { ...fill('W', 10), Pace: 19, Acceleration: 19, Agility: 16 };
  const slow = { ...fill('W', 10), Passing: 17, Vision: 17, Decisions: 16, Technique: 16, 'First Touch': 16 };
  const gap = (wp) => D.score(player('W', fast), null, 'W', wp).score - D.score(player('W', slow), null, 'W', wp).score;
  const uni = gap(D.presetProfile('universal'));
  assert.ok(gap(D.presetProfile('speed')) > uni, 'rychlostní: rozdíl ve prospěch rychlého roste');
  assert.ok(gap(D.presetProfile('positional')) < uni, 'poziční: rozdíl ve prospěch rychlého klesá');
  assert.ok(gap(D.presetProfile('technical')) < uni, 'technický: rozdíl ve prospěch rychlého klesá');
});

test('popis profilu říká, co přesně změnil: atribut, skupinu, původní a novou kategorii, váhy a násobiče', () => {
  const d = D.describeProfile(D.presetProfile('speed'));
  assert.ok(d.lines.includes('Pace: kontextový násobič 1 → 1,5 (hráči z pole, ne brankář).'), d.lines.join(' | '));
  assert.ok(d.lines.every((l) => l.includes('→')));
  const o = D.describeProfile(D.normalizeProfile({ overrides: { CB: { Pace: 'extreme' } } }).profile);
  assert.deepEqual(o.lines, ['Pace (střední obránce): důležitý → extrémně důležitý.']);
  const custom = D.normalizeProfile({ name: 'X', categoryWeights: { extreme: 10 }, gkCategoryWeights: { top: 1 }, multipliers: { key: 2 } }).profile;
  const c = D.describeProfile(custom);
  assert.ok(c.lines.includes('Váha kategorie „extrémně důležitý“ (hráči z pole): 8 → 10.'));
  assert.ok(c.lines.includes('Násobič klíčového atributu role: 1,5 → 2.'));
});

test('normalizeProfile: neplatné váhy, násobiče, atributy a kategorie se vrátí na výchozí a hlásí se', () => {
  const raw = { id: 'Můj profil', name: '   ', categoryWeights: { extreme: -5, good: 'moc', minor: 0 }, multipliers: { key: 9, pref: 1.4 }, overrides: { ST: { Finishing: 'good', Neexistuje: 'good', Pace: 'nesmysl' }, KK: { Pace: 'good' } } };
  const { profile, issues } = D.normalizeProfile(raw);
  assert.equal(profile.name, 'Vlastní profil');
  assert.equal(profile.categoryWeights.extreme, 8);
  assert.equal(profile.categoryWeights.good, 2);
  assert.equal(profile.categoryWeights.minor, 0); // nula je platná váha (kategorie se přestane počítat)
  assert.equal(profile.multipliers.key, 1.5);
  assert.equal(profile.multipliers.pref, 1.4);
  assert.deepEqual(profile.overrides, { ST: { Finishing: 'good' } });
  assert.ok(issues.length >= 5);
  const ctx = D.normalizeProfile({ context: { Pace: 9, Neexistuje: 1.2, Passing: 1.3, Stamina: 1, Vision: 'víc' } });
  assert.deepEqual(ctx.profile.context, { Passing: 1.3 });
  assert.equal(ctx.issues.length, 3);
  assert.ok(issues.some((i) => /Neexistuje/.test(i)) && issues.some((i) => /nesmysl/.test(i)));
});

test('nulová váha kategorie vyřadí její atributy; všechny váhy nulové: nelze počítat, ne dělit nulou', () => {
  const wp = D.normalizeProfile({ categoryWeights: { minor: 0 } }).profile;
  const r = D.score(player('ST', fill('ST', 12)), null, 'ST', wp);
  assert.equal(r.contributions.length, 26); // 36 atributů mínus 10 téměř nepodstatných
  const zero = D.normalizeProfile({ categoryWeights: { extreme: 0, important: 0, good: 0, decent: 0, minor: 0 } }).profile;
  const z = D.score(player('ST', fill('ST', 12)), null, 'ST', zero);
  assert.equal(z.score, null);
  assert.match(z.reason, /nulové/);
});

test('přepsání kategorie jednoho atributu mění počet atributů v kategoriích a váhy se přepočtou (součet váhy kategorie zůstává)', () => {
  const wp = D.normalizeProfile({ overrides: { ST: { Passing: 'extreme' } } }).profile;
  const p = D.plan('ST', null, wp);
  const extremeSum = p.entries.filter((e) => e.tier === 'extreme').reduce((s, e) => s + e.weight, 0);
  assert.ok(Math.abs(extremeSum - 8) < 1e-9); // kategorie váží 8, rozdělených mezi 4 atributy
  assert.equal(p.entries.filter((e) => e.tier === 'extreme').length, 4);
  assert.equal(p.entries.find((e) => e.attribute === 'Passing').weight, 2);
});

test('kontextový násobič: váha atributu se vynásobí a brankáře se netýká', () => {
  const wp = D.presetProfile('speed');
  const w = D.plan('W', null, wp).entries.find((e) => e.attribute === 'Pace');
  assert.equal(w.context, 1.5);
  assert.equal(w.weight, (8 * 1.5) / 3);
  const gk = D.plan('GK', null, D.normalizeProfile({ context: { Pace: 5 } }).profile).entries.find((e) => e.attribute === 'Pace');
  assert.equal(gk.context, 1);
});

// ---------------------------------------------------------------- skupiny pozic a rozbor hráče
test('skupina pozice: FM kódy i kódy míst formací; neznámé je null', () => {
  const map = { GK: 'GK', DC: 'CB', RCB: 'CB', LCB: 'CB', SW: 'CB', RB: 'FB', LB: 'FB', DR: 'FB', DL: 'FB', RWB: 'FB', WBL: 'FB', DM: 'DM', RDM: 'DM', MC: 'CM', LCM: 'CM', ML: 'W', RM: 'W', AML: 'W', RW: 'W', AMR: 'W', AMC: 'AM', AM: 'AM', ST: 'ST', LST: 'ST' };
  for (const [code, g] of Object.entries(map)) assert.equal(D.groupOfPosition(code), g, code);
  assert.equal(D.groupOfPosition('xx'), null);
  assert.equal(D.groupOfPosition(''), null);
  assert.equal(D.groupOfPosition(null), null);
});

test('skupina role: zadaná u profilu vyhrává, jinak jen jednoznačné anglické názvy; nejednoznačné je null', () => {
  assert.equal(D.groupOfRole({ name: 'Cokoli', group: 'CM' }), 'CM');
  assert.equal(D.groupOfRole({ name: 'Advanced Forward' }), 'ST');
  assert.equal(D.groupOfRole({ name: 'Inverted Wing-Back' }), 'FB');
  assert.equal(D.groupOfRole({ name: 'Wing-Back' }), 'FB');
  assert.equal(D.groupOfRole({ name: 'Inside Forward' }), 'W');
  assert.equal(D.groupOfRole({ name: 'Sweeper Keeper' }), 'GK');
  assert.equal(D.groupOfRole({ name: 'Ball Playing Defender' }), 'CB');
  assert.equal(D.groupOfRole({ name: 'Attacking Midfielder' }), 'AM');
  assert.equal(D.groupOfRole({ name: 'Deep-Lying Playmaker' }), null);
  assert.equal(D.groupOfRole({ name: 'Ball Winning Midfielder' }), null);
  assert.equal(D.groupOfRole({ name: 'Útočník' }), null);
  assert.equal(D.groupOfRole(null), null);
});

test('rozbor hráče: pořadí rolí, nejlepší tři, nejhorší relevantní, role bez skupiny a bez atributů jdou do nedostupných s důvodem', () => {
  const pl = player('ST', { ...fill('ST', 10), Finishing: 18, 'Off The Ball': 17, Pace: 16, Heading: 5, Strength: 5, 'Jumping Reach': 5, Passing: 6, Vision: 6 }, ['ST']);
  const profiles = [
    role('Poacher', ['Finishing', 'Off The Ball'], [], 'ST'),
    role('Target Man', ['Heading', 'Strength', 'Jumping Reach'], [], 'ST'),
    role('Complete Forward', ['Finishing', 'Passing'], [], 'ST'),
    role('Deep-Lying Forward', ['Passing', 'Vision'], [], 'ST'),
    role('Pressing Forward', ['Pace', 'Strength'], [], 'ST'),
    role('Ball Playing Defender', ['Passing'], [], 'CB'),
    { name: 'Neznámá role', key: ['Passing'], pref: [] },
  ];
  const r = D.analyzePlayer(pl, profiles, null);
  assert.equal(r.roles[0].role, 'Poacher');
  assert.deepEqual(r.best.map((x) => x.role), r.roles.slice(0, 3).map((x) => x.role));
  assert.ok(r.roles.every((x, i, a) => i === 0 || a[i - 1].score >= x.score));
  assert.ok(r.worst.length > 0 && r.worst.every((x) => x.relevant && !r.best.includes(x)));
  assert.equal(r.worst[0].role, 'Target Man'); // nejnižší relevantní
  const defender = r.roles.find((x) => x.role === 'Ball Playing Defender');
  assert.equal(defender.relevant, false); // útočník, který nehraje na stoperu
  assert.ok(!r.worst.some((x) => x.role === 'Ball Playing Defender'));
  assert.equal(r.unavailable.length, 1);
  assert.match(r.unavailable[0].reason, /Skupina pozic role není známá/);
  assert.deepEqual(r.playerGroups, ['ST']);
  const none = D.analyzePlayer(player('ST', { Finishing: 10 }, ['ST']), profiles.slice(0, 2), null);
  assert.equal(none.roles.length, 0);
  assert.equal(none.unavailable.length, 2);
});

test('rozbor hráče: částečný výsledek jen na přání; bez pozic hráče jsou všechny role relevantní', () => {
  const almost = fill('ST', 14);
  delete almost.Corners;
  const pl = { id: 'p', name: 'A', positions: [], attributes: almost };
  const profiles = [role('Poacher', ['Finishing'], [], 'ST')];
  assert.equal(D.analyzePlayer(pl, profiles, null).roles.length, 0);
  const r = D.analyzePlayer(pl, profiles, null, { allowPartial: true });
  assert.equal(r.roles.length, 1);
  assert.equal(r.roles[0].partial, true);
  assert.equal(r.roles[0].relevant, true);
});

test('silné stránky a mezery: nejvíc přispívající vysoké a nejvíc ztrácející nízké atributy, bez překryvu, s mezemi 12 a 9', () => {
  const values = { ...fill('ST', 10), Finishing: 19, Pace: 17, Acceleration: 16, 'Off The Ball': 14, Heading: 4, Strength: 5, Composure: 6, 'First Touch': 9 };
  const r = D.score(player('ST', values), null, 'ST', null);
  const sg = D.strengthsGaps(r.contributions, 3);
  assert.deepEqual(sg.strengths.map((x) => x.attribute), ['Finishing', 'Pace', 'Acceleration']);
  assert.ok(sg.gaps.length <= 3 && sg.gaps.every((x) => x.value <= 9));
  assert.ok(sg.gaps.some((x) => x.attribute === 'Composure'));
  assert.equal(sg.strengths.filter((x) => sg.gaps.some((g) => g.attribute === x.attribute)).length, 0);
  assert.deepEqual(D.strengthsGaps([], 3), { strengths: [], gaps: [] });
  assert.deepEqual(D.strengthsGaps(null), { strengths: [], gaps: [] });
});

// ---------------------------------------------------------------- vlastnosti modulu
test('vstupy se nemění (zmrazené hráč, role i profil)', () => {
  const deep = (o) => {
    Object.values(o).forEach((v) => v && typeof v === 'object' && deep(v));
    return Object.freeze(o);
  };
  const pl = deep(player('ST', fill('ST', 12)));
  const r = deep(role('R', ['Finishing'], ['Pace'], 'ST'));
  const wp = deep(D.presetProfile('speed'));
  assert.doesNotThrow(() => {
    D.score(pl, r, 'ST', wp);
    D.analyzePlayer(pl, [r], wp);
    D.describeProfile(wp);
    D.normalizeProfile(wp);
    D.plan('ST', r, wp);
  });
});

test('stejný vstup dá vždy stejný výstup', () => {
  const pl = player('CM', { ...fill('CM', 11), Passing: 17 });
  const r = role('R', ['Passing'], [], 'CM');
  assert.deepEqual(D.score(pl, r, 'CM', null), D.score(pl, r, 'CM', null));
});

test('modul je čistý: žádný čas ani náhoda, žádné DOM, žádná síť', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.ok(!/Date\.now|Math\.random|new Date\(/.test(code));
  assert.ok(!/\b(?:document|window|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/.test(code));
});

test('UMD obálka: v prohlížeči vznikne globál TrenerDwrs', () => {
  const sandbox = { self: { TrenerRoleFit: RF, TrenerTableImport: TI } };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.self.TrenerDwrs.score, 'function');
  assert.equal(typeof sandbox.self.TrenerDwrs.analyzePlayer, 'function');
});


// ---------------------------------------------------------------- porovnání profilů vah
test('compareProfiles: stejné profily nemají rozdíl, přednastavení se od výchozího liší přesně svým kontextem', () => {
  const base = D.defaultProfile();
  assert.deepEqual(D.compareProfiles(base, D.defaultProfile()), { changed: 0, lines: [] });
  assert.equal(D.compareProfiles(undefined, null).changed, 0);
  const speed = D.presetProfile('speed');
  const c = D.compareProfiles(base, speed);
  assert.equal(c.changed, Object.keys(speed.context).length);
  assert.ok(c.lines.includes('Pace: kontextový násobič 1 → 1,5 (hráči z pole).'), c.lines.join(' | '));
  // opačný směr obrací šipku
  const back = D.compareProfiles(speed, base);
  assert.ok(back.lines.includes('Pace: kontextový násobič 1,5 → 1 (hráči z pole).'), back.lines.join(' | '));
});

test('compareProfiles: váhy kategorií (obě stupnice), násobiče a změna kategorie atributu se projeví v řádcích', () => {
  const a = D.defaultProfile();
  const b = D.normalizeProfile({ name: 'B', categoryWeights: { extreme: 10 }, gkCategoryWeights: { good: 2 }, multipliers: { key: 2 }, overrides: { ST: { Heading: 'extreme' } } }).profile;
  const c = D.compareProfiles(a, b);
  assert.ok(c.lines.some((l) => /Váha kategorie „extrémně důležitý“ \(hráči z pole\): 8 → 10/.test(l)));
  assert.ok(c.lines.some((l) => /Váha kategorie „dobrý“ \(brankář\): 1 → 2/.test(l)));
  assert.ok(c.lines.includes('Násobič klíčového atributu role: 1,5 → 2.'), c.lines.join(' | '));
  assert.ok(c.lines.some((l) => /Heading \(útočník\): dobrý → extrémně důležitý/.test(l)));
  assert.equal(c.changed, 4);
  // porovnání nemění vstupy
  assert.equal(JSON.stringify(a), JSON.stringify(D.defaultProfile()));
});

// ---------------------------------------------------------------- příklad z metodiky (M15): čísla v dokumentu musí být ta, která kód opravdu počítá
test('příklad z metodiky M15: Poacher a útočník s Finishing 16 a Off The Ball 14 má 56,4; samé desítky 47,4; samé dvacítky 100; samé jedničky 0', () => {
  const all = (v) => Object.fromEntries(D.OUTFIELD_ATTRIBUTES.map((a) => [a, v]));
  const poacher = { name: 'Poacher', key: ['Finishing'], pref: ['Off The Ball'] };
  const wp = D.defaultProfile();
  const p = { id: 'x', name: 'x', positions: ['ST'], attributes: { ...all(10), Finishing: 16, 'Off The Ball': 14 } };
  const plan = D.plan('ST', poacher, wp);
  const w = (name) => plan.entries.find((e) => e.attribute === name);
  assert.equal(w('Finishing').weight, 4); // 8 × 1,5 / 3 atributy v kategorii „extrémně důležitý“
  assert.equal(w('Off The Ball').weight, 1.2); // 4 × 1,2 / 4 atributy v kategorii „důležitý“
  assert.ok(Math.abs(w('Pace').weight - 8 / 3) < 1e-12);
  assert.ok(Math.abs(plan.totalWeight - 16.7333333) < 1e-6);
  const r = D.score(p, poacher, 'ST', wp);
  assert.equal(r.score, 56.4);
  assert.ok(Math.abs(r.absolute - 196.1333333) < 1e-6 && Math.abs(r.best - 334.6666667) < 1e-6);
  assert.equal(D.score({ ...p, attributes: all(10) }, poacher, 'ST', wp).score, 47.4);
  assert.equal(D.score({ ...p, attributes: all(20) }, poacher, 'ST', wp).score, 100);
  assert.equal(D.score({ ...p, attributes: all(1) }, poacher, 'ST', wp).score, 0);
});
