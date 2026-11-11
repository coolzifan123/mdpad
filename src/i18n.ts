// The interface's language: English or Chinese (简体中文). Text is written in
// English in the code and goes through t(); the Chinese for it is in
// i18n-zh.ts (text missing there shows in English). The language is chosen
// when MdPad starts: Preferences → Language, "Same as Windows" by default.

import { ZH } from './i18n-zh';

export type LanguageChoice = 'system' | 'en' | 'zh-CN';
export type Language = 'en' | 'zh-CN';

let language: Language = 'en';

/** Use `choice` from now on ("system": Windows' display language). */
export function setLanguage(choice: LanguageChoice): void {
  language = choice === 'system' ? (/^zh/i.test(navigator.language) ? 'zh-CN' : 'en') : choice;
  document.documentElement.lang = language;
}

export function currentLanguage(): Language {
  return language;
}

/** `text` in the interface's language, with {name} filled in from `values`. */
export function t(text: string, values: Record<string, string | number> = {}): string {
  const translated = language === 'zh-CN' ? (ZH[text] ?? text) : text;
  return translated.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all));
}

/** "1 word" or "{n} words": `one` or `many`, with {n} filled in (with thousands separators). */
export function count(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n: n.toLocaleString() });
}

/** The page's own text (index.html): titles, placeholders, labels, and elements marked data-i18n. */
export function translatePage(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[title], [placeholder], [aria-label], [data-i18n]')) {
    for (const attribute of ['title', 'placeholder', 'aria-label']) {
      const value = el.getAttribute(attribute);
      if (value) el.setAttribute(attribute, t(value));
    }
    if (el.hasAttribute('data-i18n')) el.textContent = t(el.textContent ?? '');
  }
}
