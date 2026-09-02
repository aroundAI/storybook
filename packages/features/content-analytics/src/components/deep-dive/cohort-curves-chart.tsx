'use client';

import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

/** Why a growth figure is absent, when it is. */
export type GrowthSuppressionReason =
  | 'no_prior_cohort'
  | 'insufficient_sample'
  | 'no_prior_baseline';

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
    /** Videos old enough to have reached this checkpoint. */
    matureVideoCount: number;
    mature: boolean;
    growth: number | null;
    growthSuppressedBecause: GrowthSuppressionReason | null;
  }>;
}

/** Below this, a median is shown but marked as thin evidence. */
const LOW_SAMPLE = 5;

interface CohortCurvesChartProps {
  /** Cohorts in chronological order */
  cohorts: CohortEntry[];
  /** Loading state */
  isLoading?: boolean;
}

function formatViews(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatCohort(cohort: string): string {
  const date = new Date(cohort);
  if (Number.isNaN(date.getTime())) return cohort;
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
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
  isLoading = false,
}: CohortCurvesChartProps) {
  if (isLoading) {
    return <CohortCurvesChartSkeleton />;
  }

  if (cohorts.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>No upload cohorts yet.</p>
    );
  }

  const checkpointAges = cohorts[0]!.checkpoints.map((c) => c.ageDays);

  const maxViews = Math.max(
    ...cohorts.flatMap((c) =>
      c.checkpoints.filter((p) => p.mature).map((p) => p.medianViews),
    ),
    1,
  );

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'overflow-x-auto'}>
        <table className={'w-full min-w-[420px] text-sm'}>
          <thead>
            <tr className={'text-muted-foreground text-xs'}>
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
                    {formatCohort(cohort.cohort)}
                  </span>
                  <span className={'text-muted-foreground ml-2 text-xs'}>
                    {cohort.videoCount} videos
                  </span>
                </td>

                {cohort.checkpoints.map((point) => {
                  const thin = point.matureVideoCount < LOW_SAMPLE;

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
                          title={
                            thin
                              ? `${point.matureVideoCount} of ${cohort.videoCount} videos have reached ${point.ageDays}d`
                              : `${point.matureVideoCount} videos · p25 ${formatViews(point.p25Views)} · p75 ${formatViews(point.p75Views)}`
                          }
                        >
                          <span>{formatViews(point.medianViews)}</span>

                          <span
                            className={'bg-primary/70 h-1 rounded-full'}
                            style={{
                              width: `${Math.max(
                                4,
                                (point.medianViews / maxViews) * 48,
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
                          ) : null}
                        </span>
                      ) : (
                        <span className={'text-muted-foreground text-xs'}>
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

      <p className={'text-muted-foreground text-xs'}>
        Median views per video at each age, with growth against the previous
        cohort. Compare down a column — same age, different upload period.
        Dashes mark cohorts too young to have reached that checkpoint; dimmed
        figures rest on fewer than {LOW_SAMPLE} videos, and growth is withheld
        entirely below that.
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
