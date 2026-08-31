'use client';

import { useMemo } from 'react';

import { Skeleton } from '@kit/ui/skeleton';

import { detectRetentionCliff } from '../../lib/retention';
import type { RetentionPoint } from '../../lib/retention';

interface RetentionCurveChartProps {
  /** Curve points from queryRetentionCurve */
  points: RetentionPoint[];
  /** Video length, used to label the cliff position in seconds */
  durationSeconds?: number;
  /** Loading state */
  isLoading?: boolean;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Audience retention curve with the sharpest early drop-off marked.
 *
 * A steep early cliff means the intro failed — a specific, fixable thing —
 * whereas gradual decay across the body of the video is normal and not
 * worth reacting to.
 */
export function RetentionCurveChart({
  points,
  durationSeconds,
  isLoading = false,
}: RetentionCurveChartProps) {
  const cliff = useMemo(
    () => detectRetentionCliff(points, { durationSeconds }),
    [points, durationSeconds],
  );

  const path = useMemo(() => {
    if (points.length === 0) return '';

    const sorted = [...points].sort((a, b) => a.elapsedRatio - b.elapsedRatio);

    return sorted
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${(point.elapsedRatio * 100).toFixed(2)} ${(
            100 - point.audienceWatchRatio * 100
          ).toFixed(2)}`,
      )
      .join(' ');
  }, [points]);

  if (isLoading) {
    return <RetentionCurveChartSkeleton />;
  }

  if (points.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        No retention curve available for this video yet.
      </p>
    );
  }

  return (
    <div className={'flex flex-col gap-3'}>
      <svg
        viewBox={'0 0 100 100'}
        preserveAspectRatio={'none'}
        className={'bg-muted/30 h-40 w-full rounded-md'}
        role={'img'}
        aria-label={'Audience retention curve'}
      >
        <path
          d={`${path} L 100 100 L 0 100 Z`}
          className={'fill-primary/15'}
          stroke={'none'}
        />
        <path
          d={path}
          className={'stroke-primary'}
          fill={'none'}
          strokeWidth={1.5}
          vectorEffect={'non-scaling-stroke'}
        />

        {cliff ? (
          <line
            x1={cliff.position * 100}
            y1={0}
            x2={cliff.position * 100}
            y2={100}
            className={'stroke-red-500'}
            strokeWidth={1}
            strokeDasharray={'3 3'}
            vectorEffect={'non-scaling-stroke'}
          />
        ) : null}
      </svg>

      <p className={'text-muted-foreground text-xs'}>
        {cliff
          ? `Sharp drop of ${Math.round(cliff.drop * 100)} points${
              cliff.seconds !== undefined
                ? ` around ${formatTimestamp(cliff.seconds)}`
                : ''
            } — the opening is losing viewers.`
          : 'No sharp early drop-off; the opening is holding viewers.'}
      </p>
    </div>
  );
}

export function RetentionCurveChartSkeleton() {
  return (
    <div className={'flex flex-col gap-3'}>
      <Skeleton className={'h-40 w-full rounded-md'} />
      <Skeleton className={'h-3 w-2/3'} />
    </div>
  );
}
