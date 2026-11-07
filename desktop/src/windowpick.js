/* Výběr okna hry pro desktopovou aplikaci. Čistá funkce bez Electronu (desktop/test/windowpick.test.mjs): dostane seznam zdrojů, které vrací
   desktopCapturer.getSources({ types: ['window'] }), a řekne, které z nich je okno Football Manageru.

   PROČ: webová verze se při každém „Načíst z okna hry“ ptá prohlížeče na výběr okna. Desktopová aplikace okno FM27 najde sama podle názvu, takže se
   neptá. Když okno nenajde nebo jich najde víc, nic nehádá: vrátí `source: null` a aplikace ukáže seznam oken k výběru. Vlastní okno aplikace se nikdy
   nevybere (snímalo by samo sebe). Název okna ve hře není ověřený na skutečném FM27 (předpoklad: „Football Manager 2027“), proto jde vzor přepsat
   v souboru nastavení (gameWindowPattern) a proto je záložní výběr oken. */
'use strict';

/** Výchozí vzory názvu okna hry: „Football Manager 2027“ (a zkrácený „FM27“). */
const DEFAULT_PATTERNS = Object.freeze([/football\s*manager/i, /^fm\s?2\d\b/i]);
/** Přesný název okna hry („Football Manager 2027“, „Football Manager 27“): má přednost před oknem, které ho jen obsahuje (spouštěč, upozornění). */
const EXACT_TITLE = /^football manager( ?20)?\d{2}$/i;

const clean = (s) =>
  String(s === null || s === undefined ? '' : s)
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Vzory z nastavení: řetězce se převedou na regulární výrazy (bez rozlišení velikosti písmen); neplatný nebo příliš dlouhý vzor se přeskočí. */
function compilePatterns(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : typeof list === 'string' ? [list] : []) {
    if (p instanceof RegExp) out.push(p);
    else if (typeof p === 'string' && p.trim() && p.length <= 200) {
      try {
        out.push(new RegExp(p.trim(), 'i'));
      } catch (e) {
        /* neplatný vzor se přeskočí; výchozí vzory platí dál */
      }
    }
  }
  return out;
}

/** Okna ze zdrojů: jen zdroje typu okno s neprázdným názvem a bez vyloučených id. */
function windowsOf(sources, excludeIds) {
  const skip = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const out = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id.startsWith('window:') || skip.has(s.id)) continue;
    const name = clean(s.name);
    if (!name) continue;
    out.push({ id: s.id, name, source: s });
  }
  return out;
}

/**
 * pickGameWindow(sources, opts) → { source, matches, others }
 *   source   zdroj okna hry, když je právě jedno jisté okno; jinak null (nic se nehádá)
 *   matches  okna, jejichž název odpovídá vzoru hry (pro seznam oken k výběru jsou první)
 *   others   ostatní okna, podle názvu
 * opts: { patterns: [RegExp|string], excludeIds: [id vlastního okna], ownTitles: [názvy vlastního okna] }
 */
function pickGameWindow(sources, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const custom = compilePatterns(o.patterns);
  const patterns = custom.length ? custom : DEFAULT_PATTERNS;
  const own = (Array.isArray(o.ownTitles) ? o.ownTitles : []).map((t) => clean(t).toLowerCase()).filter(Boolean);
  const all = windowsOf(sources, o.excludeIds).filter((w) => !own.includes(w.name.toLowerCase()));
  const matches = all.filter((w) => patterns.some((p) => p.test(w.name)));
  const others = all.filter((w) => !matches.includes(w)).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  let source = null;
  if (matches.length === 1) source = matches[0].source;
  else if (matches.length > 1) {
    const exact = matches.filter((w) => EXACT_TITLE.test(w.name));
    if (exact.length === 1) source = exact[0].source;
  }
  return { source, matches, others };
}

/** Popisek okna do nabídky: název zkrácený na rozumnou délku. */
function labelOf(w, max) {
  const limit = Number.isInteger(max) && max > 10 ? max : 70;
  return w.name.length > limit ? `${w.name.slice(0, limit - 1)}…` : w.name;
}

module.exports = { DEFAULT_PATTERNS, EXACT_TITLE, clean, compilePatterns, windowsOf, pickGameWindow, labelOf };
