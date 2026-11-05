/* Rozbalení prvního zstd rámce pro inspektor souborů .fmf (tactics.js: inspectFmf).
   Samotné rozbalení dělá knihovna fzstd (načítá se z jsdelivr až při prvním .fmf); tady je jen přesné ohraničení
   „první rámec“: fzstd rozbaluje všechny rámce za sebou, ale inspektor chce jen ten první (jako Python `decompressobj`).
   Velikost obsahu prvního rámce se přečte z jeho hlavičky. Když ji rámec neuvádí (proudově zapsaný), vrátí se
   všechno rozbalené a inspektor to přijme jen tehdy, když obsah vypadá jako manifest. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerFmfGlue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Velikost obsahu z hlavičky zstd rámce (RFC 8878, 3.1.1.1), nebo null, když není uvedená / hlavička je vadná. */
  function firstFrameContentSize(bytes) {
    if (!bytes || bytes.length < 6) return null;
    if (!(bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd)) return null;
    const fhd = bytes[4];
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const dictSize = [0, 1, 2, 4][fhd & 3];
    let p = 5 + (single ? 0 : 1) + dictSize;
    const fcsSize = fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    if (!fcsSize) return null;
    if (bytes.length < p + fcsSize) return null;
    let v = 0;
    for (let i = fcsSize - 1; i >= 0; i--) v = v * 256 + bytes[p + i];
    if (fcsFlag === 1) v += 256;
    return Number.isSafeInteger(v) ? v : null;
  }

  /** fzstd: {Decompress}. Vrací funkci (bytes, maxBytes) → Uint8Array|null podle kontraktu inspectFmf. */
  function makeFirstFrameDecompressor(fzstd) {
    return function decompress(bytes, maxBytes) {
      if (!fzstd || typeof fzstd.Decompress !== 'function') return null;
      const chunks = [];
      let total = 0;
      try {
        const stream = new fzstd.Decompress((chunk) => {
          chunks.push(chunk);
          total += chunk.length;
        });
        stream.push(bytes, true);
      } catch (e) {
        /* po prvním rámci může následovat něco, co se rozbalit nedá; rozhoduje, co už se rozbalilo */
      }
      if (!total) return null;
      const declared = firstFrameContentSize(bytes);
      const want = Math.min(declared === null ? total : declared, maxBytes || total, total);
      if (declared !== null && total < declared) return null; // rámec se nerozbalil celý
      const out = new Uint8Array(want);
      let o = 0;
      for (const c of chunks) {
        const n = Math.min(c.length, want - o);
        out.set(c.subarray(0, n), o);
        o += n;
        if (o >= want) break;
      }
      return out;
    };
  }

  /** Rozbalí PŘESNĚ jeden zstd rámec (rámce v .fmf nemají uvedenou velikost obsahu, proto proudově) a hlídá velikost výstupu:
      funkce (bytes, maxOut) → Uint8Array nebo vyhodí chybu (neplatný rámec, rámec nedoběhl, výstup větší než maxOut). fzstd: {Decompress}. */
  function makeFrameDecompressor(fzstd) {
    return function zstd(bytes, maxOut) {
      if (!fzstd || typeof fzstd.Decompress !== 'function') throw new Error('Knihovna zstd není k dispozici.');
      const limit = Number.isFinite(maxOut) && maxOut > 0 ? maxOut : 16 * 1024 * 1024;
      const chunks = [];
      let total = 0;
      const stream = new fzstd.Decompress((chunk) => {
        total += chunk.length;
        if (total > limit) throw new Error('Rozbalený obsah přesáhl povolenou velikost.');
        chunks.push(chunk);
      });
      stream.push(bytes, true);
      const out = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    };
  }

  /** AES-128-CTR přes WebCrypto (subtle = crypto.subtle): IV je celý počáteční čítací blok, čítání 128 bitů big endian. */
  function makeWebAesCtr(subtle) {
    return async function aesCtr(key, iv, data) {
      if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.decrypt !== 'function') throw new Error('Prohlížeč nemá WebCrypto (AES-CTR). Soubor .fmf jde přečíst jen na stránce se zabezpečeným spojením (https).');
      const k = await subtle.importKey('raw', key, { name: 'AES-CTR' }, false, ['decrypt']);
      return new Uint8Array(await subtle.decrypt({ name: 'AES-CTR', counter: iv, length: 128 }, k, data));
    };
  }

  return { firstFrameContentSize, makeFirstFrameDecompressor, makeFrameDecompressor, makeWebAesCtr };
});
