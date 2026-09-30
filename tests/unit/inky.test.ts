import { describe, expect, it } from 'vitest';
import { HEART, INKY_COLORS, INKY_FRAMES, INKY_HEIGHT, INKY_WIDTH } from '../../src/ui/inky-sprite.ts';

describe('Inky', () => {
  it.each(Object.entries(INKY_FRAMES))('the %s frame is a full 16×14 grid in known colors', (_name, rows) => {
    expect(rows).toHaveLength(INKY_HEIGHT);
    for (const row of rows) {
      expect(row).toHaveLength(INKY_WIDTH);
      for (const ch of row) if (ch !== '.') expect(INKY_COLORS).toHaveProperty(ch);
    }
  });

  it('fits a 16px toolbar icon at exactly one pixel per sprite pixel', () => {
    expect(INKY_WIDTH).toBeLessThanOrEqual(16);
    expect(INKY_HEIGHT).toBeLessThanOrEqual(16);
  });

  it('draws its heart in known colors', () => {
    for (const ch of HEART.join('')) if (ch !== '.') expect(INKY_COLORS).toHaveProperty(ch);
  });
});
