import { expect, test, type Page } from '@playwright/test';
import { launchExtension, waitForThemed, type Extension } from '../../scripts/lib/extension.ts';
import { colorsOf, style } from './helpers.ts';
import { startMockJev, type MockJev } from './mock-jev.ts';

const DARK = colorsOf('gruvbox-dark-medium');

let ext: Extension;
let jev: MockJev;
let page: Page;
let extensionUrl: string;

test.beforeEach(async () => {
  jev = await startMockJev();
  ext = await launchExtension();
  await ext.setSettings({ apiKey: 'test-key', apiBase: jev.url, defaultTheme: 'gruvbox-dark-medium', sites: {} });
  page = await ext.context.newPage();
  extensionUrl = `chrome-extension://${new URL(ext.worker.url()).host}`;
});

test.afterEach(async () => {
  await ext.close();
  await jev.close();
});

const field = (key: string) => page.locator(`[id="f-${key}"]`);

async function setColor(key: string, value: string) {
  await field(key).fill(value);
  await field(key).blur();
}

/** Makes "Navy Night" (Gruvbox Dark Medium with a navy page) in the editor and saves it. */
async function makeNavyTheme() {
  await page.goto(`${extensionUrl}/editor.html?from=gruvbox-dark-medium`);
  await page.fill('#name', 'Navy Night');
  await setColor('background.page', '#101830');
  await page.click('#save');
  await expect(page.locator('#messages')).toContainText('Saved "Navy Night"');
}

test.describe('type-ahead theme picker', () => {
  test('filters as you type and picks with the keyboard', async () => {
    await page.goto(`${extensionUrl}/options.html`);
    const input = page.locator('#default-theme');
    await expect(input).toHaveValue('Gruvbox Dark Medium');

    await input.click();
    await input.fill('light hard');
    await expect(page.locator('.picker-option')).toHaveText(['Gruvbox Light Hard']);
    await expect(page.locator('.picker-option mark')).toHaveText(['Light', 'Hard']);
    await input.press('Enter');
    await expect(input).toHaveValue('Gruvbox Light Hard');
    await expect.poll(async () => ((await ext.storage()).settings as { defaultTheme: string }).defaultTheme).toBe('gruvbox-light-hard');

    // Words in any order, arrow keys, and Escape to back out without changing anything.
    await input.click();
    await input.fill('soft gruv');
    await expect(page.locator('.picker-option')).toHaveText(['Gruvbox Dark Soft', 'Gruvbox Light Soft']);
    await input.press('ArrowDown');
    await expect(page.locator('.picker-option.active')).toHaveText('Gruvbox Light Soft');
    await input.press('Escape');
    await expect(input).toHaveValue('Gruvbox Light Hard');

    await input.click();
    await input.fill('solarized');
    await expect(page.locator('.picker-empty')).toHaveText('No themes match');
  });
});

test.describe('theme editor', () => {
  test('a saved custom theme themes pages like a built-in one', async () => {
    await makeNavyTheme();
    const stored = (await ext.storage()).customThemes as Record<string, { definition: { name: string; background: Record<string, string> } }>;
    expect(stored['custom-navy-night']!.definition.name).toBe('Navy Night');
    // Soft tints follow the page color they are mixed with.
    expect(stored['custom-navy-night']!.definition.background['danger-soft']).not.toBe(DARK.bg['danger-soft']);

    await ext.setSettings({ sites: { [jev.host]: 'custom-navy-night' } });
    const site = await ext.context.newPage();
    await site.goto(`${jev.url}/fixture`);
    await waitForThemed(site);
    expect(await style(site, 'html', 'backgroundColor')).toBe('rgb(16, 24, 48)');
    expect(await style(site, '#card', 'backgroundColor')).toBe(DARK.bg.raised); // unchanged tokens carry over
    expect(await style(site, '#btn', 'backgroundColor')).toBe(DARK.bg.accent);
  });

  test('editing a saved theme recolors open pages without a reload', async () => {
    await makeNavyTheme();
    await ext.setSettings({ sites: { [jev.host]: 'custom-navy-night' } });
    const site = await ext.context.newPage();
    await site.goto(`${jev.url}/fixture`);
    await waitForThemed(site);

    await page.goto(`${extensionUrl}/editor.html?id=custom-navy-night`);
    await expect(page.locator('#title')).toContainText('Navy Night');
    await expect(page.locator('#start-field')).toBeHidden(); // only for new themes
    await setColor('background.raised', '#203050');
    await page.click('#save');
    await expect.poll(() => style(site, '#card', 'backgroundColor')).toBe('rgb(32, 48, 80)');
  });

  test('exports JSON that imports back as a new theme', async () => {
    await makeNavyTheme();
    await page.click('#export');
    const json = JSON.parse(await page.locator('#export-text').inputValue());
    expect(json).toMatchObject({ format: 1, id: 'custom-navy-night', name: 'Navy Night', mode: 'dark' });
    expect(json.background.page).toBe('#101830');
    await page.click('#export-close');

    json.name = 'Navy Night Imported';
    json.text.link = '#ff00ff';
    await page.goto(`${extensionUrl}/editor.html?import=1`);
    await page.fill('#import-text', JSON.stringify(json));
    await page.click('#import-load');
    await expect(field('text.link')).toHaveValue('#ff00ff');
    await page.click('#save');
    await expect(page.locator('#messages')).toContainText('Saved "Navy Night Imported"');
    const stored = (await ext.storage()).customThemes as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['custom-navy-night', 'custom-navy-night-imported']);
  });

  test('refuses to save an invalid theme and explains why', async () => {
    await page.goto(`${extensionUrl}/editor.html?from=gruvbox-dark-medium`);
    await page.fill('#name', '');
    await page.click('#save');
    await expect(page.locator('#messages')).toContainText('"name" is required.');
    await field('text.text').fill('not a color');
    await expect(field('text.text')).toHaveAttribute('aria-invalid', 'true');

    await page.goto(`${extensionUrl}/editor.html?import=1`);
    await page.fill('#import-text', '{"format": 1, "id": "x", "name": "Broken", "mode": "dark"}');
    await page.click('#import-load');
    await expect(page.locator('#import-errors')).toContainText('"background" must be an object of colors.');
  });

  test('deleting a theme a site uses falls back to the default theme', async () => {
    await makeNavyTheme();
    await ext.setSettings({ sites: { [jev.host]: 'custom-navy-night' } });
    const site = await ext.context.newPage();
    await site.goto(`${jev.url}/fixture`);
    await waitForThemed(site);
    expect(await style(site, 'html', 'backgroundColor')).toBe('rgb(16, 24, 48)');

    await page.goto(`${extensionUrl}/options.html`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-theme-id="custom-navy-night"] button', { hasText: 'Delete' }).click();
    await expect(page.locator('#no-themes')).toBeVisible();
    await expect.poll(() => style(site, 'html', 'backgroundColor')).toBe(DARK.base);
  });
});
