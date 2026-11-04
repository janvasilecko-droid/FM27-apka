/* FM27 Tactical Coach: jádro bez DOM (text, knihovna, hledání, kontrola poctivosti, prompty).
   Běží v prohlížeči (window.TrenerCore) i v Node (module.exports), aby šlo všechno testovat.
   Validátor je přesný překlad `ai_gateway/advice10.py`: shodu hlídá test nad fixtures z Pythonu. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- úrovně důvěry
  const TIERS = ['verified', 'observed', 'user_entered', 'inferred', 'unknown'];
  const TIER_RANK = { unknown: 0, inferred: 1, user_entered: 2, observed: 3, verified: 4 };
  const LABELS = ['heuristic_coach', 'ocr_unverified', 'vision_unverified', 'ai_advise', 'user_entered', 'screenshot_verified', 'stub'];
  const LABEL_TO_TIER = {
    screenshot_verified: 'observed',
    user_entered: 'user_entered',
    ocr_unverified: 'inferred',
    vision_unverified: 'inferred',
    heuristic_coach: 'inferred',
    ai_advise: 'inferred',
    stub: 'unknown',
  };
  const INPUT_LABELS = ['heuristic_coach', 'ocr_unverified', 'vision_unverified', 'user_entered', 'screenshot_verified'];
  const SECTION_KEYS = ['context', 'evidenceA', 'evidenceB', 'confidence', 'diagnosis', 'change', 'measure', 'risk', 'reversal', 'unknown'];
  const MIN_TEXT = 8;
  const MAX_CHANGES = 2;

  // ---------------------------------------------------------------- text a hledání
  function fold(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  const STOP_WORDS = new Set(
    (
      // čeština
      'a aby ale ani ano asi az bez bude budou by byl byla byli bylo byt co ci clanek dalsi do ho i jak jako je jeho jej jeji jejich jen jeste ji jine jiz jsem jsi jsme jsou jste k kam kde kdo kdyz ke ktera ktere kteri ktery ma mate me mezi mi mit mnou moje muj my na nad nam nas nase nebo nebot nej neni nez ni nic nove o od ode on ona oni ono ony po pod podle pokud pouze prave pred pres pri pro proc proto protoze prvni pta s se si sve svuj ta tak take take tam te ten tedy to tohle toho tom tomto tu ty tyto u uz v vam vas vase ve vice vsak vy z za zde ze ' +
      // angličtina
      'a about after all also am an and any are as at be been being but by can could did do does for from had has have he her his how i if in into is it its just may me more most my no not of on one or our out over she should so some such than that the their them then there these they this to too up us was we were what when where which who will with would you your'
    )
      .split(/\s+/)
      .filter(Boolean)
      .map(fold)
  );

  // Lehké „stemování“: ohýbané koncovky se ořežou, takže „útočník/útočníka“ i „pressing/press“ sdílejí kořen.
  function stem(token) {
    return token.length >= 6 ? token.slice(0, 5) : token;
  }

  function tokenize(text) {
    return fold(text)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
      .map(stem);
  }

  function normalizeSpace(text) {
    return String(text)
      .replace(/­/g, '')
      .replace(/([\p{L}])-\s*\n\s*(\p{Ll})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitSentences(text) {
    const out = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
      let j = i + 1;
      while (j < text.length && /[)"”“’»]/.test(text[j])) j++;
      if (j < text.length && !/\s/.test(text[j])) continue;
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (k >= text.length || /[\p{Lu}\p{N}„"“(\[]/u.test(text[k])) {
        out.push(text.slice(start, j).trim());
        start = k;
        i = k - 1;
      }
    }
    if (start < text.length) out.push(text.slice(start).trim());
    return out.filter(Boolean);
  }

  const MIN_PASSAGE = 40;

  function chunkText(text, opts) {
    const target = (opts && opts.target) || 700;
    const max = (opts && opts.max) || 1100;
    const out = [];
    let cur = '';
    const flush = () => {
      if (cur) out.push(cur);
      cur = '';
    };
    for (const sentence of splitSentences(normalizeSpace(text))) {
      if (sentence.length > max) {
        flush();
        for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max));
        continue;
      }
      if (cur && (cur.length + sentence.length + 1 > max || cur.length >= target)) flush();
      cur = cur ? cur + ' ' + sentence : sentence;
    }
    flush();
    return out.filter((p) => p.length >= MIN_PASSAGE);
  }

  /** Text bez čísel stran: po formfeedu, jinak po odstavcích do ~3000 znaků ("oddíly"). */
  function splitTextIntoSections(text) {
    const raw = String(text).replace(/\r\n?/g, '\n');
    if (raw.includes('\f')) return raw.split('\f');
    const sections = [];
    let cur = '';
    for (const para of raw.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > 3000) {
        sections.push(cur);
        cur = '';
      }
      cur = cur ? cur + '\n\n' + para : para;
    }
    if (cur) sections.push(cur);
    return sections;
  }

  function detectLanguage(sample) {
    const words = fold(sample).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 4000);
    const cs = new Set('je jsou byl byla ale nebo kdyz jako tento ktery ktera ktere pro pri jeho jeji nez take se si na do od'.split(' '));
    const en = new Set('the and of to in is that for with as are was this which by from or be it not at on'.split(' '));
    const de = new Set('der die das und ist nicht ein eine mit von zu den dem auf fur sich auch wird sind als bei oder'.split(' '));
    const score = { cs: 0, en: 0, de: 0 };
    for (const w of words) {
      if (cs.has(w)) score.cs++;
      if (en.has(w)) score.en++;
      if (de.has(w)) score.de++;
    }
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    return best[1] >= 5 ? best[0] : 'other';
  }

  function makeId(len) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    const bytes = new Uint8Array(len);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
    for (const b of bytes) id += alphabet[b % alphabet.length];
    return id;
  }

  /** pages: pole textů stran; vrací pasáže `{id, bookId, page, seq, text}`. */
  function buildPassages(bookId, pages) {
    const passages = [];
    pages.forEach((pageText, index) => {
      const page = index + 1;
      chunkText(pageText).forEach((text, seq) => {
        passages.push({ id: `bk:${bookId}:${page}:${seq + 1}`, bookId, page, seq: seq + 1, text });
      });
    });
    return passages;
  }

  function citationLabel(book, passage) {
    const where = book.pageMode === 'pdf' ? `list PDF č. ${passage.page}` : `oddíl ${passage.page}`;
    return `${book.title}, ${where}`;
  }

  class Index {
    constructor(passages) {
      this.docs = [];
      this.inv = new Map();
      this.total = 0;
      for (const p of passages || []) this._add(p);
      this.avgLen = this.docs.length ? this.total / this.docs.length : 0;
      this.byId = new Map(this.docs.map((d) => [d.p.id, d.p]));
    }
    _add(p) {
      const tokens = tokenize(p.text);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      const id = this.docs.length;
      this.docs.push({ p, len: tokens.length || 1 });
      for (const [t, f] of tf) {
        let list = this.inv.get(t);
        if (!list) this.inv.set(t, (list = []));
        list.push([id, f]);
      }
      this.total += tokens.length || 1;
    }
    get size() {
      return this.docs.length;
    }
    search(query, opts) {
      const k = (opts && opts.k) || 8;
      const perBook = (opts && opts.perBook) || 3;
      const bookIds = (opts && opts.bookIds) || null;
      const terms = [...new Set(tokenize(query))];
      if (!terms.length || !this.docs.length) return [];
      const N = this.docs.length;
      const k1 = 1.4;
      const b = 0.75;
      const scores = new Map();
      for (const t of terms) {
        const posting = this.inv.get(t);
        if (!posting) continue;
        const idf = Math.log(1 + (N - posting.length + 0.5) / (posting.length + 0.5));
        for (const [id, f] of posting) {
          const d = this.docs[id];
          if (bookIds && !bookIds.has(d.p.bookId)) continue;
          const s = (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / this.avgLen));
          scores.set(id, (scores.get(id) || 0) + s);
        }
      }
      const ranked = [...scores].sort((x, y) => y[1] - x[1]);
      const out = [];
      const per = new Map();
      for (const [id, score] of ranked) {
        const p = this.docs[id].p;
        const used = per.get(p.bookId) || 0;
        if (used >= perBook) continue;
        per.set(p.bookId, used + 1);
        out.push(Object.assign({}, p, { score }));
        if (out.length >= k) break;
      }
      return out;
    }
    /** Sousední pasáže (kontext): stejná kniha, předchozí a následující v pořadí. */
    neighbours(passageId, radius) {
      const r = radius || 1;
      const at = this.docs.findIndex((d) => d.p.id === passageId);
      if (at < 0) return [];
      const bookId = this.docs[at].p.bookId;
      const out = [];
      for (let i = Math.max(0, at - r); i <= Math.min(this.docs.length - 1, at + r); i++) {
        if (this.docs[i].p.bookId === bookId) out.push(this.docs[i].p);
      }
      return out;
    }
  }

  /** Spojí výsledky více dotazů (RRF), aby jeden špatný dotaz nepřebil ostatní. */
  function multiSearch(index, queries, opts) {
    const k = (opts && opts.k) || 10;
    const perBook = (opts && opts.perBook) || 3;
    const fused = new Map();
    for (const q of queries) {
      index.search(q, { k: 20, perBook: 20 }).forEach((hit, rank) => {
        const cur = fused.get(hit.id) || { hit, score: 0 };
        cur.score += 1 / (60 + rank);
        fused.set(hit.id, cur);
      });
    }
    const out = [];
    const per = new Map();
    for (const { hit, score } of [...fused.values()].sort((a, b) => b.score - a.score)) {
      const used = per.get(hit.bookId) || 0;
      if (used >= perBook) continue;
      per.set(hit.bookId, used + 1);
      out.push(Object.assign({}, hit, { score }));
      if (out.length >= k) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- registr zdrojů (knowledge.json)
  const FM_VERSION = /\bFM\s*-?\s*(\d{2})\b/i;

  function parseSource(item) {
    const versionText = String(item.version || '');
    const match = FM_VERSION.exec(versionText);
    const lowered = versionText.toLowerCase();
    const releaseState =
      lowered.includes('preview') || lowered.includes('předvyd') || lowered.includes('pre-release') ? 'pre_release' : match ? 'released' : 'unknown';
    const sourceType = String(item.source_type || '');
    const st = sourceType.toLowerCase();
    return {
      id: String(item.id),
      title: String(item.title || ''),
      url: String(item.url || ''),
      publisher: String(item.publisher || ''),
      fmVersion: match ? match[1] : null,
      official: st.includes('ficiáln') || st.includes('official'),
      releaseState,
      sourceType,
      trust: String(item.trust || ''),
      caveat: String(item.caveat || ''),
      claims: (item.claims || []).map(String),
    };
  }

  class Registry {
    constructor(sources) {
      this.byId = new Map();
      for (const s of sources || []) {
        if (this.byId.has(s.id)) throw new Error('Duplicitní id zdroje: ' + s.id);
        this.byId.set(s.id, s);
      }
    }
    static fromKnowledgeJson(data) {
      return new Registry(((data && data.items) || []).map(parseSource));
    }
    has(id) {
      return this.byId.has(id);
    }
    get(id) {
      return this.byId.get(id) || null;
    }
    get size() {
      return this.byId.size;
    }
    isOfficialFm27(id) {
      const s = this.byId.get(id);
      return !!(s && s.official && s.fmVersion === '27');
    }
    digest(maxClaims) {
      if (!this.byId.size) return '(registr zdrojů je prázdný: žádné tvrzení o FM27 nelze označit jako verified)';
      const lines = [];
      for (const s of this.byId.values()) {
        lines.push(`- ${s.id} [${this.isOfficialFm27(s.id) ? 'oficiální FM27' : 'NE oficiální FM27'}, ${s.releaseState}] ${s.title}`);
        if (s.caveat) lines.push(`    upozornění: ${s.caveat}`);
        for (const c of s.claims.slice(0, maxClaims || 6)) lines.push(`    • ${c}`);
      }
      return lines.join('\n');
    }
  }

  // ---------------------------------------------------------------- validátor poctivosti (viz advice10.py)
  const MECHANIC_PATTERNS = [
    /(?<![\p{L}\p{N}_])(?:CA|PA)(?![\p{L}\p{N}_])/u,
    /current ability|potential ability/iu,
    /match engine|herní engine|engine hry|zápasov[\p{L}\p{N}_]+ engine|simulační engine/iu,
    /skryt[\p{L}\p{N}_]+ atribut[\p{L}\p{N}_]*|hidden attribute[\p{L}\p{N}_]*/iu,
  ];
  const VAGUE_TARGET = new RegExp(
    '^(?:více|víc|méně|míň|vyšší|nižší|větší|menší|lepší|horší|silnější|slabší|širší|užší|hlubší|' +
      'jinak|jiné|upravit|změnit|zlepšit|optimální|správně|vhodné|vhodnější)(?![\\p{L}\\p{N}_])',
    'iu'
  );

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');
  const strList = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.map((x) => x.trim()) : null);

  /** observations: {id: {label, text}}, passages: {id: …} nebo Set/Map ids, registry: Registry|null. */
  function validateAdvice10(advice, ctx) {
    const observations = (ctx && ctx.observations) || {};
    const registry = (ctx && ctx.registry) || null;
    const passages = ctx && ctx.passages ? (ctx.passages instanceof Set || ctx.passages instanceof Map ? ctx.passages : new Set(Object.keys(ctx.passages))) : null;
    const maxChanges = (ctx && ctx.maxChanges) || MAX_CHANGES;
    const errors = [];
    const warnings = [];
    const result = (extra) => Object.assign({ ok: errors.length === 0, errors, warnings, needs_verification: false }, extra);

    if (!isObject(advice)) return { ok: false, errors: ['Odpověď není JSON objekt.'], warnings: [], needs_verification: false };
    const missing = SECTION_KEYS.filter((k) => !(k in advice));
    if (missing.length) return { ok: false, errors: [`Chybí sekce: ${missing.join(', ')}.`], warnings: [], needs_verification: false };
    const extra = Object.keys(advice).filter((k) => !SECTION_KEYS.includes(k));
    if (extra.length) warnings.push(`Nadbytečné sekce byly ignorovány: ${extra.join(', ')}.`);

    const obsTier = {};
    const obsLabel = {};
    for (const [id, obs] of Object.entries(observations)) {
      obsTier[id] = LABEL_TO_TIER[obs.label];
      obsLabel[id] = obs.label;
    }
    const isObs = (ref) => Object.prototype.hasOwnProperty.call(obsTier, ref);
    const hasPassage = (ref) => !!passages && (passages instanceof Map ? passages.has(ref) : passages.has(ref));

    function refTier(ref) {
      if (isObs(ref)) return obsTier[ref];
      if (hasPassage(ref)) return 'inferred';
      if (registry && registry.has(ref)) return registry.isOfficialFm27(ref) ? 'verified' : 'inferred';
      return null;
    }

    function mechanicScan(name, text, tier) {
      if (tier === 'verified' || tier === 'observed') return;
      for (const pattern of MECHANIC_PATTERNS) {
        const match = pattern.exec(text);
        if (match) {
          errors.push(
            `${name}: tvrzení o interní mechanice FM27 („${match[0]}“) bez ověřeného zdroje; přepiš jako otevřenou otázku do sekce unknown.`
          );
          return;
        }
      }
    }

    function tiered(name, section, needObservation) {
      if (!isObject(section)) {
        errors.push(`${name}: sekce musí být objekt.`);
        return null;
      }
      const text = txt(section.text);
      const tier = section.tier;
      const refs = strList(section.refs);
      if (text.length < MIN_TEXT) errors.push(`${name}: text je prázdný nebo příliš krátký.`);
      if (!TIERS.includes(tier)) {
        errors.push(`${name}: neplatná úroveň důvěry „${tier}“.`);
        return null;
      }
      if (refs === null) {
        errors.push(`${name}: refs musí být seznam textů.`);
        return null;
      }
      for (const ref of refs) {
        if (refTier(ref) === null) errors.push(`${name}: odkaz „${ref}“ neodpovídá žádnému pozorování ani zdroji.`);
      }
      const good = refs.filter((ref) => refTier(ref) !== null);
      if (['verified', 'observed', 'user_entered'].includes(tier) && !good.length) {
        errors.push(`${name}: tvrzení s úrovní ${tier} musí mít odkaz na pozorování nebo zdroj.`);
      }
      if (good.length) {
        const weakest = good.map(refTier).reduce((a, b) => (TIER_RANK[b] < TIER_RANK[a] ? b : a));
        if (TIER_RANK[tier] > TIER_RANK[weakest]) {
          errors.push(`${name}: úroveň ${tier} je silnější než nejslabší odkazovaný důkaz (${weakest}).`);
        }
      }
      if (needObservation && tier !== 'unknown' && !good.some(isObs)) {
        errors.push(`${name}: důkaz musí odkazovat alespoň na jedno pozorování (id).`);
      }
      mechanicScan(name, text, tier);
      return { tier, refs: good };
    }

    tiered('context', advice.context, false);
    const evA = tiered('evidenceA', advice.evidenceA, true);
    const evB = tiered('evidenceB', advice.evidenceB, true);
    tiered('diagnosis', advice.diagnosis, false);

    // --- jistota
    const conf = advice.confidence;
    const level = isObject(conf) ? conf.level : null;
    if (!['low', 'medium', 'high'].includes(level)) errors.push('confidence: level musí být low, medium nebo high.');
    if (!txt(isObject(conf) ? conf.text : null)) errors.push('confidence: chybí zdůvodnění.');
    const obsA = new Set(((evA && evA.refs) || []).filter(isObs));
    const obsB = new Set(((evB && evB.refs) || []).filter(isObs));
    const aKnown = !!(evA && evA.tier !== 'unknown');
    const bKnown = !!(evB && evB.tier !== 'unknown');
    const union = new Set([...obsA, ...obsB]);
    if (level === 'high') {
      const verifiedBoth = aKnown && bKnown && TIER_RANK[evA.tier] >= TIER_RANK.observed && TIER_RANK[evB.tier] >= TIER_RANK.observed;
      if (!(verifiedBoth && union.size >= 2)) {
        errors.push(
          'confidence: high vyžaduje dva nezávislé ověřené důkazy (evidenceA a evidenceB s různými pozorováními screenshot_verified), ' +
            'ne jen neověřené strojové čtení (ocr_unverified / vision_unverified) nebo tvrzení uživatele.'
        );
      }
    } else if (level === 'medium' && !(aKnown || bKnown)) {
      errors.push('confidence: medium vyžaduje alespoň jeden důkaz.');
    }
    if (aKnown && bKnown && obsA.size && obsA.size === obsB.size && [...obsA].every((x) => obsB.has(x))) {
      warnings.push('evidenceA a evidenceB stojí na stejném pozorování, nejsou nezávislé.');
    }

    // --- unknown
    const unknown = advice.unknown;
    let unknownItems = isObject(unknown) ? strList(unknown.items) : null;
    if (unknownItems === null) {
      errors.push('unknown: items musí být seznam textů.');
      unknownItems = [];
    }
    unknownItems = unknownItems.filter(Boolean);

    // --- změna
    let needsVerification = false;
    const change = advice.change;
    let items = isObject(change) ? change.items : null;
    if (!Array.isArray(items) || !items.length) {
      errors.push('change: musí obsahovat alespoň jednu konkrétní změnu (items).');
      items = [];
    } else if (items.length > maxChanges) {
      errors.push(`change: nejvýš ${maxChanges} cílené změny najednou, dostal jsem ${items.length}.`);
    }
    if (isObject(change)) {
      const changeText = txt(change.text);
      if (changeText.length < MIN_TEXT) errors.push('change: chybí shrnutí změny (text).');
      mechanicScan('change', changeText);
    }
    items.forEach((item, i) => {
      const name = `change[${i + 1}]`;
      if (!isObject(item)) {
        errors.push(`${name}: položka musí být objekt.`);
        return;
      }
      const player = txt(item.player);
      const setting = txt(item.setting);
      const before = txt(item.from);
      const after = txt(item.to);
      if (!(player && setting && before && after)) {
        errors.push(`${name}: vyplň hráče (nebo „tým“), nastavení, hodnotu z a hodnotu na.`);
      } else if (before.toLowerCase() === after.toLowerCase()) {
        errors.push(`${name}: hodnota „z“ a „na“ je stejná, nejde o změnu.`);
      } else if (VAGUE_TARGET.test(after)) {
        warnings.push(`${name}: cílová hodnota „${after}“ vypadá obecně; uveď konkrétní hodnotu nastavení.`);
      }
      const steps = strList(item.where);
      if (!steps || !steps.length || !steps.every(Boolean)) errors.push(`${name}: where musí obsahovat alespoň jeden neprázdný krok v menu.`);
      const whereTier = item.where_tier;
      const refs = strList(item.refs) || [];
      if (!TIERS.includes(whereTier)) {
        errors.push(`${name}: neplatná úroveň where_tier „${whereTier}“.`);
        return;
      }
      if (whereTier === 'verified') {
        if (!refs.length || !refs.every((ref) => registry && registry.isOfficialFm27(ref))) {
          errors.push(`${name}: navigace označená jako verified musí odkazovat na oficiální zdroj FM27 z registru.`);
        }
      } else if (whereTier === 'observed') {
        if (!refs.some((ref) => obsLabel[ref] === 'screenshot_verified')) {
          errors.push(`${name}: navigace označená jako observed musí odkazovat na pozorování screenshot_verified.`);
        }
      } else {
        needsVerification = true;
        warnings.push(`${name}: název nastavení a navigace nejsou ověřené ve hře; ověř je, než změnu provedeš.`);
      }
    });
    if (needsVerification && !unknownItems.length) {
      errors.push('unknown: u neověřeného názvu nastavení nebo navigace musí být uvedeno, co je potřeba ověřit.');
    }
    if (level === 'low' && !unknownItems.length) errors.push('unknown: při nízké jistotě uveď, co chybí (unknown.items).');

    // --- měření, rizika, zpětný krok
    const measure = advice.measure;
    if (isObject(measure)) {
      if (txt(measure.text).length < MIN_TEXT) errors.push('measure: chybí popis, co po změně sledovat.');
      const checks = strList(measure.checks);
      if (!checks || !checks.length || !checks.every(Boolean)) {
        errors.push('measure: checks musí obsahovat alespoň jednu konkrétní kontrolu.');
      } else {
        for (const check of checks) mechanicScan('measure', check);
      }
      const minutes = measure.recheck_after_minutes;
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) {
        errors.push('measure: recheck_after_minutes musí být celé číslo ≥ 0 (0 = neurčeno).');
      } else if (minutes === 0) {
        warnings.push('measure: není určeno, kdy změnu znovu vyhodnotit.');
      }
      mechanicScan('measure', txt(measure.text));
    } else {
      errors.push('measure: sekce musí být objekt.');
    }

    const risk = advice.risk;
    if (isObject(risk)) {
      const riskItems = strList(risk.items);
      if (txt(risk.text).length < MIN_TEXT) errors.push('risk: chybí popis rizika.');
      if (!riskItems || !riskItems.length || !riskItems.every(Boolean)) {
        errors.push('risk: items musí obsahovat alespoň jedno konkrétní riziko.');
      } else {
        for (const entry of riskItems) mechanicScan('risk', entry);
      }
      mechanicScan('risk', txt(risk.text));
    } else {
      errors.push('risk: sekce musí být objekt.');
    }

    const reversal = advice.reversal;
    if (isObject(reversal)) {
      if (txt(reversal.text).length < MIN_TEXT) errors.push('reversal: chybí popis, jak změnu vrátit zpět.');
      mechanicScan('reversal', txt(reversal.text));
    } else {
      errors.push('reversal: sekce musí být objekt.');
    }

    return result({ needs_verification: needsVerification });
  }

  // ---------------------------------------------------------------- vykreslení do textu
  const TIER_LABEL_CS = {
    verified: 'ověřeno, oficiální zdroj',
    observed: 'pozorováno na ověřeném screenshotu',
    user_entered: 'zadal uživatel',
    inferred: 'odhad',
    unknown: 'neznámé',
  };
  const LEVEL_CS = { low: 'nízká', medium: 'střední', high: 'vysoká' };

  function adviceToText(advice) {
    const tiered = (title, key) => {
      const s = advice[key] || {};
      const refs = (s.refs || []).join(', ');
      return `${title} [${TIER_LABEL_CS[s.tier] || '?'}]: ${txt(s.text)}${refs ? ` (odkazy: ${refs})` : ''}`;
    };
    const lines = ['1. ' + tiered('Kontext', 'context'), '2. ' + tiered('Důkaz A', 'evidenceA'), '3. ' + tiered('Důkaz B', 'evidenceB')];
    const conf = advice.confidence || {};
    lines.push(`4. Jistota: ${LEVEL_CS[conf.level] || '?'}. ${txt(conf.text)}`);
    lines.push('5. ' + tiered('Diagnóza', 'diagnosis'));
    const change = advice.change || {};
    lines.push(`6. Co změnit: ${txt(change.text)}`);
    for (const item of change.items || []) {
      lines.push(`   • ${txt(item.player)}: ${txt(item.setting)}, z „${txt(item.from)}“ na „${txt(item.to)}“`);
      lines.push(`     Kde ve hře: ${(item.where || []).join(' › ')} (navigace: ${TIER_LABEL_CS[item.where_tier] || '?'})`);
    }
    const measure = advice.measure || {};
    const minutes = measure.recheck_after_minutes || 0;
    lines.push(
      `7. Jak změřit: ${txt(measure.text)} Zkontrolovat: ${(measure.checks || []).join('; ')}` +
        (minutes ? `; znovu vyhodnotit za ${minutes} min` : '; čas dalšího vyhodnocení neurčen')
    );
    const risk = advice.risk || {};
    lines.push(`8. Rizika: ${txt(risk.text)} ${(risk.items || []).join('; ')}`);
    lines.push(`9. Jak vrátit zpět: ${txt((advice.reversal || {}).text)}`);
    const unknown = advice.unknown || {};
    lines.push(`10. Co nevím / co ověřit: ${txt(unknown.text)}`);
    for (const entry of unknown.items || []) lines.push(`   • ${entry}`);
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- vstup od uživatele
  /** Zkontroluje pozorování. Vyhodí Error s českou zprávou. Vrací pole bez duplicit. */
  function normalizeObservations(list) {
    const out = [];
    const seen = new Set();
    for (const raw of list || []) {
      const id = String(raw.id || '');
      if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(id)) throw new Error(`Neplatné id pozorování: ${id}`);
      if (seen.has(id)) throw new Error(`Duplicitní id pozorování: ${id}`);
      if (!INPUT_LABELS.includes(raw.label)) throw new Error(`Pozorování ${id}: štítek ${raw.label} není povolený`);
      seen.add(id);
      const minute = Number.isInteger(raw.minute) ? raw.minute : null;
      out.push({ id, label: raw.label, minute, text: String(raw.text || '').trim().slice(0, 1500) });
    }
    if (out.length > 40) throw new Error('Příliš mnoho pozorování (max 40).');
    return out;
  }

  function renderPlan(plan) {
    const lines = [
      `Klub: ${plan.club || '?'}; taktika: ${plan.tactic || '?'}; formace: ${plan.formation || '?'}; aktivní fáze: ${plan.activePhase || '?'}`,
    ];
    const shapes = plan.phaseShapes || {};
    for (const phase of ['in', 'out']) {
      const instructions = String((shapes[phase] || {}).instructions || '').trim();
      lines.push(`Pokyny (${phase}): ${instructions || '(prázdné)'}`);
    }
    for (const p of (plan.players || []).slice(0, 15)) {
      const flags = p.flags || {};
      const marks = ['injury', 'fatigue'].filter((n) => flags[n]);
      lines.push(
        `- ${p.id || '?'} ${p.name || '?'} | ${p.position || '?'} | role: ${p.role || '?'} | x=${p.x ?? '?'}, y=${p.y ?? '?'}` +
          (marks.length ? ` | ${marks.join(', ')}` : '')
      );
    }
    return lines.join('\n').slice(0, 3000);
  }

  // ---------------------------------------------------------------- prompty
  const RULES_CS = `Jsi FM27 Tactical Coach, osobní trenér pro Football Manager 27. Uživateli řekneš, co má ve hře změnit, proč a kde. Odpovídáš česky a výhradně jedním JSON objektem (10 sekcí) přesně podle uvedeného tvaru.

Pravidla poctivosti platí bez výjimky:
1. Pracuješ jen s tím, co dostaneš: s pozorováními (každé má id a štítek původu), se zdroji znalostí (každý má id) a s úryvky z knih (id začínají bk:). Hru nevidíš. Nikdy netvrď, že jsi něco viděl, pokud to není v pozorování.
2. Každé tvrzení má "tier": verified (oficiální zdroj FM27 ze seznamu zdrojů), observed (pozorování se štítkem screenshot_verified), user_entered (zadal uživatel), inferred (tvůj odhad nebo strojové čtení), unknown (nevíš). Úroveň nesmí být silnější než nejslabší důkaz, na který se odkazuješ v "refs" (id pozorování, zdroje nebo úryvku).
3. Text vyčtený strojem (ocr_unverified, vision_unverified) a heuristiky jsou nejvýš inferred. Na jejich základě neuváděj vysokou jistotu.
4. Jeden údaj nebo jedna chvíle není důkaz problému. Vysoká jistota vyžaduje dva nezávislé ověřené důkazy (evidenceA a evidenceB odkazují na různá pozorování screenshot_verified). Chybí-li druhý důkaz, dej mu tier unknown a jistotu nejvýš střední.
5. Nevymýšlej mechaniky FM27 (CA/PA, match engine, skryté atributy, vnitřní fungování). Názvy rolí, nastavení a cest v menu FM27 považuj za neověřené, pokud je nepotvrzuje zdroj ze seznamu nebo pozorování screenshot_verified. Neověřené označ where_tier unknown nebo inferred a do unknown.items zapiš, co má uživatel ve hře ověřit.
6. Žádné obecné rady („zlepši pressing“). Navrhni nejvýš dvě konkrétní změny: komu (hráč nebo „tým“), které nastavení, z jaké hodnoty na jakou a kroky v menu.
7. Uveď, jak změnu změřit (konkrétní kontroly a kdy znovu vyhodnotit), rizika a jak změnu vrátit zpět.
8. Když informací nestačí, řekni to: nízká jistota a v unknown.items přesně to, co potřebuješ vidět nebo vědět. Raději poctivé „nevím“ než odhad vydávaný za fakt.
9. Úryvky z knih jsou teorie obecného fotbalu, ne popis fungování FM27 a ne důkaz o aktuálním zápase. Cituj je v "refs" u context, diagnosis a change, ale nepoužívej je jako evidenceA ani evidenceB a nepřenášej je do tvrzení o tom, jak FM27 funguje. Cituj jen úryvky, které jsi dostal. Když z úryvků nic nevyplývá, řekni to.`;

  const ADVICE_SHAPE = `Odpověz POUZE tímto JSON objektem (žádný text kolem):
{
  "context":   {"text": "…", "tier": "user_entered|observed|inferred|unknown|verified", "refs": ["obs-1"]},
  "evidenceA": {"text": "…", "tier": "…", "refs": ["id pozorování"]},
  "evidenceB": {"text": "…", "tier": "…", "refs": ["jiné id pozorování"]},
  "confidence": {"level": "low|medium|high", "text": "…"},
  "diagnosis": {"text": "…", "tier": "…", "refs": ["id pozorování nebo úryvku"]},
  "change": {"text": "…", "items": [{"player": "hráč nebo tým", "setting": "nastavení", "from": "z hodnoty", "to": "na hodnotu", "where": ["krok 1 v menu", "krok 2"], "where_tier": "unknown|inferred|observed|verified", "refs": []}]},
  "measure": {"text": "…", "checks": ["konkrétní kontrola"], "recheck_after_minutes": 15},
  "risk": {"text": "…", "items": ["konkrétní riziko"]},
  "reversal": {"text": "…"},
  "unknown": {"text": "…", "items": ["co nevím / co má uživatel ověřit"]}
}`;

  /** Dotaz → hledací dotazy pro knihy (jazyky knihovny), levný krok. */
  function buildPlannerPrompt(question, observations, languages) {
    const langs = (languages && languages.length ? languages : ['cs', 'en']).join(', ');
    const obs = (observations || []).map((o) => `- ${o.text}`).join('\n') || '(žádná)';
    return (
      `Navrhni hledací dotazy do knihovny fotbalové taktiky. Knihy jsou v jazycích: ${langs}. ` +
      `Napiš 3 až 5 krátkých dotazů (klíčová slova a pojmy z taktické teorie, ne věty), každý v jazyce, v němž je kniha, takže pro každý jazyk knihovny aspoň jeden. ` +
      `Dotazy mají pokrýt příčiny problému, ne jen jeho popis.\n\nProblém uživatele: ${question || '(bez dotazu)'}\nPozorování:\n${obs}\n\n` +
      `Odpověz POUZE JSON polem řetězců, například ["support striker isolation", "izolovaný útočník podpora záložníků"].`
    );
  }

  function sanitizeQueries(raw, fallback) {
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.queries) ? raw.queries : [];
    const seen = new Set();
    const out = [];
    for (const q of list) {
      const s = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (s.length >= 3 && !seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        out.push(s);
      }
      if (out.length >= 5) break;
    }
    if (fallback && fallback.trim()) out.push(fallback.trim().slice(0, 300));
    return out;
  }

  function formatObservationLines(observations) {
    if (!observations.length) return '(žádná: bez pozorování nemůžeš tvrdit nic o aktuálním průběhu)';
    return observations
      .map((o) => `- ${o.id} | ${o.label} | ${o.minute !== null && o.minute !== undefined ? o.minute + "'" : '-'} | ${o.text}`)
      .join('\n');
  }

  /** Úvodní „uživatelská“ zpráva (instrukce + data + tvar výstupu). Systémový prompt stránka nemá. */
  function buildAdviceTurns(input) {
    const passages = input.passages || [];
    const passageLines = passages.length
      ? passages.map((p) => `- ${p.id} | ${p.title} | ${p.where} | ${p.text}`).join('\n')
      : '(žádné: knihovna nic relevantního nevrátila nebo je prázdná; rada nevychází z knih, řekni to)';
    const previous = input.previousAdvice
      ? `\nPředchozí rada v tomto rozhovoru (uprav ji podle nových informací, nezačínej od nuly):\n${input.previousAdvice}\n`
      : '';
    const body =
      `${RULES_CS}\n\n${ADVICE_SHAPE}\n\n` +
      `Dotaz uživatele: ${input.question || '(bez dotazu: navrhni, co je nejdůležitější ověřit nebo změnit)'}\n\n` +
      `Pozorování (id | štítek původu | minuta | text):\n${formatObservationLines(input.observations)}\n\n` +
      `Zdroje znalostí, které smíš citovat v "refs":\n${input.sourcesDigest}\n\n` +
      `Úryvky z knih (id | kniha | kde | text). Jsou to teorie, ne důkaz o aktuálním zápase:\n${passageLines}\n` +
      previous +
      (input.imageIds && input.imageIds.length ? `\nK zprávě jsou přiložené obrázky s id: ${input.imageIds.join(', ')}.\n` : '');
    return [{ role: 'user', content: body }];
  }

  function buildRepairTurns(turns, assistantText, errors) {
    const listed = errors.map((e) => `- ${e}`).join('\n');
    return [
      ...turns,
      { role: 'assistant', content: assistantText },
      {
        role: 'user',
        content:
          `Tvoje odpověď nesplnila tato pravidla:\n${listed}\n\n` +
          'Oprav JSON. Nevymýšlej důkazy, zdroje ani úryvky. Když pro tvrzení nemáš oporu, sniž jeho úroveň, ' +
          'přiznej to v unknown a nastav nízkou jistotu. Odpověz znovu POUZE JSON objektem.',
      },
    ];
  }

  return {
    TIERS, TIER_RANK, LABELS, LABEL_TO_TIER, INPUT_LABELS, SECTION_KEYS, TIER_LABEL_CS, LEVEL_CS,
    fold, tokenize, stem, normalizeSpace, splitSentences, chunkText, splitTextIntoSections, detectLanguage, makeId,
    buildPassages, citationLabel, Index, multiSearch,
    parseSource, Registry,
    validateAdvice10, adviceToText,
    normalizeObservations, renderPlan,
    RULES_CS, ADVICE_SHAPE, buildPlannerPrompt, sanitizeQueries, buildAdviceTurns, buildRepairTurns,
  };
});
