import { expect, test, type Page } from '@playwright/test';
import { launchExtension, waitForThemed, type Extension } from '../../scripts/lib/extension.ts';
import { colorsOf, offColors, screenColors, style } from './helpers.ts';
import { startMockJev, type MockJev } from './mock-jev.ts';

const DARK = colorsOf('gruvbox-dark-medium');
const LIGHT_HARD = colorsOf('gruvbox-light-hard');

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

test.describe('web components', () => {
  test('themes open, closed, nested, declarative, and late-upgraded shadow roots', async () => {
    await page.goto(`${jev.url}/shadow`);
    await waitForThemed(page);
    await page.waitForTimeout(800); // x-late upgrades at 600ms
    await waitForThemed(page);

    for (const panel of [
      ['#open-card', '#panel'],
      ['@closed', '#panel'],
      ['#nest-host', '#inner-card', '#panel'],
      ['#dsd', '#panel'],
      ['#late', '#panel'],
    ]) {
      expect(await style(page, panel, 'backgroundColor'), panel.join(' ')).toBe(DARK.bg.raised);
      expect(await style(page, panel, 'borderBottomColor'), panel.join(' ')).toBe(DARK.border.subtle);
    }
    expect(await style(page, ['#open-card', '#btn'], 'backgroundColor')).toBe(DARK.bg.accent);
    expect(await style(page, ['#open-card', '#btn'], 'color')).toBe(DARK.onSolid.accent);
    // Slotted light-DOM content inherits through the slot, and its own color is labeled.
    expect(await style(page, '#slotted', 'color')).toBe(DARK.fg.danger);
  });

  test('shadow content is crushed until Jev has labeled it', async () => {
    jev.delayMs = 2500;
    await page.goto(`${jev.url}/shadow`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.uteStatus === 'working');
    await page.waitForTimeout(300);
    expect(offColors(await screenColors(page), DARK.base)).toEqual([]);
    expect(await style(page, ['#open-card', '#panel'], 'backgroundColor')).toBe(DARK.base);
    await waitForThemed(page);
    expect(await style(page, ['#open-card', '#panel'], 'backgroundColor')).toBe(DARK.bg.raised);
  });

  test('a component replacing its adopted stylesheets stays themed and is re-measured', async () => {
    await page.goto(`${jev.url}/shadow`);
    await waitForThemed(page);
    await page.evaluate(() => (document.getElementById('open-card') as HTMLElement & { swapStyles(): void }).swapStyles());
    // Its panel is now blue in the site's own styling, so Jev (the mock) calls it the accent.
    await expect.poll(() => style(page, ['#open-card', '#panel'], 'backgroundColor')).toBe(DARK.bg.accent);
  });

  test('elements added inside a shadow root are themed', async () => {
    await page.goto(`${jev.url}/shadow`);
    await waitForThemed(page);
    await page.evaluate(() => {
      const extra = document.createElement('div');
      extra.id = 'extra';
      extra.style.background = '#d93025';
      extra.textContent = 'added later';
      document.getElementById('open-card')!.shadowRoot!.append(extra);
    });
    await expect.poll(() => style(page, ['#open-card', '#extra'], 'backgroundColor')).toBe(DARK.bg.danger);
  });
});

test.describe('complex apps', () => {
  test("page scripts reading computed styles see the site's own colors", async () => {
    await page.goto(`${jev.url}/app`);
    await waitForThemed(page);
    // Rendered with the theme…
    expect(await style(page, '.head', 'backgroundColor')).toBe(DARK.bg.accent);
    // …while the page's own JavaScript sees its original colors (Office's high-contrast check
    // reads a probe element's background-image; charts read colors to paint canvases).
    const seen = await page.evaluate(() => ({
      head: getComputedStyle(document.querySelector('.head')!).backgroundColor,
      probe: getComputedStyle(document.getElementById('hc-probe')!).backgroundImage,
      text: getComputedStyle(document.body).getPropertyValue('color'),
    }));
    expect(seen).toEqual({ head: 'rgb(11, 87, 208)', probe: expect.stringContaining('url('), text: 'rgb(32, 33, 36)' });
  });

  test('a spreadsheet grid, its canvas, and late CSS-in-JS are all themed', async () => {
    await page.goto(`${jev.url}/app`);
    await waitForThemed(page);

    // 720 repeated cells: every one resolved, with only a handful of looks sent to Jev.
    const cells = await page.evaluate(() => [...document.querySelectorAll('.cell')].filter((c) => c.hasAttribute('data-ute')).length);
    expect(cells).toBe(720);
    expect(await style(page, '.head', 'backgroundColor')).toBe(DARK.bg.accent);
    expect(await style(page, '.cell:not(.head)', 'borderBottomColor')).toBe(DARK.border.subtle);
    expect(jev.calls).toBeLessThan(10);

    // The canvas draws at 400ms; once it has, Jev calls it line art and it is re-tinted into the theme.
    await expect.poll(() => page.evaluate(() => document.getElementById('canvas')!.getAttribute('data-ute-paper')), { timeout: 10_000 }).toBe('light');
    expect(await style(page, '#canvas', 'filter')).toContain('data:image/svg+xml');
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const box = (await page.locator('#canvas').boundingBox())!;
    const pixel = await page.screenshot({ clip: { x: box.x + box.width - 20, y: box.y + box.height - 10, width: 1, height: 1 } });
    const paper = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = new OffscreenCanvas(1, 1).getContext('2d')!;
      c.drawImage(img, 0, 0);
      return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    }, pixel.toString('base64'));
    expect(Math.max(...paper)).toBeLessThan(80); // white paper is now dark

    // A rule inserted with insertRule after the element was themed: pale pink → danger-soft.
    await expect.poll(() => style(page, '#late-style', 'backgroundColor')).toBe(DARK.bg['danger-soft']);
  });

  test('recycled grid cells pick up their new state', async () => {
    await page.goto(`${jev.url}/app`);
    await waitForThemed(page);
    await page.evaluate(() => (window as unknown as { recycle(): void }).recycle());
    await expect.poll(() => style(page, '.cell.selected', 'backgroundColor')).toBe(DARK.bg['accent-soft']);
    expect(await style(page, '.cell:not(.selected):not(.head)', 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
  });

  test("frames from other hosts follow the tab's site theme", async () => {
    await ext.setSettings({ sites: { [jev.host]: 'gruvbox-light-hard' } });
    await page.goto(`${jev.url}/app`);
    await waitForThemed(page);
    const frame = page.frame({ url: /localhost.*\/frame/ })!;
    await frame.waitForFunction(() => document.documentElement.dataset.uteStatus === 'ready');
    expect(await frame.evaluate(() => document.documentElement.dataset.uteTheme)).toBe('gruvbox-light-hard');
    expect(await style(frame, '#note', 'backgroundColor')).toBe(LIGHT_HARD.bg.raised);
  });
});
