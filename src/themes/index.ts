// The theme registry: built-in themes (JSON files in ./builtin) plus themes made in the editor.

import gruvboxDarkHard from './builtin/gruvbox-dark-hard.json' with { type: 'json' };
import gruvboxDarkMedium from './builtin/gruvbox-dark-medium.json' with { type: 'json' };
import gruvboxDarkSoft from './builtin/gruvbox-dark-soft.json' with { type: 'json' };
import gruvboxLightHard from './builtin/gruvbox-light-hard.json' with { type: 'json' };
import gruvboxLightMedium from './builtin/gruvbox-light-medium.json' with { type: 'json' };
import gruvboxLightSoft from './builtin/gruvbox-light-soft.json' with { type: 'json' };
import type { ThemeDefinition } from './format.ts';

export type { ThemeDefinition } from './format.ts';

export const BUILTIN_THEMES = [
  gruvboxDarkHard,
  gruvboxDarkMedium,
  gruvboxDarkSoft,
  gruvboxLightHard,
  gruvboxLightMedium,
  gruvboxLightSoft,
] as ThemeDefinition[];

export const DEFAULT_THEME_ID = 'gruvbox-dark-medium';

/**
 * A theme ready for the page: the CSS custom properties our stylesheet reads. Built-in themes are
 * compiled at build time into themes.css; custom themes are compiled when saved in the editor.
 */
export interface CompiledTheme {
  id: string;
  name: string;
  family?: string;
  mode: 'dark' | 'light';
  vars: Record<string, string>;
}

/** A theme saved from the editor. */
export interface StoredTheme {
  definition: ThemeDefinition;
  compiled: CompiledTheme;
  updated: number;
}

export type CustomThemes = Record<string, StoredTheme>;

/** Built-in themes first, then custom ones by name. */
export function allThemes(custom: CustomThemes = {}): ThemeDefinition[] {
  const mine = Object.values(custom)
    .map((t) => t.definition)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILTIN_THEMES, ...mine];
}

export function findTheme(id: string | undefined, custom: CustomThemes = {}): ThemeDefinition | undefined {
  if (!id) return undefined;
  return BUILTIN_THEMES.find((t) => t.id === id) ?? custom[id]?.definition;
}

export const isBuiltin = (id: string) => BUILTIN_THEMES.some((t) => t.id === id);

/** The colors a theme is recognized by, for swatch strips in pickers. */
export function swatchesOf(theme: ThemeDefinition): string[] {
  const b = theme.background;
  return [b.page, b.raised, theme.text.text, b.accent, b.danger, b.success, theme.text.link];
}
