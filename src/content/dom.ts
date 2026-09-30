// Walking the page the way it renders: into shadow roots (open and closed), and with the
// flat-tree parent (slot or shadow host) as the parent an element inherits colors from.

/** Events sent by main-world.ts (the page's world) to this isolated world. */
export const SHADOW_EVENT = '__ute_shadow';
export const SHEETS_EVENT = '__ute_sheets';
export const RULES_EVENT = '__ute_rules';

export const SKIP_SUBTREE = new Set(['head', 'script', 'style', 'template', 'noscript', 'link', 'meta', 'title', 'base']);

/** The element this one inherits from and paints on top of: its slot, its shadow host, or its parent. */
export function flatParent(el: Element): Element | null {
  const slot = el.assignedSlot;
  if (slot) return slot;
  const parent = el.parentNode;
  if (parent instanceof ShadowRoot) return parent.host;
  return el.parentElement;
}

/**
 * The element's shadow root, closed ones included (chrome.dom can see those). Custom elements
 * are the usual hosts; other elements are checked only when asked, since the lookup is not free.
 */
export function shadowRootOf(el: Element, anyElement = false): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  if (!(el instanceof HTMLElement) || (!anyElement && !el.localName.includes('-'))) return null;
  try {
    return chrome.dom.openOrClosedShadowRoot(el) ?? null;
  } catch {
    return null;
  }
}

/**
 * Visits `start` and everything rendered under it in flat-tree order: an element, then its shadow
 * tree (so slots come before the content slotted into them), then its light-DOM children.
 */
export function walk(
  start: Element | ShadowRoot,
  visit: (el: Element) => void,
  onShadowRoot: (root: ShadowRoot) => void,
  findRoot: (el: Element) => ShadowRoot | null = shadowRootOf,
) {
  const stack: Array<Element | ShadowRoot> = [start];
  while (stack.length) {
    const node = stack.pop()!;
    const children: Element[] = [];
    if (node instanceof ShadowRoot) {
      for (let c = node.firstElementChild; c; c = c.nextElementSibling) children.push(c);
    } else {
      if (SKIP_SUBTREE.has(node.localName)) continue;
      visit(node);
      for (let c = node.firstElementChild; c; c = c.nextElementSibling) children.push(c);
      const root = findRoot(node);
      if (root) {
        onShadowRoot(root);
        children.unshift(...[...root.children]); // shadow content first
      }
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}

/**
 * Every shadow root we theme gets one shared constructed stylesheet: document styles do not
 * reach inside shadow trees, but inherited custom properties (the theme's colors) do.
 */
export class ShadowRoots {
  readonly sheet = new CSSStyleSheet();
  private roots = new Set<ShadowRoot>();
  private byHost = new WeakMap<Element, ShadowRoot>();

  constructor(private readonly onNewRoot: (root: ShadowRoot) => void) {}

  has(root: ShadowRoot): boolean {
    return this.roots.has(root);
  }

  /** Starts theming a root; returns false if it was already known. */
  add(root: ShadowRoot): boolean {
    this.ensureAdopted(root);
    if (this.roots.has(root)) return false;
    this.roots.add(root);
    this.byHost.set(root.host, root);
    this.onNewRoot(root);
    return true;
  }

  /** Pages may replace adoptedStyleSheets wholesale (Lit does, right after attachShadow). */
  ensureAdopted(root: ShadowRoot) {
    try {
      if (!root.adoptedStyleSheets.includes(this.sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.sheet];
    } catch {
      /* a root from another document; leave it */
    }
  }

  /** The root of a host, including closed roots we were told about that a page walk cannot see. */
  rootOf(host: Element): ShadowRoot | null {
    return this.byHost.get(host) ?? shadowRootOf(host);
  }

  /** Known roots whose hosts are still in the page (others are dropped; they are found again if re-inserted). */
  all(): ShadowRoot[] {
    for (const root of this.roots) if (!root.host.isConnected) this.roots.delete(root);
    return [...this.roots];
  }

  setCss(css: string) {
    this.sheet.replaceSync(css);
  }
}
