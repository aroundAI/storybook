'use client';

import { MIN_MATURE_VIDEOS } from '@kit/clickhouse';
import type { GrowthSuppressionReason } from '@kit/clickhouse';
import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

import { formatCohort } from '../../lib/cohort-label';

/** One cohort from getCohortCurvesAction. */
export interface CohortEntry {
  cohort: string;
  videoCount: number;
  checkpoints: Array<{
    ageDays: number;
    medianViews: number;
    p25Views: number;
    p75Views: number;
    meanViews: number;
    /** Videos old enough to have reached this checkpoint, and ingested. */
    matureVideoCount: number;
    /** Old enough, but published before their channel's ingest began. */
    predatesIngestCount: number;
    mature: boolean;
    growth: number | null;
    growthSuppressedBecause: GrowthSuppressionReason | null;
  }>;
}

/**
 * What a suppressed growth figure shows instead of a number.
 *
 * Blank would read as "no change". Each reason is a different statement —
 * "nothing to compare against" is not "not enough videos yet" — and the
 * enum exists to draw exactly that distinction, so it has to reach the
 * screen.
 */
const SUPPRESSION_LABEL: Record<GrowthSuppressionReason, string> = {
  no_prior_cohort: 'first',
  insufficient_sample: 'low n',
  no_prior_baseline: 'no base',
};

const SUPPRESSION_TITLE: Record<GrowthSuppressionReason, string> = {
  no_prior_cohort: 'No earlier cohort to compare against',
  insufficient_sample: `Fewer than ${MIN_MATURE_VIDEOS} mature videos on one side of the comparison`,
  no_prior_baseline:
    'The previous cohort median is zero, so a ratio is undefined',
};

interface CohortCurvesChartProps {
  /** Cohorts in chronological order */
  cohorts: CohortEntry[];
  /**
   * Must match the bucket the cohorts were queried with — the action
   * accepts 'month' too, and labelling those as quarters would render
   * Jan/Feb/Mar 2026 as three identical "Q1 2026" rows.
   */
  bucket?: 'month' | 'quarter';
  /** Loading state */
  isLoading?: boolean;
}

function formatViews(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/**
 * Per-video cumulative views at fixed ages, grouped by upload quarter.
 *
 * This is the closest thing to a true growth measurement, because it
 * controls for how long each video has been live: a later cohort beating
 * an earlier one *at the same age* is real improvement, which raw monthly
 * totals can never show. Immature checkpoints are marked rather than
 * rendered as low numbers, so a young cohort is not misread as weak.
 */
export function CohortCurvesChart({
  cohorts,
  bucket = 'quarter',
  isLoading = false,
}: CohortCurvesChartProps) {
  if (isLoading) {
    return <CohortCurvesChartSkeleton />;
  }

  if (cohorts.length === 0) {
    return (
      <p className={'text-sm text-muted-foreground'}>No upload cohorts yet.</p>
    );
  }

  const checkpointAges = cohorts[0]!.checkpoints.map((c) => c.ageDays);

  // Scaled per column, not globally. Bars are compared *down* a column —
  // same age, different upload period — and a 365d median is naturally an
  // order of magnitude above a 30d one, so a shared ruler crushes the early
  // columns flat against the 4px floor.
  //
  // Thin points are excluded from the ruler for the same reason they are
  // dimmed: one video's luck should not set the scale everything else is
  // measured against. A cohort is `mature` at a checkpoint once a single
  // video has reached it, so without this a brand-new quarter holding one
  // viral video would flatten every other bar in the table.
  const maxViewsByAge = new Map(
    checkpointAges.map((age) => [
      age,
      Math.max(
        ...cohorts.flatMap((cohort) =>
          cohort.checkpoints
            .filter(
              (point) =>
                point.ageDays === age &&
                point.mature &&
                point.matureVideoCount >= MIN_MATURE_VIDEOS,
            )
            .map((point) => point.medianViews),
        ),
        1,
      ),
    ]),
  );

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'overflow-x-auto'}>
        <table className={'w-full min-w-[420px] text-sm'}>
          <thead>
            <tr className={'text-xs text-muted-foreground'}>
              <th className={'py-1 pr-3 text-left font-medium'}>Cohort</th>
              {checkpointAges.map((age) => (
                <th key={age} className={'px-2 py-1 text-right font-medium'}>
                  {age}d
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort.cohort} className={'border-t'}>
                <td className={'py-2 pr-3'}>
                  <span className={'font-medium'}>
                    {formatCohort(cohort.cohort, bucket)}
                  </span>
                  <span className={'ml-2 text-xs text-muted-foreground'}>
                    {cohort.videoCount} videos
                  </span>
                </td>

                {cohort.checkpoints.map((point) => {
                  const thin = point.matureVideoCount < MIN_MATURE_VIDEOS;

                  return (
                    <td key={point.ageDays} className={'px-2 py-2 text-right'}>
                      {point.mature ? (
                        <span
                          className={cn(
                            'inline-flex flex-col items-end gap-1',
                            // Dimmed, not hidden: a median resting on a
                            // couple of videos is still information, just
                            // not evidence.
                            thin && 'opacity-50',
                          )}
                          title={[
                            thin
                              ? `${point.matureVideoCount} of ${cohort.videoCount} videos have reached ${point.ageDays}d`
                              : `${point.matureVideoCount} videos · p25 ${formatViews(point.p25Views)} · p75 ${formatViews(point.p75Views)}`,
                            // Explains a thin sample that is thin because
                            // the data cannot exist, not because the
                            // cohort is young.
                            point.predatesIngestCount > 0
                              ? `${point.predatesIngestCount} published before analytics ingest began and are excluded`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <span>{formatViews(point.medianViews)}</span>

                          <span
                            className={'h-1 rounded-full bg-primary/70'}
                            style={{
                              // Clamped: a point excluded from the ruler
                              // can exceed it, and an unclamped bar would
                              // overflow the cell.
                              width: `${Math.min(
                                48,
                                Math.max(
                                  4,
                                  (point.medianViews /
                                    (maxViewsByAge.get(point.ageDays) ?? 1)) *
                                    48,
                                ),
                              )}px`,
                            }}
                          />

                          {point.growth !== null ? (
                            <span
                              className={cn(
                                'text-xs',
                                point.growth >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {point.growth >= 0 ? '+' : ''}
                              {Math.round(point.growth * 100)}%
                            </span>
                          ) : point.growthSuppressedBecause ? (
                            <span
                              className={'text-xs text-muted-foreground/70'}
                              title={
                                SUPPRESSION_TITLE[point.growthSuppressedBecause]
                              }
                            >
                              {SUPPRESSION_LABEL[point.growthSuppressedBecause]}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className={'text-xs text-muted-foreground'}>
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={'text-xs text-muted-foreground'}>
        Median views per video at each age, with growth against the previous
        cohort. Compare down a column — same age, different upload period.
        Dashes mark cohorts too young to have reached that checkpoint; dimmed
        figures rest on fewer than {MIN_MATURE_VIDEOS} videos, and growth is
        withheld below that with the reason shown in its place.
      </p>
    </div>
  );
}

export function CohortCurvesChartSkeleton() {
  return (
    <div className={'flex flex-col gap-2'}>
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className={'h-8 w-full'} />
      ))}
    </div>
  );
}
