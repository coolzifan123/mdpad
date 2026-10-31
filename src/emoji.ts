// Emoji shortcodes: typing ":smile:" puts 😄 in its place. The names are
// GitHub's (the gemoji list), loaded in the background on first use.

import { InputRule } from '@milkdown/kit/prose/inputrules';
import { $inputRule } from '@milkdown/kit/utils';

let names: Record<string, string> | null = null;
void import('gemoji').then(({ nameToEmoji }) => (names = nameToEmoji));

export const emojiInputRule = $inputRule(
  () =>
    new InputRule(/:([a-z0-9_+-]+):$/, (state, match, start, end) => {
      const emoji = names?.[match[1]];
      // When several characters arrive at once (an input method committing
      // a phrase), the shortcode isn't all in the document yet and `start`
      // lies past `end`: leave the text as typed.
      if (!emoji || start > end) return null;
      // Leave inline code alone.
      if (state.doc.resolve(start).marks().some((mark) => mark.type.name === 'inlineCode')) return null;
      return state.tr.insertText(emoji, start, end);
    }),
);
