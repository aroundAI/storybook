'use client';

import { Skeleton } from '@kit/ui/skeleton';

/** One bucket from getMedianPerformanceAction. */
export interface MedianBucketEntry {
  bucket: string;
  videoCount: number;
  medianViews: number;
  p25Views: number;
  p75Views: number;
  meanViews: number;
}

interface MedianViewsCardProps {
  /** Buckets in chronological order */
  buckets: MedianBucketEntry[];
  /** Which semantics produced these buckets */
  mode?: 'cohort_views_to_date' | 'views_in_period';
  /** Loading state */
  isLoading?: boolean;
}

function formatViews(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatBucket(bucket: string): string {
  const date = new Date(bucket);
  return Number.isNaN(date.getTime())
    ? bucket
    : date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

/**
 * Median views per video with the p25–p75 band, plotted against the mean.
 *
 * The median is the headline because the mean is hostage to one outlier:
 * a single viral video makes a flat channel look like it is growing.
 */
export function MedianViewsCard({
  buckets,
  mode = 'cohort_views_to_date',
  isLoading = false,
}: MedianViewsCardProps) {
  if (isLoading) {
    return <MedianViewsCardSkeleton />;
  }

  if (buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        Not enough published videos yet to compute a median.
      </p>
    );
  }

  const max = Math.max(...buckets.map((b) => Math.max(b.p75Views, b.meanViews)), 1);
  const latest = buckets[buckets.length - 1]!;
  const previous = buckets.length > 1 ? buckets[buckets.length - 2] : null;
  const change =
    previous && previous.medianViews > 0
      ? ((latest.medianViews - previous.medianViews) / previous.medianViews) *
        100
      : null;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex items-baseline gap-2'}>
        <span className={'text-2xl font-semibold'}>
          {formatViews(latest.medianViews)}
        </span>
        <span className={'text-muted-foreground text-sm'}>median</span>
        {change !== null ? (
          <span
            className={`text-sm ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(0)}%
          </span>
        ) : null}
      </div>

      <div className={'flex items-end gap-1'} style={{ height: 96 }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.bucket}
            className={'group relative flex flex-1 flex-col justify-end'}
            title={`${formatBucket(bucket.bucket)}: median ${formatViews(bucket.medianViews)}, mean ${formatViews(bucket.meanViews)} (${bucket.videoCount} videos)`}
          >
            {/* p25–p75 band shows the spread the median summarizes */}
            <div
              className={'bg-primary/20 relative w-full rounded-sm'}
              style={{
                height: `${((bucket.p75Views - bucket.p25Views) / max) * 100}%`,
                marginBottom: `${(bucket.p25Views / max) * 100}%`,
              }}
            >
              <div
                className={'bg-primary absolute right-0 left-0 h-0.5'}
                style={{
                  bottom: `${
                    bucket.p75Views > bucket.p25Views
                      ? ((bucket.medianViews - bucket.p25Views) /
                          (bucket.p75Views - bucket.p25Views)) *
                        100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className={'text-muted-foreground flex justify-between text-xs'}>
        <span>{formatBucket(buckets[0]!.bucket)}</span>
        <span>{formatBucket(latest.bucket)}</span>
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {mode === 'cohort_views_to_date'
          ? 'Views to date for videos uploaded each month. A rising line means newer uploads outperform older ones.'
          : 'Views accrued within each month across the whole catalog.'}
        {latest.meanViews > latest.medianViews * 1.5
          ? ` Mean is ${formatViews(latest.meanViews)} — an outlier is pulling the average up.`
          : ''}
      </p>
    </div>
  );
}

export function MedianViewsCardSkeleton() {
  return (
    <div className={'flex flex-col gap-4'}>
      <Skeleton className={'h-8 w-32'} />
      <Skeleton className={'h-24 w-full'} />
    </div>
  );
}
