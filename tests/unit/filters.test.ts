import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor, toOklch } from '../../src/shared/color.ts';
import { retintFilter, simulate, tintFilter } from '../../src/themes/filters.ts';
import { BUILTIN_THEMES, findTheme } from '../../src/themes/index.ts';
import { shadowCss } from '../../src/themes/css.ts';

const distance = (a: string, b: string) => {
  const x = parseColor(a)!;
  const y = parseColor(b)!;
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
};

describe('re-tinting line art into a theme', () => {
  it.each(BUILTIN_THEMES.map((t) => [t.id, t] as const))('%s: paper becomes the page and ink the text, exactly', (_id, theme) => {
    const light = retintFilter('light', theme.background.page, theme.text.text);
    expect(distance(simulate(light, '#ffffff'), theme.background.page)).toBeLessThanOrEqual(1);
    expect(distance(simulate(light, '#000000'), theme.text.text)).toBeLessThanOrEqual(1);
    const dark = retintFilter('dark', theme.background.page, theme.text.text);
    expect(distance(simulate(dark, '#000000'), theme.background.page)).toBeLessThanOrEqual(1);
    expect(distance(simulate(dark, '#ffffff'), theme.text.text)).toBeLessThanOrEqual(1);
  });

  it('reaches any page color, not only warm grays (a navy theme)', () => {
    const filter = retintFilter('light', '#101830', '#ebdbb2');
    expect(simulate(filter, '#ffffff')).toBe('#101830');
    expect(contrastRatio(parseColor(simulate(filter, '#000000'))!, parseColor('#101830')!)).toBeGreaterThan(10);
  });

  it('keeps accent hues recognizable when flipping (a blue header stays blue)', () => {
    const dark = findTheme('gruvbox-dark-medium')!;
    const filter = retintFilter('light', dark.background.page, dark.text.text);
    for (const [hex, hue] of [['#4472c4', 262], ['#c00000', 29], ['#70ad47', 135]] as const) {
      const out = toOklch(parseColor(simulate(filter, hex))!);
      const drift = Math.min(Math.abs(out.h - hue), 360 - Math.abs(out.h - hue));
      expect(drift, hex).toBeLessThan(35);
      expect(out.c, hex).toBeGreaterThan(0.06);
    }
  });

  it('is a data: URL SVG filter, usable from any document or shadow root', () => {
    expect(retintFilter('light', '#282828', '#ebdbb2')).toMatch(/^url\("data:image\/svg\+xml,.*#f"\)$/);
  });

  it('tints single-color icons exactly', () => {
    expect(simulate(tintFilter('#ebdbb2'), '#000000')).toBe('#ebdbb2');
    expect(simulate(tintFilter('#ebdbb2'), '#5f6368')).toBe('#ebdbb2');
  });
});

describe('shadow root stylesheet', () => {
  const css = shadowCss();

  it('uses the same token rules without the document-level guard', () => {
    expect(css).toContain('[data-ute-bg="raised"]:not([data-ute-m]) { background-color: var(--ute-bg-raised) !important }');
    expect(css).not.toContain(':root[data-ute-theme]');
  });

  it('does not repaint a canvas root it has no business with', () => {
    expect(css).not.toContain('var(--ute-bg-page) !important; color: var(--ute-fg-text)');
  });
});
