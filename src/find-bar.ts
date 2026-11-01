// The find / replace bar (Ctrl+F, Ctrl+H). The searching itself is done by
// the active editor's `Searcher` (see search.ts).

import type { SearchOptions, Searcher } from './search';

export interface FindBarElements {
  bar: HTMLElement;
  input: HTMLInputElement;
  count: HTMLElement;
  matchCase: HTMLButtonElement;
  wholeWord: HTMLButtonElement;
  regex: HTMLButtonElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
  replaceRow: HTMLElement;
  replaceInput: HTMLInputElement;
  replaceOne: HTMLButtonElement;
  replaceAll: HTMLButtonElement;
}

export class FindBar {
  private options: SearchOptions = { matchCase: false, wholeWord: false, regex: false };
  private current = -1;

  constructor(
    private readonly ui: FindBarElements,
    private readonly searcher: () => Searcher | null,
    /** Called after the bar closes, to give the focus back to the editor. */
    private readonly onClose: () => void,
  ) {
    ui.input.addEventListener('input', () => this.refresh());
    ui.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      }
    });
    ui.replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.replace();
      }
    });
    // The options' buttons, and Alt+C / Alt+W / Alt+R while the bar has the focus.
    const toggles: [keyof SearchOptions, HTMLButtonElement, string][] = [
      ['matchCase', ui.matchCase, 'KeyC'],
      ['wholeWord', ui.wholeWord, 'KeyW'],
      ['regex', ui.regex, 'KeyR'],
    ];
    const toggle = (option: keyof SearchOptions, button: HTMLButtonElement) => {
      this.options = { ...this.options, [option]: !this.options[option] };
      button.setAttribute('aria-pressed', String(this.options[option]));
      this.refresh();
    };
    for (const [option, button] of toggles) button.addEventListener('click', () => toggle(option, button));
    ui.bar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
      const shortcut = event.altKey && !event.ctrlKey && !event.metaKey && toggles.find(([, , code]) => code === event.code);
      if (shortcut) {
        event.preventDefault();
        toggle(shortcut[0], shortcut[1]);
      }
    });
    ui.previous.addEventListener('click', () => this.step(-1));
    ui.next.addEventListener('click', () => this.step(1));
    ui.close.addEventListener('click', () => this.close());
    ui.replaceOne.addEventListener('click', () => this.replace());
    ui.replaceAll.addEventListener('click', () => this.replaceAll());
  }

  get isOpen(): boolean {
    return !this.ui.bar.hidden;
  }

  /** Open the bar, searching for the selected text if there is some. */
  open(withReplace: boolean): void {
    const selected = getSelection()?.toString() ?? '';
    if (selected && !selected.includes('\n') && selected.length < 200) this.ui.input.value = selected;
    this.ui.bar.hidden = false;
    this.ui.replaceRow.hidden = !withReplace;
    const field = withReplace && this.ui.input.value ? this.ui.replaceInput : this.ui.input;
    field.focus();
    field.select();
    this.refresh();
  }

  close(): void {
    if (!this.isOpen) return;
    this.ui.bar.hidden = true;
    this.searcher()?.clear();
    this.onClose();
  }

  /** Go to the next (1) or previous (-1) match. */
  step(direction: 1 | -1): void {
    if (!this.isOpen) {
      this.open(false);
      return;
    }
    const searcher = this.searcher();
    if (!searcher || !searcher.count) return;
    this.current = (this.current + direction + searcher.count) % searcher.count;
    searcher.show(this.current);
    this.showCount();
  }

  /** Search again, e.g. after the editor was switched or the text changed. */
  refresh(): void {
    const searcher = this.searcher();
    if (!searcher || !this.isOpen) return;
    const count = searcher.search(this.ui.input.value, this.options);
    this.current = count > 0 ? searcher.firstAfterCursor() : -1;
    if (this.current >= 0) searcher.show(this.current);
    this.showCount(count < 0 ? 'Invalid pattern' : undefined, count < 0);
  }

  private replace(): void {
    const searcher = this.searcher();
    if (!searcher || this.current < 0) return;
    this.current = searcher.replace(this.current, this.ui.replaceInput.value);
    if (this.current >= 0) searcher.show(this.current);
    this.showCount();
  }

  private replaceAll(): void {
    const searcher = this.searcher();
    if (!searcher) return;
    const replaced = searcher.replaceAll(this.ui.replaceInput.value);
    this.current = -1;
    this.showCount(replaced ? `Replaced ${replaced}` : undefined);
  }

  private showCount(message?: string, problem = false): void {
    const searcher = this.searcher();
    const count = searcher?.count ?? 0;
    const { count: label, input } = this.ui;
    if (message) label.textContent = message;
    else if (!input.value) label.textContent = '';
    else if (!count) label.textContent = 'No results';
    else label.textContent = `${this.current + 1} of ${count}`;
    label.classList.toggle('none', problem || (Boolean(input.value) && !count && !message));
  }
}
