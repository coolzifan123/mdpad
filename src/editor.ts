// The two editing modes, behind one small interface so the rest of the app
// does not care which one is active:
//
//   - Live preview: Milkdown Crepe (WYSIWYG, Typora-like)
//   - Source: a plain textarea with the raw Markdown

import { Crepe } from '@milkdown/crepe';
import { upload, uploadConfig, type Uploader } from '@milkdown/kit/plugin/upload';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

export type EditorMode = 'wysiwyg' | 'source';

export interface EditorOptions {
  host: HTMLElement;
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
  crepe.editor
    .config((ctx) => ctx.update(uploadConfig.key, (config) => ({ ...config, uploader })))
    .use(upload);

  let destroyed = false;
  crepe.on((events) => {
    events.markdownUpdated(() => {
      if (!destroyed) options.onChange();
    });
  });
  await crepe.create();

  return {
    mode: 'wysiwyg',
    getMarkdown: () => crepe.getMarkdown(),
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
