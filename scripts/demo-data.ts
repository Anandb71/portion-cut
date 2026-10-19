// Write the ?demo=1 data: page vectors for the sample book and query vectors for the sample portions.
// Run `npm run embed:book` first. Vectors come from the same model and settings as the app.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ROOT, embedQuery, ensureBook, loadModel, readBook } from './lib';
import { parsePortion } from '../src/portion';
import { SAMPLE_BOOK, SAMPLE_PORTIONS } from '../src/samples';

const cache = JSON.parse(fs.readFileSync(path.join(CACHE, 'page-vectors.json'), 'utf8'));
const book = await readBook(await ensureBook());
const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
const out = path.join(ROOT, 'public/demo');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'book.json'),
  JSON.stringify({
    name: SAMPLE_BOOK.name,
    model: cache.model,
    dtype: cache.dtype,
    dims: cache.dims,
    numPages: cache.numPages,
    embedMs: Math.round(cache.ms),
    sections: book.outline,
    pages: cache.pages.map((p: { page: number; vector: number[] }) => ({ page: p.page, vector: round(p.vector) })),
  }),
);
const loaded = await loadModel();
const queries: Record<string, number[]> = {};
for (const text of Object.values(SAMPLE_PORTIONS)) {
  for (const topic of parsePortion(text)) {
    for (const q of [topic.query, ...topic.facets]) {
      if (!queries[q]) queries[q] = round(Array.from(await embedQuery(loaded, q)));
    }
  }
}
fs.writeFileSync(path.join(out, 'queries.json'), JSON.stringify(queries));
console.log(`demo: ${cache.pages.length} pages, ${Object.keys(queries).length} queries`);
