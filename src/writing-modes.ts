// Focus mode (F8) dims everything except the block you are writing in;
// typewriter mode (F9) keeps the line you are typing in the middle of the
// window. The dimming itself is CSS (body.focus-mode in app.css).

import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const writingModes = {
  typewriter: false,
  /** The element that scrolls the editor. */
  scroller: null as HTMLElement | null,
};

/** Marks the top-level block with the cursor, and runs typewriter scrolling. */
export const currentBlockPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const { $head } = state.selection;
          if ($head.depth < 1) return null;
          const start = $head.before(1);
          const block = state.doc.child($head.index(0));
          return DecorationSet.create(state.doc, [Decoration.node(start, start + block.nodeSize, { class: 'current-block' })]);
        },
      },
      view: () => ({
        update(view, previous) {
          if (!writingModes.typewriter || previous.selection.eq(view.state.selection)) return;
          centerCursor(view);
        },
      }),
    }),
);

export function centerCursor(view: EditorView): void {
  const scroller = writingModes.scroller;
  if (!scroller) return;
  const caret = view.coordsAtPos(view.state.selection.head);
  const box = scroller.getBoundingClientRect();
  scroller.scrollTop += caret.top - (box.top + box.height / 2);
}
