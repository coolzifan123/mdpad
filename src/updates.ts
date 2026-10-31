// Updates: MdPad looks for a newer version on GitHub (Help > Check for
// Updates, and by itself once a day) and offers to install it.

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
  document.querySelector('.update-bar')?.remove();
  return new Promise((resolve) => {
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    const text = Object.assign(document.createElement('span'), { textContent: `MdPad ${version} is available.` });
    const install = Object.assign(document.createElement('button'), { textContent: 'Install and Restart', className: 'primary' });
    const later = Object.assign(document.createElement('button'), { textContent: 'Later' });
    bar.append(text, install, later);
    document.body.append(bar);
    const finish = (choice: boolean) => {
      bar.remove();
      resolve(choice);
    };
    install.addEventListener('click', () => finish(true));
    later.addEventListener('click', () => finish(false));
  });
}
