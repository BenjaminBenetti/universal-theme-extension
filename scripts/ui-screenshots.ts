// Screenshots of the extension's own pages (popup, settings, theme editor). Usage: npm run ui-screenshots
import path from 'node:path';
import { launchExtension, ROOT } from './lib/extension.ts';

const out = path.join(ROOT, 'screenshots', 'ui');
const ext = await launchExtension({ viewport: { width: 1280, height: 900 } });
await ext.setSettings({ apiKey: 'demo', defaultTheme: 'gruvbox-dark-medium', sites: { 'en.wikipedia.org': 'gruvbox-light-soft' } });
const base = `chrome-extension://${new URL(ext.worker.url()).host}`;
const page = await ext.context.newPage();

// A custom theme to show in the lists.
await page.goto(`${base}/editor.html?from=gruvbox-dark-medium`);
await page.fill('#name', 'Navy Night');
await page.locator('[id="f-background.page"]').fill('#101830');
await page.locator('[id="f-background.surface"]').fill('#16213d');
await page.locator('[id="f-background.raised"]').fill('#1d2a4a');
await page.locator('[id="f-background.accent"]').fill('#7aa2f7');
await page.locator('[id="f-text.link"]').fill('#7dcfff');
await page.locator('[id="f-text.link"]').blur();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'editor.png'), fullPage: false });
await page.click('#save');
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: path.join(out, 'editor-saved.png') });

await page.goto(`${base}/options.html`);
await page.screenshot({ path: path.join(out, 'settings.png'), fullPage: true });

// The popup, at popup size, with the site picker searching.
const popup = await ext.context.newPage();
await popup.setViewportSize({ width: 320, height: 520 });
await popup.goto(`${base}/popup.html`);
await popup.click('#default-theme');
await popup.keyboard.type('dark');
await popup.waitForTimeout(200);
await popup.screenshot({ path: path.join(out, 'popup-search.png') });
await popup.keyboard.press('Escape');
await popup.click('#default-theme');
await popup.waitForTimeout(200);
await popup.screenshot({ path: path.join(out, 'popup-open.png') });

await ext.close();
console.log('saved to', path.relative(ROOT, out));
