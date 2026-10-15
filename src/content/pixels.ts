// Pixels of other sites' images (avatars on a CDN, logos), which a content script may not read.
// The background may: it reads them and answers with the same description an image of this site
// would get, so Jev sees a photo as a photo instead of guessing from its file name.

import type { PixelsRequest, SvgRequest } from '../shared/messages.ts';
import type { PixelInfo } from '../shared/pixels.ts';

const known = new Map<string, PixelInfo | null>();
const waiting = new Map<string, Array<() => void>>();

/** The description of the image at `url`: "waiting" while the background reads it, null if it can't. */
export function remotePixels(url: string): PixelInfo | null | 'waiting' {
  const hit = known.get(url);
  if (hit !== undefined) return hit;
  if (!/^https?:/.test(url)) return null;
  if (!waiting.has(url)) {
    waiting.set(url, []);
    const request: PixelsRequest = { type: 'pixels', url };
    chrome.runtime
      .sendMessage(request)
      .then(
        (info: PixelInfo | null | undefined) => info ?? null,
        () => null,
      )
      .then((info) => {
        if (known.size > 2000) known.clear();
        known.set(url, info);
        const callbacks = waiting.get(url) ?? [];
        waiting.delete(url);
        for (const callback of callbacks) callback();
      });
  }
  return 'waiting';
}

/** Calls `then` once the background has answered for `url` (at once if it already has). */
export function whenPixels(url: string, then: () => void): void {
  const callbacks = waiting.get(url);
  if (callbacks) callbacks.push(then);
  else then();
}

/** The source of another site's SVG image, read by the background, or null if it isn't one. */
export function remoteSvg(url: string): Promise<string | null> {
  const request: SvgRequest = { type: 'svg', url };
  return chrome.runtime.sendMessage(request).then(
    (text: string | null | undefined) => text ?? null,
    () => null,
  );
}
