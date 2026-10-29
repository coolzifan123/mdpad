// The menu bar (File, Edit, ...). Menus are rebuilt each time they open, so
// check marks and "Open Recent" are always current.

import { displayShortcut } from './keymap';

export interface MenuItem {
  label: string;
  /** A command name from app.ts; its shortcut is shown in the menu. */
  command?: string;
  /** Or something else to do. */
  action?: () => void;
  /** Shortcut to show, for keys the app doesn't handle itself (Ctrl+C). */
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  /** A submenu. */
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | 'separator';

export interface Menu {
  label: string;
  items: () => MenuEntry[];
}

export class MenuBar {
  private openIndex = -1;
  private dropdown: HTMLElement | null = null;
  private readonly buttons: HTMLButtonElement[];

  constructor(
    private readonly bar: HTMLElement,
    private readonly menus: Menu[],
    private readonly run: (command: string) => void,
  ) {
    this.buttons = menus.map((menu, i) => {
      const button = document.createElement('button');
      button.className = 'menubar-item';
      button.textContent = menu.label;
      button.addEventListener('click', () => (this.openIndex === i ? this.close() : this.open(i)));
      button.addEventListener('mouseenter', () => {
        if (this.openIndex >= 0 && this.openIndex !== i) this.open(i);
      });
      return button;
    });
    bar.prepend(...this.buttons);
    // Keep the focus (and the selection) in the editor, so Cut/Copy work.
    bar.addEventListener('mousedown', (event) => event.preventDefault());
    document.addEventListener('mousedown', (event) => {
      if (this.dropdown && !this.bar.contains(event.target as Node) && !this.dropdown.contains(event.target as Node)) {
        this.close();
      }
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (this.dropdown && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      },
      true,
    );
    window.addEventListener('blur', () => this.close());
  }

  open(index: number): void {
    this.close();
    this.openIndex = index;
    const button = this.buttons[index];
    button.classList.add('open');
    this.dropdown = this.renderList(this.menus[index].items());
    this.dropdown.addEventListener('mousedown', (event) => event.preventDefault());
    document.body.append(this.dropdown);
    const rect = button.getBoundingClientRect();
    this.dropdown.style.left = `${rect.left}px`;
    this.dropdown.style.top = `${rect.bottom}px`;
  }

  close(): void {
    this.dropdown?.remove();
    this.dropdown = null;
    this.buttons[this.openIndex]?.classList.remove('open');
    this.openIndex = -1;
  }

  private renderList(entries: MenuEntry[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'menu';
    list.setAttribute('role', 'menu');
    for (const entry of entries) {
      if (entry === 'separator') {
        list.append(Object.assign(document.createElement('div'), { className: 'menu-separator' }));
        continue;
      }
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.setAttribute('role', 'menuitem');
      if (entry.disabled) row.classList.add('disabled');
      const check = Object.assign(document.createElement('span'), {
        className: 'menu-check',
        textContent: entry.checked ? '✓' : '',
      });
      const label = Object.assign(document.createElement('span'), { className: 'menu-label', textContent: entry.label });
      const hint = Object.assign(document.createElement('span'), {
        className: 'menu-shortcut',
        textContent: entry.items ? '›' : (entry.shortcut ?? (entry.command ? displayShortcut(entry.command) : '')),
      });
      row.append(check, label, hint);
      if (entry.items) {
        const sub = this.renderList(entry.items);
        sub.classList.add('submenu');
        row.classList.add('has-submenu');
        row.append(sub);
      } else if (!entry.disabled) {
        row.addEventListener('click', () => {
          this.close();
          if (entry.command) this.run(entry.command);
          entry.action?.();
        });
      }
      list.append(row);
    }
    return list;
  }
}
