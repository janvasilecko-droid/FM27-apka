#!/usr/bin/env node
/* Sestaví aplikaci do jednoho souboru ve dvou podobách. Bez závislostí: stačí Node 18+ (platí jen pro sestavení; zkoušky v trener/test potřebují Node 22.15+ kvůli zlib.zstd).

   Použití:  node trener/build.mjs            (STRICT=1 vyžaduje všechny moduly)
   Výstup:   trener/dist/trener.fragment.html   stránka v Claude (artefakt); obálku <html> doplní publikace
             trener/dist/trener.test.html       stejný obsah v obálce pro zkoušky v prohlížeči
             trener/dist/standalone/            samostatná verze (PWA): index.html, manifest, service worker, ikony

   Do aplikace se vkládá jen kód a registr oficiálních zdrojů FM27. Texty knih tu nejsou
   a nikdy nesmí být (repozitář je veřejný). */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');
const fail = (message) => {
  console.error('CHYBA: ' + message);
  process.exit(1);
};

const template = read('src/index.template.html');
const css = read('src/styles.css');
const knowledge = JSON.parse(readFileSync(join(here, '..', 'reference', 'codex-2026-11-01', 'knowledge.json'), 'utf8'));
// JSON pro <script type="application/json">: znak "<" jako <, aby uvnitř nešlo nic uzavřít.
const knowledgeJson = JSON.stringify(knowledge).replace(/</g, '\\u003c');
if (/<\/style/i.test(css)) fail('styles.css obsahuje "</style".');

// Pořadí je důležité: čisté moduly, pak rozhraní, pak obrazovky, nakonec spuštění.
// Moduly z OPTIONAL se při chybějícím souboru přeskočí (vývoj); `STRICT=1` chybu vyžaduje.
const PURE = ['core.js', 'fm27cs.js', 'websources.js', 'tableimport.js', 'squadread.js', 'oppread.js', 'matchlens.js', 'careerread.js', 'rolefit.js', 'dwrs.js', 'squadopt.js', 'recruit.js', 'providers.js', 'tactics.js', 'fm27know.js', 'tacticanalysis.js', 'posattrs.js', 'squadcheck.js', 'oppanalysis.js', 'analysis.js', 'school.js', 'alerts.js', 'opponent.js', 'report.js', 'labexplain.js', 'zstd.js', 'fmfglue.js', 'fmfcontainer.js', 'fmftac.js'];
const UI = ['ui.js', 'store.js', 'library.js', 'ai.js', 'web.js', 'context.js', 'voice.js', 'widgets.js', 'advice.js', 'live.js', 'feed.js', 'clubread.js', 'app.js'];
const OPTIONAL = new Set(['providers.js', 'tactics.js', 'analysis.js', 'school.js']);
const screensDir = join(here, 'src', 'screens');
const screenFiles = existsSync(screensDir) ? readdirSync(screensDir).filter((f) => f.endsWith('.js')).sort().map((f) => 'screens/' + f) : [];
const strict = process.env.STRICT === '1';

function loadScripts(order) {
  const scripts = [];
  for (const rel of order) {
    const full = join(here, 'src', rel);
    if (!existsSync(full)) {
      if (OPTIONAL.has(rel) && !strict) {
        console.warn(`POZOR: chybí ${rel}, přeskakuji (STRICT=1 to zakáže).`);
        continue;
      }
      fail(`chybí src/${rel}`);
    }
    const code = readFileSync(full, 'utf8');
    // Skript v HTML nesmí obsahovat "</script" ani "<!--": prohlížeč by blok předčasně ukončil.
    if (/<\/script/i.test(code)) fail(`${rel} obsahuje "</script"; zapiš to jako "<\\/script".`);
    if (code.includes('<!--')) fail(`${rel} obsahuje "<!--"; zapiš to jinak.`);
    scripts.push({ rel, code });
  }
  return scripts;
}

function assemble(scripts) {
  const hash = createHash('sha1').update(css).update(template).update(knowledgeJson);
  for (const { code } of scripts) hash.update(code);
  const stamp = `${new Date().toISOString().slice(0, 10)}-${hash.digest('hex').slice(0, 8)}`;
  const scriptTags = scripts.map(({ rel, code }) => `<script>/* ---- ${rel} ---- */\n${code}\n</script>`).join('\n');
  // Jeden průchod šablonou: vložený kód se znovu neprochází a "$&" ani "$1" v něm se nevykládá jako vzor.
  const slots = { CSS: css, KNOWLEDGE: knowledgeJson, SCRIPTS: scriptTags, BUILD: stamp };
  for (const key of Object.keys(slots)) {
    const count = template.split(`/*${key}*/`).length - 1;
    if (count !== 1) fail(`v šabloně má být místo /*${key}*/ právě jednou, je ${count}x.`);
  }
  return { fragment: template.replace(/\/\*(CSS|KNOWLEDGE|SCRIPTS|BUILD)\*\//g, (_, key) => slots[key]), stamp };
}

// Základ, který přidá publikace artefaktu (kódování, viewport, malý základ). Stejný je i v obálkách níže.
const BASE_STYLE = ':root{color-scheme:light;padding-block:env(safe-area-inset-top,0px) env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.4 system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}';
const testDoc = (body) =>
  `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${BASE_STYLE}</style></head><body>${body}</body></html>`;
const standaloneDoc = (body) =>
  '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name="theme-color" content="#0b1118"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon-192.png">' +
  `<style>${BASE_STYLE}</style></head><body>${body}</body></html>`;

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' kB';
const dist = join(here, 'dist');
mkdirSync(join(dist, 'standalone'), { recursive: true });

// ---- A) stránka v Claude
const artifact = assemble(loadScripts([...PURE, ...UI, ...screenFiles, 'boot.js']));
writeFileSync(join(dist, 'trener.fragment.html'), artifact.fragment);
writeFileSync(join(dist, 'trener.test.html'), testDoc(artifact.fragment));

// ---- B) samostatná verze (PWA): stejný kód + standalone.js před spuštěním
const standalone = assemble(loadScripts([...PURE, ...UI, ...screenFiles, 'standalone.js', 'boot.js']));
const sdir = join(dist, 'standalone');
writeFileSync(join(sdir, 'index.html'), standaloneDoc(standalone.fragment));
writeFileSync(join(sdir, 'sw.js'), readFileSync(join(here, 'standalone', 'sw.js'), 'utf8').replace('__BUILD__', standalone.stamp));
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']) copyFileSync(join(here, 'standalone', f), join(sdir, f));

console.log(`Hotovo: stránka v Claude ${artifact.stamp}, samostatná verze ${standalone.stamp}`);
console.log(`  trener/dist/trener.fragment.html   ${kb(artifact.fragment)}`);
console.log(`  trener/dist/trener.test.html       ${kb(testDoc(artifact.fragment))}`);
console.log(`  trener/dist/standalone/index.html  ${kb(standaloneDoc(standalone.fragment))}`);
