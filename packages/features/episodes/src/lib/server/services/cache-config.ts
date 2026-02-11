/**
 * Cache Configuration
 * Phase 11: FILM-1131
 *
 * Centralized TTL settings for different content categories.
 * Used by the aggregator's cache layer and entity extraction scheduling.
 */

import type { SourceCategory } from '../../../types/external-context';

/** Cache TTL by content category (hours) */
export const CACHE_TTL_HOURS: Record<SourceCategory, number> = {
    news: 6, // News expires quickly — 6 hours
    research: 168, // Academic papers — 7 days
    encyclopedia: 168, // Encyclopedia — 7 days
    historical: 720, // Historical archives — 30 days
    official: 24, // Government docs — 1 day
    multimedia: 48, // Video/podcast transcripts — 2 days
};

/** Check if cached content is still fresh */
export function isCacheFresh(cacheExpiresAt: Date): boolean {
    return cacheExpiresAt > new Date();
}

/** Calculate expiry time for a new cache entry */
export function getCacheExpiry(category: SourceCategory): Date {
    const ttlHours = CACHE_TTL_HOURS[category];

    return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}
