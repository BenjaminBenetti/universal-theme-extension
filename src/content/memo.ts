// Large apps (spreadsheets, feeds, tables) repeat the same styled element thousands of times and
// recycle them while scrolling. Measuring each copy is the expensive part of theming, so elements
// get a "style key": what CSS can see of them (tag, classes, inline style, state attributes,
// position among siblings) plus their parent's key. Once two copies with the same key measured
// identically, later copies reuse that measurement.

import type { Original } from './measure.ts';
import type { Plan } from './measure.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Measured individually: their pixels or sources differ even when their styles match. */
const NO_MEMO = new Set(['img', 'canvas', 'svg', 'video', 'iframe', 'picture', 'input', 'textarea', 'select']);
const STATE_ATTRS = [
  'type', 'role', 'aria-selected', 'aria-current', 'aria-pressed', 'aria-expanded', 'aria-checked', 'aria-disabled',
  'disabled', 'checked', 'selected', 'open', 'hidden', 'data-state', 'data-active', 'data-selected', 'dir',
];
/** Copies that must agree before a key is trusted. */
const TRUST_AFTER = 2;

interface Entry {
  fingerprint: string;
  plans: Plan[];
  original: Original;
  seen: number;
  broken: boolean;
}

export class StyleMemo {
  private ids = new Map<string, number>();
  private keys = new WeakMap<Element, number>();
  private entries = new Map<number, Entry>();

  /** Computes and remembers an element's style key; undefined when it must always be measured. */
  keyFor(el: Element, parent: Element | null): number | undefined {
    if (el.namespaceURI === SVG_NS || NO_MEMO.has(el.localName)) return undefined;
    // The root element's own styling is part of every key implicitly (it is the same for the page).
    const parentKey = !parent || parent === document.documentElement ? 0 : this.keys.get(parent);
    if (parentKey === undefined) return undefined;
    let text = `${el.localName}|${el.getAttribute('class') ?? ''}|${el.getAttribute('style') ?? ''}|${parentKey}|`;
    // Structural pseudo-classes (:first-child, :last-child, :empty) commonly change borders.
    text += `${el.previousElementSibling ? '' : 'F'}${el.nextElementSibling ? '' : 'L'}${el.firstChild ? '' : 'E'}`;
    for (const name of STATE_ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null) text += `|${name}=${value}`;
    }
    let id = this.ids.get(text);
    if (id === undefined) {
      id = this.ids.size + 1;
      this.ids.set(text, id);
    }
    this.keys.set(el, id);
    return id;
  }

  /** A trusted measurement for this element, re-targeted to it. */
  recall(el: Element, key: number): { plans: Plan[]; original: Original } | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.broken || entry.seen < TRUST_AFTER) return undefined;
    return { plans: entry.plans.map((p) => ({ ...p, el })), original: entry.original };
  }

  /**
   * Records a real measurement. Copies that disagree mean the key misses something CSS can see
   * (:nth-child, other attributes…) and the key is never trusted — unless the page's styles just
   * changed (`restyled`), in which case the new measurement replaces the old one.
   */
  learn(key: number, plans: Plan[], original: Original, restyled: boolean) {
    const fingerprint = fingerprintOf(plans, original);
    const entry = this.entries.get(key);
    if (!entry || (restyled && entry.fingerprint !== fingerprint)) {
      this.entries.set(key, { fingerprint, plans, original, seen: 1, broken: false });
    } else if (entry.fingerprint === fingerprint) {
      entry.seen++;
    } else {
      entry.broken = true;
    }
  }

  forget(el: Element) {
    const key = this.keys.get(el);
    if (key !== undefined) this.entries.delete(key);
  }
}

function fingerprintOf(plans: Plan[], original: Original): string {
  const colors = [original.fg, original.behind].map((c) => (c ? `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a.toFixed(2)}` : '-'));
  return `${colors.join('/')}#${plans.map((p) => `${p.pseudo}:${p.job?.sig ?? '-'}:${p.bgImage}:${p.paint ?? ''}`).join(';')}`;
}
