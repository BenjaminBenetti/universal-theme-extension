import type { JobImage } from '../shared/images.ts';
import type { Message, LabelResponse, StatusReport } from '../shared/messages.ts';
import { CUSTOM_THEMES_KEY, loadCustomThemes, loadSettings, SETTINGS_KEY, themeCssKey } from '../shared/settings.ts';
import { compileTheme, themeVarsCss } from '../themes/css.ts';
import { BUILTIN_THEMES } from '../themes/index.ts';
import { writeLabels } from './cache.ts';
import { JevError, systemOne, DEFAULT_API_BASE, type SystemOneResponse } from './jev.ts';
import { drawRemote, readPixels, readSvg } from './pixels.ts';
import { buildRequest, MAX_JOBS_PER_REQUEST, parseAnswers } from './questions.ts';
import { syncBootCss } from './registration.ts';

const sync = async () => syncBootCss(await loadSettings(), await loadCustomThemes());

chrome.runtime.onInstalled.addListener(async (details) => {
  // Built-in themes may have changed with this version: drop their compiled variables.
  const stale = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('themeCss:'));
  if (stale.length) await chrome.storage.local.remove(stale);
  await sync();
  if (details.reason === 'install' && !(await loadSettings()).apiKey) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(sync);
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (changes[SETTINGS_KEY] || changes[CUSTOM_THEMES_KEY])) await sync();
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.type) {
    case 'label':
      label(message.host, message.page, message.jobs).then(sendResponse);
      return true;
    case 'theme-css':
      builtinThemeCss(message.id).then(sendResponse);
      return true;
    case 'pixels':
      readPixels(message.url).then(sendResponse);
      return true;
    case 'svg':
      readSvg(message.url).then(sendResponse);
      return true;
    case 'inject-user-css':
      if (sender.tab?.id !== undefined) {
        chrome.scripting
          .insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, files: ['themes.css'], origin: 'USER' })
          .catch((err) => console.warn('[ute] user css injection failed', err));
      }
      return false;
    case 'status':
      if (sender.tab?.id !== undefined && sender.frameId === 0) updateBadge(sender.tab.id, message);
      return false;
    default:
      return false;
  }
});

/** Images are a preview feature on Jev's side: after Jev refuses them, ask without them for a while. */
const IMAGES_PAUSE_MS = 30 * 60_000;
let imagesPausedUntil = 0;

async function label(host: string, page: string, jobs: Parameters<typeof buildRequest>[2]): Promise<LabelResponse> {
  const settings = await loadSettings();
  if (!settings.apiKey) return { ok: false, error: 'No Jev API key configured', fatal: true };
  try {
    const batch = jobs.slice(0, MAX_JOBS_PER_REQUEST);
    const apiBase = settings.apiBase || DEFAULT_API_BASE;
    const images = Date.now() < imagesPausedUntil ? [] : await Promise.all(batch.map((job) => imageOf(job.image)));
    const request = buildRequest(host, page, batch, images);
    let response: SystemOneResponse;
    try {
      response = await systemOne(settings.apiKey, request, apiBase);
    } catch (err) {
      if (!request.assets || !(err instanceof JevError) || (err.status !== 400 && err.status !== 413)) throw err;
      // The words alone still describe every element, so the page is themed either way.
      console.warn('[ute] Jev refused the images; asking without them', err);
      imagesPausedUntil = Date.now() + IMAGES_PAUSE_MS;
      response = await systemOne(settings.apiKey, buildRequest(host, page, batch), apiBase);
    }
    const labels = parseAnswers(batch, response);
    await writeLabels(host, labels);
    return { ok: true, labels };
  } catch (err) {
    const fatal = err instanceof JevError && err.fatal;
    console.warn('[ute] labeling failed', err);
    return { ok: false, error: (err as Error).message, fatal };
  }
}

/** A picture as Jev receives it: drawn by the page already, or another site's image drawn here. */
async function imageOf(image: JobImage | undefined): Promise<string | undefined> {
  if (!image) return undefined;
  return 'jpeg' in image ? image.jpeg : drawRemote(image.url, image.backdrop);
}

/** A built-in theme's variables, compiled once and kept in storage for content scripts to read. */
async function builtinThemeCss(id: string): Promise<string> {
  const theme = BUILTIN_THEMES.find((t) => t.id === id);
  if (!theme) return '';
  const css = themeVarsCss(compileTheme(theme));
  await chrome.storage.local.set({ [themeCssKey(id)]: css });
  return css;
}

function updateBadge(tabId: number, status: StatusReport) {
  const text = status.error ? '!' : status.pending > 0 ? String(Math.min(status.pending, 999)) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  chrome.action.setBadgeBackgroundColor({ tabId, color: status.error ? '#cc241d' : '#d79921' }).catch(() => undefined);
  chrome.action.setTitle({ tabId, title: status.error ? `Universal Theme — ${status.error}` : 'Universal Theme' }).catch(() => undefined);
}
