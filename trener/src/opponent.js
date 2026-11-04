/* Analytik soupeře (zadání § 7): profil soupeře s původem každého údaje a předzápasový plán od modelu s kontrolou poctivosti.
   Čistá logika bez DOM (test/opponent.test.mjs). Pravidla důvěry jsou z core.js: tvrzení nesmí být silnější než nejslabší důkaz,
   vysoká jistota je těžká na splnění a hráči se nesmějí vymýšlet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerOpponent = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const FIELDS = [
    ['formation', 'Rozestavení', 'Např. 4-2-3-1'],
    ['roles', 'Role soupeřových hráčů', 'Jak je vidíš ve hře, jedna na řádek'],
    ['strengths', 'Silné stránky', 'Co umí nejlíp'],
    ['weaknesses', 'Slabé stránky', 'Kde se dá zranit'],
    ['buildUp', 'Způsob rozehrávky', 'Od brankáře, dlouhé míče, přes křídla…'],
    ['defensiveBlock', 'Obranný blok', 'Nízký, střední, vysoký, kompaktnost'],
    ['pressingHeight', 'Výška presinku', 'Kdy a kde napadá'],
    ['flankAttacks', 'Útoky po stranách', 'Která strana, kdo tam útočí'],
    ['spaceBehind', 'Prostor za obranou', 'Jak vysoko brání, jak je rychlá obrana'],
    ['setPieces', 'Standardní situace', 'Rohy, přímé kopy, jak brání'],
    ['keyPlayers', 'Klíčoví hráči', 'Jména a proč jsou důležití, jedno na řádek'],
  ];
  const FIELD_LABEL = Object.fromEntries(FIELDS.map(([k, l]) => [k, l]));
  const PROV = ['user_entered', 'vision_unverified', 'screenshot_verified'];
  const SIDES = ['left', 'right', 'centre', 'none'];
  const SIDE_CS = { left: 'levá strana', right: 'pravá strana', centre: 'střed', none: 'žádná strana nevybrána' };
  const MIN_TEXT = 8;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');

  /** Profil → pozorování. Každý vyplněný údaj je samostatné pozorování se svým původem (`opp-<pole>`). */
  function profileToObservations(profile) {
    const out = [];
    if (!profile) return out;
    out.push({ id: 'opp-name', label: 'user_entered', minute: null, text: `Soupeř: ${profile.name || '?'}` });
    for (const [key] of FIELDS) {
      const f = profile.fields && profile.fields[key];
      const value = f && txt(f.value);
      if (!value) continue;
      const label = PROV.includes(f.prov) ? f.prov : 'user_entered';
      out.push({ id: `opp-${key}`, label, minute: null, text: `${FIELD_LABEL[key]}: ${value.slice(0, 500)}` });
    }
    return out;
  }

  const SHAPE_TEXT = `Odpověz POUZE tímto JSON objektem (žádný text kolem). Každé tvrzení má {"text", "tier", "refs"}:
{
  "summary": {"text": "krátké shrnutí, jak soupeře uchopit", "tier": "inferred|user_entered|unknown", "refs": ["opp-formation"]},
  "press":   {"text": "jak soupeře napadat (konkrétně)", "tier": "…", "refs": []},
  "winBall": {"text": "kde získávat míč", "tier": "…", "refs": []},
  "side":    {"choice": "left|right|centre|none", "text": "kterou stranu využívat a proč", "tier": "…", "refs": []},
  "spaces":  {"text": "které prostory obsazovat", "items": ["konkrétní prostor 1"], "tier": "…", "refs": []},
  "limit":   {"player": "jméno z profilu soupeře nebo null", "text": "jak hráče omezit", "tier": "…", "refs": []},
  "risk": {"text": "…", "items": ["konkrétní riziko zvoleného přístupu"]},
  "confidence": {"level": "low|medium|high", "text": "…"},
  "unknown": {"text": "co nevím", "items": ["co má uživatel doplnit nebo ověřit"]}
}`;

  const RULES = `Jsi FM27 Tactical Coach a připravuješ předzápasový plán proti soupeři. Odpovídáš česky a jen JSON podle tvaru.
Pravidla (platí bez výjimky):
1. Pracuješ jen s pozorováními o soupeři (id opp-…), s pozorováními o našem týmu (id career, squad, tactic, mem-…) a s úryvky z knih (id bk:…). Nic jiného o soupeři nevíš. Nic nevymýšlej.
2. Každé tvrzení má "tier": user_entered (uživatel to o soupeři napsal), inferred (tvoje úvaha nebo strojově přečtená hodnota), unknown (nevíš). Tier nesmí být silnější než nejslabší důkaz v "refs". Úryvek z knihy je teorie, ne popis soupeře, takže ho cituj jen jako oporu úvahy (tier inferred).
3. Hráče uváděj jen jmény, která jsou v profilu soupeře. Když žádný klíčový hráč není, napiš "player": null.
4. Neznámé údaje o soupeři přiznej: do "unknown.items" napiš, co má uživatel doplnit. Bez údaje nedělej závěr o jeho stylu.
5. Vysoká jistota je zakázaná, pokud nejsou aspoň dva údaje o soupeři ověřené na screenshotu (štítek screenshot_verified). Jinak nejvýš střední, a při málo údajích nízká.
6. Nevymýšlej mechaniky FM27 (CA/PA, match engine, skryté atributy). Názvy rolí a nastavení FM27 jsou neověřené.
7. Buď konkrétní: ne "napadej víc", ale kde, kdy a kým. Navrhni nejvýš dvě až tři věci, ne přestavbu celé taktiky.`;

  function buildPlanTurns(input) {
    const obs = input.observations || [];
    const lines = obs.length ? obs.map((o) => `- ${o.id} | ${o.label} | ${o.text}`).join('\n') : '(žádná)';
    const passages = input.passages || [];
    const passageLines = passages.length ? passages.map((p) => `- ${p.id} | ${p.title} | ${p.where} | ${p.text}`).join('\n') : '(žádné: plán nevychází z knih, řekni to)';
    const body = `${RULES}\n\n${SHAPE_TEXT}\n\nPozorování (id | štítek původu | text):\n${lines}\n\nZdroje znalostí, které smíš citovat:\n${input.sourcesDigest || '(žádné)'}\n\nÚryvky z knih (id | kniha | kde | text), jsou to teorie:\n${passageLines}\n`;
    return [{ role: 'user', content: body }];
  }

  /** Hledací dotazy pro knihy z profilu soupeře (bez volání modelu: slova z vyplněných polí). */
  function searchSeeds(profile) {
    const seeds = [];
    const f = (profile && profile.fields) || {};
    const add = (s) => s && seeds.push(String(s).replace(/\s+/g, ' ').trim().slice(0, 120));
    if (f.formation && f.formation.value) add(`${f.formation.value} jak hrát proti`);
    if (f.pressingHeight && f.pressingHeight.value) add(`${f.pressingHeight.value} presink jak hrát proti`);
    if (f.defensiveBlock && f.defensiveBlock.value) add(`${f.defensiveBlock.value} blok jak prolomit`);
    if (f.buildUp && f.buildUp.value) add(`${f.buildUp.value} rozehrávka jak napadat`);
    if (f.flankAttacks && f.flankAttacks.value) add(`${f.flankAttacks.value} křídla bránění`);
    return seeds.slice(0, 5);
  }

  /** Kontrola plánu. ctx: {observations: {id: {label, text}}, passages: Set, registry, knownPlayers: [jména z profilu]}. */
  function validatePlan(plan, ctx) {
    const errors = [];
    const warnings = [];
    if (!isObject(plan)) return { ok: false, errors: ['Odpověď není JSON objekt.'], warnings };
    const missing = ['summary', 'press', 'winBall', 'side', 'spaces', 'limit', 'risk', 'confidence', 'unknown'].filter((k) => !(k in plan));
    if (missing.length) return { ok: false, errors: [`Chybí sekce: ${missing.join(', ')}.`], warnings };
    const observations = (ctx && ctx.observations) || {};
    const refTier = Core.makeRefResolver(ctx);
    const tiers = {};

    const claim = (name, section) => {
      const r = Core.checkClaim(name, section, ctx, {});
      errors.push(...r.errors);
      tiers[name] = r;
      return r;
    };
    for (const name of ['summary', 'press', 'winBall', 'side', 'spaces', 'limit']) claim(name, plan[name]);

    // strana
    if (isObject(plan.side)) {
      if (!SIDES.includes(plan.side.choice)) errors.push(`side: choice musí být ${SIDES.join(', ')}.`);
      else if (plan.side.choice !== 'none' && plan.side.tier === 'unknown') errors.push('side: strana je vybraná, ale tvrzení je označené jako neznámé.');
    }
    // prostory
    const spaces = isObject(plan.spaces) && Array.isArray(plan.spaces.items) ? plan.spaces.items : null;
    if (!spaces || !spaces.length || !spaces.every((s) => typeof s === 'string' && txt(s).length >= 6)) errors.push('spaces: uveď aspoň jeden konkrétní prostor (items).');
    else if (spaces.length > 4) errors.push('spaces: nejvýš čtyři prostory.');
    // hráč: jen jméno z profilu
    if (isObject(plan.limit)) {
      const player = plan.limit.player;
      if (player !== null && player !== undefined && typeof player !== 'string') errors.push('limit: player musí být text nebo null.');
      else if (typeof player === 'string' && txt(player)) {
        const known = ((ctx && ctx.knownPlayers) || []).map((n) => String(n).toLowerCase());
        const wanted = txt(player).toLowerCase();
        if (!known.some((n) => n.includes(wanted) || wanted.includes(n))) errors.push(`limit: hráč „${player}“ není v profilu soupeře. Jména se nesmějí vymýšlet.`);
      }
    }
    // riziko
    if (isObject(plan.risk)) {
      if (txt(plan.risk.text).length < MIN_TEXT) errors.push('risk: chybí popis rizika.');
      const items = Array.isArray(plan.risk.items) ? plan.risk.items : null;
      if (!items || !items.length || !items.every((s) => typeof s === 'string' && txt(s))) errors.push('risk: items musí obsahovat aspoň jedno konkrétní riziko.');
      for (const t of [plan.risk.text, ...(items || [])]) {
        const hit = Core.scanMechanics(String(t));
        if (hit) errors.push(`risk: tvrzení o interní mechanice FM27 („${hit}“) bez ověřeného zdroje.`);
      }
    } else errors.push('risk: sekce musí být objekt.');
    // jistota
    const level = isObject(plan.confidence) ? plan.confidence.level : null;
    if (!['low', 'medium', 'high'].includes(level)) errors.push('confidence: level musí být low, medium nebo high.');
    if (!txt(isObject(plan.confidence) ? plan.confidence.text : '')) errors.push('confidence: chybí zdůvodnění.');
    const usedObs = new Set();
    let verifiedObs = 0;
    for (const r of Object.values(tiers)) {
      for (const ref of r.refs || []) {
        if (refTier.isObservation(ref) && !usedObs.has(ref)) {
          usedObs.add(ref);
          if (observations[ref].label === 'screenshot_verified') verifiedObs++;
        }
      }
    }
    if (level === 'high' && verifiedObs < 2) errors.push('confidence: high vyžaduje aspoň dva údaje o soupeři ověřené na screenshotu (štítek screenshot_verified).');
    if (level === 'medium' && !usedObs.size) errors.push('confidence: medium vyžaduje aspoň jeden údaj o soupeři, na který se plán odkazuje.');
    // neznámé
    const unknownItems = isObject(plan.unknown) && Array.isArray(plan.unknown.items) ? plan.unknown.items.filter((s) => typeof s === 'string' && txt(s)) : null;
    if (unknownItems === null) errors.push('unknown: items musí být seznam textů.');
    else {
      const anyUnknownTier = Object.values(tiers).some((r) => r.tier === 'unknown');
      if ((level === 'low' || anyUnknownTier) && !unknownItems.length) errors.push('unknown: při nízké jistotě nebo neznámém tvrzení uveď, co chybí (unknown.items).');
    }
    if (!usedObs.size) warnings.push('Plán se neodkazuje na žádný údaj o soupeři. Doplň profil soupeře.');
    return { ok: errors.length === 0, errors, warnings };
  }

  function planToText(plan) {
    const t = (k) => txt(plan[k] && plan[k].text);
    const lines = [`Shrnutí: ${t('summary')}`, `Jak napadat: ${t('press')}`, `Kde získávat míč: ${t('winBall')}`, `Strana: ${SIDE_CS[plan.side && plan.side.choice] || '?'}. ${t('side')}`, `Prostory: ${t('spaces')} ${((plan.spaces && plan.spaces.items) || []).join('; ')}`];
    lines.push(`Omezit hráče: ${plan.limit && plan.limit.player ? plan.limit.player + '. ' : ''}${t('limit')}`);
    lines.push(`Rizika: ${t('risk')} ${((plan.risk && plan.risk.items) || []).join('; ')}`);
    lines.push(`Jistota: ${(Core.LEVEL_CS || {})[plan.confidence && plan.confidence.level] || '?'}. ${t('confidence')}`);
    lines.push(`Co nevím: ${t('unknown')} ${((plan.unknown && plan.unknown.items) || []).join('; ')}`);
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- čtení obrazovky soupeře
  const EXTRACTION_PROMPT = `Na přiložených obrázcích je obrazovka hry Football Manager s informacemi o soupeři (taktika, rozestavení, zpráva skauta nebo statistiky). Přepiš jen to, co na obrázku opravdu čteš.

Pravidla:
- Co není čitelné, napiš jako null (nebo prázdné pole). Nikdy nic nehádej ani nedoplňuj z paměti.
- Rozestavení piš jako řadu čísel (např. 4-2-3-1), jen když ho na obrázku vidíš.
- Role a jména přepiš přesně tak, jak jsou napsaná. Nepřidávej názvy rolí ani nastavení, které nevidíš.
- Silné a slabé stránky jen tehdy, když jsou na obrázku napsané jako text.

Odpověz POUZE JSON objektem:
{"formation": "…"|null, "roles": ["…"], "keyPlayers": ["…"], "strengths": ["…"], "weaknesses": ["…"], "notes": "krátká poznámka o čitelnosti"}`;

  /** Kontrola čtení: vrací {fields: {klíč: text}, issues}. Vše je neověřené (vision_unverified), dokud to uživatel nepotvrdí. */
  function normalizeExtraction(raw) {
    const issues = [];
    if (!isObject(raw)) return { fields: {}, issues: ['Odpověď není objekt.'] };
    const fields = {};
    const one = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '');
    const many = (v) => (Array.isArray(v) ? v.map(one).filter(Boolean).slice(0, 12) : []);
    const formation = one(raw.formation);
    if (formation) {
      if (/^\d(?:[\s\-–]?\d){2,4}$/.test(formation)) fields.formation = formation.replace(/[\s–]/g, '-');
      else issues.push(`Rozestavení „${formation}“ nevypadá jako řada čísel, vynechalo se.`);
    }
    for (const key of ['roles', 'keyPlayers', 'strengths', 'weaknesses']) {
      const list = many(raw[key]);
      if (list.length) fields[key] = list.join('\n');
    }
    if (!Object.keys(fields).length) issues.push('Na obrázku se nepodařilo nic spolehlivě přečíst.');
    return { fields, issues };
  }

  return { FIELDS, FIELD_LABEL, SIDES, SIDE_CS, profileToObservations, buildPlanTurns, searchSeeds, validatePlan, planToText, SHAPE_TEXT, RULES, EXTRACTION_PROMPT, normalizeExtraction };
});
