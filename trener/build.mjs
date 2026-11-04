#!/usr/bin/env node
/* Sestaví stránku trenéra do jednoho souboru. Bez závislostí: stačí Node 18+.

   Použití:  node trener/build.mjs
   Výstup:   trener/dist/trener.fragment.html   (to se publikuje jako artefakt; obálku <html> doplní publikace)
             trener/dist/trener.test.html       (stejný obsah v obálce, jde otevřít v prohlížeči a testovat)

   Do stránky se vkládá jen kód a registr oficiálních zdrojů FM27. Texty knih tu nejsou
   a nikdy nesmí být (repozitář je veřejný). */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

const template = read('src/index.template.html');
const css = read('src/styles.css');
const core = read('src/core.js');
const app = read('src/app.js');
const knowledge = JSON.parse(readFileSync(join(here, '..', 'reference', 'codex-2026-11-01', 'knowledge.json'), 'utf8'));

function fail(message) {
  console.error('CHYBA: ' + message);
  process.exit(1);
}

// Skript v HTML nesmí obsahovat "</script" ani "<!--": prohlížeč by blok předčasně ukončil.
for (const [name, src] of [['core.js', core], ['app.js', app]]) {
  if (/<\/script/i.test(src)) fail(`${name} obsahuje "</script"; zapiš to jako "<\\/script".`);
  if (src.includes('<!--')) fail(`${name} obsahuje "<!--"; zapiš to jinak.`);
}
if (/<\/style/i.test(css)) fail('styles.css obsahuje "</style".');

// JSON pro <script type="application/json">: znak "<" jako <, aby uvnitř nešlo nic uzavřít.
const knowledgeJson = JSON.stringify(knowledge).replace(/</g, '\\u003c');

const build = createHash('sha1').update(css).update(core).update(app).update(template).update(knowledgeJson).digest('hex').slice(0, 8);
const stamp = `${new Date().toISOString().slice(0, 10)}-${build}`;

// Jeden průchod šablonou: vložený kód se znovu neprochází a "$&" ani "$1" v něm se nevykládá jako vzor.
const slots = { CSS: css, KNOWLEDGE: knowledgeJson, CORE: core, APP: app, BUILD: stamp };
for (const key of Object.keys(slots)) {
  const count = template.split(`/*${key}*/`).length - 1;
  if (count !== 1) fail(`v šabloně má být místo /*${key}*/ právě jednou, je ${count}x.`);
}
const fragment = template.replace(/\/\*(CSS|KNOWLEDGE|CORE|APP|BUILD)\*\//g, (_, key) => slots[key]);

// Obálka pro místní zkoušky. Odpovídá tomu, co přidá publikace: kódování, viewport a malý základ.
const wrapper = (body) =>
  '<!doctype html><html lang="cs"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-block:env(safe-area-inset-top,0px) env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px/1.4 system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>' +
  '</head><body>' + body + '</body></html>';

const dist = join(here, 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'trener.fragment.html'), fragment);
writeFileSync(join(dist, 'trener.test.html'), wrapper(fragment));

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' kB';
console.log(`Hotovo: verze ${stamp}`);
console.log(`  trener/dist/trener.fragment.html  ${kb(fragment)}`);
console.log(`  trener/dist/trener.test.html      ${kb(wrapper(fragment))}`);
