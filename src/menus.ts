// What's in the menu bar. Items name commands from app.ts; the shortcuts
// shown next to them come from keymap.ts.

import type { Menu, MenuEntry } from './menu';

/** The app state the menus show. */
export interface MenuState {
  recentFiles: string[];
  autoSave: boolean;
  sourceMode: boolean;
  darkTheme: boolean;
  /** The sidebar panel showing, or null when the sidebar is closed. */
  sidebar: 'files' | 'outline' | null;
  focusMode: boolean;
  typewriter: boolean;
  symbols: boolean;
  /** Custom theme files, and the one in use. */
  themes: string[];
  customTheme: string | null;
  setCustomTheme(name: string | null): void;
  /** Whether the document has been saved to a file. */
  hasPath: boolean;
  openRecent(path: string): void;
  clearRecent(): void;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? 'Cmd' : 'Ctrl';

export function buildMenus(state: () => MenuState): Menu[] {
  return [
    {
      label: 'File',
      items: () => {
        const { recentFiles, autoSave, openRecent, clearRecent, hasPath } = state();
        const recent: MenuEntry[] = recentFiles.length
          ? [
              ...recentFiles.map((path) => ({ label: path, action: () => openRecent(path) })),
              'separator',
              { label: 'Clear Recent Files', action: clearRecent },
            ]
          : [{ label: 'No recent files', disabled: true }];
        return [
          { label: 'New', command: 'new' },
          { label: 'Open…', command: 'open' },
          { label: 'Open Folder…', command: 'open-folder' },
          { label: 'Quick Open…', command: 'quick-open' },
          { label: 'Open Recent', items: recent },
          'separator',
          { label: 'Save', command: 'save' },
          { label: 'Save As…', command: 'save-as' },
          { label: 'Auto Save', command: 'toggle-autosave', checked: autoSave },
          'separator',
          {
            label: 'Export',
            items: [
              { label: 'HTML…', command: 'export-html' },
              // The print dialog's "Save as PDF" printer makes the PDF.
              { label: 'PDF…', command: 'print' },
            ],
          },
          { label: 'Print…', command: 'print' },
          'separator',
          { label: 'Reveal in File Explorer', command: 'reveal-file', disabled: !hasPath },
          { label: 'Close', command: 'close' },
        ];
      },
    },
    {
      label: 'Edit',
      items: () => [
        { label: 'Undo', command: 'undo' },
        { label: 'Redo', command: 'redo' },
        'separator',
        { label: 'Cut', command: 'cut', shortcut: `${mod}+X` },
        { label: 'Copy', command: 'copy', shortcut: `${mod}+C` },
        { label: 'Paste', command: 'paste', shortcut: `${mod}+V` },
        { label: 'Paste as Plain Text', command: 'paste-plain' },
        { label: 'Select All', command: 'select-all', shortcut: `${mod}+A` },
        'separator',
        { label: 'Find…', command: 'find' },
        { label: 'Replace…', command: 'replace' },
        { label: 'Find Next', command: 'find-next' },
        { label: 'Find Previous', command: 'find-previous' },
      ],
    },
    {
      label: 'Paragraph',
      items: () => [
        { label: 'Heading 1', command: 'heading-1' },
        { label: 'Heading 2', command: 'heading-2' },
        { label: 'Heading 3', command: 'heading-3' },
        { label: 'Heading 4', command: 'heading-4' },
        { label: 'Heading 5', command: 'heading-5' },
        { label: 'Heading 6', command: 'heading-6' },
        { label: 'Paragraph', command: 'paragraph' },
        { label: 'Increase Heading Level', command: 'heading-up' },
        { label: 'Decrease Heading Level', command: 'heading-down' },
        'separator',
        { label: 'Table', command: 'table' },
        { label: 'Code Block', command: 'code-block' },
        { label: 'Math Block', command: 'math-block' },
        { label: 'Quote', command: 'quote' },
        'separator',
        { label: 'Ordered List', command: 'ordered-list' },
        { label: 'Bullet List', command: 'bullet-list' },
        { label: 'Task List', command: 'task-list' },
        'separator',
        { label: 'Horizontal Line', command: 'hr' },
      ],
    },
    {
      label: 'Format',
      items: () => [
        { label: 'Bold', command: 'bold' },
        { label: 'Italic', command: 'italic' },
        { label: 'Strikethrough', command: 'strikethrough' },
        { label: 'Inline Code', command: 'inline-code' },
        'separator',
        { label: 'Link…', command: 'link' },
        { label: 'Image…', command: 'image' },
        'separator',
        { label: 'Clear Format', command: 'clear-format' },
      ],
    },
    {
      label: 'View',
      items: () => {
        const { sourceMode, darkTheme, sidebar, focusMode, typewriter, symbols, themes, customTheme, setCustomTheme } = state();
        const themeItems: MenuEntry[] = [
          { label: 'Default', checked: !customTheme, action: () => setCustomTheme(null) },
          ...themes.map((name) => ({
            label: name.replace(/\.css$/i, ''),
            checked: name === customTheme,
            action: () => setCustomTheme(name),
          })),
          'separator',
          { label: 'Open Theme Folder…', command: 'open-theme-folder' },
        ];
        return [
          { label: 'Source Mode', command: 'toggle-source', checked: sourceMode },
          { label: 'Focus Mode', command: 'toggle-focus', checked: focusMode },
          { label: 'Typewriter Mode', command: 'toggle-typewriter', checked: typewriter },
          { label: 'Markdown Symbols at Cursor', command: 'toggle-symbols', checked: symbols },
          'separator',
          { label: 'Sidebar', command: 'toggle-sidebar', checked: sidebar !== null },
          { label: 'Outline', command: 'show-outline', checked: sidebar === 'outline' },
          { label: 'Files', command: 'show-files', checked: sidebar === 'files' },
          'separator',
          { label: 'Dark Theme', command: 'toggle-theme', checked: darkTheme },
          { label: 'Theme', items: themeItems },
          'separator',
          { label: 'Full Screen', command: 'toggle-fullscreen' },
          { label: 'Zoom In', command: 'zoom-in' },
          { label: 'Zoom Out', command: 'zoom-out' },
          { label: 'Actual Size', command: 'zoom-reset' },
        ];
      },
    },
    {
      label: 'Help',
      items: () => [{ label: 'About MdPad', command: 'about' }],
    },
  ];
}
