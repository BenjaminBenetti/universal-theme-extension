import { DEFAULT_THEME_ID, findTheme, type CustomThemes, type StoredTheme, type ThemeDefinition } from '../themes/index.ts';
import type { Labels } from './tokens.ts';

export type ThemeChoice = string | 'off';

export interface Settings {
  /** TypeSafe API key used to call Jev. Nothing is themed without it. */
  apiKey: string;
  /** Theme for every site without an override. */
  defaultTheme: ThemeChoice;
  /** Per-hostname overrides. */
  sites: Record<string, ThemeChoice>;
  /** How long Jev's labels for a site are trusted before Jev re-lays it out. */
  cacheHours: number;
  /** Development/testing only: alternative Jev endpoint (e.g. a local mock). */
  apiBase?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  defaultTheme: DEFAULT_THEME_ID,
  sites: {},
  cacheHours: 24,
};

export const SETTINGS_KEY = 'settings';
/** Themes made in the editor, by id. Kept apart from settings so settings stay small. */
export const CUSTOM_THEMES_KEY = 'customThemes';
export const cacheKey = (host: string) => `labels:${host}`;
/** A built-in theme's compiled variables (themeVarsCss), cached by the background. */
export const themeCssKey = (id: string) => `themeCss:${id}`;

/** One cached Jev decision: labels plus when Jev made it. */
export interface CacheEntry {
  l: Labels;
  t: number;
}
export type HostCache = Record<string, CacheEntry>;

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored, sites: { ...stored?.sites } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function loadCustomThemes(): Promise<CustomThemes> {
  return ((await chrome.storage.local.get(CUSTOM_THEMES_KEY))[CUSTOM_THEMES_KEY] as CustomThemes | undefined) ?? {};
}

export async function saveCustomTheme(theme: StoredTheme): Promise<void> {
  const themes = await loadCustomThemes();
  await chrome.storage.local.set({ [CUSTOM_THEMES_KEY]: { ...themes, [theme.definition.id]: theme } });
}

export async function deleteCustomTheme(id: string): Promise<void> {
  const { [id]: _gone, ...rest } = await loadCustomThemes();
  await chrome.storage.local.set({ [CUSTOM_THEMES_KEY]: rest });
}

/**
 * The theme a hostname should get, or undefined when theming is off there. A choice that no longer
 * exists (a deleted custom theme) falls back to the default theme, then to the built-in default.
 */
export function themeFor(settings: Settings, host: string, custom: CustomThemes = {}): ThemeDefinition | undefined {
  if (!settings.apiKey) return undefined;
  const choice = settings.sites[host] ?? settings.defaultTheme;
  if (choice === 'off') return undefined;
  const chosen = findTheme(choice, custom);
  if (chosen) return chosen;
  // The chosen theme was deleted: behave as if the site had no choice of its own.
  if (settings.defaultTheme === 'off') return undefined;
  return findTheme(settings.defaultTheme, custom) ?? findTheme(DEFAULT_THEME_ID);
}

export function isExpired(entry: CacheEntry, settings: Settings, now = Date.now()): boolean {
  return now - entry.t > settings.cacheHours * 3600_000;
}
