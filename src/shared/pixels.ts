// What an image looks like, in words for Jev, from a small square sample of its pixels. The
// content script samples the images it may read; the background samples other sites' images,
// which only it may read. Both describe them here, so the same image gets the same words.

import { nameColor, toOklch, type RGBA } from './color.ts';

/** Images are sampled at this size (a square, in pixels). */
export const SAMPLE = 24;

export type Paper = 'light' | 'dark';

export interface PixelInfo {
  /** "mostly white (70%), with near-black, strong blue; fills its whole box; flat areas of solid color" */
  words: string;
  /** A short summary for the label cache: copies that look alike share Jev's answer. */
  sig: string;
  /** The paper it was drawn for: its own background if opaque, else what suits its ink. */
  paper: Paper | undefined;
  /** It covers its whole box. */
  opaque: boolean;
}

/** Describes a SAMPLE × SAMPLE RGBA sample. */
export function describePixels(data: ArrayLike<number>): PixelInfo {
  const inks: RGBA[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! > 128) inks.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: 1 });
  }
  const coverage = inks.length / (SAMPLE * SAMPLE);
  if (!inks.length) return { words: 'nothing drawn (fully transparent)', sig: 'empty', paper: undefined, opaque: false };
  const counts = new Map<string, { n: number; color: RGBA }>();
  for (const c of inks) {
    const name = nameColor(c);
    const hit = counts.get(name);
    if (hit) hit.n++;
    else counts.set(name, { n: 1, color: c });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const main = ranked.filter(([, v]) => v.n / inks.length >= 0.08);
  const opaque = coverage > 0.9;
  const surface = opaque ? 'fills its whole box' : `about ${Math.round(coverage * 100)}% of the box is drawn, the rest is transparent`;
  let colors: string;
  if (main.length <= 1) colors = `a single ${ranked[0]![0]} color`;
  else {
    const [first, ...rest] = main;
    colors = `mostly ${first![0]} (${Math.round((first![1].n / inks.length) * 100)}%), with ${rest.slice(0, 4).map(([name]) => name).join(', ')}`;
  }
  // Opaque: the dominant color is the paper. Transparent: what is drawn is ink on someone else's paper.
  const paper = opaque ? paperOf(ranked[0]![1].color) : paperForInk(toneOf(inks));
  // Color names alone make a gray photo read like gray ink on white paper; how it is shaded tells them apart.
  const shading = shadingOf(data);
  const shaded = shading === 'smooth' ? '; smooth shading, like a photo' : shading === 'flat' ? '; flat areas of solid color' : '';
  return {
    words: `${colors}; ${surface}${shaded}`,
    sig: `${main.length <= 1 ? 'mono' : 'multi'}${opaque ? 'F' : ''}${shading ? `-${shading}` : ''}:${main.slice(0, 3).map(([name]) => name).join('/')}`,
    paper,
    opaque,
  };
}

/**
 * Whether drawn pixels blend smoothly into each other (a photo: many shades, few neighbors alike)
 * or sit in flat areas of one color (a drawing, text, a logo), or neither clearly.
 */
function shadingOf(data: ArrayLike<number>): 'smooth' | 'flat' | undefined {
  // Neighbors are alike when they share a color at 5 bits per channel, so a photo's grain sets them apart.
  const bin = (i: number) => ((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3);
  const drawn = (i: number) => data[i + 3]! > 128;
  // Lightness in 64 steps: a gray photo has as many as a colorful one, a two-tone drawing few.
  const levels = new Set<number>();
  let alike = 0;
  let pairs = 0;
  for (let y = 0; y < SAMPLE; y++) {
    for (let x = 0; x < SAMPLE; x++) {
      const i = (y * SAMPLE + x) * 4;
      if (!drawn(i)) continue;
      levels.add(Math.round((0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) / 4));
      for (const j of [x + 1 < SAMPLE ? i + 4 : -1, y + 1 < SAMPLE ? i + SAMPLE * 4 : -1]) {
        if (j < 0 || !drawn(j)) continue;
        pairs++;
        if (bin(i) === bin(j)) alike++;
      }
    }
  }
  if (pairs < SAMPLE * 2) return undefined; // too little drawn to tell
  const same = alike / pairs;
  if (levels.size > 24 && same < 0.45) return 'smooth';
  if (levels.size <= 24 || same >= 0.6) return 'flat';
  return undefined; // antialiased text and the like: neither clearly
}

/** Whether a set of ink colors is mostly dark, mostly light, or in between. */
export function toneOf(colors: RGBA[]): 'dark' | 'light' | 'mid' | undefined {
  if (!colors.length) return undefined;
  const l = colors.reduce((sum, c) => sum + toOklch(c).l, 0) / colors.length;
  return l < 0.5 ? 'dark' : l > 0.75 ? 'light' : 'mid';
}

export function paperOf(color: RGBA): Paper | undefined {
  const { l } = toOklch(color);
  return l > 0.75 ? 'light' : l < 0.4 ? 'dark' : undefined;
}

/** Dark ink was drawn to sit on light paper, and the other way round. */
export function paperForInk(tone: ReturnType<typeof toneOf>): Paper | undefined {
  return tone === 'dark' ? 'light' : tone === 'light' ? 'dark' : undefined;
}
