// Saving without reformatting.
//
// Milkdown turns the whole document back into Markdown, which can change
// parts of the file nobody touched ("-" bullets become "*", tables get
// re-padded...). Instead, blocks that were not edited are copied exactly from
// the original file, and only edited or new blocks go through Milkdown.
//
// This works because ProseMirror keeps the same node object for every
// top-level block that a change did not touch.

import type { Node as ProseNode } from '@milkdown/kit/prose/model';

/** The parts of a remark (mdast) tree we need. */
export interface SourceTree {
  children: { type: string; position?: { start: { offset?: number }; end: { offset?: number } } }[];
}

/** [start, end] offsets in the file. */
export type Range = [number, number];

interface SourceBlock {
  node: ProseNode;
  start: number;
  end: number;
}

export class BlockPreserver {
  private readonly index: Map<ProseNode, number>;

  private constructor(
    private readonly source: string,
    private readonly blocks: SourceBlock[],
    private readonly serialize: (nodes: ProseNode[]) => string,
  ) {
    this.index = new Map(blocks.map((block, i) => [block.node, i]));
  }

  /**
   * `tree` is `source` parsed by the editor's own remark processor and `doc`
   * the editor's document for it. `locate` finds the blocks in a piece of
   * Markdown, as [start, end] offsets. Returns null when the file and the
   * document can't be matched block by block; the caller should then
   * serialize the whole document.
   */
  static create(
    source: string,
    tree: SourceTree,
    doc: ProseNode,
    serialize: (nodes: ProseNode[]) => string,
    locate: (markdown: string) => Range[],
  ): BlockPreserver | null {
    const sourceBlocks = tree.children;
    const nodes = children(doc);
    // Milkdown may add an empty paragraph at the end of the document.
    while (nodes.length > sourceBlocks.length && isEmptyParagraph(nodes[nodes.length - 1])) nodes.pop();
    if (nodes.length !== sourceBlocks.length) return null;

    const ranges: (Range | null)[] = sourceBlocks.map((block) => {
      const { start, end } = block.position ?? {};
      return start?.offset !== undefined && end?.offset !== undefined ? [start.offset, end.offset] : null;
    });
    // Some blocks (math, images) are replaced by remark plugins and lose their
    // position. Find them in the text between their neighbours.
    for (let i = 0; i < ranges.length; ) {
      if (ranges[i]) {
        i++;
        continue;
      }
      let next = i;
      while (next < ranges.length && !ranges[next]) next++;
      const from = i > 0 ? ranges[i - 1]![1] : 0;
      const to = next < ranges.length ? ranges[next]![0] : source.length;
      const found = locate(source.slice(from, to));
      if (found.length !== next - i) return null;
      found.forEach(([start, end], k) => (ranges[i + k] = [from + start, from + end]));
      i = next;
    }

    const blocks: SourceBlock[] = [];
    let previousEnd = 0;
    for (let i = 0; i < nodes.length; i++) {
      const [start, end] = ranges[i]!;
      if (start < previousEnd || end < start || end > source.length) return null;
      blocks.push({ node: nodes[i], start, end });
      previousEnd = end;
    }
    return new BlockPreserver(source, blocks, serialize);
  }

  markdown(doc: ProseNode): string {
    const { source, blocks } = this;
    const nodes = children(doc);
    while (nodes.length > 0 && isEmptyParagraph(nodes[nodes.length - 1]) && !this.index.has(nodes[nodes.length - 1])) {
      nodes.pop();
    }

    // Which original block each node is, or -1 for an edited or new block.
    const match = nodes.map((node) => this.index.get(node) ?? -1);
    for (let i = 0; i < nodes.length; i++) {
      // A plugin may have replaced a block with an identical copy.
      const expected = i === 0 ? 0 : match[i - 1] + 1;
      if (match[i] < 0 && match[i - 1] !== -1 && expected < blocks.length && nodes[i].eq(blocks[expected].node)) {
        match[i] = expected;
      }
      // Two lists of the same kind next to each other need Milkdown's care
      // (different bullets), or they would merge into one list.
      if (i > 0 && (match[i] < 0 || match[i - 1] < 0) && isList(nodes[i]) && nodes[i].type === nodes[i - 1].type) {
        return this.serialize(nodes);
      }
    }

    let out = '';
    // The original block that the text written so far ends with, or null.
    let previous: number | null = null;
    // Gaps of the file (gap k = the text before block k) that were written.
    const usedGaps = new Set<number>();
    for (let i = 0; i < nodes.length; ) {
      let next = i + 1;
      let text: string;
      // The original blocks this part stands for: [first, last].
      let first = match[i];
      let last = first;
      if (first >= 0) {
        text = source.slice(blocks[first].start, blocks[first].end);
      } else {
        // Serialize a run of edited blocks together, so Milkdown can join them.
        while (next < nodes.length && match[next] < 0) next++;
        text = this.serialize(nodes.slice(i, next)).replace(/\n+$/, '');
        // If the run sits where some original blocks were, it replaces them.
        first = i > 0 ? match[i - 1] + 1 : 0;
        last = next < nodes.length ? match[next] - 1 : blocks.length - 1;
      }
      if (text) {
        if (first >= 0 && first <= last && (out ? previous === first - 1 : first === 0)) {
          // Same neighbour as in the file: keep the original gap.
          out += this.gap(first);
          usedGaps.add(first);
        } else if (out) {
          out += '\n\n';
        }
        out += text;
        previous = first >= 0 && first <= last ? last : null;
      }
      i = next;
    }
    if (!out) return '';

    // Gaps can hold things the editor doesn't show, such as link reference
    // definitions ("[1]: https://..."). Never drop them: move them to the end.
    const kept: string[] = [];
    for (let k = 0; k < blocks.length; k++) {
      if (!usedGaps.has(k) && this.gap(k).trim()) kept.push(this.gap(k).trim());
    }
    const tail = blocks.length > 0 ? this.gap(blocks.length) : '\n';
    let ending = tail;
    if (previous !== blocks.length - 1 && tail.trim()) {
      kept.push(tail.trim());
      ending = '\n';
    }
    return out + kept.map((text) => '\n\n' + text).join('') + ending;
  }

  /** The text before block `k` (k = blocks.length: the end of the file). */
  private gap(k: number): string {
    const { source, blocks } = this;
    return source.slice(k === 0 ? 0 : blocks[k - 1].end, k < blocks.length ? blocks[k].start : source.length);
  }
}

function children(doc: ProseNode): ProseNode[] {
  const nodes: ProseNode[] = [];
  doc.forEach((node) => nodes.push(node));
  return nodes;
}

function isEmptyParagraph(node: ProseNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0;
}

function isList(node: ProseNode): boolean {
  return node.type.name === 'bullet_list' || node.type.name === 'ordered_list';
}
