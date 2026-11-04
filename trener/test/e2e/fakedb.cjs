/* Falešná schopnost `db` Claude pro zkoušky v prohlížeči. Server žije v Node, takže dva prohlížeče (počítač a telefon)
   sdílejí jedna data jako na skutečném účtu. Platí pravidlo skutečné `db`: podsložka data/users/<id> je soukromá,
   cizí id se čte jako neexistující a zápis do ní selže `invalid_argument`. */

class FakeDbServer {
  constructor() {
    this.docs = new Map(); // úplná cesta → tělo
    this.subs = []; // {page, subId, collection, uid}
    this.writes = 0;
    this.failWrites = null; // {code}
  }

  visible(uid, path) {
    const m = /^data\/users\/([^/]+)(\/|$)/.exec(path);
    return !m || m[1] === uid;
  }

  list(collection, uid) {
    const prefix = collection + '/';
    const out = [];
    for (const [path, body] of this.docs) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && this.visible(uid, path)) out.push([path, body]);
    }
    return out;
  }

  async handle(page, uid, op, a, b) {
    if (op === 'set' || op === 'delete') {
      if (this.failWrites) throw this.failWrites;
      if (!this.visible(uid, a)) throw { code: 'invalid_argument', message: 'cizí podsložka' };
      this.writes++;
      const existed = this.docs.has(a);
      if (op === 'set') this.docs.set(a, JSON.parse(JSON.stringify(b)));
      else this.docs.delete(a);
      const collection = a.slice(0, a.lastIndexOf('/'));
      for (const s of this.subs.filter((x) => x.collection === collection && this.visible(x.uid, a))) {
        const change = { type: op === 'delete' ? 'removed' : existed ? 'modified' : 'added', id: a.slice(a.lastIndexOf('/') + 1), data: op === 'delete' ? null : this.docs.get(a) };
        s.page.evaluate(([id, ch]) => window.__dbPush && window.__dbPush(id, ch), [s.subId, [change]]).catch(() => {});
      }
      return null;
    }
    if (op === 'get') return this.visible(uid, a) && this.docs.has(a) ? this.docs.get(a) : null;
    if (op === 'subscribe') {
      const { subId, collection } = a;
      this.subs.push({ page, subId, collection, uid });
      const changes = this.list(collection, uid).map(([path, body]) => ({ type: 'added', id: path.slice(path.lastIndexOf('/') + 1), data: body }));
      setTimeout(() => page.evaluate(([id, ch]) => window.__dbPush && window.__dbPush(id, ch), [subId, changes]).catch(() => {}), 5);
      return null;
    }
    if (op === 'unsubscribe') {
      this.subs = this.subs.filter((s) => !(s.page === page && s.subId === a));
      return null;
    }
    throw new Error('neznámá operace ' + op);
  }

  /** Připojí falešnou db ke kontextu prohlížeče; `uid` je id přihlášeného uživatele. */
  async attach(context, uid) {
    const self = this;
    await context.exposeBinding('__dbCall', ({ page }, op, a, b) => self.handle(page, uid, op, a, b));
  }
}

/** Kód, který se spustí ve stránce před jejími skripty: postaví `db` a `user`, které si stránka vyzvedne přes claude.use. */
function installDbMock(config) {
  const subs = new Map();
  let nextSub = 1;
  const call = (op, a, b) => window.__dbCall(op, a, b).catch((e) => {
    throw e && e.code ? e : { code: 'unavailable', message: String(e && e.message ? e.message : e) };
  });
  const wrap = (id, data) => ({ id, exists: data !== null && data !== undefined, data: () => (data === null ? undefined : data), metadata: { fromCache: false, hasPendingWrites: false } });
  window.__dbPush = (subId, changes) => {
    const s = subs.get(subId);
    if (!s) return;
    for (const c of changes) {
      if (c.type === 'removed') s.docs.delete(c.id);
      else s.docs.set(c.id, c.data);
    }
    s.next({
      docs: [...s.docs].map(([id, d]) => wrap(id, d)),
      size: s.docs.size,
      empty: !s.docs.size,
      docChanges: () => changes.map((c) => ({ type: c.type, doc: wrap(c.id, c.data), oldIndex: -1, newIndex: -1 })),
      metadata: { fromCache: false, hasPendingWrites: false },
    });
  };
  const docRef = (path) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get: async () => wrap(path.slice(path.lastIndexOf('/') + 1), await call('get', path)),
    set: (data) => call('set', path, data),
    update: async (data) => call('set', path, Object.assign({}, await call('get', path), data)),
    delete: () => call('delete', path),
  });
  const collection = (path) => ({
    path,
    doc: (id) => docRef(path + '/' + id),
    onSnapshot(next, error) {
      const subId = 's' + nextSub++;
      subs.set(subId, { next, error, docs: new Map() });
      call('subscribe', { subId, collection: path }).catch((e) => error && error(e));
      return () => {
        subs.delete(subId);
        call('unsubscribe', subId).catch(() => {});
      };
    },
  });
  window.__dbMock = { collection, doc: docRef };
  window.__userMock = {
    id: async () => config.uid,
    isOwner: () => true,
    canEdit: () => true,
    can: () => true,
    me: async () => ({ id: config.uid }),
  };
}

module.exports = { FakeDbServer, installDbMock };
