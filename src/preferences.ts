// Preferences (File > Preferences, Ctrl+,): stored settings that aren't
// kept elsewhere, and the window that edits all of them. Changes apply as
// soon as they're made.

export interface Preferences {
  /** Editor text size in px (headings scale with it). */
  fontSize: number;
  /** Widest the text column gets, in px. */
  editorWidth: number;
  spellcheck: boolean;
  /** Folder next to a document where pasted images go. */
  imageFolder: string;
  /** Line endings of new files. */
  newFileLineEnding: 'system' | 'lf' | 'crlf';
}

const KEY = 'mdpad-prefs';
export const DEFAULT_PREFERENCES: Preferences = {
  fontSize: 16,
  editorWidth: 900,
  spellcheck: true,
  imageFolder: 'assets',
  newFileLineEnding: 'system',
};

export function loadPreferences(): Preferences {
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not critical.
  }
}

/** Font size and width are CSS variables (see styles/app.css). */
export function applyLayout(prefs: Preferences): void {
  const root = document.documentElement.style;
  root.setProperty('--crepe-base-font-size', `${prefs.fontSize}px`);
  root.setProperty('--editor-font-size', `${prefs.fontSize}px`);
  root.setProperty('--editor-max-width', `${prefs.editorWidth}px`);
}

// ---------------------------------------------------------------------------
// The window

export type Field =
  | { kind: 'checkbox'; label: string; value: boolean; onChange: (value: boolean) => void }
  | { kind: 'number'; label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }
  | { kind: 'text'; label: string; value: string; hint?: string; onChange: (value: string) => void }
  | { kind: 'select'; label: string; value: string; options: [string, string][]; onChange: (value: string) => void };

export interface Section {
  title: string;
  fields: Field[];
}

export function showPreferences(sections: Section[]): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog preferences';
    dialog.setAttribute('role', 'dialog');
    dialog.append(Object.assign(document.createElement('h2'), { textContent: 'Preferences' }));

    for (const section of sections) {
      const box = document.createElement('section');
      box.append(Object.assign(document.createElement('h3'), { textContent: section.title }));
      for (const field of section.fields) box.append(renderField(field));
      dialog.append(box);
    }

    const close = Object.assign(document.createElement('button'), { textContent: 'Close', className: 'primary' });
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    buttons.append(close);
    dialog.append(buttons);
    backdrop.append(dialog);
    document.body.append(backdrop);

    const finish = () => {
      backdrop.remove();
      resolve();
    };
    close.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    });
    (dialog.querySelector('input, select, button') as HTMLElement | null)?.focus();
  });
}

function renderField(field: Field): HTMLElement {
  const row = document.createElement('label');
  row.className = `pref-row pref-${field.kind}`;
  const label = Object.assign(document.createElement('span'), { className: 'pref-label', textContent: field.label });

  if (field.kind === 'checkbox') {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: field.value });
    input.addEventListener('change', () => field.onChange(input.checked));
    row.append(input, label);
    return row;
  }

  let control: HTMLInputElement | HTMLSelectElement;
  if (field.kind === 'select') {
    control = document.createElement('select');
    for (const [value, text] of field.options) control.append(new Option(text, value, false, value === field.value));
    control.addEventListener('change', () => field.onChange(control.value));
  } else if (field.kind === 'number') {
    const input = Object.assign(document.createElement('input'), {
      type: 'number',
      value: String(field.value),
      min: String(field.min),
      max: String(field.max),
      step: String(field.step ?? 1),
    });
    input.addEventListener('change', () => {
      const value = Math.min(field.max, Math.max(field.min, Number(input.value) || field.value));
      input.value = String(value);
      field.onChange(value);
    });
    control = input;
  } else {
    const input = Object.assign(document.createElement('input'), { type: 'text', value: field.value, spellcheck: false });
    if (field.hint) input.placeholder = field.hint;
    input.addEventListener('change', () => field.onChange(input.value.trim()));
    control = input;
  }
  row.append(label, control);
  if (field.kind === 'number' && field.unit) row.append(Object.assign(document.createElement('span'), { className: 'pref-unit', textContent: field.unit }));
  return row;
}
