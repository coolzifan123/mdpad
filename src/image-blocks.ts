// Images on a line of their own.
//
// Crepe shows such an image as a resizable "image block", and stores the
// block's display size in the image description: `![1.00](photo.png)`. That
// throws away real descriptions like `![A cat](cat.png)`. Here, only images
// without a description become image blocks; the others stay normal images
// and keep their description. A block at normal size is saved with an empty
// description instead of "1.00".

import { remarkImageBlockPlugin } from '@milkdown/kit/component/image-block';
import type { Editor } from '@milkdown/kit/core';
import { $remark } from '@milkdown/kit/utils';
import { defaultHandlers, type Handle } from 'mdast-util-to-markdown';

interface MdNode {
  type: string;
  children?: MdNode[];
  url?: string;
  alt?: string | null;
  title?: string | null;
}

/** Use in place of Crepe's own rule. Call before `create()`. */
export async function useImageBlocks(editor: Editor): Promise<void> {
  await editor.remove(remarkImageBlockPlugin);
  editor.use(imageBlocksWithoutDescription);
}

const imageBlocksWithoutDescription = $remark('imageBlocksWithoutDescription', () => () => (tree) => {
  toImageBlocks(tree as unknown as MdNode);
});

function toImageBlocks(node: MdNode): void {
  node.children?.forEach((child, i) => {
    const image = child.type === 'paragraph' && child.children?.length === 1 ? child.children[0] : null;
    if (image?.type === 'image' && isSize(image.alt)) {
      node.children![i] = { type: 'image-block', url: image.url, alt: image.alt, title: image.title };
    } else {
      toImageBlocks(child);
    }
  });
}

/** Empty, or a size written by an image block ("0.50"). */
function isSize(alt: string | null | undefined): boolean {
  return !alt || !Number.isNaN(Number(alt));
}

/** Writes images; an image block at normal size gets no description. */
export const imageHandler: Handle = (node, parent, state, info) =>
  defaultHandlers.image(node.alt === '1.00' ? { ...node, alt: '' } : node, parent, state, info);
