# Portion Cut

Paste your exam portion, drop the textbook PDF, and Portion Cut tells you which pages to read. It also builds a smaller PDF with only those pages, and it says plainly when a syllabus line is probably not in the book at all.

Everything runs in the browser tab. The PDF is never uploaded. There is no backend and no API key.

Live: https://anandb71.github.io/portion-cut/ (add `?demo=1` to try it without downloading the model)

## Why an open-weight model, on the device

The matching is done by [EmbeddingGemma 300M](https://huggingface.co/google/embeddinggemma-300m), Google's open-weight embedding model, using the 4-bit ONNX build from [`onnx-community/embeddinggemma-300m-ONNX`](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) and [Transformers.js](https://huggingface.co/docs/transformers.js) on WebAssembly.

- **The textbook stays with you.** Course PDFs are often shared files you should not be pushing to someone else's server. Here the text is pulled out with pdf.js in the tab, embedded in a Web Worker, and stored only in this browser's IndexedDB.
- **No per-page bill.** A 400-page book is 400 embedding calls. With the weights on your machine that costs nothing, today or the night before the next exam.
- **Works offline after the first visit.** The model (about 220 MB) downloads once and is cached by the browser. A small service worker keeps the app shell available.
- **Open weights made the details possible.** Matryoshka truncation to 256 dimensions keeps the per-book cache small. When the default 4-bit file used an operator the WebAssembly runtime does not support, I could switch to the `model_no_gather_q4` file in the same repo instead of waiting on a vendor.

## How it works

1. **Read.** pdf.js extracts text from each page. Blank pages, the table of contents, and the index are skipped by simple rules. PDF bookmarks are turned into page ranges.
2. **Embed.** Each page goes through EmbeddingGemma with its document prompt (`title: none | text: …`), truncated to 512 tokens and to 256 dimensions. This is the slow part. The vectors are cached per book, so the next portion for the same book is instant.
3. **Match.** Each syllabus line is embedded with the query prompt. Comma lists are also split into facets (`List: slicing, comprehensions` becomes `List slicing`, `List comprehensions`) so each facet can find its own pages.
4. **Decide, with plain rules:**
   - A line is reported as *probably not in this book* when its best page does not stand out: `(best − mean) / stdev` over all pages is below 3.35.
   - Otherwise the line keeps its pages within 0.08 of its best score (up to 6), plus up to 3 best pages per facet.
   - Kept pages are snapped to their whole bookmarked section, because you read sections, not single pages.
5. **Use it.** You get a reading list with page ranges and section names, a copyable checklist, and a cut PDF made with pdf-lib in the tab.

The model only produces similarity scores. Everything that turns scores into a reading list is in [`src/match.ts`](src/match.ts) and covered by unit tests.

## How well it works

Measured on one free textbook, *Introduction to Python Programming* (OpenStax, 2024, 397 pages), with two portions copied verbatim from the public BCSE101E Python syllabus. The ground truth was labelled by hand from the book's contents before running the model. See [`fixtures/`](fixtures/).

Settings were tuned on Modules 3–5 only. Modules 6–7 is the held-out check.

| | Modules 3–5 (tuning) | Modules 6–7 (held out) |
|---|---|---|
| Pages to read | 99 of 397 | 75 of 397 |
| Needed sections found | 18 of 21 | 12 of 16 |
| Kept pages that are on topic | 95% | 89% |
| "Not in this book" lines flagged | 2 of 2 (sets, regular expressions) | 1 of 1 (arbitrary arguments) |
| Lines wrongly flagged as missing | 0 | 0 |

A keyword (BM25) baseline using the same page rules, tuned the same way, found 8 of 16 needed sections on the held-out portion, with 65% of its kept pages on topic, and flagged none of the 3 missing lines. Run it with `npm run eval -- --keyword`.

The not-in-book threshold was chosen after looking at scores from both portions, so treat those 3 of 3 as a fit, not a test. One book and two portions is a small sample.

## Speed

On my test machine (headless Chrome, CPU only), the first read of the 397-page book took the times recorded in [`screenshots/browser-real-1.json`](screenshots/browser-real-1.json). With cross-origin isolation the WebAssembly backend uses up to 4 threads. GitHub Pages cannot send the needed headers, so the service worker adds them and the first visit reloads once. Browsers that cannot be isolated fall back to one thread, which is several times slower. Later cuts of the same book skip this step.

## Run it

```bash
npm install
npm test
npm run dev
```

`?demo=1` loads page vectors for the sample book and query vectors for the two sample portions from `public/demo/`. They were computed by the same model with the same settings (`npm run demo:data`). Demo mode is labeled on the page, works only with the sample portions, and cannot build a cut PDF because it has no PDF.

Reproduce the numbers:

```bash
npm run embed:book          # downloads the OpenStax PDF into .cache/ and embeds every page
npm run eval                # model results on both portions
npm run eval -- --keyword   # BM25 baseline
npm run eval -- --sweep     # the settings search on Modules 3-5
```

Browser proof (needs Chrome): `npm run build && npx vite preview`, then `node scripts/browser-proof.mjs real http://localhost:4173/ .cache/python.pdf 1`.

## Limits

- Scanned PDFs with no text layer are refused. There is no OCR.
- Page numbers are PDF page numbers unless the PDF carries printed page labels.
- Section snapping needs PDF bookmarks. Without them, matching is page by page.
- Phones may pause a background tab. Keep the tab open while it reads the book.

## Deploy

Pushing to `main` runs the tests, builds `dist`, and publishes it with GitHub Actions. In the repository settings, set Pages to **GitHub Actions**.

## Credits

- Sample textbook: *Introduction to Python Programming*, OpenStax, Rice University. Free at https://openstax.org/details/books/introduction-python-programming. Not included in this repo.
- Sample portions: the BCSE101E syllabus as listed at https://github.com/durgeshbhagat/Computer_Programming_Python_BCSE101E.
- EmbeddingGemma is provided under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).

## License

MIT. Copyright 2026 Anand Biju.
