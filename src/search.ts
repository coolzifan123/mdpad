// Searching the document, for the find bar. Each editor mode has a
// `Searcher`: live preview highlights matches inside the ProseMirror
// document; source mode searches the textarea.

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export interface Searcher {
  /** Find every match of `query`; returns how many there are. */
  search(query: string, matchCase: boolean): number;
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
}

function matchesIn(text: string, query: string, matchCase: boolean, offset = 0): Match[] {
  const matches: Match[] = [];
  if (!query) return matches;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  for (const m of text.matchAll(pattern)) {
    matches.push({ from: offset + m.index, to: offset + m.index + m[0].length });
  }
  return matches;
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
function findInDoc(doc: ProseNode, query: string, matchCase: boolean): Match[] {
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    let start = -1;
    const flush = () => {
      matches.push(...matchesIn(text, query, matchCase, start));
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
  private matchCase = false;
  private searchedDoc: ProseNode | null = null;
  private current = -1;

  constructor(private readonly view: EditorView) {}

  get count(): number {
    return this.matches.length;
  }

  search(query: string, matchCase: boolean): number {
    this.query = query;
    this.matchCase = matchCase;
    this.searchedDoc = this.view.state.doc;
    this.matches = findInDoc(this.view.state.doc, query, matchCase);
    this.current = -1;
    this.paint();
    return this.matches.length;
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
    this.view.dispatch(this.view.state.tr.insertText(text, match.from, match.to));
    this.search(this.query, this.matchCase);
    const next = this.matches.findIndex((m) => m.from >= match.from + text.length);
    return next < 0 ? (this.matches.length ? 0 : -1) : next;
  }

  replaceAll(text: string): number {
    this.refreshIfEdited();
    const count = this.matches.length;
    if (!count) return 0;
    const tr = this.view.state.tr;
    for (const match of [...this.matches].reverse()) tr.insertText(text, match.from, match.to);
    this.view.dispatch(tr);
    this.search(this.query, this.matchCase);
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
      this.search(this.query, this.matchCase);
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
  private matchCase = false;

  constructor(private readonly textarea: HTMLTextAreaElement) {}

  get count(): number {
    return this.matches.length;
  }

  search(query: string, matchCase: boolean): number {
    this.query = query;
    this.matchCase = matchCase;
    this.matches = matchesIn(this.textarea.value, query, matchCase);
    return this.matches.length;
  }

  show(index: number): void {
    this.search(this.query, this.matchCase);
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
    this.search(this.query, this.matchCase);
    const match = this.matches[index];
    if (!match) return -1;
    this.insert(match.from, match.to, text);
    this.search(this.query, this.matchCase);
    const next = this.matches.findIndex((m) => m.from >= match.from + text.length);
    return next < 0 ? (this.matches.length ? 0 : -1) : next;
  }

  replaceAll(text: string): number {
    const count = this.search(this.query, this.matchCase);
    if (!count) return 0;
    let value = this.textarea.value;
    for (const match of [...this.matches].reverse()) value = value.slice(0, match.from) + text + value.slice(match.to);
    this.insert(0, this.textarea.value.length, value);
    this.search(this.query, this.matchCase);
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
