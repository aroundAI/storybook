import { sumMeasured, weightedMeasured } from './export-coverage';
import type { AnalyticsDataRow, ReportSummary } from './report-types';

/**
 * The summary a report's PDF header and CSV summary print. One copy, for the
 * on-demand export and the scheduled one alike: they had diverged into two.
 *
 * A figure some rows do not measure (TikTok and Instagram watch time, TikTok
 * follower gains, a TikTok or Instagram video's average view duration) is
 * totalled over the rows that measure it, with its coverage beside it, and is
 * null when none do (decision #33, A; KB-111, KB-114).
 */
export function calculateReportSummary(
  data: AnalyticsDataRow[],
): ReportSummary {
  const platformBreakdown: Record<string, number> = {};

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalRevenueCents = 0;
  let impressions = 0;
  let clicks = 0;

  for (const row of data) {
    platformBreakdown[row.platform] =
      (platformBreakdown[row.platform] ?? 0) + row.views;
    totalViews += row.views;
    totalLikes += row.likes;
    totalComments += row.comments;
    totalShares += row.shares;
    totalRevenueCents += row.revenueCents;
    impressions += row.impressions;
    clicks += row.impressions * row.ctr;
  }

  const watchTime = sumMeasured(data.map((row) => row.watchTimeSeconds));
  const subscribers = sumMeasured(data.map((row) => row.subscribersGained));
  const avgViewDuration = weightedMeasured(
    data.map((row) => ({
      value: row.avgViewDurationSeconds,
      weight: row.views,
    })),
  );

  return {
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalWatchTimeSeconds: watchTime.value,
    totalSubscribers: subscribers.value,
    avgViewDurationSeconds: avgViewDuration.value,
    ctr: impressions > 0 ? clicks / impressions : null,
    coverage: {
      watchTime: watchTime.coverage,
      subscribers: subscribers.coverage,
      avgViewDuration: avgViewDuration.coverage,
    },
    totalRevenueCents,
    contentCount: new Set(data.map((d) => d.contentTitle)).size,
    platformBreakdown,
  };
}
