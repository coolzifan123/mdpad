// Typing a table's header line, "| Name | Price |", and pressing Enter turns
// it into a table with those headers and an empty row, like Typora.

import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/** "| a | b |": at least one cell between pipes. */
const HEADER_LINE = /^\s*\|(.*\|)+\s*$/;

export const tableInput = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
          const { state } = view;
          const { $head, empty } = state.selection;
          const block = $head.parent;
          if (!empty || block.type.name !== 'paragraph' || $head.parentOffset !== block.content.size) return false;
          if (!HEADER_LINE.test(block.textContent)) return false;
          const table = state.schema.nodes.table;
          const $block = state.doc.resolve($head.before());
          if (!table || !$block.parent.canReplaceWith($block.index(), $block.index() + 1, table)) return false;

          // Each cell's text between the pipes, as Markdown (the whole line
          // would come out as "\| Name | …": a line can't start with a pipe).
          const text = block.textBetween(0, block.content.size, undefined, '￼');
          const pipes = [...text.matchAll(/(?<!\\)\|/g)].map((m) => m.index);
          const cells = pipes.slice(1).map((end, i) => {
            const paragraph = state.schema.nodes.paragraph.create(null, block.content.cut(pipes[i] + 1, end));
            return ctx.get(serializerCtx)(state.schema.topNodeType.create(null, paragraph)).trim();
          });
          // Read it as Markdown with a separator line and an empty row under it.
          const markdown = `| ${cells.join(' | ')} |\n${'| --- '.repeat(cells.length)}|\n${'|  '.repeat(cells.length)}|\n`;
          const parsed = ctx.get(parserCtx)(markdown);
          const node = parsed.firstChild;
          if (parsed.childCount !== 1 || node?.type !== table) return false;

          const from = $head.before();
          const tr = state.tr.replaceWith(from, from + block.nodeSize, node);
          // The cursor goes into the first cell of the empty row.
          const firstRow = node.child(0).nodeSize;
          tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1 + firstRow + 1)));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
);
