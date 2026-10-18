import {
  type DenominatorWindow,
  type MeasuredEngagementCounts,
  type RecordedRate,
  recordViewsDenominator,
  recordedEngagementRatePercent,
} from '@kit/clickhouse';

import { platformLabel } from './platform-labels';

/**
 * One video's engagement rate: the Content tab's Engagement column
 * (getContentList): likes, comments and shares per 100 views over the
 * video's stored days in `window`, by its own platform's views.
 * The morning digest (FILM-1736) reads the same function, so the two can
 * never disagree. Null when it is not measured (KB-194).
 */
export function publishEngagementRate(
  counts: MeasuredEngagementCounts,
  platform: string,
  window: DenominatorWindow,
): RecordedRate | null {
  return recordedEngagementRatePercent(
    counts,
    recordViewsDenominator({ platforms: [platform], window }),
  );
}

/** Why `publishEngagementRate` is null for these counts */
export function engagementRateNullReason(
  counts: MeasuredEngagementCounts,
  platform: string,
): string {
  if (counts.views === null) {
    return platform === 'facebook'
      ? `${platformLabel('facebook')} reports no single view count, so there are no views to divide by.`
      : `No views stored for this video from ${platformLabel(platform)} yet.`;
  }

  if (counts.views === 0) return 'No views to divide by.';

  return 'Likes, comments and shares are all not measured.';
}
