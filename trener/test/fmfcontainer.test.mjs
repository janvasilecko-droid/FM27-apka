import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const C = require('../src/fmfcontainer.js');
const G = require('../src/fmfglue.js');
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

test('decode: kontrolní součet obsahu, který nesedí, je chyba i tehdy, když knihovna zstd součet sama neověřuje (jako fzstd)', async () => {
  // knihovna, která součet přeskočí: smaže příznak součtu a odřízne poslední čtyři bajty, výsledek je obsah jako u libzstd
  const lenient = { ...deps, zstd: (b, max) => { const c = Buffer.from(b); c[4] &= ~0x04; return new Uint8Array(zlib.zstdDecompressSync(c.subarray(0, c.length - 4), { maxOutputLength: max })); } };
  // bez poškození prochází i s takovou knihovnou: naše vlastní kontrola součtu sedí
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
  const base = standard(5);
  const tac = base.recs.find((x) => x.ext === '.tac');
  const key = prng(2)(16);
  const iv = prng(3)(16);
  const frame = Buffer.concat([zc(tacContent(TITLE, 3000, 5)), Buffer.from([0, 0, 0])]);
  const rec = Buffer.concat([u32le(16), u32le(16), key, iv, aesEnc(key, iv, frame)]);
  // záznam je o tři bajty delší, takže se zapíše znovu celý soubor s upraveným manifestem
  const custom = buildFmf({ title: TITLE, resources: [{ dir: '', name: TITLE, ext: '.tac', content: tacContent(TITLE, 3000, 5) }] }, 3);
  const f = Buffer.concat([custom.file.subarray(0, 26), rec, custom.file.subarray(26 + custom.recs[0].rec.length)]);
  void tac;
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

test('makeFrameDecompressor: rozbalí jeden rámec, hlídá limit a hlásí chybu knihovny', () => {
  // zástupná knihovna s tvarem fzstd, postavená na libzstd
  const fake = { Decompress: class { constructor(cb) { this.cb = cb; } push(bytes) { this.cb(new Uint8Array(zlib.zstdDecompressSync(bytes)), true); } } };
  const z = G.makeFrameDecompressor(fake);
  const data = Buffer.from('abc'.repeat(1000));
  assert.deepEqual(Buffer.from(z(new Uint8Array(zc(data)), 100000)), data);
  assert.throws(() => z(new Uint8Array(zc(data)), 100), /povolenou velikost/);
  assert.throws(() => G.makeFrameDecompressor(null)(new Uint8Array(4), 10), /není k dispozici/);
  // rozdělený výstup do více kusů
  const chunky = { Decompress: class { constructor(cb) { this.cb = cb; } push(bytes) { const out = zlib.zstdDecompressSync(bytes); for (let i = 0; i < out.length; i += 700) this.cb(new Uint8Array(out.subarray(i, i + 700)), i + 700 >= out.length); } } };
  assert.deepEqual(Buffer.from(G.makeFrameDecompressor(chunky)(new Uint8Array(zc(data)), 100000)), data);
});

test('skutečná knihovna fzstd (když je k dispozici) rozbalí stejně jako libzstd včetně rámců bez uvedené velikosti', () => {
  const dir = process.env.FZSTD_DIR;
  const p = dir ? `${dir}/fzstd/umd/index.js` : null;
  if (!p || !existsSync(p)) return; // v běžné zkoušce chybí: ověřuje se ve zkoušce v prohlížeči
  const fz = require(p);
  const z = G.makeFrameDecompressor(fz);
  const data = prng(5)(50000);
  for (const buf of [Buffer.from('xyz'.repeat(3000)), Buffer.from(data)]) assert.deepEqual(Buffer.from(z(new Uint8Array(zc(buf)), 1 << 20)), buf);
});

// ---------------------------------------------------------------- skutečné soubory (jen když je složka zadaná; do repozitáře nepatří)
test('skutečné exporty z FM27 (FMF_SAMPLES_DIR): všechny zdroje se rozšifrují a rozbalí, velikosti a kontrolní součty sedí', async () => {
  const dir = process.env.FMF_SAMPLES_DIR;
  if (!dir || !existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fmf'));
  assert.ok(files.length > 0, 've složce nejsou žádné .fmf');
  for (const f of files) {
    const r = await C.decode(new Uint8Array(readFileSync(`${dir}/${f}`)), deps);
    assert.equal(r.ok, true, f + ' ' + JSON.stringify(r.issues));
    assert.ok(r.entries.every((e) => e.ok && e.checks.checksum === 'ok'), f);
    assert.equal(r.tacHeader.tagOk, true, f);
    assert.equal(r.tacHeader.titleMatches, true, f);
    assert.equal(r.details.tagOk, true, f);
    if (r.image && r.image.png) assert.ok(r.image.width > 0 && r.image.height > 0, f);
  }
});

// ---------------------------------------------------------------- zdroj
test('zdroj: čistý modul (žádný DOM, síť, úložiště, náhoda ani čas) a bez neviditelných znaků', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.|window\.|fetch\(|XMLHttpRequest|localStorage|Math\.random|Date\.now|new Date|crypto\.subtle|require\(/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]'));
});
