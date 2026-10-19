import type { Section } from './match';

export interface CachedBook {
  key: string;
  name: string;
  numPages: number;
  labels: string[];
  sections: Section[];
  /** Pages that were embedded (skipped pages are absent). */
  pages: number[];
  /** Flattened vectors, `dims` floats per entry in `pages`. */
  vectors: Float32Array;
  dims: number;
  embedMs: number;
  savedAt: string;
}

const DB = 'portion-cut';
const STORE = 'books';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadBook(key: string): Promise<CachedBook | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as CachedBook | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function saveBook(book: CachedBook): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(book);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private windows can refuse IndexedDB. The cut still works, it just is not remembered.
  }
}

export function cacheKey(hash: string, model: string, dims: number, maxTokens: number): string {
  return `${hash}|${model}|${dims}|${maxTokens}|v1`;
}
