'use client';

import { BarChart3 } from 'lucide-react';

import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

/** One tag's aggregated performance, from getMedianByTagAction. */
export interface TagMedianEntry {
  tag: string;
  videoCount: number;
  medianViews: number;
  meanViews: number;
}

interface TagMediansCardProps {
  /** Rows to render, highest median first */
  rows: TagMedianEntry[];
  /** True while the account has too few tagged videos to compare */
  insufficientSample?: boolean;
  /** Videos tagged so far (shown in the gate message) */
  taggedCount?: number;
  /** Videos required before medians are shown */
  required?: number;
  /** Loading state */
  isLoading?: boolean;
}

function formatViews(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/** Strips the 'dimension:' prefix stored in video_dim.tags. */
function tagLabel(tag: string): string {
  const separator = tag.indexOf(':');
  return separator >= 0 ? tag.slice(separator + 1) : tag;
}

/**
 * Median performance by tag. Medians, not means: a single viral video
 * drags a mean upward and would make a mediocre format look like a winner.
 */
export function TagMediansCard({
  rows,
  insufficientSample = false,
  taggedCount = 0,
  required = 30,
  isLoading = false,
}: TagMediansCardProps) {
  if (isLoading) {
    return <TagMediansCardSkeleton />;
  }

  if (insufficientSample) {
    return (
      <div className={'flex flex-col gap-3'}>
        <p className={'text-muted-foreground text-sm'}>
          Tag-level medians unlock once {required} videos are tagged — below
          that, per-tag samples are too small to separate a real format effect
          from luck.
        </p>
        <Progress value={(taggedCount / required) * 100} />
        <p className={'text-muted-foreground text-xs'}>
          {taggedCount} of {required} videos tagged
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        No tag has enough videos yet for a reliable median.
      </p>
    );
  }

  const maxMedian = Math.max(...rows.map((row) => row.medianViews), 1);

  return (
    <div className={'flex flex-col gap-3'}>
      {rows.map((row) => (
        <div key={row.tag} className={'flex flex-col gap-1'}>
          <div className={'flex items-baseline justify-between gap-2'}>
            <span className={'truncate text-sm font-medium'}>
              {tagLabel(row.tag)}
            </span>
            <span className={'text-muted-foreground shrink-0 text-xs'}>
              {formatViews(row.medianViews)} median · {row.videoCount} videos
            </span>
          </div>

          <div className={'bg-muted h-2 w-full overflow-hidden rounded-full'}>
            <div
              className={'bg-primary h-full rounded-full'}
              style={{ width: `${(row.medianViews / maxMedian) * 100}%` }}
            />
          </div>

          {row.meanViews > row.medianViews * 1.5 ? (
            <p className={'text-muted-foreground text-xs'}>
              Mean {formatViews(row.meanViews)} — skewed by an outlier
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TagMediansCardSkeleton() {
  return (
    <div className={'flex flex-col gap-3'}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={'flex flex-col gap-1'}>
          <Skeleton className={'h-4 w-1/2'} />
          <Skeleton className={'h-2 w-full'} />
        </div>
      ))}
    </div>
  );
}

export const TagMediansIcon = BarChart3;
