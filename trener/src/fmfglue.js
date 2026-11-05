/* Lepidlo mezi čtečkami .fmf (fmfcontainer.js, tactics.js: inspectFmf) a vlastním dekodérem zstd (zstd.js).
   Dekodér je součást aplikace: nic se nestahuje z internetu, funguje i bez připojení a rozbalení je omezené (strop výstupu, bloky, okno).
   Tady je jen přesné ohraničení „právě jeden rámec“ a převod chyb na kontrakty čteček: kontejner chce funkci, která rozbalí přesně jeden rámec nebo vyhodí chybu;
   starší kontrola chce první rámec od zadaného místa, nebo null. Kontrolní součet obsahu zstd tu neověřujeme: dělá to fmfcontainer.js (XXH64). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerFmfGlue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_MAX_OUT = 16 * 1024 * 1024;
  const okZstd = (zstd) => !!zstd && typeof zstd.decompressFrame === 'function';
  const limitOf = (maxOut) => (Number.isFinite(maxOut) && maxOut > 0 ? Math.floor(maxOut) : DEFAULT_MAX_OUT);

  /** zstd: modul TrenerZstd (zstd.js). Vrací funkci (bytes, maxBytes) → Uint8Array|null podle kontraktu inspectFmf: rozbalí první rámec od začátku `bytes`
      (za ním smí být cokoli), nejvýš maxBytes výstupu. Neplatný nebo useknutý rámec dá null; rámec, který by měl víc než maxBytes, vyhodí chybu s kódem 'limit',
      aby volající poznal „příliš velký“ (od „nejde rozbalit“). */
  function makeFirstFrameDecompressor(zstd) {
    return function decompress(bytes, maxBytes) {
      if (!okZstd(zstd)) return null;
      try {
        return zstd.decompressFrame(bytes, { maxOutput: limitOf(maxBytes) }).data;
      } catch (e) {
        if (e && e.code === 'limit') throw e;
        return null;
      }
    };
  }

  /** Rozbalí PŘESNĚ jeden zstd rámec (za rámcem nesmí být žádné bajty) a hlídá velikost výstupu:
      funkce (bytes, maxOut) → Uint8Array nebo vyhodí chybu (neplatný nebo useknutý rámec, bajty navíc, výstup větší než maxOut). zstd: modul TrenerZstd. */
  function makeFrameDecompressor(zstd) {
    return function zstdOne(bytes, maxOut) {
      if (!okZstd(zstd)) throw new Error('Rozbalení zstd není k dispozici.');
      return zstd.decompressFrame(bytes, { maxOutput: limitOf(maxOut), exact: true }).data;
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

  return { makeFirstFrameDecompressor, makeFrameDecompressor, makeWebAesCtr };
});
