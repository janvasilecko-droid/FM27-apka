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
  /** Všechny rámce jednoho souboru dohromady, včetně těch, které selžou: v prozkoumaných exportech jsou čtyři bloky, takže 20 000 je štědrá mez (stavba tabulek v bloku stojí kolem 45 µs, tedy kolem 0,9 s). */
  const DEFAULT_TOTAL_BLOCKS = 20000;
  /** Výstup všech rámců jednoho souboru dohromady, včetně pokusů, které selžou: manifest do 1 MiB a záznamy do 32 MiB (strop kontejneru). Bez toho by 64 záznamů, z nichž každý vydá 16 MiB a selže až na
      konci, zdrželo čtení o desítky sekund (výstup stojí kolem 43 ns na bajt, tedy kolem 1,4 s na celý rozpočet). */
  const DEFAULT_TOTAL_OUTPUT = 33 * 1024 * 1024;
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
      funkce (bytes, maxOut) → Uint8Array nebo vyhodí chybu (neplatný nebo useknutý rámec, bajty navíc, výstup větší než maxOut, příliš mnoho bloků nebo dat dohromady). zstd: modul TrenerZstd.
      Každá vytvořená funkce má svůj rozpočet pro všechny rámce, které zkusí rozbalit, včetně těch, které selžou: bloky (opts.maxTotalBlocks, výchozí 20 000) a vydané bajty (opts.maxTotalOutput, výchozí 33 MiB).
      Právě práce za rámce, které selžou až na konci, je to, čím by jinak soubor s mnoha záznamy zdržel stránku. Zbytek rozpočtu výstupu se dekodéru předává jako strop, takže poslední rámec se zastaví na zbytku. */
  function makeFrameDecompressor(zstd, opts) {
    const num = (v, dflt) => (Number.isInteger(v) && v > 0 ? v : dflt);
    let blockBudget = num(opts && opts.maxTotalBlocks, DEFAULT_TOTAL_BLOCKS);
    let outputBudget = num(opts && opts.maxTotalOutput, DEFAULT_TOTAL_OUTPUT);
    const count = (n, fallback) => (Number.isInteger(n) && n > 0 ? n : fallback);
    return function zstdOne(bytes, maxOut) {
      if (!okZstd(zstd)) throw new Error('Rozbalení zstd není k dispozici.');
      if (blockBudget <= 0) throw new Error('Soubor má příliš mnoho bloků dohromady; další rámce se nerozbalují.');
      if (outputBudget <= 0) throw new Error('Soubor vydal při rozbalování příliš mnoho dat dohromady; další rámce se nerozbalují.');
      let r;
      try {
        r = zstd.decompressFrame(bytes, { maxOutput: Math.min(limitOf(maxOut), outputBudget), exact: true, maxBlocks: blockBudget });
      } catch (e) {
        // i rámec, který nakonec selže, stál práci: účtuje se, kolik bloků dekodér stihl zpracovat (aspoň jeden) a kolik bajtů vydal; jinak by rozpočet obešel soubor se spoustou rámců vadných až na konci
        blockBudget -= count(e && e.blocks, 1);
        outputBudget -= count(e && e.produced, 0);
        throw e;
      }
      blockBudget -= count(r.blocks, 1);
      outputBudget -= r.data ? r.data.length : 0;
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
