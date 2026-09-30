// One-off: renders assets/icon.svg into the PNG sizes Chrome wants. Usage: node scripts/render-icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: new URL(`../assets/icons/${size}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();
