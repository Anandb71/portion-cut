import { describe, expect, it } from 'vitest';
import { pageLabeler, readingList } from '../src/export';
import type { PortionCut } from '../src/match';

const cut: PortionCut = {
  totalPages: 100,
  pages: [10, 11, 12, 40],
  covered: 1,
  missing: 1,
  matches: [
    {
      topic: { id: 'a', text: 'Loops', module: 'Control', query: 'Loops', facets: [] },
      best: 0.6, lift: 4, covered: true, pages: [10, 11, 12, 40], bridged: [], sections: ['5.1 While loop'], top: [],
    },
    {
      topic: { id: 'b', text: 'Regular expressions', module: null, query: 'Regular expressions', facets: [] },
      best: 0.4, lift: 2, covered: false, pages: [], bridged: [], sections: [], top: [],
    },
  ],
};

describe('readingList', () => {
  it('writes a checklist with ranges, sections, and missing topics', () => {
    const text = readingList(cut, pageLabeler([]), 'book.pdf');
    expect(text).toContain('Read 4 of 100 pages (96% skipped).');
    expect(text).toContain('[ ] Loops\n    pp. 10–12, 40\n    5.1 While loop');
    expect(text).toContain('[ ] Regular expressions\n    Probably not in this book.');
  });

  it('uses printed page labels when the PDF has them', () => {
    const label = pageLabeler(Array.from({ length: 100 }, (_, i) => `p${i + 1}`));
    expect(readingList(cut, label, 'b')).toContain('pp. p10–p12, p40');
  });
});
