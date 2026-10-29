// The application: one open document, the active editor, and the commands
// that the menus and keyboard shortcuts run.

import { askText } from './dialog';
import { createEditor, type EditorMode, type MarkdownEditor } from './editor';
import { FileTree } from './file-tree';
import { FindBar, type FindBarElements } from './find-bar';
import { isReloadKey, keymap, shortcutFor, textCommands } from './keymap';
import { detectLineEnding, toLf, withLineEnding, type LineEnding } from './markdown-style';
import { MenuBar } from './menu';
import { buildMenus } from './menus';
import { Outline } from './outline';
import * as platform from './platform';
import { quickOpen } from './quick-open';
import { addRecentFile, clearRecentFiles, recentFiles, removeRecentFile } from './recent';
import { Sidebar, type SidebarElements, type SidebarTab } from './sidebar';
import { applyCustomTheme, EXAMPLE_THEME, savedCustomTheme, toggleTheme } from './theme';
import { writingModes } from './writing-modes';
import { countText } from './wordcount';

const APP_NAME = 'MdPad';
const UNTITLED = 'Untitled.md';
const AUTO_SAVE_KEY = 'mdpad-autosave';
/** The folder chosen with File > Open Folder. */
const FOLDER_KEY = 'mdpad-folder';
const VIEW_KEY = 'mdpad-view';

interface ViewSettings {
  focus: boolean;
  typewriter: boolean;
  /** Show "**", "##"… around the formatting at the cursor. */
  symbols: boolean;
  /** 1 = 100% */
  zoom: number;
}
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
  /** Saved back in the file's own encoding (UTF-8, GB18030, …). */
  format: platform.FileFormat;
  /** When the file last changed on disk as far as we know (ms). */
  modified: number;
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
  sidebar: SidebarElements;
}

export class App {
  private doc: DocumentState = {
    path: null,
    name: UNTITLED,
    savedText: '',
    lineEnding: detectLineEnding(''),
    format: platform.DEFAULT_FORMAT,
    modified: 0,
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
  private readonly sidebar: Sidebar;
  private readonly outline: Outline;
  private readonly fileTree: FileTree;
  /** When a heading in the outline was last clicked. */
  private outlineJumpTime = 0;
  /** Focus mode, typewriter mode and zoom; remembered between runs. */
  private view: ViewSettings = loadView();
  /** The .css files in the theme folder (View > Theme). */
  private themes: string[] = [];

  /** Add new commands here, then bind them in keymap.ts or menus.ts. */
  private readonly commands: Record<string, () => unknown> = {
    new: () => this.newDocument(),
    'new-window': () => platform.newWindow(),
    open: () => this.openDocument(),
    save: () => this.save(false),
    'save-as': () => this.save(true),
    close: () => platform.closeWindow(),
    'toggle-autosave': () => this.toggleAutoSave(),
    'toggle-source': () => this.toggleSource(),
    'toggle-theme': () => toggleTheme(),
    'toggle-focus': () => this.setView({ focus: !this.view.focus }),
    'toggle-typewriter': () => this.setView({ typewriter: !this.view.typewriter }),
    'toggle-symbols': () => this.setView({ symbols: !this.view.symbols }),
    'toggle-fullscreen': () => platform.toggleFullscreen(),
    'zoom-in': () => this.setView({ zoom: Math.min(3, round(this.view.zoom + 0.1)) }),
    'zoom-out': () => this.setView({ zoom: Math.max(0.5, round(this.view.zoom - 0.1)) }),
    'zoom-reset': () => this.setView({ zoom: 1 }),
    'open-theme-folder': () => platform.openThemeFolder(),
    'reveal-file': () => this.doc.path && platform.revealInExplorer(this.doc.path),
    'toggle-sidebar': () => this.sidebar.toggle(),
    'show-outline': () => this.sidebar.toggleTab('outline'),
    'show-files': () => this.sidebar.toggleTab('files'),
    'open-folder': () => this.openFolder(),
    'quick-open': () => this.quickOpen(),
    'export-html': () => this.exportHtml(),
    print: () => this.print(),
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
    this.outline = new Outline(ui.sidebar.panels.outline, (index) => {
      // Keep the clicked heading highlighted, even near the end of the
      // document where it can't scroll to the top.
      this.outlineJumpTime = Date.now();
      this.editor?.revealHeading(index);
      this.outline.setCurrent(index);
    });
    this.fileTree = new FileTree(
      ui.sidebar.panels.files,
      (path) => void this.run(() => this.openPath(path)),
      () => void this.run(() => this.openFolder()),
    );
    this.sidebar = new Sidebar(ui.sidebar, (tab) => this.fillSidebar(tab));
    new MenuBar(
      ui.menuBar,
      buildMenus(() => ({
        recentFiles: recentFiles(),
        autoSave: this.autoSave,
        sourceMode: this.mode === 'source',
        darkTheme: document.documentElement.dataset.theme === 'dark',
        sidebar: this.sidebar.visible ? this.sidebar.activeTab : null,
        focusMode: this.view.focus,
        typewriter: this.view.typewriter,
        symbols: this.view.symbols,
        themes: this.themes,
        customTheme: savedCustomTheme(),
        setCustomTheme: (name) => void this.run(() => applyCustomTheme(name, platform.readTheme)),
        hasPath: this.doc.path !== null,
        openRecent: (path) => void this.run(() => this.openPath(path)),
        clearRecent: clearRecentFiles,
      })),
      (command) => void this.run(command),
    );
  }

  async start(): Promise<void> {
    this.bindEvents();
    this.setView({});
    await this.loadThemes();
    const initialPath = await platform.initialFilePath();
    if (initialPath) {
      try {
        await this.load(await platform.readFile(initialPath));
        return;
      } catch (error) {
        await platform.showError(`Could not open ${initialPath}\n\n${error}`);
      }
    }
    await this.load(blankDocument());
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
    await this.load(blankDocument());
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
    const { lineEnding, format } = this.doc;
    const text = markdown === null ? this.doc.savedText : withLineEnding(markdown, lineEnding);
    const written = await platform.writeFile(saveAs ? null : this.doc.path, this.doc.name, text, format);
    if (!written) return false;

    if (markdown !== null) this.cleanSnapshot = markdown;
    this.doc = {
      path: written.path,
      name: written.name,
      savedText: text,
      lineEnding,
      format,
      modified: written.modified,
      dirty: false,
    };
    if (written.path) {
      addRecentFile(written.path);
      // A new file may need to appear in the file tree.
      if (saveAs) await this.fileTree.render();
      this.fileTree.setCurrent(written.path);
    }
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

  private async openFolder(): Promise<void> {
    const folder = await platform.pickFolder();
    if (!folder) return;
    saveText(FOLDER_KEY, folder);
    await this.fileTree.setRoot(folder);
    this.sidebar.show('files');
  }

  private async quickOpen(): Promise<void> {
    const folder = this.fileTree.folder;
    const candidates = (async () => ({
      recent: recentFiles(),
      folder,
      files: folder ? await platform.findMarkdownFiles(folder) : [],
    }))();
    const path = await quickOpen(candidates);
    if (path) await this.openPath(path);
    else this.editor?.focus();
  }

  /**
   * Another program changed the open file: reload it, or ask first when
   * there are unsaved changes here. Checked when the window gets focus.
   */
  private async checkOutsideChange(): Promise<void> {
    const { path, modified } = this.doc;
    if (!path || !modified) return;
    const now = await platform.fileModified(path);
    if (now === null || now === modified) return;
    this.refreshDirty();
    if (!this.doc.dirty || (await platform.askReloadChangedFile(this.doc.name))) {
      await this.load(await platform.readFile(path));
    } else {
      // Keep this version; don't ask again for the same change.
      this.doc.modified = now;
    }
  }

  /** Change and remember view settings, and show them. */
  private setView(change: Partial<ViewSettings>): void {
    this.view = { ...this.view, ...change };
    saveText(VIEW_KEY, JSON.stringify(this.view));
    document.body.classList.toggle('focus-mode', this.view.focus);
    document.body.classList.toggle('typewriter', this.view.typewriter);
    document.body.classList.toggle('hide-symbols', !this.view.symbols);
    writingModes.typewriter = this.view.typewriter;
    if (change.typewriter) this.editor?.run('center-cursor');
    if (change.zoom !== undefined || Object.keys(change).length === 0) void platform.setZoom(this.view.zoom);
  }

  /** Read the theme folder; put an example theme in it the first time. */
  private async loadThemes(): Promise<void> {
    try {
      this.themes = await platform.listThemes();
      if (!this.themes.length) {
        const folder = await platform.themeFolder();
        if (folder) {
          await platform.writeFile(`${folder}\\Sepia.css`, 'Sepia.css', EXAMPLE_THEME);
          this.themes = await platform.listThemes();
        }
      }
      const saved = savedCustomTheme();
      if (saved && this.themes.includes(saved)) await applyCustomTheme(saved, platform.readTheme);
    } catch (error) {
      console.warn('Could not load themes:', error);
    }
  }

  /** Ctrl+click on a link: web links in the browser, Markdown files here. */
  private async openLink(href: string): Promise<void> {
    if (/^(https?:|mailto:)/i.test(href)) {
      await platform.openExternal(href);
    } else if (href.startsWith('#')) {
      const slug = (text: string) => text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
      const target = decodeURIComponent(href.slice(1));
      const index = this.editor?.headings().findIndex((h) => slug(h.text) === slug(target)) ?? -1;
      if (index >= 0) this.editor?.revealHeading(index);
    } else if (/\.(md|markdown|mdown|mkd|txt)$/i.test(href.split('#')[0]) && this.doc.path) {
      const file = decodeURIComponent(href.split('#')[0]);
      const path = /^([a-zA-Z]:[\\/]|[\\/])/.test(file) ? file : `${platform.folderOf(this.doc.path)}\\${file.replace(/\//g, '\\')}`;
      await this.openPath(path);
    }
  }

  /** The document as a stand-alone HTML page. */
  private async htmlPage(forPrinting: boolean): Promise<string> {
    const { toHtmlPage } = await import('./export');
    return toHtmlPage(this.editor?.getMarkdown() ?? '', {
      title: this.doc.name.replace(/\.[^.]+$/, ''),
      // A printed page loads images through the app; an exported file keeps
      // the addresses from the Markdown, which work next to the document.
      resolveImage: forPrinting ? (src) => platform.resolveImageSrc(src, this.doc.path) : undefined,
    });
  }

  private async exportHtml(): Promise<void> {
    const html = await this.htmlPage(false);
    const name = this.doc.name.replace(/\.[^.]+$/, '') + '.html';
    await platform.exportFile(name, html, { name: 'HTML', extensions: ['html', 'htm'] }, this.doc.path);
    this.editor?.focus();
  }

  /** Prints the exported page, not the editor. "Save as PDF" is a printer. */
  private async print(): Promise<void> {
    const frame = document.createElement('iframe');
    frame.className = 'print-frame';
    // The document's own HTML must not run scripts inside the app.
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.srcdoc = await this.htmlPage(true);
    const loaded = new Promise((resolveLoad) => (frame.onload = resolveLoad));
    document.body.append(frame);
    await loaded;
    const page = frame.contentWindow!;
    const images = [...page.document.images].filter((img) => !img.complete);
    await Promise.all(images.map((img) => new Promise((done) => (img.onload = img.onerror = done))));
    page.addEventListener('afterprint', () => frame.remove());
    page.focus();
    page.print();
  }

  /** Fill the sidebar panel that is about to show. */
  private fillSidebar(tab: SidebarTab): void {
    if (tab === 'outline') this.updateOutline();
    else void this.fileTree.render();
  }

  private updateOutline(): void {
    if (!this.editor || !this.sidebar.visible || this.sidebar.activeTab !== 'outline') return;
    this.outline.render(this.editor.headings());
    this.outline.setCurrent(this.editor.currentHeading(this.ui.host));
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
      format: file.format,
      modified: file.modified,
      dirty: false,
    };
    if (file.path) addRecentFile(file.path);
    await this.mountEditor(toLf(file.content));
    // The file tree shows the chosen folder, or else the file's own folder
    // (but stays put for a file inside the folder it already shows).
    const shown = this.fileTree.folder;
    const keep = !file.path || (shown !== null && platform.isInside(file.path, shown));
    await this.fileTree.setRoot(loadText(FOLDER_KEY) ?? (keep ? shown : platform.folderOf(file.path!)));
    this.fileTree.setCurrent(file.path);
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
      openLink: (href) => void this.run(() => this.openLink(href)),
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
    this.updateOutline();
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

    // Highlight the heading being read. Capture: the source textarea scrolls
    // itself, and scroll events don't bubble.
    let scrollQueued = false;
    this.ui.host.addEventListener(
      'scroll',
      () => {
        if (scrollQueued) return;
        scrollQueued = true;
        setTimeout(() => {
          scrollQueued = false;
          // Skip the scroll caused by clicking a heading in the outline.
          if (Date.now() - this.outlineJumpTime < 300) return;
          if (this.editor && this.sidebar.visible) this.outline.setCurrent(this.editor.currentHeading(this.ui.host));
        }, 50);
      },
      true,
    );

    window.addEventListener('focus', () => {
      if (!this.busy) void this.run(() => this.checkOutsideChange());
    });

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
    // Show the encoding only when it's not plain UTF-8.
    const { encoding, bom } = this.doc.format;
    const format = encoding !== 'UTF-8' ? encoding : bom ? 'UTF-8 with BOM' : '';
    this.ui.statusMode.textContent = [this.mode === 'source' ? 'Source' : 'Live preview', format].filter(Boolean).join(' · ');
    void platform.setWindowTitle(`${dirty ? '● ' : ''}${name} - ${APP_NAME}`);
  }

  private updateWordCount(markdown: string): void {
    const { words, characters } = countText(markdown);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    this.ui.statusCount.textContent = `${plural(words, 'word')} · ${plural(characters, 'character')}`;
  }
}

function loadText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not critical.
  }
}

function blankDocument(): platform.OpenedFile {
  return { path: null, name: UNTITLED, content: '', format: platform.DEFAULT_FORMAT, modified: 0 };
}

function loadView(): ViewSettings {
  const defaults: ViewSettings = { focus: false, typewriter: false, symbols: true, zoom: 1 };
  try {
    return { ...defaults, ...JSON.parse(loadText(VIEW_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

/** 1.2000000002 → 1.2 */
const round = (n: number) => Math.round(n * 10) / 10;

const loadFlag = (key: string) => loadText(key) === 'true';
const saveFlag = (key: string, value: boolean) => saveText(key, String(value));
