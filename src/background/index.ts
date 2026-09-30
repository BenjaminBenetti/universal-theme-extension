import type { Message, LabelResponse, StatusReport } from '../shared/messages.ts';
import { CUSTOM_THEMES_KEY, loadCustomThemes, loadSettings, SETTINGS_KEY } from '../shared/settings.ts';
import { writeLabels } from './cache.ts';
import { JevError, systemOne, DEFAULT_API_BASE } from './jev.ts';
import { buildRequest, MAX_JOBS_PER_REQUEST, parseAnswers } from './questions.ts';
import { syncBootCss } from './registration.ts';

const sync = async () => syncBootCss(await loadSettings(), await loadCustomThemes());

chrome.runtime.onInstalled.addListener(async (details) => {
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

async function label(host: string, page: string, jobs: Parameters<typeof buildRequest>[2]): Promise<LabelResponse> {
  const settings = await loadSettings();
  if (!settings.apiKey) return { ok: false, error: 'No Jev API key configured', fatal: true };
  try {
    const batch = jobs.slice(0, MAX_JOBS_PER_REQUEST);
    const { state, questions } = buildRequest(host, page, batch);
    const response = await systemOne(settings.apiKey, state, questions, settings.apiBase || DEFAULT_API_BASE);
    const labels = parseAnswers(batch, response);
    await writeLabels(host, labels);
    return { ok: true, labels };
  } catch (err) {
    const fatal = err instanceof JevError && err.fatal;
    console.warn('[ute] labeling failed', err);
    return { ok: false, error: (err as Error).message, fatal };
  }
}

function updateBadge(tabId: number, status: StatusReport) {
  const text = status.error ? '!' : status.pending > 0 ? String(Math.min(status.pending, 999)) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  chrome.action.setBadgeBackgroundColor({ tabId, color: status.error ? '#cc241d' : '#d79921' }).catch(() => undefined);
  chrome.action.setTitle({ tabId, title: status.error ? `Universal Theme — ${status.error}` : 'Universal Theme' }).catch(() => undefined);
}
