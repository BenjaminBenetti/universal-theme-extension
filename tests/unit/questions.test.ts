import { describe, expect, it } from 'vitest';
import { buildRequest, parseAnswers } from '../../src/background/questions.ts';
import type { SystemOneResponse } from '../../src/background/jev.ts';
import type { Job } from '../../src/content/measure.ts';

const job = (sig: string, ask: Job['ask'], softBg = false): Job => ({
  sig,
  ask,
  softBg,
  facts: { site: 'example.com', page: 'white background with near-black text', element: '<button>', background: 'strong blue' },
});

const answer = (choice: string) => ({ type: 'choice' as const, choice, confidence: 0.9, probabilities: { [choice]: 0.9 } });

describe('buildRequest', () => {
  it('asks only the questions each box has a decision for, in one call', () => {
    const { state, questions } = buildRequest('example.com', 'white page', [job('a', { bg: true, fg: true }), job('b', { border: true })]);
    expect(Object.keys(questions)).toEqual(['e1_bg', 'e1_fg', 'e2_border']);
    expect(questions.e1_bg!.criteria).toHaveProperty('accent');
    expect(questions.e2_border!.instructions).toContain('element e2 only');
    expect(state).toMatchObject({ site: 'example.com', page: 'white page', elements: { e1: { element: '<button>' } } });
    // Site and page are said once, not per element.
    expect((state as { elements: Record<string, object> }).elements.e1).not.toHaveProperty('site');
  });
});

describe('parseAnswers', () => {
  it('maps choices to labels by signature', () => {
    const jobs = [job('a', { bg: true, fg: true }), job('b', { graphic: true })];
    const response: SystemOneResponse = {
      model: 'jev-1.13.0',
      answers: { e1_bg: answer('accent'), e1_fg: answer('on-accent'), e2_graphic: answer('icon') },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    expect(parseAnswers(jobs, response)).toEqual({ a: { bg: 'accent', fg: 'on-accent' }, b: { graphic: 'icon' } });
  });

  it('uses the soft variant for pale tints', () => {
    const response: SystemOneResponse = { model: 'm', answers: { e1_bg: answer('danger') }, usage: { input_tokens: 1, output_tokens: 1 } };
    expect(parseAnswers([job('a', { bg: true }, true)], response)).toEqual({ a: { bg: 'danger-soft' } });
    expect(parseAnswers([job('a', { bg: true }, false)], response)).toEqual({ a: { bg: 'danger' } });
  });

  it('ignores answers outside the vocabulary', () => {
    const response: SystemOneResponse = { model: 'm', answers: { e1_bg: answer('purple') }, usage: { input_tokens: 1, output_tokens: 1 } };
    expect(parseAnswers([job('a', { bg: true })], response)).toEqual({ a: {} });
  });
});
