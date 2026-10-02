import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, describeColor, describeRelation, isSoftTint, isTransparent, mix, nameColor, parseColor, sameColor, toHex } from '../../src/shared/color.ts';

const c = (s: string) => parseColor(s)!;

describe('parseColor', () => {
  it('reads the formats getComputedStyle produces', () => {
    expect(parseColor('rgb(11, 87, 208)')).toEqual({ r: 11, g: 87, b: 208, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(0 0 0 / 25%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.25 });
    expect(toHex(c('color(srgb 1 0.5 0)'))).toBe('#ff8000');
    expect(toHex(c('oklch(0.628 0.2577 29.23)'))).toBe('#ff0000');
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('currentcolor')).toBeNull();
  });

  it('reads lab() and lch(), which Tailwind 4 sites produce', () => {
    // The CSS Color 4 spec's own example: lab(29.2345% 39.3825 20.0664) is rgb(125 35 41).
    expect(toHex(c('lab(29.2345% 39.3825 20.0664)'))).toBe('#7d2329');
    expect(toHex(c('lch(29.2345% 44.2 27)'))).toBe('#7d2329');
    expect(toHex(c('lab(100 0 0)'))).toBe('#ffffff');
    expect(toHex(c('lab(0 0 0)'))).toBe('#000000');
    expect(c('lab(50% 0 0 / 0.5)').a).toBe(0.5);
  });

  it('treats near-zero alpha as transparent', () => {
    expect(isTransparent(c('rgba(0, 0, 0, 0)'))).toBe(true);
    expect(isTransparent(c('rgba(0, 0, 0, 0.5)'))).toBe(false);
    expect(isTransparent(null)).toBe(true);
  });
});

describe('naming colors for Jev', () => {
  it.each([
    ['#ffffff', 'white'],
    ['#000000', 'black'],
    ['#f1f3f4', 'off-white'],
    ['#dadce0', 'light gray'],
    ['#202124', 'near-black'],
    ['#0b57d0', 'strong blue'],
    ['#d93025', 'strong red'],
    ['#fce8e6', 'pale pink'],
    ['#fbf1c7', 'pale yellow'],
  ])('%s is "%s"', (hex, name) => expect(nameColor(c(hex))).toBe(name));

  it('mentions translucency', () => {
    expect(describeColor(c('rgba(0, 0, 0, 0.08)'))).toBe('black at 8% opacity');
    expect(describeColor(c('rgba(0, 0, 0, 0)'))).toBe('none (transparent)');
  });

  it('describes a box relative to what is behind it', () => {
    const white = c('#ffffff');
    expect(describeRelation(c('#f8f9fa'), white)).toBe('slightly darker than what is behind it');
    expect(describeRelation(c('#0b57d0'), white)).toBe('much darker than what is behind it');
    expect(describeRelation(c('#ffffff'), white)).toBe('same lightness as what is behind it');
  });
});

describe('color math', () => {
  it('composites translucent colors', () => {
    expect(toHex(composite(c('rgba(0, 0, 0, 0.5)'), c('#ffffff')))).toBe('#808080');
  });

  it('mixes theme colors', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('compares colors with a tolerance', () => {
    expect(sameColor(c('#ffffff'), c('#fefefe'))).toBe(true);
    expect(sameColor(c('#ffffff'), c('#f0f0f0'))).toBe(false);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 0);
  });

  it('tells a pale banner from a solid fill', () => {
    const white = c('#ffffff');
    expect(isSoftTint(c('#fce8e6'), white)).toBe(true);
    expect(isSoftTint(c('#d93025'), white)).toBe(false);
  });
});
