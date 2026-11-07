/* Čtení soupisky (vlastní i soupeřovy) ze snímku obrazovky hry: výzva pro model, kontrola odpovědi a plán, jak návrhy zapsat do kádru.
   Čistá logika bez DOM (test/squadread.test.mjs). Hra je česky: pozice jsou „O (S)“, „DZ, Z (S)“, „OZ (LS), ÚT (S)“ a atributy „Hlavičky“,
   „Poziční hra“; model je přepíše tak, jak je vidí, a kód je převede na kanonické anglické kódy (DC, DM, AML…) a názvy atributů (Heading…).
   Na jednom snímku jsou jen některé atributy (pohled Technické, Psychika, Fyzické atributy, Obrana, Útok), proto se hráči se stejným jménem
   napříč snímky SLUČUJÍ (sjednocení atributů) a u hráče už v kádru se atributy DOPLŇUJÍ, místo aby se hráč přeskočil.
   Poctivost: všechno je neověřený návrh, dokud ho uživatel nepotvrdí podle snímku. Skryté údaje hry (CA, PA, osobnost, reputace) se nečtou. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fm27cs.js'));
  else root.TrenerSquadRead = factory(root.TrenerFm27Cs);
})(typeof self !== 'undefined' ? self : this, function (CS) {
  'use strict';

  const MAX_PLAYERS = 60;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  const PROMPT = `Na přiložených obrázcích je obrazovka hry Football Manager 27 (česky, nebo anglicky): tabulka hráčů (soupiska, pohledy Informace o výběru, Atributy: Technické, Psychika, Fyzické atributy, Obrana, Útok, Brankářské) nebo profil jednoho hráče. Přepiš jen hráče, které na obrázku opravdu čteš.

Pravidla:
- Co na obrázku není čitelné, napiš jako null. Nikdy nic nehádej ani nedoplňuj z paměti.
- Jména přepiš přesně tak, jak jsou napsaná (třeba „L. Horníček“). Hráče, jejichž jméno nečteš, vynech.
- Pozice přepiš tak, jak jsou napsané ve sloupci Pozice: například „O (S)“, „DZ, Z (S)“, „OZ (LS), ÚT (S)“, „B“, nebo anglicky GK, DC, ST. Celý text pozic dej do jednoho prvku seznamu „positions“ nebo ho rozděl na prvky; aplikace pozice převede sama.
- Atributy jen tehdy, když je vidíš jako čísla 1 až 20. Název atributu přepiš PŘESNĚ tak, jak je napsaný („Hlavičky“, „Poziční hra“, nebo Heading). Aplikace je převede sama. Na jednom obrázku bývají jen některé atributy (například jen technické): přepiš jen ty, které vidíš.
- Neuváděj skryté údaje (schopnosti CA a PA, reputaci, osobnost), hvězdy ani hodnocení; do „attributes“ patří jen atributy hráče.
- „injured“ je true jen tehdy, když je u hráče výslovně vidět zranění (text nebo ikona zranění); jinak null.
- Neuváděj názvy rolí ani nastavení hry, které na obrázku nevidíš.

Odpověz POUZE JSON objektem:
{"players": [{"name": "…", "positions": ["…"], "age": číslo|null, "role": "…"|null, "attributes": {"Název": číslo}, "injured": true|false|null}], "notes": "krátká poznámka o čitelnosti"}`;

  // řídicí znaky, oddělovače řádků, formátovací znaky, znaky ignorované při zobrazení, prázdné braillské písmeno a náhradní znak objektu (zapsáno přes RegExp)
  const INVISIBLE = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\ufffc]+', 'gu');
  const clean = (v, n) => (typeof v === 'string' ? v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

  /** Kontrola odpovědi modelu: cokoli podezřelého se zahodí. Hráči se stejným jménem (i s iniciálou) se slučují: atributy se sjednotí,
      při rozporu platí první hodnota a řekne se to. → {proposals: [{name, positions, age, role, attributes, injured, unknownPositions}], issues} */
  function normalizeSquadRead(raw) {
    const issues = [];
    const list = isObj(raw) && Array.isArray(raw.players) ? raw.players : null;
    if (!list) return { proposals: [], issues: ['Odpověď nemá seznam hráčů.'] };
    const proposals = [];
    let skippedNoName = 0;
    for (const r of list.slice(0, MAX_PLAYERS)) {
      const name = isObj(r) ? clean(r.name, 60) : '';
      if (name.length < 2) {
        skippedNoName++;
        continue;
      }
      let positions = [];
      let unknownPositions = [];
      const posValue = isObj(r) ? r.positions : null;
      if (CS && posValue !== null && posValue !== undefined) {
        const parsed = CS.normalizePositions(posValue);
        positions = parsed.codes.slice(0, 8);
        unknownPositions = parsed.unknown.slice(0, 4);
      }
      const age = isObj(r) && Number.isInteger(r.age) && r.age >= 14 && r.age <= 50 ? r.age : null;
      const norm = CS ? CS.normalizeAttributes(isObj(r) ? r.attributes : null) : { attributes: {}, issues: [] };
      for (const i of norm.issues) issues.push(`${name}: ${i}.`);
      const role = isObj(r) && typeof r.role === 'string' ? clean(r.role, 60) : '';
      const injured = isObj(r) && r.injured === true;
      const same = proposals.find((p) => CS && CS.sameName(p.name, name));
      if (same) {
        for (const [k, v] of Object.entries(norm.attributes)) {
          const have = Object.keys(same.attributes).find((x) => CS.attrKey(x) === CS.attrKey(k));
          if (have === undefined) same.attributes[k] = v;
          else if (same.attributes[have] !== v) issues.push(`${same.name}: atribut „${k}“ je na obrázcích s různou hodnotou (${same.attributes[have]} a ${v}), platí první.`);
        }
        for (const c of positions) if (!same.positions.includes(c)) same.positions.push(c);
        if (same.age === null && age !== null) same.age = age;
        if (!same.role && role) same.role = role;
        same.injured = same.injured || injured;
        if (name.length > same.name.length) same.name = name; // delší tvar jména („Lukáš Horníček“ před „L. Horníček“)
        continue;
      }
      proposals.push({ name, positions, age, role, attributes: norm.attributes, injured, unknownPositions });
    }
    if (skippedNoName) issues.push('Řádek bez čitelného jména se vynechal.');
    for (const p of proposals) if (p.unknownPositions.length) issues.push(`${p.name}: pozice „${p.unknownPositions.join('“, „')}“ se nepodařilo převést, vynechaly se.`);
    return { proposals, issues };
  }

  /** planWrites(existing, proposals) → {add: [proposal], update: [{id, name, patch, changes}], same: [name]}.
      Hráč už v kádru (stejné jméno) se neduplikuje: doplní se mu atributy (nová hodnota přepíše starou a hlásí se jako změna), pozice a věk jen když chyběly,
      zranění se nastaví jen z výslovného „true“. `existing` jsou záznamy hráčů {id, name, positions, age, attributes, flags}. */
  function planWrites(existing, proposals) {
    const add = [];
    const update = [];
    const same = [];
    const have = (Array.isArray(existing) ? existing : []).filter((p) => isObj(p) && p.id && typeof p.name === 'string');
    for (const p of Array.isArray(proposals) ? proposals : []) {
      const hit = have.find((e) => CS.sameName(e.name, p.name));
      if (!hit) {
        add.push(p);
        continue;
      }
      const attributes = Object.assign({}, isObj(hit.attributes) ? hit.attributes : {});
      const changes = [];
      for (const [k, v] of Object.entries(p.attributes || {})) {
        const key = Object.keys(attributes).find((x) => CS.attrKey(x) === CS.attrKey(k));
        if (key === undefined) {
          attributes[k] = v;
          changes.push(`${k}: nově ${v}`);
        } else if (attributes[key] !== v) {
          changes.push(`${key}: ${attributes[key]} → ${v}`);
          attributes[key] = v;
        }
      }
      const patch = {};
      if (changes.length) patch.attributes = attributes;
      if ((!Array.isArray(hit.positions) || !hit.positions.length) && p.positions && p.positions.length) {
        patch.positions = p.positions;
        changes.push(`pozice: ${p.positions.join('/')}`);
      }
      if ((hit.age === null || hit.age === undefined) && p.age !== null) {
        patch.age = p.age;
        changes.push(`věk: ${p.age}`);
      }
      if (p.injured && !(hit.flags && hit.flags.injury)) {
        patch.injury = true;
        changes.push('zranění: ano');
      }
      if (Object.keys(patch).length) update.push({ id: hit.id, name: hit.name, patch, changes });
      else same.push(hit.name);
    }
    return { add, update, same };
  }

  return { PROMPT, MAX_PLAYERS, normalizeSquadRead, planWrites };
});
