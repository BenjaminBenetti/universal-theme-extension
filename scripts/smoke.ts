// Quick manual check with the real Jev: node scripts/smoke.ts <url> <theme> <out.png> [settle-ms]
import { jevKey, launchExtension, waitForThemed } from './lib/extension.ts';

const [url = 'https://www.google.com/?hl=en', theme = 'gruvbox-dark-medium', out = 'smoke.png', settle = '0'] = process.argv.slice(2);
const ext = await launchExtension();
ext.worker.on('console', (m) => console.log('[worker]', m.text()));
await ext.setSettings({ apiKey: jevKey(), defaultTheme: theme });
const page = await ext.context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
// Heavy apps keep booting after "load"; give them time before judging.
await page.waitForTimeout(Number(settle));
const ms = await waitForThemed(page, 90_000).catch((e: Error) => (console.log(e.message), -1));
console.log(`themed ${ms} ms after waiting started; ${Date.now() - t0} ms since navigation`);
for (const frame of page.frames()) {
  const info = await frame
    .evaluate(() => {
      const all = [...document.querySelectorAll('body *')].filter((e) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META'].includes(e.tagName));
      return {
        status: document.documentElement.getAttribute('data-ute-status'),
        elements: all.length,
        unresolved: all.filter((e) => !e.hasAttribute('data-ute')).length,
        canvases: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}:${c.getAttribute('data-ute-g') ?? '-'}/${c.getAttribute('data-ute-paper') ?? '-'}`),
      };
    })
    .catch(() => undefined);
  if (info?.status) console.log(new URL(frame.url()).host, JSON.stringify(info));
}
for (const [k, v] of Object.entries(await ext.storage())) if (k.startsWith('labels:')) console.log(k, Object.keys(v as object).length, 'labels');
await page.screenshot({ path: out });
await ext.close();
