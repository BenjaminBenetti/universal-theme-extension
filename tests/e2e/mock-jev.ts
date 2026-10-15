// A stand-in for TypeSafe's API plus the fixture pages. Pages are served from 127.0.0.1; the same
// server is also reachable as localhost, which the app fixture uses as a second site for its frame.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { APP, AVATAR_PNG, AVATARS, DYNAMIC, EMOJI_SVG, FIXED, FIXTURE, FRAME, GRAPHICS, SHADOW } from './fixtures.ts';

type Facts = Record<string, string>;

/** Deterministic "Jev": blue is the accent, red or pink is danger, everything else is raised. */
function decide(kind: string, facts: Facts): string {
  switch (kind) {
    case 'bg':
      if (/class="blend/.test(facts.element ?? '')) return 'inherit';
      return /blue/.test(facts.background ?? '') ? 'accent' : /red|pink/.test(facts.background ?? '') ? 'danger' : 'raised';
    case 'fg':
      if (/class="swatch/.test(facts.element ?? '')) return 'content';
      return facts.element?.startsWith('<a') ? 'link' : /red/.test(facts['text color'] ?? '') ? 'danger' : 'text';
    case 'ink':
      return 'muted';
    case 'border':
      return 'subtle';
    default:
      if (/class="icon/.test(facts.element ?? '')) return 'icon';
      if (/class="wordmark/.test(facts.element ?? '')) return 'lineart';
      // Like the real Jev: a tiny unnamed avatar it cannot see passes for an icon.
      if (/class="avatar/.test(facts.element ?? '')) return facts.image || facts.pixels ? 'keep' : 'icon';
      return facts.element?.startsWith('<canvas') ? 'lineart' : 'keep';
  }
}

export interface MockJev {
  url: string;
  host: string;
  /** The same server under a different host name, for cross-site frames. */
  otherUrl: string;
  calls: number;
  /** Every element Jev was asked about, as the facts it was sent. */
  elements: Facts[];
  /** Every picture Jev was shown (a base64 JPEG), with the facts of the element it shows. */
  pictures: Array<{ facts: Facts; jpeg: string }>;
  /** Requests that carried pictures, including refused ones. */
  pictureRequests: number;
  /** Answer requests with pictures with 400, as Jev does when images are switched off. */
  refusePictures: boolean;
  delayMs: number;
  status: number;
  close(): Promise<void>;
}

export async function startMockJev(): Promise<MockJev> {
  const mock = { calls: 0, elements: [], pictures: [], pictureRequests: 0, refusePictures: false, delayMs: 0, status: 200 } as unknown as MockJev;
  const server = http.createServer((req, res) => {
    const pages: Record<string, () => string> = {
      '/fixture': () => FIXTURE,
      '/fixed': () => FIXED,
      '/graphics': () => GRAPHICS,
      '/dynamic': () => DYNAMIC,
      '/avatars': () => AVATARS(mock.otherUrl),
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
    if (req.url === '/avatar.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(AVATAR_PNG);
      return;
    }
    if (req.url === '/emoji.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end(EMOJI_SVG);
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
        const { state, questions, assets } = JSON.parse(body) as {
          state: { elements: Record<string, Facts> };
          questions: Record<string, unknown>;
          assets?: Record<string, { type: string; format: string; data_base64: string }>;
        };
        if (assets) {
          mock.pictureRequests++;
          // Like the real API: images need the Danger Zone header, and every asset must be referenced.
          const referenced = Object.keys(assets).every((ref) => Object.values(state.elements).some((f) => f.image === ref));
          if (mock.refusePictures || req.headers['typesafe-danger-zone-images'] !== 'true' || !referenced) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end('{"detail":"images are not turned on"}');
            return;
          }
          for (const facts of Object.values(state.elements)) {
            const asset = facts.image ? assets[facts.image] : undefined;
            if (asset) mock.pictures.push({ facts, jpeg: asset.data_base64 });
          }
        }
        mock.elements.push(...Object.values(state.elements));
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
