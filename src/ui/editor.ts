// The theme editor: every color of a theme as a field, a live preview styled through the same CSS
// variables pages use, legibility checks, and JSON import/export. Saving compiles the theme (which
// runs the line-art filter search) and stores it; open pages using it recolor right away.

import { contrastRatio, parseColor } from '../shared/color.ts';
import { loadCustomThemes, loadSettings, saveCustomTheme, saveSettings } from '../shared/settings.ts';
import { compileTheme } from '../themes/css.ts';
import { retintFilter } from '../themes/filters.ts';
import {
  derivedColor,
  FIELDS,
  GROUP_LABELS,
  THEME_FORMAT,
  validateTheme,
  type Field,
  type Group,
  type ThemeDefinition,
} from '../themes/format.ts';
import { DEFAULT_THEME_ID, findTheme, isBuiltin, type CustomThemes } from '../themes/index.ts';
import { themeOptions } from './common.ts';
import { ThemePicker } from './theme-picker.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fieldId = (f: Pick<Field, 'group' | 'key'>) => `${f.group}.${f.key}`;

const GROUP_HINTS: Record<Group, string> = {
  background: 'Jev labels every box on a page with one of these roles.',
  text: 'Roles for text and icon colors.',
  border: 'Roles for outlines, dividers, and focus rings.',
  textOnFill: 'Labels on solid fills, like a primary button. Pick whatever reads best on each fill.',
  interface: 'Parts of the page the browser draws.',
};

let custom: CustomThemes = {};
let draft: ThemeDefinition;
/** Id of the saved custom theme being edited; undefined for a theme not saved yet. */
let editingId: string | undefined;
let dirty = false;
/** Fields that follow their sources (tints, text on fills) until set by hand. */
const auto = new Set<string>();
const rows = new Map<string, { field: Field; picker: HTMLInputElement; text: HTMLInputElement; auto: HTMLButtonElement }>();

// --- Colors -------------------------------------------------------------------------------------

const scratch = document.createElement('canvas').getContext('2d')!;

/** Any CSS color the user types, as #rrggbb or rgba(); undefined if it is not a color. */
function normalize(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  scratch.fillStyle = '#010203';
  scratch.fillStyle = value;
  const a = scratch.fillStyle;
  scratch.fillStyle = '#040506';
  scratch.fillStyle = value;
  return a === scratch.fillStyle && parseColor(a) ? a : undefined;
}

/** <input type=color> only takes opaque #rrggbb. */
function opaqueHex(value: string): string {
  const c = parseColor(value);
  if (!c) return '#000000';
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

const get = (f: Pick<Field, 'group' | 'key'>) => (draft[f.group] as Record<string, string>)[f.key]!;
const set = (f: Pick<Field, 'group' | 'key'>, value: string) => ((draft[f.group] as Record<string, string>)[f.key] = value);
const same = (a: string, b: string) => normalize(a) === normalize(b);

// --- Rendering ----------------------------------------------------------------------------------

function renderGroups() {
  const container = $('groups');
  container.replaceChildren();
  rows.clear();
  for (const group of Object.keys(GROUP_LABELS) as Group[]) {
    const section = document.createElement('section');
    section.className = 'card group';
    const h2 = document.createElement('h2');
    h2.textContent = GROUP_LABELS[group];
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = GROUP_HINTS[group];
    section.append(h2, hint);
    for (const field of FIELDS.filter((f) => f.group === group)) section.append(renderRow(field));
    container.append(section);
  }
}

function renderRow(field: Field): HTMLElement {
  const id = fieldId(field);
  const row = document.createElement('div');
  row.className = 'color-row';
  row.dataset.field = id;
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.setAttribute('aria-label', `${field.label} color`);
  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'value';
  text.id = `f-${id}`;
  text.spellcheck = false;
  const about = document.createElement('div');
  about.className = 'about';
  const label = document.createElement('label');
  label.htmlFor = text.id;
  label.textContent = field.label;
  const small = document.createElement('small');
  small.textContent = field.description;
  small.title = field.description;
  about.append(label, small);
  const autoButton = document.createElement('button');
  autoButton.type = 'button';
  autoButton.className = 'auto';
  autoButton.textContent = 'auto';
  autoButton.hidden = derivedColor(draft, field.group, field.key) === undefined;
  row.append(picker, text, about, autoButton);

  picker.addEventListener('input', () => edit(field, picker.value));
  text.addEventListener('input', () => {
    const value = normalize(text.value);
    text.setAttribute('aria-invalid', String(!value));
    if (value) edit(field, value);
  });
  text.addEventListener('change', () => fill(field)); // tidy the text on blur
  autoButton.addEventListener('click', () => {
    const derived = derivedColor(draft, field.group, field.key);
    if (!derived) return;
    set(field, derived);
    auto.add(id);
    changed();
  });
  rows.set(id, { field, picker, text, auto: autoButton });
  return row;
}

function fill(field: Field) {
  const row = rows.get(fieldId(field))!;
  const value = get(field);
  row.picker.value = opaqueHex(value);
  if (document.activeElement !== row.text) row.text.value = value;
  row.text.removeAttribute('aria-invalid');
  const isAuto = auto.has(fieldId(field));
  row.auto.setAttribute('aria-pressed', String(isAuto));
  row.auto.title = isAuto ? 'Follows the colors it is made from. Change it to set it yourself.' : 'Click to follow the colors it is made from again.';
}

function fillAll() {
  ($('name') as HTMLInputElement).value = draft.name;
  ($('family') as HTMLInputElement).value = draft.family ?? '';
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) radio.checked = radio.value === draft.mode;
  for (const { field } of rows.values()) fill(field);
  updatePreview();
}

/** A field was set by hand. */
function edit(field: Field, value: string) {
  set(field, value);
  const derived = derivedColor(draft, field.group, field.key);
  if (derived !== undefined && same(derived, value)) auto.add(fieldId(field));
  else auto.delete(fieldId(field));
  changed();
}

/**
 * Something changed: keep automatic fields in step, redraw, and remember there is work to save.
 * (fill() leaves a text box alone while it is being typed in.)
 */
function changed() {
  for (const id of auto) {
    const { field } = rows.get(id)!;
    const derived = derivedColor(draft, field.group, field.key);
    if (derived) set(field, derived);
  }
  for (const { field } of rows.values()) fill(field);
  dirty = true;
  updatePreview();
}

function computeAuto() {
  auto.clear();
  for (const field of FIELDS) {
    const derived = derivedColor(draft, field.group, field.key);
    if (derived !== undefined && same(derived, get(field))) auto.add(fieldId(field));
  }
}

// --- Preview and legibility ---------------------------------------------------------------------

let canvasTimer: ReturnType<typeof setTimeout> | undefined;

function updatePreview() {
  const preview = $('preview');
  const vars: Record<string, string> = {
    '--ute-visited': draft.interface.visitedLink,
    '--ute-selection-bg': draft.interface.selection,
    '--ute-selection-fg': draft.interface.selectionText,
    '--ute-scrollbar': `${draft.interface.scrollbarThumb} ${draft.interface.scrollbarTrack}`,
  };
  for (const [k, v] of Object.entries(draft.background)) vars[`--ute-bg-${k}`] = v;
  for (const [k, v] of Object.entries(draft.text)) vars[`--ute-fg-${k}`] = v;
  for (const [k, v] of Object.entries(draft.border)) vars[`--ute-bd-${k}`] = v;
  for (const [k, v] of Object.entries(draft.textOnFill)) vars[`--ute-on-${k}`] = v;
  for (const [k, v] of Object.entries(vars)) preview.style.setProperty(k, v);
  preview.style.colorScheme = draft.mode;
  renderChecks();
  // The line-art filter comes from a search; do it once typing pauses.
  clearTimeout(canvasTimer);
  canvasTimer = setTimeout(() => {
    $('pv-canvas').style.filter = retintFilter('light', draft.background.page, draft.text.text);
  }, 150);
}

function drawSpreadsheet() {
  const canvas = $<HTMLCanvasElement>('pv-canvas');
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#4472c4';
  ctx.fillRect(0, 0, width, 20);
  ctx.font = '12px system-ui, sans-serif';
  const cols = ['Region', 'Units', 'Sales'];
  cols.forEach((c, i) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c, 8 + i * 120, 14);
  });
  const data = [['North', '1,618', '$32,370'], ['South', '1,321', '$26,420'], ['East', '2,178', '$32,670']];
  data.forEach((row, r) => {
    row.forEach((cell, i) => {
      ctx.fillStyle = i === 2 && r === 1 ? '#c00000' : '#000000';
      ctx.fillText(cell, 8 + i * 120, 38 + r * 22);
    });
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(0, 44 + r * 22, width, 1);
  });
  for (let i = 1; i < 3; i++) ctx.fillRect(i * 120, 20, 1, height);
}

function renderChecks() {
  const t = draft;
  const checks: Array<[string, string, string, number]> = [
    ['Text on page', t.text.text, t.background.page, 4.5],
    ['Strong text on page', t.text.strong, t.background.page, 4.5],
    ['Muted text on page', t.text.muted, t.background.page, 3],
    ['Link on page', t.text.link, t.background.page, 4.5],
    ['Text on surface', t.text.text, t.background.surface, 4.5],
    ['Text on raised', t.text.text, t.background.raised, 4.5],
    ['Text on input', t.text.text, t.background.input, 4.5],
    ['Text on control', t.text.text, t.background.control, 4.5],
    ['Text on selected', t.text.text, t.background.selected, 4.5],
    ...(['accent', 'danger', 'success', 'warning', 'info'] as const).flatMap((k): Array<[string, string, string, number]> => [
      [`On ${k} fill`, t.textOnFill[k], t.background[k], 3],
      [`${k[0]!.toUpperCase()}${k.slice(1)} text on page`, t.text[k], t.background.page, 3],
      [`Text on ${k} soft`, t.text.text, t.background[`${k}-soft`], 4.5],
    ]),
    ['Selected text', t.interface.selectionText, t.interface.selection, 4.5],
  ];
  const list = $('checks');
  list.replaceChildren();
  for (const [label, fg, bg, target] of checks) {
    const a = parseColor(fg);
    const b = parseColor(bg);
    if (!a || !b) continue;
    const ratio = contrastRatio(a, b);
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.className = `ratio ${ratio >= target ? 'good' : ratio >= 3 ? 'low' : 'bad'}`;
    value.textContent = `${ratio.toFixed(1)}:1 ${ratio >= target ? '✓' : '⚠'}`;
    value.title = `Aim for at least ${target}:1`;
    item.append(name, value);
    list.append(item);
  }
}

// --- Loading, saving, import/export --------------------------------------------------------------

function clone(theme: ThemeDefinition): ThemeDefinition {
  const { $schema: _schema, ...rest } = structuredClone(theme);
  return rest;
}

function startFrom(base: ThemeDefinition, name: string) {
  draft = { ...clone(base), id: '', name };
  delete draft.family;
  editingId = undefined;
  computeAuto();
  renderGroups();
  fillAll();
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme'
  );
}

function newId(name: string): string {
  const stem = `custom-${slug(name)}`;
  let id = stem;
  for (let n = 2; custom[id] || isBuiltin(id); n++) id = `${stem}-${n}`;
  return id;
}

function message(text: string, kind: 'ok' | 'error' = 'ok', extra?: HTMLElement, details: string[] = []) {
  const box = document.createElement('div');
  box.className = 'notice';
  const span = document.createElement('span');
  span.className = kind === 'error' ? 'error' : '';
  span.textContent = text;
  box.append(span);
  if (details.length) {
    const list = document.createElement('ul');
    for (const d of details) {
      const li = document.createElement('li');
      li.textContent = d;
      list.append(li);
    }
    box.append(list);
  }
  if (extra) box.append(extra);
  $('messages').replaceChildren(box);
}

/** The theme as it would be saved (with its final id). */
function candidate(): ThemeDefinition {
  const name = draft.name.trim();
  const family = draft.family?.trim();
  const theme: ThemeDefinition = { ...draft, format: THEME_FORMAT, name, id: editingId ?? newId(name || 'theme') };
  if (family) theme.family = family;
  else delete theme.family;
  return theme;
}

async function save() {
  const theme = candidate();
  const errors = validateTheme(theme);
  if (errors.length) {
    message('The theme cannot be saved yet:', 'error', undefined, errors);
    return;
  }
  ($('save') as HTMLButtonElement).disabled = true;
  try {
    await saveCustomTheme({ definition: theme, compiled: compileTheme(theme), updated: Date.now() });
  } finally {
    ($('save') as HTMLButtonElement).disabled = false;
  }
  custom = await loadCustomThemes();
  editingId = theme.id;
  draft = clone(theme);
  dirty = false;
  history.replaceState(null, '', `?id=${encodeURIComponent(theme.id)}`);
  setTitle();
  const use = document.createElement('button');
  use.textContent = 'Use for all sites';
  use.onclick = async () => {
    await saveSettings({ defaultTheme: theme.id });
    message(`"${theme.name}" is now the default theme.`);
  };
  message(`Saved "${theme.name}". Pages using it have been recolored.`, 'ok', use);
}

function setTitle() {
  $('title').textContent = editingId ? `Edit “${draft.name}”` : 'New theme';
  ($('start-field') as HTMLElement).hidden = !!editingId;
  document.title = `${editingId ? draft.name : 'New theme'} — Universal Theme`;
}

function exportJson() {
  const theme = candidate();
  const json = JSON.stringify(theme, null, 2);
  ($('export-text') as HTMLTextAreaElement).value = json;
  $<HTMLDialogElement>('export-dialog').showModal();
  $('export-copy').onclick = async () => {
    await navigator.clipboard.writeText(json);
    $('export-copy').textContent = 'Copied';
  };
  $('export-download').onclick = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' }));
    link.download = `${theme.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
}

function openImport() {
  ($('import-errors') as HTMLUListElement).replaceChildren();
  $<HTMLDialogElement>('import-dialog').showModal();
}

function loadImport() {
  const text = ($('import-text') as HTMLTextAreaElement).value;
  const errorsList = $('import-errors');
  errorsList.replaceChildren();
  const show = (errors: string[]) => {
    for (const e of errors) {
      const li = document.createElement('li');
      li.textContent = e;
      errorsList.append(li);
    }
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    show([`Not valid JSON: ${(err as Error).message}`]);
    return;
  }
  const errors = validateTheme(parsed);
  if (errors.length) {
    show(errors);
    return;
  }
  const theme = parsed as ThemeDefinition;
  draft = { ...clone(theme), id: '' };
  editingId = undefined;
  computeAuto();
  renderGroups();
  fillAll();
  setTitle();
  dirty = true;
  $<HTMLDialogElement>('import-dialog').close();
  message(`Imported "${theme.name}". Save it to use it.`);
}

async function main() {
  custom = await loadCustomThemes();
  const settings = await loadSettings();
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  if (id && custom[id]) {
    draft = clone(custom[id].definition);
    editingId = id;
    computeAuto();
    renderGroups();
    fillAll();
  } else {
    const base = findTheme(params.get('from') ?? id ?? settings.defaultTheme, custom) ?? findTheme(DEFAULT_THEME_ID)!;
    startFrom(base, `${base.name} (my version)`);
  }
  setTitle();
  drawSpreadsheet();

  new ThemePicker($('start-picker'), {
    inputId: 'start-from',
    options: themeOptions(custom),
    value: params.get('from') ?? '',
    onChange: (value) => {
      const base = findTheme(value, custom);
      if (!base) return;
      if (dirty && !confirm('Replace your changes with the colors of this theme?')) return;
      startFrom(base, `${base.name} (my version)`);
      dirty = false;
    },
  });

  $('name').addEventListener('input', () => {
    draft.name = ($('name') as HTMLInputElement).value;
    dirty = true;
  });
  $('family').addEventListener('input', () => {
    draft.family = ($('family') as HTMLInputElement).value;
    dirty = true;
  });
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) {
    radio.addEventListener('change', () => {
      draft.mode = radio.value as ThemeDefinition['mode'];
      changed();
    });
  }
  $('save').onclick = save;
  $('export').onclick = exportJson;
  $('export-close').onclick = () => $<HTMLDialogElement>('export-dialog').close();
  $('import').onclick = openImport;
  $('import-cancel').onclick = () => $<HTMLDialogElement>('import-dialog').close();
  $('import-load').onclick = loadImport;
  $('import-file').addEventListener('change', async () => {
    const file = ($('import-file') as HTMLInputElement).files?.[0];
    if (file) ($('import-text') as HTMLTextAreaElement).value = await file.text();
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
  if (params.has('import')) openImport();
}

main();
