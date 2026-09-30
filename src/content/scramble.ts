// Page text, disguised before it leaves the page: every letter and digit is swapped for a random
// one of the same kind, so Jev still sees the shape of the text (word lengths, spacing,
// capitals, punctuation, numbers) but not what it says.

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

export function scrambleText(text: string, random: () => number = Math.random): string {
  const pick = (set: string) => set[Math.floor(random() * set.length)]!;
  return text.replace(/[\p{L}\p{N}]/gu, (ch) => {
    if (/\p{N}/u.test(ch)) return pick(DIGITS);
    return ch !== ch.toLowerCase() ? pick(UPPER) : pick(LOWER);
  });
}
