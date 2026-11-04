/* Úložiště dat aplikace: lokálně (IndexedDB) a zrcadlo do `db` stránky Claude, aby se kariéry, taktiky a historie
   synchronizovaly mezi počítačem a telefonem na stejném účtu.

   Pravidla:
   - Každý dokument je {key, type, id, careerId, updatedAt, deleted, data}; klíč `typ_id` je i id v `db`.
   - Poslední zápis vyhrává (podle updatedAt). Smazání je náhrobek bez dat, aby se smazání rozneslo na druhé zařízení.
   - Lokální zápis je okamžitý, zápis do `db` jde přes frontu s odložením (jeden zápis na dokument najednou, sloučené dávky).
   - Texty knih se tu neukládají (jsou jen v zařízení, viz library.js).
   Logika je bez DOM a backendy se předávají zvenku, takže ji jde zkoušet v Node (viz test/store.test.mjs). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.FM27 = root.FM27 || {}).storeLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['career', 'player', 'tactic', 'match', 'opponent', 'memory', 'progress', 'settings', 'advice', 'source'];
  const MAX_REMOTE_BYTES = 240 * 1024; // `db` bere dokument nejvýš 256 KiB; nechávám rezervu
  const keyOf = (type, id) => `${type}_${id}`;
  // Hlubokou kopii dělá JSON (zahodí funkce a nepodporované hodnoty); klíč __proto__ se zahodí, aby cizí záloha nemohla měnit prototypy.
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v), (k, val) => (k === '__proto__' ? undefined : val)));
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  /** Velikost v bajtech UTF-8 (limit `db` je v bajtech, česká diakritika zabírá dva). */
  function byteLength(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str).length;
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
    }
    return n;
  }

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  function makeId(len) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(len || 10);
    globalThis.crypto.getRandomValues(bytes);
    let id = '';
    for (const b of bytes) id += alphabet[b % alphabet.length];
    return id;
  }

  /** Dokument musí mít celý tvar: jedna poškozená položka ze zálohy nebo ze synchronizace nesmí zablokovat start aplikace.
      Id smí obsahovat jen znaky povolené v cestách `db`; živý dokument má objekt s týmž id a careerId, náhrobek má data null. */
  function validDoc(d) {
    if (!isPlain(d) || typeof d.key !== 'string' || !TYPES.includes(d.type) || typeof d.id !== 'string' || !Number.isFinite(d.updatedAt) || d.key !== keyOf(d.type, d.id)) return false;
    if (!/^[A-Za-z0-9_.~:@+-]{1,64}$/.test(d.id)) return false;
    if (d.deleted !== undefined && typeof d.deleted !== 'boolean') return false;
    if (d.deleted) return d.data === null || d.data === undefined;
    return isPlain(d.data) && d.data.id === d.id && (d.careerId || null) === (d.data.careerId || null);
  }

  // ---------------------------------------------------------------- backendy
  /** Lokální úložiště v paměti (zkoušky; v prohlížeči záloha, když IndexedDB není). */
  class MemoryBackend {
    constructor() {
      this.docs = new Map();
    }
    async all() {
      return [...this.docs.values()].map(clone);
    }
    async put(doc) {
      this.docs.set(doc.key, clone(doc));
    }
    async clear() {
      this.docs.clear();
    }
  }

  /** Lokální úložiště v IndexedDB (databáze fm27-data, jeden obchod `docs`). */
  class IdbBackend {
    constructor(name) {
      this.name = name || 'fm27-data';
      this.db = null;
    }
    open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB není k dispozici'));
        let req;
        try {
          req = indexedDB.open(this.name, 1);
        } catch (e) {
          return reject(e);
        }
        req.onupgradeneeded = () => req.result.createObjectStore('docs', { keyPath: 'key' });
        req.onsuccess = () => {
          this.db = req.result;
          resolve(this);
        };
        req.onerror = () => reject(req.error || new Error('IndexedDB se nepodařilo otevřít'));
      });
    }
    all() {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction('docs', 'readonly').objectStore('docs').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    put(doc) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('docs', 'readwrite');
        tx.objectStore('docs').put(doc);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Zápis do IndexedDB se přerušil'));
      });
    }
    clear() {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('docs', 'readwrite');
        tx.objectStore('docs').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  /** Zrcadlo do schopnosti `db`: všechno v soukromé podsložce přihlášeného uživatele data/users/<id>. */
  class DbBackend {
    constructor(db, uid) {
      this.col = db.collection('data/users/' + uid);
    }
    watch(onDocs, onError) {
      return this.col.onSnapshot(
        (snap) => {
          const docs = [];
          for (const change of snap.docChanges()) {
            if (change.type === 'removed') continue;
            const data = change.doc.data();
            if (data) docs.push(clone(data));
          }
          onDocs(docs, { fromCache: !!(snap.metadata && snap.metadata.fromCache) });
        },
        (e) => onError(e)
      );
    }
    async write(doc) {
      await this.col.doc(doc.key).set(doc);
    }
  }

  /** Falešný server pro zkoušky: dva obchody nad jedním serverem se chovají jako dvě zařízení. */
  class MemoryRemote {
    constructor() {
      this.docs = new Map();
      this.watchers = new Set();
      this.failNext = null; // {code} → příští zápis selže
      this.writes = 0;
    }
    watch(onDocs, onError) {
      const w = { onDocs, onError };
      this.watchers.add(w);
      Promise.resolve().then(() => this.watchers.has(w) && onDocs([...this.docs.values()].map(clone), { fromCache: false }));
      return () => this.watchers.delete(w);
    }
    async write(doc) {
      if (this.failNext) {
        const e = this.failNext;
        this.failNext = null;
        throw e;
      }
      this.writes++;
      this.docs.set(doc.key, clone(doc));
      for (const w of [...this.watchers]) Promise.resolve().then(() => this.watchers.has(w) && w.onDocs([clone(doc)], { fromCache: false }));
    }
  }

  // ---------------------------------------------------------------- úložiště
  function createStore(options) {
    const o = Object.assign({ local: null, remote: null, now: () => Date.now(), debounceMs: 350, retryMs: 4000 }, options);
    const mem = new Map(); // key → dokument (zmrazený)
    const remoteSeen = new Map(); // key → updatedAt, co o dokumentu ví server
    const listeners = new Set();
    const queue = new Map();
    // error = přechodná chyba synchronizace; localError = místní zápis selhal; blocked = klíče dokumentů, které se na server nedostanou
    // (příliš velké nebo je server odmítl). Zablokovaný dokument se nepřepisuje starší kopií ze serveru, aby se nic neztratilo.
    const status = { local: !!o.local, remote: o.remote ? 'connecting' : 'off', pending: 0, lastRemoteAt: null, error: '', localError: '', blocked: [], blockedInfo: [] };
    const blocked = new Map(); // key → důvod
    const syncBlocked = () => {
      status.blocked = [...blocked.keys()];
      status.blockedInfo = [...blocked].map(([key, reason]) => ({ key, reason }));
    };
    let flushTimer = null;
    let flushing = null;
    let unwatch = null;
    let firstDefinitive = false;

    const emit = (e) => {
      for (const fn of [...listeners]) {
        try {
          fn(e);
        } catch (err) {
          console.error('Posluchač úložiště selhal', err);
        }
      }
    };
    const emitStatus = () => emit({ kind: 'status', status: { ...status } });

    function setDoc(doc, origin) {
      mem.set(doc.key, deepFreeze(doc));
      emit({ kind: 'change', type: doc.type, id: doc.id, deleted: !!doc.deleted, doc, origin });
    }

    async function persistLocal(doc) {
      if (!o.local) return;
      try {
        await o.local.put(doc);
        if (!status.local || status.localError) {
          status.local = true;
          status.localError = '';
          emitStatus();
        }
      } catch (e) {
        status.local = false;
        status.localError = 'Místní úložiště se nepodařilo zapsat: ' + (e && e.message ? e.message : e);
        emitStatus();
      }
    }

    function enqueue(doc) {
      if (!o.remote) return;
      let size = 0;
      try {
        size = byteLength(JSON.stringify(doc));
      } catch (e) {
        size = Infinity;
      }
      if (size > MAX_REMOTE_BYTES) {
        // Nesynchronizuje se a nesmí ho přepsat starší kopie ze serveru. Stav zůstane vidět, dokud dokument nezmenšíš.
        blocked.set(doc.key, `je příliš velký na synchronizaci (${Math.round(size / 1024)} kB, nejvýš ${Math.round(MAX_REMOTE_BYTES / 1024)} kB)`);
        queue.delete(doc.key);
        syncBlocked();
        status.pending = queue.size;
        emitStatus();
        return;
      }
      if (blocked.delete(doc.key)) syncBlocked();
      queue.set(doc.key, doc);
      status.pending = queue.size;
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => flush().catch(() => {}), o.debounceMs);
    }

    async function flush() {
      if (!o.remote) return;
      if (flushing) return flushing;
      clearTimeout(flushTimer);
      flushing = (async () => {
        let failed = false;
        while (queue.size) {
          const [key, doc] = queue.entries().next().value;
          queue.delete(key);
          try {
            await o.remote.write(doc);
            remoteSeen.set(key, Math.max(remoteSeen.get(key) || 0, doc.updatedAt));
            status.error = '';
            if (blocked.delete(key)) syncBlocked();
          } catch (e) {
            const code = e && e.code;
            if (code === 'unavailable' || code === 'resource_exhausted') {
              if (!queue.has(key)) queue.set(key, doc);
              status.error = 'Synchronizace se zpozdila, zkusím to znovu.';
              failed = true;
              break;
            }
            // Server dokument odmítl (plné úložiště, neplatný tvar…): zůstává jen tady a starší kopie ze serveru ho nepřepíše.
            blocked.set(key, code === 'quota_exceeded' ? 'se nevešel do úložiště synchronizace' : `server ho odmítl (${code || 'chyba'})`);
            syncBlocked();
            status.error = code === 'quota_exceeded' ? 'Úložiště synchronizace je plné. Data zůstávají v tomto zařízení.' : `Synchronizace ${key} se nepovedla (${code || 'chyba'}). Data zůstávají v tomto zařízení.`;
          }
          status.pending = queue.size;
        }
        status.pending = queue.size;
        if (!failed && status.remote !== 'error') status.lastRemoteAt = o.now();
        emitStatus();
        if (failed) flushTimer = setTimeout(() => flush().catch(() => {}), o.retryMs);
      })();
      try {
        await flushing;
      } finally {
        flushing = null;
      }
    }

    function applyRemote(doc) {
      if (!validDoc(doc)) return false;
      remoteSeen.set(doc.key, Math.max(remoteSeen.get(doc.key) || 0, doc.updatedAt));
      const cur = mem.get(doc.key);
      if (cur && cur.updatedAt >= doc.updatedAt) return false;
      if (blocked.has(doc.key)) return false; // místní verze se na server nedostala; starší kopie ze serveru ji nesmí přepsat
      const copy = clone(doc);
      setDoc(copy, 'remote');
      persistLocal(copy);
      return true;
    }

    function startRemote() {
      status.remote = 'connecting';
      unwatch = o.remote.watch(
        (docs, meta) => {
          for (const d of docs) applyRemote(d);
          if (!meta || !meta.fromCache) {
            if (!firstDefinitive) {
              firstDefinitive = true;
              // Co vzniklo jen tady (třeba bez připojení), se odešle.
              for (const d of mem.values()) if (d.updatedAt > (remoteSeen.get(d.key) || 0)) enqueue(d);
            }
            status.remote = 'live';
            status.lastRemoteAt = o.now();
            if (queue.size) flush().catch(() => {});
          }
          emitStatus();
        },
        (e) => {
          status.remote = 'error';
          status.error = 'Synchronizace přestala fungovat (' + ((e && e.code) || 'chyba') + '). Data zůstávají v tomto zařízení.';
          emitStatus();
        }
      );
    }

    // ------------------------------------------------------------- veřejné rozhraní
    const store = {
      TYPES,
      async init() {
        if (o.local) {
          try {
            for (const d of await o.local.all()) if (validDoc(d)) mem.set(d.key, deepFreeze(d));
          } catch (e) {
            status.local = false;
            status.localError = 'Místní úložiště se nepodařilo přečíst: ' + (e && e.message ? e.message : e);
          }
        }
        if (o.remote) startRemote();
        emitStatus();
        return store;
      },
      on(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      status: () => ({ ...status }),
      get(type, id) {
        const d = mem.get(keyOf(type, id));
        return d && !d.deleted ? d.data : null;
      },
      list(type, pred) {
        const out = [];
        for (const d of mem.values()) if (d.type === type && !d.deleted && isPlain(d.data) && (!pred || pred(d.data))) out.push(d.data);
        return out;
      },
      /** Zapíše dokument. `data.id` se doplní, pokud chybí. Vrací uloženou (zmrazenou) podobu. */
      async put(type, data) {
        if (!TYPES.includes(type)) throw new Error('Neznámý typ dokumentu: ' + type);
        const id = (data && data.id) || makeId(10);
        const key = keyOf(type, id);
        const prev = mem.get(key);
        const updatedAt = Math.max(o.now(), prev ? prev.updatedAt + 1 : 0);
        const body = clone(Object.assign({}, data, { id }));
        const doc = { key, type, id, careerId: body.careerId || null, updatedAt, deleted: false, data: body };
        setDoc(doc, 'local');
        await persistLocal(doc);
        enqueue(doc);
        return doc.data;
      },
      async remove(type, id) {
        const key = keyOf(type, id);
        const prev = mem.get(key);
        if (!prev || prev.deleted) return false;
        const updatedAt = Math.max(o.now(), prev.updatedAt + 1);
        const doc = { key, type, id, careerId: prev.careerId, updatedAt, deleted: true, data: null };
        setDoc(doc, 'local');
        await persistLocal(doc);
        enqueue(doc);
        return true;
      },
      /** Smaže kariéru i všechno, co k ní patří (soupiska, taktiky, zápasy, soupeři, paměť). */
      async removeCareer(careerId) {
        let n = 0;
        for (const d of [...mem.values()]) {
          if (d.deleted) continue;
          if ((d.type === 'career' && d.id === careerId) || d.careerId === careerId) {
            if (await store.remove(d.type, d.id)) n++;
          }
        }
        return n;
      },
      /** Smaže všechna uživatelská data (zůstanou jen prázdné náhrobky, aby se smazání rozneslo).
          Na novém zařízení nejdřív počká na první úplný stav ze serveru (nejdéle `waitMs`), jinak by dokumenty, které
          dorazí až po smazání, data vrátily. Vrací {removed, complete}: complete=false znamená, že server neodpověděl
          a na něm mohla data zůstat. */
      async purgeAll(waitMs) {
        let complete = !o.remote || firstDefinitive;
        if (!complete) {
          const end = o.now() + (waitMs === undefined ? 8000 : waitMs);
          while (!firstDefinitive && status.remote !== 'error' && o.now() < end) await new Promise((r) => setTimeout(r, 50));
          complete = firstDefinitive;
        }
        let removed = 0;
        for (const d of [...mem.values()]) if (!d.deleted && (await store.remove(d.type, d.id))) removed++;
        return { removed, complete };
      },
      /** Úplný export (záloha). */
      exportAll() {
        return { format: 'fm27-trener-data', version: 1, exportedAt: new Date(o.now()).toISOString(), docs: [...mem.values()].filter((d) => !d.deleted).map((d) => clone(d)) };
      },
      /** Import zálohy. Živý dokument se přepíše jen novějším. Smazaný dokument (náhrobek) záloha vrátí vždy: uživatel o obnovu
          výslovně požádal, a aby ji přijala i druhá zařízení, dostane dokument novější čas než náhrobek.
          Vrací počet přijatých dokumentů; počty přijatých a přeskočených (poškozených) zůstanou v `lastImport`. */
      async importAll(data) {
        if (!data || data.format !== 'fm27-trener-data' || !Array.isArray(data.docs)) throw new Error('Tohle není záloha dat FM27 Tactical Coach.');
        let n = 0;
        let skipped = 0;
        for (const d of data.docs) {
          if (!validDoc(d) || d.deleted) {
            if (!(isPlain(d) && d.deleted === true)) skipped++;
            continue;
          }
          const cur = mem.get(d.key);
          if (cur && !cur.deleted && cur.updatedAt >= d.updatedAt) continue;
          const copy = clone(d);
          if (cur) copy.updatedAt = Math.max(o.now(), cur.updatedAt + 1, copy.updatedAt);
          setDoc(copy, 'local');
          await persistLocal(copy);
          enqueue(copy);
          n++;
        }
        store.lastImport = { accepted: n, skipped };
        return n;
      },
      lastImport: { accepted: 0, skipped: 0 },
      draft: clone,
      flush,
      makeId,
      close() {
        if (unwatch) unwatch();
        clearTimeout(flushTimer);
      },
    };
    return store;
  }

  return { createStore, MemoryBackend, IdbBackend, DbBackend, MemoryRemote, TYPES, makeId, keyOf };
});
