/* Zapisovač syntetických souborů .fmf podle ověřeného formátu (docs/FORMAT_FMF.md). Slouží zkouškám v jádru i zkoušce v prohlížeči.
   Do repozitáře nepatří žádný skutečný export: všechno tu je vymyšlené (název, přezdívka, obrázek 5 × 3, bajty taktiky).
   Konstanty formátu jsou zapsané znovu, nezávisle na zkoušeném modulu, aby se případná chyba v něm neprojevila v zapisovači. */
'use strict';
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PREAMBLE = [0x02, 0x01, 0x61, 0x66, 0x65, 0x2e, 0x08, 0x00, 0x00];
const FOOTER = [0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00];
const ZP = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1, [zlib.constants.ZSTD_c_contentSizeFlag]: 0 } };
const zc = (buf) => zlib.zstdCompressSync(buf, ZP); // rámec jako v souborech FM27: s kontrolním součtem, bez uvedené velikosti obsahu
const zcNoSum = (buf) => zlib.zstdCompressSync(buf, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 0, [zlib.constants.ZSTD_c_contentSizeFlag]: 0 } });
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64le = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (s) => { const t = Buffer.from(s, 'utf8'); return Buffer.concat([u32le(t.length), t]); };
function prng(seed) {
  let a = seed >>> 0;
  return (n) => {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      out[i] = (t ^ (t >>> 14)) & 255;
    }
    return out;
  };
}
const aesEnc = (key, iv, data) => { const c = crypto.createCipheriv('aes-128-ctr', key, iv); return Buffer.concat([c.update(data), c.final()]); };
const UNSET = -62135596800;

/** spec: {title, resources: [{dir, name, ext, content, noSum?, third?}]}. Vrací {file, recs, manifest, A}. Posuny v manifestu jsou od bajtu 26, A = posun patní značky − 9. */
function buildFmf(spec, seed) {
  const rand = prng(seed || 1);
  const recs = spec.resources.map((r) => {
    const key = rand(16);
    const iv = rand(16);
    const frame = r.frame ? Buffer.from(r.frame) : r.noSum ? zcNoSum(r.content) : zc(r.content); // r.frame: hotový rámec zstd (jen pro zkoušky nepřátelských souborů); pak je potřeba zadat i r.third
    const rec = Buffer.concat([u32le(16), u32le(16), key, iv, aesEnc(key, iv, frame)]);
    return { ...r, rec, key, iv, third: r.third !== undefined ? r.third : r.content.length };
  });
  let off = 0;
  for (const r of recs) {
    r.offset = off;
    off += r.rec.length;
  }
  const entry = (r) => Buffer.concat([str(r.name), str(r.ext), u64le(r.manifestOffset !== undefined ? r.manifestOffset : r.offset), u64le(r.manifestSize !== undefined ? r.manifestSize : r.rec.length), u64le(r.third), i64le(UNSET), i64le(UNSET)]); // manifestOffset a manifestSize jen pro zkoušky vadných manifestů
  const root = recs.filter((r) => !r.dir);
  const dirs = [...new Set(recs.filter((r) => r.dir).map((r) => r.dir))];
  const manifest = Buffer.concat([str(spec.title), u32le(root.length), ...root.map(entry), u32le(dirs.length), ...dirs.map((d) => { const fs = recs.filter((r) => r.dir === d); return Buffer.concat([str(d), u32le(fs.length), ...fs.map(entry), u32le(0)]); })]);
  const A = 26 + off - 9;
  const pre = Buffer.concat([Buffer.from(PREAMBLE), u64le(A), u64le(17), Buffer.from([3])]);
  const file = Buffer.concat([pre, ...recs.map((r) => r.rec), Buffer.from(FOOTER), zc(manifest)]);
  return { file, recs, manifest, A };
}

const pngChunk = (type, data) => {
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([u32be(data.length), t, data, crc]);
};
function tinyPng(w, h) {
  const ihdr = Buffer.concat([u32be(w), u32be(h), Buffer.from([8, 2, 0, 0, 0])]);
  const raw = Buffer.alloc(h * (1 + w * 3));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
const TITLE = 'Testovací taktika';
const tacContent = (title, n, seed) => {
  const head = Buffer.concat([Buffer.from([0x03, 0x01, 0x63, 0x61, 0x74, 0x2e, 0x22, 0x00, 0x22, 0x44, 0x00, 0x1b, 0x00, 0x00, 0x00, 0x02]), str(title)]);
  const body = Buffer.alloc(n);
  const r = prng(seed || 7)(n);
  for (let i = 0; i < n; i += 7) body[i] = r[i] & 0x1f; // převážně nuly jako u skutečných payloadů
  return Buffer.concat([head, body]);
};
const aomContent = (title, handle) => Buffer.concat([Buffer.from([0x03, 0x01, 0x6d, 0x6f, 0x61, 0x2e, 0x04, 0x00]), str('TACTICS_TYPE_HANDLER'), str(title), Buffer.alloc(10), Buffer.alloc(16, 0xff), str(handle), Buffer.from([0x02, 0x00, 0x01, 0x00])]);
const imgHeader = Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xd2, 0x00, 0x01, 0x00]);
/** Obsah zdroje .img jako ve skutečných souborech: bajt verze 1, bajt příznaku, u32 nula, u32 délka dat a data; bez obrázku samé nuly za verzí. */
const imageContent = (png) => (png.length ? Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0]), u32le(png.length), png]) : Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
/** Obvyklý soubor: obrázek (výchozí PNG 5 × 3), taktika, detaily v adresáři _data. */
function standardFmf(seed, opts) {
  const o = opts || {};
  return buildFmf({
    title: TITLE,
    resources: [
      { dir: '', name: 'image', ext: '.img', content: imageContent(o.png === undefined ? tinyPng(5, 3) : o.png) },
      { dir: '', name: TITLE, ext: '.tac', content: o.tac || tacContent(TITLE, 3000, seed), noSum: o.noSum },
      { dir: '_data', name: 'details', ext: '.aom', content: aomContent(TITLE, o.handle || 'autor_test') },
    ],
  }, seed);
}

module.exports = { PREAMBLE, FOOTER, zc, zcNoSum, u32le, u64le, i64le, str, prng, aesEnc, buildFmf, tinyPng, tacContent, aomContent, imgHeader, imageContent, standardFmf, TITLE };
