/* Hledání zdrojů na webu: jedno rozhraní nad dvěma cestami.
   1) Stránka v Claude: konektor „Parallel Search“ přes schopnost `mcp` (uživatel ho musí mít připojený v claude.ai).
   2) Samostatná verze: nástroj web_search od Anthropic přes vlastní klíč (účtuje se zvlášť).
   Obě cesty vracejí výsledky, které přečte a očistí `websources.js`; tady je jen doprava, paměť, limity, srozumitelné hlášky
   a karta zdroje. Hledá se vždy až na pokyn uživatele (kliknutí na Hledat, Poradit, Složit lekci): první volání konektoru
   se ptá na souhlas a samo nikdy nic nespouštíme.
   NEOVĚŘENO proti živým službám: tvar odpovědi Parallel Search a chování nástroje web_search v prohlížeči (CORS). Aplikace to
   říká v Nastavení a při nečitelné odpovědi ukáže, co přišlo (stručně), ať se dá čtení opravit. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const WS = window.TrenerWebSources;
  const ui = FM27.ui;
  const { h } = ui;

  const SERVER = 'Parallel Search';
  const TOOL = 'web_search';
  const CONNECTORS_URL = 'https://claude.ai/settings/connectors';
  const TTL_MS = 30 * 60 * 1000;
  const SESSION_LIMIT = { connector: 60, anthropic: 25 };
  const COUNT_KEY = 'fm27.webcount';
  // Hledání přes vlastní klíč se účtuje zvlášť (v dokumentaci Anthropic k 5. 11. 2026: 10 USD za 1 000 hledání, plus tokeny).
  const SEARCH_USD = 0.01;

  const err = (code, message, extra) => Object.assign({ code, message }, extra || {});
  const clip = (t, n) => {
    const s = String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  if (!WS) {
    FM27.web = { available: false, route: 'none', reason: 'Chybí modul zdrojů z webu.', init() {}, label: () => 'nedostupné' };
    return;
  }

  const web = (FM27.web = {
    SERVER,
    TOOL,
    CONNECTORS_URL,
    route: 'none', // 'connector' | 'anthropic' | 'none'
    reason: '',
    mcp: null,
    cache: new Map(),
    calls: 0,
    lastRaw: '', // stručný začátek poslední odpovědi, kterou aplikace nepřečetla (k opravě čtení)

    get available() {
      return web.route !== 'none';
    },

    label() {
      return web.route === 'connector' ? `konektor ${SERVER}` : web.route === 'anthropic' ? 'web search od Anthropic (tvůj klíč)' : 'nedostupné';
    },

    /** Zvolí cestu podle toho, co stránka umí. Volá se po FM27.ai.init (aby bylo známé, jestli je klíč Anthropic). */
    init(app) {
      web.cache.clear();
      web.calls = 0;
      web.lastRaw = '';
      const caps = (app && app.caps) || {};
      web.mcp = caps.mcp && typeof caps.mcp.callTool === 'function' ? caps.mcp : null;
      const ai = FM27.ai;
      if (web.mcp) {
        web.route = 'connector';
        web.reason = '';
      } else if (ai && ai.webSearchAvailable) {
        web.route = 'anthropic';
        web.reason = '';
      } else {
        web.route = 'none';
        if (app && app.standalone) {
          web.reason = ai && ai.kind && ai.kind !== 'none' ? 'Hledání na webu zatím umí jen klíč Anthropic, ne jiné poskytovatele.' : 'Hledání na webu v samostatné verzi běží přes tvůj klíč Anthropic. Zadej ho v Nastavení (Vlastní klíč AI).';
        } else {
          web.reason = 'Tahle stránka nemá povolený přístup ke konektorům. Je to starší publikovaná verze, nebo konektory v tomhle zobrazení nejdou použít. Zkus stránku obnovit a potvrdit případný dotaz na oprávnění.';
        }
      }
      FM27.bus.emit('web', web.route);
    },

    /** Počet hledání tento měsíc a odhad poplatku za hledání (jen vlastní klíč; konektor je zdarma). */
    usage() {
      const cur = ui.lsGet(COUNT_KEY, null);
      const month = monthKey();
      const searches = cur && cur.month === month && Number.isInteger(cur.searches) ? cur.searches : 0;
      return { month, searches, usd: Math.round(searches * SEARCH_USD * 100) / 100 };
    },

    /** Stav pro Nastavení a obrazovku zdrojů, bez volání vyhledávače. {state: ready|unknown|missing|reauth|off|error, text, link?} */
    async status() {
      if (web.route === 'anthropic') {
        const u = web.usage();
        return { state: 'ready', text: `Hledání na webu běží přes tvůj klíč Anthropic. Hledání se účtuje zvlášť (tento měsíc ${u.searches}, odhad ${u.usd.toFixed(2).replace('.', ',')} USD za hledání, plus běžné tokeny).` };
      }
      if (web.route === 'none') return { state: 'off', text: web.reason };
      try {
        const r = await web.mcp.listTools(SERVER);
        const s = ((r && r.servers) || []).find((x) => x && x.server === SERVER);
        if (!s || !Array.isArray(s.tools) || !s.tools.length) return { state: 'missing', text: MCP_COPY.server_not_connected, link: { label: 'Otevřít Konektory v claude.ai', url: CONNECTORS_URL } };
        if (s.authStatus === 'needs_reauth') return { state: 'reauth', text: MCP_COPY.needs_reauth, link: { label: 'Otevřít Konektory v claude.ai', url: CONNECTORS_URL } };
        if (s.authStatus === 'connected') return { state: 'ready', text: `Konektor ${SERVER} je připojený. Aplikace za hledání nic neúčtuje; limity určuje poskytovatel konektoru (služba třetí strany).` };
        return { state: 'unknown', text: `Konektor ${SERVER} zatím nepotvrdil spojení. Při prvním hledání potvrď souhlas v okně claude.ai.` };
      } catch (e) {
        return { state: 'error', text: web.errorText(e), link: web.errorAction(e) };
      }
    },

    errorText(e) {
      if (!e) return 'Hledání na webu se nepovedlo.';
      if (web.route === 'anthropic' && FM27.ai && FM27.ai.ERROR_COPY[e.code] !== undefined && e.code !== 'tool_error') return FM27.ai.errorText(e);
      if (e.code === 'tool_error') return `Vyhledávač vrátil chybu: ${clip(e.message, 220)}`;
      return MCP_COPY[e.code] || (e.message ? clip(e.message, 240) : `Hledání na webu se nepovedlo (${e.code || 'neznámá chyba'}).`);
    },

    /** Odkaz, který chybu opraví (jen když ho známe). */
    errorAction(e) {
      return e && ['server_not_connected', 'server_not_found', 'needs_reauth', 'selection_required'].includes(e.code) ? { label: 'Otevřít Konektory v claude.ai', url: CONNECTORS_URL } : null;
    },

    /** Hledá podle plánu z websources (planFor…). Vrací {results, via, cached, at, notes, unparsed?}. Chyby vyhazuje {code, message}. */
    async search(plan, opts) {
      const o = opts || {};
      if (!web.available) throw err('unavailable', web.reason || 'Hledání na webu není dostupné.');
      if (!plan || !Array.isArray(plan.queries) || !plan.queries.length) throw err('empty', 'Není co hledat: zadej téma.');
      const key = web.route + '|' + WS.cacheKey(plan);
      const hit = web.cache.get(key);
      if (hit && !o.refresh && Date.now() - hit.at < TTL_MS) return Object.assign({}, hit, { cached: true });
      if (web.calls >= SESSION_LIMIT[web.route]) throw err('limit', 'Tahle relace už hledala hodně (pojistka proti zacyklení nebo zbytečným nákladům). Obnov stránku a pokračuj.');
      if (o.signal && o.signal.aborted) throw err('cancelled', 'Zastaveno.');
      web.calls++;
      const raw = web.route === 'connector' ? await searchConnector(plan, o) : await searchAnthropic(plan, o);
      const results = WS.rank(raw.results, { max: o.max || WS.MAX_RESULTS });
      const done = { results, via: web.route, cached: false, at: Date.now(), notes: raw.notes || [], unparsed: !!raw.unparsed, found: raw.results.length };
      if (results.length) web.cache.set(key, done);
      while (web.cache.size > 30) web.cache.delete(web.cache.keys().next().value);
      return done;
    },

    /** Totéž jako search, ale pro radu a lekci: výsledky převede na úryvky (id web:…) a NIKDY nevyhodí chybu (rada se zeptá i bez webu);
        jen zrušení se předá dál. */
    async passages(plan, opts) {
      const out = { ctx: {}, results: [], notes: [], error: null, cached: false };
      try {
        const r = await web.search(plan, opts);
        out.results = r.results;
        out.cached = r.cached;
        out.notes = r.notes || [];
        for (const res of r.results) out.ctx[res.id] = WS.toPassage(res);
        if (!r.results.length) out.notes.push(r.unparsed ? 'Hledání na webu vrátilo odpověď, které aplikace nerozumí; rada vychází jen z knih.' : 'Hledání na webu nic nenašlo.');
      } catch (e) {
        if (e && e.code === 'cancelled') throw e;
        out.error = e || err('unknown', 'Neznámá chyba.');
      }
      return out;
    },

    /** Má se při radě a lekci hledat na webu automaticky? Výchozí: ano u konektoru (zdarma), ne u vlastního klíče (stojí peníze). */
    autoOn(app) {
      if (!web.available) return false;
      const s = app && typeof app.settings === 'function' ? app.settings() : null;
      const mode = (s && s.web && s.web.mode) || 'auto';
      if (mode === 'off') return false;
      if (mode === 'on') return true;
      return web.route === 'connector';
    },

    /** Karta zdroje (výsledek hledání). opts: {onSave(result) → Promise, saved: bool}. Všechno se vykresluje jako text. */
    card(r, opts) {
      const o = opts || {};
      const d = WS.describe(r);
      const href = WS.normalizeUrl(r.url);
      const save = o.onSave
        ? h('button', {
            class: 'btn small',
            type: 'button',
            'data-act': 'save-web',
            text: o.saved ? 'Uloženo' : 'Uložit do mých zdrojů',
            disabled: !!o.saved,
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                await o.onSave(r);
                btn.textContent = 'Uloženo';
              } catch (x) {
                btn.disabled = false;
                ui.toast('Uložení se nepovedlo: ' + ((x && x.message) || x));
              }
            },
          })
        : null;
      return h(
        'div',
        { class: 'book web-source', 'data-id': r.id },
        h(
          'div',
          { class: 'meta' },
          h('b', null, href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: r.title }) : r.title),
          h('span', { text: `${r.host} · ${d.kindLabel} · ${d.dateLabel}` }),
          h('span', { class: 'chips' }, ui.chip(r.kind === 'official' ? 'accent' : 'neutral', d.kindLabel), ui.chip(d.versionTone, d.versionLabel), ui.tierChip('inferred', 'z webu, neověřeno')),
          r.snippet ? h('span', { class: 'hint web-snippet', text: `„${clip(r.snippet, 420)}“ (doslovný výtah z hledání)` }) : h('span', { class: 'hint', text: 'Výsledek bez výtahu: je k dispozici jen název a odkaz.' }),
          h('span', { class: 'hint', text: d.note })
        ),
        save ? h('div', { class: 'row' }, save) : null
      );
    },

    /** Blok „Zdroje z webu“ pro radu nebo lekci: odkazy, kterými se trenér řídil. passages: {id: {title, where, url, text?}} nebo pole. */
    sourcesBlock(passages, title, cited) {
      const list = (Array.isArray(passages) ? passages : Object.values(passages || {})).filter((p) => p && typeof p.id === 'string' && p.id.startsWith('web:'));
      if (!list.length) return null;
      return h(
        'details',
        { class: 'web-sources', open: true },
        h('summary', { text: `${title || 'Zdroje z webu'} (${list.length})` }),
        h('p', { class: 'hint', text: 'Trenér je dostal jako výtahy z hledání na webu. Nejsou ověřené: otevři odkaz, než se na ně spolehneš. Starší verze Football Manageru není FM27.' }),
        h(
          'ul',
          { class: 'list' },
          list.map((p) => {
            const href = WS.normalizeUrl(p.url);
            return h(
              'li',
              null,
              href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', text: clip(p.title, 160) }) : h('span', { text: clip(p.title, 160) }),
              h('span', { class: 'hint', text: ' ' + clip(p.where || '', 200) + ' ' }),
              cited && cited.has(p.id) ? ui.chip('good', 'použito v textu') : null
            );
          })
        )
      );
    },
  });

  // ------------------------------------------------------------------ hlášky konektoru
  const MCP_COPY = {
    server_not_connected: `Konektor ${SERVER} není u tebe připojený. Přidej ho v claude.ai (Nastavení → Konektory) a obnov tuto stránku.`,
    server_not_found: `Konektor ${SERVER} už neexistuje. Přidej ho znovu v claude.ai (Nastavení → Konektory).`,
    needs_reauth: `Konektor ${SERVER} se musí přihlásit znovu (claude.ai → Nastavení → Konektory).`,
    selection_required: `Máš víc konektorů se jménem ${SERVER}. Vyber jeden v claude.ai (Nastavení → Konektory).`,
    not_in_manifest: 'Tahle stránka nemá povolený konektor (odmítl jsi ho, nebo ho vypnul v oprávněních stránky). Povol ho v nabídce oprávnění stránky a zkus to znovu.',
    approval_required: 'Hledání potřebuje tvůj souhlas. Potvrď okno v claude.ai a klikni znovu.',
    consent_required: 'Hledání potřebuje tvůj souhlas. Potvrď okno v claude.ai a klikni znovu.',
    blocked_by_policy: 'Tvoje organizace tenhle konektor zakázala.',
    server_unavailable: 'Vyhledávač teď neodpovídá. Zkus to za chvíli.',
    upstream_error: 'Vyhledávač teď chyboval. Zkus to za chvíli.',
    rate_limited: 'Příliš mnoho hledání za krátkou dobu. Chvíli počkej.',
    bad_request: 'Aplikace poslala vyhledávači špatně sestavený dotaz.',
    transform_error: 'Aplikace poslala vyhledávači špatně sestavený dotaz.',
    not_granted: 'V tomhle zobrazení stránka ke konektorům přístup nemá.',
    capability_disabled: 'V tomhle zobrazení stránka ke konektorům přístup nemá.',
    capability_removed: 'Tahle verze aplikace Claude konektory nepodporuje. Aktualizuj ji.',
    cancelled: 'Zastaveno.',
    schema: `Konektor ${SERVER} má jiné parametry, než aplikace zná, proto hledání nespouštím.`,
    limit: 'Tahle relace už hledala hodně (pojistka). Obnov stránku a pokračuj.',
    empty: 'Není co hledat: zadej téma.',
    unavailable: 'Hledání na webu není dostupné.',
  };

  function monthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function bumpCount(n) {
    if (!Number.isInteger(n) || n < 1) return;
    const cur = ui.lsGet(COUNT_KEY, null);
    const month = monthKey();
    const base = cur && cur.month === month && Number.isInteger(cur.searches) ? cur : { month, searches: 0 };
    base.searches += n;
    ui.lsSet(COUNT_KEY, base);
  }
  const delay = (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => (clearTimeout(t), reject(err('cancelled', 'Zastaveno.'))), { once: true });
    });

  // ------------------------------------------------------------------ cesta 1: konektor Parallel Search
  const CALL_CACHE = { staleTime: 10 * 60 * 1000, gcTime: 30 * 60 * 1000 };

  async function inputFor(plan) {
    try {
      const d = await web.mcp.describeTool(SERVER, TOOL);
      return { input: WS.buildToolInput(d && d.inputSchema, plan), known: true };
    } catch (e) {
      // Schéma je dostupné až po souhlasu s konektorem. Do té doby se zkusí nejpravděpodobnější tvar.
      return { input: WS.buildToolInput(null, plan), known: false };
    }
  }

  async function searchConnector(plan, o) {
    const first = await inputFor(plan);
    if (!first.input) throw err('schema', MCP_COPY.schema);
    const call = (input) => web.mcp.callTool(SERVER, TOOL, input, { signal: o.signal, cache: CALL_CACHE });
    let res;
    try {
      res = await call(first.input);
    } catch (e) {
      if (e && e.code === 'cancelled') throw err('cancelled', 'Zastaveno.');
      if (e && e.code === 'tool_error' && !first.known) {
        // po souhlasu už jde přečíst schéma: když se liší, zkusí se jednou znovu podle něj
        const second = await inputFor(plan);
        if (second.known && second.input && JSON.stringify(second.input) !== JSON.stringify(first.input)) {
          try {
            res = await call(second.input);
          } catch (e2) {
            throw mapMcp(e2);
          }
        } else throw mapMcp(e);
      } else if (e && e.retryable === true) {
        await delay(Math.min(Math.max(Number(e.retryAfterMs) || 1500, 800), 8000), o.signal);
        try {
          res = await call(first.input);
        } catch (e2) {
          throw mapMcp(e2);
        }
      } else throw mapMcp(e);
    }
    const body = res && res.payload !== undefined && res.payload !== null ? res.payload : res;
    let results = WS.parseSearchPayload(body, 'connector');
    if (!results.length && body !== res) results = WS.parseSearchPayload(res, 'connector');
    const notes = [];
    let unparsed = false;
    if (!results.length && !WS.recognizesShape(body) && !WS.recognizesShape(res)) {
      // odpověď neznámého tvaru (ne „prázdný seznam“): ukáže se začátek, ať jde čtení opravit
      const preview = clip(typeof body === 'string' ? body : safeJson(body), 300);
      if (preview && preview !== 'null' && preview !== '{}' && preview !== '[]') {
        unparsed = true;
        web.lastRaw = preview;
        notes.push('Vyhledávač odpověděl, ale aplikace ve výsledku nenašla žádné použitelné odkazy.');
      }
    }
    if (res && res.cache && res.cache.storedAt) notes.push('Výsledek je z paměti konektoru (starší než pár minut).');
    return { results, notes, unparsed };
  }

  function safeJson(v) {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  function mapMcp(e) {
    if (!e || typeof e !== 'object') return err('upstream_error', String(e || 'Neznámá chyba.'));
    return Object.assign({}, e, { code: typeof e.code === 'string' ? e.code : 'upstream_error', message: typeof e.message === 'string' ? e.message : '' });
  }

  // ------------------------------------------------------------------ cesta 2: web search od Anthropic (vlastní klíč)
  function anthropicPrompt(plan) {
    const qs = plan.queries.slice(0, WS.MAX_QUERIES).map((q) => `- ${q}`).join('\n');
    return (
      `Use the web_search tool for the queries below: one search per query, at most ${Math.min(plan.queries.length, WS.MAX_QUERIES)} searches. ` +
      'Then reply with a short bullet list: for each useful page one bullet saying in a few words what that page says. ' +
      'Write only what the pages say; add nothing from memory.\n\n' +
      `Goal: ${plan.objective}\n\nQueries:\n${qs}`
    );
  }

  const SEARCH_ERRORS = {
    max_uses_exceeded: 'Vyčerpal se počet hledání v jednom dotazu.',
    too_many_requests: 'Anthropic hlásí příliš mnoho hledání najednou, zkus to za chvíli.',
    invalid_tool_input: 'Anthropic odmítl hledaný výraz jako neplatný.',
    query_too_long: 'Hledaný výraz je příliš dlouhý.',
    request_too_large: 'Požadavek na hledání je příliš velký.',
    unavailable: 'Hledání na webu u Anthropic teď neběží, zkus to za chvíli.',
  };

  async function searchAnthropic(plan, o) {
    const r = await FM27.ai.webSearch(anthropicPrompt(plan), { signal: o.signal, modelTier: 'quick', maxUses: Math.min(plan.queries.length, 4) || 3, purpose: 'hledání na webu' });
    const parsed = WS.parseAnthropicResponse(r && r.raw);
    bumpCount(parsed.searches || parsed.queries.length);
    const notes = [];
    if (parsed.paused) notes.push('Anthropic hledání přerušil (pause_turn), výsledky mohou být neúplné.');
    if (parsed.errors.length) notes.push(...[...new Set(parsed.errors)].map((c) => SEARCH_ERRORS[c] || `Hledání vrátilo chybu ${c}.`));
    if (!parsed.results.length && parsed.errors.length) throw err('tool_error', SEARCH_ERRORS[parsed.errors[0]] || `Hledání vrátilo chybu ${parsed.errors[0]}.`);
    return { results: parsed.results, notes };
  }
})();
