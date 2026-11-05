/* FM27 Tactical Coach: zdroje z webu (čistý modul bez DOM, bez sítě a bez hodin).
   Převádí výsledky hledání na webu (konektor Parallel Search v Claude, nebo web search přes vlastní klíč Anthropic)
   na „úryvky z webu“, které se dávají modelu a ukazují uživateli: odkaz, doména, druh zdroje, verze FM, datum a doslovný výtah.

   Poctivost (zadání § 12):
   - Druh zdroje se pozná jen podle domény. Neznámá doména je „neznámý web“, ne „důvěryhodný“.
   - Verze FM se čte z adresy a názvu stránky (silný důkaz), z textu výtahu jen jako slabý. Starší verze není FM27.
   - Nic z webu není „ověřené“: výtah z hledání není celý text stránky, takže i oficiální web hry je pro kontrolu rady
     jen `inferred`. Úryvek s id `web:` v kontrole poctivosti (core.js) funguje stejně jako úryvek z knihy.
   - Text z webu je nedůvěryhodný vstup: čistí se od značek a řídicích znaků, zkracuje se a do promptu jde jako data.
   Tvary odpovědí konektoru (Parallel Search) nejsou ověřené proti živé službě, proto čtení odpovědi toleruje víc tvarů. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerWebSources = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  // ---------------------------------------------------------------- pomůcky
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const firstText = (...vals) => {
    for (const v of vals) {
      const t = text(v).trim();
      if (t) return t;
    }
    return '';
  };

  const MAX_TITLE = 160;
  const MAX_SNIPPET = 900;
  const MAX_RESULTS = 8;
  const MAX_PER_HOST = 2;
  const MAX_QUERIES = 4;
  const MAX_QUERY_CHARS = 200;

  // Řídicí znaky a oddělovače řádků Unicode se změní na mezeru. Neviditelné znaky (nulové šířky, řízení směru písma: U+202E
  // by obrátilo pořadí písmen a dalo se tím zakrýt, co v názvu stojí) se odstraní. Zapsáno přes RegExp, aby ve zdroji nebyly doslovné znaky.
  const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g');
  const INVISIBLE_CHARS = new RegExp('[\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]', 'g');

  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

  /** Text z webu na jeden bezpečný řádek: bez značek HTML, bez řídicích znaků a špičatých závorek, s mezerami sloučenými
      a zkrácený. Vždy se vykresluje jako text (nikdy jako HTML), tohle je druhá pojistka. */
  function cleanText(value, max) {
    let t = text(value);
    t = t.replace(/<[^>]*>/g, ' ');
    t = t.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m]);
    t = t
      .replace(/[<>]/g, ' ')
      .replace(CONTROL_CHARS, ' ')
      .replace(INVISIBLE_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  // ---------------------------------------------------------------- adresy a domény
  /** Jen https, bez přihlašovacích údajů, bez neobvyklého portu, bez adres čistě číselných nebo místních; bez sledovacích
      parametrů a kotvy. Vrací adresu, nebo prázdný řetězec. */
  function normalizeUrl(value) {
    const raw = text(value).trim();
    if (!raw || raw.length > 600) return '';
    let u;
    try {
      u = new URL(raw);
    } catch (e) {
      return '';
    }
    if (u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    if (u.port && u.port !== '443') return '';
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return '';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return '';
    if (/\.(?:local|localhost|internal|lan|home|corp)$/.test(host)) return '';
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(?:utm_|mc_|fbclid$|gclid$|igshid$|ref$|ref_src$|si$)/i.test(key)) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (u.pathname.length > 1 && out.endsWith('/') && !u.search) out = out.slice(0, -1);
    return out;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  const hostMatches = (host, domain) => host === domain || host.endsWith('.' + domain);

  /** Druhy zdrojů. `category` odpovídá druhům poznatků v zadání (princip skutečného fotbalu, komunitní zkušenost, jiné);
      `official_web` je oficiální web hry. Nikdy to neznamená „ověřeno“. */
  const KINDS = Object.freeze({
    official: { label: 'oficiální web hry', category: 'official_web', rank: 3, trust: 'Vydavatel hry. Pro FM27 nejsilnější zdroj, ale výtah z hledání není celý text článku a před předvydáním se věci mění.' },
    theory: { label: 'rozbor nebo odborný web o taktice', category: 'real_football', rank: 3, trust: 'Odborný text o fotbalové taktice. Je to teorie obecného fotbalu, ne popis FM27.' },
    reference: { label: 'encyklopedie', category: 'real_football', rank: 2, trust: 'Obecná definice pojmu. Dobré pro slovník, ne pro podrobnosti taktiky.' },
    community: { label: 'komunitní web nebo fórum', category: 'community', rank: 2, trust: 'Zkušenost hráčů. Není oficiální a může být zastaralá nebo nepřesná.' },
    media: { label: 'médium', category: 'other', rank: 2, trust: 'Novinový nebo herní web. Píše o hře nebo fotbale, ale neurčuje, jak hra funguje.' },
    video: { label: 'video', category: 'community', rank: 1, trust: 'Video od autora, kterého aplikace nezná. Výtah z textu stránky nemusí odpovídat tomu, co zaznívá.' },
    other: { label: 'neznámý web', category: 'other', rank: 0, trust: 'Doménu aplikace nezná. Ber to jen jako odkaz k ověření.' },
  });

  // Pořadí je důležité: první shoda vyhrává (community.sports-interactive.com je fórum, ne oficiální web).
  const HOSTS = Object.freeze([
    ['community', ['community.sports-interactive.com', 'sortitoutsi.net', 'fmscout.com', 'passion4fm.com', 'reddit.com', 'footballmanagerblog.org', 'fm-base.co.uk', 'fm-arena.com']],
    ['official', ['footballmanager.com', 'sigames.com', 'sega.com']],
    ['theory', ['spielverlagerung.com', 'coachesvoice.com', 'totalfootballanalysis.com', 'statsbomb.com', 'theanalyst.com', 'uefa.com', 'thefa.com', 'fifa.com']],
    ['reference', ['wikipedia.org']],
    ['media', ['fourfourtwo.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk', 'espn.com', 'skysports.com', 'goal.com', 'eurogamer.net', 'pcgamer.com', 'gamesradar.com', 'ign.com', 'vg247.com', 'rockpapershotgun.com', 'theathletic.com']],
    ['video', ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv']],
  ]);

  /** classify(url) → {ok, url, host, kind, label, trust, category}. Domény se porovnávají celé (footballmanager.com.jiny.cz není oficiální). */
  function classify(value) {
    const url = normalizeUrl(value);
    if (!url) return { ok: false, url: '', host: '', kind: 'other', label: KINDS.other.label, trust: KINDS.other.trust, category: KINDS.other.category };
    const host = hostOf(url);
    let kind = 'other';
    for (const [k, domains] of HOSTS) {
      if (domains.some((d) => hostMatches(host, d))) {
        kind = k;
        break;
      }
    }
    return { ok: true, url, host, kind, label: KINDS[kind].label, trust: KINDS[kind].trust, category: KINDS[kind].category };
  }

  // ---------------------------------------------------------------- verze FM
  const VERSION_RES = [/(?:^|[^a-z0-9])fm[\s_-]?20(\d{2})(?![0-9])/gi, /(?:^|[^a-z0-9])fm[\s_-]?(\d{2})(?![0-9])/gi, /football[\s_-]+manager[\s_-]+(?:20)?(\d{2})(?![0-9])/gi];

  function versionsIn(value) {
    const out = new Set();
    const t = text(value);
    if (!t) return [];
    for (const re of VERSION_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        const n = Number(m[1]);
        if (n >= 10 && n <= 40) out.add(String(n));
      }
    }
    return [...out];
  }

  /** Verze Football Manageru, o které stránka je. Silný důkaz je adresa nebo název, text výtahu je slabý. Dvě různé verze
      v adrese a názvu dohromady (nebo ve výtahu) = nejasné, verze zůstane neznámá. */
  function detectFmVersion(parts) {
    const p = isObject(parts) ? parts : {};
    let urlText = text(p.url);
    try {
      urlText = decodeURIComponent(urlText);
    } catch (e) {
      /* nechá se původní text adresy */
    }
    const strong = [...new Set([...versionsIn(urlText), ...versionsIn(p.title)])];
    const weak = versionsIn(p.text);
    const mentioned = [...new Set([...strong, ...weak])];
    if (strong.length === 1) return { version: strong[0], basis: 'url_or_title', mixed: false, mentioned };
    if (strong.length > 1) return { version: null, basis: 'conflict', mixed: true, mentioned };
    if (weak.length === 1) return { version: weak[0], basis: 'text', mixed: false, mentioned };
    if (weak.length > 1) return { version: null, basis: 'conflict', mixed: true, mentioned };
    return { version: null, basis: 'none', mixed: false, mentioned };
  }

  // ---------------------------------------------------------------- datum
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /** Datum z výsledku hledání (ISO „2026-11-03…“, „April 30, 2025“, „3 hours ago“) na čeština „3. 11. 2026“.
      Co se nepozná, vrací se jako zkrácený čistý text; prázdný vstup dává prázdný řetězec. Hodiny se nečtou. */
  function formatDate(value) {
    const raw = cleanText(value, 40);
    if (!raw) return '';
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(raw);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${+m[3]}. ${+m[2]}. ${m[1]}`;
    m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
    if (m && MONTHS[m[1].toLowerCase()]) return `${+m[2]}. ${MONTHS[m[1].toLowerCase()]}. ${m[3]}`;
    m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})$/.exec(raw);
    if (m && MONTHS[m[2].toLowerCase()]) return `${+m[1]}. ${MONTHS[m[2].toLowerCase()]}. ${m[3]}`;
    return raw;
  }

  // ---------------------------------------------------------------- id
  /** Stálé id podle adresy (FNV-1a), aby se stejný zdroj při opakovaném hledání jmenoval stejně. */
  function makeWebId(url) {
    let norm = normalizeUrl(url);
    if (!norm) return '';
    norm = norm.replace(/\/$/, '');
    let h = 0x811c9dc5;
    for (let i = 0; i < norm.length; i++) {
      h ^= norm.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'web:' + h.toString(36).padStart(7, '0');
  }

  // ---------------------------------------------------------------- jeden výsledek
  /** Surový výsledek {url, title, snippet, date} → výsledek s druhem, verzí a čistým textem; neplatná adresa dává null.
      `via` říká, kudy výsledek přišel (connector | anthropic). */
  function normalizeResult(raw, via) {
    if (!isObject(raw)) return null;
    const c = classify(raw.url);
    if (!c.ok) return null;
    const title = cleanText(raw.title, MAX_TITLE) || c.host;
    const snippet = cleanText(raw.snippet, MAX_SNIPPET);
    const v = detectFmVersion({ url: c.url, title, text: snippet });
    return {
      id: makeWebId(c.url),
      url: c.url,
      host: c.host,
      title,
      snippet,
      date: formatDate(raw.date),
      kind: c.kind,
      kindLabel: c.label,
      category: c.category,
      trust: c.trust,
      fmVersion: v.version,
      fmBasis: v.basis,
      fmMixed: v.mixed,
      via: via === 'anthropic' ? 'anthropic' : 'connector',
    };
  }

  // ---------------------------------------------------------------- čtení odpovědí hledání
  const LIST_KEYS = ['results', 'items', 'search_results', 'searchResults', 'organic', 'web', 'sources', 'documents', 'hits', 'entries', 'pages', 'data'];

  function findList(value, depth) {
    if (Array.isArray(value)) return value;
    if (!isObject(value) || depth > 3) return null;
    for (const k of LIST_KEYS) {
      if (hasOwn(value, k)) {
        const r = findList(value[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  const joinList = (v) => (Array.isArray(v) ? v.map((x) => cleanText(isObject(x) ? firstText(x.text, x.content, x.snippet) : x)).filter(Boolean).join(' … ') : '');

  function itemToRaw(it) {
    if (!isObject(it)) return null;
    const url = firstText(it.url, it.link, it.href, it.source_url, it.sourceUrl, it.uri);
    if (!url) return null;
    const snippet =
      joinList(it.excerpts) ||
      joinList(it.highlights) ||
      firstText(it.excerpt, it.snippet, it.description, it.summary, it.content, it.text, it.body, it.full_content);
    return {
      url,
      title: firstText(it.title, it.name, it.headline, it.page_title),
      snippet,
      date: firstText(it.publish_date, it.publishDate, it.published_date, it.publishedDate, it.published, it.date, it.page_age, it.last_updated, it.age),
    };
  }

  const URL_RE = /https?:\/\/[^\s<>"'\])}]+/gi;
  const trimUrl = (u) => u.replace(/[.,;:!?)]+$/, '');
  const LABEL_RE = /^\s*(?:[-*•]|\d+[.)])?\s*(title|url|link|source|excerpts?|snippet|content|summary|description|published|date|publish[_ ]date)\s*:\s*/i;

  /** Prostý text nebo markdown (odkazy [název](adresa), řádky Title:/URL:/Excerpts:, očíslované seznamy) → surové výsledky. */
  function parseTextResults(input) {
    const lines = text(input).split(/\r?\n/);
    const out = [];
    let cur = null;
    let pendingTitle = '';
    const flush = () => {
      if (cur && cur.url) out.push(cur);
      cur = null;
    };
    for (const line of lines) {
      const labelled = LABEL_RE.exec(line);
      const label = labelled ? labelled[1].toLowerCase() : '';
      const body = labelled ? line.slice(labelled[0].length) : line;
      URL_RE.lastIndex = 0;
      const urlMatch = URL_RE.exec(body);
      if (label === 'title') {
        if (cur && cur.url && !cur.title) cur.title = body.trim();
        else {
          flush();
          pendingTitle = body.trim();
        }
        continue;
      }
      if (urlMatch) {
        flush();
        const url = trimUrl(urlMatch[0]);
        const md = /\[([^\]]+)\]\(\s*https?:\/\/[^)]+\)/.exec(body);
        let inline = md ? md[1] : body.slice(0, urlMatch.index).replace(/^\s*(?:[-*•]|\d+[.)]|#+)\s*/, '').replace(/[\s:–—-]+$/, '').trim();
        if (label === 'url' || label === 'link' || label === 'source') inline = '';
        cur = { url, title: inline || pendingTitle, snippet: '', date: '' };
        pendingTitle = '';
        continue;
      }
      if (!cur) continue;
      const t = body.trim();
      if (!t) continue;
      if (label === 'published' || label === 'date' || label === 'publish_date' || label === 'publish date') cur.date = t;
      else cur.snippet = (cur.snippet ? cur.snippet + ' ' : '') + t.replace(/^\s*[-*•]\s*/, '');
    }
    flush();
    return out;
  }

  /** Odpověď konektoru (objekt, pole, text, nebo obálka MCP {content:[{type:'text', text}], structuredContent}) → surové výsledky. */
  function rawFromPayload(payload, depth) {
    const d = depth || 0;
    if (d > 3 || payload === null || payload === undefined) return [];
    if (typeof payload === 'string') {
      const t = payload.trim();
      if (/^[\[{]/.test(t)) {
        try {
          return rawFromPayload(JSON.parse(t), d + 1);
        } catch (e) {
          /* není to JSON, čte se jako text */
        }
      }
      return parseTextResults(payload);
    }
    if (isObject(payload) && payload.structuredContent !== undefined && payload.structuredContent !== null) {
      const r = rawFromPayload(payload.structuredContent, d + 1);
      if (r.length) return r;
    }
    const list = findList(payload, 0);
    if (list) {
      const out = list.map(itemToRaw).filter(Boolean);
      if (out.length) return out;
      const fromStrings = list.filter((x) => typeof x === 'string').join('\n');
      if (fromStrings) return parseTextResults(fromStrings);
    }
    if (isObject(payload) && Array.isArray(payload.content)) {
      const out = [];
      for (const block of payload.content) if (isObject(block) && block.type === 'text') out.push(...rawFromPayload(block.text, d + 1));
      return out;
    }
    if (isObject(payload) && firstText(payload.url, payload.link)) return [itemToRaw(payload)].filter(Boolean);
    return [];
  }

  /** Má odpověď tvar, který aplikace zná (seznam výsledků, i prázdný)? Prázdný seznam je „nic nenalezeno“; odpověď neznámého tvaru je
      „nerozumím“, a to se uživateli musí říct jinak. */
  function recognizesShape(payload, depth) {
    const d = depth || 0;
    if (d > 3 || payload === null || payload === undefined) return false;
    if (typeof payload === 'string') {
      const t = payload.trim();
      if (!/^[\[{]/.test(t)) return false;
      try {
        return recognizesShape(JSON.parse(t), d + 1);
      } catch (e) {
        return false;
      }
    }
    if (isObject(payload) && payload.structuredContent !== undefined && payload.structuredContent !== null && recognizesShape(payload.structuredContent, d + 1)) return true;
    if (findList(payload, 0)) return true;
    if (isObject(payload) && payload.payload !== undefined && payload.payload !== null && recognizesShape(payload.payload, d + 1)) return true;
    if (isObject(payload) && Array.isArray(payload.content)) return payload.content.some((b) => isObject(b) && b.type === 'text' && recognizesShape(b.text, d + 1));
    return false;
  }

  /** parseSearchPayload(payload, via) → výsledky (bez duplicit podle id, v pořadí, jak přišly). */
  function parseSearchPayload(payload, via) {
    const seen = new Set();
    const out = [];
    for (const raw of rawFromPayload(payload, 0)) {
      const r = normalizeResult(raw, via || 'connector');
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }

  /** Odpověď Anthropic Messages API s nástrojem web_search: výsledky z bloků web_search_tool_result (adresy a názvy dodává
      API, ne model), doslovné výtahy z `citations[].cited_text` (nejvýš 150 znaků na citaci), chyby nástroje (HTTP 200,
      v `content` je objekt s `error_code`), počet hledání a `pause_turn`. Text odpovědi modelu se výsledkům nepřidává. */
  function parseAnthropicResponse(resp) {
    const out = { results: [], queries: [], errors: [], searches: 0, paused: false, stopReason: '', text: '' };
    if (!isObject(resp)) return out;
    out.stopReason = text(resp.stop_reason);
    out.paused = out.stopReason === 'pause_turn';
    const usage = isObject(resp.usage) && isObject(resp.usage.server_tool_use) ? resp.usage.server_tool_use : null;
    if (usage && Number.isInteger(usage.web_search_requests)) out.searches = usage.web_search_requests;
    const byUrl = new Map();
    const order = [];
    const quotes = new Map();
    const blocks = Array.isArray(resp.content) ? resp.content : [];
    for (const b of blocks) {
      if (!isObject(b)) continue;
      if (b.type === 'server_tool_use' && b.name === 'web_search' && isObject(b.input) && typeof b.input.query === 'string') out.queries.push(cleanText(b.input.query, MAX_QUERY_CHARS));
      if (b.type === 'web_search_tool_result') {
        if (Array.isArray(b.content)) {
          for (const r of b.content) {
            if (!isObject(r) || r.type !== 'web_search_result') continue;
            const n = normalizeUrl(r.url);
            if (!n || byUrl.has(n)) continue;
            byUrl.set(n, { url: n, title: r.title, date: r.page_age, snippet: '' });
            order.push(n);
          }
        } else if (isObject(b.content) && typeof b.content.error_code === 'string') {
          out.errors.push(cleanText(b.content.error_code, 60));
        }
      }
      if (b.type === 'text') {
        out.text += text(b.text);
        for (const c of Array.isArray(b.citations) ? b.citations : []) {
          if (!isObject(c) || c.type !== 'web_search_result_location') continue;
          const n = normalizeUrl(c.url);
          const q = cleanText(c.cited_text, 200);
          if (!n || !q) continue;
          const list = quotes.get(n) || [];
          if (!list.includes(q)) list.push(q);
          quotes.set(n, list);
        }
      }
    }
    // citace může odkazovat na stránku, kterou web_search_tool_result nevypsal: bere se jen adresa, kterou API doložilo výsledkem
    const seen = new Set();
    for (const n of order) {
      const base = byUrl.get(n);
      base.snippet = (quotes.get(n) || []).join(' … ');
      const r = normalizeResult(base, 'anthropic');
      if (r && !seen.has(r.id)) {
        seen.add(r.id);
        out.results.push(r);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- řazení
  /** Pořadí podle užitečnosti pro učení: oficiální FM27, rozbory taktiky, encyklopedie, komunitní FM27, ostatní; starší verze FM
      je až za tím. Bez výtahu o něco níž (nejde z něj nic vyčíst). Stabilní: při shodě platí pořadí z hledání. */
  function score(r) {
    const base = { official: 70, theory: 80, reference: 60, media: 50, community: 45, video: 30, other: 20 }[r.kind] || 20;
    let s = base;
    if (r.fmVersion === '27' && r.fmBasis === 'url_or_title') s += r.kind === 'official' ? 40 : 20;
    else if (r.fmVersion && r.fmVersion !== '27') s -= 25;
    if (!r.snippet) s -= 10;
    else if (r.snippet.length > 80) s += 5;
    return s;
  }

  /** rank(results, {max, perHost}) → nejvýš `max` výsledků, nejvýš `perHost` z jedné domény. */
  function rank(results, opts) {
    const max = (opts && opts.max) || MAX_RESULTS;
    const perHost = (opts && opts.perHost) || MAX_PER_HOST;
    const seen = new Set();
    const decorated = [];
    (Array.isArray(results) ? results : []).forEach((r, i) => {
      if (!isObject(r) || !r.id || seen.has(r.id)) return;
      seen.add(r.id);
      decorated.push({ r, i, s: score(r) });
    });
    decorated.sort((a, b) => b.s - a.s || a.i - b.i);
    const perHostCount = new Map();
    const out = [];
    for (const { r } of decorated) {
      const used = perHostCount.get(r.host) || 0;
      if (used >= perHost) continue;
      perHostCount.set(r.host, used + 1);
      out.push(r);
      if (out.length >= max) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- popisky pro obrazovku
  /** describe(result) → texty a tón štítků. Verze: FM27 (z adresy nebo názvu), FM27 jen z textu, starší verze (NENÍ FM27), nejasná, neuvedená. */
  function describe(r) {
    const o = isObject(r) ? r : {};
    let versionLabel;
    let versionTone;
    if (o.fmMixed) {
      versionLabel = 'verze FM nejasná (víc verzí)';
      versionTone = 'warn';
    } else if (o.fmVersion === '27' && o.fmBasis === 'url_or_title') {
      versionLabel = 'FM27 (podle adresy nebo názvu)';
      versionTone = 'good';
    } else if (o.fmVersion === '27') {
      versionLabel = 'FM27 jen zmíněno v textu, neověřeno';
      versionTone = 'warn';
    } else if (o.fmVersion) {
      versionLabel = `FM${o.fmVersion}: starší hra, NENÍ FM27`;
      versionTone = 'warn';
    } else {
      versionLabel = 'verze FM neuvedena';
      versionTone = 'neutral';
    }
    return {
      kindLabel: o.kindLabel || KINDS.other.label,
      versionLabel,
      versionTone,
      dateLabel: o.date ? `datum: ${o.date}` : 'datum neuvedeno',
      note: 'Výtah z hledání, ne celý text stránky. Neověřeno.',
    };
  }

  // ---------------------------------------------------------------- úryvek pro model a pro uložení
  /** Úryvek z webu ve tvaru jako úryvek z knihy (id, title, where, text) a navíc url. `where` je jen z hodnot, které
      sestavila aplikace (doména, druh, verze, datum); text stránky se sem nedostane. */
  function toPassage(r) {
    const d = describe(r);
    const where = ['web', r.host, d.kindLabel, d.versionLabel, r.date || 'bez data'].join(' · ');
    return { id: r.id, kind: 'web', title: r.title, where, text: r.snippet || '(výsledek bez výtahu: je k dispozici jen název a odkaz)', url: r.url, host: r.host, sourceKind: r.kind, fmVersion: r.fmVersion || '', date: r.date || '' };
  }

  /** Lehká podoba úryvku do uložené rady nebo lekce (bez textu): jen to, co je třeba k odkazu. */
  function lightPassage(p) {
    return { id: p.id, title: cleanText(p.title, MAX_TITLE), where: cleanText(p.where, 200), url: normalizeUrl(p.url), kind: 'web' };
  }

  /** Zdroj z webu uložený mezi „moje zdroje“ (dokument typu source). Do registru se dostane vždy jako neoficiální. */
  function toSourceDoc(r, now) {
    return {
      title: r.title,
      url: r.url,
      publisher: r.host,
      date: r.date || '',
      fmVersion: r.fmVersion && r.fmBasis === 'url_or_title' ? r.fmVersion : '',
      type: r.kind === 'video' ? 'video' : r.kind === 'community' ? 'forum' : r.kind === 'other' ? 'other' : 'article',
      category: r.category,
      area: '',
      claims: r.snippet || '',
      origin: 'web',
      addedAt: now,
    };
  }

  // ---------------------------------------------------------------- plán hledání
  const clean = (s, max) => cleanText(s, max);

  function uniqueQueries(list) {
    const seen = new Set();
    const out = [];
    for (const q of list) {
      const s = clean(q, MAX_QUERY_CHARS);
      const key = core.fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
      if (s.length >= 3 && key && !seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
      if (out.length >= MAX_QUERIES) break;
    }
    return out;
  }

  const OBJECTIVE_TAIL =
    ' Prefer, in this order: official Football Manager 27 articles (footballmanager.com), analyses by coaches or tactical analysts, ' +
    'coaching resources and encyclopedic definitions, then reputable community guides. For each source give the publication date ' +
    'and which Football Manager version it is about, if any. Do not use sources about older Football Manager versions as if they described FM27.';

  /** Plán pro lekci: téma a jeho výrazy z osnovy. Teorie fotbalu je první, jedna otázka míří na FM27. */
  function planForLesson(lesson) {
    const l = isObject(lesson) ? lesson : {};
    const kw = isObject(l.keywords) ? l.keywords : {};
    const en = Array.isArray(kw.en) ? kw.en.map(String).filter(Boolean) : [];
    const cs = Array.isArray(kw.cs) ? kw.cs.map(String).filter(Boolean) : [];
    const main = en[0] || clean(l.title, 80);
    const queries = uniqueQueries([`${main} football tactics explained`, en[1] ? `${en[1]} football tactics` : '', clean(l.title, 80), `Football Manager 27 ${main}`, cs[0] || '']);
    const topic = [clean(l.title, 100), ...en.slice(0, 3)].filter(Boolean).join(' / ');
    return {
      kind: 'lesson',
      queries,
      objective: `Find reliable sources that explain the football tactics concept: ${topic}.` + OBJECTIVE_TAIL,
    };
  }

  /** Plán pro radu: dotazy z plánovače knih (3 až 5) a jedna otázka zaměřená na FM27 z textu uživatele. */
  function planForAdvice(input) {
    const o = isObject(input) ? input : {};
    const question = clean(o.question, 160);
    const fromBooks = Array.isArray(o.bookQueries) ? o.bookQueries.map((q) => clean(q, 120)).filter(Boolean) : [];
    const queries = uniqueQueries([...fromBooks.slice(0, 2).map((q) => (/tactic|taktik|football|fotbal|press|pressing|formation/i.test(q) ? q : `${q} football tactics`)), question ? `Football Manager 27 ${question}` : '', ...fromBooks.slice(2, 4)]);
    const topic = question || fromBooks[0] || 'football tactics';
    return {
      kind: 'advice',
      queries: queries.length ? queries : uniqueQueries([`Football Manager 27 ${topic}`]),
      objective: `Find reliable sources relevant to this Football Manager tactical problem: ${topic}.` + OBJECTIVE_TAIL,
    };
  }

  /** Plán pro ruční hledání na obrazovce Zdroje znalostí. */
  function planForTopic(topic) {
    const t = clean(topic, 160);
    return {
      kind: 'topic',
      queries: t ? uniqueQueries([`Football Manager 27 ${t}`, `${t} football tactics`, t]) : [],
      objective: `Find reliable sources about: ${t || 'Football Manager 27 tactics'}.` + OBJECTIVE_TAIL,
    };
  }

  /** Úvodní hledání, když uživatel zatím nic nezadal: co o FM27 vyšlo oficiálně a co o jeho taktice píše komunita. */
  function planStarter() {
    return {
      kind: 'starter',
      queries: ['Football Manager 27 tactics new features', 'Football Manager 27 match engine tactical tweaks', 'Football Manager 27 training tactical effectiveness', 'Football Manager 27 tactics guide'],
      objective: 'Find what has been officially published about Football Manager 27 tactics, the match engine and training, and reputable community analyses of the FM27 tactics.' + OBJECTIVE_TAIL,
    };
  }

  /** Klíč do paměti hledání: stejné dotazy v jiném pořadí jsou stejné hledání. */
  function cacheKey(plan) {
    const qs = (plan && Array.isArray(plan.queries) ? plan.queries : []).map((q) => core.fold(q).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
    return [...new Set(qs)].sort().join('¦');
  }

  // ---------------------------------------------------------------- vstup nástroje konektoru
  /** Vstup nástroje podle jeho schématu (`describeTool().inputSchema`). Bez schématu se použije nejpravděpodobnější tvar
      Parallel Search ({objective, search_queries}); neověřeno. Vrací null, když schéma neumíme naplnit (chybí povinná pole). */
  function buildToolInput(schema, plan) {
    const queries = (plan && Array.isArray(plan.queries) ? plan.queries : []).slice(0, MAX_QUERIES).map((q) => clean(q, MAX_QUERY_CHARS)).filter(Boolean);
    const objective = clean(plan && plan.objective, 1500) || (queries[0] || '');
    if (!queries.length && !objective) return null;
    const props = isObject(schema) && isObject(schema.properties) ? schema.properties : null;
    if (!props) return { objective, search_queries: queries };
    const out = {};
    if (hasOwn(props, 'objective')) out.objective = objective;
    if (hasOwn(props, 'search_queries')) out.search_queries = queries;
    else if (hasOwn(props, 'queries')) out.queries = queries;
    if (!hasOwn(out, 'objective') && !hasOwn(out, 'search_queries') && !hasOwn(out, 'queries')) {
      if (hasOwn(props, 'query')) out.query = queries[0] || objective.slice(0, MAX_QUERY_CHARS);
      else if (hasOwn(props, 'q')) out.q = queries[0] || objective.slice(0, MAX_QUERY_CHARS);
    }
    if (!Object.keys(out).length) return null;
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some((r) => !hasOwn(out, r))) return null;
    return out;
  }

  return {
    KINDS,
    HOSTS,
    MAX_RESULTS,
    MAX_PER_HOST,
    MAX_QUERIES,
    cleanText,
    normalizeUrl,
    hostOf,
    classify,
    detectFmVersion,
    formatDate,
    makeWebId,
    normalizeResult,
    parseSearchPayload,
    recognizesShape,
    parseAnthropicResponse,
    parseTextResults,
    rank,
    describe,
    toPassage,
    lightPassage,
    toSourceDoc,
    planForLesson,
    planForAdvice,
    planForTopic,
    planStarter,
    cacheKey,
    buildToolInput,
  };
});
