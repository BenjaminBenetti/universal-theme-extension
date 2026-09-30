// Reads an element's ORIGINAL styling (while our CSS is switched off) and turns it
// into (a) a cache signature and (b) a plain-words description for Jev.
// Code only decides structure here — which questions have a decision in them at all.
// Every color decision is left to Jev.

import {
  composite,
  describeColor,
  describeRelation,
  isSoftTint,
  isTransparent,
  nameColor,
  parseColor,
  sameColor,
  toHex,
  toOklch,
  type RGBA,
} from '../shared/color.ts';
import { flatParent } from './dom.ts';

export type Pseudo = '' | 'before' | 'after';

export interface Ask {
  bg?: true;
  fg?: true;
  ink?: true;
  border?: true;
  graphic?: true;
}

/** A question set for Jev about one box. Identical boxes share a signature and one answer. */
export interface Job {
  sig: string;
  facts: Record<string, string>;
  ask: Ask;
  /** Code-measured: the background is a pale tint, so soft-capable tokens use their "-soft" variant. */
  softBg: boolean;
  /** Code-measured: fixed or sticky with a background, so it covers the page scrolling under it. */
  covers?: boolean;
}

export interface Plan {
  el: Element;
  pseudo: Pseudo;
  /** Undefined when nothing on this box needs a decision (it inherits / is transparent). */
  job?: Job;
  /** Gradients are dropped in favour of a token color; url() images are content and kept. */
  bgImage: 'none' | 'strip' | 'keep';
  /** SVG shapes and <img> are handled by their graphic label; they only need this flag. */
  paint?: 'fill' | 'stroke' | 'both';
  /** An <img> that has not loaded yet: measure it again once it has pixels to look at. */
  deferred?: true;
  /** A <canvas> that had nothing drawn yet: measure it again a little later. */
  retry?: true;
  /**
   * Code-measured "paper" of a graphic: the background it was drawn for. A spreadsheet canvas is
   * light paper; dark ink on a transparent background was also drawn for light paper. Line art is
   * re-tinted so its paper becomes the theme's page color and its ink the theme's text color.
   */
  paper?: 'light' | 'dark';
}

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use']);
const LANDMARKS = new Set(['header', 'nav', 'main', 'footer', 'aside', 'form', 'dialog', 'table', 'li', 'button', 'a', 'label', 'pre', 'code', 'blockquote', 'figure', 'menu']);
const FORM_CONTROLS = new Set(['input', 'textarea', 'select', 'button']);
const MEDIA = new Set(['video', 'iframe', 'embed', 'object', 'picture', 'audio']);
const GRAPHICS = new Set(['svg', 'img', 'canvas']);

/** What an element looked like in the site's own styling, remembered for its descendants. */
export interface Original {
  /** Its own text color (what children inherit). */
  fg: RGBA | null;
  /** The opaque color painted behind its children. */
  behind: RGBA;
}

/**
 * Original colors of every measured element. Children are measured against their parent's
 * remembered colors, so a measurement never needs the rest of the page un-themed.
 */
export const originals = new WeakMap<Element, Original>();

/**
 * One measuring pass. Every element passed to `measure` must carry `data-ute-m` (which switches our
 * CSS off for that element only) and `data-ute-nt` (transitions off) while the pass runs, and
 * parents must be measured before children.
 */
export class MeasurePass {
  readonly viewport = { w: innerWidth || 1280, h: innerHeight || 800 };
  private host: string;
  private flagged: Set<Element>;

  constructor(host: string, flagged: Set<Element>) {
    this.host = host;
    this.flagged = flagged;
  }

  /** "white background with near-black text": the page's overall look, for Jev's context. */
  get page(): string {
    const body = document.body ? originals.get(document.body) : undefined;
    const top = body ?? originals.get(document.documentElement);
    if (!top) return 'unknown';
    return `${nameColor(top.behind)} background with ${nameColor(top.fg ?? { r: 0, g: 0, b: 0, a: 1 })} text`;
  }

  /** Records the root element's own colors (the canvas). */
  measureRoot(root: Element) {
    const cs = getComputedStyle(root);
    const bg = backgroundOf(cs);
    originals.set(root, { fg: parseColor(cs.color), behind: isTransparent(bg) ? WHITE : composite(bg!, WHITE) });
  }

  private parentOriginal(parent: Element | null): Original {
    if (!parent) return { fg: null, behind: WHITE };
    const known = originals.get(parent);
    if (known) return known;
    // Never measured (e.g. inside <head>): best effort from what is on screen now.
    const cs = getComputedStyle(parent);
    const above = this.parentOriginal(flatParent(parent));
    const bg = backgroundOf(cs);
    return { fg: parseColor(cs.color), behind: isTransparent(bg) ? above.behind : composite(bg!, above.behind) };
  }

  measure(el: Element): Plan[] {
    const cs = getComputedStyle(el);
    const tag = el.localName;
    const parent = flatParent(el);
    const inherited = this.parentOriginal(parent);

    // Text color is inherited. If the parent is still themed (not flagged in this pass) and this
    // element's color equals the parent's themed color, it is inheriting: use the parent's original.
    let fg = parseColor(cs.color);
    if (parent && !this.flagged.has(parent) && sameColor(fg, parseColor(getComputedStyle(parent).color), 0)) fg = inherited.fg;

    if (el.namespaceURI === SVG_NS && tag !== 'svg') {
      // Shapes inside an <svg> follow the <svg>'s graphic label; just record what they paint.
      originals.set(el, { fg, behind: inherited.behind });
      return [{ el, pseudo: '', bgImage: 'none', paint: shapePaint(cs) }];
    }

    const bg = backgroundOf(cs);
    const behind = isTransparent(bg) ? inherited.behind : composite(bg!, inherited.behind);
    originals.set(el, { fg, behind });

    if (tag === 'img' && !(el as HTMLImageElement).complete) return [{ el, pseudo: '', bgImage: 'none', deferred: true }];

    const plans: Plan[] = [this.planBox(el, '', cs, fg, inherited.behind, inherited.fg)];
    if (!GRAPHICS.has(tag) && !MEDIA.has(tag) && !FORM_CONTROLS.has(tag)) {
      for (const pseudo of ['before', 'after'] as const) {
        const ps = getComputedStyle(el, `::${pseudo}`);
        if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
        const psFg = parseColor(ps.color);
        const plan = this.planBox(el, pseudo, ps, sameColor(psFg, parseColor(cs.color), 0) ? fg : psFg, behind, fg);
        if (plan.job || plan.bgImage !== 'none') plans.push(plan);
      }
    }
    return plans;
  }

  private planBox(el: Element, pseudo: Pseudo, cs: CSSStyleDeclaration, fg: RGBA | null, backdrop: RGBA, parentFg: RGBA | null): Plan {
    const tag = el.localName;
    const bgImage = backgroundImageKind(cs.backgroundImage);
    if (MEDIA.has(tag)) return { el, pseudo, bgImage: 'none' };

    const bg = backgroundOf(cs);
    let radius = 0;
    let shadow = false;
    const isControl = FORM_CONTROLS.has(tag) || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'textbox';
    const floats = cs.position === 'fixed' || cs.position === 'sticky';
    const ask: Ask = {};
    const facts: Record<string, string> = {};
    const sigParts: string[] = [];
    let paper: Plan['paper'];
    let retry = false;

    // Icons that are pictures without being <img>: an element replaced by `content: url(sprite)`
    // (Google Docs' toolbar), or a small childless box painted with a background image.
    if (!pseudo && !GRAPHICS.has(tag)) {
      const replacedBy = /^url\(["']?([^"')]*)/.exec(cs.content)?.[1];
      let pictureUrl = replacedBy;
      if (!pictureUrl && bgImage === 'keep' && isTransparent(bg) && el.childElementCount === 0 && !hasOwnText(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.width <= 48 && rect.height > 0 && rect.height <= 48) pictureUrl = /url\(["']?([^"')]*)/.exec(cs.backgroundImage)?.[1];
      }
      if (pictureUrl !== undefined) {
        ask.graphic = true;
        facts.picture = `${basename(pictureUrl)} (${replacedBy !== undefined ? 'shown in place of the element, one slice of a sprite sheet' : "painted as the element's background"})`;
        sigParts.push(`pic:${basename(pictureUrl)}@${replacedBy !== undefined ? `${cs.left},${cs.top}` : cs.backgroundPosition}`);
        paper = paperOf(backdrop); // drawn for what it sits on
      }
    }

    if (GRAPHICS.has(tag)) {
      ask.graphic = true;
      if (tag === 'svg') {
        const fills = svgPaints(el);
        facts.colors = fills.length ? fills.map((c) => nameColor(c)).join(', ') : 'uses the surrounding text color';
        paper = paperForInk(toneOf(fills.length ? fills : fg ? [fg] : []));
        sigParts.push(fills.map((c) => toHex(c)).join(','));
        // Which text role an icon takes if Jev decides to recolor it.
        ask.fg = true;
      } else {
        const source = el as HTMLImageElement | HTMLCanvasElement;
        if (tag === 'img') sigParts.push(basename((source as HTMLImageElement).currentSrc || (source as HTMLImageElement).src || ''));
        // Photos are recognizable from name and size; canvases never are, so always look at those.
        const pixels = probePixels(source, tag === 'canvas');
        // A graphic's own background is its paper when its pixels do not cover it (spreadsheet
        // engines draw black text on a transparent canvas and let CSS paint the white).
        const ownPaper = isTransparent(bg) ? undefined : paperOf(composite(bg!, backdrop));
        if (pixels) {
          facts.pixels = pixels.words;
          sigParts.push(`px:${pixels.sig}`);
          paper = pixels.opaque ? pixels.paper : (ownPaper ?? pixels.paper);
          retry = tag === 'canvas' && pixels.sig === 'empty';
        } else if (tag === 'canvas') {
          // Drawn off the main thread (OffscreenCanvas) or tainted: judge by what it sits on.
          facts.pixels = 'cannot be read (drawn off-screen)';
          paper = ownPaper ?? paperOf(backdrop);
          sigParts.push('px:unreadable');
        }
      }
    }

    // A CSS mask turns the background color into the ink of an icon shape.
    const masked = cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image');
    if (masked && masked !== 'none' && !isTransparent(bg)) {
      ask.ink = true;
      facts['icon color'] = `${describeColor(bg)} (an icon shape cut out of its background by a mask)`;
      sigParts.push(`ink:${toHex(bg!)}`);
    } else if (!isTransparent(bg)) {
      // Background: only a decision when the box paints something distinct, or looks like a box.
      // A fixed or sticky box always paints something: the page scrolls underneath it, so what is
      // behind it now (often the same color) is not what it has to cover.
      radius = parseFloat(cs.borderTopLeftRadius) || 0;
      shadow = cs.boxShadow !== 'none';
      const distinct = !sameColor(composite(bg!, backdrop), backdrop, 3);
      if (distinct || radius > 0 || shadow || isControl || floats) {
        ask.bg = true;
        facts.background = `${describeColor(bg)}, ${describeRelation(bg!, backdrop)}`;
        sigParts.push(`bg:${toHex(bg!)}/${bg!.a.toFixed(2)}${floats ? '/floats' : ''}`);
      }
    }

    // Text color: only when it changes from what it would inherit and something can show it.
    if (!ask.graphic && fg && !sameColor(fg, parentFg) && (pseudo || hasOwnText(el) || el.childElementCount > 0 || isControl)) {
      ask.fg = true;
    }
    if (ask.fg) {
      facts[tag === 'svg' ? 'current text color' : 'text color'] = describeColor(fg);
      sigParts.push(`fg:${fg ? `${toHex(fg)}/${fg.a.toFixed(2)}` : 'none'}`);
    }

    // Border: only when visible against the box itself.
    const border = visibleBorder(cs);
    if (border) {
      const own = isTransparent(bg) ? backdrop : composite(bg!, backdrop);
      if (!sameColor(composite(border.color, own), own, 3)) {
        ask.border = true;
        facts.border = `${border.width} ${describeColor(border.color)}${border.sides === 'all sides' ? '' : ` on ${border.sides}`}`;
        sigParts.push(`bd:${toHex(border.color)}/${border.sides}`);
      }
    }

    if (!ask.bg && !ask.fg && !ask.ink && !ask.border && !ask.graphic) return { el, pseudo, bgImage };

    // Only boxes that need a decision pay for layout and text reads.
    const rect = el.getBoundingClientRect();
    const sizeClass = this.sizeClass(rect, cs);
    const look = describeLook(radius, shadow, sizeClass);
    const opacity = parseFloat(cs.opacity);
    sigParts.unshift(pseudo || tag, el.getAttribute('role') ?? '', sizeClass, look.sig, `o${Math.round(opacity * 4)}${cs.visibility === 'hidden' ? 'h' : ''}`, `on:${toHex(backdrop)}`);

    facts['behind it'] = nameColor(backdrop);
    facts.element = pseudo ? `::${pseudo} decoration of ${openTag(el)}` : openTag(el);
    const text = pseudo ? cs.content.replace(/^["']|["']$/g, '').slice(0, 40) : textSample(el, 80);
    if (text) facts.text = text;
    const inside = landmarks(el);
    if (inside) facts.inside = inside;
    facts.size = rect.width || rect.height ? `${Math.round(rect.width)}×${Math.round(rect.height)} px (${sizeClass})` : 'not currently visible';
    if (look.words) facts.look = look.words;
    if (floats) facts.position = `${cs.position} on screen; the page scrolls underneath it`;
    if (opacity < 0.05) facts.opacity = '0% (invisible until hovered, focused, or activated)';
    else if (opacity < 1) facts.opacity = `${Math.round(opacity * 100)}%`;
    if (cs.visibility === 'hidden') facts.visibility = 'hidden until activated';

    const softBg = ask.bg ? isSoftTint(bg!, backdrop) : false;
    return {
      el,
      pseudo,
      bgImage,
      ...(paper ? { paper } : {}),
      ...(retry ? { retry: true as const } : {}),
      job: { sig: sigParts.join('|'), facts: { site: this.host, page: this.page, ...facts }, ask, softBg, ...(floats && ask.bg ? { covers: true } : {}) },
    };
  }

  private sizeClass(rect: DOMRect, cs: CSSStyleDeclaration): string {
    if (cs.display === 'none' || (rect.width === 0 && rect.height === 0)) return 'hidden';
    if (Math.min(rect.width, rect.height) <= 3) return 'line';
    if (rect.width <= 48 && rect.height <= 48) return 'icon-sized';
    if (rect.width >= this.viewport.w * 0.8) return rect.height >= this.viewport.h * 0.5 ? 'full page' : 'full-width band';
    if (rect.width * rect.height >= this.viewport.w * this.viewport.h * 0.2) return 'large';
    return rect.height <= 64 ? 'bar' : 'box';
  }
}

export function backgroundOf(cs: CSSStyleDeclaration): RGBA | null {
  const bg = parseColor(cs.backgroundColor);
  if (!isTransparent(bg)) return bg;
  // A transparent box painted with a gradient counts as the gradient's average color.
  if (/gradient/.test(cs.backgroundImage) && !/url\(/.test(cs.backgroundImage)) return gradientAverage(cs.backgroundImage);
  return bg;
}

function gradientAverage(image: string): RGBA | null {
  const stops = image.match(/(rgba?|oklch|oklab|color)\([^)]*\)/g)?.map(parseColor).filter((c): c is RGBA => !!c) ?? [];
  if (!stops.length) return null;
  const sum = stops.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b, a: acc.a + c.a }), { r: 0, g: 0, b: 0, a: 0 });
  const n = stops.length;
  return { r: sum.r / n, g: sum.g / n, b: sum.b / n, a: sum.a / n };
}

function backgroundImageKind(image: string): Plan['bgImage'] {
  if (!image || image === 'none') return 'none';
  return /url\(/.test(image) ? 'keep' : 'strip';
}

function visibleBorder(cs: CSSStyleDeclaration): { color: RGBA; width: string; sides: string } | null {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const visible = sides.filter((s) => {
    // Width is 0 for style none/hidden, so it is the only read most elements need.
    if (!(parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0)) return false;
    return !isTransparent(parseColor(cs.getPropertyValue(`border-${s}-color`)));
  });
  const first = visible[0];
  if (!first) return null;
  const color = parseColor(cs.getPropertyValue(`border-${first}-color`))!;
  const width = `${Math.round(parseFloat(cs.getPropertyValue(`border-${first}-width`)))}px`;
  return { color, width, sides: visible.length === 4 ? 'all sides' : visible.join(' and ') + ' only' };
}

function describeLook(radius: number, shadow: boolean, sizeClass: string): { words: string; sig: string } {
  const words: string[] = [];
  if (radius >= 999 || (radius >= 16 && sizeClass !== 'large')) words.push('pill-shaped / fully rounded');
  else if (radius > 0) words.push(`rounded corners (${Math.round(radius)}px)`);
  if (shadow) words.push('drop shadow');
  return { words: words.join(', '), sig: `${radius > 0 ? 'r' : ''}${shadow ? 's' : ''}` };
}

function shapePaint(cs: CSSStyleDeclaration): Plan['paint'] {
  const fill = cs.fill !== 'none' && !isTransparent(parseColor(cs.fill));
  const stroke = cs.stroke !== 'none' && !isTransparent(parseColor(cs.stroke)) && parseFloat(cs.strokeWidth) > 0;
  return fill && stroke ? 'both' : stroke ? 'stroke' : fill ? 'fill' : undefined;
}

function svgPaints(svg: Element): RGBA[] {
  const seen = new Map<string, RGBA>();
  let n = 0;
  for (const shape of svg.querySelectorAll('*')) {
    if (!SHAPES.has(shape.localName) || ++n > 60) continue;
    const cs = getComputedStyle(shape);
    for (const value of [cs.fill, cs.stroke]) {
      const c = parseColor(value);
      if (c && !isTransparent(c)) seen.set(toHex(c), c);
    }
  }
  return [...seen.values()].slice(0, 6);
}

let probeCanvas: CanvasRenderingContext2D | null | undefined;
const PROBE = 24;

/**
 * Jev cannot see pixels, so code looks at small images (icons, logos, wordmarks) and at canvases
 * (spreadsheet grids, documents, charts) and describes them in words: "mostly white (70%), with
 * near-black, strong blue; fills its whole box". Cross-origin images without CORS cannot be read.
 */
function probePixels(
  source: HTMLImageElement | HTMLCanvasElement,
  always: boolean,
): { words: string; sig: string; paper: Plan['paper']; opaque: boolean } | undefined {
  const rect = source.getBoundingClientRect();
  const hasPixels = source instanceof HTMLCanvasElement ? source.width > 0 && source.height > 0 : source.naturalWidth > 0;
  if (!hasPixels || (!always && rect.width * rect.height > 360 * 160)) return undefined;
  if (probeCanvas === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PROBE;
    probeCanvas = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!probeCanvas) return undefined;
  let data: Uint8ClampedArray;
  try {
    probeCanvas.clearRect(0, 0, PROBE, PROBE);
    probeCanvas.drawImage(source, 0, 0, PROBE, PROBE);
    data = probeCanvas.getImageData(0, 0, PROBE, PROBE).data;
  } catch {
    return undefined; // tainted by cross-origin pixels
  }
  const inks: RGBA[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! > 128) inks.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: 1 });
  }
  const coverage = inks.length / (PROBE * PROBE);
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
  return {
    words: `${colors}; ${surface}`,
    sig: `${main.length <= 1 ? 'mono' : 'multi'}${opaque ? 'F' : ''}:${main.slice(0, 3).map(([name]) => name).join('/')}`,
    paper,
    opaque,
  };
}

/** Whether a set of ink colors is mostly dark, mostly light, or in between. */
function toneOf(colors: RGBA[]): 'dark' | 'light' | 'mid' | undefined {
  if (!colors.length) return undefined;
  const l = colors.reduce((sum, c) => sum + toOklch(c).l, 0) / colors.length;
  return l < 0.5 ? 'dark' : l > 0.75 ? 'light' : 'mid';
}

function paperOf(color: RGBA): Plan['paper'] {
  const { l } = toOklch(color);
  return l > 0.75 ? 'light' : l < 0.4 ? 'dark' : undefined;
}

/** Dark ink was drawn to sit on light paper, and the other way round. */
function paperForInk(tone: ReturnType<typeof toneOf>): Plan['paper'] {
  return tone === 'dark' ? 'light' : tone === 'light' ? 'dark' : undefined;
}

export function hasOwnText(el: Element): boolean {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim()) return true;
  }
  return false;
}

function textSample(el: Element, max: number): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.placeholder || el.value.slice(0, max);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n && out.length < max; n = walker.nextNode()) {
    const parentTag = n.parentElement?.localName;
    if (parentTag === 'script' || parentTag === 'style') continue;
    const t = n.nodeValue?.replace(/\s+/g, ' ').trim();
    if (t) out += (out ? ' ' : '') + t;
  }
  return out.length > max ? out.slice(0, max) + '…' : out;
}

function landmarks(el: Element): string {
  const found: string[] = [];
  for (let a = flatParent(el), depth = 0; a && depth < 25 && found.length < 3; a = flatParent(a), depth++) {
    const role = a.getAttribute('role');
    if (LANDMARKS.has(a.localName)) found.unshift(a.localName);
    else if (role && !['presentation', 'none', 'generic'].includes(role)) found.unshift(`[role=${role}]`);
  }
  return found.join(' > ');
}

/** Random-looking generated class names (e.g. "gNO89b") tell Jev nothing, so leave them out. */
function meaningful(name: string): boolean {
  if (name.length < 2 || name.length > 40) return false;
  if (/[-_]/.test(name)) return true; // "vector-header", "Button--primary"
  // Real words: "card", "searchBox", "SearchBox"; not "gNO89b" / "RNNXgb".
  return /^[a-z]+$/.test(name) || /^[a-zA-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(name) || /^[A-Z][a-z]{2,}$/.test(name);
}

function openTag(el: Element): string {
  const attrs: string[] = [];
  const add = (name: string, value: string | null, max = 40) => {
    if (value) attrs.push(`${name}="${value.replace(/\s+/g, ' ').trim().slice(0, max)}"`);
  };
  if (el.id && meaningful(el.id)) add('id', el.id);
  const classes = [...el.classList].filter(meaningful).slice(0, 5).join(' ');
  add('class', classes, 80);
  for (const name of ['role', 'type', 'aria-label', 'title', 'alt', 'placeholder', 'name', 'aria-selected', 'aria-current', 'aria-pressed', 'disabled']) {
    add(name, el.getAttribute(name));
  }
  if (el.localName === 'a' && el.hasAttribute('href')) attrs.push('href');
  if (el.localName === 'img') add('src', basename((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src));
  return `<${el.localName}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
}

function basename(src: string): string {
  if (!src) return '';
  if (src.startsWith('data:')) return src.slice(0, 30);
  try {
    const path = new URL(src, location.href).pathname;
    return path.split('/').filter(Boolean).pop() ?? path;
  } catch {
    return src.slice(-40);
  }
}
