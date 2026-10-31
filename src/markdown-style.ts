// Keeping a file the way it was written.
//
// The editor works on Markdown with "\n" line endings and turns its document
// back into Markdown when saving. These helpers keep that round trip close to
// the original file: its line endings come back on save, and blocks that do
// get rewritten use the file's own style (bullet character, rule, etc.).

import { defaultHandlers, type Handle, type Options } from 'mdast-util-to-markdown';

export type LineEnding = '\n' | '\r\n';

/** For new files, like Notepad and VS Code do. */
export const systemLineEnding: LineEnding = /Win/.test(navigator.platform) ? '\r\n' : '\n';

/** The line ending most lines of `text` use; `fallback` if it has none. */
export function detectLineEnding(text: string, fallback: LineEnding = systemLineEnding): LineEnding {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1 - crlf;
  if (crlf === 0 && lf === 0) return fallback;
  return crlf > lf ? '\r\n' : '\n';
}

export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** `text` must use "\n" line endings. */
export function withLineEnding(text: string, lineEnding: LineEnding): string {
  return lineEnding === '\n' ? text : text.replace(/\n/g, '\r\n');
}

/**
 * Options for Milkdown's Markdown writer that match how `markdown` is
 * written. Anything the file does not use gets a common default
 * (`-` bullets, `---` rules).
 */
export function detectStyle(markdown: string): Options {
  const count = { bullet: new Map<string, number>(), ordered: new Map<string, number>(), rule: new Map<string, number>(), fence: new Map<string, number>() };
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  let setext = 0;
  let atx = 0;
  let spaceBreaks = 0;
  let backslashBreaks = 0;
  let ruleLine: string | null = null;
  let openFence: string | null = null;

  const lines = markdown.split('\n');
  lines.forEach((line, i) => {
    // Skip the inside of fenced code blocks.
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (openFence) {
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length && !line.trim().slice(fence.length)) {
        openFence = null;
      }
      return;
    }
    if (fence) {
      openFence = fence;
      add(count.fence, fence[0]);
      return;
    }

    const previous = lines[i - 1] ?? '';
    const next = lines[i + 1] ?? '';
    if (/^ {0,3}(=+|-+)[ \t]*$/.test(line) && isParagraphLine(previous)) {
      setext++;
      return;
    }
    const rule = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.exec(line);
    if (rule) {
      add(count.rule, rule[1]);
      ruleLine ??= line.trim();
      return;
    }
    const bullet = /^\s*([-*+])[ \t]+\S/.exec(line)?.[1];
    if (bullet) add(count.bullet, bullet);
    const ordered = /^\s*\d{1,9}([.)])[ \t]+\S/.exec(line)?.[1];
    if (ordered) add(count.ordered, ordered);
    if (/^ {0,3}#{1,2}([ \t]|$)/.test(line)) atx++;
    if (next.trim() && isParagraphLine(line)) {
      if (/\S {2,}$/.test(line)) spaceBreaks++;
      else if (/\S\\$/.test(line)) backslashBreaks++;
    }
  });

  const rule = mostCommon(count.rule, '-') as Options['rule'];
  const style: Options = {
    bullet: mostCommon(count.bullet, '-') as Options['bullet'],
    bulletOrdered: mostCommon(count.ordered, '.') as Options['bulletOrdered'],
    rule,
    // "* * *" vs "***", and "-----" vs "---".
    ruleSpaces: ruleLine ? /\s/.test(ruleLine) : false,
    ruleRepetition: ruleLine ? Math.max(3, [...ruleLine].filter((c) => c === rule).length) : 3,
    fence: mostCommon(count.fence, '`') as Options['fence'],
    setext: setext > atx,
  };
  if (spaceBreaks > backslashBreaks) style.handlers = { break: spaceBreak };
  return style;
}

/** A line break written as two trailing spaces instead of a backslash. */
const spaceBreak: Handle = (node, parent, state, info) => {
  const value = defaultHandlers.break(node, parent, state, info);
  return value === '\\\n' ? '  \n' : value;
};

function isParagraphLine(line: string): boolean {
  return /\S/.test(line) && !/^ {0,3}([-*+]\s|\d{1,9}[.)]\s|#|>|\||`{3}|~{3})/.test(line) && !/^ {4}/.test(line);
}

function mostCommon(counts: Map<string, number>, fallback: string): string {
  let best = fallback;
  let bestCount = 0;
  for (const [key, n] of counts) {
    if (n > bestCount) [best, bestCount] = [key, n];
  }
  return best;
}
