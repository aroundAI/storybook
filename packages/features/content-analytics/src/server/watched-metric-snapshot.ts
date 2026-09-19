import 'server-only';

import {
  checkpointPredatesIngest,
  queryDataDaysForVideos,
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
  allPublishedAfter,
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
  /** Each linked video's publish time, in `publishIds` order. */
  publishedAt: Array<string | null>;
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

  const definition = WATCHED_METRICS[metric];

  const [fold, daysWithData] = await Promise.all([
    fetchAndFold(metric, input.accountId, publishIds, window),
    // How much of the window the figure actually covers. Not counted for an
    // age-bounded metric, which has no calendar window to cover.
    window && definition.source !== 'age'
      ? queryDataDaysForVideos({
          videoIds: publishIds,
          source: definition.source,
          startDate: window.start,
          endDate: window.end,
        })
      : Promise.resolve(null),
  ]);

  // No data, and none of the videos existed in the window: say that,
  // rather than "no data", which suggests they could have had some. Only
  // ever a better explanation of an absence — measured data always wins,
  // so a wrong publish time can never hide real figures.
  if (
    fold.status === 'unmeasured' &&
    fold.reason === 'no_data' &&
    window &&
    allPublishedAfter(input.publishedAt, window)
  ) {
    return unmeasured(metric, 'published_after_window', window);
  }

  return stampFold(metric, fold, window, publishIds.length, daysWithData);
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
          // FILM-1603's rule, not a second copy of it.
          predatesIngest: checkpointPredatesIngest(row.ingestLagDays, 30),
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
