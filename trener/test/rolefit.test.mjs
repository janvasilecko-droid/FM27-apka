import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RF = require('../src/rolefit.js');

// ---------------------------------------------------------------- pomůcky
const mk = (name, key, pref, source) => {
  const r = RF.makeProfile({ name, key, pref, source: source || 'user' }, { now: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  return r.profile;
};
const player = (id, name, positions, attributes) => ({ id, name, positions, attributes });
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

// ---------------------------------------------------------------- názvy
test('attrKey: velikost písmen, mezery, interpunkce a diakritika nehrají roli', () => {
  const k = RF.attrKey('Off The Ball');
  for (const x of ['off the ball', 'OffTheBall', 'Off-the-Ball', ' off  the ball ', 'Off The Ball.']) assert.equal(RF.attrKey(x), k, x);
  assert.equal(RF.attrKey('Team Work'), RF.attrKey('Teamwork'));
  assert.equal(RF.attrKey('Zakončení'), 'zakonceni');
  assert.equal(RF.attrKey(''), '');
  assert.equal(RF.attrKey(null), '');
  assert.equal(RF.roleKey('Advanced Forward'), RF.roleKey('advanced   forward'));
});

// ---------------------------------------------------------------- profil role z obrazovky
test('normalizeRoleExtraction: návrh z obrazovky; názvy se berou jak jsou, skryté atributy a duplicity se vyřadí a přiznají', () => {
  const r = RF.normalizeRoleExtraction({ role: ' Advanced   Forward ', phase: 'S míčem', duty: 'Attack', key: ['Finishing', 'Off The Ball', 'Consistency', 'finishing'], preferred: ['Dribbling', 'Pace', 'Off the ball', 'Important Matches'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.read, { role: 'Advanced Forward', phase: 'S míčem', duty: 'Attack', key: ['Finishing', 'Off The Ball'], pref: ['Dribbling', 'Pace'] });
  assert.ok(r.issues.some((i) => /„Consistency“ je skrytý údaj hry/.test(i)));
  assert.ok(r.issues.some((i) => /„Important Matches“ je skrytý údaj hry/.test(i)));
  assert.ok(r.issues.some((i) => /„Off the ball“ je klíčový i žádoucí/.test(i)));
  const alias = RF.normalizeRoleExtraction({ role: 'Poacher', keyAttributes: ['Finishing'], pref: ['Anticipation'] });
  assert.deepEqual(alias.read.key, ['Finishing']);
  assert.deepEqual(alias.read.pref, ['Anticipation']);
});

test('normalizeRoleExtraction: neobjekty, chybějící role nebo atributy nejsou profil; seznamy se omezí a text se vyčistí', () => {
  for (const x of [null, undefined, [], 'text', 5]) assert.equal(RF.normalizeRoleExtraction(x).ok, false);
  const noRole = RF.normalizeRoleExtraction({ role: null, key: ['Finishing'] });
  assert.equal(noRole.ok, false);
  assert.ok(noRole.issues.some((i) => /název role/.test(i)));
  const noAttr = RF.normalizeRoleExtraction({ role: 'Poacher', key: [], preferred: [] });
  assert.equal(noAttr.ok, false);
  assert.ok(noAttr.issues.some((i) => /klíčové ani žádoucí atributy/.test(i)));
  const many = RF.normalizeRoleExtraction({ role: 'R'.repeat(200), key: Array.from({ length: 80 }, (_, i) => `Atribut ${i}`), pref: [1, null, {}, 'x', 'Dvojtečka\u0000\u202e: ' + 'q'.repeat(100)] });
  assert.equal(many.read.role.length, 60);
  assert.equal(many.read.key.length, 20);
  assert.equal(many.read.pref.length, 1); // čísla, null, objekty a jednopísmenný text se zahodí
  assert.ok(!/[\u0000\u202e]/.test(many.read.pref[0]));
  assert.ok(many.read.pref[0].length <= 30);
});

test('makeProfile: jeden profil na název role (id), zdroj jen z povolených, bez názvu nebo atributů se nevytvoří', () => {
  const a = RF.makeProfile({ name: 'Advanced Forward', key: ['Finishing'], pref: ['Pace'], source: 'screenshot', note: 'z FM27' }, { now: 7 });
  assert.equal(a.ok, true);
  assert.equal(a.profile.id, 'radvancedforward');
  assert.equal(a.profile.source, 'screenshot');
  assert.equal(a.profile.at, 7);
  assert.equal(RF.makeProfile({ name: 'advanced  forward', key: ['Finishing'] }).profile.id, a.profile.id);
  assert.equal(RF.makeProfile({ name: 'X', key: ['Finishing'], source: 'estimate' }).profile.source, 'user'); // odhad z cizího nástroje tady není povolený zdroj
  assert.equal(RF.makeProfile({ name: '', key: ['Finishing'] }).ok, false);
  assert.equal(RF.makeProfile({ name: 'Poacher', key: [], pref: [] }).ok, false);
  assert.equal(RF.makeProfile({ name: '!!!', key: ['Finishing'] }).ok, false);
  const hidden = RF.makeProfile({ name: 'Poacher', key: ['Consistency'], pref: [] });
  assert.equal(hidden.ok, false);
  assert.ok(hidden.issues.some((i) => /skrytý údaj hry/.test(i)));
});

// ---------------------------------------------------------------- vhodnost na roli
test('roleFit: skóre = Σ(hodnota × váha) / Σ(20 × váha) × 100; klíčový atribut váží dvakrát, žádoucí jednou', () => {
  const p = mk('Poacher', ['Finishing', 'Pace'], ['Dribbling']);
  const fit = RF.roleFit({ attributes: { Finishing: 15, Pace: 10, Dribbling: 5 } }, p);
  assert.equal(fit.score, 55); // (30 + 20 + 5) / 100
  assert.deepEqual(fit.missing, []);
  assert.equal(fit.contributions.length, 3);
  assert.deepEqual(fit.contributions[0], { attribute: 'Finishing', level: 'key', weight: 2, value: 15, points: 30, maxPoints: 40 });
  assert.equal(RF.roleFit({ attributes: { Finishing: 20, Pace: 20, Dribbling: 20 } }, p).score, 100);
  assert.equal(RF.roleFit({ attributes: { Finishing: 1, Pace: 1, Dribbling: 1 } }, p).score, 5); // minimum 1 se neodečítá: 5 z 100
  assert.equal(RF.roleFit({ attributes: { Finishing: 15, Pace: 10, Dribbling: 5 } }, p, { weights: { key: 3, pref: 1 } }).score, 57.1); // (45+30+5)/(60+60+20) = 80/140
});

test('roleFit: chybí-li atribut, výsledek je „nedostupné“ (ne nula); částečný výpočet je zvlášť a s pokrytím', () => {
  const p = mk('Poacher', ['Finishing', 'Pace'], ['Dribbling']);
  const fit = RF.roleFit({ attributes: { Finishing: 15, Pace: 10 } }, p);
  assert.equal(fit.score, null);
  assert.deepEqual(fit.missing, ['Dribbling']);
  assert.match(fit.reason, /chybí atributy: Dribbling/);
  assert.equal(fit.partial.score, 62.5); // (30 + 20) / 80
  assert.equal(fit.partial.coverage, 0.8);
  assert.deepEqual([fit.partial.used, fit.partial.total], [2, 3]);
  const none = RF.roleFit({ attributes: {} }, p);
  assert.equal(none.score, null);
  assert.equal(none.partial, null);
  assert.equal(RF.roleFit(null, p).score, null);
  assert.equal(RF.roleFit({ attributes: { Finishing: 10 } }, null).score, null);
});

test('roleFit: neplatné hodnoty (0, 21, necelé, text, rozsah) se berou jako chybějící; názvy se shodují bez ohledu na zápis', () => {
  const p = mk('Poacher', ['Finishing', 'Off The Ball', 'Team Work'], []);
  for (const bad of [0, 21, 12.5, '15', '12-15', null, NaN, -3]) {
    const fit = RF.roleFit({ attributes: { Finishing: 15, 'Off The Ball': bad, Teamwork: 10 } }, p);
    assert.equal(fit.score, null, String(bad));
    assert.deepEqual(fit.missing, ['Off The Ball']);
  }
  const ok = RF.roleFit({ attributes: { finishing: 15, 'off the ball': 14, 'TEAMWORK': 10 } }, p);
  assert.equal(ok.score, r(((15 + 14 + 10) / 60) * 100));
  function r(v) {
    return Math.round(v * 10) / 10;
  }
});

test('roleFit: skrytý atribut v profilu (ručně vložený nebo ze staré zálohy) se přeskočí a nikdy se nepočítá', () => {
  const evil = { name: 'Poacher', key: ['Finishing', 'Consistency'], pref: ['Important Matches', 'Pace'] };
  const fit = RF.roleFit({ attributes: { Finishing: 10, Pace: 10, Consistency: 20, 'Important Matches': 20 } }, evil);
  assert.deepEqual(fit.ignoredHidden, ['Consistency', 'Important Matches']);
  assert.equal(fit.score, 10 / 20 * 100);
  assert.equal(fit.contributions.length, 2);
  const onlyHidden = RF.roleFit({ attributes: { Consistency: 20 } }, { name: 'X', key: ['Consistency'], pref: [] });
  assert.equal(onlyHidden.score, null);
  assert.match(onlyHidden.reason, /žádný použitelný atribut/);
});

// ---------------------------------------------------------------- pozice
test('eligibility: místa šablon se převedou na pozice hry; neznámé pozice projdou s příznakem; volný režim pozice nehlídá', () => {
  assert.deepEqual(RF.eligibility('RCB', ['DC'], 'strict'), { ok: true, flag: '' });
  assert.deepEqual(RF.eligibility('LB', ['DL', 'WBL'], 'strict'), { ok: true, flag: '' });
  assert.deepEqual(RF.eligibility('RW', ['AMR'], 'strict'), { ok: true, flag: '' });
  assert.deepEqual(RF.eligibility('ST', ['AMC'], 'strict'), { ok: false, flag: '' });
  assert.deepEqual(RF.eligibility('RB', ['RB'], 'strict'), { ok: true, flag: '' }); // hráč zadaný ve stylu šablon
  assert.deepEqual(RF.eligibility('DM', [], 'strict'), { ok: true, flag: 'pozice hráče je neznámá' });
  assert.deepEqual(RF.eligibility('DM', undefined, 'strict'), { ok: true, flag: 'pozice hráče je neznámá' });
  assert.deepEqual(RF.eligibility('XYZ', ['DC'], 'strict'), { ok: true, flag: 'pozici místa nejde porovnat' });
  assert.deepEqual(RF.eligibility('ST', ['GK'], 'free'), { ok: true, flag: '' });
  assert.deepEqual(RF.eligibility('dc', ['dc'], 'strict'), { ok: true, flag: '' });
});

// ---------------------------------------------------------------- přiřazení
function bruteBest(matrix) {
  // matrix[s][p] = celé skóre nebo null; nejdřív nejvíc obsazených, pak největší součet
  const n = matrix.length;
  const m = n ? matrix[0].length : 0;
  let best = { count: -1, total: -1 };
  const used = new Array(m).fill(false);
  (function go(s, count, total) {
    if (s === n) {
      if (count > best.count || (count === best.count && total > best.total)) best = { count, total };
      return;
    }
    go(s + 1, count, total); // místo zůstane prázdné
    for (let p = 0; p < m; p++) {
      if (used[p] || matrix[s][p] === null) continue;
      used[p] = true;
      go(s + 1, count + 1, total + matrix[s][p]);
      used[p] = false;
    }
  })(0, 0, 0);
  return best;
}

test('hungarianMax: přesný optimální součet proti hrubé síle (500 náhodných matic včetně nul), žádný sloupec dvakrát', () => {
  const rand = rng(12345);
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(rand() * 5);
    const m = n + Math.floor(rand() * 4);
    const gain = Array.from({ length: n }, () => Array.from({ length: m }, () => (rand() < 0.3 ? 0 : Math.floor(rand() * 50) + 1)));
    const pick = RF.hungarianMax(gain);
    assert.equal(new Set(pick).size, n);
    const got = pick.reduce((s, j, i) => s + gain[i][j], 0);
    const brute = bruteBest(gain.map((row) => row.map((g) => g)));
    // hrubá síla smí nechat místo prázdné (hodnota 0 je totéž), takže při součtu stačí porovnat nejlepší součet
    const bruteTotal = (() => {
      let best = 0;
      const used = new Array(m).fill(false);
      (function go(s, total) {
        if (s === n) return void (best = Math.max(best, total));
        for (let p = 0; p < m; p++) if (!used[p]) {
          used[p] = true;
          go(s + 1, total + gain[s][p]);
          used[p] = false;
        }
      })(0, 0);
      return best;
    })();
    assert.equal(got, bruteTotal, JSON.stringify(gain));
    assert.ok(brute.count >= 0);
  }
  assert.deepEqual(RF.hungarianMax([]), []);
});

const SLOTS = [
  { key: 's1', pos: 'GK', role: 'Sweeper Keeper', duty: 'Support' },
  { key: 's2', pos: 'RCB', role: 'Ball Playing Defender', duty: 'Defend' },
  { key: 's3', pos: 'ST', role: 'Advanced Forward', duty: 'Attack' },
];
const PROFILES = [
  mk('Sweeper Keeper', ['Reflexes', 'Handling'], ['Kicking']),
  mk('Ball Playing Defender', ['Passing', 'Tackling'], ['Composure']),
  mk('Advanced Forward', ['Finishing', 'Pace'], ['Dribbling']),
];
const SQUAD = [
  player(1, 'Brankář', ['GK'], { Reflexes: 15, Handling: 14, Kicking: 12, Passing: 8, Tackling: 5, Composure: 10, Finishing: 3, Pace: 8, Dribbling: 4 }),
  player(2, 'Stoper', ['DC'], { Reflexes: 2, Handling: 2, Kicking: 6, Passing: 14, Tackling: 16, Composure: 13, Finishing: 5, Pace: 10, Dribbling: 8 }),
  player(3, 'Útočník', ['ST'], { Reflexes: 2, Handling: 2, Kicking: 5, Passing: 9, Tackling: 6, Composure: 12, Finishing: 17, Pace: 15, Dribbling: 14 }),
  player(4, 'Univerzál', [], { Reflexes: 1, Handling: 1, Kicking: 4, Passing: 12, Tackling: 12, Composure: 11, Finishing: 12, Pace: 12, Dribbling: 12 }),
];

test('assignBest: každý hráč na svém místě; skóre z profilů; zálohy; původ profilu je vidět', () => {
  const res = RF.assignBest({ slots: SLOTS, players: SQUAD, profiles: PROFILES });
  assert.deepEqual(res.assignments.map((a) => a.player && a.player.name), ['Brankář', 'Stoper', 'Útočník']);
  assert.equal(res.filled, 3);
  assert.equal(res.unfilled, 0);
  const st = res.assignments[2];
  assert.equal(st.fit, RF.roleFit(SQUAD[2], PROFILES[2]).score);
  assert.equal(st.profile, 'Advanced Forward');
  assert.equal(st.profileSource, 'user');
  assert.equal(st.alternatives[0].name, 'Univerzál'); // jediný jiný způsobilý (pozice neznámá)
  assert.equal(st.flag, '');
  assert.equal(res.assignments[1].alternatives[0].name, 'Univerzál');
  assert.equal(res.total, Math.round(res.assignments.reduce((s, a) => s + a.fit, 0) * 10) / 10);
  assert.equal(res.options.mode, 'strict');
});

test('assignBest: nejdřív co nejvíc obsazených míst, teprve potom součet (obsazené místo vyhraje i s nižším součtem)', () => {
  // místo A: hráč 1 má 95, hráč 2 má 40; místo B: jen hráč 1 má 10, hráč 2 nemá atribut → nelze
  const pa = mk('Role A', ['Alfa'], []);
  const pb = mk('Role B', ['Beta'], []);
  const p1 = player(1, 'Jedna', [], { Alfa: 19, Beta: 2 });
  const p2 = player(2, 'Dva', [], { Alfa: 8 });
  const res = RF.assignBest({ slots: [{ key: 'a', pos: 'ST', role: 'Role A' }, { key: 'b', pos: 'ST', role: 'Role B' }], players: [p1, p2], profiles: [pa, pb] }, { mode: 'free' });
  assert.equal(res.filled, 2);
  assert.equal(res.assignments[0].player.name, 'Dva'); // 40
  assert.equal(res.assignments[1].player.name, 'Jedna'); // 10
  assert.equal(res.total, 50);
});

test('assignBest: místo bez roleí nebo bez profilu se neobsazuje a říká proč; chybějící profily se vypíšou', () => {
  const slots = [{ key: 'a', pos: 'GK', role: 'Sweeper Keeper' }, { key: 'b', pos: 'ST', role: 'Neznámá Role' }, { key: 'c', pos: 'DC', role: '' }, { key: 'd', pos: 'DC' }];
  const res = RF.assignBest({ slots, players: SQUAD, profiles: PROFILES });
  assert.equal(res.assignments[0].player.name, 'Brankář');
  assert.match(res.assignments[1].reason, /Chybí profil role „Neznámá Role“/);
  assert.equal(res.assignments[2].reason, 'Místo nemá zadanou roli.');
  assert.equal(res.assignments[3].reason, 'Místo nemá zadanou roli.');
  assert.deepEqual(res.missingProfiles, ['Neznámá Role']);
  assert.equal(res.filled, 1);
  assert.equal(res.weak.filter((w) => w.kind === 'unfilled').length, 1); // jen místo s rolí bez profilu; místa bez role se nehodnotí, takže to nejsou slabá místa
  assert.match(res.weak[0].text, /Chybí profil role „Neznámá Role“/);
});

test('assignBest: pozice (přísně nebo volně), neznámé pozice s příznakem, málo hráčů, částečná data', () => {
  const strict = RF.assignBest({ slots: [SLOTS[2]], players: [SQUAD[1], SQUAD[3]], profiles: PROFILES });
  assert.equal(strict.assignments[0].player.name, 'Univerzál'); // stoper nemá pozici ST
  assert.equal(strict.assignments[0].flag, 'pozice hráče je neznámá');
  const free = RF.assignBest({ slots: [SLOTS[2]], players: [SQUAD[1], SQUAD[3]], profiles: PROFILES }, { mode: 'free' });
  assert.equal(free.assignments[0].player.name, 'Univerzál'); // Univerzál je v útoku lepší i bez hlídání pozic (12 > 10/5/8)
  const nobody = RF.assignBest({ slots: [SLOTS[2]], players: [SQUAD[1]], profiles: PROFILES });
  assert.equal(nobody.assignments[0].player, null);
  assert.match(nobody.assignments[0].reason, /Žádný hráč nemá pozici místa \(ST\)/);
  const few = RF.assignBest({ slots: SLOTS, players: [SQUAD[0]], profiles: PROFILES });
  assert.equal(few.filled, 1);
  assert.equal(few.unfilled, 2);
  // částečná data: hráči chybí jeden atribut ze tří (pokrytí 80 %)
  const partialPlayer = player(9, 'Neúplný', ['ST'], { Finishing: 16, Pace: 14 });
  const strictRes = RF.assignBest({ slots: [SLOTS[2]], players: [partialPlayer], profiles: PROFILES });
  assert.equal(strictRes.assignments[0].player, null);
  assert.match(strictRes.assignments[0].reason, /nemá všechny atributy role \(chybí například Dribbling\)/);
  const partialRes = RF.assignBest({ slots: [SLOTS[2]], players: [partialPlayer], profiles: PROFILES }, { allowPartial: true });
  assert.equal(partialRes.assignments[0].player.name, 'Neúplný');
  assert.equal(partialRes.assignments[0].partial, true);
  assert.equal(partialRes.assignments[0].fit, 75); // (32+28)/80
  const lowCoverage = RF.assignBest({ slots: [SLOTS[2]], players: [player(8, 'Skoro nic', ['ST'], { Dribbling: 20 })], profiles: PROFILES }, { allowPartial: true });
  assert.equal(lowCoverage.assignments[0].player, null); // pokrytí 20 % je pod 80 %
});

test('assignBest: stejný vstup dá stejný výsledek, vstupy se nemění, duplicitní id hráče se vynechá', () => {
  const input = deepFreeze({ slots: SLOTS, players: SQUAD.concat([SQUAD[0]]), profiles: PROFILES });
  const a = RF.assignBest(input);
  const b = RF.assignBest(input);
  assert.deepEqual(a, b);
  assert.equal(a.filled, 3);
  // při úplné shodě rozhoduje pořadí hráčů ve vstupu
  const twin1 = player(1, 'Dvojče A', ['ST'], { Finishing: 15, Pace: 15, Dribbling: 15 });
  const twin2 = player(2, 'Dvojče B', ['ST'], { Finishing: 15, Pace: 15, Dribbling: 15 });
  assert.equal(RF.assignBest({ slots: [SLOTS[2]], players: [twin1, twin2], profiles: PROFILES }).assignments[0].player.name, 'Dvojče A');
  assert.equal(RF.assignBest({ slots: [SLOTS[2]], players: [twin2, twin1], profiles: PROFILES }).assignments[0].player.name, 'Dvojče B');
  assert.equal(RF.assignBest(null).filled, 0);
  assert.equal(RF.assignBest({}).assignments.length, 0);
});

test('assignBest: proti hrubé síle na 400 náhodných sestavách (počet obsazených míst a součet)', () => {
  const rand = rng(777);
  const NAMES = ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta'];
  const POS = ['GK', 'DC', 'ST', 'MC'];
  const SLOTPOS = ['GK', 'RCB', 'ST', 'CM'];
  for (let t = 0; t < 400; t++) {
    const nSlots = 2 + Math.floor(rand() * 4);
    const nPlayers = 2 + Math.floor(rand() * 6);
    const profiles = Array.from({ length: 3 }, (_, i) => {
      const pool = NAMES.slice().sort(() => rand() - 0.5);
      return mk(`Role ${i}`, pool.slice(0, 2), pool.slice(2, 2 + Math.floor(rand() * 3)));
    });
    const slots = Array.from({ length: nSlots }, (_, i) => ({ key: 's' + i, pos: SLOTPOS[Math.floor(rand() * 4)], role: rand() < 0.1 ? '' : `Role ${Math.floor(rand() * 3)}` }));
    const players = Array.from({ length: nPlayers }, (_, i) => {
      const attributes = {};
      for (const n of NAMES) if (rand() < 0.9) attributes[n] = 1 + Math.floor(rand() * 20);
      return player(i + 1, 'H' + i, rand() < 0.3 ? [] : [POS[Math.floor(rand() * 4)]], attributes);
    });
    const mode = rand() < 0.3 ? 'free' : 'strict';
    const res = RF.assignBest({ slots, players, profiles }, { mode });
    const idx = RF.profilesIndex(profiles);
    const matrix = slots.map((s) =>
      players.map((p) => {
        const prof = typeof s.role === 'string' && s.role ? idx.get(RF.roleKey(s.role)) : null;
        if (!prof || !RF.eligibility(s.pos, p.positions, mode).ok) return null;
        const f = RF.roleFit(p, prof).score;
        return f === null ? null : Math.round(f * 10);
      })
    );
    const brute = bruteBest(matrix);
    assert.equal(res.filled, brute.count, `počet, pokus ${t}`);
    assert.equal(Math.round(res.total * 10), brute.total, `součet, pokus ${t}`);
    const ids = res.assignments.filter((a) => a.player).map((a) => a.player.id);
    assert.equal(new Set(ids).size, ids.length); // nikdo dvakrát
  }
});

// ---------------------------------------------------------------- slabá místa a shrnutí
test('weakSpots: neobsazená místa první, slabé místo je aspoň o 8 bodů pod mediánem a až od tří obsazených; práh jde změnit', () => {
  const mkA = (i, fit, name) => ({ slotKey: 's' + i, pos: 'P' + i, role: 'R' + i, duty: '', player: fit === null ? null : { id: i, name }, fit, partial: false, alternatives: [], reason: fit === null ? 'Chybí profil.' : '' });
  const res = { assignments: [mkA(1, 80, 'A'), mkA(2, 78, 'B'), mkA(3, 77, 'C'), mkA(4, 60, 'D'), mkA(5, null)] };
  const weak = RF.weakSpots(res);
  assert.deepEqual(weak.map((w) => [w.kind, w.slotKey]), [['unfilled', 's5'], ['weak', 's4']]);
  assert.equal(weak[1].median, 77.5);
  assert.equal(weak[1].gap, 17.5);
  assert.match(weak[1].text, /D má vhodnost 60, o 17,5 méně než medián sestavy \(77,5\)/);
  assert.equal(RF.weakSpots(res, { gap: 20 }).filter((w) => w.kind === 'weak').length, 0);
  // se dvěma obsazenými místy se slabé místo neurčuje (medián z dvou čísel nic neříká)
  const two = { assignments: [mkA(1, 90, 'A'), mkA(2, 50, 'B')] };
  assert.equal(RF.weakSpots(two).length, 0);
  assert.deepEqual(RF.weakSpots(null), []);
});

test('summaryLines: pro AI trenéra s nápisem, že jde o heuristiku; neobsazená místa s důvodem, zálohy a slabá místa', () => {
  const res = RF.assignBest({ slots: SLOTS.concat([{ key: 's4', pos: 'ST', role: 'Neznámá' }]), players: SQUAD, profiles: PROFILES });
  const lines = RF.summaryLines(res);
  assert.match(lines[0], /heuristika aplikace/);
  assert.ok(lines.some((l) => /^ST Advanced Forward: Útočník, vhodnost \d+(,\d)?/.test(l) && /záloha Univerzál \d+(,\d)?/.test(l)));
  assert.ok(lines.some((l) => /^ST Neznámá: neobsazeno \(Chybí profil role „Neznámá“/.test(l)));
  assert.deepEqual(RF.summaryLines(null), []);
});

// ---------------------------------------------------------------- FM27: dvě sady rolí a česká obrazovka
test('FM27: stejná role s míčem a bez míče se neslévá (jiná fáze = jiný profil), starý profil bez fáze se chová jako dřív', () => {
  const inP = RF.makeProfile({ name: 'Střední obránce', key: ['Hlavičky', 'Obranné zákroky'], pref: ['Rychlost'], phase: 'in', source: 'screenshot' }, { now: 1 }).profile;
  const outP = RF.makeProfile({ name: 'Střední obránce', key: ['Hlavičky', 'Poziční hra'], pref: ['Agresivita'], phase: 'out', source: 'screenshot' }, { now: 1 }).profile;
  const plain = RF.makeProfile({ name: 'Libero', key: ['Passing'], pref: [], source: 'user' }, { now: 1 }).profile;
  assert.notEqual(inP.id, outP.id);
  assert.equal(plain.id, 'rlibero', 'profil bez fáze má id jako dřív');
  assert.equal(RF.phaseOf('S míčem na kopačkách'), 'in');
  assert.equal(RF.phaseOf('Bez míče'), 'out');
  assert.equal(RF.phaseOf('Out of Possession'), 'out');
  assert.equal(RF.phaseOf('in'), 'in');
  assert.equal(RF.phaseOf(''), '');
  assert.notEqual(RF.profileKey('Střední obránce', 'in'), RF.profileKey('Střední obránce', 'out'));
  const idx = RF.profilesIndex([inP, outP, plain]);
  assert.equal(idx.size, 3);
  assert.equal(idx.get(RF.roleKey('Střední obránce')).phase, 'in', 'role místa v taktice (s míčem) najde profil s míčem');
  assert.equal(idx.get('out:' + RF.roleKey('Střední obránce')).phase, 'out');
});

test('FM27: profil role přečtený z české obrazovky (české názvy atributů) sedí na hráče s anglickými názvy atributů i naopak', () => {
  const p = mk('Rozehrávající stoper', ['Hlavičky', 'Obranné zákroky', 'Obsazování', 'Přihrávky'], ['Zpracování', 'Rychlost']);
  const en = RF.roleFit({ attributes: { Heading: 15, Tackling: 16, Marking: 16, Passing: 12, 'First Touch': 13, Pace: 13 } }, p);
  const cs = RF.roleFit({ attributes: { Hlavičky: 15, 'Obranné zákroky': 16, Obsazování: 16, Přihrávky: 12, Zpracování: 13, Rychlost: 13 } }, p);
  assert.equal(en.score, cs.score);
  assert.deepEqual(en.missing, []);
  assert.ok(en.score > 60);
  // profil zadaný anglicky a hráč z české obrazovky
  const pe = mk('Anglický', ['Heading', 'Tackling'], ['Pace']);
  assert.equal(RF.roleFit({ attributes: { Hlavičky: 15, 'Obranné zákroky': 16, Rychlost: 13 } }, pe).missing.length, 0);
});
