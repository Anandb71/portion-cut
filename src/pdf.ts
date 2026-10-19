import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cleanPageText, joinTextItems, type PageText } from './pages';
import { sectionsFromOutline, type OutlineEntry } from './outline';
import type { Section } from './match';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface BookText {
  numPages: number;
  pages: PageText[];
  sections: Section[];
}

export async function readPdf(data: ArrayBuffer, onPage?: (done: number, total: number) => void): Promise<BookText> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const labels = await doc.getPageLabels().catch(() => null);
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = cleanPageText(joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>));
    pages.push({ page: i, label: labels?.[i - 1] || String(i), text });
    page.cleanup();
    onPage?.(i, doc.numPages);
  }
  const entries: OutlineEntry[] = [];
  const outline = (await doc.getOutline().catch(() => null)) ?? [];
  const walk = async (items: typeof outline) => {
    for (const item of items) {
      try {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        if (dest && dest[0]) entries.push({ title: item.title, page: (await doc.getPageIndex(dest[0] as never)) + 1 });
      } catch {
        // A broken bookmark is skipped; matching still works page by page.
      }
      if (item.items?.length) await walk(item.items);
    }
  };
  await walk(outline);
  const numPages = doc.numPages;
  await doc.destroy();
  return { numPages, pages, sections: sectionsFromOutline(entries, numPages) };
}

/** Build a new PDF that holds only the kept pages, in book order. */
export async function cutPdf(data: ArrayBuffer, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(data.slice(0), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, pages.map((page) => page - 1));
  for (const page of copied) out.addPage(page);
  out.setTitle('Portion Cut');
  out.setProducer('Portion Cut');
  return out.save();
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
