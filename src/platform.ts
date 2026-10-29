// Everything that touches the operating system lives here: reading and
// writing files, native dialogs, window title, images on disk.
//
// When the app runs inside Tauri (the desktop app) we use real files.
// When it runs in a plain browser (`npm run dev`), we fall back to a file
// picker and downloads so the editor can still be tried without Rust.

import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { dirname, resolve } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

export const inTauri = isTauri();

/** How a file is stored on disk, so it can be saved back the same way. */
export interface FileFormat {
  /** "UTF-8", "UTF-16LE", "UTF-16BE" or "GB18030". */
  encoding: string;
  /** A UTF-8 file that starts with a byte order mark. */
  bom: boolean;
}

export const DEFAULT_FORMAT: FileFormat = { encoding: 'UTF-8', bom: false };

export interface OpenedFile {
  /** Absolute path on disk. `null` in browser mode. */
  path: string | null;
  name: string;
  content: string;
  format: FileFormat;
  /** When the file last changed (ms), to notice changes by other programs. */
  modified: number;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
];

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export async function readFile(path: string): Promise<OpenedFile> {
  const file = await invoke<{ content: string; encoding: string; bom: boolean; modified: number }>('read_text_file', {
    path,
  });
  return {
    path,
    name: baseName(path),
    content: file.content,
    format: { encoding: file.encoding, bom: file.bom },
    modified: file.modified,
  };
}

/** When the file last changed (ms), or null if it no longer exists. */
export async function fileModified(path: string): Promise<number | null> {
  return inTauri ? invoke<number | null>('file_modified', { path }) : null;
}

/** Open another MdPad window. */
export async function newWindow(): Promise<void> {
  if (inTauri) await invoke('new_window');
  else window.open(location.href, '_blank');
}

/** Ask the user for a file and read it. Resolves `null` if cancelled. */
export async function pickAndReadFile(): Promise<OpenedFile | null> {
  if (inTauri) {
    const path = await open({ multiple: false, directory: false, filters: MARKDOWN_FILTERS });
    return typeof path === 'string' ? readFile(path) : null;
  }
  return browserPickFile();
}

/**
 * Write `content` to `path`. If `path` is null, ask where to save first.
 * Resolves the path that was written, or `null` if the user cancelled.
 */
export async function writeFile(
  path: string | null,
  suggestedName: string,
  content: string,
  format: FileFormat = DEFAULT_FORMAT,
): Promise<{ path: string | null; name: string; modified: number } | null> {
  if (!inTauri) {
    browserDownload(suggestedName, content);
    return { path: null, name: suggestedName, modified: 0 };
  }
  const target =
    path ?? (await save({ defaultPath: suggestedName, filters: MARKDOWN_FILTERS }));
  if (!target) return null;
  const modified = await invoke<number>('write_text_file', { path: target, contents: content, ...format });
  return { path: target, name: baseName(target), modified };
}

// ---------------------------------------------------------------------------
// Folders (the sidebar's file tree and Quick Open)

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** Folders and Markdown files in `path`, folders first. */
export async function listDir(path: string): Promise<DirEntry[]> {
  return inTauri ? invoke<DirEntry[]>('list_dir', { path }) : [];
}

/** Markdown files anywhere under `root`. */
export async function findMarkdownFiles(root: string, limit = 5000): Promise<string[]> {
  return inTauri ? invoke<string[]>('find_markdown_files', { root, limit }) : [];
}

export async function pickFolder(): Promise<string | null> {
  if (!inTauri) return null;
  const path = await open({ directory: true, multiple: false });
  return typeof path === 'string' ? path : null;
}

/** "C:\notes\a.md" → "C:\notes" */
export function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}

/** Whether `path` is inside `folder` (Windows paths: any case, \ or /). */
export function isInside(path: string, folder: string): boolean {
  const normal = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return normal(path).startsWith(normal(folder) + '\\');
}

/**
 * Ask where to save an exported file (next to `nearPath` by default) and
 * write it. Resolves the path, or null if cancelled.
 */
export async function exportFile(
  name: string,
  content: string,
  filter: { name: string; extensions: string[] },
  nearPath: string | null,
): Promise<string | null> {
  if (!inTauri) {
    browserDownload(name, content, 'text/html');
    return name;
  }
  const defaultPath = nearPath ? await resolve(await dirname(nearPath), name) : name;
  const target = await save({ defaultPath, filters: [filter] });
  if (!target) return null;
  await invoke('write_text_file', { path: target, contents: content });
  return target;
}

// ---------------------------------------------------------------------------
// Window, links, themes

export async function toggleFullscreen(): Promise<void> {
  if (inTauri) {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}

/** Zoom the whole window; 1 = 100%. */
export async function setZoom(factor: number): Promise<void> {
  if (inTauri) await getCurrentWebview().setZoom(factor);
  else document.documentElement.style.zoom = String(factor);
}

/** Open a web or mail link in the default app. */
export async function openExternal(url: string): Promise<void> {
  if (inTauri) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

export async function revealInExplorer(path: string): Promise<void> {
  if (inTauri) await revealItemInDir(path);
}

export async function themeFolder(): Promise<string | null> {
  return inTauri ? invoke<string>('theme_folder_path') : null;
}

export async function listThemes(): Promise<string[]> {
  return inTauri ? invoke<string[]>('list_themes') : [];
}

export async function readTheme(name: string): Promise<string> {
  return invoke<string>('read_theme', { name });
}

export async function openThemeFolder(): Promise<void> {
  const folder = await themeFolder();
  if (folder) await openPath(folder);
}

/** The file passed on the command line, e.g. via "Open with" in Explorer. */
export async function initialFilePath(): Promise<string | null> {
  return inTauri ? invoke<string | null>('initial_file') : null;
}

/** The file was changed by another program while it had unsaved edits here. */
export async function askReloadChangedFile(docName: string): Promise<boolean> {
  const question = `"${docName}" was changed by another program.\n\nReload it and lose your changes here?`;
  if (!inTauri) return confirm(question);
  return ask(question, { title: 'File changed', kind: 'warning', okLabel: 'Reload', cancelLabel: 'Keep Mine' });
}

export async function askUnsavedChanges(docName: string): Promise<UnsavedChoice> {
  const question = `Do you want to save the changes to "${docName}"?`;
  if (!inTauri) {
    // window.confirm has only two buttons: OK = discard, Cancel = keep editing.
    return confirm(`${question}\n\nOK discards your changes.`) ? 'discard' : 'cancel';
  }
  const result = await message(question, {
    title: 'Unsaved changes',
    kind: 'warning',
    buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
  });
  if (result === 'Save' || result === 'Yes') return 'save';
  if (result === "Don't Save" || result === 'No') return 'discard';
  return 'cancel';
}

export async function showMessage(text: string, title: string): Promise<void> {
  if (inTauri) await message(text, { title, kind: 'info' });
  else alert(text);
}

export async function showError(text: string): Promise<void> {
  if (inTauri) await message(text, { title: 'Error', kind: 'error' });
  else alert(text);
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (inTauri) await getCurrentWindow().setTitle(title);
}

/**
 * Run `handler` when the user tries to close the window. If it resolves
 * `false`, the window stays open.
 */
export function onCloseRequested(handler: () => Promise<boolean>): void {
  if (inTauri) {
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await handler())) event.preventDefault();
    });
  }
}

/** Ask to close the window (the unsaved-changes check still runs). */
export async function closeWindow(): Promise<void> {
  if (inTauri) await getCurrentWindow().close();
  else window.close();
}

/** Through Tauri: the webview's own clipboard API asks for permission. */
export async function readClipboardText(): Promise<string> {
  try {
    return inTauri ? await readText() : await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Images

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];

/**
 * Ask for an image file to insert. For a saved document it is copied to the
 * `assets` folder, like a pasted image. Resolves the `src` for the Markdown.
 */
export async function pickImage(docPath: string | null): Promise<{ src: string; alt: string } | null> {
  if (!inTauri) {
    const file = await browserPickImage();
    return file ? { src: await fileToDataUrl(file), alt: file.name.replace(/\.[^.]+$/, '') } : null;
  }
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] });
  if (typeof path !== 'string') return null;
  const alt = baseName(path).replace(/\.[^.]+$/, '');
  if (docPath) return { src: await invoke<string>('import_image', { docPath, source: path }), alt };
  return { src: encodeURI(path.replace(/\\/g, '/')), alt };
}

const EXTERNAL_URL = /^(https?:|data:|blob:|asset:|file:)/i;

/**
 * Turn an image `src` from the Markdown into something the webview can
 * display. Relative paths are resolved against the document's folder.
 */
export async function resolveImageSrc(src: string, docPath: string | null): Promise<string> {
  if (!inTauri || !src || EXTERNAL_URL.test(src) || src.startsWith('//')) return src;
  let filePath = safeDecodeURI(src);
  const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(filePath);
  if (!isAbsolute) {
    if (!docPath) return src;
    filePath = await resolve(await dirname(docPath), filePath);
  }
  return convertFileSrc(filePath);
}

/**
 * Store a pasted/uploaded image. For a saved document the image is copied
 * to an `assets` folder next to it and a relative path is returned, like
 * Typora does. For an unsaved document the image is embedded as a data URL.
 */
export async function storeImage(file: File, docPath: string | null): Promise<string> {
  if (!inTauri || !docPath) return fileToDataUrl(file);
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return invoke<string>('save_image', { docPath, fileName: file.name || 'image.png', bytes });
}

function safeDecodeURI(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Browser fallbacks

function browserPickFile(): Promise<OpenedFile | null> {
  return new Promise((resolvePromise) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolvePromise(
        file ? { path: null, name: file.name, content: await file.text(), format: DEFAULT_FORMAT, modified: 0 } : null,
      );
    };
    input.oncancel = () => resolvePromise(null);
    input.click();
  });
}

function browserPickImage(): Promise<File | null> {
  return new Promise((resolvePromise) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolvePromise(input.files?.[0] ?? null);
    input.oncancel = () => resolvePromise(null);
    input.click();
  });
}

function browserDownload(name: string, content: string, type = 'text/markdown'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
