/* Příprava obsahu desktopové aplikace: sestaví samostatnou verzi (STRICT=1, všechny moduly povinné) a zkopíruje ji do desktop/app.
   Spouští se před spuštěním (npm start) i před sestavením instalátoru (npm run dist). */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const build = spawnSync(process.execPath, [join(root, 'trener', 'build.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, STRICT: '1' } });
if (build.status !== 0) {
  console.error('Sestavení samostatné verze selhalo.');
  process.exit(build.status || 1);
}
const from = join(root, 'trener', 'dist', 'standalone');
const to = join(here, 'app');
if (!existsSync(join(from, 'index.html'))) {
  console.error('Chybí trener/dist/standalone/index.html.');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
// service worker se do desktopové aplikace nekopíruje: stránka se načítá z vlastního protokolu a nepotřebuje ho
cpSync(from, to, { recursive: true, filter: (src) => !/[\\/]sw\.js$/.test(src) });
writeFileSync(join(to, 'DESKTOP.txt'), 'Kopie trener/dist/standalone pro desktopovou aplikaci (vzniká příkazem node desktop/prepare.mjs).\n');
console.log('Hotovo: desktop/app je připravená.');
