// A stand-in for TypeSafe's API plus the fixture pages. Pages are served from 127.0.0.1; the same
// server is also reachable as localhost, which the app fixture uses as a second site for its frame.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { APP, FIXED, FIXTURE, FRAME, SHADOW } from './fixtures.ts';

type Facts = Record<string, string>;

/** Deterministic "Jev": blue is the accent, red or pink is danger, everything else is raised. */
function decide(kind: string, facts: Facts): string {
  switch (kind) {
    case 'bg':
      return /blue/.test(facts.background ?? '') ? 'accent' : /red|pink/.test(facts.background ?? '') ? 'danger' : 'raised';
    case 'fg':
      return facts.element?.startsWith('<a') ? 'link' : /red/.test(facts['text color'] ?? '') ? 'danger' : 'text';
    case 'ink':
      return 'muted';
    case 'border':
      return 'subtle';
    default:
      return facts.element?.startsWith('<canvas') ? 'lineart' : 'keep';
  }
}

export interface MockJev {
  url: string;
  host: string;
  /** The same server under a different host name, for cross-site frames. */
  otherUrl: string;
  calls: number;
  delayMs: number;
  status: number;
  close(): Promise<void>;
}

export async function startMockJev(): Promise<MockJev> {
  const mock = { calls: 0, delayMs: 0, status: 200 } as MockJev;
  const server = http.createServer((req, res) => {
    const pages: Record<string, () => string> = {
      '/fixture': () => FIXTURE,
      '/fixed': () => FIXED,
      '/shadow': () => SHADOW,
      '/app': () => APP(`${mock.otherUrl}/frame`),
      '/frame': () => FRAME,
    };
    const page = req.method === 'GET' ? pages[req.url?.split('?')[0] ?? ''] : undefined;
    if (page) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page());
      return;
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"models":[]}');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/systemone') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      mock.calls++;
      setTimeout(() => {
        if (mock.status !== 200) {
          res.writeHead(mock.status, { 'content-type': 'application/json' });
          res.end('{"detail":"mock error"}');
          return;
        }
        const { state, questions } = JSON.parse(body) as { state: { elements: Record<string, Facts> }; questions: Record<string, unknown> };
        const answers: Record<string, unknown> = {};
        for (const key of Object.keys(questions)) {
          const [id, kind] = key.split('_') as [string, string];
          const choice = decide(kind, state.elements[id] ?? {});
          answers[key] = { type: 'choice', choice, confidence: 1, probabilities: { [choice]: 1 } };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: 'mock', answers, usage: { input_tokens: 1, output_tokens: 1 } }));
      }, mock.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  mock.url = `http://127.0.0.1:${port}`;
  mock.otherUrl = `http://localhost:${port}`;
  mock.host = '127.0.0.1';
  mock.close = () => new Promise((resolve) => server.close(() => resolve()));
  return mock;
}
