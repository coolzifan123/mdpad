// Editable Markdown symbols, like Typora. When the cursor is in formatted
// text, that text turns into the Markdown it is written as — "**bold**",
// "[text](url)", "## " before a heading, "![alt](picture.png)", "$x^2$" —
// which can be edited like any other text; the symbols are shown in grey, and
// a picture or formula is previewed next to its Markdown. When the cursor leaves, the text
// is read as Markdown again. Text that wasn't changed gets its formatting
// back exactly as it was, so just moving the cursor never changes the file.
//
// The Markdown text carries a mark ("mdSource", or "mdPrefix" for a
// heading's "## ") with an id; `parts` remembers how each piece was made, to
// undo it exactly. Whatever saves or reads the document as Markdown uses
// `committed`: the document with all of this undone.

import { parserCtx, remarkCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { Fragment, type Mark, type MarkType, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import type { Mapping } from '@milkdown/kit/prose/transform';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $markSchema, $prose } from '@milkdown/kit/utils';
import { HIGHLIGHT } from './highlight';

/** View → Markdown Symbols at Cursor. */
export const inlineSourceSettings = { enabled: true };

/** Formatting written with symbols around the text. */
const FORMATTING = new Set(['strong', 'emphasis', 'inlineCode', 'strike_through', 'highlight', 'link']);
/** Inline nodes that are written as Markdown too (they have no text of their own). */
const ATOMS = new Set(['image', 'math_inline']);
const HEADING_PREFIX = /^(#{1,6}) $/;

/** Markdown that was written out for the cursor, and how to undo that. */
interface Part {
  source: string;
  /** Where the symbols are in `source`, as [start, end) ranges. */
  symbols: [number, number][];
  /** The formatting of the text without the symbols: [from, to, marks]. */
  marks: [number, number, readonly Mark[]][];
  /** With a picture or formula: what was there, put back as it was. */
  nodes?: Fragment;
}

/** A stretch of Markdown text in a block (positions in the document). */
interface Group {
  prefix: boolean;
  mark: Mark;
  id: number;
  from: number;
  to: number;
  text: string;
}

interface PluginState {
  /** Blocks (positions) with Markdown text written out. */
  blocks: number[];
  /** A heading whose "## " is written out: if that's deleted, it becomes a paragraph. */
  prefixHeading: number;
  /** Look through the whole document (after undo, redo or a drop). */
  rescan: boolean;
}

interface Layout {
  /** For each character shown in the editor, its index in the Markdown. */
  shownAt: number[];
  /** The rest of the Markdown: [start, end) ranges of symbols. */
  symbols: [number, number][];
  /** For each character shown, the classes that style it like its formatting ("md-strong"…). */
  styles: string[];
  /** A picture or formula to show next to the Markdown. */
  preview: { image: string } | { math: string } | null;
}

/** Classes for the text inside written-out Markdown, so it still looks bold, italic… */
const STYLE: Record<string, string> = {
  strong: 'md-strong',
  emphasis: 'md-em',
  delete: 'md-strike',
  inlineCode: 'md-code',
  link: 'md-link',
};

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** A mark for Markdown text: never read from a file, written out as it is. */
const markdownTextMark = (name: string, inclusive: boolean, className: string) =>
  $markSchema(name, () => ({
    // `style`: classes that make the text look as it will (bold…). On the
    // mark, not as decorations: text typed inside a decoration gets redrawn
    // after each key, which is slow in big files.
    attrs: { id: { default: 0 }, style: { default: '' } },
    excludes: '_',
    inclusive,
    parseDOM: [],
    toDOM: (mark) => ['span', { class: `${className} ${mark.attrs.style}`.trim() }, 0],
    parseMarkdown: { match: () => false, runner: () => {} },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner: (state, _mark, node) => {
        state.addNode('html', undefined, node.text ?? '');
        return true;
      },
    },
  }));

const sourceMark = markdownTextMark('mdSource', true, 'md-source');
/** Not inclusive: what's typed after "## " is the heading's text. */
const prefixMark = markdownTextMark('mdPrefix', false, 'md-source md-prefix');

const key = new PluginKey<PluginState>('mdpad-inline-source');
const REFRESH = 'refresh';

export interface InlineSource {
  plugins: MilkdownPlugin[];
  /** The document with all written-out Markdown turned back into formatting. */
  committed(state: EditorState): { doc: ProseNode; mapping: Mapping };
  /** Before a command: turn the Markdown at the cursor back into formatting. */
  settle(view: EditorView, command: string): void;
  /** After `inlineSourceSettings` changed. */
  refresh(view: EditorView): void;
  /** A block's text as it shows without the Markdown symbols (for heading ids). */
  shownText(block: ProseNode): string;
}

export interface InlineSourceOptions {
  /** A picture's address as the editor can show it (relative paths…). */
  resolveImage?: (src: string) => Promise<string> | string;
}

export function createInlineSource(options: InlineSourceOptions = {}): InlineSource {
  let ctx: Ctx | null = null;
  let nextId = 1;
  const parts = new Map<number, Part>();
  const committed = new WeakMap<ProseNode, Transaction>();
  const layouts = new Map<string, Layout>();
  let composing = false;
  /** Ctrl+click opens links: leave the link as it is for that click. */
  let linkClick = false;

  const markTypes = () => ({ source: sourceMark.type(ctx!) as MarkType, prefix: prefixMark.type(ctx!) as MarkType });

  // ---------------------------------------------------------------------
  // Markdown in and out

  /** Inline content as Markdown. */
  function inlineMarkdown(state: EditorState, content: Fragment): string {
    const { schema } = state;
    return serialize(schema.topNodeType.create(null, schema.nodes.paragraph.create(null, content)));
  }

  function serialize(doc: ProseNode): string {
    return ctx!.get(serializerCtx)(doc).replace(/\n+$/, '');
  }

  /** Which characters of `markdown` show in the editor, and which are symbols. */
  function layout(markdown: string): Layout {
    const cached = layouts.get(markdown);
    if (cached) return cached;
    const shownAt: number[] = [];
    const styles: string[] = [];
    /** Characters that aren't symbols. */
    const plain = new Set<number>();
    let preview: Layout['preview'] = null;
    const show = (at: number, style: string[]) => {
      shownAt.push(at);
      styles.push(style.join(' '));
      plain.add(at);
    };
    /** A picture or formula: one position in the editor, `text` is not grey. */
    const atom = (start: number, end: number, text: string, style: string[]) => {
      shownAt.push(start);
      styles.push(style.join(' '));
      const at = text ? markdown.slice(start, end).indexOf(text) : -1;
      if (at >= 0) for (let i = 0; i < text.length; i++) plain.add(start + at + i);
    };
    const walk = (node: MdNode, style: string[]) => {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? start;
      if (STYLE[node.type]) style = [...style, STYLE[node.type]];
      if (node.type === 'text' && node.value !== undefined) {
        for (const { at, marked } of textLayout(markdown.slice(start, end), node.value, start)) {
          show(at, marked ? [...style, 'md-mark'] : style);
        }
      } else if (node.type === 'inlineCode' && node.value !== undefined) {
        const at = Math.max(0, markdown.slice(start, end).indexOf(node.value));
        for (let i = 0; i < node.value.length; i++) show(start + at + i, style);
      } else if (node.type === 'inlineMath') {
        atom(start, end, node.value ?? '', style);
        preview ??= { math: node.value ?? '' };
      } else if (node.type === 'image') {
        atom(start, end, node.alt ?? '', style);
        preview ??= { image: node.url ?? '' };
      } else if (node.type === 'html') {
        for (let i = start; i < end; i++) show(i, style);
      } else if (node.children) {
        node.children.forEach((child) => walk(child, style));
      } else if (node.type !== 'root') {
        // An image, a line break, a footnote reference…: one position.
        show(start, style);
      }
    };
    walk(ctx!.get(remarkCtx).parse(markdown) as unknown as MdNode, []);
    const symbols: [number, number][] = [];
    for (let i = 0; i < markdown.length; i++) {
      if (plain.has(i)) continue;
      const last = symbols[symbols.length - 1];
      if (last && last[1] === i) last[1] = i + 1;
      else symbols.push([i, i + 1]);
    }
    if (layouts.size > 500) layouts.clear();
    const result = { shownAt, symbols, styles, preview };
    layouts.set(markdown, result);
    return result;
  }

  // ---------------------------------------------------------------------
  // Looking at a block

  function groupsIn(block: ProseNode, start: number): Group[] {
    const { source, prefix } = markTypes();
    const groups: Group[] = [];
    let last: Group | null = null;
    block.forEach((child, offset) => {
      const mark = child.isText ? child.marks.find((m) => m.type === source || m.type === prefix) : undefined;
      if (!mark) {
        last = null;
        return;
      }
      const from = start + offset;
      const isPrefix = mark.type === prefix;
      if (last && last.id === mark.attrs.id && last.prefix === isPrefix && last.to === from) {
        last.to += child.nodeSize;
        last.text += child.text;
      } else {
        last = { prefix: isPrefix, mark, id: mark.attrs.id as number, from, to: from + child.nodeSize, text: child.text ?? '' };
        groups.push(last);
      }
    });
    return groups;
  }

  const hasMarkdownText = (block: ProseNode) => groupsIn(block, 0).length > 0;

  /** The formatted text at `offset` in `block` (in it or next to it), as [from, to) offsets. */
  function formattedRange(block: ProseNode, offset: number): [number, number] | null {
    const kids: { node: ProseNode; from: number; to: number }[] = [];
    block.forEach((node, from) => kids.push({ node, from, to: from + node.nodeSize }));
    const formatting = (node: ProseNode) => node.marks.filter((m) => FORMATTING.has(m.type.name));
    const touching = kids.flatMap((kid, i) =>
      kid.from <= offset && offset <= kid.to && (formatting(kid.node).length || ATOMS.has(kid.node.type.name)) ? [i] : [],
    );
    if (!touching.length) return null;
    let first = touching[0];
    let last = touching[touching.length - 1];
    // Grow until each piece of formatting inside is whole.
    for (let grown = true; grown; ) {
      grown = false;
      for (let i = first; i <= last; i++) {
        for (const mark of formatting(kids[i].node)) {
          while (first > 0 && mark.isInSet(kids[first - 1].node.marks)) (first--, (grown = true));
          while (last < kids.length - 1 && mark.isInSet(kids[last + 1].node.marks)) (last++, (grown = true));
        }
      }
    }
    for (let i = first; i <= last; i++) if (!kids[i].node.isText && !ATOMS.has(kids[i].node.type.name)) return null;
    return [kids[first].from, kids[last].to];
  }

  /** Whether [from, to) has a picture or formula in it. */
  function hasAtom(doc: ProseNode, from: number, to: number): boolean {
    let found = false;
    doc.nodesBetween(from, to, (node) => {
      found ||= ATOMS.has(node.type.name);
    });
    return found;
  }

  /** How the formatted text [from, to) is written in Markdown, if it can be shown that way. */
  function planRun(state: EditorState, doc: ProseNode, from: number, to: number) {
    const content = doc.slice(from, to).content;
    const markdown = inlineMarkdown(state, content);
    const { shownAt, symbols } = layout(markdown);
    const shown = doc.textBetween(from, to);
    // Only when the Markdown shows exactly this text (no odd escaping).
    if (shownAt.length !== shown.length || shownAt.some((at, i) => markdown[at] !== shown[i])) return null;
    return { content, markdown, shownAt, symbols };
  }

  /** Blocks with Markdown text written out. */
  function expandedBlocks(state: EditorState, hint: PluginState): number[] {
    const found = new Set<number>();
    if (hint.rescan) {
      state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (hasMarkdownText(node)) found.add(pos);
        return false;
      });
      return [...found];
    }
    for (const pos of [...hint.blocks, state.selection.from, state.selection.to]) {
      if (pos < 0 || pos > state.doc.content.size) continue;
      const node = state.doc.nodeAt(pos);
      const $pos = state.doc.resolve(pos);
      const at = node?.isTextblock ? pos : $pos.parent.isTextblock ? $pos.before() : -1;
      if (at >= 0 && hasMarkdownText(state.doc.nodeAt(at)!)) found.add(at);
    }
    return [...found];
  }

  // ---------------------------------------------------------------------
  // Writing Markdown out and reading it back

  /**
   * Write out the formatted text [from, to) as Markdown. Returns the cursor's
   * new position: inside the symbols ("**|bold", "bold|**"), or after them
   * if `outside` (the formatting was just finished by typing "**").
   */
  function expandRun(state: EditorState, tr: Transaction, from: number, to: number, cursor: number, outside: boolean): number {
    const content = tr.doc.slice(from, to).content;
    let hasAtom = false;
    content.forEach((node) => (hasAtom ||= ATOMS.has(node.type.name)));
    if (hasAtom) {
      // No text to keep: replace it all, and put it back as it was. The
      // cursor goes before or after the Markdown, as it was before or after
      // the picture.
      const markdown = inlineMarkdown(state, content);
      const id = nextId++;
      parts.set(id, { source: markdown, symbols: layout(markdown).symbols, marks: [], nodes: content });
      tr.replaceWith(from, to, state.schema.text(markdown, [markTypes().source.create({ id })]));
      return cursor <= from ? from : from + markdown.length;
    }
    const plan = planRun(state, tr.doc, from, to);
    if (!plan) return cursor;
    const { markdown, shownAt, symbols } = plan;
    const marks: Part['marks'] = [];
    content.forEach((node, offset) => marks.push([offset, offset + node.nodeSize, node.marks]));
    const id = nextId++;
    parts.set(id, { source: markdown, symbols, marks });
    // The formatting all of the text has (for nested formatting, the outer one).
    const { styles } = layout(markdown);
    const style = (styles[0] ?? '').split(' ').filter((name) => name && styles.every((s) => s.split(' ').includes(name)));
    const mark = markTypes().source.create({ id, style: style.join(' ') });
    tr.addMark(from, to, mark);
    const shownBefore = (index: number) => shownAt.filter((at) => at < index).length;
    for (const [start, end] of [...symbols].reverse()) {
      tr.insert(from + shownBefore(start), state.schema.text(markdown.slice(start, end), [mark]));
    }
    // The cursor goes inside the symbols: "**|bold" or "bold|**".
    const r = cursor - from;
    const index =
      r >= shownAt.length && outside ? markdown.length : r <= 0 ? (shownAt[0] ?? markdown.length) : r > shownAt.length ? markdown.length : shownAt[r - 1] + 1;
    return from + index;
  }

  /** Write out the Markdown at the cursor in the block at `blockPos`. Returns the cursor's new position. */
  function expandAt(state: EditorState, tr: Transaction, blockPos: number, cursor: number, outside = false): number {
    const start = blockPos + 1;
    const range = formattedRange(tr.doc.nodeAt(blockPos)!, cursor - start);
    if (range) cursor = expandRun(state, tr, start + range[0], start + range[1], cursor, outside);
    const block = tr.doc.nodeAt(blockPos)!;
    if (block.type.name === 'heading') {
      const text = '#'.repeat(block.attrs.level as number) + ' ';
      const id = nextId++;
      parts.set(id, { source: text, symbols: [[0, text.length]], marks: [] });
      tr.insert(start, state.schema.text(text, [markTypes().prefix.create({ id })]));
      cursor += text.length;
    }
    return cursor;
  }

  /** Undo a group's writing-out exactly (positions as in `tr.doc`). */
  function collapseExact(tr: Transaction, group: Group, part: Part): void {
    const { source, prefix } = markTypes();
    const { from } = group;
    if (part.nodes) {
      tr.replaceWith(from, group.to, part.nodes);
      return;
    }
    for (const [start, end] of [...part.symbols].reverse()) tr.delete(from + start, from + end);
    const length = part.source.length - part.symbols.reduce((sum, [start, end]) => sum + end - start, 0);
    tr.removeMark(from, from + length, group.prefix ? prefix : source);
    for (const [start, end, marks] of part.marks) for (const mark of marks) tr.addMark(from + start, from + end, mark);
  }

  /**
   * Read a block's Markdown text as Markdown. `cursor` (a position in the
   * block, or null) is where the cursor is; returns where it should go. Text
   * that doesn't read as one block of the same kind stays as plain text.
   */
  function collapseByParsing(state: EditorState, tr: Transaction, blockPos: number, cursor: number | null): number | null {
    const { source, prefix } = markTypes();
    const { schema } = state;
    const block = tr.doc.nodeAt(blockPos)!;
    const start = blockPos + 1;
    const groups = groupsIn(block, start);
    // "## Title": read the whole line, "## " included.
    const prefixed = groups[0]?.prefix && groups[0].from === start;
    let content = block.content;
    const SENTINEL = '';
    if (cursor !== null) {
      const offset = cursor - start;
      const marks = tr.doc.resolve(cursor).marks();
      content = content.cut(0, offset).append(Fragment.from(schema.text(SENTINEL, marks))).append(content.cut(offset));
    }
    let markdown = prefixed || block.type.name === 'paragraph' ? inlineMarkdown(state, content) : serialize(schema.topNodeType.create(null, block.copy(content)));
    const at = markdown.indexOf(SENTINEL);
    markdown = markdown.replace(SENTINEL, '');

    const $block = tr.doc.resolve(blockPos);
    let parsed: ProseNode | null = null;
    try {
      const doc = ctx!.get(parserCtx)(markdown);
      const first = doc.childCount === 1 ? doc.firstChild : doc.childCount === 0 ? schema.nodes.paragraph.create() : null;
      const fits = first && $block.parent.canReplaceWith($block.index(), $block.index() + 1, first.type);
      if (first?.isTextblock && !first.type.spec.code && fits) parsed = first;
    } catch {
      parsed = null;
    }
    if (parsed) {
      tr.replaceWith(blockPos, blockPos + block.nodeSize, parsed);
      if (cursor === null) return null;
      const shown = at < 0 ? parsed.content.size : layout(markdown).shownAt.filter((i) => i < at).length;
      return start + Math.min(shown, parsed.content.size);
    }
    // Keep the text as it is, as plain text.
    tr.removeMark(start, start + block.content.size, source);
    tr.removeMark(start, start + block.content.size, prefix);
    if (prefixed && block.type.name === 'heading') tr.setNodeMarkup(blockPos, schema.nodes.paragraph);
    return cursor;
  }

  /** Turn a block's Markdown back into formatting. */
  function collapseBlock(state: EditorState, tr: Transaction, blockPos: number, cursor: number | null): { cursor: number | null; edited: boolean } {
    const block = tr.doc.nodeAt(blockPos);
    if (!block?.isTextblock) return { cursor, edited: false };
    const groups = groupsIn(block, blockPos + 1);
    const ids = groups.map((g) => g.id);
    const exact = groups.every((g) => parts.get(g.id)?.source === g.text && ids.indexOf(g.id) === ids.lastIndexOf(g.id));
    if (!exact) return { cursor: collapseByParsing(state, tr, blockPos, cursor), edited: true };
    const steps = tr.steps.length;
    // Last first, so the earlier positions stay right.
    for (const group of [...groups].reverse()) collapseExact(tr, group, parts.get(group.id)!);
    if (cursor === null) return { cursor: null, edited: false };
    let mapped = cursor;
    for (let i = steps; i < tr.steps.length; i++) mapped = tr.steps[i].getMap().map(mapped, -1);
    return { cursor: mapped, edited: false };
  }

  // ---------------------------------------------------------------------
  // Keeping up with the cursor

  function update(state: EditorState): Transaction | null {
    const hint = key.getState(state)!;
    const tr = state.tr;
    const { selection } = state;
    const { $anchor, $head } = selection;
    const block = $head.parent;
    const atomSelected = selection instanceof NodeSelection && ATOMS.has(selection.node.type.name);
    const editable = block.isTextblock && !block.type.spec.code && $anchor.sameParent($head) && !linkClick;
    const target = inlineSourceSettings.enabled && editable ? $head.before() : -1;
    const blocks = expandedBlocks(state, hint).sort((a, b) => b - a);
    let edited = false;
    let cursor: number | null = null;
    let prefixHeading = -1;

    // Other blocks go back to formatting.
    for (const pos of blocks) {
      if (pos !== target) edited = collapseBlock(state, tr, tr.mapping.map(pos), null).edited || edited;
    }

    if (target >= 0) {
      const at = tr.mapping.map(target);
      const start = at + 1;
      const head = tr.mapping.map(atomSelected ? selection.from : $head.pos);
      let node = tr.doc.nodeAt(at)!;
      const groups = groupsIn(node, start);
      const prefixGroup = groups[0]?.prefix && groups[0].from === start ? groups[0] : null;

      // A heading follows its "## " as it's edited; without one it's a paragraph.
      const $at = tr.doc.resolve(at);
      const headingFits = $at.parent.canReplaceWith($at.index(), $at.index() + 1, state.schema.nodes.heading);
      const level = prefixGroup && HEADING_PREFIX.exec(prefixGroup.text)?.[1].length;
      if (prefixGroup && level && headingFits) {
        if (node.type.name !== 'heading' || node.attrs.level !== level) {
          tr.setNodeMarkup(at, state.schema.nodes.heading, { level });
          edited = true;
        }
      } else if (node.type.name === 'heading' && (prefixGroup || hint.prefixHeading === target)) {
        tr.setNodeMarkup(at, state.schema.nodes.paragraph);
        edited = true;
      }
      node = tr.doc.nodeAt(at)!;

      if (selection.empty || atomSelected) {
        const runs = groups.filter((g) => !g.prefix);
        const inRun = runs.some((g) => g.from <= head && head <= g.to);
        const range = inRun ? null : formattedRange(node, head - start);
        const wantsRun = !!range && (hasAtom(tr.doc, start + range[0], start + range[1]) || !!planRun(state, tr.doc, start + range[0], start + range[1]));
        const strayRun = runs.some((g) => !(g.from <= head && head <= g.to));
        const wantsPrefix = node.type.name === 'heading' && !prefixGroup;
        if (wantsRun || strayRun || wantsPrefix) {
          const collapsed = groups.length ? collapseBlock(state, tr, at, head) : { cursor: head, edited: false };
          edited = collapsed.edited || edited;
          // An input rule that just made "**bold**" clears the formatting for
          // what's typed next: the cursor is after the "**", not inside.
          const outside = state.storedMarks !== null && !state.storedMarks.some((mark) => FORMATTING.has(mark.type.name));
          cursor = expandAt(state, tr, at, collapsed.cursor ?? head, outside);
        }
      }
      if (tr.doc.nodeAt(at)?.type.name === 'heading' && groupsIn(tr.doc.nodeAt(at)!, start).some((g) => g.prefix)) prefixHeading = at;
    }

    const blocksAfter = target >= 0 && hasMarkdownText(tr.doc.nodeAt(tr.mapping.map(target))!) ? [tr.mapping.map(target)] : [];
    const after: PluginState = { blocks: blocksAfter, prefixHeading: prefixHeading >= 0 ? tr.mapping.map(prefixHeading) : -1, rescan: false };
    const same = after.prefixHeading === hint.prefixHeading && !hint.rescan && after.blocks.join() === hint.blocks.join();
    if (!tr.docChanged && same) return null;
    if (cursor !== null) tr.setSelection(TextSelection.create(tr.doc, Math.min(cursor, tr.doc.content.size)));
    // Only real edits go into the undo history.
    if (!edited) tr.setMeta('addToHistory', false);
    return tr.setMeta(key, after);
  }

  /** The mark for text typed at [from, to), if it goes into Markdown text. */
  function typedMark(state: EditorState, from: number, to: number): Mark | null {
    const $from = state.doc.resolve(from);
    if (!$from.parent.isTextblock || !$from.sameParent(state.doc.resolve(to))) return null;
    for (const group of groupsIn($from.parent, $from.start())) {
      const into =
        from !== to
          ? group.from <= from && to <= group.to
          : group.prefix
            ? group.from <= from && from < group.to // "#" typed before "## " adds a level
            : group.from < from && from <= group.to; // typed right after "**" is still inside
      if (into) return group.mark;
    }
    return null;
  }

  function commit(state: EditorState): Transaction {
    const cached = committed.get(state.doc);
    if (cached) return cached;
    const tr = state.tr;
    // Only the block at the cursor has Markdown written out (update() sees to that).
    for (const pos of expandedBlocks(state, key.getState(state)!).sort((a, b) => b - a)) collapseBlock(state, tr, pos, null);
    committed.set(state.doc, tr);
    return tr;
  }

  /** The picture or formula being written, shown next to its Markdown. */
  function previewOf(state: EditorState, preview: NonNullable<Layout['preview']>): HTMLElement {
    const box = document.createElement('span');
    box.contentEditable = 'false';
    if ('image' in preview) {
      box.className = 'md-preview md-preview-image';
      const img = document.createElement('img');
      img.alt = '';
      void Promise.resolve(options.resolveImage ? options.resolveImage(preview.image) : preview.image).then((src) => (img.src = src));
      box.append(img);
    } else {
      // Drawn by the formula's own node (KaTeX).
      box.className = 'md-preview md-preview-math';
      const type = state.schema.nodes.math_inline;
      const dom = type?.spec.toDOM?.(type.create({ value: preview.math }));
      if (dom instanceof HTMLElement) box.append(dom);
      else box.textContent = preview.math;
    }
    return box;
  }

  /** Redraw after a moment; the editor may be gone by then (a Ctrl+clicked link can open another file). */
  const refreshLater = (view: EditorView) => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, REFRESH));
  };

  const plugin = $prose((pluginCtx) => {
    ctx = pluginCtx;
    return new Plugin<PluginState>({
      key,
      state: {
        init: () => ({ blocks: [], prefixHeading: -1, rescan: false }),
        apply: (tr, value) => {
          const meta = tr.getMeta(key) as PluginState | typeof REFRESH | undefined;
          if (meta && meta !== REFRESH) return meta;
          const rescan = value.rescan || !!tr.getMeta('history$') || tr.getMeta('uiEvent') === 'drop';
          if (!tr.docChanged) return rescan === value.rescan ? value : { ...value, rescan };
          const map = (pos: number) => (pos < 0 ? pos : tr.mapping.map(pos, -1));
          return { blocks: value.blocks.map(map), prefixHeading: map(value.prefixHeading), rescan };
        },
      },
      appendTransaction: (trs, _old, state) => {
        if (composing) return null;
        const ours = (tr: Transaction) => tr.getMeta(key) && tr.getMeta(key) !== REFRESH;
        if (trs.every(ours)) return null;
        if (!trs.some((tr) => tr.docChanged || tr.selectionSet || tr.getMeta(key) === REFRESH)) return null;
        return update(state);
      },
      props: {
        decorations: (state) => {
          const { blocks } = key.getState(state)!;
          const { $head } = state.selection;
          const decorations: Decoration[] = [];
          for (const pos of new Set([...blocks, $head.depth > 0 ? $head.before() : -1])) {
            const block = pos >= 0 && pos < state.doc.content.size ? state.doc.nodeAt(pos) : null;
            if (!block?.isTextblock) continue;
            for (const group of groupsIn(block, pos + 1)) {
              if (group.prefix) {
                decorations.push(Decoration.inline(group.from, group.to, { class: 'md-symbol' }));
                continue;
              }
              const { symbols, preview } = layout(group.text);
              for (const [start, end] of symbols) {
                decorations.push(Decoration.inline(group.from + start, group.from + end, { class: 'md-symbol' }));
              }
              if (preview) {
                decorations.push(Decoration.widget(group.to, () => previewOf(state, preview), { side: 1, key: `preview:${JSON.stringify(preview)}` }));
              }
            }
          }
          return DecorationSet.create(state.doc, decorations);
        },
        handleTextInput: (view, from, to, text) => {
          if (!inlineSourceSettings.enabled) return false;
          const mark = typedMark(view.state, from, to);
          if (!mark) return false;
          // Letters, digits and spaces can't finish Markdown syntax, and the
          // browser types them into the Markdown text by itself, which is much
          // faster in big files than placing the cursor again. Other
          // characters are typed here, so input rules don't turn "**a**" into
          // bold inside the Markdown text.
          if (mark.type !== markTypes().prefix && /^[\p{L}\p{N} ]+$/u.test(text)) return false;
          view.dispatch(view.state.tr.replaceWith(from, to, view.state.schema.text(text, [mark])));
          return true;
        },
        handleDOMEvents: {
          mousedown: (_view, event) => {
            linkClick = (event.ctrlKey || event.metaKey) && !!(event.target as HTMLElement).closest?.('a');
            return false;
          },
          click: (view) => {
            if (linkClick) setTimeout(() => ((linkClick = false), refreshLater(view)));
            return false;
          },
          compositionstart: () => {
            composing = true;
            return false;
          },
          compositionend: (view) => {
            composing = false;
            setTimeout(() => refreshLater(view));
            return false;
          },
        },
      },
    });
  });

  return {
    plugins: [sourceMark, prefixMark, plugin].flat(),
    committed: commit,
    settle(view, command) {
      const { state } = view;
      const { $head } = state.selection;
      if ($head.depth === 0 || !$head.parent.isTextblock || !hasMarkdownText($head.parent)) return;
      const tr = state.tr;
      const result = collapseBlock(state, tr, $head.before(), state.selection.empty ? $head.pos : null);
      // Undo and redo of edits to the Markdown text work on that text.
      if (result.edited && (command === 'undo' || command === 'redo')) return;
      if (!tr.docChanged) return;
      if (!result.edited) tr.setMeta('addToHistory', false);
      if (result.cursor !== null) tr.setSelection(TextSelection.create(tr.doc, result.cursor));
      view.dispatch(tr.setMeta(key, { blocks: [], prefixHeading: -1, rescan: false }));
    },
    refresh(view) {
      view.dispatch(view.state.tr.setMeta(key, REFRESH));
    },
    shownText(block) {
      if (!ctx) return block.textContent;
      let text = '';
      let last = 0;
      for (const group of groupsIn(block, 0)) {
        text += block.textBetween(last, group.from);
        if (!group.prefix) text += layout(group.text).shownAt.map((i) => group.text[i]).join('');
        last = group.to;
      }
      return text + block.textBetween(last, block.content.size);
    },
  };
}

/** Where the characters of a text node's `value` are in its Markdown (`source`, starting at `offset`). */
function textLayout(source: string, value: string, offset: number): { at: number; marked: boolean }[] {
  // Escapes ("\*") and entities ("&amp;") are longer in the Markdown.
  const at: number[] = [];
  let j = 0;
  for (let i = 0; i < source.length && j < value.length; i++) {
    if (source[i] === value[j]) {
      at.push(offset + i);
      j++;
    }
  }
  while (at.length < value.length) at.push(offset + source.length);
  // The "==" around highlighted text are symbols too (see highlight.ts).
  const hidden = new Set<number>();
  const marked = new Set<number>();
  for (const match of value.matchAll(HIGHLIGHT)) {
    const end = match.index + match[0].length;
    for (const i of [match.index, match.index + 1, end - 2, end - 1]) hidden.add(i);
    for (let i = match.index + 2; i < end - 2; i++) marked.add(i);
  }
  return at.flatMap((position, i) => (hidden.has(i) ? [] : [{ at: position, marked: marked.has(i) }]));
}
