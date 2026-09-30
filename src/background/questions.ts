// Turns measured boxes into one Jev request, and Jev's answers back into token labels.
//
// Several boxes go into one request: Jev answers every question in parallel against the same
// state, and seeing neighbouring elements helps it (a blue button reads as "the accent" when
// it can see that the other buttons are gray).

import type { Job } from '../content/measure.ts';
import { BG_TOKENS, BORDER_TOKENS, FG_TOKENS, GRAPHIC_TOKENS, SOFT_CAPABLE, type Labels } from '../shared/tokens.ts';
import type { ChoiceQuestion, SystemOneResponse } from './jev.ts';

export const MAX_JOBS_PER_REQUEST = 10;

const TASK =
  'This web page is being recolored with a color theme. Each element below was measured in its original colors; ' +
  'decide which design role each of its colors plays so the theme can repaint it.';

type Kind = keyof Required<Job['ask']>;

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

export interface BuiltRequest {
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
}

export function buildRequest(host: string, page: string, jobs: Job[]): BuiltRequest {
  const elements: Record<string, Record<string, string>> = {};
  const questions: Record<string, ChoiceQuestion> = {};
  jobs.forEach((job, i) => {
    const id = `e${i + 1}`;
    const { site: _site, page: _page, ...facts } = job.facts;
    elements[id] = facts;
    for (const kind of Object.keys(job.ask) as Kind[]) {
      questions[`${id}_${kind}`] = { type: 'choice', instructions: instructions(kind, id, job), criteria: CRITERIA[kind] };
    }
  });
  return { state: { task: TASK, site: host, page, elements }, questions };
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
