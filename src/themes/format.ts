// The theme format. A theme is plain data (JSON): an explicit color for every design token Jev can
// label an element with, grouped the way people think about them. Built-in themes live in
// src/themes/builtin/*.json; themes made in the editor are stored in the same shape.
//
// Adding a token to the vocabulary (shared/tokens.ts) makes it required here, so every theme —
// built-in or custom — is forced to say what color it is.

import { BG_TOKENS, BORDER_TOKENS, FG_TOKENS, SOFT_CAPABLE, type BgTokenOrSoft, type BorderToken, type FgToken } from '../shared/tokens.ts';
import { legibleOn, mix, parseColor } from '../shared/color.ts';

export const THEME_FORMAT = 1;

/** Solid fills that need their own legible text color on top. */
export const SOLID_BG = ['accent', 'danger', 'success', 'warning', 'info'] as const;
export type SolidBg = (typeof SOLID_BG)[number];

export type BackgroundKey = Exclude<BgTokenOrSoft, 'inherit' | 'content'>;
export type TextKey = Exclude<FgToken, 'content'>;
export type BorderKey = Exclude<BorderToken, 'content'>;
export const INTERFACE_KEYS = ['visitedLink', 'selection', 'selectionText', 'scrollbarThumb', 'scrollbarTrack'] as const;
export type InterfaceKey = (typeof INTERFACE_KEYS)[number];

export interface ThemeDefinition {
  /** Optional pointer to theme.schema.json, for editor autocompletion. */
  $schema?: string;
  format: typeof THEME_FORMAT;
  /** Lowercase letters, digits, and dashes. Custom themes start with "custom-". */
  id: string;
  name: string;
  /** Groups themes in pickers ("Gruvbox"). */
  family?: string;
  mode: 'dark' | 'light';
  background: Record<BackgroundKey, string>;
  text: Record<TextKey, string>;
  border: Record<BorderKey, string>;
  /** Text on solid fills (a yellow button's label). */
  textOnFill: Record<SolidBg, string>;
  interface: Record<InterfaceKey, string>;
}

export type Group = 'background' | 'text' | 'border' | 'textOnFill' | 'interface';

export interface Field {
  group: Group;
  key: string;
  label: string;
  description: string;
}

const title = (key: string) => key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const withoutKeep = <T extends string>(tokens: Record<T, string>) =>
  (Object.entries(tokens) as Array<[T, string]>).filter(([key]) => key !== 'inherit' && key !== 'content');

/** Every color a theme defines, in display order, with a human label and what it is used for. */
export const FIELDS: Field[] = [
  ...withoutKeep(BG_TOKENS).map(([key, description]) => ({ group: 'background' as const, key, label: title(key), description })),
  ...SOFT_CAPABLE.map((key) => ({
    group: 'background' as const,
    key: `${key}-soft`,
    label: `${title(key)} soft`,
    description: `A pale ${key} tint for banners, alerts, and highlighted rows`,
  })),
  ...withoutKeep(FG_TOKENS).map(([key, description]) => ({ group: 'text' as const, key, label: title(key), description })),
  ...withoutKeep(BORDER_TOKENS).map(([key, description]) => ({ group: 'border' as const, key, label: title(key), description })),
  ...SOLID_BG.map((key) => ({ group: 'textOnFill' as const, key, label: `On ${key}`, description: `Text and icons on a solid ${key} fill` })),
  { group: 'interface', key: 'visitedLink', label: 'Visited link', description: 'Links you have already opened' },
  { group: 'interface', key: 'selection', label: 'Selection', description: 'Background of selected text' },
  { group: 'interface', key: 'selectionText', label: 'Selection text', description: 'Selected text itself' },
  { group: 'interface', key: 'scrollbarThumb', label: 'Scrollbar thumb', description: 'The part of the scrollbar you drag' },
  { group: 'interface', key: 'scrollbarTrack', label: 'Scrollbar track', description: 'The groove the scrollbar thumb runs in' },
];

export const GROUP_LABELS: Record<Group, string> = {
  background: 'Backgrounds',
  text: 'Text',
  border: 'Borders',
  textOnFill: 'Text on solid fills',
  interface: 'Browser interface',
};

export const THEME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function color(theme: ThemeDefinition, group: Group, key: string): string {
  return (theme[group] as Record<string, string>)[key]!;
}

/** The color everything is crushed to until Jev has labeled it: the theme's page. */
export const baseOf = (theme: ThemeDefinition) => theme.background.page;

/** Checks an unknown value (e.g. imported JSON) against the format. Empty list means valid. */
export function validateTheme(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['A theme must be a JSON object.'];
  const t = value as Record<string, unknown>;
  if (t.format !== THEME_FORMAT) errors.push(`"format" must be ${THEME_FORMAT}.`);
  if (typeof t.id !== 'string' || !THEME_ID.test(t.id)) errors.push('"id" must be lowercase letters, digits, and dashes.');
  if (typeof t.name !== 'string' || !t.name.trim()) errors.push('"name" is required.');
  if (t.family !== undefined && typeof t.family !== 'string') errors.push('"family" must be text.');
  if (t.mode !== 'dark' && t.mode !== 'light') errors.push('"mode" must be "dark" or "light".');
  const known = new Set(['$schema', 'format', 'id', 'name', 'family', 'mode', ...Object.keys(GROUP_LABELS)]);
  for (const key of Object.keys(t)) if (!known.has(key)) errors.push(`Unknown property "${key}".`);

  for (const group of Object.keys(GROUP_LABELS) as Group[]) {
    const colors = t[group];
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
      errors.push(`"${group}" must be an object of colors.`);
      continue;
    }
    const expected = FIELDS.filter((f) => f.group === group).map((f) => f.key);
    for (const key of expected) {
      const c = (colors as Record<string, unknown>)[key];
      if (c === undefined) errors.push(`${group}.${key} is missing.`);
      else if (typeof c !== 'string' || !parseColor(c)) errors.push(`${group}.${key} is not a color: ${JSON.stringify(c)}.`);
    }
    for (const key of Object.keys(colors)) if (!expected.includes(key)) errors.push(`${group}.${key} is not a known color.`);
  }
  return errors;
}

/**
 * Colors that normally follow from others. The editor keeps them in step with their sources until
 * someone sets them by hand. Returns undefined for colors that are always chosen directly.
 */
export function derivedColor(theme: ThemeDefinition, group: Group, key: string): string | undefined {
  const page = theme.background.page;
  if (group === 'background' && key.endsWith('-soft')) {
    const solid = theme.background[key.slice(0, -'-soft'.length) as SolidBg];
    return solid && mix(page, solid, theme.mode === 'dark' ? 0.2 : 0.22);
  }
  if (group === 'textOnFill') return legibleOn(theme.background[key as SolidBg], page, theme.text.strong);
  if (group === 'text' && key === 'on-accent') return theme.text.strong;
  if (group === 'interface' && key === 'scrollbarTrack') return page;
  return undefined;
}

/**
 * Legibility every built-in theme must meet: [what, text color, background color, minimum contrast].
 * WCAG AA for body text (4.5:1); 3:1 for secondary text, status colors, and labels on fills.
 */
export function legibilityRules(t: ThemeDefinition): Array<[string, string, string, number]> {
  return [
    ['text on page', t.text.text, t.background.page, 4.5],
    ['strong on page', t.text.strong, t.background.page, 4.5],
    ['muted on page', t.text.muted, t.background.page, 3],
    ['link on page', t.text.link, t.background.page, 3],
    ['text on surface', t.text.text, t.background.surface, 4.5],
    ['text on raised', t.text.text, t.background.raised, 4.5],
    ['text on input', t.text.text, t.background.input, 4.5],
    ['text on control', t.text.text, t.background.control, 4.5],
    ['text on selected', t.text.text, t.background.selected, 3],
    ['text on highlight', t.text.text, t.background.highlight, 3],
    ['selection text', t.interface.selectionText, t.interface.selection, 3],
    ...SOLID_BG.flatMap((k): Array<[string, string, string, number]> => [
      [`on ${k} fill`, t.textOnFill[k], t.background[k], 3],
      [`${k} text on page`, t.text[k], t.background.page, 3],
      [`text on ${k}-soft`, t.text.text, t.background[`${k}-soft`], 4.5],
    ]),
  ];
}

/** JSON Schema for theme files (src/themes/theme.schema.json is generated from this). */
export function themeJsonSchema(): object {
  const groupSchema = (group: Group) => ({
    type: 'object',
    description: GROUP_LABELS[group],
    additionalProperties: false,
    required: FIELDS.filter((f) => f.group === group).map((f) => f.key),
    properties: Object.fromEntries(
      FIELDS.filter((f) => f.group === group).map((f) => [f.key, { $ref: '#/$defs/color', title: f.label, description: f.description }]),
    ),
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/BenjaminBenetti/universal-theme-extension/theme.schema.json',
    title: 'Universal Theme color theme',
    description: 'A color for every design token Jev can label a page element with.',
    type: 'object',
    additionalProperties: false,
    required: ['format', 'id', 'name', 'mode', ...Object.keys(GROUP_LABELS)],
    properties: {
      $schema: { type: 'string' },
      format: { const: THEME_FORMAT },
      id: { type: 'string', pattern: THEME_ID.source, description: 'Lowercase letters, digits, and dashes.' },
      name: { type: 'string', minLength: 1 },
      family: { type: 'string', description: 'Groups themes in pickers.' },
      mode: { enum: ['dark', 'light'], description: 'Whether the page background is dark or light.' },
      ...Object.fromEntries((Object.keys(GROUP_LABELS) as Group[]).map((g) => [g, groupSchema(g)])),
    },
    $defs: {
      color: { type: 'string', description: 'A CSS color: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), or oklch().' },
    },
  };
}
