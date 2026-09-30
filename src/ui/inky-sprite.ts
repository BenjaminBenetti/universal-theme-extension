// Inky, the Universal Theme mascot: a 16×14 pixel octopus. Pure data, shared by the animated
// mascot in the extension's pages and by scripts/render-icons.mjs (the toolbar icons).
//
// Letters are colors (see INKY_COLORS); '.' is transparent.

const HEAD = [
  '.....BBBBBB.....',
  '...BBBBBBBBBB...',
  '..BBABBBBABBBB..',
  '.BBWWBBBBBBAABB.',
  '.BWWBBBBBBBBBBB.',
  'BBBBBBBBBBBBBBBB',
];
const EYES_OPEN = ['BBBWEBBBBBBWEBBB', 'BBBEEBBBBBBEEBBB'];
const EYES_SHUT = ['BBBBBBBBBBBBBBBB', 'BBBEEBBBBBBEEBBB'];
const FACE = ['BBPPBBBKKBBBPPBB', '.BBBBBBBBBBBBBB.', '.BBBBBBBBBBBBBB.'];
const ARMS_A = ['BB.BB.BBBB.BB.BB', 'B..B..B..B..B..B', '.B..B..BB..B..B.'];
const ARMS_B = ['BB.BB.BBBB.BB.BB', '.B..B..BB..B..B.', 'B..B..B..B..B..B'];

export const INKY_WIDTH = 16;
export const INKY_HEIGHT = 14;

/** Animation frames: arms swing between A and B; eyes blink shut now and then. */
export const INKY_FRAMES = {
  idle: [...HEAD, ...EYES_OPEN, ...FACE, ...ARMS_A],
  swim: [...HEAD, ...EYES_OPEN, ...FACE, ...ARMS_B],
  blink: [...HEAD, ...EYES_SHUT, ...FACE, ...ARMS_A],
} as const;

export const HEART = ['PP.PP', 'PPPPP', '.PPP.', '..P..'];

/** Inky's own colors (Gruvbox, where it was born): pink body, plum spots, rosy cheeks. */
export const INKY_COLORS: Record<string, string> = {
  B: '#d3869b',
  A: '#b16286',
  W: '#fbf1c7',
  E: '#1d2021',
  K: '#1d2021',
  P: '#fb4934',
};
