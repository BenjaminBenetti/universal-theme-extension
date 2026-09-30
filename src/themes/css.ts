// Builds the extension's stylesheets from theme tokens.
//
// Everything is keyed on attributes the content script sets:
//   html[data-ute-theme=<id>]      which theme is active ("off" disables everything)
//   [data-ute-m]                   our CSS switched off for this element during one synchronous read of its own colors
//   [data-ute]                     Jev (or code, when there was nothing to decide) has resolved this element
//   [data-ute-bg|fg|bd|g]          the tokens Jev picked; [data-ute-before-*] / [data-ute-after-*] for pseudo-elements
// Anything without [data-ute] is "crushed" to the theme's base color, so pages never flash their original colors.
//
// Each theme only defines custom properties on <html> (see themeVarsCss); one shared set of rules
// reads them. Pages receive only their active theme's variables, so shipping many themes costs
// pages nothing.
//
// Rules live in `@layer ute` and use !important: an early-declared layer's important rules beat every
// important rule of the page's own stylesheets. The same file is also injected with USER origin
// (see background), which additionally beats inline `style="... !important"`.
//
// Document styles do not reach into shadow roots, so the content script adopts `shadowCss()` —
// the same rules without the document-level guard — into every shadow root it themes.

import { retintFilter, tintFilter } from './filters.ts';
import { baseOf, FIELDS, SOLID_BG, type ThemeDefinition } from './format.ts';
import type { CompiledTheme } from './index.ts';

const MEDIA = 'img, video, canvas, iframe, embed, object, picture, image';
const BOXES = [
  { suffix: '', attr: 'data-ute' },
  { suffix: '::before', attr: 'data-ute-before' },
  { suffix: '::after', attr: 'data-ute-after' },
] as const;

/** A theme is active (document scope). */
const DOCUMENT_ON = ':root[data-ute-theme]:not([data-ute-theme="off"])';
/** Appended to every subject: the element is not being measured right now. */
const M = ':not([data-ute-m])';

function crushDeclarations(base: string): string {
  return [
    `background-color: ${base} !important`,
    'background-image: none !important',
    `color: ${base} !important`,
    `border-color: ${base} !important`,
    `outline-color: ${base} !important`,
    'box-shadow: none !important',
    'text-shadow: none !important',
    `text-decoration-color: ${base} !important`,
    `-webkit-text-fill-color: ${base} !important`,
    `caret-color: ${base} !important`,
    `fill: ${base} !important`,
    `stroke: ${base} !important`,
  ].join('; ');
}

/**
 * Compiles a theme into the CSS custom properties our shared rules read: at build time for
 * built-in themes, when saved in the editor for custom ones.
 */
export function compileTheme(theme: ThemeDefinition): CompiledTheme {
  const vars: Record<string, string> = {
    '--ute-base': baseOf(theme),
    '--ute-visited': theme.interface.visitedLink,
    '--ute-selection-bg': theme.interface.selection,
    '--ute-selection-fg': theme.interface.selectionText,
    '--ute-scrollbar': `${theme.interface.scrollbarThumb} ${theme.interface.scrollbarTrack}`,
    '--ute-icon-filter': tintFilter(theme.text.text),
    // Line art (canvas grids, document pages, wordmarks): its paper becomes the page, its ink the text.
    '--ute-retint-light-paper': retintFilter('light', theme.background.page, theme.text.text),
    '--ute-retint-dark-paper': retintFilter('dark', theme.background.page, theme.text.text),
  };
  for (const [token, color] of Object.entries(theme.background)) vars[`--ute-bg-${token}`] = color;
  for (const [token, color] of Object.entries(theme.text)) vars[`--ute-fg-${token}`] = color;
  for (const [token, color] of Object.entries(theme.border)) vars[`--ute-bd-${token}`] = color;
  for (const [token, color] of Object.entries(theme.textOnFill)) vars[`--ute-on-${token}`] = color;
  return { id: theme.id, name: theme.name, ...(theme.family ? { family: theme.family } : {}), mode: theme.mode, vars };
}

/** One theme's block: its variables, scoped to the attribute the content script sets. */
export function themeCss(theme: CompiledTheme): string {
  const vars = Object.entries(theme.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
  // color-scheme and scrollbar-color can change layout, so they are not switched off while measuring.
  return `:root[data-ute-theme="${theme.id}"] { ${vars} color-scheme: ${theme.mode} !important; }`;
}

/**
 * The active theme's variables, adopted into the page by the content script. Pages only ever get
 * the theme they use; the static stylesheet holds just the shared rules.
 */
export function themeVarsCss(theme: CompiledTheme): string {
  return `@layer ute {\n${themeCss(theme)}\n}\n`;
}

/** Token names every theme defines, from the theme format. */
function tokenNames() {
  const keys = (group: string) => FIELDS.filter((f) => f.group === group).map((f) => f.key);
  return { bg: keys('background'), fg: keys('text'), border: keys('border') };
}

/**
 * The rules every theme shares. `scope` prefixes each selector: the active-theme guard for the
 * document, nothing inside a shadow root (the content script empties that sheet when theming is off).
 */
function sharedCss(tokens: ReturnType<typeof tokenNames>, scope: 'document' | 'shadow'): string {
  const out: string[] = [];
  const rule = (selector: string, body: string) => out.push(`${selector} { ${body} }`);
  const ON = scope === 'document' ? DOCUMENT_ON : '';

  // While being measured (and while switching back) transitions are off: otherwise the browser
  // reports a color mid-animation, and the switch back would animate the site's colors into view.
  rule(`${ON} [data-ute-nt]`, 'transition: none !important');

  if (scope === 'document') {
    // The canvas.
    rule(`${ON}${M}`, 'background-color: var(--ute-bg-page) !important; color: var(--ute-fg-text) !important');
    rule(ON, 'scrollbar-color: var(--ute-scrollbar) !important; accent-color: var(--ute-bd-accent) !important');
  }
  rule(
    `${ON} ::selection`,
    'background-color: var(--ute-selection-bg) !important; color: var(--ute-selection-fg) !important; -webkit-text-fill-color: var(--ute-selection-fg) !important',
  );

  // Crushed: not yet labeled by Jev.
  rule(`${ON} :not([data-ute])${M}, ${ON} :not([data-ute])${M}::before, ${ON} :not([data-ute])${M}::after`, crushDeclarations('var(--ute-base)'));
  rule(`${ON} :not([data-ute])${M}::placeholder`, 'color: var(--ute-base) !important; -webkit-text-fill-color: var(--ute-base) !important');
  rule(`${ON} :is(${MEDIA}):not([data-ute])${M}`, 'opacity: 0 !important');
  // Shapes inside an unlabeled <svg> stay crushed even once measured.
  rule(`${ON} svg:not([data-ute]) *${M}`, 'fill: var(--ute-base) !important; stroke: var(--ute-base) !important');

  // Resolved defaults: nothing leaks from the site's own palette unless Jev said to keep it.
  // :where() keeps these at the same specificity as the token rules below, which then win by order.
  for (const { suffix, attr } of BOXES) {
    rule(`${ON} [data-ute]${M}:where(:not([${attr}-bg="content"]))${suffix}`, 'background-color: transparent !important');
    rule(`${ON} [data-ute]${M}:where(:not([${attr}-fg="content"]))${suffix}`, 'color: inherit !important');
    rule(`${ON} [data-ute]${M}:where(:not([${attr}-bd="content"]))${suffix}`, 'border-color: transparent !important');
    rule(
      `${ON} [data-ute]${M}${suffix}`,
      'text-shadow: none !important; -webkit-text-fill-color: currentColor !important; text-decoration-color: currentColor !important; ' +
        'caret-color: currentColor !important; outline-color: var(--ute-bd-accent) !important',
    );
    rule(`${ON} [${attr}-strip]${M}${suffix}`, 'background-image: none !important');
  }
  rule(`${ON} [data-ute]${M}::placeholder`, 'color: var(--ute-fg-faint) !important; -webkit-text-fill-color: var(--ute-fg-faint) !important');

  // Token → color. One attribute per selector so the browser only checks elements that carry it.
  for (const { suffix, attr } of BOXES) {
    for (const token of tokens.bg) rule(`${ON} [${attr}-bg="${token}"]${M}${suffix}`, `background-color: var(--ute-bg-${token}) !important`);
    for (const token of tokens.fg) rule(`${ON} [${attr}-fg="${token}"]${M}${suffix}`, `color: var(--ute-fg-${token}) !important`);
    for (const token of tokens.border) rule(`${ON} [${attr}-bd="${token}"]${M}${suffix}`, `border-color: var(--ute-bd-${token}) !important`);
    for (const token of tokens.fg) rule(`${ON} [${attr}-ink="${token}"]${M}${suffix}`, `background-color: var(--ute-fg-${token}) !important`);
  }
  rule(`${ON} a[data-ute-fg="link"]${M}:visited`, 'color: var(--ute-visited) !important');

  // Legibility guard (must come after the fg rules): text on a solid fill always uses that fill's
  // on-color, and labeled text inside it inherits instead of keeping a color picked for the page.
  for (const solid of SOLID_BG) {
    for (const { suffix, attr } of BOXES) rule(`${ON} [${attr}-bg="${solid}"]${M}${suffix}`, `color: var(--ute-on-${solid}) !important`);
    rule(`${ON} [data-ute-bg="${solid}"] [data-ute-fg]:not([data-ute-bg]):not([data-ute-fg="content"])${M}`, 'color: inherit !important');
  }

  // Graphics Jev marked as single-color icons take the current text color.
  const icon = `${ON} svg[data-ute-g="icon"]`;
  rule(`${icon} [data-ute-paint="fill"]${M}, ${icon} [data-ute-paint="both"]${M}`, 'fill: currentColor !important');
  rule(`${icon} [data-ute-paint="stroke"]${M}, ${icon} [data-ute-paint="both"]${M}`, 'stroke: currentColor !important');
  rule(`${ON} :not(svg, canvas)[data-ute-g="icon"]${M}`, 'filter: var(--ute-icon-filter) !important');
  // Line art (Jev's call) re-tinted from the paper it was drawn on (code's measurement).
  rule(`${ON} [data-ute-g="lineart"][data-ute-paper="light"]${M}`, 'filter: var(--ute-retint-light-paper) !important');
  rule(`${ON} [data-ute-g="lineart"][data-ute-paper="dark"]${M}`, 'filter: var(--ute-retint-dark-paper) !important');

  return out.join('\n');
}

/** The rules every theme shares, shipped as the content-script stylesheet (themes.css). */
export function sharedStylesheet(): string {
  return `/* Generated by scripts/build.mjs — do not edit. */\n@layer ute {\n${sharedCss(tokenNames(), 'document')}\n}\n`;
}

/** The stylesheet adopted into shadow roots while a theme is active. Colors come from inherited variables. */
export function shadowCss(): string {
  return `@layer ute {\n${sharedCss(tokenNames(), 'shadow')}\n}\n`;
}

/**
 * Registered per theme at document_start, before the content script has read settings:
 * crushes the page to the theme's base color so the very first paint is already dark (or light).
 */
export function bootCss(theme: ThemeDefinition): string {
  const P = 'html:not([data-ute-theme])';
  const base = baseOf(theme);
  return (
    `/* Generated by scripts/build.mjs — do not edit. */\n@layer ute {\n` +
    `${P} { background-color: ${base} !important; color-scheme: ${theme.mode} !important; }\n` +
    `${P} *, ${P} *::before, ${P} *::after { ${crushDeclarations(base)} }\n` +
    `${P} :is(${MEDIA}) { opacity: 0 !important; }\n}\n`
  );
}
