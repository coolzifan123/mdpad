// YAML front matter: the "---" block at the top of a file, used by static
// site generators and note apps. Without this, Milkdown reads it as a
// horizontal rule and a heading. It is shown as plain text and saved as is.

import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';

/** Lets remark read and write the "---" block (as a "yaml" node). */
export const frontmatterRemark = $remark('frontmatter', () => remarkFrontmatter, ['yaml']);

export const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  content: 'text*',
  group: 'block',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'pre[data-type="frontmatter"]', preserveWhitespace: 'full' }],
  toDOM: () => ['pre', { 'data-type': 'frontmatter', class: 'front-matter' }, ['code', 0]],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type);
      if (typeof node.value === 'string' && node.value) state.addText(node.value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent);
    },
  },
}));

export const frontmatter = [frontmatterRemark, frontmatterSchema].flat();
