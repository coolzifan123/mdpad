// Everything that touches the operating system lives here: reading and
// writing files, native dialogs, window title, images on disk.
//
// When the app runs inside Tauri (the desktop app) we use real files.
// When it runs in a plain browser (`npm run dev`), we fall back to a file
// picker and downloads so the editor can still be tried without Rust.

import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { dirname, resolve } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { message, open, save } from '@tauri-apps/plugin-dialog';

export const inTauri = isTauri();

export interface OpenedFile {
  /** Absolute path on disk. `null` in browser mode. */
  path: string | null;
  name: string;
  content: string;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
];

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export async function readFile(path: string): Promise<OpenedFile> {
  const content = await invoke<string>('read_text_file', { path });
  return { path, name: baseName(path), content };
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
): Promise<{ path: string | null; name: string } | null> {
  if (!inTauri) {
    browserDownload(suggestedName, content);
    return { path: null, name: suggestedName };
  }
  const target =
    path ?? (await save({ defaultPath: suggestedName, filters: MARKDOWN_FILTERS }));
  if (!target) return null;
  await invoke('write_text_file', { path: target, contents: content });
  return { path: target, name: baseName(target) };
}

/** The file passed on the command line, e.g. via "Open with" in Explorer. */
export async function initialFilePath(): Promise<string | null> {
  return inTauri ? invoke<string | null>('initial_file') : null;
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
      resolvePromise(file ? { path: null, name: file.name, content: await file.text() } : null);
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

function browserDownload(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
