/* FM27 Tactical Coach: čtečka kontejneru .fmf (čistý modul bez DOM a sítě; rozbalení zstd a dešifrování AES dodává volající).

   FORMÁT (ověřeno na třech skutečných exportech FM27, viz docs/FORMAT_FMF.md; vlastní rozbor, žádný cizí kód):
     soubor   = předmluva[26] | datová část | patní značka[9] | manifest (jeden zstd rámec až do konce souboru)
     předmluva: 02 01 „afe.“ 08 00 00 | u64 A | u64 17 | bajt 03          (A = posun patní značky − 9)
     patní značka: 02 01 „fmf.“ 08 00 00, leží na posunu A + 9; manifest začíná na A + 18
     manifest (little endian): název | adresář (soubory: název, přípona, u64 posun, u64 velikost, u64 „třetí“ = velikost po rozbalení, 2 × i64 čas; podadresáře)
     posun v manifestu je OD BAJTU 26 (konec předmluvy), ne od začátku souboru
     záznam   = u32 16 | u32 16 | klíč[16] | IV[16] | AES-128-CTR šifrotext JEDNOHO zstd rámce (klíč a IV leží v záznamu, žádná derivace, žádný podpis)
     zstd rámec: bez uvedené velikosti obsahu, s kontrolním součtem (spodních 32 bitů XXH64 obsahu), jeden blok
   Co formát NEPOKRÝVÁ: žádný podpis ani MAC, jediná kontrola celistvosti je kontrolní součet zstd (chrání před poškozením, ne před úpravou).
   Obsah taktiky (.tac) je tu jen rozšifrovaný a rozbalený; pole taktiky se čtou jinde (fmftac.js: zatím jen stavba payloadu, ne význam čísel).

   POCTIVOST: co se nepodaří ověřit (délka, kontrolní součet, tvar záznamu), se hlásí. Vada manifestu nebo zdroje taktiky (.tac) znamená, že se soubor nepovažuje za přečtený; vada jiného zdroje
   (obrázek, detaily) a odchylky v rozložení souboru jsou varování a dotčený zdroj se nepoužije. Žádné skryté údaje se neberou.
   Čistá funkce: vstup se nemění. Autorský účet (přezdívka) z detailů je ze souboru a jen se zobrazí; nikdy se neukládá ani neposílá. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerFmfContainer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PREAMBLE = Object.freeze([0x02, 0x01, 0x61, 0x66, 0x65, 0x2e, 0x08, 0x00, 0x00]); // 02 01 "afe." 08 00 00
  const FOOTER = Object.freeze([0x02, 0x01, 0x66, 0x6d, 0x66, 0x2e, 0x08, 0x00, 0x00]); // 02 01 "fmf." 08 00 00
  const ZSTD_MAGIC = Object.freeze([0x28, 0xb5, 0x2f, 0xfd]);
  const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const BASE = 26; // konec předmluvy; od něj se počítají posuny v manifestu
  const LIMITS = Object.freeze({
    maxInput: 24 * 1024 * 1024,
    maxManifest: 1024 * 1024,
    maxEntries: 64,
    maxDepth: 4,
    maxString: 1024,
    maxEntryOut: 16 * 1024 * 1024,
    maxTotalOut: 32 * 1024 * 1024,
  });
  const KNOWN_B = 17; // pole předmluvy „u64 17“ a „bajt 03“ mají ve všech zkoumaných exportech tyhle hodnoty
  const KNOWN_VERSION = 3;
  const UNSET_TIME = '-62135596800'; // 0001-01-01 jako unixové sekundy (v každém zkoumaném záznamu)

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function toBytes(input) {
    if (input === null || input === undefined) return null;
    const tag = Object.prototype.toString.call(input);
    if (tag === '[object Uint8Array]') return input;
    if (tag === '[object ArrayBuffer]') return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }
  const eq = (b, off, pattern) => off >= 0 && off + pattern.length <= b.length && pattern.every((x, i) => b[off + i] === x);
  const u32 = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);
  /** u64 little endian jako číslo; mimo bezpečný rozsah null (takové hodnoty se odmítnou). */
  const u64 = (b, o) => {
    const v = u32(b, o + 4) * 4294967296 + u32(b, o);
    return Number.isSafeInteger(v) ? v : null;
  };
  const hex = (b, from, to) => Array.from(b.subarray(from, to), (x) => x.toString(16).padStart(2, '0')).join(' ');

  // ---------------------------------------------------------------- XXH64 (BigInt), pro kontrolní součet zstd
  const M64 = (1n << 64n) - 1n;
  const P1 = 11400714785074694791n;
  const P2 = 14029467366897019727n;
  const P3 = 1609587929392839161n;
  const P4 = 9650029242287828579n;
  const P5 = 2870177450012600261n;
  const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M64;
  /** XXH64 se seedem 0; vrací BigInt. Zkoušeno proti kontrolním součtům, které píše libzstd. */
  function xxh64(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rd64 = (p) => dv.getBigUint64(p, true);
    const round = (acc, input) => (rotl((acc + input * P2) & M64, 31) * P1) & M64;
    const merge = (acc, val) => ((acc ^ round(0n, val)) * P1 + P4) & M64;
    const n = bytes.length;
    let p = 0;
    let h;
    if (n >= 32) {
      const v = [(P1 + P2) & M64, P2, 0n, (M64 + 1n - P1) & M64];
      for (; p <= n - 32; p += 32) for (let i = 0; i < 4; i++) v[i] = round(v[i], rd64(p + 8 * i));
      h = (rotl(v[0], 1) + rotl(v[1], 7) + rotl(v[2], 12) + rotl(v[3], 18)) & M64;
      for (let i = 0; i < 4; i++) h = merge(h, v[i]);
    } else h = P5;
    h = (h + BigInt(n)) & M64;
    for (; p <= n - 8; p += 8) h = (rotl(h ^ round(0n, rd64(p)), 27) * P1 + P4) & M64;
    if (p <= n - 4) {
      h = (rotl(h ^ ((BigInt(dv.getUint32(p, true)) * P1) & M64), 23) * P2 + P3) & M64;
      p += 4;
    }
    for (; p < n; p++) h = (rotl(h ^ ((BigInt(bytes[p]) * P5) & M64), 11) * P1) & M64;
    h ^= h >> 33n;
    h = (h * P2) & M64;
    h ^= h >> 29n;
    h = (h * P3) & M64;
    h ^= h >> 32n;
    return h;
  }

  // ---------------------------------------------------------------- stavba zstd rámce (RFC 8878), bez rozbalování
  /** zstdFrameInfo(bytes, start) → {length, hasChecksum, contentSize|null, blocks} nebo {error}. Přesná délka rámce se zjistí z hlaviček bloků. */
  function zstdFrameInfo(b, start) {
    const o = start || 0;
    if (!eq(b, o, ZSTD_MAGIC)) return { error: 'Chybí zstd magic.' };
    if (b.length < o + 6) return { error: 'Rámec je useknutý (hlavička).' };
    const fhd = b[o + 4];
    if (fhd & 0x08) return { error: 'Hlavička rámce má nastavený rezervovaný bit.' };
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const hasChecksum = (fhd >> 2) & 1;
    let p = o + 5 + (single ? 0 : 1) + [0, 1, 2, 4][fhd & 3];
    const fcsSize = fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    let contentSize = null;
    if (fcsSize) {
      if (p + fcsSize > b.length) return { error: 'Rámec je useknutý (velikost obsahu).' };
      contentSize = 0;
      for (let i = fcsSize - 1; i >= 0; i--) contentSize = contentSize * 256 + b[p + i];
      if (fcsFlag === 1) contentSize += 256;
      if (!Number.isSafeInteger(contentSize)) return { error: 'Neplatná velikost obsahu v rámci.' };
    }
    p += fcsSize;
    let last = false;
    let blocks = 0;
    while (!last) {
      if (p + 3 > b.length) return { error: 'Rámec je useknutý (hlavička bloku).' };
      const h = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
      last = !!(h & 1);
      const type = (h >> 1) & 3;
      const size = h >> 3;
      p += 3;
      if (type === 3) return { error: 'Neplatný typ bloku zstd.' };
      const body = type === 1 ? 1 : size;
      if (p + body > b.length) return { error: 'Rámec je useknutý (blok).' };
      p += body;
      if (++blocks > 100000) return { error: 'Rámec má příliš mnoho bloků.' };
    }
    if (hasChecksum) {
      if (p + 4 > b.length) return { error: 'Rámec je useknutý (kontrolní součet).' };
      p += 4;
    }
    return { length: p - o, hasChecksum: !!hasChecksum, contentSize, blocks };
  }

  // ---------------------------------------------------------------- předmluva, patní značka, manifest
  /** scan(bytes) → {ok, errors[], A, B, version, manifestOffset}; kontroluje jen to, co se dá poznat bez rozbalování. */
  function scan(input) {
    const bytes = toBytes(input);
    const out = { ok: false, errors: [], size: 0, A: null, B: null, version: null, manifestOffset: null, preambleHex: '', preambleOk: false };
    if (!bytes) {
      out.errors.push('Vstup není binární soubor.');
      return out;
    }
    out.size = bytes.length;
    out.preambleHex = hex(bytes, 0, Math.min(bytes.length, 26));
    if (!bytes.length) out.errors.push('Soubor je prázdný.');
    else if (bytes.length > LIMITS.maxInput) out.errors.push(`Soubor je větší než ${Math.round(LIMITS.maxInput / 1048576)} MiB.`);
    else if (bytes.length < BASE + 9 + 9) out.errors.push('Soubor je příliš krátký.');
    else if (!eq(bytes, 0, PREAMBLE)) out.errors.push('Hlavička není z exportu .fmf, který tahle čtečka zná (02 01 61 66 65 2e 08 00 00).');
    if (out.errors.length) return out;
    out.preambleOk = true;
    const A = u64(bytes, 9);
    out.B = u64(bytes, 17);
    out.version = bytes[25];
    if (A === null || A < 0 || A + 18 >= bytes.length) {
      out.errors.push('Hlavička udává posun patní značky mimo soubor.');
      return out;
    }
    out.A = A;
    if (!eq(bytes, A + 9, FOOTER)) {
      out.errors.push('Patní značka (02 01 66 6d 66 2e 08 00 00) není tam, kam ukazuje hlavička.');
      return out;
    }
    out.manifestOffset = A + 18;
    if (!eq(bytes, out.manifestOffset, ZSTD_MAGIC)) {
      out.errors.push('Za patní značkou nezačíná zstd rámec manifestu.');
      return out;
    }
    out.ok = true;
    return out;
  }

  function utf8(bytes, from, to) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(from, to));
    } catch (e) {
      return null;
    }
  }

  /** parseManifest(bytes) → {ok, title, entries[], error}. Manifest se musí spotřebovat do posledního bajtu. */
  function parseManifest(input) {
    const m = toBytes(input);
    const fail = (error) => ({ ok: false, title: '', entries: [], error });
    if (!m) return fail('Manifest není binární.');
    let p = 0;
    const need = (n) => p + n <= m.length;
    const readU32 = () => {
      if (!need(4)) throw new Error('Manifest je useknutý.');
      const v = u32(m, p);
      p += 4;
      return v;
    };
    const readU64 = () => {
      if (!need(8)) throw new Error('Manifest je useknutý.');
      const v = u64(m, p);
      p += 8;
      if (v === null) throw new Error('Číslo v manifestu je mimo bezpečný rozsah.');
      return v;
    };
    const readI64 = () => {
      if (!need(8)) throw new Error('Manifest je useknutý.');
      const v = new DataView(m.buffer, m.byteOffset + p, 8).getBigInt64(0, true);
      p += 8;
      return v.toString();
    };
    const readStr = () => {
      const n = readU32();
      if (n > LIMITS.maxString || !need(n)) throw new Error('Řetězec v manifestu má neplatnou délku.');
      const s = utf8(m, p, p + n);
      if (s === null) throw new Error('Řetězec v manifestu není platné UTF-8.');
      p += n;
      return s;
    };
    const entries = [];
    const readDir = (dirPath, depth) => {
      if (depth > LIMITS.maxDepth) throw new Error('Manifest je zanořený příliš hluboko.');
      const files = readU32();
      for (let i = 0; i < files; i++) {
        if (entries.length >= LIMITS.maxEntries) throw new Error('Manifest má příliš mnoho souborů.');
        const name = readStr();
        const ext = readStr();
        const offset = readU64();
        const size = readU64();
        const third = readU64();
        const t1 = readI64();
        const t2 = readI64();
        entries.push({ dir: dirPath, name, ext, path: (dirPath ? dirPath + '/' : '') + name + ext, offset, size, third, times: [t1, t2], timesUnset: t1 === UNSET_TIME && t2 === UNSET_TIME });
      }
      const dirs = readU32();
      if (dirs > LIMITS.maxEntries) throw new Error('Manifest má příliš mnoho adresářů.');
      for (let i = 0; i < dirs; i++) {
        const dn = readStr();
        readDir((dirPath ? dirPath + '/' : '') + dn, depth + 1);
      }
    };
    try {
      const title = readStr();
      readDir('', 0);
      if (p !== m.length) return fail(`Manifest se nespotřeboval celý (${p} z ${m.length} bajtů).`);
      return { ok: true, title, entries, error: '' };
    } catch (e) {
      return fail(e && e.message ? e.message : String(e));
    }
  }

  // ---------------------------------------------------------------- obsah zdrojů: tvary, které se čtou jen z viditelných údajů
  /** parseImage(content) → {headerHex, version, hasImage, payloadLength, lengthMatches, png, pngSize, width, height}.
      Obrázek je 10bajtová hlavička (bajt verze, bajt příznaku, u32 nula, u32 délka dat) a volitelná data; PNG se pozná podle podpisu, ne podle příznaku.
      Význam bajtů hlavičky je odvozený ze tří souborů (příznak 0, 0, 1; délka dat u obrázku = délka PNG). */
  function parseImage(content) {
    const c = toBytes(content);
    const out = { headerHex: '', version: null, hasImage: null, payloadLength: null, lengthMatches: null, png: null, pngSize: 0, width: null, height: null };
    if (!c || c.length < 10) return out;
    out.headerHex = hex(c, 0, 10);
    out.version = c[0];
    out.hasImage = c[1];
    out.payloadLength = u32(c, 6);
    out.lengthMatches = out.payloadLength === c.length - 10;
    if (c.length >= 10 + 8 + 25 && eq(c, 10, PNG_SIGNATURE)) {
      out.png = c.subarray(10);
      out.pngSize = out.png.length;
      // IHDR hned za podpisem: délka 13, „IHDR“, šířka a výška jako u32 big endian
      if (out.png[12] === 0x49 && out.png[13] === 0x48 && out.png[14] === 0x44 && out.png[15] === 0x52) {
        const be = (o) => ((out.png[o] << 24) | (out.png[o + 1] << 16) | (out.png[o + 2] << 8) | out.png[o + 3]) >>> 0;
        out.width = be(16);
        out.height = be(20);
      }
    }
    return out;
  }

  /** parseDetails(content) → {tagOk, handlerType, title, authorHandle} podle viditelných řetězců; co nejde přečíst, je null. Přezdívka autora je ze souboru a neověřená. */
  function parseDetails(content) {
    const c = toBytes(content);
    const out = { tagOk: false, handlerType: null, title: null, authorHandle: null };
    if (!c || c.length < 12 || !(c[0] === 0x03 && c[1] === 0x01 && c[2] === 0x6d && c[3] === 0x6f && c[4] === 0x61 && c[5] === 0x2e)) return out; // 03 01 "moa."
    out.tagOk = true;
    let p = 8; // za značku a dvoubajtové pole (04 00)
    const str = () => {
      if (p + 4 > c.length) return null;
      const n = u32(c, p);
      if (n > 256 || p + 4 + n > c.length) return null;
      const s = utf8(c, p + 4, p + 4 + n);
      if (s === null) return null;
      p += 4 + n;
      return s;
    };
    out.handlerType = str();
    out.title = str();
    // za názvem následují nuly a 16 bajtů ff, pak řetězec s účtem autora
    let q = p;
    while (q < c.length && c[q] === 0x00) q++;
    let ff = 0;
    while (q + ff < c.length && c[q + ff] === 0xff) ff++;
    if (ff >= 16) {
      p = q + ff;
      const s = str();
      if (s !== null && /^[\x20-\x7e]{1,64}$/.test(s)) out.authorHandle = s;
    }
    return out;
  }

  /** parseTacHeader(content, title) → {tagOk, constantsHex, title, titleMatches}: hlavička payloadu taktiky: 03 01 „cat.“ + 10 neznámých konstantních bajtů + název. */
  function parseTacHeader(content, expectedTitle) {
    const c = toBytes(content);
    const out = { tagOk: false, constantsHex: '', title: null, titleMatches: null, titleEnd: null };
    if (!c || c.length < 20 || !(c[0] === 0x03 && c[1] === 0x01 && c[2] === 0x63 && c[3] === 0x61 && c[4] === 0x74 && c[5] === 0x2e)) return out; // 03 01 "cat."
    out.tagOk = true;
    out.constantsHex = hex(c, 6, 16);
    const n = u32(c, 16);
    if (n <= LIMITS.maxString && 20 + n <= c.length) {
      const s = utf8(c, 20, 20 + n);
      if (s !== null) {
        out.title = s;
        out.titleEnd = 20 + n;
        if (typeof expectedTitle === 'string') out.titleMatches = s === expectedTitle;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- rozšifrování a rozbalení
  /** decode(bytes, deps) → výsledek čtení kontejneru (nikdy nevyhazuje výjimku).
      deps.zstd(frameBytes, maxOut) → Uint8Array: rozbalí PŘESNĚ jeden zstd rámec (vyhodí chybu, když je neplatný nebo větší než maxOut);
      deps.aesCtr(key16, iv16, data) → Promise<Uint8Array>: AES-128-CTR, IV je celý počáteční čítací blok (128bitové čítání big endian). */
  async function decode(input, deps) {
    const res = {
      ok: false,
      reason: '',
      size: 0,
      header: { A: null, B: null, version: null, preambleOk: false, footerOk: false },
      title: '',
      entries: [],
      tac: null,
      details: null,
      image: null,
      tacHeader: null,
      layout: null,
      issues: [],
      warnings: [],
      verified: [],
      unknown: [
        'význam polí 17 a 03 v předmluvě, značky „afe.“ proti „fmf.“, času v manifestu (vždy 0001-01-01) a deseti konstantních bajtů za značkou „cat.“',
        'pole taktiky uvnitř .tac (formace, role, povinnosti, instrukce, mentalita): zatím nedekódovaná',
      ],
    };
    const fail = (msg) => {
      res.reason = msg;
      res.issues.push(msg);
      return res;
    };
    try {
      const bytes = toBytes(input);
      if (!bytes) return fail('Vstup není binární soubor.');
      res.size = bytes.length;
      if (!isObj(deps) || typeof deps.zstd !== 'function' || typeof deps.aesCtr !== 'function') return fail('Chybí funkce pro rozbalení zstd nebo pro dešifrování AES (deps.zstd, deps.aesCtr).');
      const sc = scan(bytes);
      res.header = { A: sc.A, B: sc.B, version: sc.version, preambleOk: sc.preambleOk, footerOk: sc.ok };
      if (!sc.ok) return fail(sc.errors[0]);
      // manifest: jeden zstd rámec přes celý zbytek souboru
      const mf = zstdFrameInfo(bytes, sc.manifestOffset);
      if (mf.error) return fail('Manifest: ' + mf.error);
      if (mf.length !== bytes.length - sc.manifestOffset) return fail('Za manifestem jsou nadbytečné bajty.');
      let manifestBytes;
      try {
        manifestBytes = deps.zstd(bytes.subarray(sc.manifestOffset), LIMITS.maxManifest);
      } catch (e) {
        return fail('Manifest se nepodařilo rozbalit: ' + (e && e.message ? e.message : e));
      }
      if (mf.hasChecksum && Number(xxh64(manifestBytes) & 0xffffffffn) !== u32(bytes, bytes.length - 4)) return fail('Kontrolní součet manifestu nesedí: soubor je poškozený.');
      const man = parseManifest(manifestBytes);
      if (!man.ok) return fail('Manifest: ' + man.error);
      res.title = man.title;
      res.verified.push('předmluva a patní značka mají očekávanou stavbu a manifest se přečetl celý, do posledního bajtu' + (mf.hasChecksum ? '; kontrolní součet manifestu sedí' : '; manifest kontrolní součet nemá (neověřeno)'));
      // pole předmluvy, jejichž význam neznáme: tvrdit smíme jen shodu hodnot se zkoumanými exporty
      if (sc.B === KNOWN_B && sc.version === KNOWN_VERSION) res.verified.push(`pole v předmluvě (${KNOWN_B} a ${String(KNOWN_VERSION).padStart(2, '0')}) mají stejné hodnoty jako ve zkoumaných exportech; jejich význam neznáme`);
      else res.warnings.push(`pole v předmluvě mají jiné hodnoty (${sc.B} a ${sc.version}) než ve zkoumaných exportech (${KNOWN_B} a ${KNOWN_VERSION}); jejich význam neznáme, takže nevím, co to znamená`);
      const dataEnd = sc.A + 9; // konec datové části = začátek patní značky
      // jednoznačnost: dvě stejné cesty nebo víc zdrojů taktiky by znamenaly, že nepoznám, který je ten pravý
      const seen = new Set();
      for (const e of man.entries) {
        if (seen.has(e.path)) return fail('Manifest uvádí stejnou cestu víckrát; nepoznám, který zdroj je ten pravý.');
        seen.add(e.path);
      }
      if (man.entries.filter((e) => e.ext === '.tac').length > 1) return fail('V souboru je víc zdrojů taktiky (.tac); nepoznám, který je ten pravý.');
      // rozložení záznamů v datové části: překryv je vada, nepokrytá místa a záznamy (zčásti) mimo datovou část se jen hlásí (v prozkoumaných exportech nejsou)
      const sorted = man.entries.slice().sort((a, b) => a.offset - b.offset);
      const dataLen = dataEnd - BASE;
      let cursor = 0;
      let strayBytes = 0;
      let outside = 0;
      for (const e of sorted) {
        if (e.offset < cursor) return fail('Záznamy v datové části se překrývají: soubor je poškozený nebo upravený.');
        strayBytes += Math.min(e.offset, dataLen) - Math.min(cursor, dataLen);
        if (e.offset + e.size > dataLen) outside++;
        cursor = e.offset + e.size;
      }
      strayBytes += Math.max(0, dataLen - cursor);
      res.layout = { entries: man.entries.length, strayBytes, outside, contiguous: strayBytes === 0 && outside === 0 };
      if (strayBytes > 0) res.warnings.push(`${strayBytes} bajtů v datové části nepatří žádnému záznamu z manifestu; nevím, co v nich je, a nečtu je`);
      if (outside > 0) res.warnings.push(`${outside} ${outside === 1 ? 'záznam z manifestu leží' : outside <= 4 ? 'záznamy z manifestu leží' : 'záznamů z manifestu leží'} zčásti nebo celý mimo datovou část; takové záznamy se nečtou`);
      let total = 0;
      for (const e of man.entries) {
        const entry = { path: e.path, dir: e.dir, name: e.name, ext: e.ext, offset: e.offset, size: e.size, third: e.third, ok: false, issues: [], checks: { keyIvFields: false, frameMagic: false, frameExact: false, lengthMatchesManifest: false, checksum: 'absent' }, content: null };
        res.entries.push(entry);
        const start = BASE + e.offset;
        if (start + e.size > dataEnd || e.size < 40 + 6) {
          entry.issues.push('záznam leží mimo datovou část nebo je příliš malý');
          continue;
        }
        const rec = bytes.subarray(start, start + e.size);
        if (u32(rec, 0) !== 16 || u32(rec, 4) !== 16) {
          entry.issues.push('délky klíče a IV nejsou 16');
          continue;
        }
        entry.checks.keyIvFields = true;
        let frame;
        try {
          frame = await deps.aesCtr(rec.subarray(8, 24), rec.subarray(24, 40), rec.subarray(40));
        } catch (err) {
          entry.issues.push('dešifrování selhalo: ' + (err && err.message ? err.message : err));
          continue;
        }
        entry.checks.frameMagic = eq(frame, 0, ZSTD_MAGIC);
        if (!entry.checks.frameMagic) {
          entry.issues.push('po dešifrování nezačíná zstd rámec');
          continue;
        }
        const fi = zstdFrameInfo(frame, 0);
        if (fi.error) {
          entry.issues.push('rámec: ' + fi.error);
          continue;
        }
        entry.checks.frameExact = fi.length === frame.length;
        if (!entry.checks.frameExact) {
          entry.issues.push('rámec nevyplňuje celý záznam');
          continue;
        }
        if (e.third > LIMITS.maxEntryOut || total + e.third > LIMITS.maxTotalOut) {
          entry.issues.push('rozbalený obsah by přesáhl povolenou velikost');
          continue;
        }
        let content;
        try {
          content = deps.zstd(frame, Math.max(e.third, 1));
        } catch (err) {
          entry.issues.push('rozbalení selhalo: ' + (err && err.message ? err.message : err));
          continue;
        }
        total += content.length;
        entry.checks.lengthMatchesManifest = content.length === e.third;
        if (!entry.checks.lengthMatchesManifest) entry.issues.push(`rozbalená velikost ${content.length} nesedí s manifestem (${e.third})`);
        if (fi.hasChecksum) {
          const ok = Number(xxh64(content) & 0xffffffffn) === u32(frame, frame.length - 4);
          entry.checks.checksum = ok ? 'ok' : 'bad';
          if (!ok) entry.issues.push('kontrolní součet obsahu nesedí');
        }
        entry.content = content;
        entry.ok = entry.checks.lengthMatchesManifest && entry.checks.checksum !== 'bad';
      }
      const tacEntry = res.entries.find((x) => x.ext === '.tac');
      if (!tacEntry) return fail('V souboru není zdroj taktiky (.tac).');
      for (const e of res.entries) if (!e.ok) res.issues.push(`${e.path}: ${e.issues.join('; ') || 'neověřeno'}`);
      if (!tacEntry.ok) return fail('Taktika (.tac) se nepodařilo přečíst: ' + tacEntry.issues.join('; '));
      res.tac = tacEntry.content;
      res.tacHeader = parseTacHeader(res.tac, res.title);
      const aom = res.entries.find((x) => x.ext === '.aom' && x.ok);
      if (aom) res.details = parseDetails(aom.content);
      const img = res.entries.find((x) => x.ext === '.img' && x.ok);
      if (img) res.image = parseImage(img.content);
      const okCount = res.entries.filter((x) => x.ok).length;
      const summed = res.entries.filter((x) => x.ok && x.checks.checksum === 'ok').length; // počítají se jen zdroje, které se vůbec ověřily: věta níže je o nich
      res.verified.push(`${okCount} z ${res.entries.length} zdrojů dešifrováno a rozbaleno, velikosti sedí s manifestem; kontrolní součet zstd souhlasí u ${summed} z nich`);
      if (res.tacHeader.tagOk) res.verified.push('payload taktiky začíná značkou „cat.“' + (res.tacHeader.titleMatches ? ' a obsahuje stejný název jako manifest' : ''));
      if (res.tacHeader.tagOk && res.tacHeader.titleMatches === false) res.warnings.push('název taktiky v manifestu se liší od názvu uvnitř payloadu taktiky');
      if (res.layout && res.layout.contiguous) res.verified.push('záznamy beze zbytku vyplňují datovou část, nepřekrývají se a žádná cesta se neopakuje');
      res.ok = true;
      return res;
    } catch (e) {
      return fail('Soubor se nepodařilo přečíst: ' + (e && e.message ? e.message : e));
    }
  }

  /** Bezpečná zpráva o čtení: velikosti, výsledky kontrol a názvy z manifestu (název taktiky, cesty zdrojů); žádný obsah taktiky, žádný obrázek, žádná přezdívka autora. */
  function safeReport(res) {
    if (!isObj(res)) return null;
    return {
      ok: !!res.ok,
      reason: res.reason || '',
      size: res.size,
      title: res.title,
      header: res.header,
      entries: (res.entries || []).map((e) => ({ path: e.path, offset: e.offset, size: e.size, third: e.third, ok: e.ok, checks: e.checks, issues: e.issues })),
      verified: res.verified,
      unknown: res.unknown,
      issues: res.issues,
      warnings: res.warnings || [],
      layout: res.layout || null,
    };
  }

  return { PREAMBLE, FOOTER, BASE, LIMITS, scan, parseManifest, zstdFrameInfo, xxh64, parseImage, parseDetails, parseTacHeader, decode, safeReport };
});
