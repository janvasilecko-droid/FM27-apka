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

test('summaryLines: souhrn pro kopírování a pro Osobního trenéra má pokrytí, nálezy se štítkem původu, počty kontrol, nevyhodnocená pravidla a poznámku', () => {
  const r = A.analyze(tac('4-3-3', { ti: ['Defensive Line: Lower', 'Line of Engagement: High Press'], mentality: 'Balanced' }), {});
  const lines = A.summaryLines(r);
  assert.match(lines[0], /Rozbor taktiky 4-3-3: mentalita Balanced, instrukcí rozpoznáno 2 z 27/);
  assert.ok(lines.some((l) => /\[A01, KOMUNITA, 3 zdroje\]/.test(l) && /Defensive Line → Standard/.test(l)), 'nález nese id, druh zdroje a shodu zdrojů (revize č. 2, B7)');
  assert.ok(lines.every((l) => !/^(Vážný rozpor|Upozornění|Poznámka|K vědomí|Silná stránka) \[[A-Z]\d+b?\]/.test(l)), 'žádný nález bez štítku původu');
  assert.match(lines.find((l) => /^Kontroly:/.test(l)), /Kontroly: vyhodnoceno \d+ z 42 \(bez nálezu \d+, nález \d+, silných stránek \d+\)/);
  const miss = lines.find((l) => /^Nevyhodnoceno/.test(l));
  assert.ok(miss && r.checks.notEvaluated.every((x) => miss.includes(x.id)), 'všechna nevyhodnocená pravidla jsou vypsaná');
  assert.equal(lines[lines.length - 1], r.note, 'poslední řádek říká, že jde o pomůcku, ne o pravidlo FM27 a ne o předpověď');
  const full = A.analyze(tac('4-3-3', { roles: withIn({}) }), {});
  assert.equal(full.checks.evaluated, full.checks.passed + full.checks.fired + full.checks.strengths, 'vyhodnoceno = bez nálezu + nález + silné stránky (revize č. 2, B9)');
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

// ================================================================ revize č. 2 (7. 11. 2026)
// Nezávislý revizor prošel 42 pravidel; každý nález se nejdřív ověřil zkouškou, která na starém kódu selhala (docs/REVIZE_ROZBOR_SESTAVY_A_TAKTIKY_2026-11-07.md).

const verdictOf = (id, t, players) => {
  const rule = A.RULE_BY_ID.get(id);
  const v = rule.test(A.buildContext(t, { players: players || [] }));
  return v === undefined ? 'U' : v === A.NA ? 'NA' : v === null ? 'P' : 'F:' + (v.sev || rule.sev);
};
const unevaluated = (r, id) => r.checks.notEvaluated.some((x) => x.id === id);

test('správné částečné vyhodnocení: výsledek při neúplných údajích je stejný při každém doplnění chybějících údajů (nález nezmizí, „v pořádku“ nevznikne z neznámého)', () => {
  const ATTRS = ['Pace', 'Acceleration', 'Stamina', 'Work Rate', 'Passing', 'Composure', 'First Touch'];
  const formations = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '5-3-2', '4-1-2-1-2', '4-4-1-1', '4-3-2-1', '4-1-4-1', '3-4-3'].filter((f) => T.FORMATIONS.some((x) => x.id === f));
  assert.ok(formations.length >= 8, 'zkouší se víc rozestavení');
  const RANK = { error: 0, warn: 1, note: 2, info: 3, good: 4 };
  let checked = 0;
  for (const startSeed of [7, 2026, 90210]) {
    let seed = startSeed;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const ri = (n) => Math.floor(rnd() * n);
    const pick = (a) => a[ri(a.length)];
    const fullSpec = (formation) => {
      const t = T.makeTactic({ formation, name: 'z' });
      const instr = {};
      for (const i of K.TEAM_INSTRUCTIONS) if (!i.gameOnly) instr[i.id] = pick(i.values);
      return {
        formation,
        mentality: pick(K.MENTALITIES),
        instr,
        roles: t.slots.map((s) => {
          const g = K.groupOfPos(s.pos);
          return { inn: g ? pick(K.ROLES_IN[g]) : null, out: g ? pick(K.ROLES_OUT[g]) : null };
        }),
        attrs: t.slots.map(() => Object.fromEntries(ATTRS.map((a) => [a, 1 + ri(20)]))),
      };
    };
    const build = (spec, known) => {
      const t = T.makeTactic({ formation: spec.formation, name: 'z' });
      t.mentality = known.mentality ? spec.mentality : '';
      t.teamInstructions = Object.entries(spec.instr).filter(([id]) => known.instr[id]).map(([id, v]) => `${K.TEAM_BY_ID.get(id).name}: ${v}`);
      const players = [];
      t.slots.forEach((s, i) => {
        if (known.roleIn[i] && spec.roles[i].inn) s.role = spec.roles[i].inn;
        if (known.roleOut[i] && spec.roles[i].out) s.oopRole = spec.roles[i].out;
        if (known.attr[i]) {
          players.push({ id: 'p' + i, name: 'p' + i, positions: [], age: 26, attributes: Object.fromEntries(ATTRS.filter((n) => known.names[i][n]).map((n) => [n, spec.attrs[i][n]])) });
          s.playerId = 'p' + i;
        }
      });
      return A.buildContext(t, { players });
    };
    const verdicts = (ctx) => Object.fromEntries(A.RULES.map((r) => {
      const v = r.test(ctx);
      return [r.id, v === undefined ? 'U' : v === A.NA ? 'NA' : v === null ? 'P' : 'F:' + (v.sev || r.sev)];
    }));
    const everything = (spec) => ({ mentality: true, instr: Object.fromEntries(Object.keys(spec.instr).map((id) => [id, true])), roleIn: spec.roles.map(() => true), roleOut: spec.roles.map(() => true), attr: spec.roles.map(() => true), names: spec.roles.map(() => Object.fromEntries(ATTRS.map((a) => [a, true]))) });
    for (let n = 0; n < 150; n++) {
      const spec = fullSpec(pick(formations));
      const p = 0.25 + rnd() * 0.7;
      const known = { mentality: rnd() < p, instr: Object.fromEntries(Object.keys(spec.instr).map((k) => [k, rnd() < p])), roleIn: spec.roles.map(() => rnd() < p), roleOut: spec.roles.map(() => rnd() < p), attr: spec.roles.map(() => rnd() < p), names: spec.roles.map(() => Object.fromEntries(ATTRS.map((a) => [a, rnd() < p]))) };
      const partial = verdicts(build(spec, known));
      for (let k = 0; k < 8; k++) {
        const other = fullSpec(spec.formation);
        const comp = {
          formation: spec.formation,
          mentality: known.mentality ? spec.mentality : other.mentality,
          instr: Object.fromEntries(Object.keys(spec.instr).map((id) => [id, known.instr[id] ? spec.instr[id] : other.instr[id]])),
          roles: spec.roles.map((r, i) => ({ inn: known.roleIn[i] ? r.inn : other.roles[i].inn, out: known.roleOut[i] ? r.out : other.roles[i].out })),
          attrs: spec.attrs.map((a, i) => Object.fromEntries(ATTRS.map((x) => [x, known.attr[i] && known.names[i][x] ? a[x] : other.attrs[i][x]]))),
        };
        const full = verdicts(build(comp, everything(comp)));
        for (const id of Object.keys(partial)) {
          if (partial[id] === 'U') continue;
          checked++;
          // přísnost nálezu z atributů smí s dalšími údaji jen vzrůst (nález z přečtených hráčů je dolní odhad); jinak musí výsledek zůstat
          const escalates = partial[id].startsWith('F:') && full[id].startsWith('F:') && RANK[full[id].slice(2)] <= RANK[partial[id].slice(2)];
          assert.ok(partial[id] === full[id] || escalates, `${id}: s neúplnými údaji ${partial[id]}, po doplnění ${full[id]} (${spec.formation})`);
        }
      }
    }
  }
  assert.ok(checked > 20000, `zkoušelo se jen ${checked} výsledků`);
});

test('B01, D03: „v pořádku“ jen při známém presinku a při známých atributech celého středu a obrany; z neznámého se nic nehádá', () => {
  const t = tac('4-3-3', { ti: ['Defensive Transition: Standard'] });
  const weak = pl(t, { RCM: { Stamina: 6, 'Work Rate': 6 }, LCM: { Stamina: 15, 'Work Rate': 15 }, DM: { Stamina: 15, 'Work Rate': 15 } });
  assert.equal(verdictOf('B01', t, weak), 'U', 'presink neznáme (jen Defensive Transition: Standard), slabý střed: nevyhodnoceno, ne „prošlo“');
  t.teamInstructions.push('Line of Engagement: High Press');
  assert.equal(verdictOf('B01', t, weak), 'F:error');
  const half = tac('4-3-3', { ti: ['Line of Engagement: High Press'] });
  assert.equal(verdictOf('B01', half, pl(half, { RCM: { Stamina: 17, 'Work Rate': 17 } })), 'U', 'atributy známe jen u jednoho záložníka: dobrý stav jednoho nic neříká o ostatních');
  // D03: jen Balanced bez výkopů a rozehry brankáře; stopeři Passing 6
  const d = tac('4-3-3', { ti: ['Build-Up Strategy: Balanced'] });
  const weakCb = pl(d, { RCB: { Passing: 6, Composure: 15, 'First Touch': 15 }, LCB: { Passing: 15, Composure: 15, 'First Touch': 15 }, DM: { Passing: 15, Composure: 15, 'First Touch': 15 } });
  assert.equal(verdictOf('D03', d, weakCb), 'U', 'výkopy a rozehra brankáře nejsou načtené: nevyhodnoceno');
  d.teamInstructions.push('Goal Kicks: Short');
  assert.equal(verdictOf('D03', d, weakCb), 'F:error');
  const dm2 = tac('4-2-3-1', { ti: ['Build-Up Strategy: Play Through Press'] });
  const weakLdm = pl(dm2, { RCB: { Passing: 15, Composure: 15, 'First Touch': 15 }, LCB: { Passing: 15, Composure: 15, 'First Touch': 15 }, RDM: { Passing: 15, Composure: 15, 'First Touch': 15 }, LDM: { Passing: 5, Composure: 5, 'First Touch': 5 } });
  const f = A.analyze(dm2, { players: weakLdm }).findings.find((x) => x.id === 'D03');
  assert.ok(f && f.sev === 'error', 'revize č. 2, B3: slabý druhý defenzivní záložník se posuzuje stejně jako první');
  assert.deepEqual(f.slots, [dm2.slots.find((s) => s.pos === 'LDM').key]);
});

test('A08: viníkem je místo, jehož atribut opravdu vadí (Acceleration druhého stopera, ne Pace prvního); neúplná znalost atributů se řekne', () => {
  const t = tac('4-3-3', { ti: ['Defensive Line: Higher'] });
  const f = A.analyze(t, { players: pl(t, { RCB: { Pace: 14, Acceleration: 16 }, LCB: { Pace: 15, Acceleration: 8 } }) }).findings.find((x) => x.id === 'A08');
  assert.ok(f && f.sev === 'warn');
  assert.deepEqual(f.slots, [t.slots.find((s) => s.pos === 'LCB').key]);
  assert.ok(f.ev.some((e) => /LCB: Acceleration 8/.test(e)) && !f.ev.some((e) => /RCB: Pace/.test(e)), f.ev.join(' | '));
  const one = tac('4-3-3', { ti: ['Defensive Line: Higher'] });
  const g = A.analyze(one, { players: pl(one, { RCB: { Pace: 5, Acceleration: 6 } }) }).findings.find((x) => x.id === 'A08');
  assert.ok(g && g.sev === 'error' && g.ev.some((e) => /Pozor: atributy znám jen u některých hráčů/.test(e)), 'jistý nález z jednoho stopera nese upozornění, že druhý stoper není načtený');
  const ok = tac('4-3-3', { ti: ['Defensive Line: Higher'] });
  assert.equal(verdictOf('A08', ok, pl(ok, { RCB: { Pace: 17, Acceleration: 17 } })), 'U', 'jediný rychlý stoper z dvou nestačí na „v pořádku“');
});

test('A12: spouští se jen bez vysokého presinku (nízká linie při High Press je věc pravidla A01) a rada nevyrobí rozpor', () => {
  const t = tac('4-3-3', { ti: ['Short Goalkeeper Distribution: Yes', 'Line of Engagement: High Press', 'Defensive Line: Lower'] });
  const r = A.analyze(t, {});
  assert.ok(!ids(r).includes('A12'), 'titulek říká „bez vysokého presinku“');
  const mid = tac('4-3-3', { ti: ['Short Goalkeeper Distribution: Yes', 'Line of Engagement: Mid Block', 'Defensive Line: Lower'] });
  const f = find(A.analyze(mid, {}), 'A12');
  assert.ok(f);
  // rada: samotné „Line of Engagement → High Press“ by s nízkou linií vyrobilo A01; druhá rada proto říká i obrannou linii
  assert.match(f.fix[1], /High Press spolu s Defensive Line → Higher/);
  const fixed = tac('4-3-3', { ti: ['Short Goalkeeper Distribution: Yes', 'Line of Engagement: High Press', 'Defensive Line: Higher'] });
  assert.deepEqual(ids(A.analyze(fixed, {})).filter((id) => ['A12', 'A01', 'A02'].includes(id)), []);
  assert.equal(verdictOf('A12', tac('4-3-3', { ti: ['Short Goalkeeper Distribution: Yes'] })), 'U', 'linii zapojení neznáme');
  assert.equal(verdictOf('A12', tac('4-3-3', { ti: ['Short Goalkeeper Distribution: Yes', 'Line of Engagement: Low Block'] })), 'F:note', 'i nízký blok je blok bez vysokého presinku');
});

test('B03: nízký blok s tvrdým nasazením jen při Low Block; Regroup při High Press není nízký blok', () => {
  const t = tac('4-3-3', { ti: ['Line of Engagement: High Press', 'Defensive Transition: Regroup', 'Tackling: Get Stuck In'] });
  assert.ok(!ids(A.analyze(t, {})).includes('B03'));
  assert.equal(verdictOf('B03', tac('4-3-3', { ti: ['Tackling: Get Stuck In'] })), 'U');
  assert.equal(verdictOf('B03', tac('4-3-3', { ti: ['Line of Engagement: Low Block', 'Tackling: Get Stuck In'] })), 'F:note');
});

test('C02, C03, C14, D01: jedno přečtené „v pořádku“ nestačí, když druhá větev podmínky zůstává neznámá', () => {
  assert.equal(verdictOf('C02', tac('4-3-3', { ti: ['Attacking Transition: Counter-Attack', 'Patience: Standard'] })), 'U', 'Passing Directness neznáme');
  assert.equal(verdictOf('C02', tac('4-3-3', { ti: ['Attacking Transition: Counter-Attack', 'Patience: Standard', 'Passing Directness: Standard'] })), 'P');
  assert.equal(verdictOf('C03', tac('4-3-3', { ti: ['Tempo: Much Higher', 'Passing Directness: Standard'] })), 'U', 'Patience neznáme');
  assert.equal(verdictOf('C14', tac('4-3-3', { ti: ['Pass Reception: Pass Into Space', 'Patience: Standard'] })), 'U');
  assert.equal(verdictOf('D01', tac('4-3-3', { ti: ['Build-Up Strategy: Play Through Press', 'Goal Kicks: Mixed'] })), 'U', 'GK Distribution neznáme');
  assert.equal(verdictOf('D01', tac('4-3-3', { ti: ['Build-Up Strategy: Play Through Press', 'Goal Kicks: Mixed', 'GK Distribution: Balanced'] })), 'P');
});

test('C03: rada vede k cíli, ne k dalšímu rozporu (Passing Directness → More Direct při Work Ball Into Box vyrobí C01)', () => {
  const t = tac('4-3-3', { ti: ['Tempo: Much Higher', 'Patience: Work Ball Into Box', 'Passing Directness: Standard'] });
  const f = find(A.analyze(t, {}), 'C03');
  assert.ok(f);
  assert.equal(f.fix[0], 'Tempo → Higher (ne Much Higher)');
  assert.equal(f.fix[1], 'Nebo Patience → Standard', 'spouštěčem je trpělivost, ne krátké přihrávky');
  assert.ok(!f.fix.join(' ').includes('More Direct'));
  for (const ti of [['Tempo: Higher', 'Patience: Work Ball Into Box', 'Passing Directness: Standard'], ['Tempo: Much Higher', 'Patience: Standard', 'Passing Directness: Standard']]) {
    const after = ids(A.analyze(tac('4-3-3', { ti }), {}));
    assert.ok(!after.includes('C03') && !after.includes('C01'), after.join());
  }
  const both = find(A.analyze(tac('4-3-3', { ti: ['Tempo: Much Higher', 'Patience: Work Ball Into Box', 'Passing Directness: Shorter'] }), {}), 'C03');
  assert.equal(both.fix[1], 'Nebo Passing Directness → Standard a Patience → Standard');
  const shortOnly = find(A.analyze(tac('4-3-3', { ti: ['Tempo: Much Higher', 'Patience: Hit Early Crosses', 'Passing Directness: Shorter'] }), {}), 'C03');
  assert.equal(shortOnly.fix[1], 'Nebo Passing Directness → Standard');
});

test('A03: rada o obranné linii nevyrobí rozpor s linií zapojení (u Low Block ji řeší Regroup, u High Press stačí Higher)', () => {
  const low = find(A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower', 'Line of Engagement: Low Block'] }), {}), 'A03');
  assert.ok(low && /Regroup/.test(low.fix[0]) && !/Defensive Line → /.test(low.fix.join(' ')), low.fix.join(' | '));
  const high = find(A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower', 'Line of Engagement: High Press'] }), {}), 'A03');
  assert.match(high.fix[0], /^Defensive Line → Higher/);
  const after = ids(A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Higher', 'Line of Engagement: High Press'] }), {}));
  assert.ok(!after.includes('A03') && !after.includes('A01') && !after.includes('A02'), after.join());
  const mid = find(A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower', 'Line of Engagement: Mid Block'] }), {}), 'A03');
  assert.match(mid.fix[0], /^Defensive Line → Standard/);
  const unknown = find(A.analyze(tac('4-3-3', { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower'] }), {}), 'A03');
  assert.deepEqual(unknown.fix, A.RULE_BY_ID.get('A03').fix, 'bez linie zapojení zůstává základní rada');
});

test('A08: rada nezmiňuje Line of Engagement, který pravidlo nečte', () => {
  assert.ok(!A.RULE_BY_ID.get('A08').fix.join(' ').includes('Line of Engagement'));
});

test('D03: rada se týká toho, co nález opravdu spouští (GK Distribution: Centre-Backs)', () => {
  const t = tac('4-3-3', { ti: ['Build-Up Strategy: Balanced', 'Goal Kicks: Mixed', 'GK Distribution: Centre-Backs'] });
  const players = pl(t, { RCB: { Passing: 6, Composure: 15, 'First Touch': 15 }, LCB: { Passing: 15, Composure: 15, 'First Touch': 15 }, DM: { Passing: 15, Composure: 15, 'First Touch': 15 } });
  const f = find(A.analyze(t, { players }), 'D03');
  assert.ok(f);
  assert.ok(f.ev.some((e) => /Centre-Backs/.test(e)));
  assert.match(f.fix[0], /GK Distribution → Balanced/);
  assert.ok(!/Bypass Press|Goal Kicks|Build-Up/.test(f.fix[0]), 'rada nezmiňuje instrukce, které nález nespouštějí: ' + f.fix[0]);
  const after = tac('4-3-3', { ti: ['Build-Up Strategy: Balanced', 'Goal Kicks: Mixed', 'GK Distribution: Balanced'] });
  assert.ok(!ids(A.analyze(after, { players: pl(after, { RCB: { Passing: 6, Composure: 15, 'First Touch': 15 }, LCB: { Passing: 15, Composure: 15, 'First Touch': 15 }, DM: { Passing: 15, Composure: 15, 'First Touch': 15 } }) })).includes('D03'));
  const all3 = tac('4-3-3', { ti: ['Build-Up Strategy: Play Through Press', 'Goal Kicks: Short', 'GK Distribution: Centre-Backs'] });
  const g = find(A.analyze(all3, { players: pl(all3, { RCB: { Passing: 6, Composure: 15, 'First Touch': 15 }, LCB: { Passing: 15, Composure: 15, 'First Touch': 15 }, DM: { Passing: 15, Composure: 15, 'First Touch': 15 } }) }), 'D03');
  assert.equal(g.fix[0], 'Změnit všechno, co stahuje rozehru na stopery: Build-Up Strategy → Balanced, Goal Kicks → Mixed, GK Distribution → Balanced');
});

test('E01: pravidlo jde ve všech rozestavěních splnit (práci, kterou role pro místa středu nenabízejí, nežádá) a rada říká, kolik změn je potřeba', () => {
  let checkedFormations = 0;
  for (const fm of T.FORMATIONS) {
    const t = T.makeTactic({ formation: fm.id, name: 'x' });
    let mids = t.slots.filter((s) => ['DM', 'M (C)'].includes(K.groupOfPos(s.pos)));
    if (mids.length === 2) mids = mids.concat(t.slots.filter((s) => K.groupOfPos(s.pos) === 'AM (C)'));
    if (mids.length < 3) continue;
    checkedFormations++;
    const options = mids.map((s) => K.ROLES_IN[K.groupOfPos(s.pos)]);
    let satisfiable = false;
    const walk = (i, chosen) => {
      if (satisfiable) return;
      if (i === mids.length) {
        mids.forEach((s, j) => { s.role = chosen[j]; });
        if (A.RULE_BY_ID.get('E01').test(A.buildContext(t, {})) === null) satisfiable = true;
        return;
      }
      for (const r of options[i]) walk(i + 1, chosen.concat(r));
    };
    walk(0, []);
    assert.ok(satisfiable, `${fm.id}: žádné obsazení středu nezruší E01`);
  }
  assert.ok(checkedFormations >= 8, `ověřeno ${checkedFormations} rozestavení`);
  // ve 4-4-1-1 role držáka pro střed neexistuje: chybějící držák se nežádá, ale běžec a tvůrce ano
  const t = tac('4-4-1-1', { roles: { RCM: 'Central Midfielder', LCM: 'Central Midfielder', AM: 'Attacking Midfielder' } });
  const f = find(A.analyze(t, {}), 'E01');
  assert.ok(f && f.ev.some((e) => /chybí: běžec, tvůrce/.test(e)) && !f.ev.some((e) => /držák/.test(e)), f && f.ev.join(' | '));
  assert.match(f.fix[0], /^Změnit DVĚ role .*jedna změna nestačí/);
  assert.ok(!/Defensive Midfielder|Half Back/.test(f.fix[0]), 'rada nenabízí roli, kterou hra pro tato místa nemá');
  const one = tac('4-3-3', { roles: withIn({ DM: 'Defensive Midfielder', RCM: 'Channel Midfielder', LCM: 'Central Midfielder' }) });
  assert.match(find(A.analyze(one, {}), 'E01').fix[0], /^Změnit JEDNU roli ve středu na chybějící práci \(tvůrce: /);
  assert.equal(verdictOf('E01', tac('4-4-1-1', { roles: { RCM: 'Channel Midfielder', LCM: 'Advanced Playmaker', AM: 'Attacking Midfielder' } })), 'P');
  assert.equal(verdictOf('E01', tac('4-4-1-1', { roles: { RCM: 'Central Midfielder' } })), 'U', 'další role by mohly práci dodat');
});

test('H01: jeden hráč s Outlet rolí bez míče i rolí s míčem, která běhá dopředu, je jeden hráč, ne dva', () => {
  const base = mergeRoles(withIn({ RW: 'Wide Forward' }), { ...FULL_433_OUT, RW: [null, 'Wide Outlet Winger'] });
  const one = tac('4-3-3', { mentality: 'Cautious', ti: ['Defensive Line: Lower'], roles: base });
  assert.ok(!ids(A.analyze(one, {})).includes('H01'));
  assert.equal(verdictOf('H01', one), 'P');
  const two = tac('4-3-3', { mentality: 'Cautious', ti: ['Defensive Line: Lower'], roles: mergeRoles(withIn({ RW: 'Wide Forward' }), { ...FULL_433_OUT, RW: [null, 'Wide Outlet Winger'], LW: [null, 'Wide Outlet Winger'] }) });
  const f = find(A.analyze(two, {}), 'H01');
  assert.ok(f);
  assert.deepEqual([...new Set(f.slots)].sort(), f.slots.slice().sort(), 'místo se v nálezu neopakuje');
  assert.equal(f.slots.length, 2);
});

test('H01, G07: vyšší linie a Trigger Press „Standard“ jsou vyhodnocené „v pořádku“ (nevztahuje se), bez přečtených rolí se nevyhodnotí', () => {
  assert.equal(verdictOf('H01', tac('4-3-3', { mentality: 'Cautious', ti: ['Defensive Line: Higher'] })), 'P', 'revize č. 2, B1: dřív „nevyhodnoceno“ i při úplných údajích');
  assert.equal(verdictOf('H01', tac('4-3-3', { mentality: 'Cautious', ti: ['Defensive Line: Lower'] })), 'U', 'bez jediné role se nedá říct, že víc hráčů nezůstává vysoko');
  assert.equal(verdictOf('G07', tac('4-3-3', { ti: ['Trigger Press: Less Often'] })), 'U', 'bez jediné role bez míče se nedá říct, že žádná nepresuje');
  assert.equal(verdictOf('G07', tac('4-3-3', { ti: ['Trigger Press: Standard'] })), 'P');
});

test('G06: s jedinou přečtenou Outlet rolí a nepřečtenými zbylými rolemi se „v pořádku“ neříká', () => {
  const t = tac('4-3-3', { roles: { RW: [null, 'Wide Outlet Winger'] } });
  assert.equal(verdictOf('G06', t), 'U');
  const full = tac('4-3-3', { roles: mergeRoles(FULL_433, { ...FULL_433_OUT, RW: [null, 'Wide Outlet Winger'] }) });
  assert.equal(verdictOf('G06', full), 'U', 'Defensive Transition neznáme: Counter-Press by s jednou Outlet rolí byl nález');
  const known = tac('4-3-3', { ti: ['Defensive Transition: Regroup'], roles: mergeRoles(FULL_433, { ...FULL_433_OUT, RW: [null, 'Wide Outlet Winger'] }) });
  assert.equal(verdictOf('G06', known), 'P');
  assert.ok(!/až dvě/.test(A.RULE_BY_ID.get('G06').fix.join(' ')), 'rada nesmí dovolit dvě Outlet role, když nález začíná od dvou');
});

test('C06, E02, F01, F02: bok s nepřečtenou rolí se nevyhodnotí jako „v pořádku“; nález z přečtené části zůstává', () => {
  // pravé křídlo drží lajnu, levé nečitelné
  const half = tac('4-3-3', { roles: { RB: 'Full-Back', RW: 'Winger', LB: 'Ball Playing Defender', LW: 'Ball Playing Defender' } });
  assert.equal(verdictOf('C06', half), 'U');
  // levé křídlo celé vnitřní (nález z přečtené části), pravé nečitelné
  const bad = tac('4-3-3', { roles: { LB: 'Inside Full-Back', LW: 'Inside Winger', RB: 'Ball Playing Defender' } });
  assert.equal(verdictOf('C06', bad), 'F:error');
  // E02: dva držáci a role před nimi nečitelná
  const e2 = tac('4-2-3-1', { roles: { RDM: 'Defensive Midfielder', LDM: 'Half Back', AM: 'Ball Playing Defender' } });
  assert.equal(verdictOf('E02', e2), 'U');
  assert.equal(verdictOf('E02', tac('4-2-3-1', { roles: { RDM: 'Defensive Midfielder', LDM: 'Half Back', AM: 'Attacking Midfielder' } })), 'F:warn');
  // F01 a F02: jedno přečtené křídlo nestačí na „žádný souběh“ ani na „žádná dobře sedící dvojice“
  const f1 = tac('4-3-3', { roles: { RB: 'Full-Back', RW: 'Winger', LB: 'Ball Playing Defender' } });
  assert.equal(verdictOf('F01', f1), 'U');
  assert.equal(verdictOf('F02', f1), 'U');
});

test('F01, F02: u rozestavení, kde na jedné lajně nestojí dva hráči (3-5-2, 5-3-2, 4-1-2-1-2), se pravidla nevztahují (ne „vyhodnoceno“)', () => {
  for (const f of ['3-5-2', '5-3-2', '4-1-2-1-2']) {
    const t = T.makeTactic({ formation: f, name: 'x' });
    assert.equal(verdictOf('F01', t), 'NA', f);
    assert.equal(verdictOf('F02', t), 'NA', f);
  }
  assert.notEqual(verdictOf('F01', T.makeTactic({ formation: '4-3-3', name: 'x' })), 'NA');
});

test('F04: rada nabízí jen role s míčem (Holding Wing-Back je role bez míče a pravidlo ji nečte)', () => {
  const f = find(A.analyze(tac('4-3-3', { roles: withIn({ RB: 'Wing-Back', LB: 'Wing-Back' }) }), {}), 'F04');
  assert.ok(f && !/Holding Wing-Back/.test(f.fix.join(' ')));
  for (const role of ['Full-Back', 'Inside Full-Back', 'Inside Wing-Back', 'Playmaking Wing-Back']) {
    assert.ok(f.fix[0].includes(role), role);
    assert.equal(verdictOf('F04', tac('4-3-3', { roles: withIn({ RB: 'Wing-Back', LB: role === 'Full-Back' || role === 'Inside Full-Back' ? role : 'Wing-Back' }) })), role === 'Full-Back' || role === 'Inside Full-Back' ? 'P' : 'F:warn');
  }
});

test('C07: podběh jedním bokem potřebuje běžce na té straně nebo ve středu a nález ukazuje na boční místa; nepřečtená instrukce nebo role se nevyhodnotí', () => {
  const t = tac('4-3-3', { ti: ['Underlap: Left', 'Overlap: Balanced'], roles: withIn({ RCM: 'Channel Midfielder' }) });
  const f = find(A.analyze(t, {}), 'C07');
  assert.ok(f, 'jediný běžec je vpravo, podběh míří vlevo');
  assert.ok(f.slots.length > 0 && f.slots.every((k) => ['LB', 'LW'].includes(t.slots.find((s) => s.key === k).pos)));
  const ok = tac('4-3-3', { ti: ['Underlap: Left', 'Overlap: Balanced'], roles: withIn({ LCM: 'Channel Midfielder' }) });
  assert.ok(!ids(A.analyze(ok, {})).includes('C07'));
  assert.equal(verdictOf('C07', tac('4-3-3', { ti: ['Overlap: Both Flanks'], roles: withIn({ RB: 'Wing-Back', LB: 'Advanced Wing-Back' }) })), 'U', 'Underlap neznáme');
  assert.equal(verdictOf('C07', tac('4-3-3', { ti: ['Overlap: Both Flanks', 'Underlap: Balanced'], roles: { RB: 'Wing-Back', LB: 'Ball Playing Defender' } })), 'U', 'levý bok nečitelný');
});

test('počty a pokrytí: hráč bez atributů se nepočítá do pokrytí atributy; vyhodnoceno = bez nálezu + nález + silné stránky; odolnost proti prázdným místům', () => {
  const t = tac('4-3-3', { ti: ['Defensive Line: Higher'] });
  t.slots.forEach((s) => { s.playerId = 'e' + s.key; });
  const empty = t.slots.map((s) => ({ id: 'e' + s.key, name: 'x', attributes: {} }));
  const r = A.analyze(t, { players: empty });
  assert.equal(r.coverage.withAttributes, 0);
  t.slots.slice(0, 3).forEach((s, i) => { empty[i].attributes = { Pace: 10 }; });
  assert.equal(A.analyze(t, { players: empty }).coverage.withAttributes, 3);
  assert.doesNotThrow(() => A.analyze({ formation: '4-3-3', slots: [null, { key: 'a', pos: 'ST' }, 5] }, {}), 'null a nesmysl v seznamu míst nesmí shodit rozbor');
  const gkOnly = { formation: 'x', slots: [{ key: 'g', pos: 'GK', role: 'Goalkeeper', oopRole: 'Goalkeeper' }] };
  for (const id of ['C07', 'C10', 'G06', 'G07', 'H01']) assert.notEqual(verdictOf(id, Object.assign({ mentality: 'Cautious', teamInstructions: ['Creative Freedom: More Disciplined', 'Trigger Press: Less Often', 'Defensive Line: Lower', 'Overlap: Both Flanks', 'Underlap: Both Flanks'] }, gkOnly)), 'P', `${id} bez hráčů v poli nic neposoudí`);
});

test('parseInstruction: rozpor mezi názvem a hodnotou se nehádá (název instrukce neodpovídá hodnotě → nerozpoznáno)', () => {
  assert.equal(K.parseInstruction('Tackling: Counter-Press'), null);
  assert.equal(K.parseInstruction('Defensive Line Behaviour: Higher'), null);
  assert.equal(K.parseInstruction('Passing Directness: Narrower'), null);
  // běžné zápisy zůstávají: celé hodnoty bez názvu i s názvem
  assert.equal(K.parseInstruction('Counter-Press').id, 'defensiveTransition');
  assert.equal(K.parseInstruction('Out of Possession: Counter-Press').id, 'defensiveTransition');
  assert.equal(K.parseInstruction('Defensive Transition: Counter-Press').value, 'Counter-Press');
  assert.equal(K.parseInstruction('Defensive Line Behaviour: Step Up More').id, 'defensiveLineBehaviour');
  assert.equal(K.parseInstruction('Defensive Line: Higher').id, 'defensiveLine');
  assert.equal(K.parseInstruction('Attacking Width: Narrower').id, 'attackingWidth');
});

test('všechny rady (statické i upřesněné podle nálezu) používají jen skutečné instrukce a hodnoty slovníku', () => {
  const check = (fix, label) => {
    for (const t of K.TEAM_INSTRUCTIONS) {
      let from = 0;
      for (;;) {
        const i = fix.indexOf(`${t.name} → `, from);
        if (i < 0) break;
        from = i + 1;
        const rest = fix.slice(i + t.name.length + 3);
        assert.ok(t.values.some((v) => rest.startsWith(v)), `${label}: „${t.name} → ${rest.slice(0, 25)}“ není hodnota instrukce`);
      }
    }
  };
  const cases = [
    { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower', 'Line of Engagement: Low Block'] },
    { ti: ['Defensive Transition: Counter-Press', 'Defensive Line: Lower', 'Line of Engagement: High Press'] },
    { ti: ['Tempo: Much Higher', 'Patience: Work Ball Into Box', 'Passing Directness: Shorter'] },
    { ti: ['Tempo: Much Higher', 'Patience: Work Ball Into Box'] },
    { ti: ['Tempo: Much Higher', 'Passing Directness: Shorter'] },
    { f: '4-4-1-1', roles: { RCM: 'Central Midfielder', LCM: 'Central Midfielder', AM: 'Attacking Midfielder' } },
  ];
  for (const o of cases) for (const f of A.analyze(tac(o.f || '4-3-3', o), {}).findings) f.fix.forEach((x) => check(x, f.id));
});
