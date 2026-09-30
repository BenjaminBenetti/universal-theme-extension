// Captures everything the marketing video shows, with the real extension and the real Jev:
// the hero page in its own colors and in every built-in theme, the popup while a theme is picked,
// where Jev put each design role on the page, and a few other sites in a handful of themes.
//
//   HERO_URL=…  HERO_USER=… HERO_PASS=…  node marketing/video/capture.ts
//
// HERO_USER / HERO_PASS sign in to the hero page (a Nexus EMR chart behind Auth0); they are read
// from the environment only. Output goes to marketing/video/out/capture (git-ignored).

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { jevKey, launchExtension, ROOT, waitForThemed, type Extension } from '../../scripts/lib/extension.ts';
import { BUILTIN_THEMES } from '../../src/themes/index.ts';
import type { ThemeDefinition } from '../../src/themes/format.ts';

const OUT = path.join(ROOT, 'marketing/video/out/capture');
const PROFILE = path.join(ROOT, 'marketing/video/out/profile');
const HERO_URL = process.env.HERO_URL;
if (!HERO_URL) throw new Error('Set HERO_URL to the page the video is built around.');
const key = jevKey();
if (!key) throw new Error('Set TYPESAFE_API_KEY (or JEV_KEY in secrets.env).');
const heroHost = new URL(HERO_URL).hostname;

/** The other sites, each shown in its own colors and then in three themes. */
const SITES = [
  { id: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Octopus', settle: 1000, themes: ['catppuccin-latte', 'dracula', 'everforest-dark-medium'] },
  { id: 'github', url: 'https://github.com/morhetz/gruvbox', settle: 500, themes: ['kanagawa-wave', 'rose-pine-dawn', 'github-dark-dimmed'] },
  { id: 'sheets', url: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit', settle: 4000, themes: ['nord', 'solarized-light', 'synthwave-84'] },
  {
    id: 'excel',
    url: 'https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fgo.microsoft.com%2Ffwlink%2F%3FLinkID%3D521962',
    settle: 7000,
    themes: ['one-dark', 'flexoki-light', 'tokyo-night-storm'],
  },
];

/** Every theme, one family at a time round-robin, so consecutive themes always look different. */
export function cycleOrder(themes: ThemeDefinition[]): ThemeDefinition[] {
  const families = new Map<string, ThemeDefinition[]>();
  for (const t of themes) families.set(t.family ?? t.id, [...(families.get(t.family ?? t.id) ?? []), t]);
  // Alternate dark and light inside each family so repeats of a family also differ.
  const queues = [...families.values()].map((list) => {
    const dark = list.filter((t) => t.mode === 'dark');
    const light = list.filter((t) => t.mode === 'light');
    const mixed: ThemeDefinition[] = [];
    while (dark.length || light.length) {
      if (dark.length) mixed.push(dark.shift()!);
      if (light.length) mixed.push(light.shift()!);
    }
    return mixed;
  });
  const order: ThemeDefinition[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) order.push(q.shift()!);
  return order;
}

fs.mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

async function setTheme(ext: Extension, host: string, theme: string) {
  const settings = ((await ext.storage()).settings ?? {}) as { sites?: Record<string, string> };
  await ext.setSettings({ apiKey: key, sites: { ...settings.sites, [host]: theme } });
}

/** Waits for a live theme switch to land (no reload), then for any late labeling to finish. */
async function waitForSwitch(page: Page, theme: string) {
  await page.waitForFunction((id) => document.documentElement.dataset.uteTheme === id, theme, { timeout: 20_000 });
  await waitForThemed(page, 60_000);
  await page.waitForTimeout(250);
}

async function signIn(page: Page) {
  await page.goto(HERO_URL!, { waitUntil: 'networkidle' }).catch(() => undefined);
  if (!/\/login/.test(page.url())) return;
  const user = process.env.HERO_USER;
  const pass = process.env.HERO_PASS;
  if (!user || !pass) throw new Error('The hero page asks to sign in: set HERO_USER and HERO_PASS.');
  await page.click('text=Continue with WELLSTAR ID');
  // The identity provider may still remember us and send us straight back.
  const signedIn = (url: URL) => url.hostname === heroHost && !/\/login/.test(url.pathname);
  await Promise.race([page.waitForSelector('input#username', { timeout: 30_000 }), page.waitForURL(signedIn, { timeout: 30_000 })]);
  if (!signedIn(new URL(page.url()))) {
    await page.fill('input#username', user);
    await page.fill('input#password', pass);
    await page.keyboard.press('Enter');
    await page.waitForURL(signedIn, { timeout: 60_000 });
  }
  await page.goto(HERO_URL!, { waitUntil: 'networkidle' }).catch(() => undefined);
}

/** Closes the app's keyboard-shortcut hint bar so the page is clean. */
async function tidyHero(page: Page) {
  await page
    .evaluate(() => {
      const hint = [...document.querySelectorAll('*')].find((el) => el.childElementCount === 0 && el.textContent?.trim() === 'Command palette');
      let box: Element | null | undefined = hint;
      for (let i = 0; box && i < 8; i++, box = box.parentElement) {
        const close = [...box.querySelectorAll('button')].at(-1);
        if (close && box.getBoundingClientRect().height < 120) {
          close.click();
          return;
        }
      }
    })
    .catch(() => undefined);
  // Closing it shows a "Shortcuts bar hidden" toast for a few seconds; wait it out.
  await page.waitForFunction(() => !document.body.innerText.includes('Shortcuts bar hidden'), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

/** Where Jev put each design role: a few boxes per token, in page CSS pixels. */
async function labelBoxes(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ role: string; token: string; x: number; y: number; w: number; h: number; text: string }> = [];
    const visible = (r: DOMRect) => r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    for (const [attr, role] of [['data-ute-bg', 'background'], ['data-ute-fg', 'text'], ['data-ute-bd', 'border']] as const) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        const r = el.getBoundingClientRect();
        if (!visible(r)) continue;
        out.push({ role, token: el.getAttribute(attr)!, x: r.left, y: r.top, w: r.width, h: r.height, text: (el.textContent ?? '').trim().slice(0, 40) });
      }
    }
    return out;
  });
}

async function openPopupFor(ext: Extension, site: Page): Promise<Page> {
  const base = `chrome-extension://${new URL(ext.worker.url()).host}`;
  const popup = await ext.context.newPage();
  await popup.setViewportSize({ width: 320, height: 560 });
  await popup.goto(`${base}/popup.html`);
  // The popup themes "the active tab": make the site active, then load the popup again behind it.
  await site.bringToFront();
  await popup.reload();
  await popup.waitForTimeout(700);
  return popup;
}

const ext = await launchExtension({ userDataDir: PROFILE, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
await ext.setSettings({ apiKey: key, defaultTheme: 'off', sites: { [heroHost]: 'off' } });
const hero = await ext.context.newPage();
await signIn(hero);
await hero.waitForTimeout(2500);
await tidyHero(hero);
await shot(hero, 'hero-original');
console.log('hero: original');
if (process.env.CAPTURE_ONLY === 'original') {
  await ext.close();
  process.exit(0);
}

// The popup, while someone picks "Tokyo Night" for this site.
await setTheme(ext, heroHost, '');
await ext.setSettings({ sites: {} });
const popup = await openPopupFor(ext, hero);
await popup.screenshot({ path: path.join(OUT, 'popup-0.png') });
await popup.click('#site-theme');
await popup.waitForTimeout(250);
await popup.screenshot({ path: path.join(OUT, 'popup-1.png') });
const typed = 'tokyo';
for (let i = 1; i <= typed.length; i++) {
  await popup.keyboard.type(typed[i - 1]!);
  await popup.waitForTimeout(120);
  await popup.screenshot({ path: path.join(OUT, `popup-type-${i}.png`) });
}
await popup.keyboard.press('Enter');
await popup.waitForTimeout(400);
await popup.screenshot({ path: path.join(OUT, 'popup-2.png') });
await popup.close();
await hero.bringToFront();
await waitForSwitch(hero, 'tokyo-night');
await shot(hero, 'hero-tokyo-night');
fs.writeFileSync(path.join(OUT, 'hero-labels.json'), JSON.stringify(await labelBoxes(hero), null, 1));
console.log('hero: popup and labels');

// Every theme.
const order = cycleOrder(BUILTIN_THEMES);
for (const theme of order) {
  await setTheme(ext, heroHost, theme.id);
  await waitForSwitch(hero, theme.id);
  await shot(hero, `hero-${theme.id}`);
  console.log(`hero: ${theme.name}`);
}

// Other sites.
for (const site of SITES) {
  const host = new URL(site.url).hostname;
  await setTheme(ext, host, 'off');
  const page = await ext.context.newPage();
  await page.goto(site.url, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(site.settle);
  await shot(page, `${site.id}-original`);
  for (const theme of site.themes) {
    await setTheme(ext, host, theme);
    await waitForSwitch(page, theme);
    await page.waitForTimeout(site.settle / 4);
    await shot(page, `${site.id}-${theme}`);
    console.log(`${site.id}: ${theme}`);
  }
  await page.close();
}

fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      hero: { url: HERO_URL, title: await hero.title() },
      cycle: order.map((t) => ({ id: t.id, name: t.name, family: t.family, mode: t.mode, page: t.background.page, accent: t.background.accent, text: t.text.text })),
      sites: SITES.map((s) => ({ id: s.id, url: s.url, themes: s.themes.map((id) => ({ id, name: BUILTIN_THEMES.find((t) => t.id === id)!.name })) })),
    },
    null,
    1,
  ),
);
await ext.close();
console.log('capture done:', path.relative(ROOT, OUT));
