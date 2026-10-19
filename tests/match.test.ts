import { describe, expect, it } from 'vitest';
import {
  bridgeGaps,
  cutPortion,
  DEFAULT_SETTINGS,
  dot,
  formatRanges,
  liftOf,
  matchTopic,
  percentSkipped,
  sectionOf,
  snapToSections,
  toRanges,
  truncateAndNormalize,
  type PageVector,
} from '../src/match';
import type { Topic } from '../src/portion';

const topic = (text: string): Topic => ({ id: text, text, module: null, query: text, facets: [] });

/** A toy book: page i has a unit vector along axis i % dims, plus noise pages. */
function book(spikes: Record<number, number[]>, total = 40, dims = 4): PageVector[] {
  const pages: PageVector[] = [];
  for (let page = 1; page <= total; page += 1) {
    const v = spikes[page] ?? [0.3, 0.3, 0.3, 0.3].slice(0, dims);
    pages.push({ page, label: String(page), vector: truncateAndNormalize(v, dims) });
  }
  return pages;
}

describe('vectors', () => {
  it('truncates to the first dims and re-normalizes', () => {
    const v = truncateAndNormalize([3, 4, 100, 100], 2);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(v).toHaveLength(2);
    expect(dot(v, v)).toBeCloseTo(1);
  });

  it('leaves a zero vector at zero', () => {
    expect(Array.from(truncateAndNormalize([0, 0, 0], 3))).toEqual([0, 0, 0]);
  });
});

describe('liftOf', () => {
  it('is large when one score stands out and small when none do', () => {
    const flat = Array.from({ length: 50 }, (_, i) => 0.4 + (i % 5) * 0.01);
    expect(liftOf([...flat, 0.9])).toBeGreaterThan(5);
    expect(liftOf(flat)).toBeLessThan(2);
    expect(liftOf([0.5])).toBe(0);
  });
});

describe('ranges', () => {
  it('compresses and formats page lists', () => {
    expect(toRanges([7, 1, 2, 3, 3, 9, 10])).toEqual([[1, 3], [7, 7], [9, 10]]);
    expect(formatRanges([[1, 3], [7, 7]])).toBe('1–3, 7');
    expect(formatRanges([[11, 12]], (p) => `p${p - 10}`)).toBe('p1–p2');
  });

  it('bridges short gaps only', () => {
    expect(bridgeGaps([10, 12, 20], 1)).toEqual({ pages: [10, 11, 12, 20], bridged: [11] });
    expect(bridgeGaps([10, 12], 0).pages).toEqual([10, 12]);
    expect(bridgeGaps([10, 12], 1, new Set([10, 12])).pages).toEqual([10, 12]);
  });
});

describe('sections', () => {
  const sections = [
    { title: 'Chapter 4', start: 95, end: 95 },
    { title: '4.1 Boolean values', start: 95, end: 99 },
    { title: '4.2 If-else statements', start: 100, end: 103 },
  ];

  it('finds the smallest section holding a page, preferring the deeper bookmark on ties', () => {
    expect(sectionOf(101, sections)?.title).toBe('4.2 If-else statements');
    expect(sectionOf(95, [{ title: 'Chapter', start: 95, end: 97 }, { title: '5.1', start: 95, end: 97 }])?.title).toBe('5.1');
    expect(sectionOf(500, sections)).toBeNull();
  });

  it('snaps pages to whole sections and skips pages that were never embedded', () => {
    expect(snapToSections([101], sections)).toEqual([100, 101, 102, 103]);
    expect(snapToSections([101], sections, new Set([100, 101, 103]))).toEqual([100, 101, 103]);
    expect(snapToSections([7], sections)).toEqual([7]);
  });
});

describe('matchTopic', () => {
  const pages = book({ 12: [1, 0, 0, 0], 13: [0.95, 0.1, 0, 0], 30: [0, 1, 0, 0] });

  it('keeps the standout pages for a topic the book covers', () => {
    const m = matchTopic(topic('t'), truncateAndNormalize([1, 0, 0, 0], 4), pages, { ...DEFAULT_SETTINGS, floor: 0.5 });
    expect(m.covered).toBe(true);
    expect(m.pages).toEqual([12, 13]);
    expect(m.top[0].page).toBe(12);
  });

  it('reports a topic as missing when nothing stands out', () => {
    const flat = book({});
    const m = matchTopic(topic('t'), truncateAndNormalize([0, 0, 1, 0], 4), flat);
    expect(m.covered).toBe(false);
    expect(m.pages).toEqual([]);
  });

  it('lets a facet add its own best page', () => {
    const settings = { ...DEFAULT_SETTINGS, floor: 0.5, facetLift: 1, facetPages: 1 };
    const m = matchTopic(topic('t'), truncateAndNormalize([1, 0, 0, 0], 4), pages, settings, [], [truncateAndNormalize([0, 1, 0, 0], 4)]);
    expect(m.pages).toEqual([12, 13, 30]);
    expect(m.bridged).toEqual([]);
  });

  it('marks pages added by section snapping', () => {
    const m = matchTopic(topic('t'), truncateAndNormalize([1, 0, 0, 0], 4), pages, { ...DEFAULT_SETTINGS, floor: 0.5 }, [
      { title: '2.1 Things', start: 11, end: 14 },
    ]);
    expect(m.pages).toEqual([11, 12, 13, 14]);
    expect(m.bridged).toEqual([11, 14]);
    expect(m.sections).toEqual(['2.1 Things']);
  });
});

describe('cutPortion', () => {
  it('unions pages across topics and counts missing topics', () => {
    const pages = book({ 5: [1, 0, 0, 0], 6: [0, 1, 0, 0] });
    const settings = { ...DEFAULT_SETTINGS, floor: 0.5 };
    const cut = cutPortion(
      [topic('a'), topic('b'), topic('c')],
      [truncateAndNormalize([1, 0, 0, 0], 4), truncateAndNormalize([0, 1, 0, 0], 4), truncateAndNormalize([0.5, 0.5, 0.5, 0.5], 4)],
      pages,
      40,
      settings,
    );
    expect(cut.pages).toEqual([5, 6]);
    expect(cut.covered).toBe(2);
    expect(cut.missing).toBe(1);
    expect(percentSkipped(cut)).toBe(95);
  });

  it('refuses mismatched topics and vectors', () => {
    expect(() => cutPortion([topic('a')], [], [], 1)).toThrow();
  });

  it('reports 0% skipped for an empty book', () => {
    expect(percentSkipped({ pages: [], totalPages: 0 })).toBe(0);
  });
});
