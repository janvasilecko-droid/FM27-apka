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
