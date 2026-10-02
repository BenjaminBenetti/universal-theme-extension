import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../../src/shared/color.ts';
import { bootCss, compileTheme, sharedStylesheet, themeVarsCss } from '../../src/themes/css.ts';
import { derivedColor, FIELDS, legibilityRules, themeJsonSchema, validateTheme, type ThemeDefinition } from '../../src/themes/format.ts';
import { allThemes, BUILTIN_THEMES, DEFAULT_THEME_ID, findTheme } from '../../src/themes/index.ts';

const BUILTIN = BUILTIN_THEMES.map((t) => [t.id, t] as const);
const copy = (t: ThemeDefinition): ThemeDefinition => structuredClone(t);

describe('built-in themes', () => {
  it('lists the six Gruvbox variants first', () => {
    expect(BUILTIN_THEMES.slice(0, 6).map((t) => t.id)).toEqual([
      'gruvbox-dark-hard',
      'gruvbox-dark-medium',
      'gruvbox-dark-soft',
      'gruvbox-light-hard',
      'gruvbox-light-medium',
      'gruvbox-light-soft',
    ]);
    expect(findTheme(DEFAULT_THEME_ID)).toBeDefined();
  });

  it('lists every file in src/themes/builtin (npm run themes -- index)', () => {
    const dir = new URL('../../src/themes/builtin/', import.meta.url);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    expect(BUILTIN_THEMES.map((t) => t.id).sort()).toEqual(files.sort());
  });

  it('has unique ids and names', () => {
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(BUILTIN_THEMES.length);
    expect(new Set(BUILTIN_THEMES.map((t) => t.name)).size).toBe(BUILTIN_THEMES.length);
  });

  it('uses the canonical Gruvbox bg0 for each contrast', () => {
    expect(Object.fromEntries(BUILTIN_THEMES.filter((t) => t.family === 'Gruvbox').map((t) => [t.id, t.background.page]))).toEqual({
      'gruvbox-dark-hard': '#1d2021',
      'gruvbox-dark-medium': '#282828',
      'gruvbox-dark-soft': '#32302f',
      'gruvbox-light-hard': '#f9f5d7',
      'gruvbox-light-medium': '#fbf1c7',
      'gruvbox-light-soft': '#f2e5bc',
    });
  });

  it.each(BUILTIN)('%s is a valid theme file', (_id, theme) => {
    expect(validateTheme(theme)).toEqual([]);
  });

  it.each(BUILTIN)('%s keeps text legible', (_id, theme) => {
    const failures = legibilityRules(theme)
      .map(([label, fg, bg, min]) => [label, contrastRatio(parseColor(fg)!, parseColor(bg)!), min] as const)
      .filter(([, ratio, min]) => ratio < min)
      .map(([label, ratio, min]) => `${label}: ${ratio.toFixed(2)} < ${min}`);
    expect(failures).toEqual([]);
  });

  it.each(BUILTIN)('%s says whether it is dark or light correctly', (_id, theme) => {
    const page = parseColor(theme.background.page)!;
    expect(contrastRatio(page, parseColor('#000')!) > contrastRatio(page, parseColor('#fff')!)).toBe(theme.mode === 'light');
  });
});

describe('theme format', () => {
  const base = findTheme(DEFAULT_THEME_ID)!;

  it('requires a color for every token Jev can answer with', () => {
    const t = copy(base) as unknown as { background: Record<string, string> };
    delete t.background.raised;
    expect(validateTheme(t)).toEqual(['background.raised is missing.']);
  });

  it('rejects unknown colors, bad values, and bad ids', () => {
    const t = copy(base) as unknown as Record<string, Record<string, string>> & { id: string };
    t.text!.shiny = '#fff';
    t.border!.subtle = 'not a color';
    t.id = 'Has Spaces';
    expect(validateTheme(t)).toEqual([
      '"id" must be lowercase letters, digits, and dashes.',
      'text.shiny is not a known color.',
      'border.subtle is not a color: "not a color".',
    ]);
    expect(validateTheme('nope')).toEqual(['A theme must be a JSON object.']);
  });

  it('accepts hex, rgb(a), and oklch colors', () => {
    const t = copy(base);
    t.background.page = 'rgb(10, 20, 30)';
    t.background.overlay = 'rgba(0, 0, 0, 0.5)';
    t.text.text = 'oklch(0.9 0.02 90)';
    t.text.strong = '#fffa';
    expect(validateTheme(t)).toEqual([]);
  });

  it('lists every field once, in groups', () => {
    const ids = FIELDS.map((f) => `${f.group}.${f.key}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('background.danger-soft');
    expect(ids).toContain('textOnFill.accent');
    expect(ids).toContain('interface.scrollbarThumb');
  });

  it('derives tints and text on fills from their sources', () => {
    const t = copy(base);
    for (const field of FIELDS) {
      const derived = derivedColor(t, field.group, field.key);
      if (derived) expect(derived, `${field.group}.${field.key}`).toBe((t[field.group] as Record<string, string>)[field.key]);
    }
    expect(derivedColor(t, 'background', 'page')).toBeUndefined();
  });

  it('keeps src/themes/theme.schema.json in sync (npm run schema)', () => {
    const file = JSON.parse(fs.readFileSync(new URL('../../src/themes/theme.schema.json', import.meta.url), 'utf8'));
    expect(file).toEqual(themeJsonSchema());
  });

  it('lists custom themes after the built-ins', () => {
    const mine = { ...copy(base), id: 'custom-mine', name: 'Aaa mine' };
    const custom = { 'custom-mine': { definition: mine, compiled: compileTheme(mine), updated: 1 } };
    expect(allThemes(custom).map((t) => t.id).at(-1)).toBe('custom-mine');
    expect(findTheme('custom-mine', custom)?.name).toBe('Aaa mine');
  });
});

describe('generated CSS', () => {
  const compiled = BUILTIN_THEMES.map(compileTheme);
  const css = sharedStylesheet();

  it('ships one shared rule set and no theme colors in the page stylesheet', () => {
    expect(css.match(/ \[data-ute-bg="raised"\]:not\(\[data-ute-m\]\) \{/g)).toHaveLength(1);
    expect(css).not.toContain(':root[data-ute-theme="');
  });

  it("gives each theme a variables block scoped to its id", () => {
    for (const theme of compiled) {
      const vars = themeVarsCss(theme);
      expect(vars).toContain(`:root[data-ute-theme="${theme.id}"]`);
      for (const [name, value] of Object.entries(theme.vars)) expect(vars).toContain(`${name}: ${value};`);
      expect(vars).toContain(`color-scheme: ${theme.mode} !important`);
    }
  });

  it('compiles a variable for every color in the format', () => {
    const vars = compiled[0]!.vars;
    const prefix = { background: '--ute-bg-', text: '--ute-fg-', border: '--ute-bd-', textOnFill: '--ute-on-' } as const;
    for (const f of FIELDS) if (f.group in prefix) expect(vars).toHaveProperty(`${prefix[f.group as keyof typeof prefix]}${f.key}`);
    expect(vars['--ute-base']).toBe(BUILTIN_THEMES[0]!.background.page);
  });

  it('lives in a cascade layer and wins with !important', () => {
    // @property registrations come first: they cannot live inside a layer.
    expect(css).toMatch(/^\/\*.*\*\/\n(@property [^\n]*\n)*@layer ute \{/);
    expect(css).toContain('background-color: var(--ute-base) !important');
  });

  it('re-tints kept logos only on a theme of the other brightness', () => {
    for (const theme of compiled) {
      const dark = theme.mode === 'dark';
      expect(theme.vars['--ute-keep-light-paper']).toBe(dark ? theme.vars['--ute-retint-light-paper'] : 'none');
      expect(theme.vars['--ute-keep-dark-paper']).toBe(dark ? 'none' : theme.vars['--ute-retint-dark-paper']);
    }
    expect(css).toContain('[data-ute-g="keep"][data-ute-paper="light"]');
    expect(css).toContain('color: attr(data-ute-own-color type(<color>))');
  });

  it('keeps text colors kept as content readable: lighter on dark themes, darker on light ones', () => {
    for (const theme of compiled) {
      expect(theme.vars['--ute-content-l-min']).toBe(theme.mode === 'dark' ? '0.72' : '0');
      expect(theme.vars['--ute-content-l-max']).toBe(theme.mode === 'dark' ? '1' : '0.55');
    }
    expect(css).toContain('[data-ute-fg="content"][data-ute-own-fg]');
  });

  it('keeps see-through layers see-through, and only them', () => {
    expect(css).toMatch(/@property --ute-a \{[^}]*inherits: false/);
    expect(css).toContain('[data-ute-a][data-ute-bg="raised"]:not([data-ute-m]) { background-color: rgb(from var(--ute-bg-raised) r g b / calc(alpha * var(--ute-a, 1))) !important }');
    expect(css).not.toContain('[data-ute-a][data-ute-bg="overlay"]');
  });

  it('crushes the first paint to the base color', () => {
    const boot = bootCss(findTheme('gruvbox-dark-medium')!);
    expect(boot).toContain('html:not([data-ute-theme])');
    expect(boot).toContain('background-color: #282828 !important');
    expect(boot).toContain('color-scheme: dark');
  });
});
