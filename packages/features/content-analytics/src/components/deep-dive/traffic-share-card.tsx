'use client';

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
          className={'border-foreground/40 absolute right-0 left-0 border-t border-dashed'}
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

export function TrafficShareCardSkeleton() {
  return (
    <div className={'flex flex-col gap-4'}>
      <Skeleton className={'h-8 w-28'} />
      <Skeleton className={'h-20 w-full'} />
    </div>
  );
}
