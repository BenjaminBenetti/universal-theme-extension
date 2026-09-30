// The design-token vocabulary Jev labels elements with. Themes map every token to a
// color; the criteria text doubles as the option descriptions Jev reads.

export const BG_TOKENS = {
  inherit: 'Blends into whatever is behind it; not meant to look like a separate area',
  page: 'The main page canvas that everything else sits on',
  surface: 'A broad band that separates itself from the page: header bar, navigation bar, sidebar, footer, toolbar, or section background',
  raised: 'A container that floats above content: card, panel, tile, dropdown menu, popover, dialog, or tooltip',
  input: 'A text field, search box, text area, or select box',
  control: 'A neutral button, chip, pill, tag, tab, toggle, or badge with no special meaning',
  selected: 'The selected, active, hovered, or current item in a list, menu, or set of tabs',
  code: 'A code block, inline code snippet, keyboard key, or preformatted text',
  accent: 'The primary call-to-action button, or an element filled with the brand color',
  danger: 'Error, delete, or destructive styling',
  success: 'Success, confirmation, or positive-state styling',
  warning: 'Warning or caution styling',
  info: 'Informational notice or tip styling',
  highlight: 'Highlighted or marked text, like a search match or a text marker',
  divider: 'A thin line or separator drawn with a background color',
  overlay: 'A dimming backdrop behind a modal, drawer, or lightbox',
  content: 'The exact color is content that must be kept: a color swatch, a chart or map color, a flag, or a user-chosen color',
} as const;

export const FG_TOKENS = {
  text: 'Normal body text',
  strong: 'Headings, titles, and emphasized text',
  muted: 'Secondary text: captions, metadata, timestamps, descriptions, and labels',
  faint: 'Placeholder, disabled, or barely-there hint text',
  link: 'A hyperlink or clickable text link',
  'on-accent': 'Text or icons sitting on a solid, saturated colored background such as a brand-colored button',
  accent: 'Brand-colored text or icons, such as an active tab label or a highlighted keyword',
  danger: 'Error or destructive text',
  success: 'Success or positive text',
  warning: 'Warning or caution text',
  info: 'Informational text',
  content: 'The exact color is content that must be kept: text inside a color swatch or a legend color sample',
} as const;

export const BORDER_TOKENS = {
  subtle: 'A hairline divider, separator, or card outline',
  strong: 'The outline of an input, button, or control that needs to stand out',
  accent: 'A focus ring, a selected or active outline, or a brand-colored border',
  danger: 'An error or destructive border',
  success: 'A success border',
  warning: 'A warning border',
  info: 'An informational border',
  content: 'The exact color is content that must be kept, like a swatch outline',
} as const;

export const GRAPHIC_TOKENS = {
  icon: 'A small single-color interface icon (arrow, menu, search glass, close, dots, chevron)',
  lineart:
    'Mostly one tone of ink on a plain background: text, a wordmark, line art, a diagram, a spreadsheet grid, or a document page (it may have a few colored accents)',
  keep: 'A photo, video, illustration, colorful logo, map, game, or chart whose original colors must be kept',
} as const;

export type BgToken = keyof typeof BG_TOKENS;
export type FgToken = keyof typeof FG_TOKENS;
export type BorderToken = keyof typeof BORDER_TOKENS;
export type GraphicToken = keyof typeof GRAPHIC_TOKENS;

/** Status tokens that have a pale "-soft" variant for tinted banners. */
export const SOFT_CAPABLE = ['accent', 'danger', 'success', 'warning', 'info'] as const;
export type SoftCapable = (typeof SOFT_CAPABLE)[number];

/** Token names as they appear in data attributes and theme CSS. */
export type BgTokenOrSoft = BgToken | `${SoftCapable}-soft`;

/**
 * What Jev decided for one element (or one ::before/::after box).
 * Missing fields mean the property had no decision to make and keeps its inherited/transparent value.
 */
export interface Labels {
  bg?: BgTokenOrSoft;
  fg?: FgToken;
  /** Icons painted with background-color through a CSS mask: the "background" is really ink. */
  ink?: FgToken;
  border?: BorderToken;
  graphic?: GraphicToken;
}
