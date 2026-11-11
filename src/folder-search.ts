// Search in a folder (Ctrl+Shift+F): the Search panel of the sidebar looks
// through every Markdown file in the folder shown under Files and lists the
// lines that match. Clicking a line opens the file at that match.

import * as platform from './platform';
import { count, t } from './i18n';
import { patternFor, type SearchOptions } from './search';

/** Lines listed at most, so a common word doesn't flood the panel. */
const MAX_LINES = 500;
/** Files read at the same time. */
const PARALLEL = 8;

export interface FolderSearchHooks {
  /** The folder to search (the one shown under Files), or null. */
  folder(): string | null;
  /** Open `path` and show match number `index` of the search. */
  open(path: string, query: string, options: SearchOptions, index: number): void;
}

interface LineMatch {
  line: number;
  text: string;
  /** [start, end) of each match in `text`. */
  ranges: [number, number][];
  /** The number of the first match on this line, counting from the top of the file. */
  index: number;
}

export class FolderSearch {
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly results: HTMLElement;
  private options: SearchOptions = { matchCase: false, wholeWord: false, regex: false };
  /** Each search gets a number; an older one still reading files stops. */
  private generation = 0;
  private timer: number | undefined;

  constructor(
    panel: HTMLElement,
    private readonly hooks: FolderSearchHooks,
  ) {
    const bar = document.createElement('div');
    bar.className = 'folder-search-bar';
    this.input = Object.assign(document.createElement('input'), {
      type: 'text',
      placeholder: t('Search in folder'),
      spellcheck: false,
    });
    this.input.setAttribute('aria-label', t('Search in folder'));
    bar.append(this.input);
    const toggles: [keyof SearchOptions, string, string][] = [
      ['matchCase', 'Aa', t('Match case')],
      ['wholeWord', 'ab', t('Whole word')],
      ['regex', '.*', t('Regular expression')],
    ];
    for (const [option, label, title] of toggles) {
      const button = Object.assign(document.createElement('button'), { textContent: label, title });
      button.className = option === 'wholeWord' ? 'find-word' : '';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        this.options = { ...this.options, [option]: !this.options[option] };
        button.setAttribute('aria-pressed', String(this.options[option]));
        void this.search();
      });
      bar.append(button);
    }
    this.status = Object.assign(document.createElement('div'), { className: 'folder-search-status' });
    this.results = Object.assign(document.createElement('div'), { className: 'folder-search-results' });
    panel.append(bar, this.status, this.results);

    this.input.addEventListener('input', () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.search(), 300);
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        window.clearTimeout(this.timer);
        void this.search();
      }
    });
  }

  /** Put the cursor in the search box (with the selected text, if any). */
  focus(): void {
    const selected = getSelection()?.toString() ?? '';
    if (selected && !selected.includes('\n') && selected.length < 200 && selected !== this.input.value) {
      this.input.value = selected;
      void this.search();
    }
    this.input.focus();
    this.input.select();
  }

  async search(): Promise<void> {
    const generation = ++this.generation;
    const query = this.input.value;
    this.results.replaceChildren();
    const folder = this.hooks.folder();
    if (!query) return this.say('');
    if (!folder) return this.say(t('Open a folder (File → Open Folder…) to search its files.'));
    const pattern = patternFor(query, this.options);
    if (!pattern) return this.say(t('Invalid pattern'), true);
    this.say(t('Searching…'));

    const files = await platform.findMarkdownFiles(folder);
    let matches = 0;
    let matchedFiles = 0;
    let lines = 0;
    const options = { ...this.options };
    // Read a few files at a time, and list them in folder order.
    for (let i = 0; i < files.length; i += PARALLEL) {
      const batch = await Promise.all(files.slice(i, i + PARALLEL).map((path) => this.matchesIn(path, pattern)));
      if (generation !== this.generation) return;
      for (const [j, found] of batch.entries()) {
        if (!found.length) continue;
        matchedFiles++;
        matches += found.reduce((sum, line) => sum + line.ranges.length, 0);
        const shown = found.slice(0, Math.max(0, MAX_LINES - lines));
        lines += shown.length;
        this.results.append(this.fileResults(files[i + j], folder, found, shown, query, options));
      }
      this.say(t('Searching… {matches} so far', { matches: count(matches, '1 match', '{n} matches') }));
    }
    if (generation !== this.generation) return;
    this.say(
      matches
        ? t('{matches} in {files}', { matches: count(matches, '1 match', '{n} matches'), files: count(matchedFiles, '1 file', '{n} files') })
        : t('No results in {files}', { files: count(files.length, '1 file', '{n} files') }),
    );
  }

  private async matchesIn(path: string, pattern: RegExp): Promise<LineMatch[]> {
    let content: string;
    try {
      content = (await platform.readFile(path)).content;
    } catch {
      return [];
    }
    const found: LineMatch[] = [];
    let index = 0;
    content.split(/\r?\n/).forEach((text, line) => {
      const ranges: [number, number][] = [];
      for (const m of text.matchAll(pattern)) if (m[0].length) ranges.push([m.index, m.index + m[0].length]);
      if (ranges.length) found.push({ line: line + 1, text, ranges, index });
      index += ranges.length;
    });
    return found;
  }

  private fileResults(path: string, folder: string, found: LineMatch[], shown: LineMatch[], query: string, options: SearchOptions): HTMLElement {
    const box = document.createElement('div');
    box.className = 'folder-search-file';
    const relative = path.startsWith(folder) ? path.slice(folder.length).replace(/^[\\/]/, '') : path;
    const head = document.createElement('div');
    head.className = 'folder-search-name';
    head.title = path;
    head.append(
      Object.assign(document.createElement('span'), { textContent: platform.baseName(path) }),
      Object.assign(document.createElement('span'), { className: 'folder-search-where', textContent: relative.slice(0, -platform.baseName(path).length).replace(/[\\/]$/, '') }),
      Object.assign(document.createElement('span'), { className: 'folder-search-count', textContent: String(found.reduce((sum, line) => sum + line.ranges.length, 0)) }),
    );
    head.addEventListener('click', () => this.hooks.open(path, query, options, 0));
    box.append(head);
    for (const match of shown) {
      const row = document.createElement('div');
      row.className = 'folder-search-line';
      row.title = t('Line {n}', { n: match.line });
      row.append(snippet(match));
      row.addEventListener('click', () => this.hooks.open(path, query, options, match.index));
      box.append(row);
    }
    if (shown.length < found.length) {
      box.append(Object.assign(document.createElement('div'), { className: 'folder-search-more', textContent: count(found.length - shown.length, '1 more line', '{n} more lines') }));
    }
    return box;
  }

  private say(text: string, problem = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('none', problem);
  }
}

/** The line, around its first match, with the matches marked. */
function snippet({ text, ranges }: LineMatch): DocumentFragment {
  const fragment = document.createDocumentFragment();
  // Start a little before the first match on long lines.
  const from = ranges[0][0] > 40 ? ranges[0][0] - 30 : 0;
  let at = from;
  if (from > 0) fragment.append('…');
  for (const [start, end] of ranges) {
    if (end <= at) continue;
    fragment.append(text.slice(at, Math.max(at, start)));
    fragment.append(Object.assign(document.createElement('mark'), { textContent: text.slice(Math.max(at, start), end) }));
    at = end;
  }
  fragment.append(text.slice(at, at + 200));
  return fragment;
}
