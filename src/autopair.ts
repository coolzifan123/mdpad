// Brackets and quotes in pairs: typing "(" also adds ")", typing ")" in
// front of an added ")" steps over it, and Backspace between an empty pair
// removes both. Not in code. Turned off in Preferences.

import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"' };
const CLOSERS = new Set(Object.values(PAIRS));

export const autopairSettings = { enabled: true };

export const autopairPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (!autopairSettings.enabled || view.composing) return false;
          const { state } = view;
          const $from = state.doc.resolve(from);
          if ($from.parent.type.spec.code || state.doc.rangeHasMark(from, Math.max(to, from + 1), state.schema.marks.inlineCode)) {
            return false;
          }
          const next = state.doc.textBetween(to, Math.min(to + 1, $from.end()));
          // Step over a closer that's already there.
          if (CLOSERS.has(text) && from === to && next === text) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
            return true;
          }
          const closer = PAIRS[text];
          if (!closer) return false;
          // A quote right after a letter is probably not opening one.
          const before = state.doc.textBetween(Math.max($from.start(), from - 1), from);
          if (text === '"' && /[\p{L}\p{N}]/u.test(before)) return false;
          // Only pair before a space, punctuation or the end of the line.
          if (next && !/[\s)\]}.,;:!?]/.test(next)) return false;
          const selected = state.doc.textBetween(from, to);
          const tr = state.tr.insertText(text + selected + closer, from, to);
          tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + selected.length));
          view.dispatch(tr);
          return true;
        },
        handleKeyDown(view, event) {
          if (!autopairSettings.enabled || event.key !== 'Backspace' || event.ctrlKey || event.altKey) return false;
          const { state } = view;
          const { from, empty } = state.selection;
          if (!empty) return false;
          const $from = state.doc.resolve(from);
          if ($from.parent.type.spec.code) return false;
          const around = state.doc.textBetween(Math.max($from.start(), from - 1), Math.min($from.end(), from + 1));
          if (around.length !== 2 || PAIRS[around[0]] !== around[1]) return false;
          view.dispatch(state.tr.delete(from - 1, from + 1));
          return true;
        },
      },
    }),
);
