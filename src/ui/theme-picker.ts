// A type-ahead theme picker (ARIA combobox). Type any part of a theme's name, family, or mode —
// words in any order ("light hard", "gruv soft") — and pick with the mouse or Up/Down + Enter.

export interface PickerOption {
  value: string;
  label: string;
  /** Heading the option is listed under ("Gruvbox", "My themes"); omitted for "Off" and the like. */
  group?: string;
  swatches?: string[];
  /** Extra words that should find this option (mode, id). */
  keywords?: string;
}

interface Config {
  options: PickerOption[];
  value: string;
  /** Accessible name, shown by the page's own <label for>. */
  inputId: string;
  onChange: (value: string) => void;
}

let pickerCount = 0;

export class ThemePicker {
  private options: PickerOption[];
  private value: string;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private readonly swatches: HTMLSpanElement;
  private readonly onChange: (value: string) => void;
  private matches: PickerOption[] = [];
  private active = -1;
  private readonly listId = `picker-list-${++pickerCount}`;

  constructor(host: HTMLElement, config: Config) {
    this.options = config.options;
    this.value = config.value;
    this.onChange = config.onChange;

    host.classList.add('picker');
    host.replaceChildren();
    const field = document.createElement('div');
    field.className = 'picker-field';
    this.swatches = document.createElement('span');
    this.swatches.className = 'swatches picker-current';
    this.input = document.createElement('input');
    Object.assign(this.input, { id: config.inputId, type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'Type to search themes…' });
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-controls', this.listId);
    const chevron = document.createElement('span');
    chevron.className = 'picker-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    field.append(this.input, chevron);
    this.list = document.createElement('ul');
    this.list.id = this.listId;
    this.list.className = 'picker-list';
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    host.append(field, this.swatches, this.list);

    this.input.addEventListener('focus', () => this.open());
    this.input.addEventListener('click', () => this.open());
    this.input.addEventListener('input', () => this.filter(this.input.value));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => this.close());
    // Keep focus in the input while clicking an option.
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.showValue();
  }

  set disabled(disabled: boolean) {
    this.input.disabled = disabled;
  }

  setOptions(options: PickerOption[], value = this.value) {
    this.options = options;
    this.value = value;
    if (this.list.hidden) this.showValue();
    else this.filter(this.input.value);
  }

  private selected(): PickerOption | undefined {
    return this.options.find((o) => o.value === this.value);
  }

  private showValue() {
    const current = this.selected();
    this.input.value = current?.label ?? '';
    renderSwatches(this.swatches, current?.swatches ?? []);
  }

  private open() {
    if (!this.list.hidden || this.input.disabled) return;
    this.input.select();
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.filter('');
  }

  private close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.showValue();
  }

  private choose(option: PickerOption) {
    const changed = option.value !== this.value;
    this.value = option.value;
    this.close();
    this.input.blur();
    if (changed) this.onChange(option.value);
  }

  private filter(query: string) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    this.matches = this.options.filter((o) => {
      const haystack = `${o.label} ${o.group ?? ''} ${o.keywords ?? ''}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
    const current = this.matches.findIndex((o) => o.value === this.value);
    this.active = words.length ? (this.matches.length ? 0 : -1) : current;
    this.render(words);
  }

  private render(words: string[]) {
    this.list.replaceChildren();
    if (!this.matches.length) {
      const empty = document.createElement('li');
      empty.className = 'picker-empty';
      empty.textContent = 'No themes match';
      this.list.append(empty);
      return;
    }
    let group: string | undefined;
    this.matches.forEach((option, i) => {
      if (option.group && option.group !== group) {
        const heading = document.createElement('li');
        heading.className = 'picker-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = option.group;
        this.list.append(heading);
      }
      group = option.group;
      const item = document.createElement('li');
      item.id = `${this.listId}-${i}`;
      item.className = 'picker-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === this.value));
      const label = document.createElement('span');
      label.className = 'picker-label';
      highlight(label, option.label, words);
      const swatches = document.createElement('span');
      swatches.className = 'swatches';
      renderSwatches(swatches, option.swatches ?? []);
      item.append(label, swatches);
      item.addEventListener('click', () => this.choose(option));
      item.addEventListener('mousemove', () => this.setActive(i));
      this.list.append(item);
    });
    this.setActive(this.active);
  }

  private setActive(index: number) {
    this.active = index;
    for (const item of this.list.querySelectorAll('.picker-option')) item.classList.toggle('active', item.id === `${this.listId}-${index}`);
    if (index < 0) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.input.setAttribute('aria-activedescendant', `${this.listId}-${index}`);
    document.getElementById(`${this.listId}-${index}`)?.scrollIntoView({ block: 'nearest' });
  }

  private onKey(e: KeyboardEvent) {
    if (this.list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      this.open();
      e.preventDefault();
      return;
    }
    const n = this.matches.length;
    if (e.key === 'ArrowDown' && n) this.setActive((this.active + 1) % n);
    else if (e.key === 'ArrowUp' && n) this.setActive((this.active - 1 + n) % n);
    else if (e.key === 'Home' && n) this.setActive(0);
    else if (e.key === 'End' && n) this.setActive(n - 1);
    else if (e.key === 'Enter') {
      const option = this.matches[this.active];
      if (option) this.choose(option);
    } else if (e.key === 'Escape') {
      this.close();
    } else return;
    e.preventDefault();
  }
}

/** Writes `text` into `el`, wrapping the first occurrence of each query word in <mark>. */
function highlight(el: HTMLElement, text: string, words: string[]) {
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    const at = lower.indexOf(w);
    if (at >= 0) marked.fill(true, at, at + w.length);
  }
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marked[j] === marked[i]) j++;
    const piece = text.slice(i, j);
    if (marked[i]) {
      const mark = document.createElement('mark');
      mark.textContent = piece;
      el.append(mark);
    } else {
      el.append(piece);
    }
    i = j;
  }
}

export function renderSwatches(container: HTMLElement, colors: string[]) {
  container.replaceChildren();
  for (const color of colors) {
    const chip = document.createElement('span');
    chip.style.background = color;
    container.append(chip);
  }
}
