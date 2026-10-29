// Markdown symbols at the cursor: inside **bold** text the "**" appear
// around it in grey, in a heading its "##", inside a link "[...](url)" —
// like Typora. The symbols are only drawn on screen; the text and its
// formatting stay as they are (so a "**" can't be deleted by backspacing).

import type { Mark, ResolvedPos } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** The symbols before and after text with each kind of formatting. */
const SYMBOLS: Record<string, (mark: Mark) => [string, string]> = {
  strong: (mark) => {
    const c = String(mark.attrs.marker || '*');
    return [c + c, c + c];
  },
  emphasis: (mark) => {
    const c = String(mark.attrs.marker || '*');
    return [c, c];
  },
  inlineCode: () => ['`', '`'],
  strike_through: () => ['~~', '~~'],
  link: (mark) => ['[', `](${mark.attrs.href}${mark.attrs.title ? ` "${mark.attrs.title}"` : ''})`],
};

const key = new PluginKey<DecorationSet>('mdpad-markers');
/** True while an input method (e.g. Chinese) is composing text. */
let composing = false;

export const markersPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => symbolsAt(state),
        // Changing things next to the cursor while an input method is
        // composing breaks the composition, so wait until it's done.
        apply: (tr, set, _, state) => (composing ? set.map(tr.mapping, tr.doc) : symbolsAt(state)),
      },
      props: {
        decorations: (state) => key.getState(state),
        handleDOMEvents: {
          compositionstart: () => {
            composing = true;
            return false;
          },
          compositionend: (view) => {
            composing = false;
            // Redraw for the final text.
            setTimeout(() => view.dispatch(view.state.tr.setMeta(key, true)));
            return false;
          },
        },
      },
    }),
);

function symbolsAt(state: EditorState): DecorationSet {
  const $head = state.selection.$head;
  const block = $head.parent;
  if (!block.isTextblock || block.type.spec.code) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  if (block.type.name === 'heading') {
    decorations.push(symbol($head.start(), '#'.repeat(block.attrs.level as number) + ' ', -1));
  }
  for (const { mark, from, to } of formattingAround($head)) {
    const [open, close] = SYMBOLS[mark.type.name](mark);
    decorations.push(symbol(from, open, -1), symbol(to, close, 1));
  }
  return DecorationSet.create(state.doc, decorations);
}

function symbol(pos: number, text: string, side: -1 | 1): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement('span');
      span.className = 'md-symbol';
      span.textContent = text;
      span.contentEditable = 'false';
      return span;
    },
    { side, key: `${side}:${text}`, ignoreSelection: true },
  );
}

/** The formatted stretches of text the cursor is in or right next to. */
function formattingAround($pos: ResolvedPos): { mark: Mark; from: number; to: number }[] {
  const block = $pos.parent;
  const offset = $pos.parentOffset;
  const touching = [...($pos.nodeBefore?.marks ?? []), ...($pos.nodeAfter?.marks ?? [])].filter(
    (mark, i, all) => SYMBOLS[mark.type.name] && all.findIndex((m) => m.eq(mark)) === i,
  );
  const found: { mark: Mark; from: number; to: number }[] = [];
  for (const mark of touching) {
    // Find the run of text with this mark that contains the cursor.
    let from = -1;
    let at = 0;
    for (let i = 0; i < block.childCount; i++) {
      const child = block.child(i);
      const end = at + child.nodeSize;
      if (mark.isInSet(child.marks)) {
        if (from < 0) from = at;
        if (from <= offset && offset <= end && (i + 1 === block.childCount || !mark.isInSet(block.child(i + 1).marks))) {
          found.push({ mark, from: $pos.start() + from, to: $pos.start() + end });
          break;
        }
      } else {
        from = -1;
      }
      at = end;
    }
  }
  return found;
}
