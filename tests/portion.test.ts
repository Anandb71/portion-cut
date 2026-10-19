import { describe, expect, it } from 'vitest';
import { cleanLine, facetsOf, parsePortion } from '../src/portion';
import { SAMPLE_PORTIONS } from '../src/samples';

describe('parsePortion', () => {
  it('reads the markdown syllabus format and keeps module names as context', () => {
    const topics = parsePortion(SAMPLE_PORTIONS.cat1);
    expect(topics).toHaveLength(9);
    expect(topics[0]).toMatchObject({ id: 'm3-1', text: 'if, if-else, nested if, multiway elif', module: 'Control Structure' });
    expect(topics[8].module).toBe('Strings and Regular Expressions');
    expect(topics.every((t) => !t.text.includes('**'))).toBe(true);
  });

  it('handles plain "Unit 2 - Title" headings and numbered lines', () => {
    const topics = parsePortion('Unit 2 - Sorting\n1. Bubble sort\n2) Merge sort\n\nUnit III: Graphs\n• BFS and DFS');
    expect(topics.map((t) => [t.id, t.text, t.module])).toEqual([
      ['m2-1', 'Bubble sort', 'Sorting'],
      ['m2-2', 'Merge sort', 'Sorting'],
      ['miii-1', 'BFS and DFS', 'Graphs'],
    ]);
  });

  it('keeps a lone heading as a topic when nothing sits under it', () => {
    const topics = parsePortion('Module 1: Introduction to Problem Solving');
    expect(topics).toHaveLength(1);
    expect(topics[0].text).toBe('Introduction to Problem Solving');
  });

  it('treats lines without headings as topics with no module', () => {
    const topics = parsePortion('Recursion\n  \nFile handling');
    expect(topics.map((t) => t.module)).toEqual([null, null]);
    expect(topics.map((t) => t.query)).toEqual(['Recursion', 'File handling']);
  });

  it('gives unique ids even when lines repeat', () => {
    const ids = parsePortion('Loops\nLoops').map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns nothing for empty input', () => {
    expect(parsePortion('\n  \n')).toEqual([]);
  });
});

describe('cleanLine', () => {
  it('strips bullets, bold, and extra spaces', () => {
    expect(cleanLine('  - **Control   Structure**  ')).toBe('Control Structure');
    expect(cleanLine('* `list` methods')).toBe('list methods');
  });
});

describe('facetsOf', () => {
  it('splits a "Head: a, b, c" line and keeps the head on each facet', () => {
    expect(facetsOf('Tuples: create, indexing, slicing')).toEqual(['Tuples create', 'Tuples indexing', 'Tuples slicing']);
  });

  it('drops a leading "and" and does not repeat the head when the part already has it', () => {
    expect(facetsOf('Dictionary: create, and replace values, dictionary comprehension')).toEqual([
      'Dictionary create',
      'Dictionary replace values',
      'dictionary comprehension',
    ]);
  });

  it('splits plain comma lists and " - " joins', () => {
    expect(facetsOf('break, continue, pass')).toEqual(['break', 'continue', 'pass']);
    expect(facetsOf('Recursive functions - Lambda function')).toEqual(['Recursive functions', 'Lambda function']);
  });

  it('returns no facets for a single idea', () => {
    expect(facetsOf('Built-in modules')).toEqual([]);
    expect(facetsOf('Sets: creation and operation')).toEqual([]);
  });
});
