import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const T = require('../src/fmftac.js');
const C = require('../src/fmfcontainer.js');
const source = readFileSync(new URL('../src/fmftac.js', import.meta.url), 'utf8');

// zapisovač je ve sdíleném souboru, napsaný znovu a nezávisle na zkoušeném modulu (sdílí ho zkouška v prohlížeči)
const W = require('./fixtures/fmftac_builder.cjs');
const { prng } = require('./fixtures/fmf_builder.cjs');
const { encode, encodeWithMap, randomTree, standardTree, plain } = W;
const deps = {
  zstd: (b, max) => new Uint8Array(zlib.zstdDecompressSync(b, { maxOutputLength: max })),
  aesCtr: async (key, iv, data) => { const d = crypto.createDecipheriv('aes-128-ctr', key, iv); return new Uint8Array(Buffer.concat([d.update(data), d.final()])); },
};
const flip = (buf, at, mask) => { const c = Buffer.from(buf); c[at] ^= mask === undefined ? 0x01 : mask; return c; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// ---------------------------------------------------------------- základ: ruční strom, hodnoty pole po poli
const handTree = () => ({
  title: 'Žluťoučký kůň ⚽',
  hdr6: Uint8Array.from([0x04, 0x02, 0x05, 0x07, 0x02, 0x03]),
  packed12: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  style: 'Vlastní styl',
  quad4: Uint8Array.from([0x4c, 0x4c, 0x55, 0x4e]),
  pairs: [
    { a: { selector: 0x00010004, flag: 1, items: [{ key: 1n << 57n, mask2: 0xffffffffffffffffn, value: 0xffffffff }, { key: 4n, mask2: 0n, value: 8 }], mask: 0x0000000000200004n }, b: { selector: 7, flag: 0, items: [], mask: 0n }, slot: 3 },
    { a: { selector: 9, flag: 0, items: [{ key: 2n, mask2: 5n, value: 4 }], mask: 3n }, b: { selector: 0xffffffff, flag: 1, items: [], mask: 0xffffffffffffffffn }, slot: 0 },
  ],
  idList: { entries: [{ id: 7, flag: 0, block: null }, { id: 4294967295, flag: 1, block: { selector: 1, flag: 0, items: [{ key: 8n, mask2: 8n, value: 0 }], mask: 8n } }] },
  footer: { lists: [{ tag: 0x100400, ids: [24356, 1] }, { tag: 0, ids: [] }], records: Array.from({ length: 12 }, (_, i) => Uint8Array.from({ length: 13 }, (_, k) => (i * 13 + k) & 255)), endByte: 0x2a },
});

test('čtečka: ručně zapsaný strom se přečte a každé pole sedí', () => {
  const bytes = encode(handTree());
  const r = T.parse(new Uint8Array(bytes));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.error, '');
  assert.equal(r.offset, null);
  assert.equal(r.size, bytes.length);
  const t = r.tree;
  assert.equal(t.title.text, 'Žluťoučký kůň ⚽');
  assert.equal(Buffer.from(t.title.raw).toString('utf8'), 'Žluťoučký kůň ⚽');
  assert.equal(t.style.text, 'Vlastní styl');
  assert.deepEqual(Array.from(t.hdr6), [0x04, 0x02, 0x05, 0x07, 0x02, 0x03]);
  assert.deepEqual(Array.from(t.packed12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(Array.from(t.quad4), [0x4c, 0x4c, 0x55, 0x4e]);
  assert.equal(t.pairs.length, 2);
  const a0 = t.pairs[0].a;
  assert.equal(a0.selector, 0x00010004);
  assert.equal(a0.flag, 1);
  assert.equal(a0.mask, 0x200004n);
  assert.equal(a0.items.length, 2);
  assert.equal(a0.items[0].key, 1n << 57n);
  assert.equal(a0.items[0].mask2, 0xffffffffffffffffn);
  assert.equal(a0.items[0].value, 0xffffffff);
  assert.equal(typeof a0.items[0].key, 'bigint');
  assert.equal(a0.items[1].key, 4n);
  assert.equal(a0.items[1].value, 8);
  assert.equal(t.pairs[0].slot, 3);
  assert.equal(t.pairs[0].b.items.length, 0);
  assert.equal(t.pairs[1].b.selector, 0xffffffff);
  assert.equal(t.pairs[1].b.mask, 0xffffffffffffffffn);
  assert.equal(t.pairs[1].slot, 0);
  assert.deepEqual(t.idList.entries.map((e) => [e.id, e.flag, !!e.block]), [[7, 0, false], [4294967295, 1, true]]);
  assert.equal(t.idList.entries[1].block.items[0].key, 8n);
  assert.deepEqual(t.footer.lists, [{ tag: 0x100400, ids: [24356, 1] }, { tag: 0, ids: [] }]);
  assert.equal(t.footer.records.length, 12);
  assert.deepEqual(Array.from(t.footer.records[11]), Array.from({ length: 13 }, (_, k) => (11 * 13 + k) & 255));
  assert.equal(t.footer.endByte, 0x2a);
  // posun bloku ukazuje na jeho značku 44 00 02
  for (const p of t.pairs) for (const blk of [p.a, p.b]) assert.deepEqual(Array.from(bytes.subarray(blk.offset, blk.offset + 3)), [0x44, 0x00, 0x02]);
});

test('čtečka: nejmenší možný payload (bez dvojic, bez id, bez seznamů) se přečte a zapíše zpět', () => {
  const tree = randomTree(1, { pairs: 0, entries: 0, lists: 0 });
  tree.title = '';
  tree.style = '';
  const bytes = encode(tree);
  const r = T.parse(new Uint8Array(bytes));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.tree.pairs.length, 0);
  assert.equal(r.tree.idList.entries.length, 0);
  assert.equal(r.tree.title.text, '');
  assert.deepEqual(plain(r.tree), plain(tree));
  assert.ok(Buffer.from(encode(r.tree)).equals(bytes));
});

// ---------------------------------------------------------------- náhodné stromy a zápis zpět
test('náhodné stromy: přečtení dá stejný strom a zápis zpět dá stejné bajty (300 stromů)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const tree = randomTree(seed, seed % 7 === 0 ? { maxItems: 40, pairs: 20, entries: 30 } : undefined);
    const bytes = encode(tree);
    const r = T.parse(new Uint8Array(bytes));
    assert.equal(r.ok, true, `semínko ${seed}: ${r.error} @${r.offset}`);
    assert.deepEqual(plain(r.tree), plain(tree), `semínko ${seed}`);
    assert.ok(Buffer.from(encode(r.tree)).equals(bytes), `semínko ${seed}: zápis zpět se liší`);
    assert.equal(r.size, bytes.length);
  }
});

test('řetězce: název a styl se čtou jako UTF-8; vadné UTF-8 se nezahodí (zůstanou původní bajty), text je náhradní', () => {
  const tree = randomTree(5, { pairs: 1, entries: 0, lists: 0 });
  tree.title = { raw: Uint8Array.from([0x41, 0xff, 0xfe, 0x42]) }; // vadné UTF-8
  const bytes = encode(tree);
  const r = T.parse(new Uint8Array(bytes));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(Array.from(r.tree.title.raw), [0x41, 0xff, 0xfe, 0x42]);
  assert.equal(r.tree.title.text, 'A��B');
  assert.ok(Buffer.from(encode(r.tree)).equals(bytes));
});

// ---------------------------------------------------------------- souhrn
test('summary: počty odpovídají stromu; jedenáct dvojic a místa jako permutace se poznají, odchylky se neskryjí', () => {
  const t = standardTree(21);
  const r = T.parse(new Uint8Array(encode(t)));
  const s = T.summary(r.tree);
  const items = t.pairs.reduce((n, p) => n + p.a.items.length + p.b.items.length, 0) + t.idList.entries.reduce((n, e) => n + (e.block ? e.block.items.length : 0), 0);
  const nested = t.idList.entries.filter((e) => e.block).length;
  assert.deepEqual(s, { pairs: 11, pairsAsExpected: true, blocks: 22 + nested, nestedBlocks: nested, items, idEntries: 3, footerLists: 1, records: 12, slotsArePermutation: true });
  assert.equal(T.summary(null), null);
  assert.equal(T.summary(undefined), null);
  // dvojí číslo místa: už to není permutace
  const dup = standardTree(21);
  dup.pairs[1].slot = dup.pairs[0].slot;
  assert.equal(T.summary(T.parse(new Uint8Array(encode(dup))).tree).slotsArePermutation, false);
  // číslo místa mimo rozsah 0..10
  const out = standardTree(21);
  out.pairs.find((p) => p.slot === 10).slot = 11;
  assert.equal(T.summary(T.parse(new Uint8Array(encode(out))).tree).slotsArePermutation, false);
  // deset dvojic: strukturálně v pořádku, ale ne podle očekávání
  const ten = randomTree(3, { pairs: 10, entries: 0, lists: 0 });
  ten.pairs.forEach((p, i) => { p.slot = i; });
  const s10 = T.summary(T.parse(new Uint8Array(encode(ten))).tree);
  assert.equal(s10.pairs, 10);
  assert.equal(s10.pairsAsExpected, false);
  assert.equal(s10.slotsArePermutation, true);
  assert.equal(s10.idEntries, 0);
  // dvanáct dvojic
  const twelve = randomTree(3, { pairs: 12, entries: 0, lists: 0 });
  assert.equal(T.summary(T.parse(new Uint8Array(encode(twelve))).tree).pairsAsExpected, false);
  // prázdný strom bez dvojic: permutace prázdné množiny, ale nepovažuje se za očekávaný
  const none = randomTree(3, { pairs: 0, entries: 0, lists: 0 });
  const s0 = T.summary(T.parse(new Uint8Array(encode(none))).tree);
  assert.equal(s0.pairsAsExpected, false);
  assert.equal(s0.blocks, 0);
  assert.equal(s0.items, 0);
});

test('summary: počty se berou ze stromu, ne z pevných čísel (ručně zkrácený strom)', () => {
  const tree = T.parse(new Uint8Array(encode(standardTree(22)))).tree;
  const cut = { ...tree, footer: { ...tree.footer, records: tree.footer.records.slice(0, 5), lists: [] }, pairs: tree.pairs.slice(0, 4) };
  const s = T.summary(cut);
  assert.equal(s.records, 5);
  assert.equal(s.footerLists, 0);
  assert.equal(s.pairs, 4);
  assert.equal(s.slotsArePermutation, false); // čtyři místa z jedenácti nejsou 0..3
});

test('safeReport: jen výsledek a počty, nikdy název, styl ani čísla z taktiky; vadný vstup nese pevnou větu a posun', () => {
  const tree = standardTree(23, 'Tajný název taktiky');
  tree.style = 'Tajný popis stylu';
  const r = T.parse(new Uint8Array(encode(tree)));
  const rep = T.safeReport(r);
  assert.deepEqual(rep, { ok: true, size: r.size, ...T.summary(r.tree) });
  const json = JSON.stringify(rep);
  assert.doesNotMatch(json, /Tajný/);
  assert.deepEqual(Object.keys(rep).sort(), ['blocks', 'footerLists', 'idEntries', 'items', 'nestedBlocks', 'ok', 'pairs', 'pairsAsExpected', 'records', 'size', 'slotsArePermutation']);
  const bad = T.parse(new Uint8Array(encode(tree).subarray(0, 100)));
  const brep = T.safeReport(bad);
  assert.deepEqual(brep, { ok: false, size: 100, error: bad.error, offset: bad.offset });
  assert.ok(brep.error.length > 0 && Number.isInteger(brep.offset));
  assert.doesNotMatch(JSON.stringify(brep), /Tajný/);
  // chyba bez posunu (vstup není binární) a vstup, který zpráva nezná
  assert.deepEqual(T.safeReport(T.parse(null)), { ok: false, size: 0, error: 'Vstup není binární.', offset: null });
  assert.equal(T.safeReport(null), null);
  assert.equal(T.safeReport(undefined), null);
  assert.equal(T.safeReport('x'), null);
  // výsledek bez stromu se nikdy nehlásí jako přečtený, ani když má ok = true
  assert.equal(T.safeReport({ ok: true, tree: null, size: 5 }).ok, false);
  assert.equal(T.safeReport({ ok: false, tree: r.tree, size: 5, error: 'x', offset: 1 }).ok, false);
});

test('summary: vnořené bloky v seznamu id se započítají do bloků i položek', () => {
  const t = randomTree(9, { pairs: 11, entries: 0, lists: 0, maxItems: 3 });
  t.idList.entries = [
    { id: 1, flag: 1, block: { selector: 1, flag: 0, items: [{ key: 1n, mask2: 1n, value: 1 }, { key: 2n, mask2: 2n, value: 2 }], mask: 1n } },
    { id: 2, flag: 0, block: null },
    { id: 3, flag: 1, block: { selector: 2, flag: 0, items: [], mask: 2n } },
  ];
  const base = T.summary(T.parse(new Uint8Array(encode({ ...t, idList: { entries: [] } }))).tree);
  const s = T.summary(T.parse(new Uint8Array(encode(t))).tree);
  assert.equal(s.nestedBlocks, 2);
  assert.equal(s.blocks, base.blocks + 2);
  assert.equal(s.items, base.items + 2);
  assert.equal(s.idEntries, 3);
});

// ---------------------------------------------------------------- vadné vstupy
test('zkrácený vstup: každá kratší délka se odmítne s popisem a posunem v mezích, nic nespadne', () => {
  for (const seed of [1, 2, 3, 4]) {
    const bytes = encode(randomTree(seed, { pairs: 3, entries: 2, lists: 2, maxItems: 3 }));
    for (let n = 0; n < bytes.length; n++) {
      const r = T.parse(new Uint8Array(bytes.subarray(0, n)));
      assert.equal(r.ok, false, `semínko ${seed}, délka ${n}`);
      assert.equal(r.tree, null);
      assert.ok(typeof r.error === 'string' && r.error.length > 0, `délka ${n}`);
      assert.ok(Number.isInteger(r.offset) && r.offset >= 0 && r.offset <= n, `délka ${n}: posun ${r.offset}`);
      assert.equal(r.size, n);
    }
    assert.equal(T.parse(new Uint8Array(bytes)).ok, true);
  }
});

test('useknutí přesně za značkou bloku se hlásí jako useknutí uvnitř bloku, ne jako chybějící seznam id', () => {
  const { bytes, segments } = encodeWithMap(randomTree(8, { pairs: 2, entries: 0, lists: 0, maxItems: 2 }));
  const markA = segments.find((s) => s.kind === 'constA');
  // posun míří na začátek pole, které se číst nepodařilo: selektor (4 bajty) začíná hned za značkou, bajt za ním o čtyři dál
  for (const [cut, at] of [[markA.end, markA.end], [markA.end + 1, markA.end], [markA.end + 3, markA.end], [markA.end + 4, markA.end + 4]]) {
    const r = T.parse(new Uint8Array(bytes.subarray(0, cut)));
    assert.equal(r.ok, false);
    assert.match(r.error, /useknutý/);
    assert.equal(r.offset, at, `řez ${cut}`);
  }
  // značka bloku A zkrácená o poslední bajt: nepozná se jako blok, hlásí se chybějící seznam id na začátku značky
  const short = T.parse(new Uint8Array(bytes.subarray(0, markA.end - 1)));
  assert.equal(short.ok, false);
  assert.match(short.error, /Čekal jsem značku seznamu id/);
  assert.equal(short.offset, markA.start);
});

test('bajty navíc za koncem: odmítnuto s počtem a posunem na první nadbytečný bajt', () => {
  const bytes = encode(randomTree(2, { pairs: 2, entries: 1, lists: 1 }));
  for (const extra of [1, 2, 30, 100]) {
    const r = T.parse(new Uint8Array(Buffer.concat([bytes, Buffer.alloc(extra)])));
    assert.equal(r.ok, false);
    assert.match(r.error, new RegExp(`zbývá ${extra} bajt`));
    assert.equal(r.offset, bytes.length);
  }
});

test('poškození jednoho bajtu v konstantě nebo v nulách se hlásí přesně na tom bajtu (značka dvojice na jejím začátku)', () => {
  let checked = 0;
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const { bytes, segments } = encodeWithMap(randomTree(seed, { pairs: 4, entries: 3, lists: 2, maxItems: 4 }));
    for (const s of segments) {
      if (s.kind !== 'const' && s.kind !== 'zero' && s.kind !== 'constA') continue;
      for (let at = s.start; at < s.end; at++) {
        for (const mask of [0x01, 0x80, 0xff]) {
          const r = T.parse(new Uint8Array(flip(bytes, at, mask)));
          assert.equal(r.ok, false, `semínko ${seed}, ${s.kind} @${at}`);
          assert.equal(r.offset, s.kind === 'constA' ? s.start : at, `semínko ${seed}, ${s.kind} @${at}: ${r.error}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 3000, 'zkoušelo se málo bajtů: ' + checked);
});

test('příznaky: u bloku (jeden bajt) a u záznamu id (čtyři bajty) smí být jen 0 nebo 1; jiná hodnota se odmítne na příznaku', () => {
  let checked = 0;
  for (const seed of [21, 22, 23]) {
    const { bytes, segments } = encodeWithMap(randomTree(seed, { pairs: 3, entries: 4, lists: 1 }));
    for (const s of segments) {
      if (s.kind === 'flag8') {
        const r = T.parse(new Uint8Array(flip(bytes, s.start, 0x02)));
        assert.equal(r.ok, false);
        assert.match(r.error, /Příznak bloku/);
        assert.equal(r.offset, s.start);
        checked++;
      } else if (s.kind === 'flag32') {
        for (let at = s.start; at < s.end; at++) {
          const r = T.parse(new Uint8Array(flip(bytes, at, at === s.start ? 0x02 : 0x01)));
          assert.equal(r.ok, false);
          assert.match(r.error, /Příznak záznamu/);
          assert.equal(r.offset, s.start);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 40, String(checked));
  // přepnutí 0 ↔ 1 je jiná platná stavba nebo chyba, nikdy tichý souhlas se starým stromem
  const { bytes, segments } = encodeWithMap(randomTree(24, { pairs: 2, entries: 2, lists: 0 }));
  const f = segments.find((s) => s.kind === 'flag8');
  const r = T.parse(new Uint8Array(flip(bytes, f.start, 0x01)));
  if (r.ok) assert.ok(Buffer.from(encode(r.tree)).equals(flip(bytes, f.start, 0x01)));
});

test('nahodilé poškození (výměny, vložení, vymazání, zkrácení): čtečka nikdy nespadne a co přijme, to se zapíše zpět stejně', () => {
  const rand = prng(99);
  const int = (n) => rand(4).readUInt32LE(0) % n;
  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < 4000; i++) {
    const base = encode(randomTree(1 + (i % 25), { pairs: 1 + (i % 4), entries: i % 3, lists: i % 3, maxItems: 4 }));
    let b = Buffer.from(base);
    const kind = int(5);
    const at = int(b.length);
    if (kind === 0) b[at] = int(256);
    else if (kind === 1) b = Buffer.concat([b.subarray(0, at), Buffer.from([int(256)]), b.subarray(at)]);
    else if (kind === 2) b = Buffer.concat([b.subarray(0, at), b.subarray(at + 1 + int(3))]);
    else if (kind === 3) b = b.subarray(0, at);
    else for (let k = 0; k < 4; k++) b[int(b.length)] = int(256);
    let r;
    assert.doesNotThrow(() => { r = T.parse(new Uint8Array(b)); });
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) {
      accepted++;
      assert.ok(Buffer.from(encode(r.tree)).equals(b), `přijatý vstup se nezapíše zpět stejně (i = ${i})`);
    } else {
      rejected++;
      assert.equal(r.tree, null);
      assert.ok(r.error.length > 0);
    }
  }
  assert.ok(rejected > 1000 && accepted > 0, `přijato ${accepted}, odmítnuto ${rejected}`); // zkouška má smysl, jen když obojí nastává
});

test('meze: příliš velké počty se odmítnou dřív, než by se pro ně cokoli alokovalo', () => {
  const base = encodeWithMap(randomTree(31, { pairs: 1, entries: 0, lists: 0, maxItems: 0 }));
  const count = base.segments.filter((s) => s.kind === 'len')[1]; // [0] je délka názvu, [1] je délka stylu
  assert.ok(count);
  // název delší než mez
  const longTitle = randomTree(32, { pairs: 0, entries: 0, lists: 0 });
  longTitle.title = 'x'.repeat(T.LIMITS.maxString + 1);
  let r = T.parse(new Uint8Array(encode(longTitle)));
  assert.equal(r.ok, false);
  assert.match(r.error, /příliš dlouhý/);
  longTitle.title = 'x'.repeat(T.LIMITS.maxString);
  assert.equal(T.parse(new Uint8Array(encode(longTitle))).ok, true);
  // položek v bloku: přesně na mezi se přečte, o jednu víc se odmítne
  const full = randomTree(33, { pairs: 0, entries: 1, lists: 0 });
  full.idList.entries = [{ id: 1, flag: 1, block: { selector: 1, flag: 0, items: Array.from({ length: T.LIMITS.maxItems }, (_, i) => ({ key: BigInt(i), mask2: 1n, value: 1 })), mask: 1n } }];
  assert.equal(T.parse(new Uint8Array(encode(full))).ok, true);
  full.idList.entries[0].block.items.push({ key: 1n, mask2: 1n, value: 1 });
  r = T.parse(new Uint8Array(encode(full)));
  assert.equal(r.ok, false);
  assert.match(r.error, /příliš mnoho položek/);
  // počet položek 0xffffffff v hlavičce bloku, za ním nic: odmítnuto pro mez, ne pro zkrácení
  const huge = Buffer.from(encode(randomTree(34, { pairs: 1, entries: 0, lists: 0, maxItems: 0 })));
  const seg = encodeWithMap(randomTree(34, { pairs: 1, entries: 0, lists: 0, maxItems: 0 })).segments.filter((s) => s.kind === 'len');
  const itemsLen = seg[2]; // název, styl, počet položek prvního bloku
  u32(0xffffffff).copy(huge, itemsLen.start);
  r = T.parse(new Uint8Array(huge));
  assert.equal(r.ok, false);
  assert.match(r.error, /příliš mnoho položek/);
  // dvojic bloků
  const manyPairs = randomTree(35, { pairs: T.LIMITS.maxPairs + 1, entries: 0, lists: 0, maxItems: 0 });
  r = T.parse(new Uint8Array(encode(manyPairs)));
  assert.equal(r.ok, false);
  assert.match(r.error, /Příliš mnoho dvojic/);
  manyPairs.pairs.pop();
  assert.equal(T.parse(new Uint8Array(encode(manyPairs))).ok, true);
  // záznamů v seznamu id
  const manyEntries = randomTree(36, { pairs: 0, entries: 0, lists: 0 });
  manyEntries.idList.entries = Array.from({ length: T.LIMITS.maxEntries + 1 }, (_, i) => ({ id: i, flag: 0, block: null }));
  r = T.parse(new Uint8Array(encode(manyEntries)));
  assert.equal(r.ok, false);
  assert.match(r.error, /Seznam id je příliš dlouhý/);
  manyEntries.idList.entries.pop();
  assert.equal(T.parse(new Uint8Array(encode(manyEntries))).ok, true);
  // seznamů v patičce a id v seznamu
  const manyLists = randomTree(37, { pairs: 0, entries: 0, lists: 0 });
  manyLists.footer.lists = Array.from({ length: T.LIMITS.maxLists + 1 }, () => ({ tag: 1, ids: [] }));
  r = T.parse(new Uint8Array(encode(manyLists)));
  assert.equal(r.ok, false);
  assert.match(r.error, /Příliš mnoho seznamů/);
  manyLists.footer.lists.pop();
  assert.equal(T.parse(new Uint8Array(encode(manyLists))).ok, true);
  const longList = randomTree(38, { pairs: 0, entries: 0, lists: 0 });
  longList.footer.lists = [{ tag: 1, ids: Array.from({ length: T.LIMITS.maxListIds + 1 }, (_, i) => i) }];
  r = T.parse(new Uint8Array(encode(longList)));
  assert.equal(r.ok, false);
  assert.match(r.error, /Seznam v patičce je příliš dlouhý/);
  longList.footer.lists[0].ids.pop();
  assert.equal(T.parse(new Uint8Array(encode(longList))).ok, true);
  // celkový počet bloků (dvojice i vnořené)
  const manyBlocks = randomTree(39, { pairs: 0, entries: 0, lists: 0 });
  manyBlocks.idList.entries = Array.from({ length: T.LIMITS.maxBlocks + 1 }, (_, i) => ({ id: i, flag: 1, block: { selector: 1, flag: 0, items: [], mask: 0n } }));
  r = T.parse(new Uint8Array(encode(manyBlocks)));
  assert.equal(r.ok, false);
  assert.match(r.error, /Příliš mnoho bloků/);
  manyBlocks.idList.entries.pop();
  assert.equal(T.parse(new Uint8Array(encode(manyBlocks))).ok, true);
  // celý vstup: přesně na mezi se čte (a odmítne se pro obsah), o bajt víc se odmítne pro velikost
  r = T.parse(new Uint8Array(T.LIMITS.maxInput));
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /příliš velký/);
  assert.match(r.error, /Čekal jsem značku taktiky/);
  r = T.parse(new Uint8Array(T.LIMITS.maxInput + 1));
  assert.equal(r.ok, false);
  assert.match(r.error, /příliš velký/);
  assert.equal(r.size, T.LIMITS.maxInput + 1);
});

test('hlavička: 04 a b 07 02 03 se vyžaduje; jiný první, čtvrtý, pátý nebo šestý bajt se odmítne, a a b jsou volné', () => {
  const tree = randomTree(41, { pairs: 1, entries: 0, lists: 0 });
  const { bytes, segments } = encodeWithMap(tree);
  const titleLen = textLen(tree.title);
  const hdrStart = segments.filter((s) => s.kind === 'zero')[0].end; // za dvanácti nulami
  assert.equal(hdrStart, 16 + 4 + titleLen + 12);
  for (const k of [0, 3, 4, 5]) {
    const r = T.parse(new Uint8Array(flip(bytes, hdrStart + k, 0x10)));
    assert.equal(r.ok, false, `bajt ${k}`);
    assert.match(r.error, /Hlavička/);
    assert.equal(r.offset, hdrStart, `bajt ${k}`);
  }
  for (const k of [1, 2]) {
    const r = T.parse(new Uint8Array(flip(bytes, hdrStart + k, 0xff)));
    assert.equal(r.ok, true, `bajt ${k}: ${r.error}`);
    assert.equal(r.tree.hdr6[k], bytes[hdrStart + k] ^ 0xff);
  }
});
function textLen(s) { return Buffer.byteLength(s, 'utf8'); }

// ---------------------------------------------------------------- vstupy a nezávislost výsledku
test('vstupy: Uint8Array, Buffer, ArrayBuffer, DataView i pohled s posunem; jiné typy se odmítnou; vstup se nemění; výsledek je kopie', () => {
  const bytes = encode(randomTree(51, { pairs: 3, entries: 2, lists: 1 }));
  const ref = plain(T.parse(new Uint8Array(bytes)).tree);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  const padded = new Uint8Array(bytes.length + 40);
  padded.set(bytes, 17);
  for (const input of [bytes, new Uint8Array(bytes), ab, new DataView(ab), new DataView(padded.buffer, 17, bytes.length), padded.subarray(17, 17 + bytes.length), new Uint8Array(bytes).buffer.slice(0)]) {
    const r = T.parse(input);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(plain(r.tree), ref);
  }
  for (const bad of [null, undefined, 'řetězec', 42, {}, [1, 2, 3], new Uint16Array(4)]) {
    const r = T.parse(bad);
    if (bad instanceof Uint16Array) { assert.equal(r.ok, false); continue; } // pohled na typované pole je binární, ale není to struktura
    assert.equal(r.ok, false);
    assert.match(r.error, /není binární/);
    assert.equal(r.tree, null);
  }
  // vstup se nemění a výsledek na něm nezávisí
  const copy = Buffer.from(bytes);
  const input = new Uint8Array(bytes);
  const r = T.parse(input);
  assert.ok(Buffer.from(input).equals(copy));
  const before = JSON.stringify(plain(r.tree), (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  input.fill(0xaa);
  assert.equal(JSON.stringify(plain(r.tree), (k, v) => (typeof v === 'bigint' ? v.toString() : v)), before);
});

test('odpojená paměť (ArrayBuffer přenesený jinam): čtečka nespadne, ale odmítne s popisem', () => {
  const ab = new ArrayBuffer(64);
  structuredClone(ab, { transfer: [ab] });
  let r;
  assert.doesNotThrow(() => { r = T.parse(ab); });
  assert.equal(r.ok, false);
  assert.match(r.error, /není binární/);
  const live = new Uint8Array(64);
  structuredClone(live.buffer, { transfer: [live.buffer] });
  assert.doesNotThrow(() => { r = T.parse(live); });
  assert.equal(r.ok, false);
  assert.equal(r.offset, null);
  assert.equal(r.tree, null);
  assert.match(r.error, /Struktura se nepodařila přečíst/);
});

test('prázdný vstup a vstup jen s hlavičkou se odmítne s popisem', () => {
  let r = T.parse(new Uint8Array(0));
  assert.equal(r.ok, false);
  assert.match(r.error, /useknutý/);
  assert.equal(r.offset, 0);
  r = T.parse(new Uint8Array(T.MAGIC));
  assert.equal(r.ok, false);
  assert.match(r.error, /useknutý/);
  assert.equal(r.offset, 16);
  r = T.parse(new Uint8Array(32));
  assert.equal(r.ok, false);
  assert.match(r.error, /Čekal jsem značku taktiky/);
  assert.equal(r.offset, 0);
});

// ---------------------------------------------------------------- pomocné funkce
test('bitsOf: indexy nastavených bitů od nejnižšího, i pro 64bitová čísla; nečíselné a záporné vstupy se odmítnou', () => {
  assert.deepEqual(T.bitsOf(0), []);
  assert.deepEqual(T.bitsOf(0n), []);
  assert.deepEqual(T.bitsOf(1), [0]);
  assert.deepEqual(T.bitsOf(0b10110), [1, 2, 4]);
  assert.deepEqual(T.bitsOf(1n << 57n), [57]);
  assert.deepEqual(T.bitsOf(0x8000000000000001n), [0, 63]);
  assert.equal(T.bitsOf(0xffffffffffffffffn).length, 64);
  assert.equal(T.bitsOf(0xffffffff).length, 32);
  assert.deepEqual(T.bitsOf(0x200004n), [2, 21]);
  assert.throws(() => T.bitsOf(-1), RangeError);
  assert.throws(() => T.bitsOf(-1n), RangeError);
  assert.throws(() => T.bitsOf(1.5), RangeError);
  assert.throws(() => T.bitsOf(NaN), RangeError);
  assert.throws(() => T.bitsOf('3'), TypeError);
  assert.throws(() => T.bitsOf(1n << 64n), RangeError);
  assert.doesNotThrow(() => T.bitsOf((1n << 64n) - 1n));
  assert.throws(() => T.bitsOf(2 ** 60), RangeError); // nad bezpečným celým číslem: 64bitové hodnoty patří do BigInt
  assert.deepEqual(T.bitsOf(Number.MAX_SAFE_INTEGER).length, 53);
});

test('displayText: odstraní řídicí, neviditelné a obousměrné znaky, sloučí mezery, zkrátí s třemi tečkami', () => {
  assert.equal(T.displayText('  Ahoj\u0000\u0007   světe\n\t!  '), 'Ahoj světe !');
  const cp = (...codes) => String.fromCodePoint(...codes); // znaky se skládají z čísel, aby ve zdroji nebyl žádný neviditelný znak
  assert.equal(T.displayText('a' + cp(0x202e) + 'b' + cp(0x200b) + 'c' + cp(0xfeff) + 'd' + cp(0x2060) + 'e' + cp(0x85) + 'f' + cp(0x7f) + 'g'), 'a b c d e f g');
  // okraje každého zakázaného rozsahu: první i poslední znak
  for (const code of [0x00, 0x1f, 0x7f, 0x9f, 0x200b, 0x200f, 0x2028, 0x202e, 0x2060, 0x2064, 0xfeff]) assert.equal(T.displayText('a' + cp(code) + 'b'), 'a b', `znak ${code.toString(16)}`);
  // těsně za rozsahy a běžné znaky se musí zachovat
  for (const code of [0x20ac, 0xa0 + 1, 0xe1, 0x17e, 0x2010, 0x2065 + 1, 0x2fff, 0x2070]) assert.equal(T.displayText('a' + cp(code) + 'b'), 'a' + cp(code) + 'b', `znak ${code.toString(16)} se musí zachovat`);
  assert.equal(T.displayText('ěščř ŽÝÁÍ'), 'ěščř ŽÝÁÍ');
  assert.equal(T.displayText(null), '');
  assert.equal(T.displayText(undefined), '');
  assert.equal(T.displayText(12), '12');
  assert.equal(T.displayText('x'.repeat(100)), 'x'.repeat(79) + '…');
  assert.equal(T.displayText('x'.repeat(80)), 'x'.repeat(80));
  assert.equal(T.displayText('x'.repeat(81)), 'x'.repeat(79) + '…');
  assert.equal(T.displayText('abcdefgh', 5), 'abcd…');
  assert.equal(T.displayText('abcde', 5), 'abcde');
  assert.equal(T.displayText('abcdefgh', 0), 'abcdefgh');
  assert.equal(T.displayText('abcdefgh', -3), 'abcdefgh');
  assert.equal(T.displayText('abcdefgh', 2.5), 'abcdefgh');
  assert.equal(T.displayText('\u0000\u0001'), '');
});

test('meze jsou přesně ty zdokumentované (zkoušky mezí výše se opírají o tyto konstanty, proto se tu hlídají zvlášť)', () => {
  assert.deepEqual({ ...T.LIMITS }, { maxInput: 4 * 1024 * 1024, maxPairs: 32, maxItems: 4096, maxEntries: 4096, maxLists: 64, maxListIds: 4096, maxBlocks: 1024, maxString: 4096 });
});

test('konstanty: značka je zapsaná shodně v modulu i v zapisovači a meze jsou zmrazené', () => {
  assert.deepEqual(Array.from(T.MAGIC), Array.from(W.MAGIC));
  assert.deepEqual(Array.from(T.BLOCK_MARK), [0x44, 0x00, 0x02]);
  assert.equal(T.EXPECTED.pairs, 11);
  assert.equal(T.EXPECTED.records, 12);
  assert.ok(Object.isFrozen(T.LIMITS) && Object.isFrozen(T.EXPECTED) && Object.isFrozen(T.MAGIC) && Object.isFrozen(T.BLOCK_MARK));
});

// ---------------------------------------------------------------- skutečné soubory (jen když je složka zadaná; do repozitáře nepatří)
test('skutečné exporty z FM27 (FMF_SAMPLES_DIR): celý payload taktiky se přečte, každý bajt je zařazen a zápis zpět je bajt po bajtu stejný', async () => {
  const dir = process.env.FMF_SAMPLES_DIR;
  if (!dir || !existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fmf'));
  assert.ok(files.length > 0, 've složce nejsou žádné .fmf');
  // očekávané počty ze tří známých souborů podle velikosti payloadu (názvy taktik se do repozitáře nepíší)
  const known = {
    4771: { blocks: 22, items: 156, idEntries: 0, footerLists: 0 },
    5085: { blocks: 23, items: 166, idEntries: 23, footerLists: 0 },
    6104: { blocks: 24, items: 205, idEntries: 16, footerLists: 3 },
  };
  let seen = 0;
  for (const f of files) {
    const d = await C.decode(new Uint8Array(readFileSync(`${dir}/${f}`)), deps);
    assert.equal(d.ok, true, f);
    const r = T.parse(d.tac);
    assert.equal(r.ok, true, `${f}: ${r.error} @${r.offset}`);
    assert.equal(r.size, d.tac.length);
    assert.ok(Buffer.from(encode(r.tree)).equals(Buffer.from(d.tac)), `${f}: zápis zpět se liší`);
    assert.equal(r.tree.title.text, d.title, f);
    const s = T.summary(r.tree);
    assert.equal(s.pairs, 11, f);
    assert.equal(s.pairsAsExpected, true, f);
    assert.equal(s.slotsArePermutation, true, f);
    assert.equal(s.records, 12, f);
    // klíč každé položky má právě jeden nastavený bit (jak ukázal rozbor)
    for (const p of r.tree.pairs) for (const blk of [p.a, p.b]) for (const it of blk.items) assert.equal(T.bitsOf(it.key).length, 1, f);
    const exp = known[d.tac.length];
    if (exp) {
      assert.equal(s.blocks, exp.blocks, f);
      assert.equal(s.items, exp.items, f);
      assert.equal(s.idEntries, exp.idEntries, f);
      assert.equal(s.footerLists, exp.footerLists, f);
      seen++;
    }
  }
  if (files.length === 3) assert.equal(seen, 3, 'tři známé soubory se měly poznat podle velikosti payloadu');
});

// ---------------------------------------------------------------- zdroj
test('zdroj: čistý modul (žádný DOM, síť, úložiště, náhoda ani čas) a bez neviditelných znaků', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.|window\.|fetch\(|XMLHttpRequest|localStorage|Math\.random|Date\.now|new Date|crypto\.subtle|require\(/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]'));
});
