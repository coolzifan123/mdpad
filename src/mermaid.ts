// Mermaid diagrams: a code block whose language is "mermaid" shows the
// diagram. The library is large, so it loads the first time it's needed.

import type { Mermaid } from 'mermaid';

let loading: Promise<Mermaid> | null = null;
let counter = 0;

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  return loading;
}

/** The diagram as SVG markup. Throws on a syntax error. */
export async function renderMermaid(source: string, dark: boolean): Promise<string> {
  const mermaid = await load();
  mermaid.initialize({
    startOnLoad: false,
    // 'strict' keeps diagrams from running scripts or adding click handlers.
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
  });
  const { svg } = await mermaid.render(`mdpad-mermaid-${++counter}`, source);
  return svg;
}

/** For the editor's code block preview (see editor.ts). */
export function mermaidPreview(source: string, show: (value: string | HTMLElement) => void): void {
  renderMermaid(source, document.documentElement.dataset.theme === 'dark')
    .then(show)
    .catch((error: unknown) => {
      const message = document.createElement('pre');
      message.className = 'mermaid-error';
      message.textContent = `Diagram error: ${error instanceof Error ? error.message : String(error)}`;
      show(message);
    });
}
