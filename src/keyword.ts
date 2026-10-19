// A plain keyword baseline (BM25), used only by scripts/eval.ts to check whether
// the model earns its place. The app does not use it.

const STOP = new Set('a an and are as at be by for from in into is it of on or the to with this that'.split(' '));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => word.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')));
}

export interface Bm25Index {
  docs: Array<{ id: number; tf: Map<string, number>; length: number }>;
  df: Map<string, number>;
  avgLength: number;
}

export function buildBm25(docs: Array<{ id: number; text: string }>): Bm25Index {
  const df = new Map<string, number>();
  const out = docs.map((doc) => {
    const tokens = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    return { id: doc.id, tf, length: tokens.length };
  });
  const avgLength = out.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, out.length);
  return { docs: out, df, avgLength };
}

export function bm25Scores(index: Bm25Index, query: string, k1 = 1.2, b = 0.75): Array<{ id: number; score: number }> {
  const terms = [...new Set(tokenize(query))];
  const n = index.docs.length;
  return index.docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / index.avgLength));
    }
    return { id: doc.id, score };
  });
}
