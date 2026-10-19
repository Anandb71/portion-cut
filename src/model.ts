/** Everything about the open-weight model in one place. */
export const MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX';
export const MODEL_DTYPE = 'q4' as const;
/**
 * onnx/model_no_gather_q4.onnx: the 4-bit build without the GatherBlockQuantized op,
 * which onnxruntime-web's WASM backend cannot run. Node and the browser both use it.
 */
export const MODEL_FILE = 'model_no_gather';
/** Matryoshka size kept for pages and topics. */
export const EMBED_DIMS = 256;
/** Tokens per page that reach the model. Most textbook pages fit. */
export const MAX_TOKENS = 512;

/** EmbeddingGemma prompt formats from the model card. */
export const QUERY_PREFIX = 'task: search result | query: ';
export const DOCUMENT_PREFIX = 'title: none | text: ';

export function asQuery(text: string): string {
  return QUERY_PREFIX + text;
}

export function asDocument(text: string): string {
  return DOCUMENT_PREFIX + text;
}
