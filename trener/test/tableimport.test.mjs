import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TI = require('../src/tableimport.js');

const bytes = (text, enc) => new Uint8Array(Buffer.from(text, enc || 'utf8'));
const ATTRS = ['Finishing', 'Passing', 'Pace', 'Stamina', 'Tackling', 'Vision'];
const csvOf = (rows) => rows.map((r) => r.join(',')).join('\n');

// ---------------------------------------------------------------- bajty
test('decodeBytes: UTF-8 s BOM i bez, UTF-16 s BOM, stará česká znaková sada', () => {
  assert.deepEqual(TI.decodeBytes(bytes('\ufeffJméno;Věk\nDvořák;24', 'utf8')), { ok: true, text: 'Jméno;Věk\nDvořák;24', encoding: 'UTF-8' });
  assert.equal(TI.decodeBytes(bytes('Jméno;Věk')).text, 'Jméno;Věk');
  const u16 = TI.decodeBytes(bytes('\ufeffJméno\tVěk\nDvořák\t24', 'utf16le'));
  assert.equal(u16.ok, true);
  assert.equal(u16.encoding, 'UTF-16');
  assert.equal(u16.text, 'Jméno\tVěk\nDvořák\t24');
  // „Dvořák“ ve windows-1250: ř = 0xF8, á = 0xE1
  const cp = TI.decodeBytes(new Uint8Array([0x44, 0x76, 0x6f, 0xf8, 0xe1, 0x6b]));
  assert.equal(cp.ok, true);
  assert.equal(cp.encoding, 'windows-1250');
  assert.equal(cp.text, 'Dvořák');
});

test('decodeBytes: prázdný soubor, příliš velký soubor a špatný vstup se odmítnou česky', () => {
  assert.equal(TI.decodeBytes(new Uint8Array(0)).ok, false);
  const big = TI.decodeBytes(new Uint8Array(TI.MAX_BYTES + 1));
  assert.equal(big.ok, false);
  assert.match(big.error, /větší než 2 MB/);
  for (const bad of [null, undefined, 'text', 5, {}]) assert.equal(TI.decodeBytes(bad).ok, false);
  assert.equal(TI.decodeBytes(new ArrayBuffer(3)).ok, true);
});

// ---------------------------------------------------------------- HTML
test('parseHtmlTables: buňky th i td, entity, značky uvnitř buňky, skripty a komentáře se ignorují', () => {
  const html = `<html><script>var t = '<table><tr><td>ZLE</td></tr></table>';</script><!-- <table><tr><td>KOMENTAR</td></tr></table> -->
    <table><tr><th>Name</th><th>Age</th></tr><tr><td><a href="x">Jan &amp; Petr</a></td><td>24&nbsp;</td></tr><tr><td>Karel<br>Dvořák</td><td>&#50;7</td></tr></table>`;
  const tables = TI.parseHtmlTables(html);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0], [['Name', 'Age'], ['Jan & Petr', '24'], ['Karel Dvořák', '27']]);
});

test('parseHtmlTables: víc tabulek, extractTable vybere největší; buňky se čistí od značek a řídicích znaků', () => {
  const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table><table><tr><th>Name</th><th>Age</th><th>Pos</th></tr><tr><td>Jan\u0000</td><td>20</td><td>ST</td></tr><tr><td>&lt;script&gt;x&lt;/script&gt;</td><td>21</td><td>GK</td></tr></table>';
  const t = TI.extractTable(html);
  assert.equal(t.ok, true);
  assert.equal(t.kind, 'html');
  assert.deepEqual(t.headers, ['Name', 'Age', 'Pos']);
  assert.equal(t.rows[0][0], 'Jan');
  assert.ok(!/[<>]/.test(t.rows[1][0]));
  assert.equal(TI.extractTable('<p>bez tabulky</p>').ok, false);
});

// ---------------------------------------------------------------- CSV, TSV, text
test('extractTable: čárka, středník, tabulátor, svislice; uvozovky s oddělovačem a zalomením', () => {
  const rows = [['Name', 'Age', 'Pos'], ['Jan Novák', '24', 'ST'], ['"Svoboda, Petr"', '31', 'GK']];
  for (const [d, kind] of [[',', 'csv'], [';', 'csv-strednik'], ['\t', 'tsv'], ['|', 'svislitka']]) {
    const t = TI.extractTable(rows.map((r) => r.join(d)).join('\n'));
    assert.equal(t.ok, true, kind);
    assert.equal(t.kind, kind);
    assert.deepEqual(t.headers, ['Name', 'Age', 'Pos'], kind);
    assert.equal(t.rows[1][0], 'Svoboda, Petr', kind);
  }
  const quoted = TI.extractTable('Name,Note,Age\n"Jan ""Kanon"" Novák","řádek 1\nřádek 2",24\nPetr,x,30');
  assert.equal(quoted.rows[0][0], 'Jan "Kanon" Novák');
  assert.equal(quoted.rows[0][1], 'řádek 1\nřádek 2');
  assert.equal(quoted.rows.length, 2);
});

test('extractTable: zarovnaný text se sloupci oddělenými dvěma mezerami; CRLF; prázdné řádky', () => {
  const t = TI.extractTable('Name          Age   Pos\r\n\r\nJan Novák     24    ST\r\nPetr Svoboda  31    GK\r\n');
  assert.equal(t.ok, true);
  assert.equal(t.kind, 'zarovnany-text');
  assert.deepEqual(t.headers, ['Name', 'Age', 'Pos']);
  assert.equal(t.rows.length, 2);
});

test('extractTable: nesmysl, jeden řádek a prázdno nejsou tabulka a říká se to česky', () => {
  for (const bad of ['', 'jen jeden řádek', 'abc\n', '[1,2,3]', '{"a":1}', 'a b c d e f']) {
    const t = TI.extractTable(bad);
    assert.equal(t.ok, false, JSON.stringify(bad));
    assert.match(t.error, /tabulku|záznam|řádky/);
  }
});

test('extractTable: tabulka bez hlavičky dostane sloupce „Sloupec n“; hlavička pod úvodním řádkem se najde', () => {
  const noHeader = TI.extractTable('Jan,24,15\nPetr,31,12\nKarel,27,11');
  assert.equal(noHeader.ok, true);
  assert.equal(noHeader.headerless, true);
  assert.deepEqual(noHeader.headers, ['Sloupec 1', 'Sloupec 2', 'Sloupec 3']);
  assert.equal(noHeader.rows.length, 3);
  const withTitle = TI.extractTable('Soupiska Chelsea,,\nName,Age,Pos\nJan,24,ST\nPetr,31,GK');
  assert.equal(withTitle.ok, true);
  assert.deepEqual(withTitle.headers, ['Name', 'Age', 'Pos']);
  assert.equal(withTitle.rows.length, 2);
});

test('extractTable: limity řádků a sloupců, dlouhé buňky se zkrátí', () => {
  const head = Array.from({ length: 100 }, (_, i) => 'c' + i).join(',');
  const body = Array.from({ length: 600 }, (_, r) => Array.from({ length: 100 }, (_, i) => (i === 0 ? 'x'.repeat(500) : String(r % 20 + 1))).join(',')).join('\n');
  const t = TI.extractTable(head + '\n' + body);
  assert.equal(t.ok, true);
  assert.equal(t.columns, 80);
  assert.equal(t.rows.length, TI.MAX_ROWS);
  assert.ok(t.rows[0][0].length <= 200);
});

// ---------------------------------------------------------------- JSON
test('extractTable: JSON pole objektů, objekt s polem „players“, JSON Lines; vnořené skupiny se rozbalí jako fmsave', () => {
  const rec = { name: 'Jan Novák', age: 24, natural_positions: ['ST', 'AMC'], attributes: { finishing: 14, passing: 12 }, ability: { current: 120 }, deep: { a: { b: { c: 1 } } } };
  const arr = TI.extractTable(JSON.stringify([rec, Object.assign({}, rec, { name: 'Petr' })]));
  assert.equal(arr.ok, true);
  assert.equal(arr.kind, 'json');
  assert.ok(['name', 'age', 'natural_positions', 'attributes_finishing', 'attributes_passing', 'ability_current'].every((h) => arr.headers.includes(h)), arr.headers.join(','));
  assert.equal(arr.rows[0][arr.headers.indexOf('natural_positions')], 'ST;AMC');
  assert.equal(arr.rows[0][arr.headers.indexOf('attributes_finishing')], '14');
  const wrapped = TI.extractTable(JSON.stringify({ meta: 1, players: [rec] }));
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.rows.length, 1);
  const lines = TI.extractTable(JSON.stringify(rec) + '\n' + JSON.stringify(rec));
  assert.equal(lines.ok, true);
  assert.equal(lines.kind, 'jsonl');
  assert.equal(lines.rows.length, 2);
  assert.equal(TI.extractTable('{"a": [1,2,3]}').ok, false);
  assert.equal(TI.extractTable('[]').ok, false);
});

// ---------------------------------------------------------------- význam sloupců
const table = (headers, rows) => ({ ok: true, headers, rows });
const roleOf = (map) => Object.fromEntries(map.map((c) => [c.header, c.role]));

test('guessMapping: obecná tabulka (anglicky i česky): jméno, věk, pozice, pět a víc číselných sloupců 1 až 20 jsou atributy', () => {
  const t = table(['Jméno', 'Věk', 'Pozice', ...ATTRS, 'Zápasy', 'Hodnota'], [
    ['Jan Novák', '24', 'ST', '15', '12', '14', '13', '11', '10', '3', '1000000'],
    ['Petr Svoboda', '31', 'GK', '3', '8', '9', '5', '7', '12', '18', '500000'],
    ['Karel Dvořák', '27', 'DC', '5', '11', '10', '6', '9', '14', '10', '700000'],
  ]);
  const r = roleOf(TI.guessMapping(t));
  assert.equal(r['Jméno'], 'name');
  assert.equal(r['Věk'], 'age');
  assert.equal(r['Pozice'], 'positions');
  for (const a of ATTRS) assert.equal(r[a], 'attribute', a);
  assert.equal(r['Zápasy'], 'ignore'); // číslo 1 až 20, které není atribut
  assert.equal(r['Hodnota'], 'ignore');
  const en = roleOf(TI.guessMapping(table(['Player', 'Age', 'Position'], [['A B', '20', 'ST'], ['C D', '21', 'GK']])));
  assert.deepEqual([en.Player, en.Age, en.Position], ['name', 'age', 'positions']);
});

test('guessMapping: málo číselných sloupců nejsou atributy automaticky; jméno se najde i bez názvu sloupce; CA/PA a skryté údaje nikdy', () => {
  const few = table(['Name', 'Pace', 'Passing', 'CA', 'PA', 'Consistency', 'Important Matches'], [
    ['A B', '12', '11', '120', '150', '14', '13'],
    ['C D', '10', '9', '110', '140', '12', '11'],
    ['E F', '14', '13', '100', '130', '10', '9'],
  ]);
  const m = TI.guessMapping(few);
  const r = roleOf(m);
  assert.equal(r.Pace, 'ignore');
  assert.match(m.find((c) => c.header === 'Pace').reason, /málo/);
  for (const h of ['CA', 'PA', 'Consistency', 'Important Matches']) assert.equal(r[h], 'ignore', h);
  const noName = roleOf(TI.guessMapping(table(['Sloupec 1', 'Sloupec 2'], [['Jan Novák', '24'], ['Petr Svoboda', '31'], ['Karel Dvořák', '27']])));
  assert.equal(noName['Sloupec 1'], 'name');
  // hlavičky skrytých údajů se nikdy nenavrhnou jako atributy, ani když je sloupců hodně
  const many = table(['Name', ...ATTRS, 'Injury Proneness', 'Versatility', 'Dirtiness'], [
    ['A B', '12', '11', '10', '9', '8', '7', '14', '13', '12'],
    ['C D', '10', '9', '8', '7', '6', '5', '12', '11', '10'],
    ['E F', '14', '13', '12', '11', '10', '9', '16', '15', '14'],
  ]);
  const rm = roleOf(TI.guessMapping(many));
  for (const h of ['Injury Proneness', 'Versatility', 'Dirtiness']) assert.equal(rm[h], 'ignore', h);
  assert.equal(rm.Finishing, 'attribute');
});

test('guessMapping: už u dvou řádků se pozná pět atributů; sloupec s identifikátorem hráče a zkratka CA nikdy nejsou atribut a důvod je vidět', () => {
  const t = table(['Unique ID', 'Name', 'Age', 'Pos', 'Fin', 'Pas', 'Pac', 'Sta', 'Tck', 'CA', 'PA'], [
    ['1', 'A B', '25', 'ST', '6', '11', '12', '14', '15', '140', '170'],
    ['2', 'C D', '19', 'GK', '13', '9', '16', '12', '5', '110', '130'],
  ]);
  const m = TI.guessMapping(t);
  const r = roleOf(m);
  for (const h of ['Fin', 'Pas', 'Pac', 'Sta', 'Tck']) assert.equal(r[h], 'attribute', h);
  assert.equal(r['Unique ID'], 'ignore');
  assert.match(m.find((c) => c.header === 'Unique ID').reason, /není atribut/);
  for (const h of ['CA', 'PA']) {
    assert.equal(r[h], 'ignore', h);
    assert.match(m.find((c) => c.header === h).reason, /skrytý údaj hry/, h);
  }
  // jediný řádek na odhad nestačí: nic se nenavrhne jako atribut
  const one = roleOf(TI.guessMapping(table(['Name', 'Fin', 'Pas', 'Pac', 'Sta', 'Tck'], [['A B', '6', '11', '12', '14', '15']])));
  assert.equal(one.Fin, 'ignore');
});

test('FM View Exporter (podle schématu FM Player Analyzer): hlavičky ve hře anglicky, rozsahy u neoskautovaných atributů a pozice „D (RLC)“; skryté nic', () => {
  const header = 'Unique ID,Player,Inf,Age,Wage,Transfer Value,Nation,Position,Personality,Rating,Preferred Foot,Height,Club,Finishing,Off The Ball,Team Work,Command Of Area,Passing,Pace,Stamina,Vision';
  const csv = [
    header,
    '16000101,Jan Novák,,24,"£12,000 p/w",£1M - £2M,ENG,"D (RLC), WB (R)",Balanced,6.9,Right Only,181 cm,Chelsea,15,14,13,2,12,14,13,11',
    '16000102,Petr Dvořák,,31,"£8,000 p/w",£500K,CZE,ST,Fairly Professional,7.1,Left Only,190 cm,Chelsea,16,12-15,14,3,10,9,15,12',
    '16000103,Karel Čermák,,27,"£5,000 p/w",£800K,CZE,GK,Resolute,6.4,Right Only,195 cm,Chelsea,3,4,9,17,8,7,12,9',
  ].join('\n');
  const t = TI.extractTable(csv);
  assert.equal(t.ok, true);
  const m = TI.guessMapping(t);
  const r = roleOf(m);
  assert.equal(r.Player, 'name');
  assert.equal(r.Age, 'age');
  assert.equal(r.Position, 'positions');
  for (const h of ['Finishing', 'Team Work', 'Command Of Area', 'Passing', 'Pace', 'Stamina', 'Vision']) assert.equal(r[h], 'attribute', h);
  for (const h of ['Unique ID', 'Inf', 'Wage', 'Transfer Value', 'Nation', 'Personality', 'Rating', 'Preferred Foot', 'Height', 'Club']) assert.equal(r[h], 'ignore', h);
  // sloupec s rozsahem „12-15“ (neoskautovaný atribut) nemá jen čísla: nepozná se jako atribut sám od sebe a hodnota se neuhádne
  assert.equal(r['Off The Ball'], 'ignore');
  const out = TI.rowsToPlayers(t, m, { max: 60, existingNames: [] });
  assert.equal(out.players.length, 3);
  assert.deepEqual(out.players[0].positions, []);
  assert.match(out.players[0].notes, /Pozice v exportu: D \(RLC\), WB \(R\)/);
  assert.equal(out.players[1].attributes.Finishing, 16);
  assert.equal(out.players[1].attributes['Off The Ball'], undefined);
  assert.equal(out.players[2].attributes['Command Of Area'], 17);
});

test('shortlist z FMSuperScout (BOM, konce řádků CRLF, vše v uvozovkách): jméno, věk a pozice se načtou, CA a PA jsou skryté údaje a vynechají se', () => {
  const rows = [
    ['Name', 'Position', 'Age', 'Club', 'Nationality', 'CA', 'PA', 'Value(GBP)', 'AskingPrice(GBP)', 'Wage(GBP)', 'Contract', 'Interest'],
    ['Jan Novák', 'DC, DR', '24', 'Sparta Praha', 'Czechia', '140', '165', '2500000', '3000000', '12000', '2028-06-30', 'High'],
    ['Petr Dvořák', 'ST', '31', 'Slavia Praha', 'Czechia', '120', '120', '800000', '900000', '8000', '2027-06-30', 'Fair'],
  ];
  const text = '\ufeff' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n') + '\r\n';
  const dec = TI.decodeBytes(new Uint8Array(Buffer.from(text, 'utf8')));
  assert.equal(dec.encoding, 'UTF-8');
  const t = TI.extractTable(dec.text);
  assert.equal(t.ok, true);
  const m = TI.guessMapping(t);
  const r = roleOf(m);
  assert.equal(r.Name, 'name');
  assert.equal(r.Position, 'positions');
  assert.equal(r.Age, 'age');
  for (const h of ['CA', 'PA']) {
    assert.equal(r[h], 'ignore');
    assert.match(m.find((c) => c.header === h).reason, /skrytý údaj hry/);
  }
  for (const h of ['Club', 'Nationality', 'Value(GBP)', 'AskingPrice(GBP)', 'Wage(GBP)', 'Contract', 'Interest']) assert.equal(r[h], 'ignore', h);
  const out = TI.rowsToPlayers(t, m, { max: 60, existingNames: [] });
  assert.deepEqual(out.players.map((p) => [p.name, p.age, p.positions]), [['Jan Novák', 24, ['DC', 'DR']], ['Petr Dvořák', 31, ['ST']]]);
  assert.ok(out.players.every((p) => Object.keys(p.attributes).length === 0));
});

test('fmsave: výstup se pozná podle sloupců, skryté atributy a schopnosti se vynechají, názvy atributů se zkrášlí', () => {
  const headers = ['uid', 'unique_id', 'name', 'age', 'natural_positions', 'attributes_finishing', 'attributes_off_the_ball', 'attributes_first_touch', 'attributes_consistency', 'attributes_important_matches', 'attributes_injury_proneness', 'ability_current', 'ability_potential', 'personality_ambition', 'positions_dc', 'contract_wage'];
  assert.equal(TI.isFmsave(headers), true);
  assert.equal(TI.isFmsave(['Name', 'Age', 'Finishing']), false);
  const t = table(headers, [['1', '11', 'Jan Novák', '24', 'ST', '15', '13', '12', '16', '14', '9', '120', '160', '14', '8', '5000']]);
  const m = TI.guessMapping(t);
  const r = roleOf(m);
  assert.deepEqual([r.name, r.age, r.natural_positions], ['name', 'age', 'positions']);
  assert.deepEqual(['attributes_finishing', 'attributes_off_the_ball', 'attributes_first_touch'].map((h) => r[h]), ['attribute', 'attribute', 'attribute']);
  for (const h of ['attributes_consistency', 'attributes_important_matches', 'attributes_injury_proneness', 'ability_current', 'ability_potential', 'personality_ambition', 'positions_dc', 'contract_wage']) assert.equal(r[h], 'ignore', h);
  assert.match(m.find((c) => c.header === 'attributes_consistency').reason, /skrytý údaj/);
  const p = TI.rowsToPlayers(t, m, {}).players[0];
  assert.deepEqual(p.attributes, { Finishing: 15, 'Off the ball': 13, 'First touch': 12 });
  assert.deepEqual(p.positions, ['ST']);
  assert.equal(TI.prettyAttrName('attributes_off_the_ball'), 'Off the ball');
  assert.equal(TI.prettyAttrName('Finishing'), 'Finishing');
  assert.equal(TI.prettyAttrName('off_the_ball'), 'Off the ball');
});

test('isHidden: skryté údaje podle názvu, i s předponou skupiny', () => {
  for (const n of ['consistency', 'attributes consistency', 'important matches', 'injury proneness', 'versatility', 'dirtiness', 'ability current', 'current ability', 'potential ability', 'personality ambition']) assert.equal(TI.isHidden(n), true, n);
  assert.equal(TI.isHidden('finishing'), false);
  assert.equal(TI.isHidden('pace'), false);
});

// ---------------------------------------------------------------- řádky → hráči
const basicMap = (headers) => TI.guessMapping(table(headers, [['A B', '20', 'ST', '10', '11', '12', '13', '14'], ['C D', '21', 'GK', '10', '11', '12', '13', '14'], ['E F', '22', 'DC', '10', '11', '12', '13', '14']]));

test('rowsToPlayers: hráči s věkem, pozicemi a atributy; neplatné hodnoty se vynechají a spočítají', () => {
  const headers = ['Name', 'Age', 'Position', 'Finishing', 'Passing', 'Pace', 'Stamina', 'Vision'];
  const t = table(headers, [
    ['Jan Novák', '24', 'ST', '15', '12', '14', '13', '11'],
    ['Petr Svoboda', '300', 'GK, DC', '25', 'x', '9', '5', ''],
    ['', '20', 'ST', '10', '10', '10', '10', '10'],
    ['X', '20', 'ST', '10', '10', '10', '10', '10'],
    ['Jan Novák', '24', 'ST', '15', '12', '14', '13', '11'],
  ]);
  const map = basicMap(headers);
  const r = TI.rowsToPlayers(t, map, {});
  assert.equal(r.players.length, 2);
  assert.deepEqual(r.players[0], { name: 'Jan Novák', positions: ['ST'], age: 24, role: '', duty: '', attributes: { Finishing: 15, Passing: 12, Pace: 14, Stamina: 13, Vision: 11 }, injured: false, notes: '' });
  const p2 = r.players[1];
  assert.equal(p2.age, null);
  assert.deepEqual(p2.positions, ['GK', 'DC']);
  assert.deepEqual(p2.attributes, { Pace: 9, Stamina: 5 });
  assert.equal(r.skipped.duplicates, 1);
  assert.equal(r.skipped.noName, 2);
  assert.ok(r.issues.some((i) => /Věk u 1 hráče není/.test(i)));
  assert.ok(r.issues.some((i) => /Atribut „Finishing“: 1 hodnota není/.test(i)));
  assert.ok(r.issues.some((i) => /Atribut „Passing“: 1 hodnota není/.test(i)));
});

test('rowsToPlayers: pozice ve tvaru „D (RLC)“ se nepřevádějí, jdou do poznámky; zraněný jen při nenulovém textu', () => {
  const headers = ['Name', 'Position', 'Inj'];
  const t = table(headers, [['A B', 'D (RLC), WB (R)', 'Healthy'], ['C D', 'ST', 'Knee injury'], ['E F', 'GK', '-']]);
  const map = [
    { index: 0, header: 'Name', role: 'name' },
    { index: 1, header: 'Position', role: 'positions' },
    { index: 2, header: 'Inj', role: 'injured' },
  ];
  const r = TI.rowsToPlayers(t, map, {});
  assert.deepEqual(r.players.map((p) => p.injured), [false, true, false]);
  assert.deepEqual(r.players[0].positions, []);
  assert.equal(r.players[0].notes, 'Pozice v exportu: D (RLC), WB (R)');
  assert.ok(r.issues.some((i) => /Pozice u 1 hráče není prostá zkratka/.test(i)));
});

test('rowsToPlayers: už existující jména, limit počtu a chybějící sloupec se jménem', () => {
  const headers = ['Name', 'Age'];
  const rows = Array.from({ length: 10 }, (_, i) => [`Hráč ${i}`, String(20 + i)]);
  const map = [{ index: 0, header: 'Name', role: 'name' }, { index: 1, header: 'Age', role: 'age' }];
  const r = TI.rowsToPlayers(table(headers, rows), map, { max: 4, existingNames: new Set(['hráč 0', 'HRÁČ 1']) });
  assert.deepEqual(r.players.map((p) => p.name), ['Hráč 2', 'Hráč 3', 'Hráč 4', 'Hráč 5']);
  assert.equal(r.skipped.duplicates, 2);
  assert.equal(r.skipped.overLimit, 4);
  const none = TI.rowsToPlayers(table(headers, rows), [{ index: 1, header: 'Age', role: 'age' }], {});
  assert.deepEqual(none.players, []);
  assert.match(none.issues[0], /Chybí sloupec se jménem/);
});

test('rowsToPlayers: text z buňky je jen text (značky a řídicí znaky pryč), jméno nad 60 znaků se vynechá, atributů nejvýš 40', () => {
  const hdr = ['Name', ...Array.from({ length: 50 }, (_, i) => 'A' + i)];
  const row = ['<b>Jan</b>\u0000 Novák', ...Array.from({ length: 50 }, () => '10')];
  const map = hdr.map((h, index) => ({ index, header: h, role: index === 0 ? 'name' : 'attribute' }));
  const r = TI.rowsToPlayers(table(hdr, [row, ['x'.repeat(61), ...Array.from({ length: 50 }, () => '10')]]), map, {});
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0].name, 'Jan Novák');
  assert.equal(Object.keys(r.players[0].attributes).length, 40);
  assert.equal(r.skipped.noName, 1);
});

test('celá cesta: UTF-16 TSV s českými jmény → mapování → hráči', () => {
  const text = '\ufeffJméno\tVěk\tPozice\tFinishing\tPassing\tPace\tStamina\tVision\nJan Novák\t24\tST\t15\t12\t14\t13\t11\nPetr Dvořák\t31\tGK\t3\t8\t9\t5\t7\nKarel Čermák\t27\tDC\t5\t11\t10\t6\t9\n';
  const d = TI.decodeBytes(bytes(text, 'utf16le'));
  const t = TI.extractTable(d.text);
  assert.equal(t.kind, 'tsv');
  const r = TI.rowsToPlayers(t, TI.guessMapping(t), {});
  assert.deepEqual(r.players.map((p) => p.name), ['Jan Novák', 'Petr Dvořák', 'Karel Čermák']);
  assert.equal(r.players[1].attributes.Finishing, 3);
});
