/**
 * Exact Match Cache Strategy
 *
 * Requires perfect match of request hash.
 * Fastest and most strict matching strategy.
 *
 * Features:
 * - No vector similarity computation needed
 * - Instant hash-based lookups
 * - Deterministic matching
 *
 * Best for:
 * - Repeated identical queries
 * - API endpoints with fixed parameters
 * - Maximum cache hit precision
 * - Performance-critical applications
 *
 * Trade-offs:
 * - Won't match semantically similar queries
 * - Small changes = cache miss
 *
 * @example
 * ```typescript
 * const llm = createCachedLLMClient(
 *   undefined,
 *   {
 *     enabled: true,
 *     strategy: new ExactMatchStrategy()
 *   },
 *   supabase,
 *   accountId
 * );
 * ```
 */
import type {
  CachedEntry,
  CacheMatchResult,
  CacheMatchStrategy,
} from '../types';
import type { ChatCompletionRequest } from '../../types';

export class ExactMatchStrategy implements CacheMatchStrategy {
  matches(
    request: ChatCompletionRequest,
    cached: CachedEntry,
    options: { threshold: number; accountId: string },
  ): CacheMatchResult {
    // Generate hash of current request
    const currentHash = this.generateHash(request);

    // Compare with cached entry's hash
    const isMatch = currentHash === cached.promptHash;

    return {
      isMatch,
      confidence: isMatch ? 1.0 : 0.0,
      metadata: {
        matchType: 'exact',
        currentHash,
        cachedHash: cached.promptHash,
      },
    };
  }

  /**
   * Generate deterministic hash from request
   *
   * Includes only fields that affect the response:
   * - messages
   * - temperature
   * - maxTokens
   * - topP
   */
  private generateHash(request: ChatCompletionRequest): string {
    const canonical = {
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      topP: request.topP,
    };

    // Simple base64 hash (in production, consider crypto.subtle.digest)
    return Buffer.from(JSON.stringify(canonical)).toString('base64');
  }
}
