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
  assert.equal(await s.purgeAll(), 2);
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
  assert.match(s.status().error, /příliš velký/);
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
