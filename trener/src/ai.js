/* AI vrstva aplikace: vybere poskytovatele (stránka Claude `sample`, nebo vlastní klíč v samostatné verzi),
   obalí ho měřením spotřeby a nabídne společné „zeptej se, zkontroluj, jednou oprav“.
   Aplikace volá jen toto rozhraní, takže poskytovatele lze vyměnit bez přepisování obrazovek. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const { lsGet, lsSet } = FM27.ui;

  const LEDGER_KEY = 'fm27.ledger';
  const CONFIG_KEY = 'fm27.aiConfig'; // jen v tomto zařízení; klíč se NIKDY nesynchronizuje do `db`

  const ai = (FM27.ai = {
    base: null, // surový poskytovatel
    ledger: null,
    kind: 'none', // 'claude-sample' | 'anthropic' | 'openai' | 'none'
    problem: '',
    limitsInfo: null,

    /** Samostatná verze uloží nastavení poskytovatele sem; v artefaktu se nepoužije (tam je `sample`).
        Klíč je buď trvale v tomto prohlížeči (localStorage), nebo jen do zavření záložky (sessionStorage). */
    getConfig() {
      try {
        const raw = sessionStorage.getItem(CONFIG_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        /* sessionStorage nemusí být dostupné */
      }
      return lsGet(CONFIG_KEY, null);
    },
    /** Kde je klíč uložen: 'session' (jen do zavření záložky), 'local' (trvale v prohlížeči) nebo 'none'. */
    configWhere() {
      try {
        if (sessionStorage.getItem(CONFIG_KEY)) return 'session';
      } catch (e) {
        /* nic */
      }
      return lsGet(CONFIG_KEY, null) ? 'local' : 'none';
    },
    /** opts.remember === false: klíč se uloží jen do sessionStorage (zmizí se zavřením záložky). */
    setConfig(cfg, opts) {
      const remember = !opts || opts.remember !== false;
      try {
        sessionStorage.removeItem(CONFIG_KEY);
      } catch (e) {
        /* nic */
      }
      try {
        localStorage.removeItem(CONFIG_KEY);
      } catch (e) {
        /* nic */
      }
      if (!cfg) return true;
      if (remember) return lsSet(CONFIG_KEY, cfg);
      try {
        sessionStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
        return true;
      } catch (e) {
        return false;
      }
    },

    async init(app) {
      const P = window.TrenerProviders;
      ai.base = null;
      ai.kind = 'none';
      ai.problem = '';
      if (!P) {
        ai.problem = 'Chybí modul poskytovatelů AI.';
        return ai;
      }
      ai.ledger = P.createLedger({ now: Date.now });
      try {
        const saved = lsGet(LEDGER_KEY, null);
        if (saved) ai.ledger.load(saved);
      } catch (e) {
        /* poškozená historie spotřeby se prostě zahodí */
      }
      if (app.caps.sample) {
        ai.base = P.wrapSample(app.caps.sample);
        ai.kind = 'claude-sample';
      } else {
        const cfg = ai.getConfig();
        if (cfg && cfg.kind && cfg.apiKey) {
          try {
            ai.base = P.createProvider(cfg, { fetch: window.fetch.bind(window) });
            ai.kind = cfg.kind === 'sample' ? 'none' : cfg.kind;
          } catch (e) {
            ai.problem = e && e.message ? e.message : String(e);
          }
        }
      }
      if (ai.base) {
        try {
          ai.limitsInfo = await ai.base.limits();
        } catch (e) {
          ai.limitsInfo = null;
        }
      }
      return ai;
    },

    get available() {
      return !!ai.base;
    },
    /** Umí poskytovatel hledat na webu sám (nástroj web_search u vlastního klíče Anthropic)? */
    get webSearchAvailable() {
      return !!(ai.base && typeof ai.base.webSearch === 'function');
    },
    get imagesSupported() {
      return !!(ai.limitsInfo && ai.limitsInfo.images);
    },
    label() {
      return { 'claude-sample': 'Claude (tato stránka)', anthropic: 'Claude (vlastní klíč)', openai: 'OpenAI-kompatibilní (vlastní klíč)', none: 'žádný' }[ai.kind] || ai.kind;
    },
    saveLedger() {
      if (ai.ledger) lsSet(LEDGER_KEY, ai.ledger.toJSON());
    },
    wrapped(purpose) {
      const P = window.TrenerProviders;
      return P.withLedger(ai.base, ai.ledger, { purpose: purpose || 'ostatní' });
    },
    async json(input, opts) {
      if (!ai.base) throw { code: 'not_granted', message: 'Žádný poskytovatel AI není k dispozici.' };
      try {
        return await ai.wrapped(opts && opts.purpose).json(input, opts);
      } finally {
        ai.saveLedger();
      }
    },
    async text(input, opts) {
      if (!ai.base) throw { code: 'not_granted', message: 'Žádný poskytovatel AI není k dispozici.' };
      try {
        return await ai.wrapped(opts && opts.purpose).text(input, opts);
      } finally {
        ai.saveLedger();
      }
    },
    /** Hledání na webu přes poskytovatele (jen vlastní klíč Anthropic). Vrací {text, truncated, raw}. */
    async webSearch(input, opts) {
      if (!ai.webSearchAvailable) throw { code: 'invalid_request', message: 'Tenhle poskytovatel AI neumí hledat na webu.' };
      try {
        return await ai.wrapped((opts && opts.purpose) || 'hledání na webu').webSearch(input, opts);
      } finally {
        ai.saveLedger();
      }
    },

    /** Společné pro každou odpověď, která má schéma a kontrolu poctivosti:
        zeptá se, zkontroluje, a když kontrola neprojde, jednou požádá o opravu.
        o: {turns, validate(value) → {ok, errors, warnings, …}, tier, images, signal, purpose, onStep(step, state, note), buildRepair?}
        Vrací {status: 'ok'|'needs_more_info', value, verdict}. Chyby poskytovatele se vyhazují dál (volající je zobrazí). */
    async structured(o) {
      const step = o.onStep || (() => {});
      const callOpts = (withImages) => ({
        modelTier: o.tier || 'default',
        signal: o.signal,
        cache: false,
        images: withImages && o.images && o.images.length ? o.images : undefined,
        purpose: o.purpose,
        onText: ({ text }) => step('ask', 'run', `${text.length} znaků`),
      });
      step('ask', 'run');
      let value = null;
      let raw = null;
      let verdict;
      try {
        value = await ai.json(o.turns, callOpts(true));
      } catch (e) {
        if (e && e.code === 'invalid_json') raw = e.text || '';
        else throw e;
      }
      step('ask', 'done');
      step('check', 'run');
      verdict = value !== null ? o.validate(value) : { ok: false, errors: ['Odpověď nebyla platný JSON objekt podle uvedeného tvaru.'], warnings: [] };
      step('check', verdict.ok ? 'done' : 'fail', verdict.ok ? 'prošla' : `${verdict.errors.length} výhrad`);
      if (verdict.ok || o.repair === false) return { status: verdict.ok ? 'ok' : 'needs_more_info', value, verdict };

      step('repair', 'run');
      const echoed = raw !== null && raw !== '' ? raw : JSON.stringify(value);
      try {
        value = await ai.json(C.buildRepairTurns(o.turns, echoed, verdict.errors), callOpts(false));
        verdict = o.validate(value);
        step('repair', verdict.ok ? 'done' : 'fail', verdict.ok ? 'opraveno' : 'dál nesplňuje pravidla');
      } catch (e) {
        if (e && e.code === 'invalid_json') {
          verdict = { ok: false, errors: ['Opravená odpověď nebyla platný JSON.'], warnings: [] };
          value = null;
          step('repair', 'fail');
        } else throw e;
      }
      return { status: verdict.ok ? 'ok' : 'needs_more_info', value: verdict.ok ? value : null, verdict };
    },
  });

  // Hlášky pro kódy chyb poskytovatelů. Stejné kódy má schopnost `sample` i adaptéry v providers.js.
  ai.ERROR_COPY = {
    not_granted: 'Claude pro tuhle stránku není povolený (nebo chybí platný klíč). Bez toho trenér radit nemůže.',
    sampling_disabled: 'Claude není pro tvůj účet nebo organizaci dostupný.',
    not_declared: 'Stránka už nemá povolené volání Claude.',
    capability_disabled: 'Volání Claude tady teď nejde použít.',
    capability_removed: 'Tahle verze aplikace Claude volání nepodporuje. Aktualizuj ji.',
    rate_limited: 'Dosáhl jsi limitu využití Claude. Zkus to později.',
    session_expired: 'Přihlášení vypršelo. Přihlas se znovu do Claude.',
    refused: 'Claude tuhle žádost odmítl zpracovat. Zkus ji přeformulovat.',
    empty_completion: 'Claude nevrátil žádný text. Zkus to znovu s kratším zadáním.',
    prompt_too_large: 'Zadání je příliš dlouhé. Zkrať pozorování nebo odeber plán.',
    image_rejected: 'Obrázek Claude nepřijal (typ nebo velikost). Zkus jiný.',
    images_unavailable: 'Obrázky tady nejdou poslat.',
    upstream_error: 'Služba Claude teď chybovala. Zkus to za chvíli.',
    invalid_request: 'Žádost měla špatný tvar. Zkus to znovu.',
    network_error: 'Spojení se službou se nepovedlo. Zkontroluj připojení k internetu.',
    cancelled: 'Zastaveno.',
  };
  /** U vlastního klíče je nejužitečnější hláška samotného adaptéru (česky, bez klíče, s číslem HTTP): řekne, co poskytovatel
      odmítl. Obecné věty o „stránce v Claude“ by tam mátly. */
  const OWN_KEY_KINDS = ['anthropic', 'openai', 'openai-compatible'];
  const OWN_KEY_CODES = ['not_granted', 'rate_limited', 'upstream_error', 'invalid_request', 'prompt_too_large'];
  ai.errorText = (e) => {
    if (e && OWN_KEY_KINDS.includes(ai.kind) && OWN_KEY_CODES.includes(e.code) && typeof e.message === 'string' && e.message.trim()) {
      return e.message.trim().replace(/[.\s]+$/, '') + (e.code === 'not_granted' ? '. Zkontroluj klíč v Nastavení v kartě „Vlastní klíč AI“.' : '.');
    }
    return (e && ai.ERROR_COPY[e.code]) || `Neočekávaná chyba (${(e && (e.code || e.message)) || 'neznámá'}).`;
  };
  /** Po těchto chybách nemá smysl nabízet „Zkusit znovu“. */
  ai.NO_RETRY = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'prompt_too_large', 'session_expired', 'rate_limited'];
})();
