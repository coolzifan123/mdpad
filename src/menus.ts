// What's in the menu bar. Items name commands from app.ts; the shortcuts
// shown next to them come from keymap.ts.

import { t } from './i18n';
import type { Menu, MenuEntry } from './menu';

/** The app state the menus show. */
export interface MenuState {
  recentFiles: string[];
  autoSave: boolean;
  sourceMode: boolean;
  darkTheme: boolean;
  /** The sidebar panel showing, or null when the sidebar is closed. */
  sidebar: 'files' | 'outline' | 'search' | null;
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
      label: t('File'),
      items: () => {
        const { recentFiles, autoSave, openRecent, clearRecent, hasPath } = state();
        const recent: MenuEntry[] = recentFiles.length
          ? [
              ...recentFiles.map((path) => ({ label: path, action: () => openRecent(path) })),
              'separator',
              { label: t('Clear Recent Files'), action: clearRecent },
            ]
          : [{ label: t('No recent files'), disabled: true }];
        return [
          { label: t('New'), command: 'new' },
          { label: t('New Window'), command: 'new-window' },
          { label: t('Open…'), command: 'open' },
          { label: t('Open Folder…'), command: 'open-folder' },
          { label: t('Quick Open…'), command: 'quick-open' },
          { label: t('Open Recent'), items: recent },
          'separator',
          { label: t('Save'), command: 'save' },
          { label: t('Save As…'), command: 'save-as' },
          { label: t('Auto Save'), command: 'toggle-autosave', checked: autoSave },
          'separator',
          {
            label: t('Export'),
            items: [
              { label: t('HTML…'), command: 'export-html' },
              // The print dialog's "Save as PDF" printer makes the PDF.
              { label: t('PDF…'), command: 'print' },
            ],
          },
          { label: t('Print…'), command: 'print' },
          'separator',
          { label: t('Reveal in File Explorer'), command: 'reveal-file', disabled: !hasPath },
          'separator',
          { label: t('Preferences…'), command: 'preferences' },
          'separator',
          { label: t('Close'), command: 'close' },
        ];
      },
    },
    {
      label: t('Edit'),
      items: () => [
        { label: t('Undo'), command: 'undo' },
        { label: t('Redo'), command: 'redo' },
        'separator',
        { label: t('Cut'), command: 'cut', shortcut: `${mod}+X` },
        { label: t('Copy'), command: 'copy', shortcut: `${mod}+C` },
        { label: t('Paste'), command: 'paste', shortcut: `${mod}+V` },
        { label: t('Paste as Plain Text'), command: 'paste-plain' },
        { label: t('Copy as Markdown'), command: 'copy-markdown' },
        { label: t('Copy as HTML Code'), command: 'copy-html' },
        { label: t('Select All'), command: 'select-all', shortcut: `${mod}+A` },
        'separator',
        { label: t('Find…'), command: 'find' },
        { label: t('Replace…'), command: 'replace' },
        { label: t('Find Next'), command: 'find-next' },
        { label: t('Find Previous'), command: 'find-previous' },
        { label: t('Search in Folder…'), command: 'search-folder' },
      ],
    },
    {
      label: t('Paragraph'),
      items: () => [
        { label: t('Heading 1'), command: 'heading-1' },
        { label: t('Heading 2'), command: 'heading-2' },
        { label: t('Heading 3'), command: 'heading-3' },
        { label: t('Heading 4'), command: 'heading-4' },
        { label: t('Heading 5'), command: 'heading-5' },
        { label: t('Heading 6'), command: 'heading-6' },
        { label: t('Paragraph'), command: 'paragraph' },
        { label: t('Increase Heading Level'), command: 'heading-up' },
        { label: t('Decrease Heading Level'), command: 'heading-down' },
        'separator',
        { label: t('Table'), command: 'table' },
        {
          label: t('Table Rows and Columns'),
          items: [
            { label: t('Insert Row Above'), command: 'table-row-above' },
            { label: t('Insert Row Below'), command: 'table-row-below' },
            { label: t('Insert Column Left'), command: 'table-col-left' },
            { label: t('Insert Column Right'), command: 'table-col-right' },
            'separator',
            { label: t('Delete Row'), command: 'table-delete-row' },
            { label: t('Delete Column'), command: 'table-delete-col' },
            'separator',
            { label: t('Align Left'), command: 'table-align-left' },
            { label: t('Align Center'), command: 'table-align-center' },
            { label: t('Align Right'), command: 'table-align-right' },
          ],
        },
        { label: t('Code Block'), command: 'code-block' },
        { label: t('Math Block'), command: 'math-block' },
        { label: t('Quote'), command: 'quote' },
        'separator',
        { label: t('Ordered List'), command: 'ordered-list' },
        { label: t('Bullet List'), command: 'bullet-list' },
        { label: t('Task List'), command: 'task-list' },
        'separator',
        { label: t('Horizontal Line'), command: 'hr' },
      ],
    },
    {
      label: t('Format'),
      items: () => [
        { label: t('Bold'), command: 'bold' },
        { label: t('Italic'), command: 'italic' },
        { label: t('Strikethrough'), command: 'strikethrough' },
        { label: t('Highlight'), command: 'highlight' },
        { label: t('Inline Code'), command: 'inline-code' },
        'separator',
        { label: t('Link…'), command: 'link' },
        { label: t('Image…'), command: 'image' },
        'separator',
        { label: t('Clear Format'), command: 'clear-format' },
      ],
    },
    {
      label: t('View'),
      items: () => {
        const { sourceMode, darkTheme, sidebar, focusMode, typewriter, symbols, themes, customTheme, setCustomTheme } = state();
        const themeItems: MenuEntry[] = [
          { label: t('Default'), checked: !customTheme, action: () => setCustomTheme(null) },
          ...themes.map((name) => ({
            label: name.replace(/\.css$/i, ''),
            checked: name === customTheme,
            action: () => setCustomTheme(name),
          })),
          'separator',
          { label: t('Open Theme Folder…'), command: 'open-theme-folder' },
        ];
        return [
          { label: t('Source Mode'), command: 'toggle-source', checked: sourceMode },
          { label: t('Focus Mode'), command: 'toggle-focus', checked: focusMode },
          { label: t('Typewriter Mode'), command: 'toggle-typewriter', checked: typewriter },
          { label: t('Markdown Symbols at Cursor'), command: 'toggle-symbols', checked: symbols },
          'separator',
          { label: t('Sidebar'), command: 'toggle-sidebar', checked: sidebar !== null },
          { label: t('Outline'), command: 'show-outline', checked: sidebar === 'outline' },
          { label: t('Files'), command: 'show-files', checked: sidebar === 'files' },
          'separator',
          { label: t('Dark Theme'), command: 'toggle-theme', checked: darkTheme },
          { label: t('Theme'), items: themeItems },
          'separator',
          { label: t('Full Screen'), command: 'toggle-fullscreen' },
          { label: t('Zoom In'), command: 'zoom-in' },
          { label: t('Zoom Out'), command: 'zoom-out' },
          { label: t('Actual Size'), command: 'zoom-reset' },
        ];
      },
    },
    {
      label: t('Help'),
      items: () => [
        { label: t('Word Count…'), command: 'word-count' },
        { label: t('Check for Updates…'), command: 'check-updates' },
        'separator',
        { label: t('About MdPad'), command: 'about' },
      ],
    },
  ];
}
