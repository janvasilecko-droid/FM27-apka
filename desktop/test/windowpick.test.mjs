import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../src/windowpick.js');

const win = (id, name) => ({ id: `window:${id}:0`, name });
const scr = (id, name) => ({ id: `screen:${id}:0`, name });

test('najde jediné okno Football Manageru a nehádá, když není jisté', () => {
  const sources = [win(1, 'Poznámkový blok'), win(2, 'Football Manager 2027'), win(3, 'Prohlížeč'), scr(1, 'Celá obrazovka')];
  const r = W.pickGameWindow(sources);
  assert.equal(r.source.id, 'window:2:0');
  assert.deepEqual(r.matches.map((m) => m.name), ['Football Manager 2027']);
  assert.deepEqual(r.others.map((m) => m.name), ['Poznámkový blok', 'Prohlížeč'], 'ostatní okna podle názvu, obrazovky mezi okna nepatří');
  // žádné okno hry: nic se nevybere
  assert.equal(W.pickGameWindow([win(1, 'Poznámkový blok')]).source, null);
  // dvě podobná okna: bez přesného názvu se nevybere žádné
  const two = W.pickGameWindow([win(1, 'Football Manager 2027 - Launcher'), win(2, 'Football Manager 2027 - Steam')]);
  assert.equal(two.source, null);
  assert.equal(two.matches.length, 2);
});

test('přesný název hry má přednost před oknem, které ho jen obsahuje', () => {
  const r = W.pickGameWindow([win(1, 'Football Manager 2027 - Launcher'), win(2, 'Football Manager 2027')]);
  assert.equal(r.source.id, 'window:2:0');
  assert.equal(W.pickGameWindow([win(1, 'Football Manager 27')]).source.id, 'window:1:0');
  // dvě okna s přesným názvem jsou nejednoznačná
  assert.equal(W.pickGameWindow([win(1, 'Football Manager 2027'), win(2, 'Football Manager 2027')]).source, null);
});

test('vlastní okno aplikace se nikdy nevybere (podle id ani podle názvu)', () => {
  const sources = [win(1, 'FM27 Trenér'), win(2, 'Football Manager 2027 – FM27 Trenér')];
  assert.equal(W.pickGameWindow(sources, { excludeIds: ['window:2:0'] }).matches.length, 1, 'bez názvu vlastního okna by se „FM27 Trenér“ chytil na zkrácený vzor FM27');
  assert.equal(W.pickGameWindow(sources, { excludeIds: ['window:2:0'], ownTitles: ['FM27 Trenér'] }).matches.length, 0);
  assert.equal(W.pickGameWindow([win(5, 'FM27 Trenér')], { ownTitles: ['FM27 Trenér'], patterns: ['FM27'] }).source, null, 'vlastní okno obsahuje „FM27“, ale podle názvu je vyloučené');
  assert.equal(W.pickGameWindow([win(5, 'FM27 Trenér'), win(6, 'FM27')], { ownTitles: ['fm27 trenér'], patterns: ['FM27'] }).source.id, 'window:6:0');
});

test('vzor z nastavení přepíše výchozí; neplatný nebo příliš dlouhý vzor se přeskočí a platí výchozí', () => {
  const sources = [win(1, 'Fotbalový manažer 2027'), win(2, 'Football Manager 2027')];
  assert.equal(W.pickGameWindow(sources, { patterns: ['fotbalový manažer'] }).source.id, 'window:1:0');
  assert.equal(W.pickGameWindow(sources, { patterns: ['('] }).source.id, 'window:2:0', 'neplatný regulární výraz se přeskočí');
  assert.equal(W.pickGameWindow(sources, { patterns: ['a'.repeat(300)] }).source.id, 'window:2:0');
  assert.equal(W.pickGameWindow(sources, { patterns: 'fotbalový' }).source.id, 'window:1:0', 'jediný řetězec stačí');
  assert.equal(W.compilePatterns(null).length, 0);
  assert.equal(W.compilePatterns([/x/i, 5, '', '  ']).length, 1);
});

test('odolnost: nesmyslný vstup nikdy nehodí výjimku; neviditelné znaky v názvu nevadí', () => {
  for (const bad of [null, undefined, 5, 'x', {}, [null, 3, {}, { id: 5 }, { id: 'window:1:0' }, { id: 'window:2:0', name: '   ' }]]) {
    const r = W.pickGameWindow(bad);
    assert.equal(r.source, null);
    assert.ok(Array.isArray(r.matches) && Array.isArray(r.others));
  }
  assert.equal(W.pickGameWindow([win(1, 'Football​ Manager 2027')]).source.id, 'window:1:0');
  assert.equal(W.pickGameWindow(null, null).source, null);
});

test('popisek okna je zkrácený a nic nehází', () => {
  assert.equal(W.labelOf({ name: 'Krátký název' }), 'Krátký název');
  const long = W.labelOf({ name: 'x'.repeat(200) });
  assert.equal(long.length, 70);
  assert.ok(long.endsWith('…'));
  assert.equal(W.labelOf({ name: 'x'.repeat(30) }, 20).length, 20);
});
