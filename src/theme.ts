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
