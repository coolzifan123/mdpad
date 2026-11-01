// Updates: MdPad looks for a newer version on GitHub (Help > Check for
// Updates, and by itself once a day) and offers to install it.

import { offerChoice } from './notice';

const LAST_CHECK_KEY = 'mdpad-update-check';
const DAY = 24 * 60 * 60 * 1000;

/** Whether a day has passed since the last automatic check. */
export function dueForCheck(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0) > DAY;
  } catch {
    return true;
  }
}

export function rememberCheck(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Not critical.
  }
}

/** A bar at the bottom of the window. Resolves true for "Install". */
export function offerUpdate(version: string): Promise<boolean> {
  return offerChoice(`MdPad ${version} is available.`, 'Install and Restart', 'Later', 'update-bar');
}
