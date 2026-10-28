// The two editing modes, behind one small interface so the rest of the app
// does not care which one is active:
//
//   - Live preview: Milkdown Crepe (WYSIWYG, Typora-like)
//   - Source: a plain textarea with the raw Markdown

import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, remarkCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { upload, uploadConfig, type Uploader } from '@milkdown/kit/plugin/upload';
import { $remark } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { detectStyle } from './markdown-style';
import { BlockPreserver, type Range, type SourceTree } from './preserve';

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
        handlers: { ...current.handlers, ...style.handlers },
      }));
    })
    .use(upload)
    .use(keepFileTree);

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
  // Without it, saving falls back to rewriting the whole file.
  // Block positions in a piece of Markdown. Link definitions are not blocks
  // in the editor (Milkdown turns reference links into normal links).
  const locate = (markdown: string): Range[] =>
    (ctx.get(remarkCtx).parse(markdown) as unknown as SourceTree).children
      .filter((block) => block.type !== 'definition')
      .map((block) => [block.position?.start.offset ?? -1, block.position?.end.offset ?? -1]);
  const tree = fileTree as SourceTree | null; // set by the plugin above, during create()
  const preserver = tree && BlockPreserver.create(options.markdown, tree, view.state.doc, serialize, locate);

  return {
    mode: 'wysiwyg',
    getMarkdown: () => (preserver ? preserver.markdown(view.state.doc) : crepe.getMarkdown()),
    focus: () => root.querySelector<HTMLElement>('.ProseMirror')?.focus(),
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

  return {
    mode: 'source',
    getMarkdown: () => textarea.value,
    focus: () => textarea.focus(),
    destroy: async () => textarea.remove(),
  };
}
