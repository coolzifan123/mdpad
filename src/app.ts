// The application: one open document, the active editor, and the commands
// that the menus and keyboard shortcuts run.

import { askText } from './dialog';
import { createEditor, type EditorMode, type MarkdownEditor } from './editor';
import { FindBar, type FindBarElements } from './find-bar';
import { isReloadKey, keymap, shortcutFor, textCommands } from './keymap';
import { detectLineEnding, toLf, withLineEnding, type LineEnding } from './markdown-style';
import { MenuBar } from './menu';
import { buildMenus } from './menus';
import * as platform from './platform';
import { addRecentFile, clearRecentFiles, recentFiles, removeRecentFile } from './recent';
import { toggleTheme } from './theme';
import { countText } from './wordcount';

const APP_NAME = 'MdPad';
const UNTITLED = 'Untitled.md';
const AUTO_SAVE_KEY = 'mdpad-autosave';
/** Auto save waits this long after the last change. */
const AUTO_SAVE_DELAY = 1500;

interface DocumentState {
  /** Absolute path, or null for a document that was never saved. */
  path: string | null;
  name: string;
  /** Exact text last read from or written to disk. */
  savedText: string;
  /** The editor always uses "\n"; files are saved with their own line endings. */
  lineEnding: LineEnding;
  dirty: boolean;
}

export interface AppElements {
  host: HTMLElement;
  menuBar: HTMLElement;
  docName: HTMLElement;
  dirtyMark: HTMLElement;
  statusMode: HTMLElement;
  statusCount: HTMLElement;
  findBar: FindBarElements;
}

export class App {
  private doc: DocumentState = {
    path: null,
    name: UNTITLED,
    savedText: '',
    lineEnding: detectLineEnding(''),
    dirty: false,
  };
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
  private autoSave = loadFlag(AUTO_SAVE_KEY);
  private autoSaveTimer: number | undefined;
  private readonly findBar: FindBar;

  /** Add new commands here, then bind them in keymap.ts or menus.ts. */
  private readonly commands: Record<string, () => unknown> = {
    new: () => this.newDocument(),
    open: () => this.openDocument(),
    save: () => this.save(false),
    'save-as': () => this.save(true),
    close: () => platform.closeWindow(),
    'toggle-autosave': () => this.toggleAutoSave(),
    'toggle-source': () => this.toggleSource(),
    'toggle-theme': () => toggleTheme(),
    find: () => this.findBar.open(false),
    replace: () => this.findBar.open(true),
    'find-next': () => this.findBar.step(1),
    'find-previous': () => this.findBar.step(-1),
    cut: () => document.execCommand('cut'),
    copy: () => document.execCommand('copy'),
    paste: () => this.paste(false),
    'paste-plain': () => this.paste(true),
    'select-all': () => this.editor?.run('select-all'),
    undo: () => this.editor?.run('undo'),
    redo: () => this.editor?.run('redo'),
    hr: () => this.editor?.run('hr'),
    link: () => this.insertLink(),
    image: () => this.insertImage(),
    about: () => platform.showMessage(`${APP_NAME} ${__APP_VERSION__}\n\nA free, open-source Markdown editor.`, `About ${APP_NAME}`),
  };

  constructor(private readonly ui: AppElements) {
    // Formatting commands go straight to the editor.
    for (const command of textCommands) this.commands[command] ??= () => this.editor?.run(command);

    this.findBar = new FindBar(
      ui.findBar,
      () => this.editor?.searcher ?? null,
      () => this.editor?.focus(),
    );
    new MenuBar(
      ui.menuBar,
      buildMenus(() => ({
        recentFiles: recentFiles(),
        autoSave: this.autoSave,
        sourceMode: this.mode === 'source',
        darkTheme: document.documentElement.dataset.theme === 'dark',
        openRecent: (path) => void this.run(() => this.openPath(path)),
        clearRecent: clearRecentFiles,
      })),
      (command) => void this.run(command),
    );
  }

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

  /** Run a command by name (or a function), one at a time. */
  async run(command: string | (() => unknown)): Promise<void> {
    const action = typeof command === 'string' ? this.commands[command] : command;
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

  private async openPath(path: string): Promise<void> {
    if (!(await this.confirmDiscardChanges())) return;
    try {
      await this.load(await platform.readFile(path));
    } catch (error) {
      removeRecentFile(path);
      await platform.showError(`Could not open ${path}\n\n${error}`);
    }
  }

  /** Resolves true if the document was saved. */
  private async save(saveAs: boolean): Promise<boolean> {
    if (!this.editor) return false;
    // The editor reports changes a moment late; don't miss the latest ones.
    this.refreshDirty();
    // Nothing changed: don't rewrite the file.
    if (!saveAs && this.doc.path && !this.doc.dirty) return true;

    const markdown = this.doc.dirty ? this.editor.getMarkdown() : null;
    const { lineEnding } = this.doc;
    const text = markdown === null ? this.doc.savedText : withLineEnding(markdown, lineEnding);
    const written = await platform.writeFile(saveAs ? null : this.doc.path, this.doc.name, text);
    if (!written) return false;

    if (markdown !== null) this.cleanSnapshot = markdown;
    this.doc = { path: written.path, name: written.name, savedText: text, lineEnding, dirty: false };
    if (written.path) addRecentFile(written.path);
    this.updateUi();
    return true;
  }

  private toggleAutoSave(): void {
    this.autoSave = !this.autoSave;
    saveFlag(AUTO_SAVE_KEY, this.autoSave);
    this.scheduleAutoSave();
  }

  /** Saves a little after the last change, if Auto Save is on. */
  private scheduleAutoSave(): void {
    window.clearTimeout(this.autoSaveTimer);
    if (!this.autoSave || !this.doc.path || !this.doc.dirty) return;
    this.autoSaveTimer = window.setTimeout(() => {
      if (this.busy) this.scheduleAutoSave();
      else void this.run(() => this.save(false));
    }, AUTO_SAVE_DELAY);
  }

  private async toggleSource(): Promise<void> {
    if (!this.editor) return;
    // Source mode shows the exact file content when nothing has changed.
    const markdown =
      this.editor.mode === 'wysiwyg' && !this.doc.dirty
        ? toLf(this.doc.savedText)
        : this.editor.getMarkdown();
    this.mode = this.mode === 'wysiwyg' ? 'source' : 'wysiwyg';
    await this.mountEditor(markdown);
  }

  private async paste(plain: boolean): Promise<void> {
    const text = await platform.readClipboardText();
    if (!text) {
      await platform.showError(`Could not read the clipboard. Use ${plain ? 'Ctrl+Shift+V' : 'Ctrl+V'} instead.`);
      return;
    }
    this.editor?.run(plain ? 'paste-plain' : 'paste', text);
  }

  private async insertLink(): Promise<void> {
    const href = await askText('Link address', { placeholder: 'https://' });
    this.editor?.focus();
    if (href) this.editor?.run('link', href);
  }

  private async insertImage(): Promise<void> {
    const image = await platform.pickImage(this.doc.path);
    this.editor?.focus();
    if (image) this.editor?.run('image', image);
  }

  // -------------------------------------------------------------------------
  // Document lifecycle

  private async load(file: platform.OpenedFile): Promise<void> {
    this.doc = {
      path: file.path,
      name: file.name,
      savedText: file.content,
      lineEnding: detectLineEnding(file.content),
      dirty: false,
    };
    if (file.path) addRecentFile(file.path);
    await this.mountEditor(toLf(file.content));
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
    if (editor.mode === 'source') this.cleanSnapshot = toLf(this.doc.savedText);
    else this.cleanSnapshot = this.doc.dirty ? null : editor.getMarkdown();

    this.refreshDirty();
    this.updateUi();
    if (this.findBar.isOpen) this.findBar.refresh();
    else editor.focus();
  }

  /** Asks about unsaved changes. Resolves true if it's OK to continue. */
  private async confirmDiscardChanges(): Promise<boolean> {
    this.refreshDirty();
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
    this.scheduleAutoSave();
  }

  // -------------------------------------------------------------------------
  // UI

  private bindEvents(): void {
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
        if (!command) return;
        // In a code block or a text field, leave text editing keys alone.
        const target = event.target as HTMLElement | null;
        if (textCommands.has(command) && (target?.closest('.cm-editor') || target?.tagName === 'INPUT')) return;
        event.preventDefault();
        event.stopPropagation();
        void this.run(command);
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
      if (this.closing) return;
      this.refreshDirty();
      if (this.doc.dirty) event.preventDefault();
    });
  }

  private updateUi(): void {
    const { name, dirty } = this.doc;
    this.ui.docName.textContent = name;
    this.ui.docName.title = this.doc.path ?? 'Not saved yet';
    this.ui.dirtyMark.hidden = !dirty;
    this.ui.statusMode.textContent = this.mode === 'source' ? 'Source' : 'Live preview';
    void platform.setWindowTitle(`${dirty ? '● ' : ''}${name} - ${APP_NAME}`);
  }

  private updateWordCount(markdown: string): void {
    const { words, characters } = countText(markdown);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    this.ui.statusCount.textContent = `${plural(words, 'word')} · ${plural(characters, 'character')}`;
  }
}

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not critical.
  }
}
