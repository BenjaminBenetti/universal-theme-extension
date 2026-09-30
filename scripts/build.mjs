// Builds the unpacked extension into dist/. Usage: node scripts/build.mjs [--watch | --release]
// --release leaves out source maps (npm run package uses it).
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_THEMES } from '../src/themes/index.ts';
import { bootCss, sharedStylesheet } from '../src/themes/css.ts';
import { validateTheme } from '../src/themes/format.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const release = process.argv.includes('--release');

async function writeStatic() {
  await fs.mkdir(path.join(dist, 'boot'), { recursive: true });
  await fs.mkdir(path.join(dist, 'icons'), { recursive: true });

  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'src/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await fs.writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

  for (const theme of BUILTIN_THEMES) {
    const errors = validateTheme(theme);
    if (errors.length) throw new Error(`src/themes/builtin/${theme.id}.json:\n  ${errors.join('\n  ')}`);
  }
  await fs.writeFile(path.join(dist, 'themes.css'), sharedStylesheet());
  for (const theme of BUILTIN_THEMES) await fs.writeFile(path.join(dist, 'boot', `${theme.id}.css`), bootCss(theme));

  for (const file of ['popup.html', 'options.html', 'editor.html', 'ui.css']) await fs.copyFile(path.join(root, 'src/ui', file), path.join(dist, file));
  for (const icon of await fs.readdir(path.join(root, 'assets/icons'))) {
    await fs.copyFile(path.join(root, 'assets/icons', icon), path.join(dist, 'icons', icon));
  }
}

const common = { bundle: true, target: 'chrome120', sourcemap: release ? false : 'linked', logLevel: 'info', legalComments: 'none' };
const builds = [
  { ...common, entryPoints: { content: 'src/content/index.ts', 'main-world': 'src/content/main-world.ts' }, format: 'iife', outdir: dist },
  { ...common, entryPoints: { background: 'src/background/index.ts' }, format: 'esm', outdir: dist },
  { ...common, entryPoints: { popup: 'src/ui/popup.ts', options: 'src/ui/options.ts', editor: 'src/ui/editor.ts' }, format: 'iife', outdir: dist },
];

await fs.rm(dist, { recursive: true, force: true });
await writeStatic();
if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
  console.log('Watching for changes (theme/CSS changes need a restart)…');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
