/* Analýza po zápase (zadání § 11): schéma zprávy od modelu a její kontrola poctivosti.
   Čistá logika bez DOM (test/report.test.mjs). Hlavní pravidlo zadání: porovnávat před a po změně a nezaměňovat
   časovou souvislost za důkaz příčiny. Proto zpráva o změně smí vzniknout jen z vyhodnocení, které má dost dat,
   a její text musí být opatrný. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.TrenerReport = factory(root.TrenerCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const MAX_ITEMS = 5;
  const MIN_TEXT = 8;
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');

  // Silné příčinné vazby, které časová souvislost sama neunese.
  const CAUSAL = /způsobil[aoiy]?|zavinil[aoiy]?|byl[aoi]? příčinou|díky (?:této |té )?změně|kvůli (?:této |té )?změně|změna vedla k|za to může/i;
  // Opatrná formulace, kterou musí zpráva o změně obsahovat.
  const HEDGE = /po změně|souvis|nemusí|nelze|možná|pravděpodobně|ve srovnání|zdá se|může/i;

  const SHAPE_TEXT = `Odpověz POUZE tímto JSON objektem (žádný text kolem). Každá položka je {"text", "tier", "refs"}:
{
  "worked": [{"text": "co fungovalo", "tier": "inferred|user_entered|observed|unknown", "refs": ["id pozorování"]}],
  "didntWork": [{"text": "co nefungovalo", "tier": "…", "refs": []}],
  "changesHelped": [{"changeId": "id změny", "text": "po změně se …; nemusí to souviset", "tier": "inferred", "refs": ["id vyhodnocení"]}],
  "changesHurt": [{"changeId": "id změny", "text": "…", "tier": "inferred", "refs": []}],
  "players": [{"name": "jméno ze soupisky", "text": "…", "tier": "…", "refs": []}],
  "opponentEdge": [{"text": "kde měl soupeř převahu", "tier": "…", "refs": []}],
  "repeatedMistakes": [{"text": "co se opakovalo", "tier": "…", "refs": []}],
  "nextMatch": {"text": "shrnutí", "items": [{"what": "konkrétní změna", "why": "proč", "tier": "inferred", "refs": []}]},
  "limits": {"text": "co ve zprávě chybí", "items": ["jaká data chyběla nebo byla jen odhad"]}
}
Prázdné pole [] je v pořádku, když k tomu nemáš data.`;

  const RULES = `Jsi FM27 Tactical Coach a píšeš rozbor odehraného zápasu. Odpovídáš česky a jen JSON podle tvaru.
Pravidla (platí bez výjimky):
1. Pracuješ jen s pozorováními (id), s vyhodnocením změn před a po (id chg-…) a s úryvky z knih (bk:…). Nic jiného o zápase nevíš.
2. Každé tvrzení má "tier" a "refs". Tier nesmí být silnější než nejslabší důkaz. Čtení z obrázku je jen odhad (inferred).
3. ČASOVÁ SOUVISLOST NENÍ DŮKAZ PŘÍČINY. U změn piš opatrně: "po změně se zvýšilo …, nemusí to souviset". Nikdy nepiš, že změna něco "způsobila", "zavinila" nebo že za to může. Změnu hodnoť jen když má vyhodnocení před/po dost dat (stav ready), a odkaž na ni v "refs".
4. Hráče uváděj jen jmény ze soupisky a jen když o nich máš údaj. Nevymýšlej hodnocení hráčů.
5. Nevymýšlej mechaniky FM27 (CA/PA, match engine, skryté atributy).
6. Do "limits" napiš, co zprávě chybělo (málo snímků, jen odhad z obrázků, žádné údaje o hráčích). Poctivé "nevím" je lepší než odhad.
7. "nextMatch": nejvýš tři konkrétní věci (co, proč).`;

  function buildReportTurns(input) {
    const obs = input.observations || [];
    const lines = obs.length ? obs.map((o) => `- ${o.id} | ${o.label} | ${o.minute !== null && o.minute !== undefined ? o.minute + "'" : '-'} | ${o.text}`).join('\n') : '(žádná)';
    const passages = input.passages || [];
    const passageLines = passages.length ? passages.map((p) => `- ${p.id} | ${p.title} | ${p.where} | ${p.text}`).join('\n') : '(žádné)';
    const body = `${RULES}\n\n${SHAPE_TEXT}\n\nPozorování a vyhodnocení (id | štítek původu | minuta | text):\n${lines}\n\nZdroje znalostí:\n${input.sourcesDigest || '(žádné)'}\n\nÚryvky z knih (teorie):\n${passageLines}\n`;
    return [{ role: 'user', content: body }];
  }

  /** ctx: {observations, passages: Set, registry, changeStatus: {id: 'ready'|'insufficient_data'}, knownPlayers: [jména], dataLimited: bool} */
  function validateReport(report, ctx) {
    const errors = [];
    const warnings = [];
    if (!isObject(report)) return { ok: false, errors: ['Odpověď není JSON objekt.'], warnings };
    const listKeys = ['worked', 'didntWork', 'changesHelped', 'changesHurt', 'players', 'opponentEdge', 'repeatedMistakes'];
    const missing = [...listKeys, 'nextMatch', 'limits'].filter((k) => !(k in report));
    if (missing.length) return { ok: false, errors: [`Chybí sekce: ${missing.join(', ')}.`], warnings };
    const changeStatus = (ctx && ctx.changeStatus) || {};
    const knownPlayers = ((ctx && ctx.knownPlayers) || []).map((n) => String(n).toLowerCase());

    for (const key of listKeys) {
      const list = report[key];
      if (!Array.isArray(list)) {
        errors.push(`${key}: musí být seznam.`);
        continue;
      }
      if (list.length > MAX_ITEMS) errors.push(`${key}: nejvýš ${MAX_ITEMS} položek.`);
      list.slice(0, MAX_ITEMS).forEach((item, i) => {
        const name = `${key}[${i + 1}]`;
        const r = Core.checkClaim(name, item, ctx, { needObservation: key === 'changesHelped' || key === 'changesHurt' });
        errors.push(...r.errors);
        if (!isObject(item)) return;
        if (r.tier === 'verified') errors.push(`${name}: o průběhu zápasu nelze tvrdit „ověřeno oficiálním zdrojem“.`);
        const text = txt(item.text);
        if (CAUSAL.test(text)) errors.push(`${name}: časová souvislost není důkaz příčiny, nepiš „způsobil“ ani „kvůli změně“. Formuluj opatrně.`);
        if (key === 'changesHelped' || key === 'changesHurt') {
          const id = txt(item.changeId);
          if (!id || !(id in changeStatus)) errors.push(`${name}: changeId „${id}“ neodpovídá žádné změně.`);
          else if (changeStatus[id] !== 'ready') errors.push(`${name}: změna ${id} nemá dost dat pro srovnání před a po, nehodnoť ji.`);
          if (text.length >= MIN_TEXT && !HEDGE.test(text)) errors.push(`${name}: u změny formuluj opatrně (např. „po změně…, nemusí to souviset“).`);
        }
        if (key === 'players') {
          const n = txt(item.name).toLowerCase();
          if (!n || !knownPlayers.some((k) => k.includes(n) || n.includes(k))) errors.push(`${name}: hráč „${item.name}“ není v soupisce. Jména se nesmějí vymýšlet.`);
        }
      });
    }

    const next = report.nextMatch;
    if (!isObject(next)) errors.push('nextMatch: sekce musí být objekt.');
    else {
      if (txt(next.text).length < MIN_TEXT) errors.push('nextMatch: chybí shrnutí.');
      const items = Array.isArray(next.items) ? next.items : null;
      if (!items || !items.length) errors.push('nextMatch: uveď aspoň jednu konkrétní věc.');
      else {
        if (items.length > 3) errors.push('nextMatch: nejvýš tři věci najednou.');
        items.slice(0, 3).forEach((it, i) => {
          const name = `nextMatch[${i + 1}]`;
          if (!isObject(it) || txt(it.what).length < MIN_TEXT || txt(it.why).length < MIN_TEXT) {
            errors.push(`${name}: vyplň konkrétně co a proč.`);
            return;
          }
          const r = Core.checkClaim(name, { text: it.why, tier: it.tier, refs: it.refs }, ctx, {});
          errors.push(...r.errors);
          const hit = Core.scanMechanics(it.what);
          if (hit) errors.push(`${name}: tvrzení o interní mechanice FM27 („${hit}“) bez ověřeného zdroje.`);
        });
      }
    }
    const limits = report.limits;
    if (!isObject(limits)) errors.push('limits: sekce musí být objekt.');
    else {
      if (txt(limits.text).length < MIN_TEXT) errors.push('limits: chybí popis omezení zprávy.');
      const items = Array.isArray(limits.items) ? limits.items.filter((s) => typeof s === 'string' && txt(s)) : null;
      if (items === null) errors.push('limits: items musí být seznam textů.');
      else if (ctx && ctx.dataLimited && !items.length) errors.push('limits: dat bylo málo nebo jsou jen odhad, uveď, co chybělo.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  function reportToText(report) {
    const part = (title, list) => (list && list.length ? `${title}:\n` + list.map((x) => `  • ${x.name ? x.name + ': ' : ''}${x.text}`).join('\n') : null);
    const next = report.nextMatch || {};
    return [
      part('Co fungovalo', report.worked),
      part('Co nefungovalo', report.didntWork),
      part('Změny, po kterých se situace zlepšila', report.changesHelped),
      part('Změny, po kterých se situace zhoršila', report.changesHurt),
      part('Hráči', report.players),
      part('Kde měl soupeř převahu', report.opponentEdge),
      part('Opakované chyby', report.repeatedMistakes),
      `Příští utkání: ${txt(next.text)}\n` + ((next.items || []).map((i) => `  • ${i.what} (${i.why})`).join('\n') || ''),
      `Omezení zprávy: ${txt((report.limits || {}).text)} ${((report.limits || {}).items || []).join('; ')}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return { buildReportTurns, validateReport, reportToText, SHAPE_TEXT, RULES, MAX_ITEMS };
});
