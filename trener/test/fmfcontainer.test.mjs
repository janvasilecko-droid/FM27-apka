import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const C = require('../src/fmfcontainer.js');
const G = require('../src/fmfglue.js');
const Z = require('../src/zstd.js');
const source = readFileSync(new URL('../src/fmfcontainer.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------- pomůcky: zapisovač syntetického .fmf je ve sdíleném souboru (i pro zkoušku v prohlížeči)
const B = require('./fixtures/fmf_builder.cjs');
const { zc, u32le, u64le, i64le, str, prng, aesEnc, buildFmf, tinyPng, tacContent, aomContent, imgHeader, imageContent, TITLE } = B;
const zcNoSum = B.zcNoSum;
const standard = B.standardFmf;
const deps = {
  zstd: (b, max) => new Uint8Array(zlib.zstdDecompressSync(b, { maxOutputLength: max })),
  aesCtr: async (key, iv, data) => { const d = crypto.createDecipheriv('aes-128-ctr', key, iv); return new Uint8Array(Buffer.concat([d.update(data), d.final()])); },
};
// stejné závislosti, ale s vlastním dekodérem zstd z aplikace (zstd.js přes fmfglue.js): to je to, co běží v prohlížeči; jedno čtení souboru = jeden rozbalovač s vlastním rozpočtem bloků, a tak se tu pro každé čtení dělá nový
const makeOwn = () => ({ ...deps, zstd: G.makeFrameDecompressor(Z) });
const flip = (file, at) => { const c = Buffer.from(file); c[at] ^= 0x01; return c; };

// ---------------------------------------------------------------- XXH64 a stavba zstd rámce
test('XXH64: prázdný vstup má známou hodnotu a kontrolní součty shodné s libzstd pro mnoho délek', () => {
  assert.equal(C.xxh64(new Uint8Array(0)).toString(16), 'ef46db3751d8e999');
  const rand = prng(11);
  for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 255, 256, 1000, 5000, 70000]) {
    const data = rand(n);
    const frame = zc(data);
    const expected = frame.readUInt32LE(frame.length - 4);
    assert.equal(Number(C.xxh64(new Uint8Array(data)) & 0xffffffffn), expected, `délka ${n}`);
  }
});

test('zstdFrameInfo: přesná délka rámce, kontrolní součet, jeden i více bloků, uvedená velikost obsahu', () => {
  const small = zc(Buffer.from('ahoj '.repeat(100)));
  const i1 = C.zstdFrameInfo(new Uint8Array(small), 0);
  assert.deepEqual({ length: i1.length, hasChecksum: i1.hasChecksum, contentSize: i1.contentSize }, { length: small.length, hasChecksum: true, contentSize: null });
  const big = prng(3)(400000); // nestlačitelné: víc bloků po 128 KiB
  const frame = zc(big);
  const i2 = C.zstdFrameInfo(new Uint8Array(frame), 0);
  assert.ok(i2.blocks > 1);
  assert.equal(i2.length, frame.length);
  const withSize = zlib.zstdCompressSync(Buffer.from('x'.repeat(5000)));
  const i3 = C.zstdFrameInfo(new Uint8Array(withSize), 0);
  assert.equal(i3.contentSize, 5000);
  assert.equal(i3.length, withSize.length);
  // rámec se v bajtech za koncem nehledá: nadbytečné bajty se nezapočítají
  const tail = Buffer.concat([small, Buffer.from([1, 2, 3])]);
  assert.equal(C.zstdFrameInfo(new Uint8Array(tail), 0).length, small.length);
});

test('zstdFrameInfo: poškozené rámce se odmítnou s důvodem, nikdy se nezacyklí ani nespadne', () => {
  const frame = new Uint8Array(zc(Buffer.from('abc'.repeat(300))));
  assert.match(C.zstdFrameInfo(frame.subarray(0, 5), 0).error, /useknutý/);
  assert.match(C.zstdFrameInfo(frame.subarray(0, frame.length - 6), 0).error, /useknutý/);
  assert.match(C.zstdFrameInfo(frame.subarray(0, frame.length - 2), 0).error, /useknutý/);
  assert.match(C.zstdFrameInfo(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), 0).error, /magic/);
  const reserved = Uint8Array.from(frame);
  reserved[4] |= 0x08;
  assert.match(C.zstdFrameInfo(reserved, 0).error, /rezervovaný/);
  const badBlock = Uint8Array.from(frame);
  badBlock[6] = (badBlock[6] & ~0x06) | 0x06; // typ bloku 3 je rezervovaný
  assert.ok(C.zstdFrameInfo(badBlock, 0).error);
  for (let i = 0; i < 200; i++) {
    const junk = new Uint8Array(prng(i + 1)(40));
    junk.set([0x28, 0xb5, 0x2f, 0xfd], 0);
    const r = C.zstdFrameInfo(junk, 0); // jen nesmí vyhodit výjimku
    assert.ok(r.error || r.length > 0);
  }
});

// ---------------------------------------------------------------- manifest a předmluva
test('manifest: název, soubory i adresáře se přečtou přesně a spotřebují se celé', () => {
  const b = standard(1);
  const m = C.parseManifest(new Uint8Array(b.manifest));
  assert.equal(m.ok, true);
  assert.equal(m.title, TITLE);
  assert.deepEqual(m.entries.map((e) => e.path), ['image.img', `${TITLE}.tac`, '_data/details.aom']);
  assert.ok(m.entries.every((e) => e.timesUnset));
  assert.deepEqual(m.entries.map((e) => e.size), b.recs.map((r) => r.rec.length));
});

test('manifest: useknutý, s nadbytečnými bajty, s nesmyslnou délkou řetězce, s neplatným UTF-8 a příliš velkým číslem se odmítne', () => {
  const m = standard(1).manifest;
  assert.equal(C.parseManifest(new Uint8Array(m.subarray(0, m.length - 3))).ok, false);
  assert.match(C.parseManifest(new Uint8Array(Buffer.concat([m, Buffer.from([0])]))).error, /nespotřeboval/);
  const bigLen = Buffer.concat([u32le(5000), Buffer.alloc(10)]);
  assert.match(C.parseManifest(new Uint8Array(bigLen)).error, /délku/);
  const badUtf = Buffer.concat([u32le(2), Buffer.from([0xc3, 0x28]), u32le(0), u32le(0)]);
  assert.match(C.parseManifest(new Uint8Array(badUtf)).error, /UTF-8/);
  const hugeNumber = Buffer.concat([str('t'), u32le(1), str('a'), str('.x'), Buffer.alloc(8, 0xff), u64le(1), u64le(1), i64le(0), i64le(0), u32le(0)]);
  assert.match(C.parseManifest(new Uint8Array(hugeNumber)).error, /bezpečný rozsah/);
  const tooMany = Buffer.concat([str('t'), u32le(1000)]);
  assert.ok(C.parseManifest(new Uint8Array(tooMany)).error);
  // příliš hluboké zanoření
  let deep = Buffer.concat([u32le(0), u32le(0)]);
  for (let i = 0; i < 8; i++) deep = Buffer.concat([u32le(0), u32le(1), str('d'), deep]);
  assert.match(C.parseManifest(new Uint8Array(Buffer.concat([str('t'), deep]))).error, /zanořený/);
  assert.equal(C.parseManifest(null).ok, false);
});

test('předmluva a patní značka: platný soubor projde, každá chyba má vlastní důvod', () => {
  const b = standard(2);
  const f = new Uint8Array(b.file);
  const sc = C.scan(f);
  assert.equal(sc.ok, true);
  assert.equal(sc.A, b.A);
  assert.equal(sc.B, 17);
  assert.equal(sc.version, 3);
  assert.equal(sc.manifestOffset, b.A + 18);
  assert.match(C.scan(new Uint8Array(0)).errors[0], /prázdný/);
  assert.match(C.scan(new Uint8Array(10)).errors[0], /krátký/);
  assert.match(C.scan(new Uint8Array(100)).errors[0], /Hlavička/);
  assert.match(C.scan(flip(b.file, 3)).errors[0], /Hlavička/);
  const far = Buffer.from(b.file);
  far.writeBigUInt64LE(BigInt(b.file.length + 5), 9);
  assert.match(C.scan(new Uint8Array(far)).errors[0], /mimo soubor/);
  const noFooter = Buffer.from(b.file);
  noFooter[b.A + 9 + 3] ^= 1;
  assert.match(C.scan(new Uint8Array(noFooter)).errors[0], /Patní značka/);
  const noZstd = Buffer.from(b.file);
  noZstd[b.A + 18] ^= 1;
  assert.match(C.scan(new Uint8Array(noZstd)).errors[0], /zstd/);
  assert.match(C.scan('text').errors[0], /binární/);
});

// ---------------------------------------------------------------- čtení: šťastná cesta
test('decode: syntetický export se rozšifruje, rozbalí a všechny kontroly sedí; obsah je stejný jako vstup', async () => {
  const b = standard(5);
  const r = await C.decode(new Uint8Array(b.file), deps);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.title, TITLE);
  assert.equal(r.entries.length, 3);
  for (const e of r.entries) {
    assert.equal(e.ok, true, e.path + ' ' + e.issues.join());
    assert.deepEqual(e.checks, { keyIvFields: true, frameMagic: true, frameExact: true, lengthMatchesManifest: true, checksum: 'ok' });
  }
  const tac = b.recs.find((x) => x.ext === '.tac');
  assert.equal(Buffer.compare(Buffer.from(r.tac), tac.content), 0);
  assert.equal(r.tacHeader.tagOk, true);
  assert.equal(r.tacHeader.titleMatches, true);
  assert.equal(r.tacHeader.constantsHex, '22 00 22 44 00 1b 00 00 00 02');
  assert.equal(r.details.tagOk, true);
  assert.equal(r.details.handlerType, 'TACTICS_TYPE_HANDLER');
  assert.equal(r.details.title, TITLE);
  assert.equal(r.details.authorHandle, 'autor_test');
  assert.deepEqual({ version: r.image.version, hasImage: r.image.hasImage, lengthMatches: r.image.lengthMatches }, { version: 1, hasImage: 1, lengthMatches: true });
  assert.equal(r.image.payloadLength, tinyPng(5, 3).length);
  assert.equal(r.image.width, 5);
  assert.equal(r.image.height, 3);
  assert.ok(r.verified.length >= 2);
  assert.ok(r.unknown.some((x) => /pole taktiky/.test(x)));
});

test('decode: obrázek bez PNG (prázdná hlavička) a rámec bez kontrolního součtu: čte se, ale součet je „absent“', async () => {
  const noPic = await C.decode(new Uint8Array(standard(6, { png: Buffer.alloc(0) }).file), deps);
  assert.equal(noPic.ok, true);
  assert.equal(noPic.image.png, null);
  const noSum = await C.decode(new Uint8Array(standard(6, { noSum: true }).file), deps);
  assert.equal(noSum.ok, true);
  assert.equal(noSum.entries.find((e) => e.ext === '.tac').checks.checksum, 'absent');
  assert.match(noSum.verified.join(' '), /kontrolní součet zstd souhlasí u 2 z nich/);
});

test('decode: větší soubor s víceblokovým rámcem (stovky kilobajtů) a obsah beze změny', async () => {
  const big = tacContent(TITLE, 400000, 9);
  const noise = prng(4)(300000);
  const b = standard(8, { tac: Buffer.concat([big, noise]) });
  const r = await C.decode(new Uint8Array(b.file), deps);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.tac.length, big.length + noise.length);
});

// ---------------------------------------------------------------- čtení: poškození, útoky, hranice
test('decode: pozměněný bajt šifrotextu taktiky se pozná a soubor se nepovažuje za přečtený', async () => {
  const b = standard(5);
  const tac = b.recs.find((x) => x.ext === '.tac');
  const at = 26 + tac.offset + 40 + Math.floor((tac.rec.length - 40) / 2);
  const r = await C.decode(new Uint8Array(flip(b.file, at)), deps);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Taktika \(\.tac\)/);
  assert.equal(r.tac, null);
});

test('decode: pozměněný šifrotext obrázku nezablokuje taktiku, ale je hlášen u obrázku', async () => {
  const b = standard(5);
  const img = b.recs.find((x) => x.ext === '.img');
  const at = 26 + img.offset + 40 + 4;
  const r = await C.decode(new Uint8Array(flip(b.file, at)), deps);
  assert.equal(r.ok, true);
  assert.equal(r.entries.find((e) => e.ext === '.img').ok, false);
  assert.ok(r.issues.some((x) => /image\.img/.test(x)));
  assert.equal(r.image, null);
});

test('decode: kontrolní součet obsahu, který nesedí, je chyba i tehdy, když rozbalovač součet sám neověřuje (vlastní zstd.js ho neověřuje, ověřuje ho tahle čtečka)', async () => {
  const lenient = makeOwn();
  // bez poškození prochází: kontrola součtu sedí
  const okFile = standard(5);
  const ok = await C.decode(new Uint8Array(okFile.file), lenient);
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
  assert.equal(ok.entries.every((e) => e.checks.checksum === 'ok'), true);
  // záznam taktiky s rámcem, kde je před šifrováním změněn poslední bajt součtu
  const key = prng(2)(16);
  const iv = prng(3)(16);
  const frame = Buffer.from(zc(tacContent(TITLE, 3000, 5)));
  frame[frame.length - 1] ^= 0xff;
  const rec = Buffer.concat([u32le(16), u32le(16), key, iv, aesEnc(key, iv, frame)]);
  const tac = okFile.recs.find((x) => x.ext === '.tac');
  assert.equal(rec.length, tac.rec.length); // stejná velikost, takže posuny v manifestu sedí
  const f = Buffer.from(okFile.file);
  rec.copy(f, 26 + tac.offset);
  const bad = await C.decode(new Uint8Array(f), lenient);
  assert.equal(bad.ok, false);
  assert.equal(bad.entries.find((e) => e.ext === '.tac').checks.checksum, 'bad');
  assert.match(bad.reason, /kontrolní součet obsahu nesedí/);
});

test('decode: nesoulad s manifestem (velikost po rozbalení, posun mimo data, malý záznam, chybné délky klíče)', async () => {
  const mk = (mutate) => {
    const s = standard(5);
    mutate(s);
    return s;
  };
  // jiná „třetí“ hodnota
  const wrongThird = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 500, 1), third: 499 }] }, 3);
  const r1 = await C.decode(new Uint8Array(wrongThird.file), deps);
  assert.equal(r1.ok, false);
  assert.match(r1.reason + r1.issues.join(' '), /\.tac/);
  // záznam s délkami klíče ≠ 16
  const s2 = mk(() => {});
  const bad = Buffer.from(s2.file);
  bad.writeUInt32LE(8, 26 + s2.recs[1].offset);
  assert.equal((await C.decode(new Uint8Array(bad), deps)).ok, false);
  // soubor useknutý uprostřed
  assert.equal((await C.decode(new Uint8Array(s2.file.subarray(0, s2.file.length - 40)), deps)).ok, false);
  // bajty navíc za manifestem
  assert.match((await C.decode(new Uint8Array(Buffer.concat([s2.file, Buffer.from([0])])), deps)).reason, /Za manifestem jsou nadbytečné bajty/);
  // žádný .tac
  const noTac = buildFmf({ title: TITLE, resources: [{ dir: '', name: 'image', ext: '.img', content: Buffer.concat([imgHeader]) }] }, 3);
  assert.match((await C.decode(new Uint8Array(noTac.file), deps)).reason, /není zdroj taktiky/);
});

test('decode: „třetí“ hodnota větší než skutečná velikost, posun mimo data a příliš malý záznam se hlásí každý svou chybou', async () => {
  const content = tacContent(TITLE, 800, 2);
  const larger = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content, third: content.length + 10 }] }, 3);
  const r1 = await C.decode(new Uint8Array(larger.file), deps);
  assert.equal(r1.ok, false);
  assert.match(r1.issues.join(' '), /rozbalená velikost \d+ nesedí s manifestem/);
  const beyond = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content, manifestOffset: 5000 }] }, 3);
  const r2 = await C.decode(new Uint8Array(beyond.file), deps);
  assert.equal(r2.ok, false);
  assert.match(r2.issues.join(' '), /leží mimo datovou část nebo je příliš malý/);
  const tiny = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content, manifestSize: 30 }] }, 3);
  const r3 = await C.decode(new Uint8Array(tiny.file), deps);
  assert.equal(r3.ok, false);
  assert.match(r3.issues.join(' '), /leží mimo datovou část nebo je příliš malý/);
  // záznam, který zasahuje přes patní značku
  const over = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content, manifestSize: larger.recs[0].rec.length + 9 }] }, 3);
  assert.equal((await C.decode(new Uint8Array(over.file), deps)).ok, false);
});

test('decode: kontrolní součet manifestu, který nesedí, je chyba i tehdy, když knihovna zstd součet sama neověřuje', async () => {
  const lenient = { ...deps, zstd: (b, max) => { const c = Buffer.from(b); c[4] &= ~0x04; return new Uint8Array(zlib.zstdDecompressSync(c.subarray(0, c.length - 4), { maxOutputLength: max })); } };
  const f = Buffer.from(standard(5).file);
  assert.equal((await C.decode(new Uint8Array(f), lenient)).ok, true);
  f[f.length - 1] ^= 0xff; // poslední bajt souboru je součást kontrolního součtu manifestu
  const r = await C.decode(new Uint8Array(f), lenient);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Kontrolní součet manifestu nesedí/);
});

test('decode: rámec, za kterým v záznamu zbývají bajty, se odmítne (rámec musí vyplnit celý záznam)', async () => {
  const key = prng(2)(16);
  const iv = prng(3)(16);
  const frame = Buffer.concat([zc(tacContent(TITLE, 3000, 5)), Buffer.from([0, 0, 0])]);
  const rec = Buffer.concat([u32le(16), u32le(16), key, iv, aesEnc(key, iv, frame)]);
  // záznam je o tři bajty delší, takže se zapíše znovu celý soubor s upraveným manifestem
  const custom = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 3000, 5) }] }, 3);
  const f = Buffer.concat([custom.file.subarray(0, 26), rec, custom.file.subarray(26 + custom.recs[0].rec.length)]);
  // hlavička i manifest mluví o původní velikosti: soubor se nepřečte (neodpovídá tvar), nikdy se nesmí přečíst „ok“ s oříznutým obsahem
  const r = await C.decode(new Uint8Array(f), deps);
  assert.equal(r.ok, false);
  // totéž přímo přes manifest, který o delším záznamu ví: zapisovač s ručně upravenou velikostí záznamu
  const man = Buffer.from(custom.manifest);
  const sizeAt = man.indexOf(u64le(custom.recs[0].rec.length));
  assert.ok(sizeAt > 0);
  man.writeBigUInt64LE(BigInt(rec.length), sizeAt);
  const A = 26 + rec.length - 9;
  const pre = Buffer.concat([Buffer.from(B.PREAMBLE), u64le(A), u64le(17), Buffer.from([3])]);
  const file = Buffer.concat([pre, rec, Buffer.from(B.FOOTER), zc(man)]);
  const r2 = await C.decode(new Uint8Array(file), deps);
  assert.equal(r2.ok, false);
  assert.match(r2.issues.join(' '), /rámec nevyplňuje celý záznam/);
});

test('decode: manifest slibující obří rozbalenou velikost se odmítne dřív, než se cokoli rozbalí', async () => {
  const bomb = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 500, 1), third: 200 * 1024 * 1024 }] }, 3);
  let called = 0;
  const watch = { ...deps, zstd: (b, max) => { called++; return deps.zstd(b, max); } };
  const r = await C.decode(new Uint8Array(bomb.file), watch);
  assert.equal(r.ok, false);
  assert.equal(called, 1, 'rozbalil se jen manifest');
});

test('decode: výjimka z dodané funkce nevyletí ven a bez funkcí je jasná chyba; nesmysl na vstupu nevadí', async () => {
  const b = standard(5);
  const boom = await C.decode(new Uint8Array(b.file), { zstd: () => { throw new Error('rozbité zstd'); }, aesCtr: deps.aesCtr });
  assert.equal(boom.ok, false);
  assert.match(boom.reason, /rozbité zstd/);
  assert.match((await C.decode(new Uint8Array(b.file), {})).reason, /Chybí funkce/);
  assert.equal((await C.decode(null, deps)).ok, false);
  assert.equal((await C.decode('text', deps)).ok, false);
  assert.equal((await C.decode(new Uint8Array(0), deps)).ok, false);
  const aesBoom = await C.decode(new Uint8Array(b.file), { zstd: deps.zstd, aesCtr: async () => { throw new Error('bez WebCrypto'); } });
  assert.equal(aesBoom.ok, false);
});

test('decode: náhodné poškození souboru nikdy nevyhodí výjimku (500 pokusů) a poškozená taktika není nikdy „ok“ s jiným obsahem', async () => {
  const b = standard(12);
  const rand = prng(99);
  const tac = b.recs.find((x) => x.ext === '.tac');
  for (let i = 0; i < 500; i++) {
    const f = Buffer.from(b.file);
    const n = 1 + (rand(1)[0] % 3);
    for (let k = 0; k < n; k++) {
      const pos = (rand(2).readUInt16LE(0) * 7919) % f.length;
      f[pos] ^= 1 + (rand(1)[0] % 255);
    }
    const r = await C.decode(new Uint8Array(f), deps);
    if (r.ok) assert.equal(Buffer.compare(Buffer.from(r.tac), tac.content), 0, 'úspěch smí mít jen původní obsah');
  }
});

// ---------------------------------------------------------------- tvary obsahu a bezpečná zpráva
test('parseDetails, parseImage a parseTacHeader: čtou jen to, co je vidět, a nic nehádají', () => {
  const d = C.parseDetails(new Uint8Array(aomContent('X', 'a_b')));
  assert.deepEqual(d, { tagOk: true, handlerType: 'TACTICS_TYPE_HANDLER', title: 'X', authorHandle: 'a_b' });
  assert.equal(C.parseDetails(new Uint8Array(Buffer.concat([aomContent('X', 'a_b').subarray(0, 40)]))).authorHandle, null);
  assert.equal(C.parseDetails(new Uint8Array([1, 2, 3])).tagOk, false);
  assert.equal(C.parseDetails(null).tagOk, false);
  // přezdívka s jiným než tisknutelným ASCII se nepřevezme
  const weird = Buffer.concat([aomContent('X', 'a_b').subarray(0, 8 + 4 + 20 + 4 + 1), Buffer.alloc(10), Buffer.alloc(16, 0xff), str('a\u0001b')]);
  assert.equal(C.parseDetails(new Uint8Array(weird)).authorHandle, null);
  const img = C.parseImage(new Uint8Array(imageContent(tinyPng(7, 4))));
  assert.equal(img.width, 7);
  assert.equal(img.lengthMatches, true);
  // hlavička, která slibuje jinou délku dat, než je skutečná, se pozná (obrázek se i tak ukáže podle podpisu PNG)
  const lying = Buffer.from(imageContent(tinyPng(7, 4)));
  lying.writeUInt32LE(5, 6);
  assert.equal(C.parseImage(new Uint8Array(lying)).lengthMatches, false);
  assert.deepEqual(C.parseImage(new Uint8Array(imageContent(Buffer.alloc(0)))).hasImage, 0);

  assert.equal(img.height, 4);
  assert.equal(img.png[0], 0x89);
  assert.equal(C.parseImage(new Uint8Array(imgHeader)).png, null);
  assert.equal(C.parseImage(new Uint8Array(3)).png, null);
  const h = C.parseTacHeader(new Uint8Array(tacContent('N', 50, 1)), 'N');
  assert.deepEqual({ tagOk: h.tagOk, title: h.title, titleMatches: h.titleMatches }, { tagOk: true, title: 'N', titleMatches: true });
  assert.equal(C.parseTacHeader(new Uint8Array(tacContent('N', 50, 1)), 'Jiné').titleMatches, false);
  assert.equal(C.parseTacHeader(new Uint8Array(40), 'N').tagOk, false);
});

test('safeReport: jen velikosti a výsledky kontrol; žádný obsah taktiky, žádný obrázek, žádná přezdívka autora; serializuje se bez BigInt', async () => {
  const r = await C.decode(new Uint8Array(standard(5).file), deps);
  const rep = C.safeReport(r);
  const json = JSON.stringify(rep);
  assert.ok(!json.includes('autor_test'));
  assert.ok(!json.includes('content'));
  assert.equal(rep.ok, true);
  assert.equal(rep.entries.length, 3);
  assert.equal(C.safeReport(null), null);
});

// ---------------------------------------------------------------- doprava: zstd a WebCrypto v prohlížeči
test('decode: rozložení souboru: duplicitní cesta, víc zdrojů taktiky a překryv záznamů se odmítnou; nepokrytá místa, jiný název v taktice a jiná pole předmluvy se jen hlásí a nic se o nich netvrdí', async () => {
  const spec = (resources, title) => ({ title: title || TITLE, resources });
  const tacRes = (name, seed) => ({ dir: '', name, ext: '.tac', content: tacContent(TITLE, 300, seed) });
  const imgRes = { dir: '', name: 'image', ext: '.img', content: imageContent(tinyPng(5, 3)) };
  const read = (file) => C.decode(new Uint8Array(file), deps);
  // vzorový soubor: nic se nehlásí a obě tvrzení o rozložení a o polích předmluvy jsou vypsaná
  const good = await read(buildFmf(spec([tacRes(TITLE, 1), imgRes]), 3).file);
  assert.equal(good.ok, true, JSON.stringify(good.issues));
  assert.deepEqual(good.warnings, []);
  assert.deepEqual(good.layout, { entries: 2, strayBytes: 0, outside: 0, contiguous: true });
  assert.ok(good.verified.some((v) => /pole v předmluvě \(17 a 03\) mají stejné hodnoty jako ve zkoumaných exportech; jejich význam neznáme/.test(v)), good.verified.join('|'));
  assert.ok(good.verified.some((v) => /záznamy beze zbytku vyplňují datovou část, nepřekrývají se a žádná cesta se neopakuje/.test(v)));
  // dvě stejné cesty a víc zdrojů taktiky: nepoznám, který je ten pravý
  const dup = await read(buildFmf(spec([tacRes(TITLE, 1), imgRes, { ...imgRes }]), 3).file);
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /stejnou cestu víckrát/);
  const two = await read(buildFmf(spec([tacRes(TITLE, 1), tacRes('Druhá taktika', 2)]), 4).file);
  assert.equal(two.ok, false);
  assert.match(two.reason, /víc zdrojů taktiky/);
  // překryv: druhý záznam začíná uvnitř prvního
  const ov = await read(buildFmf(spec([tacRes(TITLE, 1), { ...imgRes, manifestOffset: 10 }]), 5).file);
  assert.equal(ov.ok, false);
  assert.match(ov.reason, /se překrývají/);
  // nepokrytá místa: sedm bajtů navíc mezi záznamy; záznamy jsou celé, a tak se soubor čte, ale hlásí se to a tvrzení o beze zbytku chybí
  const b = buildFmf(spec([tacRes(TITLE, 1), { ...imgRes, manifestOffset: 0 }]), 6);
  const [r1] = b.recs;
  const withGap = buildFmf(spec([tacRes(TITLE, 1), { ...imgRes, manifestOffset: r1.rec.length + 7 }]), 6);
  const [g1, g2] = withGap.recs;
  const gapFile = Buffer.concat([Buffer.from(B.PREAMBLE), u64le(26 + g1.rec.length + 7 + g2.rec.length - 9), u64le(17), Buffer.from([3]), g1.rec, Buffer.alloc(7, 0xaa), g2.rec, Buffer.from(B.FOOTER), zc(withGap.manifest)]);
  const gap = await read(gapFile);
  assert.equal(gap.ok, true, JSON.stringify(gap.issues));
  assert.deepEqual(gap.layout, { entries: 2, strayBytes: 7, outside: 0, contiguous: false });
  assert.ok(gap.warnings.some((w) => /^7 bajtů v datové části nepatří žádnému záznamu/.test(w)), gap.warnings.join('|'));
  assert.ok(!gap.verified.some((v) => /beze zbytku/.test(v)));
  // za posledním záznamem zbývají bajty před patní značkou
  const tail = buildFmf(spec([tacRes(TITLE, 1)]), 7);
  const t1 = tail.recs[0];
  const tailFile = Buffer.concat([Buffer.from(B.PREAMBLE), u64le(26 + t1.rec.length + 5 - 9), u64le(17), Buffer.from([3]), t1.rec, Buffer.alloc(5, 0xbb), Buffer.from(B.FOOTER), zc(tail.manifest)]);
  const tl = await read(tailFile);
  assert.equal(tl.ok, true, JSON.stringify(tl.issues));
  assert.equal(tl.layout.strayBytes, 5);
  // název v manifestu se liší od názvu uvnitř taktiky: hlásí se, tvrzení o shodě názvu chybí
  const mis = await read(buildFmf(spec([tacRes(TITLE, 1)], 'Jiný název v manifestu'), 8).file);
  assert.equal(mis.ok, true, JSON.stringify(mis.issues));
  assert.ok(mis.warnings.some((w) => /název taktiky v manifestu se liší od názvu uvnitř payloadu/.test(w)), mis.warnings.join('|'));
  assert.ok(!mis.verified.some((v) => /obsahuje stejný název jako manifest/.test(v)));
  // pole předmluvy s jinými hodnotami než ve zkoumaných exportech: nic se o nich netvrdí a hlásí se to
  const hdr = Buffer.from(buildFmf(spec([tacRes(TITLE, 1)]), 9).file);
  hdr.writeBigUInt64LE(18n, 17);
  hdr[25] = 4;
  const odd = await read(hdr);
  assert.equal(odd.ok, true, JSON.stringify(odd.issues));
  assert.ok(odd.warnings.some((w) => /pole v předmluvě mají jiné hodnoty \(18 a 4\)/.test(w)), odd.warnings.join('|'));
  assert.ok(!odd.verified.some((v) => /stejné hodnoty jako ve zkoumaných exportech/.test(v)));
  // manifest bez kontrolního součtu: řekne se to, netvrdí se, že součet sedí
  const nb = buildFmf(spec([tacRes(TITLE, 1)]), 10);
  const noSumManifest = Buffer.concat([Buffer.from(B.PREAMBLE), u64le(nb.A), u64le(17), Buffer.from([3]), nb.recs[0].rec, Buffer.from(B.FOOTER), B.zcNoSum(nb.manifest)]);
  const ns = await read(noSumManifest);
  assert.equal(ns.ok, true, JSON.stringify(ns.issues));
  assert.ok(ns.verified[0].includes('manifest kontrolní součet nemá (neověřeno)') && !ns.verified[0].includes('kontrolní součet manifestu sedí'), ns.verified[0]);
  assert.ok(good.verified[0].includes('kontrolní součet manifestu sedí'));
  // zpráva o souboru nese rozložení a upozornění, ale žádný obsah
  const rep = C.safeReport(gap);
  assert.deepEqual(rep.layout, { entries: 2, strayBytes: 7, outside: 0, contiguous: false });
  assert.equal(rep.warnings.length, 1);
});

test('decode: záznam zčásti nebo celý mimo datovou část se hlásí (outside) a neprohlásí se za „beze zbytku“; souhrn o součtech počítá jen zdroje, které se ověřily', async () => {
  const tacRes = { dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 300, 1) };
  const imgRes = { dir: '', name: 'image', ext: '.img', content: imageContent(tinyPng(5, 3)) };
  const read = (file) => C.decode(new Uint8Array(file), deps);
  const plain = buildFmf({ title: TITLE, resources: [tacRes, imgRes] }, 3);
  const imgLen = plain.recs[1].rec.length;
  // obrázek je poslední záznam, manifest slibuje o 50 bajtů víc, než datová část má: záznam přesahuje do patní značky (outside 1, mezery žádné)
  const overrun = await read(buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, manifestSize: imgLen + 50 }] }, 3).file);
  assert.equal(overrun.ok, true, JSON.stringify(overrun.issues));
  assert.deepEqual(overrun.layout, { entries: 2, strayBytes: 0, outside: 1, contiguous: false });
  assert.ok(overrun.warnings.some((w) => /^1 záznam z manifestu leží zčásti nebo celý mimo datovou část; takové záznamy se nečtou$/.test(w)), overrun.warnings.join('|'));
  assert.ok(!overrun.verified.some((v) => /beze zbytku/.test(v)), 'tvrzení o beze zbytku musí chybět');
  const img = overrun.entries.find((e) => e.ext === '.img');
  assert.equal(img.ok, false);
  assert.match(img.issues.join(';'), /mimo datovou část/);
  assert.equal(overrun.image, null, 'obrázek z neověřeného záznamu se nepoužije');
  assert.ok(overrun.verified.some((v) => /^1 z 2 zdrojů dešifrováno a rozbaleno, velikosti sedí s manifestem; kontrolní součet zstd souhlasí u 1 z nich/.test(v)), overrun.verified.join('|'));
  // záznam celý za datovou částí (posun za její koncem): totéž, a mezera mezi záznamy se nepočítá dvakrát
  const far = await read(buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, manifestOffset: plain.recs[1].offset + 1000 }] }, 3).file);
  assert.equal(far.ok, true, JSON.stringify(far.issues));
  assert.equal(far.layout.outside, 1);
  assert.equal(far.layout.contiguous, false);
  assert.ok(!far.verified.some((v) => /beze zbytku/.test(v)));
  // skutečné bajty záznamu, na které manifest neukazuje, jsou nepokrytá místa (a nepočítají se dvakrát): ořez na datovou část
  assert.equal(far.layout.strayBytes, Math.min(1000, imgLen));
  assert.ok(far.warnings.some((w) => /^1 záznam z manifestu leží zčásti nebo celý mimo datovou část/.test(w)), far.warnings.join('|'));
  // zpráva o souboru nese tentýž popis rozložení
  assert.deepEqual(C.safeReport(overrun).layout, { entries: 2, strayBytes: 0, outside: 1, contiguous: false });
  // zdroj, který se rozbalil, má správný kontrolní součet, ale jinou velikost, než slibuje manifest: není ověřený, a tak se mezi „souhlasí u N z nich“ nepočítá
  const wrongLen = await read(buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, third: imgRes.content.length + 10 }] }, 3).file);
  assert.equal(wrongLen.ok, true, JSON.stringify(wrongLen.issues));
  const wl = wrongLen.entries.find((e) => e.ext === '.img');
  assert.equal(wl.ok, false);
  assert.equal(wl.checks.checksum, 'ok', 'kontrolní součet sám sedí');
  assert.equal(wl.checks.lengthMatchesManifest, false);
  assert.ok(wrongLen.verified.some((v) => /^1 z 2 zdrojů dešifrováno a rozbaleno, velikosti sedí s manifestem; kontrolní součet zstd souhlasí u 1 z nich/.test(v)), wrongLen.verified.join('|'));
  // vzorový soubor: obě čísla jsou plná
  const good = await read(plain.file);
  assert.ok(good.verified.some((v) => /^2 z 2 zdrojů dešifrováno a rozbaleno, velikosti sedí s manifestem; kontrolní součet zstd souhlasí u 2 z nich/.test(v)), good.verified.join('|'));
});

test('decode: rozložení v datové části: meze o jediný bajt, množná čísla varování, manifest s opačným pořadím záznamů', async () => {
  const tacRes = { dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 300, 1) };
  const imgRes = { dir: '', name: 'image', ext: '.img', content: imageContent(tinyPng(5, 3)) };
  const read = (file) => C.decode(new Uint8Array(file), makeOwn());
  const plain = buildFmf({ title: TITLE, resources: [tacRes, imgRes] }, 3);
  const [tacRec, imgRec] = plain.recs;
  // poslední záznam končí přesně na konci datové části: v pořádku; o jediný bajt dál: mimo
  const exact = await read(buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, manifestSize: imgRec.rec.length }] }, 3).file);
  assert.deepEqual(exact.layout, { entries: 2, strayBytes: 0, outside: 0, contiguous: true });
  const plusOne = await read(buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, manifestSize: imgRec.rec.length + 1 }] }, 3).file);
  assert.deepEqual(plusOne.layout, { entries: 2, strayBytes: 0, outside: 1, contiguous: false });
  // překryv o jediný bajt se odmítne, záznamy těsně vedle sebe ne
  const overlap = await read(buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, manifestOffset: tacRec.rec.length - 1 }] }, 3).file);
  assert.equal(overlap.ok, false);
  assert.match(overlap.reason, /se překrývají/);
  // množná čísla: jeden záznam, dva až čtyři, pět a víc (česky záznam / záznamy / záznamů); záznamy mají v manifestu posun daleko za koncem datové části, každý jinde
  const beyond = (n) => Array.from({ length: n }, (_, k) => ({ dir: '', name: 'x' + k, ext: '.bin', content: Buffer.from('x'), manifestOffset: 100000 + 500 * k, manifestSize: 50 }));
  const warnFor = async (n) => {
    const built = buildFmf({ title: TITLE, resources: [tacRes, imgRes, ...beyond(n)] }, 3);
    const r = await read(built.file);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
    assert.equal(r.layout.outside, n);
    // skutečné záznamy, na které manifest neukazuje, jsou nepokrytá místa; záznamy daleko za koncem k nim nic nepřidávají ani neubírají (ořez na datovou část i u kurzoru)
    assert.equal(r.layout.strayBytes, built.recs.slice(2).reduce((a, x) => a + x.rec.length, 0), 'n = ' + n);
    return r.warnings.filter((w) => /mimo datovou část/.test(w));
  };
  assert.deepEqual(await warnFor(1), ['1 záznam z manifestu leží zčásti nebo celý mimo datovou část; takové záznamy se nečtou']);
  assert.deepEqual(await warnFor(2), ['2 záznamy z manifestu leží zčásti nebo celý mimo datovou část; takové záznamy se nečtou']);
  assert.deepEqual(await warnFor(4), ['4 záznamy z manifestu leží zčásti nebo celý mimo datovou část; takové záznamy se nečtou']);
  assert.deepEqual(await warnFor(5), ['5 záznamů z manifestu leží zčásti nebo celý mimo datovou část; takové záznamy se nečtou']);
  // manifest uvádí záznamy v jiném pořadí, než leží v souboru: dva obrázky si v manifestu vymění posun, velikost i velikost po rozbalení; po seřazení je rozložení souvislé a oba se přečtou
  const imgB = { dir: '', name: 'second', ext: '.img', content: imageContent(tinyPng(7, 4)) };
  const base = buildFmf({ title: TITLE, resources: [tacRes, imgRes, imgB] }, 3);
  const [, a, b] = base.recs;
  const swapped = buildFmf({
    title: TITLE,
    resources: [tacRes, { ...imgRes, manifestOffset: b.offset, manifestSize: b.rec.length, third: imgB.content.length }, { ...imgB, manifestOffset: a.offset, manifestSize: a.rec.length, third: imgRes.content.length }],
  }, 3);
  const sw = await read(swapped.file);
  assert.equal(sw.ok, true, JSON.stringify(sw.issues));
  assert.deepEqual(sw.layout, { entries: 3, strayBytes: 0, outside: 0, contiguous: true });
  assert.ok(sw.entries.every((e) => e.ok), JSON.stringify(sw.entries.map((e) => e.issues)));
});

test('meze kontejneru proti nepřátelskému souboru platí na bajt přesně: soubor 24 MiB, manifest 1 MiB, záznam 16 MiB, součet 32 MiB, 64 souborů v manifestu, 100 000 bloků v rámci', async () => {
  const MiB = 1024 * 1024;
  const read = (file) => C.decode(new Uint8Array(file), makeOwn());
  const tacRes = { dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 300, 1) };
  const imgRes = { dir: '', name: 'image', ext: '.img', content: imageContent(tinyPng(5, 3)) };
  // soubor: nad 24 MiB se odmítne hned (jiný důvod než u souboru přesně 24 MiB, který jen není export)
  assert.match(C.scan(new Uint8Array(24 * MiB + 1)).errors[0], /větší než 24 MiB/);
  assert.doesNotMatch(C.scan(new Uint8Array(24 * MiB)).errors[0], /větší než/);
  // manifest: rámec s obsahem 1 MiB + 1 B se rozbalovači nedá (strop 1 MiB), rámec s obsahem přesně 1 MiB se rozbalí a teprve jeho obsah (samé nuly) není manifest
  const withManifest = (content) => buildFmf({ title: TITLE, resources: [tacRes, imgRes], manifestFrame: zc(content) }, 3).file;
  const bigM = await read(withManifest(Buffer.alloc(MiB + 1)));
  assert.equal(bigM.ok, false);
  assert.match(bigM.reason, /Manifest se nepodařilo rozbalit/);
  const edgeM = await read(withManifest(Buffer.alloc(MiB)));
  assert.equal(edgeM.ok, false);
  assert.doesNotMatch(edgeM.reason, /nepodařilo rozbalit/);
  assert.match(edgeM.reason, /^Manifest: /);
  // záznam: slíbená velikost po rozbalení 16 MiB + 1 B se odmítne před rozbalením, přesně 16 MiB se rozbalovači dá (a teprve skutečná velikost nesedí s manifestem)
  const withThird = (third) => buildFmf({ title: TITLE, resources: [tacRes, { ...imgRes, third }] }, 3).file;
  const bigE = (await read(withThird(16 * MiB + 1))).entries.find((e) => e.ext === '.img');
  assert.match(bigE.issues.join(';'), /by přesáhl povolenou velikost/);
  const edgeE = (await read(withThird(16 * MiB))).entries.find((e) => e.ext === '.img');
  assert.doesNotMatch(edgeE.issues.join(';'), /by přesáhl/);
  assert.match(edgeE.issues.join(';'), /nesedí s manifestem/);
  // součet: dva záznamy po 12 MiB skutečně rozbalené a třetí, který by součet přivedl přes 32 MiB, se před rozbalením odmítne; přesně na 32 MiB ještě ne
  const big12 = (name) => ({ dir: '', name, ext: '.bin', content: Buffer.alloc(12 * MiB) });
  const over = await read(buildFmf({ title: TITLE, resources: [tacRes, big12('a'), big12('b'), { ...imgRes, third: 8 * MiB + 1 }] }, 3).file);
  const [, oa, ob, oc] = over.entries;
  assert.ok(oa.ok && ob.ok, JSON.stringify([oa.issues, ob.issues]));
  assert.match(oc.issues.join(';'), /by přesáhl povolenou velikost/);
  const edge = await read(buildFmf({ title: TITLE, resources: [tacRes, big12('a'), big12('b'), { ...imgRes, third: 8 * MiB - tacRes.content.length }] }, 3).file);
  assert.doesNotMatch(edge.entries[3].issues.join(';'), /by přesáhl/);
  // počet souborů v manifestu: 64 ještě ano, 65 ne
  const many = (n) => buildFmf({ title: TITLE, resources: [tacRes, ...Array.from({ length: n - 1 }, (_, k) => ({ dir: '', name: 'f' + k, ext: '.bin', content: Buffer.from('x') }))] }, 3).file;
  assert.equal((await read(many(64))).entries.length, 64);
  const tooMany = await read(many(65));
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.reason, /příliš mnoho souborů/);
  // bloky v jednom rámci (kontrola rámce před rozbalením): 100 000 ještě ano, 100 001 ne
  const ZB = require('./fixtures/zstd_builders.cjs');
  assert.equal(C.zstdFrameInfo(ZB.emptyBlocksFrame(100000), 0).blocks, 100000);
  assert.match(C.zstdFrameInfo(ZB.emptyBlocksFrame(100001), 0).error, /příliš mnoho bloků/);
});

test('decode: soubor s mnoha záznamy z drahých rámců vadných až na konci se dočte za zlomek času: rozpočet bloků na soubor platí i pro rámce, které selžou', async () => {
  const ZB = require('./fixtures/zstd_builders.cjs');
  // dvanáct záznamů, v každém rámec o 6 000 drahých blocích (každý staví Huffmanův strom a tři tabulky FSE) a vadném posledním bloku; manifest slibuje velký výstup, aby odvozený strop bloků na rámec nezasáhl dřív
  const frame = ZB.heavyFrameBadEnd(6000);
  const resources = Array.from({ length: 12 }, (_, i) => ({ dir: '', name: i === 0 ? TITLE : 'z' + i, ext: i === 0 ? '.tac' : '.img', frame, third: 8000000 }));
  const { file } = buildFmf({ title: TITLE, resources }, 3);
  const mine = { ...deps, zstd: G.makeFrameDecompressor(Z, { maxTotalBlocks: 20000 }) };
  const t0 = Date.now();
  const r = await C.decode(new Uint8Array(file), mine);
  const ms = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.entries.length, 12);
  assert.ok(r.entries.every((e) => !e.ok && e.content === null));
  const why = r.entries.map((e) => e.issues.join(';'));
  // první tři rámce se zpracují celé a selžou na odkazu před začátek výstupu (6 002 bloků každý); čtvrtý narazí na zbytek rozpočtu, ostatní se už nezačnou
  for (let i = 0; i < 3; i++) assert.match(why[i], /rozbalení selhalo: Odkaz vede před začátek výstupu/, 'záznam ' + i);
  assert.match(why[3], /příliš mnoho bloků vzhledem k povolenému výstupu/);
  for (let i = 4; i < 12; i++) assert.match(why[i], /příliš mnoho bloků dohromady/, 'záznam ' + i);
  // bez rozpočtu by to bylo 12 × 6 002 drahých bloků (kolem 3 sekund); s ním nejvýš 20 000 (kolem jedné sekundy); strop je štědrý i pro pomalý stroj
  assert.ok(ms < 5000, 'čtení trvalo ' + ms + ' ms');
  // totéž s výchozím rozpočtem (20 000 bloků) se zastaví po třech záznamech a výsledek je tentýž druh chyby
  const dflt = await C.decode(new Uint8Array(file), { ...deps, zstd: G.makeFrameDecompressor(Z) });
  assert.equal(dflt.ok, false);
  assert.ok(dflt.entries.slice(0, 3).every((e) => /Odkaz vede před začátek výstupu/.test(e.issues.join(';'))));
  assert.match(dflt.entries[3].issues.join(';'), /příliš mnoho bloků vzhledem k povolenému výstupu/);
});

test('decode: soubor se 64 záznamy, z nichž každý vydá skoro 16 MiB a selže až na konci, se dočte za několik sekund: rozpočet výstupu platí i pro rámce, které selžou', async () => {
  const ZB = require('./fixtures/zstd_builders.cjs');
  // jeden rámec má jen asi 1,5 KB a vydá 16 646 190 B ze samých tříbajtových sekvencí; hlavička slibuje o sedm bajtů víc, takže dekodér udělá všechnu práci a selže až na posledním kroku
  const frame = ZB.seqBombFrame(127);
  assert.ok(frame.length < 2000, String(frame.length));
  const resources = Array.from({ length: 64 }, (_, i) => ({ dir: '', name: i === 0 ? TITLE : 'z' + i, ext: i === 0 ? '.tac' : '.img', frame, third: 16 * 1024 * 1024 }));
  const { file } = buildFmf({ title: TITLE, resources }, 3);
  assert.ok(file.length < 200000, 'soubor je drobný: ' + file.length);
  const t0 = Date.now();
  const r = await C.decode(new Uint8Array(file), makeOwn());
  const ms = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.entries.length, 64);
  assert.ok(r.entries.every((e) => !e.ok && e.content === null));
  const why = r.entries.map((e) => e.issues.join(';'));
  // dva rámce se zpracují celé (každý vydá 16,6 MB a selže na nesouladu velikosti), na ostatní už zbývá jen asi 1,3 MB rozpočtu a rámec, který slibuje víc, se odmítne hned po hlavičce
  for (let i = 0; i < 2; i++) assert.match(why[i], /rozbalení selhalo: Rozbalená velikost nesedí s velikostí uvedenou v rámci/, 'záznam ' + i);
  for (let i = 2; i < 64; i++) assert.match(why[i], /Rámec slibuje větší obsah, než je povoleno/, 'záznam ' + i);
  assert.ok(ms < 15000, 'čtení trvalo ' + ms + ' ms (asi 1,3 s; bez rozpočtu výstupu kolem 45 s; mez je štědrá kvůli pomalejším strojům, rozhodují kódy chyb výše)');
  // totéž bez uvedené velikosti obsahu v hlavičce rámce: třetí rámec se zastaví na zbytku rozpočtu (kód limit)
  const noSize = ZB.zframe([{ raw: Buffer.alloc(300, 0x61) }, ...Array.from({ length: 127 }, () => ({ comp: ZB.rleSeqBlock([], { ll: 0, of: 0, ml: 0 }, new Array(43690).fill({ of: 0, ml: 0, ll: 0 })) })), { comp: ZB.rleSeqBlock([], { ll: 0, of: 25, ml: 0 }, [{ of: 0, ml: 0, ll: 0 }]) }]); // poslední blok odkazuje 2^25 B zpět, dál než všechno, co je vydáno
  const r2 = await C.decode(new Uint8Array(buildFmf({ title: TITLE, resources: resources.map((x) => ({ ...x, frame: noSize })) }, 3).file), makeOwn());
  assert.equal(r2.ok, false);
  const why2 = r2.entries.map((e) => e.issues.join(';'));
  for (let i = 0; i < 2; i++) assert.match(why2[i], /Odkaz vede před začátek výstupu/, 'záznam ' + i);
  // na další záznamy zbývá jen zlomek jednoho bloku rozpočtu: každý se zastaví hned na prvním bloku (kód limit) nebo, až se rozpočet vyčerpá, vůbec nezačne
  for (let i = 2; i < 64; i++) assert.match(why2[i], /Rozbalený obsah přesáhl povolenou velikost|příliš mnoho dat dohromady/, 'záznam ' + i);
});

test('makeWebAesCtr: WebCrypto dá stejný výsledek jako node:crypto (včetně přetečení čítače) a bez WebCrypto je jasná chyba', async () => {
  const aes = G.makeWebAesCtr(globalThis.crypto.subtle);
  const rand = prng(21);
  for (const n of [1, 15, 16, 17, 100, 5000]) {
    const key = new Uint8Array(rand(16));
    const iv = new Uint8Array(rand(16));
    const data = new Uint8Array(rand(n));
    assert.deepEqual(await aes(key, iv, data), await deps.aesCtr(key, iv, data), 'délka ' + n);
  }
  // čítač těsně před přetečením spodních 64 bitů: oba používají 128bitové čítání
  const iv = new Uint8Array(16);
  iv.fill(0xff, 8);
  const data = new Uint8Array(rand(64));
  const k2 = new Uint8Array(rand(16));
  assert.deepEqual(await aes(k2, iv, data), await deps.aesCtr(k2, iv, data));
  await assert.rejects(() => G.makeWebAesCtr(null)(new Uint8Array(16), new Uint8Array(16), new Uint8Array(1)), /WebCrypto/);
});

test('makeFrameDecompressor (vlastní zstd.js): rozbalí právě jeden rámec, hlídá limit, odmítne bajty navíc, useknutý i vadný rámec; bez dekodéru chyba', () => {
  const z = G.makeFrameDecompressor(Z);
  const data = Buffer.from('abc'.repeat(1000));
  const frame = new Uint8Array(zc(data));
  assert.deepEqual(Buffer.from(z(frame, 100000)), data);
  assert.throws(() => z(frame, 100), (e) => e.code === 'limit');
  assert.throws(() => z(Uint8Array.from([...frame, 1, 2, 3]), 100000), /bajty navíc/);
  assert.throws(() => z(frame.subarray(0, frame.length - 6), 100000), /useknutý/);
  assert.throws(() => z(new Uint8Array(8), 100000), /magic/);
  assert.throws(() => G.makeFrameDecompressor(null)(new Uint8Array(4), 10), /není k dispozici/);
  assert.throws(() => G.makeFrameDecompressor({})(new Uint8Array(4), 10), /není k dispozici/);
  // vadný nebo chybějící strop = výchozí 16 MiB
  for (const bad of [undefined, 0, -1, NaN, 'x']) assert.deepEqual(Buffer.from(z(frame, bad)), data);
  // nestlačitelná data (víc bloků) a rámec bez uvedené velikosti obsahu
  const noise = prng(5)(300000);
  assert.deepEqual(Buffer.from(z(new Uint8Array(zc(Buffer.from(noise))), 1 << 20)), Buffer.from(noise));
});

test('makeFirstFrameDecompressor (vlastní zstd.js): první rámec od začátku, za ním smí být cokoli; nesmysl a useknutí dá null, příliš velký výstup chybu s kódem limit', () => {
  const d = G.makeFirstFrameDecompressor(Z);
  const one = new Uint8Array(zc(Buffer.from('první rámec '.repeat(30))));
  const two = new Uint8Array(zc(Buffer.from('druhý rámec '.repeat(30))));
  const out = d(Uint8Array.from([...one, ...two, 0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]), 1 << 20);
  assert.equal(Buffer.from(out).toString(), 'první rámec '.repeat(30));
  assert.equal(d(new Uint8Array([9, 9, 9, 9, 9, 9]), 100), null);
  assert.equal(d(one.subarray(0, 20), 1 << 20), null, 'useknutý rámec');
  assert.throws(() => d(one, 100), (e) => e.code === 'limit');
  assert.equal(G.makeFirstFrameDecompressor(null)(one, 100), null);
  assert.equal(G.makeFirstFrameDecompressor({})(one, 100), null);
});

test('decode s vlastním dekodérem zstd: stejný výsledek jako s libzstd (obsah všech zdrojů, název, obrázek, detaily) a pozměněný soubor se odmítne stejně', async () => {
  for (const seed of [1, 2, 5, 9]) {
    const b = standard(seed);
    const viaLib = await C.decode(new Uint8Array(b.file), deps);
    const viaOwn = await C.decode(new Uint8Array(b.file), makeOwn());
    assert.equal(viaOwn.ok, true, JSON.stringify(viaOwn.issues));
    assert.equal(viaOwn.ok, viaLib.ok);
    assert.equal(viaOwn.title, viaLib.title);
    assert.equal(viaOwn.entries.length, viaLib.entries.length);
    viaOwn.entries.forEach((e, i) => {
      assert.equal(e.ok, viaLib.entries[i].ok);
      assert.deepEqual(Buffer.from(e.content), Buffer.from(viaLib.entries[i].content), e.path);
    });
  }
  // každý z prvních 400 bajtů zdroje taktiky pozměněný: výsledek (ok i důvod odmítnutí) je s oběma rozbalovači stejný
  const b = standard(5);
  const tac = b.recs.find((x) => x.ext === '.tac');
  for (let i = 0; i < 400; i += 7) {
    const f = flip(b.file, 26 + tac.offset + 40 + (i % (tac.rec.length - 40)));
    const a = await C.decode(new Uint8Array(f), deps);
    const o = await C.decode(new Uint8Array(f), makeOwn());
    assert.equal(o.ok, a.ok, 'bajt ' + i);
    assert.deepEqual(o.entries.map((e) => e.ok), a.entries.map((e) => e.ok), 'bajt ' + i);
  }
});

// ---------------------------------------------------------------- skutečné soubory (jen když je složka zadaná; do repozitáře nepatří)
test('skutečné exporty z FM27 (FMF_SAMPLES_DIR): všechny zdroje se rozšifrují a rozbalí, velikosti a kontrolní součty sedí', async (t) => {
  const dir = process.env.FMF_SAMPLES_DIR;
  if (!dir) return t.skip('FMF_SAMPLES_DIR není zadaný (skutečné exporty nejsou v repozitáři)');
  assert.ok(existsSync(dir), 'FMF_SAMPLES_DIR je zadaný, ale složka neexistuje');
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fmf'));
  assert.ok(files.length > 0, 've složce nejsou žádné .fmf');
  for (const f of files) {
    const r = await C.decode(new Uint8Array(readFileSync(`${dir}/${f}`)), deps);
    assert.equal(r.ok, true, f + ' ' + JSON.stringify(r.issues));
    // totéž s vlastním dekodérem z aplikace: stejný obsah každého zdroje
    const o = await C.decode(new Uint8Array(readFileSync(`${dir}/${f}`)), makeOwn());
    assert.equal(o.ok, true, f + ' vlastní dekodér: ' + JSON.stringify(o.issues));
    o.entries.forEach((e, i) => assert.deepEqual(Buffer.from(e.content), Buffer.from(r.entries[i].content), f + ' ' + e.path));
    assert.ok(r.entries.every((e) => e.ok && e.checks.checksum === 'ok'), f);
    assert.equal(r.tacHeader.tagOk, true, f);
    assert.equal(r.tacHeader.titleMatches, true, f);
    assert.equal(r.details.tagOk, true, f);
    if (r.image && r.image.png) assert.ok(r.image.width > 0 && r.image.height > 0, f);
  }
});

// ---------------------------------------------------------------- věty pro obrazovku
test('věty pro obrazovku: skloňování počtu, věta o zdroji (s klíčem a IV, neověřený zdroj), věta v rámečku (všechny zdroje jen když se ověřily všechny), upozornění na neověřené a velikost souboru', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 11, 22, 64].map((n) => C.plural(n, 'zdroj', 'zdroje', 'zdrojů')), ['zdrojů', 'zdroj', 'zdroje', 'zdroje', 'zdroje', 'zdrojů', 'zdrojů', 'zdrojů', 'zdrojů']);
  const ok = { ok: true, size: 168, content: new Uint8Array(275), checks: { checksum: 'ok' }, path: 'a.tac' };
  const noSum = { ok: true, size: 23, content: new Uint8Array(10), checks: { checksum: 'absent' }, path: 'b.img' };
  const bad = { ok: false, size: 99, issues: ['kontrolní součet nesedí', 'druhý důvod'], path: 'c<x>.aom' };
  assert.equal(C.entryText(ok), 'záznam 168 B (s klíčem a IV) → 275 B rozbaleno, velikost sedí s manifestem a kontrolní součet obsahu sedí');
  assert.match(C.entryText(noSum), /^záznam 23 B \(s klíčem a IV\) → 10 B rozbaleno, velikost sedí s manifestem, kontrolní součet soubor u tohoto zdroje neuvádí \(neověřeno\)$/);
  assert.equal(C.entryText(bad), 'záznam 99 B (s klíčem a IV) → ? B rozbaleno, NEOVĚŘENO: kontrolní součet nesedí; druhý důvod');
  assert.match(C.entryText({ ok: false, size: 5 }), /NEOVĚŘENO: neznámý důvod$/);
  assert.match(C.entryText(bad, (x, n) => `<${String(x).slice(0, 5)}:${n}>`), /NEOVĚŘENO: <kontr:160>$/, 'text ze souboru prochází čištěním s mezí 160 znaků');
  // rámeček: „u všech zdrojů“ jen bez neověřeného zdroje
  const all = C.readBannerText([ok, noSum]);
  assert.match(all, /^Soubor se rozšifroval a rozbalil v tomhle zařízení \(nic se neposílá na internet ani do AI\)\. U všech zdrojů sedí velikosti s manifestem a kontrolní součty obsahu sedí tam, kde je soubor uvádí\. Jak je uvnitř uložená taktika/);
  const some = C.readBannerText([ok, bad]);
  assert.doesNotMatch(some, /U všech zdrojů/);
  assert.match(some, /U zdrojů, které se podařilo ověřit, sedí velikosti s manifestem a kontrolní součty obsahu tam, kde je soubor uvádí; ostatní jsou níže označené jako neověřené\./);
  // upozornění na neověřené zdroje
  assert.equal(C.badSourcesText([ok, noSum]), null);
  assert.equal(C.badSourcesText([ok, bad]), 'Pozor: jeden zdroj se nepodařilo ověřit (c<x>.aom).');
  const many = (n) => Array.from({ length: n }, (_, i) => ({ ok: false, path: 'z' + i }));
  assert.equal(C.badSourcesText(many(2)), 'Pozor: 2 zdroje se nepodařilo ověřit (z0, z1).');
  assert.match(C.badSourcesText(many(4)), /^Pozor: 4 zdroje se nepodařilo ověřit/);
  assert.match(C.badSourcesText(many(5)), /^Pozor: 5 zdrojů se nepodařilo ověřit/);
  assert.equal(C.badSourcesText([bad], (x, n) => `[${x}|${n}]`), 'Pozor: jeden zdroj se nepodařilo ověřit ([c<x>.aom|60]).');
  // starší kontrola: s důvodem od volajícího a bez něj
  assert.match(C.inspectText('důvod'), /^Z tohoto souboru se tady taktika přečíst nedá \(důvod je níže\)\. Doplň taktiku ručně/);
  assert.match(C.inspectText(''), /^Aplikace zná stavbu jen tří zkoumaných exportů FM27; tenhle soubor jí neodpovídá a jeho vnitřek se nehádá\. Doplň taktiku ručně/);
  assert.match(C.inspectText(undefined), /nehádá\./);
  assert.match(C.NO_WEBCRYPTO_TEXT, /nemá WebCrypto \(dešifrování AES\).*https.*jen kontrola stavby souboru\.$/);
  // velikost souboru vůči stropu: přesně na stropu se čte, o bajt víc ne; věta nese přesná čísla
  const limit = C.LIMITS.maxInput;
  assert.equal(C.sizeProblemText(limit, limit), null);
  assert.equal(C.sizeProblemText(0, limit), null);
  assert.equal(C.sizeProblemText(limit + 1, limit), `Soubor má 25165825 B (asi 24 MiB), víc než 25165824 B (24 MiB), které tahle část aplikace čte, a proto se nenačítá. Taktiku můžeš doplnit ručně.`);
  assert.match(C.sizeProblemText(6 * 1024 * 1024 + 512 * 1024, 5 * 1024 * 1024), /^Soubor má 6815744 B \(asi 6,5 MiB\), víc než 5242880 B \(5 MiB\)/);
  for (const nonsense of [undefined, null, NaN, Infinity, '99999999999', -5]) assert.equal(C.sizeProblemText(nonsense, limit), null, String(nonsense));
  assert.equal(C.sizeProblemText(100, NaN), null);
});

// ---------------------------------------------------------------- zdroj
test('zdroj: čistý modul (žádný DOM, síť, úložiště, náhoda ani čas) a bez neviditelných znaků', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.|window\.|fetch\(|XMLHttpRequest|localStorage|Math\.random|Date\.now|new Date|crypto\.subtle|require\(/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]'));
});
