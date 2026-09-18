import { groupForSource } from '@kit/clickhouse';
import type { TrafficSourceGroup } from '@kit/clickhouse';

/**
 * The metric an experiment is judged on (FILM-1610).
 *
 * Pure: every function here folds rows that were already fetched, so the
 * arithmetic — which weighting, which median, what counts as no data — is
 * testable without a database. The fetching lives in
 * `server/watched-metric-snapshot.ts`.
 *
 * Every metric is computed over the experiment's own linked videos, never
 * over the channel or project they belong to: an experiment run on six
 * videos is not measured by a channel-wide share.
 */
export const WATCHED_METRIC_KEYS = [
  'views_at_30d',
  'ctr',
  'avg_view_duration',
  'avg_view_percentage',
  'browse_suggested_share',
  'search_share',
  'subscribers_net',
] as const;

export type WatchedMetricKey = (typeof WATCHED_METRIC_KEYS)[number];

export type WatchedUnit =
  | 'views'
  | 'ratio'
  | 'seconds'
  | 'percent'
  | 'subscribers';

interface WatchedMetricDefinition {
  label: string;
  unit: WatchedUnit;
  /**
   * Whether the metric is measured over a date window. `views_at_30d` is
   * not: it is already bounded by each video's age, so a calendar window on
   * top would cut some videos' first thirty days short.
   */
  windowed: boolean;
}

export const WATCHED_METRICS: Record<
  WatchedMetricKey,
  WatchedMetricDefinition
> = {
  views_at_30d: {
    label: 'Median views at 30 days',
    unit: 'views',
    windowed: false,
  },
  ctr: {
    label: 'Impressions click-through rate',
    unit: 'ratio',
    windowed: true,
  },
  avg_view_duration: {
    label: 'Average view duration',
    unit: 'seconds',
    windowed: true,
  },
  avg_view_percentage: {
    label: 'Average percentage viewed',
    unit: 'percent',
    windowed: true,
  },
  browse_suggested_share: {
    label: 'Browse + suggested share of views',
    unit: 'ratio',
    windowed: true,
  },
  search_share: {
    label: 'Search share of views',
    unit: 'ratio',
    windowed: true,
  },
  subscribers_net: {
    label: 'Net subscribers from these videos',
    unit: 'subscribers',
    windowed: true,
  },
};

export function isWatchedMetricKey(value: string): value is WatchedMetricKey {
  return Object.hasOwn(WATCHED_METRICS, value);
}

/** An inclusive date range, `YYYY-MM-DD`. */
export interface DateWindow {
  start: string;
  end: string;
}

/**
 * Why there is no value. Each reason is a different fact, and the UI says
 * which — a missing measurement must never render as a zero.
 */
export type UnmeasuredReason =
  /** The experiment has no linked videos, so there is nothing to measure. */
  | 'no_linked_videos'
  /** None of the linked videos has data for this metric in the window. */
  | 'no_data'
  /** `views_at_30d` only: no linked video is thirty days old yet. */
  | 'none_mature'
  /** The stored metric name is not one this code knows. */
  | 'unknown_metric';

export type WatchedValue =
  | {
      status: 'measured';
      metric: WatchedMetricKey;
      value: number;
      unit: WatchedUnit;
      window: DateWindow | null;
      /** Linked videos that contributed data. */
      coveredVideos: number;
      /** All linked videos. */
      totalVideos: number;
    }
  | {
      status: 'unmeasured';
      metric: string;
      reason: UnmeasuredReason;
      window: DateWindow | null;
    };

/** A fold's result before it is stamped with the metric, unit and window. */
export type FoldResult =
  | { status: 'measured'; value: number; coveredVideos: number }
  | { status: 'unmeasured'; reason: 'no_data' | 'none_mature' };

const NO_DATA: FoldResult = { status: 'unmeasured', reason: 'no_data' };

export function unmeasured(
  metric: string,
  reason: UnmeasuredReason,
  window: DateWindow | null,
): WatchedValue {
  return { status: 'unmeasured', metric, reason, window };
}

export function stampFold(
  metric: WatchedMetricKey,
  fold: FoldResult,
  window: DateWindow | null,
  totalVideos: number,
): WatchedValue {
  if (fold.status === 'unmeasured') {
    return unmeasured(metric, fold.reason, window);
  }

  return {
    status: 'measured',
    metric,
    value: fold.value,
    unit: WATCHED_METRICS[metric].unit,
    window,
    coveredVideos: fold.coveredVideos,
    totalVideos,
  };
}

/**
 * Median of each mature video's views at 30 days.
 *
 * A median, not a sum or mean: one breakout video would otherwise decide
 * the result. Immature videos are left out rather than counted as zero —
 * their thirty days have not happened yet.
 */
export function foldViewsAtAge(
  rows: Array<{ views: number; mature: boolean }>,
): FoldResult {
  const mature = rows
    .filter((row) => row.mature)
    .map((row) => row.views)
    .sort((a, b) => a - b);

  if (mature.length === 0) {
    return rows.length === 0
      ? NO_DATA
      : { status: 'unmeasured', reason: 'none_mature' };
  }

  const middle = Math.floor(mature.length / 2);
  const value =
    mature.length % 2 === 1
      ? mature[middle]!
      : (mature[middle - 1]! + mature[middle]!) / 2;

  return { status: 'measured', value, coveredVideos: mature.length };
}

/**
 * Pooled click-through rate: Σ(ctr × impressions) / Σ impressions.
 *
 * Weighted by impressions, because CTR is clicks per impression. Weighting
 * by views instead would let a video with many views from outside the
 * thumbnail surface pull the pooled rate toward its own.
 */
export function foldCtr(
  rows: Array<{ impressions: number; impressionsCtr: number }>,
): FoldResult {
  let clicks = 0;
  let impressions = 0;
  let covered = 0;

  for (const row of rows) {
    if (row.impressions <= 0) continue;
    clicks += row.impressionsCtr * row.impressions;
    impressions += row.impressions;
    covered += 1;
  }

  if (impressions === 0) return NO_DATA;

  return {
    status: 'measured',
    value: clicks / impressions,
    coveredVideos: covered,
  };
}

/**
 * A per-video average pooled across videos, weighted by each video's views
 * in the same window — what the per-video figure is itself weighted by.
 */
export function foldViewWeighted(
  rows: Array<{ value: number; views: number }>,
): FoldResult {
  let weighted = 0;
  let views = 0;
  let covered = 0;

  for (const row of rows) {
    if (row.views <= 0) continue;
    weighted += row.value * row.views;
    views += row.views;
    covered += 1;
  }

  if (views === 0) return NO_DATA;

  return {
    status: 'measured',
    value: weighted / views,
    coveredVideos: covered,
  };
}

/**
 * One traffic group's share of the videos' pooled views.
 *
 * Grouped through `groupForSource`, the single definition FILM-1605 set, so
 * "browse + suggested" here means exactly what it means on the Deep Dive.
 */
export function foldTrafficShare(
  rows: Array<{ source: string; videoId?: string; views: number }>,
  group: TrafficSourceGroup,
): FoldResult {
  let total = 0;
  let inGroup = 0;
  const videos = new Set<string>();

  for (const row of rows) {
    if (row.views <= 0) continue;
    total += row.views;
    if (groupForSource(row.source) === group) inGroup += row.views;
    if (row.videoId) videos.add(row.videoId);
  }

  if (total === 0) return NO_DATA;

  return {
    status: 'measured',
    value: inGroup / total,
    coveredVideos: videos.size,
  };
}

/** Net subscribers summed across the videos that have data in the window. */
export function foldNetSubscribers(
  rows: Array<{ gained: number; lost: number }>,
): FoldResult {
  if (rows.length === 0) return NO_DATA;

  const value = rows.reduce((sum, row) => sum + row.gained - row.lost, 0);

  return { status: 'measured', value, coveredVideos: rows.length };
}

/**
 * The window a snapshot measures.
 *
 * The baseline covers the `windowDays` days *before* the experiment started,
 * so it describes the videos before the change; the result covers the days
 * *since*. Both are inclusive. Lifetime figures would dilute the change with
 * every day that came before it.
 */
export function baselineWindow(
  startedAt: string,
  windowDays: number,
): DateWindow {
  return {
    start: addDays(startedAt, -windowDays),
    end: addDays(startedAt, -1),
  };
}

export function resultWindow(startedAt: string, endedAt: string): DateWindow {
  return { start: startedAt, end: endedAt };
}

/** Whole days from `startedAt` to `endedAt` — what actually elapsed. */
export function daysBetween(startedAt: string, endedAt: string): number {
  return Math.round(
    (Date.parse(`${endedAt}T00:00:00Z`) -
      Date.parse(`${startedAt}T00:00:00Z`)) /
      86_400_000,
  );
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What each unmeasured reason means, in words a reader can act on. */
export const UNMEASURED_REASON_TEXT: Record<UnmeasuredReason, string> = {
  no_linked_videos:
    'No videos are linked to this experiment, so there is nothing to measure.',
  no_data: 'None of the linked videos has data for this metric in this window.',
  none_mature:
    'No linked video is 30 days old yet, so views at 30 days are not knowable.',
  unknown_metric:
    'This metric is no longer recognised, so it was not measured.',
};

/** A measured value in its unit, for display. */
export function formatWatchedValue(value: number, unit: WatchedUnit): string {
  switch (unit) {
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'seconds': {
      const total = Math.round(value);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }
    case 'subscribers':
      return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`;
    case 'views':
      return Math.round(value).toLocaleString('en-US');
  }
}
