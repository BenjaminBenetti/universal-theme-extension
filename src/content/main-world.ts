// Runs in the page's own JavaScript world at document_start, before any page script.
//
// Some things a page does are invisible to MutationObserver, yet change what we must theme:
//   - attaching a shadow root (open or closed) to an element,
//   - replacing a shadow root's or the document's adoptedStyleSheets,
//   - adding CSS rules from script (insertRule / replace / replaceSync, as CSS-in-JS libraries do).
// This script reports those events (as DOM events the extension's isolated world listens for).
//
// It also keeps theming purely visual: when page scripts read computed colors, they get the
// site's own colors, not ours (see getComputedStyle below). It must never break the page.

import { MEDIA_TAGS } from '../shared/media.ts';

const SHADOW_EVENT = '__ute_shadow';
const SHEETS_EVENT = '__ute_sheets';
const RULES_EVENT = '__ute_rules';
const COLOR_PROPS = /(^|[;\s])(color|background|border|fill|stroke|box-shadow|outline|opacity|visibility|content)[\w-]*\s*:/i;

const notify = (target: EventTarget, type: string, detail?: unknown) => {
  try {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  } catch {
    /* never let reporting break the page */
  }
};

// --- Shadow roots -----------------------------------------------------------------------------

const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
  const root = attachShadow.call(this, init);
  notify(this, SHADOW_EVENT);
  return root;
} as typeof Element.prototype.attachShadow;

function hookAdopted(proto: Document | ShadowRoot, targetOf: (self: Document | ShadowRoot) => EventTarget) {
  const desc = Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
  if (!desc?.set || !desc.get) return;
  Object.defineProperty(proto, 'adoptedStyleSheets', {
    ...desc,
    set(this: Document | ShadowRoot, value: CSSStyleSheet[]) {
      desc.set!.call(this, value);
      notify(targetOf(this), SHEETS_EVENT, { selectors: colorSelectors(value) });
    },
  });
}
hookAdopted(ShadowRoot.prototype, (root) => (root as ShadowRoot).host);
hookAdopted(Document.prototype, (doc) => doc);

// --- CSS rules added from script ----------------------------------------------------------------

/** Selectors of rules that set colors, from the given sheets. */
function colorSelectors(sheets: Iterable<CSSStyleSheet>): string[] {
  const out: string[] = [];
  for (const sheet of sheets) {
    try {
      collect(sheet.cssRules, out);
    } catch {
      out.push('*');
    }
  }
  return out;
}

function collect(rules: CSSRuleList, out: string[]) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      if (COLOR_PROPS.test(rule.style.cssText)) out.push(rule.selectorText);
      if (rule.cssRules?.length) out.push('*');
    } else if ('cssRules' in rule) {
      collect((rule as CSSGroupingRule).cssRules, out);
    }
  }
}

// CSS-in-JS libraries insert thousands of rules while an app boots; report them once per task.
const pending = new Map<EventTarget, Set<string>>();
let scheduled = false;

function report(sheet: CSSStyleSheet, rules: Iterable<CSSRule>) {
  const selectors: string[] = [];
  try {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && COLOR_PROPS.test(rule.style.cssText)) selectors.push(rule.selectorText);
      else if (!(rule instanceof CSSStyleRule) && 'cssRules' in rule) collect((rule as CSSGroupingRule).cssRules, selectors);
    }
  } catch {
    selectors.push('*');
  }
  if (!selectors.length) return;
  // A <style> element's sheet is reported on that element, so the extension knows which tree
  // (document or shadow root) it styles. Constructed sheets can be adopted anywhere.
  const target = sheet.ownerNode ?? document;
  let set = pending.get(target);
  if (!set) pending.set(target, (set = new Set()));
  for (const s of selectors) set.add(s);
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      for (const [node, found] of pending) notify(node, RULES_EVENT, { selectors: [...found], constructed: node === document });
      pending.clear();
    }, 0);
  }
}

const insertRule = CSSStyleSheet.prototype.insertRule;
CSSStyleSheet.prototype.insertRule = function (this: CSSStyleSheet, rule: string, index?: number) {
  const at = insertRule.call(this, rule, index);
  try {
    const inserted = this.cssRules[at];
    if (inserted) report(this, [inserted]);
  } catch {
    /* ignore */
  }
  return at;
};

const replaceSync = CSSStyleSheet.prototype.replaceSync;
CSSStyleSheet.prototype.replaceSync = function (this: CSSStyleSheet, text: string) {
  replaceSync.call(this, text);
  report(this, this.cssRules);
};

const replace = CSSStyleSheet.prototype.replace;
CSSStyleSheet.prototype.replace = function (this: CSSStyleSheet, text: string) {
  return replace.call(this, text).then((sheet) => {
    report(sheet, sheet.cssRules);
    return sheet;
  });
};

// --- Page scripts see the site's own colors -------------------------------------------------------
//
// Apps read computed styles to make decisions: Office detects Windows High Contrast by checking
// whether a probe element kept its background-image, chart libraries paint canvases with colors
// read from CSS. Our theme (or the crush before it) would mislead them. For the properties our CSS
// overrides, the read is done with our CSS switched off for that one element (the same data-ute-m
// flag the extension measures with), so the page sees exactly what it would without us.

const getComputedStyleOriginal = window.getComputedStyle;
/** Exactly the properties the theme overrides (kebab-case). Widths, sizes, etc. are never touched. */
const OURS =
  /^-?(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|caret-color|webkit-text-fill-color|text-decoration(-color)?|filter|opacity|accent-color|color-scheme|scrollbar-color|css-text)$/;
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const MEDIA = new Set<string>(MEDIA_TAGS);
/**
 * Properties our CSS sets only on some elements (see css.ts): on any other, the page already sees its
 * own value, and reading it needs no restyle. Sites read these often, on large containers.
 */
const ONLY_ON: Record<string, (el: Element) => boolean> = {
  filter: (el) => el.hasAttribute('data-ute-g'),
  opacity: (el) => MEDIA.has(el.localName) && !el.hasAttribute('data-ute'),
};
/** Whether our CSS may change what the page reads for this property of this element. */
const isOurs = (el: Element, name: string) => {
  const prop = kebab(name);
  return OURS.test(prop) && (ONLY_ON[prop]?.(el) ?? true);
};

function themed(): boolean {
  const theme = document.documentElement?.getAttribute('data-ute-theme');
  return !!theme && theme !== 'off';
}

/**
 * Elements whose original colors page scripts are reading right now: our CSS stays off for them
 * until the script is done (a microtask), so reading several of an element's colors, or the same one
 * again, costs the browser one restyle instead of two per read. Nothing is painted in between.
 */
const reading = new Set<Element>();

function withOriginal<T>(el: Element, read: () => T): T {
  if (themed() && el.ownerDocument === document && !el.hasAttribute('data-ute-m')) {
    if (!reading.size) queueMicrotask(restoreOurs);
    reading.add(el);
    el.setAttribute('data-ute-nt', '');
    el.setAttribute('data-ute-m', '');
  }
  return read();
}

function restoreOurs() {
  const done = [...reading];
  reading.clear();
  for (const el of done) el.removeAttribute('data-ute-m');
  // Transitions come back once our CSS is styled in again, so switching back never animates.
  const release = () => {
    for (const el of done) if (!el.hasAttribute('data-ute-m')) el.removeAttribute('data-ute-nt');
  };
  if (document.visibilityState === 'hidden') {
    void getComputedStyleOriginal.call(window, done[0]!).color; // no frames: restyle now
    setTimeout(release, 0);
  } else {
    requestAnimationFrame(() => setTimeout(release, 0));
  }
}

window.getComputedStyle = function (this: Window, el: Element, pseudo?: string | null) {
  const real = getComputedStyleOriginal.call(this, el, pseudo);
  if (!(el instanceof Element)) return real;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'getPropertyValue') {
        return (name: string) => (isOurs(el, name) ? withOriginal(el, () => target.getPropertyValue(name)) : target.getPropertyValue(name));
      }
      if (typeof prop === 'string' && isOurs(el, prop)) return withOriginal(el, () => Reflect.get(target, prop, target));
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
} as typeof window.getComputedStyle;
