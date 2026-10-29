// Recently opened files (File > Open Recent), newest first.

const STORAGE_KEY = 'mdpad-recent';
const MAX = 10;

export function recentFiles(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addRecentFile(path: string): void {
  save([path, ...recentFiles().filter((p) => p !== path)].slice(0, MAX));
}

export function removeRecentFile(path: string): void {
  save(recentFiles().filter((p) => p !== path));
}

export function clearRecentFiles(): void {
  save([]);
}

function save(paths: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Not critical.
  }
}
