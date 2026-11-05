/* FM27 Tactical Coach: struktura payloadu taktiky (.tac) ze souboru .fmf (čistý modul bez DOM a sítě).

   CO TU JE: přísný čtecí rozbor BINÁRNÍ STRUKTURY rozbaleného payloadu taktiky (po rozšifrování a rozbalení kontejneru, viz fmfcontainer.js a docs/FORMAT_FMF.md).
   Gramatiku odvodily ze tří skutečných exportů FM27 dva samostatné běhy Claude (žádná oficiální specifikace, shoda dvou pokusů téhož modelu); oba rozbory spotřebují každý bajt a zapíšou je zpět beze změny.
   CO TU NENÍ: význam čísel. Modul vrací syrové hodnoty (výběry, bitové masky, identifikátory) a nic z nich nepřekládá na role, instrukce ani formaci;
   to je samostatný krok (zatím neexistuje), který smí použít jen to, co je ověřené. Kdo čte tenhle modul, nesmí z „rozpoznané struktury“ vyvozovat „rozumím taktice“.

   GRAMATIKA (vše little endian, str = u32 délka + bajty UTF-8):
     soubor  = značka[16] | název | 12 × 00 | hlavička6 | zabalených12 | styl | čtveřice4 | dvojice{11} | seznam id | patička
     značka  = 03 01 „cat.“ 22 00 22 44 00 1b 00 00 00 02;  hlavička6 = 04 a b 07 02 03;  styl = ff | str
     dvojice = blok | blok | bajt místa;  dvojice se čtou, dokud další tři bajty jsou 44 00 02
     blok    = 44 00 02 | selektor u32 | 00 | 01 | F (00 nebo 01) | počet u32 | položka{počet} | 00 00 00 00 | maska u64        (26 + 24 · počet bajtů)
     položka = klíč u64 | 02 02 02 | maska2 u64 | ff | hodnota u32                                                        (24 bajtů)
     seznam id = 01 | N u32 | záznam{N};  záznam = id u32 | příznak u32 (0 nebo 1) | [blok, když příznak = 1]
     patička = 00 00 00 00 | početSeznamů u32 | seznam{…} | 01 00 00 00 | záznam13{12} | bajt konce | 30 × 00;  seznam = značka u32 | počet u32 | (01 00 | id u32){počet}
   POCTIVOST: jakákoli odchylka od gramatiky (jiná konstanta, nenulový bajt tam, kde jsou nuly, bajty navíc nebo chybějící) znamená „soubor má jinou strukturu“ a nic se neodhaduje.
   Čistá funkce: vstup se nemění; výsledek obsahuje jen kopie a pohledy na vstup. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerFmfTac = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAGIC = Object.freeze([0x03, 0x01, 0x63, 0x61, 0x74, 0x2e, 0x22, 0x00, 0x22, 0x44, 0x00, 0x1b, 0x00, 0x00, 0x00, 0x02]);
  const BLOCK_MARK = Object.freeze([0x44, 0x00, 0x02]);
  const LIMITS = Object.freeze({ maxInput: 4 * 1024 * 1024, maxPairs: 32, maxItems: 4096, maxEntries: 4096, maxLists: 64, maxListIds: 4096, maxBlocks: 1024, maxString: 4096 });
  const EXPECTED = Object.freeze({ pairs: 11, records: 12 });

  class ParseError extends Error {
    constructor(message, offset) {
      super(message);
      this.offset = offset;
    }
  }

  function toBytes(input) {
    if (input === null || input === undefined) return null;
    const tag = Object.prototype.toString.call(input);
    if (tag === '[object Uint8Array]') return input;
    if (tag === '[object ArrayBuffer]') return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }

  class Reader {
    constructor(b) {
      this.b = b;
      this.p = 0;
      this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    }
    need(n, what) {
      if (n < 0 || this.p + n > this.b.length) throw new ParseError(`Soubor je useknutý (${what}).`, this.p);
    }
    u8(what) {
      this.need(1, what);
      return this.b[this.p++];
    }
    u32(what) {
      this.need(4, what);
      const v = this.dv.getUint32(this.p, true);
      this.p += 4;
      return v;
    }
    u64(what) {
      this.need(8, what);
      const v = this.dv.getBigUint64(this.p, true);
      this.p += 8;
      return v;
    }
    bytes(n, what) {
      this.need(n, what);
      const out = this.b.slice(this.p, this.p + n);
      this.p += n;
      return out;
    }
    expect(pattern, what) {
      this.need(pattern.length, what);
      for (let i = 0; i < pattern.length; i++) if (this.b[this.p + i] !== pattern[i]) throw new ParseError(`Čekal jsem ${what}, ale bajty se liší.`, this.p + i);
      this.p += pattern.length;
    }
    zeros(n, what) {
      this.need(n, what);
      for (let i = 0; i < n; i++) if (this.b[this.p + i] !== 0) throw new ParseError(`Čekal jsem ${n} nul (${what}), ale našel jsem nenulový bajt.`, this.p + i);
      this.p += n;
    }
    peekIs(pattern) {
      if (this.p + pattern.length > this.b.length) return false;
      for (let i = 0; i < pattern.length; i++) if (this.b[this.p + i] !== pattern[i]) return false;
      return true;
    }
    str(what) {
      const n = this.u32(what + ' (délka)');
      if (n > LIMITS.maxString) throw new ParseError(`Řetězec (${what}) je příliš dlouhý.`, this.p - 4);
      const raw = this.bytes(n, what);
      let text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
      } catch (e) {
        text = '';
      }
      return { raw, text };
    }
  }

  /** Indexy nastavených bitů čísla (nejnižší bit má index 0). Bere BigInt nebo celé bezpečné číslo v rozsahu 0 až 2^64 − 1; cokoli jiného je chyba volajícího (nehádá se). */
  function bitsOf(v) {
    let x;
    if (typeof v === 'bigint') x = v;
    else if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) throw new RangeError('Bity se čtou jen z celého čísla (64bitové hodnoty předávejte jako BigInt).');
      x = BigInt(v);
    } else throw new TypeError('Bity se čtou jen z čísla nebo BigInt.');
    if (x < 0n || x >= 1n << 64n) throw new RangeError('Číslo je mimo rozsah 0 až 2^64 − 1.');
    const out = [];
    for (let i = 0; x > 0n; i++, x >>= 1n) if (x & 1n) out.push(i);
    return out;
  }

  function parseBlock(r, counter) {
    if (++counter.blocks > LIMITS.maxBlocks) throw new ParseError('Příliš mnoho bloků.', r.p);
    const start = r.p;
    r.expect(BLOCK_MARK, 'značku bloku 44 00 02');
    const selector = r.u32('selektor');
    r.expect([0x00], 'nulu za selektorem');
    r.expect([0x01], 'značku 01 v bloku');
    const flag = r.u8('příznak bloku');
    if (flag > 1) throw new ParseError('Příznak bloku není 0 ani 1.', r.p - 1);
    const count = r.u32('počet položek');
    if (count > LIMITS.maxItems) throw new ParseError('Blok má příliš mnoho položek.', r.p - 4);
    const items = [];
    for (let i = 0; i < count; i++) {
      const key = r.u64('klíč položky');
      r.expect([0x02, 0x02, 0x02], 'značku položky 02 02 02');
      const mask2 = r.u64('maska položky');
      r.expect([0xff], 'bajt ff v položce');
      const value = r.u32('hodnota položky');
      items.push({ key, mask2, value });
    }
    r.zeros(4, 'nuly za položkami');
    const mask = r.u64('maska bloku');
    return { offset: start, selector, flag, items, mask };
  }

  /** parse(bytes) → {ok, error, offset, tree, size}. tree.* nese syrové hodnoty, nic se nepřekládá. */
  function parse(input) {
    const out = { ok: false, error: '', offset: null, tree: null, size: 0 };
    let b = null;
    try {
      b = toBytes(input);
    } catch (e) {
      b = null; // například odpojená paměť (ArrayBuffer přenesený jinam)
    }
    if (!b) {
      out.error = 'Vstup není binární.';
      return out;
    }
    out.size = b.length;
    if (b.length > LIMITS.maxInput) {
      out.error = 'Payload je příliš velký.';
      return out;
    }
    const counter = { blocks: 0 };
    try {
      const r = new Reader(b);
      r.expect(MAGIC, 'značku taktiky 03 01 cat. …');
      const title = r.str('název');
      r.zeros(12, 'za názvem');
      const hdr6 = r.bytes(6, 'hlavičku');
      if (!(hdr6[0] === 0x04 && hdr6[3] === 0x07 && hdr6[4] === 0x02 && hdr6[5] === 0x03)) throw new ParseError('Hlavička nemá tvar 04 a b 07 02 03.', r.p - 6);
      const packed12 = r.bytes(12, 'zabalená pole');
      r.expect([0xff], 'bajt ff před popisem stylu');
      const style = r.str('popis stylu');
      const quad4 = r.bytes(4, 'čtveřici bajtů');
      const pairs = [];
      while (r.peekIs(BLOCK_MARK)) {
        if (pairs.length >= LIMITS.maxPairs) throw new ParseError('Příliš mnoho dvojic bloků.', r.p);
        const a = parseBlock(r, counter);
        const bb = parseBlock(r, counter);
        const slot = r.u8('číslo místa');
        pairs.push({ a, b: bb, slot });
      }
      r.expect([0x01], 'značku seznamu id');
      const n = r.u32('počet záznamů');
      if (n > LIMITS.maxEntries) throw new ParseError('Seznam id je příliš dlouhý.', r.p - 4);
      const entries = [];
      for (let i = 0; i < n; i++) {
        const id = r.u32('id');
        const flag = r.u32('příznak záznamu');
        if (flag > 1) throw new ParseError('Příznak záznamu není 0 ani 1.', r.p - 4);
        entries.push({ id, flag, block: flag === 1 ? parseBlock(r, counter) : null });
      }
      r.zeros(4, 'nuly před seznamy v patičce');
      const nLists = r.u32('počet seznamů');
      if (nLists > LIMITS.maxLists) throw new ParseError('Příliš mnoho seznamů v patičce.', r.p - 4);
      const lists = [];
      for (let i = 0; i < nLists; i++) {
        const tag = r.u32('značka seznamu');
        const count = r.u32('počet id v seznamu');
        if (count > LIMITS.maxListIds) throw new ParseError('Seznam v patičce je příliš dlouhý.', r.p - 4);
        const ids = [];
        for (let k = 0; k < count; k++) {
          r.expect([0x01, 0x00], 'značku 01 00 u id');
          ids.push(r.u32('id v seznamu'));
        }
        lists.push({ tag, ids });
      }
      r.expect([0x01, 0x00, 0x00, 0x00], 'značku 01 00 00 00 před záznamy');
      const records = [];
      for (let i = 0; i < EXPECTED.records; i++) records.push(r.bytes(13, 'záznam o 13 bajtech'));
      const endByte = r.u8('závěrečný bajt');
      r.zeros(30, 'závěrečné nuly');
      if (r.p !== b.length) throw new ParseError(`Za koncem struktury zbývá ${b.length - r.p} bajtů.`, r.p);
      out.tree = { title, hdr6, packed12, style, quad4, pairs, idList: { entries }, footer: { lists, records, endByte } };
      out.ok = true;
      return out;
    } catch (e) {
      if (e instanceof ParseError) {
        out.error = e.message;
        out.offset = e.offset;
        return out;
      }
      out.error = 'Struktura se nepodařila přečíst: ' + (e && e.message ? e.message : e);
      return out;
    }
  }

  /** Počty a rozpoznané tvary bez významu: pro zprávu o souboru a pro zkoušky. */
  function summary(tree) {
    if (!tree) return null;
    const nested = tree.idList.entries.filter((e) => e.block).length;
    const blocks = tree.pairs.length * 2 + nested;
    const items = tree.pairs.reduce((s, p) => s + p.a.items.length + p.b.items.length, 0) + tree.idList.entries.reduce((s, e) => s + (e.block ? e.block.items.length : 0), 0);
    const slots = tree.pairs.map((p) => p.slot).slice().sort((x, y) => x - y);
    return {
      pairs: tree.pairs.length,
      pairsAsExpected: tree.pairs.length === EXPECTED.pairs,
      blocks,
      nestedBlocks: nested,
      items,
      idEntries: tree.idList.entries.length,
      footerLists: tree.footer.lists.length,
      records: tree.footer.records.length,
      slotsArePermutation: slots.every((s, i) => s === i), // místa seřazená vzestupně musí být přesně 0, 1, 2, …
    };
  }

  /** Zpráva o struktuře bez obsahu: jen výsledek čtení, velikost a počty. Nikdy nenese název, styl ani čísla z taktiky; chyby jsou pevné věty čtečky a posun v bajtech. */
  function safeReport(result) {
    if (!result || typeof result !== 'object') return null;
    const size = Number.isInteger(result.size) ? result.size : null;
    if (!result.ok || !result.tree) return { ok: false, size, error: typeof result.error === 'string' ? result.error : '', offset: Number.isInteger(result.offset) ? result.offset : null };
    return Object.assign({ ok: true, size }, summary(result.tree));
  }

  // řídicí znaky, oddělovače řádků, všechny formátovací znaky Unicode (nulová šířka, řízení směru písma včetně izolátů, měkký spojovník, značky) a neviditelné výplně a selektory; zapsáno přes RegExp, aby ve zdrojích nebyly doslovné znaky
  const INVISIBLE = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\u034f\\u115f\\u1160\\u3164\\uffa0\\u2800\\ufe00-\\ufe0f\\ufffc\\u{e0100}-\\u{e01ef}]+', 'gu');
  /** Text ze souboru bezpečný k zobrazení: bez řídicích a neviditelných znaků, zkrácený. */
  function displayText(text, max) {
    const clean = String(text === undefined || text === null ? '' : text).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
    const n = Number.isInteger(max) && max > 0 ? max : 80;
    return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
  }

  return { MAGIC, BLOCK_MARK, LIMITS, EXPECTED, parse, summary, safeReport, bitsOf, displayText };
});
