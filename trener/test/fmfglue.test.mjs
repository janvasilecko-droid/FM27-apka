import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../src/fmfglue.js');
const Z = require('../src/zstd.js');
const T = require('../src/tactics.js');
const B = require('./fixtures/zstd_builders.cjs');
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
// Rámce vyrobené Pythonem (balíček zstandard, což je také libzstd, ale volané jinou cestou než zlib v Node), tedy jiným zapisovačem než ten, kterým se rámce vyrábějí v ostatních zkouškách: F1 a F2 mají uvedenou velikost obsahu, F3 je proudový bez ní.
const F1 = hex('28b52ffd2036c500009003616263042e7461630378797a042e696d6701001639c3'); // obsah 54 bajtů
const F2 = hex('28b52ffd20789d00006064727568792072616d6563200100e9694902'); // obsah 120 bajtů
const F3 = hex('28b52ffd0058dd0000a070726f75642062657a2076656c696b6f73746920010072d26402');
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

test('první rámec: rozbalí se jen ten první, i když za ním jsou další rámce a smetí; strop výstupu platí', () => {
  const d = G.makeFirstFrameDecompressor(Z);
  const data = cat(F1, F2, new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]));
  const out = d(data, 1 << 20);
  assert.equal(out.length, 54);
  assert.deepEqual([...out.subarray(0, 4)], [3, 0x61, 0x62, 0x63]);
  assert.equal(d(F2, 1 << 20).length, 120);
  // strop menší než obsah: chyba s kódem limit (ne oříznutí), aby volající poznal „příliš velký“
  assert.throws(() => d(data, 10), (e) => e.code === 'limit');
  assert.equal(d(data, 54).length, 54, 'strop přesně na velikosti obsahu projde');
});

test('proudový rámec bez velikosti obsahu se rozbalí celý; nesmysl, useknutí a jiný druh dat dá null', () => {
  const d = G.makeFirstFrameDecompressor(Z);
  const out = d(F3, 1 << 20);
  assert.equal(Buffer.from(out).toString(), 'proud bez velikosti '.repeat(4));
  assert.equal(d(new Uint8Array([9, 9, 9, 9, 9, 9]), 100), null);
  assert.equal(d(F1.subarray(0, 20), 100), null, 'useknutý rámec');
  assert.equal(d(new Uint8Array(0), 100), null);
  assert.equal(d(null, 100), null);
});

test('přesně jeden rámec pro kontejner: bajty navíc a useknutí jsou chyba', () => {
  const z = G.makeFrameDecompressor(Z);
  assert.equal(z(F1, 1 << 20).length, 54);
  assert.throws(() => z(cat(F1, F2), 1 << 20), /bajty navíc/);
  assert.throws(() => z(F1.subarray(0, 20), 1 << 20), /useknutý/);
  assert.throws(() => z(F1, 10), (e) => e.code === 'limit');
});

test('bez dekodéru: první rámec vrátí null, přesně jeden rámec vyhodí chybu', () => {
  assert.equal(G.makeFirstFrameDecompressor(null)(F1, 100), null);
  assert.equal(G.makeFirstFrameDecompressor({})(F1, 100), null);
  assert.throws(() => G.makeFrameDecompressor(null)(F1, 100), /není k dispozici/);
});

test('rozpočet bloků: každý rozbalovač má svůj rozpočet pro všechny rámce, které rozbalí; vyčerpaný rozpočet je jasná chyba a nový rozbalovač začíná znovu', () => {
  const four = B.emptyBlocksFrame(4);
  const z = G.makeFrameDecompressor(Z, { maxTotalBlocks: 8 });
  assert.equal(z(four, 1 << 20).length, 0); // spotřebuje 4, zbývá 4
  assert.equal(z(four, 1 << 20).length, 0); // spotřebuje 4, zbývá 0
  assert.throws(() => z(four, 1 << 20), /příliš mnoho bloků dohromady/);
  assert.throws(() => z(four, 1 << 20), /příliš mnoho bloků dohromady/, 'a zůstane to tak');
  assert.equal(G.makeFrameDecompressor(Z, { maxTotalBlocks: 8 })(four, 1 << 20).length, 0, 'jiný rozbalovač má vlastní rozpočet');
  // rámec, který by rozpočet překročil, se zastaví na jeho zbytku (chyba dekodéru s kódem blocks), ne až po rozbalení všeho
  const three = B.emptyBlocksFrame(3);
  const y = G.makeFrameDecompressor(Z, { maxTotalBlocks: 8 });
  y(three, 1 << 20);
  y(three, 1 << 20); // zbývají 2
  assert.throws(() => y(three, 1 << 20), (e) => e.code === 'blocks');
  // výchozí rozpočet je 20 000 bloků: dva rámce po 9 000 projdou (v součtu 18 000), třetí už ne
  const big = B.emptyBlocksFrame(9000);
  const d = G.makeFrameDecompressor(Z);
  d(big, 1 << 24);
  d(big, 1 << 24);
  assert.throws(() => d(big, 1 << 24), (e) => e.code === 'blocks');
  // výchozí rozpočet na blok přesně: jediný rámec s 20 000 bloky projde (strop bloků z výstupu 32 MiB je 32 784, rozhoduje rozpočet), s 20 001 už ne; po vyčerpání se další rámec ani nezačne
  const exactly = G.makeFrameDecompressor(Z);
  assert.equal(exactly(B.emptyBlocksFrame(20000), 1 << 25).length, 0);
  assert.throws(() => exactly(B.emptyBlocksFrame(1), 100), /příliš mnoho bloků dohromady/);
  assert.throws(() => G.makeFrameDecompressor(Z)(B.emptyBlocksFrame(20001), 1 << 25), (e) => e.code === 'blocks' && e.blocks === 20001);
  // vadné hodnoty volby se ignorují (výchozí rozpočet)
  for (const bad of [0, -3, 2.5, 'x', null, NaN]) {
    const w = G.makeFrameDecompressor(Z, { maxTotalBlocks: bad });
    w(big, 1 << 24);
    w(big, 1 << 24);
    assert.throws(() => w(big, 1 << 24), (e) => e.code === 'blocks', String(bad));
  }
  // rozbalovač bez dekodéru nepotřebuje rozpočet a hlásí svoji chybu
  assert.throws(() => G.makeFrameDecompressor({}, { maxTotalBlocks: 1 })(four, 100), /není k dispozici/);
});

test('rozpočet bloků se účtuje i za rámce, které nakonec selžou: soubor se spoustou rámců vadných až na konci nezdrží stránku víckrát', () => {
  // drahý rámec o 41 blocích (surový + 40 drahých), za nímž je bajt navíc: rozbalí se celý a až potom se odmítne (exact)
  const failing = Buffer.concat([B.heavyFrame(40), Buffer.from([0])]);
  assert.throws(() => Z.decompress(failing, { exact: true }), /bajty navíc/);
  assert.equal(Z.decompressFrame(B.heavyFrame(40)).blocks, 41);
  const z = G.makeFrameDecompressor(Z, { maxTotalBlocks: 100 });
  assert.throws(() => z(failing, 1 << 20), /bajty navíc/); // spotřebuje 41, zbývá 59
  assert.throws(() => z(failing, 1 << 20), /bajty navíc/); // spotřebuje 41, zbývá 18
  assert.throws(() => z(failing, 1 << 20), (e) => e.code === 'blocks'); // na zbytku 18 se zastaví (účtuje se 19), rozpočet je vyčerpaný
  assert.throws(() => z(failing, 1 << 20), /příliš mnoho bloků dohromady/, 'a další rámec se už ani nezačne rozbalovat');
  // i chyba, která dekodér zastaví hned (hlavička), stojí aspoň jeden blok, takže nekonečná řada vadných rámců rozpočet vyčerpá
  const w = G.makeFrameDecompressor(Z, { maxTotalBlocks: 3 });
  for (let i = 0; i < 3; i++) assert.throws(() => w(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), 100), (e) => e instanceof Z.ZstdError && e.code === 'magic');
  assert.throws(() => w(B.emptyBlocksFrame(1), 100), /příliš mnoho bloků dohromady/);
  // chyba dekodéru nese počet zpracovaných bloků
  try {
    Z.decompress(B.emptyBlocksFrame(18), { maxOutput: 1024 });
    assert.fail('mělo selhat');
  } catch (e) {
    assert.equal(e.code, 'blocks');
    assert.equal(e.blocks, 18, 'počítá se i blok, na kterém se přestalo');
  }
  try {
    Z.decompress(Buffer.concat([B.emptyBlocksFrame(5), Buffer.from([0])]), { exact: true });
    assert.fail('mělo selhat');
  } catch (e) {
    assert.equal(e.blocks, 5);
  }
});

test('strop výstupu: bez maxBytes (nebo s vadným) platí výchozí strop 16 MiB; přesně 16 MiB projde, o bajt víc ne; zadaný strop platí na bajt přesně', () => {
  const blocks = (n, extra) => B.zframe([...Array.from({ length: n }, () => ({ rle: [0x41, 131072] })), ...(extra ? [{ rle: [0x42, extra] }] : [])]);
  const exact = blocks(128); // 128 × 128 KiB = 16 MiB
  const over = blocks(128, 1);
  for (const bad of [undefined, null, 0, -1, NaN, 'x', Infinity]) {
    const z = G.makeFrameDecompressor(Z);
    assert.equal(z(exact, bad).length, 16 * 1024 * 1024, 'strop ' + String(bad));
    assert.throws(() => G.makeFrameDecompressor(Z)(over, bad), (e) => e.code === 'limit', 'strop ' + String(bad));
  }
  const small = B.zframe([{ rle: [0x41, 1000] }]);
  assert.equal(G.makeFrameDecompressor(Z)(small, 1000).length, 1000);
  assert.throws(() => G.makeFrameDecompressor(Z)(small, 999), (e) => e.code === 'limit');
  assert.equal(G.makeFrameDecompressor(Z)(small, 1000.9).length, 1000, 'necelý strop se zaokrouhlí dolů');
  assert.throws(() => G.makeFrameDecompressor(Z)(small, 999.9), (e) => e.code === 'limit');
});

test('rozpočet výstupu: výstup všech rámců jednoho souboru dohromady je omezený, i s rámci, které selžou; zbytek rozpočtu je strop pro další rámec', () => {
  const kib = B.zframe([{ rle: [0x41, 1024] }]); // vydá 1024 B
  const z = G.makeFrameDecompressor(Z, { maxTotalOutput: 2048 });
  assert.equal(z(kib, 1 << 20).length, 1024);
  assert.equal(z(kib, 1 << 20).length, 1024);
  assert.throws(() => z(kib, 1 << 20), /příliš mnoho dat dohromady/);
  assert.throws(() => z(kib, 1 << 20), /příliš mnoho dat dohromady/, 'a zůstane to tak');
  assert.equal(G.makeFrameDecompressor(Z, { maxTotalOutput: 2048 })(kib, 1 << 20).length, 1024, 'jiný rozbalovač má vlastní rozpočet');
  // selhaný rámec se účtuje: vydá 1000 B a selže na odkazu před začátek výstupu
  const bad = B.zframe([{ rle: [0x41, 1000] }, { comp: B.rleSeqBlock([], { ll: 0, of: 20, ml: 0 }, [{ of: 0, ml: 0, ll: 0 }]) }]);
  const y = G.makeFrameDecompressor(Z, { maxTotalOutput: 2000 });
  assert.throws(() => y(bad, 1 << 20), (e) => /před začátek výstupu/.test(e.message) && e.produced === 1000);
  assert.throws(() => y(bad, 1 << 20), (e) => e.code === 'limit' && e.produced === 1000); // zbývalo přesně 1000 B: vydají se a další blok už se nevejde
  assert.throws(() => y(bad, 1 << 20), /příliš mnoho dat dohromady/, 'rozpočet je vyčerpaný selhanými rámci');
  // zbytek rozpočtu je strop pro další rámec: rámec, který by vydal víc, narazí na zbytek (kód limit) a tím se rozpočet vyčerpá
  const x = G.makeFrameDecompressor(Z, { maxTotalOutput: 1500 });
  assert.equal(x(kib, 1 << 20).length, 1024);
  assert.throws(() => x(B.zframe([{ rle: [0x42, 512] }, { rle: [0x42, 512] }]), 1 << 20), (e) => e.code === 'limit' && e.produced === 0); // zbývá 476 B a první blok má 512
  // chyba, která dekodér zastaví dřív, než cokoli vydá (hlavička), výstup neúčtuje: řada vadných hlaviček rozpočet výstupu nespotřebuje
  const h = G.makeFrameDecompressor(Z, { maxTotalOutput: 2048 });
  for (let i = 0; i < 5; i++) assert.throws(() => h(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), 100), (e) => e.code === 'magic' && e.produced === undefined);
  assert.equal(h(kib, 1 << 20).length, 1024);
  assert.equal(h(kib, 1 << 20).length, 1024);
  // vadné hodnoty volby se ignorují (výchozí 33 MiB)
  for (const badValue of [0, -1, 2.5, 'x', null, NaN]) assert.equal(G.makeFrameDecompressor(Z, { maxTotalOutput: badValue })(kib, 1 << 20).length, 1024, String(badValue));
  // výchozí rozpočet: dva rámce po 16 MiB projdou, třetí dostane jen zbytek (1 MiB) a po něm je rozpočet vyčerpaný
  const sixteen = B.zframe(Array.from({ length: 128 }, () => ({ rle: [0x41, 131072] })));
  const w = G.makeFrameDecompressor(Z);
  assert.equal(w(sixteen, 1 << 24).length, 16 * 1024 * 1024);
  assert.equal(w(sixteen, 1 << 24).length, 16 * 1024 * 1024);
  assert.throws(() => w(sixteen, 1 << 24), (e) => e.code === 'limit' && e.produced === 1024 * 1024);
  assert.throws(() => w(sixteen, 1 << 24), /příliš mnoho dat dohromady/);
});

test('první rámec: starší kontrola má nízký strop počtu bloků (64), takže kandidát z drobných nebo drahých bloků ji nezdrží; jiné chyby než limit dají null', () => {
  const d = G.makeFirstFrameDecompressor(Z);
  assert.equal(d(B.emptyBlocksFrame(64), 1 << 20).length, 0, '64 bloků projde');
  assert.equal(d(B.emptyBlocksFrame(65), 1 << 20), null, '65 bloků je null');
  // rámec ze samých drahých bloků: null a rychle (každý blok je tu stavba stromu a tří tabulek)
  const heavy = B.heavyFrame(190000);
  const t0 = Date.now();
  assert.equal(d(heavy, 1 << 20), null);
  assert.ok(Date.now() - t0 < 1000, 'trvalo ' + (Date.now() - t0) + ' ms');
  // limit výstupu se dál hlásí jako chyba s kódem limit, ne jako null
  assert.throws(() => d(B.zframe([{ rle: [0x41, 5000] }]), 1000), (e) => e.code === 'limit');
});

test('inspectFmf: šestnáct kandidátů čtoucích týž drahý ocas se nezmnoží na šestnáctinásobnou práci: každý se zastaví na stropu bloků', () => {
  // 16 hlaviček rámců za sebou; každý kandidát má první surový blok, který končí přesně na začátku společného ocasu z drahých bloků (a nese aspoň 16 B historie, kterou drahé bloky potřebují)
  const nCand = 16;
  const nTail = 20000;
  const blk = B.heavyBlock();
  const start = 6 + nCand * 9 + 16; // za předponou (6 B), hlavičkami (4 B magie, 2 B hlavička rámce, 3 B hlavička surového bloku) a šestnácti bajty historie
  const heads = [];
  for (let j = 0; j < nCand; j++) {
    const at = 6 + j * 9;
    heads.push(Buffer.from([...B.MAGIC_BYTES, 0x00, 0x50, ...B.blockHeader(start - (at + 9), 0, false)]));
  }
  const tail = [];
  for (let i = 0; i < nTail; i++) tail.push(Buffer.from(B.blockHeader(blk.length, 2, i === nTail - 1)), blk);
  const file = Buffer.concat([Buffer.from([0x02, 0x01, 0x61, 0x66, 0x65, 0x2e]), ...heads, Buffer.from('abcdefghijklmnop'), ...tail]);
  // dekodér, který si pamatuje, čím každé volání skončilo a kolik bloků do té doby zpracoval
  const outcomes = [];
  const blockCounts = [];
  const spy = {
    decompressFrame(bytes, opts) {
      try {
        const r = Z.decompressFrame(bytes, opts);
        outcomes.push('ok');
        blockCounts.push(r.blocks);
        return r;
      } catch (e) {
        outcomes.push(e.code);
        blockCounts.push(e.blocks);
        throw e;
      }
    },
  };
  const t0 = Date.now();
  const rep = T.inspectFmf(file, { decompress: G.makeFirstFrameDecompressor(spy) });
  const ms = Date.now() - t0;
  assert.equal(rep.candidates.found, nCand);
  assert.equal(rep.candidates.tried, nCand);
  assert.equal(rep.ok, false);
  assert.deepEqual(outcomes, new Array(nCand).fill('blocks'), 'každý kandidát se má zastavit na stropu bloků');
  // počet zpracovaných bloků je přesný, ne jen „něco se odmítlo": první surový blok a 63 drahých projdou, 65. blok (64. drahý) strop zastaví
  assert.deepEqual(blockCounts, new Array(nCand).fill(65), 'každý kandidát má vykonat nejvýš strop + 1 bloků: ' + JSON.stringify(blockCounts));
  assert.ok(rep.frames.every((f) => f.reason === 'nejde rozbalit'), JSON.stringify(rep.frames.map((f) => f.reason)));
  assert.ok(ms < 3000, 'kontrola trvala ' + ms + ' ms');
});
