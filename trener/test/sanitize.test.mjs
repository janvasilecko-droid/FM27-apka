import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Tac = require('../src/fmftac.js');
const Recruit = require('../src/recruit.js');
const Rolefit = require('../src/rolefit.js');
const Matchlens = require('../src/matchlens.js');
const Websources = require('../src/websources.js');

// Texty ze souborů, od modelu a z webu jsou cizí vstup: pět modulů je čistí stejnou třídou znaků (řídicí, oddělovače řádků, všechny formátovací znaky Unicode, neviditelné výplně a selektory).
// Znaky jsou tu zapsané escapem, ve zdrojích nemá být žádný doslovný neviditelný znak.
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i));
const HIDDEN = [
  ...range(0x00, 0x08), ...range(0x0b, 0x1f), '\u007f', ...range(0x80, 0x9f), // řídicí znaky včetně C1 (bez tabulátoru a konce řádku, které jsou jen mezera)
  '\u00ad', // měkký spojovník
  ...range(0x0600, 0x0605), '\u061c', '\u06dd', '\u070f', '\u180e', // arabské formátovací značky, Mongolian vowel separator
  ...range(0x200b, 0x200f), // nulová šířka, spojky, značky směru
  '\u2028', '\u2029', // oddělovač řádku a odstavce
  ...range(0x202a, 0x202e), // řízení směru písma
  ...range(0x2060, 0x2064), ...range(0x2066, 0x206f), // spojka slov, neviditelné operátory, izoláty a zastaralé řízení
  '\ufeff', ...range(0xfff9, 0xfffb), // BOM, poznámky mezi řádky
  '\u034f', '\u115f', '\u1160', '\u3164', '\uffa0', '\u2800', '\ufffc', // spojka grafémů, výplně hangul, prázdné braillské písmeno, nahrazující znak objektu
  ...range(0xfe00, 0xfe0f), String.fromCodePoint(0xe0100), String.fromCodePoint(0xe01ef), // selektory variant
  String.fromCodePoint(0xe0001), String.fromCodePoint(0xe0020), String.fromCodePoint(0xe0041), String.fromCodePoint(0xe007f), // značky (skrytý text pro modely)
];
const name = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

/** Ze všech hodnot musí zmizet každý skrytý znak a viditelný text zůstat: sanitizér dostane „A“ + znak + „B“. */
function eachHidden(clean, label) {
  let n = 0;
  for (const c of HIDDEN) {
    const out = clean('A' + c + 'B');
    assert.equal(typeof out, 'string', `${label} ${name(c)}`);
    assert.ok(!out.includes(c), `${label}: znak ${name(c)} zůstal ve výstupu ${JSON.stringify(out)}`);
    assert.equal(out.replace(/\s+/g, ''), 'AB', `${label}: ${name(c)} změnil viditelný text: ${JSON.stringify(out)}`);
    n++;
  }
  return n;
}

test('seznam skrytých znaků je opravdu skrytý: žádný z nich není písmeno, číslice ani tisknutelný znak (zkouška proti vlastnostem Unicode)', () => {
  for (const c of HIDDEN) assert.ok(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f\u115f\u1160\u3164\uffa0\u2800︀-️\ufffc\u{e0100}-\u{e01ef}]/u.test(c), name(c));
  assert.ok(HIDDEN.length > 130, String(HIDDEN.length));
  // nic z toho není běžné viditelné písmeno ani znak češtiny
  for (const c of 'AaÁáČčŘřŽžĚěÝýÚúŮů0123456789 .,-+€£$%') assert.ok(!HIDDEN.includes(c), c);
});

test('fmftac.displayText: každý skrytý znak zmizí', () => {
  assert.equal(eachHidden((s) => Tac.displayText(s, 80), 'displayText'), HIDDEN.length);
});

test('recruit.text: každý skrytý znak zmizí (číslo se převede, objekt dá prázdný text)', () => {
  assert.equal(eachHidden((s) => Recruit.text(s, 80), 'recruit.text'), HIDDEN.length);
  assert.equal(Recruit.text({ toString: () => 'x' }, 80), '');
  assert.equal(Recruit.text(12.5, 80), '12.5');
});

test('rolefit.normalizeRoleExtraction: každý skrytý znak zmizí z názvu role, fáze, povinnosti i atributů', () => {
  const probe = (field) => (s) => {
    const raw = { role: 'Role', phase: 'in', duty: 'Attack', key: ['Passing'], pref: ['Vision'] };
    raw[field] = field === 'key' || field === 'pref' ? [s] : s;
    const r = Rolefit.normalizeRoleExtraction(raw);
    const value = field === 'key' ? (r.read && r.read.key[0]) || '' : field === 'pref' ? (r.read && r.read.pref[0]) || '' : r.read && r.read[field];
    return typeof value === 'string' ? value : '';
  };
  // každé pole se musí přečíst (viditelný text zůstane) a nesmí nést skrytý znak
  for (const field of ['role', 'phase', 'duty', 'key', 'pref']) assert.equal(eachHidden(probe(field), 'rolefit ' + field), HIDDEN.length);
});

test('matchlens.parseMeta: každý skrytý znak zmizí z názvů týmů, jmen, soutěže a identifikátoru zápasu', () => {
  const meta = (s) => Matchlens.parseMeta({
    matchId: s,
    competition: { name: s },
    home: { name: s, manager: { firstName: s, secondName: 'X', isHumanControlled: true } },
    away: { name: 'Hosté' },
    players: [{ slot: 1, team: 'home', displayName: s, position: 'ST' }],
  });
  assert.equal(meta('ok').ok, true);
  for (const c of HIDDEN) {
    const m = meta('A' + c + 'B');
    for (const [label, value] of [['tým', m.home.name], ['trenér', m.home.manager.name], ['soutěž', m.competition], ['zápas', m.matchId], ['hráč', m.players[0] && m.players[0].name]]) {
      assert.equal(typeof value, 'string', `${label} ${name(c)}`);
      assert.ok(!value.includes(c), `${label}: znak ${name(c)} zůstal ve výstupu ${JSON.stringify(value)}`);
      assert.ok(value.replace(/\s+/g, '').startsWith('A') && value.replace(/\s+/g, '').includes('B'), `${label}: ${name(c)} změnil viditelný text: ${JSON.stringify(value)}`);
    }
  }
});

test('websources.cleanText: každý skrytý znak zmizí, značky HTML a špičaté závorky také', () => {
  assert.equal(eachHidden((s) => Websources.cleanText(s, 200), 'cleanText'), HIDDEN.length);
  assert.equal(Websources.cleanText('A<b>B</b>\u202e C', 200), 'A B C');
});

test('zdroje: v tomto souboru ani v pěti modulech není doslovný neviditelný ani přepínací znak (jen zápis přes escape nebo RegExp)', () => {
  const files = ['sanitize.test.mjs', '../src/fmftac.js', '../src/recruit.js', '../src/rolefit.js', '../src/matchlens.js', '../src/websources.js'];
  const re = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\u034f\\u115f\\u1160\\u3164\\uffa0\\u2800\\ufffc]', 'u');
  for (const f of files) {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/[\n\r\t]/g, ' ');
    const m = re.exec(text);
    assert.equal(m, null, `${f}: doslovný znak ${m && name(m[0])}`);
  }
});
