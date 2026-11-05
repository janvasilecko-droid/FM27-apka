/* FM27 Tactical Coach: dekomprese Zstandard (RFC 8878), vlastní, přísná a s omezenou prací (čistý modul bez DOM a sítě).

   PROČ VLASTNÍ: soubory .fmf z FM27 jsou zabalené do zstd a čte je prohlížeč nepřátelskému souboru napospas. Knihovna třetí strany (fzstd) umí ze 53 bajtů souboru udělat několikaminutové zamrznutí
   stránky (jediný blok s desítkami tisíc sekvencí), z 25 bajtů rámce přidělit gigabajty paměti a vadné rámce nepozná. Tenhle modul proto
   - nepřipouští víc výstupu, než je zadaný strop (kontroluje se před každým zápisem, ne až po bloku),
   - drží každý blok v mezích specifikace (nejvýš 128 KiB výstupu na blok), takže práce na jeden blok je omezená a celková práce je úměrná stropu výstupu,
   - odmítne vadný rámec místo hádání (rezervované bity, neplatné tabulky, nespotřebovaný proud bitů, odkaz za začátek výstupu nebo dál než okno rámce (kód 'window'), okno nad 128 MiB, slovník, který nemáme); u konce proudů bitů je přísnější než libzstd:
     proud literálů musí mít koncovou značku a být spotřebovaný přesně (kód 'litend') a proud sekvencí také (kód 'inexact' zůstalo něco nepřečteno, kód 'overread' bylo čteno za začátek), kdežto libzstd 1.5.7 to podle pozorování
     (zkouška test/zstd.test.mjs s referenčním dekodérem) u čtyřproudých literálů nekontroluje a u sekvencí čtení za konec přijme; platný rámec z libzstd tyhle podmínky vždy splní,
   - nestahuje nic z internetu a funguje i bez připojení.
   Nepodporuje: slovníky, přeskočitelné rámce, více rámců za sebou (volající si hlídá délku rámce sám) a kontrolní součet rámce (ten ověřuje volající: fmfcontainer.js, XXH64).
   Čisté funkce: vstup se nemění, výstup je nová paměť. Chyba je vždy ZstdError (nikdy jiná výjimka z tohoto modulu). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerZstd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAGIC = 0xfd2fb528;
  const BLOCK_MAX = 128 * 1024;
  const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;
  /** Největší okno, které přijmeme: 128 MiB, tedy stejný strop jako výchozí nastavení libzstd (RFC 8878 doporučuje podporu aspoň 8 MiB a dovoluje strop volit). Okno samo paměť nestojí (výstup se skládá do jednoho pole a je omezený zvlášť), jde o shodu s referenčním dekodérem. */
  const MAX_WINDOW = 2 ** 27;
  const MAX_HUF_BITS = 12;

  class ZstdError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ZstdError';
      this.code = code || 'corrupt';
    }
  }
  const fail = (message, code) => {
    throw new ZstdError(message, code);
  };

  // ---------------------------------------------------------------- tabulky z RFC 8878
  const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
  const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const ML_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539];
  const ML_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const LL_DEFAULT = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
  const ML_DEFAULT = [1, 4, 3, 2, 2, 2, 2, 2, 2].concat(new Array(37).fill(1), new Array(7).fill(-1)); // 53 symbolů, součet 64
  const OF_DEFAULT = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];
  const MAX_SYMBOL = { ll: 35, of: 31, ml: 52 };
  const MAX_ACC_LOG = { ll: 9, of: 8, ml: 9 };

  const highbit = (x) => 31 - Math.clz32(x);

  // ---------------------------------------------------------------- čtení bitů
  /** Bity [lo, lo + n) bajtového pole jako číslo (bit 0 je nejnižší bit prvního bajtu), n nejvýš 24. Bajty za koncem pole se berou jako nuly. */
  function bitsAt(b, lo, n) {
    const i = lo >> 3;
    const v = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> (lo & 7);
    return v & ((1 << n) - 1);
  }

  /** Zpětný čtenář bitů: proud je b[start..end), poslední bajt nese koncovou značku (nejvyšší nastavený bit). Čte se od konce k začátku, první přečtený bit je nejvyšší bit výsledku.
      Chybějící značka je chyba s kódem markCode (výchozí 'corrupt'). */
  function backReader(b, start, end, markCode) {
    if (!(end > start)) fail('Proud bitů je prázdný.');
    const last = b[end - 1];
    if (last === 0) fail('Proud bitů nemá koncovou značku.', markCode);
    const base = start * 8;
    const r = {
      pos: (end - 1 - start) * 8 + highbit(last), // zbývá datových bitů (kladné), záporná hodnota = čteno za začátek
      read(n) {
        if (n > 24) {
          const hi = r.read(n - 16);
          return hi * 65536 + r.read(16);
        }
        const lo = r.pos - n;
        r.pos = lo;
        if (lo >= 0) return bitsAt(b, base + lo, n);
        const have = n + lo; // bitů, které ještě v proudu byly
        return have > 0 ? bitsAt(b, base, have) << -lo : 0; // chybějící spodní bity jsou nuly
      },
    };
    return r;
  }

  // ---------------------------------------------------------------- FSE
  /** Přečte popis tabulky FSE (RFC 8878 4.1.1) dopředným čtením bitů z b[start..end). Vrací {counts, accLog, bytes}. */
  function readFseDescription(b, start, end, maxAccLog, maxSymbol) {
    const base = start * 8;
    const endBit = end * 8 - base;
    let bit = 0;
    const take = (n) => {
      if (bit + n > endBit) fail('Popis tabulky FSE je useknutý.');
      const v = bitsAt(b, base + bit, n);
      bit += n;
      return v;
    };
    const accLog = take(4) + 5;
    if (accLog > maxAccLog) fail('Přesnost tabulky FSE je větší, než kolik dovoluje formát.');
    let remaining = (1 << accLog) + 1;
    let threshold = 1 << accLog;
    let nbBits = accLog + 1;
    const counts = [];
    let previousZero = false;
    while (remaining > 1 && counts.length <= maxSymbol) {
      if (previousZero) {
        let r;
        do {
          r = take(2);
          for (let k = 0; k < r; k++) counts.push(0);
          // hlídá se hned, ne až po řadě nul: popis ze samých jedniček by jinak nasypal do pole nul úměrně své délce
          if (counts.length > maxSymbol) fail('Tabulka FSE má víc symbolů, než dovoluje formát.');
        } while (r === 3);
      }
      const max = 2 * threshold - 1 - remaining;
      let count;
      const low = bitsAt(b, base + bit, nbBits - 1) & (threshold - 1);
      if (bit + nbBits - 1 > endBit) fail('Popis tabulky FSE je useknutý.');
      if (low < max) {
        count = low;
        bit += nbBits - 1;
      } else {
        const v = take(nbBits) & (2 * threshold - 1);
        count = v >= threshold ? v - max : v;
      }
      count -= 1;
      remaining -= count < 0 ? -count : count; // zbytek tu nemůže klesnout pod 1: hodnota je nejvýš zbytek (kódování s „max“ to zaručuje)
      counts.push(count);
      previousZero = count === 0;
      while (remaining < threshold) {
        nbBits--;
        threshold >>= 1;
      }
    }
    if (remaining !== 1) fail('Tabulka FSE nemá součet pravděpodobností 1.');
    return { counts, accLog, bytes: (bit + 7) >> 3 };
  }

  /** Dekódovací tabulka FSE z normalizovaných počtů (-1 = pravděpodobnost menší než 1). */
  function buildFse(counts, accLog) {
    const size = 1 << accLog;
    const sym = new Uint8Array(size);
    const nb = new Uint8Array(size);
    const base = new Uint16Array(size);
    const next = new Uint16Array(counts.length);
    let high = size - 1;
    let total = 0;
    for (let s = 0; s < counts.length; s++) {
      const c = counts[s];
      if (c === -1) {
        sym[high--] = s;
        next[s] = 1;
        total += 1;
      } else {
        next[s] = c;
        total += c;
      }
    }
    if (total !== size) fail('Součet pravděpodobností v tabulce FSE nesedí s velikostí tabulky.');
    const step = (size >> 1) + (size >> 3) + 3;
    const mask = size - 1;
    let pos = 0;
    for (let s = 0; s < counts.length; s++) {
      for (let i = 0; i < counts[s]; i++) {
        sym[pos] = s;
        do pos = (pos + step) & mask;
        while (pos > high);
      }
    }
    if (pos !== 0) fail('Tabulku FSE nejde sestavit.');
    for (let u = 0; u < size; u++) {
      const s = sym[u];
      const n = next[s]++;
      const bits = accLog - highbit(n);
      nb[u] = bits;
      base[u] = (n << bits) - size;
    }
    return { sym, nb, base, accLog };
  }

  const rleTable = (symbol) => ({ sym: Uint8Array.of(symbol), nb: Uint8Array.of(0), base: Uint16Array.of(0), accLog: 0 });
  const PREDEFINED = {};
  function predefined(kind) {
    if (!PREDEFINED[kind]) PREDEFINED[kind] = buildFse(kind === 'll' ? LL_DEFAULT : kind === 'ml' ? ML_DEFAULT : OF_DEFAULT, kind === 'of' ? 5 : 6);
    return PREDEFINED[kind];
  }

  // ---------------------------------------------------------------- Huffman
  /** Strom vah Huffmanova kódu (RFC 8878 4.2.1): přímo (4 bity na váhu), nebo komprimovaný FSE se dvěma proloženými stavy. Vrací {table, bytes}. */
  function readHuffmanTree(b, p, end) {
    if (p >= end) fail('Chybí popis Huffmanova stromu.');
    const hdr = b[p];
    const weights = [];
    let bytes;
    if (hdr >= 128) {
      const n = hdr - 127;
      bytes = 1 + ((n + 1) >> 1);
      if (p + bytes > end) fail('Popis Huffmanova stromu je useknutý.');
      for (let i = 0; i < n; i++) {
        const byte = b[p + 1 + (i >> 1)];
        weights.push(i & 1 ? byte & 15 : byte >> 4);
      }
    } else {
      if (hdr === 0 || p + 1 + hdr > end) fail('Popis Huffmanova stromu je vadný nebo useknutý.');
      bytes = 1 + hdr;
      const d = readFseDescription(b, p + 1, p + 1 + hdr, 6, 255);
      const t = buildFse(d.counts, d.accLog);
      const r = backReader(b, p + 1 + d.bytes, p + 1 + hdr);
      let s1 = r.read(d.accLog);
      let s2 = r.read(d.accLog);
      const step = (s) => {
        const v = r.read(t.nb[s]);
        return t.base[s] + v;
      };
      for (;;) {
        if (weights.length > 253) fail('Huffmanův strom má příliš mnoho vah.');
        weights.push(t.sym[s1]);
        s1 = step(s1);
        if (r.pos < 0) {
          weights.push(t.sym[s2]);
          break;
        }
        weights.push(t.sym[s2]);
        s2 = step(s2);
        if (r.pos < 0) {
          weights.push(t.sym[s1]);
          break;
        }
      }
    }
    let sum = 0;
    for (const w of weights) {
      if (w > MAX_HUF_BITS) fail('Váha v Huffmanově stromu je mimo rozsah.');
      if (w > 0) sum += 1 << (w - 1);
    }
    if (sum === 0) fail('Huffmanův strom nemá žádný symbol.');
    const maxBits = highbit(sum) + 1;
    if (maxBits > MAX_HUF_BITS) fail('Huffmanův kód je delší, než dovoluje formát.');
    const rest = (1 << maxBits) - sum;
    if ((rest & (rest - 1)) !== 0) fail('Poslední váha v Huffmanově stromu nejde odvodit.');
    weights.push(highbit(rest) + 1); // nejvýš 256 symbolů: přímý zápis dává nejvýš 128 vah, komprimovaný nejvýš 255 (hlídá smyčka výše)
    // úplný kód má nejdelší kódy (váha 1) vždy aspoň dva; strom s větší tabulkou, než potřebuje, platný zápis není (libzstd ho odmítá). Sudý počet z toho plyne sám: součet vah je mocnina dvou.
    if (!weights.includes(1)) fail('Huffmanův strom nemá nejdelší kódy: tabulka je větší, než strom potřebuje.');
    // tabulka: slabší váhy (delší kódy) jsou na začátku, uvnitř váhy podle symbolu
    const size = 1 << maxBits;
    const sym = new Uint8Array(size);
    const nb = new Uint8Array(size);
    const rankStart = new Array(maxBits + 2).fill(0);
    for (const w of weights) if (w > 0) rankStart[w] += 1 << (w - 1);
    let acc = 0;
    for (let w = 1; w <= maxBits; w++) {
      const c = rankStart[w];
      rankStart[w] = acc;
      acc += c;
    }
    for (let s = 0; s < weights.length; s++) {
      const w = weights[s];
      if (w === 0) continue;
      const len = 1 << (w - 1);
      const at = rankStart[w];
      sym.fill(s, at, at + len);
      nb.fill(maxBits + 1 - w, at, at + len);
      rankStart[w] += len;
    }
    return { table: { sym, nb, maxBits }, bytes };
  }

  /** Rozbalí jeden proud literálů. Proud musí mít koncovou značku a být spotřebovaný přesně do konce, jinak je to chyba s kódem 'litend'. Pozorování na libzstd 1.5.7 (procesor s BMI2): u čtyřproudých literálů
      konec proudu nekontroluje vůbec (ani značku) a po přečtení za konec vrací jiné bity než nuly (pravděpodobně z přetočeného kontejneru; příčina se neověřovala); tohle chování se nedá a nemá napodobovat. */
  function huffStream(b, start, end, count, table, out, at) {
    const r = backReader(b, start, end, 'litend');
    const { sym, nb, maxBits } = table;
    for (let i = 0; i < count; i++) {
      let idx;
      if (r.pos >= maxBits) idx = bitsAt(b, start * 8 + r.pos - maxBits, maxBits);
      else idx = r.pos > 0 ? bitsAt(b, start * 8, r.pos) << (maxBits - r.pos) : 0;
      out[at + i] = sym[idx];
      r.pos -= nb[idx];
    }
    if (r.pos !== 0) fail(r.pos > 0 ? 'Proud literálů není celý spotřebovaný.' : 'Proud literálů je přečtený za svůj začátek.', 'litend');
  }

  // ---------------------------------------------------------------- literály a sekvence
  function decodeLiterals(b, p, end, state, blockMax) {
    if (p >= end) fail('Blok nemá sekci literálů.');
    const b0 = b[p];
    const type = b0 & 3;
    const sf = (b0 >> 2) & 3;
    let regen;
    let comp = 0;
    let hdr;
    let streams = 1;
    if (type <= 1) {
      if (sf === 0 || sf === 2) {
        hdr = 1;
        regen = b0 >> 3;
      } else if (sf === 1) {
        hdr = 2;
        regen = (b0 >> 4) + (b[p + 1] << 4);
      } else {
        hdr = 3;
        regen = (b0 >> 4) + (b[p + 1] << 4) + (b[p + 2] << 12);
      }
    } else if (sf <= 1) {
      hdr = 3;
      streams = sf === 0 ? 1 : 4;
      const v = b0 + (b[p + 1] << 8) + (b[p + 2] << 16);
      regen = (v >> 4) & 0x3ff;
      comp = (v >> 14) & 0x3ff;
    } else if (sf === 2) {
      hdr = 4;
      streams = 4;
      const v = (b0 + (b[p + 1] << 8) + (b[p + 2] << 16) + b[p + 3] * 16777216) >>> 0;
      regen = (v >>> 4) & 0x3fff;
      comp = v >>> 18;
    } else {
      hdr = 5;
      streams = 4;
      const lo = (b0 + (b[p + 1] << 8) + (b[p + 2] << 16) + b[p + 3] * 16777216) >>> 0;
      const hi = b[p + 4];
      regen = (lo >>> 4) & 0x3ffff; // bity 4 až 21
      comp = ((lo >>> 22) + hi * 1024) & 0x3ffff; // bity 22 až 39: deset z lo a osm z hi
    }
    if (p + hdr > end) fail('Hlavička literálů je useknutá.');
    if (regen > blockMax) fail('Literály jsou větší než největší blok.');
    const q = p + hdr;
    if (type === 0) {
      if (q + regen > end) fail('Surové literály jsou useknuté.');
      return { lits: b.subarray(q, q + regen), next: q + regen };
    }
    if (type === 1) {
      if (q + 1 > end) fail('Literály RLE jsou useknuté.');
      return { lits: new Uint8Array(regen).fill(b[q]), next: q + 1 };
    }
    const litEnd = q + comp;
    if (litEnd > end) fail('Komprimované literály jsou useknuté.');
    let s = q;
    if (type === 2) {
      const t = readHuffmanTree(b, q, litEnd);
      state.huf = t.table;
      s += t.bytes;
    } else if (!state.huf) fail('Literály bez stromu se odvolávají na neexistující předchozí strom.');
    const table = state.huf;
    const lits = new Uint8Array(regen);
    if (streams === 1) huffStream(b, s, litEnd, regen, table, lits, 0);
    else {
      if (regen < 6) fail('Čtyři proudy literálů smí mít nejméně šest znaků.'); // pravidlo formátu, které libzstd vynucuje (kratší literály se zapisují jedním proudem)
      if (litEnd - s < 6) fail('Skok mezi proudy literálů je useknutý.');
      const s1 = b[s] + (b[s + 1] << 8);
      const s2 = b[s + 2] + (b[s + 3] << 8);
      const s3 = b[s + 4] + (b[s + 5] << 8);
      const rest = litEnd - (s + 6);
      const s4 = rest - s1 - s2 - s3;
      if (s4 < 1) fail('Proudy literálů se nevejdou do sekce.');
      const seg = (regen + 3) >> 2;
      const last = regen - 3 * seg; // pro regen od 6 výš nikdy záporné
      let at = s + 6;
      huffStream(b, at, at + s1, seg, table, lits, 0);
      at += s1;
      huffStream(b, at, at + s2, seg, table, lits, seg);
      at += s2;
      huffStream(b, at, at + s3, seg, table, lits, 2 * seg);
      at += s3;
      huffStream(b, at, at + s4, last, table, lits, 3 * seg);
    }
    return { lits, next: litEnd };
  }

  function ensure(out, add) {
    const need = out.len + add;
    if (need > out.max) fail('Rozbalený obsah přesáhl povolenou velikost.', 'limit');
    if (need > out.buf.length) {
      const grown = new Uint8Array(Math.min(out.max, Math.max(need, out.buf.length * 2)));
      grown.set(out.buf.subarray(0, out.len));
      out.buf = grown;
    }
  }

  function readTable(kind, mode, b, q, end, state) {
    if (mode === 0) return { table: predefined(kind), q };
    if (mode === 1) {
      if (q >= end) fail('Tabulka RLE je useknutá.');
      if (b[q] > MAX_SYMBOL[kind]) fail('Symbol tabulky RLE je mimo rozsah.');
      return { table: rleTable(b[q]), q: q + 1 };
    }
    if (mode === 2) {
      const d = readFseDescription(b, q, end, MAX_ACC_LOG[kind], MAX_SYMBOL[kind]);
      return { table: buildFse(d.counts, d.accLog), q: q + d.bytes };
    }
    if (!state.tables[kind]) fail('Tabulka se odvolává na předchozí tabulku, která neexistuje.');
    return { table: state.tables[kind], q };
  }

  function execSequences(b, p, end, lits, out, state, blockStart, blockMax, windowSize) {
    let q = p;
    if (q >= end) fail('Chybí sekce sekvencí.');
    let nSeq = b[q++];
    if (nSeq > 127) {
      if (nSeq < 255) {
        if (q >= end) fail('Počet sekvencí je useknutý.');
        nSeq = ((nSeq - 128) << 8) + b[q++];
      } else {
        if (q + 2 > end) fail('Počet sekvencí je useknutý.');
        nSeq = b[q] + (b[q + 1] << 8) + 0x7f00;
        q += 2;
      }
    }
    if (nSeq === 0) {
      if (q !== end) fail('Za prázdnou sekcí sekvencí jsou bajty navíc.');
      ensure(out, lits.length);
      out.buf.set(lits, out.len);
      out.len += lits.length;
      return;
    }
    if (q >= end) fail('Chybí režimy tabulek.');
    const modes = b[q++];
    if (modes & 3) fail('Rezervované bity v režimech tabulek jsou nastavené.');
    const ll = readTable('ll', modes >> 6, b, q, end, state);
    const of = readTable('of', (modes >> 4) & 3, b, ll.q, end, state);
    const ml = readTable('ml', (modes >> 2) & 3, b, of.q, end, state);
    state.tables.ll = ll.table;
    state.tables.of = of.table;
    state.tables.ml = ml.table;
    const T_LL = ll.table;
    const T_OF = of.table;
    const T_ML = ml.table;
    const r = backReader(b, ml.q, end);
    let sLL = r.read(T_LL.accLog);
    let sOF = r.read(T_OF.accLog);
    let sML = r.read(T_ML.accLog);
    let litPos = 0;
    let [rep0, rep1, rep2] = state.rep;
    for (let i = 0; i < nSeq; i++) {
      const ofCode = T_OF.sym[sOF];
      const mlCode = T_ML.sym[sML];
      const llCode = T_LL.sym[sLL];
      const ofValue = ofCode === 0 ? 1 : 2 ** ofCode + r.read(ofCode);
      const matchLen = ML_BASE[mlCode] + r.read(ML_BITS[mlCode]);
      const litLen = LL_BASE[llCode] + r.read(LL_BITS[llCode]);
      let offset;
      if (ofValue > 3) {
        offset = ofValue - 3;
        rep2 = rep1;
        rep1 = rep0;
        rep0 = offset;
      } else {
        const idx = ofValue - 1 + (litLen === 0 ? 1 : 0);
        if (idx === 0) offset = rep0;
        else {
          offset = idx === 1 ? rep1 : idx === 2 ? rep2 : rep0 - 1;
          if (offset < 1) fail('Opakovaný odkaz vede na nulový posun.');
          if (idx !== 1) rep2 = rep1;
          rep1 = rep0;
          rep0 = offset;
        }
      }
      if (litPos + litLen > lits.length) fail('Sekvence čte víc literálů, než blok má.');
      // hlídá se už u každé sekvence, ne až na konci bloku: práce na jeden blok je tak omezená i při velkém stropu výstupu
      if (out.len - blockStart + litLen + matchLen > blockMax) fail('Sekvence by přesáhla největší blok (128 KiB výstupu).');
      ensure(out, litLen + matchLen);
      out.buf.set(lits.subarray(litPos, litPos + litLen), out.len);
      out.len += litLen;
      litPos += litLen;
      if (offset > out.len) fail('Odkaz vede před začátek výstupu.');
      // specifikace zakazuje odkaz dál, než je okno rámce; libzstd ho přijme, když data ještě drží ve vyrovnávací paměti, my ne
      if (offset > windowSize) fail('Odkaz vede dál, než dovoluje okno rámce.', 'window');
      const from = out.len - offset;
      if (offset >= matchLen) out.buf.copyWithin(out.len, from, from + matchLen);
      else for (let k = 0; k < matchLen; k++) out.buf[out.len + k] = out.buf[from + k];
      out.len += matchLen;
      if (i < nSeq - 1) {
        sLL = T_LL.base[sLL] + r.read(T_LL.nb[sLL]);
        sML = T_ML.base[sML] + r.read(T_ML.nb[sML]);
        sOF = T_OF.base[sOF] + r.read(T_OF.nb[sOF]);
      }
    }
    if (r.pos > 0) fail('Proud sekvencí není celý spotřebovaný.', 'inexact');
    // přečtení za začátek proudu libzstd 1.5.7 u sekvencí přijme (pozorováno; výstup pak závisí na bitech, které nejsou nuly); platný rámec to nikdy neudělá
    if (r.pos < 0) fail('Proud sekvencí je přečtený za svůj začátek.', 'overread');
    state.rep = [rep0, rep1, rep2];
    const left = lits.length - litPos;
    if (out.len - blockStart + left > blockMax) fail('Blok by se po doplnění zbylých literálů zvětšil nad největší blok.');
    ensure(out, left);
    out.buf.set(lits.subarray(litPos), out.len);
    out.len += left;
  }

  // ---------------------------------------------------------------- rámec
  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }

  /** Hlavička rámce → {windowSize, contentSize|null, hasChecksum, headerLength}; chyba pro cokoli, co tenhle modul nepodporuje nebo co formát zakazuje. */
  function readFrameHeader(b) {
    if (b.length < 6) fail('Rámec je useknutý (hlavička).');
    const magic = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    if (magic !== MAGIC) fail('Chybí zstd magic.', 'magic');
    const fhd = b[4];
    if (fhd & 0x08) fail('Hlavička rámce má nastavený rezervovaný bit.');
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const hasChecksum = !!((fhd >> 2) & 1);
    const dictSize = [0, 1, 2, 4][fhd & 3];
    let p = 5;
    let windowSize = 0;
    if (!single) {
      if (p >= b.length) fail('Rámec je useknutý (okno).');
      const wd = b[p++];
      const log = 10 + (wd >> 3);
      const base = 2 ** log;
      windowSize = base + (base / 8) * (wd & 7);
    }
    if (p + dictSize > b.length) fail('Rámec je useknutý (slovník).');
    let dictId = 0;
    for (let i = dictSize - 1; i >= 0; i--) dictId = dictId * 256 + b[p + i];
    p += dictSize;
    if (dictId !== 0) fail('Rámec vyžaduje slovník, který nemáme.', 'dictionary');
    const fcsSize = fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    let contentSize = null;
    if (fcsSize) {
      if (p + fcsSize > b.length) fail('Rámec je useknutý (velikost obsahu).');
      contentSize = 0;
      for (let i = fcsSize - 1; i >= 0; i--) contentSize = contentSize * 256 + b[p + i];
      if (fcsFlag === 1) contentSize += 256;
      if (!Number.isSafeInteger(contentSize)) fail('Neplatná velikost obsahu v rámci.');
      p += fcsSize;
    }
    if (single) windowSize = contentSize;
    if (windowSize > MAX_WINDOW) fail('Rámec chce okno větší než povolených 128 MiB.', 'limit');
    return { windowSize, contentSize, hasChecksum, headerLength: p };
  }

  /** decompressFrame(bytes, opts) → {data, length}: rozbalí PRÁVĚ JEDEN rámec od začátku. opts: {maxOutput (výchozí 16 MiB), exact (true = za rámcem nesmí být žádné bajty)}.
      Kontrolní součet rámce se jen přeskočí (ověřuje ho volající). */
  function decompressFrame(input, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const max = Number.isInteger(o.maxOutput) && o.maxOutput > 0 ? o.maxOutput : DEFAULT_MAX_OUTPUT;
    const b = toBytes(input);
    if (!b) fail('Vstup není binární.', 'input');
    const h = readFrameHeader(b);
    if (h.contentSize !== null && h.contentSize > max) fail('Rámec slibuje větší obsah, než je povoleno.', 'limit');
    const blockMax = Math.min(h.windowSize, BLOCK_MAX);
    const out = { buf: new Uint8Array(Math.min(max, h.contentSize !== null ? h.contentSize : 4096, 1 << 20)), len: 0, max };
    const state = { huf: null, tables: { ll: null, of: null, ml: null }, rep: [1, 4, 8] };
    let p = h.headerLength;
    for (let last = false; !last; ) {
      if (p + 3 > b.length) fail('Rámec je useknutý (hlavička bloku).');
      const hdr = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
      p += 3;
      last = !!(hdr & 1);
      const type = (hdr >> 1) & 3;
      const size = hdr >> 3;
      const blockStart = out.len;
      if (type === 3) fail('Neplatný typ bloku zstd.');
      if (type === 1) {
        if (size > blockMax) fail('Blok je větší než největší blok.');
        if (p + 1 > b.length) fail('Rámec je useknutý (blok RLE).');
        ensure(out, size);
        out.buf.fill(b[p], out.len, out.len + size);
        out.len += size;
        p += 1;
      } else {
        if (size > blockMax) fail('Blok je větší než největší blok.');
        if (p + size > b.length) fail('Rámec je useknutý (blok).');
        if (type === 0) {
          ensure(out, size);
          out.buf.set(b.subarray(p, p + size), out.len);
          out.len += size;
        } else {
          const end = p + size;
          const lit = decodeLiterals(b, p, end, state, blockMax);
          execSequences(b, lit.next, end, lit.lits, out, state, blockStart, blockMax, h.windowSize);
        }
        p += size;
      }
    }
    if (h.hasChecksum) {
      if (p + 4 > b.length) fail('Rámec je useknutý (kontrolní součet).');
      p += 4;
    }
    if (h.contentSize !== null && h.contentSize !== out.len) fail('Rozbalená velikost nesedí s velikostí uvedenou v rámci.');
    if (o.exact === true && p !== b.length) fail('Za rámcem jsou bajty navíc.');
    return { data: out.buf.slice(0, out.len), length: p };
  }

  /** decompress(bytes, opts) → Uint8Array. Chyba je vždy ZstdError. */
  function decompress(input, opts) {
    try {
      return decompressFrame(input, opts).data;
    } catch (e) {
      if (e instanceof ZstdError) throw e;
      throw new ZstdError('Rámec zstd se nepodařilo rozbalit: ' + (e && e.message ? e.message : e), 'internal');
    }
  }

  /** Interní funkce zveřejněné jen pro zkoušky (kruhová zkouška popisu tabulky FSE); aplikace je nepoužívá. */
  const internals = Object.freeze({ readFseDescription, buildFse });

  return { ZstdError, internals, LIMITS: Object.freeze({ maxOutput: DEFAULT_MAX_OUTPUT, blockMax: BLOCK_MAX, maxHufBits: MAX_HUF_BITS, maxWindow: MAX_WINDOW }), readFrameHeader, decompressFrame, decompress };
});
