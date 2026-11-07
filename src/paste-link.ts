// Pasting a web address over selected text makes that text a link to it, like
// Typora. (An address pasted on its own becomes a link anyway.)

import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const ADDRESS = /^(?:https?:\/\/|mailto:|www\.)[^\s<>]+$/i;

export const pasteLink = $prose(
  () =>
    new Plugin({
      props: {
        // The paste event itself: Milkdown's own paste handling comes first otherwise.
        handleDOMEvents: {
          paste(view, event) {
            const text = event.clipboardData?.getData('text/plain').trim() ?? '';
            const { state } = view;
            const { from, to, empty, $from, $to } = state.selection;
            const link = state.schema.marks.link;
            if (empty || !link || !ADDRESS.test(text)) return false;
            if (!$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
            // Not in code, nor in Markdown written out at the cursor (inline-source.ts).
            const marks = ['inlineCode', 'mdSource', 'mdPrefix'].map((name) => state.schema.marks[name]).filter(Boolean);
            if (marks.some((mark) => state.doc.rangeHasMark(from, to, mark))) return false;
            event.preventDefault();
            const href = /^www\./i.test(text) ? `https://${text}` : text;
            view.dispatch(state.tr.removeMark(from, to, link).addMark(from, to, link.create({ href })));
            return true;
          },
        },
      },
    }),
);
