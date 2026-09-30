// When a page adds or changes CSS after we have measured, only elements matched by the new
// color rules need measuring again. These helpers find them.

const COLOR_PROPS = /(^|[;\s])(color|background|border|fill|stroke|box-shadow|outline|opacity|visibility|content)[\w-]*\s*:/i;
const DYNAMIC =
  /::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button|part\([^)]*\)|slotted\([^)]*\)|-webkit-[\w-]+|-moz-[\w-]+)|:(hover|focus|focus-visible|focus-within|active|visited|link|target|checked|disabled|enabled|host(-context)?(\([^)]*\))?)\b/g;

/** Selectors of the color-setting rules in a rule list ("*" when we cannot tell what they match). */
export function collectColorSelectors(rules: CSSRuleList, out: Set<string>) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      if (COLOR_PROPS.test(rule.style.cssText)) addSelector(rule.selectorText, out);
      if (rule.cssRules.length) out.add('*'); // CSS nesting: selectors are relative
    } else if (rule instanceof CSSImportRule) {
      if (rule.styleSheet) collectColorSelectors(rule.styleSheet.cssRules, out);
    } else if ('cssRules' in rule) {
      collectColorSelectors((rule as CSSGroupingRule).cssRules, out);
    }
  }
}

/** Adds a selector list, stripped of states we cannot query (:hover, ::before, :host…). */
export function addSelector(selectorText: string, out: Set<string>) {
  // Split the list, unless commas may be inside functions like :is(a, b).
  const parts = selectorText.includes('(') ? [selectorText] : selectorText.split(',');
  for (const part of parts) {
    const clean = part.replace(DYNAMIC, '').trim();
    out.add(!clean || /[>+~]$/.test(clean) || clean.includes('&') ? '*' : clean);
  }
}

/** querySelectorAll over many selectors in chunks; selectors the DOM API rejects are skipped. */
export function matchAll(scope: ParentNode, selectors: string[], found: Set<Element>) {
  const add = (list: NodeListOf<Element>) => list.forEach((el) => found.add(el));
  for (let i = 0; i < selectors.length; i += 100) {
    const chunk = selectors.slice(i, i + 100);
    try {
      add(scope.querySelectorAll(chunk.join(',')));
    } catch {
      for (const selector of chunk) {
        try {
          add(scope.querySelectorAll(selector));
        } catch {
          /* not a selector querySelectorAll understands */
        }
      }
    }
  }
}
