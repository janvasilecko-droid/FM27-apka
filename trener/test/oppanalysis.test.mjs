import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { RAW } from './fixtures/oppreport.mjs';

const require = createRequire(import.meta.url);
const OA = require('../src/oppanalysis.js');
const OR = require('../src/oppread.js');
const T = require('../src/tactics.js');
const source = readFileSync(new URL('../src/oppanalysis.js', import.meta.url), 'utf8');
// Zpráva o soupeři má strukturu české zprávy FM27 (průzkum 7. 11. 2026); jména a čísla jsou vymyšlená.
const report = () => OR.normalizeReport(JSON.parse(JSON.stringify(RAW))).report;
const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

function myTactic(extra) {
  const t = T.makeTactic({ formation: '4-2-3-1', name: 'Moje', careerId: 'c1' });
  t.mentality = 'Vyvážený';
  t.teamInstructions = [
    'Přímočarost přihrávek: Mnohem kratší', 'Tempo: Vyšší', 'Šířka při útočení: Užší', 'Přechod do útoku: Protiútok', 'Hrát na standardky: Udržet míč ve hře', 'Střely z dálky: Povzbuzovat',
    'Styl centrování: Načechrané centry', 'Strategie výstavby: Obejít pressink', 'Linie napadání: Nízký blok', 'Výška obranná linie: Vyšší', 'Napadání: Častěji', 'Obranný přechod: Kontrapresink', 'Obranný zákrok: Standardní',
  ];
  return Object.assign(t, extra || {});
}
const player = (id, name, positions, attributes, flags) => ({ id, name, positions, attributes, flags: flags || { injury: false, fatigue: false }, age: 25 });
const SQUAD = [
  player('s1', 'Stoper Rychlý', ['DC'], { Rychlost: 15, Zrychlení: 14, Hlavičky: 12, Výskok: 12 }),
  player('s2', 'Stoper Vysoký', ['DC'], { Pace: 9, Acceleration: 9, Heading: 16, 'Jumping Reach': 17 }),
  player('s3', 'Útočník Rychlý', ['ST'], { Pace: 16, Acceleration: 17, Heading: 8, 'Jumping Reach': 9, 'Long Shots': 12, Finishing: 14 }, { injury: false, fatigue: true }),
  player('s4', 'Útočník Vysoký', ['ST'], { Heading: 16, 'Jumping Reach': 15, Pace: 10, Acceleration: 10 }),
  player('s5', 'Zraněný Stoper', ['DC'], { Heading: 20, 'Jumping Reach': 20, Pace: 20, Acceleration: 20 }, { injury: true, fatigue: false }),
];

// ---------------------------------------------------------------- celý rozbor bez atributů soupeře
test('rozbor ze zprávy hry: seřazená doporučení s českými názvy nastavení, jen to, co ještě nemáš nastavené', () => {
  const r = OA.analyze({ report: report(), tactic: myTactic(), squad: SQUAD });
  assert.equal(r.usable, true);
  assert.equal(r.team, 'Sparta Test');
  const by = (id) => r.recs.find((x) => x.id === id);
  // P01: hra píše o slabém vzduchu a komunikaci brankáře → centry a šířka; centry už má nastavené, šířka je Užší
  const p01 = by('P01');
  assert.equal(p01.sev, 'doporuceno');
  assert.equal(p01.basis, 'HRA');
  const todo = (r) => r.changes.filter((c) => !c.already);
  assert.deepEqual(todo(p01).map((c) => [c.id, c.label, c.value]), [['attackingWidth', 'Šířka při útočení', 'Širší']], 'Styl centrování už je Načechrané centry, takže se nedoporučuje');
  assert.deepEqual(p01.changes.filter((c) => c.already).map((c) => [c.id, c.fromCs]), [['crossingStyle', 'Načechrané centry']], 'ale zůstává ve výsledku jako „už máš nastaveno“');
  assert.ok(p01.risks.some((x) => /Máš Šířku při útočení „Užší“/.test(x)));
  assert.deepEqual(p01.who.map((w) => w.name), ['Útočník Vysoký', 'Útočník Rychlý'], 'nejvzdušnější útoč níci kádru, zraněný stoper se nebere');
  assert.ok(p01.ev.some((e) => /Dovednost ve vzduchu/.test(e)) && p01.ev.some((e) => /Komunikace/.test(e)));
  // P02: čtyři fyzické slabiny (Agresivita, Odvaha, Síla, Nasazení) → tvrdší hra; Napadání Častěji už má
  const p02 = by('P02');
  assert.equal(p02.sev, 'doporuceno');
  assert.deepEqual(todo(p02).map((c) => [c.label, c.value]), [['Obranný zákrok', 'Přitvrdit hru']]);
  assert.match(p02.tweak, /Get Physical/);
  assert.ok(p02.risks.some((x) => /Útočník Rychlý/.test(x)), 'unavený hráč kádru se zmíní');
  assert.deepEqual(p02.training, ['Defensive Engagement']);
  // P04: hráč ve špatné formě hraje vpravo u soupeře → naše levá strana
  const p04 = by('P04');
  assert.deepEqual(todo(p04).map((c) => [c.label, c.value]), [['Pokrok prostřednictvím', 'Levá']]);
  assert.match(p04.text, /svou levou/);
  assert.match(p04.text, /jeho pravá strana/);
  // P05: pokyny k soupeři: asistent (OZP) a střelec (ÚTS), těsné obsazování Vždy
  const p05 = by('P05');
  assert.deepEqual(r.oi.map((o) => [o.code, o.name, o.column, o.value]), [['OZP', 'Oto Křídlo', 'Těsné obsazování', 'Vždy'], ['ÚTS', 'Petr Útočník', 'Těsné obsazování', 'Vždy']]);
  assert.equal(p05.cost.oi, 2);
  assert.match(p05.text, /OZP \(Oto Křídlo\) a ÚTS \(Petr Útočník\)/);
  // P06, P16, P17 jsou jen „k vědomí“ a nepočítají se do změn
  for (const id of ['P06', 'P16', 'P17']) assert.equal(by(id).sev, 'info', id);
  assert.ok(by('P17').text.includes('Základní'));
  // seřazení: nejvyšší priorita první, info na konci
  const prios = r.recs.map((x) => x.priority);
  assert.deepEqual(prios, prios.slice().sort((a, b) => b - a));
  assert.equal(r.recs[r.recs.length - 1].sev, 'info');
});

test('rozpočet změn: nejvýš tři změny nastavení, ostatní jsou volitelné; jedna testovatelná změna je nejlevnější z nejvyšších', () => {
  const r = OA.analyze({ report: report(), tactic: myTactic(), squad: SQUAD });
  assert.equal(r.budget.max, 3);
  assert.equal(r.budget.settings, 3);
  assert.equal(r.budget.offered, 4);
  assert.equal(r.budget.over, true);
  const optional = r.recs.filter((x) => x.optional);
  assert.deepEqual(optional.map((x) => x.id), ['P10'], 'čtvrtá změna (hrát na standardky) je volitelná');
  assert.ok(r.oneChange);
  assert.equal(r.oneChange.recId, 'P01');
  assert.match(r.oneChange.text, /Šířka při útočení → Širší/);
  assert.match(r.oneChange.revert, /Tactical Tweak Pending/);
  assert.ok(r.warnings.some((w) => /nejvýš tří změn/.test(w)));
  assert.ok(r.warnings.some((w) => /jeho pravá strana je tvá levá/.test(w)));
});

test('standardky a presink soupeře: obrana standardek (zadní tyč) a časté napadání s rozporem v rozehrávce', () => {
  const r = OA.analyze({ report: report(), tactic: myTactic(), squad: SQUAD });
  const p10 = r.recs.find((x) => x.id === 'P10');
  assert.match(p10.text, /zadní tyč/);
  assert.deepEqual(p10.changes.filter((c) => !c.already).map((c) => [c.label, c.value]), [['Hrát na standardky', 'Hrát na standardky']]);
  assert.ok(p10.ev.length >= 2 && p10.ev.every((e) => /^hra píše/.test(e)));
  assert.ok(!p10.ev.some((e) => /good when defending corners/.test(e)), 'věta, že rohy brání dobře, není slabina');
  const p07 = r.recs.find((x) => x.id === 'P07');
  assert.equal(p07.changes.filter((c) => !c.already).length, 0, 'Obejít pressink už má nastavené');
  assert.ok(p07.risks.some((x) => /Možný rozpor/.test(x) && /Přímočarost přihrávek je krátká/.test(x)), 'rozpor Obejít pressink + krátká přímočarost se přizná jako úvaha autora');
  assert.equal(p07.basis, 'KOMUNITA');
  const p11 = r.recs.find((x) => x.id === 'P11');
  assert.match(p11.text, /nefauluj/);
  assert.deepEqual(r.training.map((t) => t.session), ['Corners', 'Defensive Engagement', 'Free Kicks', 'Press Avoidance']);
  assert.ok(r.training.every((t) => t.basis === 'ODHAD' && /About Session/.test(t.note)));
});

test('nepoznáno se nehádá: bez atributů soupeře se pravidla P12 až P15 nevyhodnotí a bez vlastní taktiky se neví, co už je nastavené', () => {
  const r = OA.analyze({ report: report(), squad: SQUAD });
  assert.deepEqual(r.notChecked.map((x) => x.id), ['P09', 'P12', 'P13', 'P14', 'P15'], 'P09 potřebuje tvoji taktiku, P12 až P15 atributy soupeře');
  const p01 = r.recs.find((x) => x.id === 'P01');
  assert.deepEqual(p01.changes.map((c) => [c.id, c.known, c.already]), [['crossingStyle', false, false], ['attackingWidth', false, false]], 'bez taktiky se nic nepovažuje za nastavené');
  assert.equal(r.inputs.tactic, false);
  assert.equal(r.recs.find((x) => x.id === 'P07').changes[0].id, 'buildUpStrategy');
  assert.ok(r.recs.find((x) => x.id === 'P07').risks.some((x) => /Nemáš načtenou vlastní taktiku/.test(x)));
});

test('bez zprávy o soupeři se nevyhodnocuje nic a nic se nevymýšlí', () => {
  for (const input of [undefined, null, {}, { report: OR.emptyReport() }, { report: { ok: false } }]) {
    const r = OA.analyze(input);
    assert.equal(r.usable, false);
    assert.deepEqual(r.recs, []);
    assert.deepEqual(r.oi, []);
    assert.equal(r.oneChange, null);
  }
  assert.deepEqual(OA.summaryLines(OA.analyze(null)), ['Rozbor soupeře: o soupeři nejsou načtená žádná data ze zprávy ze hry.']);
});

// ---------------------------------------------------------------- s atributy soupeřových hráčů
const OPP_PLAYERS = [
  player('o1', 'Adam Brankář', ['GK'], { Passing: 8, 'First Touch': 9, Composure: 12, Reflexes: 8, Handling: 12 }),
  player('o2', 'Kenny Pravý', ['DR'], { Pace: 8, Acceleration: 9, Composure: 12, Passing: 12, 'First Touch': 12 }),
  player('o3', 'Karel Stoper', ['DC'], { Rychlost: 7, Zrychlení: 8, Hlavičky: 8, Výskok: 9, Vyrovnanost: 8, Přihrávky: 12, Zpracování: 11 }),
  player('o4', 'Calvin Střed', ['DC'], { Pace: 9, Acceleration: 9, Heading: 9, 'Jumping Reach': 10, Composure: 12, Passing: 12, 'First Touch': 12 }),
  player('o5', 'Antonín Levý', ['DL'], { Pace: 9, Acceleration: 10, Composure: 12, Passing: 12, 'First Touch': 12 }),
  player('o6', 'Petr Útočník', ['ST'], { Pace: 16, Acceleration: 16, Heading: 15, 'Jumping Reach': 15 }),
  player('o7', 'Oto Křídlo', ['AMR'], { Pace: 15, Acceleration: 15, Passing: 15, Vision: 15, Technique: 16 }),
  player('o8', 'Josef Tvůrce', ['AMC'], { Passing: 17, Vision: 16, Technique: 15 }),
  player('o9', 'Tomáš Záloha', ['DM'], { Passing: 11, Vision: 10, Technique: 11 }),
];
// nastavení bez nižší zprávy: aby šlo zkoušet jen pravidla podle atributů, nechá se ze zprávy jen sestava a trenér
const bare = () => {
  const r = report();
  return Object.assign(r, { weaknesses: [], strengths: [], absences: [], keyPlayers: [], verdicts: [], setPieces: { attack: [], defence: [], prefs: r.setPieces.prefs }, manager: { preferredFormation: '', mentality: '', pressing: '', marking: '' }, staffAnalysis: '' });
};

test('atributy soupeře: pomalá obrana, vzduch stoperů, slabý rozehrávač, rychlí a vzdušní útočníci a tvůrce hry (české i anglické názvy atributů dohromady)', () => {
  const r = OA.analyze({ report: bare(), oppPlayers: OPP_PLAYERS, tactic: myTactic(), squad: SQUAD });
  const ids = r.recs.map((x) => x.id);
  assert.deepEqual(ids.slice().sort(), ['P01', 'P03', 'P05', 'P12', 'P13', 'P14', 'P15']);
  // P03: brankář s Reflexes 8 (práh 9); Střely z dálky už má nastavené a v kádru nejsou záložníci, takže bez změny a bez jmen
  assert.deepEqual([r.recs.find((x) => x.id === 'P03').changes.filter((c) => !c.already), r.recs.find((x) => x.id === 'P03').who], [[], []]);
  assert.deepEqual(r.recs.find((x) => x.id === 'P03').changes.map((c) => [c.id, c.already]), [['shotsFromDistance', true]]);
  assert.equal(r.inputs.lineupWithAttributes, 9 - 0, 'devět z jedenácti míst sestavy má načtené atributy');
  const by = (id) => r.recs.find((x) => x.id === id);
  // P01 jen podle atributů (hra nic nenapsala): ODHAD
  assert.equal(by('P01').basis, 'ODHAD');
  assert.equal(by('P01').sev, 'zvaz');
  assert.ok(by('P01').ev.some((e) => /Heading a Jumping Reach 9,?\d?/.test(e) || /průměr Heading a Jumping Reach/.test(e)));
  // P12: pomalá obrana → rychlí útočníci kádru, přihrávky do prostoru (protiútok už má)
  assert.deepEqual(by('P12').changes.filter((c) => !c.already).map((c) => [c.label, c.value]), [['Příjem přihrávek', 'Přihrávat do prostoru']]);
  assert.deepEqual(by('P12').who.map((w) => w.name), ['Útočník Rychlý', 'Útočník Vysoký']);
  // P13: rychlí útočníci soupeře proti vyšší linii → snížit linii, nejrychlejší stopeři
  assert.equal(by('P13').sev, 'doporuceno');
  assert.deepEqual(by('P13').changes.filter((c) => !c.already).map((c) => [c.label, c.value]), [['Výška obranná linie', 'Standardní']]);
  assert.deepEqual(by('P13').who.map((w) => w.name), ['Stoper Rychlý', 'Stoper Vysoký'], 'zraněný stoper s nejlepšími atributy se nebere');
  // P14: slabý rozehrávač (brankář: Passing 8, First Touch 9) → Napadání: Vždy na místo B
  assert.deepEqual(r.oi.map((o) => [o.code, o.column, o.value]).filter((x) => x[1] === 'Napadání'), [['B', 'Napadání', 'Vždy']]);
  // P15: vzdušně silný útočník soupeře → naši nejvzdušnější stopeři
  assert.deepEqual(by('P15').who.map((w) => w.name), ['Stoper Vysoký', 'Stoper Rychlý']);
  // P05 bez významných hráčů ve zprávě: tvůrce hry podle atributů (Passing, Vision, Technique ≥ 14) je Josef Tvůrce
  assert.equal(by('P05').basis, 'ODHAD');
  assert.deepEqual(r.oi.filter((o) => o.column === 'Těsné obsazování').map((o) => o.name), ['Josef Tvůrce']);
  assert.ok(r.oi.length <= r.thresholds.maxOi);
  // hráči: rychlý útočník kádru je unavený
  assert.ok(r.playerNotes.some((n) => n.name === 'Útočník Rychlý' && /unavený/.test(n.text)));
  assert.ok(r.playerNotes.some((n) => n.name === 'Zraněný Stoper' && /zraněný/.test(n.text)));
});

test('prahy se dají posunout a málo načtených hráčů rozbor atributů vypne', () => {
  const few = OPP_PLAYERS.filter((p) => ['Karel Stoper', 'Petr Útočník'].includes(p.name));
  const r = OA.analyze({ report: bare(), oppPlayers: few, tactic: myTactic(), squad: SQUAD });
  assert.ok(!r.recs.some((x) => x.id === 'P12'), 'dva obránci s atributy jsou pod minimem (tři)');
  assert.ok(r.notChecked.some((x) => x.id === 'P12'));
  const strict = OA.analyze({ report: bare(), oppPlayers: OPP_PLAYERS, tactic: myTactic(), squad: SQUAD, thresholds: { slowDefence: 5, fast: 18, high: 18, weakPasser: 1, aerialLow: 1, playmaker: 19 } });
  const sids = strict.recs.map((x) => x.id);
  for (const id of ['P01', 'P12', 'P13', 'P14', 'P15']) assert.ok(!sids.includes(id), `${id} při přísných prazích nevyjde`);
  assert.equal(strict.thresholds.slowDefence, 5);
  assert.equal(OA.DEFAULTS.slowDefence, 10, 'výchozí prahy se nemění');
});

test('strana se převádí na naši perspektivu: pravý obránce soupeře = naše levá, levý = naše pravá, stoper = střed', () => {
  const mk = (slot, name) => {
    const rep = bare();
    rep.lineup = rep.lineup.filter((l) => l.slot !== slot).concat([{ slot, position: '', fm: null, side: null, code: null, name, rating: 6.5 }]);
    const parsed = OR.normalizeReport({ lineup: rep.lineup.map((l) => ({ slot: l.slot, name: l.name })) }).report;
    parsed.weaknesses = [{ area: 'Hráč, který se potýká s formou', text: `${name} (6,3) je ve špatné formě.`, cls: { type: 'poorForm' } }];
    return OA.analyze({ report: parsed, tactic: myTactic() }).recs.find((x) => x.id === 'P04');
  };
  assert.deepEqual(mk('OP', 'Kenny Pravý').changes.map((c) => c.to), ['Left']);
  assert.deepEqual(mk('OL', 'Antonín Levý').changes.map((c) => c.to), ['Right']);
  assert.deepEqual(mk('OSP', 'Karel Stoper').changes.map((c) => c.to), ['Left'], 'OSP je střed vpravo: jeho pravá strana je naše levá');
  assert.deepEqual(mk('OSL', 'Calvin Střed').changes.map((c) => c.to), ['Right'], 'OSL je střed vlevo: jeho levá strana je naše pravá');
  assert.deepEqual(mk('OS', 'Libor Dlouhý').changes.map((c) => c.to), ['Middle'], 'střední stoper je střed');
});

test('spor o pravý/levý: OSP (střed vpravo) je jeho pravá strana, takže naše levá', () => {
  const rep = OR.normalizeReport({ lineup: [{ slot: 'OSP', name: 'Karel Stoper' }], weaknesses: [{ area: 'Hráč, který se potýká s formou', text: 'Karel Stoper (6,3) je ve špatné formě.' }] }).report;
  const p04 = OA.analyze({ report: rep, tactic: myTactic() }).recs.find((x) => x.id === 'P04');
  assert.equal(p04.changes[0].to, 'Left');
});

test('hráč ve špatné formě, který není v očekávané sestavě, jen informuje (nevíme, kterou stranu to otevírá)', () => {
  const rep = OR.normalizeReport({ lineup: [{ slot: 'OP', name: 'Kenny Pravý' }], weaknesses: [{ area: 'Hráč, který se potýká s formou', text: 'Neznámý Hráč (6,3)' }] }).report;
  const p04 = OA.analyze({ report: rep, tactic: myTactic() }).recs.find((x) => x.id === 'P04');
  assert.equal(p04.sev, 'info');
  assert.deepEqual(p04.changes, []);
});

test('mentalita soupeře: opatrný soupeř → širší hra; odvážný → rychlý přechod a varování před vysokou linií proti rychlým hráčům', () => {
  const cautious = bare();
  cautious.manager.mentality = 'Opatrná';
  const rc = OA.analyze({ report: cautious, tactic: myTactic() });
  const p08 = rc.recs.find((x) => x.id === 'P08');
  assert.deepEqual(p08.changes.filter((c) => !c.already).map((c) => [c.label, c.value]), [['Šířka při útočení', 'Širší']]);
  const adventurous = bare();
  adventurous.manager.mentality = 'Dobrodružná';
  const t = myTactic();
  t.teamInstructions = t.teamInstructions.filter((x) => !/Přechod do útoku/.test(x));
  const ra = OA.analyze({ report: adventurous, oppPlayers: OPP_PLAYERS, tactic: t });
  const a08 = ra.recs.find((x) => x.id === 'P08');
  assert.deepEqual(a08.changes.filter((c) => !c.already).map((c) => [c.label, c.value]), [['Přechod do útoku', 'Protiútok']]);
  assert.ok(a08.risks.some((x) => /rychlé hráče/.test(x) && /vyšší obrannou linii/.test(x)));
  const balanced = bare();
  balanced.manager.mentality = 'Vyrovnaný';
  assert.ok(!OA.analyze({ report: balanced, tactic: myTactic() }).recs.some((x) => x.id === 'P08'));
});

test('přesila ve středu zálohy soupeře: počítá se z jeho sestavy a z míst tvé taktiky', () => {
  const rep = bare();
  rep.lineup = OR.normalizeReport({ lineup: ['B', 'OP', 'OSP', 'OSL', 'OL', 'DZSP', 'DZSL', 'ZS', 'OZS', 'OZP', 'OZL'].map((slot, i) => ({ slot, name: `Hráč Číslo${i}` })) }).report.lineup;
  // soupeř: DZ ×2, Z, OZ střed = 4 ve středu; ty (4-2-3-1): 2 DZ + 1 OZ = 3 → rozdíl 1: nic
  assert.ok(!OA.analyze({ report: rep, tactic: myTactic() }).recs.some((x) => x.id === 'P09'));
  const t = T.makeTactic({ formation: '4-4-2', name: 'Dva', careerId: 'c1' }); // dva záložníci uprostřed
  const r = OA.analyze({ report: rep, tactic: t });
  const p09 = r.recs.find((x) => x.id === 'P09');
  assert.ok(p09, 'čtyři proti dvěma = přesila');
  assert.match(p09.text, /4 hráčů proti tvým 2/);
  assert.equal(p09.basis, 'ODHAD');
  const t3 = T.makeTactic({ formation: '4-3-3', name: 'Tři', careerId: 'c1' });
  assert.ok(!OA.analyze({ report: rep, tactic: t3 }).recs.some((x) => x.id === 'P09' && x.sev !== 'info'));
});

test('výpadky: dva stopeři pryč zvedne důležitost (bez tvrzení, že jde o „hlavní“), nejistý start jen připomene kontrolu před zápasem', () => {
  const rep = bare();
  rep.absences = [{ name: 'Karel Stoper', status: 'out', note: 'zlomená paže' }, { name: 'Calvin Střed', status: 'out', note: 'trest' }, { name: 'Petr Útočník', status: 'doubt', note: 'natažené slabiny' }];
  const r = OA.analyze({ report: rep, oppPlayers: OPP_PLAYERS, tactic: myTactic() });
  const p06 = r.recs.find((x) => x.id === 'P06');
  assert.equal(p06.sev, 'zvaz');
  assert.match(p06.text, /chybí dva stopeři/);
  assert.ok(p06.risks.some((x) => /Petr Útočník/.test(x) && /znovu otevři/.test(x)));
  const solo = OA.analyze({ report: Object.assign(bare(), { absences: [{ name: 'Karel Stoper', status: 'out' }] }), oppPlayers: OPP_PLAYERS, tactic: myTactic() }).recs.find((x) => x.id === 'P06');
  assert.equal(solo.sev, 'info');
});

test('vstupy se nemění, výsledek je deterministický a nezávisí na pořadí kádru', () => {
  const input = deepFreeze({ report: report(), oppPlayers: clone(OPP_PLAYERS), tactic: myTactic(), squad: clone(SQUAD) });
  const a = OA.analyze(input);
  const b = OA.analyze(input);
  assert.deepEqual(a, b);
  const shuffled = OA.analyze({ report: input.report, oppPlayers: input.oppPlayers, tactic: input.tactic, squad: clone(SQUAD).reverse() });
  assert.deepEqual(shuffled.recs.map((x) => [x.id, x.who.map((w) => w.name)]), a.recs.map((x) => [x.id, x.who.map((w) => w.name)]));
});

test('summaryLines: souhrn pro kopírování a pro Osobního trenéra obsahuje doporučení, pokyny, sezení a jednu změnu', () => {
  const lines = OA.summaryLines(OA.analyze({ report: report(), tactic: myTactic(), squad: SQUAD }));
  assert.match(lines[0], /^Rozbor soupeře Sparta Test: 7 doporučení/);
  assert.ok(lines.some((l) => /^Doporučeno \[P01\]/.test(l) && /Změna: Šířka při útočení → Širší/.test(l) && /Původ: HRA/.test(l)));
  assert.ok(lines.some((l) => /^Pokyn k soupeři: Těsné obsazování = Vždy u OZP \(Oto Křídlo\)/.test(l)));
  assert.ok(lines.some((l) => /^Zápasová příprava: Corners/.test(l)));
  assert.ok(lines.some((l) => /^Jedna testovatelná změna: Zkus jen tohle/.test(l)));
  assert.ok(lines.some((l) => /\(volitelné: přes rozpočet změn\)/.test(l)));
});

test('katalog pravidel: každé pravidlo má jedinečné id, původ ze tří štítků a vrací jen povolené stavy', () => {
  const ids = new Set();
  for (const rule of OA.RULES) {
    assert.ok(!ids.has(rule.id), rule.id);
    ids.add(rule.id);
    assert.ok(['HRA', 'KOMUNITA', 'ODHAD'].includes(rule.basis), rule.id);
    assert.equal(typeof rule.test, 'function');
    assert.ok(OA.RULE_BY_ID[rule.id] === rule);
  }
  assert.equal(OA.RULES.length, 17);
  // každé pravidlo na prázdném kontextu: nevyhodnoceno nebo nic, nikdy výjimka
  const c = OA.buildContext({ report: OR.emptyReport() });
  for (const rule of OA.RULES) assert.ok([undefined, null].includes(rule.test(c)), rule.id);
});

test('modul je čistý (žádný DOM, síť, čas ani náhoda) a nezná skryté údaje hry', () => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(withoutComments, /Math\.random|Date\.now|new Date|\bdocument\b|\bwindow\b|localStorage|fetch\s*\(/);
  assert.doesNotMatch(withoutComments, /\b(currentAbility|potentialAbility|personality|reputation)\b/i);
  const deps = [...withoutComments.matchAll(/\brequire\('([^']+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(deps, ['./dwrs.js', './fm27cs.js', './fm27know.js', './oppread.js', './tacticanalysis.js']);
});

// ---------------------------------------------------------------- nezávislá revize 7. 11. 2026 (nálezy A1, A7, A9, B1, B3 a drobnosti)
const LINEUP11 = [
  { slot: 'B', name: 'Adam Brankář' }, { slot: 'OP', name: 'Kenny Pravý' }, { slot: 'OSP', name: 'Karel Stoper' }, { slot: 'OSL', name: 'Milan Stopl' }, { slot: 'OL', name: 'Luboš Levý' },
  { slot: 'DZSP', name: 'Dan Dvě' }, { slot: 'DZSL', name: 'Emil Emko' }, { slot: 'OZP', name: 'Oto Křídlo' }, { slot: 'OZS', name: 'Ota Střed' }, { slot: 'OZL', name: 'Ondra Levák' }, { slot: 'ÚTS', name: 'Petr Útočník' },
];
const mini = (raw) => OR.normalizeReport(Object.assign({ team: 'Mini FC' }, raw)).report;
const run = (rep, extra) => OA.analyze(Object.assign({ report: rep, tactic: myTactic(), squad: SQUAD }, extra || {}));
const recOf = (res, id) => res.recs.find((r) => r.id === id);
const unchecked = (res) => res.notChecked.map((x) => x.id);
const poorForm = (name) => ({ area: 'Hráč, který se potýká s formou', text: `${name} (6,44) se potýká s formou.` });

test('A1/P04: strana se pozná i z pozice bez kódu místa (jeho pravá je naše levá); brankář ve špatné formě neotevírá žádnou stranu; hráče se stejným příjmením rozliší křestní jméno', () => {
  const fromPosition = run(mini({ lineup: [{ position: 'OZ (P)', name: 'Oto Křídlo' }], weaknesses: [poorForm('Oto Křídlo')] }));
  const p04 = recOf(fromPosition, 'P04');
  assert.deepEqual(p04.changes.map((c) => [c.id, c.to]), [['progressThrough', 'Left']], 'jeho pravá strana je naše levá');
  assert.match(p04.text, /svou levou/);
  const gk = recOf(run(mini({ lineup: [{ slot: 'B', name: 'Adam Brankář' }], weaknesses: [poorForm('Adam Brankář')] })), 'P04');
  assert.deepEqual(gk.changes, []);
  assert.equal(gk.info, true);
  assert.match(gk.text, /brankář/i);
  // dva Nováci: text hry jmenuje Jiřího (OL = jeho levá = naše pravá), ne Jana (OP)
  const twins = mini({ lineup: [{ slot: 'OP', name: 'Jan Novák' }, { slot: 'OL', name: 'Jiří Novák' }], weaknesses: [poorForm('Jiří Novák')] });
  assert.deepEqual(recOf(run(twins), 'P04').changes.map((c) => c.to), ['Right']);
  // jen příjmení a dvě shody: nepozná se, o koho jde, a nic se nehádá
  const vague = mini({ lineup: [{ slot: 'OP', name: 'Jan Novák' }, { slot: 'OL', name: 'Jiří Novák' }], weaknesses: [poorForm('Novák')] });
  const pv = recOf(run(vague), 'P04');
  assert.deepEqual(pv.changes, []);
  assert.equal(pv.info, true);
  // text hry nesmí vyvolat shodu přes hranici slov ani přes nadpis oblasti („se potýká s formou“)
  const noMatch = mini({ lineup: [{ slot: 'OP', name: 'Ab Pot' }], weaknesses: [{ area: 'Hráč, který se potýká s formou', text: 'Jiný Hráč (6,0) se potýká s formou.' }] });
  assert.equal(recOf(run(noMatch), 'P04').info, true);
});

test('A7: slabina brankáře u střel z dálky není slabina ve vzduchu (P01), ale zákroků (P03); Hbitost není brankářský atribut; Vyrážení je vzdušní brankářský atribut', () => {
  const shots = run(mini({ weaknesses: [{ area: 'Brankář', text: 'Brankář často inkasuje po střelách z dálky.' }] }));
  assert.equal(recOf(shots, 'P01'), undefined, 'o vzduchu nic nepadlo');
  const p03 = recOf(shots, 'P03');
  assert.ok(p03, 'střely z dálky jsou věc zákroků');
  assert.equal(p03.basis, 'HRA');
  assert.equal(recOf(run(mini({ weaknesses: [{ area: 'Hbitost', text: 'Hbitost týmu je nízká.' }] })), 'P03'), undefined, 'Hbitost je atribut hráčů v poli');
  assert.ok(recOf(run(mini({ weaknesses: [{ area: 'Vyrážení (Tendence)', text: 'Brankáři málo vyrážejí.' }] })), 'P01'), 'Vyrážení patří k brankářově hře do vzduchu');
  assert.ok(recOf(run(mini({ weaknesses: [{ area: 'Brankář', text: 'Brankář je slabý při centrech a hře ve vzduchu.' }] })), 'P01'));
  assert.ok(recOf(run(mini({ weaknesses: [{ area: 'Reflexes', text: 'Goalkeepers have poor reflexes.' }] })), 'P03'), 'anglické brankářské atributy se poznají');
  // centr v nadpisu oblasti platí stejně jako v textu; „centrální“ není centr
  assert.ok(recOf(run(mini({ weaknesses: [{ area: 'Inkasované góly (6 z 18 po centru)', text: 'Dostávají góly.' }] })), 'P01'));
  assert.equal(recOf(run(mini({ weaknesses: [{ area: 'Inkasované góly', text: 'Slabé v centrální zóně.' }] })), 'P01'), undefined);
  // silná stránka Rohy je hrozba na standardky
  assert.ok(recOf(run(mini({ strengths: [{ area: 'Rohy', text: 'Rohy dobře zahrávají.' }] })), 'P11'));
});

test('A9: pravidlo, kterému chybí vstup, je „nevyhodnoceno“, ne „nic nenalezeno“; P09 nehádá z pozic, které nejdou převést', () => {
  const onlyLineup = run(mini({ lineup: LINEUP11 }));
  for (const id of ['P03', 'P05', 'P06', 'P14']) assert.ok(unchecked(onlyLineup).includes(id), `${id} je nevyhodnoceno`);
  // atributy jen Pace a Acceleration: P03 a P14 je nemají z čeho posoudit
  const paceOnly = [
    player('o1', 'Adam Brankář', ['GK'], { Pace: 8, Acceleration: 9 }), player('o2', 'Kenny Pravý', ['DR'], { Pace: 8, Acceleration: 9 }), player('o3', 'Karel Stoper', ['DC'], { Pace: 7, Acceleration: 8 }),
    player('o4', 'Milan Stopl', ['DC'], { Pace: 9, Acceleration: 9 }), player('o5', 'Luboš Levý', ['DL'], { Pace: 9, Acceleration: 10 }),
  ];
  const r = run(mini({ lineup: LINEUP11 }), { oppPlayers: paceOnly });
  assert.ok(unchecked(r).includes('P03') && unchecked(r).includes('P14'));
  assert.ok(!unchecked(r).includes('P12'), 'pomalá obrana se z Pace a Acceleration posoudit dá');
  // zpráva se zraněnými a významnými hráči: P05 a P06 se vyhodnotily
  const withInfo = run(mini({ lineup: LINEUP11, absences: [{ name: 'Nikdo Důležitý', status: 'doubt' }], keyPlayers: [{ kind: 'topScorer', name: 'Petr Útočník', position: 'ÚT (S)' }] }));
  assert.ok(!unchecked(withInfo).includes('P05') && !unchecked(withInfo).includes('P06'));
  // P09: tři z jedenácti pozic nejdou převést, střed zálohy se z nich nespočítá
  const broken = LINEUP11.map((x, i) => (i >= 8 ? { position: 'Xyz', name: x.name } : x));
  const rb = run(mini({ lineup: broken }));
  assert.ok(unchecked(rb).includes('P09'), 'nepřevedené pozice: P09 nevyhodnoceno');
  assert.equal(recOf(rb, 'P09'), undefined);
});

test('B1: věty o standardkách se zápornými tvary nespouštějí P10 a P11; kladné věty dál fungují', () => {
  const neg = run(mini({
    setPieces: {
      attack: ['They have not scored from any of their last 12 corners.', 'They have scored from 0 of their last 12 corners.', 'Nevytváří žádné šance ze standardek.'],
      defence: ['They have not struggled to defend free-kicks.', 'They have not conceded from any of the last 10 corners.', 'They have been solid when defending corners, conceding from only 1 of the previous 12 deliveries.', 'Neinkasují góly ze standardek.'],
    },
  }));
  assert.equal(recOf(neg, 'P10'), undefined);
  assert.equal(recOf(neg, 'P11'), undefined);
  const pos = run(mini({ setPieces: { attack: ['They have scored from 4 of their last 12 corners.'], defence: ['They have struggled to defend corners, conceding from 5 of the last 9 they have faced.'] } }));
  assert.ok(recOf(pos, 'P10') && recOf(pos, 'P11'));
});

test('B3: P05 nehlídá hráče, který podle hry nehraje; pozice významného hráče rozlišuje stejná příjmení; P06 netvrdí, že jde o „hlavní“ stopery', () => {
  const rep = mini({
    lineup: [...LINEUP11.slice(0, 10), { slot: 'ÚTS', name: 'Petr Útočník' }],
    absences: [{ name: 'Petr Útočník', status: 'out' }],
    keyPlayers: [{ kind: 'topScorer', name: 'Petr Útočník', position: 'ÚT (S)' }, { kind: 'topAssists', name: 'Oto Křídlo', position: 'OZ (P)' }],
  });
  const p05 = recOf(run(rep), 'P05');
  assert.ok(p05);
  assert.deepEqual(p05.oi.map((o) => o.name), ['Oto Křídlo'], 'hráč, který nehraje, se nehlídá');
  const twins = mini({
    lineup: [{ slot: 'OSP', name: 'Jan Novák' }, { slot: 'ÚTS', name: 'Jiří Novák' }, ...LINEUP11.slice(1, 3)],
    keyPlayers: [{ kind: 'topScorer', name: 'J. Novák', position: 'ÚT (S)' }],
  });
  assert.deepEqual(recOf(run(twins), 'P05').oi.map((o) => o.name), ['Jiří Novák'], 'střelec hraje na útoku, tak je to ten útočník');
  const unclear = mini({ lineup: [{ slot: 'OSP', name: 'Jan Novák' }, { slot: 'ÚTS', name: 'Jiří Novák' }], keyPlayers: [{ kind: 'topScorer', name: 'J. Novák' }] });
  assert.equal(recOf(run(unclear), 'P05'), undefined, 'bez pozice a se dvěma shodami se nehádá');
  // P06
  const backs = [player('b1', 'Záložní Stoper', ['DC'], {}), player('b2', 'Druhý Stoper', ['DC'], {})];
  const p06 = recOf(run(mini({ absences: [{ name: 'Záložní Stoper', status: 'out' }, { name: 'Druhý Stoper', status: 'out' }] }), { oppPlayers: backs }), 'P06');
  assert.ok(p06);
  assert.match(p06.text, /chybí dva stopeři/);
  assert.doesNotMatch(p06.text, /hlavní/);
  assert.equal(p06.sev, 'zvaz');
});

test('P08 a P07: Aktivní (Positive) ani Protiútočný nejsou útočná mentalita; „Not often“ není časté napadání; „Často“ ano', () => {
  const mood = (m) => recOf(run(mini({ manager: { mentality: m } })), 'P08');
  assert.equal(mood('Aktivní'), undefined);
  assert.equal(mood('Positive'), undefined);
  assert.equal(mood('Protiútočný'), undefined);
  assert.equal(mood('Vyvážený'), undefined);
  for (const m of ['Útočný', 'Velmi útočný', 'Attacking', 'Very Attacking']) assert.match(mood(m).text, /odvážně a otevřeně/, m);
  for (const m of ['Opatrný', 'Obranný', 'Velmi defenzivní', 'Cautious', 'Defensive']) assert.match(mood(m).text, /opatrný/, m);
  const press = (p) => recOf(run(mini({ manager: { pressing: p } })), 'P07');
  for (const p of ['Not often', 'Zřídka', 'Méně často', 'Never', 'Nikdy']) assert.equal(press(p), undefined, p);
  for (const p of ['Často', 'Častěji', 'Often', 'Vždy', 'Always', 'Vysoký']) assert.ok(press(p), p);
});

test('rozpočet změn počítá každé nastavení jednou, i když ho chtějí dvě pravidla; jedna testovatelná změna je jedno nastavení', () => {
  // P01 (vzduch) i P08 (opatrný soupeř) chtějí Šířku při útočení → Širší
  const both = run(mini({ manager: { mentality: 'Opatrný' }, weaknesses: [{ area: 'Dovednost ve vzduchu', text: 'Slabý vzduch.' }] }));
  const p01 = recOf(both, 'P01');
  const p08 = recOf(both, 'P08');
  assert.ok(p01 && p08);
  assert.deepEqual(p01.changes.filter((c) => !c.already).map((c) => c.id), ['attackingWidth']);
  assert.deepEqual(p08.changes.filter((c) => !c.already).map((c) => c.id), ['attackingWidth']);
  assert.equal(both.budget.settings, 1, 'Šířka se počítá jednou');
  assert.equal(p08.optional, false, 'P08 nedoplácí nic navíc: změna už je v P01');
  assert.equal(p01.optional, false);
  // jedna testovatelná změna = jedno nastavení; zbytek doporučení jde až potom
  const bare2 = run(mini({ weaknesses: [{ area: 'Dovednost ve vzduchu', text: 'Slabý vzduch.' }] }), { tactic: myTactic({ teamInstructions: [] }) });
  const todo = recOf(bare2, 'P01').changes.filter((c) => !c.already);
  assert.equal(todo.length, 2, 'bez načtené taktiky jsou na řadě obě změny');
  assert.equal(bare2.oneChange.recId, 'P01');
  assert.match(bare2.oneChange.text, /Styl centrování/);
  assert.doesNotMatch(bare2.oneChange.text.split('Zbytek')[0], /Šířka při útočení/, 'v „zkus jen tohle“ je jediné nastavení');
  assert.match(bare2.oneChange.text, /Šířka při útočení → Širší/, 'druhé nastavení je jen zmíněno jako pozdější');
  assert.match(bare2.oneChange.text, /až potom/);
});
