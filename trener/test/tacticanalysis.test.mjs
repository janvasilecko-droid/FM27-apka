import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const T = require('../src/tactics.js');
const K = require('../src/fm27know.js');
const A = require('../src/tacticanalysis.js');
const source = readFileSync(new URL('../src/tacticanalysis.js', import.meta.url), 'utf8');

/** tac('4-3-3', {mentality, ti: [texty instrukcí], roles: {RB: 'Wing-Back' | ['role s míčem', 'role bez míče']}}) */
function tac(formation, o = {}) {
  const t = T.makeTactic({ formation, name: 'zkouška' });
  t.mentality = o.mentality || '';
  t.teamInstructions = o.ti || [];
  for (const [pos, r] of Object.entries(o.roles || {})) {
    const s = t.slots.find((x) => x.pos === pos);
    assert.ok(s, `pozice ${pos} v ${formation}`);
    const [inn, out] = Array.isArray(r) ? r : [r, null];
    if (inn) s.role = inn;
    if (out) s.oopRole = out;
  }
  return t;
}
/** Přidá hráče s atributy na pozice: pl(t, {RCB: {Pace: 10}}) → pole hráčů pro opts.players */
function pl(t, byPos) {
  const players = [];
  for (const [pos, attributes] of Object.entries(byPos)) {
    const s = t.slots.find((x) => x.pos === pos);
    s.playerId = 'p-' + pos;
    players.push({ id: s.playerId, name: 'Hráč ' + pos, attributes });
  }
  return players;
}
const ids = (r) => r.findings.map((f) => f.id);
const strengthIds = (r) => r.strengths.map((f) => f.id);
const find = (r, id) => r.findings.find((f) => f.id === id);

// kompletní role pro 4-3-3 (aby šla vyhodnotit pravidla, která chtějí všechny role): neutrální
const FULL_433 = { GK: 'Goalkeeper', RB: 'Full-Back', RCB: 'Centre-Back', LCB: 'Centre-Back', LB: 'Full-Back', DM: 'Defensive Midfielder', RCM: 'Central Midfielder', LCM: 'Central Midfielder', RW: 'Winger', ST: 'Centre Forward', LW: 'Winger' };
const FULL_433_OUT = { GK: [null, 'Goalkeeper'], RB: [null, 'Full-Back'], RCB: [null, 'Centre-Back'], LCB: [null, 'Centre-Back'], LB: [null, 'Full-Back'], DM: [null, 'Defensive Midfielder'], RCM: [null, 'Central Midfielder'], LCM: [null, 'Central Midfielder'], RW: [null, 'Winger'], ST: [null, 'Centre Forward'], LW: [null, 'Winger'] };
const mergeRoles = (inn, out) => {
  const res = {};
  for (const pos of new Set([...Object.keys(inn), ...Object.keys(out)])) {
    const i = inn[pos];
    const o = out[pos];
    res[pos] = [(Array.isArray(i) ? i[0] : i) || null, (Array.isArray(o) ? o[1] : null) || null];
  }
  return res;
};
const withIn = (over) => ({ ...FULL_433, ...over });

// každé pravidlo: kladný příklad (musí zahlásit) a záporný (nesmí)
const CASES = [
  ['A01', { f: '4-3-3', ti: ['Defensive Line: Lower', 'Line of Engagement: High Press'] }, { f: '4-3-3', ti: ['Defensive Line: Standard', 'Line of Engagement: Mid Block'] }],
  ['A01', { f: '4-3-3', ti: ['Defensive Line: Much Higher', 'Line of Engagement: Low Block'] }, { f: '4-3-3', ti: ['Defensive Line: Higher', 'Line of Engagement: Mid Block'] }],
  ['A02', { f: '4-3-3', ti: ['Defensive Line: Standard', 'Line of Engagement: High Press'] }, { f: '4-3-3', ti: ['Defensive Line: Higher', 'Line of Engagement: High Press'] }],
  ['A03', { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower'] }, { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Standard'] }],
  ['A04', { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Line of Engagement: Low Block'] }, { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Line of Engagement: Mid Block'] }],
  ['A04b', { f: '4-3-3', ti: ['Defensive Transition: Regroup', 'Line of Engagement: High Press'] }, { f: '4-3-3', ti: ['Defensive Transition: Regroup', 'Line of Engagement: Low Block'] }],
  ['A05', { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Attacking Width: Wider'] }, { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Attacking Width: Narrower'] }],
  ['A06', { f: '4-3-3', ti: ['Trigger Press: Less Often', 'Defensive Line: Higher'] }, { f: '4-3-3', ti: ['Trigger Press: Standard', 'Defensive Line: Higher'] }],
  ['A07', { f: '4-3-3', ti: ['Defensive Line Behaviour: Drop Off More', 'Defensive Line: Higher'] }, { f: '4-3-3', ti: ['Defensive Line Behaviour: Balanced', 'Defensive Line: Higher'] }],
  ['A07', { f: '4-3-3', ti: ['Defensive Line Behaviour: Step Up More', 'Defensive Line: Lower'] }, { f: '4-3-3', ti: ['Defensive Line Behaviour: Step Up More', 'Defensive Line: Higher'] }],
  ['A09', { f: '4-3-3', ti: ['Defensive Line: Higher'], roles: { GK: [null, 'Line-Holding Keeper'] } }, { f: '4-3-3', ti: ['Defensive Line: Higher'], roles: { GK: [null, 'Sweeper Keeper'] } }],
  ['A12', { f: '4-3-3', ti: ['Short Goalkeeper Distribution: Yes', 'Line of Engagement: Mid Block'] }, { f: '4-3-3', ti: ['Short Goalkeeper Distribution: Yes', 'Line of Engagement: High Press', 'Defensive Line: Higher'] }],
  ['B02', { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Tackling: Get Stuck In'] }, { f: '4-3-3', ti: ['Defensive Transition: Counter-Press', 'Tackling: Standard'] }],
  ['B03', { f: '4-3-3', ti: ['Line of Engagement: Low Block', 'Tackling: Get Stuck In'] }, { f: '4-3-3', ti: ['Line of Engagement: Mid Block', 'Tackling: Get Stuck In'] }],
  ['C01', { f: '4-3-3', ti: ['Passing Directness: More Direct', 'Patience: Work Ball Into Box'] }, { f: '4-3-3', ti: ['Passing Directness: Standard', 'Patience: Work Ball Into Box'] }],
  ['C02', { f: '4-3-3', ti: ['Attacking Transition: Counter-Attack', 'Patience: Work Ball Into Box'] }, { f: '4-3-3', ti: ['Attacking Transition: Counter-Attack', 'Patience: Hit Early Crosses', 'Passing Directness: Standard'] }],
  ['C03', { f: '4-3-3', ti: ['Tempo: Much Higher', 'Passing Directness: Shorter'] }, { f: '4-3-3', ti: ['Tempo: Higher', 'Passing Directness: Shorter'] }],
  ['C04', { f: '4-3-3', ti: ['Attacking Width: Wider', 'Passing Directness: Shorter'] }, { f: '4-3-3', ti: ['Attacking Width: Wider', 'Passing Directness: Standard'] }],
  ['C06', { f: '4-3-3', roles: withIn({ RB: 'Inside Full-Back', LB: 'Inside Full-Back', RW: 'Inside Winger', LW: 'Inside Winger' }) }, { f: '4-3-3', roles: withIn({ RB: 'Inside Full-Back', LB: 'Inside Full-Back', RW: 'Winger', LW: 'Winger' }) }],
  ['C07', { f: '4-3-3', ti: ['Overlap: Both Flanks'], roles: withIn({}) }, { f: '4-3-3', ti: ['Overlap: Both Flanks'], roles: withIn({ RB: 'Wing-Back', LB: 'Advanced Wing-Back' }) }],
  ['C07', { f: '4-3-3', ti: ['Underlap: Both Flanks'], roles: withIn({}) }, { f: '4-3-3', ti: ['Underlap: Both Flanks'], roles: withIn({ LCM: 'Channel Midfielder' }) }],
  ['C08', { f: '4-3-3', ti: ['Patience: Work Ball Into Box', 'Shots from Distance: Encourage'] }, { f: '4-3-3', ti: ['Patience: Work Ball Into Box', 'Shots from Distance: Balanced'] }],
  ['C10', { f: '4-3-3', ti: ['Creative Freedom: More Disciplined'], roles: withIn({ DM: 'Deep-Lying Playmaker' }) }, { f: '4-3-3', ti: ['Creative Freedom: Balanced'], roles: withIn({ DM: 'Deep-Lying Playmaker' }) }],
  ['C14', { f: '4-3-3', ti: ['Pass Reception: Pass Into Space', 'Passing Directness: Shorter'] }, { f: '4-3-3', ti: ['Pass Reception: Balanced', 'Passing Directness: Shorter'] }],
  ['C15', { f: '4-3-3', ti: ['Build-Up Strategy: Play Through Press', 'Passing Directness: More Direct'] }, { f: '4-3-3', ti: ['Build-Up Strategy: Bypass Press', 'Passing Directness: More Direct'] }],
  ['D01', { f: '4-3-3', ti: ['Build-Up Strategy: Play Through Press', 'Goal Kicks: Long'] }, { f: '4-3-3', ti: ['Build-Up Strategy: Play Through Press', 'Goal Kicks: Short'] }],
  ['D01', { f: '4-3-3', ti: ['Build-Up Strategy: Play Through Press', 'GK Distribution: Target Forward'] }, { f: '4-3-3', ti: ['Build-Up Strategy: Play Through Press', 'GK Distribution: Centre-Backs'] }],
  ['D02', { f: '4-3-3', ti: ['Build-Up Strategy: Bypass Press', 'Goal Kicks: Short'] }, { f: '4-3-3', ti: ['Build-Up Strategy: Bypass Press', 'Goal Kicks: Long'] }],
  ['D06', { f: '4-3-3', roles: { GK: ['Ball-Playing Goalkeeper', 'Line-Holding Keeper'] } }, { f: '4-3-3', roles: { GK: ['Ball-Playing Goalkeeper', 'Sweeper Keeper'] } }],
  ['D06', { f: '4-3-3', roles: { GK: ['No-Nonsense Goalkeeper', 'Sweeper Keeper'] } }, { f: '4-3-3', roles: { GK: ['No-Nonsense Goalkeeper', 'Line-Holding Keeper'] } }],
  ['E01', { f: '4-3-3', roles: withIn({ DM: 'Defensive Midfielder', RCM: 'Central Midfielder', LCM: 'Central Midfielder' }) }, { f: '4-3-3', roles: withIn({ DM: 'Defensive Midfielder', RCM: 'Channel Midfielder', LCM: 'Advanced Playmaker' }) }],
  ['E02', { f: '4-2-3-1', roles: { RDM: 'Defensive Midfielder', LDM: 'Half Back', AM: 'Attacking Midfielder' } }, { f: '4-2-3-1', roles: { RDM: 'Defensive Midfielder', LDM: 'Half Back', AM: 'Advanced Playmaker' } }],
  ['E02', { f: '4-2-3-1', roles: { RDM: 'Deep-Lying Playmaker', LDM: 'Midfield Playmaker', AM: 'Attacking Midfielder' } }, { f: '4-2-3-1', roles: { RDM: 'Deep-Lying Playmaker', LDM: 'Defensive Midfielder', AM: 'Attacking Midfielder' } }],
  ['E03', { f: '4-3-3', roles: mergeRoles(FULL_433, FULL_433_OUT) }, { f: '4-3-3', roles: mergeRoles(FULL_433, { ...FULL_433_OUT, DM: [null, 'Screening Defensive Midfielder'] }) }],
  ['F01', { f: '4-3-3', roles: withIn({ RB: 'Wing-Back', RW: 'Wide Forward' }) }, { f: '4-3-3', roles: withIn({ RB: 'Wing-Back', RW: 'Winger' }) }],
  ['F04', { f: '4-3-3', roles: withIn({ RB: 'Wing-Back', LB: 'Wing-Back' }) }, { f: '4-3-3', roles: withIn({ RB: 'Wing-Back', LB: 'Full-Back' }) }],
  ['G01', { f: '4-4-2', roles: { GK: 'Goalkeeper', RB: 'Full-Back', RCB: 'Centre-Back', LCB: 'Centre-Back', LB: 'Full-Back', RM: 'Winger', RCM: 'Central Midfielder', LCM: 'Central Midfielder', LM: 'Winger', RST: 'Poacher', LST: 'Channel Forward' } }, { f: '4-4-2', roles: { GK: 'Goalkeeper', RB: 'Full-Back', RCB: 'Centre-Back', LCB: 'Centre-Back', LB: 'Full-Back', RM: 'Winger', RCM: 'Central Midfielder', LCM: 'Central Midfielder', LM: 'Winger', RST: 'Poacher', LST: 'Deep-Lying Forward' } }],
  ['G02', { f: '4-3-3', roles: withIn({ ST: 'Poacher', RCM: 'Central Midfielder', LCM: 'Central Midfielder' }) }, { f: '4-3-3', roles: withIn({ ST: 'Poacher', RCM: 'Central Midfielder', LCM: 'Advanced Playmaker' }) }],
  ['G03', { f: '4-3-3', roles: withIn({ RCB: 'Ball-Playing Centre-Back', LCB: 'Ball-Playing Centre-Back' }) }, { f: '4-3-3', roles: withIn({ RCB: 'Ball-Playing Centre-Back', LCB: 'Centre-Back' }) }],
  ['G06', { f: '4-3-3', roles: mergeRoles(FULL_433, { ...FULL_433_OUT, RW: [null, 'Wide Outlet Winger'], LW: [null, 'Wide Outlet Winger'] }) }, { f: '4-3-3', roles: mergeRoles(FULL_433, { ...FULL_433_OUT, RW: [null, 'Wide Outlet Winger'] }) }],
  ['G07', { f: '4-3-3', ti: ['Trigger Press: Less Often'], roles: { DM: [null, 'Pressing Defensive Midfielder'] } }, { f: '4-3-3', ti: ['Trigger Press: Standard'], roles: { DM: [null, 'Pressing Defensive Midfielder'] } }],
  ['H01', { f: '4-3-3', mentality: 'Cautious', ti: ['Defensive Line: Lower'], roles: { RW: [null, 'Wide Outlet Winger'], LW: [null, 'Wide Outlet Winger'] } }, { f: '4-3-3', mentality: 'Balanced', ti: ['Defensive Line: Lower'], roles: { RW: [null, 'Wide Outlet Winger'], LW: [null, 'Wide Outlet Winger'] } }],
];

for (const [id, pos, neg] of CASES) {
  test(`pravidlo ${id}: kladný příklad nález zahlásí, záporný ne (${(pos.ti || []).concat(Object.keys(pos.roles || {}).slice(0, 2)).join(' | ')})`, () => {
    const make = (o) => tac(o.f, { mentality: o.mentality, ti: o.ti, roles: o.roles });
    const rp = A.analyze(make(pos), {});
    const rn = A.analyze(make(neg), {});
    assert.ok(ids(rp).includes(id), `${id} se nezahlásilo; nálezy: ${ids(rp)}`);
    assert.ok(!ids(rn).includes(id), `${id} se zahlásilo i u záporného příkladu`);
    const f = find(rp, id);
    assert.ok(f.ev.length > 0, 'nález bez důkazu');
    assert.ok(f.fix.length > 0, 'nález bez návrhu změny');
    assert.ok(f.why.length > 30 && f.title.length > 10);
  });
}

test('silné stránky (C12, F02, F05) se hlásí zvlášť a jen když platí', () => {
  const good = A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Counter-Press', 'Attacking Transition: Hold Shape'], roles: withIn({ RW: 'Inside Winger', RB: 'Wing-Back', LB: 'Full-Back', LW: 'Winger' }) }), {});
  assert.ok(strengthIds(good).includes('C12'));
  assert.ok(strengthIds(good).includes('F02'));
  assert.ok(strengthIds(good).includes('F05'));
  assert.ok(!ids(good).includes('C12'), 'silná stránka není mezi nálezy');
  const bad = A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Regroup', 'Attacking Transition: Hold Shape'], roles: withIn({ RW: 'Winger', RB: 'Full-Back', LB: 'Full-Back', LW: 'Winger' }) }), {});
  assert.deepEqual(strengthIds(bad), []);
});

test('A08: vysoká linie a pomalý stoper; práh se dá posunout; bez atributů se pravidlo nevyhodnotí', () => {
  const mk = () => tac('4-3-3', { ti: ['Defensive Line: Higher'] });
  const slow = mk();
  const r1 = A.analyze(slow, { players: pl(slow, { RCB: { Pace: 10, Acceleration: 12 }, LCB: { Pace: 14, Acceleration: 14 } }) });
  assert.equal(find(r1, 'A08').sev, 'error');
  assert.deepEqual(find(r1, 'A08').slots, [slow.slots.find((s) => s.pos === 'RCB').key]);
  const mid = mk();
  assert.equal(find(A.analyze(mid, { players: pl(mid, { RCB: { Pace: 13 }, LCB: { Pace: 15 } }) }), 'A08').sev, 'warn');
  const ok = mk();
  assert.ok(!ids(A.analyze(ok, { players: pl(ok, { RCB: { Pace: 15, Acceleration: 14 }, LCB: { Pace: 16, Acceleration: 15 } }) })).includes('A08'));
  const low = mk();
  const pLow = pl(low, { RCB: { Pace: 10 }, LCB: { Pace: 15 } });
  assert.equal(find(A.analyze(low, { players: pLow }), 'A08').sev, 'error');
  assert.equal(find(A.analyze(low, { players: pLow, attrShift: -2 }), 'A08').sev, 'warn', 'nižší soutěž posune práh o dva dolů');
  const none = A.analyze(mk(), {});
  assert.ok(none.checks.notEvaluated.some((x) => x.id === 'A08'));
  const lowLine = tac('4-3-3', { ti: ['Defensive Line: Standard'] });
  assert.ok(!ids(A.analyze(lowLine, { players: pl(lowLine, { RCB: { Pace: 5 }, LCB: { Pace: 5 } }) })).includes('A08'), 'pomalí stopeři při standardní linii nejsou nález');
});

test('B01: intenzivní presink a střed bez výdrže (nejhorší hráč, ne průměr)', () => {
  const t = tac('4-3-3', { ti: ['Line of Engagement: High Press'] });
  const players = pl(t, { DM: { Stamina: 17, 'Work Rate': 17 }, RCM: { Stamina: 17, 'Work Rate': 16 }, LCM: { Stamina: 11, 'Work Rate': 15 } });
  const f = find(A.analyze(t, { players }), 'B01');
  assert.equal(f.sev, 'error');
  assert.deepEqual(f.slots, [t.slots.find((s) => s.pos === 'LCM').key]);
  const t2 = tac('4-3-3', { ti: ['Line of Engagement: High Press'] });
  const w = find(A.analyze(t2, { players: pl(t2, { DM: { Stamina: 15, 'Work Rate': 15 }, RCM: { Stamina: 13, 'Work Rate': 15 }, LCM: { Stamina: 15, 'Work Rate': 15 } }) }), 'B01');
  assert.equal(w.sev, 'warn');
  const t3 = tac('4-3-3', { ti: ['Line of Engagement: Mid Block'] });
  assert.ok(!ids(A.analyze(t3, { players: pl(t3, { DM: { Stamina: 5, 'Work Rate': 5 } }) })).includes('B01'), 'bez intenzivního presinku to není nález');
  const t4 = tac('4-3-3', { ti: ['Line of Engagement: High Press'] });
  assert.ok(!ids(A.analyze(t4, { players: pl(t4, { DM: { Stamina: 16, 'Work Rate': 16 }, RCM: { Stamina: 15, 'Work Rate': 15 }, LCM: { Stamina: 14, 'Work Rate': 14 } }) })).includes('B01'));
});

test('D03: rozehra od brankáře a technicky slabý stoper', () => {
  const t = tac('4-3-3', { ti: ['Build-Up Strategy: Play Through Press'] });
  const f = find(A.analyze(t, { players: pl(t, { RCB: { Passing: 9, Composure: 14, 'First Touch': 14 }, LCB: { Passing: 15, Composure: 14, 'First Touch': 14 } }) }), 'D03');
  assert.equal(f.sev, 'error');
  const t2 = tac('4-3-3', { ti: ['Build-Up Strategy: Play Through Press'] });
  assert.equal(find(A.analyze(t2, { players: pl(t2, { RCB: { Passing: 12, Composure: 14, 'First Touch': 14 }, LCB: { Passing: 15, Composure: 14, 'First Touch': 14 } }) }), 'D03').sev, 'warn');
  const t3 = tac('4-3-3', { ti: ['Build-Up Strategy: Bypass Press', 'Goal Kicks: Long'] });
  assert.ok(!ids(A.analyze(t3, { players: pl(t3, { RCB: { Passing: 5, Composure: 5, 'First Touch': 5 } }) })).includes('D03'));
});

test('prázdná taktika nemá žádný nález a nic se nevyhodnotí z toho, co chybí', () => {
  const r = A.analyze(tac('4-3-3'), {});
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.strengths, []);
  assert.equal(r.checks.evaluated, 0);
  assert.equal(r.checks.notEvaluated.length + r.checks.notApplicable, r.checks.total);
  assert.equal(r.coverage.settingsKnown, 0);
  assert.equal(r.mentality, null);
});

test('nerozpoznaná instrukce se uvede a nezkresluje nic dalšího; stejná instrukce dvakrát: platí poslední', () => {
  const r = A.analyze(tac('4-3-3', { ti: ['Defensive Line: Higher', 'Něco mimo slovník', 'Defensive Line: Lower', 'Line of Engagement: High Press'] }), {});
  assert.deepEqual(r.unknownSettings, ['Něco mimo slovník']);
  assert.equal(r.settings.find((s) => s.id === 'defensiveLine').value, 'Lower');
  assert.ok(ids(r).includes('A01'));
});

test('role s FM24 názvem se nepozná a pravidla, která ji potřebují, se nevyhodnotí (ne falešný nález)', () => {
  const t = tac('4-3-3', { roles: withIn({ RCB: 'Ball Playing Defender', LCB: 'Ball Playing Defender' }) });
  const r = A.analyze(t, {});
  assert.ok(!ids(r).includes('G03'));
  assert.ok(r.checks.notEvaluated.some((x) => x.id === 'G03'));
  assert.equal(r.coverage.rolesIn.known, 9);
  assert.equal(r.coverage.rolesIn.total, 11);
});

test('pravidla na role se nevztahují, když rozestavení nemá potřebnou řadu (nevyhodnotit ≠ nevztahuje se)', () => {
  const r = A.analyze(tac('4-3-3', { roles: withIn({}) }), {});
  assert.equal(r.checks.notApplicable, 2, 'G01 (dva útočníci) a E02 (dvojice záložníků) se na 4-3-3 nevztahují');
  assert.ok(!r.checks.notEvaluated.some((x) => x.id === 'G01' || x.id === 'E02'));
});

test('řazení: vážné rozpory před upozorněními, poznámkami a informacemi; vstup se nemění', () => {
  const t = tac('4-3-3', {
    ti: ['Line of Engagement: High Press', 'Defensive Line: Lower', 'Defensive Transition: Counter-Press', 'Tackling: Get Stuck In', 'Attacking Width: Wider'],
    roles: withIn({}),
  });
  const frozen = JSON.parse(JSON.stringify(t));
  const deep = (o) => {
    if (o && typeof o === 'object') {
      Object.freeze(o);
      for (const v of Object.values(o)) deep(v);
    }
    return o;
  };
  const r = A.analyze(deep(t), {});
  assert.deepEqual(JSON.parse(JSON.stringify(t)), frozen);
  const rank = { error: 0, warn: 1, note: 2, info: 3 };
  for (let i = 1; i < r.findings.length; i++) assert.ok(rank[r.findings[i - 1].sev] <= rank[r.findings[i].sev], 'špatné řazení');
  assert.equal(r.findings[0].sev, 'error');
});

test('stejný vstup dá stejný výstup', () => {
  const o = { f: '4-3-3', ti: ['Defensive Line: Lower', 'Line of Engagement: High Press', 'Tempo: Much Higher', 'Passing Directness: Shorter'], roles: withIn({ RB: 'Wing-Back', LB: 'Wing-Back' }) };
  assert.deepEqual(A.analyze(tac(o.f, o), {}), A.analyze(tac(o.f, o), {}));
});

test('katalog: jedinečná id, platné závažnosti a druhy, texty bez neviditelných znaků, nález má vždy návrh změny kromě silných stránek', () => {
  const seen = new Set();
  for (const r of A.RULES) {
    assert.ok(!seen.has(r.id), `duplicitní id ${r.id}`);
    seen.add(r.id);
    assert.ok(['error', 'warn', 'note', 'info', 'good'].includes(r.sev), r.id);
    assert.ok(['HRA', 'KOMUNITA', 'ODHAD'].includes(r.basis), r.id);
    assert.ok(r.title.length >= 10 && r.why.length >= 40, r.id);
    if (r.sev === 'good') assert.equal(r.fix.length, 0, r.id);
    else assert.ok(r.fix.length >= 1, r.id);
    for (const text of [r.title, r.why, ...r.fix]) assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text), `${r.id}: neviditelný znak`);
    assert.equal(typeof r.test, 'function');
  }
  assert.ok(A.RULES.length >= 40);
});

test('doporučené změny „Název → Hodnota“ používají jen skutečné instrukce a hodnoty slovníku FM27', () => {
  let checked = 0;
  for (const r of A.RULES) {
    for (const fix of r.fix) {
      for (const t of K.TEAM_INSTRUCTIONS) {
        let from = 0;
        for (;;) {
          const i = fix.indexOf(`${t.name} → `, from);
          if (i < 0) break;
          from = i + 1;
          // nejdelší název vyhrává: „Defensive Line → …“ nesmí být chycené uvnitř „Defensive Line Behaviour → …“ (tam by za názvem nebyla šipka)
          const rest = fix.slice(i + t.name.length + 3);
          assert.ok(t.values.some((v) => rest.startsWith(v)), `${r.id}: „${t.name} → ${rest.slice(0, 25)}“ není hodnota instrukce`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 30, `zkontrolováno jen ${checked} návrhů`);
});

test('odolnost: náhodné taktiky a zmatené texty nikdy nehodí výjimku a výstup má vždy platný tvar', () => {
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const allRoles = [...Object.values(K.ROLES_IN).flat(), ...Object.values(K.ROLES_OUT).flat(), 'Ball Playing Defender', '', 'čokoláda'];
  const allSettings = K.TEAM_INSTRUCTIONS.flatMap((t) => t.values.map((v) => `${t.name}: ${v}`)).concat(['blabla', '', 'Higher', 'Tempo: ???']);
  for (let n = 0; n < 300; n++) {
    const f = pick(T.FORMATIONS).id;
    const t = T.makeTactic({ formation: f, name: 'n' });
    t.mentality = pick(['', ...K.MENTALITIES, 'divné']);
    t.teamInstructions = Array.from({ length: Math.floor(rnd() * 14) }, () => pick(allSettings));
    for (const s of t.slots) {
      if (rnd() < 0.8) s.role = pick(allRoles);
      if (rnd() < 0.6) s.oopRole = pick(allRoles);
      if (rnd() < 0.5) s.playerId = 'p' + s.key;
    }
    const players = t.slots.filter((s) => s.playerId).map((s) => ({ id: s.playerId, name: s.playerId, attributes: Object.fromEntries(['Pace', 'Acceleration', 'Stamina', 'Work Rate', 'Passing', 'Composure', 'First Touch'].filter(() => rnd() < 0.7).map((a) => [a, 1 + Math.floor(rnd() * 20)])) }));
    const r = A.analyze(t, { players, attrShift: Math.floor(rnd() * 5) - 3 });
    assert.equal(r.checks.evaluated + r.checks.notApplicable + r.checks.notEvaluated.length, r.checks.total);
    for (const x of r.findings.concat(r.strengths)) {
      assert.ok(A.RULE_BY_ID.has(x.id));
      assert.ok(['error', 'warn', 'note', 'info', 'good'].includes(x.sev));
      assert.ok(Array.isArray(x.ev) && x.ev.every((e) => typeof e === 'string' && e.length));
      assert.ok(x.slots.every((k) => t.slots.some((s) => s.key === k)), 'nález ukazuje na neexistující místo');
    }
  }
});

test('summaryLines: souhrn pro kopírování a pro Osobního trenéra má pokrytí, nálezy a počty kontrol', () => {
  const r = A.analyze(tac('4-3-3', { ti: ['Defensive Line: Lower', 'Line of Engagement: High Press'], mentality: 'Balanced' }), {});
  const lines = A.summaryLines(r);
  assert.match(lines[0], /Rozbor taktiky 4-3-3: mentalita Balanced, instrukcí rozpoznáno 2 z 28/);
  assert.ok(lines.some((l) => /\[A01\]/.test(l) && /Defensive Line → Standard/.test(l)));
  assert.match(lines[lines.length - 1], /Kontroly: vyhodnoceno \d+ z 42 \(bez nálezu \d+, nález 1\)/);
});

test('modul je čisté UMD: v prohlížeči se přihlásí do globálního objektu, když jsou závislosti načtené', () => {
  const ctx = { self: {} };
  for (const f of ['core.js', 'rolefit.js', 'tableimport.js', 'dwrs.js', 'fm27know.js', 'tacticanalysis.js']) {
    vm.runInNewContext(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), ctx);
  }
  assert.equal(typeof ctx.self.TrenerTacticAnalysis.analyze, 'function');
});

test('zdroj neobsahuje neviditelné ani řídicí znaky kromě odřádkování', () => {
  const bad = source.match(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu) || [];
  assert.deepEqual(bad.filter((ch) => ch !== '\n'), []);
});
