/**
 * Cache Extensibility Types
 *
 * Provides interfaces for customizing caching behavior.
 * Apps can implement these to add custom matching logic, key generation,
 * and metadata extraction without modifying the core caching system.
 */
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';

/**
 * Cached entry from database
 */
export interface CachedEntry {
  id: string;
  accountId: string;
  promptHash: string;
  promptEmbedding: number[];
  request: ChatCompletionRequest;
  response: ChatCompletionResponse;
  embeddingProvider: string;
  embeddingModel: string;
  provider: string;
  model: string;
  tokensUsed: number;
  cost: number;
  hitCount: number;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string | null;
  customMetadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Match result from cache strategy
 */
export interface CacheMatchResult {
  /**
   * Whether the request matches the cached entry
   */
  isMatch: boolean;

  /**
   * Confidence score (0-1) of the match
   * - 1.0 = exact match
   * - 0.95+ = high confidence semantic match
   * - 0.75-0.95 = medium confidence (e.g., structural similarity)
   * - <0.75 = low confidence
   */
  confidence: number;

  /**
   * Optional metadata about the match
   */
  metadata?: {
    matchType?: 'exact' | 'semantic' | 'structural' | 'analogical' | 'hybrid';
    distance?: number;
    [key: string]: unknown;
  };
}

/**
 * Cache key components
 */
export interface CacheKey {
  /**
   * Hash of the canonical request representation
   */
  hash: string;

  /**
   * Canonical representation used to generate the hash
   * Only includes fields that affect the response
   */
  canonical: Record<string, unknown>;

  /**
   * Optional embedding for semantic search
   */
  embedding?: number[];
}

/**
 * Cache Match Strategy
 *
 * Defines how to determine if a request matches a cached entry.
 * Apps can implement custom matching logic:
 * - Exact match (fastest, strictest)
 * - Semantic match (default, uses vector similarity)
 * - Structural match (pattern-based, for cross-domain)
 * - Hybrid match (combines multiple strategies)
 *
 * @example
 * ```typescript
 * class ExactMatchStrategy implements CacheMatchStrategy {
 *   matches(request, cached, options) {
 *     return {
 *       isMatch: hash(request) === cached.promptHash,
 *       confidence: 1.0
 *     };
 *   }
 * }
 * ```
 */
export interface CacheMatchStrategy {
  /**
   * Determine if a request matches a cached entry
   *
   * @param request - Current LLM request
   * @param cached - Cached entry from database
   * @param options - Cache configuration options
   * @returns Match result with confidence score
   */
  matches(
    request: ChatCompletionRequest,
    cached: CachedEntry,
    options: { threshold: number; accountId: string },
  ): Promise<CacheMatchResult> | CacheMatchResult;
}

/**
 * Cache Key Generator
 *
 * Defines how to generate cache keys from requests.
 * Apps can customize which fields are included in the key.
 *
 * @example
 * ```typescript
 * class StrictKeyGenerator implements CacheKeyGenerator {
 *   generateKey(request) {
 *     // Include ALL fields for exact matching
 *     return {
 *       hash: hash(JSON.stringify(request)),
 *       canonical: request
 *     };
 *   }
 * }
 * ```
 */
export interface CacheKeyGenerator {
  /**
   * Generate cache key from request
   *
   * @param request - LLM request
   * @returns Cache key with hash and canonical representation
   */
  generateKey(request: ChatCompletionRequest): CacheKey;
}

/**
 * Cache Metadata Extractor
 *
 * Extracts custom metadata from requests and responses.
 * Apps can store additional data for custom filtering/matching.
 *
 * @example
 * ```typescript
 * class IndustryMetadataExtractor implements CacheMetadataExtractor {
 *   extractMetadata(request, response) {
 *     return {
 *       industry: detectIndustry(request),
 *       domain: detectDomain(request),
 *       pattern_type: extractPattern(request)
 *     };
 *   }
 *
 *   extractTags(request, response) {
 *     return ['sports', 'coaching', 'metrics'];
 *   }
 * }
 * ```
 */
export interface CacheMetadataExtractor {
  /**
   * Extract custom metadata from request and response
   *
   * This metadata is stored in the database and can be used for:
   * - Custom filtering in cache searches
   * - Analytics and reporting
   * - Cross-domain transfer logic
   *
   * @param request - LLM request
   * @param response - LLM response
   * @returns Custom metadata object
   */
  extractMetadata(
    request: ChatCompletionRequest,
    response: ChatCompletionResponse,
  ): Record<string, unknown>;

  /**
   * Extract tags from request and response
   *
   * Tags are stored as an array and can be used for:
   * - Quick filtering
   * - Categorization
   * - Analytics
   *
   * @param request - LLM request
   * @param response - LLM response
   * @returns Array of tag strings
   */
  extractTags(
    request: ChatCompletionRequest,
    response: ChatCompletionResponse,
  ): string[];
}

/**
 * Extended cache options with extensibility support
 */
export interface ExtendedCacheOptions {
  /**
   * Enable/disable caching
   */
  enabled: boolean;

  /**
   * Similarity threshold (0-1)
   * Higher = more similar required for cache hit
   */
  threshold: number;

  /**
   * Time to live in seconds (optional)
   */
  ttl?: number;

  /**
   * Account ID for multi-tenancy
   */
  accountId: string;

  /**
   * Custom cache match strategy (optional)
   * Defaults to semantic matching if not provided
   */
  strategy?: CacheMatchStrategy;

  /**
   * Custom cache key generator (optional)
   * Defaults to standard key generation if not provided
   */
  keyGenerator?: CacheKeyGenerator;

  /**
   * Custom metadata extractor (optional)
   * If provided, custom metadata and tags are stored with cache entries
   */
  metadataExtractor?: CacheMetadataExtractor;
}
