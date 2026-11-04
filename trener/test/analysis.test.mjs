import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const A = require('../src/analysis.js');
const core = require('../src/core.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '..', 'src', 'analysis.js'), 'utf8');

// ------------------------------------------------------------------ pomůcky
/** Snímek z částečných statistik (home/away); výchozí původ je neověřené čtení z obrazu. */
function snap(id, minute, home, away, extra) {
  return A.makeSnapshot({ id, at: minute * 60000, minute, stats: { home, away }, provenance: 'vision_unverified', ...extra });
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const kinds = (findings) => findings.map((f) => f.kind);
const find = (findings, kind) => findings.filter((f) => f.kind === kind);
const allTexts = (value) => JSON.stringify(value); // celý výsledek jako text, pro kontrolu zakázaných slov

const fullStats = (p, s, sot, xg) => ({ possession: p, shots: s, shotsOnTarget: sot, xg, passes: 200, passAccuracy: 80, tackles: 10, fouls: 4, corners: 2, offsides: 1, saves: 2 });
const validRaw = () => ({
  screen: 'stats',
  minute: 34,
  score: { home: 1, away: 0 },
  teams: { home: 'Domácí FC', away: 'Hosté FC' },
  stats: { home: fullStats(58, 7, 3, 0.9), away: fullStats(42, 3, 1, 0.4) },
  events: [{ minute: 12, type: 'goal', team: 'home', text: 'Gól' }],
  visibleText: ['34:12', 'Statistiky'],
  notes: 'čitelné',
});

// ------------------------------------------------------------------ rozhraní a prahy
test('exporty a konstanty podle kontraktu 5.2', () => {
  assert.deepEqual(A.STAT_KEYS, ['possession', 'shots', 'shotsOnTarget', 'xg', 'passes', 'passAccuracy', 'tackles', 'fouls', 'corners', 'offsides', 'saves']);
  for (const name of [
    'buildExtractionPrompt', 'normalizeExtraction', 'makeSnapshot', 'sortTimeline', 'windowStats', 'detectProblems',
    'findingsToObservations', 'evaluateChange', 'summarizeMatch', 'createFrameGate', 'downscaleGray', 'frameDiff',
  ]) {
    assert.equal(typeof A[name], 'function', name);
  }
  assert.ok(Object.isFrozen(A.DEFAULT_THRESHOLDS));
  const T = A.DEFAULT_THRESHOLDS;
  assert.deepEqual(
    [T.possessionHigh, T.chanceShareLow, T.dominanceRatio, T.dominanceMinShots, T.trendRatio, T.trailingFromMinute, T.ratingDrop, T.minSpanMinutes, T.lookbackMinutes, T.minAfterMinutes, T.similarBand, T.periodMinutes],
    [58, 0.4, 1.8, 3, 2, 60, 0.8, 10, 20, 8, 0.15, 15]
  );
  for (const k of A.STAT_KEYS) assert.ok(A.STAT_RANGES[k], k);
});

test('modul je čistý: žádný čas ani náhoda bez parametru, žádné DOM, žádná síť', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, ''); // komentáře se nepočítají
  assert.ok(!/Date\.now|Math\.random|new Date\(/.test(code));
  assert.ok(!/\b(?:document|window|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/.test(code));
});

test('UMD obálka: v prohlížeči vznikne globál TrenerAnalysis, bez core.js se ozve chyba', () => {
  const sandbox = { self: { TrenerCore: core } };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.self.TrenerAnalysis.detectProblems, 'function');
  assert.throws(() => vm.runInNewContext(source, { self: {} }), /core\.js/);
});

test('funkce nemění svůj vstup (zmrazená časová osa)', () => {
  const timeline = deepFreeze([
    snap('a', 20, { possession: 61, shots: 2, shotsOnTarget: 0, xg: 0.2 }, { shots: 5, xg: 0.9 }, { score: { home: 0, away: 1 }, players: [{ name: 'Novák', rating: 7.2 }] }),
    snap('b', 35, { possession: 63, shots: 3, shotsOnTarget: 0, xg: 0.3 }, { shots: 8, xg: 1.4 }, { score: { home: 0, away: 1 }, players: [{ name: 'Novák', rating: 6.3 }] }),
    snap('c', 66, { possession: 64, shots: 4, shotsOnTarget: 0, xg: 0.4 }, { shots: 12, xg: 2 }, { score: { home: 0, away: 1 }, events: [{ minute: 60, type: 'red', team: 'away', text: 'Červená' }] }),
  ]);
  const change = deepFreeze({ id: 'c1', minute: 40, summary: 'změna', recheckAfterMinutes: 15 });
  assert.doesNotThrow(() => {
    A.sortTimeline(timeline);
    A.windowStats(timeline, 0, 130, { mySide: 'home' });
    A.detectProblems(timeline, { mySide: 'home' });
    A.evaluateChange(timeline, change, { mySide: 'home' });
    A.summarizeMatch(timeline, [change], { mySide: 'home' });
  });
});

// ------------------------------------------------------------------ prompt
test('prompt: jen čitelné, jinak null, JSON, tvar odpovědi a všechny klíče statistik', () => {
  const p = A.buildExtractionPrompt({ mySide: 'home', knownMinute: 34 });
  assert.equal(typeof p, 'string');
  for (const needle of ['JSON', 'null', 'NEODHADUJ', 'heat map', 'rolí', 'FM27', 'kumulativní', 'doslovn', 'visibleText', 'notes', '"screen"', '"minute"', '"score"', '"teams"', '"stats"', '"events"']) {
    assert.ok(p.includes(needle), needle);
  }
  for (const k of A.STAT_KEYS) assert.ok(p.includes(k), k);
  for (const v of ['match', 'stats', 'tactics', 'squad', 'analysis', 'other', 'unknown', 'goal', 'yellow', 'red', 'sub', 'injury']) assert.ok(p.includes(`"${v}"`), v);
  assert.match(p, /nedoplňuj z paměti/);
  assert.match(p, /Nic netvrď o tom, jak funguje herní engine FM27/);
  assert.match(p, /Co na snímku není čitelné, MUSÍ být null/);
  assert.match(p, /nejvýš 12/);
  assert.match(p, /POUZE jedním JSON objektem/);
});

test('prompt: strana uživatele a známá minuta jsou jen nápověda, ne fakt', () => {
  assert.match(A.buildExtractionPrompt({ mySide: 'home' }), /za domácí tým/);
  assert.match(A.buildExtractionPrompt({ mySide: 'away' }), /za hostující tým/);
  assert.match(A.buildExtractionPrompt({ mySide: null }), /není známa/);
  assert.match(A.buildExtractionPrompt(), /není známa/);
  const withMinute = A.buildExtractionPrompt({ mySide: null, knownMinute: 34 });
  assert.match(withMinute, /34\. minutě/);
  assert.match(withMinute, /NENÍ to fakt/);
  for (const bad of [-5, 'x', null, undefined, 500, NaN]) assert.ok(!/minutě \(nápověda/.test(A.buildExtractionPrompt({ knownMinute: bad })), String(bad));
  assert.equal(A.buildExtractionPrompt({ mySide: 'home', knownMinute: 34 }), A.buildExtractionPrompt({ mySide: 'home', knownMinute: 34 }));
});

// ------------------------------------------------------------------ normalizeExtraction
test('normalizeExtraction: platný snímek, provenance vždy vision_unverified', () => {
  const { snapshot, issues } = A.normalizeExtraction(validRaw(), { id: 'snap1', at: 1700000000000 });
  assert.deepEqual(issues, []);
  assert.equal(snapshot.id, 'snap1');
  assert.equal(snapshot.at, 1700000000000);
  assert.equal(snapshot.provenance, 'vision_unverified');
  assert.equal(snapshot.screen, 'stats');
  assert.equal(snapshot.minute, 34);
  assert.deepEqual(snapshot.score, { home: 1, away: 0 });
  assert.deepEqual(snapshot.teams, { home: 'Domácí FC', away: 'Hosté FC' });
  assert.equal(snapshot.stats.home.possession, 58);
  assert.equal(snapshot.stats.away.xg, 0.4);
  assert.deepEqual(snapshot.events, [{ minute: 12, type: 'goal', team: 'home', text: 'Gól' }]);
  assert.deepEqual(snapshot.visibleText, ['34:12', 'Statistiky']);
  assert.equal(snapshot.notes, 'čitelné');
  assert.deepEqual(Object.keys(snapshot.stats.home), A.STAT_KEYS);
});

test('normalizeExtraction: model si provenance nenastaví, cizí pole se zahodí a ohlásí', () => {
  const raw = { ...validRaw(), provenance: 'screenshot_verified', foo: 'bar', stats: { home: { ...fullStats(58, 7, 3, 0.9), possesion: 5 }, away: {}, draw: {} } };
  const { snapshot, issues } = A.normalizeExtraction(raw, { id: 'x1', at: 5 });
  assert.equal(snapshot.provenance, 'vision_unverified');
  assert.ok(!('foo' in snapshot) && !('draw' in snapshot.stats) && !('possesion' in snapshot.stats.home));
  const text = issues.join('\n');
  assert.match(text, /provenance/);
  assert.match(text, /foo/);
  assert.match(text, /possesion/);
  assert.match(text, /draw/);
  const ev = A.normalizeExtraction({ minute: 5, events: [{ minute: 5, type: 'goal', team: 'home', text: 'Gól', extra: 1 }] }, { id: 'x2', at: 1 });
  assert.deepEqual(Object.keys(ev.snapshot.events[0]), ['minute', 'type', 'team', 'text']);
});

test('normalizeExtraction: null hodnoty zůstanou null a nejsou chybou', () => {
  const raw = { screen: 'match', minute: null, score: { home: 2, away: 2 }, teams: { home: null, away: null }, stats: { home: { possession: null, shots: 4 }, away: null }, events: [], visibleText: [], notes: '' };
  const { snapshot, issues } = A.normalizeExtraction(raw, { id: 'n1', at: 1 });
  assert.deepEqual(issues, []);
  assert.equal(snapshot.minute, null);
  assert.equal(snapshot.teams, null);
  assert.equal(snapshot.stats.home.possession, null);
  assert.equal(snapshot.stats.home.shots, 4);
  assert.ok(A.STAT_KEYS.every((k) => snapshot.stats.away[k] === null));
});

test('normalizeExtraction: čísla mimo rozsah se nahradí null a zapíšou do issues', () => {
  const raw = {
    screen: 'stats',
    minute: 200,
    score: { home: 31, away: 1 },
    stats: {
      home: { possession: 120, shots: 61, shotsOnTarget: 41, xg: 12, passes: 1501, passAccuracy: 101, tackles: 81, fouls: 51, corners: 31, offsides: 21, saves: 41 },
      away: { possession: -1, shots: 3.5, xg: '1.2', passes: Infinity, shotsOnTarget: 2, saves: 'x' },
    },
  };
  const { snapshot, issues } = A.normalizeExtraction(raw, { id: 'r1', at: 1 });
  assert.equal(snapshot.minute, null);
  assert.equal(snapshot.score, null);
  for (const k of A.STAT_KEYS) assert.equal(snapshot.stats.home[k], null, `home.${k}`);
  for (const k of A.STAT_KEYS) assert.equal(snapshot.stats.away[k], k === 'shotsOnTarget' ? 2 : null, `away.${k}`);
  const text = issues.join('\n');
  for (const needle of ['minute: 200', 'score.home: 31', 'stats.home.possession: 120', 'stats.home.shots: 61', 'stats.home.xg: 12', 'stats.home.passes: 1501', 'stats.away.possession: -1', 'stats.away.shots: 3.5', 'stats.away.xg: hodnota není číslo', 'stats.away.saves: hodnota není číslo']) {
    assert.ok(text.includes(needle), needle);
  }
  assert.match(text, /celé skóre nahrazeno null/);
});

test('normalizeExtraction: hranice rozsahů jsou platné, o jedna dál ne', () => {
  const at = (stats, minute) => A.normalizeExtraction({ minute, stats: { home: stats } }, { id: 'b', at: 1 });
  assert.equal(at({ possession: 100 }, 0).snapshot.stats.home.possession, 100);
  assert.equal(at({ possession: 0 }, 130).snapshot.minute, 130);
  assert.equal(at({ xg: 10 }, 1).snapshot.stats.home.xg, 10);
  assert.equal(at({ shots: 60 }, 1).snapshot.stats.home.shots, 60);
  assert.equal(at({ passes: 1500 }, 1).snapshot.stats.home.passes, 1500);
  assert.equal(at({ shots: 61 }, 131).snapshot, null, 'minuta 131 i 61 střel jsou mimo rozsah: nezbylo nic čitelného');
  assert.equal(A.normalizeExtraction({ score: { home: 30, away: 0 } }, { id: 'b', at: 1 }).snapshot.score.home, 30);
  assert.equal(A.normalizeExtraction({ score: { home: 0, away: 31 } }, { id: 'b', at: 1 }).snapshot, null);
});

test('normalizeExtraction: nesmysl místo objektu, prázdný objekt a snímek bez čitelné hodnoty', () => {
  for (const garbage of ['text', '{"a":1}', 42, null, undefined, [], [1, 2], true]) {
    const r = A.normalizeExtraction(garbage, { id: 'g', at: 1 });
    assert.equal(r.snapshot, null, String(garbage));
    assert.match(r.issues[0], /není JSON objekt/);
  }
  for (const empty of [{}, { screen: 'match' }, { screen: 'unknown', notes: 'nečitelné', visibleText: ['něco'] }, { stats: { home: {}, away: {} }, events: [], score: null, minute: null }]) {
    const r = A.normalizeExtraction(empty, { id: 'e', at: 1 });
    assert.equal(r.snapshot, null);
    assert.ok(r.issues.some((i) => /žádná hodnota/.test(i)));
  }
  assert.equal(A.normalizeExtraction(validRaw()).snapshot.id, 's0', 'bez id a času vzniká deterministické id');
});

test('normalizeExtraction: podezřelý součet držení je v issues, hodnoty se tiše neopravují', () => {
  const make = (h, a) => A.normalizeExtraction({ minute: 30, stats: { home: { possession: h }, away: { possession: a } } }, { id: 'p', at: 1 });
  for (const [h, a] of [[70, 60], [40, 40], [100, 100], [10, 10]]) {
    const r = make(h, a);
    assert.ok(r.issues.some((i) => /součet držení míče/.test(i)), `${h}+${a}`);
    assert.equal(r.snapshot.stats.home.possession, h);
    assert.equal(r.snapshot.stats.away.possession, a);
  }
  for (const [h, a] of [[50, 50], [52, 53], [48, 47], [55, 45]]) assert.deepEqual(make(h, a).issues, [], `${h}+${a}`);
  assert.deepEqual(make(70, null).issues, [], 'když je uvedený jen jeden tým, součet se nekontroluje');
  const sot = A.normalizeExtraction({ minute: 5, stats: { home: { shots: 2, shotsOnTarget: 5 } } }, { id: 's', at: 1 });
  assert.match(sot.issues.join(), /střel na bránu \(5\) je víc než střel celkem \(2\)/);
  assert.equal(sot.snapshot.stats.home.shotsOnTarget, 5);
});

test('normalizeExtraction: obrazovka, události a viditelný text', () => {
  const norm = (extra) => A.normalizeExtraction({ minute: 10, ...extra }, { id: 'v', at: 1 });
  assert.equal(norm({ screen: 'unknown' }).snapshot.screen, 'other');
  const bad = norm({ screen: 'něco' });
  assert.equal(bad.snapshot.screen, 'other');
  assert.match(bad.issues.join(), /screen/);
  for (const s of ['match', 'stats', 'tactics', 'squad', 'analysis', 'other']) assert.equal(norm({ screen: s }).snapshot.screen, s);

  const ev = norm({
    events: [
      { minute: 5, type: 'goal', team: 'home', text: 'Gól' },
      { minute: 5, type: 'goal', team: 'home', text: ' gól ' },
      { minute: 7, type: 'nonsense', team: 'both', text: 'Něco' },
      { minute: 999, type: 'yellow', team: 'away', text: 'Karta' },
      { type: 'other' },
      'řetězec',
    ],
  });
  assert.deepEqual(ev.snapshot.events, [
    { minute: 5, type: 'goal', team: 'home', text: 'Gól' },
    { minute: 7, type: 'other', team: null, text: 'Něco' },
    { minute: null, type: 'yellow', team: 'away', text: 'Karta' },
  ]);
  const text = ev.issues.join('\n');
  assert.match(text, /neznámý typ „nonsense“/);
  assert.match(text, /neznámý tým „both“/);
  assert.match(text, /events\[3\]\.minute: 999/);
  assert.match(text, /prázdná událost/);

  const many = norm({ events: Array.from({ length: 50 }, (_, i) => ({ minute: i, type: 'other', team: null, text: `událost ${i}` })) });
  assert.equal(many.snapshot.events.length, 40);
  assert.match(many.issues.join(), /nad 40 událostí/);

  const vt = norm({ visibleText: Array.from({ length: 20 }, (_, i) => `řetězec ${i}`) });
  assert.equal(vt.snapshot.visibleText.length, 12);
  assert.equal(norm({ visibleText: 'ne pole' }).snapshot.visibleText.length, 0);
});

test('normalizeExtraction: neúplné skóre a neobjekty uvnitř se ohlásí, nepadá to', () => {
  const half = A.normalizeExtraction({ minute: 3, score: { home: 1 } }, { id: 'h', at: 1 });
  assert.equal(half.snapshot.score, null);
  assert.match(half.issues.join(), /jen jedna strana/);
  const odd = A.normalizeExtraction({ minute: 3, score: 'ne', teams: 5, stats: 'x', events: {}, visibleText: 7 }, { id: 'o', at: 1 });
  assert.equal(odd.snapshot.minute, 3);
  for (const needle of ['score: není objekt', 'teams: není objekt', 'stats: není objekt', 'events: není pole', 'visibleText: není pole']) assert.ok(odd.issues.join('\n').includes(needle), needle);
  const players = A.normalizeExtraction({ players: [{ name: 'Novák', rating: 7.1 }, { name: 'Bez', rating: 11 }, { rating: 6 }, 'x'] }, { id: 'pl', at: 1 });
  assert.deepEqual(players.snapshot.players, [{ name: 'Novák', rating: 7.1 }]);
});

// ------------------------------------------------------------------ makeSnapshot, sortTimeline
test('makeSnapshot: výchozí a neplatný původ je nejslabší, platný zůstane', () => {
  assert.equal(A.makeSnapshot({ id: 'a', at: 1, minute: 5 }).provenance, 'vision_unverified');
  assert.equal(A.makeSnapshot({ id: 'a', at: 1, minute: 5, provenance: 'magic' }).provenance, 'vision_unverified');
  assert.equal(A.makeSnapshot({ id: 'a', at: 1, minute: 5, provenance: 'ocr_unverified' }).provenance, 'vision_unverified');
  assert.equal(A.makeSnapshot({ id: 'a', at: 1, minute: 5, provenance: 'user_entered' }).provenance, 'user_entered');
  assert.equal(A.makeSnapshot({ id: 'a', at: 1, minute: 5, provenance: 'screenshot_verified' }).provenance, 'screenshot_verified');
  const s = A.makeSnapshot({ id: 'a', at: 1, minute: 5 });
  assert.deepEqual(Object.keys(s.stats.home), A.STAT_KEYS);
  assert.equal(s.screen, 'other');
  assert.deepEqual(s.events, []);
  assert.equal(A.makeSnapshot(null).minute, null);
  assert.equal(A.makeSnapshot({ id: 'zlé id!', at: 7 }).id, 's7');
  const sink = [];
  A.makeSnapshot({ id: 'a', at: 1, minute: 500 }, { issues: sink });
  assert.match(sink.join(), /minute: 500/);
});

test('sortTimeline: podle minuty, času a id; bez minuty na konec; vstup se nemění', () => {
  const list = [
    A.makeSnapshot({ id: 'e', at: 5, minute: null }),
    A.makeSnapshot({ id: 'c', at: 30, minute: 20 }),
    A.makeSnapshot({ id: 'b', at: 10, minute: 20 }),
    A.makeSnapshot({ id: 'a', at: 99, minute: 5 }),
    A.makeSnapshot({ id: 'd', at: 10, minute: 20 }),
    'nesmysl',
    null,
  ];
  const before = list.map((x) => x && x.id);
  const sorted = A.sortTimeline(list);
  assert.deepEqual(sorted.map((s) => s.id), ['a', 'b', 'd', 'c', 'e']);
  assert.deepEqual(list.map((x) => x && x.id), before);
  assert.notEqual(sorted, list);
  assert.deepEqual(A.sortTimeline(undefined), []);
});

// ------------------------------------------------------------------ windowStats
const WIN = [
  snap('w1', 20, { possession: 60, shots: 4, shotsOnTarget: 1, xg: 0.5 }, { possession: 40, shots: 6, shotsOnTarget: 2, xg: 0.9 }),
  snap('w2', 30, { possession: 62, shots: 5, shotsOnTarget: 1, xg: 0.6 }, { possession: 38, shots: 11, shotsOnTarget: 4, xg: 1.7 }),
];

test('windowStats: tempo na 10 minut z rozdílu kumulativních statistik, podíly a změna držení', () => {
  const w = A.windowStats(WIN, 20, 30, { mySide: 'home' });
  assert.equal(w.minutes, 10);
  assert.equal(w.kickoff, false);
  assert.deepEqual(w.snapshots, ['w1', 'w2']);
  assert.equal(w.mine.totals.shots, 1);
  assert.equal(w.opp.totals.shots, 5);
  assert.equal(w.mine.rates.shots, 1);
  assert.equal(w.opp.rates.shots, 5);
  assert.equal(w.mine.rates.xg, 0.1);
  assert.equal(w.opp.rates.xg, 0.8);
  assert.equal(w.opp.rates.shotsOnTarget, 2);
  assert.equal(w.mine.share.shots, 0.1667);
  assert.equal(w.mine.share.xg, 0.1111);
  assert.equal(w.mine.possession.changePp, 2);
  assert.equal(w.opp.possession.changePp, -2);
  assert.equal(w.mine.possession.end, 62);
  assert.equal(w.mine.last.shots, 5);
  assert.equal(w.mine.rates.possession, undefined, 'držení není součet, tempo se nepočítá');
  assert.deepEqual(w.warnings, []);
  // tempo se škáluje délkou okna: stejný rozdíl za 20 minut je poloviční tempo
  const slow = A.windowStats([WIN[0], snap('w3', 40, { shots: 5, xg: 0.6 }, { shots: 11, xg: 1.7 })], 20, 40, { mySide: 'home' });
  assert.equal(slow.opp.rates.shots, 2.5);
});

test('windowStats: strana away a neznámá strana', () => {
  const away = A.windowStats(WIN, 20, 30, { mySide: 'away' });
  assert.equal(away.mine.totals.shots, 5);
  assert.equal(away.opp.totals.shots, 1);
  assert.equal(away.mine.share.shots, 0.8333);
  const none = A.windowStats(WIN, 20, 30);
  assert.equal(none.mine, null);
  assert.equal(none.opp, null);
  assert.equal(none.home.totals.shots, 1);
  assert.equal(none.away.totals.shots, 5);
});

test('windowStats: okno od začátku zápasu stačí jeden snímek, jinak jsou potřeba dva', () => {
  const k = A.windowStats([WIN[1]], 0, 130, { mySide: 'home' });
  assert.equal(k.kickoff, true);
  assert.equal(k.minutes, 30);
  assert.deepEqual(k.snapshots, ['w2']);
  assert.equal(k.mine.totals.shots, 5);
  assert.equal(k.mine.rates.shots, 1.667);
  assert.equal(k.mine.possession.start, null);
  assert.equal(k.mine.possession.changePp, null);
  assert.equal(A.windowStats([WIN[1]], 10, 130, { mySide: 'home' }), null, 'jediný snímek mimo začátek zápasu nedává rozdíl');
  assert.equal(A.windowStats([WIN[0], snap('same', 20, { shots: 9 }, { shots: 9 })], 10, 40), null, 'dva snímky ve stejné minutě');
  assert.equal(A.windowStats(WIN, 30, 20), null);
  assert.equal(A.windowStats([], 0, 130), null);
  assert.equal(A.windowStats(undefined, 0, 130), null);
  assert.equal(A.windowStats(WIN, NaN, 30), null);
  assert.equal(A.windowStats(WIN, 31, 130), null);
});

test('windowStats: záporný rozdíl kumulativní hodnoty se nepočítá a je ve warnings', () => {
  const bad = [snap('x1', 20, { shots: 8, xg: 1 }, { shots: 3, xg: 0.2 }), snap('x2', 30, { shots: 6, xg: 1.4 }, { shots: 5, xg: 0.5 })];
  const w = A.windowStats(bad, 20, 30, { mySide: 'home' });
  assert.equal(w.mine.rates.shots, null);
  assert.equal(w.mine.totals.shots, null);
  assert.equal(w.mine.rates.xg, 0.4);
  assert.equal(w.opp.rates.shots, 2);
  assert.equal(w.mine.share.shots, null);
  assert.equal(w.warnings.length, 1);
  assert.match(w.warnings[0], /home\.shots: kumulativní hodnota klesla z 8 na 6/);
});

test('windowStats: snímky bez minuty nebo bez statistik se ignorují, chybějící statistika je null', () => {
  const tl = [
    A.makeSnapshot({ id: 'nm', at: 1, minute: null, stats: { home: { shots: 99 } } }),
    snap('t1', 20, { shots: 2 }, { shots: 3 }),
    A.makeSnapshot({ id: 'ns', at: 2, minute: 25 }),
    snap('t2', 30, { shots: 4 }, { shots: 3 }),
  ];
  const w = A.windowStats(tl, 15, 35, { mySide: 'home' });
  assert.deepEqual(w.snapshots, ['t1', 't2']);
  assert.equal(w.mine.totals.shots, 2);
  assert.equal(w.opp.totals.shots, 0);
  assert.equal(w.mine.rates.xg, null);
  assert.equal(w.opp.share.shots, 0, 'soupeř 0 z 2 střel: podíl 0');
});

test('windowStats: evidenceTier podle původu použitých snímků', () => {
  assert.equal(A.windowStats(WIN, 20, 30).evidenceTier, 'inferred');
  const verified = WIN.map((s) => ({ ...s, provenance: 'screenshot_verified' }));
  assert.equal(A.windowStats(verified, 20, 30).evidenceTier, 'observed');
});

// ------------------------------------------------------------------ detektor possession_without_chances
test('possession_without_chances: jedno měření je jen watch, dvě měření ≥ 10 min od sebe jsou alert', () => {
  const a = snap('a', 20, { possession: 61, shots: 2, xg: 0.2 }, { possession: 39, shots: 5, xg: 0.9 });
  const b = snap('b', 35, { possession: 63, shots: 3, xg: 0.3 }, { possession: 37, shots: 8, xg: 1.4 });
  const one = find(A.detectProblems([b], { mySide: 'home' }), 'possession_without_chances');
  assert.equal(one.length, 1);
  assert.equal(one[0].severity, 'watch');
  assert.match(one[0].text, /jedno měření/);
  assert.deepEqual(one[0].evidence, ['b']);
  assert.equal(one[0].minute, 35);

  const two = find(A.detectProblems([a, b], { mySide: 'home' }), 'possession_without_chances');
  assert.equal(two.length, 1);
  assert.equal(two[0].severity, 'alert');
  assert.deepEqual(two[0].evidence, ['a', 'b']);
  assert.equal(two[0].metrics.possession, 63);
  assert.equal(two[0].metrics.snapshots, 2);
  assert.equal(two[0].metrics.spanMinutes, 15);
  assert.match(two[0].text, /Možná příčina k ověření/);
  assert.match(two[0].text, /Statistická odchylka sama není taktický problém/);
  assert.match(two[0].basis, /Heuristika této aplikace, ne pravidlo FM27/);
  assert.match(two[0].basis, /58 %/);
  assert.equal(two[0].kind, 'possession_without_chances');
  assert.ok(two[0].id.startsWith('possession_without_chances:'));
  assert.equal(two[0].at, null);
  assert.equal(A.detectProblems([a, b], { mySide: 'home', now: 1234 })[0].at, 1234);
});

test('possession_without_chances: odstup pod 10 minut nebo nepotvrzující starší snímek nestačí na alert', () => {
  const b = snap('b', 35, { possession: 63, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 });
  const close = snap('c', 28, { possession: 62, shots: 2, xg: 0.2 }, { shots: 6, xg: 1 });
  const f = find(A.detectProblems([close, b], { mySide: 'home' }), 'possession_without_chances')[0];
  assert.equal(f.severity, 'watch');
  assert.deepEqual(f.evidence, ['b']);
  const old = snap('o', 20, { possession: 50, shots: 4, xg: 0.5 }, { shots: 4, xg: 0.5 });
  const g = find(A.detectProblems([old, b], { mySide: 'home' }), 'possession_without_chances')[0];
  assert.equal(g.severity, 'watch');
  assert.match(g.text, /Dřívější snímek \(min\. 20\) tento stav nepotvrzuje/);
});

test('possession_without_chances: nevzniká bez splněných podmínek (hranice 58 % a 40 %)', () => {
  const run = (home, away, mySide = 'home') => find(A.detectProblems([snap('s', 35, home, away)], { mySide }), 'possession_without_chances');
  assert.equal(run({ possession: 57, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 }).length, 0, 'držení pod 58 %');
  assert.equal(run({ possession: 58, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 }).length, 1, 'přesně 58 % už stačí');
  assert.equal(run({ possession: 62, shots: 4, xg: 0.5 }, { shots: 6, xg: 0.7 }).length, 0, 'podíl střel přesně 40 % není pod prahem');
  assert.equal(run({ possession: 62, shots: 5, xg: 1.2 }, { shots: 9, xg: 1.2 }).length, 0, 'střely říkají 36 %, xG 50 %: nesouhlasí, nehlásíme');
  assert.equal(run({ possession: 62, shots: 1, xg: null }, { shots: 4, xg: null }).length, 0, 'pět střel obou týmů je na podíl málo');
  assert.equal(run({ possession: 62, shots: 2, xg: null }, { shots: 4, xg: null }).length, 1, 'šest střel se už posuzuje');
  assert.equal(run({ possession: null, shots: 2 }, { shots: 9 }).length, 0, 'bez držení se nehodnotí');
  assert.equal(run({ possession: 70, shots: 6, xg: 1 }, { shots: 6, xg: 1 }).length, 0, 'poloviční podíl');
  assert.equal(run({ possession: 40, shots: 2, xg: 0.2 }, { possession: 60, shots: 9, xg: 1.4 }, 'away').length, 0, 'soupeř (domácí) má 60 % držení, ne my');
  assert.equal(run({ possession: 40, shots: 9, xg: 1.4 }, { possession: 60, shots: 2, xg: 0.2 }, 'away').length, 1, 'my jako hosté: 60 % držení a 2 střely z 11');
  const resolved = [snap('x', 20, { possession: 62, shots: 2, xg: 0.2 }, { shots: 6, xg: 1 }), snap('y', 40, { possession: 60, shots: 9, xg: 1.4 }, { shots: 10, xg: 1.5 })];
  assert.equal(find(A.detectProblems(resolved, { mySide: 'home' }), 'possession_without_chances').length, 0, 'dnes už stav neplatí');
});

test('possession_without_chances: používá poslední snímek se statistikami, i když poslední snímek žádné nemá', () => {
  const tl = [snap('a', 35, { possession: 63, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 }), A.makeSnapshot({ id: 'tac', at: 99, minute: 40, screen: 'tactics', provenance: 'vision_unverified' })];
  const f = find(A.detectProblems(tl, { mySide: 'home' }), 'possession_without_chances');
  assert.deepEqual(f[0].evidence, ['a']);
});

// ------------------------------------------------------------------ detektor opponent_chance_dominance
test('opponent_chance_dominance: nález vzniká, alert až s potvrzením o ≥ 10 minut dřív', () => {
  const run = (home, away, mySide = 'home') => find(A.detectProblems([snap('s', 30, home, away)], { mySide }), 'opponent_chance_dominance');
  assert.equal(run({ shots: 3 }, { shots: 6 }).length, 1, 'poměr 2,0');
  assert.equal(run({ shots: 5 }, { shots: 9 }).length, 1, 'přesně 1,8×');
  assert.equal(run({ shots: 3 }, { shots: 5 }).length, 0, 'poměr 1,67');
  assert.equal(run({ shots: 0 }, { shots: 2 }).length, 0, 'soupeř má méně než 3 střely');
  assert.equal(run({ shots: 0 }, { shots: 3 }).length, 1, 'tři střely proti nule');
  assert.equal(run({ shots: 4 }, { shots: 3 }).length, 0);
  assert.equal(run({ shots: 3 }, {}).length, 0, 'soupeřovy střely neznáme');
  assert.equal(run({ shots: 7 }, { shots: 3 }, 'away').length, 1, 'my jsme hosté, soupeř (domácí) má 7:3');
  assert.equal(run({ shots: 3, xg: 0.5 }, { shots: 3, xg: 1.2 }).length, 1, 'střely stejné, xG 2,4×');
  assert.equal(run({ shots: 3, xg: 0.7 }, { shots: 3, xg: 1.2 }).length, 0, 'xG jen 1,7×');
  assert.equal(run({ shots: 3, xg: 0 }, { shots: 3, xg: 0.3 }).length, 0, 'soupeřovo xG pod minimem nestačí');

  const a = snap('a', 15, { shots: 1 }, { shots: 3 });
  const b = snap('b', 30, { shots: 3 }, { shots: 7 });
  const f = find(A.detectProblems([a, b], { mySide: 'home' }), 'opponent_chance_dominance');
  assert.equal(f[0].severity, 'alert');
  assert.deepEqual(f[0].evidence, ['a', 'b']);
  assert.match(f[0].text, /střely soupeře 7, naše 3/);
  assert.match(f[0].text, /Opírá se o snímky z minut 15, 30 \(odstup 15 min\)/);
  assert.equal(f[0].metrics.shotsRatio, 2.33);
  assert.match(f[0].basis, /1\.8×/);
  const single = find(A.detectProblems([b], { mySide: 'home' }), 'opponent_chance_dominance')[0];
  assert.equal(single.severity, 'watch');
  assert.match(single.text, /jedno měření/);
  assert.match(single.text, /Možná příčina k ověření/);
});

test('opponent_chance_dominance: text říká, který ukazatel překročil práh', () => {
  const text = (home, away) => find(A.detectProblems([snap('s', 30, home, away)], { mySide: 'home' }), 'opponent_chance_dominance')[0].text;
  assert.match(text({ shots: 3 }, { shots: 6 }), /překračuje počet střel\./);
  assert.match(text({ shots: 9, xg: 0.7 }, { shots: 9, xg: 1.3 }), /překračuje xG \(střely samotné práh nepřekračují\)/);
  assert.match(text({ shots: 3, xg: 0.5 }, { shots: 7, xg: 1.2 }), /překračuje počet střel i xG/);
  assert.match(text({ shots: 3, xg: 0.5 }, { shots: 7, xg: 1.2 }), /xG soupeře 1,2, naše 0,5/);
});

// ------------------------------------------------------------------ detektor opponent_shots_trend
const trendLine = (shots, minutes = [10, 20, 30]) => shots.map((s, i) => snap(`t${i}`, minutes[i], { shots: 1 }, { shots: s }));
const trend = (list, mySide = 'home') => find(A.detectProblems(list, { mySide }), 'opponent_shots_trend');

test('opponent_shots_trend: potřebuje tři snímky a aspoň dvojnásobné tempo v posledním okně', () => {
  const f = trend(trendLine([1, 3, 8]));
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'alert');
  assert.deepEqual(f[0].evidence, ['t0', 't1', 't2']);
  assert.equal(f[0].metrics.prevRatePer10, 2);
  assert.equal(f[0].metrics.lastRatePer10, 5);
  assert.match(f[0].text, /Možná příčina k ověření/);
  assert.match(f[0].basis, /Heuristika/);
  assert.equal(trend(trendLine([1, 3, 7])).length, 1, 'přesně 2×');
  assert.equal(trend(trendLine([0, 0, 4]))[0].severity, 'alert', 'z nuly na čtyři střely');
  assert.equal(trend(trendLine([1, 4, 7])).length, 0, 'stejné tempo');
  assert.equal(trend(trendLine([0, 0, 2])).length, 0, 'v posledním okně jen 2 střely');
  assert.equal(trend(trendLine([1, 3])).length, 0, 'dva snímky nestačí');
  assert.equal(trend(trendLine([5, 3, 8])).length, 0, 'kumulativní hodnota klesla');
  assert.equal(trend(trendLine([1, 3, 8]), null).length, 0, 'bez strany uživatele nelze určit soupeře');
  const away = [10, 20, 30].map((m, i) => snap(`t${i}`, m, { shots: [1, 3, 8][i] }, { shots: 1 }));
  assert.equal(trend(away, 'away').length, 1, 'my jsme hosté: soupeř jsou domácí');
  assert.equal(trend(away, 'home').length, 0);
});

test('opponent_shots_trend: krátká okna jsou jen watch s poznámkou, husté snímky najdou okna po 10 minutách', () => {
  const short = trend(trendLine([1, 2, 6], [20, 23, 26]));
  assert.equal(short.length, 1);
  assert.equal(short[0].severity, 'watch');
  assert.match(short[0].text, /Okna trendu jsou krátká/);
  const mixed = trend(trendLine([1, 3, 8], [10, 22, 26]));
  assert.equal(mixed[0].severity, 'watch');

  const minutes = [5, 10, 15, 20, 25, 30, 35, 40];
  const dense = minutes.map((m, i) => snap(`d${i}`, m, { shots: 1 }, { shots: [0, 0, 1, 1, 1, 2, 5, 8][i] }));
  const f = trend(dense);
  assert.equal(f[0].severity, 'alert');
  assert.deepEqual(f[0].evidence, ['d3', 'd5', 'd7']);
  assert.equal(f[0].metrics.prevShots, 1);
  assert.equal(f[0].metrics.lastShots, 6);
});

// ------------------------------------------------------------------ detektor trailing_without_threat
const TS = (id, minute, h, a, sot) => snap(id, minute, { shotsOnTarget: sot }, {}, { score: { home: h, away: a } });
const trailing = (list, mySide = 'home') => find(A.detectProblems(list, { mySide }), 'trailing_without_threat');

test('trailing_without_threat: od 60. minuty prohráváme a v okně není střela na bránu', () => {
  const single = trailing([TS('p', 65, 0, 1, 0)]);
  assert.equal(single.length, 1);
  assert.equal(single[0].severity, 'watch');
  assert.match(single[0].text, /od začátku zápasu jsme neměli žádnou střelu na bránu/);
  assert.match(single[0].text, /jedno měření/);
  assert.match(single[0].text, /Možná příčina k ověření/);

  const alert = trailing([TS('p', 54, 0, 1, 1), TS('q', 66, 0, 1, 1)]);
  assert.equal(alert[0].severity, 'alert');
  assert.deepEqual(alert[0].evidence, ['p', 'q']);
  assert.match(alert[0].text, /v okně od 54\. do 66\. minuty/);
  assert.equal(alert[0].metrics.windowFrom, 54);

  const short = trailing([TS('p', 60, 0, 1, 0), TS('q', 66, 0, 1, 0)]);
  assert.equal(short[0].severity, 'watch');
  assert.match(short[0].text, /jen 6 min/);
});

test('trailing_without_threat: nevzniká, když vedeme, remizujeme, je dřív než 60. minuta nebo střela byla', () => {
  assert.equal(trailing([TS('p', 54, 0, 1, 1), TS('q', 66, 0, 1, 2)]).length, 0, 'v okně je střela na bránu');
  assert.equal(trailing([TS('p', 55, 0, 1, 0)]).length, 0, 'před 60. minutou');
  assert.equal(trailing([TS('p', 65, 1, 1, 0)]).length, 0, 'remíza');
  assert.equal(trailing([TS('p', 65, 2, 1, 0)]).length, 0, 'vedeme');
  assert.equal(trailing([TS('p', 65, 0, 1, 2)]).length, 0, 'jediný snímek se střelami na bránu: bez okna nic nevíme o poslední době');
  assert.equal(trailing([snap('n', 65, { shotsOnTarget: 0 }, {})]).length, 0, 'bez skóre');
  assert.equal(trailing([snap('m', 65, { shots: 3 }, {}, { score: { home: 0, away: 1 } })]).length, 0, 'bez střel na bránu');
  assert.equal(trailing([TS('p', 54, 0, 1, 1), TS('q', 66, 0, 1, 1)], null).length, 0, 'bez strany uživatele');
  const level = trailing([TS('p', 52, 1, 1, 0), TS('q', 66, 0, 1, 0)]);
  assert.equal(level[0].severity, 'watch', 'dřívější snímek při remíze není základ okna');
  assert.deepEqual(level[0].evidence, ['q']);
  const away = snap('a', 66, {}, { shotsOnTarget: 0 }, { score: { home: 2, away: 1 } });
  assert.equal(trailing([away], 'away').length, 1, 'jako hosté prohráváme 1:2 a nemáme střelu na bránu');
  assert.equal(trailing([away], 'home').length, 0, 'jako domácí vedeme 2:1 (a naše střely na bránu ani neznáme)');
});

// ------------------------------------------------------------------ detektor red_card
const redEvent = (team, minute = 38, text = 'Červená karta') => ({ minute, type: 'red', team, text });
const RS = (id, minute, events) => snap(id, minute, { shots: 1 }, { shots: 1 }, { events });
const reds = (list, mySide = 'home') => find(A.detectProblems(list, { mySide }), 'red_card');

test('red_card: fakt z události; jedno čtení je watch, potvrzení ≥ 10 minut později je alert; bez duplicit', () => {
  const one = reds([RS('r1', 40, [redEvent('away')])]);
  assert.equal(one.length, 1);
  assert.equal(one[0].severity, 'watch');
  assert.match(one[0].text, /soupeř hraje o hráče méně/);
  assert.match(one[0].text, /početní situace/);
  assert.match(one[0].text, /jedno měření/);
  assert.equal(one[0].evidenceTier, 'inferred');
  assert.match(one[0].basis, /neověřená/);
  assert.equal(one[0].metrics.minute, 38);
  assert.equal(one[0].metrics.redsAway, 1);

  const twice = reds([RS('r1', 40, [redEvent('away')]), RS('r2', 54, [redEvent('away', 38, 'červená karta')])]);
  assert.equal(twice.length, 1, 'stejná událost v dalším snímku se nepočítá znovu');
  assert.equal(twice[0].severity, 'alert');
  assert.deepEqual(twice[0].evidence, ['r1', 'r2']);
  const near = reds([RS('r1', 40, [redEvent('away')]), RS('r2', 46, [redEvent('away')])]);
  assert.equal(near[0].severity, 'watch');
});

test('red_card: strana, neznámý tým, jiné události a dvě červené', () => {
  assert.match(reds([RS('r', 40, [redEvent('home')])])[0].text, /hrajeme o hráče méně/);
  const neutral = reds([RS('r', 40, [redEvent('away')])], null);
  assert.equal(neutral.length, 1, 'červená karta je fakt z události, mySide nepotřebuje');
  assert.match(neutral[0].text, /hosté hrají o hráče méně/);
  assert.match(reds([RS('r', 40, [redEvent('home')])], null)[0].text, /domácí hrají o hráče méně/);
  assert.match(reds([RS('r', 40, [redEvent(null)])])[0].text, /který, se ze snímku nepodařilo určit/);
  assert.equal(reds([RS('r', 40, [{ minute: 30, type: 'yellow', team: 'home', text: 'Žlutá' }, { minute: 31, type: 'sub', team: 'away', text: 'Střídání' }])]).length, 0);
  const two = reds([RS('r', 70, [redEvent('home', 30), redEvent('away', 55)])]);
  assert.equal(two.length, 2);
  assert.notEqual(two[0].id, two[1].id);
  assert.deepEqual([two[1].metrics.redsHome, two[1].metrics.redsAway], [1, 1]);
  assert.match(two[1].text, /domácí 1, hosté 1/);
  const noMinute = reds([RS('r', 40, [{ minute: null, type: 'red', team: 'home', text: '' }])]);
  assert.match(noMinute[0].text, /\(40\. min, domácí\)/);
});

// ------------------------------------------------------------------ detektor rating_drop
const PS = (id, minute, players) => snap(id, minute, { shots: 1 }, { shots: 1 }, { players });
const drops = (list) => find(A.detectProblems(list, { mySide: 'home' }), 'rating_drop');

test('rating_drop: pokles o ≥ 0,8 mezi snímky', () => {
  const f = drops([PS('r1', 20, [{ name: 'Novák', rating: 7.2 }]), PS('r2', 35, [{ name: 'Novák', rating: 6.3 }])]);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'alert');
  assert.deepEqual(f[0].evidence, ['r1', 'r2']);
  assert.equal(f[0].metrics.drop, 0.9);
  assert.match(f[0].title, /Novák/);
  assert.match(f[0].text, /z 7,2 \(20\. min\) na 6,3 \(35\. min\)/);
  assert.match(f[0].text, /Možná příčina k ověření/);
  assert.equal(drops([PS('r1', 20, [{ name: 'Novák', rating: 7.2 }]), PS('r2', 35, [{ name: 'Novák', rating: 6.4 }])]).length, 1, 'přesně 0,8');
  assert.equal(drops([PS('r1', 20, [{ name: 'Novák', rating: 7.2 }]), PS('r2', 35, [{ name: 'Novák', rating: 6.5 }])]).length, 0, 'pokles jen 0,7');
  assert.equal(drops([PS('r1', 20, [{ name: 'Novák', rating: 6.3 }]), PS('r2', 35, [{ name: 'Novák', rating: 7.2 }])]).length, 0, 'růst');
  assert.equal(drops([PS('r2', 35, [{ name: 'Novák', rating: 6.3 }])]).length, 0, 'jeden snímek');
  const shortGap = drops([PS('r1', 30, [{ name: 'Novák', rating: 7.2 }]), PS('r2', 34, [{ name: 'Novák', rating: 6.3 }])]);
  assert.equal(shortGap[0].severity, 'watch');
  const named = drops([PS('r1', 20, [{ name: 'Novák', rating: 7.2 }]), PS('r2', 35, [{ name: ' NOVAK ', rating: 6.3 }])]);
  assert.equal(named.length, 1, 'jméno se porovnává bez diakritiky a velikosti písmen');
  const many = drops([
    PS('r1', 20, ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ name: n, rating: 7.5 }))),
    PS('r2', 35, ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ name: n, rating: 7.5 - 0.8 - i * 0.1 }))),
  ]);
  assert.equal(many.length, 3, 'nejvýš tři nálezy');
  assert.deepEqual(many.map((x) => x.metrics.player), ['E', 'D', 'C'], 'nejdřív největší pokles');
});

// ------------------------------------------------------------------ původ důkazů, jeden snímek, mySide
test('evidenceTier: inferred, pokud kterýkoli snímek je vision_unverified; observed jen u ověřených nebo zadaných', () => {
  const tl = (pa, pb) => [
    snap('a', 20, { possession: 61, shots: 2, xg: 0.2 }, { shots: 5, xg: 0.9 }, { provenance: pa }),
    snap('b', 35, { possession: 63, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 }, { provenance: pb }),
  ];
  const tier = (pa, pb) => find(A.detectProblems(tl(pa, pb), { mySide: 'home' }), 'possession_without_chances')[0].evidenceTier;
  assert.equal(tier('vision_unverified', 'vision_unverified'), 'inferred');
  assert.equal(tier('screenshot_verified', 'screenshot_verified'), 'observed');
  assert.equal(tier('user_entered', 'screenshot_verified'), 'observed');
  assert.equal(tier('user_entered', 'user_entered'), 'observed');
  assert.equal(tier('screenshot_verified', 'vision_unverified'), 'inferred');
  assert.equal(tier('vision_unverified', 'screenshot_verified'), 'inferred');
  const unknownProvenance = [{ ...tl('screenshot_verified', 'screenshot_verified')[0], provenance: undefined }, tl('screenshot_verified', 'screenshot_verified')[1]];
  assert.equal(find(A.detectProblems(unknownProvenance, { mySide: 'home' }), 'possession_without_chances')[0].evidenceTier, 'inferred');
  const ev = A.detectProblems([RS('v', 40, [redEvent('away')])].map((s) => ({ ...s, provenance: 'screenshot_verified' })), { mySide: 'home' })[0];
  assert.equal(ev.evidenceTier, 'observed');
  assert.doesNotMatch(ev.basis, /neověřená/);
});

test('jeden snímek: každý nález je nejvýš watch a říká, že jde o jedno měření', () => {
  const one = snap('one', 66, { possession: 63, shots: 3, shotsOnTarget: 0, xg: 0.3 }, { possession: 37, shots: 8, shotsOnTarget: 4, xg: 1.4 }, {
    score: { home: 0, away: 1 },
    events: [redEvent('away', 60)],
  });
  const findings = A.detectProblems([one], { mySide: 'home' });
  assert.deepEqual(kinds(findings).sort(), ['opponent_chance_dominance', 'possession_without_chances', 'red_card', 'trailing_without_threat']);
  for (const f of findings) {
    assert.equal(f.severity, 'watch', f.kind);
    assert.match(f.text, /jedno měření/, f.kind);
    assert.deepEqual(f.evidence, ['one'], f.kind);
    assert.equal(f.evidenceTier, 'inferred', f.kind);
    assert.ok(f.basis.length > 20, f.kind);
  }
  assert.deepEqual(A.detectProblems([], { mySide: 'home' }), []);
  assert.deepEqual(A.detectProblems(undefined), []);
});

test('alert smí vzniknout jen ze dvou snímků s odstupem ≥ 10 minut; upozornění jsou na začátku výsledku', () => {
  const a = snap('a', 20, { possession: 61, shots: 2, xg: 0.2 }, { shots: 5, xg: 0.9 }, { events: [redEvent('away', 18)] });
  const b = snap('b', 35, { possession: 63, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 }, { events: [redEvent('away', 18)] });
  const alerts = A.detectProblems([a, b], { mySide: 'home' }).filter((f) => f.severity === 'alert');
  assert.ok(alerts.length >= 2);
  for (const f of alerts) {
    assert.ok(f.evidence.length >= 2, f.kind);
    const minutes = f.evidence.map((id) => ({ a: 20, b: 35 })[id]);
    assert.ok(Math.max(...minutes) - Math.min(...minutes) >= 10, f.kind);
  }
  const bunched = [a, snap('a2', 24, { possession: 63, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 })];
  assert.ok(A.detectProblems(bunched, { mySide: 'home' }).every((f) => f.severity === 'watch'));
  const mixed = A.detectProblems([a, b], { mySide: 'home' });
  const firstWatch = mixed.findIndex((f) => f.severity === 'watch');
  assert.ok(firstWatch === -1 || mixed.slice(firstWatch).every((f) => f.severity === 'watch'));
  const custom = A.detectProblems([a, b], { mySide: 'home', thresholds: { minSpanMinutes: 20 } });
  assert.ok(custom.every((f) => f.severity === 'watch'), 'práh lze přepsat');
});

test('mySide null: detektory, které potřebují vědět, kdo jsme, nic nevrátí', () => {
  const tl = [
    snap('a', 20, { possession: 61, shots: 2, shotsOnTarget: 0, xg: 0.2 }, { shots: 5, xg: 0.9 }, { score: { home: 0, away: 1 } }),
    snap('b', 66, { possession: 63, shots: 3, shotsOnTarget: 0, xg: 0.3 }, { shots: 12, xg: 1.4 }, { score: { home: 0, away: 1 }, events: [redEvent('away', 60)] }),
  ];
  assert.ok(A.detectProblems(tl, { mySide: 'home' }).length >= 3);
  for (const side of [null, undefined, 'sideways', 7]) {
    const kindsFound = kinds(A.detectProblems(tl, { mySide: side }));
    assert.deepEqual(kindsFound, ['red_card'], String(side));
  }
  const summary = A.summarizeMatch(tl, [{ id: 'c', minute: 30, recheckAfterMinutes: 10 }], { mySide: null });
  assert.ok(summary.notes.some((n) => /Strana uživatele/.test(n) && /nic nehodnotily/.test(n)));
  assert.equal(summary.changes[0].evaluation.status, 'insufficient_data');
});

// ------------------------------------------------------------------ findingsToObservations
test('findingsToObservations: pozorování s heuristic_coach, kompatibilní s core.normalizeObservations', () => {
  const tl = [
    snap('a', 20, { possession: 61, shots: 2, shotsOnTarget: 0, xg: 0.2 }, { shots: 5, xg: 0.9 }, { score: { home: 0, away: 1 } }),
    snap('b', 66, { possession: 63, shots: 3, shotsOnTarget: 0, xg: 0.3 }, { shots: 12, xg: 1.4 }, { score: { home: 0, away: 1 }, events: [redEvent('away', 60)] }),
  ];
  const findings = A.detectProblems(tl, { mySide: 'home' });
  assert.ok(findings.length >= 3);
  const obs = A.findingsToObservations(findings, { prefix: 'live' });
  assert.equal(obs.length, findings.length);
  obs.forEach((o, i) => {
    assert.equal(o.label, 'heuristic_coach');
    assert.equal(o.id, `live-${i + 1}`);
    assert.ok(Number.isInteger(o.minute));
    assert.equal(o.minute, findings[i].minute);
    assert.ok(o.text.includes(findings[i].title) && o.text.includes('Základ:') && o.text.length <= 1500);
    assert.equal(core.LABEL_TO_TIER[o.label], 'inferred', 'heuristika není silnější než inferred');
  });
  const normalized = core.normalizeObservations(obs);
  assert.equal(normalized.length, obs.length);
  assert.ok(A.findingsToObservations(findings)[0].id.startsWith('live-'));
  assert.doesNotThrow(() => core.normalizeObservations(A.findingsToObservations(findings, { prefix: 'zlé id!' })));
  assert.deepEqual(A.findingsToObservations([]), []);
  assert.deepEqual(A.findingsToObservations(undefined), []);
});

test('findingsToObservations: i ověřené snímky dávají štítek heuristic_coach, text říká, na čem stojí', () => {
  const verified = [
    snap('a', 20, { possession: 61, shots: 2, xg: 0.2 }, { shots: 5, xg: 0.9 }, { provenance: 'screenshot_verified' }),
    snap('b', 35, { possession: 63, shots: 3, xg: 0.3 }, { shots: 8, xg: 1.4 }, { provenance: 'screenshot_verified' }),
  ];
  const obsV = A.findingsToObservations(A.detectProblems(verified, { mySide: 'home' }));
  assert.ok(obsV.length > 0 && obsV.every((o) => o.label === 'heuristic_coach' && /ověřenými snímky/.test(o.text)));
  const obsU = A.findingsToObservations(A.detectProblems(verified.map((s) => ({ ...s, provenance: 'vision_unverified' })), { mySide: 'home' }));
  assert.ok(obsU.every((o) => /neověřeným čtením z obrazu/.test(o.text)));
});

// ------------------------------------------------------------------ evaluateChange
const CHANGE_TL = [
  snap('c30', 30, { possession: 55, shots: 3, shotsOnTarget: 1, xg: 0.3 }, { possession: 45, shots: 5, shotsOnTarget: 2, xg: 0.6 }),
  snap('c45', 45, { possession: 55, shots: 5, shotsOnTarget: 2, xg: 0.5 }, { possession: 45, shots: 9, shotsOnTarget: 4, xg: 1.2 }),
  snap('c50', 50, { possession: 56, shots: 7, shotsOnTarget: 3, xg: 0.9 }, { possession: 44, shots: 10, shotsOnTarget: 4, xg: 1.3 }),
  snap('c62', 62, { possession: 58, shots: 12, shotsOnTarget: 6, xg: 1.7 }, { possession: 42, shots: 11, shotsOnTarget: 4, xg: 1.5 }),
];
const CHANGE = { id: 'ch1', minute: 46, summary: 'Změna role', recheckAfterMinutes: 15 };
const NO_CAUSE = /způsob|kvůli změn|díky změn|zlepšil|zhoršil|vyplatil/i;

test('evaluateChange: dost dat → ready, před/po na 10 minut pro nás i soupeře, změna držení, popisné verdikty', () => {
  const r = A.evaluateChange(CHANGE_TL, CHANGE, { mySide: 'home' });
  assert.equal(r.status, 'ready');
  assert.equal(r.changeMinute, 46);
  assert.equal(r.recheckAfterMinutes, 15);
  assert.equal(r.before.minutes, 15);
  assert.deepEqual(r.before.snapshots, ['c30', 'c45']);
  assert.equal(r.before.basis, 'lookback');
  assert.equal(r.before.mine.shots, 1.333);
  assert.equal(r.before.opp.shots, 2.667);
  assert.equal(r.before.mine.xg, 0.133);
  assert.equal(r.before.opp.shotsOnTarget, 1.333);
  assert.equal(r.before.possessionChangePp, 0);
  assert.equal(r.after.minutes, 12);
  assert.deepEqual(r.after.snapshots, ['c50', 'c62']);
  assert.equal(r.after.mine.shots, 4.167);
  assert.equal(r.after.opp.shots, 0.833);
  assert.equal(r.after.mine.shotsOnTarget, 2.5);
  assert.equal(r.after.opp.shotsOnTarget, 0);
  assert.equal(r.after.possessionChangePp, 2);
  assert.equal(r.deltas.mine.shots.verdict, 'higher');
  assert.equal(r.deltas.mine.shots.diff, 2.834);
  assert.equal(r.deltas.opp.shots.verdict, 'lower');
  assert.equal(r.deltas.opp.shotsOnTarget.verdict, 'lower');
  assert.equal(r.deltas.mine.xg.verdict, 'higher');
  assert.deepEqual(r.deltas.possessionChangePp, { before: 0, after: 2, diff: 2, verdict: 'higher' });
  assert.ok(r.notes.some((n) => /samotná změna/.test(n)), 'úsek mezi okny se nepočítá a je to řečeno');
  assert.ok(r.notes.some((n) => /jen popis rozdílu/.test(n)));
  assert.ok(r.notes.some((n) => /neověřen/.test(n) || /odhad z čtení obrazu/.test(n)));
  assert.equal(r.evidenceTier, 'inferred');
  assert.equal(r.causalityNote, A.CAUSALITY_NOTE);
  assert.match(r.causalityNote, /Časová souvislost není důkaz příčiny/);
  assert.doesNotMatch(allTexts(r), NO_CAUSE);
});

test('evaluateChange: nedostatek dat', () => {
  const insufficient = (tl, change = CHANGE, opts = { mySide: 'home' }) => A.evaluateChange(tl, change, opts);
  const none = insufficient(CHANGE_TL.slice(0, 2));
  assert.equal(none.status, 'insufficient_data');
  assert.equal(none.before, null);
  assert.equal(none.after, null);
  assert.equal(none.deltas, null);
  assert.match(none.notes.join(' '), /Po změně \(46\. min\) je zatím 0 min/);
  assert.equal(none.causalityNote, A.CAUSALITY_NOTE);

  const oneAfter = insufficient(CHANGE_TL.slice(0, 3));
  assert.equal(oneAfter.status, 'insufficient_data', 'po změně je jediný snímek');

  const five = insufficient([...CHANGE_TL.slice(0, 2), snap('x50', 50, { shots: 6 }, { shots: 9 }), snap('x55', 55, { shots: 7 }, { shots: 9 })]);
  assert.equal(five.status, 'insufficient_data');
  assert.match(five.notes.join(' '), /zatím 5 min.*aspoň 8/);

  const eight = insufficient([...CHANGE_TL.slice(0, 2), snap('x50', 50, { shots: 6 }, { shots: 9 }), snap('x58', 58, { shots: 7 }, { shots: 9 })]);
  assert.equal(eight.status, 'ready', 'přesně 8 minut stačí');
  const nine = insufficient([...CHANGE_TL.slice(0, 2), snap('x50', 50, { shots: 6 }, { shots: 9 }), snap('x57', 57, { shots: 7 }, { shots: 9 })], CHANGE, { mySide: 'home', minAfterMinutes: 6 });
  assert.equal(nine.status, 'ready', 'minAfterMinutes jde přepsat');

  const noBefore = insufficient(CHANGE_TL.slice(2));
  assert.equal(noBefore.status, 'insufficient_data');
  assert.match(noBefore.notes.join(' '), /Před změnou není žádný snímek/);

  assert.match(insufficient(CHANGE_TL, { id: 'x', recheckAfterMinutes: 10 }).notes.join(' '), /nemá zadanou minutu/);
  assert.match(insufficient(CHANGE_TL, CHANGE, { mySide: null }).notes.join(' '), /Není zadána strana uživatele/);
  assert.equal(insufficient(CHANGE_TL, CHANGE, {}).status, 'insufficient_data');
  assert.equal(insufficient([], CHANGE).status, 'insufficient_data');
  assert.equal(insufficient(CHANGE_TL, null).status, 'insufficient_data');
});

test('evaluateChange: podobné hodnoty jsou similar (pásmo ±15 %), roste/klesá je higher/lower', () => {
  const same = [
    snap('s30', 30, { possession: 50, shots: 3, shotsOnTarget: 1, xg: 0.3 }, { possession: 50, shots: 3, shotsOnTarget: 1, xg: 0.3 }),
    snap('s45', 45, { possession: 50, shots: 6, shotsOnTarget: 2, xg: 0.6 }, { possession: 50, shots: 6, shotsOnTarget: 2, xg: 0.6 }),
    snap('s50', 50, { possession: 50, shots: 7, shotsOnTarget: 2, xg: 0.7 }, { possession: 50, shots: 7, shotsOnTarget: 2, xg: 0.7 }),
    snap('s65', 65, { possession: 50, shots: 10, shotsOnTarget: 3, xg: 1 }, { possession: 50, shots: 10, shotsOnTarget: 3, xg: 1 }),
  ];
  const r = A.evaluateChange(same, CHANGE, { mySide: 'home' });
  assert.equal(r.status, 'ready');
  for (const side of ['mine', 'opp']) for (const metric of ['shots', 'shotsOnTarget', 'xg']) assert.equal(r.deltas[side][metric].verdict, 'similar', `${side}.${metric}`);
  assert.equal(r.deltas.possessionChangePp.verdict, 'similar');
  assert.doesNotMatch(allTexts(r), NO_CAUSE);

  // hranice pásma na xG: před 0,2 na 10 min, po 0,23 (+15 %) je still similar, 0,231 už higher; 0,17 (−15 %) similar, 0,169 lower
  const xgCase = (afterXg) => {
    const tl = [snap('b1', 30, { xg: 0 }, { xg: 0 }), snap('b2', 45, { xg: 0.3 }, { xg: 0 }), snap('a1', 50, { xg: 0.3 }, { xg: 0 }), snap('a2', 60, { xg: 0.3 + afterXg }, { xg: 0 })];
    return A.evaluateChange(tl, CHANGE, { mySide: 'home' }).deltas.mine.xg.verdict;
  };
  assert.equal(xgCase(0.23), 'similar');
  assert.equal(xgCase(0.231), 'higher');
  assert.equal(xgCase(0.17), 'similar');
  assert.equal(xgCase(0.169), 'lower');
  assert.equal(xgCase(0.2), 'similar');
  // z nuly: 0 → 0 je similar, 0 → něco je higher
  const zero = (afterShots) => {
    const tl = [snap('z1', 30, { shots: 0 }, { shots: 0 }), snap('z2', 45, { shots: 0 }, { shots: 0 }), snap('z3', 50, { shots: 0 }, { shots: 0 }), snap('z4', 60, { shots: afterShots }, { shots: 0 })];
    return A.evaluateChange(tl, CHANGE, { mySide: 'home' }).deltas.mine.shots.verdict;
  };
  assert.equal(zero(0), 'similar');
  assert.equal(zero(2), 'higher');
});

test('evaluateChange: poznámky říkají, jak malý je vzorek; okno před změnou může být od začátku zápasu', () => {
  const tiny = [
    snap('t1', 30, { shots: 0, xg: 0 }, { shots: 1, xg: 0.1 }),
    snap('t2', 45, { shots: 1, xg: 0.1 }, { shots: 1, xg: 0.1 }),
    snap('t3', 50, { shots: 1, xg: 0.1 }, { shots: 1, xg: 0.1 }),
    snap('t4', 58, { shots: 2, xg: 0.2 }, { shots: 1, xg: 0.1 }),
  ];
  const r = A.evaluateChange(tiny, CHANGE, { mySide: 'home' });
  assert.equal(r.status, 'ready');
  const text = r.notes.join('\n');
  assert.match(text, /Okno před změnou: střel obou týmů dohromady jen 1 \(malý vzorek/);
  assert.match(text, /Okno po změně: střel obou týmů dohromady jen 1 \(malý vzorek/);
  assert.match(text, /Okno po změně je krátké \(8 min\)/);
  assert.doesNotMatch(text, /Okno před změnou je krátké/, 'okno před změnou má přesně 15 minut, to ještě není krátké');

  const fallback = A.evaluateChange([snap('k44', 44, { shots: 4, shotsOnTarget: 1, xg: 0.4, possession: 52 }, { shots: 6, shotsOnTarget: 2, xg: 0.6, possession: 48 }), ...CHANGE_TL.slice(2)], CHANGE, { mySide: 'home' });
  assert.equal(fallback.status, 'ready');
  assert.equal(fallback.before.basis, 'kickoff');
  assert.equal(fallback.before.fromMinute, 0);
  assert.equal(fallback.before.toMinute, 44);
  assert.equal(fallback.before.mine.shots, 0.909);
  assert.equal(fallback.before.possessionChangePp, null);
  assert.equal(fallback.deltas.possessionChangePp.verdict, null);
  assert.match(fallback.notes.join(' '), /jako výchozí slouží tempo od začátku zápasu do 44\. min/);

  const early = A.evaluateChange(
    [snap('e8', 8, { shots: 1, xg: 0.1 }, { shots: 0, xg: 0 }), snap('e14', 14, { shots: 2, xg: 0.2 }, { shots: 1, xg: 0.1 }), snap('e24', 24, { shots: 5, xg: 0.6 }, { shots: 1, xg: 0.1 })],
    { id: 'early', minute: 10 },
    { mySide: 'home' }
  );
  assert.equal(early.status, 'ready');
  assert.equal(early.before.basis, 'kickoff');
  assert.ok(early.notes.every((n) => !/jako výchozí slouží/.test(n)), 'okno 20 minut zpět sahá k začátku zápasu, to není náhradní řešení');
});

test('evaluateChange: plánované vyhodnocení, konec okna u další změny a záporné rozdíly', () => {
  const late = A.evaluateChange(CHANGE_TL, { ...CHANGE, recheckAfterMinutes: 20 }, { mySide: 'home' });
  assert.match(late.notes.join(' '), /Plánované vyhodnocení bylo za 20 min po změně; poslední snímek je 16 min po ní/);
  assert.ok(!A.evaluateChange(CHANGE_TL, CHANGE, { mySide: 'home' }).notes.some((n) => /Plánované vyhodnocení/.test(n)));
  assert.equal(A.evaluateChange(CHANGE_TL, CHANGE, { mySide: 'home', untilMinute: 55 }).status, 'insufficient_data');
  assert.equal(A.evaluateChange(CHANGE_TL, CHANGE, { mySide: 'home', untilMinute: 62 }).after.toMinute, 62);
  assert.equal(A.evaluateChange(CHANGE_TL, CHANGE, { mySide: 'home', lookbackMinutes: 10 }).before.basis, 'kickoff', 'okno 10 minut zpět nemá dva snímky: náhradní okno od začátku');
  const bad = [CHANGE_TL[0], CHANGE_TL[1], snap('d50', 50, { shots: 6 }, { shots: 10 }), snap('d62', 62, { shots: 9 }, { shots: 9 })];
  const r = A.evaluateChange(bad, CHANGE, { mySide: 'home' });
  assert.equal(r.status, 'ready');
  assert.equal(r.after.opp.shots, null, 'kumulativní hodnota soupeře klesla: tempo se nepočítá');
  assert.equal(r.deltas.opp.shots.verdict, null);
  assert.match(r.notes.join(' '), /away\.shots: kumulativní hodnota klesla/);
});

test('evaluateChange: ověřené snímky dávají evidenceTier observed', () => {
  const verified = CHANGE_TL.map((s) => ({ ...s, provenance: 'screenshot_verified' }));
  const r = A.evaluateChange(verified, CHANGE, { mySide: 'home' });
  assert.equal(r.evidenceTier, 'observed');
  assert.ok(!r.notes.some((n) => /nejsou všechny ověřené/.test(n)));
  const mixed = [...verified.slice(0, 3), { ...verified[3], provenance: 'vision_unverified' }];
  assert.equal(A.evaluateChange(mixed, CHANGE, { mySide: 'home' }).evidenceTier, 'inferred');
});

// ------------------------------------------------------------------ summarizeMatch
const MATCH_TL = () =>
  [10, 20, 30, 40, 50, 60].map((m, i) =>
    snap(`m${m}`, m, { possession: 55, shots: 2 * (i + 1), shotsOnTarget: i + 1, xg: 0.3 * (i + 1) }, { possession: 45, shots: i + 2, shotsOnTarget: i, xg: 0.2 * (i + 1) }, {
      score: m >= 40 ? { home: 1, away: 0 } : { home: 0, away: 0 },
      events: m >= 40 ? [{ minute: 35, type: 'goal', team: 'home', text: 'Gól' }] : [],
    })
  );

test('summarizeMatch: období, součty, změny s vyhodnocením a poznámky', () => {
  const changes = [
    { id: 'c2', minute: 45, summary: 'Druhá změna', recheckAfterMinutes: 10 },
    { id: 'c1', minute: 25, summary: 'První změna', recheckAfterMinutes: 10 },
  ];
  const s = A.summarizeMatch(MATCH_TL(), changes, { mySide: 'home' });
  assert.deepEqual(s.periods.map((p) => [p.fromMinute, p.toMinute]), [[0, 15], [15, 30], [30, 45], [45, 60]]);
  assert.ok(s.periods.every((p) => p.stats !== null));
  assert.equal(s.periods[0].stats.kickoff, true);
  assert.equal(s.periods[1].stats.mine.totals.shots, 2);
  assert.equal(s.totals.snapshots, 6);
  assert.equal(s.totals.lastMinute, 60);
  assert.deepEqual(s.totals.score, { home: 1, away: 0, minute: 60 });
  assert.equal(s.totals.stats.minutes, 60);
  assert.equal(s.totals.stats.mine.totals.shots, 12);
  assert.equal(s.totals.events.goal, 1, 'událost opakovaná ve více snímcích se počítá jednou');
  assert.deepEqual(s.totals.provenance, { vision_unverified: 6 });
  assert.equal(s.totals.evidenceTier, 'inferred');
  assert.deepEqual(s.changes.map((c) => c.id), ['c1', 'c2'], 'změny podle minuty');
  assert.ok(s.changes.every((c) => c.evaluation.status === 'ready'));
  assert.equal(s.changes[0].evaluation.after.toMinute, 40, 'okno po první změně končí u druhé změny');
  assert.equal(s.changes[1].evaluation.after.toMinute, 60);
  assert.equal(s.changes[0].summary, 'První změna');
  assert.ok(s.notes.some((n) => /6 z 6 snímků je neověřené čtení z obrazu/.test(n)));
  assert.ok(!s.notes.some((n) => /xG/.test(n)));
  assert.ok(Array.isArray(s.findings));
  assert.equal(s.causalityNote, A.CAUSALITY_NOTE);
  assert.doesNotMatch(allTexts(s), NO_CAUSE);
  assert.equal(A.summarizeMatch(MATCH_TL(), [], { mySide: 'home', windowMinutes: 30 }).periods.length, 2);
});

test('summarizeMatch: chybějící data jsou v poznámkách, nic se nehádá', () => {
  const empty = A.summarizeMatch([], [], { mySide: 'home' });
  assert.deepEqual(empty.periods, []);
  assert.equal(empty.totals.stats, null);
  assert.equal(empty.totals.score, null);
  assert.equal(empty.totals.lastMinute, null);
  assert.ok(empty.notes.some((n) => /Časová osa je prázdná/.test(n)));
  assert.ok(empty.notes.some((n) => /žádná změna taktiky/.test(n)));
  assert.deepEqual(A.summarizeMatch(undefined, undefined).changes, []);

  const sparse = [MATCH_TL()[0], MATCH_TL()[1], MATCH_TL()[5], A.makeSnapshot({ id: 'nm', at: 5, minute: null, stats: { home: { shots: 1 } } })];
  const s = A.summarizeMatch(sparse, [{ id: 'c', minute: 30, recheckAfterMinutes: 10 }, { id: 'nm', minute: null }], { mySide: 'home' });
  assert.deepEqual(s.periods.map((p) => p.stats !== null), [true, false, false, false]);
  assert.ok(s.notes.some((n) => /obdobích 15–30, 30–45, 45–60 min nejsou aspoň dva snímky/.test(n)));
  assert.ok(s.notes.some((n) => /1 snímků nemá přečtenou minutu/.test(n)));
  assert.equal(s.changes.length, 2);
  assert.ok(s.changes.every((c) => c.evaluation.status === 'insufficient_data'));
  assert.ok(s.notes.some((n) => /Změna v 30\. min: Po změně/.test(n)));
  assert.ok(s.notes.some((n) => /Změna bez minuty: Změna nemá zadanou minutu/.test(n)));

  const noXg = [snap('a', 20, { shots: 3 }, { shots: 4 }), snap('b', 40, { shots: 6 }, { shots: 5 })];
  assert.ok(A.summarizeMatch(noXg, [], { mySide: 'home' }).notes.some((n) => /Na žádném snímku nebylo xG/.test(n)));
  const noStats = A.summarizeMatch([A.makeSnapshot({ id: 'ns', at: 1, minute: 30, screen: 'tactics' })], [], { mySide: 'home' });
  assert.ok(noStats.notes.some((n) => /Žádný snímek neobsahuje statistiky/.test(n)));
  const verified = A.summarizeMatch(MATCH_TL().map((x) => ({ ...x, provenance: 'user_entered' })), [], { mySide: 'home' });
  assert.equal(verified.totals.evidenceTier, 'observed');
  assert.ok(!verified.notes.some((n) => /neověřené čtení/.test(n)));
});

// ------------------------------------------------------------------ downscaleGray, frameDiff
test('downscaleGray: průměr bloků ve stupních šedi', () => {
  // 2×2 → 1×1: černá, bílá, červená, modrá (váhy 0,299 / 0,587 / 0,114)
  const px = [0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255];
  assert.deepEqual([...A.downscaleGray(px, 2, 2, 1, 1)], [90]);
  // 4×2 → 2×1: levá půlka černá, pravá bílá
  const bw = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) bw.push(...(x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.deepEqual([...A.downscaleGray(bw, 4, 2, 2, 1)], [0, 255]);
  // šedá stupnice 4×4 → 2×2
  const ramp = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ramp.push(x * 60, x * 60, x * 60, 255);
  assert.deepEqual([...A.downscaleGray(ramp, 4, 4, 2, 2)], [30, 150, 30, 150]);
  // bloky o nestejné velikosti: 3×1 → 2×1 dává [10, 25]
  const odd = [10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255];
  assert.deepEqual([...A.downscaleGray(odd, 3, 1, 2, 1)], [10, 25]);
  // zvětšení nevyrobí prázdné bloky
  assert.deepEqual([...A.downscaleGray([100, 100, 100, 255], 1, 1, 2, 2)], [100, 100, 100, 100]);
  // průhlednost se nebere v úvahu, výstup je Uint8Array správné délky, Uint8ClampedArray z canvasu jde také
  const out = A.downscaleGray(new Uint8ClampedArray([200, 200, 200, 0]), 1, 1, 1, 1);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual([...out], [200]);
  assert.equal(A.downscaleGray(new Uint8Array(8 * 6 * 4), 8, 6, 4, 3).length, 12);
  // špatné vstupy jsou chyba programátora
  assert.throws(() => A.downscaleGray([0, 0, 0, 255], 0, 1, 1, 1), RangeError);
  assert.throws(() => A.downscaleGray([0, 0, 0, 255], 1, 1, 1.5, 1), RangeError);
  assert.throws(() => A.downscaleGray([0, 0, 0], 1, 1, 1, 1), RangeError);
  assert.throws(() => A.downscaleGray(null, 1, 1, 1, 1), RangeError);
});

test('frameDiff: 0 až 1, různé délky jsou 1', () => {
  assert.equal(A.frameDiff(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), 0);
  assert.equal(A.frameDiff(new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 255, 255, 255])), 1);
  assert.equal(A.frameDiff(new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 255, 0, 0])), 0.5);
  assert.equal(A.frameDiff([0, 100], [51, 100]), 0.1);
  assert.equal(A.frameDiff(new Uint8Array(3), new Uint8Array(4)), 1);
  assert.equal(A.frameDiff(null, new Uint8Array(3)), 1);
  assert.equal(A.frameDiff(undefined, undefined), 1);
  assert.equal(A.frameDiff(new Uint8Array(0), new Uint8Array(0)), 0);
  assert.equal(A.frameDiff(new Uint8Array([10, 200]), new Uint8Array([200, 10])), A.frameDiff(new Uint8Array([200, 10]), new Uint8Array([10, 200])), 'symetrie');
});

// ------------------------------------------------------------------ brána snímků
const flat = (v, n = 64) => new Uint8Array(n).fill(v);

test('brána: first, too_soon, unchanged, unsettled a changed na syntetických polích', () => {
  const g = A.createFrameGate();
  assert.deepEqual(g.check(flat(100), 0), { process: true, reason: 'first', diff: null, intervalMs: 15000 });
  const soon = g.check(flat(100), 5000);
  assert.deepEqual([soon.process, soon.reason, soon.diff], [false, 'too_soon', 0]);
  const same = g.check(flat(100), 20000);
  assert.deepEqual([same.process, same.reason, same.diff], [false, 'unchanged', 0]);
  // obrazovka se přepíná: první snímek nového obsahu se liší od předchozího viděného → čekáme
  const mid = g.check(flat(200), 21000);
  assert.equal(mid.process, false);
  assert.equal(mid.reason, 'unsettled');
  assert.ok(Math.abs(mid.diff - 100 / 255) < 1e-9, 'u unsettled je diff proti předchozímu viděnému snímku');
  // druhý snímek téhož nového obsahu: ustálené a změněné proti poslednímu zpracovanému
  const done = g.check(flat(200), 22000);
  assert.equal(done.process, true);
  assert.equal(done.reason, 'changed');
  assert.ok(Math.abs(done.diff - 100 / 255) < 1e-9, 'u changed je diff proti poslednímu zpracovanému snímku');
  assert.equal(g.check(flat(200), 23000).reason, 'too_soon', 'odstup se počítá od posledního zpracování');
  assert.equal(g.check(flat(200), 38000).reason, 'unchanged');
});

test('brána: přepnutí tam a zpátky je unchanged, ne unsettled (unsettled jen u snímku, který by se zpracoval)', () => {
  const g = A.createFrameGate();
  g.check(flat(50), 0);
  assert.equal(g.check(flat(220), 20000).reason, 'unsettled', 'jiná obrazovka, předchozí viděný snímek byl jiný');
  const back = g.check(flat(50), 21000); // zpátky na zpracovaný obsah, ale předchozí viděný snímek byl jiný
  assert.equal(back.reason, 'unchanged');
  assert.equal(back.diff, 0);
});

test('brána: malé změny pod minDiff se nezpracují, mírnější změny se po ustálení zpracují', () => {
  const g = A.createFrameGate();
  g.check(flat(100), 0);
  const tiny = g.check(flat(101), 20000); // 1/255 ≈ 0,004 < minDiff 0,02 (a pod settleDiff 0,01)
  assert.equal(tiny.reason, 'unchanged');
  const first = g.check(flat(106), 40000); // 6/255 ≈ 0,024: proti předchozímu viděnému (101) 5/255 ≈ 0,02 > settleDiff
  assert.equal(first.reason, 'unsettled');
  assert.equal(g.check(flat(106), 41000).reason, 'changed');
  const custom = A.createFrameGate({ minDiff: 0.5 });
  custom.check(flat(0), 0);
  custom.check(flat(100), 20000); // unsettled
  assert.equal(custom.check(flat(100), 21000).reason, 'unchanged', 'změna 0,39 je pod vlastním minDiff 0,5');
});

test('brána: rozpočet na zápas a na hodinu, hlásí se jen u snímku, který by se jinak zpracoval', () => {
  const A0 = flat(0);
  const B255 = flat(255);
  const match = A.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 1000, maxPerMatch: 2 });
  assert.equal(match.check(A0, 0).reason, 'first');
  assert.equal(match.check(B255, 2000).reason, 'unsettled');
  assert.equal(match.check(B255, 3000).reason, 'changed');
  assert.equal(match.check(A0, 4000).reason, 'unsettled');
  const over = match.check(A0, 5000);
  assert.deepEqual([over.process, over.reason], [false, 'budget_match']);
  assert.equal(match.check(A0, 6000).reason, 'budget_match', 'dokud se obsah liší od posledního zpracovaného, hlásí se rozpočet');
  const st = match.stats();
  assert.equal(st.processed, 2);
  assert.equal(st.skipped.budget_match, 2);
  assert.equal(st.perMatch, 2);
  assert.equal(st.limits.perMatch, 2);

  const hour = A.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 1000, maxPerHour: 2 });
  hour.check(A0, 0);
  hour.check(B255, 2000);
  assert.equal(hour.check(B255, 3000).reason, 'changed');
  hour.check(A0, 4000);
  assert.equal(hour.check(A0, 5000).reason, 'budget_hour');
  assert.equal(hour.stats().perHour, 2);
  // po uplynutí hodiny se rozpočet uvolní (klouzavé okno)
  const later = hour.check(A0, 3_700_000);
  assert.deepEqual([later.process, later.reason], [true, 'changed']);
  assert.equal(hour.stats().perHour, 1);

  const zero = A.createFrameGate({ maxPerMatch: 0 });
  assert.equal(zero.check(A0, 0).reason, 'budget_match', 'ani první snímek nepřekročí nulový rozpočet');

  const unchanged = A.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 1000, maxPerMatch: 1 });
  unchanged.check(A0, 0);
  assert.equal(unchanged.check(A0, 5000).reason, 'unchanged', 'u nezměněného snímku je důvod unchanged, ne rozpočet');
});

test('brána: adaptivní interval (důležité ×0,6 nejméně minIntervalMs, dvě zpracování bez nálezu ×1,5 nejvýš maxIntervalMs)', () => {
  const g = A.createFrameGate();
  assert.equal(g.stats().intervalMs, 15000);
  const seq = [];
  for (let i = 0; i < 4; i++) {
    g.noteResult({ important: true });
    seq.push(g.stats().intervalMs);
  }
  assert.deepEqual(seq, [9000, 5400, 5000, 5000]);

  const q = A.createFrameGate();
  const grow = [];
  for (let i = 0; i < 4; i++) {
    q.noteResult({ important: false });
    grow.push(q.stats().intervalMs);
  }
  assert.deepEqual(grow, [15000, 22500, 22500, 33750], 'prodlouží se po každých dvou klidných zpracováních');
  for (let i = 0; i < 40; i++) q.noteResult({});
  assert.equal(q.stats().intervalMs, 120000);

  const mixed = A.createFrameGate();
  mixed.noteResult({ important: false });
  mixed.noteResult({ important: true }); // důležité vynuluje počítadlo klidu
  assert.equal(mixed.stats().intervalMs, 9000);
  mixed.noteResult({ important: false });
  assert.equal(mixed.stats().intervalMs, 9000);
  mixed.noteResult(null);
  assert.equal(mixed.stats().intervalMs, 13500);

  // nový odstup se hned používá
  const t = A.createFrameGate();
  t.check(flat(0), 0);
  t.noteResult({ important: true });
  assert.equal(t.check(flat(0), 8000).reason, 'too_soon');
  const ok = t.check(flat(0), 9000);
  assert.equal(ok.reason, 'unchanged');
  assert.equal(ok.intervalMs, 9000);
  const own = A.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 2000, maxIntervalMs: 3000 });
  assert.equal(own.stats().intervalMs, 2000, 'výchozí odstup se vejde mezi min a max');
  own.noteResult({});
  own.noteResult({});
  own.noteResult({});
  own.noteResult({});
  assert.equal(own.stats().intervalMs, 3000);
});

test('brána: pauza a pokračování', () => {
  const g = A.createFrameGate();
  g.check(flat(0), 0);
  g.pause();
  assert.deepEqual(g.check(flat(255), 20000), { process: false, reason: 'paused', diff: null, intervalMs: 15000 });
  assert.equal(g.check(flat(255), 21000).reason, 'paused');
  assert.equal(g.stats().paused, true);
  assert.equal(g.stats().skipped.paused, 2);
  g.resume();
  assert.equal(g.stats().paused, false);
  const r = g.check(flat(255), 40000);
  assert.deepEqual([r.process, r.reason], [true, 'changed'], 'po pauze se první snímek neporovnává se zastaralým předchozím');
  assert.equal(g.stats().processed, 2);
  const fresh = A.createFrameGate();
  fresh.pause();
  assert.equal(fresh.check(flat(0), 0).reason, 'paused', 'ani první snímek se při pauze nezpracuje');
  fresh.resume();
  assert.equal(fresh.check(flat(0), 1000).reason, 'first');
});

test('brána: stats(), čas jen přes parametr nebo opts.now, brána si snímek kopíruje a je deterministická', () => {
  const g = A.createFrameGate({ maxPerHour: 7, maxPerMatch: 9 });
  assert.deepEqual(g.stats(), { processed: 0, skipped: {}, intervalMs: 15000, perHour: 0, perMatch: 0, paused: false, limits: { perHour: 7, perMatch: 9 } });
  g.check(flat(0), 0);
  g.check(flat(0), 1000);
  g.check(flat(0), 2000);
  const st = g.stats();
  assert.equal(st.processed, 1);
  assert.deepEqual(st.skipped, { too_soon: 2 });
  assert.equal(st.perHour, 1);
  st.skipped.too_soon = 99;
  assert.equal(g.stats().skipped.too_soon, 2, 'stats() vrací kopii');

  assert.throws(() => A.createFrameGate().check(flat(0)), TypeError);
  assert.throws(() => A.createFrameGate().check(flat(0), NaN), TypeError);
  let clock = 0;
  const timed = A.createFrameGate({ now: () => clock });
  assert.equal(timed.check(flat(0)).reason, 'first');
  clock = 20000;
  assert.equal(timed.check(flat(0)).reason, 'unchanged');
  assert.equal(timed.check(flat(0), 40000).reason, 'unchanged', 'explicitní čas má přednost');

  const buf = flat(0);
  const copy = A.createFrameGate();
  copy.check(buf, 0);
  buf.fill(255); // volající přepíše svůj buffer; brána si pamatuje původní obsah
  assert.equal(copy.check(flat(0), 20000).reason, 'unchanged');

  const frames = [0, 0, 255, 255, 255, 0, 40, 40, 40, 255];
  const run = () => {
    const gate = A.createFrameGate({ baseIntervalMs: 3000, minIntervalMs: 1000 });
    return frames.map((v, i) => {
      const r = gate.check(flat(v), i * 2000);
      if (r.process) gate.noteResult({ important: i % 2 === 0 });
      return r;
    });
  };
  assert.deepEqual(run(), run());
  assert.ok(run().some((r) => r.process) && run().some((r) => !r.process));
});

test('brána s opravdovým zmenšením: stejná obrazovka se nezpracuje, jiná ano', () => {
  const screen = (w, h, paint) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = paint(x, y);
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    return rgba;
  };
  const W = 64;
  const H = 36;
  const match = screen(W, H, (x, y) => (y < 8 ? 30 : x < 32 ? 90 : 160));
  const clockTick = screen(W, H, (x, y) => (y < 8 ? 30 : x < 32 ? 90 : x === 63 && y === 35 ? 0 : 160)); // změní se jeden pixel
  const tactics = screen(W, H, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? 220 : 40);
  const g = A.createFrameGate();
  const small = (rgba) => A.downscaleGray(rgba, W, H, 16, 9);
  assert.equal(g.check(small(match), 0).reason, 'first');
  assert.equal(g.check(small(clockTick), 20000).reason, 'unchanged', 'jeden pixel (hodiny) není změna obrazovky');
  assert.equal(g.check(small(tactics), 40000).reason, 'unsettled');
  assert.equal(g.check(small(tactics), 41000).reason, 'changed');
});

test('brána: obrazovka, která se hýbe pořád, se po několika čekáních zpracuje i tak', () => {
  const g = A.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 1000 });
  assert.equal(g.check(flat(0), 0).reason, 'first');
  const frames = [100, 160, 100, 160, 100];
  const reasons = frames.map((v, i) => g.check(flat(v), 2000 + i * 1500).reason);
  assert.deepEqual(reasons, ['unsettled', 'unsettled', 'unsettled', 'unsettled', 'changed']);
  assert.equal(g.stats().processed, 2);
  // po zpracování se počítání čekání vynuluje
  assert.equal(g.check(flat(160), 20000).reason, 'unsettled');
});

test('brána: pohybující se obrazovka bez skutečné změny se nezpracuje (unchanged má přednost po vyčerpání čekání)', () => {
  const g = A.createFrameGate({ baseIntervalMs: 1000, minIntervalMs: 1000, maxUnsettled: 1 });
  g.check(flat(100), 0);
  assert.equal(g.check(flat(103), 2000).reason, 'unchanged', 'pod settleDiff, jen drobný šum');
  g.check(flat(115), 4000); // unsettled
  assert.equal(g.check(flat(100), 6000).reason, 'unchanged', 'po vyčerpání čekání se zpracuje jen skutečná změna');
});
