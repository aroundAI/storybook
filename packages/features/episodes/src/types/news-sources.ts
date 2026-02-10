/**
 * News-Specific Types
 * Phase 11: FILM-1130
 *
 * Bias tracking, source categorization, and balanced coverage utilities
 * for news content within the External Context Provider system.
 */

/** Political bias label for news sources (from Ad Fontes / AllSides methodology) */
export type BiasLabel =
    | 'left'
    | 'center_left'
    | 'center'
    | 'center_right'
    | 'right'
    | 'unknown';

/** News source subcategory */
export type NewsSourceType =
    | 'wire_service' // AP, Reuters, AFP
    | 'broadcaster' // BBC, CNN, Al Jazeera
    | 'newspaper' // NYT, WSJ, Guardian
    | 'magazine' // Economist, Time
    | 'government' // Official government sources
    | 'organization'; // WHO, UN, etc.

/** Human-readable descriptions for UI display */
export const BIAS_LABEL_DESCRIPTIONS: Record<BiasLabel, string> = {
    left: 'Leans progressive/liberal',
    center_left: 'Slightly progressive',
    center: 'Generally neutral',
    center_right: 'Slightly conservative',
    right: 'Leans conservative',
    unknown: 'Bias not evaluated',
};

/**
 * Filter content items by bias label into balanced perspective groups.
 *
 * Accepts any array of objects with an optional `biasLabel` field,
 * so it works with both ExternalContent items and raw source rows.
 * Items with undefined or missing biasLabel fall into the center bucket.
 */
export function getBalancedSources<T extends { biasLabel?: string }>(
    items: T[],
): { left: T[]; center: T[]; right: T[] } {
    return {
        left: items.filter(
            (s) =>
                s.biasLabel === 'left' || s.biasLabel === 'center_left',
        ),
        center: items.filter(
            (s) =>
                s.biasLabel === 'center' ||
                s.biasLabel === 'unknown' ||
                !s.biasLabel,
        ),
        right: items.filter(
            (s) =>
                s.biasLabel === 'right' || s.biasLabel === 'center_right',
        ),
    };
}
