import type { CDPSession, Frame, Page } from '@playwright/test';
import { parseColor } from '../../src/shared/color.ts';
import { findTheme } from '../../src/themes/index.ts';

/** A theme's colors as getComputedStyle reports them ("rgb(40, 40, 40)"). */
export function colorsOf(themeId: string) {
  const theme = findTheme(themeId)!;
  const rgb = (hex: string) => {
    const c = parseColor(hex)!;
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  };
  const map = <K extends string>(colors: Record<K, string>) => Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, rgb(v as string)])) as Record<K, string>;
  return {
    base: rgb(theme.background.page),
    bg: map(theme.background),
    fg: map(theme.text),
    border: map(theme.border),
    onSolid: map(theme.textOnFill),
  };
}

type Prop = 'backgroundColor' | 'color' | 'borderBottomColor' | 'filter' | 'fill' | 'stroke';

const sessions = new WeakMap<Page | Frame, CDPSession>();

async function cdp(target: Page | Frame): Promise<CDPSession> {
  let session = sessions.get(target);
  if (!session) {
    const context = 'context' in target ? target.context() : target.page().context();
    session = await context.newCDPSession(target);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    sessions.set(target, session);
  }
  return session;
}

/**
 * The style the browser actually renders with. It is read through the DevTools protocol because
 * page scripts (and page.evaluate) deliberately see the site's own colors, not the theme's.
 *
 * `path` walks into shadow roots: ['#host', '#inside'] reads #inside in #host's shadow root.
 * A leading '@closed' starts in the fixture's closed root (window.__closedRoot).
 */
export async function style(target: Page | Frame, path: string | string[], prop: Prop): Promise<string> {
  const steps = typeof path === 'string' ? [path] : path;
  const session = await cdp(target);
  await session.send('DOM.getDocument', { depth: 0 });
  const finder = `(() => {
    let scope = document, el = null;
    const steps = ${JSON.stringify(steps)};
    for (const [i, step] of steps.entries()) {
      if (step === '@closed') { scope = window.__closedRoot; continue; }
      el = scope.querySelector(step);
      if (!el) throw new Error('not found: ' + step);
      if (i < steps.length - 1 && el.shadowRoot) scope = el.shadowRoot;
    }
    return el;
  })()`;
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', { expression: finder });
  if (exceptionDetails || !result.objectId) throw new Error(`element not found: ${steps.join(' ')}`);
  const { nodeId } = await session.send('DOM.requestNode', { objectId: result.objectId });
  const { computedStyle } = await session.send('CSS.getComputedStyleForNode', { nodeId });
  const name = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return computedStyle.find((p) => p.name === name)?.value ?? '';
}

/** Every distinct color in a screenshot of the viewport. */
export async function screenColors(page: Page): Promise<string[]> {
  const png = (await page.screenshot()).toString('base64');
  const viewer = await page.context().newPage();
  const colors = await viewer.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const seen = new Set<string>();
    for (let i = 0; i < px.length; i += 4) seen.add(`rgb(${px[i]}, ${px[i + 1]}, ${px[i + 2]})`);
    return [...seen];
  }, png);
  await viewer.close();
  return colors;
}

/** Colors further than `tolerance` per channel from `expected` (anti-aliasing produces ±1-2). */
export function offColors(colors: string[], expected: string, tolerance = 2): string[] {
  const channels = (rgb: string) => rgb.match(/\d+/g)!.map(Number);
  const want = channels(expected);
  return colors.filter((c) => channels(c).some((v, i) => Math.abs(v - want[i]!) > tolerance));
}
