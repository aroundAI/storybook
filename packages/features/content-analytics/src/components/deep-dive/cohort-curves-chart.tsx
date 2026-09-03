'use client';

import { Skeleton } from '@kit/ui/skeleton';

/** One cohort from getCohortCurvesAction. */
export interface CohortEntry {
  cohort: string;
  videoCount: number;
  cohortAgeDays: number;
  checkpoints: Array<{
    ageDays: number;
    totalViews: number;
    viewsPerVideo: number;
    mature: boolean;
  }>;
}

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
      c.checkpoints.filter((p) => p.mature).map((p) => p.viewsPerVideo),
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

                {cohort.checkpoints.map((point) => (
                  <td key={point.ageDays} className={'px-2 py-2 text-right'}>
                    {point.mature ? (
                      <span className={'inline-flex flex-col items-end gap-1'}>
                        <span>{formatViews(point.viewsPerVideo)}</span>
                        <span
                          className={'bg-primary/70 h-1 rounded-full'}
                          style={{
                            width: `${Math.max(
                              4,
                              (point.viewsPerVideo / maxViews) * 48,
                            )}px`,
                          }}
                        />
                      </span>
                    ) : (
                      <span className={'text-muted-foreground text-xs'}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={'text-muted-foreground text-xs'}>
        Views per video at each age. Compare cohorts down a column — same age,
        different upload quarter. Dashes mark cohorts too young to have reached
        that checkpoint.
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
