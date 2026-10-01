'use client';

import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

import {
  VIEW_DEFINITION_BUCKET,
  type ViewDefinitionMark,
  markedBuckets,
} from '../../lib/view-definition-marks';
import type { CardClaim } from '../overview/card-claim';
import { ChartMark, ChartMarks } from './chart-marks';

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
  /** Loading state */
  isLoading?: boolean;
  /** View-definition changes inside the range, drawn on their bucket (FILM-1722). */
  marks?: readonly ViewDefinitionMark[];
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

/** Which semantics produced the buckets. */
type MedianMode = 'cohort_views_to_date' | 'views_in_period';

/**
 * A bucket's month in words, for a sentence. The axis's "Sep 26" reads as
 * the 26th of September once it is inside one.
 */
function monthInWords(bucket: string): string {
  const date = new Date(bucket);

  return Number.isNaN(date.getTime())
    ? bucket
    : date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * The card's claim: the newest bucket's median, and how it compares with
 * the bucket before. The median is the headline because the mean is
 * hostage to one outlier: a single viral video makes a flat channel look
 * like it is growing.
 */
export function medianViewsClaim(
  buckets: readonly MedianBucketEntry[],
  mode: MedianMode,
): CardClaim {
  const latest = buckets[buckets.length - 1];

  if (!latest) {
    return {
      figure: null,
      noFigure: 'Not enough published videos yet.',
      sentence: 'A median needs published videos to compute.',
    };
  }

  const previous = buckets.length > 1 ? buckets[buckets.length - 2]! : null;
  const change =
    previous && previous.medianViews > 0
      ? Math.round(
          ((latest.medianViews - previous.medianViews) / previous.medianViews) *
            100,
        )
      : null;
  const subject =
    mode === 'cohort_views_to_date'
      ? `Median views to date for videos uploaded in ${monthInWords(latest.bucket)}`
      : `Median views per video accrued in ${monthInWords(latest.bucket)}`;
  const comparison =
    change === null || previous === null
      ? ''
      : change === 0
        ? `, level with ${monthInWords(previous.bucket)}`
        : `, ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on ${monthInWords(previous.bucket)}`;

  return {
    figure: formatViews(latest.medianViews),
    sentence: `${subject}${comparison}.`,
  };
}

/** What the card computes, and the outlier note when the mean runs away. */
export function medianViewsDetails(
  buckets: readonly MedianBucketEntry[],
  mode: MedianMode,
) {
  const latest = buckets[buckets.length - 1];
  const method =
    mode === 'cohort_views_to_date'
      ? 'Views to date for the videos uploaded in each month, as a median per video, with the middle half of videos shaded. A rising line means newer uploads outperform older ones.'
      : 'Views accrued within each month across the whole catalog, as a median per video, with the middle half of videos shaded.';
  const outlier =
    latest && latest.meanViews > latest.medianViews * 1.5
      ? `The mean is ${formatViews(latest.meanViews)} — an outlier is pulling the average up.`
      : null;

  return {
    method,
    caveats: [
      'The median resists outliers; one viral video can make a flat channel look like it is growing.',
      ...(outlier ? [outlier] : []),
    ] as const satisfies readonly [string, ...string[]],
  };
}

/**
 * Median views per video with the p25–p75 band, plotted against the mean.
 * The figure and its sentence are the shell's (`medianViewsClaim`).
 */
export function MedianViewsCard({
  buckets,
  isLoading = false,
  marks = [],
}: MedianViewsCardProps) {
  if (isLoading) {
    return <MedianViewsCardSkeleton />;
  }

  // The claim above says there is nothing to compute yet.
  if (buckets.length === 0) {
    return null;
  }

  const max = Math.max(
    ...buckets.map((b) => Math.max(b.p75Views, b.meanViews)),
    1,
  );
  const latest = buckets[buckets.length - 1]!;
  const marked = markedBuckets(
    buckets.map(({ bucket }) => bucket),
    marks,
  );

  return (
    <div className={'flex flex-col gap-4'}>
      <ChartMarks
        label={'Median views per video by month'}
        className={'flex items-end gap-1'}
        style={{ height: 96 }}
      >
        {buckets.map((bucket, index) => (
          <ChartMark
            key={bucket.bucket}
            col={index}
            data-view-definition={
              marked.has(bucket.bucket) ? 'true' : undefined
            }
            className={cn(
              'group relative h-full flex-1',
              marked.has(bucket.bucket) && VIEW_DEFINITION_BUCKET,
            )}
            style={{ height: '100%' }}
            detail={`${formatBucket(bucket.bucket)}: median ${formatViews(bucket.medianViews)}, mean ${formatViews(bucket.meanViews)} (${bucket.videoCount} videos)`}
            data-test={'median-bar'}
          >
            {/* p25–p75 band shows the spread the median summarizes. Placed
                by `bottom`, never a percentage margin: a vertical margin's
                percentage is of the width, which drew every band hundreds
                of pixels above the chart (KB-155). */}
            <div
              className={'absolute right-0 left-0 rounded-sm bg-primary/20'}
              data-test={'median-band'}
              style={{
                bottom: `${(bucket.p25Views / max) * 100}%`,
                height: `${((bucket.p75Views - bucket.p25Views) / max) * 100}%`,
              }}
            />
            <div
              className={'absolute right-0 left-0 h-0.5 bg-primary'}
              data-test={'median-line'}
              // Kept inside the bucket when the median is the tallest value.
              style={{
                bottom: `min(${(bucket.medianViews / max) * 100}%, calc(100% - 2px))`,
              }}
            />
          </ChartMark>
        ))}
      </ChartMarks>

      <div className={'flex justify-between text-xs text-muted-foreground'}>
        <span>{formatBucket(buckets[0]!.bucket)}</span>
        <span>{formatBucket(latest.bucket)}</span>
      </div>
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
