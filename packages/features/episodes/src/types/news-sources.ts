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
  return items.reduce<{ left: T[]; center: T[]; right: T[] }>(
    (acc, item) => {
      const bias = item.biasLabel;

      if (bias === 'left' || bias === 'center_left') {
        acc.left.push(item);
      } else if (bias === 'right' || bias === 'center_right') {
        acc.right.push(item);
      } else {
        acc.center.push(item);
      }

      return acc;
    },
    { left: [], center: [], right: [] },
  );
}
