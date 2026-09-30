import { expect, test, type Page } from '@playwright/test';
import { launchExtension, waitForThemed, type Extension } from '../../scripts/lib/extension.ts';
import { offColors, screenColors, style } from './helpers.ts';
import { startMockJev, type MockJev } from './mock-jev.ts';

// Gruvbox Dark Medium / Light Hard token colors, as computed styles.
const DARK = { base: 'rgb(40, 40, 40)', raised: 'rgb(60, 56, 54)', accent: 'rgb(250, 189, 47)', danger: 'rgb(251, 73, 52)', text: 'rgb(235, 219, 178)', link: 'rgb(131, 165, 152)' };
const LIGHT_HARD_RAISED = 'rgb(235, 219, 178)';

let ext: Extension;
let jev: MockJev;
let page: Page;

test.beforeEach(async () => {
  jev = await startMockJev();
  ext = await launchExtension();
  await ext.setSettings({ apiKey: 'test-key', apiBase: jev.url, defaultTheme: 'gruvbox-dark-medium', sites: {} });
  page = await ext.context.newPage();
});

test.afterEach(async () => {
  await ext.close();
  await jev.close();
});

const css = (selector: string, prop: 'backgroundColor' | 'color') => style(page, selector, prop);

test('crushes the page to the theme base color until Jev has labeled it', async () => {
  jev.delayMs = 2500;
  await page.goto(`${jev.url}/fixture`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.uteStatus === 'working');
  await page.waitForTimeout(300);
  // Nothing of the original page is visible: one flat color, the theme's base (±2 for anti-aliasing).
  expect(offColors(await screenColors(page), DARK.base)).toEqual([]);
  expect(await css('#card', 'backgroundColor')).toBe(DARK.base);
  expect(await css('#para', 'color')).toBe(DARK.base);

  await waitForThemed(page);
  expect(await css('#card', 'backgroundColor')).toBe(DARK.raised);
  expect(await css('#btn', 'backgroundColor')).toBe(DARK.accent);
  expect(await css('#btn', 'color')).toBe(DARK.base); // legible on the accent
  expect(await css('#link', 'color')).toBe(DARK.link);
  expect(await css('body', 'color')).toBe(DARK.text);
  expect(jev.calls).toBeGreaterThan(0);
});

test('beats inline !important styles', async () => {
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  expect(await css('#inline', 'backgroundColor')).toBe(DARK.raised);
});

test('new elements are crushed, then themed once Jev labels them', async () => {
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  jev.delayMs = 1500;
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'late';
    el.className = 'danger';
    el.textContent = 'Something went wrong';
    document.body.append(el);
  });
  expect(await css('#late', 'backgroundColor')).toBe(DARK.base);
  expect(await css('#late', 'color')).toBe(DARK.base);
  await waitForThemed(page);
  expect(await css('#late', 'backgroundColor')).toBe(DARK.danger);
});

test('repeat visits use cached labels without calling Jev', async () => {
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  const calls = jev.calls;
  await page.reload();
  await waitForThemed(page);
  expect(jev.calls).toBe(calls);
  expect(await css('#card', 'backgroundColor')).toBe(DARK.raised);
});

test('switching themes recolors the open page without calling Jev', async () => {
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  const calls = jev.calls;
  await ext.setSettings({ sites: { [jev.host]: 'gruvbox-light-hard' } });
  await page.waitForFunction(() => document.documentElement.dataset.uteTheme === 'gruvbox-light-hard');
  expect(await css('#card', 'backgroundColor')).toBe(LIGHT_HARD_RAISED);
  expect(jev.calls).toBe(calls);
});

test('a fixed header the same color as the page stays solid over content scrolling under it', async () => {
  await page.goto(`${jev.url}/fixed`);
  await waitForThemed(page);
  // Unasked, it would be transparent and the tiles would show through it.
  expect(await page.getAttribute('#bar', 'data-ute-bg')).toBe('raised');
  expect(await css('#bar', 'backgroundColor')).toBe(DARK.raised);
});

test('a site set to off is left exactly as the site made it', async () => {
  await ext.setSettings({ sites: { [jev.host]: 'off' } });
  await page.goto(`${jev.url}/fixture`);
  await page.waitForFunction(() => document.documentElement.dataset.uteStatus === 'off');
  expect(await css('#card', 'backgroundColor')).toBe('rgb(241, 243, 244)');
  expect(await css('body', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(jev.calls).toBe(0);
});

test('a rejected key shows the original page and reports the error', async () => {
  jev.status = 401;
  await page.goto(`${jev.url}/fixture`);
  await page.waitForFunction(() => document.documentElement.dataset.uteStatus === 'error');
  expect(await css('#card', 'backgroundColor')).toBe('rgb(241, 243, 244)');
});

test('registers the first-paint stylesheet for the default theme', async () => {
  const scripts = await ext.worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  expect(scripts).toEqual([expect.objectContaining({ id: 'boot-default', css: ['boot/gruvbox-dark-medium.css'], runAt: 'document_start' })]);
});

test('the settings page saves a key that works', async () => {
  await ext.setSettings({ apiKey: '' });
  const id = new URL(ext.worker.url()).host;
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.fill('#api-key', 'another-key');
  await page.click('#save-key');
  await expect(page.locator('#key-status')).toContainText('Key works');
  const stored = (await ext.storage()).settings as { apiKey: string };
  expect(stored.apiKey).toBe('another-key');
});
