// Embed every usable page of the fixture textbook with the real model and cache the vectors.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, ensureBook, embedPage, loadModel, readBook, usable } from './lib';
import { skipReason } from '../src/pages';
import { EMBED_DIMS, MODEL_DTYPE, MODEL_ID } from '../src/model';

const data = await ensureBook();
const book = await readBook(data);
const loaded = await loadModel();
console.log(`model ${MODEL_ID} (${MODEL_DTYPE}) loaded in ${Math.round(loaded.loadMs)} ms`);
const started = performance.now();
const out: Array<{ page: number; label: string; vector: number[] }> = [];
const skipped: Array<{ page: number; reason: string }> = [];
for (const page of book.pages) {
  if (!usable(page)) {
    skipped.push({ page: page.page, reason: skipReason(page.text) ?? '' });
    continue;
  }
  const vector = await embedPage(loaded, page.text);
  out.push({ page: page.page, label: page.label, vector: Array.from(vector, (v) => Math.round(v * 1e5) / 1e5) });
  if (out.length % 50 === 0) console.log(`  ${out.length} pages`);
}
const ms = performance.now() - started;
console.log(`embedded ${out.length} pages in ${Math.round(ms)} ms (${Math.round(ms / out.length)} ms/page); skipped ${skipped.length}`);
fs.writeFileSync(
  path.join(CACHE, 'page-vectors.json'),
  JSON.stringify({ model: MODEL_ID, dtype: MODEL_DTYPE, dims: EMBED_DIMS, numPages: book.numPages, ms, skipped, pages: out, sections: book.sections }),
);
