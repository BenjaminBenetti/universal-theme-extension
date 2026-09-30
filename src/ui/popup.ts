import type { TabStatus } from '../shared/messages.ts';
import { cacheKey, CUSTOM_THEMES_KEY, loadCustomThemes, loadSettings, saveSettings } from '../shared/settings.ts';
import { findTheme, swatchesOf } from '../themes/index.ts';
import { OFF_OPTION, themeOptions } from './common.ts';
import { dockInky } from './inky.ts';
import { ThemePicker } from './theme-picker.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  dockInky($('inky-dock'), 2);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ? new URL(tab.url) : undefined;
  const host = url && /^https?:|^file:/.test(url.protocol) ? url.hostname || url.protocol.replace(':', '') : undefined;
  let [settings, custom] = await Promise.all([loadSettings(), loadCustomThemes()]);

  $('host').textContent = host ?? 'this page cannot be themed';
  $('no-key').hidden = !!settings.apiKey;
  $('add-key').onclick = $('settings').onclick = () => chrome.runtime.openOptionsPage();

  const siteOptions = () => {
    const fallback = findTheme(settings.defaultTheme, custom);
    return [
      { value: '', label: `Default (${fallback?.name ?? 'Off'})`, swatches: fallback ? swatchesOf(fallback) : [], keywords: 'default' },
      OFF_OPTION,
      ...themeOptions(custom),
    ];
  };
  const sitePicker = new ThemePicker($('site-picker'), {
    inputId: 'site-theme',
    options: siteOptions(),
    value: host ? (settings.sites[host] ?? '') : '',
    onChange: async (value) => {
      if (!host) return;
      const sites = { ...settings.sites };
      if (value) sites[host] = value;
      else delete sites[host];
      settings = await saveSettings({ sites });
    },
  });
  sitePicker.disabled = !host;
  const defaultPicker = new ThemePicker($('default-picker'), {
    inputId: 'default-theme',
    options: [OFF_OPTION, ...themeOptions(custom)],
    value: settings.defaultTheme,
    onChange: async (value) => {
      settings = await saveSettings({ defaultTheme: value });
      sitePicker.setOptions(siteOptions()); // "Default (…)" names the new default
    },
  });
  chrome.storage.onChanged.addListener(async (changes) => {
    if (!changes[CUSTOM_THEMES_KEY]) return;
    custom = await loadCustomThemes();
    sitePicker.setOptions(siteOptions());
    defaultPicker.setOptions([OFF_OPTION, ...themeOptions(custom)]);
  });

  $('relayout').onclick = async () => {
    if (!host || tab?.id === undefined) return;
    await chrome.storage.local.remove(cacheKey(host));
    await chrome.tabs.reload(tab.id);
    window.close();
  };
  ($('relayout') as HTMLButtonElement).disabled = !host;

  const showStatus = async () => {
    if (tab?.id === undefined || !host) return;
    const s = (await chrome.tabs.sendMessage(tab.id, { type: 'get-status' }, { frameId: 0 }).catch(() => undefined)) as TabStatus | undefined;
    const el = $('status');
    el.className = s?.error ? 'error' : 'muted';
    if (!s) el.textContent = 'Reload the page to theme it.';
    else if (s.error) el.textContent = s.error;
    else if (s.theme === 'off') el.textContent = 'Theming is off here.';
    else if (s.pending) el.textContent = `Jev is labeling ${s.pending} styles…`;
    else el.textContent = `Jev has labeled ${s.cached} styles on this site.`;
  };
  showStatus();
  setInterval(showStatus, 500);
}

main();
