import type { Topic } from './portion';

export type Vector = Float32Array | number[];

/** Matryoshka truncation: keep the first `dims` values and re-normalize. */
export function truncateAndNormalize(vector: ArrayLike<number>, dims: number): Float32Array {
  const size = Math.min(dims, vector.length);
  const out = new Float32Array(size);
  let norm = 0;
  for (let i = 0; i < size; i += 1) {
    out[i] = vector[i];
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < size; i += 1) out[i] /= norm;
  return out;
}

export function dot(a: Vector, b: Vector): number {
  const size = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < size; i += 1) sum += a[i] * b[i];
  return sum;
}

export interface MatchSettings {
  /**
   * A topic is reported as probably not in the book when its best page does
   * not stand out from the rest of the book: (best - mean) / stdev below this.
   */
  minLift: number;
  /** Keep pages scoring within this distance of the topic's best page. */
  band: number;
  /** Never keep a page below this score. */
  floor: number;
  /** Fill gaps of up to this many pages between kept pages. */
  bridge: number;
  /** Hard cap on pages kept per topic from the whole-line query. */
  maxPages: number;
  /** Pages each facet may add (its best pages). */
  facetPages: number;
  /** A facet only adds pages when its best page stands out this much. */
  facetLift: number;
}

/** Tuned on the cat1 fixture portion only; cat2 is the held-out check. See README. */
export const DEFAULT_SETTINGS: MatchSettings = {
  minLift: 3.35,
  band: 0.08,
  floor: 0.5,
  bridge: 0,
  maxPages: 6,
  facetPages: 3,
  facetLift: 3,
};

/** A bookmarked section of the PDF, used to snap matches to whole sections. */
export interface Section {
  title: string;
  start: number;
  end: number;
}

export interface PageVector {
  page: number;
  label: string;
  vector: Vector;
}

export interface TopicMatch {
  topic: Topic;
  best: number;
  /** How far the best page stands above the book's average, in stdevs. */
  lift: number;
  covered: boolean;
  /** Kept pages, sorted ascending. */
  pages: number[];
  /** Pages added by gap bridging or section snapping rather than by score. */
  bridged: number[];
  /** Section titles the kept pages belong to, in page order. */
  sections: string[];
  /** Top scores, best first, for the "why" panel. */
  top: Array<{ page: number; label: string; score: number }>;
}

export function matchTopic(
  topic: Topic,
  topicVector: Vector,
  pages: PageVector[],
  settings: MatchSettings = DEFAULT_SETTINGS,
  sections: Section[] = [],
  facetVectors: Vector[] = [],
): TopicMatch {
  return selectPages(
    topic,
    rank(topicVector, pages),
    facetVectors.map((vector) => rank(vector, pages)),
    new Set(pages.map((page) => page.page)),
    settings,
    sections,
  );
}

export interface Scored {
  page: number;
  label: string;
  score: number;
}

/**
 * The page-picking rules, given scores already sorted best first. Shared by the
 * model path and the keyword baseline in scripts/eval.ts.
 */
export function selectPages(
  topic: Topic,
  scored: Scored[],
  facets: Scored[][],
  known: Set<number>,
  settings: MatchSettings = DEFAULT_SETTINGS,
  sections: Section[] = [],
): TopicMatch {
  const best = scored[0]?.score ?? 0;
  const lift = liftOf(scored.map((entry) => entry.score));
  const top = scored.slice(0, 5);

  if (lift < settings.minLift) {
    return { topic, best, lift, covered: false, pages: [], bridged: [], sections: [], top };
  }

  const cutoff = Math.max(settings.floor, best - settings.band);
  const seeds = scored
    .filter((entry) => entry.score >= cutoff)
    .slice(0, settings.maxPages)
    .map((entry) => entry.page);
  for (const facet of facets) {
    if (liftOf(facet.map((entry) => entry.score)) < settings.facetLift) continue;
    for (const entry of facet.slice(0, settings.facetPages)) {
      if (entry.score >= settings.floor && !seeds.includes(entry.page)) seeds.push(entry.page);
    }
  }
  const snapped = snapToSections(seeds, sections, known);
  const { pages: kept, bridged } = bridgeGaps(snapped, settings.bridge, known);
  const extra = kept.filter((page) => !seeds.includes(page));
  return {
    topic,
    best,
    lift,
    covered: true,
    pages: kept,
    bridged: [...new Set([...extra, ...bridged])].sort((a, b) => a - b),
    sections: sectionTitles(kept, sections),
    top,
  };
}

function rank(vector: Vector, pages: PageVector[]): Scored[] {
  return pages
    .map((page) => ({ page: page.page, label: page.label, score: dot(vector, page.vector) }))
    .sort((a, b) => b.score - a.score || a.page - b.page);
}

/** (best - mean) / stdev over all page scores. */
export function liftOf(scores: number[]): number {
  if (scores.length < 2) return 0;
  const best = Math.max(...scores);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (best - mean) / sd : 0;
}

/** The smallest bookmarked section containing a page, if any. */
export function sectionOf(page: number, sections: Section[]): Section | null {
  let found: Section | null = null;
  for (const section of sections) {
    if (page < section.start || page > section.end) continue;
    if (!found || section.end - section.start <= found.end - found.start) found = section;
  }
  return found;
}

/** Expand each page to every page of its bookmarked section. */
export function snapToSections(pages: number[], sections: Section[], known?: Set<number>): number[] {
  const out = new Set<number>(pages);
  for (const page of pages) {
    const section = sectionOf(page, sections);
    if (!section) continue;
    for (let p = section.start; p <= section.end; p += 1) if (!known || known.has(p)) out.add(p);
  }
  return [...out].sort((a, b) => a - b);
}

function sectionTitles(pages: number[], sections: Section[]): string[] {
  const titles: string[] = [];
  for (const page of pages) {
    const section = sectionOf(page, sections);
    if (section && !titles.includes(section.title)) titles.push(section.title);
  }
  return titles;
}

/** Fill short gaps between kept pages, e.g. 100, 102 -> 100, 101, 102. */
export function bridgeGaps(
  pages: number[],
  maxGap: number,
  known?: Set<number>,
): { pages: number[]; bridged: number[] } {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const bridged: number[] = [];
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    out.push(sorted[i]);
    const next = sorted[i + 1];
    if (next === undefined) continue;
    const gap = next - sorted[i] - 1;
    if (gap > 0 && gap <= maxGap) {
      for (let page = sorted[i] + 1; page < next; page += 1) {
        if (known && !known.has(page)) continue;
        out.push(page);
        bridged.push(page);
      }
    }
  }
  return { pages: out, bridged };
}

/** Compress sorted page numbers into ranges: [1,2,3,7] -> [[1,3],[7,7]]. */
export function toRanges(pages: number[]): Array<[number, number]> {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const page of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else ranges.push([page, page]);
  }
  return ranges;
}

export function formatRanges(ranges: Array<[number, number]>, label?: (page: number) => string): string {
  const name = label ?? ((page: number) => String(page));
  return ranges
    .map(([start, end]) => (start === end ? name(start) : `${name(start)}–${name(end)}`))
    .join(', ');
}

export interface PortionCut {
  matches: TopicMatch[];
  /** Union of kept pages across topics, sorted. */
  pages: number[];
  totalPages: number;
  covered: number;
  missing: number;
}

export function cutPortion(
  topics: Topic[],
  topicVectors: Vector[],
  pages: PageVector[],
  totalPages: number,
  settings: MatchSettings = DEFAULT_SETTINGS,
  sections: Section[] = [],
  facetVectors: Vector[][] = [],
): PortionCut {
  if (topics.length !== topicVectors.length) {
    throw new Error('Each topic needs exactly one vector.');
  }
  const matches = topics.map((topic, index) =>
    matchTopic(topic, topicVectors[index], pages, settings, sections, facetVectors[index] ?? []),
  );
  const union = new Set<number>();
  for (const match of matches) for (const page of match.pages) union.add(page);
  const covered = matches.filter((match) => match.covered).length;
  return {
    matches,
    pages: [...union].sort((a, b) => a - b),
    totalPages,
    covered,
    missing: matches.length - covered,
  };
}

export function percentSkipped(cut: Pick<PortionCut, 'pages' | 'totalPages'>): number {
  if (cut.totalPages <= 0) return 0;
  return Math.round((1 - cut.pages.length / cut.totalPages) * 100);
}
