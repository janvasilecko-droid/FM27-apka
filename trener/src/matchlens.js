/* FM27 Tactical Coach: čtení živých dat z nástroje FMMatchLens (čistý modul bez DOM, bez sítě a bez AI; síť řeší feed.js).
   FMMatchLens (https://github.com/osnsyc/FMMatchLens, licence MIT) je zásuvný modul do hry (BepInEx), který za běhu zápasu čte data hry
   a nabízí je na lokální adrese (výchozí http://127.0.0.1:16726, JSON s názvy ve tvaru camelCase). Tenhle modul jen převádí jeho odpovědi
   na naše snímky zápasu a na tabulku sestavy. Tvar odpovědí je převzatý ze zdrojového kódu pluginu verze 0.7.x (`/api/health`, `/api/match/meta`,
   `/api/match/current`) a NEBYL ověřen na běžící hře. Proto je čtení tolerantní: co chybí nebo je nesmyslné, je null a zapíše se do `issues`;
   nic se nehádá a nikdy se nic nevymýšlí.
   Co se NIKDY nečte, i když to plugin nabízí: schopnosti hráčů CA a PA, pověst, mzdy, skryté atributy (Consistency, Injury Proneness a další),
   osobnost, interní vstupy hodnocení (`ratingInputs`, `ratingModel`), pozice na hřišti a identifikátory hráčů. Trenér s nimi nepočítá a o skrytých
   mechanikách FM27 nic netvrdí.
   Co se načte, je „zadal uživatel“ (údaje od nástroje, který běží u něj), ne „ověřeno hrou“: aplikace nemůže zkontrolovat, že plugin čte správně. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tableimport.js'));
  else root.TrenerMatchLens = factory(root.TrenerTableImport);
})(typeof self !== 'undefined' ? self : this, function (TI) {
  'use strict';

  const DEFAULT_URL = 'http://127.0.0.1:16726';
  const TICKS_PER_MINUTE = 240; // podle zdrojového kódu pluginu: 4 ticky za sekundu herního času
  const MINUTE_MAX = 130;
  const MAX_PLAYERS = 80;
  const MAX_ATTRS = 40;
  const SIDES = ['home', 'away'];

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const int = (v, lo, hi) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const real = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  // Řídicí, neviditelné a obousměrné znaky pryč (sestaveno z escape sekvencí, ať zdroj žádný nenese).
  // řídicí znaky, oddělovače řádků, všechny formátovací znaky Unicode (nulová šířka, řízení směru písma včetně izolátů, měkký spojovník, značky) a všechny znaky, které se mají při zobrazení ignorovat (Default_Ignorable_Code_Point: výplně, selektory variant, neviditelné samohlásky), plus prázdné braillské písmeno a náhradní znak objektu; zapsáno přes RegExp, aby ve zdrojích nebyly doslovné znaky
  const INVISIBLE = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\ufffc]+', 'gu');
  const text = (v, n) => (typeof v === 'string' ? v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

  // ---------------------------------------------------------------- adresa
  /** Adresa pluginu smí být jen na tomto počítači. Aplikace nikdy nevolá cizí server kvůli datům ze hry. */
  function cleanBaseUrl(input) {
    const raw = String(input === undefined || input === null ? '' : input).trim();
    if (!raw) return { ok: true, url: DEFAULT_URL };
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw;
    let u;
    try {
      u = new URL(withScheme);
    } catch (e) {
      return { ok: false, error: `Adresa nemá platný tvar. Příklad: ${DEFAULT_URL}` };
    }
    if (u.protocol !== 'http:') return { ok: false, error: `Plugin mluví jen přes http, ne přes ${u.protocol.replace(':', '')}. Příklad: ${DEFAULT_URL}` };
    if (u.username || u.password) return { ok: false, error: 'Adresa nesmí obsahovat jméno ani heslo.' };
    const host = u.hostname.toLowerCase();
    if (!(host === '127.0.0.1' || host === 'localhost' || host === '[::1]')) return { ok: false, error: 'Adresa musí být na tomto počítači (127.0.0.1 nebo localhost). Data ze hry aplikace nikdy nebere z cizího serveru.' };
    const port = u.port ? Number(u.port) : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port musí být číslo od 1 do 65535.' };
    return { ok: true, url: `http://${host}:${port}` };
  }

  // ---------------------------------------------------------------- /api/health
  function parseHealth(raw) {
    if (!isObj(raw)) return { ok: false, error: 'Odpověď není objekt JSON.' };
    const name = text(raw.name, 40);
    if (!/fmmatchlens/i.test(name)) return { ok: false, error: 'Na téhle adrese odpovídá něco jiného než FMMatchLens.' };
    return {
      ok: true,
      name,
      pluginVersion: text(raw.pluginVersion, 20),
      game: text(raw.game, 40),
      gameVersion: text(raw.gameVersion, 30),
      status: text(raw.status, 20),
      inMatch: raw.inMatch === true,
      tick: int(raw.tick, 0, 1e8),
      frameCount: int(raw.frameCount, 0, 1e8),
    };
  }

  // ---------------------------------------------------------------- /api/match/current
  const TEAM_INT_KEYS = ['goals', 'shots', 'shotsOnTarget', 'shotsOffTarget', 'blockedShots', 'clearCutChances', 'passes', 'passesCompleted', 'crosses', 'crossesCompleted', 'aerials', 'aerialsWon', 'progressivePasses', 'finalThirdPasses', 'tacklesAttempted', 'tacklesWon', 'fouls', 'corners', 'offsides', 'yellowCards', 'redCards', 'firstHalfShots', 'secondHalfShots'];

  function parseTeamStats(raw, label, issues) {
    const out = {};
    const missing = [];
    for (const k of TEAM_INT_KEYS) {
      out[k] = int(raw[k], 0, 5000);
      if (out[k] === null) missing.push(k);
    }
    out.xg = real(raw.xg, 0, 30);
    if (out.xg === null) missing.push('xg');
    out.possessionTime = real(raw.possessionTime, 0, 1e9);
    if (out.possessionTime === null) missing.push('possessionTime');
    if (missing.length) issues.push(`${label}: chybí nebo nejsou čitelné údaje (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}).`);
    return out;
  }

  /** Jeden záznam zápasu → {ok, minute, second, period, possession, home, away, players, matchId, issues}. */
  function parseFrame(raw) {
    if (!isObj(raw)) return { ok: false, error: 'Plugin zatím žádný zápas nehlásí (odpověď je prázdná).' };
    if (!isObj(raw.home) || !isObj(raw.away)) return { ok: false, error: 'V odpovědi chybí údaje o týmech.' };
    const issues = [];
    const clockTick = real(raw.displayTick, 0, 1e8) !== null ? raw.displayTick : real(raw.tick, 0, 1e8);
    let minute = null;
    let second = null;
    if (clockTick === null) issues.push('Chybí čas zápasu (displayTick i tick).');
    else {
      minute = Math.floor(clockTick / TICKS_PER_MINUTE);
      second = Math.floor(clockTick / 4) % 60;
      if (minute > MINUTE_MAX) {
        issues.push(`Čas zápasu ${minute}. minuta je mimo rozsah, nepoužije se.`);
        minute = null;
        second = null;
      }
    }
    const home = parseTeamStats(raw.home, 'Domácí', issues);
    const away = parseTeamStats(raw.away, 'Hosté', issues);
    const players = [];
    if (Array.isArray(raw.players)) {
      for (const p of raw.players.slice(0, MAX_PLAYERS)) {
        if (!isObj(p)) continue;
        const team = p.team === 'home' || p.team === 'away' ? p.team : null;
        const slot = int(p.slot, 0, 500);
        if (team === null || slot === null) continue;
        const rating = real(p.rating, 0, 10);
        const savesPart = (k) => int(p[k], 0, 200) || 0;
        players.push({
          slot,
          team,
          isSubstitute: p.isSubstitute === true,
          isOnPitch: p.isOnPitch === true,
          rating: rating !== null && rating > 0 ? rating : null,
          goals: int(p.goals, 0, 30),
          assists: int(p.assists, 0, 30),
          saves: savesPart('savesHeld') + savesPart('savesParried') + savesPart('savesTipped'),
        });
      }
    } else issues.push('V odpovědi chybí seznam hráčů.');
    return {
      ok: true,
      matchId: text(raw.matchId, 80),
      minute,
      second,
      period: int(raw.period, 0, 10),
      possession: raw.possessionTeam === 'home' || raw.possessionTeam === 'away' ? raw.possessionTeam : null,
      home,
      away,
      players,
      issues,
    };
  }

  // ---------------------------------------------------------------- /api/match/meta
  function parseAssignment(raw) {
    if (!isObj(raw)) return null;
    const role = text(raw.role, 50);
    const position = text(raw.position, 12);
    if (!role && !position) return null;
    return { position, role, roleAbbreviation: text(raw.roleAbbreviation, 10), duty: text(raw.duty, 20) };
  }

  function parseAttributes(raw, isKeeper) {
    const out = {};
    if (!isObj(raw)) return out;
    // Brankářské atributy u hráčů z pole bývají jen vyplněné nízkými čísly; berou se jen u brankáře.
    for (const group of isKeeper ? ['technical', 'mental', 'physical', 'goalkeeping'] : ['technical', 'mental', 'physical']) {
      const g = raw[group];
      if (!isObj(g)) continue;
      for (const [k, v] of Object.entries(g)) {
        if (Object.keys(out).length >= MAX_ATTRS) return out;
        const name = text(k, 30);
        const value = int(v, 1, 20);
        if (!name || value === null) continue;
        if (TI && TI.isHiddenName && TI.isHiddenName(name)) continue; // skryté atributy se nečtou ani tady
        out[name] = value;
      }
    }
    return out;
  }

  /** Údaje o zápase a sestavách → {ok, matchId, home, away, humanSide, competition, players, issues}. */
  function parseMeta(raw) {
    if (!isObj(raw)) return { ok: false, error: 'Plugin zatím žádný zápas nehlásí (odpověď je prázdná).' };
    if (!isObj(raw.home) || !isObj(raw.away)) return { ok: false, error: 'V odpovědi chybí údaje o týmech.' };
    const issues = [];
    const team = (t) => {
      const m = isObj(t.manager) ? t.manager : null;
      return { name: text(t.name, 60), manager: m ? { name: text([m.firstName, m.secondName].filter((x) => typeof x === 'string' && x).join(' '), 60), human: m.isHumanControlled === true } : null };
    };
    const home = team(raw.home);
    const away = team(raw.away);
    const humans = SIDES.filter((s) => (s === 'home' ? home : away).manager && (s === 'home' ? home : away).manager.human);
    const players = [];
    if (Array.isArray(raw.players)) {
      for (const p of raw.players.slice(0, MAX_PLAYERS)) {
        if (!isObj(p)) continue;
        const side = p.team === 'home' || p.team === 'away' ? p.team : null;
        const slot = int(p.slot, 0, 500);
        const name = text(p.displayName, 60) || text([p.firstName, p.secondName].filter((x) => typeof x === 'string' && x).join(' '), 60);
        if (side === null || slot === null || !name) continue;
        players.push({
          slot,
          team: side,
          name,
          shirt: int(p.shirtNumber, 0, 99) !== null ? p.shirtNumber : int(p.squadNumber, 0, 99),
          position: text(p.position, 12),
          inPossession: parseAssignment(p.inPossession),
          outOfPossession: parseAssignment(p.outOfPossession),
          attributes: parseAttributes(p.attributes, text(p.position, 12).toUpperCase() === 'GK' || (isObj(p.inPossession) && text(p.inPossession.position, 12).toUpperCase() === 'GK')),
        });
      }
    } else issues.push('V odpovědi chybí seznam hráčů.');
    const humanSide = humans.length === 1 ? humans[0] : null;
    // Plugin čte přesné atributy i soupeřových hráčů, kdežto hra u hráčů, které neznáš, ukazuje atributy jen jako rozsahy. Takové údaje by byly skryté
    // informace, proto se berou jen atributy mého týmu. Když z dat nejde poznat, který tým je můj, neberou se žádné (ani při ruční volbě strany).
    for (const p of players) if (p.team !== humanSide) p.attributes = {};
    if (!humanSide) issues.push('Z dat nejde poznat, který tým je tvůj, proto se nenačetly žádné atributy (u soupeře by to byly informace, které hra neukazuje přesně).');
    return {
      ok: true,
      matchId: text(raw.matchId, 80),
      home,
      away,
      humanSide,
      competition: isObj(raw.competition) ? text(raw.competition.name, 80) : '',
      players,
      issues,
    };
  }

  // ---------------------------------------------------------------- převod na snímek zápasu
  const pct = (a, b) => (a !== null && b !== null && a + b > 0 ? Math.round((100 * a) / (a + b)) : null);

  /** Pole pro `makeSnapshot`: minuta, skóre a statistiky obou týmů. Držení míče se počítá z podílu času, přesnost přihrávek z úspěšných a všech přihrávek. */
  function toSnapshotFields(frame, meta, opts) {
    const o = Object.assign({ mySide: null }, opts);
    const possHome = pct(frame.home.possessionTime, frame.away.possessionTime);
    const acc = (t) => (t.passes !== null && t.passes > 0 && t.passesCompleted !== null ? Math.round((100 * t.passesCompleted) / t.passes) : null);
    const saves = (side) => {
      const mine = frame.players.filter((p) => p.team === side);
      return mine.length ? mine.reduce((s, p) => s + p.saves, 0) : null;
    };
    const stats = (side, t) => ({
      possession: possHome === null ? null : side === 'home' ? possHome : 100 - possHome,
      shots: t.shots,
      shotsOnTarget: t.shotsOnTarget,
      xg: t.xg === null ? null : Math.round(t.xg * 100) / 100,
      passes: t.passes,
      passAccuracy: acc(t),
      tackles: t.tacklesWon,
      fouls: t.fouls,
      corners: t.corners,
      offsides: t.offsides,
      saves: saves(side),
    });
    const score = frame.home.goals !== null && frame.away.goals !== null ? { home: frame.home.goals, away: frame.away.goals } : null;
    const names = new Map((meta && meta.ok ? meta.players : []).map((p) => [p.slot, p.name]));
    const players = [];
    if (o.mySide === 'home' || o.mySide === 'away') {
      for (const p of frame.players) {
        if (p.team !== o.mySide || !p.isOnPitch || p.rating === null || !names.has(p.slot)) continue;
        players.push({ name: names.get(p.slot), rating: p.rating });
      }
    }
    return {
      minute: frame.minute,
      score,
      screen: 'stats',
      stats: { home: stats('home', frame.home), away: stats('away', frame.away) },
      teams: meta && meta.ok ? { home: meta.home.name || null, away: meta.away.name || null } : null,
      players,
      provenance: 'user_entered',
      via: 'fmmatchlens',
      notes: 'Živě z FMMatchLens: údaje čte plugin z paměti hry, aplikace je nemohla ověřit. Držení míče a přesnost přihrávek se počítají z jeho čísel.',
    };
  }

  /** Stav, podle kterého se rozhoduje, jestli je potřeba nový snímek. */
  const stateOf = (frame) => ({ minute: frame.minute, score: frame.home.goals !== null && frame.away.goals !== null ? [frame.home.goals, frame.away.goals] : null, reds: [frame.home.redCards, frame.away.redCards], period: frame.period });

  /** Má se z tohoto záznamu udělat snímek? Ano: první záznam, gól, červená karta, nová část zápasu, nebo uběhlo aspoň `everyMinutes` herních minut.
      Podle herního času, ne podle hodin: hra běží různou rychlostí. Vrací {record, reason, state}. */
  function shouldRecord(prev, frame, opts) {
    const every = opts && Number.isFinite(opts.everyMinutes) ? Math.max(1, Math.min(20, opts.everyMinutes)) : 3;
    const cur = stateOf(frame);
    if (cur.minute === null) return { record: false, reason: 'no_clock', state: prev || null };
    if (!prev) return { record: true, reason: 'first', state: cur };
    if (cur.minute < prev.minute) return { record: false, reason: 'clock_back', state: prev };
    if (cur.score && prev.score && (cur.score[0] !== prev.score[0] || cur.score[1] !== prev.score[1])) return { record: true, reason: 'goal', state: cur };
    if (cur.reds[0] !== null && cur.reds[1] !== null && prev.reds[0] !== null && prev.reds[1] !== null && (cur.reds[0] !== prev.reds[0] || cur.reds[1] !== prev.reds[1])) return { record: true, reason: 'red', state: cur };
    if (cur.period !== null && prev.period !== null && cur.period !== prev.period) return { record: true, reason: 'period', state: cur };
    if (cur.minute - prev.minute >= every) return { record: true, reason: 'minutes', state: cur };
    return { record: false, reason: 'none', state: prev };
  }

  // ---------------------------------------------------------------- sestava
  const cut = (v, n) => String(v).slice(0, n);

  /** Sestava jedné strany z `/api/match/meta` ve tvaru, v jakém se hráči ukládají. Role a povinnost jsou „s míčem“ (jak je plugin hlásí),
      role „bez míče“ jde do poznámky. Názvy rolí se nepřekládají a nic se nedoplňuje. Věk plugin v použitém tvaru neposílá: zůstane prázdný.
      → {players, count, issues}. Jména už v soupisce (`existingNames`) se přeskočí. */
  function squadPlayers(meta, side, frame, opts) {
    const o = Object.assign({ existingNames: [], max: 60 }, opts);
    if (!meta || !meta.ok || (side !== 'home' && side !== 'away')) return null;
    const mine = meta.players.filter((p) => p.team === side);
    if (!mine.length) return null;
    const bench = new Set(frame && frame.ok ? frame.players.filter((p) => p.team === side && p.isSubstitute).map((p) => p.slot) : []);
    const existing = new Set(o.existingNames.map((n) => String(n).trim().toLowerCase()));
    const issues = [];
    const players = [];
    let skippedExisting = 0;
    let skippedOver = 0;
    let oddPositions = 0;
    const sorted = mine.slice().sort((a, b) => (bench.has(a.slot) ? 1 : 0) - (bench.has(b.slot) ? 1 : 0) || (a.shirt === null ? 99 : a.shirt) - (b.shirt === null ? 99 : b.shirt));
    for (const p of sorted) {
      if (existing.has(p.name.toLowerCase())) {
        skippedExisting++;
        continue;
      }
      if (players.length >= o.max) {
        skippedOver++;
        continue;
      }
      const ip = p.inPossession;
      const oop = p.outOfPossession;
      const rawPos = cut((ip && ip.position) || p.position || '', 12).toUpperCase();
      const simple = /^[A-Z]{1,4}$/.test(rawPos);
      if (rawPos && !simple) oddPositions++;
      const notes = [
        bench.has(p.slot) ? 'náhradník' : null,
        rawPos && !simple ? `Pozice v datech: ${rawPos}` : null,
        oop && (oop.role || oop.duty) ? `Bez míče: ${[oop.role, oop.duty].filter(Boolean).join(', ')}` : null,
      ].filter(Boolean).join('; ');
      players.push({ name: p.name, positions: simple ? [rawPos] : [], age: null, role: cut((ip && ip.role) || '', 60), duty: cut((ip && ip.duty) || '', 40), attributes: Object.assign({}, p.attributes), injured: false, notes: cut(notes, 300) });
    }
    if (oddPositions) issues.push(`Pozice u ${oddPositions} ${oddPositions === 1 ? 'hráče není prostá zkratka' : 'hráčů nejsou prosté zkratky'}, aplikace je nepřevádí a uložila je do poznámky.`);
    if (skippedExisting) issues.push(`Už v soupisce jsou: ${skippedExisting}.`);
    if (skippedOver) issues.push(`Nad limit ${o.max} hráčů: ${skippedOver}.`);
    return { players, count: players.length, issues, skipped: { existing: skippedExisting, overLimit: skippedOver } };
  }

  /** Řádky diagnostiky pro obrazovku: co plugin odpověděl a co z toho aplikace přečetla. {ok, text} */
  function diagnose(health, meta, frame) {
    const out = [];
    if (health) out.push(health.ok ? { ok: true, text: `Plugin ${health.name}${health.pluginVersion ? ' ' + health.pluginVersion : ''} odpovídá${health.game ? ` (je určený pro: ${health.game}${health.gameVersion ? ' ' + health.gameVersion : ''}; to je údaj z jeho sestavení, ne zjištění, jaká hra běží)` : ''}; stav „${health.status || 'neznámý'}“, ${health.inMatch ? 'zápas se hraje' : 'zápas se nehraje'}.` } : { ok: false, text: health.error || 'Plugin neodpověděl.' });
    if (meta) out.push(meta.ok ? { ok: true, text: `Zápas: ${meta.home.name || '?'} – ${meta.away.name || '?'}${meta.competition ? ` (${meta.competition})` : ''}; hráčů v sestavách ${meta.players.length}${meta.humanSide ? `; tvůj tým podle hry: ${meta.humanSide === 'home' ? 'domácí' : 'hosté'}` : '; tvůj tým z dat nejde poznat'}.` } : { ok: false, text: meta.error });
    if (frame) out.push(frame.ok ? { ok: true, text: `Čas zápasu: ${frame.minute === null ? 'nečitelný' : frame.minute + '. minuta'}; skóre ${frame.home.goals === null ? '?' : frame.home.goals}:${frame.away.goals === null ? '?' : frame.away.goals}; xG ${frame.home.xg === null ? '?' : frame.home.xg.toFixed(2)} : ${frame.away.xg === null ? '?' : frame.away.xg.toFixed(2)}.` } : { ok: false, text: frame.error });
    for (const part of [meta, frame]) if (part && part.ok) for (const i of part.issues.slice(0, 3)) out.push({ ok: false, text: i });
    return out;
  }

  return { DEFAULT_URL, TICKS_PER_MINUTE, cleanBaseUrl, parseHealth, parseFrame, parseMeta, toSnapshotFields, shouldRecord, squadPlayers, diagnose };
});
