// Unsaved changes are kept as a draft while you work. If MdPad closes
// without saving them (a crash, a power cut), the next start offers to
// restore them.
//
// Drafts are in localStorage, one per window. Each window holds a Web Lock
// for as long as it is open; a draft whose window no longer holds its lock
// was left behind.

import { offerChoice } from './notice';

const PREFIX = 'mdpad-draft:';
/** Without Web Locks: an open window rewrites its draft at least this often. */
const ALIVE_EVERY = 20_000;

export interface Draft {
  path: string | null;
  name: string;
  text: string;
  time: number;
}

const windowId = crypto.randomUUID();
const lockName = (id: string) => `mdpad-window-${id}`;
const locks = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
// Held until the window closes.
void locks?.request(lockName(windowId), () => new Promise(() => {}));

let lastSaved: Omit<Draft, 'time'> | null = null;

/** Keep this window's unsaved text. */
export function keepDraft(draft: Omit<Draft, 'time'>): void {
  lastSaved = draft;
  try {
    localStorage.setItem(PREFIX + windowId, JSON.stringify({ ...draft, time: Date.now() }));
  } catch {
    // Too big for localStorage: no draft.
  }
}

/** This window has nothing unsaved. */
export function dropDraft(): void {
  lastSaved = null;
  try {
    localStorage.removeItem(PREFIX + windowId);
  } catch {
    // Nothing to do.
  }
}

// Without Web Locks, liveness is the draft's age: keep it fresh.
if (!locks) setInterval(() => lastSaved && keepDraft(lastSaved), ALIVE_EVERY);

/** Drafts left by windows that closed without saving, newest first. */
export async function leftoverDrafts(): Promise<{ key: string; draft: Draft }[]> {
  const held = locks ? new Set(((await locks.query()).held ?? []).map((lock) => lock.name)) : null;
  const found: { key: string; draft: Draft }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX) || key === PREFIX + windowId) continue;
      const draft = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
      if (!draft) continue;
      const alive = held ? held.has(lockName(key.slice(PREFIX.length))) : Date.now() - draft.time < 3 * ALIVE_EVERY;
      if (!alive) found.push({ key, draft });
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => b.draft.time - a.draft.time);
}

export function forgetDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** A bar asking whether to restore a left-over draft. Resolves true for "Restore". */
export function offerRestore(draft: Draft): Promise<boolean> {
  const minutes = Math.round((Date.now() - draft.time) / 60_000);
  const when = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : new Date(draft.time).toLocaleString();
  return offerChoice(`"${draft.name}" had unsaved changes when MdPad closed (${when}).`, 'Restore', 'Discard', 'draft-bar');
}
