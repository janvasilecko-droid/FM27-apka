import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const Z = require('../src/zstd.js');
const Fmf = require('../src/fmfcontainer.js'); // jen kvůli XXH64 (kontrolní součet obsahu v rámci)
const B = require('./fixtures/zstd_builders.cjs');
const { u16, u24, MAGIC_BYTES, directTree, huffCodes, huffStreamBytes, bitStream, literalsFrame, splitFour, bin, blockHeader, zframe, rawLits, LL_BASE_T, LL_EXTRA, ML_BASE_T, ML_EXTRA, rleSeqBlock, bigLiterals, writeNCount, heavyFrame, emptyBlocksFrame } = B;
const source = readFileSync(new URL('../src/zstd.js', import.meta.url), 'utf8');
const C = zlib.constants;

// ---------------------------------------------------------------- pomůcky
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ['taktika', 'obrana', 'útok', 'střed', 'pressing', 'křídlo', 'brankář', 'roh', 'penalta', 'hráč', 'formace', 'role', 'instrukce'];
const gen = {
  zeros: (n) => Buffer.alloc(n),
  same: (n) => Buffer.alloc(n, 0x41),
  random: (n, r) => Buffer.from(Array.from({ length: n }, () => Math.floor(r() * 256))),
  text: (n, r) => {
    let s = '';
    while (s.length < n) s += WORDS[Math.floor(r() * WORDS.length)] + (r() < 0.15 ? '\n' : ' ');
    return Buffer.from(s.slice(0, n));
  },
  skewed: (n, r) => Buffer.from(Array.from({ length: n }, () => (r() < 0.8 ? Math.floor(r() * 4) : Math.floor(r() * 256)))),
  records: (n, r) => {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i += 16) {
      if (i + 4 <= n) b.writeUInt32LE(i >>> 4, i);
      if (i + 8 <= n) b.writeUInt32LE(Math.floor(r() * 30), i + 4);
    }
    return b;
  },
  mixed: (n, r) => Buffer.concat([gen.text(Math.floor(n / 3), r), gen.random(Math.floor(n / 6), r), gen.zeros(Math.floor(n / 6)), gen.records(n - Math.floor(n / 3) - 2 * Math.floor(n / 6), r)]),
};
const compress = (input, params) => zlib.zstdCompressSync(input, { params });
const ours = (frame, opts) => {
  try {
    return Z.decompress(new Uint8Array(frame), opts);
  } catch (e) {
    if (!(e instanceof Z.ZstdError)) throw new Error('výjimka, která není ZstdError: ' + (e && e.stack));
    return null;
  }
};
const same = (a, b) => a !== null && b !== null && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
/** Přísná věštírna (libzstd přes Python `zstandard`, viz fixtures/zstd_oracle.py): pole null (odmítnuto) nebo Uint8Array. Bez Pythonu a balíčku vrací null a zkoušky, které ji potřebují, se přeskočí.
    Jakmile se věštírna při zkoušce dostupnosti osvědčila (oracleWorked), je její selhání na další dávce chyba zkoušky, ne důvod k přeskočení: jinak by se při pádu Pythonu nebo nedostatku paměti
    tiše přeskočila všechna porovnání s libzstd, a to i s ZSTD_ORACLE_REQUIRED=1. */
let oracleWorked = false;
function oracle(frames) {
  const py = process.env.ZSTD_ORACLE_PYTHON || 'python3';
  const r = spawnSync(py, [new URL('./fixtures/zstd_oracle.py', import.meta.url).pathname], { input: frames.map((f) => Buffer.from(f).toString('hex')).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 29, timeout: 300000 });
  const fail = (why) => {
    if (oracleWorked) throw new Error(`věštírna selhala na dávce ${frames.length} rámců: ${why}`);
    return null;
  };
  if (r.error || r.status !== 0) return fail(r.error ? String(r.error) : `stav ${r.status}, ${String(r.stderr || '').slice(0, 300)}`);
  const lines = r.stdout.split('\n');
  lines.pop();
  if (lines.length !== frames.length) return fail(`vrátila ${lines.length} řádků místo ${frames.length}`);
  return lines.map((l) => (l === 'ERR' ? null : Uint8Array.from(Buffer.from(l, 'hex'))));
}
/** Kódy chyb, v nichž je libzstd 1.5.7 podle pozorování shovívavější než specifikace (viz judge). */
const TOLERATED = ['litend', 'window', 'blocksize'];
/** Věštírna je k dispozici, když na jednom malém rámci odpoví správně. */
const ORACLE_PROBE = (() => {
  const w = oracle([zframe([{ raw: Buffer.from('ahoj') }])]);
  return !!(w && w[0] && Buffer.from(w[0]).toString() === 'ahoj');
})();
oracleWorked = ORACLE_PROBE;

// ---------------------------------------------------------------- věštírna
test('věštírna (libzstd přes Python balíček zstandard) je k dispozici; bez ní se porovnání s libzstd přeskočí, s ZSTD_ORACLE_REQUIRED=1 zkouška selže', (t) => {
  if (ORACLE_PROBE) return;
  if (process.env.ZSTD_ORACLE_REQUIRED === '1') assert.fail('věštírna není k dispozici, a přitom je ZSTD_ORACLE_REQUIRED=1 (ZSTD_ORACLE_PYTHON = ' + (process.env.ZSTD_ORACLE_PYTHON || 'python3') + '; potřebuje balíček zstandard)');
  t.skip('věštírna libzstd není k dispozici: zkoušky shody s libzstd (poškozené rámce, ruční stromy a sekvence) se přeskočí; pip install zstandard a ZSTD_ORACLE_PYTHON ji zapnou');
});

// ---------------------------------------------------------------- shoda s libzstd
test('rozbalení shodné s libzstd: sedm druhů dat × délky kolem hranic bloků × úrovně 1, 3, 9, 19 a 22, s kontrolním součtem i bez', () => {
  const r = rng(1);
  let cases = 0;
  for (const kind of ['zeros', 'same', 'random', 'text', 'skewed', 'records', 'mixed']) {
    for (const n of [0, 1, 2, 3, 7, 31, 127, 128, 129, 255, 256, 1000, 4096, 20000, 131071, 131072, 131073, 300000]) {
      if ((kind === 'random' || kind === 'mixed') && n > 131073) continue;
      const input = gen[kind](n, r);
      const level = [1, 3, 9, 19, 22][cases % 5];
      const frame = compress(input, { [C.ZSTD_c_compressionLevel]: level, [C.ZSTD_c_checksumFlag]: cases % 2, [C.ZSTD_c_contentSizeFlag]: (cases >> 1) % 2 });
      const out = ours(frame);
      assert.ok(same(out, input), `${kind} ${n} B, úroveň ${level}: výstup se liší nebo je chyba`);
      cases++;
    }
  }
  assert.ok(cases > 100, String(cases));
});

test('rozbalení shodné s libzstd: strategie 1 až 9, délky oken, dlouhé shody (LDM), víc bloků a opakované tabulky', () => {
  const r = rng(2);
  let cases = 0;
  const input = Buffer.concat([gen.text(120000, r), gen.records(80000, r), gen.text(60000, r), gen.skewed(50000, r)]);
  for (const strategy of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const windowLog of [10, 14, 17, 20, 23]) {
      const frame = compress(input, { [C.ZSTD_c_strategy]: strategy, [C.ZSTD_c_windowLog]: windowLog, [C.ZSTD_c_checksumFlag]: 1 });
      assert.ok(same(ours(frame), input), `strategie ${strategy}, okno ${windowLog}`);
      cases++;
    }
  }
  for (const level of [3, 12, 19]) {
    const frame = compress(input, { [C.ZSTD_c_compressionLevel]: level, [C.ZSTD_c_enableLongDistanceMatching]: 1, [C.ZSTD_c_windowLog]: 22 });
    assert.ok(same(ours(frame), input), `LDM, úroveň ${level}`);
    cases++;
  }
  assert.equal(cases, 48);
});

test('malé vstupy všech tvarů: stovky krátkých textů a binárních dat shodně s libzstd (předdefinované i vlastní tabulky)', () => {
  const r = rng(3);
  let mine = 0;
  for (let i = 0; i < 400; i++) {
    const n = Math.floor(r() * 2500);
    const kind = ['text', 'skewed', 'records', 'mixed', 'random', 'same'][i % 6];
    const input = gen[kind](n, r);
    const frame = compress(input, { [C.ZSTD_c_compressionLevel]: 1 + (i % 19), [C.ZSTD_c_checksumFlag]: (i >> 2) % 2 });
    assert.ok(same(ours(frame), input), `${i}: ${kind} ${n} B`);
    mine++;
  }
  assert.equal(mine, 400);
});

// ---------------------------------------------------------------- společné pravidlo porovnání s libzstd
/** Má rámec aspoň jeden komprimovaný blok s čtyřproudými literály? Hrubý průchod bloky stejným způsobem jako dekodér; na poškozeném rámci skončí tam, kde skončí dekodér. */
function hasFourStreamLiterals(f) {
  const b = Buffer.from(f);
  if (b.length < 6) return false;
  const fhd = b[4];
  const single = (fhd >> 5) & 1;
  const fcsFlag = fhd >> 6;
  let p = 5 + (single ? 0 : 1) + [0, 1, 2, 4][fhd & 3] + (fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag]);
  while (p + 3 <= b.length) {
    const h = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
    const type = (h >> 1) & 3;
    const size = h >> 3;
    p += 3;
    if (type === 2 && p < b.length && (b[p] & 3) >= 2 && ((b[p] >> 2) & 3) >= 1) return true;
    p += type === 1 ? 1 : size;
    if (h & 1) break;
  }
  return false;
}
/** Porovná rámce s verdikty věštírny (want[i] = null nebo výstup). Pravidla:
    - co libzstd odmítne, odmítneme i my; jedinou výjimkou je vadný kontrolní součet obsahu, který neověřujeme my, ale volající (fmfcontainer.js). Ta výjimka se ověřuje: stejný rámec s opraveným součtem
      se pošle věštírně znovu a ta ho musí přijmout a dát stejný výstup (jinak by součet jen zakryl jiný důvod odmítnutí);
    - co oba přijmou, vyjde bajt po bajtu stejně;
    - co libzstd přijme a my ne, smí být jen ze tří pozorovaných důvodů, v nichž je libzstd 1.5.7 shovívavější než specifikace (u nás každý má svůj kód chyby): 'litend' (konec proudu čtyřproudých literálů, na rychlé cestě
      se nekontroluje ani koncová značka), 'window' (odkaz dál než okno rámce, když data ještě drží ve vyrovnávací paměti) a 'blocksize' (blok větší než okno, když rámec uvádí velikost obsahu).
      U sekvencí žádnou shovívavost nemá: nepřečtené bity i čtení za začátek proudu odmítá stejně jako my (kódy 'inexact' a 'overread' tedy v tomto seznamu nejsou).
    Vrací počty případů. */
function judge(frames, want) {
  const c = { accepted: 0, rejected: 0, endClass: 0, sumExplained: 0 };
  const patched = [];
  frames.forEach((f, it) => {
    const shown = Buffer.from(f).toString('hex').slice(0, 3000);
    const got = ours(f, { exact: true });
    let code = null;
    if (!got) {
      try {
        Z.decompress(new Uint8Array(f), { exact: true });
      } catch (e) {
        code = e.code;
      }
    }
    if (want[it] === null) {
      c.rejected++;
      if (got) {
        const hasSum = f.length > 8 && (f[4] & 0x04) !== 0;
        assert.ok(hasSum, `iterace ${it}: libzstd odmítl, my jsme přijali a rámec nemá kontrolní součet: ${shown}`);
        const stored = Buffer.from(f).readUInt32LE(f.length - 4);
        const actual = Number(Fmf.xxh64(got) & 0xffffffffn);
        assert.ok(stored !== actual, `iterace ${it}: libzstd odmítl, my jsme přijali a součet sedí: ${shown}`);
        const fixed = Buffer.from(f);
        fixed.writeUInt32LE(actual, fixed.length - 4);
        patched.push({ it, frame: fixed, out: got, shown });
        c.sumExplained++;
      }
    } else {
      c.accepted++;
      if (got) assert.ok(same(got, want[it]), `iterace ${it}: libzstd přijal, ale výstup se liší: ${shown}`);
      else {
        assert.ok(TOLERATED.includes(code), `iterace ${it}: libzstd přijal, my jsme odmítli z jiného důvodu než jeho pozorovaná shovívavost (${code}): ${shown}`);
        // shovívavost u konce proudu literálů pozorujeme jen u čtyř proudů; u jednoho proudu libzstd konec kontroluje (na 32 000 poškozených rámcích žádná výjimka)
        if (code === 'litend') assert.ok(hasFourStreamLiterals(f), `iterace ${it}: libzstd přijal pokažený konec proudu literálů v rámci bez čtyřproudých literálů: ${shown}`);
        c.endClass++;
      }
    }
  });
  if (patched.length) {
    const again = oracle(patched.map((x) => x.frame));
    assert.ok(again, 'věštírna při druhém dotazu neodpověděla');
    patched.forEach((x, k) => assert.ok(again[k] && same(again[k], x.out), `iterace ${x.it}: libzstd odmítá rámec i s opraveným kontrolním součtem, tedy důvod odmítnutí nebyl součet: ${x.shown}`));
  }
  return c;
}

// ---------------------------------------------------------------- shovívavost libzstd, na které stojí tolerance v judge
test('tři pozorované shovívavosti libzstd 1.5.7 (odkaz za okno, blok větší než okno u rámce s velikostí obsahu, pokažený konec čtyřproudých literálů od 255 znaků): my je odmítneme se svým kódem, libzstd je přijme (druhá polovina potřebuje věštírnu)', () => {
  const cases = []; // [název, rámec, kód chyby u nás, délka výstupu libzstd nebo null (odmítne)]
  // odkaz za okno: okno 1 KiB (wd 0), historie 2000 B ze dvou surových bloků, posun 1025 a 1500
  const hist = [{ raw: Buffer.alloc(1000, 1) }, { raw: Buffer.alloc(1000, 2) }];
  const seqAt = (offset) => {
    const v = offset + 3;
    const code = 31 - Math.clz32(v);
    return zframe([...hist, { comp: rleSeqBlock([], { ll: 0, of: code, ml: 0 }, [{ of: v - 2 ** code, ml: 0, ll: 0 }]) }], { wd: 0x00 });
  };
  cases.push(['odkaz za okno (posun 1025)', seqAt(1025), 'window', 2003]);
  cases.push(['odkaz za okno (posun 1500)', seqAt(1500), 'window', 2003]);
  // blok větší než okno: okno 1 KiB, rámec uvádí velikost obsahu 1025 (dvoubajtové pole: hodnota − 256 = 769); bez uvedené velikosti libzstd odmítne
  const withSize = [0x40, 0x00, 769 & 255, 769 >> 8];
  cases.push(['surový blok 1025 B u okna 1 KiB, velikost obsahu uvedena', zframe([{ raw: Buffer.alloc(1025, 7) }], { head: withSize }), 'blocksize', 1025]);
  cases.push(['RLE blok 1025 B u okna 1 KiB, velikost obsahu uvedena', zframe([{ rle: [7, 1025] }], { head: withSize }), 'blocksize', 1025]);
  cases.push(['surový blok 1025 B u okna 1 KiB, velikost obsahu neuvedena', zframe([{ raw: Buffer.alloc(1025, 7) }], { head: [0x00, 0x00] }), 'blocksize', null]);
  // čtyřproudé literály s pokaženým koncem jednoho proudu: od 255 znaků libzstd na rychlé cestě konec nekontroluje, pod to ano
  const good = huffCodes([1, 1, 2]);
  const four = (n, mutate) => {
    const parts = splitFour(Array.from({ length: n }, (_, i) => [2, 0, 1, 2, 2, 1, 0, 2][i % 8]));
    mutate(parts);
    return literalsFrame(directTree([1, 1]), parts.map((x) => huffStreamBytes(good, x)), n);
  };
  for (const [n, len] of [[100, null], [300, 300], [1000, 1000]]) {
    cases.push([`čtyři proudy, ${n} znaků, druhý o znak víc`, four(n, (p) => p[1].push(2)), 'litend', len]);
    cases.push([`čtyři proudy, ${n} znaků, druhý o znak míň`, four(n, (p) => p[1].pop()), 'litend', len]);
    cases.push([`čtyři proudy, ${n} znaků, čtvrtý o znak víc`, four(n, (p) => p[3].push(2)), 'litend', len]);
  }
  for (const [name, f, code] of cases) assert.throws(() => Z.decompress(f), (e) => e instanceof Z.ZstdError && e.code === code, name);
  // správné protějšky se rozbalí
  assert.equal(ours(four(300, () => {})).length, 300);
  assert.equal(ours(seqAt(1024)).length, 2003);
  const frames = cases.map((c) => c[1]);
  const want = oracle(frames);
  if (!want) return;
  cases.forEach(([name, , , len], i) => {
    if (len === null) assert.equal(want[i], null, 'libzstd má odmítnout: ' + name);
    else assert.ok(want[i] && want[i].length === len, 'libzstd má přijmout (' + len + ' B): ' + name + (want[i] ? ' dal ' + want[i].length : ' odmítl'));
  });
  judge(frames, want);
});

// ---------------------------------------------------------------- poškozené rámce: stejné rozhodnutí jako libzstd
test('poškozené rámce: co libzstd odmítne, odmítneme i my (kromě vadného kontrolního součtu), co oba přijmou, vyjde stejně; tolerují se jen tři pozorované shovívavosti libzstd (12 000 poškození; bez věštírny se přeskočí; ZSTD_SEED pro delší zkoušky s jiným semínkem)', (t) => {
  const r = rng(Number(process.env.ZSTD_SEED) || 4);
  const pick = (n) => Math.floor(r() * n);
  const bases = [];
  for (let i = 0; i < 60; i++) {
    const kind = ['text', 'skewed', 'records', 'mixed', 'same'][i % 5];
    const n = [60, 300, 2000, 9000, 40000][i % 5];
    bases.push(compress(gen[kind](n, r), { [C.ZSTD_c_compressionLevel]: [1, 3, 9, 19][i % 4], [C.ZSTD_c_checksumFlag]: i % 3 === 0 ? 1 : 0, [C.ZSTD_c_contentSizeFlag]: i % 2 }));
  }
  const frames = [];
  for (let it = 0; it < 12000; it++) {
    let f = Buffer.from(bases[it % bases.length]);
    const kind = pick(8);
    if (kind === 0) f[pick(f.length)] ^= 1 << pick(8);
    else if (kind === 1) f[pick(f.length)] = pick(256);
    else if (kind === 2) f = f.subarray(0, pick(f.length));
    else if (kind === 3) f = Buffer.concat([f.subarray(0, pick(f.length)), Buffer.from([pick(256)]), f.subarray(pick(f.length))]);
    else if (kind === 4) f = Buffer.concat([f, Buffer.from([pick(256)])]);
    else if (kind === 5) for (let k = 0; k < 3; k++) f[pick(f.length)] = pick(256);
    else if (f.length > 6 && (f[4] & 0x20) === 0) f[5] = kind === 6 ? pick(40) : pick(256); // menší nebo libovolné okno než to, se kterým se rámec psal
    frames.push(f);
  }
  const want = oracle(frames);
  if (!want) return t.skip('věštírna libzstd není k dispozici: tahle zkouška bez ní nehlídá nic');
  const c = judge(frames, want);
  assert.ok(c.accepted > 600 && c.rejected > 4000, `přijato ${c.accepted}, odmítnuto ${c.rejected}: zkouška by byla slabá`);
  assert.ok(c.endClass > 0, 'zkouška nikdy nezasáhla shovívavost libzstd (konec proudu literálů, okno nebo velikost bloku): povolená výjimka by zůstala nevyzkoušená');
  assert.ok(c.sumExplained > 0, 'zkouška nikdy nezasáhla rámec s vadným kontrolním součtem: oprávněná výjimka by zůstala nevyzkoušená');
});

// ---------------------------------------------------------------- ručně sestavené literály (Huffmanovy stromy), kam náhodné poškození skoro nedosáhne
test('ruční stromy: nejkratší kódy, čtyři proudy pod šest znaků a velikosti bloků se posuzují přesně jako v libzstd (pevné případy)', () => {
  // strom o délkách kódů 2, 2, 1 zapsaný správně (váhy 1, 1 + dopočtená 2) a špatně (váhy 2, 2 + dopočtená 3: nemá žádný nejdelší kód)
  const good = huffCodes([1, 1, 2]);
  const data = [2, 0, 1, 2];
  const okFrame = literalsFrame(directTree([1, 1]), [huffStreamBytes(good, data)], 4);
  assert.deepEqual(Array.from(ours(okFrame)), data);
  const badTree = literalsFrame(directTree([2, 2]), [huffStreamBytes(good, data)], 4);
  assert.throws(() => Z.decompress(badTree), /nejdelší kódy/);
  // čtyři proudy: od šesti znaků dál platí, pod šest je to chyba formátu
  const six = [2, 0, 1, 2, 2, 1, 0, 2];
  const four = (n) => literalsFrame(directTree([1, 1]), splitFour(six.slice(0, n)).map((part) => huffStreamBytes(good, part)), n);
  for (const n of [3, 4, 5]) assert.throws(() => Z.decompress(four(n)), /nejméně šest znaků/, 'znaků ' + n);
  for (const n of [6, 7, 8]) assert.deepEqual(Array.from(ours(four(n))), six.slice(0, n), 'znaků ' + n);
  // velikost bloku: RLE i surový blok smí mít nejvýš 128 KiB, i když je okno větší
  const rle = (size) => Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x50, ...u24((size << 3) | 3), 0x41]);
  assert.equal(ours(rle(131072)).length, 131072);
  assert.equal(ours(rle(131073)), null);
  // strom s jedinou výslovně zapsanou váhou (hlavička 128 je nejmenší přímý zápis): druhá váha se dopočítá a oba symboly mají jednobitové kódy
  const twoData = [0, 1, 1, 0, 1];
  const twoFrame = literalsFrame(directTree([1]), [huffStreamBytes(huffCodes([1, 1]), twoData)], 5);
  assert.deepEqual(Array.from(ours(twoFrame)), twoData);
  const frames = [okFrame, badTree, ...[3, 4, 5, 6, 7, 8].map(four), rle(131072), rle(131073), rle(200000), twoFrame];
  const want = oracle(frames);
  if (!want) return;
  judge(frames, want);
  // verdikty libzstd na pevných případech jsou přesně ty, které tu ručně popsal zápis zkoušky výše (ne jen „nějaké“)
  assert.deepEqual(want.map((w) => w !== null), [true, false, false, false, false, true, true, true, true, false, false, true]);
});

test('ruční stromy: tisíce náhodných úplných kódů (jeden i čtyři proudy) a jejich pokažených podob mají stejné rozhodnutí a obsah jako libzstd', () => {
  const r = rng(Number(process.env.ZSTD_SEED) || 21);
  const pick = (n) => Math.floor(r() * n);
  const frames = [];
  const valid = []; // [index rámce, očekávané znaky] u nepoškozených stromů
  while (frames.length < 6000) {
    // náhodný úplný binární strom: dělí se náhodný list; hloubky listů jsou délky kódů
    const k = 2 + pick(40);
    const depth = [0];
    while (depth.length < k) {
      const i = pick(depth.length);
      depth.splice(i, 1, depth[i] + 1, depth[i] + 1);
    }
    const maxBits = Math.max(...depth);
    if (maxBits > 12) continue;
    const chosen = [...Array(k + pick(60)).keys()];
    for (let i = chosen.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
    }
    const used = chosen.slice(0, k).sort((a, b) => a - b);
    const weights = new Array(used[k - 1] + 1).fill(0);
    used.forEach((sym, idx) => (weights[sym] = maxBits + 1 - depth[idx]));
    const explicit = weights.slice(0, -1); // poslední váhu dopočítává dekodér
    const codes = huffCodes(weights);
    const regen = 1 + pick(300);
    const syms = Array.from({ length: regen }, () => used[pick(k)]);
    const streams = regen >= 6 && r() < 0.6 ? splitFour(syms).map((part) => huffStreamBytes(codes, part)) : [huffStreamBytes(codes, syms)];
    let tree = directTree(explicit);
    let regenField = regen;
    const kind = pick(8);
    if (kind === 1) tree = directTree(explicit.map((w, i) => (i === pick(explicit.length) ? pick(14) : w)));
    else if (kind === 2) tree = directTree([...explicit, pick(13)]);
    else if (kind === 3 && tree[0] > 128) tree[0]--;
    else if (kind === 4 && tree[0] < 255) tree[0]++;
    else if (kind === 5) streams[pick(streams.length)][0] ^= 1 << pick(8);
    else if (kind === 6) regenField = Math.max(1, regen + pick(5) - 2);
    const bodyLen = tree.length + (streams.length === 4 ? 6 : 0) + streams.reduce((a, x) => a + x.length, 0);
    if (regenField >= 1024 || bodyLen >= 1024 || streams.some((x) => x.length > 65535)) continue;
    if (kind === 0) valid.push([frames.length, syms]);
    frames.push(literalsFrame(tree, streams, regenField));
  }
  // nepoškozené stromy se musí rozbalit na přesně ty znaky, které se zapsaly (nezávisle na věštírně: kontroluje to i zápis proudů v této zkoušce)
  assert.ok(valid.length > 500, String(valid.length));
  for (const [i, syms] of valid) assert.deepEqual(Array.from(ours(frames[i]) || []), syms, 'rámec ' + i);
  const want = oracle(frames);
  if (!want) return;
  const c = judge(frames, want);
  assert.ok(c.accepted > 1500 && c.rejected > 300, `přijato ${c.accepted}, odmítnuto ${c.rejected}: zkouška by byla slabá`);
});

// ---------------------------------------------------------------- ručně sestavené rámce: hlavička, bloky, literály a sekvence s RLE tabulkami
const text4 = Buffer.from('ahoj');
test('hlavička: identifikátor slovníku má 0, 1, 2 nebo 4 bajty, nulový znamená bez slovníku, nenulový se odmítne; readFrameHeader čte pole přesně', () => {
  const frames = [];
  const sizes = [0, 1, 2, 4];
  for (let flag = 0; flag < 4; flag++) {
    const zero = zframe([{ raw: text4 }], { head: [flag, 0x50, ...new Array(sizes[flag]).fill(0)] });
    assert.equal(Buffer.from(ours(zero) || []).toString(), 'ahoj', 'nulový identifikátor, příznak ' + flag);
    frames.push(zero);
    if (flag === 0) continue;
    // nenulový je jen poslední bajt: kratší čtení by ho minulo
    const id = new Array(sizes[flag]).fill(0);
    id[id.length - 1] = 1;
    const nonzero = zframe([{ raw: text4 }], { head: [flag, 0x50, ...id] });
    assert.throws(() => Z.decompress(nonzero), (e) => e.code === 'dictionary', 'příznak ' + flag);
    frames.push(nonzero);
  }
  const want = oracle(frames);
  if (want) judge(frames, want);
  // pole hlavičky: okno z exponentu a mantisy, velikost obsahu ve čtyřech šířkách, příznak součtu, délka hlavičky
  const rh = (...bytes) => Z.readFrameHeader(Uint8Array.from([...MAGIC_BYTES, ...bytes]));
  assert.deepEqual({ ...rh(0x00, 0x00, 0) }, { windowSize: 1024, contentSize: null, hasChecksum: false, headerLength: 6 });
  assert.equal(rh(0x00, 0x07, 0).windowSize, 1024 + 128 * 7);
  assert.equal(rh(0x00, 0x08, 0).windowSize, 2048);
  assert.equal(rh(0x04, 0x00, 0).hasChecksum, true);
  assert.deepEqual({ ...rh(0x20, 65, 0) }, { windowSize: 65, contentSize: 65, hasChecksum: false, headerLength: 6 });
  assert.deepEqual({ ...rh(0x40, 0x00, 44, 0) }, { windowSize: 1024, contentSize: 300, hasChecksum: false, headerLength: 8 });
  assert.equal(rh(0x80, 0x00, 1, 0, 0, 0).contentSize, 1);
  assert.equal(rh(0x80, 0x00, 0, 0, 0, 1).contentSize, 2 ** 24);
  assert.equal(rh(0xc0, 0x00, 0, 0, 0, 0, 0, 1, 0, 0).contentSize, 2 ** 40);
  assert.throws(() => rh(0xc0, 0x00, 0, 0, 0, 0, 0, 0, 0x20, 0), /Neplatná velikost obsahu/); // 2^53 už není bezpečné celé číslo
  assert.throws(() => rh(0x00), /useknutý/);
});

test('bloky: rezervovaný typ 3 se odmítne, strop výstupu platí na bajt přesně u každého druhu bloku i u rámce bez uvedené velikosti obsahu', () => {
  const reserved = Buffer.from([...MAGIC_BYTES, 0x00, 0x50, ...u24((2 << 3) | (3 << 1) | 1), 0x00, 0x00]);
  assert.throws(() => Z.decompress(reserved), /Neplatný typ bloku/);
  const frames = [reserved];
  // rámce bez uvedené velikosti obsahu: RLE, surový, komprimovaný, víceblokový
  const noSize = (buf) => zlib.zstdCompressSync(buf, { params: { [C.ZSTD_c_contentSizeFlag]: 0 } });
  const r = rng(31);
  const cases = [Buffer.alloc(5000, 0x41), gen.random(300, r), gen.text(1000, r), Buffer.concat([gen.random(200000, r), Buffer.alloc(5000)])];
  for (const input of cases) {
    const f = noSize(input);
    frames.push(f);
    const n = input.length;
    assert.ok(same(ours(f, { maxOutput: n }), input), 'přesně na stropu, ' + n);
    assert.ok(same(ours(f, { maxOutput: n + 1 }), input));
    assert.throws(() => Z.decompress(f, { maxOutput: n - 1 }), (e) => e.code === 'limit', 'o bajt pod stropem, ' + n);
  }
  const want = oracle(frames);
  if (want) judge(frames, want);
});

test('literály: největší blok je 128 KiB (osmnáctibitová velikost), useknuté a chybějící části a pravidla stromu mají své chyby', () => {
  // čtyři proudy z jednoho symbolu s jednobitovým kódem (strom délek 2, 2, 1: symbol 2 má kód 1); váhy [1, 1] + dopočtená 2
  const big = (regen) => zframe([{ comp: [...bigLiterals(regen), 0x00] }]);
  const ok = big(131072);
  assert.ok(same(ours(ok), new Uint8Array(131072).fill(2)), 'právě největší blok');
  assert.throws(() => Z.decompress(big(131073)), /největší blok/);
  const frames = [ok, big(131073)];
  const comp = (header, rest) => zframe([{ comp: [...header, ...rest] }]);
  const cases = [
    ['Surové literály jsou useknuté', zframe([{ comp: [0x50, 1, 2, 3, 4, 5] }]), /Surové literály jsou useknuté/], // 10 znaků slíbeno, 5 je
    ['Komprimované literály jsou useknuté', comp(u24(2 | (0 << 2) | (4 << 4) | (50 << 14)), [129, 0x11, 0x63]), /Komprimované literály jsou useknuté/],
    ['strom bez předchozího', comp(u24(3 | (0 << 2) | (4 << 4) | (3 << 14)), [0x63, 0x63, 0x63, 0x00]), /neexistující předchozí strom/],
    ['skok mezi proudy useknutý', comp(u24(2 | (1 << 2) | (8 << 4) | (5 << 14)), [129, 0x11, 1, 2, 3, 0x00]), /Skok mezi proudy/],
    ['čtvrtý proud bez bajtu', comp(u24(2 | (1 << 2) | (8 << 4) | (11 << 14)), [129, 0x11, 1, 0, 1, 0, 1, 0, 0x03, 0x03, 0x03, 0x00]), /nevejdou/],
    ['strom: slíbeno víc, než je', comp(u24(2 | (0 << 2) | (4 << 4) | (6 << 14)), [100, 0xf0, 0x03, 0x00, 0x04, 0x01]), /vadný nebo useknutý/],
    ['strom: přesnost FSE 7', comp(u24(2 | (0 << 2) | (4 << 4) | (4 << 14)), [3, 0x02, 0x00, 0x00, 0x01]), /Přesnost tabulky FSE/],
    ['strom: samé nulové váhy', comp(u24(2 | (0 << 2) | (4 << 4) | (3 << 14)), [...directTree([0, 0]), 0x01]), /žádný symbol/],
    ['strom: váha nad 12', comp(u24(2 | (0 << 2) | (4 << 4) | (3 << 14)), [...directTree([13, 13]), 0x01]), /mimo rozsah/],
    ['strom: kód delší než 12 bitů (128 vah 12)', comp(u24(2 | (0 << 2) | (4 << 4) | (66 << 14)), [...directTree(new Array(128).fill(12)), 0x01]), /delší, než dovoluje formát/],
    ['strom: dopočtená váha není mocnina dvou (váhy 3 a 1)', comp(u24(2 | (0 << 2) | (4 << 4) | (3 << 14)), [...directTree([3, 1]), 0x01]), /nejde odvodit/],
    ['strom: jeden symbol se stoprocentní pravděpodobností nikdy neskončí, váhy se hlídají', comp(u24(2 | (0 << 2) | (4 << 4) | (5 << 14)), [4, 0xf0, 0x03, 0x00, 0x04]), /příliš mnoho vah/],
  ];
  for (const [name, frame, re] of cases) {
    assert.throws(() => Z.decompress(frame), re, name);
    frames.push(frame);
  }
  const want = oracle(frames);
  if (want) judge(frames, want);
});

test('sekvence: prázdný proud a proud bez koncové značky, tabulky RLE mimo rozsah, opakování tabulky bez předchozí, přesnost FSE nad mezí', () => {
  const block = (...bytes) => zframe([{ comp: [0x00, ...bytes] }]); // surové literály o nulové délce, pak sekce sekvencí
  const cases = [
    ['prázdný proud', block(0x01, 0x00), /Proud bitů je prázdný/],
    ['proud bez koncové značky', block(0x01, 0x00, 0x00), /koncovou značku/],
    ['symbol RLE LL nad 35', block(0x01, 0x54, 36, 0, 0, 0x01), /Symbol tabulky RLE je mimo rozsah/],
    ['symbol RLE OF nad 31', block(0x01, 0x54, 0, 32, 0, 0x01), /Symbol tabulky RLE je mimo rozsah/],
    ['symbol RLE ML nad 52', block(0x01, 0x54, 0, 0, 53, 0x01), /Symbol tabulky RLE je mimo rozsah/],
    ['největší symboly RLE projdou do čtení proudu', block(0x01, 0x54, 35, 31, 52), /Proud bitů je prázdný/],
    ['opakování tabulek bez předchozího bloku', block(0x01, 0xfc, 0x01), /neexistuje/],
    ['LL: přesnost FSE 10', block(0x01, 0x94, 0x05, 0x00, 0x00, 0, 0, 0x01), /Přesnost tabulky FSE/],
    ['OF: přesnost FSE 9', block(0x01, 0x64, 0, 0x04, 0x00, 0x00, 0, 0x01), /Přesnost tabulky FSE/],
    ['rezervované bity režimů', block(0x01, 0x55, 0, 0, 0, 0x01), /Rezervované bity/],
    ['za prázdnou sekcí sekvencí jsou bajty', block(0x00, 0x00), /bajty navíc/],
  ];
  const frames = [];
  for (const [name, frame, re] of cases) {
    assert.throws(() => Z.decompress(frame), re, name);
    frames.push(frame);
  }
  const want = oracle(frames);
  if (want) judge(frames, want);
});

test('sekvence: počet sekvencí v jednom, dvou i třech bajtech a všechny kódy délek literálů a shod s bity navíc (RLE tabulky) shodně s libzstd', () => {
  const frames = [];
  const expected = [];
  const history = Buffer.from(gen.random(300, rng(41)));
  // počet sekvencí: samé sekvence s kódy 0 (délka shody 3, bez bitů navíc), takže proud nese jen koncovou značku
  for (const n of [1, 2, 126, 127, 128, 129, 255, 256, 1000, 32511, 32512, 32513, 40000]) {
    const f = zframe([{ raw: history }, { comp: rleSeqBlock([], { ll: 0, of: 0, ml: 0 }, new Array(n).fill({ of: 0, ml: 0, ll: 0 })) }]);
    const out = ours(f);
    assert.ok(out, 'počet ' + n);
    assert.equal(out.length, 300 + 3 * n, 'počet ' + n);
    frames.push(f);
  }
  // všechny kódy délky literálů a délky shody, nejmenší i největší hodnota bitů navíc
  for (let ll = 0; ll < 36; ll++) {
    for (const ml of [0, 1, 31, 32, 35, 36, 39, 40, 42, 43, 52]) {
      for (const extra of ['min', 'max']) {
        const q = { of: 0, ml: extra === 'min' ? 0 : 2 ** ML_EXTRA[ml] - 1, ll: extra === 'min' ? 0 : 2 ** LL_EXTRA[ll] - 1 };
        const litLen = LL_BASE_T[ll] + q.ll;
        const matchLen = ML_BASE_T[ml] + q.ml;
        if (litLen + matchLen > 131072) continue; // větší než největší blok: oba rozbalovače ho odmítnou, tady se jen počítá výstup
        const lits = Buffer.from(gen.random(litLen, rng(100 + ll)));
        const f = zframe([{ raw: history }, { comp: rleSeqBlock(lits, { ll, of: 0, ml }, [q]) }]);
        const out = ours(f);
        assert.ok(out, `ll ${ll} ml ${ml} ${extra}`);
        assert.equal(out.length, 300 + litLen + matchLen, `ll ${ll} ml ${ml} ${extra}`);
        frames.push(f);
        expected.push([frames.length - 1, litLen, matchLen]);
      }
    }
  }
  const want = oracle(frames);
  if (!want) return;
  const c = judge(frames, want);
  assert.equal(c.rejected, 0, 'všechny tyhle rámce jsou platné');
  assert.equal(c.accepted, frames.length);
});

test('sekvence: odkaz za okno, výstup bloku nad největší blok, zbylé literály nad blok a nulový opakovaný posun', () => {
  // okno 1 KiB (wd 0): dva surové bloky po 1000 bajtech dají historii 2000 bajtů, odkaz dál než okno se odmítne i když v historii je
  const hist = [{ raw: Buffer.from(gen.random(1000, rng(51))) }, { raw: Buffer.from(gen.random(1000, rng(52))) }];
  const seqAt = (offset) => {
    const v = offset + 3; // hodnota posunu: posuny 1 až 3 jsou opakování
    const code = 31 - Math.clz32(v);
    return zframe([...hist, { comp: rleSeqBlock([], { ll: 0, of: code, ml: 0 }, [{ of: v - 2 ** code, ml: 0, ll: 0 }]) }], { wd: 0x00 });
  };
  assert.equal(ours(seqAt(1024)).length, 2003, 'posun přesně na velikosti okna');
  for (const off of [1025, 1500]) assert.throws(() => Z.decompress(seqAt(off)), (e) => e.code === 'window' && /dál, než dovoluje okno/.test(e.message), 'posun ' + off);
  assert.throws(() => Z.decompress(seqAt(2001)), /před začátek výstupu/); // dál než všechno, co je před ním
  // výstup jednoho bloku nad největší blok: okno 1 KiB dovolí blok nejvýš 1 KiB; 1000 literálů + shoda o délce 67 až 82 to přesáhne
  const over = zframe([...hist, { comp: rleSeqBlock(Buffer.from(gen.random(1000, rng(53))), { ll: 28, of: 0, ml: 40 }, [{ of: 0, ml: 0, ll: 488 }]) }], { wd: 0x00 });
  assert.throws(() => Z.decompress(over), /Sekvence by přesáhla největší blok/);
  // zbylé literály po sekvencích přesáhnou blok: 131072 literálů (z malého bloku, jsou komprimované) + shoda o délce 3
  const left = zframe([{ raw: text4 }, { comp: [...bigLiterals(131072), 0x01, 0x54, 0, 0, 0, ...bitStream('')] }]);
  assert.throws(() => Z.decompress(left), /zbylých literálů/);
  // nulový opakovaný posun: první sekvence s hodnotou posunu 3 a nulovými literály chce „první opakovaný posun minus jedna“, což je při počátečním 1 nula; odmítá se (libzstd 1.5.7 také)
  const zero = zframe([{ raw: Buffer.from(gen.random(100, rng(55))) }, { comp: rleSeqBlock([], { ll: 0, of: 1, ml: 0 }, [{ of: 1, ml: 0, ll: 0 }]) }]);
  assert.throws(() => Z.decompress(zero), /nulový posun/);
  // totéž s hodnotou posunu 2 (opakovaný posun č. 2 = 8) je platné
  const nonzero = zframe([{ raw: Buffer.from(gen.random(100, rng(55))) }, { comp: rleSeqBlock([], { ll: 0, of: 1, ml: 0 }, [{ of: 0, ml: 0, ll: 0 }]) }]);
  assert.equal(ours(nonzero).length, 103);
  const frames = [seqAt(1024), seqAt(2001), over, left, zero, nonzero]; // odkazy za okno (kód window) tu nejsou: libzstd je v rámci své vyrovnávací paměti přijme
  const want = oracle(frames);
  if (want) judge(frames, want);
});

test('konce proudů bitů, přímo (bez věštírny): literály bez koncové značky, s nespotřebovanými bity nebo čtené za začátek mají kód litend; sekvence mají inexact a overread; sekvence nesmí číst víc literálů, než blok má', () => {
  const codeOf = (frame) => {
    try {
      Z.decompress(frame);
    } catch (e) {
      return e instanceof Z.ZstdError ? e.code : 'cizí výjimka';
    }
    return 'ok';
  };
  const frames = [];
  const check = (frame, expected, name, message) => {
    assert.equal(codeOf(frame), expected, name);
    if (message) assert.throws(() => Z.decompress(frame), message, name + ' (text chyby)');
    frames.push(frame);
  };
  // literály: jeden proud (strom délek kódů 2, 2, 1; symbol 2 má jednobitový kód)
  const good = huffCodes([1, 1, 2]);
  const data = [2, 0, 1, 2];
  const one = (streamBytes, regen) => literalsFrame(directTree([1, 1]), [streamBytes], regen);
  check(one(huffStreamBytes(good, data), 4), 'ok', 'správný proud');
  check(one([0x00], 4), 'litend', 'poslední bajt proudu je 0: chybí koncová značka');
  check(one(huffStreamBytes(good, [...data, 2]), 4), 'litend', 'proud nese víc znaků, než se slíbilo: zůstanou nepřečtené bity', /není celý spotřebovaný/);
  check(one(huffStreamBytes(good, data.slice(0, 3)), 4), 'litend', 'proud nese míň znaků, než se slíbilo: čte se za začátek', /přečtený za svůj začátek/);
  check(one(bitStream('1110'), 4), 'litend', 'poslední kód (dva bity) má v proudu jen jeden bit: čte se o jediný bit za začátek', /přečtený za svůj začátek/);
  check(one(bitStream('1111'), 4), 'ok', 'tytéž čtyři znaky bez zbytku: proud je spotřebovaný přesně');
  // čtyři proudy: pokažený druhý proud
  const six = [2, 0, 1, 2, 2, 1, 0, 2];
  const four = (mutate) => {
    const parts = splitFour(six);
    mutate(parts);
    return literalsFrame(directTree([1, 1]), parts.map((x) => huffStreamBytes(good, x)), 8);
  };
  check(four(() => {}), 'ok', 'správné čtyři proudy');
  check(four((parts) => parts[1].push(2)), 'litend', 'čtyři proudy: druhý nese znak navíc');
  check(four((parts) => parts[1].pop()), 'litend', 'čtyři proudy: druhý nese znak málo');
  // sekvence: jedna sekvence z RLE tabulek, historie 300 B
  const history = Buffer.from(gen.random(300, rng(91)));
  const seqFrame = (lits, codes, bits) => zframe([{ raw: history }, { comp: Buffer.concat([rawLits(lits), Buffer.from([1, 0x54, codes.ll, codes.of, codes.ml, ...bitStream(bits)])]) }]);
  const zero = { ll: 0, of: 0, ml: 0 };
  check(seqFrame([], zero, ''), 'ok', 'sekvence bez bitů navíc a prázdný proud');
  check(seqFrame([], zero, '1'), 'inexact', 'v proudu sekvencí zůstal nepřečtený bit', /není celý spotřebovaný/);
  check(seqFrame([], { ll: 0, of: 0, ml: 32 }, ''), 'overread', 'kód délky shody 32 chce jeden bit navíc, a proud je prázdný', /přečtený za svůj začátek/);
  check(seqFrame([], { ll: 0, of: 0, ml: 32 }, '0'), 'ok', 'tentýž kód s tím bitem');
  check(seqFrame([], { ll: 0, of: 3, ml: 0 }, '00'), 'overread', 'posun o kódu 3 chce tři bity a proud má dva');
  // čtení literálů nad jejich počet
  const tooMany = zframe([{ raw: history }, { comp: rleSeqBlock(Buffer.from('ab'), { ll: 5, of: 0, ml: 0 }, [{ of: 0, ml: 0, ll: 0 }]) }]);
  assert.throws(() => Z.decompress(tooMany), /Sekvence čte víc literálů, než blok má/);
  frames.push(tooMany);
  // libzstd (je-li k dispozici) všechny tyhle rámce posoudí stejně, až na jeho pozorovanou shovívavost u čtyřproudých literálů
  const want = oracle(frames);
  if (want) judge(frames, want);
});

test('sekvence: odkaz dál než 2^25 bajtů (bity posunu nad 24) se přečte přesně; zkouška staví 33 MiB výstupu z RLE bloků', () => {
  // okno 64 MiB (wd 0x80); bloky RLE: A 65636 bajtů, B 131072, 255 × C po 131072 a C o 65536 bajtech; pak sekvence s posunem 2^25 + 65537, který ukazuje na poslední bajt bloku A
  const blocks = [{ rle: [0x41, 65636] }, { rle: [0x42, 131072] }];
  for (let i = 0; i < 255; i++) blocks.push({ rle: [0x43, 131072] });
  blocks.push({ rle: [0x43, 65536] });
  const history = 65636 + 131072 * 256 + 65536; // 2^25 + 131172
  const offset = 2 ** 25 + 65537; // horních 9 z 25 bitů posunu je nenulových, takže chyba ve skládání bitů nad 24 by se projevila
  const ofValue = offset + 3;
  assert.equal(history - offset, 65635);
  blocks.push({ comp: rleSeqBlock([], { ll: 0, of: 25, ml: 0 }, [{ of: ofValue - 2 ** 25, ml: 0, ll: 0 }]) });
  const f = zframe(blocks, { wd: 0x80 });
  const out = Z.decompress(f, { maxOutput: 2 ** 26 });
  assert.equal(out.length, history + 3);
  assert.deepEqual(Array.from(out.subarray(history, history + 3)), [0x41, 0x42, 0x42]);
  assert.equal(out[65635], 0x41);
  assert.equal(out[65636], 0x42);
  const want = oracle([f]);
  if (want) assert.ok(want[0] && same(want[0], out), 'libzstd dá totéž');
});

test('sekvence: náhodné bloky s RLE tabulkami a náhodnými bity navíc (opakované posuny, všechny druhy kódů) mají stejné rozhodnutí a výstup jako libzstd', (t) => {
  const r = rng(Number(process.env.ZSTD_SEED) || 61);
  const pick = (n) => Math.floor(r() * n);
  const frames = [];
  while (frames.length < 4000) {
    const blocks = [{ raw: Buffer.from(Array.from({ length: 200 + pick(600) }, () => pick(256))) }];
    for (let b = 1 + pick(3); b > 0; b--) {
      const codes = { ll: pick(4) === 0 ? pick(36) : pick(16), ml: pick(4) === 0 ? pick(53) : pick(40), of: pick(5) === 0 ? pick(12) : pick(8) };
      const nSeq = pick(6) === 0 ? 1 + pick(200) : 1 + pick(4);
      const seqs = Array.from({ length: nSeq }, () => ({ of: pick(2 ** codes.of), ml: pick(2 ** ML_EXTRA[codes.ml]), ll: pick(2 ** LL_EXTRA[codes.ll]) }));
      let litSum = seqs.reduce((a, q) => a + LL_BASE_T[codes.ll] + q.ll, 0);
      while (litSum > 120000 && seqs.length > 1) litSum -= LL_BASE_T[codes.ll] + seqs.pop().ll;
      const lits = Buffer.from(Array.from({ length: litSum + pick(30) }, () => pick(256)));
      blocks.push({ comp: rleSeqBlock(lits, codes, seqs) });
    }
    frames.push(zframe(blocks));
  }
  const want = oracle(frames);
  if (!want) return t.skip('věštírna libzstd není k dispozici: tahle zkouška bez ní nehlídá nic');
  const c = judge(frames, want);
  assert.ok(c.accepted > 1500 && c.rejected > 100, `přijato ${c.accepted}, odmítnuto ${c.rejected}: zkouška by byla slabá`);
});

// ---------------------------------------------------------------- popis tabulky FSE: kruhová zkouška proti zapisovači napsanému zvlášť
/** Náhodné normalizované počty se součtem 2^accLog (−1 = „méně než jedna“); symboly mohou mít mezery. */
function randomCounts(pick, accLog, maxSym) {
  for (;;) {
    const size = 1 << accLog;
    const k = 2 + pick(Math.min(maxSym, 34));
    const set = new Set();
    while (set.size < k) set.add(pick(maxSym + 1));
    const syms = [...set].sort((a, b) => a - b);
    const counts = new Array(syms[syms.length - 1] + 1).fill(0);
    const nNeg = Math.min(pick(4), syms.length - 1);
    const negs = [...syms].sort(() => pick(3) - 1).slice(0, nNeg);
    negs.forEach((s) => (counts[s] = -1));
    const pos = syms.filter((s) => counts[s] !== -1);
    let rest = size - nNeg - pos.length;
    if (rest < 0) continue;
    pos.forEach((s) => (counts[s] = 1));
    while (rest > 0) {
      counts[pos[pick(pos.length)]]++;
      rest--;
    }
    return counts;
  }
}
const FSE_KINDS = [['LL', 9, 35], ['OF', 8, 31], ['ML', 9, 52], ['váhy Huffmanova stromu', 6, 255]];

test('popis tabulky FSE: tisíce náhodných platných popisů se přečtou přesně tak, jak byly zapsány, a z nich postavená tabulka pokrývá všechny stavy; useknutí a nadměrné hodnoty se odmítnou', () => {
  const { readFseDescription, buildFse } = Z.internals;
  const r = rng(Number(process.env.ZSTD_SEED) || 71);
  const pick = (n) => Math.floor(r() * n);
  let withZeroRuns = 0;
  let withNegative = 0;
  for (let it = 0; it < 3000; it++) {
    const [name, maxLog, maxSym] = FSE_KINDS[it % 4];
    const accLog = 5 + pick(maxLog - 4);
    const counts = randomCounts(pick, accLog, Math.min(maxSym, 60 + pick(200)));
    const { bytes, bits } = writeNCount(counts, accLog);
    if (counts.some((c, i) => c === 0 && i < counts.length - 1)) withZeroRuns++;
    if (counts.includes(-1)) withNegative++;
    const padded = Uint8Array.from([...bytes, 0xaa, 0xbb]);
    const d = readFseDescription(padded, 0, padded.length, maxLog, maxSym);
    assert.deepEqual(d.counts, counts, `${name}, přesnost ${accLog}`);
    assert.equal(d.accLog, accLog);
    assert.equal(d.bytes, bytes.length, 'zabrané bajty (bity ' + bits + ')');
    // každé useknutí o celý bajt (nebo víc) se pozná
    for (let cut = 0; cut < bytes.length; cut++) if ((cut << 3) < bits) assert.throws(() => readFseDescription(Uint8Array.from(bytes.slice(0, cut)), 0, cut, maxLog, maxSym), /useknutý/, `${name}: useknuto na ${cut} z ${bytes.length} bajtů`);
    // přesnost nad mezí se odmítne
    if (accLog === maxLog) {
      const over = writeNCount(randomCounts(pick, accLog + 1, Math.min(maxSym, 40)), accLog + 1);
      assert.throws(() => readFseDescription(Uint8Array.from(over.bytes), 0, over.bytes.length, maxLog, maxSym), /Přesnost tabulky FSE/, name);
    }
    // tabulka: každý symbol má tolik stavů, kolik je jeho počet (−1 má jeden), a rozsahy následujících stavů jednoho symbolu pokrývají všechny stavy přesně jednou
    const t = buildFse(d.counts, d.accLog);
    const size = 1 << accLog;
    counts.forEach((c, s) => {
      const states = [];
      for (let u = 0; u < size; u++) if (t.sym[u] === s) states.push(u);
      assert.equal(states.length, c === -1 ? 1 : c, `počet stavů symbolu ${s}`);
      if (!states.length) return;
      const covered = new Array(size).fill(0);
      for (const u of states) for (let x = t.base[u]; x < t.base[u] + (1 << t.nb[u]); x++) covered[x]++;
      assert.ok(covered.every((x) => x === 1), `rozsahy symbolu ${s} nepokrývají stavy přesně jednou`);
    });
  }
  assert.ok(withZeroRuns > 300 && withNegative > 300, `zkouška by byla slabá: nuly ${withZeroRuns}, záporné ${withNegative}`);
  // hraniční počet symbolů: právě maxSym + 1 symbolů projde, o jeden víc se odmítne; dlouhá řada nul za symbolem přes mez se odmítne hned
  for (const [name, maxLog, maxSym] of FSE_KINDS.slice(0, 3)) {
    const exact = new Array(maxSym + 1).fill(1);
    exact[0] = (1 << maxLog) - maxSym;
    const e = writeNCount(exact, maxLog);
    assert.equal(readFseDescription(Uint8Array.from(e.bytes), 0, e.bytes.length, maxLog, maxSym).counts.length, maxSym + 1, name);
    const tooMany = new Array(maxSym + 2).fill(1);
    tooMany[0] = (1 << maxLog) - maxSym - 1;
    const m = writeNCount(tooMany, maxLog);
    assert.throws(() => readFseDescription(Uint8Array.from(m.bytes), 0, m.bytes.length, maxLog, maxSym), /Tabulka FSE/, name + ' o symbol víc');
    const gap = [1, ...new Array(maxSym + 20).fill(0), (1 << maxLog) - 1];
    const g = writeNCount(gap, maxLog);
    assert.throws(() => readFseDescription(Uint8Array.from(g.bytes), 0, g.bytes.length, maxLog, maxSym), /víc symbolů/, name + ' řada nul');
  }
  // hranice u řady nul: poslední symbol přesně na největším povoleném čísle projde, o jedno místo dál se odmítne (řada nul přeleze mez)
  for (const [name, maxLog, maxSym] of FSE_KINDS) {
    const okEdge = writeNCount([1, ...new Array(maxSym - 1).fill(0), (1 << maxLog) - 1], maxLog);
    assert.equal(readFseDescription(Uint8Array.from(okEdge.bytes), 0, okEdge.bytes.length, maxLog, maxSym).counts.length, maxSym + 1, name + ' poslední symbol na hranici');
    const overEdge = writeNCount([1, ...new Array(maxSym).fill(0), (1 << maxLog) - 1], maxLog);
    assert.throws(() => readFseDescription(Uint8Array.from(overEdge.bytes), 0, overEdge.bytes.length, maxLog, maxSym), /víc symbolů/, name + ' poslední symbol o jedno místo za hranicí');
  }
  // řada nul ze samých jedniček (příznaky „další tři nuly“): odmítne se hned po překročení meze, ne až na konci popisu, a rychle i u dlouhého popisu
  for (const [name, maxLog, maxSym] of FSE_KINDS) {
    const flood = Uint8Array.from([0x10, 0xfe, ...new Array(200000).fill(0xff)]); // přesnost 5, první symbol s počtem 0, pak jen příznaky „tři nuly“
    const t0 = Date.now();
    assert.throws(() => readFseDescription(flood, 0, flood.length, maxLog, maxSym), /víc symbolů/, name);
    assert.ok(Date.now() - t0 < 500, name + ' trvalo ' + (Date.now() - t0) + ' ms');
  }
  // pomocná stavba tabulky přímo: součet, který nesedí s velikostí, se odmítne
  assert.throws(() => buildFse([10, 10], 5), /nesedí s velikostí tabulky/);
});

test('každé useknutí platného rámce se odmítne a nic nezamrzne ani nepadne', () => {
  const r = rng(6);
  for (const kind of ['text', 'mixed', 'records']) {
    const frame = compress(gen[kind](3000, r), { [C.ZSTD_c_checksumFlag]: 1, [C.ZSTD_c_compressionLevel]: 9 });
    assert.ok(ours(frame));
    for (let n = 0; n < frame.length; n++) assert.equal(ours(frame.subarray(0, n)), null, `${kind}, délka ${n}`);
  }
});

// ---------------------------------------------------------------- útoky z nezávislé revize
test('výbuch z RLE bloků: rámec s tisíci bloky po 128 KiB se zastaví na stropu výstupu, rychle a bez velké paměti', () => {
  const header = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x50];
  const block = (last) => [...u24((131072 << 3) | (1 << 1) | last), 0x41];
  const blocks = [];
  for (let i = 0; i < 4000; i++) blocks.push(...block(i === 3999 ? 1 : 0));
  const frame = Uint8Array.from([...header, ...blocks]);
  const t0 = Date.now();
  assert.throws(() => Z.decompress(frame, { maxOutput: 1 << 20 }), (e) => e instanceof Z.ZstdError && e.code === 'limit');
  assert.ok(Date.now() - t0 < 2000, 'zastavení trvalo ' + (Date.now() - t0) + ' ms');
  // s dostatečným stropem se rozbalí celé a výstup je správný
  const small = Uint8Array.from([...header, ...block(0), ...block(1)]);
  const out = Z.decompress(small, { maxOutput: 1 << 20 });
  assert.equal(out.length, 262144);
  assert.ok(out.every((x) => x === 0x41));
});

test('počet bloků: strop se odvozuje z povoleného výstupu (1 blok na KiB + 16) nebo ze slíbené velikosti obsahu, maxBlocks ho jen zužuje, počet se hlásí a kontroluje se dřív než práce na bloku', () => {
  // povolený výstup 1024 B: 1 + 16 = 17 bloků
  assert.equal(Z.decompressFrame(emptyBlocksFrame(17), { maxOutput: 1024 }).blocks, 17);
  assert.throws(() => Z.decompress(emptyBlocksFrame(18), { maxOutput: 1024 }), (e) => e instanceof Z.ZstdError && e.code === 'blocks' && e.blocks === 18, 'chyba nese počet zpracovaných bloků včetně toho, na kterém se přestalo');
  // výchozí strop 16 MiB: 16 384 + 16 bloků
  assert.equal(Z.decompressFrame(emptyBlocksFrame(16400)).blocks, 16400);
  assert.throws(() => Z.decompress(emptyBlocksFrame(16401)), (e) => e.code === 'blocks');
  // neúplný KiB se počítá nahoru: výstup 1025 B povolí 2 + 16 bloků
  assert.equal(Z.decompressFrame(emptyBlocksFrame(18), { maxOutput: 1025 }).blocks, 18);
  assert.throws(() => Z.decompress(emptyBlocksFrame(19), { maxOutput: 1025 }), (e) => e.code === 'blocks');
  // maxBlocks strop jen zužuje; vadné hodnoty se ignorují
  assert.equal(Z.decompressFrame(emptyBlocksFrame(5), { maxBlocks: 5 }).blocks, 5);
  assert.throws(() => Z.decompress(emptyBlocksFrame(6), { maxBlocks: 5 }), (e) => e.code === 'blocks');
  assert.throws(() => Z.decompress(emptyBlocksFrame(18), { maxOutput: 1024, maxBlocks: 1000 }), (e) => e.code === 'blocks', 'větší maxBlocks odvozený strop nerozšíří');
  for (const bad of [0, -1, 1.5, 'x', null, NaN, Infinity]) assert.equal(Z.decompressFrame(emptyBlocksFrame(17), { maxOutput: 1024, maxBlocks: bad }).blocks, 17, String(bad));
  // rámec se slíbenou velikostí obsahu (jednosegmentový, velikost 0): strop se odvozuje od ní, ne od maxOutput: 16 bloků ano, 17 ne
  const sized = (n) => zframe(Array.from({ length: n }, () => ({ raw: [] })), { head: [0x20, 0] });
  assert.equal(Z.decompressFrame(sized(16), { maxOutput: 1 << 30 }).blocks, 16);
  assert.throws(() => Z.decompress(sized(17), { maxOutput: 1 << 30 }), (e) => e.code === 'blocks');
  // i tady se neúplný KiB počítá nahoru: slíbený jediný bajt povolí 1 + 16 bloků (šestnáct prázdných a jeden s bajtem)
  const oneByte = zframe([...Array.from({ length: 16 }, () => ({ raw: [] })), { raw: [65] }], { head: [0x20, 1] });
  assert.equal(Z.decompressFrame(oneByte, { maxOutput: 1 << 30 }).blocks, 17);
  // kontrola počtu předchází práci na bloku: za posledním povoleným blokem leží blok rezervovaného typu, a hlásí se strop, ne typ
  const withReserved = (plain) => Buffer.concat([Buffer.from([...MAGIC_BYTES, 0x00, 0x50]), ...Array.from({ length: plain }, () => Buffer.from(blockHeader(0, 0, false))), Buffer.from(blockHeader(0, 3, true))]);
  assert.throws(() => Z.decompress(withReserved(17), { maxOutput: 1024 }), (e) => e.code === 'blocks');
  assert.throws(() => Z.decompress(withReserved(16), { maxOutput: 1024 }), (e) => /Neplatný typ bloku/.test(e.message) && e.blocks === 17, 'a totéž u jiné chyby: nese počet bloků do chyby');
  assert.throws(() => Z.decompress(Buffer.concat([emptyBlocksFrame(5), Buffer.from([0])]), { exact: true }), (e) => /bajty navíc/.test(e.message) && e.blocks === 5, 'i chyba po posledním bloku');
  assert.throws(() => Z.decompress(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), (e) => e.code === 'magic' && e.blocks === undefined, 'chyba hlavičky: bloky se ještě nepočítaly (readFrameHeader je před smyčkou)');
  // drahé bloky (každý staví Huffmanův strom a tři tabulky FSE a vydá tři bajty): platný rámec se rozbalí správně, počet bloků je n + 1
  const ok = Z.decompressFrame(heavyFrame(50));
  assert.equal(ok.blocks, 51);
  assert.equal(ok.data.length, 16 + 3 * 50);
  assert.equal(Buffer.from(ok.data.subarray(0, 16)).toString(), 'abcdefghijklmnop');
  const heavyOk = heavyFrame(16399); // 16 400 bloků včetně surového: přesně na stropu
  assert.equal(Z.decompressFrame(heavyOk).blocks, 16400);
  // rámec ze 190 000 drahých bloků by bez stropu trval řádově desítky sekund; takhle se zastaví na stropu za zlomek času (strop 4 s je štědrý i pro pomalý stroj)
  const heavy = heavyFrame(190000);
  const t0 = Date.now();
  assert.throws(() => Z.decompress(heavy), (e) => e instanceof Z.ZstdError && e.code === 'blocks');
  assert.ok(Date.now() - t0 < 4000, 'zastavení trvalo ' + (Date.now() - t0) + ' ms');
  const want = oracle([heavyFrame(50), heavyFrame(1)]);
  if (want) {
    assert.ok(want[0] && same(want[0], ok.data), 'libzstd rozbalí drahý rámec stejně');
    judge([heavyFrame(50), heavyFrame(1)], want);
  }
});

test('výbuch ze sekvencí: blok s největším možným počtem sekvencí (98 047) se zastaví na největším bloku a rychle; totéž s velkými shodami', () => {
  const history = Buffer.from(gen.random(300, rng(81)));
  // samé sekvence o délce shody 3 (kódy 0, posun z opakovaného posunu 4): největší blok 131072 B pojme jen 43 690 z nich, jeden blok slibuje 98 047
  const f = zframe([{ raw: history }, { comp: rleSeqBlock([], { ll: 0, of: 0, ml: 0 }, new Array(98047).fill({ of: 0, ml: 0, ll: 0 })) }]);
  const t0 = process.hrtime.bigint();
  assert.throws(() => Z.decompress(f), (e) => e instanceof Z.ZstdError && /Sekvence by přesáhla největší blok/.test(e.message));
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 500, 'odmítnutí trvalo příliš dlouho');
  // s menším počtem (43 690 × 3 = 131 070 B) blok projde: hranice neleží jinde než v největším bloku
  const fits = zframe([{ raw: history }, { comp: rleSeqBlock([], { ll: 0, of: 0, ml: 0 }, new Array(43690).fill({ of: 0, ml: 0, ll: 0 })) }]);
  assert.equal(Z.decompress(fits).length, 300 + 131070);
  // jediná shoda o největší možné délce (kód 52 s 16 bity navíc: 65 539 + 65 535 = 131 074 B) je nad největší blok
  const big = zframe([{ raw: history }, { comp: rleSeqBlock([], { ll: 0, of: 0, ml: 52 }, [{ of: 0, ml: 65535, ll: 0 }]) }]);
  assert.throws(() => Z.decompress(big), /Sekvence by přesáhla největší blok/);
  const want = oracle([f, fits, big]);
  if (want) judge([f, fits, big], want);
});

test('chyby nesou počet zpracovaných bloků a vydaných bajtů; cizí výjimka je ZstdError s kódem internal v decompress i v decompressFrame; exact platí jen pro true', () => {
  // vydáno 1000 B a pak chyba: produced = 1000, blocks = 2
  const bad = zframe([{ rle: [0x41, 1000] }, { comp: rleSeqBlock([], { ll: 0, of: 20, ml: 0 }, [{ of: 0, ml: 0, ll: 0 }]) }]);
  for (const fn of [Z.decompress, Z.decompressFrame]) {
    assert.throws(() => fn(bad), (e) => e instanceof Z.ZstdError && /před začátek výstupu/.test(e.message) && e.produced === 1000 && e.blocks === 2);
  }
  // chyba hlavičky: ještě se nic nerozbalovalo, takže ani bloky, ani výstup se neuvádějí
  assert.throws(() => Z.decompress(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), (e) => e.code === 'magic' && e.produced === undefined && e.blocks === undefined);
  // chyba po vydání celého obsahu (bajty navíc): produced je celý výstup
  assert.throws(() => Z.decompress(Buffer.concat([zframe([{ rle: [0x41, 500] }]), Buffer.from([0])]), { exact: true }), (e) => /bajty navíc/.test(e.message) && e.produced === 500 && e.blocks === 1);
  // cizí výjimka (hostilní getter ve volbách) se zabalí, ať se volá cokoli z toho
  const hostile = { get maxOutput() { throw new RangeError('hostilní getter'); } };
  for (const fn of [Z.decompress, Z.decompressFrame]) {
    assert.throws(() => fn(zframe([{ raw: Buffer.from('ahoj') }]), hostile), (e) => e instanceof Z.ZstdError && e.code === 'internal' && /hostilní getter/.test(e.message));
  }
  // exact: jen pravdivá hodnota true vyžaduje přesný konec; jiné pravdivé hodnoty se neberou jako true
  const framed = Buffer.concat([zframe([{ raw: Buffer.from('ahoj') }]), Buffer.from([1, 2])]);
  assert.throws(() => Z.decompress(framed, { exact: true }), /bajty navíc/);
  for (const notTrue of [1, 'true', {}, 'ano']) assert.equal(Buffer.from(Z.decompress(framed, { exact: notTrue })).toString(), 'ahoj', String(notTrue));
});

test('paměť: rámec, který slibuje obří obsah, nepřidělí hned obří vyrovnávací paměť (začíná se nejvýš 1 MiB a roste se podle skutečného výstupu)', () => {
  // nejednosegmentový rámec s velikostí obsahu 2^29 (čtyři bajty, little endian) a jediným malým surovým blokem: dekodér selže na nesouladu velikosti, ale nesmí si předem vzít 512 MiB
  const promise = zframe([{ raw: Buffer.from('ahoj') }], { head: [0x80, 0x50, 0, 0, 0, 0x20] });
  const before = process.memoryUsage().arrayBuffers;
  assert.throws(() => Z.decompress(promise, { maxOutput: 2 ** 30 }), /nesedí s velikostí uvedenou v rámci/);
  const grew = process.memoryUsage().arrayBuffers - before;
  assert.ok(grew < 64 * 1024 * 1024, 'přidělilo se ' + (grew / 1048576).toFixed(1) + ' MiB');
  // růst podle skutečného výstupu: 3 MiB z RLE bloků bez uvedené velikosti a se stropem 1 GiB přidělí řádově jednotky MiB, ne strop
  const grow = zframe(Array.from({ length: 24 }, () => ({ rle: [0x41, 131072] })));
  const before2 = process.memoryUsage().arrayBuffers;
  assert.equal(Z.decompress(grow, { maxOutput: 2 ** 30 }).length, 3 * 1024 * 1024);
  const grew2 = process.memoryUsage().arrayBuffers - before2;
  assert.ok(grew2 < 64 * 1024 * 1024, 'přidělilo se ' + (grew2 / 1048576).toFixed(1) + ' MiB');
});

test('rámce s obřím oknem nebo obří slíbenou velikostí: okno nad 128 MiB se odmítne hned (jako v libzstd), na hranici projde; slíbená velikost nad strop se odmítne před rozbalením', () => {
  const raw = (txt) => [...u24((txt.length << 3) | 1), ...Buffer.from(txt)];
  const withWindow = (wd) => Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, wd, ...raw('ahoj')]);
  // okno 0xff (skoro 4 TiB) a okno o kousek nad hranicí 2^27 se odmítnou; okno přesně 2^27 (0x88) a o jeden stupeň menší projdou a nic se podle okna nealokuje
  for (const wd of [0xff, 0x89, 0xc0]) assert.throws(() => Z.decompress(withWindow(wd)), (e) => e instanceof Z.ZstdError && e.code === 'bigwindow', 'okno ' + wd.toString(16));
  for (const wd of [0x88, 0x87, 0x00]) assert.equal(Buffer.from(Z.decompress(withWindow(wd))).toString(), 'ahoj', 'okno ' + wd.toString(16));
  assert.equal(Z.LIMITS.maxWindow, 2 ** 27);
  // jednosegmentový rámec má okno rovné velikosti obsahu: nad 2^27 se odmítne i při dostatečném stropu výstupu
  const head4 = (n) => [0x28, 0xb5, 0x2f, 0xfd, 0x80 | 0x20, n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  assert.throws(() => Z.decompress(Uint8Array.from([...head4(2 ** 27 + 1), ...raw('x')]), { maxOutput: 2 ** 30 }), (e) => e instanceof Z.ZstdError && e.code === 'bigwindow');
  // velikost obsahu 8 bajtů s hodnotou 2^40
  const f2 = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0xc0, 0x50, 0, 0, 0, 0, 0, 1, 0, 0, ...raw('x')]);
  assert.throws(() => Z.decompress(f2), (e) => e instanceof Z.ZstdError && e.code === 'limit');
  // velikost obsahu přes bezpečné celé číslo
  const f3 = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0xc0, 0x50, 255, 255, 255, 255, 255, 255, 255, 255, ...raw('x')]);
  assert.throws(() => Z.decompress(f3), (e) => e instanceof Z.ZstdError);
});

test('hranice blokové velikosti: surový i RLE blok nad 128 KiB a blok větší než okno se odmítnou s kódem blocksize; na hranici projdou', () => {
  const isBlockSize = (e) => e instanceof Z.ZstdError && e.code === 'blocksize' && /největší blok/.test(e.message);
  const big = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x50, ...u24((131073 << 3) | 1), ...new Uint8Array(131073)];
  assert.throws(() => Z.decompress(Uint8Array.from(big)), isBlockSize);
  const bigRle = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x50, ...u24((131073 << 3) | (1 << 1) | 1), 0x41];
  assert.throws(() => Z.decompress(Uint8Array.from(bigRle)), isBlockSize);
  // okno 1 KiB (0x00): největší blok je 1 KiB
  const small = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, ...u24((1025 << 3) | 1), ...new Uint8Array(1025)];
  assert.throws(() => Z.decompress(Uint8Array.from(small)), isBlockSize);
  const smallRle = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, ...u24((1025 << 3) | (1 << 1) | 1), 0x41];
  assert.throws(() => Z.decompress(Uint8Array.from(smallRle)), isBlockSize);
  const ok = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, ...u24((1024 << 3) | 1), ...new Uint8Array(1024)];
  assert.equal(Z.decompress(Uint8Array.from(ok)).length, 1024);
  const okRle = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, ...u24((1024 << 3) | (1 << 1) | 1), 0x41];
  assert.equal(Z.decompress(Uint8Array.from(okRle)).length, 1024);
  // komprimovaný blok větší než okno (jeho velikost v hlavičce bloku): totéž
  const comp = [0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, ...u24((1025 << 3) | (2 << 1) | 1), ...new Uint8Array(1025)];
  assert.throws(() => Z.decompress(Uint8Array.from(comp)), isBlockSize);
});

// ---------------------------------------------------------------- hlavička a pravidla rozhraní
test('hlavička rámce: rezervovaný bit, slovník, přeskočitelný rámec, špatná magie a prázdný vstup se odmítnou; nepoužitý bit se toleruje', () => {
  const raw = [...u24((1 << 3) | 1), 0x41];
  const reserved = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x08, 0x50, ...raw]);
  assert.throws(() => Z.decompress(reserved), /rezervovaný bit/);
  const unused = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x10, 0x50, ...raw]);
  assert.equal(Z.decompress(unused)[0], 0x41);
  const dict = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x50, 7, ...raw]);
  assert.throws(() => Z.decompress(dict), (e) => e.code === 'dictionary');
  const dict0 = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x50, 0, ...raw]);
  assert.equal(Z.decompress(dict0)[0], 0x41); // identifikátor 0 znamená „bez slovníku“
  assert.throws(() => Z.decompress(Uint8Array.from([0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0])), (e) => e.code === 'magic');
  assert.throws(() => Z.decompress(Uint8Array.from([1, 2, 3, 4, 5, 6, 7])), (e) => e.code === 'magic');
  assert.throws(() => Z.decompress(new Uint8Array(0)), /useknutý/);
  assert.throws(() => Z.decompress(Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd])), /useknutý/);
  assert.throws(() => Z.decompress(Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])), /useknutý/);
});

test('velikost obsahu a kontrolní součet v rámci: nesoulad velikosti se odmítne, součet se přeskočí a jeho chybějící bajty jsou useknutí', () => {
  const raw = [...u24((4 << 3) | 1), 0x61, 0x62, 0x63, 0x64];
  // FCS 1 bajt, jednosegmentový rámec (příznak 0x20): velikost 5, ale blok má 4 bajty
  const bad = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 5, ...raw]);
  assert.throws(() => Z.decompress(bad), /nesedí s velikostí uvedenou v rámci/);
  const good = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 4, ...raw]);
  assert.equal(Buffer.from(Z.decompress(good)).toString(), 'abcd');
  // kontrolní součet (příznak 0x04): čtyři bajty se přeskočí, bez nich je rámec useknutý
  const sum = Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x24, 4, ...raw, 9, 9, 9, 9]);
  const r = Z.decompressFrame(sum);
  assert.equal(r.length, sum.length);
  assert.equal(Buffer.from(r.data).toString(), 'abcd');
  assert.throws(() => Z.decompress(sum.subarray(0, sum.length - 1)), /useknutý/);
  // velikost 256 až 511 se v poli o dvou bajtech ukládá jako (hodnota − 256)
  const two = [0x28, 0xb5, 0x2f, 0xfd, 0x40, 0x50, 44, 0, ...u24((300 << 3) | 1), ...new Uint8Array(300)];
  assert.equal(Z.decompress(Uint8Array.from(two)).length, 300);
});

test('volby: maxOutput, exact (bajty za rámcem), vstupy Buffer, ArrayBuffer a pohled s posunem; cokoli jiného není binární', () => {
  const frame = compress(Buffer.from('ahoj světe '.repeat(50)), { [C.ZSTD_c_checksumFlag]: 1 });
  const want = Buffer.from('ahoj světe '.repeat(50));
  assert.ok(same(Z.decompress(frame), want));
  assert.ok(same(Z.decompress(new Uint8Array(frame).buffer.slice(0)), want));
  const padded = new Uint8Array(frame.length + 20);
  padded.set(frame, 7);
  assert.ok(same(Z.decompress(padded.subarray(7, 7 + frame.length)), want));
  // bajty za rámcem: ignorují se, s exact se odmítnou; decompressFrame ohlásí přesnou délku
  const tail = Buffer.concat([frame, Buffer.from([1, 2, 3])]);
  assert.ok(same(Z.decompress(tail), want));
  assert.throws(() => Z.decompress(tail, { exact: true }), /bajty navíc/);
  assert.equal(Z.decompressFrame(tail).length, frame.length);
  assert.ok(same(Z.decompress(frame, { exact: true }), want));
  // strop výstupu
  assert.throws(() => Z.decompress(frame, { maxOutput: want.length - 1 }), (e) => e.code === 'limit');
  assert.ok(same(Z.decompress(frame, { maxOutput: want.length }), want));
  for (const badMax of [0, -5, 1.5, 'x', null, NaN]) assert.ok(same(Z.decompress(frame, { maxOutput: badMax }), want), String(badMax)); // vadná volba = výchozí strop
  for (const bad of [null, undefined, 'text', 42, {}, [1, 2, 3]]) assert.throws(() => Z.decompress(bad), (e) => e instanceof Z.ZstdError && e.code === 'input');
});

test('výstup je nová paměť a vstup se nemění; konstanty jsou zmrazené', () => {
  const frame = new Uint8Array(compress(Buffer.from('abc'.repeat(500)), {}));
  const copy = Uint8Array.from(frame);
  const out = Z.decompress(frame);
  assert.deepEqual(frame, copy);
  out.fill(0);
  assert.deepEqual(Z.decompress(frame).subarray(0, 3), Uint8Array.from([0x61, 0x62, 0x63]));
  assert.ok(Object.isFrozen(Z.LIMITS));
  assert.deepEqual({ ...Z.LIMITS }, { maxOutput: 16 * 1024 * 1024, blockMax: 131072, maxHufBits: 12, maxWindow: 134217728, bytesPerBlock: 1024, blockSlack: 16 });
  const e = new Z.ZstdError('x', 'kód');
  assert.ok(e instanceof Error && e.name === 'ZstdError' && e.code === 'kód');
  assert.equal(new Z.ZstdError('y').code, 'corrupt');
});

test('rychlost: 12 MiB nul a 3 MiB textu se rozbalí v řádu sekund', () => {
  const r = rng(7);
  const t0 = Date.now();
  const zeros = compress(Buffer.alloc(12 * 1024 * 1024), {});
  assert.equal(Z.decompress(zeros).length, 12 * 1024 * 1024);
  const text = gen.text(3 * 1024 * 1024, r);
  assert.ok(same(Z.decompress(compress(text, { [C.ZSTD_c_compressionLevel]: 5 })), text));
  assert.ok(Date.now() - t0 < 8000, 'trvalo ' + (Date.now() - t0) + ' ms');
});

// ---------------------------------------------------------------- zdroj
test('zdroj: čistý modul (žádný DOM, síť, úložiště, náhoda, čas ani načítání knihoven) a bez neviditelných znaků', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.|window\.|fetch\(|XMLHttpRequest|localStorage|Math\.random|Date\.now|new Date|crypto\.|require\(|import\(|importScripts|Worker\(/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]'));
});
