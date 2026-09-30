// Renders the marketing video from the captures (run capture.ts first): bundles stage.ts, plays it
// frame by frame in headless Chromium, and encodes the frames and the synthesized soundtrack with
// ffmpeg.
//
//   node marketing/video/render.ts                  → marketing/universal-theme.mp4
//   node marketing/video/render.ts --stills 1,3.4   → marketing/video/out/stills/*.png
//
// Frames are rendered on several pages at once; the stage is a pure function of time, so any page
// can render any frame.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const CAPTURE = path.join(OUT, 'capture');
const MP4 = path.join(HERE, '..', 'universal-theme.mp4'); // the published copy, checked in
const WAV = path.join(OUT, 'soundtrack.wav');
const WORKERS = 8;

if (!fs.existsSync(path.join(CAPTURE, 'manifest.json'))) throw new Error('No captures yet: run marketing/video/capture.ts first.');

const bundle = await build({
  entryPoints: [path.join(HERE, 'stage.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'stage',
  target: 'chrome120',
  logLevel: 'warning',
});
const script = bundle.outputFiles[0]!.text;

const PAGE = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700;800&family=Silkscreen:wght@400;700&display=block">
<style>html, body { margin: 0; background: #000; } canvas { display: block; }</style>
<canvas width="1920" height="1080"></canvas>
<script src="stage.js"></script>`;

interface Stage {
  init(): Promise<{ duration: number; frames: number; fps: number; timeline: Record<string, number> }>;
  frame(i: number): string;
  still(t: number): string;
  renderAudio(): Promise<string>;
}
declare const stage: Stage;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });

async function openStage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('http://stage.local/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
    if (pathname === '/stage.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    const file = path.resolve(CAPTURE, decodeURIComponent(pathname.replace(/^\/capture\//, '')));
    if (pathname.startsWith('/capture/') && file.startsWith(CAPTURE + path.sep) && fs.existsSync(file)) return route.fulfill({ path: file });
    return route.fulfill({ status: 404 });
  });
  page.on('pageerror', (e) => console.error('stage:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('stage:', m.text()));
  await page.goto('http://stage.local/', { waitUntil: 'load' });
  return page;
}

const first = await openStage();
const info = await first.evaluate(() => stage.init());
console.log(`stage: ${info.duration.toFixed(2)} s, ${info.frames} frames`, info.timeline);

const stillsArg = process.argv.indexOf('--stills');
if (stillsArg >= 0) {
  const dir = path.join(OUT, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  for (const t of process.argv[stillsArg + 1]!.split(',').map(Number)) {
    const png = await first.evaluate((t) => stage.still(t), t);
    const file = path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(png, 'base64'));
    console.log(path.relative(process.cwd(), file));
  }
  await browser.close();
  process.exit(0);
}

const wav = await first.evaluate(() => stage.renderAudio());
fs.writeFileSync(WAV, Buffer.from(wav, 'base64'));
console.log('soundtrack:', path.relative(process.cwd(), WAV));

const pages = [first, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, openStage)))];
await Promise.all(pages.slice(1).map((p) => p.evaluate(() => stage.init())));

const ffmpeg = spawn(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', 'mjpeg', '-i', '-',
    '-i', WAV,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-tune', 'animation',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest',
    MP4,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const done = new Promise<void>((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
const write = (buf: Buffer) => new Promise<void>((resolve) => (ffmpeg.stdin.write(buf) ? resolve() : ffmpeg.stdin.once('drain', resolve)));

const started = Date.now();
for (let i = 0; i < info.frames; i += pages.length) {
  const batch = await Promise.all(pages.map((p, k) => (i + k < info.frames ? p.evaluate((n) => stage.frame(n), i + k) : undefined)));
  for (const b64 of batch) if (b64) await write(Buffer.from(b64, 'base64'));
  if ((i / pages.length) % 30 === 0) process.stdout.write(`\rframes ${i}/${info.frames}  ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
console.log(`\nvideo: ${path.relative(process.cwd(), MP4)}`);
