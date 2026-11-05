import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../src/fmfglue.js');
const Z = require('../src/zstd.js');
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
// Rámce vyrobené Pythonem (zstandard), tedy jiným zapisovačem než libzstd v Node: F1 a F2 mají uvedenou velikost obsahu, F3 je proudový bez ní.
const F1 = hex('28b52ffd2036c500009003616263042e7461630378797a042e696d6701001639c3'); // obsah 54 bajtů
const F2 = hex('28b52ffd20789d00006064727568792072616d6563200100e9694902'); // obsah 120 bajtů
const F3 = hex('28b52ffd0058dd0000a070726f75642062657a2076656c696b6f73746920010072d26402');
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

test('první rámec: rozbalí se jen ten první, i když za ním jsou další rámce a smetí; strop výstupu platí', () => {
  const d = G.makeFirstFrameDecompressor(Z);
  const data = cat(F1, F2, new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]));
  const out = d(data, 1 << 20);
  assert.equal(out.length, 54);
  assert.deepEqual([...out.subarray(0, 4)], [3, 0x61, 0x62, 0x63]);
  assert.equal(d(F2, 1 << 20).length, 120);
  // strop menší než obsah: chyba s kódem limit (ne oříznutí), aby volající poznal „příliš velký“
  assert.throws(() => d(data, 10), (e) => e.code === 'limit');
  assert.equal(d(data, 54).length, 54, 'strop přesně na velikosti obsahu projde');
});

test('proudový rámec bez velikosti obsahu se rozbalí celý; nesmysl, useknutí a jiný druh dat dá null', () => {
  const d = G.makeFirstFrameDecompressor(Z);
  const out = d(F3, 1 << 20);
  assert.equal(Buffer.from(out).toString(), 'proud bez velikosti '.repeat(4));
  assert.equal(d(new Uint8Array([9, 9, 9, 9, 9, 9]), 100), null);
  assert.equal(d(F1.subarray(0, 20), 100), null, 'useknutý rámec');
  assert.equal(d(new Uint8Array(0), 100), null);
  assert.equal(d(null, 100), null);
});

test('přesně jeden rámec pro kontejner: bajty navíc a useknutí jsou chyba', () => {
  const z = G.makeFrameDecompressor(Z);
  assert.equal(z(F1, 1 << 20).length, 54);
  assert.throws(() => z(cat(F1, F2), 1 << 20), /bajty navíc/);
  assert.throws(() => z(F1.subarray(0, 20), 1 << 20), /useknutý/);
  assert.throws(() => z(F1, 10), (e) => e.code === 'limit');
});

test('bez dekodéru: první rámec vrátí null, přesně jeden rámec vyhodí chybu', () => {
  assert.equal(G.makeFirstFrameDecompressor(null)(F1, 100), null);
  assert.equal(G.makeFirstFrameDecompressor({})(F1, 100), null);
  assert.throws(() => G.makeFrameDecompressor(null)(F1, 100), /není k dispozici/);
});
