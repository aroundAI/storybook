/**
 * Element Prompt Caching (FILM-209)
 * Redis-backed caching for generated element prompts
 */
import 'server-only';

import { createCacheClient } from '@kit/cache';
import { getLogger } from '@kit/shared/logger';

/**
 * Cache key prefix for element prompts
 */
const CACHE_PREFIX = 'element-prompt';

/**
 * Default TTL: 24 hours in seconds
 */
const DEFAULT_TTL = 24 * 60 * 60;

/**
 * Cached prompt data structure
 */
interface CachedPrompt {
  prompt: string;
  generatedAt: string;
  wordCount: number;
}

/**
 * Build cache key for a character
 */
function buildCacheKey(characterId: string): string {
  return `${CACHE_PREFIX}:${characterId}`;
}

/**
 * Get cached element prompt for a character
 * @param characterId - Character ID
 * @returns Cached prompt or null if not found
 */
export async function getCachedPrompt(
  characterId: string,
): Promise<string | null> {
  const logger = await getLogger();
  const ctx = { name: 'element-prompt-cache', characterId };

  try {
    const cache = createCacheClient();
    const key = buildCacheKey(characterId);
    const cached = await cache.get<CachedPrompt>(key);

    if (cached) {
      logger.info({ ...ctx, cachedAt: cached.generatedAt }, 'Cache hit');
      return cached.prompt;
    }

    logger.info(ctx, 'Cache miss');
    return null;
  } catch (error) {
    logger.warn({ ...ctx, error }, 'Cache read failed');
    return null;
  }
}

/**
 * Cache an element prompt for a character
 * @param characterId - Character ID
 * @param prompt - Generated prompt
 * @param ttlSeconds - Time to live in seconds (default: 24 hours)
 */
export async function cachePrompt(
  characterId: string,
  prompt: string,
  ttlSeconds: number = DEFAULT_TTL,
): Promise<void> {
  const logger = await getLogger();
  const ctx = { name: 'element-prompt-cache', characterId };

  try {
    const cache = createCacheClient();
    const key = buildCacheKey(characterId);

    const data: CachedPrompt = {
      prompt,
      generatedAt: new Date().toISOString(),
      wordCount: prompt.split(/\s+/).length,
    };

    await cache.set(key, data, ttlSeconds);
    logger.info({ ...ctx, ttl: ttlSeconds }, 'Prompt cached');
  } catch (error) {
    logger.warn({ ...ctx, error }, 'Cache write failed');
    // Don't throw - caching is non-critical
  }
}

/**
 * Invalidate cached element prompt for a character
 * Call this when character data is updated
 * @param characterId - Character ID
 */
export async function invalidatePromptCache(
  characterId: string,
): Promise<void> {
  const logger = await getLogger();
  const ctx = { name: 'element-prompt-cache', characterId };

  try {
    const cache = createCacheClient();
    const key = buildCacheKey(characterId);
    await cache.del(key);
    logger.info(ctx, 'Cache invalidated');
  } catch (error) {
    logger.warn({ ...ctx, error }, 'Cache invalidation failed');
    // Don't throw - invalidation is non-critical
  }
}

/**
 * Batch get cached prompts for multiple characters
 * @param characterIds - Array of character IDs
 * @returns Map of characterId to prompt (null for cache misses)
 */
export async function getCachedPrompts(
  characterIds: string[],
): Promise<Map<string, string | null>> {
  const logger = await getLogger();
  const ctx = { name: 'element-prompt-cache', count: characterIds.length };

  try {
    const cache = createCacheClient();
    const keys = characterIds.map(buildCacheKey);
    const results = await cache.mget<CachedPrompt>(keys);

    const prompts = new Map<string, string | null>();
    let hits = 0;

    characterIds.forEach((id, index) => {
      const cached = results[index];
      if (cached) {
        prompts.set(id, cached.prompt);
        hits++;
      } else {
        prompts.set(id, null);
      }
    });

    logger.info(
      { ...ctx, hits, misses: characterIds.length - hits },
      'Batch cache lookup',
    );
    return prompts;
  } catch (error) {
    logger.warn({ ...ctx, error }, 'Batch cache read failed');
    // Return empty results on error
    const prompts = new Map<string, string | null>();
    characterIds.forEach((id) => prompts.set(id, null));
    return prompts;
  }
}
