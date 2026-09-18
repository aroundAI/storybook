'use client';

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';

import { categoryLabel } from '../../lib/schemas/experiment.schema';
import {
  type DateWindow,
  UNMEASURED_REASON_TEXT,
  WATCHED_METRICS,
  type WatchedValue,
  formatWatchedValue,
  isWatchedMetricKey,
  perDay,
} from '../../lib/watched-metrics';

/** Snapshot persisted by start/conclude, mirroring ExperimentSnapshot. */
export interface ExperimentMetricSnapshot {
  capturedAt?: string;
  publishCount?: number;
  totals?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    watchTimeSeconds: number;
    revenueCents: number;
  };
  /** FILM-1610. Absent on snapshots written before it; null when unwatched. */
  watched?: WatchedValue | null;
  /** Result snapshots only: days from start to end. */
  resultAfterDays?: number;
}

interface ExperimentDetailProps {
  /** The experiment being viewed */
  experiment: {
    title: string;
    hypothesis: string | null;
    change_description: string;
    expected_outcome: string | null;
    actual_outcome: string | null;
    status: string;
    outcome_status: string;
    started_at: string | null;
    ended_at: string | null;
    baseline_metrics: ExperimentMetricSnapshot | null;
    result_metrics: ExperimentMetricSnapshot | null;
    category?: string | null;
    metric_watched?: string | null;
    review_window_days?: number;
    review_due_at?: string | null;
    notes?: string | null;
  };
  /** Loading state */
  isLoading?: boolean;
}

const METRICS = [
  { key: 'views', label: 'Views' },
  { key: 'watchTimeSeconds', label: 'Watch time (s)' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'revenueCents', label: 'Revenue (cents)' },
] as const;

function metricLabelOf(metric: string): string {
  return isWatchedMetricKey(metric) ? WATCHED_METRICS[metric].label : metric;
}

/** Blank text saved before blanks became null reads as nothing recorded. */
function textOr(value: string | null, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function formatWindow(window: DateWindow | null): string {
  return window
    ? `${window.start} → ${window.end}`
    : "each video's first 30 days";
}

/**
 * What a measured value covers: the window, how many videos had data, and —
 * when the data does not span the whole window — how many days it does. A
 * sum is also given per day of data, since a sum grows with the window.
 */
function WatchedCoverage({
  watched,
}: {
  watched: Extract<WatchedValue, { status: 'measured' }>;
}) {
  // Snapshots written before coverage was recorded have neither field.
  const daysWithData = watched.daysWithData ?? null;
  const windowDays = watched.windowDays ?? null;

  const partial =
    daysWithData !== null && windowDays !== null && daysWithData < windowDays;

  const daily =
    isWatchedMetricKey(watched.metric) &&
    WATCHED_METRICS[watched.metric].kind === 'sum' &&
    daysWithData !== null
      ? perDay(watched.value, daysWithData)
      : null;

  return (
    <span className={'text-muted-foreground text-xs'}>
      {formatWindow(watched.window)} · {watched.coveredVideos} of{' '}
      {watched.totalVideos} videos had data
      {partial ? (
        <span data-test={'watched-partial-coverage'}>
          {` · data on ${daysWithData} of ${windowDays} days`}
        </span>
      ) : null}
      {daily !== null ? ` · ${daily.toFixed(1)} per day` : null}
    </span>
  );
}

/** One side of the watched metric: a value, or why there is none. */
function WatchedSide({
  label,
  watched,
  testId,
  notYet,
}: {
  label: string;
  watched: WatchedValue | null | undefined;
  testId: string;
  /** What to say when this side has not been captured yet. */
  notYet: string;
}) {
  return (
    <div className={'flex flex-col gap-1'} data-test={testId}>
      <span className={'text-muted-foreground text-xs'}>{label}</span>

      {!watched ? (
        <span className={'text-muted-foreground text-sm'}>{notYet}</span>
      ) : watched.status === 'measured' ? (
        <>
          <span
            className={'text-lg font-semibold'}
            data-test={`${testId}-value`}
          >
            {formatWatchedValue(watched.value, watched.unit)}
          </span>
          <WatchedCoverage watched={watched} />
        </>
      ) : (
        // A reason, never a zero: "no data" and "measured zero" are different
        // facts, and a 0 here would say the second when it means the first.
        <span
          className={'text-muted-foreground text-sm'}
          data-test={`${testId}-unmeasured`}
          data-reason={watched.reason}
        >
          {UNMEASURED_REASON_TEXT[watched.reason]}
        </span>
      )}
    </div>
  );
}

function DeltaRow({
  label,
  before,
  after,
}: {
  label: string;
  before: number;
  after: number;
}) {
  const delta = after - before;
  const pct = before > 0 ? (delta / before) * 100 : null;
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : ArrowRight;

  return (
    <div className={'flex items-center justify-between gap-2 text-sm'}>
      <span className={'text-muted-foreground'}>{label}</span>
      <span className={'flex items-center gap-2'}>
        <span className={'text-muted-foreground'}>
          {before.toLocaleString()} → {after.toLocaleString()}
        </span>
        <span className={'flex items-center gap-0.5 font-medium'}>
          <Icon className={'h-3 w-3'} />
          {pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
        </span>
      </span>
    </div>
  );
}

/**
 * Shows an experiment's intent beside its measured result, including the
 * metric deltas captured automatically at start and conclusion.
 */
export function ExperimentDetail({
  experiment,
  isLoading = false,
}: ExperimentDetailProps) {
  if (isLoading) {
    return <ExperimentDetailSkeleton />;
  }

  const before = experiment.baseline_metrics?.totals;
  const after = experiment.result_metrics?.totals;
  // What the snapshots measured is the truth about them; the experiment's
  // current setting is only a fallback before anything has been captured.
  const baselineMetric = experiment.baseline_metrics?.watched?.metric;
  const resultMetric = experiment.result_metrics?.watched?.metric;
  const metric =
    baselineMetric ?? resultMetric ?? experiment.metric_watched ?? null;
  const metricLabel = metric ? metricLabelOf(metric) : null;
  const mismatched =
    baselineMetric !== undefined &&
    resultMetric !== undefined &&
    baselineMetric !== resultMetric;
  const resultAfterDays = experiment.result_metrics?.resultAfterDays;

  return (
    <div className={'flex flex-col gap-6'}>
      <div className={'flex flex-col gap-2'}>
        <div className={'flex items-center gap-2'}>
          <h2 className={'text-lg font-semibold'}>{experiment.title}</h2>
          <Badge variant={'secondary'}>{experiment.status}</Badge>
          {experiment.status === 'concluded' ? (
            <Badge variant={'outline'}>{experiment.outcome_status}</Badge>
          ) : null}
        </div>
        <p className={'text-muted-foreground text-xs'}>
          {experiment.started_at
            ? `Started ${experiment.started_at}`
            : 'Not started'}
          {experiment.ended_at ? ` · Ended ${experiment.ended_at}` : ''}
          {resultAfterDays !== undefined ? (
            <span data-test={'experiment-result-after-days'}>
              {` · result after ${resultAfterDays} days`}
            </span>
          ) : null}
          {experiment.review_window_days
            ? ` · ${experiment.review_window_days}-day review window`
            : ''}
          {experiment.status === 'running' && experiment.review_due_at
            ? ` · Due for review ${experiment.review_due_at}`
            : ''}
        </p>
        {experiment.category ? (
          <div>
            <Badge variant={'outline'} data-test={'experiment-detail-category'}>
              {categoryLabel(experiment.category)}
            </Badge>
          </div>
        ) : null}
      </div>

      <section className={'flex flex-col gap-3'}>
        <div className={'flex flex-col gap-1'}>
          <h3 className={'text-sm font-medium'}>What changed</h3>
          <p className={'text-muted-foreground text-sm'}>
            {experiment.change_description}
          </p>
        </div>

        {experiment.hypothesis?.trim() ? (
          <div className={'flex flex-col gap-1'}>
            <h3 className={'text-sm font-medium'}>Hypothesis</h3>
            <p className={'text-muted-foreground text-sm'}>
              {experiment.hypothesis}
            </p>
          </div>
        ) : null}

        <div className={'grid gap-3 sm:grid-cols-2'}>
          <div className={'flex flex-col gap-1 rounded-lg border p-3'}>
            <h3 className={'text-sm font-medium'}>Expected</h3>
            <p className={'text-muted-foreground text-sm'}>
              {textOr(experiment.expected_outcome, 'Not recorded')}
            </p>
          </div>

          <div className={'flex flex-col gap-1 rounded-lg border p-3'}>
            <h3 className={'text-sm font-medium'}>What actually happened</h3>
            <p className={'text-muted-foreground text-sm'}>
              {textOr(experiment.actual_outcome, 'Not concluded yet')}
            </p>
          </div>
        </div>
      </section>

      {metricLabel ? (
        <section
          className={'flex flex-col gap-2'}
          data-test={'experiment-watched'}
        >
          <h3 className={'text-sm font-medium'}>Watched: {metricLabel}</h3>
          {mismatched ? (
            <p
              className={'text-destructive text-sm'}
              data-test={'experiment-watched-mismatch'}
            >
              The baseline measured {metricLabelOf(baselineMetric!)} and the
              result measured {metricLabelOf(resultMetric!)}. They are not
              comparable.
            </p>
          ) : null}
          <div className={'grid gap-3 rounded-lg border p-3 sm:grid-cols-2'}>
            <WatchedSide
              label={'Before the change'}
              watched={experiment.baseline_metrics?.watched}
              testId={'experiment-watched-baseline'}
              notYet={'Measured when the experiment starts.'}
            />
            <WatchedSide
              label={'Since the change'}
              watched={experiment.result_metrics?.watched}
              testId={'experiment-watched-result'}
              notYet={'Measured when the experiment is concluded.'}
            />
          </div>
        </section>
      ) : null}

      {before && after ? (
        <section className={'flex flex-col gap-2'}>
          <h3 className={'text-sm font-medium'}>
            Measured change across{' '}
            {experiment.result_metrics?.publishCount ?? 0} videos
          </h3>
          <div className={'flex flex-col gap-1.5 rounded-lg border p-3'}>
            {METRICS.map((metric) => (
              <DeltaRow
                key={metric.key}
                label={metric.label}
                before={before[metric.key]}
                after={after[metric.key]}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className={'text-muted-foreground text-sm'}>
          Metric deltas appear once the experiment has been started and
          concluded.
        </p>
      )}

      {experiment.notes?.trim() ? (
        <section className={'flex flex-col gap-1'}>
          <h3 className={'text-sm font-medium'}>Notes</h3>
          <p
            className={'text-muted-foreground whitespace-pre-wrap text-sm'}
            data-test={'experiment-detail-notes'}
          >
            {experiment.notes}
          </p>
        </section>
      ) : null}
    </div>
  );
}

export function ExperimentDetailSkeleton() {
  return (
    <div className={'flex flex-col gap-6'}>
      <Skeleton className={'h-7 w-2/3'} />
      <Skeleton className={'h-20 w-full'} />
      <Skeleton className={'h-32 w-full'} />
    </div>
  );
}
