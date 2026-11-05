import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ML = require('../src/matchlens.js');
const TI = require('../src/tableimport.js');
const AN = require('../src/analysis.js');

// ---------------------------------------------------------------- zkušební odpovědi ve tvaru, který plugin podle svého zdrojového kódu posílá (camelCase)
const INT_KEYS = ['goals', 'shots', 'shotsOnTarget', 'shotsOffTarget', 'blockedShots', 'clearCutChances', 'passes', 'passesCompleted', 'crosses', 'crossesCompleted', 'aerials', 'aerialsWon', 'progressivePasses', 'finalThirdPasses', 'tacklesAttempted', 'tacklesWon', 'fouls', 'corners', 'offsides', 'yellowCards', 'redCards', 'firstHalfShots', 'secondHalfShots'];
const team = (over) => Object.assign(Object.fromEntries(INT_KEYS.map((k) => [k, 0])), { xg: 0, possessionTime: 0 }, over);
const player = (over) => Object.assign({ slot: 0, playerId: 5000, team: 'home', isBallHolder: false, x: 12.5, y: -3, speedCentimetersPerSecond: 300, angleDegrees: 90, rating: 6.8, isSubstitute: false, isOnPitch: true, savesHeld: 0, savesParried: 0, savesTipped: 0, goals: 0, assists: 0, xg: 0.1, ratingInputs: { statsPacked: 'AAAA' } }, over);
const frame = (over) =>
  Object.assign(
    {
      sequence: 120,
      matchId: 'match-1',
      tick: 16200,
      displayTick: 16200, // 67,5 minuty
      period: 2,
      possessionTeam: 'home',
      home: team({ goals: 2, xg: 1.8449, possessionTime: 9000, shots: 11, shotsOnTarget: 5, passes: 300, passesCompleted: 255, tacklesWon: 9, tacklesAttempted: 14, fouls: 7, corners: 4, offsides: 1, yellowCards: 1 }),
      away: team({ goals: 1, xg: 0.62, possessionTime: 3000, shots: 5, shotsOnTarget: 2, passes: 100, passesCompleted: 70, tacklesWon: 12, fouls: 10, corners: 1, redCards: 0 }),
      players: [
        player({ slot: 0, team: 'home', rating: 7.4 }),
        player({ slot: 1, team: 'home', rating: 6.1, savesHeld: 2, savesParried: 1, savesTipped: 0 }),
        player({ slot: 2, team: 'home', rating: 0, isOnPitch: true }),
        player({ slot: 3, team: 'home', rating: 6.5, isOnPitch: false, isSubstitute: true }),
        player({ slot: 20, team: 'away', rating: 7.9, savesHeld: 3, savesParried: 0, savesTipped: 1 }),
      ],
      ratingModel: { ratingBaseCondition: 1, activeBaseline: 600 },
    },
    over
  );

const SECRET_CA = 9876;
const SECRET_PA = 8765;
const meta = (over) =>
  Object.assign(
    {
      matchId: 'match-1',
      home: { uid: 1, name: 'Chelsea', manager: { firstName: 'Jan', secondName: 'Novák', isHumanControlled: true } },
      away: { uid: 2, name: 'Arsenal', manager: { firstName: 'Mikel', secondName: 'Arteta', isHumanControlled: false } },
      competition: { name: 'Premier League' },
      players: [
        {
          slot: 0,
          playerId: 5001,
          uid: 5001,
          team: 'home',
          shirtNumber: 9,
          position: 'ST',
          displayName: 'Jan Novák',
          profile: { currentAbility: SECRET_CA, potentialAbility: SECRET_PA, weeklyWage: 123456, morale: 14, condition: 90 },
          attributes: { technical: { Finishing: 16, Passing: 11 }, mental: { Vision: 12, Consistency: 17, 'Important Matches': 15 }, physical: { Pace: 15 }, goalkeeping: { Reflexes: 2 }, traits: 'x' },
          inPossession: { positionMask: 4096, position: 'ST', roleDuty: '123', role: 'Advanced Forward', roleAbbreviation: 'AF', duty: 'Attack' },
          outOfPossession: { position: 'ST', role: 'Central Defender', roleAbbreviation: 'CD', duty: 'Defend' },
        },
        { slot: 1, team: 'home', shirtNumber: 1, position: 'GK', displayName: 'Petr Brankář', attributes: { goalkeeping: { Reflexes: 15, Handling: 14 } }, inPossession: { position: 'GK', role: 'Sweeper Keeper', roleAbbreviation: 'SK', duty: 'Support' } },
        { slot: 3, team: 'home', shirtNumber: 14, position: 'MC', displayName: 'Karel Lavička', attributes: { technical: { Passing: 13 } } },
        { slot: 20, team: 'away', shirtNumber: 7, position: 'AMR', displayName: 'Bukayo Saka' },
      ],
    },
    over
  );

// ---------------------------------------------------------------- adresa
test('cleanBaseUrl: prázdné = výchozí adresa; bez schématu se doplní http; cesta, dotaz a pomlčky pryč', () => {
  assert.deepEqual(ML.cleanBaseUrl(''), { ok: true, url: 'http://127.0.0.1:16726' });
  assert.deepEqual(ML.cleanBaseUrl(undefined), { ok: true, url: 'http://127.0.0.1:16726' });
  assert.equal(ML.cleanBaseUrl('127.0.0.1:16726').url, 'http://127.0.0.1:16726');
  assert.equal(ML.cleanBaseUrl('  localhost:5000/api/health?x=1#a ').url, 'http://localhost:5000');
  assert.equal(ML.cleanBaseUrl('http://LOCALHOST:7000/').url, 'http://localhost:7000');
  assert.equal(ML.cleanBaseUrl('http://[::1]:16726').url, 'http://[::1]:16726');
  assert.equal(ML.cleanBaseUrl('127.1:16726').url, 'http://127.0.0.1:16726'); // zkrácený zápis prohlížeč sám převede
});

test('cleanBaseUrl: jen tento počítač a jen http; cizí servery, místní síť, přihlašovací údaje a podvržené názvy se odmítnou', () => {
  const bad = ['https://127.0.0.1:16726', 'http://192.168.1.20:16726', 'http://10.0.0.5:16726', 'http://example.com:16726', 'http://localhost.evil.com:16726', 'http://127.0.0.1.evil.com:16726', 'http://user:pw@127.0.0.1:16726', 'ftp://127.0.0.1', 'http://127.0.0.1:99999', 'http://', 'ahoj svete', 'javascript:alert(1)', 'http://0.0.0.0:16726', 'http://[fe80::1]:16726'];
  for (const b of bad) {
    const r = ML.cleanBaseUrl(b);
    assert.equal(r.ok, false, b);
    assert.ok(r.error && r.error.length > 10, b);
  }
});

// ---------------------------------------------------------------- /api/health
test('parseHealth: správný plugin; cizí odpověď, neobjekt a chybějící části', () => {
  const h = ML.parseHealth({ status: 'live', name: 'FMMatchLens', pluginVersion: '0.7.1', game: 'Football Manager 27', gameVersion: '27.0.0', inMatch: true, tick: 100, frameCount: 99, webSocketConnections: 1, projectUrl: 'https://github.com/osnsyc/FMMatchLens' });
  assert.deepEqual(h, { ok: true, name: 'FMMatchLens', pluginVersion: '0.7.1', game: 'Football Manager 27', gameVersion: '27.0.0', status: 'live', inMatch: true, tick: 100, frameCount: 99 });
  assert.equal(ML.parseHealth({ name: 'Něco jiného', status: 'ok' }).ok, false);
  for (const x of [null, undefined, [], 'text', 5, true]) assert.equal(ML.parseHealth(x).ok, false);
  const w = ML.parseHealth({ name: 'FMMatchLens', inMatch: 'true', tick: -4, frameCount: 1.5 });
  assert.equal(w.ok, true);
  assert.equal(w.inMatch, false); // jen skutečné true
  assert.equal(w.tick, null);
  assert.equal(w.frameCount, null);
});

// ---------------------------------------------------------------- /api/match/current
test('parseFrame: minuta a sekunda z herního času (240 ticků na minutu), skóre, statistiky obou týmů a hráči', () => {
  const f = ML.parseFrame(frame());
  assert.equal(f.ok, true);
  assert.equal(f.minute, 67);
  assert.equal(f.second, 30);
  assert.equal(f.period, 2);
  assert.equal(f.possession, 'home');
  assert.equal(f.matchId, 'match-1');
  assert.equal(f.home.goals, 2);
  assert.equal(f.away.shots, 5);
  assert.equal(f.home.xg, 1.8449);
  assert.deepEqual(f.issues, []);
  assert.equal(f.players.length, 5);
  assert.equal(f.players[2].rating, null); // nula = hodnocení ještě není
  assert.equal(f.players[1].saves, 3);
  assert.equal(f.players[4].saves, 4);
});

test('parseFrame: bez displayTick se použije tick; mimo rozsah a nesmysly se nepřijmou a zapíšou do issues', () => {
  const noDisplay = frame();
  delete noDisplay.displayTick;
  noDisplay.tick = 2400;
  assert.equal(ML.parseFrame(noDisplay).minute, 10);
  const far = ML.parseFrame(frame({ displayTick: 240 * 200 }));
  assert.equal(far.minute, null);
  assert.ok(far.issues.some((i) => /mimo rozsah/.test(i)));
  const noClock = ML.parseFrame(frame({ displayTick: undefined, tick: undefined }));
  assert.equal(noClock.minute, null);
  assert.ok(noClock.issues.some((i) => /Chybí čas/.test(i)));
  const hostile = ML.parseFrame(frame({ home: team({ goals: '3', shots: -2, xg: 1e9, passes: 2.5, corners: null, possessionTime: 'x', fouls: Infinity }) }));
  assert.equal(hostile.ok, true);
  for (const k of ['goals', 'shots', 'xg', 'passes', 'corners', 'possessionTime', 'fouls']) assert.equal(hostile.home[k], null, k);
  assert.ok(hostile.issues.some((i) => /^Domácí: chybí/.test(i)));
});

test('parseFrame: neobjekty a chybějící týmy nejsou zápas; hráči s nesmyslem se zahodí; nic navíc se nepřebírá', () => {
  for (const x of [null, undefined, [], 'x', 3]) assert.equal(ML.parseFrame(x).ok, false);
  assert.equal(ML.parseFrame({ home: {} }).ok, false);
  assert.match(ML.parseFrame(null).error, /nehlásí/);
  const mixed = ML.parseFrame(frame({ players: [null, 'x', player({ slot: 'a' }), player({ team: 'nikdo' }), player({ slot: 5, team: 'away', rating: 14 }), player({ slot: 6, team: 'away', rating: 6.2 })] }));
  assert.equal(mixed.players.length, 2);
  assert.equal(mixed.players[0].rating, null); // 14 je mimo rozsah 0 až 10
  assert.equal(mixed.players[1].rating, 6.2);
  assert.deepEqual(Object.keys(mixed.players[1]).sort(), ['assists', 'goals', 'isOnPitch', 'isSubstitute', 'rating', 'saves', 'slot', 'team']);
  const noPlayers = ML.parseFrame(frame({ players: undefined }));
  assert.equal(noPlayers.ok, true);
  assert.ok(noPlayers.issues.some((i) => /seznam hráčů/.test(i)));
  // výstup nenese pozice ani vstupy hodnocení ani identifikátory
  const json = JSON.stringify(ML.parseFrame(frame()));
  for (const forbidden of ['ratingInputs', 'ratingModel', 'statsPacked', 'playerId', '"x"', '"y"', 'ballHolder']) assert.ok(!json.includes(forbidden), forbidden);
});

// ---------------------------------------------------------------- /api/match/meta
test('parseMeta: týmy, soutěž a tým řízený člověkem; skryté údaje a schopnosti se nikde neobjeví', () => {
  const m = ML.parseMeta(meta());
  assert.equal(m.ok, true);
  assert.equal(m.home.name, 'Chelsea');
  assert.equal(m.away.name, 'Arsenal');
  assert.equal(m.competition, 'Premier League');
  assert.equal(m.humanSide, 'home');
  assert.equal(m.home.manager.name, 'Jan Novák');
  assert.equal(m.players.length, 4);
  const json = JSON.stringify(m);
  for (const secret of [String(SECRET_CA), String(SECRET_PA), 'currentAbility', 'potentialAbility', 'weeklyWage', '123456', 'Consistency', 'Important Matches', 'morale']) assert.ok(!json.includes(secret), secret);
  const jan = m.players[0];
  assert.deepEqual(jan.attributes, { Finishing: 16, Passing: 11, Vision: 12, Pace: 15 }); // brankářský atribut Reflexes u hráče z pole se nebere
  assert.deepEqual(m.players[1].attributes, { Reflexes: 15, Handling: 14 });
  assert.deepEqual(jan.inPossession, { position: 'ST', role: 'Advanced Forward', roleAbbreviation: 'AF', duty: 'Attack' });
  assert.deepEqual(jan.outOfPossession, { position: 'ST', role: 'Central Defender', roleAbbreviation: 'CD', duty: 'Defend' });
  assert.equal(m.players[3].inPossession, null);
});

test('parseMeta: tým člověka se pozná jen když je právě jeden; neplatné atributy a hráči bez jména se zahodí', () => {
  const both = meta({ away: { name: 'Arsenal', manager: { isHumanControlled: true } } });
  assert.equal(ML.parseMeta(both).humanSide, null);
  const none = meta({ home: { name: 'Chelsea' }, away: { name: 'Arsenal' } });
  assert.equal(ML.parseMeta(none).humanSide, null);
  const away = meta({ home: { name: 'Chelsea', manager: { isHumanControlled: false } }, away: { name: 'Arsenal', manager: { isHumanControlled: true } } });
  assert.equal(ML.parseMeta(away).humanSide, 'away');
  const odd = ML.parseMeta(
    meta({
      players: [
        { slot: 1, team: 'home', displayName: 'A B', attributes: { technical: { Finishing: 0, Passing: 21, Dribbling: '15', Heading: 1.5, Marking: 14 } } },
        { slot: 2, team: 'home', displayName: '' },
        { slot: 3, team: 'cizi', displayName: 'C D' },
        'x',
        null,
      ],
    })
  );
  assert.equal(odd.players.length, 1);
  assert.deepEqual(odd.players[0].attributes, { Marking: 14 });
  for (const x of [null, undefined, [], 'x']) assert.equal(ML.parseMeta(x).ok, false);
  assert.equal(ML.parseMeta({ home: {}, away: {} }).ok, true);
  assert.ok(ML.parseMeta({ home: {}, away: {} }).issues.some((i) => /seznam hráčů/.test(i)));
});

test('parseMeta: atributy soupeře se zahodí (plugin čte přesné hodnoty, hra ukazuje u neznámých hráčů jen rozsahy); když není jasné, kdo je můj tým, neberou se žádné', () => {
  const both = meta({
    players: [
      { slot: 0, team: 'home', displayName: 'Můj Hráč', position: 'ST', attributes: { technical: { Finishing: 16 } } },
      { slot: 20, team: 'away', displayName: 'Cizí Hráč', position: 'ST', attributes: { technical: { Finishing: 18 } } },
    ],
  });
  const m = ML.parseMeta(both);
  assert.equal(m.humanSide, 'home');
  assert.deepEqual(m.players.find((p) => p.team === 'home').attributes, { Finishing: 16 });
  assert.deepEqual(m.players.find((p) => p.team === 'away').attributes, {});
  assert.ok(!JSON.stringify(m).includes('18'));
  const unknown = ML.parseMeta(Object.assign({}, both, { home: { name: 'A' }, away: { name: 'B' } }));
  assert.equal(unknown.humanSide, null);
  // bez poznaného týmu se neberou žádné atributy, takže ani omylem zvolená strana soupeře je neprozradí
  assert.ok(unknown.players.every((p) => Object.keys(p.attributes).length === 0));
  assert.ok(unknown.issues.some((i) => /nejde poznat, který tým je tvůj/.test(i)));
  const chosenWrong = ML.squadPlayers(unknown, 'away', null);
  assert.ok(chosenWrong.players.every((p) => Object.keys(p.attributes).length === 0));
});

test('parseMeta: neviditelné a řídicí znaky ve jménech se odstraní, jména se zkrátí', () => {
  const m = ML.parseMeta(meta({ home: { name: `Chel‮sea\u0000 ${'x'.repeat(200)}` }, players: [{ slot: 1, team: 'home', displayName: 'Jan​  Novák\n' }] }));
  assert.ok(!/[‮\u0000​\n]/.test(m.home.name + m.players[0].name));
  assert.ok(m.home.name.length <= 60);
  assert.equal(m.players[0].name, 'Jan Novák');
});

// ---------------------------------------------------------------- převod na snímek zápasu
test('toSnapshotFields: držení míče z podílu času, přesnost přihrávek, vyhrané souboje, zákroky brankářů, xG na dvě místa', () => {
  const f = ML.parseFrame(frame());
  const m = ML.parseMeta(meta());
  const s = ML.toSnapshotFields(f, m, { mySide: 'home' });
  assert.equal(s.minute, 67);
  assert.deepEqual(s.score, { home: 2, away: 1 });
  assert.equal(s.stats.home.possession, 75);
  assert.equal(s.stats.away.possession, 25);
  assert.equal(s.stats.home.passAccuracy, 85);
  assert.equal(s.stats.away.passAccuracy, 70);
  assert.equal(s.stats.home.tackles, 9);
  assert.equal(s.stats.home.xg, 1.84);
  assert.equal(s.stats.home.shotsOnTarget, 5);
  assert.equal(s.stats.home.saves, 3);
  assert.equal(s.stats.away.saves, 4);
  assert.deepEqual(s.teams, { home: 'Chelsea', away: 'Arsenal' });
  assert.equal(s.provenance, 'user_entered');
  assert.equal(s.via, 'fmmatchlens');
  assert.equal(s.screen, 'stats');
  assert.match(s.notes, /neověřen|nemohla ověřit/);
});

test('toSnapshotFields: hodnocení hráčů jen z mého týmu, jen ze hřiště a jen s jménem z metadat; bez strany nebo bez metadat žádní hráči', () => {
  const f = ML.parseFrame(frame());
  const m = ML.parseMeta(meta());
  const mine = ML.toSnapshotFields(f, m, { mySide: 'home' });
  assert.deepEqual(mine.players, [{ name: 'Jan Novák', rating: 7.4 }, { name: 'Petr Brankář', rating: 6.1 }]); // slot 2 bez hodnocení, slot 3 na lavičce, slot 20 je soupeř
  assert.deepEqual(ML.toSnapshotFields(f, m, { mySide: 'away' }).players, [{ name: 'Bukayo Saka', rating: 7.9 }]); // strana se určuje jen podle volby, žádný jiný hráč se nepřidá
  assert.deepEqual(ML.toSnapshotFields(f, m, {}).players, []);
  const noMeta = ML.toSnapshotFields(f, null, { mySide: 'home' });
  assert.deepEqual(noMeta.players, []);
  assert.equal(noMeta.teams, null);
});

test('toSnapshotFields: chybějící údaje zůstanou null, nic se nedopočítává; snímek z nich projde makeSnapshot a nese původ', () => {
  const empty = ML.parseFrame(frame({ home: team({ goals: 0, possessionTime: 0, passes: 0 }), away: team({ goals: 0, possessionTime: 0, passes: 0 }), players: [] }));
  const s = ML.toSnapshotFields(empty, null, {});
  assert.equal(s.stats.home.possession, null); // nikdo ještě nedržel míč: žádné dělení nulou
  assert.equal(s.stats.home.passAccuracy, null);
  assert.equal(s.stats.home.saves, null);
  const f = ML.parseFrame(frame());
  const fields = ML.toSnapshotFields(f, ML.parseMeta(meta()), { mySide: 'home' });
  const issues = [];
  const snap = AN.makeSnapshot(Object.assign({ id: 'snap-x', at: 1 }, fields), { issues });
  assert.deepEqual(issues, []);
  assert.equal(snap.provenance, 'user_entered');
  assert.equal(snap.via, 'fmmatchlens');
  assert.equal(snap.minute, 67);
  assert.equal(snap.stats.home.possession, 75);
  assert.equal(snap.players.length, 2);
  // snímek bez původu přes plugin žádné `via` nemá a model si ho nastavit nemůže
  assert.equal('via' in AN.makeSnapshot({ id: 's1', at: 1, minute: 3 }), false);
  assert.equal('via' in AN.makeSnapshot({ id: 's1', at: 1, minute: 3, via: 'jiny' }), false);
  const fromModel = AN.normalizeExtraction({ minute: 5, score: { home: 0, away: 0 }, via: 'fmmatchlens', provenance: 'user_entered' }, { id: 'snap-m', at: 2 });
  assert.equal(fromModel.snapshot.provenance, 'vision_unverified');
  assert.equal('via' in fromModel.snapshot, false);
});

// ---------------------------------------------------------------- kdy se dělá nový snímek
const st = (minute, score, reds, period) => ({ minute, score, reds: reds || [0, 0], period: period === undefined ? 1 : period });
const fr = (over) => ML.parseFrame(frame(over));

test('shouldRecord: první záznam, pak jen gól, červená, nová část, nebo uplynutí zadaných herních minut', () => {
  const f67 = fr();
  const first = ML.shouldRecord(null, f67, { everyMinutes: 3 });
  assert.deepEqual([first.record, first.reason], [true, 'first']);
  const prev = first.state;
  const same = ML.shouldRecord(prev, fr({ displayTick: 240 * 67 + 400 }), { everyMinutes: 3 });
  assert.deepEqual([same.record, same.reason], [false, 'none']);
  assert.equal(same.state, prev);
  const later = ML.shouldRecord(prev, fr({ displayTick: 240 * 70 }), { everyMinutes: 3 });
  assert.deepEqual([later.record, later.reason], [true, 'minutes']);
  const goal = ML.shouldRecord(prev, fr({ displayTick: 240 * 68, home: team({ goals: 3, possessionTime: 1 }) }), { everyMinutes: 10 });
  assert.deepEqual([goal.record, goal.reason], [true, 'goal']);
  const red = ML.shouldRecord(prev, fr({ displayTick: 240 * 68, away: team({ goals: 1, redCards: 1, possessionTime: 1 }) }), { everyMinutes: 10 });
  assert.deepEqual([red.record, red.reason], [true, 'red']);
  const period = ML.shouldRecord(prev, fr({ displayTick: 240 * 68, period: 3 }), { everyMinutes: 10 });
  assert.deepEqual([period.record, period.reason], [true, 'period']);
});

test('shouldRecord: čas zpět nebo nečitelný čas se nezaznamená; počet minut se omezí na 1 až 20; neznámé hodnoty nic nespouštějí', () => {
  const prev = ML.shouldRecord(null, fr(), {}).state;
  const back = ML.shouldRecord(prev, fr({ displayTick: 240 * 10 }), { everyMinutes: 3 });
  assert.deepEqual([back.record, back.reason], [false, 'clock_back']);
  const none = ML.shouldRecord(prev, fr({ displayTick: undefined, tick: undefined }), { everyMinutes: 3 });
  assert.deepEqual([none.record, none.reason], [false, 'no_clock']);
  const tiny = ML.shouldRecord(prev, fr({ displayTick: 240 * 68 }), { everyMinutes: 0 }); // 0 se zvedne na 1
  assert.equal(tiny.record, true);
  const huge = ML.shouldRecord(prev, fr({ displayTick: 240 * 87 }), { everyMinutes: 999 }); // 999 se sníží na 20
  assert.equal(huge.record, true);
  const unknownScore = ML.shouldRecord(st(60, null, [null, null], null), fr({ displayTick: 240 * 61, home: team({ goals: null }) }), { everyMinutes: 3 });
  assert.equal(unknownScore.record, false);
});

// ---------------------------------------------------------------- sestava
test('squadPlayers: jen jedna strana, náhradníci až na konci, role s míčem do sloupců, role bez míče do poznámky, skryté atributy žádné', () => {
  const m = ML.parseMeta(meta());
  const f = ML.parseFrame(frame());
  const r = ML.squadPlayers(m, 'home', f);
  assert.equal(r.count, 3);
  assert.deepEqual(r.players.map((p) => p.name), ['Petr Brankář', 'Jan Novák', 'Karel Lavička']); // podle čísla dresu, náhradník (slot 3 je v záznamu na lavičce) až poslední
  const jan = r.players[1];
  assert.deepEqual(jan.positions, ['ST']);
  assert.equal(jan.role, 'Advanced Forward');
  assert.equal(jan.duty, 'Attack');
  assert.equal(jan.age, null);
  assert.equal(jan.attributes.Finishing, 16);
  assert.ok(!('Consistency' in jan.attributes) && !('Important Matches' in jan.attributes) && !('Reflexes' in jan.attributes));
  assert.match(jan.notes, /Bez míče: Central Defender, Defend/);
  assert.match(r.players[2].notes, /náhradník/);
  assert.equal(r.players[0].attributes.Reflexes, 15);
  assert.equal(r.players[0].attributes.Finishing, undefined);
  const json = JSON.stringify(r);
  for (const secret of [String(SECRET_CA), String(SECRET_PA), 'currentAbility', 'weeklyWage', 'Consistency']) assert.ok(!json.includes(secret), secret);
  assert.equal(ML.squadPlayers(m, 'nikdo', f), null);
  assert.equal(ML.squadPlayers(null, 'home', f), null);
  assert.equal(ML.squadPlayers(ML.parseMeta(meta({ players: [] })), 'home', f), null);
  assert.equal(ML.squadPlayers(m, 'away', null).count, 1);
});

test('squadPlayers: jména už v soupisce a limit se vynechají a přiznají; neprosté pozice jdou do poznámky', () => {
  const m = ML.parseMeta(meta());
  const f = ML.parseFrame(frame());
  const again = ML.squadPlayers(m, 'home', f, { existingNames: ['jan novák', 'Petr Brankář'] });
  assert.deepEqual(again.players.map((p) => p.name), ['Karel Lavička']);
  assert.equal(again.skipped.existing, 2);
  assert.ok(again.issues.some((i) => /Už v soupisce jsou: 2/.test(i)));
  const limited = ML.squadPlayers(m, 'home', f, { max: 1 });
  assert.equal(limited.count, 1);
  assert.equal(limited.skipped.overLimit, 2);
  assert.ok(limited.issues.some((i) => /Nad limit 1 hráčů: 2/.test(i)));
  const odd = ML.parseMeta(meta({ players: [{ slot: 1, team: 'home', displayName: 'A B', position: 'D (RLC)' }] }));
  const r = ML.squadPlayers(odd, 'home', null);
  assert.deepEqual(r.players[0].positions, []);
  assert.match(r.players[0].notes, /Pozice v datech: D \(RLC\)/);
  assert.ok(r.issues.some((i) => /Pozice u 1 hráče není prostá zkratka/.test(i)));
});

// ---------------------------------------------------------------- diagnostika
test('diagnose: řádky o pluginu, zápase a záznamu; chyby se označí; nic nepadne na prázdných vstupech', () => {
  const lines = ML.diagnose(ML.parseHealth({ name: 'FMMatchLens', pluginVersion: '0.7.1', game: 'Football Manager 27', status: 'live', inMatch: true }), ML.parseMeta(meta()), ML.parseFrame(frame()));
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.ok));
  assert.match(lines[0].text, /FMMatchLens 0\.7\.1 odpovídá/);
  assert.match(lines[0].text, /je určený pro: Football Manager 27/);
  assert.match(lines[1].text, /Chelsea – Arsenal \(Premier League\).*tvůj tým podle hry: domácí/);
  assert.match(lines[2].text, /67\. minuta; skóre 2:1; xG 1\.84 : 0\.62/);
  const bad = ML.diagnose(ML.parseHealth(null), ML.parseMeta(null), ML.parseFrame(null));
  assert.equal(bad.length, 3);
  assert.ok(bad.every((l) => !l.ok));
  assert.deepEqual(ML.diagnose(null, null, null), []);
  // jiná služba na adrese: důvod se řekne, ne jen „neodpověděl“
  const other = ML.diagnose(ML.parseHealth({ name: 'Něco jiného' }), null, null);
  assert.equal(other.length, 1);
  assert.match(other[0].text, /něco jiného než FMMatchLens/);
});
