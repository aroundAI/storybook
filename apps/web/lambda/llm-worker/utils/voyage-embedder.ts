/**
 * Voyage embeddings for the LLM worker (KB-35).
 *
 * Worker-local on purpose: no `server-only`, no Supabase, `fetch` injected so
 * tests never reach the network. The host comes from `vendorUrl('voyage')`,
 * so a FILM-1803 stand-in serves it locally with no code change.
 *
 * No key, no embedder: `createVoyageEmbedder` returns null and callers fall
 * back to sequential context. The key is set by the owner at deploy.
 */
import { vendorUrl } from '@kit/shared/vendors';

export const VOYAGE_EMBEDDING_MODEL = 'voyage-3-large';
export const VOYAGE_EMBEDDING_DIMENSIONS = 1024;

const DEFAULT_TIMEOUT_MS = 10_000;

export interface Embedder {
  model: string;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface VoyageEmbedderOptions {
  apiKey: string | undefined;
  model?: string;
  fetchImpl?: Fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

/** Raised for any response the worker cannot use; never carries the key. */
export class VoyageEmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VoyageEmbeddingError';
  }
}

export function createVoyageEmbedder(
  options: VoyageEmbedderOptions,
): Embedder | null {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;

  const model = options.model ?? VOYAGE_EMBEDDING_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.baseUrl ?? vendorUrl('voyage')}/v1/embeddings`;

  async function embed(
    texts: string[],
    inputType: 'document' | 'query',
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model,
          input_type: inputType,
          output_dimension: VOYAGE_EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new VoyageEmbeddingError(
        `request failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }

    if (!response.ok) {
      throw new VoyageEmbeddingError(
        `HTTP ${response.status}`,
        response.status,
      );
    }

    const vectors = parseEmbeddings(await response.json().catch(() => null));

    if (vectors.length !== texts.length) {
      throw new VoyageEmbeddingError(
        `expected ${texts.length} embeddings, got ${vectors.length}`,
      );
    }

    return vectors;
  }

  return {
    model,
    embedDocuments: (texts) => embed(texts, 'document'),
    embedQuery: async (text) => {
      const [vector] = await embed([text], 'query');
      return vector!;
    },
  };
}

/**
 * Reads `{ data: [{ embedding, index }] }` in index order. Anything else —
 * a missing field, a non-number, a vector of the wrong length — is an error,
 * so a bad response is never written to the database.
 */
function parseEmbeddings(body: unknown): number[][] {
  const data =
    body && typeof body === 'object' && 'data' in body ? body.data : null;

  if (!Array.isArray(data)) {
    throw new VoyageEmbeddingError('response has no data array');
  }

  return data
    .map((item: unknown, position) => {
      const record = (item ?? {}) as { embedding?: unknown; index?: unknown };
      const index = typeof record.index === 'number' ? record.index : position;
      const embedding = record.embedding;

      if (
        !Array.isArray(embedding) ||
        embedding.length !== VOYAGE_EMBEDDING_DIMENSIONS ||
        !embedding.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw new VoyageEmbeddingError(
          `embedding ${index} is not ${VOYAGE_EMBEDDING_DIMENSIONS} finite numbers`,
        );
      }

      return { index, embedding: embedding as number[] };
    })
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
