// Mutační zkouška: každá mutace se zapíše do KOPIE zdroje (repozitář se nemění), pustí se zadané zkoušky a aspoň jedna musí selhat; přeživší mutace je díra ve zkouškách.
// Použití (z kořene repozitáře):
//   node trener/test/mutation/mutate.mjs <zdroj, např. trener/src/fmfglue.js> <seznam mutací .json> <zkouška1.mjs[,zkouška2.mjs]> [--only <regulární výraz názvu>] [--shard i/n] [--oracle]
// Hodnoty přepínačů se píšou za mezeru (ne --only=výraz); zkoušky se oddělují čárkou, ne mezerou; cokoli jiného, než nástroj zná, skončí kódem 64.
// --shard i/n zpracuje jen každou n-tou mutaci počínaje i-tou (i od 0): n souběžných běhů s různým i rozdělí práci na n jader (každý si vytvoří vlastní pracovní složku).
// Seznam mutací je pole trojic [název, původní text, nový text]; původní text se musí v souboru vyskytovat PRÁVĚ JEDNOU, jinak se mutace počítá jako nepoužitelná (a jako přeživší).
// Zdroj musí ležet ve složce, která se kopíruje (trener/src, trener/test, reference, ai_gateway).
// Bez --oracle se věštírna libzstd vypne (ZSTD_ORACLE_PYTHON míří na neexistující program), takže přímé zkoušky musí mutace chytit samy.
// S --oracle se použije ZSTD_ORACLE_PYTHON (nebo python3), nástroj před během ověří, že v něm jde `import zstandard`, a zkouškám nastaví ZSTD_ORACLE_REQUIRED=1 (věštírna je povinná, nevynechá se tiše).
// Pracovní kopie (trener/src, trener/test, reference, ai_gateway ve stejném rozložení jako v repozitáři, aby zkoušky našly své soubory) je v dočasné složce; její název je podle zdroje a čísla procesu, takže
// souběžné běhy se nepřepisují, a na konci se smaže (i po pádu nástroje, jen ne po SIGKILL). Proměnná WORK ji změní: složka se na začátku SMAŽE a vytvoří znovu a na konci zůstane k prohlédnutí; nástroj ji
// proto přijme jen nepřítomnou, prázdnou nebo takovou, kterou sám dřív vytvořil (značkový soubor .mutate-work), a nikdy ne uvnitř repozitáře ani nad ním (podle skutečné cesty, symbolické odkazy se rozloží);
// soubor nebo odkaz místo složky se odmítne. U souběžných běhů musí být WORK pro každý jiná.
// Návratový kód: 0 = všechny mutace zachyceny, 1 = nějaká přežila nebo je nepoužitelná (vždy po řádku „Přeživších mutací“; neočekávaná chyba prostředí, například plný disk, skončí také kódem 1, ale se zásobníkem
// výjimky a bez toho řádku), 2 = zkoušky neprojdou ani bez mutace, 3 = výběr nezahrnuje žádnou mutaci (překlep v --only, prázdná dávka), 64 = chybné použití (argumenty, neplatný výraz, zdroj mimo kopírované složky,
// nepřípustná složka WORK, věštírna není k dispozici).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync, lstatSync, statSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MARKER = '.mutate-work';
const COPIED = ['trener/src', 'trener/test', 'reference', 'ai_gateway'];
const usage = (message) => {
  console.error(message);
  process.exit(64);
};

// ---------------------------------------------------------------- argumenty (cokoli neznámého je chyba, nic se mlčky neignoruje)
const args = process.argv.slice(2);
const KNOWN = new Set(['--only', '--shard', '--oracle']);
const VALUED = new Set(['--only', '--shard']);
const positional = [];
const seen = new Set();
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) {
    positional.push(a);
    continue;
  }
  if (!KNOWN.has(a)) usage(`Neznámý přepínač ${a} (platné: --only <výraz>, --shard i/n, --oracle; hodnota se píše za mezeru, ne za =).`);
  if (seen.has(a)) usage(`Přepínač ${a} je zadán dvakrát.`);
  seen.add(a);
  if (VALUED.has(a)) {
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) usage(`Přepínač ${a} vyžaduje hodnotu.`);
    i++;
  }
}
if (positional.length > 3) usage(`Víc než tři poziční argumenty (zkoušky se oddělují čárkou, ne mezerou): ${positional.slice(3).join(' ')}`);
const [srcRel, mutFile, testsArg] = positional;
if (!srcRel || !mutFile || !testsArg) usage('Použití: node trener/test/mutation/mutate.mjs <zdroj> <mutace.json> <zkouška1.mjs[,zkouška2.mjs]> [--only <regex>] [--shard i/n] [--oracle]');
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
let only = null;
if (option('--only') !== null) {
  try {
    only = new RegExp(option('--only'));
  } catch (e) {
    usage('--only: neplatný regulární výraz: ' + e.message);
  }
}
let shard = null;
if (option('--shard') !== null) {
  const m = /^(\d+)\/(\d+)$/.exec(option('--shard'));
  if (!m || Number(m[2]) < 1 || Number(m[1]) >= Number(m[2])) usage('--shard má tvar i/n, kde 0 <= i < n (například 0/4)');
  shard = [Number(m[1]), Number(m[2])];
}
const testNames = testsArg.split(',');
if (!testNames.every((t) => /^[\w.-]+\.(mjs|cjs|js)$/.test(t))) usage(`Zkoušky se zadávají jako názvy souborů ze složky trener/test oddělené čárkou (například core.test.mjs,sanitize.test.mjs): ${testsArg}`);

// ---------------------------------------------------------------- prostředí pro zkoušky, zdroj a seznam mutací
const env = Object.assign({}, process.env);
if (seen.has('--oracle')) {
  const py = env.ZSTD_ORACLE_PYTHON || 'python3';
  const probe = spawnSync(py, ['-c', 'import zstandard'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) usage(`--oracle: věštírna není k dispozici (${py} neumí import zstandard): pip install zstandard==0.25.0 a případně ZSTD_ORACLE_PYTHON.`);
  env.ZSTD_ORACLE_REQUIRED = '1';
} else {
  env.ZSTD_ORACLE_PYTHON = '/nonexistent/python';
  delete env.ZSTD_ORACLE_REQUIRED;
}
// zdroj se normalizuje (trener/src/../../README.md je README.md, ../x je mimo repozitář) a musí ležet v kopírované složce a být soubor
const source = path.relative(repo, path.resolve(repo, srcRel)).split(path.sep).join('/');
if (!COPIED.some((d) => source.startsWith(d + '/'))) usage(`Zdroj musí ležet v ${COPIED.join(', ')} (cesta od kořene repozitáře, například trener/src/fmfglue.js): ${srcRel}`);
let sourceStat = null;
try {
  sourceStat = statSync(path.join(repo, source));
} catch (e) {
  sourceStat = null;
}
if (!sourceStat || !sourceStat.isFile()) usage(`Zdroj ${srcRel} v repozitáři není soubor.`);
let mutations;
try {
  mutations = JSON.parse(readFileSync(path.resolve(repo, mutFile), 'utf8'));
} catch (e) {
  usage(`Seznam mutací ${mutFile} se nepodařilo přečíst: ${e.message}`);
}
if (!Array.isArray(mutations) || !mutations.every((m) => Array.isArray(m) && m.length === 3 && m.every((x) => typeof x === 'string'))) usage(`Seznam mutací ${mutFile} má být pole trojic [název, původní text, nový text].`);

// ---------------------------------------------------------------- pracovní složka: výchozí je nová, s číslem procesu; zadaná se smaže jen když je prázdná nebo naše, a nikdy nesmí být uvnitř repozitáře ani nad ním
const work = path.resolve(process.env.WORK || path.join(tmpdir(), `fm27-mutace-${path.basename(source).replace(/\W+/g, '_')}-${process.pid}`));
// skutečné cesty: symbolický odkaz na složku v repozitáři (nebo nad ním) by jinak prošel kontrolou podle textu cesty
const realOf = (p) => {
  const tail = [];
  let cur = p;
  while (!existsSync(cur) && path.dirname(cur) !== cur) {
    tail.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  return path.join(realpathSync(cur), ...tail);
};
const realRepo = realpathSync(repo);
const realWork = realOf(work);
const shown = realWork === work ? work : `${work} → ${realWork}`;
const rel = path.relative(realRepo, realWork);
if (rel === '' || !(rel.split(path.sep)[0] === '..' || path.isAbsolute(rel))) usage(`WORK (${shown}) leží v repozitáři nebo je to on sám: složka se na začátku maže, a tak se sem nezapisuje.`);
if (path.relative(realWork, realRepo).split(path.sep)[0] !== '..') usage(`WORK (${shown}) je nad repozitářem: složka se na začátku maže.`);
let present = null;
try {
  present = lstatSync(work);
} catch (e) {
  if (e.code !== 'ENOENT') usage(`WORK (${shown}) nelze zkontrolovat: ${e.message}`);
}
if (present) {
  if (!present.isDirectory()) usage(`WORK (${shown}) existuje a není složka (soubor nebo odkaz): použij novou cestu.`);
  if (readdirSync(work).length > 0 && !existsSync(path.join(work, MARKER))) usage(`WORK (${shown}) existuje, není prázdná a nevytvořil ji tento nástroj (chybí ${MARKER}); složka se na začátku maže, použij novou cestu.`);
  rmSync(work, { recursive: true, force: true });
}
mkdirSync(work, { recursive: true });
// složku, kterou si nástroj pojmenoval sám (bez WORK), smaže na konci i po neočekávané výjimce; složka ze zadané WORK zůstane k prohlédnutí
process.on('exit', () => {
  if (!process.env.WORK) rmSync(work, { recursive: true, force: true });
});
writeFileSync(path.join(work, MARKER), 'pracovní kopie mutační zkoušky; složka se při příštím běhu s touto WORK smaže\n');
for (const dir of COPIED) if (existsSync(path.join(repo, dir))) cpSync(path.join(repo, dir), path.join(work, dir), { recursive: true });
const file = path.join(work, source);
const original = readFileSync(file, 'utf8');
const tests = testNames.map((t) => path.join(work, 'trener/test', t));
const run = () => spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', env, timeout: 300000 });
const failingNames = (r) => (r.stdout || '').split('\n').filter((l) => /^not ok/.test(l)).map((l) => l.replace(/^not ok \d+ - /, '').slice(0, 60));

const selected = mutations.map((m, index) => ({ m, index })).filter(({ m, index }) => (!only || only.test(m[0])) && (!shard || index % shard[1] === shard[0]));
if (!selected.length) {
  console.log(`Výběr neobsahuje žádnou mutaci (seznam má ${mutations.length}${only ? ', --only ' + only : ''}${shard ? ', --shard ' + shard.join('/') : ''}): nic se nezkoušelo.`);
  process.exit(3);
}
writeFileSync(file, original);
const base = run();
if (base.status !== 0) {
  console.log('ZÁKLAD SELHAL: zkoušky neprojdou ani bez mutace\n' + failingNames(base).slice(0, 5).join('\n') + (failingNames(base).length ? '' : '\n' + String(base.stderr || base.stdout || '').slice(0, 600)));
  process.exit(2);
}
console.log('základ v pořádku');

let survived = 0;
try {
  for (const { m: [name, from, to] } of selected) {
    const count = original.split(from).length - 1;
    if (count !== 1) {
      console.log(`VZOR ${count === 0 ? 'NENALEZEN' : 'NEJEDNOZNAČNÝ (' + count + 'x)'}: ${name}`);
      survived++;
      continue;
    }
    writeFileSync(file, original.replace(from, () => to));
    const t0 = Date.now();
    const r = run();
    const killed = r.status !== 0;
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    if (!killed) survived++;
    console.log(`${killed ? 'zabito  ' : 'PŘEŽILO '} ${name}${timedOut ? ' (časový limit)' : ''}${killed ? '  ← ' + failingNames(r).slice(0, 2).join(' | ') : ''}  [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
  }
} finally {
  writeFileSync(file, original);
}
console.log(`\nPřeživších mutací: ${survived} z ${selected.length}`);
process.exit(survived ? 1 : 0);
