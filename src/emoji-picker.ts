// The emoji picker: typing ":" and a few letters (":sm") lists matching
// emoji under the cursor, like Typora. ↑/↓ choose, Enter or Tab puts the
// emoji in place of ":sm", Esc closes the list. (":smile:" typed in full is
// turned into 😄 by emoji.ts.)

import { Plugin, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { Gemoji } from 'gemoji';

let list: Gemoji[] | null = null;
void import('gemoji').then(({ gemoji }) => (list = gemoji));

const MAX_RESULTS = 8;

interface Query {
  /** The ":" and the letters after it. */
  from: number;
  to: number;
  text: string;
}

/** The ":letters" just before the cursor (not in code, not in "10:30"). */
function queryAt(state: EditorState): Query | null {
  const { selection } = state;
  const $pos = selection.$from;
  if (!selection.empty || !$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  if ($pos.marks().some((mark) => mark.type.name === 'inlineCode')) return null;
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 40), $pos.parentOffset, undefined, '￼');
  const match = /(?:^|[^\p{L}\p{N}:])(:([a-z0-9_+-]{2,}))$/iu.exec(before);
  if (!match) return null;
  return { from: $pos.pos - match[1].length, to: $pos.pos, text: match[2].toLowerCase() };
}

/** Emoji whose name starts with `text`, then names containing it, then tags. */
function search(text: string): { emoji: string; name: string }[] {
  if (!list) return [];
  const ranked: { emoji: string; name: string; rank: number }[] = [];
  for (const entry of list) {
    const starts = entry.names.find((name) => name.startsWith(text));
    const contains = starts ?? entry.names.find((name) => name.includes(text));
    const tagged = entry.tags.some((tag) => tag.startsWith(text));
    if (contains) ranked.push({ emoji: entry.emoji, name: contains, rank: starts ? 0 : 1 });
    else if (tagged) ranked.push({ emoji: entry.emoji, name: entry.names[0], rank: 2 });
  }
  // A stable sort keeps gemoji's own order (common emoji first) within a rank.
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, MAX_RESULTS);
}

export const emojiPicker = $prose(() => {
  let box: HTMLElement | null = null;
  let results: { emoji: string; name: string }[] = [];
  let selected = 0;
  let query: Query | null = null;
  /** Where Esc closed the list: it stays closed for that ":". */
  let dismissedAt = -1;

  const close = () => {
    box?.remove();
    box = null;
    results = [];
    query = null;
  };

  const choose = (view: EditorView, index: number) => {
    const result = results[index];
    if (!result || !query) return;
    view.dispatch(view.state.tr.insertText(result.emoji, query.from, query.to));
    close();
  };

  const render = (view: EditorView) => {
    if (!box) {
      box = document.createElement('div');
      box.className = 'emoji-picker';
      box.setAttribute('role', 'listbox');
      document.body.append(box);
    }
    box.replaceChildren(
      ...results.map((result, i) => {
        const row = document.createElement('div');
        row.className = i === selected ? 'emoji-row selected' : 'emoji-row';
        row.setAttribute('role', 'option');
        row.append(Object.assign(document.createElement('span'), { className: 'emoji-glyph', textContent: result.emoji }));
        row.append(Object.assign(document.createElement('span'), { textContent: `:${result.name}:` }));
        // mousedown, not click: keep the focus (and the cursor) in the editor.
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(view, i);
        });
        return row;
      }),
    );
    // Under the ":", or above it near the bottom of the window.
    const at = view.coordsAtPos(query!.from);
    const height = box.offsetHeight;
    const below = at.bottom + 4;
    box.style.left = `${Math.min(at.left, window.innerWidth - box.offsetWidth - 8)}px`;
    box.style.top = `${below + height > window.innerHeight - 8 ? at.top - height - 4 : below}px`;
  };

  return new Plugin({
    view: () => ({
      update: (view) => {
        const found = view.editable ? queryAt(view.state) : null;
        if (!found) dismissedAt = -1;
        if (!found || found.from === dismissedAt) return close();
        const matches = search(found.text);
        if (!matches.length) return close();
        if (found.text !== query?.text || found.from !== query.from) selected = 0;
        query = found;
        results = matches;
        render(view);
      },
      destroy: close,
    }),
    props: {
      handleKeyDown: (view, event) => {
        if (!box || event.ctrlKey || event.altKey || event.metaKey) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          selected = (selected + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
          render(view);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          choose(view, selected);
          return true;
        }
        if (event.key === 'Escape') {
          dismissedAt = query?.from ?? -1;
          close();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        blur: () => {
          close();
          return false;
        },
      },
    },
  });
});
