/* FM27 Tactical Coach: poskytovatelé AI (jedno rozhraní, vyměnitelné adaptéry).
   Aplikace volá jen `provider.json(input, opts)`, `provider.text(input, opts)` a `provider.limits()`. Kdo odpovídá
   (stránka v Claude přes `sample`, Anthropic API z prohlížeče, OpenAI-kompatibilní API), určuje jen konfigurace
   (`createProvider`), takže výměna poskytovatele nevyžaduje přepis aplikace (zadání § 14).

   Čistý modul: bez DOM a bez závislostí. Síť jen přes `fetch` předaný zvenku (v prohlížeči window.fetch, v testech
   falešný), čas jen přes předané `now`. Běží v prohlížeči (window.TrenerProviders) i v Node (module.exports).

   Rozhraní poskytovatele: {name, kind, limits(), json(input, opts), text(input, opts)}
     input     řetězec, nebo [{role:'user'|'assistant', content}] začínající i končící zprávou uživatele
     opts      {modelTier:'quick'|'default'|'complex', images:Blob[], signal, onText({text, delta}), maxTokens, cache}
     limits()  vždy Promise (jako sample.limits) → {maxPromptBytes, images?:{maxCount, maxInputBytes, mediaTypes}}
     json()    rozparsovaná hodnota (objekt nebo pole); text() → {text, truncated}
     `cache` API adaptéry ignorují (mezipaměť odpovědí je věc `sample`); wrapSample předá jen `cache:false`.
   Chyby jsou prosté objekty {code, message, text?}, ne Error. Kódy: not_granted, rate_limited, upstream_error,
   prompt_too_large, invalid_request, cancelled, invalid_json, refused, empty_completion, network_error.
   `sample` umí kódů víc (image_rejected, session_expired…); wrapSample je předává beze změny.

   Použití (aplikace jen předá konfiguraci a závislosti, o zbytek se stará vrstva):
     const ledger = TrenerProviders.createLedger({ now });   // now() vrací čas v ms, hodiny dodává aplikace
     const provider = TrenerProviders.createProvider({ kind: 'anthropic', apiKey }, { fetch: window.fetch.bind(window), ledger, purpose: 'rada' });
     const advice = await provider.json(turns, { modelTier: 'complex', signal, onText });   // nebo kind:'sample' s deps.sample
     ledger.summary();   // součty po úrovních, odhad ceny v USD, podíl odhadnutých záznamů

   Co je ověřené a co ne (poctivě):
   - Anthropic: tvar požadavku (POST /v1/messages, tělo, obrázky jako base64 bloky) je převzatý z
     ai_gateway/anthropic_provider.py a jeho testů, které zachytávají skutečný přenos SDK. Proti živému API z prohlížeče je
     to NEOVĚŘENO (chybí klíč), hlavně CORS a přijetí hlaviček. Tady jen proti falešnému fetch.
   - OpenAI-kompatibilní adaptér je NEOVĚŘENÝ proti jakémukoli živému API. Je napsaný podle veřejně známého tvaru
     chat completions a vyzkoušený jen proti falešnému fetch.
   - sample: podle typových definic platformy (kontrakt 0.2.96), vyzkoušeno jen falešným `sample`.
   Klíč API jde jen do hlavičky požadavku, nikdy do `message`, do výjimek ani do objektu poskytovatele. Záznam spotřeby
   (ledger) nenese žádný text promptu ani odpovědi, jen počty (repozitář i záznamy nesmí nést obsah knih). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrenerProviders = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- konstanty
  const TIERS = Object.freeze(['quick', 'default', 'complex']);

  const ERROR_CODES = Object.freeze([
    'not_granted',
    'rate_limited',
    'upstream_error',
    'prompt_too_large',
    'invalid_request',
    'cancelled',
    'invalid_json',
    'refused',
    'empty_completion',
    'network_error',
  ]);

  // Modely podle náročnosti úlohy; stejné rozdělení jako DEFAULT_ROUTES v ai_gateway/providers.py
  // (levné čtení a plánování = Haiku, běžná rada a výuka = Sonnet, důležité taktické rozhodování = Opus).
  const TIER_MODELS = Object.freeze({
    anthropic: Object.freeze({ quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' }),
  });

  // ceník k ověření, převzato z ai_gateway/costs.py (tam podle dokumentace Claude API, tabulka modelů, stav 2026-10-06).
  // USD za 1 milion tokenů. Může zastarat; před spoléháním na částky ho ověř na stránce cen Anthropic. Neznámý model
  // nebo poskytovatel má cenu `null` (neznámá), nikdy ne nulu. Ceny mezipaměti se v odhadu nepoužívají, protože
  // `cache_control` neposíláme. Haiku má nad `longThreshold` vstupních tokenů vyšší sazby (jako v costs.py).
  const PRICES_USD_PER_MTOK = Object.freeze({
    'claude-opus-5-5': Object.freeze({ input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 }),
    'claude-sonnet-5-5': Object.freeze({ input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 }),
    'claude-haiku-5-5': Object.freeze({ input: 0.1, output: 0.5, longThreshold: 100000, longInput: 0.5, longOutput: 2.5 }),
  });
  const PRICES_NOTE = 'Ceník k ověření, převzato z ai_gateway/costs.py (dokumentace Claude API, stav 2026-10-06); ověř na stránce cen Anthropic.';

  const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
  // Verze API, kterou pro surové HTTP uvádějí aktuální příklady v dokumentaci Claude API (starší hodnota byla 2023-06-01).
  // SDK ji posílá samo; my voláme bez SDK, proto je tu natvrdo. Jde přepsat parametrem `version`.
  const ANTHROPIC_VERSION = '2026-10-21';

  // Strop textu jednoho zadání shodný s `sample` (256 KiB): adaptéry se pak chovají stejně a nejde omylem poslat
  // obří (a drahý) prompt. Jde přepsat parametrem `maxPromptBytes`.
  const MAX_PROMPT_BYTES = 262144;
  // Obrázky: počet, velikost a typy jako ai_gateway/advise.py (MAX_IMAGES, MAX_IMAGE_BYTES, IMAGE_TYPES).
  const IMAGE_LIMITS = Object.freeze({
    maxCount: 4,
    maxInputBytes: 5 * 1024 * 1024,
    mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  });
  // Výchozí `max_tokens` podle úrovně jako trasy v ai_gateway/providers.py (vision/quick 4096, advice a teach 16000).
  const DEFAULT_MAX_TOKENS = Object.freeze({ quick: 4096, default: 16000, complex: 16000 });
  const LEDGER_MAX_ENTRIES = 500;
  const JSON_HINT_CS = 'Odpověz výhradně platným JSON, bez dalšího textu.';

  // ---------------------------------------------------------------- drobné pomůcky
  const isCount = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function makeError(code, message, text) {
    const e = { code, message: String(message) };
    if (text !== undefined) e.text = text;
    return e;
  }

  /** Nahradí v textu klíč API. Volá se na vše, co pochází ze serveru nebo z výjimek, dřív než se text zkrátí
      (po zkrácení by z klíče mohl zbýt nerozpoznatelný kus). */
  function makeRedactor(secret) {
    const s = typeof secret === 'string' ? secret : '';
    return (text) => (s.length >= 4 ? String(text).split(s).join('[klíč skryt]') : String(text));
  }

  /** Zavolá zpětné volání z rozhraní; jeho chyba nesmí shodit ani změnit výsledek volání AI. */
  function safeCall(fn, arg) {
    try {
      fn(arg);
    } catch (e) {
      /* chyba kódu rozhraní se úmyslně nepropaguje; modul zůstává bez vedlejších efektů (nic nelogujeme) */
    }
  }

  function clip(text, max) {
    const one = String(text).replace(/\s+/g, ' ').trim();
    return one.length > max ? one.slice(0, max - 1) + '…' : one;
  }

  /** Počet bajtů v UTF-8 bez alokace (limit zadání je v bajtech jako u `sample`). */
  function utf8Length(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }

  // ---------------------------------------------------------------- odhad tokenů a ceny
  /** Počet znaků → odhad tokenů: ceil(znaky / 3,2). Zapsáno jako ceil(znaky * 5 / 16), je to totéž a bez chyby
      zaokrouhlení v plovoucí čárce. Čeština má kratší tokeny než angličtina, proto 3,2 a ne 4. */
  function estimateTokensFromChars(chars) {
    return Math.ceil((chars * 5) / 16);
  }

  function estimateTokens(text) {
    return estimateTokensFromChars(text === undefined || text === null ? 0 : String(text).length);
  }

  /** Odhad ceny záznamu v USD, nebo `null`, když cenu neznáme. Cenu mají jen volání přes adaptér Anthropic a známý
      model: `sample` účtuje limit uživatele v Claude (ne dolary) a u OpenAI-kompatibilních API ceny neznáme. */
  function estimateCostUsd(entry) {
    if (!entry || entry.provider !== 'anthropic') return null;
    const model = typeof entry.model === 'string' ? entry.model : '';
    if (!hasOwn(PRICES_USD_PER_MTOK, model)) return null;
    const price = PRICES_USD_PER_MTOK[model];
    const inTok = isCount(entry.inputTokens) ? entry.inputTokens : 0;
    const outTok = isCount(entry.outputTokens) ? entry.outputTokens : 0;
    const long = price.longThreshold !== undefined && inTok > price.longThreshold;
    const rateIn = long && price.longInput !== undefined ? price.longInput : price.input;
    const rateOut = long && price.longOutput !== undefined ? price.longOutput : price.output;
    // součet je v mikrodolarech; zaokrouhlení na 6 desetinných míst jako round(…, 6) v costs.py
    return Math.round(inTok * rateIn + outTok * rateOut) / 1e6;
  }

  // ---------------------------------------------------------------- extractJson
  const isContainer = (v) => v !== null && typeof v === 'object';

  function tryParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false };
    }
  }

  /** Konec vyváženého bloku od `start` (tam je `{` nebo `[`), nebo -1. Závorky uvnitř řetězců se nepočítají a
      v řetězcích se respektují escapované uvozovky, takže `"a } b"` ani `"\""` nic nerozbijí. */
  function balancedEnd(s, start) {
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if (c === '}' || c === ']') {
        if (stack.pop() !== c) return -1;
        if (stack.length === 0) return i;
      }
    }
    return -1;
  }

  /** Z odpovědi vyjme JSON objekt nebo pole, i když je obalený ```json ohradou nebo textem před/po. Celý text se
      čte jako jedna hodnota; jinak se hledají vyvážené bloky a vyhraje nejdelší, který jde zpracovat (typicky
      skutečná odpověď, ne zmínka typu „[1]“ v předchozí větě). Ohrady se záměrně nedělí regulárním výrazem: řetězec
      uvnitř JSON smí obsahovat i ```. Holé číslo, text nebo true/null se nepřijímá, volající čeká objekt nebo pole.
      Při selhání vyhodí {code:'invalid_json', message, text}, kde `text` je celá syrová odpověď. */
  function extractJson(text) {
    const raw = text === undefined || text === null ? '' : String(text);
    const fail = (message) => makeError('invalid_json', message, raw);
    const s = raw.trim(); // trim() ořízne i znak BOM na začátku (U+FEFF je v JS bílý znak)
    if (!s) throw fail('Odpověď je prázdná, není co číst jako JSON.');

    const whole = tryParse(s);
    if (whole.ok) {
      if (isContainer(whole.value)) return whole.value;
      throw fail('Odpověď je platný JSON, ale ne objekt ani pole.');
    }

    let best = null;
    let sawBracket = false;
    let tries = 0;
    let i = 0;
    // strop pokusů hlídá čas u textu plného nespárovaných závorek (každý pokus čte až do konce textu)
    while (i < s.length && tries < 200) {
      const c = s[i];
      if (c !== '{' && c !== '[') {
        i++;
        continue;
      }
      sawBracket = true;
      tries++;
      const end = balancedEnd(s, i);
      if (end !== -1) {
        const parsed = tryParse(s.slice(i, end + 1));
        if (parsed.ok) {
          const len = end + 1 - i;
          if (!best || len > best.len) best = { value: parsed.value, len };
          i = end + 1;
          continue;
        }
      }
      i++;
    }
    if (best) return best.value;
    throw fail(
      sawBracket
        ? 'V odpovědi je text podobný JSON, ale nejde ho zpracovat (chybná syntaxe nebo useknutý konec).'
        : 'V odpovědi není žádný JSON objekt ani pole.'
    );
  }

  // ---------------------------------------------------------------- obrázky
  /** Base64 obsahu souboru bez předpony data:. V prohlížeči arrayBuffer + btoa po blocích (jedno `fromCharCode` nad
      celým souborem by přetekl zásobník), v Node Buffer; funkce si prostředí vybere sama. */
  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') return Buffer.from(buffer).toString('base64');
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(binary);
  }

  const isBlobLike = (x) => x !== null && typeof x === 'object' && typeof x.arrayBuffer === 'function' && typeof x.size === 'number';

  function listImages(images, fail) {
    if (images === undefined || images === null) return [];
    if (isBlobLike(images)) return [images];
    if (Array.isArray(images)) return images;
    // FileList z <input type="file"> není pole, ale má length a indexy
    if (typeof images === 'object' && typeof images.length === 'number') return Array.prototype.slice.call(images);
    throw fail('invalid_request', 'Obrázky (images) musí být Blob, File nebo pole souborů.');
  }

  async function prepareImages(images, limits, fail) {
    const list = listImages(images, fail);
    if (!list.length) return [];
    if (!limits) throw fail('invalid_request', 'Tenhle poskytovatel obrázky nepřijímá.');
    if (list.length > limits.maxCount) throw fail('invalid_request', `Obrázků je příliš mnoho (nejvýš ${limits.maxCount}, zadáno ${list.length}).`);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const blob = list[i];
      const n = i + 1;
      if (!isBlobLike(blob)) throw fail('invalid_request', `Obrázek ${n} není Blob ani File.`);
      const type = String(blob.type || '').toLowerCase();
      if (!limits.mediaTypes.includes(type)) {
        throw fail('invalid_request', `Obrázek ${n} má nepodporovaný typ „${clip(type, 40) || 'neznámý'}“ (povoleno: ${limits.mediaTypes.join(', ')}).`);
      }
      if (blob.size === 0) throw fail('invalid_request', `Obrázek ${n} je prázdný.`);
      if (blob.size > limits.maxInputBytes) {
        throw fail('invalid_request', `Obrázek ${n} je větší než ${Math.floor(limits.maxInputBytes / (1024 * 1024))} MiB.`);
      }
      out.push({ mediaType: type, data: await blobToBase64(blob) });
    }
    return out;
  }

  // ---------------------------------------------------------------- vstup a volby
  function normalizeInput(input, fail) {
    if (typeof input === 'string') {
      if (!input.trim()) throw fail('invalid_request', 'Zadání je prázdné.');
      return [{ role: 'user', content: input }];
    }
    if (!Array.isArray(input) || input.length === 0) {
      throw fail('invalid_request', 'Vstup musí být neprázdný řetězec nebo pole zpráv {role, content}.');
    }
    const out = [];
    for (let i = 0; i < input.length; i++) {
      const m = input[i];
      if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant')) {
        throw fail('invalid_request', `Zpráva ${i + 1} musí mít roli „user“ nebo „assistant“.`);
      }
      if (typeof m.content !== 'string' || !m.content.trim()) {
        throw fail('invalid_request', `Zpráva ${i + 1} musí mít neprázdný textový obsah.`);
      }
      const prev = out[out.length - 1];
      // dvě zprávy téže role za sebou se čtou jako jedna (jako u `sample`); některá API je jinak odmítají
      if (prev && prev.role === m.role) prev.content += '\n\n' + m.content;
      else out.push({ role: m.role, content: m.content });
    }
    if (out[0].role !== 'user' || out[out.length - 1].role !== 'user') {
      throw fail('invalid_request', 'Zprávy musí začínat i končit zprávou uživatele (role „user“).');
    }
    return out;
  }

  function normalizeOpts(opts, fail) {
    const o = opts === undefined || opts === null ? {} : opts;
    if (!isObject(o)) throw fail('invalid_request', 'Volby (opts) musí být objekt.');
    const tier = o.modelTier === undefined || o.modelTier === null ? 'default' : o.modelTier;
    if (!TIERS.includes(tier)) throw fail('invalid_request', `Neznámá úroveň modelu „${clip(tier, 40)}“ (povoleno: ${TIERS.join(', ')}).`);
    if (o.signal !== undefined && o.signal !== null && !(typeof o.signal === 'object' && typeof o.signal.aborted === 'boolean')) {
      throw fail('invalid_request', 'signal musí být AbortSignal (předej ctl.signal, ne ctl).');
    }
    if (o.onText !== undefined && o.onText !== null && typeof o.onText !== 'function') throw fail('invalid_request', 'onText musí být funkce.');
    if (o.maxTokens !== undefined && o.maxTokens !== null && !(Number.isInteger(o.maxTokens) && o.maxTokens >= 1)) {
      throw fail('invalid_request', 'maxTokens musí být kladné celé číslo.');
    }
    return {
      tier,
      signal: o.signal || null,
      onText: o.onText || null,
      onUsage: typeof o.onUsage === 'function' ? o.onUsage : null, // interní: ledger tak dostane tokeny přesně k tomuto volání
      maxTokens: o.maxTokens === null ? undefined : o.maxTokens,
      images: o.images,
    };
  }

  // ---------------------------------------------------------------- HTTP
  async function readBody(res) {
    if (typeof res.text === 'function') {
      const raw = await res.text();
      const p = tryParse(raw);
      return { raw, parsed: p.ok ? p.value : undefined };
    }
    if (typeof res.json === 'function') {
      let parsed;
      try {
        parsed = await res.json();
      } catch (e) {
        parsed = undefined;
      }
      return { raw: '', parsed };
    }
    return { raw: '', parsed: undefined };
  }

  /** Lidsky čitelný text z těla chyby (Anthropic {error:{message}}, OpenAI {error:{message}}); HTML stránku proxy ne. */
  function serverText(parsed, raw) {
    if (isObject(parsed)) {
      const err = parsed.error;
      if (isObject(err) && typeof err.message === 'string') return err.message;
      if (typeof err === 'string') return err;
      if (typeof parsed.message === 'string') return parsed.message;
      return '';
    }
    return typeof raw === 'string' && !/^\s*</.test(raw) ? raw : '';
  }

  function errorTag(parsed) {
    if (!isObject(parsed) || !isObject(parsed.error)) return '';
    return [parsed.error.type, parsed.error.code].filter((x) => typeof x === 'string').join(' ').slice(0, 160);
  }

  function requestIdOf(parsed) {
    return isObject(parsed) && typeof parsed.request_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(parsed.request_id) ? parsed.request_id : '';
  }

  // Text 400 o příliš dlouhém zadání: Anthropic „prompt is too long: N tokens > M maximum“, OpenAI-kompatibilní
  // „maximum context length…“ / kód context_length_exceeded. Holé „too large“ se záměrně nehledá: „max_tokens: too large“
  // je chyba požadavku, ne dlouhý prompt.
  const TOO_LONG_RE = /prompt is too long|input is too long|too many tokens|context[ _-]?(length|window)|maximum context|reduce the length|request[ _]too[ _]large/i;
  const NO_CREDIT_RE = /credit balance/i;

  /** HTTP stav → chyba rozhraní. Pro 401/403 se text ze serveru záměrně nepřebírá (některá API v něm ozvěnou vrací klíč). */
  function mapHttpError(status, parsed, raw, fail, redact) {
    const detail = clip(redact(serverText(parsed, raw)), 200);
    const rid = requestIdOf(parsed);
    const compose = (base, withDetail) => base + (withDetail && detail ? ': ' + detail : '') + (rid ? ` [${rid}]` : '');
    const probe = detail + ' ' + errorTag(parsed);
    if (status === 401 || status === 403) return fail('not_granted', compose(`Poskytovatel odmítl klíč API (neplatný, chybí nebo nemá oprávnění), HTTP ${status}`, false));
    if (status === 402 || (status === 400 && NO_CREDIT_RE.test(probe))) {
      return fail('not_granted', compose(`Účet poskytovatele nemá platnou platbu nebo kredit (HTTP ${status})`, true));
    }
    if (status === 429) return fail('rate_limited', compose('Poskytovatel hlásí překročený limit požadavků (HTTP 429), zkus to později', true));
    if (status === 413) return fail('prompt_too_large', compose('Požadavek je pro poskytovatele příliš velký (HTTP 413)', true));
    if (status === 400 && TOO_LONG_RE.test(probe)) return fail('prompt_too_large', compose('Zadání je pro model příliš dlouhé (HTTP 400)', true));
    if (status >= 500 || status === 408) return fail('upstream_error', compose(`Služba poskytovatele je nedostupná nebo přetížená (HTTP ${status})`, true));
    if (status === 404) return fail('invalid_request', compose('Model nebo adresa API nenalezena (HTTP 404)', true));
    if (status >= 400 && status < 500) return fail('invalid_request', compose(`Poskytovatel odmítl požadavek jako neplatný (HTTP ${status})`, true));
    return fail('upstream_error', compose(`Neočekávaná odpověď poskytovatele (HTTP ${status})`, true));
  }

  // ---------------------------------------------------------------- společné jádro adaptérů s klíčem (Anthropic, OpenAI)
  /** Obě API se liší jen tvarem požadavku a odpovědi (`spec.buildRequest`, `spec.parseResponse`), vše ostatní
      (kontrola vstupu, obrázky, zrušení, mapování chyb, tokeny, onText, JSON) je tu jednou. */
  function createApiProvider(spec) {
    const redact = makeRedactor(spec.apiKey);
    const fail = (code, message, text) => makeError(code, redact(message), text);
    // Pozor: `fetch` se volá jako samostatná funkce, ne jako metoda objektu. window.fetch zavolaný s cizím `this`
    // v prohlížeči končí „Illegal invocation“.
    const fetchFn = spec.fetch;

    const provider = {
      name: spec.name,
      kind: spec.kind,
      models: Object.assign({}, spec.models),
      lastUsage: null,
      // Hlásí tokeny zpětným voláním `opts.onUsage` k jednotlivému volání. Ledger u takového poskytovatele `lastUsage`
      // nečte: při souběžných voláních by mohlo patřit jinému volání (třeba neúspěšné by dostalo tokeny úspěšného).
      reportsUsage: true,
      async limits() {
        return makeLimits(spec.maxPromptBytes, spec.images);
      },
      async text(input, opts) {
        return complete(input, opts, false);
      },
      async json(input, opts) {
        const r = await complete(input, opts, true);
        // Odpověď useknutou limitem délky nebereme, ani když se z ní dá kus JSON přečíst: byl by to jen začátek
        // odpovědi a volající by pracoval s neúplnými daty. `sample` ji odmítá také.
        if (r.truncated) throw makeError('invalid_json', 'Odpověď byla useknuta limitem délky, JSON není úplný.', r.text);
        return extractJson(r.text);
      },
    };

    const cancelled = () => fail('cancelled', 'Volání bylo zrušeno.');
    // Chyba z fetch nebo ze čtení těla. Zrušení se pozná podle signálu (i když fetch vyhodí cokoli) nebo podle
    // AbortError; ostatní je síť. Text chyby může obsahovat adresu či hlavičky, proto přes `redact`.
    function transportError(e, signal) {
      if ((signal && signal.aborted) || (e && e.name === 'AbortError')) return cancelled();
      const m = e && typeof e === 'object' ? e.message : e;
      const detail = typeof m === 'string' && m ? ': ' + clip(redact(m), 160) : '';
      return fail('network_error', `Spojení s poskytovatelem selhalo (síť, CORS nebo blokování)${detail}.`);
    }

    async function complete(input, rawOpts, jsonMode) {
      provider.lastUsage = null; // ať ledger nikdy nevezme tokeny z předchozího volání
      const o = normalizeOpts(rawOpts, fail);
      const aborted = () => !!(o.signal && o.signal.aborted);
      if (aborted()) throw cancelled();
      if (typeof fetchFn !== 'function') throw fail('invalid_request', 'Chybí funkce fetch (předej ji při vytvoření poskytovatele).');
      spec.checkConfig(fail);

      const messages = normalizeInput(input, fail);
      const bytes = messages.reduce((n, m) => n + utf8Length(m.content), 0);
      if (bytes > spec.maxPromptBytes) throw fail('prompt_too_large', `Zadání má ${bytes} B, nejvýš se posílá ${spec.maxPromptBytes} B.`);
      const images = await prepareImages(o.images, spec.images ? IMAGE_LIMITS : null, fail);
      if (aborted()) throw cancelled();

      const model = spec.modelFor(o.tier, fail);
      const req = spec.buildRequest({ model, messages, images, maxTokens: o.maxTokens, tier: o.tier, jsonMode });
      // redirect:'error': hlavička s klíčem by při přesměrování mohla putovat na jiný server
      const init = { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), redirect: 'error' };
      if (o.signal) init.signal = o.signal;

      let res;
      try {
        res = await fetchFn(req.url, init);
      } catch (e) {
        throw transportError(e, o.signal);
      }
      if (!res || typeof res !== 'object') throw fail('upstream_error', 'Funkce fetch nevrátila odpověď.');

      let body;
      try {
        body = await readBody(res);
      } catch (e) {
        throw transportError(e, o.signal);
      }
      if (aborted()) throw cancelled();
      const status = typeof res.status === 'number' ? res.status : 0;
      const ok = typeof res.ok === 'boolean' ? res.ok : status >= 200 && status < 300;
      if (!ok) throw mapHttpError(status, body.parsed, body.raw, fail, redact);
      if (!isObject(body.parsed)) throw fail('upstream_error', 'Odpověď poskytovatele není JSON objekt.');

      const out = spec.parseResponse(body.parsed, fail);
      // Tokeny se hlásí dřív, než se případně vyhodí odmítnutí nebo prázdná odpověď: i takové volání model spotřeboval.
      if (out.usage) {
        const usage = { inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, model: out.usage.model || model };
        provider.lastUsage = usage;
        if (o.onUsage) safeCall(o.onUsage, Object.assign({}, usage));
      }
      if (aborted()) throw cancelled();
      if (out.refusal) throw fail('refused', 'Model odmítl žádost zpracovat' + (out.refusal.note ? ` (${out.refusal.note})` : '') + '.');
      if (!out.text.trim()) {
        throw fail('empty_completion', 'Model nevrátil žádný text' + (out.truncated ? '; odpověď skončila na limitu délky, zvyš maxTokens nebo zkrať zadání' : '') + '.');
      }
      // Bez předstírání streamování: jedno zavolání na konci s celým textem (`delta` je tedy celý text).
      if (o.onText) safeCall(o.onText, { text: out.text, delta: out.text });
      return { text: out.text, truncated: out.truncated };
    }

    return provider;
  }

  function makeLimits(maxPromptBytes, withImages) {
    const out = { maxPromptBytes };
    if (withImages) {
      out.images = { maxCount: IMAGE_LIMITS.maxCount, maxInputBytes: IMAGE_LIMITS.maxInputBytes, mediaTypes: IMAGE_LIMITS.mediaTypes.slice() };
    }
    return out;
  }

  function cleanBaseUrl(url) {
    return typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
  }

  function cleanModels(models) {
    const out = {};
    if (isObject(models)) for (const tier of TIERS) if (typeof models[tier] === 'string' && models[tier].trim()) out[tier] = models[tier].trim();
    return out;
  }

  function positiveOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  /** Klíč se do hlavičky smí dostat jen jako tisknutelné ASCII (bez mezer a zalomení): chrání hlavičky před vložením
      řádku a hned řekne, že uživatel vložil klíč i s diakritikou nebo mezerou. */
  function keyProblem(apiKey, required, fail) {
    if (!apiKey) {
      if (required) throw fail('not_granted', 'Chybí klíč API.');
      return;
    }
    if (!/^[\x21-\x7e]+$/.test(apiKey)) throw fail('not_granted', 'Klíč API obsahuje nepovolené znaky (mezeru, diakritiku nebo zalomení řádku).');
  }

  function urlProblem(baseUrl, fail) {
    if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) throw fail('invalid_request', 'Adresa API (baseUrl) musí začínat http:// nebo https://.');
  }

  // ---------------------------------------------------------------- adaptér Anthropic (přímo z prohlížeče)
  /** createAnthropicProvider({apiKey, fetch, models, baseUrl, version, maxPromptBytes, name})
      Požadavek: POST {baseUrl}/v1/messages, tělo {model, max_tokens, messages}, obrázky jako base64 bloky před textem
      poslední zprávy uživatele (stejně jako ai_gateway/vision.py). Bez temperature/top_p/top_k, bez thinking, bez
      předvyplněné odpovědi asistenta, bez tool_choice (modely 5.x je odmítají nebo nepotřebují).
      NEPOSÍLÁ se `output_config` (nemá smysl bez schématu, `effort` není v kontraktu) ani serverový fallback při odmítnutí
      (hlavička anthropic-beta, kterou Python brána posílá u Opus/Sonnet): z prohlížeče nejde ověřit, že ji CORS povolí. */
  function createAnthropicProvider(config) {
    const c = isObject(config) ? config : {};
    const apiKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : '';
    const baseUrl = cleanBaseUrl(c.baseUrl === undefined || c.baseUrl === null || c.baseUrl === '' ? ANTHROPIC_BASE_URL : c.baseUrl);
    const version = typeof c.version === 'string' && c.version.trim() ? c.version.trim() : ANTHROPIC_VERSION;
    const models = Object.assign({}, TIER_MODELS.anthropic, cleanModels(c.models));

    return createApiProvider({
      name: typeof c.name === 'string' && c.name ? c.name : 'Anthropic',
      kind: 'anthropic',
      apiKey,
      fetch: c.fetch,
      models,
      maxPromptBytes: positiveOr(c.maxPromptBytes, MAX_PROMPT_BYTES),
      images: true,
      checkConfig(fail) {
        keyProblem(apiKey, true, fail);
        urlProblem(baseUrl, fail);
      },
      modelFor: (tier) => models[tier],
      buildRequest({ model, messages, images, maxTokens, tier }) {
        const last = messages.length - 1;
        const apiMessages = messages.map((m, i) =>
          i === last && images.length
            ? {
                role: m.role,
                content: images
                  .map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }))
                  .concat([{ type: 'text', text: m.content }]),
              }
            : { role: m.role, content: m.content }
        );
        return {
          url: `${baseUrl}/v1/messages`,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': version,
            // bez této hlavičky API volání z prohlížeče (CORS) odmítne; mimo prohlížeč je neškodná
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: { model, max_tokens: maxTokens !== undefined ? maxTokens : DEFAULT_MAX_TOKENS[tier], messages: apiMessages },
        };
      },
      parseResponse(payload, fail) {
        if (!Array.isArray(payload.content)) throw fail('upstream_error', 'Odpověď Anthropic nemá očekávaný tvar (chybí pole content).');
        // všechny textové bloky, bez mezer mezi nimi (jako ai_gateway); thinking a jiné bloky se přeskočí
        const text = payload.content
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('');
        const stop = payload.stop_reason;
        const u = isObject(payload.usage) ? payload.usage : null;
        const n = (x) => (isCount(x) ? x : 0);
        const category = isObject(payload.stop_details) && typeof payload.stop_details.category === 'string' && /^[a-z_]{1,40}$/.test(payload.stop_details.category) ? payload.stop_details.category : '';
        return {
          text,
          truncated: stop === 'max_tokens' || stop === 'model_context_window_exceeded',
          refusal: stop === 'refusal' ? { note: category ? `kategorie: ${category}` : '' } : null,
          // vstup = běžné + čtené z mezipaměti + zapsané do mezipaměti (mezipaměť nepoužíváme, takže obvykle jen běžné)
          usage:
            u && (isCount(u.input_tokens) || isCount(u.output_tokens))
              ? {
                  inputTokens: n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens),
                  outputTokens: n(u.output_tokens),
                  model: typeof payload.model === 'string' ? payload.model : '',
                }
              : null,
        };
      },
    });
  }

  // ---------------------------------------------------------------- adaptér OpenAI-kompatibilní
  /** createOpenAICompatibleProvider({apiKey, baseUrl, models:{quick,default,complex}, fetch, images, maxPromptBytes, name})

      !!! NEOVĚŘENO proti živému API (nebyl k dispozici žádný klíč ani server). Napsáno podle veřejně známého tvaru
      chat completions a vyzkoušeno jen falešným fetch. Před spoléháním ho vyzkoušej s vlastním klíčem. !!!

      POST {baseUrl}/chat/completions, hlavička Authorization: Bearer (bez klíče se hlavička vynechá: místní servery ji
      nechtějí). U json() `response_format: {type:'json_object'}`; když zadání neobsahuje slovo JSON, přidá se systémová
      zpráva, protože OpenAI JSON režim bez zmínky o JSON odmítá. Obrázky jako `image_url` s data URI (`images:false`
      je vypne pro modely bez zraku). `max_tokens` se posílá jen na výslovné `opts.maxTokens`.
      Názvy modelů musí zadat uživatel: žádný výchozí se nevymýšlí. Chybí-li model pro úroveň, použije se `models.default`;
      chybí-li i ten, volání skončí invalid_request s důvodem. `baseUrl` je povinná (např. https://api.openai.com/v1). */
  function createOpenAICompatibleProvider(config) {
    const c = isObject(config) ? config : {};
    const apiKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : '';
    const baseUrl = cleanBaseUrl(c.baseUrl);
    const models = cleanModels(c.models);
    const endpoint = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;

    return createApiProvider({
      name: typeof c.name === 'string' && c.name ? c.name : 'OpenAI-kompatibilní API',
      kind: 'openai-compatible',
      apiKey,
      fetch: c.fetch,
      models,
      maxPromptBytes: positiveOr(c.maxPromptBytes, MAX_PROMPT_BYTES),
      images: c.images !== false,
      checkConfig(fail) {
        keyProblem(apiKey, false, fail);
        if (!baseUrl) throw fail('invalid_request', 'Chybí adresa API (baseUrl) OpenAI-kompatibilního poskytovatele.');
        urlProblem(baseUrl, fail);
      },
      modelFor(tier, fail) {
        const name = models[tier] || models.default;
        if (!name) {
          throw fail('invalid_request', `Chybí název modelu pro úroveň „${tier}“. U OpenAI-kompatibilního API ho musí zadat uživatel (models.${tier} nebo models.default), žádný výchozí se nevymýšlí.`);
        }
        return name;
      },
      buildRequest({ model, messages, images, maxTokens, jsonMode }) {
        const last = messages.length - 1;
        const apiMessages = messages.map((m, i) =>
          i === last && images.length
            ? {
                role: m.role,
                content: [{ type: 'text', text: m.content }].concat(
                  images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } }))
                ),
              }
            : { role: m.role, content: m.content }
        );
        if (jsonMode && !messages.some((m) => /json/i.test(m.content))) apiMessages.unshift({ role: 'system', content: JSON_HINT_CS });
        const body = { model, messages: apiMessages };
        if (maxTokens !== undefined) body.max_tokens = maxTokens;
        if (jsonMode) body.response_format = { type: 'json_object' };
        const headers = { 'content-type': 'application/json' };
        if (apiKey) headers.authorization = 'Bearer ' + apiKey;
        return { url: endpoint, headers, body };
      },
      parseResponse(payload, fail) {
        const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
        if (!isObject(choice) || !isObject(choice.message)) throw fail('upstream_error', 'Odpověď API nemá očekávaný tvar (chybí choices[0].message).');
        const msg = choice.message;
        let text = '';
        if (typeof msg.content === 'string') text = msg.content;
        else if (Array.isArray(msg.content)) text = msg.content.map((p) => (isObject(p) && typeof p.text === 'string' ? p.text : '')).join('');
        const refusalText = typeof msg.refusal === 'string' && msg.refusal.trim() ? msg.refusal : '';
        const u = isObject(payload.usage) ? payload.usage : null;
        return {
          text,
          truncated: choice.finish_reason === 'length',
          refusal: refusalText || choice.finish_reason === 'content_filter' ? { note: refusalText ? clip(refusalText, 160) : 'filtr obsahu' } : null,
          usage:
            u && (isCount(u.prompt_tokens) || isCount(u.completion_tokens))
              ? {
                  inputTokens: isCount(u.prompt_tokens) ? u.prompt_tokens : 0,
                  outputTokens: isCount(u.completion_tokens) ? u.completion_tokens : 0,
                  model: typeof payload.model === 'string' ? payload.model : '',
                }
              : null,
        };
      },
    });
  }

  // ---------------------------------------------------------------- adaptér schopnosti `sample` (stránka v Claude)
  /** Poskytovatel, který jen odmítá. `createProvider` ho vrací místo výjimky při špatné konfiguraci: rozhraní pak
      ukáže chybu podle `code` stejně jako u každé jiné chyby. */
  function unavailableProvider(kind, code, message) {
    const reject = async () => {
      throw makeError(code, message);
    };
    return { name: 'Nedostupný poskytovatel', kind, models: {}, lastUsage: null, limits: async () => makeLimits(MAX_PROMPT_BYTES, false), json: reject, text: reject };
  }

  /** wrapSample(sample): stejné rozhraní nad schopností `sample` (json → sample.json, text → sample, limits →
      sample.limits). Mapují se jen volby, které `sample` zná: modelTier, signal a onText přímo, images (jen neprázdné),
      cache jen jako `false`. `maxTokens` se nepředává (sample ho nezná a neznámé volby hlásí do konzole). Odpovědi i chyby
      platformy se předávají beze změny, včetně kódů mimo seznam rozhraní (image_rejected, session_expired…). */
  function wrapSample(sample) {
    if (typeof sample !== 'function') {
      return unavailableProvider('claude-sample', 'not_granted', 'Schopnost sample není k dispozici (stránka není otevřená v Claude nebo ji uživatel nepovolil).');
    }
    function mapOpts(opts) {
      const o = isObject(opts) ? opts : {};
      const out = {};
      if (o.modelTier !== undefined && o.modelTier !== null) out.modelTier = o.modelTier;
      if (o.signal) out.signal = o.signal;
      if (typeof o.onText === 'function') out.onText = o.onText;
      const imgs = o.images;
      if (imgs && (typeof imgs.length === 'number' ? imgs.length > 0 : true)) out.images = imgs;
      if (o.cache === false) out.cache = false;
      return out;
    }
    return {
      name: 'Claude (stránka)',
      kind: 'claude-sample',
      models: {},
      lastUsage: null,
      async limits() {
        let raw = null;
        try {
          raw = typeof sample.limits === 'function' ? await sample.limits() : null;
        } catch (e) {
          raw = null; // podle typů platformy se odmítnutí bere jako „bez obrázků“
        }
        const out = { maxPromptBytes: raw && isCount(raw.maxPromptBytes) ? raw.maxPromptBytes : MAX_PROMPT_BYTES };
        if (raw && isObject(raw.images)) {
          out.images = { maxCount: raw.images.maxCount, maxInputBytes: raw.images.maxInputBytes, mediaTypes: Array.isArray(raw.images.mediaTypes) ? raw.images.mediaTypes.slice() : [] };
        }
        return out;
      },
      async text(input, opts) {
        const r = (await sample(input, mapOpts(opts))) || {};
        return { text: String(r.text === undefined || r.text === null ? '' : r.text), truncated: !!r.truncated };
      },
      async json(input, opts) {
        if (typeof sample.json === 'function') return sample.json(input, mapOpts(opts));
        // starší běhové prostředí bez sample.json: stejný výsledek přes text a extractJson
        const r = (await sample(input, mapOpts(opts))) || {};
        return extractJson(r.text);
      },
    };
  }

  // ---------------------------------------------------------------- měření spotřeby
  const BUCKET_KEYS = ['calls', 'okCalls', 'failedCalls', 'inputTokens', 'outputTokens', 'inputChars', 'outputChars', 'images', 'ms', 'costUsd', 'unpricedCalls', 'estimatedCalls'];

  function emptyBucket() {
    const b = {};
    for (const k of BUCKET_KEYS) b[k] = 0;
    return b;
  }

  function emptyTotals() {
    const tiers = {};
    for (const t of TIERS) tiers[t] = emptyBucket();
    return { all: emptyBucket(), tiers };
  }

  function addToBucket(bucket, e) {
    const cost = estimateCostUsd(e);
    bucket.calls += 1;
    if (e.ok) bucket.okCalls += 1;
    else bucket.failedCalls += 1;
    bucket.inputTokens += e.inputTokens;
    bucket.outputTokens += e.outputTokens;
    bucket.inputChars += e.inputChars;
    bucket.outputChars += e.outputChars;
    bucket.images += e.images;
    bucket.ms += e.ms;
    if (cost === null) bucket.unpricedCalls += 1;
    else bucket.costUsd += cost;
    if (e.estimated) bucket.estimatedCalls += 1;
  }

  const num = (x, fallback) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  const nonNeg = (x) => Math.max(0, Math.round(num(x, 0)));
  const text40 = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');

  /** Záznam v jednotném tvaru. Prochází jím i vše načtené z úložiště, takže cizí nebo poškozená data nic nerozbijí. */
  function normalizeEntry(raw, fallbackAt) {
    const r = isObject(raw) ? raw : {};
    return {
      at: num(r.at, fallbackAt),
      provider: text40(r.provider, 40),
      tier: TIERS.includes(r.tier) ? r.tier : 'default',
      model: text40(r.model, 80),
      inputChars: nonNeg(r.inputChars),
      outputChars: nonNeg(r.outputChars),
      inputTokens: nonNeg(r.inputTokens),
      outputTokens: nonNeg(r.outputTokens),
      estimated: r.estimated === true,
      images: nonNeg(r.images),
      ok: r.ok !== false,
      ms: nonNeg(r.ms),
      purpose: text40(r.purpose, 60),
    };
  }

  function bucketOut(b) {
    const out = {};
    for (const k of BUCKET_KEYS) out[k] = b[k];
    out.costUsd = Math.round(b.costUsd * 1e6) / 1e6;
    out.estimatedShare = b.calls ? b.estimatedCalls / b.calls : 0;
    return out;
  }

  function sanitizeBucket(raw) {
    const b = emptyBucket();
    if (isObject(raw)) for (const k of BUCKET_KEYS) b[k] = Math.max(0, num(raw[k], 0));
    return b;
  }

  /** createLedger({now}) → {now, record(entry), summary({sinceMs}), toJSON(), load(json), clear()}
      Záznam: {at, provider, tier, model, inputChars, outputChars, inputTokens, outputTokens, estimated, images, ok, ms, purpose}.
      Drží nejvýš 500 záznamů; zahozené zůstávají v kumulativních počítadlech, takže součty za celou dobu se neztrácejí.
      `now` (hodiny) předává aplikace; bez nich je čas vždy 0 (modul si hodiny nebere sám).
      summary() → {calls, okCalls, failedCalls, inputTokens, outputTokens, inputChars, outputChars, images, ms, costUsd,
      unpricedCalls, estimatedCalls, estimatedShare, byTier:{quick, default, complex: tatáž pole}, sinceMs,
      windowIncomplete, droppedEntries, retainedEntries, pricesNote}; costUsd sčítá jen volání se známou cenou. */
  function createLedger(options) {
    const now = options && typeof options.now === 'function' ? options.now : () => 0;
    let entries = [];
    let dropped = 0;
    let totals = emptyTotals();

    function record(entry) {
      const e = normalizeEntry(entry, num(now(), 0));
      entries.push(e);
      while (entries.length > LEDGER_MAX_ENTRIES) {
        entries.shift();
        dropped += 1;
      }
      addToBucket(totals.all, e);
      addToBucket(totals.tiers[e.tier], e);
      return Object.assign({}, e);
    }

    /** Součty za celou dobu (z kumulativních počítadel), nebo od `sinceMs` (časové razítko ve stejných jednotkách jako
        `at`; počítá se z držených záznamů, takže po zahození starších může být okno neúplné: `windowIncomplete`). */
    function summary(opts) {
      const since = opts && typeof opts.sinceMs === 'number' && Number.isFinite(opts.sinceMs) ? opts.sinceMs : null;
      let source = totals;
      let incomplete = false;
      if (since !== null) {
        source = emptyTotals();
        for (const e of entries) {
          if (e.at >= since) {
            addToBucket(source.all, e);
            addToBucket(source.tiers[e.tier], e);
          }
        }
        incomplete = dropped > 0 && entries.length > 0 && since <= entries[0].at;
      }
      const byTier = {};
      for (const t of TIERS) byTier[t] = bucketOut(source.tiers[t]);
      return Object.assign(bucketOut(source.all), { byTier, sinceMs: since, windowIncomplete: incomplete, droppedEntries: dropped, retainedEntries: entries.length, pricesNote: PRICES_NOTE });
    }

    function toJSON() {
      const tiers = {};
      for (const t of TIERS) tiers[t] = Object.assign({}, totals.tiers[t]);
      return { version: 1, dropped, entries: entries.map((e) => Object.assign({}, e)), totals: { all: Object.assign({}, totals.all), tiers } };
    }

    /** Načte stav z `toJSON()` (objekt nebo JSON řetězec). Špatná data se nepřijmou a dosavadní stav zůstane. */
    function load(json) {
      let data = json;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return { ok: false, errors: ['Záznam spotřeby není platný JSON.'], entries: entries.length };
        }
      }
      if (!isObject(data) || !Array.isArray(data.entries)) return { ok: false, errors: ['Záznam spotřeby nemá očekávaný tvar (chybí seznam entries).'], entries: entries.length };
      if (data.version !== undefined && data.version !== 1) return { ok: false, errors: [`Nepodporovaná verze záznamu spotřeby (${String(data.version).slice(0, 20)}).`], entries: entries.length };
      const all = data.entries.filter(isObject).map((r) => normalizeEntry(r, 0));
      const kept = all.slice(-LEDGER_MAX_ENTRIES);
      let nextTotals = null;
      if (isObject(data.totals) && isObject(data.totals.all) && isObject(data.totals.tiers)) {
        nextTotals = { all: sanitizeBucket(data.totals.all), tiers: {} };
        for (const t of TIERS) nextTotals.tiers[t] = sanitizeBucket(data.totals.tiers[t]);
        // počítadla, která nesedí se záznamy (méně volání než držených záznamů), se zahodí a přepočítají ze záznamů
        if (nextTotals.all.calls < kept.length) nextTotals = null;
      }
      entries = kept;
      dropped = nonNeg(data.dropped) + (all.length - kept.length);
      if (nextTotals) totals = nextTotals;
      else {
        totals = emptyTotals();
        for (const e of entries) {
          addToBucket(totals.all, e);
          addToBucket(totals.tiers[e.tier], e);
        }
      }
      return { ok: true, errors: [], entries: entries.length };
    }

    function clear() {
      entries = [];
      dropped = 0;
      totals = emptyTotals();
    }

    return { now, record, summary, toJSON, load, clear };
  }

  // Chyby, při kterých se k modelu nic neodeslalo nebo ho server odmítl dřív, než cokoli spotřeboval: nulová spotřeba
  // je tu přesná, takže se u nich tokeny neodhadují (jinak by rozpočet platil za volání, která neproběhla). První čtyři
  // jsou kódy rozhraní; zbytek jsou kódy `sample`, u nichž typy platformy říkají, že se nic neposlalo (nebo že volání
  // platforma odmítla dřív než Claude). Platí to jen bez částečného textu: odpověď, která už začala, něco stála.
  const NOT_BILLED = new Set([
    'not_granted',
    'rate_limited',
    'invalid_request',
    'prompt_too_large',
    'transform_error',
    'queue_overflow',
    'sampling_disabled',
    'not_declared',
    'capability_disabled',
    'capability_removed',
    'images_unavailable',
    'tools_unavailable',
    'session_expired',
    'image_rejected',
  ]);

  function inputLength(input) {
    if (typeof input === 'string') return input.length;
    if (!Array.isArray(input)) return 0;
    return input.reduce((n, m) => n + (isObject(m) && typeof m.content === 'string' ? m.content.length : 0), 0);
  }

  function countImages(images) {
    if (!images) return 0;
    if (isBlobLike(images)) return 1;
    return typeof images.length === 'number' ? images.length : 0;
  }

  function jsonLength(value) {
    try {
      const s = JSON.stringify(value);
      return typeof s === 'string' ? s.length : 0;
    } catch (e) {
      return 0;
    }
  }

  /** withLedger(provider, ledger, {purpose, now}) → poskytovatel se stejným rozhraním, který každé volání zapíše do ledgeru
      (i neúspěšné). Měří čas, znaky vstupu a výstupu, počet obrázků a úspěch. Tokeny bere z `usage`, které adaptér
      hlásí zpětným voláním `onUsage` (přesné i při souběžných voláních); jen poskytovatel bez příznaku `reportsUsage`
      (cizí implementace) se čte z `provider.lastUsage`. Když je poskytovatel nehlásí (sample), odhadne je z počtu znaků
      (`estimated: true`). `purpose` jde přepsat v `opts.purpose` u každého
      volání. Chyba se předá volajícímu beze změny; selhání zápisu do ledgeru volání nikdy neshodí. Obalovat stačí jednou. */
  function withLedger(provider, ledger, options) {
    if (!ledger || typeof ledger.record !== 'function') return provider;
    if (provider.ledger === ledger) return provider;
    const defaults = isObject(options) ? options : {};
    const clock = typeof defaults.now === 'function' ? defaults.now : typeof ledger.now === 'function' ? ledger.now : () => 0;

    async function measured(method, input, rawOpts) {
      const opts = isObject(rawOpts) ? rawOpts : {};
      const tier = TIERS.includes(opts.modelTier) ? opts.modelTier : 'default';
      const purpose = typeof opts.purpose === 'string' && opts.purpose ? opts.purpose : typeof defaults.purpose === 'string' ? defaults.purpose : '';
      let usage = null;
      let seenText = null;
      const inner = Object.assign({}, opts);
      delete inner.purpose;
      inner.onUsage = (u) => {
        usage = u;
        if (typeof opts.onUsage === 'function') safeCall(opts.onUsage, u);
      };
      inner.onText = (u) => {
        if (isObject(u) && typeof u.text === 'string') seenText = u.text;
        if (typeof opts.onText === 'function') safeCall(opts.onText, u);
      };

      const start = num(clock(), 0);
      let result;
      let error;
      let failed = false;
      try {
        result = await provider[method](input, inner);
      } catch (e) {
        failed = true;
        error = e;
      }
      const end = num(clock(), start);

      try {
        const u = usage || (!provider.reportsUsage && isObject(provider.lastUsage) ? provider.lastUsage : null);
        const reportedIn = u && isCount(u.inputTokens) ? u.inputTokens : null;
        const reportedOut = u && isCount(u.outputTokens) ? u.outputTokens : null;
        const inputChars = inputLength(input);
        let outputChars = 0;
        if (seenText !== null) outputChars = seenText.length;
        else if (!failed) outputChars = method === 'text' ? String((result && result.text) || '').length : jsonLength(result);
        else if (isObject(error) && typeof error.text === 'string') outputChars = error.text.length;

        let inputTokens;
        let outputTokens;
        let estimated;
        const partialText = seenText !== null || (isObject(error) && typeof error.text === 'string' && error.text !== '');
        if (failed && isObject(error) && NOT_BILLED.has(error.code) && !partialText && reportedIn === null && reportedOut === null) {
          inputTokens = 0;
          outputTokens = 0;
          estimated = false;
        } else {
          inputTokens = reportedIn !== null ? reportedIn : estimateTokensFromChars(inputChars);
          outputTokens = reportedOut !== null ? reportedOut : estimateTokensFromChars(outputChars);
          estimated = reportedIn === null || reportedOut === null;
        }
        const named = provider.models && (provider.models[tier] || provider.models.default);
        ledger.record({
          at: end,
          provider: provider.kind,
          tier,
          model: (u && typeof u.model === 'string' && u.model) || (typeof named === 'string' ? named : ''),
          inputChars,
          outputChars,
          inputTokens,
          outputTokens,
          estimated,
          images: countImages(opts.images),
          ok: !failed,
          ms: Math.max(0, end - start),
          purpose,
        });
      } catch (e) {
        /* záznam spotřeby je vedlejší věc: jeho selhání nesmí změnit výsledek volání AI */
      }
      if (failed) throw error;
      return result;
    }

    const wrapped = {
      name: provider.name,
      kind: provider.kind,
      models: provider.models,
      reportsUsage: provider.reportsUsage === true,
      ledger,
      limits: async () => provider.limits(),
      json: (input, opts) => measured('json', input, opts),
      text: (input, opts) => measured('text', input, opts),
    };
    Object.defineProperty(wrapped, 'lastUsage', { get: () => provider.lastUsage, enumerable: true });
    return wrapped;
  }

  // ---------------------------------------------------------------- výběr adaptéru podle konfigurace
  /** createProvider(config, deps)
      config: {kind:'anthropic', apiKey, models?, baseUrl?, version?} | {kind:'openai', apiKey?, baseUrl, models, images?}
              | {kind:'sample'}
      deps:   {fetch (pro anthropic a openai), sample (schopnost z claude.use('sample')), ledger?, purpose?, now?}
      Vrací vždy poskytovatele (při špatné konfiguraci takového, jehož volání skončí chybou `invalid_request`), a když je
      předán ledger, už obaleného `withLedger`. Konfigurace bývá uživatelský vstup, proto tu nevyhazujeme výjimky. */
  function createProvider(config, deps) {
    const cfg = isObject(config) ? config : {};
    const d = isObject(deps) ? deps : {};
    const kind = String(cfg.kind === undefined || cfg.kind === null ? '' : cfg.kind).toLowerCase();
    let provider;
    if (kind === 'anthropic') provider = createAnthropicProvider(Object.assign({}, cfg, { fetch: d.fetch }));
    else if (kind === 'openai' || kind === 'openai-compatible') provider = createOpenAICompatibleProvider(Object.assign({}, cfg, { fetch: d.fetch }));
    else if (kind === 'sample' || kind === 'claude-sample') provider = wrapSample(d.sample);
    else provider = unavailableProvider(kind || 'neznámý', 'invalid_request', `Neznámý druh poskytovatele „${clip(kind, 40)}“ (povoleno: anthropic, openai, sample).`);
    return d.ledger ? withLedger(provider, d.ledger, { purpose: d.purpose, now: d.now }) : provider;
  }

  return {
    TIERS,
    ERROR_CODES,
    TIER_MODELS,
    PRICES_USD_PER_MTOK,
    PRICES_NOTE,
    ANTHROPIC_VERSION,
    MAX_PROMPT_BYTES,
    IMAGE_LIMITS,
    DEFAULT_MAX_TOKENS,
    LEDGER_MAX_ENTRIES,
    extractJson,
    estimateTokens,
    estimateCostUsd,
    blobToBase64,
    createAnthropicProvider,
    createOpenAICompatibleProvider,
    wrapSample,
    createLedger,
    withLedger,
    createProvider,
  };
});
