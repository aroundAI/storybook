import 'server-only';

import {
  queryNetSubscribersForVideos,
  queryQualityMetricsForVideos,
  queryTotalsByVideoIds,
  queryTrafficSources,
  queryVideoViewsAtAge,
} from '@kit/clickhouse/server';

import {
  type DateWindow,
  type FoldResult,
  WATCHED_METRICS,
  type WatchedMetricKey,
  type WatchedValue,
  foldCtr,
  foldNetSubscribers,
  foldTrafficShare,
  foldViewWeighted,
  foldViewsAtAge,
  isWatchedMetricKey,
  stampFold,
  unmeasured,
} from '../lib/watched-metrics';

/**
 * Fetches and folds the experiment's watched metric (FILM-1610).
 *
 * Every read is over the linked videos only. The window is applied only to
 * windowed metrics; `views_at_30d` is age-bounded already and is recorded
 * with a null window so the snapshot says which kind of figure it holds.
 */
export async function resolveWatchedMetric(input: {
  metric: string;
  accountId: string;
  publishIds: string[];
  window: DateWindow;
}): Promise<WatchedValue> {
  const { metric, publishIds } = input;

  if (!isWatchedMetricKey(metric)) {
    return unmeasured(metric, 'unknown_metric', null);
  }

  const window = WATCHED_METRICS[metric].windowed ? input.window : null;

  if (publishIds.length === 0) {
    return unmeasured(metric, 'no_linked_videos', window);
  }

  const fold = await fetchAndFold(metric, input.accountId, publishIds, window);

  return stampFold(metric, fold, window, publishIds.length);
}

async function fetchAndFold(
  metric: WatchedMetricKey,
  accountId: string,
  videoIds: string[],
  window: DateWindow | null,
): Promise<FoldResult> {
  const range = window ? { startDate: window.start, endDate: window.end } : {};

  switch (metric) {
    case 'views_at_30d': {
      const rows = await queryVideoViewsAtAge({
        scope: { accountId },
        videoIds,
        checkpoints: [30],
      });

      return foldViewsAtAge(
        rows.map((row) => ({
          views: row.viewsAtAge[30] ?? 0,
          mature: row.matureAt[30] ?? false,
        })),
      );
    }

    case 'ctr': {
      const quality = await queryQualityMetricsForVideos({
        videoIds,
        ...range,
      });
      return foldCtr([...quality.values()]);
    }

    case 'avg_view_duration':
    case 'avg_view_percentage': {
      // Weighted by each video's views over the same window, read from the
      // same table the per-video averages are weighted by.
      const [quality, totals] = await Promise.all([
        queryQualityMetricsForVideos({ videoIds, ...range }),
        queryTotalsByVideoIds(videoIds, range),
      ]);

      return foldViewWeighted(
        [...quality].map(([videoId, metrics]) => ({
          value:
            metric === 'avg_view_duration'
              ? metrics.avgViewDurationSeconds
              : metrics.avgViewPercentage,
          views: totals.get(videoId)?.views ?? 0,
        })),
      );
    }

    case 'browse_suggested_share':
    case 'search_share': {
      // byVideo, so coverage can count the videos that had traffic at all.
      const rows = await queryTrafficSources({
        videoIds,
        ...range,
        byVideo: true,
      });

      return foldTrafficShare(
        rows,
        metric === 'search_share' ? 'search' : 'browse_suggested',
      );
    }

    case 'subscribers_net': {
      const perVideo = await queryNetSubscribersForVideos({
        videoIds,
        ...range,
      });
      return foldNetSubscribers([...perVideo.values()]);
    }
  }
}
