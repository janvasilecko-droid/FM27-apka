import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Tac = require('../src/fmftac.js');
const Recruit = require('../src/recruit.js');
const Rolefit = require('../src/rolefit.js');
const Matchlens = require('../src/matchlens.js');
const Websources = require('../src/websources.js');
const Careerread = require('../src/careerread.js');
const Tactics = require('../src/tactics.js');
const Tableimport = require('../src/tableimport.js');
const Core = require('../src/core.js');

// Texty ze souborů, od modelu, z tabulek, z webu a z pluginu jsou cizí vstup. Zkouška neprochází ručně vybraný seznam, ale vlastnosti Unicode: každý PŘIDĚLENÝ znak, který je řídicí (Cc),
// formátovací (Cf), oddělovač řádku nebo odstavce (Zl, Zp) nebo se při zobrazení ignoruje (Default_Ignorable_Code_Point), plus prázdné braillské písmeno a náhradní znak objektu
// (ty v žádné z těch vlastností nejsou). Znaky se tu nikde nepíšou doslova, vznikají z čísel; zkouška na konci hlídá, že žádný nevznikl ani ve zdrojích.
const HIDDEN = [];
{
  const hidden = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}]', 'u');
  const assigned = new RegExp('\\P{Cn}', 'u');
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCodePoint(cp);
    if (hidden.test(c) && assigned.test(c)) HIDDEN.push(c);
  }
  HIDDEN.push(String.fromCodePoint(0x2800), String.fromCodePoint(0xfffc));
}
const name = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

/** Z každého výstupu musí zmizet každý skrytý znak a viditelný text zůstat: sanitizér dostane „A“ + znak + „B“ (fn vrací text; null je u názvů povolené odmítnutí, viz allowNull). */
function eachHidden(fn, label, allowNull) {
  let n = 0;
  for (const c of HIDDEN) {
    const out = fn('A' + c + 'B');
    if (out === null && allowNull) {
      n++;
      continue;
    }
    assert.equal(typeof out, 'string', `${label} ${name(c)}: ${JSON.stringify(out)}`);
    assert.ok(!out.includes(c), `${label}: znak ${name(c)} zůstal ve výstupu ${JSON.stringify(out)}`);
    assert.equal(out.replace(/\s+/g, ''), 'AB', `${label}: ${name(c)} změnil viditelný text: ${JSON.stringify(out)}`);
    n++;
  }
  return n;
}

test('seznam skrytých znaků vzniká z vlastností Unicode a obsahuje známé nebezpečné znaky; žádný běžný viditelný znak v něm není', () => {
  const must = [0x00, 0x09, 0x0a, 0x7f, 0x85, 0xad, 0x061c, 0x17b4, 0x180b, 0x200b, 0x200d, 0x200e, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0x2800, 0x3164, 0xfe0f, 0xfeff, 0xffa0, 0xfffc, 0xe0001, 0xe0041, 0xe007f, 0xe0100];
  for (const cp of must) assert.ok(HIDDEN.includes(String.fromCodePoint(cp)), 'chybí ' + cp.toString(16));
  assert.ok(HIDDEN.length > 450, String(HIDDEN.length));
  for (const c of 'AaÁáČčŘřŽžĚěÝýÚúŮů0123456789 .,-+€£$% ') assert.ok(!HIDDEN.includes(c), name(c));
  assert.equal(new Set(HIDDEN).size, HIDDEN.length, 'bez duplicit');
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
  for (const [label, pick] of [['tým', (m) => m.home.name], ['trenér', (m) => m.home.manager.name], ['soutěž', (m) => m.competition], ['zápas', (m) => m.matchId], ['hráč', (m) => m.players[0] && m.players[0].name]]) {
    // trenér má za jménem ještě „X“, ostatní mají výstup přesně AB; společné je, že skrytý znak zmizí a viditelný text zůstane
    const n = eachHidden((s) => pick(meta(s)).replace(/ X$/, ''), 'matchlens ' + label);
    assert.equal(n, HIDDEN.length);
  }
});

test('websources.cleanText: každý skrytý znak zmizí, značky HTML a špičaté závorky také', () => {
  assert.equal(eachHidden((s) => Websources.cleanText(s, 200), 'cleanText'), HIDDEN.length);
  assert.equal(Websources.cleanText('A<b>B</b>' + String.fromCodePoint(0x202e) + ' C', 200), 'A B C');
});

test('careerread: poznámka se čistí, název klubu a soutěže se s řídicím nebo skrytým znakem odmítne (nebo projde bez něj, když šlo jen o mezeru)', () => {
  assert.equal(eachHidden((s) => Careerread.normalizeCareerExtraction({ club: 'Chelsea', notes: s }).note, 'careerread notes'), HIDDEN.length);
  for (const field of ['club', 'competition']) {
    const probe = (s) => {
      const r = Careerread.normalizeCareerExtraction({ club: field === 'club' ? s : 'Chelsea', competition: field === 'competition' ? s : 'Premier League', season: '2026/27' });
      return r.read[field];
    };
    assert.equal(eachHidden(probe, 'careerread ' + field, true), HIDDEN.length);
    // odmítnutí není jen formálnost: klub bez skrytého znaku se přečte
    assert.equal(probe('Chelsea'), field === 'club' ? 'Chelsea' : 'Chelsea');
  }
});

test('tactics.normalizeTacticExtraction: každý skrytý znak zmizí z názvu, mentality, instrukcí a rolí', () => {
  const read = (s) => Tactics.normalizeTacticExtraction({ name: s, formation: '4-2-3-1', mentality: s, instructions: [s], roles: [{ pos: 'ST', role: s, duty: s, player: s }] }).read;
  assert.equal(eachHidden((s) => read(s).name, 'tactics name'), HIDDEN.length);
  assert.equal(eachHidden((s) => read(s).mentality, 'tactics mentality'), HIDDEN.length);
  assert.equal(eachHidden((s) => read(s).instructions[0], 'tactics instruction'), HIDDEN.length);
  for (const field of ['role', 'duty', 'player']) assert.equal(eachHidden((s) => read(s).roles[0][field], 'tactics role ' + field), HIDDEN.length);
});

test('tableimport.cellText: každý skrytý znak zmizí z buňky tabulky', () => {
  assert.equal(eachHidden((s) => Tableimport.cellText('<b>' + s + '</b>'), 'cellText'), HIDDEN.length);
});

test('core.oneLine (text do promptů): každý skrytý znak zmizí; zalomení řádku se změní na středník, svislice na podobný znak', () => {
  // zalomení řádků (LF, CR, oddělovače řádku a odstavce) jsou ve výstupu středník: u těch se kontroluje, že zbyl středník a ne znak
  assert.equal(eachHidden((s) => Core.oneLine(s, 200).replace(/ ; /g, ' '), 'oneLine'), HIDDEN.length);
  assert.equal(Core.oneLine('A\nB|C', 100), 'A ; B¦C');
  assert.equal(Core.oneLine('A' + String.fromCodePoint(0xe0041, 0xe0042) + 'B', 100), 'A B', 'značky (skrytý text pro modely) zmizí');
});

test('zdroje: v žádném souboru JavaScriptu v trener/src a trener/test není doslovný neviditelný ani přepínací znak (jen zápis přes escape, RegExp nebo číslo)', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', 'out', 'dist'].includes(e.name) ? [] : walk(new URL(e.name + '/', dir))) : /\.(js|mjs|cjs)$/.test(e.name) ? [new URL(e.name, dir)] : []));
  const files = [...walk(new URL('../src/', import.meta.url)), ...walk(new URL('./', import.meta.url))];
  assert.ok(files.length > 60, 'prošlo se ' + files.length + ' souborů');
  const re = new RegExp('[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\ufffc]', 'u');
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/[\n\r\t]/g, ' ');
    const m = re.exec(text);
    assert.equal(m, null, `${f.pathname.split('/trener/')[1]}: doslovný znak ${m && name(m[0])}`);
  }
});
