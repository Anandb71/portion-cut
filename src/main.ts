import './style.css';
import { cacheKey, loadBook, saveBook, type CachedBook } from './cache';
import { createWorkerEmbedder, type LoadProgress } from './embedder';
import { pageLabeler, readingList } from './export';
import { cutPortion, formatRanges, percentSkipped, toRanges, type PageVector, type PortionCut, type Vector } from './match';
import { EMBED_DIMS, MAX_TOKENS, MODEL_FILE, MODEL_ID } from './model';
import { skipReason } from './pages';
import { parsePortion, type Topic } from './portion';
import { SAMPLE_BOOK, SAMPLE_PORTIONS } from './samples';

const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';

function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Portion Cut is missing #${id}.`);
  return element;
}

const drop = $('drop');
const fileInput = $('file') as HTMLInputElement;
const bookCopy = $('book-copy');
const bookInfo = $('book-info');
const portionInput = $('portion') as HTMLTextAreaElement;
const cutButton = $('cut') as HTMLButtonElement;
const progressBox = $('progress');
const bar = $('bar');
const progressText = $('progress-text');
const statusEl = $('status');
const results = $('results');
const summaryEl = $('summary');
const topicsEl = $('topics');
const downloadButton = $('download') as HTMLButtonElement;
const copyButton = $('copy') as HTMLButtonElement;
const downloadNote = $('download-note');
const netCount = $('net-count');

interface Book {
  name: string;
  data: ArrayBuffer | null;
  cached: CachedBook;
}

let book: Book | null = null;
let busy = false;
let lastCut: PortionCut | null = null;
let modelReady = false;
let requestsAfterReady = 0;
let demoQueries: Record<string, number[]> = {};

const embedder = demo
  ? null
  : createWorkerEmbedder(threadCount(), (count) => {
      requestsAfterReady += count;
      netCount.textContent = String(requestsAfterReady);
    });

$('demo').hidden = !demo;
if (demo) {
  bookCopy.textContent = 'Demo mode uses the sample textbook. No PDF needed.';
  netCount.textContent = '0';
}

watchNetwork();
portionInput.value = demo ? SAMPLE_PORTIONS.cat1 : '';
$('sample1').addEventListener('click', () => setPortion(SAMPLE_PORTIONS.cat1));
$('sample2').addEventListener('click', () => setPortion(SAMPLE_PORTIONS.cat2));
portionInput.addEventListener('input', refresh);

drop.addEventListener('click', () => !busy && !demo && fileInput.click());
drop.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && !busy && !demo) {
    event.preventDefault();
    fileInput.click();
  }
});
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  const file = event.dataTransfer?.files?.[0];
  if (file && !busy && !demo) void openFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
});
cutButton.addEventListener('click', () => void runCut());
copyButton.addEventListener('click', () => void copyList());
downloadButton.addEventListener('click', () => void downloadCut());

if (demo) void loadDemo();
refresh();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js').then(async () => {
    // The service worker adds cross-origin isolation headers so the model can use
    // several CPU threads. The very first visit needs one reload to pick them up.
    await navigator.serviceWorker.ready;
    if (!self.crossOriginIsolated && !sessionStorage.getItem('pc-reloaded')) {
      sessionStorage.setItem('pc-reloaded', '1');
      location.reload();
    }
  }).catch(() => undefined);
}

function setPortion(text: string) {
  portionInput.value = text;
  refresh();
}

function refresh() {
  cutButton.disabled = busy || !book || parsePortion(portionInput.value).length === 0;
}

function setStatus(text: string, tone: 'info' | 'error' = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function showProgress(fraction: number | null, text: string) {
  progressBox.hidden = false;
  bar.style.width = fraction === null ? '100%' : `${Math.max(2, Math.min(100, fraction * 100)).toFixed(1)}%`;
  bar.classList.toggle('busy', fraction === null);
  progressText.textContent = text;
}

function hideProgress() {
  progressBox.hidden = true;
}

async function openFile(file: File) {
  if (busy) return;
  busy = true;
  refresh();
  results.hidden = true;
  setStatus('');
  try {
    const data = await file.arrayBuffer();
    const { sha256, readPdf } = await import('./pdf');
    const hash = await sha256(data);
    const key = cacheKey(hash, `${MODEL_ID}/${MODEL_FILE}`, EMBED_DIMS, MAX_TOKENS);
    const known = await loadBook(key);
    showProgress(0, 'Reading the text out of the PDF…');
    const text = await readPdf(data, (done, total) => showProgress(done / total, `Reading text: page ${done} of ${total}`));
    hideProgress();
    const usable = text.pages.filter((page) => skipReason(page.text) === null);
    if (usable.length === 0) {
      throw new Error('This PDF has no text layer (it may be a scan). Portion Cut needs selectable text.');
    }
    const cached: CachedBook = known ?? {
      key,
      name: file.name,
      numPages: text.numPages,
      labels: text.pages.map((page) => page.label),
      sections: text.sections,
      pages: [],
      vectors: new Float32Array(0),
      dims: EMBED_DIMS,
      embedMs: 0,
      savedAt: '',
    };
    book = { name: file.name, data, cached };
    pendingText = usable.map((page) => ({ page: page.page, text: page.text }));
    bookCopy.textContent = file.name;
    bookInfo.textContent =
      `${text.numPages} pages, ${usable.length} with text, ${text.sections.length} bookmarks.` +
      (known ? ' This book was already read on this device, so the cut is instant.' : ' The first cut reads every page with the model; later cuts of the same book are instant.');
  } catch (error) {
    book = null;
    hideProgress();
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    busy = false;
    refresh();
  }
}

let pendingText: Array<{ page: number; text: string }> = [];

async function ensurePageVectors(current: Book): Promise<void> {
  if (current.cached.pages.length > 0 || !embedder) return;
  const wake = await requestWake();
  try {
    showProgress(null, 'Loading EmbeddingGemma (about 220 MB the first time, cached after that)…');
    const loadMs = await embedder.load((update) => reportLoad(update));
    modelReady = true;
    requestsAfterReady = 0;
    netCount.textContent = '0';
    const started = performance.now();
    const total = pendingText.length;
    const vectors = new Float32Array(total * EMBED_DIMS);
    for (let i = 0; i < total; i += 1) {
      const [vector] = await embedder.embed('document', [pendingText[i].text]);
      vectors.set(vector, i * EMBED_DIMS);
      const elapsed = performance.now() - started;
      const left = (elapsed / (i + 1)) * (total - i - 1);
      showProgress((i + 1) / total, `Reading page ${i + 1} of ${total} with the model on ${plural(threadCount(), 'CPU thread')} · about ${formatDuration(left)} left. You can lie down.`);
    }
    const embedMs = performance.now() - started;
    current.cached = {
      ...current.cached,
      pages: pendingText.map((page) => page.page),
      vectors,
      embedMs,
      savedAt: new Date().toISOString(),
    };
    await saveBook(current.cached);
    console.info(`[portion-cut] model ready in ${Math.round(loadMs)} ms; embedded ${total} pages in ${Math.round(embedMs)} ms on ${threadCount()} thread(s); isolated=${self.crossOriginIsolated}`);
  } finally {
    await wake?.release().catch(() => undefined);
  }
}

async function runCut() {
  if (!book || busy) return;
  const topics = parsePortion(portionInput.value);
  if (topics.length === 0) return;
  busy = true;
  refresh();
  setStatus('');
  const t0 = performance.now();
  try {
    await ensurePageVectors(book);
    showProgress(null, 'Matching your portion…');
    const { lines, facets } = await embedTopics(topics);
    const pages = pageVectors(book.cached);
    const cut = cutPortion(topics, lines, pages, book.cached.numPages, undefined, book.cached.sections, facets);
    lastCut = cut;
    hideProgress();
    render(cut, book.cached);
    const ms = performance.now() - t0;
    setStatus(`Done in ${formatDuration(ms)}.`);
    document.body.dataset.cutMs = String(Math.round(ms));
    document.body.dataset.embedMs = String(Math.round(book.cached.embedMs));
    document.body.dataset.threads = String(threadCount());
  } catch (error) {
    hideProgress();
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    busy = false;
    refresh();
  }
}

async function embedTopics(topics: Topic[]): Promise<{ lines: Vector[]; facets: Vector[][] }> {
  if (demo) {
    const lookup = (text: string) => {
      const vector = demoQueries[text];
      if (!vector) throw new Error(`Demo mode only has vectors for the two sample portions. "${text}" is not one of them. Open the page without ?demo=1 to run the model on your own portion.`);
      return vector;
    };
    return { lines: topics.map((t) => lookup(t.query)), facets: topics.map((t) => t.facets.map(lookup)) };
  }
  if (!embedder) throw new Error('Model is not available.');
  await embedder.load((update) => reportLoad(update));
  modelReady = true;
  const lines = await embedder.embed('query', topics.map((t) => t.query));
  const facets: Vector[][] = [];
  for (const topic of topics) facets.push(topic.facets.length ? await embedder.embed('query', topic.facets) : []);
  return { lines, facets };
}

function pageVectors(cached: CachedBook): PageVector[] {
  return cached.pages.map((page, index) => ({
    page,
    label: cached.labels[page - 1] ?? String(page),
    vector: cached.vectors.subarray(index * cached.dims, (index + 1) * cached.dims),
  }));
}

function render(cut: PortionCut, cached: CachedBook) {
  const label = pageLabeler(cached.labels);
  results.hidden = false;
  summaryEl.innerHTML = '';
  const big = document.createElement('strong');
  big.textContent = `Read ${cut.pages.length} of ${cut.totalPages} pages.`;
  const small = document.createElement('span');
  small.textContent = ` That skips ${percentSkipped(cut)}% of the book. ${cut.covered} of ${cut.matches.length} topics found` +
    (cut.missing ? `; ${cut.missing} probably not in this book.` : '.');
  summaryEl.append(big, small);

  topicsEl.innerHTML = '';
  for (const match of cut.matches) {
    const item = document.createElement('li');
    item.className = match.covered ? 'found' : 'missing';
    const head = document.createElement('div');
    head.className = 'topic-head';
    const title = document.createElement('span');
    title.className = 'topic-text';
    title.textContent = match.topic.text;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = match.covered ? `${match.pages.length} pp.` : 'not in this book?';
    head.append(title, badge);
    item.append(head);
    if (match.topic.module) {
      const module = document.createElement('p');
      module.className = 'module';
      module.textContent = match.topic.module;
      item.append(module);
    }
    const detail = document.createElement('p');
    detail.className = 'pages';
    if (match.covered) {
      detail.textContent = `Pages ${formatRanges(toRanges(match.pages), label)}`;
    } else {
      const guess = match.top[0];
      detail.textContent = `Nothing stood out. The closest page was ${guess ? label(guess.page) : '–'}, and it scored like the rest of the book. Check another source for this one.`;
    }
    item.append(detail);
    if (match.sections.length) {
      const sections = document.createElement('p');
      sections.className = 'sections';
      sections.textContent = match.sections.join(' · ');
      item.append(sections);
    }
    const why = document.createElement('p');
    why.className = 'why';
    why.textContent = `Best match ${match.best.toFixed(2)}, ${match.lift.toFixed(1)}σ above the book's average page.`;
    item.append(why);
    topicsEl.append(item);
  }
  downloadButton.disabled = !book?.data || cut.pages.length === 0;
  downloadNote.textContent = book?.data
    ? 'The cut PDF is built in this tab from your own file.'
    : `Demo mode has no PDF to cut. Get the free book from ${SAMPLE_BOOK.url} and run it without ?demo=1.`;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function downloadCut() {
  if (!book?.data || !lastCut) return;
  const { cutPdf } = await import('./pdf');
  const bytes = await cutPdf(book.data, lastCut.pages);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = book.name.replace(/\.pdf$/i, '') + ' - portion.pdf';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyList() {
  if (!lastCut || !book) return;
  const text = readingList(lastCut, pageLabeler(book.cached.labels), book.name);
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = 'Copied';
  } catch {
    copyButton.textContent = 'Copy failed';
  }
  setTimeout(() => (copyButton.textContent = 'Copy reading list'), 1500);
}

async function loadDemo() {
  busy = true;
  refresh();
  try {
    const [bookResponse, queryResponse] = await Promise.all([fetch('./demo/book.json'), fetch('./demo/queries.json')]);
    const data = (await bookResponse.json()) as {
      name: string;
      numPages: number;
      sections: CachedBook['sections'];
      dims: number;
      embedMs: number;
      pages: Array<{ page: number; vector: number[] }>;
    };
    demoQueries = (await queryResponse.json()) as Record<string, number[]>;
    const vectors = new Float32Array(data.pages.length * data.dims);
    data.pages.forEach((page, index) => vectors.set(page.vector, index * data.dims));
    book = {
      name: data.name,
      data: null,
      cached: {
        key: 'demo',
        name: data.name,
        numPages: data.numPages,
        labels: Array.from({ length: data.numPages }, (_, i) => String(i + 1)),
        sections: data.sections,
        pages: data.pages.map((page) => page.page),
        vectors,
        dims: data.dims,
        embedMs: data.embedMs,
        savedAt: '',
      },
    };
    bookInfo.textContent = `${SAMPLE_BOOK.name}: ${data.numPages} pages, ${data.pages.length} with text, ${data.sections.length} bookmarks. Vectors precomputed.`;
  } catch (error) {
    setStatus(`Could not load demo data: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    busy = false;
    refresh();
  }
}

function reportLoad(update: LoadProgress) {
  if (update.status === 'progress' && typeof update.progress === 'number' && update.file?.includes('onnx')) {
    const mb = update.total ? ` of ${Math.round(update.total / 1e6)} MB` : '';
    showProgress(update.progress / 100, `Downloading EmbeddingGemma: ${Math.round(update.progress)}%${mb}. Only the first time.`);
  }
}

function watchNetwork() {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      if (!modelReady) return;
      requestsAfterReady += list.getEntries().length;
      netCount.textContent = String(requestsAfterReady);
    });
    observer.observe({ type: 'resource', buffered: false });
  } catch {
    // Older browsers: the counter just stays blank.
  }
}

async function requestWake(): Promise<{ release(): Promise<void> } | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    return (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Threads for the WASM backend: only possible when the page is cross-origin isolated. */
function threadCount(): number {
  if (!self.crossOriginIsolated) return 1;
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(4, cores - 1));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
