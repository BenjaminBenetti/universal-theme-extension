// Reads other sites' images for the content script, which may not: the extension's host
// permissions let the background fetch them (without cookies) and sample their pixels.

import { describePixels, SAMPLE, type PixelInfo } from '../shared/pixels.ts';

/** Bigger files are not worth sampling (avatars and logos are small). */
const MAX_BYTES = 8 * 1024 * 1024;
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
  if (!/^https?:/.test(url)) return null;
  try {
    // The page already loaded this image; the HTTP cache usually still has it.
    const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > MAX_BYTES) return null;
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
