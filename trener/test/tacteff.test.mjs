import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const TE = require('../src/tacteff.js');
const TA = require('../src/tacticanalysis.js');
const T = require('../src/tactics.js');
const K = require('../src/fm27know.js');
const source = readFileSync(new URL('../src/tacteff.js', import.meta.url), 'utf8');

const taWith = (n) => {
  const t = T.makeTactic({ formation: '4-3-3', name: 'X', careerId: 'c' });
  const nonDefault = ['Přímočarost přihrávek: Mnohem kratší', 'Tempo: Vyšší', 'Šířka při útočení: Užší', 'Přechod do útoku: Protiútok', 'Hrát na standardky: Hrát na standardky', 'Střely z dálky: Povzbuzovat', 'Styl centrování: Načechrané centry', 'Strategie výstavby: Obejít pressink', 'Linie napadání: Nízký blok', 'Výška obranná linie: Vyšší', 'Napadání: Častěji', 'Obranný přechod: Kontrapresink', 'Obranný zákrok: Přitvrdit hru'];
  t.teamInstructions = nonDefault.slice(0, n);
  return TA.analyze(t, {});
};

test('čtyři pilíře ze hry mají popis, klíčové faktory a rady podle faktorů; bez zadané úrovně se nic nepředstírá', () => {
  const r = TE.analyze({});
  assert.deepEqual(r.pillars.map((p) => p.name), ['Tactical Understanding', 'Player Ability', 'Player Buy-In', 'Next Match Info']);
  assert.equal(r.overall, 'unknown');
  for (const p of r.pillars) {
    assert.equal(p.level, 'unknown');
    assert.ok(p.game.length > 20 && p.csDesc.length > 20);
    assert.equal(p.advice.length, p.factors.length, `${p.id}: každý faktor má radu`);
    assert.match(p.note, /Úroveň jsi nezadal/);
  }
  assert.equal(r.pillars[0].factors.length, 10);
  assert.deepEqual(r.priority, ['understanding', 'ability', 'buyIn', 'nextMatch']);
  assert.equal(r.complexity, null, 'bez rozboru taktiky se složitost neodhaduje');
  assert.ok(r.unknown.some((x) => /Intenzita/.test(x)));
  assert.ok(r.warnings.some((w) => /Tactical Tweak Pending/.test(w)));
});

test('úrovně: nízká a střední jdou první, neznámá po nich a vysoká se nepočítá do priorit (a nemá rady)', () => {
  const r = TE.analyze({ levels: { understanding: 'low', ability: 'high', buyIn: 'mid', nextMatch: 'unknown', overall: 'mid' } });
  assert.deepEqual(r.priority, ['understanding', 'buyIn', 'nextMatch']);
  const by = (id) => r.pillars.find((p) => p.id === id);
  assert.equal(by('ability').advice.length, 0);
  assert.match(by('ability').note, /Úroveň je vysoká/);
  assert.ok(by('understanding').advice.length > 0);
  assert.equal(by('buyIn').advice.length, 0, 'střední úroveň rady nechce, jen přehled');
  assert.equal(r.overall, 'mid');
  assert.equal(r.overallCs, 'střední');
  // nesmysl na vstupu = neznámá úroveň
  const bad = TE.analyze({ levels: { understanding: 'výborná', ability: 5, buyIn: null, nextMatch: {} } });
  assert.deepEqual(bad.pillars.map((p) => p.level), ['unknown', 'unknown', 'unknown', 'unknown']);
});

test('sezení: oblast, kterou asistent jmenuje ve hře, se převede na sezení Tactical Understanding (Chance Creation = Vytvoření šancí)', () => {
  assert.equal(TE.sessionFor('Build Up'), 'Build Up');
  assert.equal(TE.sessionFor('build-up'), 'Build Up');
  assert.equal(TE.sessionFor('Chance Creation'), 'Vytvoření šancí');
  assert.equal(TE.sessionFor('Vytvoření šancí'), 'Vytvoření šancí');
  assert.equal(TE.sessionFor('Pressing Trap'), 'Pressing Trap');
  assert.equal(TE.sessionFor('Něco jiného'), null);
  assert.equal(TE.sessionFor(''), null);
  const r = TE.analyze({ levels: { understanding: 'low', nextMatch: 'low' }, assistantHint: 'Build Up', nextMatchPrepared: true });
  assert.deepEqual(r.sessions.map((s) => [s.category, s.session, s.basis]), [['Tactical Understanding', 'Build Up', 'HRA'], ['Zápasová příprava', null, 'ODHAD']]);
  assert.match(r.sessions[1].why, /Příprava na zápas/);
  const generic = TE.analyze({ levels: { understanding: 'low' } });
  assert.equal(generic.sessions[0].session, null);
  assert.match(generic.sessions[0].why, /osmi sezení/);
  // vysoké porozumění a vysoká znalost soupeře: žádná sezení
  assert.deepEqual(TE.analyze({ levels: { understanding: 'high', nextMatch: 'high' } }).sessions, []);
});

test('složitost taktiky je odhad z PŘEČTENÝCH instrukcí: při neúplném čtení je to dolní odhad (neznámá, aspoň střední, vysoká), nízká jen když je přečteno všech 27', () => {
  const low = TE.analyze({ tacticAnalysis: taWith(3) });
  assert.equal(low.complexity.nonDefault, 3);
  assert.equal(low.complexity.level, 'neznámá', 'tři instrukce ze 27 nestačí na tvrzení „nízká“');
  assert.equal(low.complexity.complete, false);
  assert.equal(low.complexity.known, 3);
  assert.equal(low.complexity.allInstructions, 27);
  assert.match(low.complexity.note, /Přečteno je 3 z 27 instrukcí/);
  assert.equal(low.complexity.basis, 'ODHAD');
  const mid = TE.analyze({ tacticAnalysis: taWith(8) });
  assert.equal(mid.complexity.level, 'aspoň střední');
  const withOpp = TE.analyze({ tacticAnalysis: taWith(8), oppositionInstructions: 5 });
  assert.equal(withOpp.complexity.total, 13);
  assert.equal(withOpp.complexity.level, 'vysoká', 'dolní odhad 13 stačí na „vysoká“');
  assert.ok(withOpp.complexity.nonDefaultList.some((l) => /^Tempo: Vyšší$/.test(l)), withOpp.complexity.nonDefaultList.join(' | '));
  assert.match(withOpp.complexity.note, /Vzorec hry neznáme/);
  assert.match(withOpp.complexity.note, /Výchozí hodnoty instrukcí aplikace ve FM27 neověřila/);
  assert.equal(TE.analyze({ tacticAnalysis: taWith(2), oppositionInstructions: -1 }).complexity.opposition, null);
  assert.match(TE.analyze({ tacticAnalysis: taWith(2) }).complexity.note, /pokynů k soupeři jsi nezadal/);
  // bez přečtených instrukcí vůbec: neznámá, ne „nízká“
  const none = TE.analyze({ tacticAnalysis: taWith(0) });
  assert.equal(none.complexity.level, 'neznámá');
  assert.equal(none.complexity.total, 0);
  // všech 27 instrukcí přečteno: úrovně podle počtu mimo výchozí
  const full = (n) => {
    const t = T.makeTactic({ formation: '4-3-3', name: 'Plná', careerId: 'c' });
    t.teamInstructions = K.TEAM_INSTRUCTIONS.filter((x) => !K.THIRD_PARTY_ONLY.includes(x.id)).map((x, i) => `${x.name}: ${i < n ? x.values.find((v) => v !== x.default) : x.default}`);
    return TE.analyze({ tacticAnalysis: TA.analyze(t, {}) }).complexity;
  };
  assert.equal(full(0).complete, true);
  assert.equal(full(0).known, 27);
  assert.equal(full(2).level, 'nízká');
  assert.equal(full(8).level, 'střední');
  assert.equal(full(12).level, 'vysoká');
  assert.doesNotMatch(full(2).note, /Přečteno je/, 'u úplného čtení není co omlouvat');
});

test('názvy pilířů a faktorů jsou přesně ty ze hry a každý faktor má radu', () => {
  const CS = require('../src/fm27cs.js');
  for (const p of CS.TE.pillars) for (const f of p.factors) assert.ok(TE.FACTOR_ADVICE[f], `chybí rada k faktoru ${f}`);
  assert.equal(Object.keys(TE.FACTOR_ADVICE).length, CS.TE.pillars.reduce((n, p) => n + p.factors.length, 0));
  assert.ok(K.TE === CS.TE);
});

test('modul je čistý, nezná skryté údaje a závisí jen na fm27cs.js', () => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(withoutComments, /Math\.random|Date\.now|new Date|\bdocument\b|\bwindow\b|localStorage|fetch\s*\(/);
  assert.doesNotMatch(withoutComments, /\b(currentAbility|potentialAbility|personality|reputation)\b/i);
  assert.doesNotMatch(withoutComments, /\brequire\((?!'\.\/fm27cs\.js'\))/);
  assert.deepEqual(JSON.parse(JSON.stringify(TE.analyze({ levels: { understanding: 'low' } }))), JSON.parse(JSON.stringify(TE.analyze({ levels: { understanding: 'low' } }))));
});

test('složitost taktiky: hranice 7 a 12 platí na instrukci přesně, při úplném i neúplném čtení (doplněno podle mutační zkoušky)', () => {
  const lvl = (n) => TE.analyze({ tacticAnalysis: taWith(n) }).complexity.level;
  assert.deepEqual([lvl(6), lvl(7), lvl(11), lvl(12)], ['neznámá', 'aspoň střední', 'aspoň střední', 'vysoká']);
  const full = (n) => {
    const t = T.makeTactic({ formation: '4-3-3', name: 'Plná', careerId: 'c' });
    t.teamInstructions = K.TEAM_INSTRUCTIONS.filter((x) => !K.THIRD_PARTY_ONLY.includes(x.id)).map((x, i) => `${x.name}: ${i < n ? x.values.find((v) => v !== x.default) : x.default}`);
    return TE.analyze({ tacticAnalysis: TA.analyze(t, {}) }).complexity.level;
  };
  assert.deepEqual([full(6), full(7), full(11), full(12)], ['nízká', 'střední', 'střední', 'vysoká']);
});
