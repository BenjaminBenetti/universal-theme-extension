import type { Job } from '../content/measure.ts';
import type { Labels } from './tokens.ts';

/** Content script → background: label these boxes (one Jev call). */
export interface LabelRequest {
  type: 'label';
  host: string;
  page: string;
  jobs: Job[];
}

export type LabelResponse = { ok: true; labels: Record<string, Labels> } | { ok: false; error: string; fatal: boolean };

/** Content script → background: the variables block of a built-in theme (a string, or '' if unknown). */
export interface ThemeCssRequest {
  type: 'theme-css';
  id: string;
}

/** Content script → background: add the USER-origin copy of our stylesheet to this frame. */
export interface InjectRequest {
  type: 'inject-user-css';
}

/** Content script → background: report progress for the badge / popup. */
export interface StatusReport {
  type: 'status';
  host: string;
  pending: number;
  labeled: number;
  error?: string;
}

/** Popup → content script: what is going on in this tab. */
export interface StatusQuery {
  type: 'get-status';
}

export interface TabStatus {
  host: string;
  theme: string;
  pending: number;
  labeled: number;
  cached: number;
  error?: string;
}

export type Message = LabelRequest | ThemeCssRequest | InjectRequest | StatusReport | StatusQuery;
