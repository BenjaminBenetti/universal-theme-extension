// Minimal client for TypeSafe's System One endpoint (the model is Jev).
// The official SDK targets Node; the HTTP API is one POST, so we call it with fetch.
// Calls must come from the service worker: the API does not allow extension origins via CORS,
// and host_permissions let the worker skip CORS entirely.

export const DEFAULT_API_BASE = 'https://api.typesafe.ai';
export const MODEL = 'jev-latest';

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Retrying will not help (bad key, bad request). */
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

const MAX_CONCURRENT = 8;
const RETRIES = 2;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function systemOne(
  apiKey: string,
  state: unknown,
  questions: Record<string, ChoiceQuestion>,
  apiBase = DEFAULT_API_BASE,
): Promise<SystemOneResponse> {
  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${apiBase}/v1/systemone`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, state, questions }),
        });
      } catch (err) {
        if (attempt < RETRIES) {
          await sleep(500 * 3 ** attempt);
          continue;
        }
        throw new JevError(`Could not reach Jev: ${(err as Error).message}`, 0, false);
      }
      if (response.ok) return (await response.json()) as SystemOneResponse;

      const retryable = response.status === 429 || response.status === 529 || response.status >= 500;
      if (retryable && attempt < RETRIES) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 500 * 3 ** attempt);
        continue;
      }
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      const fatal = response.status === 401 || response.status === 403;
      const reason = fatal ? 'Jev rejected the API key' : `Jev request failed (${response.status})`;
      throw new JevError(`${reason}: ${detail}`, response.status, fatal);
    }
  });
}
