import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { cleanPageText, joinTextItems, skipReason, type PageText } from '../src/pages';
import { asDocument, asQuery, EMBED_DIMS, MAX_TOKENS, MODEL_DTYPE, MODEL_FILE, MODEL_ID } from '../src/model';
import { truncateAndNormalize, type Section as RangeSection } from '../src/match';
import { sectionsFromOutline, type OutlineEntry } from '../src/outline';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const CACHE = path.join(ROOT, '.cache');
export const BOOK_URL =
  'https://assets.openstax.org/oscms-prodcms/media/documents/Introduction_to_Python_Programming-WEB.pdf';
export const BOOK_PATH = path.join(CACHE, 'python.pdf');

env.cacheDir = path.join(CACHE, 'hf');

export async function ensureBook(): Promise<Uint8Array> {
  if (!fs.existsSync(BOOK_PATH)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const response = await fetch(BOOK_URL);
    if (!response.ok) throw new Error(`Book download failed: ${response.status}`);
    fs.writeFileSync(BOOK_PATH, Buffer.from(await response.arrayBuffer()));
  }
  return new Uint8Array(fs.readFileSync(BOOK_PATH));
}

export interface Section {
  id: string;
  title: string;
  start: number;
  end: number;
}

export async function readBook(data: Uint8Array) {
  const doc = await getDocument({ data: data.slice() }).promise;
  const labels = await doc.getPageLabels();
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = cleanPageText(joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>));
    pages.push({ page: i, label: labels?.[i - 1] ?? String(i), text });
  }
  const { sections, outline } = await readSections(doc);
  return { numPages: doc.numPages, pages, sections, outline };
}

async function readSections(
  doc: Awaited<ReturnType<typeof getDocument>['promise']>,
): Promise<{ sections: Section[]; outline: RangeSection[] }> {
  const outline = (await doc.getOutline()) ?? [];
  const flat: OutlineEntry[] = [];
  const walk = async (items: typeof outline) => {
    for (const item of items) {
      if (item.dest) {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        if (dest) flat.push({ title: item.title, page: (await doc.getPageIndex(dest[0] as never)) + 1 });
      }
      if (item.items?.length) await walk(item.items);
    }
  };
  await walk(outline);
  const numbered = flat.filter((entry) => /^\d+\.\d+\s/.test(entry.title));
  const anchors = [...flat].sort((a, b) => a.page - b.page);
  const sections = numbered.map((entry) => {
    const next = anchors.find((other) => other.page > entry.page);
    return {
      id: entry.title.split(' ')[0],
      title: entry.title,
      start: entry.page,
      end: next ? next.page - 1 : doc.numPages,
    };
  });
  return { sections, outline: sectionsFromOutline(flat, doc.numPages) };
}

export async function loadModel() {
  const started = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: MODEL_DTYPE, model_file_name: MODEL_FILE });
  return { tokenizer, model, loadMs: performance.now() - started };
}

type Loaded = Awaited<ReturnType<typeof loadModel>>;

export async function embed(loaded: Loaded, text: string): Promise<Float32Array> {
  const inputs = loaded.tokenizer([text], { truncation: true, max_length: MAX_TOKENS });
  const output = await loaded.model(inputs);
  const data = output.sentence_embedding.data as Float32Array;
  return truncateAndNormalize(data, EMBED_DIMS);
}

export const embedPage = (loaded: Loaded, text: string) => embed(loaded, asDocument(text));
export const embedQuery = (loaded: Loaded, text: string) => embed(loaded, asQuery(text));

export function usable(page: PageText): boolean {
  return skipReason(page.text) === null;
}
