// Reads other sites' images for the content script, which may not: the extension's host
// permissions let the background fetch them (without cookies), sample their pixels, and draw them
// for Jev to look at.

import { drawContained, encodeJpeg, IMAGE_SIZE } from '../shared/images.ts';
import { describePixels, SAMPLE, type PixelInfo } from '../shared/pixels.ts';

/** Bigger files are not worth sampling (avatars and logos are small). */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SVG_BYTES = 1024 * 1024;
const cache = new Map<string, Promise<PixelInfo | null>>();

/** The description of the image at `url`, or null if it can't be read (not an image, too big, an SVG). */
export function readPixels(url: string): Promise<PixelInfo | null> {
  let result = cache.get(url);
  if (!result) {
    if (cache.size > 500) cache.clear();
    result = sample(url);
    cache.set(url, result);
  }
  return result;
}

async function sample(url: string): Promise<PixelInfo | null> {
  try {
    const blob = await fetchImage(url);
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob, { resizeWidth: SAMPLE, resizeHeight: SAMPLE, resizeQuality: 'medium' });
    const canvas = new OffscreenCanvas(SAMPLE, SAMPLE);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return describePixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    return null; // not an image a worker can decode (an SVG), or unreachable
  }
}

/** The image at `url` drawn for Jev on `backdrop` (a base64 JPEG), or undefined if it can't be read. */
export async function drawRemote(url: string, backdrop: string): Promise<string | undefined> {
  try {
    const blob = await fetchImage(url);
    if (!blob) return undefined;
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE);
    drawContained(canvas.getContext('2d')!, bitmap, bitmap.width, bitmap.height, backdrop);
    bitmap.close();
    return await encodeJpeg(canvas);
  } catch {
    return undefined;
  }
}

/**
 * The source of the SVG image at `url`, or null if it is not one. A worker can't draw SVG, and a page
 * may not read another site's; drawn from its source, the page may.
 */
export async function readSvg(url: string): Promise<string | null> {
  if (!/^https?:/.test(url)) return null;
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    const type = response.headers.get('content-type') ?? '';
    // Pictures (PNG, JPEG, WebP…) are drawn by drawRemote; only read what may be an SVG.
    if (!response.ok || (/^image\//.test(type) && !/svg/.test(type))) {
      void response.body?.cancel();
      return null;
    }
    const blob = await response.blob();
    if (blob.size > MAX_SVG_BYTES) return null;
    const text = await blob.text();
    return /svg/.test(type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text) ? text : null;
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<Blob | null> {
  if (!/^https?:/.test(url)) return null;
  // The page already loaded this image; the HTTP cache usually still has it.
  const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) return null;
  const blob = await response.blob();
  return blob.size > MAX_BYTES ? null : blob;
}
