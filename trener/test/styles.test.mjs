/* Zkouška vzhledu bez prohlížeče: hlídá tři věci, které se při úpravě barev snadno rozbijí.
   1) Světlý vzhled je v styles.css dvakrát (podle nastavení systému a podle ruční volby) a oba bloky musí být stejné.
   2) Každá proměnná, kterou CSS a kód používají, je definovaná.
   3) Dvojice barev písma a plochy mají v obou vzhledech kontrast aspoň 4,5 : 1 (WCAG AA pro běžný text).
   Zkouška čitelnosti v prohlížeči (scénář 11) měří skutečné obrazovky; tahle hlídá samotné barvy, takže chybu najde i tam,
   kam se obrazovky v scénáři nedostanou. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);
const css = readFileSync(new URL('styles.css', SRC), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// ------------------------------------------------------------------ rozbor CSS (jen to, co soubor opravdu používá)
/** Rozdělí text na pravidla první úrovně a pravidla uvnitř @media: [{ at, selector, body }]. */
function rules(text) {
  const out = [];
  const walk = (src, at) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      let quote = '';
      for (; j < src.length && depth > 0; j++) {
        const ch = src[j];
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head);
      else if (head.startsWith('@')) {
        /* @keyframes apod. se tu nezkoumá */
      } else out.push({ at, selector: head, body });
      i = j;
    }
  };
  walk(css, '');
  return out;
}
/** Deklarace z těla pravidla; středníky v uvozovkách a závorkách (adresa data:) ji nerozdělí. */
function declarations(body) {
  const list = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ';' && depth === 0) {
      list.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) list.push(cur);
  const map = new Map();
  for (const d of list) {
    const k = d.indexOf(':');
    if (k < 0) continue;
    map.set(d.slice(0, k).trim(), d.slice(k + 1).trim().replace(/\s+/g, ' '));
  }
  return map;
}

const all = rules(css);
const find = (selector, at = '') => {
  const r = all.find((x) => x.selector === selector && x.at === at);
  assert.ok(r, `v styles.css chybí pravidlo ${at ? at + ' ' : ''}${selector}`);
  return r;
};
const darkRoot = declarations(find(':root').body);
const lightMedia = declarations(find(":root:not([data-theme='dark'])", '@media (prefers-color-scheme: light)').body);
const lightAttr = declarations(find(":root[data-theme='light']").body);

// ------------------------------------------------------------------ 1) dva světlé bloky
test('světlý vzhled je v CSS dvakrát a oba bloky jsou stejné', () => {
  const keys = (m) => [...m.keys()].sort();
  assert.deepEqual(keys(lightMedia), keys(lightAttr), 'bloky mají různé proměnné');
  for (const [k, v] of lightMedia) assert.equal(lightAttr.get(k), v, `proměnná ${k} se v blocích liší`);
});

test('světlé bloky přepisují jen proměnné, které existují v tmavém základu', () => {
  for (const k of lightAttr.keys()) assert.ok(darkRoot.has(k) || k === 'color-scheme', `světlý vzhled definuje ${k}, ale tmavý základ ne`);
  // Všechno, co mění barvu plochy nebo písma, musí mít světlou podobu (jinak by ve světlém vzhledu zůstala tmavá).
  const mustHave = ['--bg', '--bg-2', '--field', '--panel', '--panel-2', '--panel-3', '--line', '--line-2', '--fg', '--muted-rgb', '--accent-rgb', '--accent-hi', '--accent-lo', '--accent-ink', '--accent-soft', '--t-verified-rgb', '--t-observed-rgb', '--t-user-rgb', '--t-inferred-rgb', '--t-unknown-rgb', '--ok-rgb', '--warn-rgb', '--bad-rgb', '--shadow', '--sheen', '--bg-glow', '--line-glow', '--pitch', '--pitch-line', '--chev'];
  for (const k of mustHave) assert.ok(lightAttr.has(k), `světlý vzhled nepřepisuje ${k}`);
});

// ------------------------------------------------------------------ 2) proměnné jsou definované
function sourceFiles() {
  const dir = (u) => readdirSync(u).filter((f) => f.endsWith('.js')).map((f) => new URL(f, u));
  return [...dir(SRC), ...dir(new URL('screens/', SRC))];
}
test('každá použitá proměnná je definovaná (v CSS i v kódu, který barvy bere z CSS)', () => {
  const declared = new Set();
  for (const r of all) for (const k of declarations(r.body).keys()) if (k.startsWith('--')) declared.add(k);
  const used = new Map();
  const note = (name, where) => used.set(name, (used.get(name) || new Set()).add(where));
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) note(m[1], 'styles.css');
  for (const url of sourceFiles()) {
    const text = readFileSync(url, 'utf8');
    for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) note(m[1], url.pathname.split('/src/')[1]);
  }
  const missing = [...used].filter(([name]) => !declared.has(name)).map(([name, where]) => `${name} (${[...where].join(', ')})`);
  assert.deepEqual(missing, [], 'nedefinované proměnné');
  assert.ok(used.size > 40, 'rozbor CSS nenašel proměnné; zkouška by nic nehlídala');
});

// ------------------------------------------------------------------ 3) kontrast
function theme(light) {
  const base = new Map(darkRoot);
  if (light) for (const [k, v] of lightAttr) base.set(k, v);
  return base;
}
/** Hodnota proměnné s dosazenými vnořenými var(). */
function resolve(tokens, name, depth = 0) {
  assert.ok(depth < 12, `cyklus v proměnné ${name}`);
  const raw = tokens.get(name);
  assert.ok(raw !== undefined, `chybí proměnná ${name}`);
  return raw.replace(/var\((--[a-z0-9-]+)\)/g, (_, n) => resolve(tokens, n, depth + 1));
}
function parseColor(text) {
  const t = text.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(t);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('neznámý zápis barvy: ' + text);
}
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** Barva proměnné; `alpha` přepíše průhlednost (odstíny rgb(var(--x-rgb) / 0.12)). */
const colorOf = (tokens, name, alpha) => {
  const c = parseColor(resolve(tokens, name));
  return alpha === undefined ? c : { ...c, a: alpha };
};

for (const [label, light] of [['tmavý', false], ['světlý', true]]) {
  const T = theme(light);
  const col = (name, alpha) => colorOf(T, name, alpha);
  const solid = ['--bg', '--bg-2', '--field', '--panel', '--panel-2', '--panel-3'];
  const insets = ['--bg', '--bg-2', '--panel', '--panel-2'];
  const need = 4.5;
  let fails = [];
  const check = (what, fg, bg) => {
    const r = ratio(over(fg, bg), bg);
    if (r < need) fails.push(`${what}: ${r.toFixed(2)}:1`);
  };
  // Každá zkouška vypíše všechny slabá místa najednou, ne jen první.
  const done = () => {
    const list = fails;
    fails = [];
    assert.deepEqual(list, [], `${label} vzhled: kontrast pod ${need}:1`);
  };

  test(`kontrast (${label} vzhled): písmo a tlumené písmo na všech plochách`, () => {
    for (const s of solid) {
      check(`--fg na ${s}`, col('--fg'), col(s));
      check(`--muted na ${s}`, col('--muted'), col(s));
    }
    done();
  });
  test(`kontrast (${label} vzhled): akcent a barvy s významem na plochách`, () => {
    for (const name of ['--accent', '--t-verified', '--t-observed', '--t-user', '--t-inferred', '--t-unknown', '--ok', '--warn', '--bad']) {
      for (const s of insets) check(`${name} na ${s}`, col(name), col(s));
    }
    done();
  });
  test(`kontrast (${label} vzhled): štítky (barva na vlastním 12% odstínu)`, () => {
    for (const [name, rgb] of [['--accent', '--accent-rgb'], ['--t-verified', '--t-verified-rgb'], ['--t-observed', '--t-observed-rgb'], ['--t-user', '--t-user-rgb'], ['--t-inferred', '--t-inferred-rgb'], ['--t-unknown', '--t-unknown-rgb'], ['--ok', '--ok-rgb'], ['--warn', '--warn-rgb'], ['--bad', '--bad-rgb'], ['--muted', '--muted-rgb']]) {
      for (const s of insets) {
        const bg = over(colorOf(T, name, 0.12), col(s));
        check(`${name} na odstínu štítku nad ${s}`, col(name), bg);
      }
    }
    done();
  });
  test(`kontrast (${label} vzhled): tlačítka s akcentem (text na obou koncích přechodu)`, () => {
    for (const bg of ['--accent', '--accent-hi', '--accent-lo']) check(`--accent-ink na ${bg}`, col('--accent-ink'), col(bg));
    done();
  });
  test(`kontrast (${label} vzhled): menu, vysvětlení a hlášky na průhledných odstínech`, () => {
    // Odstíny leží na kartě (--panel) nebo na vnořené ploše (--bg-2); silnější odstín (0,17) je jen pod menu na kartě, kde je písmo --fg nebo --accent.
    for (const s of ['--panel', '--bg-2']) {
      for (const a of [0.09, 0.1, 0.17]) {
        if (a > 0.1 && s !== '--panel') continue;
        const tint = over(colorOf(T, '--accent', a), col(s));
        check(`--fg na odstínu akcentu ${a} nad ${s}`, col('--fg'), tint);
        check(`--accent na odstínu akcentu ${a} nad ${s}`, col('--accent'), tint);
        if (a <= 0.1) check(`--muted na odstínu akcentu ${a} nad ${s}`, col('--muted'), tint);
      }
    }
    for (const s of insets) {
      for (const a of [0.05, 0.06, 0.08, 0.12, 0.14, 0.24]) {
        const tint = over(colorOf(T, '--muted', a), col(s));
        check(`--fg na šedém odstínu ${a} nad ${s}`, col('--fg'), tint);
        if (a <= 0.14) check(`--muted na šedém odstínu ${a} nad ${s}`, col('--muted'), tint);
      }
      for (const kind of ['--ok', '--warn', '--bad']) {
        const tint = over(colorOf(T, kind, 0.1), col(s));
        check(`--fg na odstínu ${kind} nad ${s}`, col('--fg'), tint);
        check(`--muted na odstínu ${kind} nad ${s}`, col('--muted'), tint);
      }
    }
    // zvýrazněná odpověď a pasáž leží na plné ploše --accent-soft
    check('--fg na --accent-soft', col('--fg'), col('--accent-soft'));
    check('--muted na --accent-soft', col('--muted'), col('--accent-soft'));
    done();
  });
}
