// Runs at document_start in every frame.
//
// Lifecycle of an element:
//   1. It appears (parser or script). Our CSS already crushes it to the theme's base color —
//      inside shadow roots too, where we adopt the same rules as a constructed stylesheet.
//   2. We flag it with data-ute-m, which switches our CSS off for that element only, read its
//      original colors synchronously (nothing is painted in between), and unflag it. Copies of an
//      element already measured twice with the same result reuse that measurement instead.
//   3. If Jev has labeled that look before (per-site cache), the labels are applied at once.
//      Otherwise it stays crushed while Jev decides, then gets its labels.
//   4. Boxes with nothing to decide (transparent, inherited) are resolved without asking Jev.

import { flatParent, RULES_EVENT, SHADOW_EVENT, SHEETS_EVENT, ShadowRoots, shadowRootOf, walk } from './dom.ts';
import { MeasurePass, originals, type Job, type Plan } from './measure.ts';
import { scrambleText } from './scramble.ts';
import { StyleMemo } from './memo.ts';
import { addSelector, collectColorSelectors, matchAll } from './styles.ts';
import type { LabelRequest, LabelResponse, StatusQuery, TabStatus } from '../shared/messages.ts';
import {
  cacheKey,
  CUSTOM_THEMES_KEY,
  isExpired,
  loadCustomThemes,
  loadSettings,
  modeFor,
  SETTINGS_KEY,
  themeCssKey,
  themeFor,
  type HostCache,
  type Settings,
} from '../shared/settings.ts';
import type { Labels } from '../shared/tokens.ts';
import { shadowCss, themeVarsCss } from '../themes/css.ts';
import { isBuiltin, type CustomThemes } from '../themes/index.ts';

const MAX_JOBS_PER_MESSAGE = 10;
/**
 * Real measurements per flush (30-60µs each; remembered ones are nearly free). Switching our CSS
 * off for a container restyles everything that inherits from it, so while a page loads — when it is
 * crushed anyway — a few large batches are far cheaper than many small ones.
 */
const MAX_MEASURED_WHILE_LOADING = 3000;
const MAX_MEASURED_PER_FLUSH = 600;
/** Inside a MutationObserver callback, before the next paint, stay well under a frame. */
const MAX_MEASURED_SYNC = 120;
const MAX_PER_FLUSH = 5000;
const MIN_FLUSH_GAP_MS = 30;
/** A class change re-measures the element's subtree only when the subtree is this small. */
const MAX_RESTYLE_SUBTREE = 400;
const MAX_ATTEMPTS = 5;
/** Canvases often draw after they are inserted; look again at these delays. */
const CANVAS_RETRIES_MS = [300, 1000, 3000, 8000];
const COLORISH = /(color|background|border|fill|stroke|outline)[^;]*/gi;
const OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeOldValue: true,
  attributeFilter: ['class', 'style', 'src', 'srcset'],
};

const root = document.documentElement;
/** Labels are cached per document origin: they describe this frame's own elements. */
const host = originHost();
/** The theme follows the tab's site, so a spreadsheet frame on another host matches its page. */
const siteHost = topHost();

let settings: Settings | undefined;
let customThemes: CustomThemes = {};
let cache: HostCache = {};
let theme = 'off';
let active = false;
/** Set once render-blocking stylesheets have loaded (first animation frame), so measurements are real. */
let ready = false;
let fatalError: string | undefined;
let lastError: string | undefined;
let resolvedCount = 0;
let pageWords = '';

const plansOf = new WeakMap<Element, Plan[]>();
const waiting = new Map<string, Set<Element>>();
const queued = new Map<string, Job>();
const inflight = new Set<string>();
const attempts = new Map<string, number>();
const dirty = new Set<Element>();
/** Elements whose styles changed under them: measure for real, never from memory. */
const restyled = new WeakSet<Element>();
const canvasTries = new WeakMap<Element, number>();
const memo = new StyleMemo();
const shadows = new ShadowRoots(onNewShadowRoot);
/**
 * Hosts whose shadow roots were attached before theming started (inline scripts run while settings
 * load). Closed roots on plain elements cannot be found later by walking the page, so remember them.
 */
const earlyHosts = new Set<Element>();
let shadowSheetCss: string | undefined;
/** The active theme's colors (variables); the shared rules come from themes.css. */
const themeSheet = new CSSStyleSheet();
let applying = 0;

function originHost(): string {
  try {
    // about:blank and srcdoc frames inherit their parent's origin.
    if (self.origin && self.origin !== 'null') return new URL(self.origin).hostname || location.protocol.replace(':', '');
  } catch {
    /* fall through */
  }
  return location.hostname || location.protocol.replace(':', '');
}

function topHost(): string {
  const ancestors = location.ancestorOrigins;
  const top = ancestors && ancestors.length ? ancestors[ancestors.length - 1] : undefined;
  try {
    if (top && top !== 'null') return new URL(top).hostname || host;
  } catch {
    /* fall through */
  }
  return host;
}

// ---------------------------------------------------------------------------------------------
// Startup and settings

async function start() {
  if (!root) return;
  for (const type of [SHADOW_EVENT, SHEETS_EVENT, RULES_EVENT]) window.addEventListener(type, onPageEvent, true);
  const [loaded, custom, stored] = await Promise.all([loadSettings(), loadCustomThemes(), chrome.storage.local.get(cacheKey(host))]);
  settings = loaded;
  customThemes = custom;
  cache = (stored[cacheKey(host)] as HostCache | undefined) ?? {};
  chrome.storage.onChanged.addListener(onStorageChanged);
  await applySettings();
}

/**
 * The active theme's variables: a custom theme carries them compiled; a built-in theme's are
 * compiled by the background once and then read from storage.
 */
async function themeVars(id: string): Promise<string> {
  if (!isBuiltin(id)) {
    const custom = customThemes[id];
    return custom ? themeVarsCss(custom.compiled) : '';
  }
  const stored = (await chrome.storage.local.get(themeCssKey(id)))[themeCssKey(id)] as string | undefined;
  return stored ?? ((await chrome.runtime.sendMessage({ type: 'theme-css', id }).catch(() => '')) as string);
}

async function applySettings() {
  const next = settings && themeFor(settings, siteHost, customThemes);
  const attempt = ++applying;
  if (!next || fatalError) {
    theme = 'off';
    root.setAttribute('data-ute-theme', 'off');
    shadows.setCss('');
    themeSheet.replaceSync('');
    earlyHosts.clear();
    stop();
    report();
    return;
  }
  // Until the variables are in, the page stays crushed by the first-paint stylesheet (or keeps
  // showing the previous theme). Editing a custom theme recolors open pages live.
  const vars = await themeVars(next.id);
  if (attempt !== applying) return; // settings changed again meanwhile
  theme = next.id;
  themeSheet.replaceSync(vars);
  ensureDocumentSheet();
  root.setAttribute('data-ute-theme', next.id);
  shadows.setCss((shadowSheetCss ??= shadowCss()));
  if (!active) begin();
}

function begin() {
  active = true;
  chrome.runtime.sendMessage({ type: 'inject-user-css' }).catch(() => undefined);
  observer.observe(document, OBSERVE);
  for (const shadowRoot of shadows.all()) observer.observe(shadowRoot, OBSERVE);
  for (const early of earlyHosts) {
    const shadowRoot = shadowRootOf(early, true);
    if (shadowRoot) shadows.add(shadowRoot);
  }
  earlyHosts.clear();
  markSubtree(root);
  report();
  // The first animation frame only runs once render-blocking stylesheets are in, and still before
  // the first paint: the earliest moment an element's computed colors are the site's real ones.
  // Frames that never render (hidden iframes, background tabs) get there through "load" instead.
  if (ready) flush();
  else {
    requestAnimationFrame(onFirstFrame);
    if (document.readyState === 'complete') setTimeout(onFirstFrame, 0);
    else window.addEventListener('load', onFirstFrame, { once: true });
  }
}

function onFirstFrame() {
  if (!active || ready) return;
  ready = true;
  root.setAttribute('data-ute-m', '');
  new MeasurePass(host, new Set([root])).measureRoot(root);
  root.removeAttribute('data-ute-m');
  flush();
}

function stop() {
  active = false;
  observer.disconnect();
  dirty.clear();
}

function ensureDocumentSheet() {
  if (!document.adoptedStyleSheets.includes(themeSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet];
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== 'local') return;
  if (changes[CUSTOM_THEMES_KEY]) {
    customThemes = (changes[CUSTOM_THEMES_KEY].newValue as CustomThemes | undefined) ?? {};
    if (settings) applySettings();
  }
  if (changes[SETTINGS_KEY]) {
    loadSettings().then((s) => {
      settings = s;
      applySettings();
    });
  }
  const mine = changes[cacheKey(host)];
  if (!mine) return;
  if (!mine.newValue) {
    cache = {}; // re-layout requested
    return;
  }
  const next = mine.newValue as HostCache;
  const fresh = Object.keys(next).filter((sig) => !cache[sig] || cache[sig]!.t < next[sig]!.t);
  cache = { ...cache, ...next };
  for (const sig of fresh) resolveSig(sig);
  report();
}

// ---------------------------------------------------------------------------------------------
// Watching the page (and its shadow roots)

let lastFlush = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    const target = m.target as Element;
    if (m.type === 'childList') {
      if (target.localName === 'style') stylesheetsChanged([target]);
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        if (isStylesheet(el)) stylesheetsChanged([el]);
        else if (target !== document.head && !document.head?.contains(target)) markSubtree(el);
      }
    } else if (m.type === 'attributes' && target !== root && target.hasAttribute('data-ute')) {
      if (m.attributeName === 'style' && colorish(m.oldValue) === colorish(target.getAttribute('style'))) continue;
      // Class changes can restyle descendants too; re-measure small subtrees, not the whole page.
      if (target.getElementsByTagName('*').length <= MAX_RESTYLE_SUBTREE) markSubtree(target);
      else dirty.add(target);
    }
  }
  // Once the page has loaded, MutationObserver callbacks (which run before the next paint) process
  // small changes right away, so known looks land without ever being painted crushed. While the
  // page is still loading, changes are batched instead.
  if (!loading() && performance.now() - lastFlush > MIN_FLUSH_GAP_MS) flush(true);
  else scheduleFlush();
});

function loading(): boolean {
  return document.readyState !== 'complete';
}

function onNewShadowRoot(shadowRoot: ShadowRoot) {
  if (active) observer.observe(shadowRoot, OBSERVE);
  // Events from main-world.ts about things inside this root stop at the root; listen there.
  for (const type of [SHADOW_EVENT, SHEETS_EVENT, RULES_EVENT]) shadowRoot.addEventListener(type, onPageEvent, true);
}

/** Reports from main-world.ts: shadow roots attached, stylesheets adopted, CSS rules inserted. */
function onPageEvent(event: Event) {
  const target = event.target as Node;
  if (!active) {
    // Before settings have loaded we do not know yet whether this page will be themed.
    if (event.type === SHADOW_EVENT && !settings && target instanceof Element) earlyHosts.add(target);
    return;
  }
  const detail = (event as CustomEvent<{ selectors?: string[]; constructed?: boolean } | null>).detail;
  if (event.type === SHADOW_EVENT) {
    // Adopt our sheet synchronously, inside attachShadow, before the component renders anything.
    const shadowRoot = target instanceof Element ? shadowRootOf(target, true) : null;
    if (shadowRoot) shadows.add(shadowRoot);
    if (target instanceof Element && target.isConnected) {
      markSubtree(target); // upgrading can restyle the host itself
      scheduleFlush();
    }
  } else if (event.type === SHEETS_EVENT) {
    const shadowRoot = target instanceof Element ? shadowRootOf(target, true) : null;
    if (shadowRoot) shadows.ensureAdopted(shadowRoot);
    else if (theme !== 'off') ensureDocumentSheet(); // the page replaced document.adoptedStyleSheets
    restyle(shadowRoot ?? document, detail?.selectors ?? ['*']);
  } else if (event.type === RULES_EVENT) {
    restyle(detail?.constructed ? 'everywhere' : (target.getRootNode() as Document | ShadowRoot), detail?.selectors ?? ['*']);
  }
}

function colorish(style: string | null): string {
  return (style?.match(COLORISH) ?? []).join(';');
}

function isStylesheet(el: Element): boolean {
  return el.localName === 'style' || (el.localName === 'link' && /stylesheet/i.test(el.getAttribute('rel') ?? ''));
}

function markSubtree(start: Element, styleChanged = false) {
  walk(
    start,
    (el) => {
      if (el === root) return;
      dirty.add(el);
      if (styleChanged) restyled.add(el);
    },
    (shadowRoot) => shadows.add(shadowRoot),
    (el) => shadows.rootOf(el),
  );
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(
    () => {
      flushTimer = undefined;
      flush();
    },
    Math.max(0, MIN_FLUSH_GAP_MS - (performance.now() - lastFlush)),
  );
}

// ---------------------------------------------------------------------------------------------
// CSS that arrives after the first paint: re-measure only what it can affect

type Scope = Document | ShadowRoot | 'everywhere';
const pendingRestyles = new Map<Scope, Set<string>>();
let restyleTimer: ReturnType<typeof setTimeout> | undefined;

/** A <style> or <link> was added or edited. */
function stylesheetsChanged(owners: Iterable<Element>) {
  if (!ready) return;
  for (const owner of owners) {
    const sheet = (owner as HTMLStyleElement | HTMLLinkElement).sheet;
    if (!sheet && owner.localName === 'link') {
      owner.addEventListener('load', () => stylesheetsChanged([owner]), { once: true });
      continue;
    }
    const selectors = new Set<string>();
    try {
      if (sheet) collectColorSelectors(sheet.cssRules, selectors);
    } catch {
      selectors.add('*'); // cross-origin without CORS: we cannot see which elements it affects
    }
    restyle(owner.getRootNode() as Document | ShadowRoot, [...selectors]);
  }
}

function restyle(scope: Scope, selectors: string[]) {
  if (!ready || !selectors.length) return;
  let set = pendingRestyles.get(scope);
  if (!set) pendingRestyles.set(scope, (set = new Set()));
  for (const s of selectors) addSelector(s, set);
  clearTimeout(restyleTimer);
  restyleTimer = setTimeout(processRestyles, 150);
}

function processRestyles() {
  if (!active) return;
  const found = new Set<Element>();
  let everything = false;
  for (const [scope, selectors] of pendingRestyles) {
    const scopes: Array<Document | ShadowRoot> = scope === 'everywhere' ? [document, ...shadows.all()] : [scope];
    for (const s of scopes) {
      if (selectors.has('*')) {
        if (s === document) everything = true;
        else markSubtree((s as ShadowRoot).host, true);
      } else {
        matchAll(s, [...selectors], found);
      }
    }
  }
  pendingRestyles.clear();
  if (everything) markSubtree(root, true);
  for (const el of found) {
    if (el.getElementsByTagName('*').length <= MAX_RESTYLE_SUBTREE) markSubtree(el, true);
    else {
      dirty.add(el);
      restyled.add(el);
    }
  }
  flush();
}

// ---------------------------------------------------------------------------------------------
// Measuring and labeling

function flush(sync = false) {
  if (!active || !ready || !dirty.size) return;
  lastFlush = performance.now();

  // Parents were added to `dirty` before their children, so they are processed first.
  const toMeasure: Element[] = [];
  const keys = new Map<Element, number | undefined>();
  const results: Array<[Element, Plan[]]> = [];
  const maxMeasured = sync ? MAX_MEASURED_SYNC : loading() ? MAX_MEASURED_WHILE_LOADING : MAX_MEASURED_PER_FLUSH;
  let taken = 0;
  for (const el of dirty) {
    if (toMeasure.length >= maxMeasured || taken >= MAX_PER_FLUSH) break;
    dirty.delete(el);
    taken++;
    if (!el.isConnected) continue;
    const key = memo.keyFor(el, flatParent(el));
    const recalled = key !== undefined && !restyled.has(el) ? memo.recall(el, key) : undefined;
    if (recalled) {
      originals.set(el, recalled.original);
      results.push([el, recalled.plans]);
    } else {
      keys.set(el, key);
      toMeasure.push(el);
    }
  }

  // Transitions stay off (data-ute-nt) from before the switch until after the switch back has been
  // styled: otherwise the browser reports colors mid-animation, and the site's own transitions
  // would animate its original colors into view.
  for (const el of toMeasure) {
    el.setAttribute('data-ute-nt', '');
    el.setAttribute('data-ute-m', '');
  }
  try {
    const pass = new MeasurePass(host, new Set(toMeasure));
    for (const el of toMeasure) {
      const plans = pass.measure(el);
      results.push([el, plans]);
      const key = keys.get(el);
      if (key !== undefined && !plans.some((p) => p.deferred || p.retry)) memo.learn(key, plans, originals.get(el)!, restyled.has(el));
      restyled.delete(el);
    }
    pageWords = pass.page;
  } finally {
    for (const el of toMeasure) el.removeAttribute('data-ute-m');
    releaseTransitions(toMeasure);
  }

  for (const [el, plans] of results) settle(el, plans);
  sendQueued();
  report();
  if (dirty.size) scheduleFlush();
}

function settle(el: Element, plans: Plan[]) {
  if (plans[0]?.deferred) {
    // Stays crushed (invisible) until it has pixels; then it is measured for real.
    el.addEventListener('load', () => (markSubtree(el), scheduleFlush()), { once: true });
    return;
  }
  if (plans[0]?.retry) retryCanvas(el);
  plansOf.set(el, plans);
  let missing = false;
  for (const plan of plans) {
    if (!plan.job) continue;
    const entry = cache[plan.job.sig];
    if (!entry) {
      missing = true;
      queue(plan.job);
      let set = waiting.get(plan.job.sig);
      if (!set) waiting.set(plan.job.sig, (set = new Set()));
      set.add(el);
    } else if (settings && isExpired(entry, settings)) {
      queue(plan.job); // stale: keep showing it while Jev lays the site out again
    }
  }
  // A brand-new element stays crushed until every box on it is labeled; an already-themed
  // element whose styling changed keeps its old labels until the new ones arrive.
  if (!missing) apply(el, plans);
}

const transitionHolds = new WeakMap<Element, number>();
let holdCounter = 0;

/**
 * Transitions come back only after the browser has restyled these elements without our measuring
 * flag (normally in the next frame, together with the labels just applied); otherwise the switch
 * from the site's colors back to ours would animate. A later measurement of the same element
 * renews its hold.
 */
function releaseTransitions(els: Element[]) {
  if (!els.length) return;
  const hold = ++holdCounter;
  for (const el of els) transitionHolds.set(el, hold);
  const release = () => {
    for (const el of els) if (transitionHolds.get(el) === hold) el.removeAttribute('data-ute-nt');
  };
  if (document.visibilityState === 'hidden') {
    void getComputedStyle(els[0]!).color; // nothing is painted; restyle now instead of waiting for a frame
    setTimeout(release, 0);
  } else {
    requestAnimationFrame(() => setTimeout(release, 0));
  }
}

/** A canvas with nothing drawn yet is labeled as-is, then looked at again once it has drawn. */
function retryCanvas(el: Element) {
  const tries = canvasTries.get(el) ?? 0;
  const delay = CANVAS_RETRIES_MS[tries];
  if (delay === undefined) return;
  canvasTries.set(el, tries + 1);
  setTimeout(() => {
    if (!active || !el.isConnected) return;
    dirty.add(el);
    restyled.add(el);
    scheduleFlush();
  }, delay);
}

function resolveSig(sig: string) {
  const els = waiting.get(sig);
  if (!els) return;
  waiting.delete(sig);
  for (const el of els) {
    const plans = plansOf.get(el);
    if (plans && plans.every((p) => !p.job || cache[p.job.sig])) apply(el, plans);
  }
}

function setAttr(el: Element, name: string, value: string | undefined) {
  if (value === undefined) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function apply(el: Element, plans: Plan[]) {
  const seen = new Set<string>();
  for (const plan of plans) {
    const prefix = plan.pseudo ? `data-ute-${plan.pseudo}` : 'data-ute';
    seen.add(prefix);
    const l: Labels = (plan.job && cache[plan.job.sig]?.l) || {};
    // Re-tinted line art keeps its own background: the filter maps that paper to the page color.
    const retinted = !plan.pseudo && l.graphic === 'lineart' && plan.paper !== undefined;
    setAttr(el, `${prefix}-bg`, retinted ? 'content' : l.bg);
    setAttr(el, `${prefix}-fg`, l.fg);
    setAttr(el, `${prefix}-ink`, l.ink);
    setAttr(el, `${prefix}-bd`, l.border);
    setAttr(el, `${prefix}-strip`, plan.bgImage === 'strip' ? '' : undefined);
    if (!plan.pseudo) {
      setAttr(el, 'data-ute-g', l.graphic);
      setAttr(el, 'data-ute-paper', l.graphic === 'lineart' ? plan.paper : undefined);
      setAttr(el, 'data-ute-paint', plan.paint);
    }
  }
  for (const prefix of ['data-ute-before', 'data-ute-after']) {
    if (seen.has(prefix)) continue;
    for (const suffix of ['-bg', '-fg', '-ink', '-bd', '-strip']) setAttr(el, prefix + suffix, undefined);
  }
  if (!el.hasAttribute('data-ute')) {
    el.setAttribute('data-ute', '');
    resolvedCount++;
  }
}

function queue(job: Job) {
  if (!inflight.has(job.sig) && !queued.has(job.sig)) queued.set(job.sig, job);
}

/** The job with its text scrambled (privacy mode). Scrambled here, as it leaves the page, so no path sends plain text. */
function scrambled(job: Job): Job {
  return job.facts.text === undefined ? job : { ...job, facts: { ...job.facts, text: scrambleText(job.facts.text) } };
}

function sendQueued() {
  if (fatalError) return;
  const jobs = [...queued.values()];
  queued.clear();
  for (let i = 0; i < jobs.length; i += MAX_JOBS_PER_MESSAGE) {
    const batch = jobs.slice(i, i + MAX_JOBS_PER_MESSAGE);
    for (const job of batch) inflight.add(job.sig);
    const request: LabelRequest = { type: 'label', host, page: pageWords, jobs: settings && modeFor(settings, host) === 'privacy' ? batch.map(scrambled) : batch };
    chrome.runtime
      .sendMessage(request)
      .then((res: LabelResponse) => onLabels(batch, res))
      .catch((err: Error) => onLabels(batch, { ok: false, error: err.message, fatal: false }));
  }
}

function onLabels(batch: Job[], res: LabelResponse) {
  for (const job of batch) inflight.delete(job.sig);
  if (res.ok) {
    const now = Date.now();
    for (const [sig, l] of Object.entries(res.labels)) {
      cache[sig] = { l, t: now };
      resolveSig(sig);
    }
  } else if (res.fatal) {
    // Without a working key nothing can ever be labeled: show the page as the site made it.
    fatalError = res.error;
    applySettings();
  } else {
    lastError = res.error;
    for (const job of batch) {
      const n = (attempts.get(job.sig) ?? 0) + 1;
      attempts.set(job.sig, n);
      if (n < MAX_ATTEMPTS) setTimeout(() => (queue(job), sendQueued()), 1000 * 2 ** (n - 1));
    }
  }
  report();
}

// ---------------------------------------------------------------------------------------------
// Status for the toolbar badge, the popup, and tests

let reportTimer: ReturnType<typeof setTimeout> | undefined;

function status(): TabStatus {
  const stuck = waiting.size > 0 && !inflight.size && !queued.size;
  return {
    host: siteHost,
    theme,
    pending: waiting.size + queued.size,
    labeled: resolvedCount,
    cached: Object.keys(cache).length,
    error: fatalError ?? (stuck ? lastError : undefined),
  };
}

function report() {
  const s = status();
  root.setAttribute('data-ute-status', s.error ? 'error' : theme === 'off' ? 'off' : s.pending || dirty.size || !ready ? 'working' : 'ready');
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = undefined;
    if (window === window.top) chrome.runtime.sendMessage({ type: 'status', ...status() }).catch(() => undefined);
  }, 150);
}

chrome.runtime.onMessage.addListener((message: StatusQuery, _sender, sendResponse) => {
  if (message.type === 'get-status' && window === window.top) sendResponse(status());
  return false;
});

start();
