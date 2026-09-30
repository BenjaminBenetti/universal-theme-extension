// Color math lives in code, never in Jev: Jev's docs say it cannot judge hex or
// RGB values, so we convert every color into plain words before asking it.

export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export interface Oklch {
  l: number; // 0-1
  c: number; // chroma, ~0-0.4
  h: number; // degrees
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseNumbers(body: string): number[] {
  return body
    .replace(/[,/]/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => (part.endsWith('%') ? parseFloat(part) / 100 : part === 'none' ? 0 : parseFloat(part)));
}

/** Parses the color formats `getComputedStyle` produces (rgb/rgba, color(srgb), oklch, oklab, hex). */
export function parseColor(input: string | null | undefined): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) return parseHex(s);
  const fn = /^([a-z-]+)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const [, name, body] = fn as unknown as [string, string, string];
  const hasSlashAlpha = body.includes('/');
  const nums = parseNumbers(body);
  switch (name) {
    case 'rgb':
    case 'rgba': {
      const [r = 0, g = 0, b = 0, a = 1] = nums;
      // Percent channels were already divided by 100 in parseNumbers.
      const scale = body.includes('%') && !hasSlashAlpha ? 255 : 1;
      return { r: clamp(r * scale, 0, 255), g: clamp(g * scale, 0, 255), b: clamp(b * scale, 0, 255), a: clamp(a, 0, 1) };
    }
    case 'color': {
      const [space, ...rest] = body.trim().split(/\s+/);
      if (space !== 'srgb' && space !== 'srgb-linear' && space !== 'display-p3') return null;
      const [r = 0, g = 0, b = 0, a = 1] = parseNumbers(rest.join(' '));
      const lin = space === 'srgb-linear';
      const conv = (v: number) => clamp((lin ? linearToSrgb(v) : v) * 255, 0, 255);
      return { r: conv(r), g: conv(g), b: conv(b), a: clamp(a, 0, 1) };
    }
    case 'oklch': {
      const [l = 0, c = 0, h = 0, a = 1] = nums;
      return { ...oklabToRgb(l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)), a: clamp(a, 0, 1) };
    }
    case 'oklab': {
      const [l = 0, A = 0, B = 0, a = 1] = nums;
      return { ...oklabToRgb(l, A, B), a: clamp(a, 0, 1) };
    }
    default:
      return null;
  }
}

function parseHex(s: string): RGBA | null {
  const hex = s.slice(1);
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) return null;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
}

export function toHex({ r, g, b }: RGBA): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function isTransparent(c: RGBA | null): boolean {
  return !c || c.a < 0.02;
}

/** Paints `top` over an opaque `bottom`. */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** Linear interpolation in sRGB, used when building theme tokens (t = weight of `b`). */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a)!;
  const cb = parseColor(b)!;
  return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t, a: 1 });
}

export function sameColor(a: RGBA | null, b: RGBA | null, tolerance = 2): boolean {
  if (!a || !b) return a === b;
  if (isTransparent(a) && isTransparent(b)) return true;
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance &&
    Math.abs(a.a - b.a) <= 0.02
  );
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function toOklch({ r, g, b }: RGBA): Oklch {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/** OKLCH → sRGB (clamped into gamut), the inverse of toOklch. */
export function fromOklch({ l, c, h }: Oklch): RGBA {
  const rad = (h * Math.PI) / 180;
  return { ...oklabToRgb(l, c * Math.cos(rad), c * Math.sin(rad)), a: 1 };
}

function oklabToRgb(L: number, A: number, B: number): Omit<RGBA, 'a'> {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const conv = (v: number) => clamp(linearToSrgb(v) * 255, 0, 255);
  return {
    r: conv(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: conv(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: conv(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function luminance({ r, g, b }: RGBA): number {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hueName(h: number, l: number): string {
  if (h >= 345 || h < 40) return l > 0.82 ? 'pink' : 'red';
  if (h < 75) return 'orange';
  if (h < 115) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 230) return 'sky blue';
  if (h < 275) return 'blue';
  if (h < 310) return 'purple';
  return 'magenta';
}

function grayName(l: number): string {
  if (l >= 0.985) return 'white';
  if (l >= 0.95) return 'off-white';
  if (l >= 0.9) return 'very light gray';
  if (l >= 0.76) return 'light gray';
  if (l >= 0.56) return 'medium gray';
  if (l >= 0.4) return 'dark gray';
  if (l >= 0.26) return 'very dark gray';
  if (l >= 0.16) return 'near-black';
  return 'black';
}

/** Names an opaque color in plain English, e.g. "strong blue", "very light gray", "pale yellow". */
export function nameColor(c: RGBA): string {
  const { l, c: chroma, h } = toOklch(c);
  // Very light colors can't hold much chroma, so a small amount already reads as a tint (pale pink).
  const grayBelow = l > 0.9 ? 0.012 : l > 0.8 ? 0.02 : 0.03;
  if (chroma < grayBelow || l < 0.12 || l > 0.985) return grayName(l);
  const hue = hueName(h, l);
  let tone: string;
  if (l > 0.9) tone = 'pale';
  else if (l > 0.78) tone = 'light';
  else if (l < 0.33) tone = 'very dark';
  else if (l < 0.45) tone = 'dark';
  else tone = '';
  const intensity = tone !== 'pale' && chroma < 0.06 ? 'grayish' : chroma > 0.14 && tone !== 'pale' ? 'strong' : '';
  return [intensity, tone, hue].filter(Boolean).join(' ');
}

/** Describes any color, including translucency, in plain words. */
export function describeColor(c: RGBA | null): string {
  if (isTransparent(c)) return 'none (transparent)';
  const name = nameColor(c!);
  return c!.a < 0.98 ? `${name} at ${Math.round(c!.a * 100)}% opacity` : name;
}

/** How a color relates to what is behind it, in words ("slightly darker than what is behind it"). */
export function describeRelation(top: RGBA, behind: RGBA): string {
  const a = toOklch(composite(top, behind)).l;
  const b = toOklch(behind).l;
  const d = a - b;
  if (Math.abs(d) < 0.015) return 'same lightness as what is behind it';
  const size = Math.abs(d) < 0.06 ? 'slightly ' : Math.abs(d) < 0.2 ? '' : 'much ';
  return `${size}${d > 0 ? 'lighter' : 'darker'} than what is behind it`;
}

/**
 * Soft vs strong: a pale tint (error banner) is "soft", a saturated fill (delete button) is "strong".
 * Used to pick between e.g. `danger` and `danger-soft` after Jev picks the semantic role.
 */
export function isSoftTint(c: RGBA, behind: RGBA): boolean {
  const { l, c: chroma } = toOklch(composite(c, behind));
  const back = toOklch(behind).l;
  return chroma < 0.09 && Math.abs(l - back) < 0.15;
}

/** Whichever of two candidate colors reads better on `fill` (by WCAG contrast). */
export function legibleOn(fill: string, a: string, b: string): string {
  const f = parseColor(fill);
  if (!f) return a;
  return contrastRatio(parseColor(a)!, f) >= contrastRatio(parseColor(b)!, f) ? a : b;
}
