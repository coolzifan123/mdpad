// Crepe's own texts (the "/" menu, the toolbar's tips, the picture and link
// boxes, code blocks) in the interface's language. In English, Crepe's own
// wording is kept.

import { Crepe } from '@milkdown/crepe';
import { currentLanguage, t } from './i18n';

/** Settings to merge into Crepe's `featureConfigs`. */
export function crepeTexts(): Record<string, object> {
  if (currentLanguage() === 'en') return {};
  return {
    [Crepe.Feature.BlockEdit]: {
      textGroup: {
        label: t('Text'),
        text: { label: t('Body text') },
        h1: { label: t('Heading 1') },
        h2: { label: t('Heading 2') },
        h3: { label: t('Heading 3') },
        h4: { label: t('Heading 4') },
        h5: { label: t('Heading 5') },
        h6: { label: t('Heading 6') },
        quote: { label: t('Quote') },
        divider: { label: t('Divider') },
      },
      listGroup: {
        label: t('List'),
        bulletList: { label: t('Bullet List') },
        orderedList: { label: t('Ordered List') },
        taskList: { label: t('Task List') },
      },
      advancedGroup: {
        label: t('Advanced'),
        image: { label: t('Image') },
        codeBlock: { label: t('Code Block') },
        table: { label: t('Table') },
        math: { label: t('Math Block') },
      },
    },
    [Crepe.Feature.Toolbar]: {
      boldLabel: t('Bold'),
      italicLabel: t('Italic'),
      strikethroughLabel: t('Strikethrough'),
      codeLabel: t('Inline Code'),
      linkLabel: t('Link'),
      latexLabel: t('Math'),
    },
    [Crepe.Feature.LinkTooltip]: { inputPlaceholder: t('Paste link…') },
  };
}

/** Texts for the picture box (merged into the ImageBlock settings). */
export function imageTexts(): object {
  if (currentLanguage() === 'en') return {};
  return {
    blockUploadButton: t('Upload file'),
    blockUploadPlaceholderText: t('or paste link'),
    blockCaptionPlaceholderText: t('Write Image Caption'),
    inlineUploadButton: t('Upload'),
    inlineUploadPlaceholderText: t('or paste link'),
  };
}

/** Texts for code blocks (merged into the CodeMirror settings). */
export function codeTexts(): object {
  if (currentLanguage() === 'en') return {};
  return {
    searchPlaceholder: t('Search language'),
    noResultText: t('No result'),
    copyText: t('Copy'),
    previewLabel: t('Preview'),
    previewLoading: t('Loading…'),
    previewToggleText: (previewOnly: boolean) => (previewOnly ? t('Edit') : t('Hide')),
  };
}
