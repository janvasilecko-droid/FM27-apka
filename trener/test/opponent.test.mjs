import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const O = require('../src/opponent.js');

const ctx = () => ({
  observations: {
    'opp-name': { label: 'user_entered', text: 'Soupeř: Sparta' },
    'opp-formation': { label: 'user_entered', text: 'Rozestavení: 4-2-3-1' },
    'opp-pressingHeight': { label: 'vision_unverified', text: 'Výška presinku: vysoko' },
    'opp-keyPlayers': { label: 'user_entered', text: 'Klíčoví hráči: Novák – hrot' },
  },
  passages: new Set(['bk:x:1:1']),
  knownPlayers: ['Novák – hrot'],
});
const good = () => ({
  summary: { text: 'Soupeř hraje 4-2-3-1 a tlačí vysoko, hrát přes střed je riskantní.', tier: 'inferred', refs: ['opp-formation', 'bk:x:1:1'] },
  press: { text: 'Napadat dvojicí záložníků a zavírat střed při jejich rozehrávce.', tier: 'inferred', refs: ['opp-pressingHeight'] },
  winBall: { text: 'Míč získávat na jejich křídle po ztrátě, kde bývají vysunutí obránci.', tier: 'unknown', refs: [] },
  side: { choice: 'left', text: 'Levá strana: soupeř tam nechává prostor za obráncem.', tier: 'inferred', refs: ['opp-formation'] },
  spaces: { text: 'Obsadit prostor za jejich pravým obráncem.', items: ['Prostor za jejich pravým obráncem'], tier: 'inferred', refs: ['opp-formation'] },
  limit: { player: 'Novák', text: 'Hlídat hrot Nováka dvojicí stoperů.', tier: 'user_entered', refs: ['opp-keyPlayers'] },
  risk: { text: 'Otevřený střed.', items: ['Při ztrátě míče zůstane střed otevřený'] },
  confidence: { level: 'medium', text: 'Dva údaje o soupeři, ale žádný ověřený na screenshotu.' },
  unknown: { text: 'Chybí údaje o standardních situacích.', items: ['Jak soupeř brání rohy'] },
});
const errorsOf = (plan, c) => O.validatePlan(plan, c || ctx()).errors.join(' | ');

test('profil → pozorování: jen vyplněná pole, původ podle pole', () => {
  const obs = O.profileToObservations({
    name: 'Sparta',
    fields: { formation: { value: '4-2-3-1', prov: 'user_entered' }, pressingHeight: { value: 'vysoko', prov: 'vision_unverified' }, buildUp: { value: '  ', prov: 'user_entered' }, setPieces: { value: 'rohy na zadní', prov: 'cokoli' } },
  });
  assert.deepEqual(obs.map((o) => o.id), ['opp-name', 'opp-formation', 'opp-pressingHeight', 'opp-setPieces']);
  assert.equal(obs.find((o) => o.id === 'opp-pressingHeight').label, 'vision_unverified');
  assert.equal(obs.find((o) => o.id === 'opp-setPieces').label, 'user_entered');
  assert.match(obs.find((o) => o.id === 'opp-formation').text, /Rozestavení: 4-2-3-1/);
  assert.deepEqual(O.profileToObservations(null), []);
});

test('prompt obsahuje pravidla, tvar, pozorování a úryvky', () => {
  const turns = O.buildPlanTurns({ observations: [{ id: 'opp-formation', label: 'user_entered', text: 'Rozestavení: 4-2-3-1' }], passages: [{ id: 'bk:x:1:1', title: 'Kniha', where: 'list PDF č. 1', text: 'Text úryvku.' }], sourcesDigest: '(registr)' });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, 'user');
  assert.match(turns[0].content, /opp-formation \| user_entered/);
  assert.match(turns[0].content, /bk:x:1:1 \| Kniha \| list PDF č\. 1/);
  assert.match(turns[0].content, /"side":/);
  assert.match(turns[0].content, /Hráče uváděj jen jmény, která jsou v profilu/);
  assert.match(O.buildPlanTurns({}).at(0).content, /\(žádná\)/);
});

test('platný plán projde', () => {
  const r = O.validatePlan(good(), ctx());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.match(O.planToText(good()), /Strana: levá strana/);
});

test('chybějící sekce a neobjekt', () => {
  const p = good();
  delete p.limit;
  assert.match(errorsOf(p), /Chybí sekce: limit/);
  assert.match(errorsOf('nic'), /není JSON objekt/);
});

test('tvrzení silnější než důkaz, neexistující odkaz, mechanika FM27', () => {
  let p = good();
  p.press.tier = 'user_entered'; // odkaz je vision_unverified
  assert.match(errorsOf(p), /press: úroveň user_entered je silnější/);
  p = good();
  p.press.refs = ['opp-nic'];
  assert.match(errorsOf(p), /neodpovídá žádnému/);
  p = good();
  p.summary.text = 'Soupeř má vysoké CA a skrytý atribut, proto vyhraje.';
  assert.match(errorsOf(p), /summary: tvrzení o interní mechanice/);
  p = good();
  p.risk.items = ['Match engine soupeře je silný'];
  assert.match(errorsOf(p), /risk: tvrzení o interní mechanice/);
});

test('strana, prostory, riziko', () => {
  let p = good();
  p.side.choice = 'nahoru';
  assert.match(errorsOf(p), /side: choice musí být/);
  p = good();
  p.side.tier = 'unknown';
  p.side.refs = [];
  assert.match(errorsOf(p), /strana je vybraná, ale tvrzení je označené jako neznámé/);
  p = good();
  p.side = { choice: 'none', text: 'Nevím, kterou stranu použít.', tier: 'unknown', refs: [] };
  assert.equal(errorsOf(p), '');
  p = good();
  p.spaces.items = [];
  assert.match(errorsOf(p), /spaces: uveď aspoň jeden konkrétní prostor/);
  p = good();
  p.spaces.items = ['prostor jedna', 'prostor dva', 'prostor tři', 'prostor čtyři', 'prostor pět'];
  assert.match(errorsOf(p), /nejvýš čtyři/);
  p = good();
  p.risk.items = [];
  assert.match(errorsOf(p), /risk: items musí obsahovat/);
});

test('hráči se nesmějí vymýšlet', () => {
  let p = good();
  p.limit.player = 'Dvořák';
  assert.match(errorsOf(p), /hráč „Dvořák“ není v profilu soupeře/);
  p = good();
  p.limit.player = null;
  assert.equal(errorsOf(p), '');
  p = good();
  p.limit.player = 42;
  assert.match(errorsOf(p), /player musí být text nebo null/);
  p = good();
  p.limit.player = 'nov'; // část jména stačí
  assert.equal(errorsOf(p), '');
});

test('jistota: high potřebuje dva ověřené údaje, medium aspoň jeden, low vyžaduje, co chybí', () => {
  let p = good();
  p.confidence.level = 'high';
  assert.match(errorsOf(p), /high vyžaduje aspoň dva údaje o soupeři ověřené/);

  const c = ctx();
  c.observations['opp-formation'].label = 'screenshot_verified';
  c.observations['opp-keyPlayers'].label = 'screenshot_verified';
  p = good();
  p.confidence.level = 'high';
  p.summary.refs = ['opp-formation']; // úryvek z knihy by tvrzení srazil na odhad
  p.summary.tier = 'observed';
  p.limit.tier = 'observed';
  p.side.tier = 'observed';
  p.spaces.tier = 'observed';
  assert.equal(errorsOf(p, c), '', 'dva ověřené údaje stačí');

  p = good();
  p.summary = { text: 'Bez údajů nelze nic tvrdit.', tier: 'unknown', refs: [] };
  p.press = { text: 'Bez údajů nelze nic tvrdit.', tier: 'unknown', refs: [] };
  p.side = { choice: 'none', text: 'Bez údajů nelze nic tvrdit.', tier: 'unknown', refs: [] };
  p.spaces = { text: 'Bez údajů nelze nic tvrdit.', items: ['Zatím žádný konkrétní prostor'], tier: 'unknown', refs: [] };
  p.limit = { player: null, text: 'Bez údajů nelze nic tvrdit.', tier: 'unknown', refs: [] };
  p.confidence.level = 'medium';
  assert.match(errorsOf(p), /medium vyžaduje aspoň jeden údaj/);
  p.confidence.level = 'low';
  p.unknown.items = [];
  assert.match(errorsOf(p), /při nízké jistotě nebo neznámém tvrzení uveď/);
  p.unknown.items = ['Vyplň profil soupeře'];
  assert.equal(errorsOf(p), '');
  p.confidence.level = 'nesmysl';
  assert.match(errorsOf(p), /level musí být low, medium nebo high/);
});

test('odkaz jen na teorii z knihy je povolen jako oporu, ale plán bez údajů o soupeři dostane varování', () => {
  const p = good();
  for (const k of ['summary', 'press', 'side', 'spaces', 'limit']) {
    p[k].refs = ['bk:x:1:1'];
    p[k].tier = 'inferred';
  }
  p.limit.player = null;
  p.confidence.level = 'low';
  const r = O.validatePlan(p, ctx());
  assert.equal(r.ok, true, r.errors.join('|'));
  assert.ok(r.warnings.some((w) => /neodkazuje na žádný údaj o soupeři/.test(w)));
});

test('hledací dotazy z profilu', () => {
  const seeds = O.searchSeeds({ fields: { formation: { value: '4-2-3-1' }, pressingHeight: { value: 'vysoký' }, flankAttacks: { value: 'pravá strana' } } });
  assert.equal(seeds.length, 3);
  assert.match(seeds[0], /4-2-3-1/);
  assert.deepEqual(O.searchSeeds(null), []);
});

test('čtení obrazovky soupeře: jen platné hodnoty, vše ostatní se zahodí', () => {
  const ok = O.normalizeExtraction({ formation: '4 2 3 1', roles: ['  Křídelník  ', '', 5], keyPlayers: ['Novák'], strengths: [], weaknesses: ['Pomalá obrana'], notes: 'čitelné' });
  assert.equal(ok.fields.formation, '4-2-3-1');
  assert.equal(ok.fields.roles, 'Křídelník');
  assert.equal(ok.fields.keyPlayers, 'Novák');
  assert.equal(ok.fields.weaknesses, 'Pomalá obrana');
  assert.ok(!('strengths' in ok.fields));
  const bad = O.normalizeExtraction({ formation: 'útočná', roles: [] });
  assert.deepEqual(bad.fields, {});
  assert.ok(bad.issues.some((i) => /nevypadá jako řada čísel/.test(i)));
  assert.ok(bad.issues.some((i) => /nic spolehlivě přečíst/.test(i)));
  assert.deepEqual(O.normalizeExtraction('nesmysl').fields, {});
  assert.match(O.EXTRACTION_PROMPT, /nikdy nic nehádej/i);
});
