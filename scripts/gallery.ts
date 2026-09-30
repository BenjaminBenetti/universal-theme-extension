// One page in every built-in theme, as a single contact sheet, using the real Jev.
// Usage: npm run gallery [-- <url> [settle-ms]]   → screenshots/gallery--<site>.png
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_THEMES } from '../src/themes/index.ts';
import { jevKey, launchExtension, ROOT, waitForThemed } from './lib/extension.ts';

const [url = 'https://github.com/morhetz/gruvbox', settleArg = '0'] = process.argv.slice(2);
const settle = Number(settleArg);
const key = jevKey();
if (!key) throw new Error('Set TYPESAFE_API_KEY (or JEV_KEY in secrets.env) to run against Jev.');
const host = new URL(url).hostname;
const slug = host.replace(/^www\./, '').replace(/\W+/g, '-');
const outDir = path.join(ROOT, 'screenshots', 'gallery', slug);
fs.mkdirSync(outDir, { recursive: true });

const ext = await launchExtension();
const page = await ext.context.newPage();
const shots: Array<{ name: string; file: string }> = [];

for (const theme of BUILTIN_THEMES) {
  await ext.setSettings({ apiKey: key, sites: { [host]: theme.id } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(settle);
  await waitForThemed(page, 60_000).catch((e: Error) => console.log(`${theme.id}: ${e.message}`));
  const file = path.join(outDir, `${theme.id}.png`);
  await page.screenshot({ path: file });
  shots.push({ name: theme.name, file });
  console.log(`${theme.name}`);
}

const cells = shots
  .map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.file).toString('base64')}"><figcaption>${s.name}</figcaption></figure>`)
  .join('');
const sheet = await ext.context.newPage();
await sheet.setViewportSize({ width: 2400, height: 1000 });
await sheet.setContent(
  `<style>body{margin:0;padding:24px;background:#1d2021;color:#ebdbb2;font:600 16px system-ui}` +
    `h1{margin:0 0 16px;font-size:22px}main{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}` +
    `figure{margin:0}img{width:100%;border-radius:4px;display:block;box-shadow:0 0 0 1px #504945}figcaption{margin-top:4px}</style>` +
    `<h1>${host} in all ${shots.length} built-in themes — Universal Theme × Jev</h1><main>${cells}</main>`,
);
const out = path.join(ROOT, 'screenshots', `gallery--${slug}.png`);
await sheet.screenshot({ path: out, fullPage: true });
console.log('gallery:', path.relative(ROOT, out));
await ext.close();
