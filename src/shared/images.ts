// Pictures of graphics for Jev: an element as it looks on the page, in its original colors on the
// color behind it, scaled to fit a square. The content script draws what the page may read; the
// background draws other sites' images, which only it may read. Both draw them here, the same way.

/** Each side, in pixels: the smallest square Jev accepts. Twice the size costs 3.5 times the tokens. */
export const IMAGE_SIZE = 280;

/** A picture on its way to Jev: drawn already (a base64 JPEG), or another site's image for the background to draw. */
export type JobImage = { jpeg: string } | { url: string; backdrop: string };

/** Draws `source` (`w` × `h`) on `backdrop`, centered in the square and scaled to fit it. */
export function drawContained(ctx: OffscreenCanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number, backdrop: string) {
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  const scale = Math.min(IMAGE_SIZE / w, IMAGE_SIZE / h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (IMAGE_SIZE - w * scale) / 2, (IMAGE_SIZE - h * scale) / 2, w * scale, h * scale);
}

/** The canvas as a base64 JPEG. Throws if it holds another site's pixels (the canvas is tainted). */
export async function encodeJpeg(canvas: OffscreenCanvas): Promise<string> {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
