'use client';

import type { TrafficGroupBucket, TrafficSourceGroup } from '@kit/clickhouse';
import { Skeleton } from '@kit/ui/skeleton';

/** One bucket of the Browse+Suggested trend, derived from the breakdown. */
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
  /**
   * Names the denominator of the headline figure, which is the most recent
   * bucket — not the whole window. The stacked breakdown card sits beside
   * this one and legends the same "Browse + Suggested" label across the
   * entire window, so without saying which is which the two disagree on
   * screen with no way to reconcile them.
   */
  periodLabel?: string;
  /** True when the query failed, so the empty state does not lie about why. */
  isError?: boolean;
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
  periodLabel = 'latest period',
  isError = false,
}: TrafficShareCardProps) {
  if (isLoading) {
    return <TrafficShareCardSkeleton />;
  }

  // Same distinction the stacked card makes. Both are fed by one query, so
  // a failure that left this branch out would put "arrives with the bulk
  // report ingest" beside a card correctly reporting the fetch failed.
  if (isError && buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        Traffic-source data could not be loaded. This is a fetch failure, not an
        absence of data — retry, or check the project scope.
      </p>
    );
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
          Browse + Suggested, {periodLabel}
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
  /** True when the query failed, so the empty state does not lie about why. */
  isError?: boolean;
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
  isError = false,
}: TrafficBreakdownCardProps) {
  if (isLoading) {
    return <TrafficShareCardSkeleton />;
  }

  // Distinct from the empty state on purpose. "It arrives with the bulk
  // report ingest" is a promise about the future, and a scope denial or a
  // ClickHouse timeout will never keep it.
  // Only when there is nothing to fall back on: React Query keeps `data`
  // through a failed background refetch, and discarding a chart the user is
  // already reading is worse than quietly serving the last good one.
  if (isError && buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        Traffic-source data could not be loaded. This is a fetch failure, not an
        absence of data — retry, or check the project scope.
      </p>
    );
  }

  if (buckets.length === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        No traffic-source data yet. It arrives with the YouTube bulk report
        ingest.
      </p>
    );
  }

  // Over the whole window, not the latest bucket. The legend sits above a
  // chart spanning every bucket, so a per-bucket figure reads as the period
  // share and would be wrong by exactly the amount the last bucket differs.
  const windowViews = buckets.reduce((sum, b) => sum + b.totalViews, 0);
  const windowByGroup = new Map<TrafficSourceGroup, number>();

  for (const bucket of buckets) {
    for (const group of bucket.groups) {
      windowByGroup.set(
        group.group,
        (windowByGroup.get(group.group) ?? 0) + group.views,
      );
    }
  }

  const legend = (buckets[0]?.groups ?? []).map((group) => ({
    group: group.group,
    share:
      windowViews > 0 ? (windowByGroup.get(group.group) ?? 0) / windowViews : 0,
  }));

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex flex-wrap gap-x-4 gap-y-1'}>
        {legend.map((group) => (
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

      {/* Bars grow to fill but never shrink below min-w-2, which is what
          makes overflow-x-auto engage. `flex-1` alone does not: its default
          min-width:auto resolves to 0 for an empty div, so the bars would
          collapse to nothing and the row would render as blank gaps —
          degrading silently as history accumulates rather than failing at
          once. */}
      <div
        className={'flex items-end gap-1 overflow-x-auto'}
        style={{ height: 80 }}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.bucket}
            className={
              'flex h-full min-w-2 flex-1 flex-col-reverse overflow-hidden rounded-sm'
            }
          >
            {bucket.groups.map((group) => (
              <div
                key={group.group}
                className={GROUP_COLORS[group.group]}
                style={{
                  height: `${group.share * 100}%`,
                  // A group under ~1.3% is sub-pixel in an 80px stack: it
                  // disappears and its tooltip becomes unhoverable, so a
                  // small-but-real surface reads as absent.
                  minHeight: group.views > 0 ? 2 : 0,
                }}
                title={`${bucket.bucket} — ${GROUP_LABELS[group.group]}: ${Math.round(
                  group.share * 100,
                )}% of ${bucket.totalViews.toLocaleString()} views`}
              />
            ))}
          </div>
        ))}
      </div>

      <p className={'text-muted-foreground text-xs'}>
        Percentages are the share across the whole window shown. Shares cover
        videos published through this platform. Views on channel videos that
        never matched a publish are not counted, so these percentages will not
        match YouTube Studio exactly.
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
