export interface PageText {
  /** 1-based page index inside the PDF. */
  page: number;
  /** Printed page label if the PDF has one (e.g. "158"), else the index. */
  label: string;
  text: string;
}

const BOILERPLATE = [
  /Access for free at openstax\.org\.?/gi,
  /Access multimedia content \(https?:\/\/[^)]*\)/gi,
  /https?:\/\/\S+/g,
];

/** Strip running headers, links, and repeated footer lines; collapse whitespace. */
export function cleanPageText(raw: string): string {
  let text = raw;
  for (const pattern of BOILERPLATE) text = text.replace(pattern, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Join text items from pdf.js into one string, keeping line breaks as spaces. */
export function joinTextItems(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    out += item.hasEOL ? '\n' : ' ';
  }
  return out;
}

export type SkipReason = 'empty' | 'contents' | 'index';

/**
 * Pages that would match every topic for the wrong reason: blank pages, the
 * table of contents, and the back-of-book index. Plain rules, not the model.
 */
export function skipReason(text: string): SkipReason | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 25) return 'empty';
  const numbers = words.filter((word) => /^\d{1,4}[,.;]?$/.test(word)).length;
  const ratio = numbers / words.length;
  if (/^(table of )?contents\b/i.test(text) && ratio > 0.12) return 'contents';
  if (/^index\b/i.test(text) && ratio > 0.12) return 'index';
  if (ratio > 0.3) return 'index';
  return null;
}

/** Short preview for the reading list: the first sentence-ish chunk. */
export function snippet(text: string, max = 140): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 60 ? space : max).trimEnd()}…`;
}
