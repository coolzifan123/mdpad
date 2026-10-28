// Rough word count. CJK characters count as one word each, like Typora.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countText(markdown: string): { words: number; characters: number } {
  const text = markdown
    .replace(/^```.*$/gm, '') // code fence lines
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> link text
    .replace(/[#>*_`~|\\-]/g, ' ');
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, ' ').match(WORD)?.length ?? 0;
  const characters = text.replace(/\s/g, '').length;
  return { words: words + cjk, characters };
}
