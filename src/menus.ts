// What's in the menu bar. Items name commands from app.ts; the shortcuts
// shown next to them come from keymap.ts.

import type { Menu, MenuEntry } from './menu';

/** The app state the menus show. */
export interface MenuState {
  recentFiles: string[];
  autoSave: boolean;
  sourceMode: boolean;
  darkTheme: boolean;
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
        const { recentFiles, autoSave, openRecent, clearRecent } = state();
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
          { label: 'Open Recent', items: recent },
          'separator',
          { label: 'Save', command: 'save' },
          { label: 'Save As…', command: 'save-as' },
          { label: 'Auto Save', command: 'toggle-autosave', checked: autoSave },
          'separator',
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
        const { sourceMode, darkTheme } = state();
        return [
          { label: 'Source Mode', command: 'toggle-source', checked: sourceMode },
          'separator',
          { label: 'Dark Theme', command: 'toggle-theme', checked: darkTheme },
        ];
      },
    },
    {
      label: 'Help',
      items: () => [{ label: 'About MdPad', command: 'about' }],
    },
  ];
}
