// Inky, animated: bobs, swings its arms, blinks, and pops a heart when you click it.
//
//   dockInky(host)   Inky sits in `host` (a header) and bobs in place.
//   roamInky(main)   Inky floats around the empty margins beside `main`, never over it; when the
//                    window is too narrow for margins it docks in `fallback` instead.
// Everything stays still for people who ask for reduced motion.

import { HEART, INKY_COLORS, INKY_FRAMES, INKY_HEIGHT, INKY_WIDTH } from './inky-sprite.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawRows(parent: SVGElement, rows: readonly string[], x0 = 0, y0 = 0) {
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let run = 1;
      while (row[x + run] === ch) run++;
      if (ch !== '.') {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(x0 + x));
        rect.setAttribute('y', String(y0 + y));
        rect.setAttribute('width', String(run));
        rect.setAttribute('height', '1');
        rect.setAttribute('fill', INKY_COLORS[ch] ?? '#000');
        parent.append(rect);
      }
      x += run;
    }
  });
}

type Frame = keyof typeof INKY_FRAMES;

/** One Inky: an SVG with a group per frame, so animating is just showing a different group. */
class Inky {
  readonly el: HTMLElement;
  private frames = new Map<Frame, SVGGElement>();
  private timers: number[] = [];
  private arms: Frame = 'idle';
  private blinking = false;

  constructor(readonly scale: number) {
    this.el = document.createElement('span');
    this.el.className = 'inky';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.title = 'Inky';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${INKY_WIDTH} ${INKY_HEIGHT}`);
    svg.setAttribute('width', String(INKY_WIDTH * scale));
    svg.setAttribute('height', String(INKY_HEIGHT * scale));
    svg.setAttribute('shape-rendering', 'crispEdges');
    for (const name of Object.keys(INKY_FRAMES) as Frame[]) {
      const g = document.createElementNS(SVG_NS, 'g');
      drawRows(g, INKY_FRAMES[name]);
      g.style.display = name === 'idle' ? '' : 'none';
      this.frames.set(name, g);
      svg.append(g);
    }
    this.el.append(svg);
    this.el.addEventListener('click', () => this.boop());
    if (!reducedMotion()) this.animate();
  }

  private show(frame: Frame) {
    for (const [name, g] of this.frames) g.style.display = name === frame ? '' : 'none';
  }

  private animate() {
    // Arms swing and the body bobs by one sprite pixel, in step, like a sprite on a tile map.
    this.timers.push(
      window.setInterval(() => {
        if (document.hidden) return;
        this.arms = this.arms === 'idle' ? 'swim' : 'idle';
        this.el.classList.toggle('up', this.arms === 'swim');
        if (!this.blinking) this.show(this.arms);
      }, 520),
    );
    const blink = () => {
      this.timers.push(
        window.setTimeout(() => {
          this.blinking = true;
          this.show('blink');
          window.setTimeout(() => {
            this.blinking = false;
            this.show(this.arms);
            blink();
          }, 140);
        }, 2600 + Math.random() * 3400),
      );
    };
    blink();
  }

  /** A little hop and a heart. */
  boop() {
    this.el.classList.remove('hop');
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add('hop');
    const heart = document.createElementNS(SVG_NS, 'svg');
    heart.setAttribute('viewBox', '0 0 5 4');
    heart.setAttribute('width', String(5 * this.scale));
    heart.setAttribute('height', String(4 * this.scale));
    heart.setAttribute('shape-rendering', 'crispEdges');
    heart.classList.add('inky-heart');
    drawRows(heart, HEART);
    this.el.append(heart);
    window.setTimeout(() => heart.remove(), 1100);
  }

  destroy() {
    for (const t of this.timers) window.clearInterval(t);
  }
}

const STYLES = `
.inky { display: inline-block; position: relative; line-height: 0; cursor: pointer; user-select: none; }
.inky svg { display: block; }
.inky.up > svg:first-child { transform: translateY(calc(var(--inky-px) * -1)); }
.inky.hop > svg:first-child { animation: inky-hop 0.45s steps(3) 1; }
@keyframes inky-hop { 0% { transform: translateY(0); } 50% { transform: translateY(calc(var(--inky-px) * -4)); } 100% { transform: translateY(0); } }
.inky-heart { position: absolute; left: 50%; top: 0; translate: -50% -100%; animation: inky-heart 1.1s steps(6) forwards; pointer-events: none; }
@keyframes inky-heart { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(calc(var(--inky-px) * -8)); } }
.inky-roam { position: fixed; z-index: 20; left: 0; top: 0; will-change: transform; }
@media (prefers-reduced-motion: reduce) { .inky.up > svg:first-child, .inky.hop > svg:first-child { transform: none; animation: none; } .inky-heart { animation: none; opacity: 0; } }
`;

function injectStyles() {
  if (document.getElementById('inky-styles')) return;
  const style = document.createElement('style');
  style.id = 'inky-styles';
  style.textContent = STYLES;
  document.head.append(style);
}

/** Inky in a header, bobbing in place. */
export function dockInky(host: HTMLElement, scale = 2): Inky {
  injectStyles();
  const inky = new Inky(scale);
  inky.el.style.setProperty('--inky-px', `${scale}px`);
  host.append(inky.el);
  return inky;
}

/**
 * Inky floating around the empty margins beside `main` (the page's content column). It drifts
 * between random spots in whichever margin it is in, snapped to its own pixel grid, and never
 * crosses the content. Too narrow for margins: it docks in `fallback` instead.
 */
export function roamInky(main: HTMLElement, fallback: HTMLElement, scale = 3): void {
  injectStyles();
  const inky = new Inky(scale);
  inky.el.style.setProperty('--inky-px', `${scale}px`);
  const w = INKY_WIDTH * scale;
  const h = INKY_HEIGHT * scale;
  const margin = 24;
  let side: 'left' | 'right' = 'right';
  let pos = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  let lastMove = 0;
  let roaming = false;

  const zone = () => {
    const box = main.getBoundingClientRect();
    const left = { x0: margin, x1: box.left - w - margin };
    const right = { x0: box.right + margin, x1: innerWidth - w - margin };
    const y0 = 80;
    const y1 = innerHeight - h - margin;
    const fits = (z: { x0: number; x1: number }) => z.x1 - z.x0 >= w && y1 > y0;
    if (!fits(left) && !fits(right)) return undefined;
    if (!fits(side === 'left' ? left : right)) side = side === 'left' ? 'right' : 'left';
    return { ...(side === 'left' ? left : right), y0, y1 };
  };
  const pick = () => {
    const z = zone();
    if (!z) return;
    target = { x: z.x0 + Math.random() * (z.x1 - z.x0), y: z.y0 + Math.random() * (z.y1 - z.y0) };
    // Now and then, head for the other margin next time.
    if (Math.random() < 0.15) side = side === 'left' ? 'right' : 'left';
  };
  const place = () => {
    const snap = (v: number) => Math.round(v / scale) * scale;
    inky.el.style.transform = `translate(${snap(pos.x)}px, ${snap(pos.y)}px)`;
  };

  const layout = () => {
    const z = zone();
    if (!z || reducedMotion()) {
      if (roaming || !inky.el.isConnected) {
        roaming = false;
        inky.el.classList.remove('inky-roam');
        inky.el.style.transform = '';
        fallback.append(inky.el);
      }
      return;
    }
    if (!roaming) {
      roaming = true;
      inky.el.classList.add('inky-roam');
      document.body.append(inky.el);
      pos = { x: z.x0 + (z.x1 - z.x0) / 2, y: z.y0 + 40 };
      pick();
    }
    pos = { x: Math.min(Math.max(pos.x, z.x0), z.x1), y: Math.min(Math.max(pos.y, z.y0), z.y1) };
    place();
  };

  const step = (now: number) => {
    if (roaming && !document.hidden) {
      const dt = Math.min(0.1, (now - (lastMove || now)) / 1000);
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const speed = 26; // px per second: a lazy drift
      if (dist < 2) pick();
      else {
        pos = { x: pos.x + (dx / dist) * speed * dt, y: pos.y + (dy / dist) * speed * dt };
        place();
      }
    }
    lastMove = now;
    requestAnimationFrame(step);
  };

  addEventListener('resize', layout);
  layout();
  if (!reducedMotion()) requestAnimationFrame(step);
}
