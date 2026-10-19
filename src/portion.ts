export interface Topic {
  /** Stable id, e.g. "m3-1". */
  id: string;
  /** The syllabus line as the student wrote it, minus bullets and markdown. */
  text: string;
  /** Module or unit heading the line sits under, if any. */
  module: string | null;
  /** What gets embedded. The line alone matched better than "module: line" on the fixtures. */
  query: string;
  /**
   * Smaller queries for comma lists, so "List: create, slicing, comprehensions"
   * can find the slicing pages and the comprehension pages separately.
   */
  facets: string[];
}

const HEADING = /^(module|unit|chapter|part|section)[\s_-]*([0-9ivx]+)\b\s*[:.\-–]?\s*(.*)$/i;

/**
 * Turn a pasted syllabus into topics. One topic per non-empty line.
 * Lines that look like "Module 3: Control Structure" become headings for the
 * lines under them instead of topics, unless nothing follows them.
 */
export function parsePortion(input: string): Topic[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter((line) => line.length > 0);

  const topics: Topic[] = [];
  let module: string | null = null;
  let moduleKey = '0';
  let pendingHeading: string | null = null;
  let counter = 0;

  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      if (pendingHeading) topics.push(makeTopic(pendingHeading, null, `${moduleKey}-0`));
      const name = heading[3].trim();
      module = name.length > 0 ? name : line;
      moduleKey = `m${heading[2].toLowerCase()}`;
      pendingHeading = line;
      counter = 0;
      continue;
    }
    pendingHeading = null;
    counter += 1;
    topics.push(makeTopic(line, module, `${moduleKey}-${counter}`));
  }
  if (pendingHeading && module) topics.push(makeTopic(module, null, `${moduleKey}-0`));
  return dedupeIds(topics);
}

export function cleanLine(line: string): string {
  return line
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*•▪◦·]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeTopic(text: string, module: string | null, id: string): Topic {
  return { id, text, module, query: text, facets: facetsOf(text) };
}

function dedupeIds(topics: Topic[]): Topic[] {
  const seen = new Map<string, number>();
  return topics.map((topic) => {
    const count = seen.get(topic.id) ?? 0;
    seen.set(topic.id, count + 1);
    return count === 0 ? topic : { ...topic, id: `${topic.id}.${count}` };
  });
}

/**
 * Split a syllabus line into facets. "Head: a, b, and c" -> ["Head a", "Head b", "Head c"].
 * "a, b, c" -> ["a", "b", "c"]. A line with no list gives no facets.
 */
export function facetsOf(text: string): string[] {
  const colon = text.indexOf(':');
  const head = colon > 0 && colon < 40 ? text.slice(0, colon).trim() : '';
  const rest = head ? text.slice(colon + 1) : text;
  const parts = rest
    .split(/,|;|\s-\s|\s–\s/)
    .map((part) => part.replace(/^\s*(and|or|&)\s+/i, '').trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return [];
  const seen = new Set<string>();
  const facets: string[] = [];
  for (const part of parts) {
    const facet = head && !part.toLowerCase().includes(head.toLowerCase()) ? `${head} ${part}` : part;
    const key = facet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facets.push(facet);
  }
  return facets;
}
