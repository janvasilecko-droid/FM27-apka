import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStore, MemoryBackend, MemoryRemote } = require('../src/store.js');

function clock(start = 1000) {
  let t = start;
  return { now: () => t, set: (v) => (t = v), tick: (d = 1) => (t += d) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(...stores) {
  await tick();
  for (const s of stores) await s.flush();
  await tick();
  await tick();
}

test('zápis, čtení, seznam, smazání a monotónní čas', async () => {
  const c = clock();
  const s = createStore({ now: c.now });
  await s.init();
  const a = await s.put('career', { id: 'c1', club: 'Můj klub' });
  assert.equal(a.club, 'Můj klub');
  assert.equal(s.get('career', 'c1').club, 'Můj klub');
  await s.put('player', { id: 'p1', careerId: 'c1', name: 'A' });
  await s.put('player', { id: 'p2', careerId: 'c1', name: 'B' });
  assert.deepEqual(s.list('player').map((p) => p.name).sort(), ['A', 'B']);
  assert.deepEqual(s.list('player', (p) => p.name === 'B').map((p) => p.id), ['p2']);
  await s.put('player', { id: 'p1', careerId: 'c1', name: 'A2' }); // stejný čas → updatedAt stoupne o 1
  assert.equal(s.get('player', 'p1').name, 'A2');
  assert.ok(await s.remove('player', 'p2'));
  assert.equal(s.get('player', 'p2'), null);
  assert.equal(await s.remove('player', 'p2'), false);
  assert.equal(s.list('player').length, 1);
});

test('data jsou zmrazená: omylem je nejde měnit, upravuje se kopie přes draft', async () => {
  const s = createStore({});
  await s.init();
  const doc = await s.put('career', { id: 'c1', club: 'X', tags: ['a'] });
  assert.throws(() => {
    doc.club = 'Y';
  }, TypeError);
  assert.throws(() => doc.tags.push('b'), TypeError);
  const copy = s.draft(doc);
  copy.club = 'Y';
  await s.put('career', copy);
  assert.equal(s.get('career', 'c1').club, 'Y');
});

test('neznámý typ a chybějící id', async () => {
  const s = createStore({});
  await s.init();
  await assert.rejects(() => s.put('neco', { id: 'x' }), /Neznámý typ/);
  const d = await s.put('career', { club: 'Bez id' });
  assert.match(d.id, /^[a-z0-9]{10}$/);
});

test('lokální úložiště: nová instance načte, co se uložilo', async () => {
  const local = new MemoryBackend();
  const a = createStore({ local });
  await a.init();
  await a.put('tactic', { id: 't1', careerId: 'c1', name: '4-3-3' });
  await a.remove('tactic', 't1');
  await a.put('tactic', { id: 't2', careerId: 'c1', name: '4-4-2' });
  const b = createStore({ local });
  await b.init();
  assert.deepEqual(b.list('tactic').map((t) => t.id), ['t2']);
});

test('synchronizace: dvě zařízení nad jedním serverem', async () => {
  const remote = new MemoryRemote();
  const ca = clock(1000);
  const cb = clock(1000);
  const pc = createStore({ local: new MemoryBackend(), remote, now: ca.now, debounceMs: 0 });
  const phone = createStore({ local: new MemoryBackend(), remote, now: cb.now, debounceMs: 0 });
  await pc.init();
  await phone.init();
  await settle(pc, phone);
  assert.equal(pc.status().remote, 'live');

  await pc.put('career', { id: 'c1', club: 'Chelsea' });
  await pc.put('tactic', { id: 't1', careerId: 'c1', name: 'Hlavní' });
  await settle(pc, phone);
  assert.equal(phone.get('career', 'c1').club, 'Chelsea');
  assert.equal(phone.get('tactic', 't1').name, 'Hlavní');

  cb.set(2000);
  await phone.put('tactic', { id: 't1', careerId: 'c1', name: 'Hlavní (telefon)' });
  await settle(pc, phone);
  assert.equal(pc.get('tactic', 't1').name, 'Hlavní (telefon)');

  ca.set(3000);
  await pc.remove('tactic', 't1');
  await settle(pc, phone);
  assert.equal(phone.get('tactic', 't1'), null);
});

test('souběžná úprava téhož dokumentu: vyhrává novější, na obou zařízeních stejně', async () => {
  const remote = new MemoryRemote();
  const ca = clock(5000);
  const cb = clock(5000);
  const a = createStore({ local: new MemoryBackend(), remote, now: ca.now, debounceMs: 0 });
  const b = createStore({ local: new MemoryBackend(), remote, now: cb.now, debounceMs: 0 });
  await a.init();
  await b.init();
  await a.put('career', { id: 'c1', club: 'Základ' });
  await settle(a, b);
  ca.set(6000);
  cb.set(7000);
  await a.put('career', { id: 'c1', club: 'Z počítače' });
  await b.put('career', { id: 'c1', club: 'Z telefonu' });
  await settle(a, b);
  assert.equal(a.get('career', 'c1').club, 'Z telefonu');
  assert.equal(b.get('career', 'c1').club, 'Z telefonu');
});

test('dokumenty vzniklé bez připojení se po připojení odešlou', async () => {
  const remote = new MemoryRemote();
  const local = new MemoryBackend();
  const offline = createStore({ local, now: () => 100 });
  await offline.init();
  await offline.put('career', { id: 'c1', club: 'Offline klub' });
  const online = createStore({ local, remote, now: () => 200, debounceMs: 0 });
  await online.init();
  await settle(online);
  assert.ok(remote.docs.has('career_c1'));
  const other = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await other.init();
  await settle(other);
  assert.equal(other.get('career', 'c1').club, 'Offline klub');
});

test('smazání kariéry smaže i vše, co k ní patří, a rozšíří se na druhé zařízení', async () => {
  const remote = new MemoryRemote();
  const a = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  const b = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await a.init();
  await b.init();
  await a.put('career', { id: 'c1', club: 'K1' });
  await a.put('career', { id: 'c2', club: 'K2' });
  await a.put('player', { id: 'p1', careerId: 'c1', name: 'A' });
  await a.put('player', { id: 'p2', careerId: 'c2', name: 'B' });
  await a.put('match', { id: 'm1', careerId: 'c1' });
  await a.put('progress', { id: 'progress' });
  await settle(a, b);
  assert.equal(await a.removeCareer('c1'), 3);
  await settle(a, b);
  assert.deepEqual(b.list('career').map((c) => c.id), ['c2']);
  assert.deepEqual(b.list('player').map((p) => p.id), ['p2']);
  assert.equal(b.list('match').length, 0);
  assert.equal(b.list('progress').length, 1);
  // náhrobek nenese žádná data
  assert.equal(remote.docs.get('player_p1').data, null);
});

test('purgeAll zanechá jen prázdné náhrobky', async () => {
  const remote = new MemoryRemote();
  const s = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await s.init();
  await s.put('career', { id: 'c1', club: 'K' });
  await s.put('player', { id: 'p1', careerId: 'c1', name: 'Tajné jméno' });
  await settle(s);
  assert.deepEqual(await s.purgeAll(), { removed: 2, complete: true });
  await settle(s);
  assert.equal(s.list('player').length + s.list('career').length, 0);
  for (const d of remote.docs.values()) assert.equal(d.data, null);
});

test('příliš velký dokument zůstane jen místně a hlásí to', async () => {
  const remote = new MemoryRemote();
  const s = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await s.init();
  await settle(s);
  await s.put('match', { id: 'velky', careerId: 'c1', text: 'x'.repeat(260 * 1024) });
  await settle(s);
  assert.equal(remote.docs.has('match_velky'), false);
  assert.equal(s.get('match', 'velky').text.length, 260 * 1024);
  assert.deepEqual(s.status().blocked, ['match_velky']);
  assert.match(s.status().blockedInfo[0].reason, /příliš velký/);
  // další úspěšný zápis jiného dokumentu upozornění nezruší: dokument se pořád nesynchronizuje
  await s.put('career', { id: 'c1', club: 'Jiný' });
  await settle(s);
  assert.deepEqual(s.status().blocked, ['match_velky']);
});

test('velikost se měří v bajtech: česká diakritika zabírá dva, takže 130 tisíc znaků je už příliš', async () => {
  const remote = new MemoryRemote();
  const s = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await s.init();
  await settle(s);
  await s.put('match', { id: 'diak', careerId: 'c1', text: 'ě'.repeat(130 * 1024) }); // 130 tisíc znaků = 260 kB v UTF-8
  await settle(s);
  assert.equal(remote.docs.has('match_diak'), false);
  assert.deepEqual(s.status().blocked, ['match_diak']);
});

test('dokument, který se nesynchronizuje, nepřepíše starší kopie ze serveru (nic se neztratí)', async () => {
  const c = clock(1000);
  const remote = new MemoryRemote();
  const a = createStore({ local: new MemoryBackend(), remote, debounceMs: 0, now: c.now });
  await a.init();
  await settle(a);
  await a.put('match', { id: 'z', careerId: 'c1', timeline: [1] });
  await settle(a);
  assert.deepEqual(remote.docs.get('match_z').data.timeline, [1]);
  // místní verze přeroste limit, na server se nedostane
  c.tick(10);
  await a.put('match', { id: 'z', careerId: 'c1', timeline: [1, 2], text: 'x'.repeat(260 * 1024) });
  await settle(a);
  assert.deepEqual(remote.docs.get('match_z').data.timeline, [1]);
  // druhé zařízení upraví starou verzi a pošle ji; první ji nesmí převzít
  const b = createStore({ local: new MemoryBackend(), remote, debounceMs: 0, now: () => 99999 });
  await b.init();
  await settle(b, a);
  await b.put('match', { id: 'z', careerId: 'c1', timeline: [1], status: 'finished' });
  await settle(b, a);
  assert.deepEqual(a.get('match', 'z').timeline, [1, 2], 'místní, větší verze zůstala');
  assert.ok(a.get('match', 'z').text, 'a nepřišla o data');
});

test('poškozený dokument v záloze, na serveru ani v místním úložišti nezablokuje seznamy', async () => {
  const bad = [
    { key: 'career_a', type: 'career', id: 'a', updatedAt: 5, deleted: false, data: null, careerId: null },
    { key: 'career_b', type: 'career', id: 'b', updatedAt: 5, deleted: false, data: 'text', careerId: null },
    { key: 'career_c', type: 'career', id: 'c', updatedAt: 5, deleted: false, data: { id: 'jine', club: 'X' }, careerId: null },
    { key: 'player_d', type: 'player', id: 'd', updatedAt: 5, deleted: false, data: { id: 'd', careerId: 'k1', name: 'N' }, careerId: 'jine' },
    { key: 'career_e/x', type: 'career', id: 'e/x', updatedAt: 5, deleted: false, data: { id: 'e/x', club: 'X' }, careerId: null },
    { key: 'career_f', type: 'career', id: 'f', updatedAt: 5, deleted: 'ano', data: { id: 'f', club: 'X' }, careerId: null },
    { key: 'career_g', type: 'career', id: 'g', updatedAt: 5, deleted: true, data: { id: 'g' }, careerId: null },
    { key: 'career_ok', type: 'career', id: 'ok', updatedAt: 5, deleted: false, data: { id: 'ok', club: 'Platný' }, careerId: null },
  ];
  const local = new MemoryBackend();
  for (const d of bad) await local.put(d);
  const remote = {
    watch(onDocs) {
      Promise.resolve().then(() => onDocs(bad, { fromCache: false }));
      return () => {};
    },
    async write() {},
  };
  const s = createStore({ local, remote });
  await s.init();
  await tick();
  assert.deepEqual(s.list('career').map((c) => c.id), ['ok']);
  assert.equal(s.list('player').length, 0);
  assert.ok(s.list('career').every((c) => c && typeof c === 'object'));
  // záloha: poškozené se přeskočí a spočítá, platné se přijme
  const t = createStore({});
  await t.init();
  assert.equal(await t.importAll({ format: 'fm27-trener-data', version: 1, docs: bad }), 1);
  assert.equal(t.lastImport.skipped >= 5, true);
  assert.deepEqual(t.list('career').map((c) => c.id), ['ok']);
});

test('klíč __proto__ z cizí zálohy se zahodí a nic nezmění', async () => {
  const s = createStore({});
  await s.init();
  const doc = JSON.parse('{"key":"career_p","type":"career","id":"p","updatedAt":5,"deleted":false,"careerId":null,"data":{"id":"p","club":"X","__proto__":{"zlo":true}}}');
  assert.equal(await s.importAll({ format: 'fm27-trener-data', version: 1, docs: [doc] }), 1);
  const c = s.get('career', 'p');
  assert.equal(c.zlo, undefined);
  assert.equal({}.zlo, undefined);
  assert.equal(Object.getPrototypeOf(c), Object.prototype);
});

test('obnova ze zálohy vrátí i smazané: po smazání jedné kariéry i po smazání všeho, a rozšíří se na druhé zařízení', async () => {
  const c = clock(1000);
  const remote = new MemoryRemote();
  const a = createStore({ local: new MemoryBackend(), remote, debounceMs: 0, now: c.now });
  await a.init();
  await a.put('career', { id: 'c1', club: 'Sparta' });
  await a.put('player', { id: 'p1', careerId: 'c1', name: 'Hráč' });
  await settle(a);
  const dump = a.exportAll();
  const b = createStore({ local: new MemoryBackend(), remote, debounceMs: 0, now: c.now });
  await b.init();
  await settle(a, b);

  c.tick(5000);
  await a.removeCareer('c1');
  await settle(a, b);
  assert.equal(b.list('career').length, 0);

  c.tick(5000);
  assert.equal(await a.importAll(dump), 2, 'záloha obnoví i smazané dokumenty');
  await settle(a, b);
  assert.deepEqual(a.list('career').map((x) => x.club), ['Sparta']);
  assert.deepEqual(b.list('career').map((x) => x.club), ['Sparta'], 'obnovení se dostalo i na druhé zařízení');
  assert.deepEqual(b.list('player').map((x) => x.name), ['Hráč']);

  // po smazání všeho totéž
  c.tick(5000);
  await a.purgeAll();
  await settle(a, b);
  assert.equal(b.list('career').length, 0);
  c.tick(5000);
  assert.equal(await a.importAll(dump), 2);
  await settle(a, b);
  assert.equal(b.list('career').length, 1);
});

test('živý novější dokument zálohou přepsat nejde (jen náhrobek)', async () => {
  const c = clock(1000);
  const a = createStore({ now: c.now });
  await a.init();
  await a.put('career', { id: 'c1', club: 'Starý' });
  const dump = a.exportAll();
  c.tick(100);
  await a.put('career', { id: 'c1', club: 'Novější' });
  assert.equal(await a.importAll(dump), 0);
  assert.equal(a.get('career', 'c1').club, 'Novější');
});

test('purgeAll na novém zařízení počká na první stav serveru, jinak by se data vrátila', async () => {
  let deliver;
  const server = [{ key: 'career_c1', type: 'career', id: 'c1', updatedAt: 5, deleted: false, data: { id: 'c1', club: 'Ze serveru' }, careerId: null }];
  const written = [];
  const remote = {
    watch(onDocs) {
      deliver = () => onDocs(server, { fromCache: false });
      return () => {};
    },
    async write(d) {
      written.push(d);
    },
  };
  const s = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await s.init();
  const purging = s.purgeAll(2000);
  setTimeout(() => deliver(), 60); // server odpoví až za chvíli
  const res = await purging;
  assert.deepEqual(res, { removed: 1, complete: true });
  assert.equal(s.list('career').length, 0);
  await settle(s);
  assert.equal(written.at(-1).deleted, true, 'náhrobek se odeslal i pro dokument, který dorazil až po začátku mazání');
});

test('purgeAll bez odpovědi serveru smaže místní data a přizná, že server neodpověděl', async () => {
  const remote = { watch: () => () => {}, async write() {} };
  const s = createStore({ local: new MemoryBackend(), remote, debounceMs: 0 });
  await s.init();
  await s.put('career', { id: 'c1', club: 'K' });
  const res = await s.purgeAll(80);
  assert.deepEqual(res, { removed: 1, complete: false });
});

test('selhání místního zápisu zůstane vidět i po úspěšném zápisu na server', async () => {
  const remote = new MemoryRemote();
  let failing = true;
  const local = {
    async all() {
      return [];
    },
    async put() {
      if (failing) throw new Error('quota');
    },
    async clear() {},
  };
  const s = createStore({ local, remote, debounceMs: 0 });
  await s.init();
  await settle(s);
  await s.put('career', { id: 'c1', club: 'K' });
  await settle(s);
  assert.equal(s.status().local, false);
  assert.match(s.status().localError, /quota/);
  assert.ok(remote.docs.has('career_c1'));
  assert.equal(s.status().error, '', 'chyba serveru se nemíchá s chybou místního úložiště');
  failing = false;
  await s.put('career', { id: 'c2', club: 'L' });
  await settle(s);
  assert.equal(s.status().local, true, 'po úspěšném zápisu se stav vrátí');
  assert.equal(s.status().localError, '');
});

test('chyby serveru: plné úložiště se hlásí, přechodná chyba se opakuje', async () => {
  const remote = new MemoryRemote();
  const s = createStore({ local: new MemoryBackend(), remote, debounceMs: 0, retryMs: 5 });
  await s.init();
  await settle(s);
  remote.failNext = { code: 'quota_exceeded' };
  await s.put('career', { id: 'c1', club: 'A' });
  await settle(s);
  assert.match(s.status().error, /plné/);
  assert.equal(s.get('career', 'c1').club, 'A');

  remote.failNext = { code: 'unavailable' };
  await s.put('career', { id: 'c2', club: 'B' });
  await s.flush();
  await new Promise((r) => setTimeout(r, 30));
  await s.flush();
  assert.ok(remote.docs.has('career_c2'), 'po přechodné chybě se zápis zopakoval');
  assert.equal(s.status().pending, 0);
});

test('chyba sledování serveru přepne stav a data zůstanou použitelná', async () => {
  let fail;
  const remote = {
    watch(onDocs, onError) {
      fail = onError;
      return () => {};
    },
    async write() {},
  };
  const s = createStore({ local: new MemoryBackend(), remote });
  await s.init();
  assert.equal(s.status().remote, 'connecting');
  fail({ code: 'revoked' });
  assert.equal(s.status().remote, 'error');
  assert.match(s.status().error, /revoked/);
  await s.put('career', { id: 'c1', club: 'Dál funguje' });
  assert.equal(s.get('career', 'c1').club, 'Dál funguje');
});

test('neplatné dokumenty ze serveru se ignorují', async () => {
  const remote = {
    watch(onDocs) {
      Promise.resolve().then(() =>
        onDocs(
          [
            { key: 'career_ok', type: 'career', id: 'ok', updatedAt: 5, deleted: false, data: { id: 'ok', club: 'Platný' }, careerId: null },
            { key: 'career_zly', type: 'career', id: 'jiny', updatedAt: 5, data: {} },
            { key: 'nic_1', type: 'nic', id: '1', updatedAt: 5, data: {} },
            null,
            'řetězec',
          ],
          { fromCache: false }
        )
      );
      return () => {};
    },
    async write() {},
  };
  const s = createStore({ remote });
  await s.init();
  await tick();
  assert.deepEqual(s.list('career').map((c) => c.id), ['ok']);
});

test('záloha: export a import, starší dokument nepřepíše novější', async () => {
  const c = clock(1000);
  const a = createStore({ now: c.now });
  await a.init();
  await a.put('career', { id: 'c1', club: 'Z zálohy' });
  await a.put('player', { id: 'p1', careerId: 'c1', name: 'Hráč' });
  const dump = a.exportAll();
  assert.equal(dump.format, 'fm27-trener-data');
  assert.equal(dump.docs.length, 2);

  const b = createStore({ now: () => 50 });
  await b.init();
  await b.put('career', { id: 'c1', club: 'Novější lokální' }); // updatedAt 50, starší než záloha
  assert.equal(await b.importAll(dump), 2);
  assert.equal(b.get('career', 'c1').club, 'Z zálohy');

  const d = createStore({ now: () => 9000 });
  await d.init();
  await d.put('career', { id: 'c1', club: 'Opravdu novější' });
  assert.equal(await d.importAll(dump), 1);
  assert.equal(d.get('career', 'c1').club, 'Opravdu novější');
  await assert.rejects(() => d.importAll({ format: 'jiny' }), /Tohle není záloha/);
});

test('události: změna a stav', async () => {
  const s = createStore({ local: new MemoryBackend(), remote: new MemoryRemote(), debounceMs: 0 });
  const seen = [];
  s.on((e) => seen.push(e.kind + ':' + (e.type || '') + ':' + (e.origin || '')));
  await s.init();
  await s.put('career', { id: 'c1', club: 'K' });
  await settle(s);
  assert.ok(seen.includes('change:career:local'));
  assert.ok(seen.some((x) => x.startsWith('status')));
});
