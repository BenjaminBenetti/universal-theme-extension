import { describe, expect, it } from 'vitest';
import { bootFileFor, bootScripts } from '../../src/background/registration.ts';
import { DEFAULT_SETTINGS, isExpired, themeFor, type Settings } from '../../src/shared/settings.ts';
import { compileTheme } from '../../src/themes/css.ts';
import { findTheme, type CustomThemes } from '../../src/themes/index.ts';

/** A custom theme: Gruvbox Dark Medium with a navy page. */
function navy(): CustomThemes {
  const definition = { ...structuredClone(findTheme('gruvbox-dark-medium')!), id: 'custom-navy', name: 'Navy' };
  definition.background.page = '#101830';
  return { 'custom-navy': { definition, compiled: compileTheme(definition), updated: 1 } };
}

const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, apiKey: 'key', ...patch });

describe('themeFor', () => {
  it('uses the per-site theme, then the default', () => {
    const s = settings({ defaultTheme: 'gruvbox-dark-medium', sites: { 'a.com': 'gruvbox-light-hard', 'b.com': 'off' } });
    expect(themeFor(s, 'a.com')?.id).toBe('gruvbox-light-hard');
    expect(themeFor(s, 'b.com')).toBeUndefined();
    expect(themeFor(s, 'c.com')?.id).toBe('gruvbox-dark-medium');
  });

  it('resolves custom themes, and falls back when one is deleted', () => {
    const s = settings({ defaultTheme: 'gruvbox-light-soft', sites: { 'a.com': 'custom-navy' } });
    expect(themeFor(s, 'a.com', navy())?.name).toBe('Navy');
    expect(themeFor(s, 'a.com', {})?.id).toBe('gruvbox-light-soft');
    expect(themeFor({ ...s, defaultTheme: 'custom-navy' }, 'b.com', {})?.id).toBe('gruvbox-dark-medium');
    expect(themeFor({ ...s, defaultTheme: 'off' }, 'a.com', {})).toBeUndefined();
  });

  it('themes nothing without a Jev key', () => {
    expect(themeFor(settings({ apiKey: '' }), 'a.com')).toBeUndefined();
  });
});

describe('cache expiry', () => {
  it('expires labels after the configured hours', () => {
    const s = settings({ cacheHours: 24 });
    const now = Date.now();
    expect(isExpired({ l: {}, t: now - 23 * 3600_000 }, s, now)).toBe(false);
    expect(isExpired({ l: {}, t: now - 25 * 3600_000 }, s, now)).toBe(true);
  });
});

describe('first-paint stylesheet registration', () => {
  it('registers the default theme everywhere except overridden sites', () => {
    const scripts = bootScripts(settings({ defaultTheme: 'gruvbox-dark-soft', sites: { 'a.com': 'gruvbox-light-hard', 'b.com': 'off', 'c.com': 'gruvbox-light-hard' } }));
    expect(scripts).toEqual([
      expect.objectContaining({ id: 'boot-default', matches: ['<all_urls>'], excludeMatches: ['*://a.com/*', '*://b.com/*', '*://c.com/*'], css: ['boot/gruvbox-dark-soft.css'], runAt: 'document_start' }),
      expect.objectContaining({ id: 'boot-gruvbox-light-hard', matches: ['*://a.com/*', '*://c.com/*'], css: ['boot/gruvbox-light-hard.css'] }),
    ]);
  });

  it('gives a custom theme the first-paint stylesheet of the nearest built-in', () => {
    const custom = navy();
    expect(bootFileFor(custom['custom-navy']!.definition)).toBe('boot/gruvbox-dark-hard.css');
    const light = { ...custom['custom-navy']!.definition, id: 'custom-paper', mode: 'light' as const };
    light.background = { ...light.background, page: '#ffffff' };
    expect(bootFileFor(light)).toBe('boot/gruvbox-light-hard.css');
    const scripts = bootScripts(settings({ defaultTheme: 'custom-navy' }), custom);
    expect(scripts).toEqual([expect.objectContaining({ id: 'boot-default', css: ['boot/gruvbox-dark-hard.css'] })]);
  });

  it('registers nothing when theming is off or there is no key', () => {
    expect(bootScripts(settings({ defaultTheme: 'off' }))).toEqual([]);
    expect(bootScripts(settings({ apiKey: '' }))).toEqual([]);
  });
});
