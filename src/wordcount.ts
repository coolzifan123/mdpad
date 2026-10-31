// Rough word count. CJK characters count as one word each, like Typora.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countText(markdown: string): { words: number; characters: number } {
  const { words, characters } = textStats(markdown);
  return { words, characters };
}

export interface TextStats {
  words: number;
  /** Not counting spaces. */
  characters: number;
  charactersWithSpaces: number;
  paragraphs: number;
  /** About 230 words or 400 CJK characters a minute. */
  readingMinutes: number;
}

export function textStats(markdown: string): TextStats {
  const text = markdown
    .replace(/^```.*$/gm, '') // code fence lines
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> link text
    .replace(/[#>*_`~|\\=-]/g, ' ');
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.replace(CJK, ' ').match(WORD)?.length ?? 0;
  return {
    words: latin + cjk,
    characters: text.replace(/\s/g, '').length,
    charactersWithSpaces: text.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim().length,
    paragraphs: markdown.split(/\n\s*\n/).filter((block) => block.trim()).length,
    readingMinutes: latin / 230 + cjk / 400,
  };
}
