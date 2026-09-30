// CSS filters that recolor graphics we cannot restyle (canvases, images, sprite icons) into a
// theme. Each is an SVG feColorMatrix — an exact affine map of every pixel's color — referenced
// from a data: URL, so it works in any document or shadow root without injecting markup.
//
//   retintFilter: "line art" (spreadsheet grids, document pages, wordmarks). The paper it was
//     drawn on becomes the theme's page color and its ink the theme's text color, exactly. When
//     paper and theme differ in lightness (white paper, dark theme) lightness is inverted with hues
//     kept (invert + hue-rotate(180deg)), so a blue header stays blue.
//   tintFilter: single-color icons become exactly one color, keeping their shape (alpha).

import { parseColor } from '../shared/color.ts';

type RGB = [number, number, number];
/** 4 rows × 5 columns (r, g, b, a, offset), as feColorMatrix takes them. */
type Matrix = number[];

const rgb = (color: string): RGB => {
  const c = parseColor(color)!;
  return [c.r / 255, c.g / 255, c.b / 255];
};

/** hue-rotate(180deg) from the Filter Effects spec; keeps grays gray (rows sum to 1). */
const HUE_180 = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

/** saturate(k) from the Filter Effects spec; also keeps grays gray. */
function saturate(k: number): number[][] {
  return [
    [0.213 + 0.787 * k, 0.715 - 0.715 * k, 0.072 - 0.072 * k],
    [0.213 - 0.213 * k, 0.715 + 0.285 * k, 0.072 - 0.072 * k],
    [0.213 - 0.213 * k, 0.715 - 0.715 * k, 0.072 + 0.928 * k],
  ];
}

const multiply = (a: number[][], b: number[][]) => a.map((row) => b[0]!.map((_, j) => row.reduce((sum, v, k) => sum + v * b[k]![j]!, 0)));

/** Remapping paper→page and ink→text compresses color range; a little saturation makes up for it. */
const SATURATION_BOOST = 1.25;

function retintMatrix(sourcePaper: 'light' | 'dark', page: string, text: string): Matrix {
  const P = rgb(page);
  const T = rgb(text);
  const themeIsDark = P[0] + P[1] + P[2] < 1.5;
  const flips = (sourcePaper === 'light') === themeIsDark;
  // "Paper-ness" of a pixel, 0..1 per channel, before mapping onto the theme's colors.
  //   no flip:  light paper → the pixel itself; dark paper → the pixel itself (black paper = 0)
  //   flip:     1 - hue-kept inversion
  const S = saturate(SATURATION_BOOST);
  const rows: Matrix = [];
  for (let c = 0; c < 3; c++) {
    if (flips) {
      // light paper on a dark theme:  out = T - (T - P)·(H·S·v)   (white → P, black → T)
      // dark paper on a light theme:  out = P - (P - T)·(H·S·v)   (black → P, white → T)
      const [from, to] = sourcePaper === 'light' ? [T, P] : [P, T];
      const scale = from[c]! - to[c]!;
      const hs = multiply(HUE_180, S)[c]!;
      rows.push(-scale * hs[0]!, -scale * hs[1]!, -scale * hs[2]!, 0, from[c]!);
    } else {
      // light paper on a light theme: out = T + (P - T)·(S·v)     (white → P, black → T)
      // dark paper on a dark theme:   out = P + (T - P)·(S·v)     (black → P, white → T)
      const [from, to] = sourcePaper === 'light' ? [T, P] : [P, T];
      const scale = to[c]! - from[c]!;
      const s = S[c]!;
      rows.push(scale * s[0]!, scale * s[1]!, scale * s[2]!, 0, from[c]!);
    }
  }
  rows.push(0, 0, 0, 1, 0); // keep alpha
  return rows;
}

function tintMatrix(color: string): Matrix {
  const [r, g, b] = rgb(color);
  return [0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, 1, 0];
}

function toCss(matrix: Matrix): string {
  const values = matrix.map((v) => +v.toFixed(4)).join(' ');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"><filter id="f" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${values}"/></filter></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#f")`;
}

/** The filter that re-tints line art drawn on `sourcePaper` into a theme with this page and text color. */
export function retintFilter(sourcePaper: 'light' | 'dark', page: string, text: string): string {
  return toCss(retintMatrix(sourcePaper, page, text));
}

/** The filter that paints a single-color icon exactly `color`. */
export function tintFilter(color: string): string {
  return toCss(tintMatrix(color));
}

/** Applies a filter produced above to an opaque color, for tests and previews. */
export function simulate(filter: string, color: string): string {
  const values = /values%3D%22([^%]+(?:%20[^%]+)*)%22/.exec(filter)?.[1];
  if (!values) throw new Error('not one of our filters');
  const m = decodeURIComponent(values).split(' ').map(Number);
  const v = rgb(color);
  const out = [0, 1, 2].map((c) => Math.min(1, Math.max(0, m[c * 5]! * v[0] + m[c * 5 + 1]! * v[1] + m[c * 5 + 2]! * v[2] + m[c * 5 + 4]!)));
  return `#${out.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}
