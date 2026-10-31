// ==Highlight==: the "==text==" syntax for highlighted text. Shown as
// <mark>, saved as "==text==", toggled with Ctrl+Shift+H. (Highlights that
// contain other formatting, like ==**bold**==, aren't recognised yet.)

import { markRule } from '@milkdown/kit/prose';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { $command, $inputRule, $markSchema, $remark } from '@milkdown/kit/utils';
import type { Handle } from 'mdast-util-to-markdown';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** A remark plugin: turns "==text==" in plain text into "highlight" nodes. */
export function remarkHighlight() {
  return (tree: MdNode) => splitHighlights(tree);
}

const HIGHLIGHT = /==(?=\S)([^=]*?\S)==/g;

function splitHighlights(node: MdNode): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || !child.value?.includes('==')) {
      splitHighlights(child);
      return [child];
    }
    const parts: MdNode[] = [];
    let last = 0;
    for (const match of child.value.matchAll(HIGHLIGHT)) {
      if (match.index > last) parts.push({ type: 'text', value: child.value.slice(last, match.index) });
      parts.push({ type: 'highlight', children: [{ type: 'text', value: match[1] }] });
      last = match.index + match[0].length;
    }
    if (!parts.length) return [child];
    if (last < child.value.length) parts.push({ type: 'text', value: child.value.slice(last) });
    return parts;
  });
}

/** Writes a "highlight" node back as "==text==". */
export const highlightHandler: Handle = (node, _parent, state, info) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a node type mdast doesn't know
  `==${state.containerPhrasing(node as any, { ...info, before: '=', after: '=' })}==`;

const highlightRemark = $remark('highlight', () => remarkHighlight);

export const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', { class: 'highlight' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight');
    },
  },
}));

/** Typing "==text==" highlights the text. */
const highlightInputRule = $inputRule((ctx) => markRule(/(?:==)([^=\s](?:[^=]*[^=\s])?)(?:==)$/, highlightSchema.type(ctx)));

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () => toggleMark(highlightSchema.type(ctx)));

export const highlight = [highlightRemark, highlightSchema, highlightInputRule, toggleHighlightCommand].flat();
