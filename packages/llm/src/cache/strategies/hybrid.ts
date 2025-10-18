/**
 * Hybrid Cache Match Strategy
 *
 * Combines multiple matching strategies for optimal cache hit rates.
 * Uses exact matching for parameters and semantic matching for content.
 *
 * Features:
 * - Exact match on temperature, maxTokens, topP
 * - Semantic match on message content
 * - Best of both worlds: precision + flexibility
 *
 * Best for:
 * - Production environments
 * - When parameter consistency matters
 * - Balancing hit rate with accuracy
 *
 * Example:
 * - Request 1: "Explain React" with temp=0.7, maxTokens=100
 * - Request 2: "What is React?" with temp=0.7, maxTokens=100
 * - Result: ✅ MATCH (same params, similar content)
 *
 * - Request 3: "Explain React" with temp=0.9, maxTokens=100
 * - Result: ❌ MISS (different params, even with similar content)
 *
 * @example
 * ```typescript
 * const llm = createCachedLLMClient(
 *   undefined,
 *   {
 *     enabled: true,
 *     threshold: 0.95, // For semantic content matching
 *     strategy: new HybridCacheStrategy({
 *       parameterTolerance: {
 *         temperature: 0.01, // Allow 1% difference
 *         maxTokens: 10,     // Allow 10 token difference
 *       }
 *     })
 *   },
 *   supabase,
 *   accountId
 * );
 * ```
 */
import type { ChatCompletionRequest } from '../../types';
import type {
  CacheMatchResult,
  CacheMatchStrategy,
  CachedEntry,
} from '../types';

/**
 * Parameter tolerance configuration
 */
export interface ParameterTolerance {
  /**
   * Maximum difference in temperature (0-1)
   * Default: 0 (exact match)
   */
  temperature?: number;

  /**
   * Maximum difference in maxTokens
   * Default: 0 (exact match)
   */
  maxTokens?: number;

  /**
   * Maximum difference in topP (0-1)
   * Default: 0 (exact match)
   */
  topP?: number;
}

export class HybridCacheStrategy implements CacheMatchStrategy {
  private parameterTolerance: Required<ParameterTolerance>;

  constructor(options?: { parameterTolerance?: ParameterTolerance }) {
    this.parameterTolerance = {
      temperature: options?.parameterTolerance?.temperature ?? 0,
      maxTokens: options?.parameterTolerance?.maxTokens ?? 0,
      topP: options?.parameterTolerance?.topP ?? 0,
    };
  }

  async matches(
    request: ChatCompletionRequest,
    cached: CachedEntry,
    options: { threshold: number; accountId: string },
  ): Promise<CacheMatchResult> {
    // Step 1: Check if parameters match (or are within tolerance)
    const parametersMatch = this.checkParametersMatch(request, cached);

    if (!parametersMatch.isMatch) {
      // Parameters don't match - return early
      return {
        isMatch: false,
        confidence: 0.0,
        metadata: {
          matchType: 'hybrid',
          reason: 'parameters_mismatch',
          parameterDifferences: parametersMatch.differences,
        },
      };
    }

    // Step 2: If parameters match, assume semantic matching was done
    // (This strategy is used after DB-level vector search)
    // The fact that we got here means content is semantically similar

    // Calculate combined confidence
    // - Parameter match contributes 30%
    // - Semantic similarity contributes 70%
    const parameterConfidence = parametersMatch.confidence;
    const semanticConfidence = options.threshold;
    const combinedConfidence =
      parameterConfidence * 0.3 + semanticConfidence * 0.7;

    return {
      isMatch: true,
      confidence: combinedConfidence,
      metadata: {
        matchType: 'hybrid',
        parameterConfidence,
        semanticConfidence,
        combinedConfidence,
      },
    };
  }

  /**
   * Check if request parameters match cached entry parameters
   */
  private checkParametersMatch(
    request: ChatCompletionRequest,
    cached: CachedEntry,
  ): {
    isMatch: boolean;
    confidence: number;
    differences?: Record<string, { current: unknown; cached: unknown }>;
  } {
    const differences: Record<string, { current: unknown; cached: unknown }> =
      {};
    let matchCount = 0;
    let totalChecks = 0;

    // Check temperature
    if (
      request.temperature !== undefined ||
      cached.request.temperature !== undefined
    ) {
      totalChecks++;
      const currentTemp = request.temperature ?? 0.7;
      const cachedTemp = cached.request.temperature ?? 0.7;
      const tempDiff = Math.abs(currentTemp - cachedTemp);

      if (tempDiff <= this.parameterTolerance.temperature) {
        matchCount++;
      } else {
        differences.temperature = {
          current: currentTemp,
          cached: cachedTemp,
        };
      }
    }

    // Check maxTokens
    if (
      request.maxTokens !== undefined ||
      cached.request.maxTokens !== undefined
    ) {
      totalChecks++;
      const currentTokens = request.maxTokens ?? 1024;
      const cachedTokens = cached.request.maxTokens ?? 1024;
      const tokensDiff = Math.abs(currentTokens - cachedTokens);

      if (tokensDiff <= this.parameterTolerance.maxTokens) {
        matchCount++;
      } else {
        differences.maxTokens = {
          current: currentTokens,
          cached: cachedTokens,
        };
      }
    }

    // Check topP
    if (request.topP !== undefined || cached.request.topP !== undefined) {
      totalChecks++;
      const currentTopP = request.topP ?? 1.0;
      const cachedTopP = cached.request.topP ?? 1.0;
      const topPDiff = Math.abs(currentTopP - cachedTopP);

      if (topPDiff <= this.parameterTolerance.topP) {
        matchCount++;
      } else {
        differences.topP = {
          current: currentTopP,
          cached: cachedTopP,
        };
      }
    }

    const isMatch = Object.keys(differences).length === 0;
    const confidence = totalChecks > 0 ? matchCount / totalChecks : 1.0;

    return {
      isMatch,
      confidence,
      differences:
        Object.keys(differences).length > 0 ? differences : undefined,
    };
  }
}
