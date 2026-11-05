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
  /** Rámec, který starší kontrola zkouší jako manifest, má mít bloků jen pár (v prozkoumaných exportech jeden); víc kandidátů nesmí zdržet stránku. */
  const FIRST_FRAME_MAX_BLOCKS = 64;
  /** Všechny rámce jednoho souboru dohromady: v prozkoumaných exportech jsou čtyři bloky, takže 40 000 je štědrá mez, která ale zdrží nejvýš o jednotky sekund. */
  const DEFAULT_TOTAL_BLOCKS = 40000;
  const okZstd = (zstd) => !!zstd && typeof zstd.decompressFrame === 'function';
  const limitOf = (maxOut) => (Number.isFinite(maxOut) && maxOut > 0 ? Math.floor(maxOut) : DEFAULT_MAX_OUT);

  /** zstd: modul TrenerZstd (zstd.js). Vrací funkci (bytes, maxBytes) → Uint8Array|null podle kontraktu inspectFmf: rozbalí první rámec od začátku `bytes`
      (za ním smí být cokoli), nejvýš maxBytes výstupu. Neplatný nebo useknutý rámec dá null; rámec, který by měl víc než maxBytes, vyhodí chybu s kódem 'limit',
      aby volající poznal „příliš velký“ (od „nejde rozbalit“). */
  function makeFirstFrameDecompressor(zstd) {
    return function decompress(bytes, maxBytes) {
      if (!okZstd(zstd)) return null;
      try {
        return zstd.decompressFrame(bytes, { maxOutput: limitOf(maxBytes), maxBlocks: FIRST_FRAME_MAX_BLOCKS }).data;
      } catch (e) {
        if (e && e.code === 'limit') throw e;
        return null;
      }
    };
  }

  /** Rozbalí PŘESNĚ jeden zstd rámec (za rámcem nesmí být žádné bajty) a hlídá velikost výstupu a počet bloků:
      funkce (bytes, maxOut) → Uint8Array nebo vyhodí chybu (neplatný nebo useknutý rámec, bajty navíc, výstup větší než maxOut, příliš mnoho bloků). zstd: modul TrenerZstd.
      Každá vytvořená funkce má svůj rozpočet bloků (opts.maxTotalBlocks, výchozí 40 000) pro všechny rámce, které zkusí rozbalit (včetně těch, které selžou), aby soubor s mnoha záznamy z drobných bloků nezdržel stránku. */
  function makeFrameDecompressor(zstd, opts) {
    let budget = opts && Number.isInteger(opts.maxTotalBlocks) && opts.maxTotalBlocks > 0 ? opts.maxTotalBlocks : DEFAULT_TOTAL_BLOCKS;
    return function zstdOne(bytes, maxOut) {
      if (!okZstd(zstd)) throw new Error('Rozbalení zstd není k dispozici.');
      if (budget <= 0) throw new Error('Soubor má příliš mnoho bloků dohromady; další rámce se nerozbalují.');
      let r;
      try {
        r = zstd.decompressFrame(bytes, { maxOutput: limitOf(maxOut), exact: true, maxBlocks: budget });
      } catch (e) {
        // i rámec, který nakonec selže, stál práci: účtuje se, kolik bloků dekodér stihl zpracovat (aspoň jeden), jinak by rozpočet obešel soubor se spoustou rámců vadných až na konci
        budget -= e && Number.isInteger(e.blocks) && e.blocks > 0 ? e.blocks : 1;
        throw e;
      }
      budget -= Number.isInteger(r.blocks) ? r.blocks : 1;
      return r.data;
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
