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
  /**
   * A rate reads the same over any window length; a sum grows with it. A sum
   * compared across windows of different length, or partly covered, says
   * more about the window than the videos — so sums are also shown per day.
   */
  kind: 'rate' | 'sum';
  /** The table whose days of data this metric's coverage is counted from. */
  source: WatchedSource;
}

/**
 * Where a windowed metric's rows come from. Named here, mapped to a table in
 * `@kit/clickhouse`, so no table name ever comes from a caller.
 */
export type WatchedSource = 'reach' | 'daily' | 'traffic' | 'age';

export const WATCHED_METRICS: Record<
  WatchedMetricKey,
  WatchedMetricDefinition
> = {
  views_at_30d: {
    label: 'Median views at 30 days',
    unit: 'views',
    windowed: false,
    kind: 'rate',
    source: 'age',
  },
  ctr: {
    label: 'Impressions click-through rate',
    unit: 'ratio',
    windowed: true,
    kind: 'rate',
    source: 'reach',
  },
  avg_view_duration: {
    label: 'Average view duration',
    unit: 'seconds',
    windowed: true,
    kind: 'rate',
    source: 'daily',
  },
  avg_view_percentage: {
    label: 'Average percentage viewed',
    unit: 'percent',
    windowed: true,
    kind: 'rate',
    source: 'daily',
  },
  browse_suggested_share: {
    label: 'Browse + suggested share of views',
    unit: 'ratio',
    windowed: true,
    kind: 'rate',
    source: 'traffic',
  },
  search_share: {
    label: 'Search share of views',
    unit: 'ratio',
    windowed: true,
    kind: 'rate',
    source: 'traffic',
  },
  subscribers_net: {
    label: 'Net subscribers from these videos',
    unit: 'subscribers',
    windowed: true,
    kind: 'sum',
    source: 'daily',
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
  /**
   * `views_at_30d` only: the mature videos' 30 days all closed before ingest
   * began, so their figures hold no data from their own window (FILM-1603).
   */
  | 'predates_ingest'
  /**
   * Every linked video was published after the window ended, so the window
   * holds no "before" for any of them (FILM-1610 review 5). Not "no data":
   * there was nothing to have data about.
   */
  | 'published_after_window'
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
      /**
       * Days in the window with any data for these videos, and the window's
       * length. Null for an age-bounded metric, which has no calendar window.
       * Fewer days than the window means the value covers only part of it.
       */
      daysWithData: number | null;
      windowDays: number | null;
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
  | {
      status: 'unmeasured';
      reason: 'no_data' | 'none_mature' | 'predates_ingest';
    };

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
  daysWithData: number | null,
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
    daysWithData: window ? daysWithData : null,
    windowDays: window ? daysBetween(window.start, window.end) + 1 : null,
  };
}

/**
 * A sum per day of data. The raw sum stays in the snapshot beside it: this
 * changes what is shown, never what is known.
 */
export function perDay(value: number, daysWithData: number): number | null {
  return daysWithData > 0 ? value / daysWithData : null;
}

/**
 * Median of each mature video's views at 30 days.
 *
 * A median, not a sum or mean: one breakout video would otherwise decide
 * the result. Immature videos are left out rather than counted as zero —
 * their thirty days have not happened yet.
 */
export function foldViewsAtAge(
  rows: Array<{ views: number; mature: boolean; predatesIngest: boolean }>,
): FoldResult {
  const matureRows = rows.filter((row) => row.mature);
  // A window that closed before ingest began holds no data from itself: its
  // figure is an absence, and counting it would pull the median to zero.
  const mature = matureRows
    .filter((row) => !row.predatesIngest)
    .map((row) => row.views)
    .sort((a, b) => a - b);

  if (mature.length === 0) {
    if (rows.length === 0) return NO_DATA;

    return {
      status: 'unmeasured',
      reason: matureRows.length > 0 ? 'predates_ingest' : 'none_mature',
    };
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
 *
 * A video whose figure is null is left out entirely — of the weight and of
 * the coverage. Its platform does not measure it (KB-111), and counting its
 * views against a 0 once turned 45.5% into a "measured" 13%.
 */
export function foldViewWeighted(
  rows: Array<{ value: number | null; views: number }>,
): FoldResult {
  let weighted = 0;
  let views = 0;
  let covered = 0;

  for (const row of rows) {
    if (row.value === null || row.views <= 0) continue;
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

/**
 * Net subscribers summed across the videos that have data in the window.
 *
 * Only videos whose losses were measured: a net is gained minus lost, and a
 * video with no measured loss (TikTok, Instagram — KB-111) has no net.
 * `coveredVideos` says how many carried one.
 */
export function foldNetSubscribers(
  rows: Array<{ gained: number; lost: number | null }>,
): FoldResult {
  const measured = rows.filter(
    (row): row is { gained: number; lost: number } => row.lost !== null,
  );

  if (measured.length === 0) return NO_DATA;

  const value = measured.reduce((sum, row) => sum + row.gained - row.lost, 0);

  return { status: 'measured', value, coveredVideos: measured.length };
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
  predates_ingest:
    "The linked videos' first 30 days ended before analytics collection began, so there is no data for them.",
  published_after_window:
    'The linked videos were published after this window, so there is no "before" for them. This log compares videos with their own past; comparing new videos with earlier ones is what channel experiments (coming) are for.',
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

/**
 * Whether every linked video was published after the window ended, so the
 * window cannot hold any of their data (FILM-1610 review 5).
 *
 * Publish times are timestamps and windows are calendar days; a video counts
 * as in the window from the UTC day it was published, the calendar the
 * metric tables are keyed by. A video with no publish time is not assumed
 * late: its data, if any, decides.
 */
export function allPublishedAfter(
  publishedAt: Array<string | null>,
  window: DateWindow,
): boolean {
  return (
    publishedAt.length > 0 &&
    publishedAt.every(
      (timestamp) => timestamp !== null && timestamp.slice(0, 10) > window.end,
    )
  );
}

/**
 * What a metric can and cannot show here, where it needs saying. Views at
 * 30 days is a fixed figure per video once the video is 30 days old, so on
 * the same videos it reads the same before and after.
 */
export const WATCHED_METRIC_NOTES: Partial<Record<WatchedMetricKey, string>> = {
  views_at_30d:
    "Each video's views in its first 30 days. For a video already 30 days old it is the same before and after, so it shows a change only between different videos.",
};
