/**
 * Episode Cache Keys and Invalidation
 *
 * Cache key patterns and invalidation functions for episode data.
 * Call invalidation functions after any mutation to ensure fresh data.
 */
import { createCacheClient } from '@kit/cache';

/**
 * Cache key patterns for episodes
 */
export const episodeCacheKeys = {
  /** Single episode by ID */
  episode: (id: string) => `episode:${id}`,

  /** All episodes for a project */
  episodeList: (projectId: string) => `episodes:${projectId}`,

  /** Episode screenplay data */
  screenplay: (id: string) => `episode:${id}:screenplay`,

  /** Episode shot list */
  shots: (id: string) => `episode:${id}:shots`,

  /** Episode ideation data */
  ideation: (id: string) => `episode:${id}:ideation`,

  /** Episode story data */
  story: (id: string) => `episode:${id}:story`,
} as const;

/**
 * Cache TTLs in seconds
 */
export const episodeCacheTTL = {
  /** Episode list - 5 minutes (frequently updated) */
  episodeList: 300,
  /** Single episode - 5 minutes */
  episode: 300,
  /** Screenplay - 5 minutes (actively edited) */
  screenplay: 300,
  /** Shot list - 5 minutes (actively edited) */
  shots: 300,
  /** Ideation - 30 minutes (less frequently changed) */
  ideation: 1800,
  /** Story - 30 minutes */
  story: 1800,
} as const;

/**
 * Invalidate all episode-related cache for an episode
 * Call this on episode update/delete operations
 */
export async function invalidateEpisodeCache(
  episodeId: string,
  projectId: string,
): Promise<void> {
  const cache = createCacheClient();

  await cache.mdel([
    episodeCacheKeys.episode(episodeId),
    episodeCacheKeys.episodeList(projectId),
    episodeCacheKeys.screenplay(episodeId),
    episodeCacheKeys.shots(episodeId),
    episodeCacheKeys.ideation(episodeId),
    episodeCacheKeys.story(episodeId),
  ]);
}

/**
 * Invalidate episode list cache for a project
 * Call this when episodes are created/deleted
 */
export async function invalidateEpisodeListCache(
  projectId: string,
): Promise<void> {
  const cache = createCacheClient();
  await cache.del(episodeCacheKeys.episodeList(projectId));
}

/**
 * Invalidate screenplay cache
 * Call this when screenplay is updated
 */
export async function invalidateScreenplayCache(
  episodeId: string,
): Promise<void> {
  const cache = createCacheClient();
  await cache.mdel([
    episodeCacheKeys.episode(episodeId),
    episodeCacheKeys.screenplay(episodeId),
  ]);
}

/**
 * Invalidate shot list cache
 * Call this when shots are updated
 */
export async function invalidateShotsCache(episodeId: string): Promise<void> {
  const cache = createCacheClient();
  await cache.mdel([
    episodeCacheKeys.episode(episodeId),
    episodeCacheKeys.shots(episodeId),
  ]);
}
