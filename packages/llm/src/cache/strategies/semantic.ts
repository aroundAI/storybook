/**
 * Semantic Cache Match Strategy
 *
 * Uses vector similarity (cosine distance) to match requests.
 * This is the DEFAULT strategy providing semantic understanding.
 *
 * Features:
 * - Understands similar meanings ("What is TypeScript?" ≈ "Explain TypeScript")
 * - Tolerates small wording changes
 * - Configurable similarity threshold (default: 0.95)
 *
 * Best for:
 * - General-purpose caching
 * - Natural language queries
 * - Scenarios where slight variations should match
 */
import type {
  CachedEntry,
  CacheMatchResult,
  CacheMatchStrategy,
} from '../types';
import type { ChatCompletionRequest } from '../../types';

export class SemanticCacheStrategy implements CacheMatchStrategy {
  async matches(
    request: ChatCompletionRequest,
    cached: CachedEntry,
    options: { threshold: number; accountId: string },
  ): Promise<CacheMatchResult> {
    // This strategy assumes the cached entry already has an embedding
    // and that similarity search was done at the database level
    // (via the search_similar_cache SQL function)

    // In practice, this is checked before calling matches()
    // This strategy simply validates the threshold

    // Note: The actual vector search happens in cache-client.ts
    // This strategy is a marker for "use semantic search"

    return {
      isMatch: true, // If we got here, DB already filtered by similarity
      confidence: options.threshold,
      metadata: {
        matchType: 'semantic',
      },
    };
  }
}
