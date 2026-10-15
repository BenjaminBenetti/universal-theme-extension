// Pictures of graphics (<img>, <canvas>, background pictures, <svg>) for Jev to look at. How to draw
// one is recorded while it is measured in its original colors; it is drawn only once its question
// is about to leave the page, so graphics Jev has already labeled cost nothing.

import { drawContained, encodeJpeg, IMAGE_SIZE, type JobImage } from '../shared/images.ts';
import { remoteSvg } from './pixels.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export type Picture =
  /** Pixels the page has: an <img>, a <canvas>, or a background picture. */
  | { kind: 'image'; source: HTMLImageElement | HTMLCanvasElement; url: string; backdrop: string }
  /** An inline <svg>, with the computed style of it and each element inside, in document order. */
  | { kind: 'svg'; svg: Element; styles: string[]; w: number; h: number; backdrop: string };

/** Properties that decide how an SVG paints; a copy drawn on its own has none of the page's CSS. */
const PAINT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity', 'display', 'visibility'];
const EXTRA: Record<string, string[]> = {
  stop: ['stop-color', 'stop-opacity'],
  text: ['font-family', 'font-size', 'font-weight'],
  tspan: ['font-family', 'font-size', 'font-weight'],
};
/** Bigger SVGs are illustrations, charts, or maps: their colors tell Jev enough. */
const MAX_SVG_PARTS = 60;

/**
 * The computed styles that draw an <svg> and what is inside it. Its own text color is `color`, the
 * original one: when it inherits from a parent that is themed now, paints in the themed color are
 * really currentColor.
 */
export function svgStyles(svg: Element, color: string | undefined): string[] | undefined {
  const parts = [svg, ...svg.querySelectorAll('*')];
  if (parts.length > MAX_SVG_PARTS) return undefined;
  const current = getComputedStyle(svg).color;
  return parts.map((el, i) => {
    const cs = getComputedStyle(el);
    const props = [...PAINT, ...(EXTRA[el.localName] ?? [])].map((p) => {
      const value = cs.getPropertyValue(p);
      return `${p}:${color && (p === 'fill' || p === 'stroke') && value === current ? 'currentColor' : value}`;
    });
    if (i === 0 && color) props.push(`color:${color}`);
    return props.join(';');
  });
}

/** The picture as Jev will see it, or undefined if it can't be drawn (a tainted canvas, an SVG that changed). */
export async function drawPicture(picture: Picture): Promise<JobImage | undefined> {
  if (picture.kind === 'svg') return drawSvg(picture).catch(() => undefined);
  const { source, url, backdrop } = picture;
  const rect = source.getBoundingClientRect();
  try {
    const w = (source instanceof HTMLImageElement ? source.naturalWidth : source.width) || rect.width || IMAGE_SIZE;
    const h = (source instanceof HTMLImageElement ? source.naturalHeight : source.height) || rect.height || IMAGE_SIZE;
    const canvas = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
    drawContained(canvas.getContext('2d')!, source, w, h, backdrop);
    return { jpeg: await encodeJpeg(canvas) };
  } catch {
    if (!/^https?:/.test(url)) return undefined;
  }
  // Another site's image: the page may not read its pixels, but the background may. It can't draw
  // SVG (emoji and icons on a CDN), so it hands over their source, which the page may draw.
  const markup = await remoteSvg(url);
  const svg = markup ? new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement : undefined;
  if (svg?.localName !== 'svg' || svg.querySelector('parsererror')) return { url, backdrop };
  return drawSvgElement(svg, rect.width || IMAGE_SIZE, rect.height || IMAGE_SIZE, backdrop).catch(() => undefined);
}

/** Draws a standalone copy of an inline <svg>, with its styles written onto it. */
async function drawSvg({ svg, styles, w, h, backdrop }: Extract<Picture, { kind: 'svg' }>): Promise<JobImage | undefined> {
  const copy = svg.cloneNode(true) as Element;
  const parts = [copy, ...copy.querySelectorAll('*')];
  if (parts.length !== styles.length) return undefined; // it changed since it was measured
  parts.forEach((el, i) => el.setAttribute('style', styles[i]!));
  bringReferences(copy, svg);
  return drawSvgElement(copy, w, h, backdrop);
}

/** Draws a standalone <svg> shown at `w` × `h` on the page, scaled up to the square. */
async function drawSvgElement(copy: Element, w: number, h: number, backdrop: string): Promise<JobImage | undefined> {
  const scale = Math.min(IMAGE_SIZE / w, IMAGE_SIZE / h);
  // Without a viewBox, what it draws is laid out in its own width and height, if it says them.
  const own = (name: string) => /^\d+(\.\d+)?(px)?$/.test(copy.getAttribute(name) ?? '') ? parseFloat(copy.getAttribute(name)!) : undefined;
  if (!copy.hasAttribute('viewBox')) copy.setAttribute('viewBox', `0 0 ${own('width') ?? w} ${own('height') ?? h}`);
  copy.setAttribute('width', String(w * scale));
  copy.setAttribute('height', String(h * scale));
  copy.setAttribute('xmlns', SVG_NS);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await img.decode();
  // Drawn alone first: a copy that draws nothing (its parts were defined elsewhere) is not worth sending.
  const alone = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
  const ctx = alone.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, (IMAGE_SIZE - w * scale) / 2, (IMAGE_SIZE - h * scale) / 2, w * scale, h * scale);
  const pixels = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data;
  let drawn = false;
  for (let i = 3; i < pixels.length && !drawn; i += 4) drawn = pixels[i]! > 0;
  if (!drawn) return undefined;
  const canvas = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
  drawContained(canvas.getContext('2d')!, alone, IMAGE_SIZE, IMAGE_SIZE, backdrop);
  return { jpeg: await encodeJpeg(canvas) };
}

/**
 * Icons drawn with <use href="#id"> point at a symbol elsewhere on the page (a sprite sheet). The
 * copy carries those symbols along, so it draws on its own.
 */
function bringReferences(copy: Element, svg: Element) {
  const scope = svg.getRootNode() as Document | ShadowRoot;
  let defs: Element | undefined;
  const brought = new Set<string>();
  for (const use of copy.querySelectorAll('use')) {
    const href = use.getAttribute('href') ?? use.getAttributeNS(XLINK_NS, 'href');
    const id = href?.startsWith('#') ? href.slice(1) : undefined;
    if (!id || brought.has(id) || svg.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
    const target = scope.getElementById(id);
    if (!target) continue;
    brought.add(id);
    if (!defs) copy.prepend((defs = document.createElementNS(SVG_NS, 'defs')));
    defs.append(target.cloneNode(true));
  }
}
