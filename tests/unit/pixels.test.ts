import { describe, expect, it } from 'vitest';
import { describePixels, SAMPLE } from '../../src/shared/pixels.ts';

/** A SAMPLE × SAMPLE RGBA sample painted by `color(x, y)` (undefined = transparent). */
function sample(color: (x: number, y: number) => [number, number, number] | undefined): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SAMPLE * SAMPLE * 4);
  for (let y = 0; y < SAMPLE; y++) {
    for (let x = 0; x < SAMPLE; x++) {
      const c = color(x, y);
      if (c) data.set([...c, 255], (y * SAMPLE + x) * 4);
    }
  }
  return data;
}

describe('describePixels', () => {
  it('describes a picture as several colors filling its box', () => {
    const photo = describePixels(sample((x, y) => [[201, 148, 110], [70, 52, 40], [120, 170, 210], [230, 210, 180]][(x >= 12 ? 1 : 0) + (y >= 12 ? 2 : 0)] as [number, number, number]));
    expect(photo.opaque).toBe(true);
    expect(photo.words).toMatch(/^mostly .*, with .*; fills its whole box; flat areas of solid color$/);
    expect(photo.sig).toMatch(/^multiF-flat:/);
  });

  it('describes dark ink on a transparent background as drawn for light paper', () => {
    const icon = describePixels(sample((x, y) => (Math.abs(x - y) < 3 ? [30, 30, 30] : undefined)));
    expect(icon.opaque).toBe(false);
    expect(icon.paper).toBe('light');
    expect(icon.words).toMatch(/^a single .* color; about \d+% of the box is drawn, the rest is transparent/);
  });

  it("tells a photo's smooth shading from flat areas of color, so a gray photo is not read as gray ink", () => {
    // A gray portrait on white: every pixel a slightly different shade of gray.
    let seed = 7;
    const grain = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 40;
    const photo = describePixels(sample((x, y) => {
      const v = 60 + x * 4 + y * 2 + grain();
      return [v, v, v];
    }));
    expect(photo.words).toMatch(/smooth shading, like a photo$/);
    expect(photo.sig).toMatch(/^multiF-smooth:/);

    // A default avatar: a light shape on white, the same few colors in large areas.
    const placeholder = describePixels(sample((x, y) => (Math.hypot(x - 12, y - 12) < 7 ? [255, 255, 255] : [221, 221, 221])));
    expect(placeholder.words).toMatch(/flat areas of solid color$/);
    expect(placeholder.sig).toMatch(/^multiF-flat:/);
  });

  it('says so when nothing is drawn', () => {
    expect(describePixels(sample(() => undefined))).toEqual({ words: 'nothing drawn (fully transparent)', sig: 'empty', paper: undefined, opaque: false });
  });
});
