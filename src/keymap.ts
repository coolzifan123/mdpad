// Keyboard shortcuts → command names (see `commands` in app.ts).
// "Mod" means Ctrl on Windows/Linux and Cmd on macOS. The menu bar shows
// these shortcuts next to its items, so this is the only place to edit them.

export const keymap: Record<string, string> = {
  // File
  'Mod+N': 'new',
  'Mod+O': 'open',
  'Mod+P': 'quick-open',
  'Mod+S': 'save',
  'Mod+Shift+S': 'save-as',
  'Mod+W': 'close',
  // Edit
  'Mod+Z': 'undo',
  'Mod+Y': 'redo',
  'Mod+Shift+Z': 'redo',
  'Mod+F': 'find',
  'Mod+H': 'replace',
  'F3': 'find-next',
  'Shift+F3': 'find-previous',
  'Mod+Shift+V': 'paste-plain',
  // Paragraph
  'Mod+1': 'heading-1',
  'Mod+2': 'heading-2',
  'Mod+3': 'heading-3',
  'Mod+4': 'heading-4',
  'Mod+5': 'heading-5',
  'Mod+6': 'heading-6',
  'Mod+0': 'paragraph',
  'Mod+T': 'table',
  'Mod+Shift+K': 'code-block',
  'Mod+Shift+M': 'math-block',
  'Mod+Shift+Q': 'quote',
  'Mod+Shift+[': 'ordered-list',
  'Mod+Shift+]': 'bullet-list',
  'Mod+Shift+X': 'task-list',
  // Format
  'Mod+B': 'bold',
  'Mod+I': 'italic',
  'Mod+Shift+`': 'inline-code',
  'Alt+Shift+5': 'strikethrough',
  'Mod+K': 'link',
  'Mod+Shift+I': 'image',
  'Mod+\\': 'clear-format',
  // View
  'Mod+/': 'toggle-source',
  'Mod+Shift+L': 'toggle-sidebar',
  'Mod+Shift+1': 'show-outline',
  'Mod+Shift+3': 'show-files',
};

/**
 * Commands that act on the document's text. Inside a code block or a text
 * field (the find bar), their keys are left alone: Ctrl+1 in a code block
 * must not turn the code block into a heading.
 */
export const textCommands = new Set([
  'undo',
  'redo',
  'paste-plain',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
  'paragraph',
  'table',
  'code-block',
  'math-block',
  'quote',
  'ordered-list',
  'bullet-list',
  'task-list',
  'bold',
  'italic',
  'inline-code',
  'strikethrough',
  'link',
  'image',
  'clear-format',
]);

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** F5 / Ctrl+R would reload the webview and lose unsaved changes. */
export function isReloadKey(event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  return event.key === 'F5' || (mod && event.key.toLowerCase() === 'r');
}

/** Convert a KeyboardEvent to the same format as the keys above. */
export function shortcutFor(event: KeyboardEvent): string | null {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const key = keyName(event);
  if (!key || (!mod && !event.altKey && !/^F\d+$/.test(key))) return null;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * The key itself, ignoring Shift and the keyboard layout's symbols
 * (Shift+[ gives "{" on a US keyboard), so shortcuts match by key position.
 */
function keyName(event: KeyboardEvent): string | null {
  const { code } = event;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const symbols: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    Slash: '/',
    Backslash: '\\',
    Equal: '=',
    Minus: '-',
  };
  if (symbols[code]) return symbols[code];
  if (/^F\d+$/.test(event.key)) return event.key;
  return null;
}

/** "Mod+Shift+K" → "Ctrl+Shift+K", for showing in menus. */
export function displayShortcut(command: string): string {
  const shortcut = Object.keys(keymap).find((key) => keymap[key] === command);
  return shortcut ? shortcut.replace('Mod', isMac ? 'Cmd' : 'Ctrl') : '';
}
