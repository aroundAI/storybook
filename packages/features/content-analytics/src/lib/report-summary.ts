import { sumMeasured, weightedMeasured } from './export-coverage';
import type { AnalyticsDataRow, ReportSummary } from './report-types';
import { viewsToAdd } from './views';

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
  let impressions = 0;
  let clicks = 0;

  for (const row of data) {
    // A Facebook row has no single view (KB-153): it adds nothing to the
    // views total, and its platform gets no views line rather than a 0.
    if (row.views !== null) {
      platformBreakdown[row.platform] =
        (platformBreakdown[row.platform] ?? 0) + row.views;
    }
    totalViews += viewsToAdd(row.views);
    totalLikes += row.likes;
    totalComments += row.comments;
    totalShares += row.shares;
    impressions += row.impressions;
    clicks += row.impressions * row.ctr;
  }

  const watchTime = sumMeasured(data.map((row) => row.watchTimeSeconds));
  const subscribers = sumMeasured(data.map((row) => row.subscribersGained));
  const revenue = sumMeasured(data.map((row) => row.revenueCents));
  const avgViewDuration = weightedMeasured(
    data.map((row) => ({
      value: row.avgViewDurationSeconds,
      weight: viewsToAdd(row.views),
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
      revenue: revenue.coverage,
    },
    totalRevenueCents: revenue.value,
    contentCount: new Set(data.map((d) => d.contentTitle)).size,
    platformBreakdown,
  };
}
