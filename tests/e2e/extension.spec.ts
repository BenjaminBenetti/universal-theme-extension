import { expect, test, type Page } from '@playwright/test';
import { launchExtension, waitForThemed, type Extension } from '../../scripts/lib/extension.ts';
import { AVATAR_QUARTERS } from './fixtures.ts';
import { near, offColors, pictureAt, screenColors, style } from './helpers.ts';
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

/** The picture Jev was shown of the element with this id. */
const pictureOf = (id: string) => jev.pictures.find((p) => p.facts.element?.includes(`id="${id}"`))?.jpeg;

/** Checks a picture Jev was shown, point by point: [x, y, the color it should be there]. */
async function expectPicture(jpeg: string | undefined, want: Array<[number, number, string]>) {
  expect(jpeg, 'Jev was shown no picture').toBeTruthy();
  const seen = await pictureAt(page, jpeg!, want.map(([x, y]) => [x, y]));
  expect([seen.width, seen.height]).toEqual([280, 280]);
  want.forEach(([x, y, color], i) => expect(near(seen.colors[i]!, color), `(${x}, ${y}) is ${seen.colors[i]}, not ${color}`).toBe(true));
}

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

test("content added inside a themed page is described in the site's colors, not the theme's", async () => {
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  // The page's text is themed now; new text inherits it through a wrapper measured with it.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<section id="fresh"><div id="fresh-wrap"><p id="fresh-p">Fresh text <a href="#">link</a></p></div></section>');
  });
  await expect.poll(() => page.getAttribute('#fresh-p', 'data-ute'), { timeout: 5000 }).toBe('');
  await waitForThemed(page);
  const themedText = jev.elements.filter((f) => /grayish light yellow/.test(`${f['text color']} ${f['behind it']}`));
  expect(themedText).toEqual([]);
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

test('fixed and sticky boxes that match what they sit on stay solid, in that color', async () => {
  await page.goto(`${jev.url}/fixed`);
  await waitForThemed(page);
  // Nothing to ask Jev: they match what is behind them. See-through, the tiles scrolling under
  // them would show; a role of their own (a header bar's) would paint a band that was never there.
  expect(await page.getAttribute('#bar', 'data-ute-bg')).toBeNull();
  expect(await page.getAttribute('#bar', 'data-ute-cover')).toBe('');
  expect(await css('#bar', 'backgroundColor')).toBe(await css('body', 'backgroundColor'));
  expect(await css('#bar', 'backgroundColor')).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.getAttribute('#month', 'data-ute-cover')).toBe('');
  expect(await css('#card', 'backgroundColor')).toBe(DARK.accent);
  expect(await css('#month', 'backgroundColor')).toBe(DARK.accent);
});

test('a solid header that blends in stays solid, though only its wrapper is sticky', async () => {
  // Reddit: the sticky element is a see-through wrapper; the header bar inside paints the color.
  await page.goto(`${jev.url}/fixed`);
  await waitForThemed(page);
  expect(await page.getAttribute('#masthead', 'data-ute-bg')).toBe('inherit');
  expect(await page.getAttribute('#masthead', 'data-ute-cover')).toBe('');
  expect(await css('#masthead', 'backgroundColor')).toBe(await css('body', 'backgroundColor'));
  expect(await css('#masthead', 'backgroundColor')).not.toBe('rgba(0, 0, 0, 0)');
  // The see-through wrapper itself has nothing to paint.
  expect(await page.getAttribute('#top', 'data-ute-cover')).toBeNull();
});

test('graphics keep their details and stay visible on a dark theme', async () => {
  await page.goto(`${jev.url}/graphics`);
  await waitForThemed(page);
  const attr = (selector: string, name: string) => page.getAttribute(selector, name);
  const cdp = (selector: string, prop: Parameters<typeof style>[2]) => style(page, selector, prop);

  // A two-tone icon: the tile takes the icon color, the white glyph is cut out to what it sits on.
  expect(await attr('#tile', 'data-ute-paint')).toBe('fill');
  expect(await attr('#glyph', 'data-ute-paint')).toBeNull();
  expect(await attr('#glyph', 'data-ute-knock')).toBe('stroke');
  expect(await cdp('#tile', 'fill')).toBe(DARK.text);
  expect(await cdp('#glyph', 'stroke')).toBe(DARK.base); // it sits on the page

  // A button's ::after mask icon (a dropdown chevron) is labeled, so it keeps an ink color.
  expect(await attr('#menu', 'data-ute-after-ink')).toBe('muted');

  // A wordmark re-tinted as line art keeps its own ink color, so the re-tint isn't undone.
  expect(await attr('#wordmark', 'data-ute-g')).toBe('lineart');
  expect(await attr('#wordmark', 'data-ute-own-color')).toBe('#24292f');
  expect(await cdp('#wordmark', 'color')).toBe('rgb(36, 41, 47)');
  expect(await cdp('#wordmark', 'filter')).not.toBe('none');

  // A dark logo whose colors are kept is re-tinted on a dark theme instead of vanishing.
  expect(await attr('#logo', 'data-ute-g')).toBe('keep');
  expect(await attr('#logo', 'data-ute-paper')).toBe('light');
  expect(await cdp('#logo', 'filter')).not.toBe('none');

  // A text color kept as content (a syntax color) keeps its hue but is lightened to be readable.
  expect(await attr('#swatch', 'data-ute-fg')).toBe('content');
  expect(await attr('#swatch', 'data-ute-own-fg')).toBe('#0000a4');
  expect(await cdp('#swatch', 'color')).toMatch(/^oklch\(0\.72 /);

  // A see-through layer over text stays see-through.
  expect(await attr('#layer', 'data-ute-a')).toBe('4');
  expect(await cdp('#layer', 'backgroundColor')).toMatch(/\/ 0\.4\)$/);
});

test('Jev sees each graphic as a picture, in its original colors on what it sits on', async () => {
  await page.goto(`${jev.url}/graphics`);
  await waitForThemed(page);
  // A two-tone icon: the white glyph on its indigo tile, and the white page past its rounded corners.
  await expectPicture(pictureOf('two-tone'), [[140, 140, '#ffffff'], [40, 140, '#4f46e5'], [3, 3, '#ffffff']]);
  // A wordmark painted in its text color (currentColor), scaled to fit the square.
  await expectPicture(pictureOf('wordmark'), [[140, 140, '#24292f'], [140, 20, '#ffffff']]);
  // An icon drawn from a sprite sheet elsewhere on the page (<use href="#…">).
  await expectPicture(pictureOf('sprite-icon'), [[140, 140, '#d93025'], [10, 10, '#ffffff']]);
  // An image the page itself may read.
  const { topLeft, topRight, bottomLeft, bottomRight } = AVATAR_QUARTERS;
  await expectPicture(pictureOf('local-avatar'), [[70, 70, topLeft], [210, 70, topRight], [70, 210, bottomLeft], [210, 210, bottomRight]]);
  expect(await page.getAttribute('#local-avatar', 'data-ute-g')).toBe('keep');
});

test('Jev is told where each element sits, from the body down, without the plain wrappers', async () => {
  await page.goto(`${jev.url}/graphics`);
  await waitForThemed(page);
  const inside = (id: string) => jev.elements.find((f) => f.element?.includes(`id="${id}"`))?.inside;
  expect(inside('local-avatar')).toBe('body > article.comment > … > a.author');
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  // Ancestors with a background of their own say so, in their original color.
  expect(inside('link')).toBe('body > div#card.card (off-white) > p#para');
});

test('when Jev refuses pictures, it is asked again without them and the page is still themed', async () => {
  jev.refusePictures = true;
  await page.goto(`${jev.url}/graphics`);
  await waitForThemed(page);
  expect(jev.pictureRequests).toBeGreaterThan(0);
  expect(jev.pictures).toEqual([]);
  expect(await page.getAttribute('#wordmark', 'data-ute-g')).toBe('lineart');
  expect(await page.getAttribute('#local-avatar', 'data-ute-g')).toBe('keep'); // from its pixels, in words
});

test('a message that arrives mid-animation is labeled by its resting colors', async () => {
  await page.goto(`${jev.url}/dynamic`);
  await waitForThemed(page);
  await page.evaluate(() => (window as unknown as { addMessage(id: string, isNew: boolean): void }).addMessage('flash', true));
  // While it flashes it may be measured red; once the animation is over it must not stay red.
  await expect.poll(() => page.getAttribute('#flash', 'data-ute'), { timeout: 5000 }).toBe('');
  await page.waitForTimeout(2500);
  await waitForThemed(page);
  // At rest it has no background of its own.
  expect(await page.getAttribute('#flash', 'data-ute-bg')).toBeNull();
});

test('a message that appears under the pointer is labeled by its colors without hover', async () => {
  await page.goto(`${jev.url}/dynamic`);
  await waitForThemed(page);
  // The pointer rests on the list, so a new message arrives already in its hover color.
  await page.hover('#m0');
  await page.evaluate(() => (window as unknown as { addMessage(id: string, isNew: boolean): void }).addMessage('hovered', false));
  await expect.poll(() => page.getAttribute('#hovered', 'data-ute'), { timeout: 5000 }).toBe('');
  // The pointer moves away: the hover color must not stay.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);
  await waitForThemed(page);
  expect(await page.getAttribute('#hovered', 'data-ute-bg')).toBeNull();
});

test("another site's image is seen through the background, so an avatar stays a photo", async () => {
  await page.goto(`${jev.url}/avatars`);
  await waitForThemed(page);
  // The page may not read the avatar's pixels (it is from another site); the background reads them.
  const avatar = jev.elements.find((f) => f.element?.includes('class="avatar"'));
  expect(avatar?.pixels).toMatch(/fills its whole box/);
  // The background draws its picture for Jev too.
  const { topLeft, topRight, bottomLeft, bottomRight } = AVATAR_QUARTERS;
  await expectPicture(pictureOf('avatar'), [[70, 70, topLeft], [210, 70, topRight], [70, 210, bottomLeft], [210, 210, bottomRight]]);
  expect(await page.getAttribute('#avatar', 'data-ute-g')).toBe('keep');
  // Another site's SVG (an emoji on a CDN): the background reads its source, and the page draws it.
  await expectPicture(pictureOf('emoji'), [[140, 200, '#ffcc4d'], [93, 117, '#664500'], [3, 3, '#ffffff']]);
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

const sentTexts = () => jev.elements.map((f) => f.text).filter((t): t is string => !!t);
const storedSettings = async () => (await ext.storage()).settings as { defaultMode: string; siteModes: Record<string, string> };

test('performance mode, the default, sends element text to Jev as it is', async () => {
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  expect(sentTexts()).toContain('Hello link Go');
});

test('privacy mode scrambles element text before Jev sees it, and still themes the page', async () => {
  await ext.setSettings({ siteModes: { [jev.host]: 'privacy' } });
  await page.goto(`${jev.url}/fixture`);
  await waitForThemed(page);
  const sent = sentTexts();
  expect(sent.join(' ')).not.toMatch(/Hello|link|inline/);
  expect(sent).toContainEqual(expect.stringMatching(/^[A-Z][a-z]{4} [a-z]{4} [A-Z][a-z]$/)); // "Hello link Go", scrambled
  expect(await css('#card', 'backgroundColor')).toBe(DARK.raised);
});

test('privacy mode shows Jev no pictures, and still themes the graphics', async () => {
  await ext.setSettings({ siteModes: { [jev.host]: 'privacy' } });
  await page.goto(`${jev.url}/graphics`);
  await waitForThemed(page);
  expect(jev.pictureRequests).toBe(0);
  expect(jev.elements.some((f) => f.image)).toBe(false);
  expect(await page.getAttribute('#wordmark', 'data-ute-g')).toBe('lineart');
});

test('the popup switches privacy mode for the site it was opened on', async () => {
  await page.goto(`${jev.url}/fixture`);
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${new URL(ext.worker.url()).host}/popup.html`);
  // The popup acts on the active tab: make the fixture active, then load the popup again.
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator('#host')).toHaveText(jev.host);
  await expect(popup.locator('#privacy')).not.toBeChecked();
  await popup.locator('#privacy').check();
  await expect.poll(async () => (await storedSettings()).siteModes).toEqual({ [jev.host]: 'privacy' });
  await popup.locator('#privacy').uncheck();
  await expect.poll(async () => (await storedSettings()).siteModes).toEqual({});
});

test('the settings page sets the text mode for all sites', async () => {
  await page.goto(`chrome-extension://${new URL(ext.worker.url()).host}/options.html`);
  await expect(page.locator('#default-mode')).toHaveValue('performance');
  await page.selectOption('#default-mode', 'privacy');
  await expect.poll(async () => (await storedSettings()).defaultMode).toBe('privacy');
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
