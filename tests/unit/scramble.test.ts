import { describe, expect, it } from 'vitest';
import { scrambleText } from '../../src/content/scramble.ts';

describe('scrambleText', () => {
  it('keeps the shape of the text but not the letters', () => {
    const text = 'Meridith Schmidt, DOB 1969-11-13 — Sign up!';
    const out = scrambleText(text);
    expect(out).toHaveLength(text.length);
    expect(out.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '0')).toBe('Aaaaaaaa Aaaaaaa, AAA 0000-00-00 — Aaaa aa!');
    expect(out).not.toContain('Meridith');
    expect(out).not.toContain('1969');
  });

  it('turns letters from any script into Latin letters', () => {
    expect(scrambleText('日本 Ωμέγα')).toMatch(/^[a-z]{2} [A-Z][a-z]{4}$/);
  });
});
