// The first paint must already be in the theme's base color, but the content script can only
// read settings asynchronously. So the background registers, per theme, a document_start
// stylesheet (dist/boot/<theme>.css) for exactly the sites that use that theme.
//
// Registered stylesheets must be files in the extension, so a custom theme borrows the boot file
// of the built-in theme whose base color is closest to its own.

import { parseColor } from '../shared/color.ts';
import { type Settings, themeFor } from '../shared/settings.ts';
import { baseOf } from '../themes/format.ts';
import { BUILTIN_THEMES, isBuiltin, type CustomThemes, type ThemeDefinition } from '../themes/index.ts';

const PREFIX = 'boot-';

export function hostPatterns(host: string): string[] {
  return [`*://${host}/*`];
}

/** The built-in boot stylesheet for a theme: its own, or the nearest built-in's for a custom theme. */
export function bootFileFor(theme: ThemeDefinition): string {
  if (isBuiltin(theme.id)) return `boot/${theme.id}.css`;
  const base = parseColor(baseOf(theme))!;
  const distance = (t: ThemeDefinition) => {
    const c = parseColor(baseOf(t))!;
    return (c.r - base.r) ** 2 + (c.g - base.g) ** 2 + (c.b - base.b) ** 2 + (t.mode === theme.mode ? 0 : 1e6);
  };
  const nearest = [...BUILTIN_THEMES].sort((a, b) => distance(a) - distance(b))[0]!;
  return `boot/${nearest.id}.css`;
}

export function bootScripts(settings: Settings, custom: CustomThemes = {}): chrome.scripting.RegisteredContentScript[] {
  if (!settings.apiKey) return [];
  const overrides = Object.keys(settings.sites);
  const common = { runAt: 'document_start' as const, allFrames: true, persistAcrossSessions: true };
  const byFile = new Map<string, string[]>();
  const add = (file: string, patterns: string[]) => byFile.set(file, [...(byFile.get(file) ?? []), ...patterns]);

  for (const host of overrides) {
    const theme = themeFor(settings, host, custom);
    if (theme) add(bootFileFor(theme), hostPatterns(host));
  }
  const scripts: chrome.scripting.RegisteredContentScript[] = [];
  // Resolved for a host with no override, i.e. the default theme.
  const fallback = themeFor({ ...settings, sites: {} }, '', custom);
  if (fallback) {
    const excludeMatches = overrides.flatMap(hostPatterns);
    scripts.push({
      id: `${PREFIX}default`,
      matches: ['<all_urls>'],
      ...(excludeMatches.length ? { excludeMatches } : {}),
      css: [bootFileFor(fallback)],
      ...common,
    });
  }
  for (const [file, matches] of byFile) {
    const id = `${PREFIX}${file.replace(/^boot\//, '').replace(/\.css$/, '')}`;
    scripts.push({ id, matches, css: [file], ...common });
  }
  return scripts;
}

let chain: Promise<unknown> = Promise.resolve();

/** Re-registers boot stylesheets to match settings. Calls are serialized. */
export function syncBootCss(settings: Settings, custom: CustomThemes = {}): Promise<void> {
  const run = async () => {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.filter((s) => s.id.startsWith(PREFIX)).map((s) => s.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
    const scripts = bootScripts(settings, custom);
    if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
  };
  const next = chain.then(run, run);
  chain = next.catch((err) => console.error('[ute] boot css registration failed', err));
  return next;
}
