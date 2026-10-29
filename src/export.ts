// Turning the document into a stand-alone HTML page, for File > Export and
// Print. The page needs no other files: math is written as MathML, and the
// styles are included. Loaded only when needed, because it's large.

import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export interface PageOptions {
  title: string;
  /** Rewrite image addresses, e.g. so local images load when printing. */
  resolveImage?: (src: string) => Promise<string> | string;
}

export async function toHtmlPage(markdown: string, { title, resolveImage }: PageOptions): Promise<string> {
  const body = await unified()
    .use(remarkParse)
    // Front matter is metadata: left out of the page.
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex, { output: 'mathml' })
    .use(() => (tree: HtmlNode) => renderDiagrams(tree))
    .use(rehypeHighlight)
    .use(() => (tree: HtmlNode) => rewriteImages(tree, resolveImage))
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PAGE_STYLE}</style>`,
    '</head>',
    '<body>',
    '<main class="document">',
    String(body),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

interface HtmlNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
  value?: string;
}

/** Replace ```mermaid code blocks with the drawn diagram (SVG). */
async function renderDiagrams(tree: HtmlNode): Promise<void> {
  const blocks: { parent: HtmlNode; index: number; source: string }[] = [];
  const walk = (node: HtmlNode) => {
    node.children?.forEach((child, index) => {
      const code = child.tagName === 'pre' ? child.children?.[0] : undefined;
      const classes = code?.properties?.className;
      if (code?.tagName === 'code' && Array.isArray(classes) && classes.includes('language-mermaid')) {
        blocks.push({ parent: node, index, source: (code.children ?? []).map((t) => t.value ?? '').join('') });
      } else {
        walk(child);
      }
    });
  };
  walk(tree);
  if (!blocks.length) return;
  const { renderMermaid } = await import('./mermaid');
  for (const { parent, index, source } of blocks) {
    try {
      const svg = await renderMermaid(source, false);
      parent.children![index] = { type: 'raw', value: `<figure class="diagram">${svg}</figure>` };
    } catch {
      // Leave the code as it is.
    }
  }
}

async function rewriteImages(tree: HtmlNode, resolve?: PageOptions['resolveImage']): Promise<void> {
  if (!resolve) return;
  const images: HtmlNode[] = [];
  const walk = (node: HtmlNode) => {
    if (node.type === 'element' && node.tagName === 'img') images.push(node);
    node.children?.forEach(walk);
  };
  walk(tree);
  await Promise.all(
    images.map(async (img) => {
      img.properties ??= {};
      img.properties.src = await resolve(String(img.properties.src ?? ''));
    }),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PAGE_STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1f2328;
  font: 16px/1.7 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', 'PingFang SC', 'Noto Sans', sans-serif; }
.document { max-width: 860px; margin: 0 auto; padding: 48px 32px 80px; }
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.6em; line-height: 1.3; font-weight: 600; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #e3e6ea; }
h2 { font-size: 1.5em; padding-bottom: 0.25em; border-bottom: 1px solid #e3e6ea; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5, h6 { font-size: 0.9em; color: #57606a; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }
hr { height: 1px; margin: 2em 0; border: 0; background: #e3e6ea; }
blockquote { margin-left: 0; padding: 0 1em; border-left: 4px solid #d0d7de; color: #57606a; }
ul, ol { padding-left: 2em; }
li + li { margin-top: 0.25em; }
li.task-list-item { list-style: none; }
li.task-list-item input { margin: 0 0.5em 0 -1.4em; }
code { padding: 0.15em 0.35em; border-radius: 4px; background: #eff1f3;
  font: 0.88em 'Cascadia Code', Consolas, 'JetBrains Mono', Menlo, monospace; }
pre { overflow: auto; padding: 14px 16px; border-radius: 6px; background: #f6f8fa; line-height: 1.5; }
pre code { padding: 0; background: none; font-size: 0.86em; }
table { border-collapse: collapse; display: block; overflow: auto; }
th, td { padding: 6px 13px; border: 1px solid #d0d7de; }
th { background: #f6f8fa; font-weight: 600; }
tr:nth-child(2n) td { background: #fafbfc; }
math[display="block"] { margin: 1em 0; overflow-x: auto; }
.diagram { margin: 1em 0; text-align: center; }
.diagram svg { max-width: 100%; height: auto; }
.hljs-comment, .hljs-quote { color: #6e7781; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type { color: #cf222e; }
.hljs-string, .hljs-regexp, .hljs-attr-value, .hljs-addition { color: #0a3069; }
.hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet { color: #0550ae; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #8250df; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-property { color: #953800; }
.hljs-meta, .hljs-name, .hljs-tag { color: #116329; }
.hljs-deletion { color: #82071e; }
@media print {
  .document { max-width: none; padding: 0; }
  pre, blockquote, table, img { break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; }
}
`;
