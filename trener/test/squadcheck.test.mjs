import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const T = require('../src/tactics.js');
const D = require('../src/dwrs.js');
const PA = require('../src/posattrs.js');
const RF = require('../src/rolefit.js');
const S = require('../src/squadcheck.js');
const source = readFileSync(new URL('../src/squadcheck.js', import.meta.url), 'utf8');

let n = 0;
const outfield = (base, over) => Object.assign(Object.fromEntries(D.OUTFIELD_ATTRIBUTES.map((a) => [a, base])), over || {});
const keeper = (base, over) => Object.assign(Object.fromEntries(D.GK_ATTRIBUTES.map((a) => [a, base])), over || {});
const P = (name, positions, age, base, over, flags) => ({ id: `p${++n}`, name, positions, age, attributes: positions[0] === 'GK' ? keeper(base, over) : outfield(base, over), flags: flags || { injury: false, fatigue: false } });
const tac = (f = '4-3-3') => T.makeTactic({ formation: f, name: 'zkouška' });
const ids = (r) => r.findings.map((f) => f.id);
const strength = (r) => r.strengths.map((f) => f.id);

// kádr s dobrou hloubkou na všech skupinách (4-3-3: GK 1, FB 2, CB 2, DM 1, CM 2, W 2, ST 1)
function fullSquad() {
  return [
    P('GK1', ['GK'], 29, 14), P('GK2', ['GK'], 22, 12),
    P('CB1', ['DC'], 27, 14), P('CB2', ['DC'], 26, 13), P('CB3', ['DC'], 25, 13), P('CB4', ['DC'], 20, 11),
    P('RB1', ['DR'], 26, 13), P('RB2', ['DR'], 22, 12), P('LB1', ['DL'], 27, 13), P('LB2', ['DL'], 21, 12),
    P('DM1', ['DM'], 28, 14), P('DM2', ['DM'], 24, 12),
    P('CM1', ['MC'], 26, 13), P('CM2', ['MC'], 25, 13), P('CM3', ['MC'], 23, 12), P('CM4', ['MC'], 28, 12),
    P('RW1', ['AMR'], 24, 14), P('RW2', ['AMR'], 21, 12), P('LW1', ['AML'], 25, 13), P('LW2', ['AML'], 22, 12),
    P('ST1', ['ST'], 27, 15), P('ST2', ['ST'], 23, 13),
  ];
}

test('kádr s dobrou hloubkou: rozbor je použitelný, nemá díry ani chybějící zálohy a všech 11 míst je obsazeno', () => {
  const r = S.analyze(tac(), fullSquad());
  assert.equal(r.usable, true);
  assert.equal(r.xi.length, 11);
  assert.ok(r.xi.every((e) => e.best && e.best.score !== null));
  assert.ok(!ids(r).some((id) => ['G1', 'G2'].includes(id)), `nálezy: ${ids(r)}`);
  assert.ok(r.depth.every((d) => d.state === 'ok'));
  assert.equal(new Set(r.xi.map((e) => e.best.id)).size, 11, 'žádný hráč dvakrát');
});

test('G1: na skupinu pozic nejsou hráči ani na základ (jediný stoper pro dvě místa)', () => {
  const sq = fullSquad().filter((p) => !['CB2', 'CB3', 'CB4'].includes(p.name));
  const r = S.analyze(tac(), sq);
  const g1 = r.findings.find((f) => f.id === 'G1');
  assert.ok(g1, ids(r).join());
  assert.equal(g1.sev, 'error');
  assert.match(g1.title, /RCB, LCB/);
  assert.ok(g1.fix.length >= 1 && g1.fix[0].includes('pozici RCB, LCB'));
  assert.ok(r.xi.some((e) => e.pos === 'LCB' && e.best === null) || r.xi.some((e) => e.pos === 'RCB' && e.best === null), 'jedno z míst zůstane prázdné');
});

test('G2: přesně tolik hráčů, kolik míst (žádná záloha), je upozornění s návrhem, co udělat', () => {
  const sq = fullSquad().filter((p) => !['RW2', 'LW2'].includes(p.name));
  const r = S.analyze(tac(), sq);
  const g = r.findings.find((f) => f.id === 'G2' && /křídlo/.test(f.title));
  assert.ok(g);
  assert.equal(g.sev, 'warn');
  assert.ok(g.fix.some((x) => /Přivést 2 hráče na pozici RW, LW/.test(x)), g.fix.join('|'));
  assert.ok(g.fix.some((x) => /Přestupy/.test(x)));
});

test('G3: záloha existuje, ale je pod cílem dvou hráčů na místo (poznámka)', () => {
  const sq = fullSquad().filter((p) => p.name !== 'CM4' && p.name !== 'CM3');
  const r = S.analyze(tac(), sq);
  const g = r.findings.find((f) => f.id === 'G2' || f.id === 'G3');
  assert.ok(r.findings.some((f) => f.id === 'G2' && /střední záložník/.test(f.title)), 'dva hráči na dvě místa = žádná záloha');
  const sq2 = fullSquad().filter((p) => p.name !== 'CM4');
  const r2 = S.analyze(tac(), sq2);
  const g3 = r2.findings.find((f) => f.id === 'G3');
  assert.ok(g3 && /střední záložník/.test(g3.title) && g3.sev === 'note');
  void g;
});

test('G4: dost hráčů, ale málo přirozených (hráč s pozicí z jiné skupiny se v přísném režimu nepočítá, volné pozice ano)', () => {
  const sq = fullSquad().filter((p) => !['LB2'].includes(p.name));
  const noPos = P('Bez pozice', [], 24, 12); // pozice neznámá: aplikace ho pustí s příznakem, ale přirozený není
  const r = S.analyze(tac(), sq.concat([noPos]));
  const fb = r.depth.find((d) => d.group === 'FB');
  assert.equal(fb.state, 'ok');
  assert.equal(fb.natural, 3);
  assert.equal(fb.eligible, 4);
  assert.ok(r.findings.some((f) => f.id === 'G4' && /krajní obránce/.test(f.title)));
});

test('Q1: viditelná slabina v nejdůležitějších atributech základního hráče (uvede atributy a hodnoty)', () => {
  const sq = fullSquad();
  sq.find((p) => p.name === 'CB1').attributes.Marking = 7;
  sq.find((p) => p.name === 'CB1').attributes.Tackling = 8;
  const t = tac();
  t.slots.find((s) => s.pos === 'RCB').playerId = sq.find((p) => p.name === 'CB1').id; // hráč, kterého uživatel nasadil, se posuzuje, i když by ho model nevybral
  const r = S.analyze(t, sq);
  const q = r.findings.find((f) => f.id === 'Q1' && /CB1/.test(f.title));
  assert.ok(q, ids(r).join());
  assert.equal(q.sev, 'warn');
  assert.deepEqual(q.ev.sort(), ['Marking: 7', 'Tackling: 8']);
  assert.ok(q.fix[0].includes('Marking') && q.fix[0].includes('Tackling'));
  assert.equal(q.players.length, 1);
});

test('Q1: slabý atribut jen z důležité (ne nejdůležitější) kategorie je poznámka, ne upozornění', () => {
  const sq = fullSquad();
  sq.find((p) => p.name === 'CB1').attributes.Anticipation = 8; // CB: important
  const t = tac();
  t.slots.find((s) => s.pos === 'RCB').playerId = sq.find((p) => p.name === 'CB1').id;
  const q = S.analyze(t, sq).findings.find((f) => f.id === 'Q1' && /CB1/.test(f.title));
  assert.ok(q);
  assert.equal(q.sev, 'note');
});

test('P1: hráč nasazený mimo své pozice nebo bez známé pozice je poznámka; základní jedenáctka bere hráče, které uživatel zadal, a zbytek doplní model', () => {
  const sq = fullSquad();
  const t = tac();
  const striker = sq.find((p) => p.name === 'ST2');
  t.slots.find((s) => s.pos === 'RW').playerId = striker.id; // útočník na křídle
  const r = S.analyze(t, sq);
  const e = r.xi.find((x) => x.pos === 'RW');
  assert.equal(e.source, 'user');
  assert.equal(e.starter.id, striker.id);
  assert.equal(e.starter.natural, false);
  assert.ok(r.findings.some((f) => f.id === 'P1' && /RW: ST2 hraje mimo své pozice/.test(f.title)));
  assert.ok(r.xi.filter((x) => x.source === 'model').length === 10, 'ostatních deset míst doplnil model');
  assert.equal(new Set(r.xi.map((x) => x.starter && x.starter.id)).size, 11, 'nikdo dvakrát: ST2 je na křídle, takže ho model jinde nepoužil');
  const unknown = fullSquad();
  unknown.find((p) => p.name === 'RW1').positions = [];
  const t2 = tac();
  const r2 = S.analyze(t2, unknown);
  assert.ok(r2.findings.some((f) => f.id === 'P1' && /není známá pozice/.test(f.title)) || !r2.xi.some((x) => x.starter && x.starter.name === 'RW1'));
});

test('Q2: velký propad mezi základním hráčem a nejlepší zálohou (poznámka s čísly)', () => {
  const sq = fullSquad();
  sq.find((p) => p.name === 'ST1').attributes = outfield(17);
  sq.find((p) => p.name === 'ST2').attributes = outfield(8);
  const r = S.analyze(tac(), sq);
  const q = r.findings.find((f) => f.id === 'Q2' && /^ST:/.test(f.title));
  assert.ok(q, ids(r).join());
  assert.equal(q.sev, 'note');
  assert.ok(q.players.length === 2);
});

test('A1: stárnoucí základní hráč bez mladšího nástupce (a bez nálezu, když nástupce je)', () => {
  const sq = fullSquad();
  sq.find((p) => p.name === 'GK1').age = 34;
  sq.find((p) => p.name === 'GK2').age = 31;
  const r = S.analyze(tac(), sq);
  assert.ok(r.findings.some((f) => f.id === 'A1' && /GK1/.test(f.title)));
  sq.find((p) => p.name === 'GK2').age = 22;
  assert.ok(!S.analyze(tac(), sq).findings.some((f) => f.id === 'A1' && /GK1/.test(f.title)));
});

test('věk neznámý: věkové kontroly hráče vynechají a řeknou to', () => {
  const sq = fullSquad();
  for (const p of sq) p.age = null;
  const r = S.analyze(tac(), sq);
  assert.ok(!ids(r).includes('A1'));
  assert.ok(r.notes.some((x) => /chybí věk/.test(x)));
  assert.equal(r.age, null);
});

test('I1 a výměny: zraněný hráč zadaný v taktice je upozornění a nejlepší jedenáctka se bez něj sestaví', () => {
  const sq = fullSquad();
  const t = tac();
  const rcb = t.slots.find((s) => s.pos === 'RCB');
  const hurt = sq.find((p) => p.name === 'CB1');
  hurt.flags.injury = true;
  rcb.playerId = hurt.id;
  const r = S.analyze(t, sq);
  const i1 = r.findings.find((f) => f.id === 'I1');
  assert.ok(i1 && /CB1/.test(i1.title) && i1.sev === 'warn');
  assert.ok(!r.xi.some((e) => e.best && e.best.id === hurt.id), 'zraněný hráč není v nejlepší jedenáctce');
  assert.equal(r.coverage.injured, 1);
});

test('výměny: když má uživatel všech 11 míst obsazeno, aplikace navrhne jen výměny o aspoň swapGain bodů, seřazené podle zisku', () => {
  const sq = fullSquad();
  const t = tac();
  const best = S.analyze(t, sq).xi;
  // uživatel dá na všechna místa nejlepší, kromě křídla (slabší záloha) a útočníka (záloha)
  for (const e of best) t.slots.find((s) => s.key === e.slotKey).playerId = e.best.id;
  t.slots.find((s) => s.pos === 'RW').playerId = sq.find((p) => p.name === 'RW2').id;
  t.slots.find((s) => s.pos === 'ST').playerId = sq.find((p) => p.name === 'ST2').id;
  const r = S.analyze(t, sq);
  assert.equal(r.user.picked, 11);
  assert.ok(r.user.avg < r.user.bestAvg);
  assert.deepEqual(r.swaps.map((x) => x.pos).sort(), ['RW', 'ST']);
  assert.ok(r.swaps[0].gain >= r.swaps[1].gain);
  assert.ok(r.swaps.every((x) => x.gain >= S.DEFAULTS.swapGain));
  // beze všech míst obsazených se výměny nenavrhují
  t.slots.find((s) => s.pos === 'LW').playerId = null;
  assert.deepEqual(S.analyze(t, sq).swaps, []);
});

test('silné stránky: dva klíčové atributy na 15+, dobrá hloubka a průměrný věk 25 až 28', () => {
  const sq = fullSquad();
  sq.find((p) => p.name === 'ST1').attributes = outfield(14, { Finishing: 18, Acceleration: 17, Pace: 16 });
  const r = S.analyze(tac(), sq);
  assert.ok(strength(r).includes('S1'));
  assert.ok(r.strengths.find((f) => f.id === 'S1').ev.length >= 2);
  assert.ok(strength(r).includes('S2'));
  assert.ok(strength(r).includes('S3'), `věk ${r.age && r.age.avgXi}`);
  assert.ok(r.strengths.every((f) => f.sev === 'good' && f.fix.length === 0));
});

test('částečné atributy: od pokrytí 60 % se hráč ohodnotí a je označený, pod ním je „neohodnoceno“ (nikdy nula)', () => {
  const sq = fullSquad();
  const half = sq.find((p) => p.name === 'ST2');
  half.attributes = { Finishing: 15, Pace: 14, Acceleration: 14 }; // jen tři atributy
  const r = S.analyze(tac(), sq);
  assert.ok(r.coverage.partial >= 1 || r.coverage.complete < sq.length);
  const none = sq.find((p) => p.name === 'DM2');
  none.attributes = {};
  const r2 = S.analyze(tac(), sq);
  assert.equal(r2.coverage.none, 1);
  assert.ok(r2.notes.some((x) => /nemá žádné atributy/.test(x)));
  const dm = r2.depth.find((d) => d.group === 'DM');
  assert.equal(dm.eligible, 1, 'hráč bez atributů se do hloubky nepočítá');
});

test('skryté údaje (CA, PA, potenciál) se nepoužijí: stejné skóre s nimi i bez nich', () => {
  const a = fullSquad();
  const b = JSON.parse(JSON.stringify(a));
  for (const p of b) Object.assign(p.attributes, { CA: 20, PA: 20, 'Current Ability': 20, Potential: 20 });
  const ra = S.analyze(tac(), a);
  const rb = S.analyze(tac(), b);
  assert.deepEqual(ra.xi.map((e) => e.best && e.best.score), rb.xi.map((e) => e.best && e.best.score));
});

test('prázdné vstupy: bez hráčů, bez míst a bez použitelných pozic je rozbor nepoužitelný a řekne proč', () => {
  const none = S.analyze(tac(), []);
  assert.equal(none.usable, false);
  assert.match(none.notes[0], /Soupiska je prázdná/);
  const noSlots = S.analyze({ formation: '4-3-3', slots: [] }, fullSquad());
  assert.equal(noSlots.usable, false);
  assert.match(noSlots.notes[0], /žádná místa/);
  const weird = S.analyze({ formation: 'x', slots: [{ key: 's1', pos: 'XYZ' }] }, fullSquad());
  assert.equal(weird.usable, false);
  assert.match(weird.notes[0], /nejde zařadit/);
  assert.equal(S.analyze(null, null).usable, false);
});

test('nejlepší jedenáctka je přesné přiřazení: shoduje se s hrubou silou na malých případech', () => {
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 40; k++) {
    // 3 místa (DM, RCM, LCM) a 5 hráčů s náhodnými atributy, všichni „MC“ nebo „DM“
    const t = tac('4-1-4-1');
    t.slots = t.slots.filter((s) => ['DM', 'RCM', 'LCM'].includes(s.pos));
    const sq = Array.from({ length: 5 }, (_, i) => P('H' + i, [rnd() < 0.5 ? 'DM' : 'MC'], 25, 5, Object.fromEntries(D.OUTFIELD_ATTRIBUTES.map((a) => [a, 1 + Math.floor(rnd() * 20)]))));
    const r = S.analyze(t, sq);
    // hrubá síla: nejlepší součet zisků přes všechny uspořádané trojice různých hráčů, které jsou na místo způsobilé
    const gain = (s, p) => {
      const el = RF.eligibility(s.pos, p.positions, 'strict');
      if (!el.ok) return 0;
      const v = PA.valueOf(PA.score(D.playerAttributes(p), D.groupOfPosition(s.pos)), true, S.DEFAULTS.minCoverage).value;
      return v === null ? 0 : Math.round(v * 10) + 1;
    };
    let top = 0;
    const perm = (used, i, total) => {
      if (i === t.slots.length) return void (top = Math.max(top, total));
      for (let j = -1; j < sq.length; j++) {
        if (j >= 0 && used.has(j)) continue;
        const g = j < 0 ? 0 : gain(t.slots[i], sq[j]);
        used.add(j);
        perm(used, i + 1, total + g);
        used.delete(j);
      }
    };
    perm(new Set([-1]), 0, 0);
    const got = r.xi.reduce((s, e, i) => s + (e.best ? Math.round(e.best.score * 10) + 1 : 0), 0);
    // skóre v rozboru je zaokrouhlené na desetinu: povolená odchylka je zaokrouhlení (1 na místo)
    assert.ok(Math.abs(got - top) <= t.slots.length, `případ ${k}: hrubá síla ${top}, rozbor ${got}`);
  }
});

test('vstupy se nemění a stejný vstup dá stejný výstup', () => {
  const sq = fullSquad();
  const t = tac();
  const before = JSON.stringify([sq, t]);
  const deep = (o) => {
    if (o && typeof o === 'object') {
      Object.freeze(o);
      for (const v of Object.values(o)) deep(v);
    }
    return o;
  };
  const r1 = S.analyze(deep(t), deep(sq));
  assert.equal(JSON.stringify([sq, t]), before);
  const sq2 = fullSquad().map((p, i) => Object.assign(p, { id: sq[i].id }));
  assert.deepEqual(S.analyze(tac(), sq2).xi.map((e) => e.best.score), r1.xi.map((e) => e.best.score));
});

test('odolnost: náhodné kádry a formace nikdy nehodí výjimku, každý hráč je v jedenáctce nejvýš jednou a nálezy ukazují na existující místa a hráče', () => {
  let seed = 99;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pos = ['GK', 'DC', 'DR', 'DL', 'DM', 'MC', 'AMR', 'AML', 'AMC', 'ST', 'WBR', 'MR', 'XX', ''];
  for (let k = 0; k < 120; k++) {
    const t = tac(T.FORMATIONS[Math.floor(rnd() * T.FORMATIONS.length)].id);
    const sq = Array.from({ length: Math.floor(rnd() * 30) }, (_, i) => {
      const positions = rnd() < 0.1 ? [] : [pos[Math.floor(rnd() * pos.length)]];
      const attrs = {};
      for (const a of D.OUTFIELD_ATTRIBUTES.concat(D.GK_ATTRIBUTES)) if (rnd() < 0.8) attrs[a] = rnd() < 0.05 ? 99 : 1 + Math.floor(rnd() * 20);
      return { id: 'r' + i, name: 'Hráč ' + i, positions, age: rnd() < 0.2 ? null : 15 + Math.floor(rnd() * 25), attributes: attrs, flags: { injury: rnd() < 0.1, fatigue: rnd() < 0.1 } };
    });
    for (const s of t.slots) if (sq.length && rnd() < 0.5) s.playerId = sq[Math.floor(rnd() * sq.length)].id;
    const r = S.analyze(t, sq);
    const used = r.xi.filter((e) => e.best).map((e) => e.best.id);
    assert.equal(new Set(used).size, used.length);
    for (const f of r.findings.concat(r.strengths)) {
      assert.ok(['error', 'warn', 'note', 'info', 'good'].includes(f.sev));
      assert.ok(f.slots.every((key) => t.slots.some((s) => s.key === key)));
      assert.ok(f.players.every((id) => sq.some((p) => p.id === id)));
      assert.ok(f.ev.every((e) => typeof e === 'string' && e.length));
      if (f.sev !== 'good') assert.ok(f.fix.length >= 1, f.id);
    }
    const lines = S.summaryLines(r);
    assert.ok(lines.length >= 1);
  }
});

test('texty: bez neviditelných znaků, bez slibů výsledku a se zachovaným označením odhadu', () => {
  const sq = fullSquad().filter((p) => !['CB2', 'CB3', 'CB4', 'RW2', 'LW2'].includes(p.name));
  const r = S.analyze(tac(), sq);
  const all = r.findings.concat(r.strengths).flatMap((f) => [f.title, f.why, ...f.fix, ...f.ev, f.basisCs]);
  for (const text of all) {
    assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text), text);
    assert.ok(!/zabere|vyhraj|zaručen/i.test(text), text);
  }
  assert.ok(r.model.includes('klíčové atributy podle pozice') && r.model.includes('odhad'));
  assert.ok(r.findings.every((f) => /odhad|výpočet|komunitní/i.test(f.basisCs + f.agree)));
});

test('summaryLines: obsahuje pokrytí, nálezy, výměny a nic navíc', () => {
  const sq = fullSquad();
  const t = tac();
  const best = S.analyze(t, sq).xi;
  for (const e of best) t.slots.find((s) => s.key === e.slotKey).playerId = e.best.id;
  t.slots.find((s) => s.pos === 'ST').playerId = sq.find((p) => p.name === 'ST2').id;
  const lines = S.summaryLines(S.analyze(t, sq));
  assert.match(lines[0], /Rozbor sestavy 4-3-3: hráčů 22/);
  assert.ok(lines.some((l) => /^Průměr tvé jedenáctky/.test(l)));
  assert.ok(lines.some((l) => /^Výměna ST: ST2 → ST1/.test(l)));
});

test('modul je čisté UMD: v prohlížeči se přihlásí do globálního objektu, když jsou závislosti načtené', () => {
  const ctx = { self: {} };
  for (const f of ['core.js', 'rolefit.js', 'tableimport.js', 'dwrs.js', 'fm27know.js', 'squadcheck.js']) {
    vm.runInNewContext(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), ctx);
  }
  assert.equal(typeof ctx.self.TrenerSquadCheck.analyze, 'function');
});

test('zdroj neobsahuje neviditelné ani řídicí znaky kromě odřádkování', () => {
  const bad = source.match(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu) || [];
  assert.deepEqual(bad.filter((ch) => ch !== '\n'), []);
});

// ================================================================ revize č. 2 (7. 11. 2026)
// Nálezy nezávislého revizora k rozboru sestavy; každý se nejdřív ověřil zkouškou, která na starém kódu selhala (docs/REVIZE_ROZBOR_SESTAVY_A_TAKTIKY_2026-11-07.md).

test('A1: rovnocenná jedenáctka se zaměněnými stopery a záložníky mezi levou a pravou stranou není „výměna“ (skóre závisí jen na skupině pozic)', () => {
  const sq = fullSquad();
  const base = S.analyze(tac(), sq);
  const best = new Map(base.xi.map((e) => [e.pos, e.best]));
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let withSwap = 0;
  for (let n = 0; n < 60; n++) {
    const t = tac();
    const cb = rnd() < 0.5;
    const cm = rnd() < 0.5;
    const to = { RCB: cb ? 'LCB' : 'RCB', LCB: cb ? 'RCB' : 'LCB', RCM: cm ? 'LCM' : 'RCM', LCM: cm ? 'RCM' : 'LCM' };
    for (const s of t.slots) s.playerId = best.get(to[s.pos] || s.pos).id;
    if (cb || cm) withSwap++;
    const r = S.analyze(t, sq);
    assert.deepEqual(r.swaps, [], `zaměněno stopeři ${cb}, záložníky ${cm}: ${JSON.stringify(r.swaps.map((x) => x.pos))}`);
    assert.equal(r.user.avg, r.user.bestAvg);
  }
  assert.ok(withSwap > 30, 'zkouška opravdu zaměňuje');
  // skutečná výměna zůstává: slabší hráč na místě, kde je lepší k dispozici
  const t = tac();
  for (const s of t.slots) s.playerId = best.get(s.pos).id;
  t.slots.find((s) => s.pos === 'ST').playerId = sq.find((p) => p.name === 'ST2').id;
  assert.deepEqual(S.analyze(t, sq).swaps.map((x) => x.pos), ['ST']);
});

test('I1: náhrada za zraněného hráče je zdravý hráč, ne zraněný sám', () => {
  const sq = fullSquad();
  const t = tac();
  const hurt = sq.find((p) => p.name === 'CB1');
  hurt.flags.injury = true;
  t.slots.find((s) => s.pos === 'RCB').playerId = hurt.id;
  const r = S.analyze(t, sq);
  const i1 = r.findings.find((f) => f.id === 'I1');
  assert.ok(i1);
  assert.ok(!i1.fix[0].includes('CB1'), i1.fix[0]);
  assert.match(i1.fix[0], /^Vyměnit za CB\d/);
  assert.ok(S.summaryLines(r).some((l) => /Vyměnit za CB[2-4]/.test(l) && !/Vyměnit za CB1/.test(l)));
  // bez zdravé náhrady se řekne obecně
  const only = [P('Zraněný stoper', ['DC'], 27, 14, {}, { injury: true, fatigue: false })];
  const t2 = { formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: only[0].id }] };
  assert.equal(S.analyze(t2, only).findings.find((f) => f.id === 'I1').fix[0], 'Vyměnit za dostupného hráče');
});

test('G1 a G5: hráč, kterému chybí atributy, není „chybějící hráč“; rozbor to rozliší a řekne, co načíst', () => {
  // dvanáct hráčů s úplnými pohledy Technické, Psychika, Fyzické; brankář bez pohledu Brankářské (podle dokumentace běžný stav)
  const outfieldOnly = (name, pos) => ({ id: `q${++n}`, name, positions: [pos], age: 27, attributes: outfield(13), flags: {} });
  const sq = [outfieldOnly('Brankář', 'GK'), ...['DC', 'DC', 'DC', 'DR', 'DL', 'DM', 'MC', 'MC', 'AMR', 'AML', 'ST'].map((p, i) => outfieldOnly('H' + i, p))];
  const r = S.analyze(tac(), sq);
  assert.ok(!r.findings.some((f) => f.id === 'G1' && /brankář/.test(f.title)), 'brankář tu je, jen nemá atributy');
  const g5 = r.findings.find((f) => f.id === 'G5' && /brankář/.test(f.title));
  assert.ok(g5, ids(r).join());
  assert.equal(g5.sev, 'warn');
  assert.match(g5.title, /hráči jsou, ale chybí jim atributy/);
  assert.match(g5.fix[0], /^Načti atributy hráčů: Brankář \(pohled Brankářské atributy/);
  assert.ok(!g5.fix.join(' ').includes('Doplnit hráče'), 'rada nesmí posílat kupovat brankáře');
  assert.equal(r.depth.find((d) => d.group === 'GK').state, 'nodata');
  assert.equal(r.depth.find((d) => d.group === 'GK').unrated, 1);
  // opravdu chybějící hráč zůstává G1
  const noKeeper = sq.filter((p) => p.name !== 'Brankář');
  const g1 = S.analyze(tac(), noKeeper).findings.find((f) => f.id === 'G1' && /brankář/.test(f.title));
  assert.ok(g1 && g1.fix[0].startsWith('Doplnit hráče'));
  // sedmnáct hráčů jen s technickými atributy: sestavu nejde posoudit a důvod to říká (ne poznámka o smlouvách)
  const tech = (name, pos) => ({ id: `q${++n}`, name, positions: [pos], age: 27, attributes: Object.fromEntries(D.OUTFIELD_ATTRIBUTES.slice(0, 14).map((a) => [a, 13])), flags: {} });
  const sq2 = ['GK', 'DC', 'DC', 'DC', 'DR', 'DL', 'DM', 'MC', 'MC', 'AMR', 'AML', 'ST'].map((p, i) => tech('T' + i, p));
  const r2 = S.analyze(tac(), sq2);
  assert.equal(r2.usable, false);
  assert.match(r2.reason, /Technické, Psychika a Fyzické atributy/);
  assert.ok(!/Smlouvy/.test(r2.reason));
  assert.ok(r2.notes.includes(r2.reason));
  const none = S.analyze(tac(), [{ id: 'x1', name: 'Bez atributů', positions: ['GK'], attributes: {} }]);
  assert.match(none.reason, /Žádný hráč nemá načtené atributy/);
  assert.equal(S.analyze(tac(), []).reason, 'Soupiska je prázdná: přidej hráče v Můj tým nebo je načti ze snímku či tabulky.');
  assert.equal(S.analyze(tac(), sq).reason, null);
});

test('G2 a G3: věta o hráčích bez atributů; rada načíst atributy je první', () => {
  const sq = fullSquad().filter((p) => !['RW2', 'LW2'].includes(p.name));
  sq.push({ id: 'z1', name: 'Bez dat', positions: ['AMR'], age: 22, attributes: {}, flags: {} });
  const g = S.analyze(tac(), sq).findings.find((f) => f.id === 'G2' && /křídlo/.test(f.title));
  assert.ok(g);
  assert.match(g.why, /1 hráče s touhle pozicí nejde ohodnotit, protože jim chybí atributy \(Bez dat\)/);
  assert.match(g.fix[0], /^Načti atributy hráčů: Bez dat/);
});

test('D1: jeden hráč na dvou místech je vážný nález, neporovnává se s nejlepší jedenáctkou a druhé místo doplní model', () => {
  const sq = [P('Hvězda', ['DC'], 26, 17), P('Záloha 1', ['DC'], 26, 12), P('Záloha 2', ['DC'], 26, 11), P('Záloha 3', ['DC'], 26, 10)];
  const t = { formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: sq[0].id }, { key: 'b', pos: 'LCB', playerId: sq[0].id }] };
  const r = S.analyze(t, sq);
  const d1 = r.findings.find((f) => f.id === 'D1');
  assert.ok(d1 && d1.sev === 'error' && d1.basis === 'VYPOCET');
  assert.match(d1.title, /Hvězda je v taktice na 2 místech \(RCB, LCB\)/);
  assert.match(d1.fix[0], /^Na LCB dát jiného hráče \(podle modelu Záloha 1\)/);
  assert.equal(r.user.avg, null, 'jedenáctka s dvojitým hráčem se neporovnává');
  assert.deepEqual(r.swaps, []);
  assert.deepEqual(r.xi.map((e) => e.starter.name), ['Hvězda', 'Záloha 1'], 'druhé místo doplnil model');
  assert.equal(r.strengths.filter((f) => f.id === 'S1').length, 1, 'silná stránka Hvězdy jen jednou');
  assert.equal(r.xi[1].user.duplicate, true);
  // dva různí hráči: žádné D1
  t.slots[1].playerId = sq[1].id;
  assert.ok(!S.analyze(t, sq).findings.some((f) => f.id === 'D1'));
  // slabý hráč na dvou místech a silnější k dispozici: žádná „výměna“, jedenáctka s dvojitým hráčem se neporovnává
  const weak = [P('Slabý', ['DC'], 26, 8), P('Silný 1', ['DC'], 26, 16), P('Silný 2', ['DC'], 26, 15)];
  const t2 = { formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: weak[0].id }, { key: 'b', pos: 'LCB', playerId: weak[0].id }] };
  const r2 = S.analyze(t2, weak);
  assert.ok(r2.findings.some((f) => f.id === 'D1'));
  assert.deepEqual(r2.swaps, []);
  const t3 = { formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: weak[0].id }, { key: 'b', pos: 'LCB', playerId: weak[1].id }] };
  assert.ok(S.analyze(t3, weak).swaps.length >= 1, 'bez dvojitého hráče by se výměna navrhla');
});

/** Hledá dva hráče, jejichž skóre se v desetinách liší přesně o `tenths`; s `floatEdge` jen takové, kde je rozdíl v plovoucí čárce o něco menší (14,3 − 2,3 není 12). */
function pairWithFloatEdge(tenths, floatEdge = true) {
  let seed = 5;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const names = PA.entriesOf('CB').map((e) => e.attribute);
  const byScore = new Map();
  for (let i = 0; i < 20000; i++) {
    const a = {};
    const level = 1 + Math.floor(rnd() * 20); // různé úrovně hráčů, ať jsou vidět skóre od nuly po stovku
    for (const nm of names) a[nm] = Math.max(1, Math.min(20, level + Math.floor(rnd() * 7) - 3));
    const sc = PA.score(D.playerAttributes({ attributes: a }), 'CB').score;
    if (!byScore.has(sc)) byScore.set(sc, a);
  }
  for (const [x, ax] of byScore) {
    const y = Math.round((x - tenths / 10) * 10) / 10;
    if (byScore.has(y) && Math.round(x * 10) - Math.round(y * 10) === tenths && (!floatEdge || x - y < tenths / 10)) return { hi: ax, lo: byScore.get(y), x, y };
  }
  return null;
}

test('B5: hrany prahů (propad zálohy 12, zisk výměny 4) se porovnávají v desetinách, ne v plovoucí čárce', () => {
  const q2 = pairWithFloatEdge(120);
  assert.ok(q2, 'pár hráčů se najde');
  assert.ok(q2.x - q2.y < 12, 'v plovoucí čárce je rozdíl pod 12');
  const mk = (id, attributes) => ({ id, name: id, positions: ['DC'], age: 25, attributes, flags: {} });
  const r = S.analyze({ formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: 'S' }] }, [mk('S', q2.hi), mk('B', q2.lo)]);
  assert.ok(r.findings.some((f) => f.id === 'Q2'), `rozdíl ${q2.x} − ${q2.y} je přesně 12,0 bodu: ${ids(r)}`);
  const sw = pairWithFloatEdge(40);
  assert.ok(sw);
  const r2 = S.analyze({ formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: 'U' }] }, [mk('U', sw.lo), mk('A', sw.hi)]);
  assert.equal(r2.swaps.length, 1, 'zisk 4,0 bodu už je výměna');
  assert.equal(r2.swaps[0].gain, 4);
});

test('B6: hráč s víc pozicemi se do hloubky počítá jen v jedné skupině (čtyři univerzální záložníci nestačí na DM i CM)', () => {
  const mid = Object.fromEntries(['Passing', 'Stamina', 'Work Rate', 'Teamwork', 'First Touch', 'Composure', 'Vision', 'Dribbling', 'Decisions', 'Off The Ball', 'Technique', 'Anticipation', 'Positioning', 'Tackling', 'Concentration', 'Marking', 'Strength'].map((a) => [a, 14]));
  const sq = Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, name: 'Záložník ' + i, positions: ['DM', 'MC'], age: 26, attributes: mid, flags: {} }));
  const r = S.analyze(tac(), sq);
  const dm = r.depth.find((d) => d.group === 'DM');
  const cm = r.depth.find((d) => d.group === 'CM');
  assert.equal(dm.eligible + 0, 4);
  assert.equal(dm.assigned + cm.assigned, 4, 'čtyři hráči, každý započítaný jednou');
  assert.ok(dm.assigned + cm.assigned <= 4);
  assert.notEqual(cm.state, 'ok');
  assert.ok(!r.strengths.some((f) => f.id === 'S2' && /střední záložník/.test(f.title)), 'hloubka středu není „v pořádku“');
  const g = r.findings.find((f) => (f.id === 'G2' || f.id === 'G3') && /střední záložník/.test(f.title));
  assert.ok(g && /hrají víc pozic a započítávají se v jiné skupině/.test(g.why), g && g.why);
  // bez překryvu zůstává počítání jako dřív: každý hráč jen v jedné skupině
  const plain = S.analyze(tac(), fullSquad());
  for (const d of plain.depth) assert.equal(d.assigned, Math.min(d.eligible, d.target), d.group);
});

test('B9: průměr tvé jedenáctky a nejlepší jedenáctka se porovnávají na týchž místech (hráč, kterého nejde ohodnotit, porovnání nezkreslí)', () => {
  const sq = fullSquad();
  const t = tac();
  const best = S.analyze(t, sq).xi;
  for (const e of best) t.slots.find((s) => s.key === e.slotKey).playerId = e.best.id;
  const noAttrs = { id: 'nic', name: 'Bez atributů', positions: ['AML'], age: 24, attributes: {}, flags: {} };
  sq.push(noAttrs);
  t.slots.find((s) => s.pos === 'LW').playerId = noAttrs.id;
  const r = S.analyze(t, sq);
  assert.equal(r.user.picked, 11);
  assert.equal(r.user.rated, 10);
  assert.equal(r.user.compared, 10);
  const same = r.xi.filter((e) => e.pos !== 'LW');
  const avg = (v) => Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
  assert.equal(r.user.avg, avg(same.map((e) => e.user.score)));
  assert.equal(r.user.bestAvg, avg(same.map((e) => e.best.score)), 'nejlepší jedenáctka jen na deseti místech, kde jde porovnat');
  assert.equal(r.user.avg, r.user.bestAvg, 'tvá jedenáctka je tam nejlepší možná');
  assert.ok(r.swaps.some((x) => x.pos === 'LW' && x.gain === null), 'neohodnotitelný hráč se hlásí jako výměna bez čísla');
  assert.ok(S.summaryLines(r).some((l) => /porovnáno na 10 z 11 míst/.test(l)));
});

test('C4: správná čeština v poznámkách (2 hráči nemají, U 3 hráčů chybí věk, 4 přirozené hráče)', () => {
  const mk = (count) => {
    const sq = fullSquad();
    for (let i = 0; i < count; i++) sq.push({ id: `nb${count}_${i}`, name: 'Bez ' + i, positions: ['ST'], age: 25, attributes: {}, flags: {} });
    return S.analyze(tac(), sq).notes.find((x) => /atributy, takže se neohodnotí/.test(x));
  };
  assert.equal(mk(1), '1 hráč nemá žádné atributy, takže se neohodnotí.');
  assert.equal(mk(2), '2 hráči nemají žádné atributy, takže se neohodnotí.');
  assert.equal(mk(5), '5 hráčů nemá žádné atributy, takže se neohodnotí.');
  const ages = (count) => {
    const sq = fullSquad();
    const t = tac();
    const r0 = S.analyze(t, sq);
    for (const e of r0.xi.slice(0, count)) sq.find((p) => p.id === e.best.id).age = null;
    return S.analyze(t, sq).notes.find((x) => /chybí věk/.test(x));
  };
  assert.equal(ages(1), 'U 1 hráče v jedenáctce chybí věk, věkové kontroly je nezahrnují.');
  assert.equal(ages(3), 'U 3 hráčů v jedenáctce chybí věk, věkové kontroly je nezahrnují.');
  const s2 = S.analyze(tac(), fullSquad()).strengths.find((f) => f.id === 'S2' && /střední obránce/.test(f.title));
  assert.match(s2.why, /máš 4 přirozené hráče \(cíl 4\)/);
});

test('C6: obsadí se co nejvíc míst (univerzál, který na jedné pozici zazáří a na druhé je slabý, nezabere místo, aby druhé zůstalo prázdné)', () => {
  const base = (v) => Object.fromEntries(D.OUTFIELD_ATTRIBUTES.map((a) => [a, v]));
  const st = PA.entriesOf('ST').map((e) => e.attribute);
  const dm = PA.entriesOf('DM').map((e) => e.attribute);
  const uni = base(1);
  for (const a of dm) uni[a] = 1;
  for (const a of st) uni[a] = 20;
  const players = [
    { id: 'u1', name: 'Útočník', positions: ['ST'], age: 25, attributes: base(7), flags: {} },
    { id: 'u2', name: 'Univerzál', positions: ['ST', 'DM'], age: 25, attributes: uni, flags: {} },
  ];
  const r = S.analyze({ formation: 'x', slots: [{ key: 'a', pos: 'ST' }, { key: 'b', pos: 'DM' }] }, players);
  assert.deepEqual(r.xi.map((e) => e.best && e.best.name), ['Útočník', 'Univerzál'], 'obě místa obsazená');
});

test('summaryLines: nálezy nesou štítek původu a shodu zdrojů, na konci je věta, že jde o odhad', () => {
  const sq = fullSquad().filter((p) => !['RW2', 'LW2'].includes(p.name));
  const lines = S.summaryLines(S.analyze(tac(), sq));
  assert.ok(lines.some((l) => /\[G2, KOMUNITA, komunitní cíl 2 hráči na místo\]/.test(l)));
  assert.ok(lines.every((l) => !/^(Vážný nález|Upozornění|Poznámka|K vědomí|Silná stránka) \[[A-Z]\d\]/.test(l)), 'žádný nález bez štítku původu');
  assert.match(lines[lines.length - 1], /Rozbor sestavy je odhad podle komunitních příruček .* ne pravidlo FM27 a ne předpověď/);
  assert.ok(lines.some((l) => /Smlouvy, morálku ani formu aplikace zatím nezná/.test(l)), 'poznámky se kopírují taky');
});

test('A1: preference uživatelova hráče jen rozhoduje při shodě; o desetinu lepšího hráče nikdy nepřebije', () => {
  const pair = pairWithFloatEdge(1, false);
  assert.ok(pair);
  const mk = (id, attributes) => ({ id, name: id, positions: ['DC'], age: 25, attributes, flags: {} });
  const r = S.analyze({ formation: 'x', slots: [{ key: 'a', pos: 'RCB', playerId: 'U' }] }, [mk('U', pair.lo), mk('A', pair.hi)]);
  assert.equal(r.xi[0].best.id, 'A', 'nejlepší podle modelu je hráč o 0,1 bodu lepší, ne ten, kterého zadal uživatel');
  assert.deepEqual(r.swaps, [], '0,1 bodu není výměna');
});

test('G1 a G5: chybějící atributy nahrazují hráče jen tehdy, když by jejich doplnění místa opravdu zaplnilo (zraněný bez atributů se nepočítá)', () => {
  const noData = (id, over) => Object.assign({ id, name: id, positions: ['DC'], age: 25, attributes: {}, flags: {} }, over || {});
  // dvě místa, jediný stoper a bez atributů: i s doplněním by jedno místo zůstalo prázdné
  const two = { formation: 'x', slots: [{ key: 'a', pos: 'RCB' }, { key: 'b', pos: 'LCB' }] };
  const r = S.analyze(two, [noData('jediny')]);
  assert.ok(r.findings.some((f) => f.id === 'G1'), ids(r).join());
  assert.ok(!r.findings.some((f) => f.id === 'G5'));
  // dva stopeři bez atributů na dvě místa: jde o chybějící údaje, ne hráče
  const r2 = S.analyze(two, [noData('a1'), noData('a2')]);
  assert.ok(r2.findings.some((f) => f.id === 'G5') && !r2.findings.some((f) => f.id === 'G1'), ids(r2).join());
  // zraněný stoper bez atributů se do „chybí atributy“ nepočítá
  const one = { formation: 'x', slots: [{ key: 'a', pos: 'RCB' }] };
  const r3 = S.analyze(one, [noData('zraneny', { flags: { injury: true } })]);
  assert.ok(r3.findings.some((f) => f.id === 'G1') && !r3.findings.some((f) => f.id === 'G5'), ids(r3).join());
});

test('B6: nejdřív se obsadí základní místa všech skupin, teprve potom zálohy (univerzál nezůstane jako záloha, když druhá skupina nemá nikoho)', () => {
  const mid = Object.fromEntries(['Passing', 'Stamina', 'Work Rate', 'Teamwork', 'First Touch', 'Composure', 'Vision', 'Dribbling', 'Decisions', 'Off The Ball', 'Technique', 'Anticipation', 'Positioning', 'Tackling', 'Concentration', 'Marking', 'Strength'].map((a) => [a, 14]));
  const sq = [
    { id: 'jen', name: 'Jen DM', positions: ['DM'], age: 26, attributes: mid, flags: {} },
    { id: 'uni', name: 'Univerzál', positions: ['DM', 'MC'], age: 26, attributes: mid, flags: {} },
  ];
  const r = S.analyze({ formation: 'x', slots: [{ key: 'a', pos: 'DM' }, { key: 'b', pos: 'RCM' }] }, sq);
  const dm = r.depth.find((d) => d.group === 'DM');
  const cm = r.depth.find((d) => d.group === 'CM');
  assert.equal(dm.assigned, 1, 'Jen DM drží defenzivní místo');
  assert.equal(cm.assigned, 1, 'univerzál hraje střed, kde jinak nikdo není');
  assert.equal(cm.state, 'single');
});

test('B6: při rozdělení hráčů mezi skupiny mají přednost přirozené pozice (hráč bez známé pozice nevytlačí přirozeného)', () => {
  const base = Object.fromEntries(D.OUTFIELD_ATTRIBUTES.map((a) => [a, 13]));
  const mk = (id, positions) => ({ id, name: id, positions, age: 25, attributes: base, flags: {} });
  const sq = [mk('u1', []), mk('u2', []), mk('u3', []), mk('prirozeny', ['ST'])];
  const r = S.analyze({ formation: 'x', slots: [{ key: 'a', pos: 'ST' }] }, sq);
  const st = r.depth.find((d) => d.group === 'ST');
  assert.equal(st.assigned, 2);
  assert.equal(st.natural, 1, 'mezi přidělenými je přirozený útočník');
});
