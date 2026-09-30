import { DEFAULT_API_BASE } from '../background/jev.ts';
import { CUSTOM_THEMES_KEY, deleteCustomTheme, loadCustomThemes, loadSettings, saveSettings, type Settings } from '../shared/settings.ts';
import { DEFAULT_THEME_ID, findTheme, swatchesOf, type CustomThemes } from '../themes/index.ts';
import { OFF_OPTION, themeOptions } from './common.ts';
import { roamInky } from './inky.ts';
import { renderSwatches, ThemePicker } from './theme-picker.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;
let custom: CustomThemes;
let defaultPicker: ThemePicker;

const editorUrl = (params: Record<string, string>) => `editor.html?${new URLSearchParams(params)}`;

async function checkKey(key: string): Promise<string | undefined> {
  const res = await fetch(`${settings.apiBase || DEFAULT_API_BASE}/v1/models`, { headers: { authorization: `Bearer ${key}` } }).catch(() => undefined);
  if (!res) return 'Could not reach TypeSafe.';
  if (res.status === 401 || res.status === 403) return 'TypeSafe rejected this key.';
  if (!res.ok) return `TypeSafe answered ${res.status}.`;
  return undefined;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function renderThemes() {
  const list = $('themes');
  list.replaceChildren();
  const mine = Object.values(custom).sort((a, b) => a.definition.name.localeCompare(b.definition.name));
  $('no-themes').hidden = mine.length > 0;
  for (const { definition } of mine) {
    const row = document.createElement('li');
    row.dataset.themeId = definition.id;
    const name = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'name';
    title.textContent = definition.name;
    const detail = document.createElement('div');
    detail.className = 'muted';
    detail.textContent = `${definition.mode === 'dark' ? 'Dark' : 'Light'}${definition.family ? ` · ${definition.family}` : ''}`;
    name.append(title, detail);
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    renderSwatches(swatches, swatchesOf(definition));
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Edit', () => (location.href = editorUrl({ id: definition.id }))),
      button('Duplicate', () => (location.href = editorUrl({ from: definition.id }))),
      button('Delete', async () => {
        const inUse = settings.defaultTheme === definition.id || Object.values(settings.sites).includes(definition.id);
        const warning = inUse ? ' Sites using it will switch to the default theme.' : '';
        if (!confirm(`Delete "${definition.name}"?${warning}`)) return;
        if (settings.defaultTheme === definition.id) settings = await saveSettings({ defaultTheme: DEFAULT_THEME_ID });
        await deleteCustomTheme(definition.id);
      }),
    );
    row.append(name, swatches, actions);
    list.append(row);
  }
}

function renderSites() {
  const body = $('sites');
  body.replaceChildren();
  const entries = Object.entries(settings.sites).sort(([a], [b]) => a.localeCompare(b));
  $('no-sites').hidden = entries.length > 0;
  for (const [host, choice] of entries) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = host;
    const theme = document.createElement('td');
    theme.textContent = choice === 'off' ? 'Off' : (findTheme(choice, custom)?.name ?? `${choice} (deleted)`);
    theme.className = 'muted';
    const actions = document.createElement('td');
    actions.append(
      button('Use default', async () => {
        const sites = { ...settings.sites };
        delete sites[host];
        settings = await saveSettings({ sites });
        renderSites();
      }),
    );
    row.append(name, theme, actions);
    body.append(row);
  }
}

async function main() {
  roamInky(document.querySelector('main')!, $('inky-dock'));
  [settings, custom] = await Promise.all([loadSettings(), loadCustomThemes()]);

  const keyInput = $<HTMLInputElement>('api-key');
  keyInput.value = settings.apiKey;
  $('key-status').textContent = settings.apiKey ? 'Key saved.' : '';
  $('save-key').onclick = async () => {
    const key = keyInput.value.trim();
    const status = $('key-status');
    status.className = 'muted';
    status.textContent = 'Checking…';
    const problem = key ? await checkKey(key) : undefined;
    if (problem) {
      status.className = 'error';
      status.textContent = problem;
      return;
    }
    settings = await saveSettings({ apiKey: key });
    status.className = key ? 'ok' : 'muted';
    status.textContent = key ? 'Key works and is saved. Reload a page to theme it.' : 'Key removed.';
  };

  defaultPicker = new ThemePicker($('default-picker'), {
    inputId: 'default-theme',
    options: [OFF_OPTION, ...themeOptions(custom)],
    value: settings.defaultTheme,
    onChange: async (value) => {
      settings = await saveSettings({ defaultTheme: value });
    },
  });

  const hours = $<HTMLInputElement>('cache-hours');
  hours.value = String(settings.cacheHours);
  hours.onchange = async () => {
    const value = Math.max(1, Math.min(720, Number(hours.value) || 24));
    hours.value = String(value);
    settings = await saveSettings({ cacheHours: value });
  };

  $('new-theme').onclick = () => {
    const start = findTheme(settings.defaultTheme, custom)?.id ?? DEFAULT_THEME_ID;
    location.href = editorUrl({ from: start });
  };
  $('import-theme').onclick = () => (location.href = editorUrl({ import: '1' }));

  renderThemes();
  renderSites();
  chrome.storage.onChanged.addListener(async (changes) => {
    [settings, custom] = await Promise.all([loadSettings(), loadCustomThemes()]);
    if (changes[CUSTOM_THEMES_KEY]) {
      renderThemes();
      defaultPicker.setOptions([OFF_OPTION, ...themeOptions(custom)], settings.defaultTheme);
    }
    renderSites();
  });

  $('clear-cache').onclick = async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('labels:'));
    await chrome.storage.local.remove(keys);
    $('cache-status').textContent = ` Forgot labels for ${keys.length} site${keys.length === 1 ? '' : 's'}.`;
  };
}

main();
