// Searching the document, for the find bar. Each editor mode has a
// `Searcher`: live preview highlights matches inside the ProseMirror
// document; source mode searches the textarea.

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export interface SearchOptions {
  matchCase: boolean;
  /** Only matches that are whole words. */
  wholeWord: boolean;
  /** `query` is a regular expression; replacements can use $1, $&, $<name>. */
  regex: boolean;
}

export interface Searcher {
  /** Find every match of `query`. Returns how many there are, or -1 if it isn't a valid regular expression. */
  search(query: string, options: SearchOptions): number;
  /** Make match `index` the current one: select it and scroll to it. */
  show(index: number): void;
  /** The first match at or after the cursor, or -1. */
  firstAfterCursor(): number;
  /** Replace match `index`. Returns the match to show next, or -1. */
  replace(index: number, text: string): number;
  /** Replace every match; returns how many were replaced. */
  replaceAll(text: string): number;
  /** Remove the highlights. */
  clear(): void;
  /** Number of matches found by the last search. */
  readonly count: number;
}

interface Match {
  from: number;
  to: number;
  /** The regular expression match, for $1… in a replacement. */
  groups: RegExpMatchArray;
}

const NO_OPTIONS: SearchOptions = { matchCase: false, wholeWord: false, regex: false };

/** The pattern for a search, or null if `query` isn't a valid regular expression. */
function patternFor(query: string, { matchCase, wholeWord, regex }: SearchOptions): RegExp | null {
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = matchCase ? 'g' : 'gi';
  try {
    // Unicode mode knows the letters of every language (for whole words);
    // some patterns are only valid without it.
    return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source, flags + 'u');
  } catch {
    try {
      return new RegExp(wholeWord ? `\\b(?:${source})\\b` : source, flags);
    } catch {
      return null;
    }
  }
}

function matchesIn(text: string, pattern: RegExp, offset = 0): Match[] {
  const matches: Match[] = [];
  for (const m of text.matchAll(pattern)) {
    // Empty matches (of "^" or "a*") can't be shown or replaced.
    if (m[0].length) matches.push({ from: offset + m.index, to: offset + m.index + m[0].length, groups: m });
  }
  return matches;
}

/** `text` with $1, $&, $<name> and $$ filled in from a regular expression match. */
function expand(text: string, match: Match, options: SearchOptions): string {
  if (!options.regex) return text;
  const m = match.groups;
  return text.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/g, (all, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return m[0];
    if (token.startsWith('<')) return m.groups?.[token.slice(1, -1)] ?? '';
    const n = Number(token);
    return n > 0 && n < m.length ? (m[n] ?? '') : all;
  });
}

// ---------------------------------------------------------------------------
// Live preview

const highlights = new PluginKey<DecorationSet>('mdpad-search');

/** Draws the highlights. Add it to the editor with `.use()`. */
export const searchHighlightPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: highlights,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => tr.getMeta(highlights) ?? set.map(tr.mapping, tr.doc),
      },
      props: { decorations: (state) => highlights.getState(state) },
    }),
);

/** Matches inside text blocks. A match can't cross an image or a line break. */
function findInDoc(doc: ProseNode, pattern: RegExp): Match[] {
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    let start = -1;
    const flush = () => {
      matches.push(...matchesIn(text, pattern, start));
      text = '';
      start = -1;
    };
    node.forEach((child, offset) => {
      if (child.isText) {
        if (start < 0) start = pos + 1 + offset;
        text += child.text;
      } else {
        flush();
      }
    });
    flush();
    return false;
  });
  return matches;
}

export class ProseSearcher implements Searcher {
  private matches: Match[] = [];
  private query = '';
  private options = NO_OPTIONS;
  private searchedDoc: ProseNode | null = null;
  private current = -1;

  constructor(private readonly view: EditorView) {}

  get count(): number {
    return this.matches.length;
  }

  search(query: string, options: SearchOptions): number {
    this.query = query;
    this.options = options;
    this.searchedDoc = this.view.state.doc;
    const pattern = query ? patternFor(query, options) : null;
    this.matches = pattern ? findInDoc(this.view.state.doc, pattern) : [];
    this.current = -1;
    this.paint();
    return query && !pattern ? -1 : this.matches.length;
  }

  show(index: number): void {
    this.refreshIfEdited();
    const match = this.matches[index];
    if (!match) return;
    this.current = index;
    const { state } = this.view;
    const tr = state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView();
    this.view.dispatch(tr.setMeta(highlights, this.decorations()));
  }

  firstAfterCursor(): number {
    if (!this.matches.length) return -1;
    const cursor = this.view.state.selection.from;
    const index = this.matches.findIndex((m) => m.from >= cursor);
    return index < 0 ? 0 : index;
  }

  replace(index: number, text: string): number {
    this.refreshIfEdited();
    const match = this.matches[index];
    if (!match) return -1;
    const replacement = expand(text, match, this.options);
    this.view.dispatch(this.view.state.tr.insertText(replacement, match.from, match.to));
    this.search(this.query, this.options);
    const next = this.matches.findIndex((m) => m.from >= match.from + replacement.length);
    return next < 0 ? (this.matches.length ? 0 : -1) : next;
  }

  replaceAll(text: string): number {
    this.refreshIfEdited();
    const count = this.matches.length;
    if (!count) return 0;
    const tr = this.view.state.tr;
    for (const match of [...this.matches].reverse()) tr.insertText(expand(text, match, this.options), match.from, match.to);
    this.view.dispatch(tr);
    this.search(this.query, this.options);
    return count;
  }

  clear(): void {
    this.matches = [];
    this.current = -1;
    this.searchedDoc = null;
    this.paint();
  }

  private refreshIfEdited(): void {
    if (this.searchedDoc && this.searchedDoc !== this.view.state.doc) {
      const current = this.current;
      this.search(this.query, this.options);
      this.current = Math.min(current, this.matches.length - 1);
    }
  }

  private decorations(): DecorationSet {
    const decorations = this.matches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === this.current ? 'search-match current' : 'search-match' }),
    );
    return DecorationSet.create(this.view.state.doc, decorations);
  }

  private paint(): void {
    this.view.dispatch(this.view.state.tr.setMeta(highlights, this.decorations()));
  }
}

// ---------------------------------------------------------------------------
// Source mode

export class TextareaSearcher implements Searcher {
  private matches: Match[] = [];
  private query = '';
  private options = NO_OPTIONS;

  constructor(private readonly textarea: HTMLTextAreaElement) {}

  get count(): number {
    return this.matches.length;
  }

  search(query: string, options: SearchOptions): number {
    this.query = query;
    this.options = options;
    const pattern = query ? patternFor(query, options) : null;
    this.matches = pattern ? matchesIn(this.textarea.value, pattern) : [];
    return query && !pattern ? -1 : this.matches.length;
  }

  show(index: number): void {
    this.search(this.query, this.options);
    const match = this.matches[index];
    if (!match) return;
    // Focusing makes the textarea scroll to the selection; then give the
    // focus back to the find bar.
    const active = document.activeElement as HTMLElement | null;
    this.textarea.focus();
    this.textarea.setSelectionRange(match.from, match.to);
    active?.focus();
  }

  firstAfterCursor(): number {
    if (!this.matches.length) return -1;
    const index = this.matches.findIndex((m) => m.from >= this.textarea.selectionStart);
    return index < 0 ? 0 : index;
  }

  replace(index: number, text: string): number {
    this.search(this.query, this.options);
    const match = this.matches[index];
    if (!match) return -1;
    const replacement = expand(text, match, this.options);
    this.insert(match.from, match.to, replacement);
    this.search(this.query, this.options);
    const next = this.matches.findIndex((m) => m.from >= match.from + replacement.length);
    return next < 0 ? (this.matches.length ? 0 : -1) : next;
  }

  replaceAll(text: string): number {
    const count = this.search(this.query, this.options);
    if (count <= 0) return 0;
    let value = this.textarea.value;
    for (const match of [...this.matches].reverse()) value = value.slice(0, match.from) + expand(text, match, this.options) + value.slice(match.to);
    this.insert(0, this.textarea.value.length, value);
    this.search(this.query, this.options);
    return count;
  }

  clear(): void {
    this.matches = [];
  }

  /** Like typing it: keeps undo working and tells the app about the change. */
  private insert(from: number, to: number, text: string): void {
    const active = document.activeElement as HTMLElement | null;
    this.textarea.focus();
    this.textarea.setSelectionRange(from, to);
    document.execCommand('insertText', false, text);
    active?.focus();
  }
}
