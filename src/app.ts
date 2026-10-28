// The application: one open document, the active editor, and the commands
// that the toolbar buttons and keyboard shortcuts run.

import { createEditor, type EditorMode, type MarkdownEditor } from './editor';
import { isReloadKey, keymap, shortcutFor } from './keymap';
import * as platform from './platform';
import { toggleTheme } from './theme';
import { countText } from './wordcount';

const APP_NAME = 'MdPad';
const UNTITLED = 'Untitled.md';

interface DocumentState {
  /** Absolute path, or null for a document that was never saved. */
  path: string | null;
  name: string;
  /** Exact text last read from or written to disk. */
  savedText: string;
  dirty: boolean;
}

export interface AppElements {
  host: HTMLElement;
  docName: HTMLElement;
  dirtyMark: HTMLElement;
  statusMode: HTMLElement;
  statusCount: HTMLElement;
  sourceButton: HTMLElement;
}

export class App {
  private doc: DocumentState = { path: null, name: UNTITLED, savedText: '', dirty: false };
  private editor: MarkdownEditor | null = null;
  private mode: EditorMode = 'wysiwyg';
  /**
   * What the editor's content looks like when there are no unsaved changes.
   * Milkdown may format Markdown slightly differently from the file on disk,
   * so we compare against its own output. `null` = nothing to compare to.
   */
  private cleanSnapshot: string | null = '';
  /** Stops a second command from starting while a dialog is open. */
  private busy = false;
  /** Set once the user has agreed to close the window. */
  private closing = false;

  /** Add new commands here, then bind them in keymap.ts or index.html. */
  private readonly commands: Record<string, () => unknown> = {
    new: () => this.newDocument(),
    open: () => this.openDocument(),
    save: () => this.save(false),
    'save-as': () => this.save(true),
    'toggle-source': () => this.toggleSource(),
    'toggle-theme': () => toggleTheme(),
  };

  constructor(private readonly ui: AppElements) {}

  async start(): Promise<void> {
    this.bindEvents();
    const initialPath = await platform.initialFilePath();
    if (initialPath) {
      try {
        await this.load(await platform.readFile(initialPath));
        return;
      } catch (error) {
        await platform.showError(`Could not open ${initialPath}\n\n${error}`);
      }
    }
    await this.load({ path: null, name: UNTITLED, content: '' });
  }

  async run(command: string): Promise<void> {
    const action = this.commands[command];
    if (!action || this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      await platform.showError(String(error));
    } finally {
      this.busy = false;
    }
  }

  // -------------------------------------------------------------------------
  // Commands

  private async newDocument(): Promise<void> {
    if (!(await this.confirmDiscardChanges())) return;
    await this.load({ path: null, name: UNTITLED, content: '' });
  }

  private async openDocument(): Promise<void> {
    if (!(await this.confirmDiscardChanges())) return;
    const file = await platform.pickAndReadFile();
    if (file) await this.load(file);
  }

  /** Resolves true if the document was saved. */
  private async save(saveAs: boolean): Promise<boolean> {
    if (!this.editor) return false;
    // Nothing changed: don't rewrite the file (Milkdown could reformat it).
    if (!saveAs && this.doc.path && !this.doc.dirty) return true;

    const text = this.doc.dirty ? this.editor.getMarkdown() : this.doc.savedText;
    const written = await platform.writeFile(saveAs ? null : this.doc.path, this.doc.name, text);
    if (!written) return false;

    if (this.doc.dirty) this.cleanSnapshot = text;
    this.doc = { path: written.path, name: written.name, savedText: text, dirty: false };
    this.updateUi();
    return true;
  }

  private async toggleSource(): Promise<void> {
    if (!this.editor) return;
    // Source mode shows the exact file content when nothing has changed.
    const markdown =
      this.editor.mode === 'wysiwyg' && !this.doc.dirty
        ? this.doc.savedText
        : this.editor.getMarkdown();
    this.mode = this.mode === 'wysiwyg' ? 'source' : 'wysiwyg';
    await this.mountEditor(markdown);
  }

  // -------------------------------------------------------------------------
  // Document lifecycle

  private async load(file: platform.OpenedFile): Promise<void> {
    this.doc = { path: file.path, name: file.name, savedText: file.content, dirty: false };
    await this.mountEditor(file.content);
  }

  private async mountEditor(markdown: string): Promise<void> {
    const previous = this.editor;
    this.editor = null;
    await previous?.destroy();

    const editor = await createEditor(this.mode, {
      host: this.ui.host,
      markdown,
      onChange: () => this.refreshDirty(),
      resolveImage: (src) => platform.resolveImageSrc(src, this.doc.path),
      uploadImage: (file) => platform.storeImage(file, this.doc.path),
    });
    this.editor = editor;
    if (editor.mode === 'source') this.cleanSnapshot = this.doc.savedText;
    else this.cleanSnapshot = this.doc.dirty ? null : editor.getMarkdown();

    this.refreshDirty();
    this.updateUi();
    editor.focus();
  }

  /** Asks about unsaved changes. Resolves true if it's OK to continue. */
  private async confirmDiscardChanges(): Promise<boolean> {
    if (!this.doc.dirty) return true;
    const choice = await platform.askUnsavedChanges(this.doc.name);
    if (choice === 'save') return this.save(false);
    return choice === 'discard';
  }

  private refreshDirty(): void {
    if (!this.editor) return;
    const markdown = this.editor.getMarkdown();
    const dirty = this.cleanSnapshot === null || markdown !== this.cleanSnapshot;
    if (dirty !== this.doc.dirty) {
      this.doc.dirty = dirty;
      this.updateUi();
    }
    this.updateWordCount(markdown);
  }

  // -------------------------------------------------------------------------
  // UI

  private bindEvents(): void {
    for (const button of document.querySelectorAll<HTMLElement>('[data-command]')) {
      button.addEventListener('click', () => void this.run(button.dataset.command!));
    }

    // Capture phase, so our shortcuts win over the editor's own.
    document.addEventListener(
      'keydown',
      (event) => {
        if (isReloadKey(event)) {
          event.preventDefault();
          return;
        }
        const shortcut = shortcutFor(event);
        const command = shortcut && keymap[shortcut];
        if (command) {
          event.preventDefault();
          event.stopPropagation();
          void this.run(command);
        }
      },
      true,
    );

    // A file dropped outside the editor would make the webview open it in
    // place of the app. (Milkdown handles files dropped inside the editor.)
    for (const type of ['dragover', 'drop'] as const) {
      window.addEventListener(type, (event) => {
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
      });
    }

    platform.onCloseRequested(async () => {
      this.closing = await this.confirmDiscardChanges();
      return this.closing;
    });
    // Last line of defence against anything else that would leave the page
    // with unsaved changes, such as "Refresh" in the right-click menu.
    window.addEventListener('beforeunload', (event) => {
      if (this.doc.dirty && !this.closing) event.preventDefault();
    });
  }

  private updateUi(): void {
    const { name, dirty } = this.doc;
    this.ui.docName.textContent = name;
    this.ui.docName.title = this.doc.path ?? 'Not saved yet';
    this.ui.dirtyMark.hidden = !dirty;
    this.ui.sourceButton.classList.toggle('active', this.mode === 'source');
    this.ui.statusMode.textContent = this.mode === 'source' ? 'Source' : 'Live preview';
    void platform.setWindowTitle(`${dirty ? '● ' : ''}${name} - ${APP_NAME}`);
  }

  private updateWordCount(markdown: string): void {
    const { words, characters } = countText(markdown);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    this.ui.statusCount.textContent = `${plural(words, 'word')} · ${plural(characters, 'character')}`;
  }
}
