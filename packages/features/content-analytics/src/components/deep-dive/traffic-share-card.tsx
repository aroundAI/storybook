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
  /**
   * Names the window the query asked for. The empty state used to promise
   * the data "arrives with the ingest", which is wrong when the data exists
   * and merely predates the window the caller chose.
   */
  windowLabel?: string;
  /** Buckets in chronological order */
  buckets: TrafficShareEntry[];
  /** Loading state */
  isLoading?: boolean;
  /**
   * Noun for one bucket ('week', 'month'). The headline names the actual
   * bucket it came from, because that bucket is the newest one *present in
   * the response*, not the current one — buckets exist only where traffic
   * rows do, so a paused channel's newest bucket can be months old. The
   * stacked card beside this one legends the whole window under the same
   * label, so both have to say what they cover.
   */
  bucketNoun?: string;
  /** True when the query failed, so the empty state does not lie about why. */
  isError?: boolean;
}

/**
 * Bar and stack height in px, shared by both cards and by `stackHeights`,
 * which does its floor arithmetic against it.
 */
const STACK_HEIGHT_PX = 80;

/** Smallest height a non-zero bar or slice may draw at. */
const MIN_SLICE_PX = 2;

/** The same floor as a percentage, for the cards that size in percentages. */
const MIN_SLICE_FLOOR_PERCENT = (MIN_SLICE_PX / STACK_HEIGHT_PX) * 100;

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
  bucketNoun = 'period',
  isError = false,
  windowLabel = 'this window',
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
        No traffic-source data in {windowLabel}. Anything older falls outside
        this window; new data arrives with the YouTube bulk report ingest.
      </p>
    );
  }

  const latest = buckets[buckets.length - 1]!;
  // Gated on the *displayed* figure, not the raw share. Rounding to a whole
  // percent while testing the unrounded value disagrees on [59.5%, 60%): the
  // headline reads "60%" directly above a footnote saying "Below 60%".
  const shownPercent = Math.round(latest.share * 100);
  const crossed = shownPercent >= RECOMMENDED_CHANNEL_THRESHOLD * 100;
  // A share of 0 out of 0 views is not a composition, and saying "views come
  // mostly from Search" about a week with no views contradicts the stacked
  // card, which renders the same bucket as "no views".
  const hasViews = latest.totalViews > 0;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex items-baseline gap-2'}>
        <span className={'text-2xl font-semibold'}>
          {hasViews ? `${shownPercent}%` : '—'}
        </span>
        <span className={'text-muted-foreground text-sm'}>
          Browse + Suggested — {bucketNoun} of {latest.bucket}
        </span>
      </div>

      <div className={'overflow-x-auto'}>
        {/* The threshold line is positioned against this inner box, not the
            scroller: an absolute child of an overflow container is laid out
            against its *visible* width and scrolls away with the content,
            while a wrapper outside the scroller does not lose the
            scrollbar's height and so sits a few pixels off the bars. Sized
            to content but at least full width, this box is both the bars'
            containing block and the full scroll width. */}
        <div
          className={'relative flex w-max min-w-full items-end gap-1'}
          style={{ height: STACK_HEIGHT_PX }}
        >
          {buckets.map((bucket) => (
            <div
              key={bucket.bucket}
              className={`min-w-2 flex-1 rounded-sm ${
                bucket.totalViews === 0
                  ? 'bg-muted-foreground/30'
                  : 'bg-primary/70'
              }`}
              style={{
                // The same MIN_SLICE_PX floor the stacked card uses, expressed
                // as a percentage of the same nominal height — it read as a
                // bare `2` percent (1.6px) before, so the two adjacent charts
                // floored at different heights off one query. Bars here are
                // independent, so a floored bar's tooltip still reports its
                // true share; there is no neighbouring slice to borrow from.
                height: `${Math.max(MIN_SLICE_FLOOR_PERCENT, bucket.share * 100)}%`,
              }}
              title={
                bucket.totalViews === 0
                  ? `${bucket.bucket}: no views`
                  : `${bucket.bucket}: ${Math.round(bucket.share * 100)}% of ${bucket.totalViews.toLocaleString()} views`
              }
            />
          ))}

          <div
            className={
              'border-foreground/40 pointer-events-none absolute left-0 right-0 border-t border-dashed'
            }
            style={{ bottom: `${RECOMMENDED_CHANNEL_THRESHOLD * 100}%` }}
          />
        </div>
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {!hasViews
          ? `No views in the ${bucketNoun} of ${latest.bucket}, so there is no traffic mix to report. That is the newest ${bucketNoun} with data.`
          : crossed
            ? `Above 60% in the ${bucketNoun} shown — recommendations, not just search. That is the newest ${bucketNoun} with traffic; it may not be the current one, and report ingest lags a few days so it may be only partly counted.`
            : `Below 60% in the ${bucketNoun} shown — views still come mostly from Search and external sources. The dashed line marks recommended-channel territory.`}
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

/**
 * Pixel height per group for one bucket's stack.
 *
 * Percentage heights summing to 100% cannot carry a per-slice minimum: the
 * floors add pixels the container takes back out of every slice, so a 97%
 * group drew at roughly 82% while its own tooltip still reported 97%.
 * Laying the stack out in pixels lets the floors be borrowed from the
 * largest slice — the only one with room — so the total stays exactly the
 * container height and the distortion lands where it is least visible.
 */
function stackHeights(
  bucket: TrafficGroupBucket,
): Map<TrafficSourceGroup, string> {
  const pixels = new Map<TrafficSourceGroup, number>();
  const asPercent = (px: number) => `${(px / STACK_HEIGHT_PX) * 100}%`;

  if (bucket.totalViews === 0) {
    // An invisible column between full-height neighbours reads as a
    // rendering hole rather than a quiet week.
    return new Map([['other' as TrafficSourceGroup, asPercent(MIN_SLICE_PX)]]);
  }

  let borrowed = 0;

  for (const group of bucket.groups) {
    const raw = group.share * STACK_HEIGHT_PX;

    if (group.views > 0 && raw < MIN_SLICE_PX) {
      pixels.set(group.group, MIN_SLICE_PX);
      borrowed += MIN_SLICE_PX - raw;
    } else {
      pixels.set(group.group, raw);
    }
  }

  const largest = [...bucket.groups].sort((a, b) => b.views - a.views)[0];

  if (largest && borrowed > 0) {
    pixels.set(
      largest.group,
      Math.max(MIN_SLICE_PX, (pixels.get(largest.group) ?? 0) - borrowed),
    );
  }

  // The floor arithmetic has to happen in pixels — that is what makes the
  // borrowing exact — but the result is emitted as percentages of the
  // nominal height. The column is `h-full` inside a scroll container, so a
  // classic horizontal scrollbar shrinks its content box below
  // STACK_HEIGHT_PX, and a pixel total pinned to 80 would overflow and clip
  // the topmost slice.
  return new Map(
    [...pixels].map(([group, px]) => [group, asPercent(px)] as const),
  );
}

interface TrafficBreakdownCardProps {
  /**
   * Names the window the query asked for. The empty state used to promise
   * the data "arrives with the ingest", which is wrong when the data exists
   * and merely predates the window the caller chose.
   */
  windowLabel?: string;
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
  windowLabel = 'this window',
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
        No traffic-source data in {windowLabel}. Anything older falls outside
        this window; new data arrives with the YouTube bulk report ingest.
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
        style={{ height: STACK_HEIGHT_PX }}
      >
        {buckets.map((bucket) => {
          const heights = stackHeights(bucket);

          return (
            <div
              key={bucket.bucket}
              className={
                'flex h-full min-w-2 flex-1 flex-col-reverse overflow-hidden rounded-sm'
              }
              title={
                bucket.totalViews === 0
                  ? `${bucket.bucket}: no views`
                  : undefined
              }
            >
              {bucket.groups.map((group) => (
                <div
                  key={group.group}
                  className={GROUP_COLORS[group.group]}
                  style={{ height: heights.get(group.group) ?? 0 }}
                  // Suppressed on a zero-view bucket so the column's own
                  // "no views" tooltip is reachable: otherwise the 2px
                  // baseline slice wins the hover over the only visible
                  // pixels and the bucket reads as Other-sourced traffic.
                  title={
                    bucket.totalViews === 0
                      ? undefined
                      : `${bucket.bucket} — ${GROUP_LABELS[group.group]}: ${Math.round(
                          group.share * 100,
                        )}% of ${bucket.totalViews.toLocaleString()} views`
                  }
                />
              ))}
            </div>
          );
        })}
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
