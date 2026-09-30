// Themes real websites with every theme, using the real Jev, and saves screenshots plus a
// contact sheet to screenshots/. Usage: npm run screenshots [-- url ...]
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_THEMES as THEMES } from '../src/themes/index.ts';
import { jevKey, launchExtension, ROOT, waitForThemed } from './lib/extension.ts';

/** `settle`: web apps keep booting after "load"; give them this long before judging. */
const DEFAULT_SITES = [
  { url: 'https://www.google.com/?hl=en', settle: 0 },
  { url: 'https://en.wikipedia.org/wiki/Cat', settle: 0 },
  { url: 'https://github.com/morhetz/gruvbox', settle: 0 },
  // Web components: Shoelace's docs are built from shadow-DOM components.
  { url: 'https://shoelace.style/components/button', settle: 1000 },
  // Complex apps: Excel for the web (canvas grid in a cross-site frame) and Google Sheets.
  { url: 'https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fgo.microsoft.com%2Ffwlink%2F%3FLinkID%3D521962', settle: 6000 },
  { url: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit', settle: 4000 },
];
const sites = process.argv.slice(2).length ? process.argv.slice(2).map((url) => ({ url, settle: 3000 })) : DEFAULT_SITES;
const outDir = path.join(ROOT, 'screenshots');

const key = jevKey();
if (!key) throw new Error('Set TYPESAFE_API_KEY (or JEV_KEY in secrets.env) to run against Jev.');
fs.mkdirSync(outDir, { recursive: true });

const ext = await launchExtension();
const page = await ext.context.newPage();
const shots: Array<{ site: string; theme: string; file: string; ms: number }> = [];

for (const { url, settle } of sites) {
  const host = new URL(url).hostname;
  const slug = host.replace(/^www\./, '').replace(/\W+/g, '-');

  // Original, for comparison.
  await ext.setSettings({ apiKey: key, sites: { [host]: 'off' } });
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(800 + settle);
  const original = path.join(outDir, `${slug}--original.png`);
  await page.screenshot({ path: original });
  shots.push({ site: host, theme: 'Original', file: original, ms: 0 });

  for (const theme of THEMES) {
    await ext.setSettings({ apiKey: key, sites: { [host]: theme.id } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const ms = await waitForThemed(page, 60_000);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(settle);
    await waitForThemed(page, 60_000);
    const file = path.join(outDir, `${slug}--${theme.id}.png`);
    await page.screenshot({ path: file });
    const status = await page.evaluate(() => document.documentElement.getAttribute('data-ute-status'));
    shots.push({ site: host, theme: theme.name, file, ms });
    console.log(`${host.padEnd(22)} ${theme.name.padEnd(22)} ${status} after ${ms} ms`);

    // Google: also open the suggestions dropdown, which the page builds on the fly (MutationObserver path).
    if (host === 'www.google.com' && theme.id.endsWith('medium')) {
      await page.locator('textarea[name=q], input[name=q]').first().click();
      await page.keyboard.type('gruvbox color scheme', { delay: 40 });
      await page.waitForTimeout(1200);
      await waitForThemed(page, 60_000);
      const typed = path.join(outDir, `${slug}--${theme.id}--suggestions.png`);
      await page.screenshot({ path: typed });
      console.log(`${host.padEnd(22)} ${`${theme.name} + typing`.padEnd(22)} suggestions captured`);
    }
  }
}

// Contact sheet per site: original + every theme.
for (const site of [...new Set(shots.map((s) => s.site))]) {
  const items = shots.filter((s) => s.site === site);
  const cells = items
    .map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.file).toString('base64')}"><figcaption>${s.theme}</figcaption></figure>`)
    .join('');
  const sheet = await ext.context.newPage();
  await sheet.setViewportSize({ width: 1920, height: 1000 });
  await sheet.setContent(
    `<style>body{margin:0;padding:24px;background:#1d2021;color:#ebdbb2;font:600 18px system-ui}` +
      `h1{margin:0 0 16px;font-size:22px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}` +
      `figure{margin:0}img{width:100%;border-radius:6px;display:block;box-shadow:0 0 0 1px #504945}figcaption{margin-top:6px}</style>` +
      `<h1>${site} — Universal Theme × Jev</h1><main>${cells}</main>`,
  );
  const file = path.join(outDir, `${site.replace(/^www\./, '').replace(/\W+/g, '-')}--sheet.png`);
  await sheet.screenshot({ path: file, fullPage: true });
  await sheet.close();
  console.log('contact sheet:', path.relative(ROOT, file));
}

await ext.close();
