// Chrome Web Store images (24-bit PNG, no alpha): five 1280×800 screenshots composed from the
// marketing video's captures (run marketing/video/capture.ts first) plus a fresh shot of the
// theme editor, and the 440×280 small promo tile with Inky.
//
//   npm run store:images   → marketing/store/*.png

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension } from '../../scripts/lib/extension.ts';
import { INKY_COLORS, INKY_FRAMES } from '../../src/ui/inky-sprite.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE = path.join(HERE, '../video/out/capture');
if (!fs.existsSync(path.join(CAPTURE, 'manifest.json'))) throw new Error('No captures yet: run marketing/video/capture.ts first.');

/** 16 themes for the grid, dark and light alternating like a checkerboard. */
const GRID = [
  ['gruvbox-dark-medium', 'catppuccin-latte', 'tokyo-night', 'solarized-light'],
  ['rose-pine-dawn', 'dracula', 'github-light', 'nord'],
  ['synthwave-84', 'flexoki-light', 'kanagawa-wave', 'one-light'],
  ['ayu-light', 'everforest-dark-medium', 'tomorrow', 'monokai'],
];

const ext = await launchExtension({ viewport: { width: 1280, height: 800 } });
const base = `chrome-extension://${new URL(ext.worker.url()).host}`;

// The theme editor, from the top, starting from a colorful theme.
const editor = await ext.context.newPage();
await editor.goto(`${base}/editor.html?from=catppuccin-mocha`);
await editor.waitForTimeout(600);
const editorPng = await editor.screenshot();
await editor.close();

// Everything else is drawn on a canvas from the captures.
const stage = await ext.context.newPage();
await stage.route('http://store.local/**', (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname === '/') {
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@600;700;800&family=Silkscreen:wght@700&display=block"><canvas width="1280" height="800"></canvas>`,
    });
  }
  if (pathname === '/editor.png') return route.fulfill({ contentType: 'image/png', body: editorPng });
  const file = path.resolve(CAPTURE, pathname.slice(1));
  if (file.startsWith(CAPTURE + path.sep) && fs.existsSync(file)) return route.fulfill({ path: file });
  return route.fulfill({ status: 404 });
});
await stage.goto('http://store.local/', { waitUntil: 'load' });

const names = (await stage.evaluate(async () => {
  const manifest = await (await fetch('/manifest.json')).json();
  return Object.fromEntries(manifest.cycle.map((t: { id: string; name: string }) => [t.id, t.name]));
})) as Record<string, string>;

type Shot = { file: string; draw: string; args?: unknown };
const shots: Shot[] = [
  { file: 'screenshot-1-pick-a-theme.png', draw: 'pick' },
  { file: 'screenshot-2-before-after.png', draw: 'split', args: { before: 'wikipedia-original', after: 'wikipedia-dracula', label: names['dracula'] } },
  { file: 'screenshot-3-75-themes.png', draw: 'grid', args: { grid: GRID, names } },
  { file: 'screenshot-4-web-apps.png', draw: 'plain', args: { name: 'sheets-synthwave-84' } },
  { file: 'screenshot-5-make-your-own.png', draw: 'plain', args: { name: 'editor' } },
  { file: 'promo-small-440x280.png', draw: 'promo', args: { rows: INKY_FRAMES.idle, colors: INKY_COLORS } },
];

for (const shot of shots) {
  const b64 = await stage.evaluate(
    async ({ draw, args }) => {
      await document.fonts.load('700 18px Figtree');
      await document.fonts.load('700 30px Silkscreen');
      const canvas = document.querySelector('canvas')!;
      [canvas.width, canvas.height] = draw === 'promo' ? [440, 280] : [1280, 800];
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      const load = async (name: string) => {
        const img = new Image();
        img.src = name === 'editor' ? '/editor.png' : `/${name}.png`;
        await img.decode();
        return img;
      };
      /** A small dark label with rounded ends. */
      const pill = (text: string, x: number, y: number, align: 'left' | 'right', size = 18) => {
        ctx.font = `700 ${size}px Figtree, sans-serif`;
        const w = ctx.measureText(text).width + size * 1.4;
        const h = size * 1.9;
        const left = align === 'left' ? x : x - w;
        ctx.fillStyle = 'rgba(29, 32, 33, 0.88)';
        ctx.beginPath();
        ctx.roundRect(left, y - h, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = '#fbf1c7';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, left + size * 0.7, y - h / 2 + 1);
      };
      const a = args as Record<string, unknown>;

      ctx.fillStyle = '#1d2021';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (draw === 'promo') {
        // Inky, the wordmark, and a few splats of theme-colored ink, in the video's pixel style.
        const cell = 5;
        const blob = (cx: number, cy: number, r: number, color: string) => {
          for (let j = -r; j <= r; j++)
            for (let i = -r; i <= r; i++) {
              if ((i + 0.5) ** 2 + (j + 0.5) ** 2 > r * r) continue;
              const shine = (i + r * 0.4) ** 2 + (j + r * 0.4) ** 2 < (r * 0.3) ** 2;
              ctx.fillStyle = shine ? '#fbf1c7' : color;
              ctx.fillRect(cx + i * cell, cy + j * cell, cell, cell);
            }
        };
        blob(412, 26, 6, '#fabd2f');
        blob(386, 56, 1, '#fabd2f');
        blob(22, 252, 5, '#7aa2f7');
        blob(52, 268, 1, '#7aa2f7');
        blob(416, 252, 4, '#ff79c6');
        blob(28, 30, 3, '#a7c080');
        blob(362, 262, 1, '#bd93f9');
        const rows = a.rows as string[];
        const colors = a.colors as Record<string, string>;
        const px = 9;
        const inkyX = 34;
        const inkyY = Math.round((280 - rows.length * px) / 2);
        rows.forEach((row, y) => {
          [...row].forEach((ch, x) => {
            if (ch === '.') return;
            ctx.fillStyle = colors[ch] ?? '#000';
            ctx.fillRect(inkyX + x * px, inkyY + y * px, px, px);
          });
        });
        // The wordmark, as large as fits beside Inky.
        const left = 200;
        const room = 440 - left - 22;
        let size = 44;
        ctx.font = `700 ${size}px Silkscreen`;
        while (ctx.measureText('UNIVERSAL').width > room) ctx.font = `700 ${--size}px Silkscreen`;
        ctx.textBaseline = 'alphabetic';
        const shadow = Math.max(2, Math.round(size / 14));
        for (const [text, y] of [['UNIVERSAL', 124], ['THEME', 124 + size + 6]] as const) {
          ctx.fillStyle = '#b16286';
          ctx.fillText(text, left + shadow, y + shadow);
          ctx.fillStyle = '#fbf1c7';
          ctx.fillText(text, left, y);
        }
        ctx.font = '700 17px Figtree, sans-serif';
        ctx.fillStyle = '#d5c4a1';
        ctx.fillText('Any website, any theme.', left, 124 + size + 6 + 34);
      }
      if (draw === 'plain') {
        ctx.drawImage(await load(a.name as string), 0, 0, 1280, 800);
      }
      if (draw === 'pick') {
        // The page in Tokyo Night, with the popup dropped down from the toolbar.
        ctx.drawImage(await load('hero-tokyo-night'), 0, 0, 1280, 800);
        const popup = await load('popup-type-5');
        const hImg = 450;
        const w = 320;
        const h = (hImg / popup.naturalWidth) * w;
        const x = 1280 - w - 16;
        const y = 8;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 36;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = '#282828';
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.clip();
        ctx.drawImage(popup, 0, 0, popup.naturalWidth, hImg, x, y, w, h);
        ctx.restore();
      }
      if (draw === 'split') {
        // Before on the left, after on the right, a handle in the middle.
        ctx.drawImage(await load(a.before as string), 0, 0, 1280, 800);
        const after = await load(a.after as string);
        ctx.drawImage(after, after.naturalWidth / 2, 0, after.naturalWidth / 2, after.naturalHeight, 640, 0, 640, 800);
        ctx.fillStyle = '#fbf1c7';
        ctx.fillRect(638, 0, 4, 800);
        ctx.beginPath();
        ctx.arc(640, 400, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1d2021';
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(640 + dir * 5, 392);
          ctx.lineTo(640 + dir * 13, 400);
          ctx.lineTo(640 + dir * 5, 408);
          ctx.closePath();
          ctx.fill();
        }
        pill('Original', 24, 776, 'left');
        pill(a.label as string, 1256, 776, 'right');
      }
      if (draw === 'grid') {
        // The same page in 16 themes, each named.
        const grid = a.grid as string[][];
        const names = a.names as Record<string, string>;
        const gap = 4;
        const w = (1280 - gap * 3) / 4;
        const h = (800 - gap * 3) / 4;
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 4; col++) {
            const id = grid[row]![col]!;
            const x = col * (w + gap);
            const y = row * (h + gap);
            ctx.drawImage(await load(`hero-${id}`), x, y, w, h);
            pill(names[id] ?? id, x + 8, y + h - 8, 'left', 12);
          }
        }
      }
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    },
    { draw: shot.draw, args: shot.args },
  );
  const tmp = path.join(HERE, `.${shot.file}`);
  fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
  // The store wants 24-bit PNGs: drop the canvas's alpha channel.
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-pix_fmt', 'rgb24', path.join(HERE, shot.file)]);
  fs.rmSync(tmp);
  console.log(path.relative(process.cwd(), path.join(HERE, shot.file)));
}

await ext.close();
