import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../src/fmfglue.js');
const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
// Rámce vyrobené Pythonem (zstandard): F1 a F2 mají uvedenou velikost obsahu, F3 je proudový bez ní.
const F1 = hex('28b52ffd2036c500009003616263042e7461630378797a042e696d6701001639c3'); // obsah 54 bajtů
const F2 = hex('28b52ffd20789d00006064727568792072616d6563200100e9694902'); // obsah 120 bajtů
const F3 = hex('28b52ffd0058dd0000a070726f75642062657a2076656c696b6f73746920010072d26402');
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

test('velikost obsahu z hlavičky rámce', () => {
  assert.equal(G.firstFrameContentSize(F1), 54);
  assert.equal(G.firstFrameContentSize(F2), 120);
  assert.equal(G.firstFrameContentSize(F3), null, 'proudový rámec velikost neuvádí');
  assert.equal(G.firstFrameContentSize(new Uint8Array([1, 2, 3, 4, 5, 6])), null);
  assert.equal(G.firstFrameContentSize(new Uint8Array(3)), null);
  assert.equal(G.firstFrameContentSize(null), null);
});

// Skutečná knihovna fzstd se použije jen když je k dispozici (instaluje se mimo repozitář).
let fzstd = null;
for (const where of ['fzstd', process.env.FZSTD_DIR && process.env.FZSTD_DIR + '/fzstd']) {
  if (!where) continue;
  try {
    fzstd = require(where);
    break;
  } catch (e) {
    /* zkusí se další */
  }
}

test('první rámec se ořízne na deklarovanou velikost, i když za ním jsou další rámce a smetí', { skip: !fzstd && 'fzstd není nainstalované (FZSTD_DIR)' }, () => {
  const d = G.makeFirstFrameDecompressor(fzstd);
  const data = cat(F1, F2, new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]));
  const out = d(data, 1 << 20);
  assert.equal(out.length, 54);
  assert.deepEqual([...out.subarray(0, 4)], [3, 0x61, 0x62, 0x63]);
  assert.equal(d(data, 10).length, 10, 'limit velikosti platí');
});

test('proudový rámec bez velikosti vrátí vše, co se rozbalilo; nesmysl vrátí null', { skip: !fzstd && 'fzstd není nainstalované (FZSTD_DIR)' }, () => {
  const d = G.makeFirstFrameDecompressor(fzstd);
  const out = d(F3, 1 << 20);
  assert.equal(Buffer.from(out).toString(), 'proud bez velikosti '.repeat(4));
  assert.equal(d(new Uint8Array([9, 9, 9, 9, 9, 9]), 100), null);
  assert.equal(d(F1.subarray(0, 20), 100), null, 'useknutý rámec');
});

test('bez knihovny vrátí null', () => {
  assert.equal(G.makeFirstFrameDecompressor(null)(F1, 100), null);
  assert.equal(G.makeFirstFrameDecompressor({})(F1, 100), null);
});
