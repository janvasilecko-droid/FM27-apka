/* Zapisovač syntetických payloadů taktiky (.tac) pro zkoušky modulu fmftac.js a zkoušku v prohlížeči.
   Do repozitáře nepatří žádný skutečný obsah: všechno tu je vymyšlené (názvy, čísla, bajty se berou z generátoru pseudonáhodných čísel).
   Gramatika je zapsaná ZNOVU a nezávisle na zkoušeném modulu (jiná struktura kódu, vlastní konstanty), aby se případná chyba v něm neprojevila i tady.
   Zapisovač bere strom ve stejném tvaru, jaký vrací parse(): zápis stromu zpět musí dát původní bajty. */
'use strict';
const { prng } = require('./fmf_builder.cjs');

const MAGIC = Buffer.from([0x03, 0x01, 0x63, 0x61, 0x74, 0x2e, 0x22, 0x00, 0x22, 0x44, 0x00, 0x1b, 0x00, 0x00, 0x00, 0x02]);

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const textBytes = (s) => (s && typeof s === 'object' && s.raw ? Buffer.from(s.raw) : Buffer.from(String(s), 'utf8'));
const strBytes = (s) => {
  const t = textBytes(s);
  return Buffer.concat([u32(t.length), t]);
};

/** Zapíše strom. Vrací {bytes, segments}; segments = [{kind, start, end}] pro zkoušky poškození:
    const = pevná konstanta, zero = bajty, které musí být nulové, flag8/flag32 = příznak 0 nebo 1, constA = značka bloku, jejíž vada se hlásí na začátku značky (čte se jako konec řady dvojic),
    len = počet nebo délka, data = volná data. */
function encodeWithMap(tree) {
  const parts = [];
  let at = 0;
  const add = (kind, buf) => {
    const b = Buffer.from(buf);
    parts.push({ kind, start: at, end: at + b.length, buf: b });
    at += b.length;
  };
  const block = (blk, marker) => {
    add(marker, [0x44, 0x00, 0x02]);
    add('data', u32(blk.selector));
    add('zero', [0x00]);
    add('const', [0x01]);
    add('flag8', [blk.flag]);
    add('len', u32(blk.items.length));
    for (const it of blk.items) {
      add('data', u64(it.key));
      add('const', [0x02, 0x02, 0x02]);
      add('data', u64(it.mask2));
      add('const', [0xff]);
      add('data', u32(it.value));
    }
    add('zero', [0, 0, 0, 0]);
    add('data', u64(blk.mask));
  };
  add('const', MAGIC);
  add('len', u32(textBytes(tree.title).length));
  add('data', textBytes(tree.title));
  add('zero', Buffer.alloc(12));
  add('data', tree.hdr6);
  add('data', tree.packed12);
  add('const', [0xff]);
  add('len', u32(textBytes(tree.style).length));
  add('data', textBytes(tree.style));
  add('data', tree.quad4);
  for (const p of tree.pairs) {
    block(p.a, 'constA');
    block(p.b, 'const');
    add('data', [p.slot]);
  }
  add('const', [0x01]);
  add('len', u32(tree.idList.entries.length));
  for (const e of tree.idList.entries) {
    add('data', u32(e.id));
    add('flag32', u32(e.flag));
    if (e.flag === 1) block(e.block, 'const');
  }
  add('zero', [0, 0, 0, 0]);
  add('len', u32(tree.footer.lists.length));
  for (const l of tree.footer.lists) {
    add('data', u32(l.tag));
    add('len', u32(l.ids.length));
    for (const id of l.ids) {
      add('const', [0x01, 0x00]);
      add('data', u32(id));
    }
  }
  add('const', [0x01, 0x00, 0x00, 0x00]);
  for (const r of tree.footer.records) add('data', r);
  add('data', [tree.footer.endByte]);
  add('zero', Buffer.alloc(30));
  return { bytes: Buffer.concat(parts.map((x) => x.buf)), segments: parts.map(({ kind, start, end }) => ({ kind, start, end })) };
}
const encode = (tree) => encodeWithMap(tree).bytes;

const TITLES = ['Testovací taktika', 'Žluťoučký kůň úpěl ďábelské ódy', 'Taktika ⚽ 🧪 日本語', 'x', ''];
const STYLES = ['Vlastní styl (vymyšlený)', 'Úplně jiný popis stylu', ''];

/** Vymyšlený strom podle gramatiky; opts: {pairs, maxItems, entries, lists, nestedChance} */
function randomTree(seed, opts) {
  const o = opts || {};
  const rand = prng(seed);
  const int = (n) => rand(4).readUInt32LE(0) % n;
  const u32r = () => rand(4).readUInt32LE(0);
  const u64r = () => rand(8).readBigUInt64LE(0);
  const bytes = (n) => Uint8Array.from(rand(n));
  const block = (flag) => ({
    selector: u32r(),
    flag: flag === undefined ? int(2) : flag,
    items: Array.from({ length: int((o.maxItems === undefined ? 6 : o.maxItems) + 1) }, () => ({ key: u64r(), mask2: u64r(), value: u32r() })),
    mask: u64r(),
  });
  const nPairs = o.pairs === undefined ? int(14) : o.pairs;
  const nEntries = o.entries === undefined ? int(6) : o.entries;
  const nLists = o.lists === undefined ? int(4) : o.lists;
  const hdr6 = bytes(6);
  hdr6[0] = 0x04;
  hdr6[3] = 0x07;
  hdr6[4] = 0x02;
  hdr6[5] = 0x03;
  return {
    title: TITLES[int(TITLES.length)],
    hdr6,
    packed12: bytes(12),
    style: STYLES[int(STYLES.length)],
    quad4: bytes(4),
    pairs: Array.from({ length: nPairs }, () => ({ a: block(), b: block(), slot: int(256) })),
    idList: { entries: Array.from({ length: nEntries }, () => { const flag = int(2); return { id: u32r(), flag, block: flag === 1 ? block() : null }; }) },
    footer: {
      lists: Array.from({ length: nLists }, () => ({ tag: u32r(), ids: Array.from({ length: int(5) }, () => u32r()) })),
      records: Array.from({ length: 12 }, () => bytes(13)),
      endByte: int(256),
    },
  };
}

/** Strom převedený na prosté hodnoty (bajty jako šestnáctkový text), aby šly porovnat strom ze zapisovače a strom z čtečky. Posuny bloků se vynechají. */
function plain(tree) {
  const hex = (x) => Buffer.from(x).toString('hex');
  const strHex = (s) => hex(textBytes(s));
  const blk = (x) => (x ? { selector: x.selector, flag: x.flag, items: x.items.map((i) => ({ key: BigInt(i.key), mask2: BigInt(i.mask2), value: i.value })), mask: BigInt(x.mask) } : null);
  return {
    title: strHex(tree.title),
    hdr6: hex(tree.hdr6),
    packed12: hex(tree.packed12),
    style: strHex(tree.style),
    quad4: hex(tree.quad4),
    pairs: tree.pairs.map((p) => ({ a: blk(p.a), b: blk(p.b), slot: p.slot })),
    entries: tree.idList.entries.map((e) => ({ id: e.id, flag: e.flag, block: blk(e.block) })),
    lists: tree.footer.lists.map((l) => ({ tag: l.tag, ids: l.ids.slice() })),
    records: tree.footer.records.map(hex),
    endByte: tree.footer.endByte,
  };
}

/** Obvyklý vymyšlený payload: 11 dvojic a 11 míst v pořadí promíchaném podle semínka, pár záznamů v seznamu id a jeden seznam v patičce. */
function standardTree(seed, title) {
  const t = randomTree(seed, { pairs: 11, maxItems: 8, entries: 3, lists: 1 });
  t.title = title === undefined ? 'Testovací taktika' : title;
  const order = Array.from({ length: 11 }, (_, i) => i);
  const rand = prng(seed + 1000);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rand(4).readUInt32LE(0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  t.pairs.forEach((p, i) => { p.slot = order[i]; });
  return t;
}
const standardTac = (seed, title) => encode(standardTree(seed, title));

/** Počty podle zapisovaného stromu, spočítané přímo (nezávisle na summary() ve zkoušeném modulu). */
function counts(tree) {
  let blocks = 0;
  let items = 0;
  for (const p of tree.pairs) {
    blocks += 2;
    items += p.a.items.length + p.b.items.length;
  }
  for (const e of tree.idList.entries) {
    if (e.flag === 1) {
      blocks += 1;
      items += e.block.items.length;
    }
  }
  return { pairs: tree.pairs.length, blocks, items, idEntries: tree.idList.entries.length, footerLists: tree.footer.lists.length };
}

module.exports = { MAGIC, TITLES, STYLES, encode, encodeWithMap, randomTree, standardTree, standardTac, plain, counts };
