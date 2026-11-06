/* Stavitelé ručně sestavených rámců zstd pro zkoušky (zstd.test.mjs, fmfglue.test.mjs, fmfcontainer.test.mjs).
   Všechno je zapsané zvlášť od zkoušeného dekodéru (src/zstd.js), podle RFC 8878, takže chyba v dekodéru se nepřenese do zapisovače; správnost rozhoduje libzstd (viz zstd_oracle.py).
   Nic tu není z cizího souboru: bajty jsou vymyšlené. */
'use strict';

const u16 = (n) => [n & 255, (n >> 8) & 255];
const u24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const MAGIC_BYTES = [0x28, 0xb5, 0x2f, 0xfd];

/** Strom v přímém zápisu: hlavička 127 + n a váhy po čtyřech bitech (první váha je vyšší půlbajt); poslední váhu dopočítává dekodér. */
const directTree = (explicit) => {
  const bytes = [127 + explicit.length];
  for (let i = 0; i < explicit.length; i += 2) bytes.push((explicit[i] << 4) | (explicit[i + 1] || 0));
  return bytes;
};

/** Kódy symbolů podle pravidla formátu: slabší váhy (delší kódy) první, uvnitř váhy podle symbolu, váha w zabere 2^(w-1) položek tabulky o 2^maxBits položkách. weights jsou všechny váhy včetně dopočtené. */
function huffCodes(weights) {
  let sum = 0;
  for (const w of weights) if (w) sum += 2 ** (w - 1);
  const maxBits = 31 - Math.clz32(sum);
  const codes = {};
  let start = 0;
  weights.map((w, sym) => [w, sym]).filter(([w]) => w > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(([w, sym]) => {
    codes[sym] = { code: start >> (w - 1), len: maxBits + 1 - w };
    start += 2 ** (w - 1);
  });
  return codes;
}

/** Jeden proud: kódy v pořadí čtení (nejvyšší bit kódu první), proud se zapisuje odzadu a za nejnižší použitý bit přijde koncová značka. */
function huffStreamBytes(codes, syms) {
  let bits = '';
  for (const s of syms) bits += codes[s].code.toString(2).padStart(codes[s].len, '0');
  return bitStream(bits);
}

/** Proud bitů z řetězce '0'/'1' v pořadí čtení (první přečtený bit první): zapisuje se odzadu a za nejnižší použitý bit přijde koncová značka. */
function bitStream(bits) {
  const M = bits.length;
  const out = new Array((M >> 3) + 1).fill(0);
  for (let k = 0; k < M; k++) if (bits[M - 1 - k] === '1') out[k >> 3] |= 1 << (k & 7);
  out[M >> 3] |= 1 << (M & 7);
  return out;
}

/** Rámec s jedním blokem: komprimované literály (jeden nebo čtyři proudy, bez sekvencí). Okno 64 KiB. */
function literalsFrame(tree, streams, regen) {
  const four = streams.length === 4;
  const jump = four ? [...u16(streams[0].length), ...u16(streams[1].length), ...u16(streams[2].length)] : [];
  const body = [...tree, ...jump, ...streams.flat()];
  const v = 2 | ((four ? 1 : 0) << 2) | (regen << 4) | (body.length << 14);
  const block = [...u24(v), ...body, 0x00];
  return Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x30, ...u24((block.length << 3) | (2 << 1) | 1), ...block]);
}

const splitFour = (syms) => {
  const seg = (syms.length + 3) >> 2;
  return [syms.slice(0, seg), syms.slice(seg, 2 * seg), syms.slice(2 * seg, 3 * seg), syms.slice(3 * seg)];
};

const bin = (v, n) => (n === 0 ? '' : v.toString(2).padStart(n, '0'));
const blockHeader = (size, type, last) => u24((size << 3) | (type << 1) | (last ? 1 : 0));

/** Rámec ze seznamu bloků {raw: bajty} | {rle: [bajt, počet]} | {comp: bajty}; poslední blok dostane příznak posledního. opts: fhd (výchozí 0), wd (bajt okna, výchozí 0x50 = 1 MiB), head (celá hlavička za magií místo fhd a wd). */
function zframe(blocks, opts) {
  const o = opts || {};
  const fhd = o.fhd === undefined ? 0x00 : o.fhd;
  const head = o.head || [fhd, ...((fhd & 0x20) ? [] : [o.wd === undefined ? 0x50 : o.wd])];
  const parts = [Buffer.from(MAGIC_BYTES), Buffer.from(head)];
  blocks.forEach((b, i) => {
    const last = i === blocks.length - 1;
    if (b.raw) parts.push(Buffer.from(blockHeader(b.raw.length, 0, last)), Buffer.from(b.raw));
    else if (b.rle) parts.push(Buffer.from(blockHeader(b.rle[1], 1, last)), Buffer.from([b.rle[0]]));
    else parts.push(Buffer.from(blockHeader(b.comp.length, 2, last)), Buffer.from(b.comp));
  });
  return Buffer.concat(parts);
}

/** Surové literály s hlavičkou podle velikosti (1, 2 nebo 3 bajty). */
const rawLits = (buf) => {
  const n = buf.length;
  const head = n < 32 ? [n << 3] : n < 4096 ? [((n & 15) << 4) | 0x04, n >> 4] : [((n & 15) << 4) | 0x0c, (n >> 4) & 255, n >> 12];
  return Buffer.concat([Buffer.from(head), Buffer.from(buf)]);
};
const nSeqBytes = (n) => (n < 128 ? [n] : n < 0x7f00 ? [(n >> 8) + 128, n & 255] : [255, (n - 0x7f00) & 255, (n - 0x7f00) >> 8]);

// tabulky kódů z RFC 8878 (4.1.? a 3.1.1.3.2.1.1), zapsané nezávisle na zkoušeném modulu; správnost rozhoduje libzstd
const LL_BASE_T = [...Array(16).keys(), 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const LL_EXTRA = [...Array(16).fill(0), 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE_T = [...Array(32).keys()].map((i) => i + 3).concat([35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539]);
const ML_EXTRA = [...Array(32).fill(0), 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** Komprimovaný blok, jehož tři tabulky jsou RLE (jeden symbol pro všechny sekvence), takže proud nese jen bity navíc v pořadí posun, délka shody, délka literálů.
    codes {ll, of, ml}, seqs [{of, ml, ll}] = hodnoty bitů navíc. */
function rleSeqBlock(lits, codes, seqs) {
  let bits = '';
  for (const q of seqs) bits += bin(q.of, codes.of) + bin(q.ml, ML_EXTRA[codes.ml]) + bin(q.ll, LL_EXTRA[codes.ll]);
  return Buffer.concat([rawLits(lits), Buffer.from([...nSeqBytes(seqs.length), 0x54, codes.ll, codes.of, codes.ml, ...bitStream(bits)])]);
}

/** Komprimované literály (čtyři proudy, pětibajtová hlavička: typ 2, formát 3) samých symbolů 2 se stromem délek kódů 2, 2, 1; regen znaků z malého počtu bajtů. */
function bigLiterals(regen) {
  const codes = huffCodes([1, 1, 2]);
  const streams = splitFour(new Array(regen).fill(2)).map((part) => huffStreamBytes(codes, part));
  const body = [...directTree([1, 1]), ...u16(streams[0].length), ...u16(streams[1].length), ...u16(streams[2].length), ...streams.flat()];
  const v = BigInt(2 | (3 << 2)) | (BigInt(regen) << 4n) | (BigInt(body.length) << 22n);
  return [...Array.from({ length: 5 }, (_, i) => Number((v >> BigInt(8 * i)) & 255n)), ...body];
}

/** Zapisovač popisu normalizovaných počtů (FSE, RFC 8878 4.1.1): obrácený postup k čtení. Vrací {bytes, bits}. */
function writeNCount(counts, accLog) {
  const out = [];
  let acc = 0;
  let nAcc = 0;
  let bits = 0;
  const put = (v, n) => {
    acc += v * 2 ** nAcc;
    nAcc += n;
    bits += n;
    while (nAcc >= 8) {
      out.push(acc % 256);
      acc = Math.floor(acc / 256);
      nAcc -= 8;
    }
  };
  put(accLog - 5, 4);
  let remaining = (1 << accLog) + 1;
  let threshold = 1 << accLog;
  let nbBits = accLog + 1;
  let s = 0;
  let prevZero = false;
  while (remaining > 1) {
    if (prevZero) {
      let z = 0;
      while (counts[s + z] === 0) z++;
      s += z;
      let rep = z;
      while (rep >= 3) {
        put(3, 2);
        rep -= 3;
      }
      put(rep, 2);
    }
    const c = counts[s++];
    const max = 2 * threshold - 1 - remaining;
    let v = c + 1;
    if (v >= threshold) v += max;
    put(v, v < max ? nbBits - 1 : nbBits);
    remaining -= c < 0 ? -c : c;
    prevZero = c === 0;
    while (remaining < threshold) {
      nbBits--;
      threshold >>= 1;
    }
  }
  if (nAcc > 0) out.push(acc);
  return { bytes: out, bits };
}

/** Tabulka FSE s jediným symbolem (počet 2^accLog): každý stav vede na týž symbol a nečte žádné bity. */
const singleTable = (accLog) => writeNCount([1 << accLog], accLog).bytes;

/** „Drahý“ blok: staví se v něm Huffmanův strom s 12bitovou tabulkou a tři tabulky FSE největší přesnosti (9, 8, 9), a přitom vydá jen tři bajty (jedna sekvence s délkou shody 3 z historie).
    Dekodér ho musí zaplatit celý a právě proto je počet bloků omezený. Rámec pro něj potřebuje v historii aspoň jeden bajt (heavyFrame dá šestnáct). */
function heavyBlock() {
  const tree = directTree([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const body = [...tree, 0x01];
  const v = 2 | (0 << 2) | (0 << 4) | (body.length << 14);
  return Buffer.concat([Buffer.from([...u24(v), ...body]), Buffer.from([1, 0xa8, ...singleTable(9), ...singleTable(8), ...singleTable(9), ...bitStream('0'.repeat(26))])]);
}

/** Rámec: surový blok s historií (16 B) a n „drahých“ bloků; okno 1 MiB, bez velikosti obsahu a bez kontrolního součtu. Výstup má 16 + 3n bajtů. */
function heavyFrame(n) {
  const blk = heavyBlock();
  const parts = [Buffer.from(MAGIC_BYTES), Buffer.from([0x00, 0x50]), Buffer.from(blockHeader(16, 0, false)), Buffer.from('abcdefghijklmnop')];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(blockHeader(blk.length, 2, i === n - 1)), blk);
  return Buffer.concat(parts);
}

/** Jako heavyFrame, ale poslední blok je komprimovaný blok s odkazem daleko před začátek výstupu: dekodér zpracuje všech n drahých bloků a chybu pozná až na konci (ta nejdražší chyba). Bloků je n + 2. */
function heavyFrameBadEnd(n) {
  const blk = heavyBlock();
  const bad = rleSeqBlock([], { ll: 0, of: 20, ml: 0 }, [{ of: 0, ml: 0, ll: 0 }]);
  const parts = [Buffer.from(MAGIC_BYTES), Buffer.from([0x00, 0x50]), Buffer.from(blockHeader(16, 0, false)), Buffer.from('abcdefghijklmnop')];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(blockHeader(blk.length, 2, false)), blk);
  parts.push(Buffer.from(blockHeader(bad.length, 2, true)), bad);
  return Buffer.concat(parts);
}

/** Rámec, který vydá skoro 16 MiB ze samých tříbajtových sekvencí a selže až na konci: surový blok s historií (300 B) a `blocks` komprimovaných bloků, každý s 43 690 sekvencemi (tabulky RLE, délka shody 3,
    žádné bity navíc) a výstupem 131 070 B; hlavička slibuje o `extra` bajtů víc, než rámec vydá (výchozí 7), takže dekodér udělá všechnu práci a teprve na konci hlásí nesoulad velikosti.
    Rámec má jen asi 12 B na blok. Pro 127 bloků vydá 16 646 190 B (pod 16 MiB). Okno 1 MiB, velikost obsahu ve čtyřech bajtech. */
function seqBombFrame(blocks, extra) {
  const comp = rleSeqBlock([], { ll: 0, of: 0, ml: 0 }, new Array(43690).fill({ of: 0, ml: 0, ll: 0 }));
  const total = 300 + blocks * 131070;
  const fcs = total + (extra === undefined ? 7 : extra);
  const head = [0x80, 0x50, fcs & 255, (fcs >>> 8) & 255, (fcs >>> 16) & 255, (fcs >>> 24) & 255];
  return zframe([{ raw: Buffer.alloc(300, 0x61) }, ...Array.from({ length: blocks }, () => ({ comp }))], { head });
}

/** Rámec z n prázdných surových bloků (nulová velikost, bez výstupu): nejlevnější způsob, jak napočítat bloky. */
function emptyBlocksFrame(n) {
  const parts = [Buffer.from(MAGIC_BYTES), Buffer.from([0x00, 0x50])];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(blockHeader(0, 0, i === n - 1)));
  return Buffer.concat(parts);
}

module.exports = {
  u16, u24, MAGIC_BYTES, directTree, huffCodes, huffStreamBytes, bitStream, literalsFrame, splitFour, bin, blockHeader, zframe, rawLits, nSeqBytes,
  LL_BASE_T, LL_EXTRA, ML_BASE_T, ML_EXTRA, rleSeqBlock, bigLiterals, writeNCount, singleTable, heavyBlock, heavyFrame, heavyFrameBadEnd, seqBombFrame, emptyBlocksFrame,
};
