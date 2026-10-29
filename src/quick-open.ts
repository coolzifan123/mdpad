// Quick Open (Ctrl+P): type part of a file name, press Enter. Lists recent
// files first, then every Markdown file in the sidebar's folder.

export async function quickOpen(candidates: Promise<{ recent: string[]; folder: string | null; files: string[] }>): Promise<string | null> {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const palette = document.createElement('div');
  palette.className = 'palette';
  const input = Object.assign(document.createElement('input'), {
    type: 'text',
    placeholder: 'Search files by name',
    spellcheck: false,
  });
  const list = document.createElement('div');
  list.className = 'palette-list';
  palette.append(input, list);
  backdrop.append(palette);
  document.body.append(backdrop);
  input.focus();
  list.append(note('Loading…'));

  const { recent, folder, files } = await candidates;
  // Recent files first, without duplicates.
  const all = [...new Set([...recent, ...files])];
  const label = (path: string) => (folder && path.startsWith(folder) ? path.slice(folder.length).replace(/^[\\/]/, '') : path);

  return new Promise((resolve) => {
    let shown: string[] = [];
    let selected = 0;

    const render = () => {
      shown = rank(all, input.value, label).slice(0, 50);
      selected = Math.min(selected, Math.max(0, shown.length - 1));
      list.replaceChildren();
      if (!shown.length) {
        list.append(note(all.length ? 'No matching files' : folder ? 'No Markdown files in this folder' : 'Open a folder to search its files'));
        return;
      }
      shown.forEach((path, i) => {
        const row = document.createElement('div');
        row.className = 'palette-row';
        row.classList.toggle('selected', i === selected);
        const name = Object.assign(document.createElement('span'), { className: 'palette-name', textContent: baseName(path) });
        const where = Object.assign(document.createElement('span'), { className: 'palette-path', textContent: label(path) });
        row.append(name, where);
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();
          finish(path);
        });
        list.append(row);
      });
      list.children[selected]?.scrollIntoView({ block: 'nearest' });
    };

    const finish = (path: string | null) => {
      backdrop.remove();
      resolve(path);
    };

    input.addEventListener('input', () => {
      selected = 0;
      render();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        selected = (selected + step + shown.length) % Math.max(1, shown.length);
        render();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        finish(shown[selected] ?? null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    });
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish(null);
    });
    render();
  });
}

/**
 * Paths whose label contains the query's letters in order, best first:
 * matches in the file name beat matches in the folder, and earlier,
 * tighter matches beat later, looser ones.
 */
function rank(paths: string[], query: string, label: (path: string) => string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths;
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const name = baseName(path).toLowerCase();
    const inName = subsequence(name, q);
    const inPath = inName >= 0 ? -1 : subsequence(label(path).toLowerCase(), q);
    if (inName < 0 && inPath < 0) continue;
    const score = (inName >= 0 ? inName : 1000 + inPath) + name.length / 1000;
    scored.push({ path, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.path);
}

/** -1 if `query`'s letters don't appear in order in `text`; else the gaps between them. */
function subsequence(text: string, query: string): number {
  let at = -1;
  let gaps = 0;
  for (const char of query) {
    const next = text.indexOf(char, at + 1);
    if (next < 0) return -1;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return gaps;
}

function note(text: string): HTMLElement {
  return Object.assign(document.createElement('p'), { className: 'sidebar-empty', textContent: text });
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
