// Brackets and quotes in pairs: typing "(" also adds ")", typing ")" in
// front of an added ")" steps over it, and Backspace between an empty pair
// removes both. Not in code. Turned off in Preferences.
//
// Optionally the same for the Markdown symbols *, _ and ` (like Typora's
// "auto pair Markdown syntax"): "*" gives "*|*", a second "*" gives "**|**",
// and typing the closing symbol finishes the formatting.
//
// Also optionally smart quotes: " and ' become “ ” and ‘ ’ (it’s).

import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"' };
const CLOSERS = new Set(Object.values(PAIRS));
const MARKDOWN = new Set(['*', '_', '`']);

export const autopairSettings = { enabled: true, markdown: false, smartQuotes: false };
const CURLY: Record<string, [string, string]> = { '"': ['“', '”'], "'": ['‘', '’'] };

export const autopairPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false;
          const { state } = view;
          const $from = state.doc.resolve(from);
          if ($from.parent.type.spec.code || state.doc.rangeHasMark(from, Math.max(to, from + 1), state.schema.marks.inlineCode)) {
            return false;
          }
          const next = state.doc.textBetween(to, Math.min(to + 1, $from.end()));
          const before = state.doc.textBetween(Math.max($from.start(), from - 2), from);

          if (autopairSettings.markdown && MARKDOWN.has(text)) return markdownPair(view, from, to, text, before, next);
          if (autopairSettings.smartQuotes && CURLY[text]) return smartQuote(view, from, to, text, before, next);
          if (!autopairSettings.enabled) return false;

          // Step over a closer that's already there.
          if (CLOSERS.has(text) && from === to && next === text) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
            return true;
          }
          const closer = PAIRS[text];
          if (!closer) return false;
          // A quote right after a letter is probably not opening one.
          if (text === '"' && /[\p{L}\p{N}]$/u.test(before)) return false;
          // Only pair before a space, punctuation or the end of the line.
          if (next && !/[\s)\]}.,;:!?]/.test(next)) return false;
          const selected = state.doc.textBetween(from, to);
          const tr = state.tr.insertText(text + selected + closer, from, to);
          tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + selected.length));
          view.dispatch(tr);
          return true;
        },
        handleKeyDown(view, event) {
          if (event.key !== 'Backspace' || event.ctrlKey || event.altKey) return false;
          const { state } = view;
          const { from, empty } = state.selection;
          if (!empty) return false;
          const $from = state.doc.resolve(from);
          if ($from.parent.type.spec.code) return false;
          const around = state.doc.textBetween(Math.max($from.start(), from - 1), Math.min($from.end(), from + 1));
          const pair =
            (autopairSettings.enabled && (PAIRS[around[0]] === around[1] || around === '“”')) ||
            (autopairSettings.markdown && MARKDOWN.has(around[0]) && around[0] === around[1]);
          if (around.length !== 2 || !pair) return false;
          view.dispatch(state.tr.delete(from - 1, from + 1));
          return true;
        },
      },
    }),
);

/** A curly quote for " or ' typed at [from, to): opening after a space or bracket, else closing (it’s). */
function smartQuote(view: EditorView, from: number, to: number, text: string, before: string, next: string): boolean {
  const { state } = view;
  const [open, close] = CURLY[text];
  // Step over a closing quote that's already there.
  if (from === to && next === close) {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
    return true;
  }
  const opening = !before || /[\s([{\-–—“‘]$/u.test(before);
  const selected = state.doc.textBetween(from, to);
  if (!opening && !selected) {
    view.dispatch(state.tr.insertText(close, from, to));
    return true;
  }
  // Double quotes in pairs (with "Type brackets and quotes in pairs"), or around the selection.
  const pair = !!selected || (text === '"' && autopairSettings.enabled && (!next || /[\s)\]}.,;:!?]/.test(next)));
  const tr = state.tr.insertText(open + selected + (pair ? close : ''), from, to);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + selected.length)));
  return true;
}

/** "*", "_" or "`" typed at [from, to). `before` is up to two characters before it, `next` the one after. */
function markdownPair(view: EditorView, from: number, to: number, text: string, before: string, next: string): boolean {
  const { state } = view;
  const { schema } = state;
  // With text selected: make it italic or code.
  if (from !== to) {
    const mark = text === '`' ? schema.marks.inlineCode : schema.marks.emphasis;
    if (!mark) return false;
    view.dispatch(state.tr.addMark(from, to, mark.create()));
    return true;
  }
  if (next === text) {
    // "*|*" and another "*": "**|**". (In "b*|*" the "*" before the cursor
    // closes, so this one is the closing one too.)
    const opener = before.endsWith(text) && (before.length < 2 || (before[0] !== text && /[\s\p{P}]/u.test(before[0])));
    if (opener) {
      const tr = state.tr.insertText(text + text, from);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)));
      return true;
    }
    // The closing symbol: take away the added one and let this one through,
    // so that "*text*" becomes italic as usual.
    view.dispatch(state.tr.delete(to, to + 1));
    return false;
  }
  // At the start of a line "*" and "`" begin lists, rules and code blocks;
  // inside a word "_" is just a character (snake_case).
  const $from = state.doc.resolve(from);
  const lineSoFar = $from.parent.textBetween(0, $from.parentOffset);
  if (!lineSoFar.trim()) return false;
  if (/[\p{L}\p{N}]$/u.test(before) || (next && !/[\s)\]}.,;:!?]/.test(next))) return false;
  const tr = state.tr.insertText(text + text, from);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)));
  return true;
}
