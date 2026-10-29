// The two editing modes, behind one small interface so the rest of the app
// does not care which one is active:
//
//   - Live preview: Milkdown Crepe (WYSIWYG, Typora-like)
//   - Source: a plain textarea with the raw Markdown

import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, remarkCtx, remarkStringifyOptionsCtx, serializerCtx, type CmdKey } from '@milkdown/kit/core';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { upload, uploadConfig, type Uploader } from '@milkdown/kit/plugin/upload';
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { AllSelection } from '@milkdown/kit/prose/state';
import { $remark, callCommand } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { imageHandler, useImageBlocks } from './image-blocks';
import { detectStyle } from './markdown-style';
import { BlockPreserver, type Range, type SourceTree } from './preserve';
import { ProseSearcher, searchHighlightPlugin, TextareaSearcher, type Searcher } from './search';

export type EditorMode = 'wysiwyg' | 'source';

export interface EditorOptions {
  host: HTMLElement;
  /** With "\n" line endings. */
  markdown: string;
  /** Called after the content changes. */
  onChange: () => void;
  /** Map an image `src` from the Markdown to a URL the webview can show. */
  resolveImage: (src: string) => Promise<string> | string;
  /** Store a pasted or uploaded image; resolve the `src` to put in Markdown. */
  uploadImage: (file: File) => Promise<string>;
}

export interface MarkdownEditor {
  readonly mode: EditorMode;
  getMarkdown(): string;
  /**
   * Run an editing command such as "bold" or "heading-2" (see `textCommands`
   * in keymap.ts). `arg` is the URL for "link", { src, alt } for "image" and
   * the text for "paste-plain". Returns false if it can't run here.
   */
  run(command: string, arg?: unknown): boolean;
  readonly searcher: Searcher;
  focus(): void;
  destroy(): Promise<void>;
}

export function createEditor(mode: EditorMode, options: EditorOptions): Promise<MarkdownEditor> {
  return mode === 'wysiwyg' ? createWysiwygEditor(options) : Promise.resolve(createSourceEditor(options));
}

async function createWysiwygEditor(options: EditorOptions): Promise<MarkdownEditor> {
  const root = document.createElement('div');
  root.className = 'wysiwyg-root';
  options.host.append(root);

  const crepe = new Crepe({
    root,
    defaultValue: options.markdown,
    // Turn features on/off here. See `Crepe.Feature` for the full list.
    features: {
      [Crepe.Feature.Latex]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ImageBlock]: true,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: 'Start writing…', mode: 'doc' },
      // Math blocks show only the formula until you click them.
      [Crepe.Feature.CodeMirror]: { previewOnlyByDefault: true },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: options.resolveImage,
        onUpload: options.uploadImage,
      },
    },
  });

  // Pasted or dropped image files become inline images, like Typora.
  const uploader: Uploader = async (files, schema) => {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    const nodes = await Promise.all(
      images.map(async (file) =>
        schema.nodes.image.createAndFill({
          src: await options.uploadImage(file),
          alt: file.name.replace(/\.[^.]+$/, ''),
        }),
      ),
    );
    return nodes.filter((node) => node !== null);
  };
  // Blocks Milkdown rewrites follow the file's own style ("-" bullets, ...).
  const style = detectStyle(options.markdown);
  // Milkdown parses the file into a syntax tree that knows where each block
  // is in the file. Keep it, to save unedited blocks exactly as they were.
  let fileTree: SourceTree | null = null;
  const keepFileTree = $remark('keepFileTree', () => () => (tree, file) => {
    if (!fileTree && String(file.value) === options.markdown) fileTree = tree as unknown as SourceTree;
  });
  crepe.editor
    .config((ctx) => {
      ctx.update(uploadConfig.key, (config) => ({ ...config, uploader }));
      ctx.update(remarkStringifyOptionsCtx, (current) => ({
        ...current,
        ...style,
        handlers: { ...current.handlers, image: imageHandler, ...style.handlers },
      }));
    })
    .use(upload)
    .use(keepFileTree)
    .use(searchHighlightPlugin);
  await useImageBlocks(crepe.editor);

  let destroyed = false;
  crepe.on((events) => {
    // `updated`, not `markdownUpdated`: that one serializes the whole
    // document after every change, which makes typing in big files slow.
    events.updated(() => {
      if (!destroyed) options.onChange();
    });
  });
  await crepe.create();

  // Unedited blocks are saved exactly as they are in the file.
  const ctx = crepe.editor.ctx;
  const view = ctx.get(editorViewCtx);
  const serializer = ctx.get(serializerCtx);
  const serialize = (nodes: ProseNode[]) => serializer(view.state.schema.topNodeType.create(null, nodes));
  // Block positions in a piece of Markdown. Link definitions are not blocks
  // in the editor (Milkdown turns reference links into normal links).
  const locate = (markdown: string): Range[] =>
    (ctx.get(remarkCtx).parse(markdown) as unknown as SourceTree).children
      .filter((block) => block.type !== 'definition')
      .map((block) => [block.position?.start.offset ?? -1, block.position?.end.offset ?? -1]);
  const tree = fileTree as SourceTree | null; // set by the plugin above, during create()
  const preserver = tree && BlockPreserver.create(options.markdown, tree, view.state.doc, serialize, locate);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any command
  const call =(command: { key: CmdKey<any> }, payload?: unknown) => crepe.editor.action(callCommand(command.key, payload));

  /** Ctrl+2 on a level-2 heading turns it back into a paragraph, like Typora. */
  const heading = (level: number) => {
    const block = view.state.selection.$from.parent;
    if (block.type.name === 'heading' && block.attrs.level === level) return call(turnIntoTextCommand);
    return call(wrapInHeadingCommand, level);
  };

  /** A bullet list whose items have checkboxes; toggles them in a list. */
  const taskList = () => {
    if (!view.state.selection.$from.node(-1) || view.state.selection.$from.node(-1).type.name !== 'list_item') {
      call(wrapInBulletListCommand);
    }
    const { state } = view;
    const { from, to } = state.selection;
    const tr = state.tr;
    let allTasks = true;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === 'list_item' && node.attrs.checked == null) allTasks = false;
    });
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'list_item') tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: allTasks ? null : false });
    });
    view.dispatch(tr);
    return true;
  };

  const link = (href: string) => {
    const { state } = view;
    if (state.selection.empty) {
      const mark = state.schema.marks.link.create({ href });
      view.dispatch(state.tr.replaceSelectionWith(state.schema.text(href, [mark]), false));
      return true;
    }
    return call(toggleLinkCommand, { href });
  };

  const pastePlain = (text: string) => {
    const { schema } = view.state;
    const paragraphs = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
    view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(paragraphs), 1, 1)).scrollIntoView());
    return true;
  };

  const commands: Record<string, (arg?: unknown) => boolean> = {
    'heading-1': () => heading(1),
    'heading-2': () => heading(2),
    'heading-3': () => heading(3),
    'heading-4': () => heading(4),
    'heading-5': () => heading(5),
    'heading-6': () => heading(6),
    paragraph: () => call(turnIntoTextCommand),
    bold: () => call(toggleStrongCommand),
    italic: () => call(toggleEmphasisCommand),
    'inline-code': () => call(toggleInlineCodeCommand),
    strikethrough: () => call(toggleStrikethroughCommand),
    quote: () => call(wrapInBlockquoteCommand),
    'bullet-list': () => call(wrapInBulletListCommand),
    'ordered-list': () => call(wrapInOrderedListCommand),
    'task-list': taskList,
    'code-block': () => call(createCodeBlockCommand, ''),
    'math-block': () => call(createCodeBlockCommand, 'LaTeX'),
    table: () => call(insertTableCommand, { row: 3, col: 3 }),
    hr: () => call(insertHrCommand),
    link: (href) => typeof href === 'string' && link(href),
    image: (image) => call(insertImageCommand, image as { src: string; alt?: string }),
    'clear-format': () => {
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.removeMark(from, to));
      return true;
    },
    'paste-plain': (text) => typeof text === 'string' && pastePlain(text),
    // Like Ctrl+V, so Markdown in the text is turned into formatting.
    paste: (text) => {
      if (typeof text !== 'string') return false;
      const data = new DataTransfer();
      data.setData('text/plain', text);
      view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      return true;
    },
    undo: () => call(undoCommand),
    redo: () => call(redoCommand),
    'select-all': () => {
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
      return true;
    },
  };

  return {
    mode: 'wysiwyg',
    getMarkdown: () => (preserver ? preserver.markdown(view.state.doc) : crepe.getMarkdown()),
    run: (command, arg) => {
      const action = commands[command];
      if (!action) return false;
      view.focus();
      return action(arg);
    },
    searcher: new ProseSearcher(view),
    focus: () => view.focus(),
    destroy: async () => {
      destroyed = true;
      await crepe.destroy();
      root.remove();
    },
  };
}

function createSourceEditor(options: EditorOptions): MarkdownEditor {
  const textarea = document.createElement('textarea');
  textarea.className = 'source-editor';
  textarea.spellcheck = false;
  textarea.value = options.markdown;
  textarea.addEventListener('input', () => options.onChange());
  textarea.addEventListener('keydown', (event) => {
    // Tab inserts spaces instead of leaving the editor.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      // execCommand keeps the browser's undo history intact.
      document.execCommand('insertText', false, '    ');
    }
  });
  options.host.append(textarea);

  // Edits go through execCommand so that undo keeps working.
  const replaceSelection = (text: string, select = false) => {
    const start = textarea.selectionStart;
    document.execCommand('insertText', false, text);
    if (select) textarea.setSelectionRange(start, start + text.length);
    return true;
  };
  const wrap = (marker: string) => {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    if (!selected) {
      replaceSelection(marker + marker);
      textarea.setSelectionRange(start + marker.length, start + marker.length);
      return true;
    }
    return replaceSelection(marker + selected + marker, true);
  };
  /** Replace the "#" markers of the current line. */
  const heading = (level: number) => {
    const { value, selectionStart } = textarea;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEnd = value.indexOf('\n', selectionStart);
    const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
    const text = line.replace(/^ {0,3}#{1,6}[ \t]+/, '');
    textarea.setSelectionRange(lineStart, lineStart + line.length);
    return replaceSelection((level ? '#'.repeat(level) + ' ' : '') + text);
  };
  const commands: Record<string, (arg?: unknown) => boolean> = {
    'heading-1': () => heading(1),
    'heading-2': () => heading(2),
    'heading-3': () => heading(3),
    'heading-4': () => heading(4),
    'heading-5': () => heading(5),
    'heading-6': () => heading(6),
    paragraph: () => heading(0),
    bold: () => wrap('**'),
    italic: () => wrap('*'),
    'inline-code': () => wrap('`'),
    strikethrough: () => wrap('~~'),
    link: (href) => typeof href === 'string' && replaceSelection(`[${textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) || href}](${href})`),
    image: (image) => {
      const { src, alt = '' } = image as { src: string; alt?: string };
      return replaceSelection(`![${alt}](${src})`);
    },
    'paste-plain': (text) => typeof text === 'string' && replaceSelection(text),
    paste: (text) => typeof text === 'string' && replaceSelection(text),
    undo: () => document.execCommand('undo'),
    redo: () => document.execCommand('redo'),
    'select-all': () => {
      textarea.select();
      return true;
    },
  };

  return {
    mode: 'source',
    getMarkdown: () => textarea.value,
    run: (command, arg) => {
      const action = commands[command];
      if (!action) return false;
      textarea.focus();
      return action(arg);
    },
    searcher: new TextareaSearcher(textarea),
    focus: () => textarea.focus(),
    destroy: async () => textarea.remove(),
  };
}
