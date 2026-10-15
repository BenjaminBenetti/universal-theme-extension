// Turns measured boxes into one Jev request, and Jev's answers back into token labels.
//
// Several boxes go into one request: Jev answers every question in parallel against the same
// state, and seeing neighbouring elements helps it (a blue button reads as "the accent" when
// it can see that the other buttons are gray).

import type { Job } from '../content/measure.ts';
import { BG_TOKENS, BORDER_TOKENS, FG_TOKENS, GRAPHIC_TOKENS, SOFT_CAPABLE, type Labels } from '../shared/tokens.ts';
import type { ChoiceQuestion, ImageAsset, SystemOneRequest, SystemOneResponse } from './jev.ts';

export const MAX_JOBS_PER_REQUEST = 10;

const TASK =
  'This web page is being recolored with a color theme. Each element below was measured in its original colors; ' +
  'decide which design role each of its colors plays so the theme can repaint it.';
const IMAGES = "An element's image shows how it looks on the page: its original colors on the color behind it, scaled up to fill a square.";

type Kind = keyof Required<Job['ask']>;

/**
 * Graphic roles for a picture that fills its whole box (a photo, an avatar): every role but "icon",
 * which would paint its whole box one flat color. Jev still picks which.
 */
const FILLED_GRAPHIC: Record<string, string> = Object.fromEntries(Object.entries(GRAPHIC_TOKENS).filter(([token]) => token !== 'icon'));

function instructions(kind: Kind, id: string, job: Job): string {
  const about = `About element ${id} only:`;
  switch (kind) {
    case 'bg':
      return `${about} which design role does its background color play?`;
    case 'fg':
      return job.ask.graphic ? `${about} which text role matches the color of this icon?` : `${about} which design role does its text color play?`;
    case 'ink':
      return `${about} it is an icon whose shape is painted in its "icon color"; which text role matches that color?`;
    case 'border':
      return `${about} which design role does its border play?`;
    case 'graphic':
      return `${about} what kind of graphic is it?`;
  }
}

const CRITERIA: Record<Kind, Record<string, string>> = {
  bg: BG_TOKENS,
  fg: FG_TOKENS,
  ink: FG_TOKENS,
  border: BORDER_TOKENS,
  graphic: GRAPHIC_TOKENS,
};

/** `images[i]` is a base64 JPEG of `jobs[i]`'s graphic, if Jev may look at it. */
export function buildRequest(host: string, page: string, jobs: Job[], images: Array<string | undefined> = []): SystemOneRequest {
  const elements: Record<string, Record<string, string>> = {};
  const questions: Record<string, ChoiceQuestion> = {};
  const assets: Record<string, ImageAsset> = {};
  jobs.forEach((job, i) => {
    const id = `e${i + 1}`;
    const { site: _site, page: _page, ...facts } = job.facts;
    elements[id] = facts;
    const image = images[i];
    if (image) {
      // References are matched as text anywhere in the request, so each is a fresh UUID.
      const ref = crypto.randomUUID();
      assets[ref] = { type: 'image', format: 'jpg', data_base64: image };
      facts.image = ref;
    }
    for (const kind of Object.keys(job.ask) as Kind[]) {
      questions[`${id}_${kind}`] = { type: 'choice', instructions: instructions(kind, id, job), criteria: kind === 'graphic' && job.filled ? FILLED_GRAPHIC : CRITERIA[kind] };
    }
  });
  const seen = Object.keys(assets).length > 0;
  return { state: { task: seen ? `${TASK} ${IMAGES}` : TASK, site: host, page, elements }, questions, ...(seen ? { assets } : {}) };
}

export function parseAnswers(jobs: Job[], response: SystemOneResponse): Record<string, Labels> {
  const out: Record<string, Labels> = {};
  jobs.forEach((job, i) => {
    const id = `e${i + 1}`;
    const pick = (kind: Kind) => response.answers[`${id}_${kind}`]?.choice;
    const labels: Labels = {};
    const bg = job.ask.bg && pick('bg');
    if (bg && bg in BG_TOKENS) {
      labels.bg = job.softBg && (SOFT_CAPABLE as readonly string[]).includes(bg) ? (`${bg}-soft` as Labels['bg']) : (bg as Labels['bg']);
    }
    const fg = job.ask.fg && pick('fg');
    if (fg && fg in FG_TOKENS) labels.fg = fg as Labels['fg'];
    const ink = job.ask.ink && pick('ink');
    if (ink && ink in FG_TOKENS) labels.ink = ink as Labels['ink'];
    const border = job.ask.border && pick('border');
    if (border && border in BORDER_TOKENS) labels.border = border as Labels['border'];
    const graphic = job.ask.graphic && pick('graphic');
    if (graphic && graphic in GRAPHIC_TOKENS) labels.graphic = graphic as Labels['graphic'];
    out[job.sig] = labels;
  });
  return out;
}
