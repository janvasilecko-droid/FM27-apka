import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAlertPolicy, shortenForSpeech, GAP_MS } = require('../src/alerts.js');

const on = { enabled: true, quiet: false, frequency: 'normal' };

test('zkrácení: krátký text zůstane, dlouhý se řízne na větě', () => {
  assert.equal(shortenForSpeech('Pozor, soupeř tlačí po křídle.'), 'Pozor, soupeř tlačí po křídle.');
  const long = 'První věta je krátká. Druhá věta je o něco delší, ale ještě se vejde. ' + 'Třetí věta je tak dlouhá, že se už nevejde do limitu. '.repeat(5);
  const out = shortenForSpeech(long, 100);
  assert.ok(out.length <= 100, out);
  assert.match(out, /[.!?]$/);
  assert.match(out, /^První věta/);
  assert.equal(shortenForSpeech('x'.repeat(500), 50).length <= 50, true);
  assert.equal(shortenForSpeech('**tučně** a `kód`'), 'tučně a kód');
  assert.equal(shortenForSpeech(null), '');
});

test('hlas vypnutý nebo tichý režim: nikdy nemluví, ani naléhavé upozornění', () => {
  const p = createAlertPolicy();
  assert.equal(p.decide({ severity: 'alert', text: 'Pozor' }, { enabled: false }, 0).reason, 'voice_off');
  assert.equal(p.decide({ severity: 'alert', text: 'Pozor' }, { enabled: true, quiet: true }, 0).reason, 'quiet');
});

test('četnost: málo důležité se čte jen při vysoké četnosti', () => {
  const p = createAlertPolicy();
  assert.equal(p.decide({ severity: 'info', text: 'Drobnost' }, on, 0).reason, 'too_minor');
  assert.equal(p.decide({ severity: 'watch', text: 'Sleduj' }, { ...on, frequency: 'low' }, 0).reason, 'too_minor');
  assert.equal(p.decide({ severity: 'watch', text: 'Sleduj' }, on, 0).speak, true);
  assert.equal(p.decide({ severity: 'info', text: 'Drobnost' }, { ...on, frequency: 'high' }, 0).speak, true);
});

test('odstup mezi upozorněními a naléhavé upozornění', () => {
  const p = createAlertPolicy();
  const a = { id: 'a', severity: 'watch', text: 'První' };
  assert.equal(p.decide(a, on, 1000).speak, true);
  p.record(a, 1000);
  assert.equal(p.decide({ id: 'b', severity: 'watch', text: 'Druhé' }, on, 1000 + GAP_MS.normal - 1).reason, 'gap');
  assert.equal(p.decide({ id: 'b', severity: 'watch', text: 'Druhé' }, on, 1000 + GAP_MS.normal).speak, true);
  // naléhavé projde dřív, ale ne okamžitě za sebou
  assert.equal(p.decide({ id: 'c', severity: 'alert', text: 'Pozor' }, on, 1000 + 5000).reason, 'gap');
  assert.equal(p.decide({ id: 'c', severity: 'alert', text: 'Pozor' }, on, 1000 + 15000).speak, true);
});

test('stejné upozornění se neopakuje do pěti minut', () => {
  const p = createAlertPolicy();
  const a = { id: 'dup', severity: 'alert', text: 'Pozor' };
  p.record(a, 0);
  assert.equal(p.decide(a, on, 20000).reason, 'duplicate');
  assert.equal(p.decide(a, on, 300000).speak, true);
});

test('strop za deset minut platí pro běžná upozornění, ne pro naléhavá', () => {
  const p = createAlertPolicy();
  let t = 0;
  for (let i = 0; i < 4; i++) {
    p.record({ id: 'x' + i, severity: 'watch' }, t);
    t += GAP_MS.normal;
  }
  assert.equal(p.decide({ id: 'y', severity: 'watch', text: 'Další' }, on, t).reason, 'rate');
  assert.equal(p.decide({ id: 'z', severity: 'alert', text: 'Pozor' }, on, t).speak, true);
});

test('prázdný text se nečte a neznámá četnost se bere jako běžná', () => {
  const p = createAlertPolicy();
  assert.equal(p.decide({ severity: 'alert', text: '   ' }, on, 0).reason, 'empty');
  assert.equal(p.decide({ severity: 'watch', text: 'Ahoj' }, { enabled: true, frequency: 'nesmysl' }, 0).speak, true);
});

test('reset smaže historii', () => {
  const p = createAlertPolicy();
  p.record({ id: 'a' }, 0);
  p.reset();
  assert.equal(p.history().length, 0);
});
