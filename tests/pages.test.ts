import { describe, expect, it } from 'vitest';
import { cleanPageText, joinTextItems, skipReason, snippet } from '../src/pages';
import { sectionsFromOutline } from '../src/outline';
import { cacheKey } from '../src/cache';
import { asDocument, asQuery } from '../src/model';

describe('page text', () => {
  it('drops OpenStax footers and links and collapses whitespace', () => {
    const raw = '158  6 • Functions\nAccess for free at openstax.org\nSee https://example.com/x  for more.\n\n  def f():';
    expect(cleanPageText(raw)).toBe('158 6 • Functions See for more. def f():');
  });

  it('joins pdf.js text items with spaces and line breaks', () => {
    expect(joinTextItems([{ str: 'a', hasEOL: true }, { str: 'b' }, { foo: 1 } as never, { str: 'c' }])).toBe('a\nb c ');
  });

  it('skips blank pages, contents, and index pages', () => {
    expect(skipReason('This page intentionally left blank')).toBe('empty');
    const words = Array.from({ length: 40 }, (_, i) => `topic ${i * 3}`).join(' ');
    expect(skipReason(`Contents ${words}`)).toBe('contents');
    expect(skipReason(`Index ${words}`)).toBe('index');
    const prose = 'A while loop repeats a block of code while its condition stays true and stops as soon as it becomes false. '.repeat(3);
    expect(skipReason(prose)).toBeNull();
  });

  it('makes short snippets on word boundaries', () => {
    expect(snippet('short')).toBe('short');
    const long = 'word '.repeat(60);
    const s = snippet(long, 100);
    expect(s.length).toBeLessThanOrEqual(101);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('sectionsFromOutline', () => {
  it('turns bookmarks into adjacent page ranges', () => {
    const sections = sectionsFromOutline(
      [
        { title: 'Chapter 4 Decisions', page: 95 },
        { title: '4.1 Boolean values', page: 95 },
        { title: '4.2  If-else statements', page: 100 },
        { title: 'Bad', page: 0 },
        { title: 'Chapter 5 Loops', page: 125 },
      ],
      130,
    );
    expect(sections).toEqual([
      { title: 'Chapter 4 Decisions', start: 95, end: 99 },
      { title: '4.1 Boolean values', start: 95, end: 99 },
      { title: '4.2 If-else statements', start: 100, end: 124 },
      { title: 'Chapter 5 Loops', start: 125, end: 130 },
    ]);
  });
});

describe('model prompts and cache keys', () => {
  it('uses the EmbeddingGemma retrieval prompts', () => {
    expect(asQuery('loops')).toBe('task: search result | query: loops');
    expect(asDocument('page')).toBe('title: none | text: page');
  });

  it('changes the cache key when the model or settings change', () => {
    expect(cacheKey('abc', 'm', 256, 512)).not.toBe(cacheKey('abc', 'm', 128, 512));
    expect(cacheKey('abc', 'm', 256, 512)).not.toBe(cacheKey('abc', 'm2', 256, 512));
  });
});
