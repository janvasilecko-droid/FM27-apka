/* Vysvětlení taktického rozložení (zadání § 6): proč některé role spolupracují a jiné vytvářejí prostorové konflikty.
   Model dostane jen geometrická fakta (z tactics.js), roli a povinnost, jak je uživatel napsal, a úryvky z knih.
   Čistá logika bez DOM (test/labexplain.test.mjs). Vysvětlení je nejvýš odhad: o chování hráčů ve FM27 nic netvrdí. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerLabExplain = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const MIN_TEXT = 8;
  const MAX_ITEMS = 3;
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');

  const RULES = `Jsi FM27 Tactical Coach a vysvětluješ, jak je postavené rozložení hráčů, které si uživatel nakreslil. Odpovídáš česky a jen JSON podle tvaru.
Pravidla (platí bez výjimky):
1. Vycházíš jen z fakt o nakresleném rozložení (id geo-…), ze sloupce „role“ a „povinnost“ (to napsal uživatel, jsou to jeho slova, ne ověřené názvy z FM27) a z úryvků z knih (id bk:…).
2. Fakta jsou geometrie bodů, ne chování hráčů ve hře. Nikdy netvrď, co hráč „ve FM27 udělá“. Piš: „podle nakresleného rozložení…“, „v teorii z knihy…“.
3. Každé tvrzení má "tier" a "refs". Tier je nejvýš "inferred" (geometrie i kniha jsou jen oporou úvahy). Když nemáš oporu, tier je "unknown".
4. Prostorové konflikty vysvětli jen tam, kde je ve faktech nález (konflikt), a uveď jeho id v "refs". Nevymýšlej nové.
5. "slots" jsou klíče slotů (např. s8), kterých se tvrzení týká; musí existovat v zadání.
6. Nevymýšlej mechaniky FM27 (CA/PA, match engine, skryté atributy). Názvy rolí neověřuj ani nedoplňuj.
7. Nejvýš tři položky v "worksWell" a tři v "conflicts". Prázdný seznam je v pořádku.`;

  const SHAPE_TEXT = `Odpověz POUZE tímto JSON objektem (žádný text kolem):
{
  "summary": {"text": "jak je rozložení postavené, jen z fakt", "tier": "inferred|unknown", "refs": ["geo-shape-lines"]},
  "worksWell": [{"text": "proč spolu dvě pozice nebo role dávají prostorově smysl", "tier": "inferred", "refs": ["geo-…", "bk:…"], "slots": ["s8", "s9"]}],
  "conflicts": [{"text": "proč může vzniknout prostorový konflikt", "tier": "inferred", "refs": ["geo-…"], "slots": ["s10"]}],
  "unknown": {"text": "co z rozložení nepoznáš", "items": ["co má uživatel doplnit nebo ověřit"]}
}`;

  /** input: {tactic, phase, facts (observations), conflicts, passages, playerNames: {playerId: jméno}, sourcesDigest} */
  function buildExplainTurns(input) {
    const t = input.tactic;
    const names = input.playerNames || {};
    const one = Core.oneLine;
    const slotLines = (t.slots || []).map((s) => `- ${one(s.key, 20)} | ${one(s.pos, 10)} | ${s.playerId && names[s.playerId] ? one(names[s.playerId], 80) : 'bez hráče'} | role: ${one(s.role, 80) || '?'}${s.duty ? ' (' + one(s.duty, 40) + ')' : ''} | x=${Math.round(input.phase === 'out' ? s.ox : s.x)}, y=${Math.round(input.phase === 'out' ? s.oy : s.y)}`).join('\n');
    const facts = (input.facts || []).map((o) => `- ${one(o.id, 60)} | ${one(o.text, 600)}`).join('\n') || '(žádná)';
    const passageLines = Core.formatPassageLines(input.passages, '(žádné: vysvětlení nevychází z knih, řekni to)');
    const body = `${RULES}\n${Core.DATA_RULE}\n\n${SHAPE_TEXT}\n\nTaktika „${one(t.name, 80)}“, formace ${one(t.formation, 20)}, fáze ${input.phase === 'out' ? 'bez míče' : 's míčem'}. Sloty (klíč | pozice | hráč | role a povinnost podle uživatele | souřadnice):\n${slotLines}\n\nFakta o rozložení (id | text):\n${facts}\n\nZdroje znalostí:\n${input.sourcesDigest || '(žádné)'}\n\nÚryvky z knih (id | kniha | kde | text), teorie:\n${passageLines}\n`;
    return [{ role: 'user', content: body }];
  }

  /** ctx: {observations: {id: {label}}, passages: Set, registry, slotKeys: [klíče]} */
  function validateExplain(x, ctx) {
    const errors = [];
    const warnings = [];
    if (!isObject(x)) return { ok: false, errors: ['Odpověď není JSON objekt.'], warnings };
    const missing = ['summary', 'worksWell', 'conflicts', 'unknown'].filter((k) => !(k in x));
    if (missing.length) return { ok: false, errors: [`Chybí sekce: ${missing.join(', ')}.`], warnings };
    const slotKeys = new Set((ctx && ctx.slotKeys) || []);
    const opts = { forbidTiers: ['verified', 'observed', 'user_entered'] };

    errors.push(...Core.checkClaim('summary', x.summary, ctx, opts).errors);
    for (const key of ['worksWell', 'conflicts']) {
      const list = x[key];
      if (!Array.isArray(list)) {
        errors.push(`${key}: musí být seznam.`);
        continue;
      }
      if (list.length > MAX_ITEMS) errors.push(`${key}: nejvýš ${MAX_ITEMS} položky.`);
      list.slice(0, MAX_ITEMS).forEach((item, i) => {
        const name = `${key}[${i + 1}]`;
        errors.push(...Core.checkClaim(name, item, ctx, opts).errors);
        if (!isObject(item)) return;
        const rawSlots = item.slots === undefined || item.slots === null ? [] : item.slots;
        if (!Array.isArray(rawSlots) || !rawSlots.every((v) => typeof v === 'string')) errors.push(`${name}: slots musí být seznam textů (klíčů slotů).`);
        const slots = Array.isArray(rawSlots) ? rawSlots.filter((v) => typeof v === 'string') : [];
        if (!slots.length) warnings.push(`${name}: bez uvedených slotů.`);
        for (const s of slots) if (!slotKeys.has(s)) errors.push(`${name}: slot „${s}“ v rozložení není.`);
        // Konflikt musí stát na nálezu konfliktu nebo přetížení, ne na neutrálním faktu o tvaru (geo-shape-…).
        const conflictIds = ctx && ctx.conflictIds ? new Set(ctx.conflictIds) : null;
        const isConflictRef = (r) => (conflictIds ? conflictIds.has(r) : /^geo-(?!shape-)/.test(r));
        if (key === 'conflicts' && !(Array.isArray(item.refs) && item.refs.some((r) => typeof r === 'string' && isConflictRef(r)))) errors.push(`${name}: konflikt musí odkazovat na nález konfliktu (např. geo-line-gap-…), ne na neutrální fakt o tvaru; nevymýšlej nové.`);
      });
    }
    const u = x.unknown;
    if (!isObject(u)) errors.push('unknown: sekce musí být objekt.');
    else {
      if (txt(u.text).length < MIN_TEXT) errors.push('unknown: chybí text.');
      if (!Array.isArray(u.items) || !u.items.every((s) => typeof s === 'string')) errors.push('unknown: items musí být seznam textů.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  return { buildExplainTurns, validateExplain, SHAPE_TEXT, RULES, MAX_ITEMS };
});
