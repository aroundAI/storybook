'use client';

import { BarChart3 } from 'lucide-react';

import { interpretSpread } from '@kit/clickhouse';
import type { SegmentConfidence } from '@kit/clickhouse';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

/** One segment's aggregated performance, from getMedianByTagAction. */
export interface TagMedianEntry {
  segment: string;
  videoCount: number;
  /** Videos that actually reached the checkpoint. Drives `confidence`. */
  matureVideoCount: number;
  medianViews: number;
  meanViews: number;
  /** maxViews / medianViews, or null when the median is zero. */
  spread: number | null;
  confidence: SegmentConfidence;
  /** Pooled revenue per thousand views, when revenue was requested. */
  rpmCents?: number | null;
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
  /**
   * True when `rpmCents` covers only publish-attributed revenue, which it
   * always does — channel-level income belongs to no segment.
   */
  attributedRevenueOnly?: boolean;
  /** Loading state */
  isLoading?: boolean;
  /**
   * What a row is, for the empty copy. Language rows come from the segment
   * action — a `video_dim` column, not a taxonomy tag — and must not be
   * described as tags.
   */
  segmentNoun?: 'tag' | 'language';
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

function formatRpm(cents: number): string {
  return `$${(cents / 100).toFixed(2)} RPM`;
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
  attributedRevenueOnly = false,
  isLoading = false,
  segmentNoun = 'tag',
}: TagMediansCardProps) {
  if (isLoading) {
    return <TagMediansCardSkeleton />;
  }

  if (insufficientSample) {
    // Tag wording without a `segmentNoun` branch: only the tag action returns
    // this gate. A segment that gains one brings its own copy then, rather
    // than a second case here that nothing can reach.
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
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'tag-medians-empty'}
      >
        No {segmentNoun} has enough videos yet for a reliable median.
      </p>
    );
  }

  const maxMedian = Math.max(...rows.map((row) => row.medianViews), 1);

  return (
    <div className={'flex flex-col gap-3'}>
      {rows.map((row) => (
        <div
          key={row.segment}
          // Dimmed, never hidden: a hard gate removes the only information
          // a new channel has. The n travels with the row instead.
          className={cn(
            'flex flex-col gap-1',
            row.confidence !== 'reportable' && 'opacity-60',
          )}
        >
          <div className={'flex items-baseline justify-between gap-2'}>
            <span className={'truncate text-sm font-medium'}>
              {tagLabel(row.segment)}
            </span>
            <span className={'text-muted-foreground shrink-0 text-xs'}>
              {formatViews(row.medianViews)} median · {row.matureVideoCount} of{' '}
              {row.videoCount} videos
            </span>
          </div>

          <div className={'bg-muted h-2 w-full overflow-hidden rounded-full'}>
            <div
              className={'bg-primary h-full rounded-full'}
              style={{ width: `${(row.medianViews / maxMedian) * 100}%` }}
            />
          </div>

          <div
            className={'text-muted-foreground flex flex-wrap gap-x-2 text-xs'}
          >
            {row.confidence !== 'reportable' ? (
              <span>
                {row.confidence === 'insufficient'
                  ? 'Too few videos to report'
                  : 'Directional only'}
              </span>
            ) : null}

            {interpretSpread(row.spread) === 'carried_by_one' ? (
              <span>One video carrying it</span>
            ) : null}

            {row.meanViews > row.medianViews * 1.5 ? (
              <span>
                Mean {formatViews(row.meanViews)} — skewed by an outlier
              </span>
            ) : null}

            {typeof row.rpmCents === 'number' ? (
              <span>
                {formatRpm(row.rpmCents)}
                {attributedRevenueOnly ? ' (per-video revenue only)' : ''}
              </span>
            ) : null}
          </div>
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
