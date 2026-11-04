/* FM27 Tactical Coach: analýza zápasu bez DOM (časová osa ze snímků, detektory, vyhodnocení změny, brána snímků).
   Běží v prohlížeči (window.TrenerAnalysis) i v Node (module.exports). Kontrakt: docs/ARCHITEKTURA_V2.md, oddíl 5.2.

   Pravidla poctivosti (oddíl 3 architektury):
   - Čtení z obrazu je VŽDY neověřené (vision_unverified), dokud ho uživatel nepotvrdí nebo nezadá sám.
   - Statistiky v zápase jsou kumulativní součty od začátku (držení míče a přesnost přihrávek jsou procenta),
     tempo v okně se proto počítá z rozdílů dvou snímků.
   - Prahy jsou heuristiky této aplikace, ne pravidla FM27. Aplikace neví, jak funguje match engine FM27, a nic o něm netvrdí.
   - Statistická odchylka není taktický problém: nálezy mluví o „možné příčině k ověření“, ne o diagnóze.
   - Časová souvislost není důkaz příčiny: vyhodnocení změny je jen popisné. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerAnalysis = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  // Úrovně důvěry a štítky původu jsou jen v core.js; kopie by časem rozjela pravidla poctivosti.
  if (!core || !core.LABEL_TO_TIER || !core.fold) throw new Error('analysis.js potřebuje core.js (TrenerCore) načtený před sebou.');

  // ---------------------------------------------------------------- konstanty
  const STAT_KEYS = ['possession', 'shots', 'shotsOnTarget', 'xg', 'passes', 'passAccuracy', 'tackles', 'fouls', 'corners', 'offsides', 'saves'];
  const PERCENT_KEYS = ['possession', 'passAccuracy']; // nejsou kumulativní součty: rozdíl dvou snímků by nedával smysl jako tempo
  const CUMULATIVE_KEYS = STAT_KEYS.filter((k) => !PERCENT_KEYS.includes(k));
  const SCREENS = ['match', 'stats', 'tactics', 'squad', 'analysis', 'other', 'unknown'];
  const EVENT_TYPES = ['goal', 'yellow', 'red', 'sub', 'injury', 'other'];
  const PROVENANCES = ['vision_unverified', 'screenshot_verified', 'user_entered'];
  const SIDES = ['home', 'away'];

  // Rozsahy záměrně nechávají místo pro skutečný zápas; mají zachytit nesmysly z čtení obrazu
  // (záměna sloupců, slepená čísla, procenta místo součtů), ne omezovat hru. Mimo rozsah = null + zápis do issues.
  const STAT_RANGES = {
    possession: { min: 0, max: 100, integer: false }, // procento
    shots: { min: 0, max: 60, integer: true },
    shotsOnTarget: { min: 0, max: 40, integer: true },
    xg: { min: 0, max: 10, integer: false },
    passes: { min: 0, max: 1500, integer: true },
    passAccuracy: { min: 0, max: 100, integer: false }, // procento
    tackles: { min: 0, max: 80, integer: true },
    fouls: { min: 0, max: 50, integer: true },
    corners: { min: 0, max: 30, integer: true },
    offsides: { min: 0, max: 20, integer: true },
    saves: { min: 0, max: 40, integer: true },
  };
  const MINUTE_MAX = 130; // 90 min + nastavení + prodloužení s rezervou
  const SCORE_MAX = 30;
  const RATING_MAX = 10;
  const MAX_EVENTS = 40;
  const MAX_VISIBLE = 12;
  const MAX_PLAYERS = 30;
  const LIMITS = { name: 60, eventText: 120, visible: 80, notes: 300 };

  // Prahy detektorů a vyhodnocení. Jsou to heuristiky této aplikace, ne pravidla FM27; každý nález je cituje v `basis`.
  const DEFAULT_THRESHOLDS = Object.freeze({
    minSpanMinutes: 10, // 'alert' chce aspoň dva snímky s tímto odstupem: jedno měření ani krátký výkyv není trend
    possessionHigh: 58, // naše držení (%), od kterého hledáme „držení bez šancí“; pod tím je rozdíl držení příliš malý
    chanceShareLow: 0.4, // náš podíl střel/xG pod touto hodnotou = držení se nepromění v šance
    minChanceShots: 6, // součet střel obou týmů, od kterého podíl střel posuzujeme (pod tím rozhoduje náhoda)
    minChanceXg: 0.6, // totéž pro součet xG obou týmů
    dominanceRatio: 1.8, // soupeř má aspoň tolikrát víc střel nebo xG než my
    dominanceMinShots: 3, // ... a aspoň tolik střel (poměr 1:0 nebo 2:1 nic neříká)
    trendRatio: 2, // soupeřovy střely na 10 min v posledním okně vůči předchozímu oknu
    trendMinShots: 3, // v posledním okně aspoň tolik soupeřových střel (z 0 na 1 není trend)
    trailingFromMinute: 60, // od jaké minuty hlídáme „prohráváme a nehrozíme“
    ratingDrop: 0.8, // pokles hodnocení hráče mezi snímky
    lookbackMinutes: 20, // evaluateChange: délka okna před změnou
    minAfterMinutes: 8, // evaluateChange: nejméně minut mezi dvěma snímky po změně
    similarBand: 0.15, // evaluateChange: relativní pásmo „similar“ (±15 %)
    similarPp: 1, // evaluateChange: pásmo „similar“ pro změnu držení v procentních bodech
    smallSampleShots: 6, // evaluateChange: součet střel obou týmů v okně, pod kterým upozorníme na malý vzorek
    shortWindowMinutes: 15, // evaluateChange: okno kratší než tohle označíme jako krátké
    periodMinutes: 15, // summarizeMatch: výchozí délka období
  });

  // Pevná věta (zadání § 11). Žádný text této knihovny netvrdí příčinu změny.
  const CAUSALITY_NOTE =
    'Časová souvislost není důkaz příčiny: rozdíl před a po změně může mít i jiné vysvětlení (stav zápasu, střídání, ' +
    'změna soupeře, náhoda), proto ho nelze připsat změně.';

  // ---------------------------------------------------------------- drobné pomůcky
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const round = (v, d) => {
    const f = 10 ** d;
    return Math.round(v * f) / f;
  };
  const other = (side) => (side === 'home' ? 'away' : 'home');
  const asSide = (v) => (v === 'home' || v === 'away' ? v : null);
  const clip = (v, n) => String(v).replace(/\s+/g, ' ').trim().slice(0, n);
  const fmt = (v) => String(round(v, 1)).replace('.', ',');
  const pct = (v) => `${Math.round(v * 100)} %`;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const findLast = (arr, pred) => {
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
    return null;
  };

  function unknownKeys(obj, allowed, where, issues) {
    const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
    if (extra.length) issues.push(`${where}: neznámá pole zahozena (${extra.slice(0, 5).map((k) => clip(k, 30)).join(', ')}${extra.length > 5 ? ', …' : ''}).`);
  }

  /** Číslo v rozsahu, jinak null a zápis do issues. Řetězce se nepřevádějí: model má vracet čísla. */
  function cleanNumber(v, label, min, max, integer, issues) {
    if (v === null || v === undefined) return null;
    if (!isNum(v)) {
      issues.push(`${label}: hodnota není číslo (${typeof v}), nahrazeno null.`);
      return null;
    }
    if (v < min || v > max) {
      issues.push(`${label}: ${v} je mimo rozsah ${min}–${max}, nahrazeno null.`);
      return null;
    }
    if (integer && !Number.isInteger(v)) {
      issues.push(`${label}: ${v} není celé číslo, nahrazeno null.`);
      return null;
    }
    return v;
  }

  // ---------------------------------------------------------------- prompt pro čtení snímku
  function buildExtractionPrompt(opts) {
    const o = opts || {};
    const side = asSide(o.mySide);
    const lines = [
      'Jsi čtečka snímku obrazovky pro FM27 Tactical Coach. Dostaneš jeden snímek ze hry Football Manager. Úkol: popsat JEN to, co je na snímku opravdu čitelné. Nic neanalyzuješ, neradíš a nehodnotíš.',
      '',
      'Pravidla (platí bez výjimky):',
      '1. Co na snímku není čitelné, MUSÍ být null. Nikdy neodhaduj a nedopočítávej (žádné součty, rozdíly ani procenta) a nic nedoplňuj z paměti nebo z obecných znalostí o fotbale či o hře.',
      '2. Statistiky přepiš tak, jak jsou zobrazené: jsou to kumulativní součty od začátku zápasu (držení míče je procento 0–100, píšeš jen číslo bez znaku %). Nepřepočítávej je na tempo.',
      '3. Když popisek nejasně říká, co číslo znamená, nebo je hodnota oříznutá či nečitelná, vrať null. Názvy ve hře se mohou lišit; přiřaď hodnotu ke klíči jen tehdy, když je její význam z popisku jasný.',
      '4. minute: celé číslo (nastavení 90+3 zapiš jako 93). Je-li minuta zápasu na snímku nejasná nebo tam není, vrať null.',
      '5. Domácí (home) a hosty (away) urči jen podle toho, co je na snímku výslovně vidět. Není-li jasné, který tým je který, vrať null (u teams i u team v událostech).',
      '6. NEODHADUJ hodnoty z heat map, průměrných pozic, map přihrávek ani střel, z pozic hráčů na hřišti ani z rolí a povinností: to nech na člověku. Názvy rolí, instrukcí a nastavení FM27 nedoplňuj z paměti: přepiš jen přesný viditelný text (do visibleText), jinak nic.',
      '7. Nic netvrď o tom, jak funguje herní engine FM27. Žádná diagnóza, žádné doporučení.',
      '8. Události (events) uveď jen ty, které jsou na snímku skutečně vypsané. type zařaď jen tehdy, když je z textu zřejmý, jinak "other".',
      '9. Snímek, který není z Football Manageru nebo je nečitelný: screen "unknown", ostatní null nebo prázdné.',
    ];
    const ctx = [];
    if (side) ctx.push(`Uživatel hraje za ${side === 'home' ? 'domácí' : 'hostující'} tým. Je to jen kontext, nesmí to změnit, co čteš.`);
    else ctx.push('Strana uživatele (domácí/hosté) není známa: nic nepředpokládej.');
    if (isNum(o.knownMinute) && o.knownMinute >= 0 && o.knownMinute <= MINUTE_MAX) {
      ctx.push(
        `Aplikace čeká, že zápas je zhruba v ${Math.round(o.knownMinute)}. minutě (nápověda z dřívějšího snímku, NENÍ to fakt o tomto snímku). Do minute zapiš jen to, co je na snímku vidět; nepřepisuj tuto nápovědu.`
      );
    }
    lines.push('', ...ctx, '');
    lines.push(
      'Klíče statistik (stats.home a stats.away, každý číslo nebo null):',
      '- possession: držení míče v % (0–100)',
      '- shots: střely celkem',
      '- shotsOnTarget: střely na bránu',
      '- xg: očekávané góly (xG), desetinné číslo; neuvádí-li je snímek, null',
      '- passes: počet přihrávek, tak jak je uvedeno',
      '- passAccuracy: úspěšnost přihrávek v % (0–100)',
      '- tackles: počet odebrání míče v soubojích, tak jak je uvedeno',
      '- fouls: fauly',
      '- corners: rohy',
      '- offsides: ofsajdy',
      '- saves: zákroky brankáře',
      '',
      'Odpověz POUZE jedním JSON objektem (žádný text kolem, žádné zástupné hodnoty), přesně v tomto tvaru:',
      '{',
      '  "screen": "match" | "stats" | "tactics" | "squad" | "analysis" | "other" | "unknown",',
      '  "minute": celé číslo | null,',
      '  "score": {"home": celé číslo, "away": celé číslo} | null,',
      '  "teams": {"home": "název" | null, "away": "název" | null},',
      `  "stats": {"home": {${STAT_KEYS.map((k) => `"${k}": číslo | null`).join(', ')}}, "away": {stejné klíče}},`,
      '  "events": [{"minute": celé číslo | null, "type": "goal" | "yellow" | "red" | "sub" | "injury" | "other", "team": "home" | "away" | null, "text": "krátký doslovný text"}],',
      '  "visibleText": ["doslovné krátké řetězce, které čteš, nejvýš 12"],',
      '  "notes": "krátká poznámka o čitelnosti snímku"',
      '}'
    );
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- snímek: čištění, normalizace, řazení
  function emptyStats() {
    const o = {};
    for (const k of STAT_KEYS) o[k] = null;
    return o;
  }

  function cleanScore(v, issues) {
    if (v === null || v === undefined) return null;
    if (!isObj(v)) {
      issues.push('score: není objekt, nahrazeno null.');
      return null;
    }
    const home = cleanNumber(v.home, 'score.home', 0, SCORE_MAX, true, issues);
    const away = cleanNumber(v.away, 'score.away', 0, SCORE_MAX, true, issues);
    if (home === null || away === null) {
      if (home !== null || away !== null) issues.push('score: je čitelná jen jedna strana, celé skóre nahrazeno null.');
      return null;
    }
    return { home, away };
  }

  function cleanTeams(v, issues) {
    if (v === null || v === undefined) return null;
    if (!isObj(v)) {
      issues.push('teams: není objekt, nahrazeno null.');
      return null;
    }
    const name = (x, label) => {
      if (x === null || x === undefined) return null;
      if (typeof x !== 'string') {
        issues.push(`${label}: není text, nahrazeno null.`);
        return null;
      }
      return clip(x, LIMITS.name) || null;
    };
    const home = name(v.home, 'teams.home');
    const away = name(v.away, 'teams.away');
    return home || away ? { home, away } : null;
  }

  function cleanStats(v, issues) {
    const out = { home: emptyStats(), away: emptyStats() };
    if (v === null || v === undefined) return out;
    if (!isObj(v)) {
      issues.push('stats: není objekt, ignorováno.');
      return out;
    }
    unknownKeys(v, SIDES, 'stats', issues);
    for (const side of SIDES) {
      const s = v[side];
      if (s === null || s === undefined) continue;
      if (!isObj(s)) {
        issues.push(`stats.${side}: není objekt, ignorováno.`);
        continue;
      }
      unknownKeys(s, STAT_KEYS, `stats.${side}`, issues);
      for (const k of STAT_KEYS) {
        const r = STAT_RANGES[k];
        out[side][k] = cleanNumber(s[k], `stats.${side}.${k}`, r.min, r.max, r.integer, issues);
      }
    }
    // Souvislosti: jen upozornění, hodnoty se tiše neopravují (nevíme, která z nich je špatně).
    const ph = out.home.possession;
    const pa = out.away.possession;
    if (ph !== null && pa !== null && (ph + pa > 105 || ph + pa < 95)) {
      issues.push(`stats: součet držení míče obou týmů je ${round(ph + pa, 1)} % (čekáme kolem 100 %), čtení je podezřelé; hodnoty zůstaly beze změny.`);
    }
    for (const side of SIDES) {
      const { shots, shotsOnTarget } = out[side];
      if (shots !== null && shotsOnTarget !== null && shotsOnTarget > shots) {
        issues.push(`stats.${side}: střel na bránu (${shotsOnTarget}) je víc než střel celkem (${shots}), čtení je podezřelé; hodnoty zůstaly beze změny.`);
      }
    }
    return out;
  }

  function cleanEvents(v, issues) {
    if (v === null || v === undefined) return [];
    if (!Array.isArray(v)) {
      issues.push('events: není pole, ignorováno.');
      return [];
    }
    const out = [];
    const seen = new Set();
    for (let i = 0; i < v.length; i++) {
      if (out.length >= MAX_EVENTS) {
        issues.push(`events: nad ${MAX_EVENTS} událostí, zbytek zahozen.`);
        break;
      }
      const e = v[i];
      if (!isObj(e)) {
        issues.push(`events[${i}]: není objekt, zahozeno.`);
        continue;
      }
      unknownKeys(e, ['minute', 'type', 'team', 'text'], `events[${i}]`, issues);
      let type = e.type;
      if (!EVENT_TYPES.includes(type)) {
        if (type !== undefined && type !== null) issues.push(`events[${i}]: neznámý typ „${clip(type, 20)}“, použito „other“.`);
        type = 'other';
      }
      let team = e.team;
      if (team !== 'home' && team !== 'away') {
        if (team !== undefined && team !== null) issues.push(`events[${i}]: neznámý tým „${clip(team, 20)}“, nahrazeno null.`);
        team = null;
      }
      const minute = cleanNumber(e.minute, `events[${i}].minute`, 0, MINUTE_MAX, true, issues);
      const text = typeof e.text === 'string' ? clip(e.text, LIMITS.eventText) : '';
      if (type === 'other' && !text && minute === null) {
        issues.push(`events[${i}]: prázdná událost, zahozeno.`);
        continue;
      }
      const key = `${minute}|${type}|${team}|${core.fold(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ minute, type, team, text });
    }
    return out;
  }

  function cleanVisibleText(v, issues) {
    if (v === null || v === undefined) return [];
    if (!Array.isArray(v)) {
      issues.push('visibleText: není pole, ignorováno.');
      return [];
    }
    const out = [];
    for (const t of v) {
      if (typeof t !== 'string') continue;
      const s = clip(t, LIMITS.visible);
      if (!s || out.includes(s)) continue;
      if (out.length >= MAX_VISIBLE) {
        issues.push(`visibleText: nad ${MAX_VISIBLE} řetězců, zbytek zahozen.`);
        break;
      }
      out.push(s);
    }
    return out;
  }

  function cleanPlayers(v, issues) {
    if (v === null || v === undefined) return [];
    if (!Array.isArray(v)) {
      issues.push('players: není pole, ignorováno.');
      return [];
    }
    const out = [];
    for (let i = 0; i < v.length && out.length < MAX_PLAYERS; i++) {
      const p = v[i];
      const name = isObj(p) && typeof p.name === 'string' ? clip(p.name, LIMITS.name) : '';
      if (!name) {
        issues.push(`players[${i}]: chybí jméno, zahozeno.`);
        continue;
      }
      const rating = cleanNumber(p.rating, `players[${i}].rating`, 0, RATING_MAX, false, issues);
      if (rating !== null) out.push({ name, rating });
    }
    return out;
  }

  /** Společné čištění polí snímku (odpověď modelu i ruční zadání). Nikdy nevyhazuje výjimku. */
  function sanitize(raw, issues) {
    const r = isObj(raw) ? raw : {};
    let screen = r.screen;
    if (screen === 'unknown') screen = 'other'; // datový model snímku „unknown“ nezná
    else if (!SCREENS.includes(screen)) {
      if (screen !== undefined && screen !== null) issues.push(`screen: neznámá hodnota „${clip(screen, 30)}“, použito „other“.`);
      screen = 'other';
    }
    return {
      screen,
      minute: cleanNumber(r.minute, 'minute', 0, MINUTE_MAX, true, issues),
      score: cleanScore(r.score, issues),
      teams: cleanTeams(r.teams, issues),
      stats: cleanStats(r.stats, issues),
      events: cleanEvents(r.events, issues),
      visibleText: cleanVisibleText(r.visibleText, issues),
      players: cleanPlayers(r.players, issues),
      notes: typeof r.notes === 'string' ? clip(r.notes, LIMITS.notes) : '',
    };
  }

  function cleanId(id, at) {
    if (typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(id)) return id;
    return `s${isNum(at) ? Math.max(0, Math.trunc(at)) : 0}`; // deterministické, bez náhody
  }

  /** Snímek z (volných) polí. Provenance: neznámá nebo chybějící = nejslabší, tedy vision_unverified.
      Neplatné hodnoty se nahradí null; důvody se přidají do opts.issues, je-li zadáno. */
  function makeSnapshot(fields, opts) {
    const issues = opts && Array.isArray(opts.issues) ? opts.issues : [];
    const f = isObj(fields) ? fields : {};
    const c = sanitize(f, issues);
    const at = isNum(f.at) ? f.at : 0;
    return {
      id: cleanId(f.id, at),
      at,
      minute: c.minute,
      score: c.score,
      screen: c.screen,
      stats: c.stats,
      events: c.events,
      provenance: PROVENANCES.includes(f.provenance) ? f.provenance : 'vision_unverified',
      notes: c.notes,
      teams: c.teams, // rozšíření datového modelu: pomáhá uživateli ověřit, co se četlo
      visibleText: c.visibleText, // totéž
      players: c.players, // volitelné hodnocení hráčů pro detektor rating_drop
    };
  }

  const EXTRACTION_KEYS = ['screen', 'minute', 'score', 'teams', 'stats', 'events', 'visibleText', 'notes', 'players'];

  /** Přísná kontrola odpovědi modelu. Provenance je VŽDY 'vision_unverified' (model si ji nesmí nastavit sám).
      Snímek je null, když vstup není objekt nebo na něm není jediná čitelná hodnota. */
  function normalizeExtraction(raw, ctx) {
    const issues = [];
    if (!isObj(raw)) {
      const kind = Array.isArray(raw) ? 'pole' : raw === null ? 'null' : typeof raw;
      issues.push(`Odpověď modelu není JSON objekt (${kind}), snímek nevznikl.`);
      return { snapshot: null, issues };
    }
    unknownKeys(raw, EXTRACTION_KEYS, 'odpověď', issues);
    const c = sanitize(raw, issues);
    const readable =
      c.minute !== null ||
      c.score !== null ||
      c.teams !== null ||
      c.events.length > 0 ||
      c.players.length > 0 ||
      STAT_KEYS.some((k) => c.stats.home[k] !== null || c.stats.away[k] !== null);
    if (!readable) {
      issues.push('Na snímku nebyla přečtena žádná hodnota (minuta, skóre, týmy, statistika, událost ani hodnocení), snímek nevznikl.');
      return { snapshot: null, issues };
    }
    const meta = ctx || {};
    const snapshot = makeSnapshot(Object.assign({}, c, { id: meta.id, at: meta.at, provenance: 'vision_unverified' }));
    return { snapshot, issues };
  }

  /** Nová řazená kopie: podle minuty, pak času pořízení, pak id. Snímky bez minuty jdou na konec (v čase nejsou k použití). */
  function sortTimeline(list) {
    const arr = Array.isArray(list) ? list.filter(isObj) : [];
    const minute = (s) => (isNum(s.minute) ? s.minute : Infinity);
    const at = (s) => (isNum(s.at) ? s.at : 0);
    return arr.slice().sort((a, b) => {
      const dm = minute(a) === minute(b) ? 0 : minute(a) < minute(b) ? -1 : 1;
      return dm || at(a) - at(b) || cmp(String(a.id), String(b.id));
    });
  }

  // ---------------------------------------------------------------- časová osa: okno a rozdíly kumulativních statistik
  const usable = (timeline) => sortTimeline(timeline).filter((s) => isNum(s.minute));
  const stat = (s, side, key) => {
    const v = s && s.stats && s.stats[side] && s.stats[side][key];
    return isNum(v) ? v : null;
  };
  const hasStats = (s) => STAT_KEYS.some((k) => stat(s, 'home', k) !== null || stat(s, 'away', k) !== null);
  const sideStats = (s, side) => {
    const o = {};
    for (const k of STAT_KEYS) o[k] = stat(s, side, k);
    return o;
  };
  const mergeThresholds = (o) => Object.assign({}, DEFAULT_THRESHOLDS, o && o.thresholds);

  /** Úroveň podkladů je úroveň nejslabšího snímku: 'observed' jen když jsou VŠECHNY snímky screenshot_verified,
      'user_entered' když jsou ověřené nebo zadané ručně a aspoň jeden je zadaný ručně (číslo, které uživatel napsal, není
      ověřený snímek), jinak 'inferred' (strojové čtení nebo neznámý původ). */
  function tierOf(snaps) {
    if (!snaps.length) return 'inferred';
    let weakest = 'observed';
    for (const s of snaps) {
      const t = core.LABEL_TO_TIER[s.provenance];
      if (t === 'user_entered') weakest = 'user_entered';
      else if (t !== 'observed') return 'inferred';
    }
    return weakest;
  }
  const TIER_ORDER = { inferred: 0, user_entered: 1, observed: 2 };
  const weakerTier = (a, b) => (TIER_ORDER[a] <= TIER_ORDER[b] ? a : b);
  /** Věta o podkladech nálezu pro model (pozorování): co přesně se na čísla dívalo. */
  const TIER_BASIS_CS = { observed: 'podloženo ověřenými snímky', user_entered: 'podloženo údaji zadanými ručně (ne ověřeným snímkem)', inferred: 'podloženo neověřeným čtením z obrazu' };

  /** Tempo a podíly v okně [fromMinute, toMinute] z rozdílu prvního a posledního snímku se statistikami v okně.
      Okno začínající v minutě ≤ 0 používá jako výchozí stav začátek zápasu (kumulativní součty jsou tam nula),
      takže stačí jediný snímek. Jinak jsou potřeba dva snímky v různých minutách, jinak null.
      Záporný rozdíl kumulativní hodnoty (snímky si neodpovídají) se nepočítá a zapíše do warnings.
      Držení míče není součet: vracíme jeho první a poslední hodnotu a rozdíl v procentních bodech. */
  function windowStats(timeline, fromMinute, toMinute, opts) {
    const mySide = asSide(opts && opts.mySide);
    if (!isNum(fromMinute) || !isNum(toMinute) || fromMinute > toMinute) return null;
    const snaps = usable(timeline).filter((s) => s.minute >= fromMinute && s.minute <= toMinute && hasStats(s));
    if (!snaps.length) return null;
    const end = snaps[snaps.length - 1];
    const kickoff = fromMinute <= 0;
    const base = kickoff ? null : snaps[0];
    const startMinute = kickoff ? 0 : base.minute;
    const minutes = end.minute - startMinute;
    if (!(minutes > 0)) return null;
    const warnings = [];
    const sides = {};
    for (const side of SIDES) {
      const totals = {};
      const rates = {};
      for (const k of CUMULATIVE_KEYS) {
        const e = stat(end, side, k);
        const b = kickoff ? 0 : stat(base, side, k);
        let d = e === null || b === null ? null : round(e - b, 3);
        if (d !== null && d < 0) {
          warnings.push(`${side}.${k}: kumulativní hodnota klesla z ${b} na ${e}, snímky si neodpovídají; tempo se nepočítá.`);
          d = null;
        }
        totals[k] = d;
        rates[k] = d === null ? null : round((d / minutes) * 10, 3);
      }
      const pStart = kickoff ? null : stat(base, side, 'possession');
      const pEnd = stat(end, side, 'possession');
      sides[side] = {
        totals,
        rates,
        share: {},
        possession: { start: pStart, end: pEnd, changePp: pStart === null || pEnd === null ? null : round(pEnd - pStart, 2) },
        last: sideStats(end, side), // kumulativní hodnoty na posledním snímku okna
      };
    }
    for (const side of SIDES) {
      for (const k of ['shots', 'shotsOnTarget', 'xg']) {
        const mine = sides[side].totals[k];
        const theirs = sides[other(side)].totals[k];
        sides[side].share[k] = mine === null || theirs === null || mine + theirs <= 0 ? null : round(mine / (mine + theirs), 4);
      }
    }
    const used = kickoff ? [end] : [base, end];
    return {
      fromMinute: startMinute,
      toMinute: end.minute,
      minutes,
      kickoff,
      snapshots: used.map((s) => s.id),
      home: sides.home,
      away: sides.away,
      mine: mySide ? sides[mySide] : null,
      opp: mySide ? sides[other(mySide)] : null,
      evidenceTier: tierOf(used),
      warnings,
    };
  }

  // ---------------------------------------------------------------- detektory
  // Každý detektor je heuristika. Nález bez dvou snímků s odstupem ≥ minSpanMinutes je nejvýš 'watch' a říká, že jde o jedno měření.
  const ONE_MEASUREMENT = 'Jde o jedno měření (jeden snímek), ne o trend: sleduj další snímky.';

  function sampleNote(snaps, T) {
    if (snaps.length < 2) return ONE_MEASUREMENT;
    const span = snaps[snaps.length - 1].minute - snaps[0].minute;
    return span >= T.minSpanMinutes
      ? ''
      : `Snímky jsou od sebe jen ${span} min (pro upozornění je potřeba aspoň ${T.minSpanMinutes}), takže jde prakticky o jedno měření a nález je předběžný.`;
  }

  /** Složí nález. 'alert' jen když ho detektor dovolí (wantAlert), jsou aspoň dva snímky a jejich odstup je ≥ minSpanMinutes. */
  function makeFinding(c, kind, snaps, wantAlert, parts) {
    const last = snaps[snaps.length - 1];
    const span = last.minute - snaps[0].minute;
    const alert = !!wantAlert && snaps.length >= 2 && span >= c.T.minSpanMinutes;
    const note = alert
      ? `Opírá se o snímky z minut ${snaps.map((s) => s.minute).join(', ')} (odstup ${span} min).`
      : parts.note !== undefined
        ? parts.note
        : sampleNote(snaps, c.T);
    return {
      id: parts.id || `${kind}:${last.id}`,
      // Epizoda: tentýž trvající stav na dalších snímcích je pořád jeden nález (hlásí se jednou, ne při každém snímku).
      episode: parts.episode || parts.id || kind,
      kind,
      severity: alert ? 'alert' : 'watch',
      title: parts.title,
      text: [parts.text, note].filter(Boolean).join(' '),
      evidence: snaps.map((s) => s.id),
      metrics: Object.assign({ snapshots: snaps.length, spanMinutes: span }, parts.metrics),
      evidenceTier: tierOf(snaps),
      basis: parts.basis,
      minute: last.minute,
      at: null,
    };
  }

  /** Detektor nad kumulativními součty: spouští ho poslední snímek s daty, 'alert' jen když stejný stav platil i na snímku
      starším aspoň minSpanMinutes (trvá, není to výkyv). test(snímek) → null (chybí data) | {triggered, …}. */
  function totalDetector(c, kind, test, describe) {
    let b = null;
    let rb = null;
    for (let i = c.snaps.length - 1; i >= 0 && !b; i--) {
      const r = test(c.snaps[i]);
      if (r) {
        b = c.snaps[i];
        rb = r;
      }
    }
    if (!b || !rb.triggered) return null;
    let p = null;
    let checked = null;
    for (let i = c.snaps.length - 1; i >= 0 && !p; i--) {
      const s = c.snaps[i];
      if (s.minute > b.minute - c.T.minSpanMinutes) continue;
      const r = test(s);
      if (!r) continue;
      checked = checked || s;
      if (r.triggered) p = s;
    }
    const parts = describe(b, rb);
    if (!p && checked) parts.note = `Dřívější snímek (min. ${checked.minute}) tento stav nepotvrzuje, takže jde zatím o jedno měření (výkyv z jednoho snímku).`;
    return makeFinding(c, kind, p ? [p, b] : [b], !!p, parts);
  }

  function detectPossession(c) {
    const T = c.T;
    const test = (s) => {
      const m = sideStats(s, c.mySide);
      const o = sideStats(s, other(c.mySide));
      if (m.possession === null) return null;
      const shotsTotal = m.shots !== null && o.shots !== null ? m.shots + o.shots : 0;
      const xgTotal = m.xg !== null && o.xg !== null ? m.xg + o.xg : 0;
      const shotShare = shotsTotal >= T.minChanceShots ? m.shots / shotsTotal : null;
      const xgShare = xgTotal >= T.minChanceXg ? m.xg / xgTotal : null;
      const shares = [shotShare, xgShare].filter((x) => x !== null);
      if (!shares.length) return null; // bez dost střel i xG se podíl neposuzuje
      const triggered = m.possession >= T.possessionHigh && shares.every((x) => x < T.chanceShareLow);
      return { triggered, possession: m.possession, shotShare, xgShare, shots: [m.shots, o.shots], xg: [m.xg, o.xg] };
    };
    return totalDetector(c, 'possession_without_chances', test, (b, r) => {
      const parts = [`držíme míč ${fmt(r.possession)} %`];
      if (r.shotShare !== null) parts.push(`náš podíl střel je ${pct(r.shotShare)} (${r.shots[0]}:${r.shots[1]})`);
      if (r.xgShare !== null) parts.push(`podíl xG ${pct(r.xgShare)}`);
      return {
        title: 'Držení míče bez šancí',
        text:
          `Podle snímku z ${b.minute}. minuty ${parts.join(', ')}. Možná příčina k ověření: držení se nepromění ve střely ` +
          '(třeba pomalá rozehrávka bez průniku do útočné třetiny, nebo soupeř brání hluboko); z čísel to nepoznáš, ověř to na heat mapě a mapě přihrávek. ' +
          'Statistická odchylka sama není taktický problém.',
        metrics: { possession: r.possession, shotShare: r.shotShare, xgShare: r.xgShare, shots: r.shots, xg: r.xg },
        basis:
          `Heuristika této aplikace, ne pravidlo FM27: naše držení ≥ ${T.possessionHigh} % a podíl střel i xG (kde jsou k dispozici) pod ${Math.round(T.chanceShareLow * 100)} %, ` +
          `posuzuje se od ${T.minChanceShots} střel obou týmů (xG od ${T.minChanceXg}). Kumulativní statistiky od začátku zápasu.`,
      };
    });
  }

  function detectDominance(c) {
    const T = c.T;
    const test = (s) => {
      const m = sideStats(s, c.mySide);
      const o = sideStats(s, other(c.mySide));
      if (o.shots === null || (m.shots === null && !(m.xg !== null && o.xg !== null))) return null;
      const byShots = m.shots !== null && o.shots >= T.dominanceMinShots && o.shots >= T.dominanceRatio * m.shots;
      const byXg = m.xg !== null && o.xg !== null && o.shots >= T.dominanceMinShots && o.xg >= T.minChanceXg && o.xg >= T.dominanceRatio * m.xg;
      return { triggered: byShots || byXg, byShots, byXg, m, o };
    };
    return totalDetector(c, 'opponent_chance_dominance', test, (b, r) => {
      const xgPart = r.m.xg !== null && r.o.xg !== null ? `, xG soupeře ${fmt(r.o.xg)}, naše ${fmt(r.m.xg)}` : '';
      const which = r.byShots && r.byXg ? 'počet střel i xG' : r.byShots ? 'počet střel' : 'xG (střely samotné práh nepřekračují)';
      return {
        title: 'Soupeř má víc šancí',
        text:
          `Podle snímku z ${b.minute}. minuty jsou střely soupeře ${r.o.shots}, naše ${r.m.shots === null ? '(neznámo)' : r.m.shots}${xgPart}; ` +
          `práh ${T.dominanceRatio}× překračuje ${which}. ` +
          'Možná příčina k ověření: soupeř se dostává do střelby častěji, než na to máme odpověď (třeba v přechodové fázi nebo po jedné straně); z čísel to nepoznáš. ' +
          'Dokud to nepotvrdí další měření a pohled na zápas, je to jen statistická odchylka.',
        metrics: {
          oppShots: r.o.shots,
          mineShots: r.m.shots,
          shotsRatio: r.m.shots > 0 ? round(r.o.shots / r.m.shots, 2) : null,
          oppXg: r.o.xg,
          mineXg: r.m.xg,
          xgRatio: r.m.xg > 0 && r.o.xg !== null ? round(r.o.xg / r.m.xg, 2) : null,
        },
        basis:
          `Heuristika této aplikace, ne pravidlo FM27: soupeř má aspoň ${T.dominanceRatio}× naše střely nebo xG a aspoň ${T.dominanceMinShots} střely. ` +
          'Kumulativní statistiky od začátku zápasu.',
      };
    });
  }

  function detectTrend(c) {
    const T = c.T;
    const foe = other(c.mySide);
    const ss = c.snaps.filter((s) => stat(s, foe, 'shots') !== null);
    if (ss.length < 3) return null;
    const s3 = ss[ss.length - 1];
    let s2 = findLast(ss, (s) => s.minute <= s3.minute - T.minSpanMinutes);
    let s1 = s2 && findLast(ss, (s) => s.minute <= s2.minute - T.minSpanMinutes);
    const long = !!(s1 && s2);
    if (!long) {
      // krátká okna: poslední tři snímky se striktně rostoucí minutou; nález bude nejvýš 'watch'
      const picked = [s3];
      for (let i = ss.length - 2; i >= 0 && picked.length < 3; i--) if (ss[i].minute < picked[picked.length - 1].minute) picked.push(ss[i]);
      if (picked.length < 3) return null;
      s2 = picked[1];
      s1 = picked[2];
    }
    const d1 = stat(s2, foe, 'shots') - stat(s1, foe, 'shots');
    const d2 = stat(s3, foe, 'shots') - stat(s2, foe, 'shots');
    if (d1 < 0 || d2 < 0) return null; // kumulativní hodnota klesla: čtení si neodpovídají, trend nelze počítat
    const r1 = round((d1 / (s2.minute - s1.minute)) * 10, 2);
    const r2 = round((d2 / (s3.minute - s2.minute)) * 10, 2);
    if (!(d2 >= T.trendMinShots && r2 >= T.trendRatio * r1)) return null;
    return makeFinding(c, 'opponent_shots_trend', [s1, s2, s3], long, {
      title: 'Soupeřovy střely zrychlují',
      text:
        `Tempo soupeřových střel: ${fmt(r2)} na 10 min v posledním okně (${s2.minute}.–${s3.minute}. min) proti ${fmt(r1)} v předchozím (${s1.minute}.–${s2.minute}. min). ` +
        'Možná příčina k ověření: změna stavu zápasu nebo soupeřova přístupu, únava nebo naše vlastní změna; z čísel to nepoznáš.',
      note: long ? '' : `Okna trendu jsou krátká (${s2.minute - s1.minute} a ${s3.minute - s2.minute} min; pro upozornění je potřeba v každém aspoň ${T.minSpanMinutes} min), nález je předběžný.`,
      metrics: { prevRatePer10: r1, lastRatePer10: r2, prevShots: d1, lastShots: d2, windows: [[s1.minute, s2.minute], [s2.minute, s3.minute]] },
      basis:
        `Heuristika této aplikace, ne pravidlo FM27: soupeřovy střely na 10 min v posledním okně ≥ ${T.trendRatio}× předchozí okno a v posledním okně aspoň ${T.trendMinShots} střely. ` +
        'Počítáno z rozdílů kumulativních statistik tří snímků.',
    });
  }

  function detectTrailing(c) {
    const T = c.T;
    const me = c.mySide;
    const trailing = (s) => isObj(s.score) && isNum(s.score[me]) && isNum(s.score[other(me)]) && s.score[me] < s.score[other(me)];
    const sot = (s) => stat(s, me, 'shotsOnTarget');
    const b = findLast(c.snaps, (s) => s.minute >= T.trailingFromMinute && trailing(s) && sot(s) !== null);
    if (!b) return null;
    const earlier = c.snaps.filter((s) => s.minute < b.minute && trailing(s) && sot(s) !== null);
    const longBase = findLast(earlier, (s) => s.minute <= b.minute - T.minSpanMinutes);
    const base = longBase || earlier[earlier.length - 1] || null;
    let snaps;
    let where;
    if (base) {
      if (sot(b) - sot(base) !== 0) return null; // střela na bránu byla (nebo čtení nesedí)
      snaps = [base, b];
      where = `v okně od ${base.minute}. do ${b.minute}. minuty jsme neměli žádnou střelu na bránu`;
    } else {
      if (sot(b) !== 0) return null;
      snaps = [b];
      where = 'od začátku zápasu jsme neměli žádnou střelu na bránu';
    }
    return makeFinding(c, 'trailing_without_threat', snaps, !!longBase, {
      title: 'Prohráváme a nehrozíme',
      text:
        `Od ${T.trailingFromMinute}. minuty prohráváme (${b.score.home}:${b.score.away}, domácí:hosté) a ${where}. ` +
        'Možná příčina k ověření: soupeř nás pustí jen k nekvalitním pokusům nebo hrajeme příliš opatrně na stav zápasu; z čísel to nepoznáš.',
      metrics: { score: { home: b.score.home, away: b.score.away }, shotsOnTargetInWindow: 0, windowFrom: snaps[0].minute, windowTo: b.minute },
      basis:
        `Heuristika této aplikace, ne pravidlo FM27: od ${T.trailingFromMinute}. minuty prohráváme a v okně ≥ ${T.minSpanMinutes} min nemáme žádnou střelu na bránu ` +
        '(rozdíl kumulativních statistik dvou snímků).',
    });
  }

  /** Události ze všech snímků bez duplicit (seznam událostí se v dalších snímcích opakuje); u každé snímky, kde byla vidět. */
  function collectEvents(snaps) {
    const map = new Map();
    for (const s of snaps) {
      // Stejná událost se v dalších snímcích přečte jinými slovy („Novák červená“ × „Novák (červená karta)“), proto se
      // porovnává minuta, druh a tým; dvě události téhož druhu v jedné minutě rozliší pořadí v rámci snímku.
      const ordinal = new Map();
      for (const e of Array.isArray(s.events) ? s.events : []) {
        if (!isObj(e)) continue;
        const base = `${isNum(e.minute) ? e.minute : ''}|${e.type}|${e.team || ''}`;
        const nth = ordinal.get(base) || 0;
        ordinal.set(base, nth + 1);
        const key = `${base}|${nth}`;
        let rec = map.get(key);
        if (!rec) {
          rec = { minute: isNum(e.minute) ? e.minute : s.minute, type: e.type, team: asSide(e.team), text: e.text || '', seenIn: [] };
          map.set(key, rec);
        }
        if (!rec.seenIn.includes(s)) rec.seenIn.push(s);
      }
    }
    return [...map.values()].sort((a, b) => a.minute - b.minute);
  }

  function detectRedCard(c) {
    const reds = collectEvents(c.snaps).filter((e) => e.type === 'red');
    return reds.map((e, i) => {
      const upto = reds.slice(0, i + 1);
      const count = (side) => upto.filter((x) => x.team === side).length;
      const home = count('home');
      const away = count('away');
      let situation;
      if (e.team === null) situation = 'jeden z týmů má o hráče méně (který, se ze snímku nepodařilo určit)';
      else if (c.mySide) situation = e.team === c.mySide ? 'hrajeme o hráče méně' : 'soupeř hraje o hráče méně';
      else situation = e.team === 'home' ? 'domácí hrají o hráče méně' : 'hosté hrají o hráče méně';
      const first = e.seenIn[0];
      const last = e.seenIn[e.seenIn.length - 1];
      const snaps = first === last ? [first] : [first, last];
      const tier = tierOf(snaps);
      return makeFinding(c, 'red_card', snaps, true, {
        id: `red_card:${e.team || 'x'}:${e.minute}:${i + 1}`,
        title: 'Červená karta',
        text:
          `Událost „červená karta“ (${e.minute}. min${e.team ? `, ${e.team === 'home' ? 'domácí' : 'hosté'}` : ''}): podle ní se změnila početní situace, ${situation}. ` +
          (home + away > 1 ? `Podle událostí do této chvíle: domácí ${home}, hosté ${away} červených. ` : '') +
          'Dopad na tempo hry z toho ještě nevyplývá, sleduj další snímky.',
        metrics: { minute: e.minute, team: e.team, redsHome: home, redsAway: away },
        basis:
          'Fakt z události na snímku, ne odhad z prahu.' +
          (tier === 'inferred' ? ' Událost je přečtená z obrazu a je neověřená, dokud ji uživatel nepotvrdí.' : ''),
      });
    });
  }

  function detectRatingDrop(c) {
    const T = c.T;
    const byName = new Map();
    for (const s of c.snaps) {
      for (const p of Array.isArray(s.players) ? s.players : []) {
        if (!isObj(p) || !isNum(p.rating) || typeof p.name !== 'string') continue;
        const key = core.fold(p.name).replace(/\s+/g, ' ').trim();
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, { name: p.name, key, list: [] });
        byName.get(key).list.push({ s, rating: p.rating });
      }
    }
    const found = [];
    for (const { name, key, list } of byName.values()) {
      const cur = list[list.length - 1];
      const earlier = list.slice(0, -1).filter((x) => x.s.minute < cur.s.minute);
      const longBase = findLast(earlier, (x) => x.s.minute <= cur.s.minute - T.minSpanMinutes);
      const base = longBase || earlier[earlier.length - 1];
      if (!base) continue;
      const drop = round(base.rating - cur.rating, 2); // zaokrouhlení kvůli plovoucí čárce (7,2 − 6,4)
      if (drop < T.ratingDrop) continue;
      found.push({ name, key, base, cur, drop, long: !!longBase });
    }
    found.sort((a, b) => b.drop - a.drop);
    return found.slice(0, 3).map((f) =>
      makeFinding(c, 'rating_drop', [f.base.s, f.cur.s], f.long, {
        id: `rating_drop:${f.key}:${f.cur.s.id}`,
        episode: `rating_drop:${f.key}`,
        title: `Pokles hodnocení: ${f.name}`,
        text:
          `Hodnocení hráče ${f.name} kleslo z ${fmt(f.base.rating)} (${f.base.s.minute}. min) na ${fmt(f.cur.rating)} (${f.cur.s.minute}. min), tedy o ${fmt(f.drop)}. ` +
          'Možná příčina k ověření: únava, zranění nebo soupeřův tlak na jeho straně; z hodnocení samotného to nepoznáš.',
        metrics: { player: f.name, from: f.base.rating, to: f.cur.rating, drop: f.drop },
        basis: `Heuristika této aplikace, ne pravidlo FM27: pokles hodnocení hráče mezi snímky o aspoň ${T.ratingDrop}. Hodnocení se v zápase průběžně mění, jeden pokles není důkaz problému.`,
      })
    );
  }

  /** Nálezy z časové osy. Detektory, které potřebují vědět, kdo jsme (mySide), bez něj nic nevrátí;
      červená karta a pokles hodnocení jsou fakta ze snímků a mySide nepotřebují (text je pak neutrální: domácí/hosté). */
  function detectProblems(timeline, opts) {
    const o = opts || {};
    const c = { snaps: usable(timeline), mySide: asSide(o.mySide), T: mergeThresholds(o) };
    const out = [];
    const add = (x) => {
      if (Array.isArray(x)) out.push(...x);
      else if (x) out.push(x);
    };
    if (c.mySide) {
      add(detectPossession(c));
      add(detectDominance(c));
      add(detectTrend(c));
      add(detectTrailing(c));
    }
    add(detectRedCard(c));
    add(detectRatingDrop(c));
    const now = isNum(o.now) ? o.now : null;
    for (const f of out) f.at = now;
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'alert' ? -1 : 1)); // stabilní: upozornění první
  }

  /** Nálezy → pozorování pro poradce. Štítek je vždy heuristic_coach (nejvýš inferred), i když jsou snímky ověřené. */
  function findingsToObservations(findings, opts) {
    const prefix = String((opts && opts.prefix) || 'live').replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 30) || 'live';
    return (Array.isArray(findings) ? findings : [])
      .filter(isObj)
      .map((f, i) => ({
        id: `${prefix}-${i + 1}`,
        label: 'heuristic_coach',
        minute: isNum(f.minute) ? Math.trunc(f.minute) : null,
        text: clip(
          `[${f.severity === 'alert' ? 'upozornění' : 'sledovat'}; ${TIER_BASIS_CS[f.evidenceTier] || TIER_BASIS_CS.inferred}] ` +
            `${f.title || ''}. ${f.text || ''} Základ: ${f.basis || ''}`,
          1500
        ),
      }));
  }

  // ---------------------------------------------------------------- vyhodnocení změny a shrnutí zápasu
  /** Popisný verdikt metriky: relativní pásmo „similar“. Z nuly na kladnou hodnotu je 'higher'. */
  function verdictRel(before, after, band) {
    if (before === null || after === null) return null;
    if (before === 0 && after === 0) return 'similar';
    if (before === 0) return after > 0 ? 'higher' : 'lower';
    const rel = round((after - before) / Math.abs(before), 6); // zaokrouhlení: na hranici pásma nerozhoduje plovoucí čárka
    return rel > band ? 'higher' : rel < -band ? 'lower' : 'similar';
  }
  const verdictAbs = (diff, band) => (diff === null ? null : diff > band ? 'higher' : diff < -band ? 'lower' : 'similar');

  function windowSummary(w) {
    const pick = (b) => ({ shots: b.rates.shots, shotsOnTarget: b.rates.shotsOnTarget, xg: b.rates.xg, totalShots: b.totals.shots });
    return {
      fromMinute: w.fromMinute,
      toMinute: w.toMinute,
      minutes: w.minutes,
      basis: w.kickoff ? 'kickoff' : 'lookback', // 'kickoff' = od začátku zápasu, jinak okno mezi dvěma snímky
      snapshots: w.snapshots,
      mine: pick(w.mine), // tempo na 10 minut
      opp: pick(w.opp),
      possessionChangePp: w.mine.possession.changePp, // změna zobrazeného kumulativního držení v procentních bodech
    };
  }

  /** Popisné před/po kolem změny z rozdílů kumulativních statistik. NIKDY netvrdí příčinu: verdikt je jen
      'higher' | 'lower' | 'similar' po metrikách. Okno před = snímky do minuty změny (lookbackMinutes zpět),
      okno po = snímky po ní (nejvýš do opts.untilMinute). Úsek mezi nimi se nepočítá, obsahuje samotnou změnu.
      'insufficient_data', dokud po změně není aspoň minAfterMinutes minut mezi dvěma snímky a není s čím porovnat. */
  function evaluateChange(timeline, change, opts) {
    const o = opts || {};
    const T = mergeThresholds(o);
    const mySide = asSide(o.mySide);
    const ch = isObj(change) ? change : {};
    const minute = isNum(ch.minute) ? Math.floor(ch.minute) : null;
    const lookback = isNum(o.lookbackMinutes) ? o.lookbackMinutes : T.lookbackMinutes;
    const minAfter = isNum(o.minAfterMinutes) ? o.minAfterMinutes : T.minAfterMinutes;
    const until = isNum(o.untilMinute) ? o.untilMinute : MINUTE_MAX;
    const notes = [];
    const result = {
      status: 'insufficient_data',
      changeMinute: minute,
      recheckAfterMinutes: isNum(ch.recheckAfterMinutes) ? ch.recheckAfterMinutes : null,
      before: null,
      after: null,
      deltas: null,
      notes,
      causalityNote: CAUSALITY_NOTE,
      evidenceTier: 'inferred',
    };
    if (minute === null) {
      notes.push('Změna nemá zadanou minutu, nelze určit okno před a po změně.');
      return result;
    }
    if (!mySide) {
      notes.push('Není zadána strana uživatele (domácí/hosté), nelze říct, které údaje jsou naše.');
      return result;
    }
    let bw = windowStats(timeline, minute - lookback, minute, { mySide });
    if (!bw) {
      bw = windowStats(timeline, 0, minute, { mySide });
      if (bw) {
        notes.push(
          `Před změnou nebyly v okně ${lookback} min dva snímky se statistikami; jako výchozí slouží tempo od začátku zápasu do ${bw.toMinute}. min (jiná délka období, srovnání je hrubší).`
        );
      }
    }
    const aw = windowStats(timeline, minute + 1, until, { mySide });
    const afterMinutes = aw ? aw.minutes : 0;
    if (!aw || afterMinutes < minAfter) {
      notes.push(`Po změně (${minute}. min) je zatím ${afterMinutes} min mezi dvěma snímky se statistikami; potřeba je aspoň ${minAfter}. Zatím nelze nic vyhodnotit.`);
    }
    if (!bw) notes.push('Před změnou není žádný snímek se statistikami, není s čím porovnat.');
    if (!bw || !aw || afterMinutes < minAfter) return result;

    const before = windowSummary(bw);
    const after = windowSummary(aw);
    const d = (b, a) => ({ before: b, after: a, diff: b === null || a === null ? null : round(a - b, 3), verdict: verdictRel(b, a, T.similarBand) });
    const sideDeltas = (k) => ({ shots: d(before[k].shots, after[k].shots), shotsOnTarget: d(before[k].shotsOnTarget, after[k].shotsOnTarget), xg: d(before[k].xg, after[k].xg) });
    const ppDiff = before.possessionChangePp === null || after.possessionChangePp === null ? null : round(after.possessionChangePp - before.possessionChangePp, 2);
    result.status = 'ready';
    result.before = before;
    result.after = after;
    result.deltas = {
      mine: sideDeltas('mine'),
      opp: sideDeltas('opp'),
      possessionChangePp: { before: before.possessionChangePp, after: after.possessionChangePp, diff: ppDiff, verdict: verdictAbs(ppDiff, T.similarPp) },
    };
    result.evidenceTier = weakerTier(bw.evidenceTier, aw.evidenceTier);

    notes.push(`Tempo je na 10 minut; verdikt je jen popis rozdílu (higher/lower/similar, pásmo ±${Math.round(T.similarBand * 100)} %), ne hodnocení změny.`);
    for (const [label, w] of [['před změnou', before], ['po změně', after]]) {
      const total = w.mine.totalShots === null || w.opp.totalShots === null ? null : w.mine.totalShots + w.opp.totalShots;
      if (total !== null && total < T.smallSampleShots) notes.push(`Okno ${label}: střel obou týmů dohromady jen ${total} (malý vzorek, rozdíl může být náhoda).`);
      if (w.minutes < T.shortWindowMinutes) notes.push(`Okno ${label} je krátké (${w.minutes} min).`);
    }
    if (after.fromMinute > before.toMinute) {
      notes.push(`Úsek ${before.toMinute}.–${after.fromMinute}. minuta (samotná změna) se do žádného okna nepočítá.`);
    }
    if (result.recheckAfterMinutes > 0 && after.toMinute - minute < result.recheckAfterMinutes) {
      notes.push(`Plánované vyhodnocení bylo za ${result.recheckAfterMinutes} min po změně; poslední snímek je ${after.toMinute - minute} min po ní.`);
    }
    if (result.evidenceTier === 'inferred') notes.push('Podkladové snímky nejsou všechny ověřené uživatelem: hodnoty ber jako odhad z čtení obrazu.');
    else if (result.evidenceTier === 'user_entered') notes.push('Část hodnot jsi zadal ručně: jsou to tvoje údaje, ne ověřené snímky.');
    for (const w of [bw, aw]) for (const msg of w.warnings) notes.push(msg);
    return result;
  }

  /** Shrnutí zápasu pro rozbor po zápase: období (výchozí 15 min), součty, změny s vyhodnocením, nálezy a poznámky
      o chybějících datech. Nikde netvrdí příčinu; vyhodnocení změn jsou jen popisná. */
  function summarizeMatch(timeline, changes, opts) {
    const o = opts || {};
    const T = mergeThresholds(o);
    const mySide = asSide(o.mySide);
    const size = isNum(o.windowMinutes) && o.windowMinutes > 0 ? o.windowMinutes : T.periodMinutes;
    const all = (Array.isArray(timeline) ? timeline : []).filter(isObj);
    const snaps = usable(timeline);
    const withStats = snaps.filter(hasStats);
    const notes = [];
    if (!all.length) notes.push('Časová osa je prázdná: není z čeho zápas shrnout.');
    if (all.length > snaps.length) notes.push(`${all.length - snaps.length} snímků nemá přečtenou minutu a do časové analýzy se nezapočítalo.`);
    if (snaps.length && !withStats.length) notes.push('Žádný snímek neobsahuje statistiky, tempo ani podíly nelze spočítat.');
    if (withStats.length && !withStats.some((s) => stat(s, 'home', 'xg') !== null || stat(s, 'away', 'xg') !== null)) {
      notes.push('Na žádném snímku nebylo xG: podíl šancí se posuzuje jen ze střel.');
    }
    if (!mySide) {
      notes.push(
        'Strana uživatele (domácí/hosté) není zadána, proto detektory držení bez šancí, soupeřovy převahy, trendu soupeřových střel a „prohráváme bez hrozby“ nic nehodnotily ' +
          'a změny se nevyhodnotily. Zadej, za koho hraješ.'
      );
    }
    const unverified = all.filter((s) => s.provenance === 'vision_unverified').length;
    if (unverified) notes.push(`${unverified} z ${all.length} snímků je neověřené čtení z obrazu (vision_unverified): čísla ber jako odhad ke kontrole.`);

    const lastStat = withStats.length ? withStats[withStats.length - 1].minute : 0;
    const periods = [];
    const missing = [];
    for (let from = 0; from < lastStat; from += size) {
      const stats = windowStats(timeline, from, from + size, { mySide });
      periods.push({ fromMinute: from, toMinute: from + size, stats });
      if (!stats) missing.push(`${from}–${from + size}`);
    }
    if (missing.length) notes.push(`V obdobích ${missing.join(', ')} min nejsou aspoň dva snímky se statistikami, tempo se tam nepočítá.`);

    const events = collectEvents(snaps);
    const counts = {};
    for (const t of EVENT_TYPES) counts[t] = events.filter((e) => e.type === t).length;
    const scored = findLast(snaps, (s) => isObj(s.score));
    const provenance = {};
    for (const s of all) provenance[s.provenance] = (provenance[s.provenance] || 0) + 1;
    const totals = {
      snapshots: all.length,
      lastMinute: snaps.length ? snaps[snaps.length - 1].minute : null,
      score: scored ? { home: scored.score.home, away: scored.score.away, minute: scored.minute } : null,
      stats: windowStats(timeline, 0, MINUTE_MAX, { mySide }),
      events: counts,
      provenance,
      evidenceTier: tierOf(all),
    };

    const ordered = (Array.isArray(changes) ? changes : [])
      .filter(isObj)
      .map((ch) => ({ ch, minute: isNum(ch.minute) ? Math.floor(ch.minute) : null }))
      .sort((a, b) => (a.minute === null) - (b.minute === null) || (a.minute || 0) - (b.minute || 0));
    if (!ordered.length) notes.push('V zápase nebyla zaznamenána žádná změna taktiky, není co vyhodnocovat.');
    const evaluated = ordered.map((x, i) => {
      const next = ordered.slice(i + 1).find((y) => x.minute !== null && y.minute !== null && y.minute > x.minute);
      const evaluation = evaluateChange(timeline, x.ch, {
        mySide,
        thresholds: o.thresholds,
        lookbackMinutes: o.lookbackMinutes,
        minAfterMinutes: o.minAfterMinutes,
        untilMinute: next ? next.minute : undefined, // okno po změně končí u další změny, ať se nepřekrývají
      });
      if (evaluation.status !== 'ready') notes.push(`Změna ${x.minute === null ? 'bez minuty' : `v ${x.minute}. min`}: ${evaluation.notes[0] || 'nejsou data k vyhodnocení.'}`);
      return {
        id: x.ch.id === undefined ? null : x.ch.id,
        minute: x.minute,
        summary: typeof x.ch.summary === 'string' ? x.ch.summary : '',
        recheckAfterMinutes: isNum(x.ch.recheckAfterMinutes) ? x.ch.recheckAfterMinutes : null,
        evaluation,
      };
    });

    return {
      periods,
      totals,
      changes: evaluated,
      findings: detectProblems(timeline, { mySide, thresholds: o.thresholds, now: o.now }),
      notes,
      causalityNote: CAUSALITY_NOTE,
    };
  }

  // ---------------------------------------------------------------- brána snímků (zadání § 2: nezpracovávat každý snímek)
  /** Šedotónové zmenšení: průměr bloků zdrojových pixelů. rgba jsou bajty RGBA (jako z canvasu), w×h → outW×outH.
      Špatné rozměry jsou chyba programátora, proto výjimka (RangeError), ne vrácená chyba. */
  function downscaleGray(rgba, w, h, outW, outH) {
    const ok = (n) => Number.isInteger(n) && n > 0;
    if (!ok(w) || !ok(h) || !ok(outW) || !ok(outH)) throw new RangeError('downscaleGray: rozměry musí být kladná celá čísla.');
    if (!rgba || rgba.length < w * h * 4) throw new RangeError('downscaleGray: rgba je kratší než w×h×4.');
    const out = new Uint8Array(outW * outH);
    for (let oy = 0; oy < outH; oy++) {
      const y0 = Math.min(h - 1, Math.floor((oy * h) / outH));
      const y1 = Math.min(h, Math.max(y0 + 1, Math.floor(((oy + 1) * h) / outH)));
      for (let ox = 0; ox < outW; ox++) {
        const x0 = Math.min(w - 1, Math.floor((ox * w) / outW));
        const x1 = Math.min(w, Math.max(x0 + 1, Math.floor(((ox + 1) * w) / outW)));
        let acc = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4;
            acc += 299 * rgba[i] + 587 * rgba[i + 1] + 114 * rgba[i + 2]; // váhy 0,299 / 0,587 / 0,114 v tisícinách
          }
        }
        out[oy * outW + ox] = Math.round(acc / (1000 * (y1 - y0) * (x1 - x0)));
      }
    }
    return out;
  }

  /** Průměrná absolutní rozdílnost dvou šedotónových polí, 0 (shodná) až 1. Různé délky = 1 (nesrovnatelné, raději zpracovat). */
  function frameDiff(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    if (a.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length * 255);
  }

  /** Brána rozhoduje, který snímek se pošle ke zpracování (a tím stojí peníze). Stav je v uzávěru, čas se předává
      (check(gray, nowMs), nebo opts.now), takže je chování deterministické.
      Pořadí rozhodování: paused → first → too_soon → unchanged → unsettled → budget_match → budget_hour → changed.
      „unsettled“ a rozpočty se hlásí až u snímku, který by se jinak zpracoval (je změněný proti poslednímu zpracovanému):
      u nezměněného snímku je důvod vždy „unchanged“, i když se obrazovka mezitím přepínala tam a zpátky. */
  function createFrameGate(opts) {
    const o = Object.assign(
      {
        baseIntervalMs: 15000, // výchozí odstup mezi zpracováními
        minIntervalMs: 5000, // nejkratší odstup (i po sérii důležitých událostí)
        maxIntervalMs: 120000, // nejdelší odstup (i po dlouhém klidu)
        minDiff: 0.02, // pod touto rozdílností vůči poslednímu zpracovanému snímku se nic nemění
        settleDiff: 0.01, // dva po sobě viděné snímky se liší víc = obrazovka se přepíná, počkáme
        maxPerHour: 60, // rozpočet zpracování na hodinu (klouzavě)
        maxPerMatch: 150, // rozpočet zpracování na zápas (jedna brána = jeden zápas)
        maxUnsettled: 4, // obrazovka, která se hýbe pořád (animace zápasu), by jinak nikdy „neustála“: po tolika čekáních se zpracuje i tak
      },
      opts
    );
    const HOUR = 3600000;
    const clamp = (v) => Math.min(o.maxIntervalMs, Math.max(o.minIntervalMs, v));
    let interval = clamp(o.baseIntervalMs);
    let paused = false;
    let lastSeen = null;
    let lastProcessed = null;
    let lastProcessedAt = 0;
    let lastNow = null;
    let quiet = 0; // zpracování po sobě bez důležitého nálezu
    let unsettledStreak = 0; // kolikrát po sobě se čekalo na ustálení obrazovky
    let processed = 0;
    let times = [];
    const skipped = {};

    const skip = (reason, diff) => {
      skipped[reason] = (skipped[reason] || 0) + 1;
      return { process: false, reason, diff, intervalMs: interval };
    };
    const take = (gray, now, reason, diff) => {
      unsettledStreak = 0;
      lastProcessed = Uint8Array.from(gray);
      lastProcessedAt = now;
      processed++;
      times.push(now);
      return { process: true, reason, diff, intervalMs: interval };
    };

    /** `diff` v odpovědi: u 'unsettled' rozdíl proti předchozímu viděnému snímku, jinak proti poslednímu zpracovanému. */
    function check(gray, nowMs) {
      const now = isNum(nowMs) ? nowMs : typeof o.now === 'function' ? o.now() : NaN;
      if (!isNum(now)) throw new TypeError('createFrameGate.check: chybí čas (nowMs nebo opts.now).');
      lastNow = now;
      if (paused) return skip('paused', null); // při pauze se snímek nezapamatuje
      const seenDiff = lastSeen ? frameDiff(lastSeen, gray) : null;
      lastSeen = Uint8Array.from(gray);
      times = times.filter((t) => now - t < HOUR);
      const overBudget = processed >= o.maxPerMatch ? 'budget_match' : times.length >= o.maxPerHour ? 'budget_hour' : null;
      if (!lastProcessed) return overBudget ? skip(overBudget, null) : take(gray, now, 'first', null);
      const diff = frameDiff(lastProcessed, gray);
      if (now - lastProcessedAt < interval) return skip('too_soon', diff);
      if (diff < o.minDiff) return skip('unchanged', diff);
      if (seenDiff !== null && seenDiff > o.settleDiff) {
        if (unsettledStreak < o.maxUnsettled) {
          unsettledStreak++;
          return skip('unsettled', seenDiff);
        }
        // Obrazovka se pořád hýbe: nečekáme dál, ale zpracuje se jen to, co se proti poslednímu zpracovanému opravdu liší (níž).
      } else unsettledStreak = 0;
      if (overBudget) return skip(overBudget, diff);
      return take(gray, now, 'changed', diff);
    }

    /** Důležitá událost zkrátí odstup (×0,6, nejméně minIntervalMs); každá dvě zpracování po sobě bez důležitého nálezu
        ho prodlouží (×1,5, nejvýš maxIntervalMs) a počítadlo klidu se vynuluje. */
    function noteResult(result) {
      if (result && result.important) {
        interval = clamp(interval * 0.6);
        quiet = 0;
      } else if (++quiet >= 2) {
        interval = clamp(interval * 1.5);
        quiet = 0;
      }
    }

    return {
      check,
      noteResult,
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
        lastSeen = null; // po pauze se první snímek neporovnává se zastaralým „předchozím“, jinak by se zbytečně čekalo
      },
      stats() {
        return {
          processed,
          skipped: Object.assign({}, skipped),
          intervalMs: interval,
          perHour: lastNow === null ? 0 : times.filter((t) => lastNow - t < HOUR).length,
          perMatch: processed,
          paused,
          limits: { perHour: o.maxPerHour, perMatch: o.maxPerMatch },
        };
      },
    };
  }

  return {
    STAT_KEYS,
    STAT_RANGES,
    SCREENS,
    EVENT_TYPES,
    DEFAULT_THRESHOLDS,
    CAUSALITY_NOTE,
    buildExtractionPrompt,
    normalizeExtraction,
    makeSnapshot,
    sortTimeline,
    windowStats,
    detectProblems,
    findingsToObservations,
    evaluateChange,
    summarizeMatch,
    createFrameGate,
    downscaleGray,
    frameDiff,
  };
});
