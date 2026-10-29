// The Files panel in the sidebar: the Markdown files in a folder. Folders
// load when you open them.

import * as platform from './platform';

export class FileTree {
  private root: string | null = null;
  private current: string | null = null;
  /** Folders the user opened, so they stay open after a refresh. */
  private readonly expanded = new Set<string>();

  constructor(
    private readonly panel: HTMLElement,
    private readonly onOpenFile: (path: string) => void,
    private readonly onOpenFolder: () => void,
  ) {}

  get folder(): string | null {
    return this.root;
  }

  async setRoot(path: string | null): Promise<void> {
    if (path === this.root) return;
    this.root = path;
    this.expanded.clear();
    await this.render();
  }

  /** Highlight the open document. */
  setCurrent(path: string | null): void {
    this.current = path;
    this.panel.querySelectorAll<HTMLElement>('.tree-row.file').forEach((row) => {
      row.classList.toggle('current', row.dataset.path === path);
    });
  }

  async render(): Promise<void> {
    this.panel.replaceChildren();
    const header = document.createElement('div');
    header.className = 'tree-header';
    const title = Object.assign(document.createElement('span'), {
      className: 'tree-title',
      textContent: this.root ? baseName(this.root) : 'No folder',
      title: this.root ?? '',
    });
    const open = button('Open Folder…', 'Open a folder', () => this.onOpenFolder());
    header.append(title, open);
    if (this.root) header.append(button('↻', 'Refresh', () => void this.render()));
    this.panel.append(header);

    if (!platform.inTauri) {
      this.panel.append(empty('Folders are available in the desktop app.'));
      return;
    }
    if (!this.root) {
      this.panel.append(empty('Open a folder to see its Markdown files here.'));
      return;
    }
    const list = document.createElement('div');
    list.className = 'tree';
    this.panel.append(list);
    try {
      await this.renderFolder(this.root, list, 0);
    } catch (error) {
      list.append(empty(`Can't read this folder.\n${error}`));
    }
  }

  private async renderFolder(path: string, container: HTMLElement, depth: number): Promise<void> {
    const entries = await platform.listDir(path);
    if (!entries.length && depth === 0) container.append(empty('No Markdown files here.'));
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = `tree-row ${entry.isDir ? 'folder' : 'file'}`;
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.title = entry.path;
      row.dataset.path = entry.path;
      const icon = Object.assign(document.createElement('span'), { className: 'tree-icon' });
      const name = Object.assign(document.createElement('span'), { className: 'tree-name', textContent: entry.name });
      row.append(icon, name);
      container.append(row);

      if (entry.isDir) {
        const children = document.createElement('div');
        children.hidden = true;
        container.append(children);
        const toggle = async (open: boolean) => {
          row.classList.toggle('open', open);
          children.hidden = !open;
          if (open) {
            this.expanded.add(entry.path);
            if (!children.childElementCount) await this.renderFolder(entry.path, children, depth + 1);
          } else {
            this.expanded.delete(entry.path);
          }
        };
        row.addEventListener('click', () => void toggle(Boolean(children.hidden)));
        if (this.expanded.has(entry.path)) await toggle(true);
      } else {
        row.classList.toggle('current', entry.path === this.current);
        row.addEventListener('click', () => this.onOpenFile(entry.path));
      }
    }
  }
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const el = Object.assign(document.createElement('button'), { textContent: text, title });
  el.addEventListener('click', onClick);
  return el;
}

function empty(text: string): HTMLElement {
  return Object.assign(document.createElement('p'), { className: 'sidebar-empty', textContent: text });
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
