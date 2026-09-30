// Renders the toolbar icons from Inky's sprite (src/ui/inky-sprite.ts), pixel for pixel:
// 16px is the sprite at 1:1, larger sizes are whole-number scale-ups, centered on a transparent
// square (128px leaves the 16px margin the Chrome Web Store asks for). Also writes assets/inky.svg.
// Usage: node scripts/render-icons.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';
import { INKY_COLORS, INKY_FRAMES, INKY_HEIGHT, INKY_WIDTH } from '../src/ui/inky-sprite.ts';

const rows = INKY_FRAMES.idle;
const SIZES = { 16: 1, 32: 2, 48: 3, 128: 6 };

const svgRects = rows
  .flatMap((row, y) => [...row].map((ch, x) => (ch === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${INKY_COLORS[ch]}"/>`)))
  .join('');
fs.writeFileSync(
  new URL('../assets/inky.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${INKY_WIDTH} ${INKY_HEIGHT}" shape-rendering="crispEdges">${svgRects}</svg>\n`,
);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
const page = await browser.newPage();
for (const [size, scale] of Object.entries(SIZES)) {
  const dataUrl = await page.evaluate(
    ({ rows, colors, size, scale }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const x0 = Math.floor((size - rows[0].length * scale) / 2);
      const y0 = Math.floor((size - rows.length * scale) / 2);
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          ctx.fillStyle = colors[ch];
          ctx.fillRect(x0 + x * scale, y0 + y * scale, scale, scale);
        }),
      );
      return canvas.toDataURL('image/png');
    },
    { rows: [...rows], colors: INKY_COLORS, size: Number(size), scale },
  );
  fs.writeFileSync(new URL(`../assets/icons/${size}.png`, import.meta.url), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();
console.log('icons written');
