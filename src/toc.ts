// [TOC]: a paragraph containing only "[TOC]" shows a table of contents of
// the document's headings, like Typora. The file keeps the text "[TOC]".

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

interface TocHeading {
  level: number;
  text: string;
  pos: number;
}

export const tocPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const markers: { from: number; to: number }[] = [];
          state.doc.forEach((node, offset) => {
            if (node.type.name === 'paragraph' && node.textContent.trim() === '[TOC]') {
              markers.push({ from: offset, to: offset + node.nodeSize });
            }
          });
          if (!markers.length) return null;
          const headings = collectHeadings(state.doc);
          const key = JSON.stringify(headings.map(({ level, text }) => [level, text]));
          return DecorationSet.create(
            state.doc,
            markers.flatMap(({ from, to }) => [
              Decoration.node(from, to, { class: 'toc-marker' }),
              Decoration.widget(to, (view) => renderToc(view, headings), { side: -1, key: `toc-${from}-${key}` }),
            ]),
          );
        },
      },
    }),
);

function collectHeadings(doc: ProseNode): TocHeading[] {
  const headings: TocHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') headings.push({ level: node.attrs.level as number, text: node.textContent, pos });
    return node.isBlock;
  });
  return headings;
}

function renderToc(view: EditorView, headings: TocHeading[]): HTMLElement {
  const box = document.createElement('nav');
  box.className = 'toc';
  box.contentEditable = 'false';
  if (!headings.length) {
    box.textContent = 'No headings yet';
    return box;
  }
  const top = Math.min(...headings.map((h) => h.level));
  for (const heading of headings) {
    const item = document.createElement('a');
    item.className = 'toc-item';
    item.style.paddingLeft = `${(heading.level - top) * 16}px`;
    item.textContent = heading.text || '(empty heading)';
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      // Positions may have moved since the list was drawn; find it again.
      const target = collectHeadings(view.state.doc).find((h) => h.text === heading.text && h.level === heading.level);
      if (!target) return;
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(target.pos + 1))));
      (view.nodeDOM(target.pos) as HTMLElement | null)?.scrollIntoView({ block: 'start' });
      view.focus();
    });
    box.append(item);
  }
  return box;
}
