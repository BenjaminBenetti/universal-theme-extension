// Launches Chromium with the built extension loaded (used by the e2e tests and the screenshot script).
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DIST = path.join(ROOT, 'dist');

export interface Extension {
  context: BrowserContext;
  worker: Worker;
  setSettings(patch: Record<string, unknown>): Promise<void>;
  storage(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** The Jev key: TYPESAFE_API_KEY / JEV_KEY from the environment, else JEV_KEY in ./secrets.env. */
export function jevKey(): string | undefined {
  const fromEnv = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY;
  if (fromEnv) return fromEnv;
  const file = path.join(ROOT, 'secrets.env');
  if (!fs.existsSync(file)) return undefined;
  return /^JEV_KEY=(.*)$/m.exec(fs.readFileSync(file, 'utf8'))?.[1]?.trim();
}

export async function launchExtension(
  options: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    /** Keep the profile (cookies, extension storage) in this folder between runs. */
    userDataDir?: string;
  } = {},
): Promise<Extension> {
  const keepProfile = !!options.userDataDir;
  const userDataDir = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ute-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: options.headless ?? true,
    viewport: options.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    locale: 'en-US',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  if (keepProfile) await worker.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  // The install handler opens the settings page when there is no key yet; close it.
  await new Promise((r) => setTimeout(r, 300));
  for (const page of context.pages()) if (page.url().startsWith('chrome-extension://')) await page.close();

  return {
    context,
    worker,
    async setSettings(patch) {
      await worker.evaluate(async (p) => {
        const current = ((await chrome.storage.local.get('settings')).settings ?? {}) as Record<string, unknown>;
        await chrome.storage.local.set({ settings: { apiKey: '', defaultTheme: 'gruvbox-dark-medium', sites: {}, cacheHours: 24, ...current, ...p } });
      }, patch);
      // Let the background re-register the first-paint stylesheets.
      await worker.evaluate(async () => {
        for (let i = 0; i < 50; i++) {
          if ((await chrome.scripting.getRegisteredContentScripts()).length) return;
          await new Promise((r) => setTimeout(r, 20));
        }
      });
    },
    storage: () => worker.evaluate(() => chrome.storage.local.get(null)),
    async close() {
      await context.close();
      if (!keepProfile) fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Theming status of every frame in the page that has our content script ("working", "ready", …). */
async function frameStatuses(page: Page): Promise<string[]> {
  const statuses = await Promise.all(
    page.frames().map((frame) => frame.evaluate(() => document.documentElement?.getAttribute('data-ute-status') ?? 'none').catch(() => 'gone')),
  );
  return statuses.filter((s) => s !== 'none' && s !== 'gone');
}

/**
 * Waits until the content script in every frame reports that nothing is left for Jev to label,
 * and stays that way for a moment (late widgets). Returns how long it took.
 */
export async function waitForThemed(page: Page, timeout = 20_000): Promise<number> {
  const started = Date.now();
  let calmSince = 0;
  while (Date.now() - started < timeout) {
    const statuses = await frameStatuses(page);
    const settled = statuses.length > 0 && statuses.every((s) => s === 'ready' || s === 'off' || s === 'error');
    if (!settled) calmSince = 0;
    else if (!calmSince) calmSince = Date.now();
    else if (Date.now() - calmSince >= 400) return calmSince - started;
    await page.waitForTimeout(50);
  }
  throw new Error(`not themed within ${timeout}ms: ${(await frameStatuses(page)).join(', ')}`);
}
