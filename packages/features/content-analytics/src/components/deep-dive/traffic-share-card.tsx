'use client';

import type { TrafficGroupBucket, TrafficSourceGroup } from '@kit/clickhouse';
import { Skeleton } from '@kit/ui/skeleton';

/** One bucket from getTrafficShareTrendAction. */
export interface TrafficShareEntry {
  bucket: string;
  totalViews: number;
  browseSuggestedViews: number;
  share: number;
}

interface TrafficShareCardProps {
  /** Buckets in chronological order */
  buckets: TrafficShareEntry[];
  /** Loading state */
  isLoading?: boolean;
}

/** Share above which a channel reads as algorithm-recommended. */
const RECOMMENDED_CHANNEL_THRESHOLD = 0.6;

/**
 * Browse + Suggested as a share of views over time — the clearest signal
 * of whether the algorithm has decided what the channel is for. Early on
 * most views come from Search and external; crossing ~60% means the
 * channel has entered recommended territory.
 */
export function TrafficShareCard({
  buckets,
  isLoading = false,
}: TrafficShareCardProps) {
  if (isLoading) {
    return <TrafficShareCardSkeleton />;
  }

  if (buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        No traffic-source data yet. It arrives with the YouTube bulk report
        ingest.
      </p>
    );
  }

  const latest = buckets[buckets.length - 1]!;
  const crossed = latest.share >= RECOMMENDED_CHANNEL_THRESHOLD;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex items-baseline gap-2'}>
        <span className={'text-2xl font-semibold'}>
          {Math.round(latest.share * 100)}%
        </span>
        <span className={'text-muted-foreground text-sm'}>
          Browse + Suggested
        </span>
      </div>

      <div className={'relative flex items-end gap-1'} style={{ height: 80 }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.bucket}
            className={'bg-primary/70 flex-1 rounded-sm'}
            style={{ height: `${Math.max(2, bucket.share * 100)}%` }}
            title={`${bucket.bucket}: ${Math.round(bucket.share * 100)}% of ${bucket.totalViews.toLocaleString()} views`}
          />
        ))}

        <div
          className={
            'border-foreground/40 absolute left-0 right-0 border-t border-dashed'
          }
          style={{ bottom: `${RECOMMENDED_CHANNEL_THRESHOLD * 100}%` }}
        />
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {crossed
          ? 'Above 60% — the algorithm is recommending this channel rather than merely answering searches.'
          : 'Below 60% — views still come mostly from Search and external sources. The dashed line marks recommended-channel territory.'}
      </p>
    </div>
  );
}

/**
 * Group labels and colours.
 *
 * `direct` is labelled "Direct / unknown" deliberately: the underlying
 * source is DIRECT_OR_UNKNOWN, and calling it "Direct" alone overstates
 * what the API actually reports.
 */
const GROUP_LABELS: Record<TrafficSourceGroup, string> = {
  browse_suggested: 'Browse + Suggested',
  search: 'Search',
  shorts_feed: 'Shorts feed',
  external: 'External',
  playlists: 'Playlists',
  channel_page: 'Channel page',
  direct: 'Direct / unknown',
  other: 'Other',
};

const GROUP_COLORS: Record<TrafficSourceGroup, string> = {
  browse_suggested: 'bg-chart-1',
  search: 'bg-chart-2',
  shorts_feed: 'bg-chart-3',
  external: 'bg-chart-4',
  playlists: 'bg-chart-5',
  channel_page: 'bg-primary/40',
  direct: 'bg-muted-foreground/40',
  other: 'bg-muted-foreground',
};

interface TrafficBreakdownCardProps {
  /** Buckets in chronological order, from getTrafficBreakdownAction. */
  buckets: TrafficGroupBucket[];
  isLoading?: boolean;
}

/**
 * Stacked traffic-source breakdown (FILM-1605).
 *
 * Every group is drawn in every bucket, including at zero, so the stack
 * order never changes between renders. The share is over matched videos
 * only — unmatched traffic rows are dropped at ingest — so it will not
 * match Studio exactly, which the footnote says rather than leaving the
 * reader to discover.
 */
export function TrafficBreakdownCard({
  buckets,
  isLoading = false,
}: TrafficBreakdownCardProps) {
  if (isLoading) {
    return <TrafficShareCardSkeleton />;
  }

  if (buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        No traffic-source data yet. It arrives with the YouTube bulk report
        ingest.
      </p>
    );
  }

  const latest = buckets[buckets.length - 1]!;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex flex-wrap gap-x-4 gap-y-1'}>
        {latest.groups.map((group) => (
          <span
            key={group.group}
            className={'flex items-center gap-1.5 text-xs'}
          >
            <span
              className={`size-2 rounded-full ${GROUP_COLORS[group.group]}`}
            />
            <span className={'text-muted-foreground'}>
              {GROUP_LABELS[group.group]}
            </span>
            <span className={'font-medium'}>
              {Math.round(group.share * 100)}%
            </span>
          </span>
        ))}
      </div>

      <div className={'flex items-end gap-1'} style={{ height: 80 }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.bucket}
            className={
              'flex h-full flex-1 flex-col-reverse overflow-hidden rounded-sm'
            }
          >
            {bucket.groups.map((group) => (
              <div
                key={group.group}
                className={GROUP_COLORS[group.group]}
                style={{ height: `${group.share * 100}%` }}
                title={`${bucket.bucket} — ${GROUP_LABELS[group.group]}: ${Math.round(
                  group.share * 100,
                )}% of ${bucket.totalViews.toLocaleString()} views`}
              />
            ))}
          </div>
        ))}
      </div>

      <p className={'text-muted-foreground text-xs'}>
        Shares cover videos published through this platform. Views on channel
        videos that never matched a publish are not counted, so these
        percentages will not match YouTube Studio exactly.
      </p>
    </div>
  );
}

export function TrafficShareCardSkeleton() {
  return (
    <div className={'flex flex-col gap-4'}>
      <Skeleton className={'h-8 w-28'} />
      <Skeleton className={'h-20 w-full'} />
    </div>
  );
}
