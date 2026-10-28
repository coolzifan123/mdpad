// Keyboard shortcuts → command names (see `commands` in app.ts).
// "Mod" means Ctrl on Windows/Linux and Cmd on macOS.

export const keymap: Record<string, string> = {
  'Mod+N': 'new',
  'Mod+O': 'open',
  'Mod+S': 'save',
  'Mod+Shift+S': 'save-as',
  'Mod+/': 'toggle-source',
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** F5 / Ctrl+R would reload the webview and lose unsaved changes. */
export function isReloadKey(event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  return event.key === 'F5' || (mod && event.key.toLowerCase() === 'r');
}

/** Convert a KeyboardEvent to the same format as the keys above. */
export function shortcutFor(event: KeyboardEvent): string | null {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod) return null;
  const parts = ['Mod'];
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  // Shift changes event.key on some layouts ("/" -> "?"), so use event.code for those.
  parts.push(event.code === 'Slash' ? '/' : key);
  return parts.join('+');
}
