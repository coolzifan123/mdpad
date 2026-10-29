// The Outline panel in the sidebar: the document's headings. Clicking one
// jumps to it; the heading you are reading is highlighted.

import type { Heading } from './editor';

export class Outline {
  private shown = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly onSelect: (index: number) => void,
  ) {}

  render(headings: Heading[]): void {
    // Rebuilding on every keystroke would reset the hover state; skip
    // when nothing changed.
    const key = JSON.stringify(headings);
    if (key === this.shown) return;
    this.shown = key;
    this.panel.replaceChildren();
    if (!headings.length) {
      this.panel.append(Object.assign(document.createElement('p'), { className: 'sidebar-empty', textContent: 'No headings' }));
      return;
    }
    const top = Math.min(...headings.map((h) => h.level));
    headings.forEach((heading, i) => {
      const row = document.createElement('div');
      row.className = 'outline-row';
      row.style.paddingLeft = `${10 + (heading.level - top) * 14}px`;
      row.textContent = heading.text || '(empty heading)';
      row.title = heading.text;
      row.addEventListener('click', () => this.onSelect(i));
      this.panel.append(row);
    });
  }

  setCurrent(index: number): void {
    this.panel.querySelectorAll('.outline-row').forEach((row, i) => row.classList.toggle('current', i === index));
  }
}
