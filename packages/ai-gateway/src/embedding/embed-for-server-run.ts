/**
 * Embeddings for a server run (FILM-1902): the Voyage embedder, reachable
 * only with a run that is an open server run. The worker's context builder
 * recalls related episodes with it; in external mode prepare reads the
 * stored episode_embeddings only, and never asks for a new vector.
 *
 * No key, no embedder: `serverEmbedder` returns null and the caller falls
 * back to sequential context, as the worker always has.
 */
import type { RunHandle } from '@kit/generation';

import { recordUsage } from '../executors/usage';
import { assertServerRunOpen } from '../guard';
import { requireRun } from '../run-context';
import {
  type Embedder,
  VOYAGE_EMBEDDING_MODEL,
  createVoyageEmbedder,
} from './voyage-embedder';

export interface EmbedOptions {
  /** The run this embedding is for; defaults to the run in scope */
  run?: RunHandle;
  apiKey?: string | undefined;
  fetchImpl?: Parameters<typeof createVoyageEmbedder>[0]['fetchImpl'];
}

/**
 * An `Embedder` whose every call first checks the run. Null when no key is
 * configured, so callers keep their sequential fallback.
 */
export function serverEmbedder(options: EmbedOptions = {}): Embedder | null {
  const run = requireRun('embedding', options.run);
  const embedder = createVoyageEmbedder({
    apiKey: options.apiKey ?? process.env.VOYAGE_API_KEY,
    fetchImpl: options.fetchImpl,
    // One usage row per request, with the run's id (FILM-1902). Voyage
    // prices are not in @kit/llm's table, so the cost columns stay null:
    // "cannot measure", never 0.
    onRequest: (report) =>
      recordUsage(run, {
        templateSlug: 'embedding',
        operationName: 'embedding',
        llmProvider: 'voyage',
        llmModel: VOYAGE_EMBEDDING_MODEL,
        promptTokens: report.totalTokens ?? 0,
        completionTokens: 0,
        totalTokens: report.totalTokens ?? 0,
        latencyMs: report.latencyMs,
        status: report.status,
        errorCode: report.errorCode,
        errorMessage: report.errorMessage,
        requestConfig: {
          inputType: report.inputType,
          inputCount: report.inputCount,
        },
        responseMetadata: { tokensReported: report.totalTokens !== null },
      }),
  });

  if (!embedder) return null;

  return {
    model: embedder.model,
    embedDocuments: async (texts) => {
      await assertServerRunOpen(run);
      return embedder.embedDocuments(texts);
    },
    embedQuery: async (text) => {
      await assertServerRunOpen(run);
      return embedder.embedQuery(text);
    },
  };
}

/** Document vectors for `texts`, for the run; throws without a key. */
export async function embedForServerRun(
  run: RunHandle,
  texts: string[],
  options: Omit<EmbedOptions, 'run'> = {},
): Promise<number[][]> {
  const embedder = serverEmbedder({ ...options, run });

  if (!embedder) {
    throw new Error('No embedding model configured (VOYAGE_API_KEY unset)');
  }

  return embedder.embedDocuments(texts);
}
