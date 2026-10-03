/**
 * Semantic previous-episode context (KB-35): the parts that need no schema.
 *
 * An episode is embedded from the same text the story prompt shows for it,
 * and re-embedded only when that text or the model changes, detected by a
 * content hash. Every failure falls back to sequential context: semantic
 * search must never make story generation fail.
 */
import { createHash } from 'node:crypto';

import type { Embedder } from '@kit/ai-gateway';

/** Voyage truncates long inputs itself; this keeps requests small. */
export const MAX_DOCUMENT_CHARS = 4_000;

export interface EpisodeDocumentSource {
  title: string;
  summary: string;
  keyEvents?: string[];
}

/** The text an episode is embedded from: what the prompt shows for it. */
export function episodeDocument(episode: EpisodeDocumentSource): string {
  const lines = [episode.title.trim(), episode.summary.trim()];

  if (episode.keyEvents?.length) {
    lines.push(`Key events: ${episode.keyEvents.join('; ')}`);
  }

  return lines.filter(Boolean).join('\n').slice(0, MAX_DOCUMENT_CHARS);
}

/** Changes when the text or the model changes, so either re-embeds. */
export function contentHash(model: string, document: string): string {
  return createHash('sha256').update(`${model}\n${document}`).digest('hex');
}

export interface EmbeddingCandidate {
  episodeId: string;
  document: string;
}

/**
 * The candidates whose stored hash is missing or differs, each with the hash
 * to store once embedded. Unchanged episodes are never sent to Voyage.
 */
export function episodesNeedingEmbedding(
  candidates: EmbeddingCandidate[],
  storedHashes: ReadonlyMap<string, string>,
  model: string,
): Array<EmbeddingCandidate & { hash: string }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      hash: contentHash(model, candidate.document),
    }))
    .filter(
      (candidate) => storedHashes.get(candidate.episodeId) !== candidate.hash,
    );
}

let loggedMissingKey = false;

/**
 * The embedder, or null with one log line per cold start when no key is set.
 * Tests reset the latch with `resetSemanticLogLatch`.
 */
export function embedderOrLog(embedder: Embedder | null): Embedder | null {
  if (!embedder && !loggedMissingKey) {
    loggedMissingKey = true;
    console.info('[semantic-context] VOYAGE_API_KEY not set — sequential only');
  }

  return embedder;
}

export function resetSemanticLogLatch() {
  loggedMissingKey = false;
}

/**
 * Runs a semantic step; on any failure logs one line (no text, no key) and
 * returns the fallback, so the job carries on with sequential context.
 */
export async function withSequentialFallback<T>(
  step: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const reason =
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
    console.warn(
      `[semantic-context] ${step} failed (${reason}) — sequential only`,
    );
    return fallback;
  }
}
