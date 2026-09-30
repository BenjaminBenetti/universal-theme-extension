// Builds the extension for release and zips it: release/universal-theme-<version>.zip, ready to
// attach to a GitHub release or upload to the Chrome Web Store. Usage: npm run package
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--release'], { stdio: 'inherit' });
const out = path.join(root, 'release', `universal-theme-${version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
// From inside dist/, so manifest.json sits at the root of the zip.
execFileSync('zip', ['-qrX', out, '.'], { cwd: path.join(root, 'dist'), stdio: 'inherit' });
console.log(path.relative(root, out));
