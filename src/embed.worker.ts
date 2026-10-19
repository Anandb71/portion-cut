/// <reference lib="webworker" />
import { asDocument, asQuery, EMBED_DIMS, MAX_TOKENS, MODEL_DTYPE, MODEL_FILE, MODEL_ID } from './model';
import { truncateAndNormalize } from './match';

type Request =
  | { type: 'load'; threads?: number }
  | { type: 'embed'; id: number; kind: 'query' | 'document'; texts: string[] };

type Loaded = {
  tokenizer: (texts: string[], options: Record<string, unknown>) => unknown;
  model: (inputs: unknown) => Promise<{ sentence_embedding: { data: Float32Array } }>;
};

let loading: Promise<Loaded> | null = null;

let threads = 1;

function load(): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const { AutoModel, AutoTokenizer, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const wasm = env.backends.onnx.wasm;
      if (wasm) wasm.numThreads = threads;
      const progress = (info: Record<string, unknown>) => {
        self.postMessage({ type: 'progress', status: info.status, file: info.file, progress: info.progress, loaded: info.loaded, total: info.total });
      };
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: progress });
      const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: MODEL_DTYPE, model_file_name: MODEL_FILE, progress_callback: progress });
      return { tokenizer: tokenizer as unknown as Loaded['tokenizer'], model: model as unknown as Loaded['model'] };
    })().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      threads = Math.max(1, message.threads ?? 1);
      const started = performance.now();
      await load();
      self.postMessage({ type: 'ready', ms: performance.now() - started, threads });
      watchRequests();
      return;
    }
    const loaded = await load();
    const vectors: Float32Array[] = [];
    for (const text of message.texts) {
      const input = message.kind === 'query' ? asQuery(text) : asDocument(text);
      const inputs = loaded.tokenizer([input], { truncation: true, max_length: MAX_TOKENS });
      const output = await loaded.model(inputs);
      vectors.push(truncateAndNormalize(output.sentence_embedding.data, EMBED_DIMS));
    }
    self.postMessage({ type: 'vectors', id: message.id, vectors });
  } catch (error) {
    self.postMessage({ type: 'error', id: 'id' in message ? message.id : -1, message: error instanceof Error ? error.message : String(error) });
  }
};

let watching = false;
/** Report any network request the worker makes after the model is ready. There should be none. */
function watchRequests() {
  if (watching || typeof PerformanceObserver === 'undefined') return;
  watching = true;
  try {
    new PerformanceObserver((list) => {
      self.postMessage({ type: 'net', count: list.getEntries().length });
    }).observe({ type: 'resource', buffered: false });
  } catch {
    // Not supported in this browser's workers.
  }
}
