// The Universal Theme marketing video, as a pure function of time.
//
// renderFrame(t) paints the frame at t seconds onto a 1920×1080 canvas and renderAudio() synthesizes
// the soundtrack from the same timeline, so render.ts can play the whole thing offline, frame by
// frame, with nothing depending on the clock. Every page shown is a capture of the real extension
// on the real site (out/capture, from capture.ts); Inky is drawn from the extension's own sprite.
//
//   1. Splash    Inky drops in and fires theme-colored ink at the camera; the ink slides off.
//   2. How       Open a site, click Inky, pick Tokyo Night; Jev labels the page, the theme paints it.
//   3. Cycle     The same page in all 75 themes, faster and faster.
//   4. Sites     Wikipedia, GitHub, Google Sheets, and Excel, each in a few themes.
//   5. End card  Inky tries on themes, hiccups some ink, shakes it off, and winks.

import { HEART, INKY_COLORS, INKY_FRAMES } from '../../src/ui/inky-sprite.ts';
import { BUILTIN_THEMES, swatchesOf } from '../../src/themes/index.ts';
import type { ThemeDefinition } from '../../src/themes/format.ts';
import { parseColor, toHex } from '../../src/shared/color.ts';

const W = 1920;
const H = 1080;
const FPS = 30;

// The stage lives in Inky's home palette (Gruvbox Dark Hard): near-black ground, cream type, pink
// and plum for Inky. From scene 3 on, the frame takes the colors of whichever theme is on screen.
const GROUND = '#1d2021';
const CREAM = '#fbf1c7';
const SAND = '#d5c4a1';
const STONE = '#a89984';
const PLUM = '#b16286';
const PIXEL = '"Silkscreen", "Courier New", monospace';
const SANS = '"Figtree", "Segoe UI", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
/** Colors Jev's labels are drawn in, by what they describe. */
const ROLE_COLORS = { background: '#7aa2f7', text: '#e0af68', border: '#9ece6a' } as const;

interface Manifest {
  hero: { url: string; title: string };
  cycle: Array<{ id: string }>;
  sites: Array<{ id: string; url: string; themes: Array<{ id: string }> }>;
}
interface LabelBox {
  role: keyof typeof ROLE_COLORS;
  token: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let ctx: CanvasRenderingContext2D;
let manifest: Manifest;
let labels: LabelBox[] = [];
const shots = new Map<string, HTMLImageElement>();
/** Height of each popup capture's content, in image pixels (the rest is empty popup). */
const popupHeight = new Map<string, number>();
const THEMES = new Map(BUILTIN_THEMES.map((t) => [t.id, t]));
const theme = (id: string) => THEMES.get(id)!;

// ---------------------------------------------------------------------------------------------
// Math, color

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** 0 before t0, 1 after t1, linear between. */
const span = (t: number, t0: number, t1: number) => clamp((t - t0) / (t1 - t0));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeIn = (p: number) => p * p * p;
const easeBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263) ^ Math.imul(c + 13, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(color: string): [number, number, number] {
  const c = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
  return [c.r, c.g, c.b];
}
const hex = (color: string) => toHex(parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 });
function mix(a: string, b: string, p: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex({ r: lerp(x[0], y[0], p), g: lerp(x[1], y[1], p), b: lerp(x[2], y[2], p), a: 1 });
}
function withAlpha(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${clamp(a)})`;
}
function lightness(color: string): number {
  const [r, g, b] = rgb(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------------------------------------------------------------------------------------------
// Timeline. Scene 2 is laid out by hand; the rest is planned from the captures in init().

const BAR = 2; // seconds per bar of the soundtrack (120 bpm, 4/4)

/** Inky's ink volley in the splash: where each blob lands, when, and in which theme's color. */
const FLIGHT = 0.2;
const SHOTS = [
  { t: 3.05, x: 380, y: 250, r: 150, color: '#fabd2f' },
  { t: 3.25, x: 1540, y: 290, r: 170, color: '#7aa2f7' },
  { t: 3.42, x: 700, y: 850, r: 140, color: '#ff79c6' },
  { t: 3.57, x: 1650, y: 810, r: 160, color: '#a7c080' },
  { t: 3.7, x: 230, y: 700, r: 130, color: '#f7768e' },
  { t: 3.81, x: 1190, y: 150, r: 120, color: '#8be9fd' },
  { t: 3.91, x: 1110, y: 660, r: 180, color: '#bd93f9' },
  { t: 4.0, x: 560, y: 470, r: 150, color: '#fe8019' },
  { t: 4.08, x: 1420, y: 530, r: 140, color: '#83a598' },
  { t: 4.15, x: 890, y: 320, r: 190, color: '#d3869b' },
];
const SLIDE = 4.72; // the ink starts sliding off the screen

/** Scene 2: how it works. */
const HOW = {
  start: 4.1,
  cap1: [5.6, 7.4],
  zoomIn: [7.0, 7.8],
  clicks: [7.45, 8.62, 10.32],
  popup: 7.55,
  cap2: [7.6, 11.2],
  list: 8.62,
  type: 9.05,
  typeStep: 0.13,
  pick: 10.35,
  close: 11.15,
  zoomOut: [11.0, 11.7],
  scan: [11.8, 13.4],
  cap3: [11.8, 13.9],
  paint: [14.0, 14.9],
  cap4: [14.0, 16.0],
  labelsOut: [14.9, 15.4],
} as const;

/** Where the cursor is, in stage coordinates, and how visible: [time, x, y, opacity]. */
const CURSOR: Array<[number, number, number, number]> = [
  [6.5, 1150, 700, 0],
  [6.75, 1150, 700, 1],
  [7.4, 1482, 96, 1],
  [8.05, 1482, 96, 1],
  [8.55, 1300, 212, 1],
  [9.9, 1300, 212, 1],
  [10.28, 1262, 274, 1],
  [11.05, 1262, 274, 1],
  [11.3, 1262, 274, 0],
];

interface Slot {
  theme: ThemeDefinition;
  t0: number;
  t1: number;
  index: number;
  /** Switches this short are hard cuts; longer ones dissolve. */
  frames: number;
}
interface SiteItem {
  img: string;
  theme?: ThemeDefinition;
  t0: number;
  t1: number;
}
interface SitePlan {
  id: string;
  name: string;
  title: string;
  icon: Favicon;
  url: string;
  t0: number;
  t1: number;
  items: SiteItem[];
}

const PUNCH_HOLD = BAR; // one bar on "75 themes"
const SITE_INFO: Record<string, { name: string; title: string; icon: Favicon }> = {
  wikipedia: { name: 'Wikipedia', title: 'Octopus - Wikipedia', icon: 'wikipedia' },
  github: { name: 'GitHub', title: 'GitHub - morhetz/gruvbox', icon: 'github' },
  sheets: { name: 'Google Sheets', title: 'Example Spreadsheet - Google Sheets', icon: 'sheets' },
  excel: { name: 'Excel', title: 'Financial Sample.xlsx', icon: 'excel' },
};
const ORIGINAL_HOLD = 0.95;
const THEME_HOLD = 0.8;
const PUSH = 0.4;
const PEEK = 0.8; // Inky peeks up over the last site before the end card

const TL = { cycle: 0, punch: 0, sites: 0, end: 0, card: 0, total: 0 };
let slots: Slot[] = [];
let sitePlan: SitePlan[] = [];

/** End card beats, relative to TL.card. */
const CARD = { hops: [1.15, 1.7, 2.25, 2.8], hop: 0.45, hic: 3.8, length: 7.75 };
const HOP_LOOKS = ['tokyo', 'dracula', 'everforest', 'inky'] as const;
const HOP_NAMES = ['Tokyo Night', 'Dracula', 'Everforest', 'Gruvbox'];

function plan() {
  const ids = manifest.cycle.map((c) => c.id);
  const first = 'tokyo-night'; // continues from scene 2
  const last = 'gruvbox-dark-medium'; // Inky's home, and the default theme
  const middle = ids.filter((id) => id !== first && id !== last);
  const n = ids.length;
  // Geometric speed-up: 1 s per theme down to 2 frames per theme.
  const r = (2 / FPS) ** (1 / (n - 2));
  const frames = Array.from({ length: n - 1 }, (_, i) => Math.max(2, Math.round(FPS * r ** i)));
  // Past about three switches a second, stick to themes of one brightness at a time, so the fast
  // part changes hue quickly but never strobes between dark and light.
  const calm = frames.filter((f) => f >= 11).length;
  const early = middle.slice(0, calm - 1);
  const rest = middle.slice(calm - 1);
  const ofMode = (mode: string) => rest.filter((id) => theme(id).mode === mode);
  const order = [first, ...early, ...ofMode('light'), ...ofMode('dark'), last];
  const cycleLength = frames.reduce((a, b) => a + b, 0) / FPS;
  // Land the "75 themes" punch on a bar line of the music.
  TL.punch = Math.ceil((16.2 + cycleLength) / BAR) * BAR;
  TL.cycle = TL.punch - cycleLength;
  let t = TL.cycle;
  slots = order.map((id, index) => {
    const f = frames[index] ?? Math.round(PUNCH_HOLD * FPS);
    const slot = { theme: theme(id), t0: t, t1: t + f / FPS, index, frames: f };
    t += f / FPS;
    return slot;
  });

  TL.sites = TL.punch + PUNCH_HOLD;
  t = TL.sites;
  sitePlan = manifest.sites.map((site, k) => {
    const info = SITE_INFO[site.id]!;
    const t0 = t;
    const items: SiteItem[] = [{ img: `${site.id}-original`, t0, t1: t0 + ORIGINAL_HOLD }];
    t += ORIGINAL_HOLD;
    for (const [j, th] of site.themes.entries()) {
      const hold = THEME_HOLD + (k === manifest.sites.length - 1 && j === site.themes.length - 1 ? PEEK : 0);
      items.push({ img: `${site.id}-${th.id}`, theme: theme(th.id), t0: t, t1: t + hold });
      t += hold;
    }
    return { id: site.id, ...info, url: site.url, t0, t1: t, items };
  });
  TL.end = t;
  TL.card = TL.end + 0.65;
  TL.total = TL.card + CARD.length;
}

// ---------------------------------------------------------------------------------------------
// Inky

type Palette = Record<string, string>;
const PALETTES: Record<string, Palette> = {
  inky: { B: INKY_COLORS.B!, A: INKY_COLORS.A!, P: INKY_COLORS.P! },
  tokyo: { B: '#7aa2f7', A: '#3d59a1', P: '#f7768e' },
  dracula: { B: '#bd93f9', A: '#ff79c6', P: '#ff5555' },
  everforest: { B: '#a7c080', A: '#5c7a4a', P: '#e67e80' },
};
const HEAD = INKY_FRAMES.idle.slice(0, 6);
const EYES = {
  open: INKY_FRAMES.idle.slice(6, 8),
  shut: INKY_FRAMES.blink.slice(6, 8),
  wink: ['BBBWEBBBBBBBBBBB', 'BBBEEBBBBBBEEBBB'],
  happy: ['BBBEEBBBBBBEEBBB', 'BBEBBEBBBBEBBEBB'],
};
const FACES = {
  calm: INKY_FRAMES.idle.slice(8, 11),
  o: ['BBPPBBBKKBBBPPBB', '.BBBBBBKKBBBBBB.', '.BBBBBBBBBBBBBB.'],
  smile: ['BBPPBBKBBKBBPPBB', '.BBBBBBKKBBBBBB.', '.BBBBBBBBBBBBBB.'],
  blush: ['BPPPBBKBBKBBPPPB', '.BPPBBBKKBBBPPB.', '.BBBBBBBBBBBBBB.'],
};
const ARMS = { a: INKY_FRAMES.idle.slice(11), b: INKY_FRAMES.swim.slice(11) };

interface Look {
  eyes?: keyof typeof EYES;
  face?: keyof typeof FACES;
  arms?: keyof typeof ARMS;
  /** Eyes open extra wide. */
  wide?: boolean;
  palette?: keyof typeof PALETTES;
}

const sprites = new Map<string, HTMLCanvasElement>();
function paintRows(rows: readonly string[], colors: Palette, rowOffset = 0): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = rows[0]!.length;
  canvas.height = rows.length;
  const g = canvas.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.') continue;
      g.fillStyle = colors[ch] ?? INKY_COLORS[ch] ?? '#000';
      g.fillRect(x, y + rowOffset, 1, 1);
    }
  });
  return canvas;
}
function inkySprite(look: Look): HTMLCanvasElement {
  const key = JSON.stringify(look);
  let sprite = sprites.get(key);
  if (!sprite) {
    const rows = [
      ...HEAD.slice(0, 5),
      look.wide ? 'BBBWWBBBBBBWWBBB' : HEAD[5]!,
      ...EYES[look.eyes ?? 'open'],
      ...FACES[look.face ?? 'calm'],
      ...ARMS[look.arms ?? 'a'],
    ];
    sprite = paintRows(rows, { ...INKY_COLORS, ...PALETTES[look.palette ?? 'inky'] });
    sprites.set(key, sprite);
  }
  return sprite;
}

/**
 * Inky standing on (cx, bottom), `scale` screen pixels per sprite pixel. Squash > 0 flattens,
 * < 0 stretches, both about the feet. `extra` draws on top in sprite pixels (0,0 is the top-left).
 */
function drawInky(
  look: Look,
  cx: number,
  bottom: number,
  scale: number,
  opts: { squash?: number; rot?: number; extra?: () => void } = {},
) {
  const squash = opts.squash ?? 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, bottom);
  ctx.rotate(opts.rot ?? 0);
  ctx.scale(scale * (1 + squash), scale * (1 - squash));
  ctx.translate(-8, -14);
  ctx.drawImage(inkySprite(look), 0, 0);
  opts.extra?.();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Ink

interface SplatArt {
  canvas: HTMLCanvasElement;
  size: number;
  cell: number;
  fill: string;
  dark: string;
  drips: Array<{ col: number; top: number; w: number; len: number; rate: number }>;
}

/** A pixel-art ink splat: a wobbly blob with satellites, droplets, a shine, and drips. */
function makeSplat(seed: number, radius: number, color: string, cell = 10): SplatArt {
  const rnd = random(seed);
  const R = radius / cell;
  const size = Math.ceil(R * 3.6);
  const c = size / 2;
  const ph1 = rnd() * 6.28;
  const ph2 = rnd() * 6.28;
  const blobs: Array<[number, number, number]> = [];
  const satellites = 6 + Math.floor(rnd() * 5);
  for (let i = 0; i < satellites; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R * (0.75 + rnd() * 0.4);
    blobs.push([c + Math.cos(a) * d, c + Math.sin(a) * d, R * (0.16 + rnd() * 0.22)]);
  }
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R * (1.3 + rnd() * 0.4);
    blobs.push([c + Math.cos(a) * d, c + Math.sin(a) * d, 0.5 + rnd() * 1.0]);
  }
  const inside = (x: number, y: number) => {
    const dx = x - c;
    const dy = y - c;
    const a = Math.atan2(dy, dx);
    const rr = R * (1 + 0.1 * Math.sin(3 * a + ph1) + 0.07 * Math.sin(5 * a + ph2));
    return dx * dx + dy * dy < rr * rr || blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br);
  };
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && inside(x + 0.5, y + 0.5);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const light = mix(color, '#ffffff', 0.45);
  const dark = mix(color, '#000000', 0.28);
  const shine: [number, number] = [c - R * 0.42, c - R * 0.45];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!filled(x, y)) continue;
      let fill = color;
      if (!filled(x, y + 1) || !filled(x + 1, y)) fill = dark;
      if ((x + 0.5 - shine[0]) ** 2 + (y + 0.5 - shine[1]) ** 2 < (R * 0.26) ** 2) fill = light;
      g.fillStyle = fill;
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(shine[0] - R * 0.12), Math.round(shine[1] - R * 0.1), 1, 1);
  const drips = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => {
    const col = Math.round(c + (rnd() * 1.3 - 0.65) * R);
    let top = size - 1;
    while (top > 0 && !filled(col, top)) top--;
    return { col, top, w: rnd() < 0.4 ? 2 : 1, len: R * (0.5 + rnd() * 1.1), rate: 1.2 + rnd() * 1.6 };
  });
  return { canvas, size, cell, fill: color, dark, drips };
}

/** A splat centered on (x, y), `age` seconds after landing (drips grow with age). */
function drawSplat(art: SplatArt, x: number, y: number, age: number, scale = 1, stretch = 1) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.scale(scale, scale * stretch);
  const px = art.cell;
  const half = (art.size * px) / 2;
  ctx.drawImage(art.canvas, -half, -half, art.size * px, art.size * px);
  for (const d of art.drips) {
    const len = Math.round(d.len * (1 - Math.exp(-Math.max(0, age) * d.rate)));
    if (len < 1) continue;
    const x0 = -half + d.col * px;
    const y0 = -half + d.top * px;
    ctx.fillStyle = art.fill;
    ctx.fillRect(x0, y0, d.w * px, (len + 1) * px);
    ctx.fillRect(x0, y0 + (len - 1) * px, (d.w + 1) * px, 2 * px);
    ctx.fillStyle = art.dark;
    ctx.fillRect(x0 + d.w * px, y0 + (len - 1) * px, px, 2 * px);
    ctx.fillRect(x0, y0 + (len + 1) * px, (d.w + 1) * px, px);
  }
  ctx.restore();
}

/** A round blob of ink in flight, snapped to a coarse pixel grid. */
function drawBlob(x: number, y: number, radius: number, color: string) {
  const cell = Math.max(4, Math.round(radius / 6));
  const n = Math.ceil(radius / cell);
  const rr = (radius / cell) ** 2;
  const light = mix(color, '#ffffff', 0.45);
  const dark = mix(color, '#000000', 0.28);
  const ox = Math.round(x / cell) * cell;
  const oy = Math.round(y / cell) * cell;
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      if ((i + 0.5) ** 2 + (j + 0.5) ** 2 >= rr) continue;
      const shine = (i + 0.5 + n * 0.4) ** 2 + (j + 0.5 + n * 0.4) ** 2 < rr * 0.1;
      const rim = (i + 1.5) ** 2 + (j + 1.5) ** 2 >= rr;
      ctx.fillStyle = shine ? light : rim ? dark : color;
      ctx.fillRect(ox + i * cell, oy + j * cell, cell, cell);
    }
  }
}

const splats = new Map<string, SplatArt>();
function splatArt(key: string, make: () => SplatArt): SplatArt {
  let art = splats.get(key);
  if (!art) splats.set(key, (art = make()));
  return art;
}

// ---------------------------------------------------------------------------------------------
// Type and backdrop

function pixelText(text: string, x: number, y: number, size: number, color: string, shadow: string) {
  ctx.font = `700 ${size}px ${PIXEL}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const d = Math.max(3, Math.round(size / 15));
  ctx.fillStyle = shadow;
  ctx.fillText(text, x + d, y + d);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const TITLE = 'UNIVERSAL THEME';
/** The wordmark, letters dropping in one after another from `start`. */
function drawTitle(t: number, start: number) {
  ctx.font = `700 104px ${PIXEL}`;
  const widths = [...TITLE].map((ch) => ctx.measureText(ch).width);
  let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  [...TITLE].forEach((ch, i) => {
    const p = span(t, start + i * 0.035, start + i * 0.035 + 0.38);
    if (p > 0 && ch !== ' ') {
      ctx.save();
      ctx.globalAlpha *= clamp(p * 4);
      pixelText(ch, x + widths[i]! / 2, 712 - (1 - easeBack(p)) * 70, 104, CREAM, PLUM);
      ctx.restore();
    }
    x += widths[i]!;
  });
}

function drawLine(text: string, t: number, start: number, y: number, font: string, color: string) {
  const p = span(t, start, start + 0.4);
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha *= p;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y + (1 - easeOut(p)) * 12);
  ctx.restore();
}

function ground(color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 120, W / 2, H / 2, 1250);
  glow.addColorStop(0, 'rgba(255,255,255,0.045)');
  glow.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = glow;
  ctx.fillRect(-40, -40, W + 80, H + 80);
}

/** Pixel bubbles drifting up: Inky is an octopus, after all. */
function bubbles(t: number) {
  for (let i = 0; i < 46; i++) {
    const size = [4, 8, 12][Math.floor(hash(i, 1) * 3)]!;
    const speed = 24 + hash(i, 2) * 60;
    const travel = H + 60;
    const y = H + 30 - ((t * speed + hash(i, 4) * travel) % travel);
    const x = hash(i, 3) * W + Math.sin(t * (0.6 + hash(i, 5)) + i) * 12;
    ctx.fillStyle = withAlpha(CREAM, 0.04 + hash(i, 6) * 0.09);
    ctx.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, size, size);
  }
}

// ---------------------------------------------------------------------------------------------
// The browser window

type Favicon = 'nexus' | 'wikipedia' | 'github' | 'sheets' | 'excel';
interface Tab {
  title: string;
  url: string;
  icon: Favicon;
}
const WIN = { x: 320, y: 36, w: 1280, h: 878 };
const TAB_H = 38;
const BAR_H = 40;
/** The page itself: the captures are 1280×800 CSS pixels, shown 1:1 on the stage. */
const VIEW = { x: WIN.x, y: WIN.y + TAB_H + BAR_H, w: 1280, h: 800 };
const ICON = { x: WIN.x + WIN.w - 118, y: WIN.y + TAB_H + BAR_H / 2 };
const POPUP = { x: ICON.x + 16 - 320, y: VIEW.y + 2, w: 320 };

function favicon(kind: Favicon, x: number, y: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letter = (bg: string, fg: string, text: string, font: string, round: boolean) => {
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (round) ctx.arc(x + 8, y + 8, 8, 0, Math.PI * 2);
    else ctx.roundRect(x, y, 16, 16, 3);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.fillText(text, x + 8, y + 8.5);
  };
  if (kind === 'nexus') letter('#4f7cff', '#ffffff', 'N', `800 10px ${SANS}`, true);
  if (kind === 'wikipedia') letter('#f8f9fa', '#202122', 'W', `700 11px Georgia, serif`, true);
  if (kind === 'github') letter('#f0f6fc', '#1f2328', 'G', `800 10px ${SANS}`, true);
  if (kind === 'excel') letter('#107c41', '#ffffff', 'X', `800 10px ${SANS}`, false);
  if (kind === 'sheets') {
    ctx.fillStyle = '#0f9d58';
    ctx.beginPath();
    ctx.roundRect(x + 2, y, 12, 16, 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 4.5, y + 6, 7, 6);
    ctx.fillStyle = '#0f9d58';
    ctx.fillRect(x + 7.5, y + 6, 1, 6);
    ctx.fillRect(x + 4.5, y + 8.5, 7, 1);
  }
  ctx.restore();
}

function drawChrome(tab: Tab, iconDown: number) {
  const { x, y, w } = WIN;
  ctx.fillStyle = '#202124';
  ctx.fillRect(x, y, w, TAB_H);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + 22 + i * 20, y + 19, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  // The one tab.
  const tx = x + 88;
  const tw = 256;
  ctx.fillStyle = '#35363a';
  ctx.beginPath();
  ctx.roundRect(tx, y + 7, tw, TAB_H - 7 + 1, [10, 10, 0, 0]);
  ctx.fill();
  favicon(tab.icon, tx + 12, y + 15);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tx + 36, y + 7, tw - 70, TAB_H - 7);
  ctx.clip();
  ctx.font = `500 13px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e8eaed';
  ctx.fillText(tab.title, tx + 36, y + 27.5);
  ctx.restore();
  ctx.strokeStyle = '#9aa0a6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const cx = tx + tw - 20;
  ctx.moveTo(cx - 4, y + 19);
  ctx.lineTo(cx + 4, y + 27);
  ctx.moveTo(cx + 4, y + 19);
  ctx.lineTo(cx - 4, y + 27);
  ctx.moveTo(tx + tw + 20, y + 17);
  ctx.lineTo(tx + tw + 20, y + 29);
  ctx.moveTo(tx + tw + 14, y + 23);
  ctx.lineTo(tx + tw + 26, y + 23);
  ctx.stroke();

  // Toolbar: back, forward, reload, the address bar, extensions.
  const by = y + TAB_H;
  const my = by + BAR_H / 2;
  ctx.fillStyle = '#35363a';
  ctx.fillRect(x, by, w, BAR_H);
  ctx.strokeStyle = '#c4c7c5';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 29, my);
  ctx.lineTo(x + 15, my);
  ctx.moveTo(x + 21, my - 6);
  ctx.lineTo(x + 15, my);
  ctx.lineTo(x + 21, my + 6);
  ctx.stroke();
  ctx.strokeStyle = '#6f7275';
  ctx.beginPath();
  ctx.moveTo(x + 47, my);
  ctx.lineTo(x + 61, my);
  ctx.moveTo(x + 55, my - 6);
  ctx.lineTo(x + 61, my);
  ctx.lineTo(x + 55, my + 6);
  ctx.stroke();
  ctx.strokeStyle = '#c4c7c5';
  ctx.beginPath();
  ctx.arc(x + 88, my, 7, -Math.PI * 0.35, Math.PI * 1.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 93, my - 9);
  ctx.lineTo(x + 94, my - 4);
  ctx.lineTo(x + 89, my - 3);
  ctx.stroke();

  const ob = { x: x + 112, y: by + 6, w: w - 112 - 152, h: 28 };
  ctx.fillStyle = '#202124';
  ctx.beginPath();
  ctx.roundRect(ob.x, ob.y, ob.w, ob.h, 14);
  ctx.fill();
  ctx.strokeStyle = '#9aa0a6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ob.x + 12, ob.y + 10);
  ctx.lineTo(ob.x + 22, ob.y + 10);
  ctx.moveTo(ob.x + 12, ob.y + 18);
  ctx.lineTo(ob.x + 22, ob.y + 18);
  ctx.stroke();
  ctx.fillStyle = '#9aa0a6';
  ctx.beginPath();
  ctx.arc(ob.x + 15, ob.y + 10, 2.2, 0, Math.PI * 2);
  ctx.arc(ob.x + 19, ob.y + 18, 2.2, 0, Math.PI * 2);
  ctx.fill();
  const url = tab.url.replace(/^https?:\/\//, '');
  const cut = url.indexOf('/');
  const host = cut < 0 ? url : url.slice(0, cut);
  const rest = cut < 0 ? '' : url.slice(cut);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ob.x + 34, ob.y, ob.w - 46, ob.h);
  ctx.clip();
  ctx.font = `400 14px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eaed';
  ctx.fillText(host, ob.x + 36, ob.y + 19);
  ctx.fillStyle = '#9aa0a6';
  ctx.fillText(rest, ob.x + 36 + ctx.measureText(host).width, ob.y + 19);
  ctx.restore();

  // Inky, pressed or not; then the puzzle piece, the profile, the menu.
  if (iconDown > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.16 * iconDown})`;
    ctx.beginPath();
    ctx.arc(ICON.x, ICON.y, 16, 0, Math.PI * 2);
    ctx.fill();
  }
  drawInky({}, ICON.x, ICON.y + 9, 1.25);
  ctx.strokeStyle = '#c4c7c5';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(x + w - 92, my - 6, 13, 13, 2);
  ctx.moveTo(x + w - 85.5, my - 6);
  ctx.arc(x + w - 85.5, my - 8, 2.5, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  ctx.fillStyle = '#8ab4f8';
  ctx.beginPath();
  ctx.arc(x + w - 50, my, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#202124';
  ctx.font = `700 12px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('B', x + w - 50, my + 4.5);
  ctx.fillStyle = '#c4c7c5';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(x + w - 20, my + i * 5.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The whole browser window with `content` drawn into the page area. */
function drawWindow(tab: Tab, content: () => void, opts: { iconDown?: number; backdrop?: string } = {}) {
  const backdrop = opts.backdrop ?? GROUND;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${lerp(0.6, 0.3, lightness(backdrop))})`;
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 28;
  ctx.fillStyle = '#202124';
  ctx.beginPath();
  ctx.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, 12);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, 12);
  ctx.clip();
  drawChrome(tab, opts.iconDown ?? 0);
  ctx.beginPath();
  ctx.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  content();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(WIN.x + 0.5, WIN.y + 0.5, WIN.w - 1, WIN.h - 1, 12);
  ctx.stroke();
  ctx.restore();
}

function shot(name: string): HTMLImageElement {
  const img = shots.get(name);
  if (!img) throw new Error(`Missing capture: ${name}.png`);
  return img;
}

function drawPage(name: string) {
  ctx.drawImage(shot(name), VIEW.x, VIEW.y, VIEW.w, VIEW.h);
}

/**
 * Page `from` turning into page `to` in 32 px blocks. "random" scatters the blocks, "sweep" runs
 * top to bottom with a lit edge, "diagonal" runs from the top-left corner.
 */
function dissolve(from: string, to: string, p: number, mode: 'random' | 'sweep' | 'diagonal', seed: number, edge?: string) {
  if (p <= 0) return drawPage(from);
  if (p >= 1) return drawPage(to);
  drawPage(from);
  const img = shot(to);
  const size = 32;
  const cols = VIEW.w / size;
  const rows = VIEW.h / size;
  const k = img.naturalWidth / VIEW.w;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const noise = hash(i, j, seed);
      const at =
        mode === 'random' ? noise : mode === 'sweep' ? (j / rows) * 0.8 + noise * 0.2 : ((i / cols) * 0.55 + (j / rows) * 0.45) * 0.75 + noise * 0.25;
      if (at >= p) continue;
      ctx.drawImage(img, i * size * k, j * size * k, size * k, size * k, VIEW.x + i * size, VIEW.y + j * size, size, size);
      if (edge && p - at < 0.04) {
        ctx.fillStyle = withAlpha(edge, 0.55);
        ctx.fillRect(VIEW.x + i * size, VIEW.y + j * size, size, size);
      }
    }
  }
}

const HERO_TAB = (): Tab => ({ title: manifest.hero.title, url: manifest.hero.url, icon: 'nexus' });

// ---------------------------------------------------------------------------------------------
// Captions

/** A centered caption under the window, fading in over 0.3 s and out over 0.25 s. */
function caption(text: string, t: number, [t0, t1]: readonly [number, number], legend = false) {
  const a = span(t, t0, t0 + 0.3) * (1 - span(t, t1 - 0.25, t1));
  if (a <= 0) return;
  const dy = (1 - easeOut(span(t, t0, t0 + 0.3))) * 14;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `800 46px ${SANS}`;
  const w = ctx.measureText(text).width;
  const top = legend ? 948 : 962;
  ctx.fillStyle = withAlpha(GROUND, 0.94);
  ctx.beginPath();
  ctx.roundRect(W / 2 - w / 2 - 30, top + dy, w + 60, legend ? 118 : 76, 24);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = CREAM;
  ctx.fillText(text, W / 2, top + 54 + dy);
  if (legend) {
    const items: Array<[string, string]> = [
      ['backgrounds', ROLE_COLORS.background],
      ['text', ROLE_COLORS.text],
      ['borders', ROLE_COLORS.border],
    ];
    ctx.font = `600 19px ${MONO}`;
    const gap = 44;
    const widths = items.map(([label]) => 26 + ctx.measureText(label).width);
    let x = W / 2 - (widths.reduce((s, v) => s + v, 0) + gap * (items.length - 1)) / 2;
    ctx.textAlign = 'left';
    items.forEach(([label, color], i) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, top + 82 + dy, 16, 16);
      ctx.fillStyle = SAND;
      ctx.fillText(label, x + 26, top + 97 + dy);
      x += widths[i]! + gap;
    });
  }
  ctx.restore();
}

interface BandColors {
  strong: string;
  muted: string;
  swatches?: string[];
}
const bandColors = (t?: ThemeDefinition): BandColors =>
  t ? { strong: hex(t.text.strong), muted: hex(t.text.muted), swatches: swatchesOf(t).map(hex) } : { strong: CREAM, muted: STONE };

function swatchRow(colors: string[], x: number, y: number, alignRight = false) {
  const step = 28;
  const x0 = alignRight ? x - (colors.length * step - 6) : x;
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x0 + i * step, y, 22, 22);
    ctx.strokeStyle = 'rgba(128,128,128,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + i * step + 0.5, y + 0.5, 21, 21);
  });
  return colors.length * step - 6;
}

/** Scene 3's caption: swatches, family and mode, the theme's name, and the count. */
function themeBand(slot: Slot, alpha: number, t: number) {
  if (alpha <= 0) return;
  const th = slot.theme;
  const c = bandColors(th);
  const enter = slot.frames >= 11 ? easeOut(span(t, slot.t0, slot.t0 + 0.2)) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  const used = swatchRow(c.swatches!, WIN.x, 944);
  ctx.font = `600 17px ${MONO}`;
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'left';
  ctx.fillStyle = c.muted;
  ctx.fillText(`${(th.family ?? th.name).toUpperCase()} · ${th.mode.toUpperCase()}`, WIN.x + used + 18, 961);
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = alpha * (0.4 + 0.6 * enter);
  ctx.font = `800 52px ${SANS}`;
  ctx.fillStyle = c.strong;
  ctx.fillText(th.name, WIN.x, 1032 + (1 - enter) * 10);
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'right';
  ctx.font = `600 30px ${MONO}`;
  ctx.fillStyle = c.muted;
  const of = ` / ${slots.length}`;
  ctx.fillText(of, WIN.x + WIN.w, 1032);
  const ofWidth = ctx.measureText(of).width;
  ctx.font = `800 52px ${MONO}`;
  ctx.fillStyle = c.strong;
  ctx.fillText(String(slot.index + 1), WIN.x + WIN.w - ofWidth, 1032);
  ctx.restore();
}

/** Scene 4's caption: the site on the left, the theme on the right. */
function siteBand(site: SitePlan, item: SiteItem, alpha: number) {
  if (alpha <= 0) return;
  const c = bandColors(item.theme);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  ctx.font = `600 17px ${MONO}`;
  ctx.letterSpacing = '2px';
  ctx.fillStyle = c.muted;
  ctx.fillText(site.name.toUpperCase(), WIN.x, 961);
  ctx.letterSpacing = '0px';
  ctx.font = `800 52px ${SANS}`;
  ctx.fillStyle = c.strong;
  ctx.fillText('Works on any website.', WIN.x, 1032);
  ctx.textAlign = 'right';
  if (item.theme) {
    swatchRow(c.swatches!, WIN.x + WIN.w, 944, true);
    ctx.font = `700 32px ${SANS}`;
    ctx.fillStyle = c.strong;
    ctx.fillText(item.theme.name, WIN.x + WIN.w, 1030);
  } else {
    ctx.font = `600 32px ${SANS}`;
    ctx.fillStyle = c.muted;
    ctx.fillText('Original colors', WIN.x + WIN.w, 1030);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Scene 1: splash

const S = 17; // screen pixels per Inky pixel on the title cards
const INKY_BOTTOM = 575;
const MOUTH = { x: W / 2, y: INKY_BOTTOM - 5 * S };

function splash(t: number) {
  ground(GROUND);
  bubbles(t);
  let bottom = INKY_BOTTOM;
  let squash = 0;
  const look: Look = { eyes: 'open', face: 'calm', arms: 'a' };
  if (t < 0.95) {
    const p = span(t, 0.25, 0.95);
    bottom = lerp(-20, INKY_BOTTOM, p * p);
    look.arms = 'b';
  } else {
    squash = 0.3 * Math.exp(-(t - 0.95) * 8) * Math.cos((t - 0.95) * 24);
    const swing = Math.floor(t / 0.26) % 2 === 1;
    look.arms = swing ? 'b' : 'a';
    if (swing && t > 1.2 && t < 2.35) bottom -= S;
  }
  if (t > 1.9 && t < 2.02) look.eyes = 'shut';
  if (t >= 2.35 && t < 2.85) {
    // Wind-up: crouch and squint.
    squash = 0.2 * easeOut(span(t, 2.35, 2.85));
    look.eyes = 'shut';
  }
  if (t >= 2.85) {
    look.face = 'o';
    look.arms = Math.floor(t / 0.08) % 2 ? 'b' : 'a';
    squash = 0;
    for (const s of SHOTS) {
      const dt = t - (s.t - FLIGHT);
      if (dt >= 0) squash -= 0.13 * Math.exp(-dt * 14);
    }
    squash = Math.max(-0.22, squash);
  }
  if (t >= SHOTS.at(-1)!.t + 0.1) {
    // Pleased with itself.
    look.eyes = 'happy';
    look.face = 'smile';
    if (Math.floor(t / 0.13) % 2) bottom -= S;
  }
  if (t < 0.25) return;
  drawInky(look, W / 2, bottom, S, { squash });
  drawTitle(t, 1.2);
  drawLine('Any website. Any theme.', t, 1.85, 800, `700 40px ${SANS}`, SAND);
}

/** The ink volley: blobs in flight, splats on the "glass", then everything sliding off. */
function introInk(t: number) {
  if (t < SHOTS[0]!.t - FLIGHT || t > SLIDE + 1.6) return;
  SHOTS.forEach((s, i) => {
    const launch = s.t - FLIGHT;
    if (t < launch) return;
    if (t < s.t) {
      const p = span(t, launch, s.t);
      drawBlob(lerp(MOUTH.x, s.x, p), lerp(MOUTH.y, s.y, p) - Math.sin(Math.PI * p) * 60, lerp(8, s.r * 0.55, p * p), s.color);
      return;
    }
    const art = splatArt(`intro-${i}`, () => makeSplat(101 + i * 17, s.r, s.color));
    const pop = span(t, s.t, s.t + 0.16);
    const scale = pop < 0.5 ? lerp(0.55, 1.1, easeOut(pop * 2)) : lerp(1.1, 1, easeInOut((pop - 0.5) * 2));
    const slideAt = SLIDE + hash(i, 99) * 0.35;
    const fall = Math.max(0, t - slideAt);
    drawSplat(art, s.x, s.y + 0.5 * 3000 * fall * fall, t - s.t, scale, 1 + Math.min(0.35, fall * 0.8));
  });
}

function shake(t: number): [number, number] {
  let x = 0;
  let y = 0;
  const hits = [...SHOTS.map((s) => [s.t, 7] as const), [TL.end, 12] as const];
  hits.forEach(([at, amp], i) => {
    const dt = t - at;
    if (dt < 0 || dt > 0.3) return;
    const k = amp * Math.exp(-dt * 22) * Math.cos(dt * 95);
    x += k * (hash(i, 5) * 2 - 1);
    y += k * (hash(i, 6) * 2 - 1);
  });
  return [x, y];
}

// ---------------------------------------------------------------------------------------------
// Scene 2: how it works

const CURSOR_ROWS = [
  'K...........',
  'KK..........',
  'KWK.........',
  'KWWK........',
  'KWWWK.......',
  'KWWWWK......',
  'KWWWWWK.....',
  'KWWWWWWK....',
  'KWWWWWWWK...',
  'KWWWWWWWWK..',
  'KWWWWWWWWWK.',
  'KWWWWWWKKKKK',
  'KWWWKWWK....',
  'KWWK.KWWK...',
  'KWK..KWWK...',
  'KK....KWWK..',
  'K.....KWWK..',
  '.......KK...',
];
let cursorSprite: HTMLCanvasElement;

function drawCursor(t: number) {
  const first = CURSOR[0]!;
  const last = CURSOR.at(-1)!;
  if (t < first[0] || t > last[0]) return;
  let k = 0;
  while (k < CURSOR.length - 2 && t >= CURSOR[k + 1]![0]) k++;
  const a = CURSOR[k]!;
  const b = CURSOR[k + 1]!;
  const p = easeInOut(span(t, a[0], b[0]));
  const x = lerp(a[1], b[1], p);
  const y = lerp(a[2], b[2], p);
  const alpha = lerp(a[3], b[3], p);
  let press = 1;
  for (const c of HOW.clicks) {
    const dt = t - c;
    if (dt >= -0.06 && dt < 0.12) press = 0.86;
    if (dt >= 0 && dt < 0.35) {
      const q = dt / 0.35;
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - q)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, lerp(5, 26, easeOut(q)), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.scale(press, press);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.drawImage(cursorSprite, 0, 0, 12 * 1.6, 18 * 1.6);
  ctx.restore();
}

function popupAt(t: number): string | undefined {
  if (t < HOW.popup || t >= HOW.close + 0.15) return undefined;
  if (t < HOW.list) return 'popup-0';
  if (t < HOW.type) return 'popup-1';
  if (t < HOW.pick) return `popup-type-${Math.min(5, Math.floor((t - HOW.type) / HOW.typeStep) + 1)}`;
  return 'popup-2';
}

function drawPopup(t: number) {
  const name = popupAt(t);
  if (!name) return;
  const appear = easeOut(span(t, HOW.popup, HOW.popup + 0.12)) * (1 - span(t, HOW.close, HOW.close + 0.15));
  const img = shot(name);
  const hImg = popupHeight.get(name) ?? img.naturalHeight;
  const k = img.naturalWidth / POPUP.w;
  const h = hImg / k;
  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(POPUP.x + POPUP.w, POPUP.y);
  ctx.scale(lerp(0.94, 1, appear), lerp(0.94, 1, appear));
  ctx.translate(-POPUP.w, 0);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#282828';
  ctx.beginPath();
  ctx.roundRect(0, 0, POPUP.w, h, 8);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, img.naturalWidth, hImg, 0, 0, POPUP.w, h);
  ctx.restore();
}

/** The labels Jev gave the page, drawn as the scan line passes over them. */
const TAGGED: Array<[LabelBox['role'], string, number, number]> = [
  ['background', 'accent', 1120, 17],
  ['background', 'control', 834, 17],
  ['text', 'accent', 1122, 115],
  ['background', 'selected', 60, 67],
  ['border', 'accent', 372, 151],
  ['background', 'input', 372, 487],
  ['background', 'raised', 372, 550],
  ['text', 'strong', 477, 559],
  ['background', 'success-soft', 1117, 559],
];
const isTagged = (b: LabelBox) => TAGGED.some(([role, token, x, y]) => b.role === role && b.token === token && Math.abs(b.x - x) < 2 && Math.abs(b.y - y) < 2);
const labelTime = (b: LabelBox) => lerp(HOW.scan[0], HOW.scan[1], clamp(b.y / VIEW.h));

function drawLabels(t: number) {
  const out = 1 - span(t, HOW.labelsOut[0], HOW.labelsOut[1]);
  if (t < HOW.scan[0] || out <= 0) return;
  const shown = labels.filter((b) => b.w >= 10 && b.h >= 10 && b.w * b.h < VIEW.w * VIEW.h * 0.5);
  for (const b of shown) {
    const a = span(t, labelTime(b), labelTime(b) + 0.15) * out;
    if (a <= 0) continue;
    const color = ROLE_COLORS[b.role];
    ctx.fillStyle = withAlpha(color, 0.07 * a);
    ctx.fillRect(VIEW.x + b.x, VIEW.y + b.y, b.w, b.h);
    ctx.strokeStyle = withAlpha(color, 0.85 * a);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(VIEW.x + b.x + 0.75, VIEW.y + b.y + 0.75, b.w - 1.5, b.h - 1.5);
  }
  for (const b of shown.filter(isTagged)) {
    const p = span(t, labelTime(b) + 0.08, labelTime(b) + 0.3);
    if (p <= 0) continue;
    ctx.save();
    ctx.globalAlpha = out;
    ctx.font = `700 13px ${MONO}`;
    const w = ctx.measureText(b.token).width + 12;
    const x = VIEW.x + b.x;
    const y = VIEW.y + Math.max(0, b.y - 10);
    ctx.translate(x, y + 9);
    ctx.scale(easeBack(p), easeBack(p));
    ctx.fillStyle = ROLE_COLORS[b.role];
    ctx.beginPath();
    ctx.roundRect(0, -9, w, 19, 4);
    ctx.fill();
    ctx.fillStyle = '#1a1b26';
    ctx.textAlign = 'left';
    ctx.fillText(b.token, 6, 5);
    ctx.restore();
  }
  if (t < HOW.scan[1] + 0.2) {
    const p = span(t, HOW.scan[0], HOW.scan[1]);
    const y = VIEW.y + VIEW.h * p;
    const a = 1 - span(t, HOW.scan[1], HOW.scan[1] + 0.2);
    const glow = ctx.createLinearGradient(0, y - 110, 0, y);
    glow.addColorStop(0, 'rgba(125,207,255,0)');
    glow.addColorStop(1, `rgba(125,207,255,${0.22 * a})`);
    ctx.fillStyle = glow;
    ctx.fillRect(VIEW.x, y - 110, VIEW.w, 110);
    ctx.fillStyle = `rgba(160,220,255,${a})`;
    ctx.fillRect(VIEW.x, y - 1.5, VIEW.w, 3);
  }
}

function how(t: number) {
  const k = easeInOut(span(t, HOW.zoomIn[0], HOW.zoomIn[1])) * (1 - easeInOut(span(t, HOW.zoomOut[0], HOW.zoomOut[1])));
  ground(GROUND);
  ctx.save();
  ctx.translate(W / 2, lerp(H / 2, 470, k));
  ctx.scale(lerp(1, 1.55, k), lerp(1, 1.55, k));
  ctx.translate(-lerp(W / 2, 1330, k), -lerp(H / 2, 300, k));
  const pressed = Math.max(0, 1 - Math.abs(t - HOW.clicks[0]! - 0.05) / 0.12);
  drawWindow(
    HERO_TAB(),
    () => {
      dissolve('hero-original', 'hero-tokyo-night', span(t, HOW.paint[0], HOW.paint[1]), 'sweep', 7, '#7aa2f7');
      drawLabels(t);
    },
    { iconDown: t > HOW.popup && t < HOW.close ? 0.6 : pressed },
  );
  drawPopup(t);
  drawCursor(t);
  ctx.restore();
  caption('Open any website.', t, HOW.cap1);
  caption('Click Inky and pick a theme.', t, HOW.cap2);
  caption('Jev reads the page and labels every element.', t, HOW.cap3, true);
  caption('Your theme gives every label its color.', t, HOW.cap4);
}

// ---------------------------------------------------------------------------------------------
// Scene 3: every theme, faster and faster

function slotAt(t: number): number {
  let i = 0;
  while (i < slots.length - 1 && t >= slots[i]!.t1) i++;
  return i;
}

const heroShot = (s: Slot) => `hero-${s.theme.id}`;

/** How far the switch into slot i has come: dissolves for slow switches, cuts for fast ones. */
function switchProgress(i: number, t: number): number {
  const s = slots[i]!;
  if (i === 0 || s.frames < 11) return 1;
  return easeInOut(span(t, s.t0, s.t0 + Math.min(0.3, (s.frames / FPS) * 0.4)));
}

function cycle(t: number) {
  const i = slotAt(t);
  const s = slots[i]!;
  const prev = slots[Math.max(0, i - 1)]!;
  const p = switchProgress(i, t);
  const backdrop = i === 0 ? mix(GROUND, s.theme.background.page, span(t, TL.cycle, TL.cycle + 0.4)) : mix(prev.theme.background.page, s.theme.background.page, p);
  ground(backdrop);
  // A slow push in while it speeds up; eases back out for the punch.
  const z = 1 + 0.035 * easeIn(span(t, TL.cycle, TL.punch)) * (1 - easeOut(span(t, TL.punch, TL.punch + 0.5)));
  ctx.save();
  ctx.translate(W / 2, 475);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -475);
  drawWindow(HERO_TAB(), () => dissolve(heroShot(prev), heroShot(s), p, 'diagonal', i), { backdrop });
  ctx.restore();
  const bandIn = span(t, TL.cycle, TL.cycle + 0.35);
  const bandOut = 1 - span(t, TL.sites - 0.15, TL.sites + 0.15);
  themeBand(s, bandIn * bandOut, t);
  punch(t);
}

const CONFETTI_COLORS = BUILTIN_THEMES.map((t) => hex(t.background.accent));

function punch(t: number) {
  if (t < TL.punch) return;
  const s = slots.at(-1)!;
  const out = 1 - span(t, TL.sites - 0.35, TL.sites);
  if (out <= 0) return;
  const accent = hex(s.theme.background.accent);
  ctx.save();
  ctx.globalAlpha = out;
  ctx.fillStyle = `rgba(0,0,0,${0.55 * easeOut(span(t, TL.punch, TL.punch + 0.25))})`;
  ctx.beginPath();
  ctx.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, 12);
  ctx.fill();
  const age = t - TL.punch;
  for (let i = 0; i < 70; i++) {
    const a = hash(i, 11) * Math.PI * 2;
    const v = 500 + hash(i, 12) * 700;
    const x = W / 2 + Math.cos(a) * v * age;
    const y = 470 + Math.sin(a) * v * age + 0.5 * 1500 * age * age;
    const size = [10, 14, 18][Math.floor(hash(i, 13) * 3)]!;
    ctx.globalAlpha = out * (1 - span(age, 1.1, 1.6));
    ctx.fillStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, size, size);
  }
  ctx.globalAlpha = out;
  const p = span(t, TL.punch, TL.punch + 0.45);
  ctx.save();
  ctx.translate(W / 2, 480);
  const k = lerp(1.7, 1, easeBack(p));
  ctx.scale(k, k);
  ctx.globalAlpha = out * clamp(p * 3);
  pixelText(`${slots.length} THEMES`, 0, 40, 160, accent, '#000000');
  ctx.restore();
  ctx.globalAlpha = out;
  drawLine('Built in. Or make your own.', t, TL.punch + 0.35, 600, `700 44px ${SANS}`, '#ffffff');
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Scene 4: other sites

function siteAt(t: number): number {
  let k = 0;
  while (k < sitePlan.length - 1 && t >= sitePlan[k]!.t1) k++;
  return k;
}
function itemAt(site: SitePlan, t: number): number {
  let i = 0;
  while (i < site.items.length - 1 && t >= site.items[i]!.t1) i++;
  return i;
}

function siteContent(site: SitePlan, t: number, k: number) {
  const i = itemAt(site, t);
  const item = site.items[i]!;
  if (i === 0) return drawPage(item.img);
  dissolve(site.items[i - 1]!.img, item.img, easeInOut(span(t, item.t0, item.t0 + 0.28)), 'random', 40 + k * 5 + i);
}

const pageOf = (item: SiteItem) => (item.theme ? item.theme.background.page : GROUND);

function sites(t: number) {
  const k = siteAt(t);
  const site = sitePlan[k]!;
  const i = itemAt(site, t);
  const item = site.items[i]!;
  const push = easeInOut(span(t, site.t0, site.t0 + PUSH));
  const before: { page: string; draw: () => void; tab: Tab } =
    k === 0
      ? { page: slots.at(-1)!.theme.background.page, draw: () => drawPage(heroShot(slots.at(-1)!)), tab: HERO_TAB() }
      : (() => {
          const prev = sitePlan[k - 1]!;
          const last = prev.items.at(-1)!;
          return { page: pageOf(last), draw: () => drawPage(last.img), tab: { title: prev.title, url: prev.url, icon: prev.icon } };
        })();
  const itemP = i === 0 ? 1 : easeInOut(span(t, item.t0, item.t0 + 0.28));
  const current = mix(pageOf(site.items[Math.max(0, i - 1)]!), pageOf(item), itemP);
  const backdrop = push < 1 ? mix(before.page, current, push) : current;
  ground(backdrop);
  const tab = push < 0.5 ? before.tab : { title: site.title, url: site.url, icon: site.icon };
  drawWindow(
    tab,
    () => {
      if (push < 1) {
        ctx.save();
        ctx.translate(-VIEW.w * push, 0);
        before.draw();
        ctx.restore();
        ctx.save();
        ctx.translate(VIEW.w * (1 - push), 0);
        siteContent(site, t, k);
        ctx.restore();
      } else siteContent(site, t, k);
    },
    { backdrop },
  );
  if (k === 0 && push < 1) {
    // The punch caption hands over to this scene's caption.
    themeBand(slots.at(-1)!, 1 - span(t, TL.sites - 0.15, TL.sites + 0.15), t);
  }
  siteBand(site, item, span(t, TL.sites, TL.sites + 0.3));
}

// ---------------------------------------------------------------------------------------------
// Scene 5: the end card

const INK_OVERLAY = ['......IIII......', '....IIJJIIII....', '...IIJIIIIIII...', '..IIIIIIIIIIII..', '...I.III..III...'];
const INK_DRIPS = [
  { col: 3, len: 4, at: 0.0 },
  { col: 7, len: 2, at: 0.15 },
  { col: 11, len: 3, at: 0.3 },
];
let inkOverlay: HTMLCanvasElement;

function finale(t: number) {
  const E0 = TL.end;
  // Inky peeks up over the last site and fires one more blob, straight at the camera.
  if (t >= E0 - PEEK && t < E0 + 0.05) {
    const scale = 13;
    const rise = easeOut(span(t, E0 - PEEK, E0 - PEEK + 0.3));
    const sink = easeIn(span(t, E0 - 0.2, E0 + 0.05));
    const bottom = lerp(H + 14 * scale + 10, H + 60, rise) + sink * 200;
    const firing = t >= E0 - 0.35;
    const look: Look = { eyes: t > E0 - 0.55 && t < E0 - 0.45 ? 'shut' : 'open', face: firing ? 'o' : 'smile', arms: Math.floor(t / 0.2) % 2 ? 'b' : 'a' };
    const squash = firing ? -0.14 * Math.exp(-(t - (E0 - 0.3)) * 10) : 0;
    drawInky(look, W / 2, bottom, scale, { squash });
    if (t >= E0 - 0.3) {
      const p = span(t, E0 - 0.3, E0);
      drawBlob(W / 2, lerp(bottom - 5 * scale, 500, p), lerp(10, 170, p * p), PLUM);
    }
  }
  if (t >= E0 && t < TL.card + 0.1) {
    // It splats, then floods the screen: a plum wave with dark ink right behind it.
    const plum = splatArt('end-plum', () => makeSplat(907, 170, PLUM));
    const dark = splatArt('end-dark', () => makeSplat(911, 170, GROUND));
    drawSplat(plum, W / 2, 500, 0, lerp(1, 13, easeIn(span(t, E0, E0 + 0.55))));
    const k = span(t, E0 + 0.08, E0 + 0.63);
    if (k > 0) drawSplat(dark, W / 2, 500, 0, lerp(0.3, 13, easeIn(k)));
  }
  if (t >= TL.card) endCard(t - TL.card, t);
}

function endCard(u: number, t: number) {
  ground(GROUND);
  bubbles(t);
  const hic = CARD.hic;
  let bottom = INKY_BOTTOM;
  let squash = 0;
  let dx = 0;
  let rot = 0;
  const look: Look = { eyes: 'open', face: 'smile', arms: Math.floor(u / 0.26) % 2 ? 'b' : 'a', palette: 'inky' };

  // Pops up from below.
  if (u < 0.6) bottom = lerp(H + 14 * S + 20, INKY_BOTTOM, easeBack(span(u, 0.05, 0.6)));
  if (u > 0.9 && u < 1.02) look.eyes = 'shut';

  // Tries on themes: a hop, a new color on every landing.
  CARD.hops.forEach((h, k) => {
    const p = span(u, h, h + CARD.hop);
    if (p > 0 && p < 1) {
      bottom -= Math.sin(Math.PI * p) * 90;
      squash = -0.1 * Math.sin(Math.PI * p);
      look.arms = 'b';
    }
    const landed = u - (h + CARD.hop);
    if (landed >= 0) {
      look.palette = HOP_LOOKS[k];
      if (landed < 0.4) squash += 0.22 * Math.exp(-landed * 12) * Math.cos(landed * 30);
    }
    if (u > h - 0.08 && u < h) squash = 0.12;
  });

  // Hiccup: a jolt, a "hic!", and a little bubble of ink that pops out, floats up, and falls
  // right back on Inky's head.
  const jolt = span(u, hic, hic + 0.14);
  if (jolt > 0 && jolt < 1) {
    bottom -= Math.sin(Math.PI * jolt) * 3 * S;
    squash = -0.12 * Math.sin(Math.PI * jolt);
  }
  if (u >= hic && u < hic + 0.8) {
    look.wide = true;
    look.eyes = 'open';
    look.face = u < hic + 0.3 ? 'o' : 'calm';
  }
  const plop = hic + 0.85;
  const inked = u >= plop && u < hic + 1.8;
  if (u >= plop && u < hic + 1.65) {
    look.face = 'calm';
    look.eyes = u < plop + 0.15 || (u > plop + 0.55 && u < plop + 0.65) ? 'shut' : 'open';
    const d = u - plop;
    if (d < 0.4) squash += 0.2 * Math.exp(-d * 12) * Math.cos(d * 30);
  }
  // Shakes it off.
  const shakeP = span(u, hic + 1.65, hic + 2.1);
  if (shakeP > 0 && shakeP < 1) {
    dx = Math.sin((u - hic - 1.65) * 70) * 2 * S * (1 - shakeP * 0.4);
    rot = Math.sin((u - hic - 1.65) * 70) * 0.06;
    look.eyes = 'shut';
    look.face = 'calm';
  }
  // Then a blush, a wink, and a heart.
  const love = hic + 2.15;
  if (u >= love) {
    look.face = 'blush';
    look.eyes = u < love + 1.6 ? 'wink' : 'happy';
  }

  const top = bottom - 14 * S;
  drawInky(look, W / 2 + dx, bottom, S, {
    squash,
    rot,
    extra: inked
      ? () => {
          ctx.drawImage(inkOverlay, 0, -1);
          ctx.fillStyle = '#3c3836';
          for (const d of INK_DRIPS) {
            const len = Math.round(d.len * easeOut(span(u, plop + d.at, plop + d.at + 0.5)));
            if (len > 0) ctx.fillRect(d.col, 4, 1, len);
          }
        }
      : undefined,
  });

  // Landing sparkles and the name of the theme Inky just put on.
  CARD.hops.forEach((h, k) => {
    const landed = u - (h + CARD.hop);
    if (landed < 0 || landed > 0.5) return;
    const color = PALETTES[HOP_LOOKS[k]!]!.B!;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + k;
      const r = 150 + easeOut(landed / 0.5) * 90;
      const x = W / 2 + Math.cos(a) * r * 1.15;
      const y = INKY_BOTTOM - 7 * S + Math.sin(a) * r * 0.8;
      ctx.globalAlpha = 1 - landed / 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x) - 3, Math.round(y) - 9, 6, 18);
      ctx.fillRect(Math.round(x) - 9, Math.round(y) - 3, 18, 6);
    }
    ctx.globalAlpha = 1;
    ctx.font = `700 26px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, landed * 8) * (1 - span(landed, 0.35, 0.5));
    ctx.fillStyle = color;
    ctx.fillText(HOP_NAMES[k]!, W / 2, INKY_BOTTOM - 14 * S - 40);
    ctx.globalAlpha = 1;
  });

  // "hic!" and the ink bubble's flight.
  if (u >= hic && u < hic + 0.9) {
    const p = span(u, hic, hic + 0.15);
    ctx.save();
    ctx.globalAlpha = 1 - span(u, hic + 0.6, hic + 0.9);
    ctx.translate(W / 2 + 230, top + 70);
    ctx.rotate(-0.12);
    ctx.scale(easeBack(p), easeBack(p));
    pixelText('hic!', 0, 0, 48, CREAM, PLUM);
    ctx.restore();
  }
  if (u >= hic + 0.05 && u < plop) {
    const mouth = { x: W / 2, y: INKY_BOTTOM - 5 * S };
    const up = easeOut(span(u, hic + 0.05, hic + 0.6));
    const down = easeIn(span(u, hic + 0.7, plop));
    const x = lerp(mouth.x, W / 2 + 30, up) + Math.sin(u * 14) * 10 * (1 - down) - down * 30;
    const y = lerp(lerp(mouth.y, top - 120, up), top + 6, down);
    drawBlob(x, y, 26, '#3c3836');
  }
  // Ink flicked off by the shake.
  if (u >= hic + 1.75 && u < hic + 2.6) {
    const age = u - (hic + 1.75);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (1.05 + (i / 8) * 0.9);
      const v = 520 + hash(i, 21) * 380;
      const x = W / 2 + Math.cos(a) * v * age;
      const y = top + 40 + Math.sin(a) * v * age + 0.5 * 2200 * age * age;
      ctx.globalAlpha = 1 - span(age, 0.5, 0.85);
      ctx.fillStyle = '#3c3836';
      ctx.fillRect(Math.round(x / S) * S, Math.round(y / S) * S, S, S);
    }
    ctx.globalAlpha = 1;
  }
  // Hearts.
  [
    [0, 60, 9],
    [0.3, -70, 6],
  ].forEach(([delay, ox, scale]) => {
    const p = span(u, love + delay!, love + delay! + 1.3);
    if (p <= 0 || p >= 1) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1 - span(p, 0.6, 1);
    const x = W / 2 + ox! - 2.5 * scale!;
    const y = top - 20 - easeOut(p) * 150;
    const heart = heartSprite;
    ctx.translate(x, y);
    const pop = easeBack(span(p, 0, 0.15));
    ctx.scale(pop, pop);
    ctx.drawImage(heart, 0, 0, 5 * scale!, 4 * scale!);
    ctx.restore();
  });

  drawTitle(u, 0.5);
  drawLine('75 themes. Every website.', u, 0.95, 800, `700 40px ${SANS}`, SAND);
  ctx.save();
  ctx.letterSpacing = '2px';
  drawLine('CHROME EXTENSION  ·  POWERED BY JEV FROM TYPESAFE AI', u, love + 0.25, 1000, `600 22px ${MONO}`, SAND);
  ctx.restore();

  const fade = span(u, CARD.length - 0.55, CARD.length);
  if (fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${fade})`;
    ctx.fillRect(-40, -40, W + 80, H + 80);
  }
}
let heartSprite: HTMLCanvasElement;

// ---------------------------------------------------------------------------------------------
// The frame

export function renderFrame(t: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const [sx, sy] = shake(t);
  ctx.translate(sx, sy);
  if (t >= HOW.start && t < TL.cycle) how(t);
  else if (t >= TL.cycle && t < TL.sites) cycle(t);
  else if (t >= TL.sites && t < TL.card) sites(t);
  if (t < HOW.start + 0.5) {
    ctx.save();
    ctx.globalAlpha = 1 - span(t, HOW.start, HOW.start + 0.5);
    splash(t);
    ctx.restore();
  }
  introInk(t);
  finale(t);
  ctx.restore();
  if (t < 0.3) {
    ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.3})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------------------------------------------------------------------------------------------
// The soundtrack: a little chiptune plus sound effects, synthesized offline on the same timeline.

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** C, Am, F, G: one chord per bar, as MIDI notes. */
const PROGRESSION = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
];
/** Four bars of melody over the progression: [bar, beat, note, beats]. */
const MELODY: Array<[number, number, number, number]> = [
  [0, 0, 79, 1], [0, 1, 76, 0.5], [0, 1.5, 79, 0.5], [0, 2, 84, 1], [0, 3, 83, 0.5], [0, 3.5, 81, 0.5],
  [1, 0, 81, 1.5], [1, 1.5, 79, 0.5], [1, 2, 76, 1], [1, 3, 72, 1],
  [2, 0, 77, 0.5], [2, 0.5, 81, 0.5], [2, 1, 84, 0.5], [2, 1.5, 81, 0.5], [2, 2, 79, 1], [2, 3, 77, 1],
  [3, 0, 74, 0.5], [3, 0.5, 76, 0.5], [3, 1, 77, 0.5], [3, 1.5, 79, 0.5], [3, 2, 83, 1], [3, 3, 79, 1],
];

export async function renderAudio(): Promise<string> {
  const rate = 44100;
  const audio = new OfflineAudioContext(2, Math.ceil(TL.total * rate), rate);
  const master = audio.createGain();
  master.gain.value = 0.85;
  const comp = audio.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.12;
  master.connect(comp).connect(audio.destination);
  const music = audio.createGain();
  music.gain.value = 0.6;
  music.connect(master);
  const fx = audio.createGain();
  fx.gain.value = 0.9;
  fx.connect(master);
  // The very end fades out.
  master.gain.setValueAtTime(0.85, TL.total - 0.8);
  master.gain.linearRampToValueAtTime(0, TL.total);

  const pulse = (duty: number) => {
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return audio.createPeriodicWave(real, imag);
  };
  const square = pulse(0.5);
  const thin = pulse(0.125);
  const quarter = pulse(0.25);
  const rnd = random(4242);
  const noiseBuffer = audio.createBuffer(1, rate * 2, rate);
  noiseBuffer.getChannelData(0).forEach((_, i, data) => (data[i] = rnd() * 2 - 1));

  type Wave = PeriodicWave | OscillatorType;
  const tone = (
    dest: AudioNode,
    at: number,
    dur: number,
    freq: number,
    opts: { wave?: Wave; gain?: number; to?: number; attack?: number; pan?: number; decay?: boolean } = {},
  ) => {
    if (at < 0 || at >= TL.total) return;
    const osc = audio.createOscillator();
    const wave = opts.wave ?? square;
    if (wave instanceof PeriodicWave) osc.setPeriodicWave(wave);
    else osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, at + dur);
    const g = audio.createGain();
    const peak = opts.gain ?? 0.1;
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    if (opts.decay) g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    else {
      g.gain.setValueAtTime(peak, at + Math.max(attack, dur - 0.03));
      g.gain.linearRampToValueAtTime(0, at + dur);
    }
    let out: AudioNode = g;
    if (opts.pan) {
      const pan = audio.createStereoPanner();
      pan.pan.value = opts.pan;
      g.connect(pan);
      out = pan;
    }
    osc.connect(g);
    out.connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  };
  const noise = (
    dest: AudioNode,
    at: number,
    dur: number,
    opts: { gain?: number; type?: BiquadFilterType; freq?: number; to?: number; q?: number; attack?: number } = {},
  ) => {
    if (at < 0 || at >= TL.total) return;
    const src = audio.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = opts.type ?? 'highpass';
    filter.frequency.setValueAtTime(opts.freq ?? 6000, at);
    if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, at + dur);
    filter.Q.value = opts.q ?? 0.7;
    const g = audio.createGain();
    const attack = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(at, rnd() * 1.5);
    src.stop(at + dur + 0.02);
  };

  // Drums.
  const kick = (at: number, gain = 0.8) => tone(music, at, 0.2, 150, { wave: 'sine', to: 42, gain, decay: true });
  const snare = (at: number, gain = 0.3) => {
    noise(music, at, 0.14, { type: 'bandpass', freq: 1900, q: 0.8, gain });
    tone(music, at, 0.08, 200, { wave: 'triangle', gain: gain * 0.6, decay: true });
  };
  const hat = (at: number, gain = 0.07) => noise(music, at, 0.045, { type: 'highpass', freq: 7500, gain });
  const crash = (at: number) => noise(music, at, 1.6, { type: 'highpass', freq: 4200, gain: 0.28 });

  /** The groove between t0 and t1, on the 16th-note grid counted from `origin`. */
  const groove = (t0: number, t1: number, parts: { bass?: number; arp?: number; hat?: boolean; drums?: boolean; melody?: number }, origin = 0) => {
    const step = BAR / 16;
    for (let s = Math.ceil((t0 - origin) / step); origin + s * step < t1; s++) {
      const at = origin + s * step;
      const bar = Math.floor(s / 16);
      const chord = PROGRESSION[((bar % 4) + 4) % 4]!;
      const in16 = ((s % 16) + 16) % 16;
      if (parts.bass && in16 % 2 === 0) {
        const root = chord[0]! - 24;
        tone(music, at, 0.2, midi(in16 % 4 === 0 ? root : root + 12), { wave: 'triangle', gain: parts.bass });
      }
      if (parts.arp) {
        const notes = [chord[0]! + 12, chord[1]! + 12, chord[2]! + 12, chord[0]! + 24];
        tone(music, at, 0.11, midi(notes[in16 % 4]!), { wave: thin, gain: parts.arp, pan: in16 % 2 ? 0.35 : -0.35 });
      }
      if (parts.hat && in16 % 4 === 2) hat(at);
      if (parts.drums) {
        if (in16 % 4 === 0) kick(at);
        if (in16 % 8 === 4) snare(at);
        if (in16 % 2 === 1) hat(at, 0.035);
      }
      if (parts.melody && in16 === 0) {
        for (const [b, beat, note, beats] of MELODY) {
          if (b !== ((bar % 4) + 4) % 4) continue;
          const nt = at + beat * (BAR / 4);
          if (nt >= t0 && nt < t1) tone(music, nt, beats * (BAR / 4) * 0.9, midi(note), { wave: quarter, gain: parts.melody, pan: 0.1 });
        }
      }
    }
  };

  // --- Scene 1: sparkle arpeggio, a thump when Inky lands, a charge-up, and the volley.
  for (let s = 0; s < 20; s++) tone(music, 0.3 + s * 0.125, 0.11, midi([72, 76, 79, 83][s % 4]! + (s >= 8 ? 12 : 0)), { wave: thin, gain: 0.05, pan: s % 2 ? 0.3 : -0.3 });
  tone(fx, 0.95, 0.22, 170, { wave: 'sine', to: 55, gain: 0.7, decay: true });
  noise(fx, 0.95, 0.12, { type: 'lowpass', freq: 800, gain: 0.25 });
  tone(music, 0.95, 1.4, midi(36), { wave: 'triangle', gain: 0.25, decay: true });
  [...TITLE].forEach((ch, i) => ch !== ' ' && tone(fx, 1.2 + i * 0.035 + 0.25, 0.03, 1760, { wave: square, gain: 0.025 }));
  tone(fx, 2.35, 0.5, 180, { wave: quarter, to: 900, gain: 0.07 });
  for (const s of SHOTS) {
    tone(fx, s.t - FLIGHT, 0.17, 1500, { wave: square, to: 260, gain: 0.08 });
    noise(fx, s.t, 0.26, { type: 'lowpass', freq: 1400, to: 180, gain: 0.5 });
    tone(fx, s.t, 0.12, 110, { wave: 'sine', to: 45, gain: 0.45, decay: true });
  }
  groove(2.85, 4.4, { bass: 0.16 });
  noise(fx, SLIDE, 0.9, { type: 'bandpass', freq: 2500, to: 300, q: 1.2, gain: 0.18, attack: 0.25 });

  // --- Scene 2: a mellow groove under clicks, typing, the scan, and the paint.
  groove(4.4, TL.cycle, { bass: 0.2, arp: 0.045, hat: true });
  for (const c of HOW.clicks) {
    noise(fx, c, 0.03, { type: 'highpass', freq: 2500, gain: 0.35 });
    tone(fx, c, 0.025, 1300, { wave: 'sine', gain: 0.12 });
  }
  tone(fx, HOW.popup, 0.07, 520, { wave: 'sine', to: 980, gain: 0.14 });
  for (let k = 0; k < 5; k++) noise(fx, HOW.type + k * HOW.typeStep, 0.035, { type: 'bandpass', freq: 2800 + k * 150, q: 1.2, gain: 0.3 });
  tone(fx, HOW.pick, 0.06, 880, { wave: thin, gain: 0.08 });
  tone(fx, HOW.pick + 0.07, 0.1, 1320, { wave: thin, gain: 0.08 });
  tone(fx, HOW.close, 0.07, 900, { wave: 'sine', to: 480, gain: 0.1 });
  tone(fx, HOW.scan[0], HOW.scan[1] - HOW.scan[0], 320, { wave: 'sine', to: 1250, gain: 0.05, attack: 0.2 });
  labels.filter(isTagged).forEach((b, i) => tone(fx, labelTime(b) + 0.08, 0.06, midi(84 + [0, 4, 7, 12][i % 4]!), { wave: thin, gain: 0.05 }));
  noise(fx, HOW.paint[0], HOW.paint[1] - HOW.paint[0] + 0.3, { type: 'bandpass', freq: 400, to: 5000, q: 1, gain: 0.16, attack: 0.3 });

  // --- Scene 3: drums and melody; a blip per theme that climbs as it speeds up; a riser and a
  // snare roll into the punch.
  groove(TL.cycle, TL.punch, { bass: 0.22, arp: 0.04, drums: true, melody: 0.055 });
  slots.forEach((s, i) => {
    if (i === 0 || i === slots.length - 1) return;
    tone(fx, s.t0, Math.min(0.06, (s.frames / FPS) * 0.8), 520 * 2 ** (i / 36), { wave: quarter, gain: 0.05 });
  });
  noise(fx, TL.punch - 6, 6, { type: 'bandpass', freq: 300, to: 6000, q: 1.5, gain: 0.14, attack: 5.5 });
  for (let at = TL.punch - 2; at < TL.punch; ) {
    const late = at >= TL.punch - 1;
    snare(at, late ? 0.28 : 0.2);
    at += late ? BAR / 32 : BAR / 16;
  }
  kick(TL.punch, 1);
  crash(TL.punch);
  for (const note of [60, 64, 67, 72]) tone(music, TL.punch, 1.4, midi(note), { wave: quarter, gain: 0.07, decay: true });
  tone(music, TL.punch, 1.9, midi(36), { wave: 'triangle', gain: 0.3, decay: true });
  groove(TL.punch + 0.02, TL.sites, { arp: 0.035 });

  // --- Scene 4: the full groove; a swoosh per site and a blip per theme.
  groove(TL.sites, TL.end - 0.35, { bass: 0.22, arp: 0.04, drums: true, melody: 0.055 });
  sitePlan.forEach((site) => {
    noise(fx, site.t0, 0.4, { type: 'bandpass', freq: 700, to: 3500, q: 1.1, gain: 0.16, attack: 0.15 });
    site.items.slice(1).forEach((item, j) => tone(fx, item.t0, 0.06, midi(79 + [0, 4, 7][j % 3]!), { wave: quarter, gain: 0.05 }));
  });

  // --- Scene 5: one last shot, a flood, then a cute outro.
  tone(fx, TL.end - 0.3, 0.2, 1400, { wave: square, to: 200, gain: 0.09 });
  noise(fx, TL.end, 0.5, { type: 'lowpass', freq: 1200, to: 120, gain: 0.6 });
  tone(fx, TL.end, 0.3, 90, { wave: 'sine', to: 35, gain: 0.6, decay: true });
  noise(fx, TL.end + 0.05, 0.7, { type: 'bandpass', freq: 3000, to: 250, q: 0.9, gain: 0.2, attack: 0.1 });
  const c = TL.card;
  groove(c + 0.1, c + CARD.hic + 2.1, { bass: 0.14, arp: 0.035, hat: true }, c + 0.1);
  tone(fx, c + 0.1, 0.28, 220, { wave: 'triangle', to: 660, gain: 0.18 });
  CARD.hops.forEach((h, k) => {
    tone(fx, c + h, 0.2, 280, { wave: 'triangle', to: 760, gain: 0.16 });
    tone(fx, c + h + CARD.hop, 0.1, 160, { wave: 'sine', to: 70, gain: 0.35, decay: true });
    [0, 4, 7].forEach((n, j) => tone(fx, c + h + CARD.hop + j * 0.045, 0.07, midi(84 + k * 2 + n), { wave: thin, gain: 0.05 }));
  });
  const hic = c + CARD.hic;
  tone(fx, hic, 0.08, 480, { wave: square, to: 1100, gain: 0.1 });
  noise(fx, hic + 0.02, 0.06, { type: 'bandpass', freq: 3500, gain: 0.15 });
  tone(fx, hic + 0.06, 0.4, 600, { wave: 'sine', to: 900, gain: 0.05 });
  tone(fx, hic + 0.85, 0.12, 900, { wave: 'sine', to: 180, gain: 0.25 });
  noise(fx, hic + 0.85, 0.15, { type: 'lowpass', freq: 900, gain: 0.25 });
  for (let k = 0; k < 7; k++) noise(fx, hic + 1.65 + k * 0.065, 0.05, { type: 'bandpass', freq: 2200 + (k % 2) * 500, q: 2, gain: 0.2 });
  const love = c + CARD.hic + 2.15;
  tone(fx, love, 1.2, midi(88), { wave: 'sine', gain: 0.12, decay: true });
  tone(fx, love + 0.12, 1.3, midi(95), { wave: 'sine', gain: 0.1, decay: true });
  [72, 76, 79, 84].forEach((n, j) => tone(music, love + 0.25 + j * 0.08, 2.6 - j * 0.08, midi(n), { wave: thin, gain: 0.06, decay: true }));
  [48, 55, 64].forEach((n) => tone(music, love + 0.25, 2.8, midi(n), { wave: 'triangle', gain: 0.12, decay: true }));

  const rendered = await audio.startRendering();
  return encodeWav(rendered);
}

function encodeWav(buffer: AudioBuffer): string {
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const frames = buffer.length;
  const bytes = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(bytes);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    v.setInt16(44 + i * 4, clamp(channels[0]![i]!, -1, 1) * 32767, true);
    v.setInt16(46 + i * 4, clamp(channels[1]![i]!, -1, 1) * 32767, true);
  }
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------------------------
// Setup

async function loadImage(name: string) {
  const img = new Image();
  img.src = `capture/${name}.png`;
  await img.decode();
  shots.set(name, img);
}

/** Where a popup capture's content ends: the last row that isn't plain popup background. */
function contentHeight(img: HTMLImageElement): number {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const at = (x: number, y: number) => (y * c.width + x) * 4;
  const bg = at(4, c.height - 4);
  for (let y = c.height - 1; y > 0; y--) {
    for (let x = 0; x < c.width; x += 2) {
      const i = at(x, y);
      if (Math.abs(data[i]! - data[bg]!) + Math.abs(data[i + 1]! - data[bg + 1]!) + Math.abs(data[i + 2]! - data[bg + 2]!) > 24) {
        return Math.min(c.height, y + 30);
      }
    }
  }
  return c.height;
}

export async function init() {
  const canvas = document.querySelector('canvas')!;
  ctx = canvas.getContext('2d')!;
  manifest = await (await fetch('capture/manifest.json')).json();
  labels = await (await fetch('capture/hero-labels.json')).json();
  const fonts = [`700 104px ${PIXEL}`, `800 46px ${SANS}`, `700 40px ${SANS}`, `500 13px ${SANS}`, `600 17px ${MONO}`, `800 52px ${MONO}`];
  await Promise.all(fonts.map((f) => document.fonts.load(f)));
  for (const f of ['700 20px Silkscreen', '800 20px Figtree', '600 20px "JetBrains Mono"']) {
    if (!document.fonts.check(f)) throw new Error(`Font did not load: ${f}`);
  }
  plan();
  const popups = ['popup-0', 'popup-1', 'popup-2', ...[1, 2, 3, 4, 5].map((k) => `popup-type-${k}`)];
  const names = [
    'hero-original',
    ...manifest.cycle.map((c) => `hero-${c.id}`),
    ...popups,
    ...manifest.sites.flatMap((s) => [`${s.id}-original`, ...s.themes.map((t) => `${s.id}-${t.id}`)]),
  ];
  await Promise.all(names.map(loadImage));
  for (const p of popups) popupHeight.set(p, contentHeight(shot(p)));
  cursorSprite = paintRows(CURSOR_ROWS, { K: '#111111', W: '#ffffff' });
  inkOverlay = paintRows(INK_OVERLAY, { I: '#3c3836', J: '#928374' });
  heartSprite = paintRows(HEART, {});
  return { duration: TL.total, frames: Math.ceil(TL.total * FPS), fps: FPS, timeline: { ...TL } };
}

/** One frame as a base64 JPEG, for the encoder. */
export function frame(i: number): string {
  renderFrame(i / FPS);
  return ctx.canvas.toDataURL('image/jpeg', 0.95).slice('data:image/jpeg;base64,'.length);
}

/** One moment as a base64 PNG, for checking stills. */
export function still(t: number): string {
  renderFrame(t);
  return ctx.canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}
