export interface LoadProgress {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface Embedder {
  load(onProgress?: (update: LoadProgress) => void): Promise<number>;
  embed(kind: 'query' | 'document', texts: string[]): Promise<Float32Array[]>;
}

/** Runs EmbeddingGemma in a Web Worker so the page stays responsive. */
export function createWorkerEmbedder(threads = 1, onNetwork?: (count: number) => void): Embedder {
  const worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  let ready: Promise<number> | null = null;
  let onProgress: ((update: LoadProgress) => void) | undefined;
  let readyResolve: ((ms: number) => void) | null = null;
  let readyReject: ((e: Error) => void) | null = null;

  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as { type: string; id?: number; vectors?: Float32Array[]; message?: string; ms?: number } & LoadProgress;
    if (data.type === 'progress') onProgress?.(data);
    else if (data.type === 'net') onNetwork?.((data as { count?: number }).count ?? 0);
    else if (data.type === 'ready') readyResolve?.(data.ms ?? 0);
    else if (data.type === 'vectors' && data.id !== undefined) {
      pending.get(data.id)?.resolve(data.vectors ?? []);
      pending.delete(data.id);
    } else if (data.type === 'error') {
      const error = new Error(data.message ?? 'Model error');
      if (data.id !== undefined && pending.has(data.id)) {
        pending.get(data.id)?.reject(error);
        pending.delete(data.id);
      } else {
        readyReject?.(error);
        ready = null;
      }
    }
  };

  return {
    load(progress) {
      onProgress = progress;
      if (!ready) {
        ready = new Promise<number>((resolve, reject) => {
          readyResolve = resolve;
          readyReject = reject;
        });
        worker.postMessage({ type: 'load', threads });
      }
      return ready;
    },
    embed(kind, texts) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'embed', id, kind, texts });
      });
    },
  };
}
