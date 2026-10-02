import { type AnalyticsPlatform } from '@kit/clickhouse';

import { SHOWN_ANALYTICS_PLATFORMS } from './shown-platforms';

/**
 * The platform filter's selection, as the page and the actions read it
 * (FILM-1709). Pure, so the page and the server agree on one meaning.
 */

/** Whether a row's platform — any string, a channel's included — is selected. */
export function isSelected(
  selected: readonly AnalyticsPlatform[],
  platform: string,
): boolean {
  return (selected as readonly string[]).includes(platform);
}

/**
 * The selection in the filter's own order, so two selections of the same
 * platforms are one cache key and one request, whichever was ticked first.
 */
export function orderedSelection(
  selected: readonly AnalyticsPlatform[],
): AnalyticsPlatform[] {
  return SHOWN_ANALYTICS_PLATFORMS.filter((platform) =>
    selected.includes(platform),
  );
}

export function selectsEveryPlatform(
  selected: readonly AnalyticsPlatform[],
): boolean {
  return SHOWN_ANALYTICS_PLATFORMS.every((platform) =>
    selected.includes(platform),
  );
}

/**
 * Why a card, a tab or a headline figure has nothing when nothing is
 * selected — one sentence everywhere. Nothing is asked for: an empty
 * selection is not a filter a query can apply, and reading it as "every
 * platform" is the bug `assertPlatformSelection` exists to stop.
 */
export const NO_PLATFORM_SELECTED = 'No platform is selected in the filter.';
