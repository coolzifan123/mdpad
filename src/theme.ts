// Light / dark theme. The colors themselves live in styles/theme.css.

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'mdpad-theme';

export function applySavedTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable; fall back to the system setting.
  }
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved === 'light' || saved === 'dark' ? saved : systemDark ? 'dark' : 'light');
}

export function toggleTheme(): void {
  const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not critical.
  }
}

function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

// ---------------------------------------------------------------------------
// Custom themes: .css files in the theme folder (View > Theme), loaded after
// the app's own styles so they can change any color or rule.

const CUSTOM_KEY = 'mdpad-custom-theme';

export function savedCustomTheme(): string | null {
  try {
    return localStorage.getItem(CUSTOM_KEY);
  } catch {
    return null;
  }
}

/** Use the theme `name` (null: none), reading its CSS with `load`. */
export async function applyCustomTheme(name: string | null, load: (name: string) => Promise<string>): Promise<void> {
  let style = document.getElementById('custom-theme') as HTMLStyleElement | null;
  if (name) {
    const css = await load(name);
    if (!style) {
      style = Object.assign(document.createElement('style'), { id: 'custom-theme' });
      document.head.append(style);
    }
    style.textContent = css;
  } else {
    style?.remove();
  }
  try {
    if (name) localStorage.setItem(CUSTOM_KEY, name);
    else localStorage.removeItem(CUSTOM_KEY);
  } catch {
    // Not critical.
  }
}

/** Written to the theme folder when it's empty, to show how themes work. */
export const EXAMPLE_THEME = `/*
 * Sepia: an example MdPad theme.
 *
 * Themes are CSS files in this folder. Pick one in View > Theme. To make
 * your own, copy this file, rename it and change the colors. A theme is
 * loaded after MdPad's own styles, so anything here wins. The variables
 * you can set are listed in MdPad's src/styles/theme.css.
 */

:root,
:root[data-theme='dark'] {
  --app-bg: #f5eedc;
  --app-fg: #4a3b2c;
  --app-fg-muted: #8a7660;
  --app-chrome-bg: #ece2c9;
  --app-border: #dccfb0;
  --app-hover: #e3d6b8;
  --app-active: #d8c9a5;
  --app-accent: #a0522d;
  color-scheme: light;
}

:root .milkdown,
:root[data-theme='dark'] .milkdown {
  --crepe-color-background: #f5eedc;
  --crepe-color-on-background: #4a3b2c;
  --crepe-color-surface: #ece2c9;
  --crepe-color-surface-low: #efe6d0;
  --crepe-color-on-surface: #4a3b2c;
  --crepe-color-on-surface-variant: #6f5c47;
  --crepe-color-outline: #b9a684;
  --crepe-color-primary: #a0522d;
  --crepe-color-inline-code: #9b2c2c;
  --crepe-color-hover: #e3d6b8;
  --crepe-color-selected: #d8c9a5;
  --crepe-color-inline-area: #e8dcc0;
  --crepe-font-default: Georgia, 'Songti SC', 'SimSun', serif;
}
`;
