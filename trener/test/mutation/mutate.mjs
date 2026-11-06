// Mutační zkouška: každá mutace se zapíše do KOPIE zdroje (repozitář se nemění), pustí se zadané zkoušky a aspoň jedna musí selhat; přeživší mutace je díra ve zkouškách.
// Použití (z kořene repozitáře):
//   node trener/test/mutation/mutate.mjs <zdroj, např. trener/src/fmfglue.js> <seznam mutací .json> <zkouška1.mjs[,zkouška2.mjs]> [--only <regulární výraz názvu>] [--shard i/n] [--oracle]
// --shard i/n zpracuje jen každou n-tou mutaci počínaje i-tou (i od 0): n souběžných běhů s různým i (a s různou proměnnou WORK) rozdělí práci na n jader.
// Seznam mutací je pole trojic [název, původní text, nový text]; původní text se musí v souboru vyskytovat PRÁVĚ JEDNOU, jinak se mutace počítá jako nepoužitelná (a jako přeživší).
// Bez --oracle se věštírna libzstd vypne (ZSTD_ORACLE_PYTHON míří na neexistující program), takže přímé zkoušky musí mutace chytit samy; s --oracle se použije ZSTD_ORACLE_PYTHON (nebo python3).
// Pracovní kopie je v dočasné složce (proměnná WORK ji změní). Návratový kód: 0 = všechny mutace zachyceny, 1 = nějaká přežila nebo je nepoužitelná, 2 = zkoušky neprojdou ani bez mutace.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only' && args[i - 1] !== '--shard');
const [srcRel, mutFile, testsArg] = positional;
if (!srcRel || !mutFile || !testsArg) {
  console.error('Použití: node trener/test/mutation/mutate.mjs <zdroj> <mutace.json> <zkouška1.mjs[,zkouška2.mjs]> [--only <regex>] [--oracle]');
  process.exit(64);
}
const only = option('--only') ? new RegExp(option('--only')) : null;
const shard = option('--shard') ? option('--shard').split('/').map(Number) : null;
if (shard && !(Number.isInteger(shard[0]) && Number.isInteger(shard[1]) && shard[1] > 0 && shard[0] >= 0 && shard[0] < shard[1])) {
  console.error('--shard má tvar i/n, kde 0 <= i < n');
  process.exit(64);
}
const work = process.env.WORK || path.join(tmpdir(), 'fm27-mutace-' + path.basename(srcRel).replace(/\W+/g, '_'));
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
cpSync(path.join(repo, 'trener/src'), path.join(work, 'src'), { recursive: true });
cpSync(path.join(repo, 'trener/test'), path.join(work, 'test'), { recursive: true });
const file = path.join(work, srcRel.replace(/^trener\//, ''));
const original = readFileSync(file, 'utf8');
const tests = testsArg.split(',').map((t) => path.join(work, 'test', t));
const env = Object.assign({}, process.env);
if (!flag('--oracle')) env.ZSTD_ORACLE_PYTHON = '/nonexistent/python';
delete env.ZSTD_ORACLE_REQUIRED;
const run = () => spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', env, timeout: 300000 });
const failingNames = (r) => (r.stdout || '').split('\n').filter((l) => /^not ok/.test(l)).map((l) => l.replace(/^not ok \d+ - /, '').slice(0, 60));

const mutations = JSON.parse(readFileSync(path.resolve(repo, mutFile), 'utf8'));
writeFileSync(file, original);
const base = run();
if (base.status !== 0) {
  console.log('ZÁKLAD SELHAL: zkoušky neprojdou ani bez mutace\n' + failingNames(base).slice(0, 5).join('\n'));
  process.exit(2);
}
console.log('základ v pořádku');

let survived = 0;
let used = 0;
try {
  for (const [index, [name, from, to]] of mutations.entries()) {
    if (only && !only.test(name)) continue;
    if (shard && index % shard[1] !== shard[0]) continue;
    used++;
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
console.log(`\nPřeživších mutací: ${survived} z ${used}`);
process.exit(survived ? 1 : 0);
