import type { Section } from './match';

export interface OutlineEntry {
  title: string;
  /** 1-based page the bookmark points to. */
  page: number;
}

/**
 * Turn flattened PDF bookmarks into page ranges. Each bookmark runs until the
 * page before the next bookmark that starts later, so nested bookmarks become
 * adjacent segments and the deepest one wins in `sectionOf`.
 */
export function sectionsFromOutline(entries: OutlineEntry[], numPages: number): Section[] {
  const valid = entries
    .filter((entry) => Number.isInteger(entry.page) && entry.page >= 1 && entry.page <= numPages)
    .map((entry) => ({ title: entry.title.replace(/\s+/g, ' ').trim(), page: entry.page }));
  const starts = [...new Set(valid.map((entry) => entry.page))].sort((a, b) => a - b);
  return valid.map((entry) => {
    const next = starts.find((page) => page > entry.page);
    return { title: entry.title, start: entry.page, end: next ? next - 1 : numPages };
  });
}
