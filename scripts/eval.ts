// Score the real model against the hand-labelled ground truth.
// Usage: npm run eval            (default settings)
//        npm run eval -- --sweep (grid search on cat1 only, then report cat2 as held out)
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ROOT, embedQuery, ensureBook, loadModel, readBook, type Section } from './lib';
import { parsePortion, type Topic } from '../src/portion';
import { cutPortion, DEFAULT_SETTINGS, selectPages, type MatchSettings, type PageVector, type PortionCut, type Scored, type Vector } from '../src/match';
import { bm25Scores, buildBm25 } from '../src/keyword';

interface GroundTopic { match: string; required: string[] | null; acceptable: string[] }
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/ground-truth.json'), 'utf8'));
const cache = JSON.parse(fs.readFileSync(path.join(CACHE, 'page-vectors.json'), 'utf8'));
const book = await readBook(await ensureBook());
const sections: Section[] = book.sections;
const outline = process.argv.includes('--no-sections') ? [] : book.outline;
const pages: PageVector[] = cache.pages;
const sectionPages = (ids: string[]) => {
  const out = new Set<number>();
  for (const id of ids) {
    const section = sections.find((s) => s.id === id);
    if (!section) throw new Error(`Unknown section ${id}`);
    for (let p = section.start; p <= section.end; p += 1) out.add(p);
  }
  return out;
};

const loaded = await loadModel();
const portions: Record<string, { topics: Topic[]; vectors: Vector[]; facets: Vector[][]; truth: GroundTopic[]; queryMs: number }> = {};
const useFacets = !process.argv.includes('--no-facets');
for (const [key, portion] of Object.entries<{ file: string; topics: GroundTopic[] }>(truth.portions)) {
  const topics = parsePortion(fs.readFileSync(path.join(ROOT, 'fixtures', portion.file), 'utf8'));
  const started = performance.now();
  const vectors: Vector[] = [];
  const facets: Vector[][] = [];
  for (const topic of topics) {
    vectors.push(await embedQuery(loaded, topic.query));
    const fv: Vector[] = [];
    if (useFacets) for (const facet of topic.facets) fv.push(await embedQuery(loaded, facet));
    facets.push(fv);
  }
  const queryMs = performance.now() - started;
  const ordered = topics.map((topic) => {
    const g = portion.topics.find((t) => topic.text.includes(t.match));
    if (!g) throw new Error(`No ground truth for "${topic.text}"`);
    return g;
  });
  portions[key] = { topics, vectors, facets, truth: ordered, queryMs };
}

const textByPage = new Map(book.pages.map((p) => [p.page, p.text]));
const bm25 = buildBm25(pages.map((p) => ({ id: p.page, text: textByPage.get(p.page) ?? '' })));
const known = new Set(pages.map((p) => p.page));
function keywordRank(query: string): Scored[] {
  const raw = bm25Scores(bm25, query);
  const max = Math.max(...raw.map((r) => r.score), 1e-9);
  return raw.map((r) => ({ page: r.id, label: String(r.id), score: r.score / max })).sort((a, b) => b.score - a.score || a.page - b.page);
}
function keywordCut(key: string, settings: MatchSettings): PortionCut {
  const { topics } = portions[key];
  const matches = topics.map((t) => selectPages(t, keywordRank(t.query), t.facets.map(keywordRank), known, settings, outline));
  const union = new Set<number>();
  for (const m of matches) m.pages.forEach((p) => union.add(p));
  const covered = matches.filter((m) => m.covered).length;
  return { matches, pages: [...union].sort((a, b) => a - b), totalPages: cache.numPages, covered, missing: matches.length - covered };
}
let method: 'model' | 'keyword' = 'model';

function score(key: string, settings: MatchSettings, verbose = false) {
  const { topics, vectors, facets, truth: gts } = portions[key];
  const cut = method === 'keyword' ? keywordCut(key, settings) : cutPortion(topics, vectors, pages, cache.numPages, settings, outline, facets);
  let sectionsNeeded = 0, sectionsHit = 0, gapsRight = 0, gaps = 0, falseGaps = 0;
  const requiredAll = new Set<number>(), acceptableAll = new Set<number>();
  const rows = cut.matches.map((m, i) => {
    const g = gts[i];
    const required = g.required ? sectionPages(g.required) : new Set<number>();
    const ok = new Set([...required, ...sectionPages(g.acceptable)]);
    required.forEach((p) => requiredAll.add(p));
    ok.forEach((p) => acceptableAll.add(p));
    let hit = 0;
    if (g.required) {
      for (const id of g.required) {
        sectionsNeeded += 1;
        const s = sectionPages([id]);
        if (m.pages.some((p) => s.has(p))) { sectionsHit += 1; hit += 1; }
      }
      if (!m.covered) falseGaps += 1;
    } else {
      gaps += 1;
      if (!m.covered) gapsRight += 1;
    }
    const wasted = m.pages.filter((p) => !ok.has(p));
    if (verbose) {
      console.log(`  ${m.covered ? 'IN ' : 'GAP'} best=${m.best.toFixed(3)} lift=${m.lift.toFixed(2)} kept=${m.pages.length} wasted=${wasted.length} sections ${g.required ? `${hit}/${g.required.length}` : 'n/a (not in book)'}  | ${m.topic.text.slice(0, 60)}`);
      console.log(`      top: ${m.top.map((t) => `${t.page}:${t.score.toFixed(3)}`).join(' ')}  kept: ${m.pages.join(',')}`);
    }
    return { topic: m.topic.text, covered: m.covered, best: m.best, lift: m.lift, pages: m.pages, wasted: wasted.length, sectionsHit: hit, sectionsNeeded: g.required?.length ?? 0, notInBook: g.required === null };
  });
  const kept = cut.pages;
  const keptOk = kept.filter((p) => acceptableAll.has(p)).length;
  const requiredHit = [...requiredAll].filter((p) => kept.includes(p)).length;
  return {
    rows,
    keptPages: kept.length,
    totalPages: cache.numPages,
    sectionRecall: sectionsHit / sectionsNeeded,
    sectionsHit, sectionsNeeded,
    pageRecall: requiredHit / requiredAll.size,
    requiredPages: requiredAll.size,
    pagePrecision: kept.length ? keptOk / kept.length : 0,
    gapsRight, gaps, falseGaps,
  };
}

const summary = (r: ReturnType<typeof score>) =>
  `kept ${r.keptPages}/${r.totalPages} pages | sections ${r.sectionsHit}/${r.sectionsNeeded} (${(r.sectionRecall * 100).toFixed(0)}%) | required pages ${(r.pageRecall * 100).toFixed(0)}% of ${r.requiredPages} | on-topic ${(r.pagePrecision * 100).toFixed(0)}% | not-in-book flagged ${r.gapsRight}/${r.gaps} | wrongly flagged ${r.falseGaps}`;

function sweepKeyword(): MatchSettings {
  let best: { s: MatchSettings; v: number } | null = null;
  for (const minLift of [2, 2.5, 3, 3.35, 4, 5]) for (const band of [0.05, 0.1, 0.2, 0.3]) for (const floor of [0.2, 0.4, 0.6]) for (const maxPages of [2, 4, 6]) for (const facetPages of [0, 1, 2, 3]) for (const facetLift of [2, 3, 4]) {
    const s = { ...DEFAULT_SETTINGS, minLift, band, floor, bridge: 0, maxPages, facetPages, facetLift };
    const r = score('cat1', s);
    const v = r.sectionRecall * 2 + r.pagePrecision + (r.gapsRight - r.falseGaps * 2) * 0.25 - (r.keptPages / r.totalPages) * 0.5;
    if (!best || v > best.v) best = { s, v };
  }
  return best!.s;
}

let settings = DEFAULT_SETTINGS;
if (process.argv.includes('--keyword')) {
  method = 'keyword';
  settings = sweepKeyword();
  console.log('keyword baseline, best on cat1:', JSON.stringify(settings));
}
if (process.argv.includes('--sweep')) {
  let best: { s: MatchSettings; v: number } | null = null;
  for (const band of [0.02, 0.04, 0.06, 0.08]) for (const floor of [0.3, 0.4, 0.5]) for (const bridge of [0, 1]) for (const maxPages of [2, 4, 6]) for (const facetPages of [1, 2, 3]) for (const facetLift of [3.0, 3.25, 3.5, 4.0]) {
    const s = { ...DEFAULT_SETTINGS, band, floor, bridge, maxPages, facetPages, facetLift };
    const r = score('cat1', s);
    const v = r.sectionRecall * 2 + r.pagePrecision + (r.gapsRight - r.falseGaps * 2) * 0.25 - (r.keptPages / r.totalPages) * 0.5;
    if (!best || v > best.v) best = { s, v };
  }
  settings = best!.s;
  console.log('best on cat1:', JSON.stringify(settings));
}

const report: Record<string, unknown> = { method, model: cache.model, dtype: cache.dtype, dims: cache.dims, settings, pageEmbedMs: cache.ms, pagesEmbedded: pages.length, modelLoadMs: loaded.loadMs };
for (const key of Object.keys(portions)) {
  console.log(`\n${key} (${portions[key].topics.length} topics, embedded in ${Math.round(portions[key].queryMs)} ms)`);
  const r = score(key, settings, true);
  console.log(summary(r));
  report[key] = { ...r, queryMs: portions[key].queryMs };
}
fs.mkdirSync(path.join(ROOT, 'screenshots'), { recursive: true });
if (!process.argv.includes('--sweep')) fs.writeFileSync(path.join(ROOT, method === 'keyword' ? 'screenshots/keyword-baseline.json' : 'screenshots/node-eval.json'), JSON.stringify(report, null, 2));
