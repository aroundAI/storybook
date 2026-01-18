/**
 * Asset Cache Keys and Invalidation
 *
 * Cache key patterns and invalidation functions for asset data
 * (characters, locations, props, etc.)
 */

import { createCacheClient } from '@kit/cache';

/**
 * Cache key patterns for assets
 */
export const assetCacheKeys = {
    /** All assets for a project by type */
    assetsByType: (projectId: string, type: string) =>
        `assets:${projectId}:${type}`,

    /** All assets for a project */
    allAssets: (projectId: string) => `assets:${projectId}:all`,

    /** Single asset by ID */
    asset: (assetId: string) => `asset:${assetId}`,

    /** Asset count by type */
    assetCount: (projectId: string, type: string) =>
        `assets:${projectId}:${type}:count`,
} as const;

/**
 * Cache TTLs in seconds
 */
export const assetCacheTTL = {
    /** Asset list - 5 minutes */
    assetList: 300,
    /** Single asset - 30 minutes */
    asset: 1800,
    /** Asset count - 5 minutes */
    count: 300,
} as const;

/**
 * Invalidate asset cache by type
 * Call this when assets are created/updated/deleted
 */
export async function invalidateAssetCache(
    projectId: string,
    type: string,
): Promise<void> {
    const cache = createCacheClient();

    await cache.mdel([
        assetCacheKeys.assetsByType(projectId, type),
        assetCacheKeys.allAssets(projectId),
        assetCacheKeys.assetCount(projectId, type),
    ]);
}

/**
 * Invalidate a single asset cache
 * Call this when an asset is updated
 */
export async function invalidateSingleAssetCache(
    assetId: string,
    projectId: string,
    type: string,
): Promise<void> {
    const cache = createCacheClient();

    await cache.mdel([
        assetCacheKeys.asset(assetId),
        assetCacheKeys.assetsByType(projectId, type),
        assetCacheKeys.assetCount(projectId, type),
    ]);
}

/**
 * Invalidate all asset caches for a project
 * Call this on project delete or bulk operations
 */
export async function invalidateAllAssetCaches(
    projectId: string,
): Promise<void> {
    const cache = createCacheClient();

    // Invalidate common asset types
    const types = ['character', 'location', 'prop', 'vehicle'];

    await cache.mdel([
        assetCacheKeys.allAssets(projectId),
        ...types.map((t) => assetCacheKeys.assetsByType(projectId, t)),
        ...types.map((t) => assetCacheKeys.assetCount(projectId, t)),
    ]);
}
