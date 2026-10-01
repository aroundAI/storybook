'use client';

import {
  type TrafficGroupBucket,
  type TrafficSourceGroup,
  windowTrafficMix,
} from '@kit/clickhouse';
import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

import { platformLabel } from '../../lib/platform-labels';
import type { CardDetails } from '../overview/analytics-card';
import type { CardClaim } from '../overview/card-claim';
import { ChartMark, ChartMarks, formatTrueShare } from './chart-marks';

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

/**
 * Carried by *both* threshold branches, not just the one above 60%.
 *
 * The bias runs the wrong way to disclose on one side only: a partially
 * ingested newest week depresses Browse+Suggested share, so a channel
 * genuinely above the threshold is the one most likely to land in the
 * below-60% branch and be told its views "come mostly from Search".
 */
const LATEST_BUCKET_CAVEAT = (bucketNoun: string) =>
  `That is the newest ${bucketNoun} with traffic; it may not be the current one, and report ingest lags a few days so it may be only partly counted.`;

/** Share above which a channel reads as algorithm-recommended. */
const RECOMMENDED_CHANNEL_THRESHOLD = 0.6;

/**
 * The newest bucket *with traffic*, which is what the claim and the caveat
 * both name. The tab fills absent weeks, so the final element is the most
 * recently closed calendar week whether or not it has been ingested yet —
 * picking it blindly reported "no views" for a channel whose previous 51
 * weeks are full.
 */
function latestWithTraffic(buckets: readonly TrafficShareEntry[]) {
  return (
    [...buckets].reverse().find((bucket) => bucket.totalViews > 0) ??
    buckets[buckets.length - 1]
  );
}

/**
 * The Browse + Suggested card's claim: the newest week's share, and which
 * side of the 60% line it is on.
 *
 * It names the bucket it came from, because that is the newest one *present
 * in the response*, not the current one — buckets exist only where traffic
 * rows do, so a paused channel's newest bucket can be months old. And it
 * names the window the query asked for rather than promising the data
 * "arrives with the ingest", which is wrong when data exists and merely
 * predates the window.
 */
export function trafficShareClaim(
  buckets: readonly TrafficShareEntry[],
  { bucketNoun, windowLabel }: { bucketNoun: string; windowLabel: string },
): CardClaim {
  const latest = latestWithTraffic(buckets);

  if (!latest) {
    return {
      figure: null,
      noFigure: 'No traffic-source data.',
      sentence: `No traffic-source data in ${windowLabel}.`,
    };
  }

  if (!buckets.some((bucket) => bucket.totalViews > 0)) {
    return {
      figure: null,
      noFigure: 'No views.',
      sentence: `No views in ${windowLabel}, so there is no traffic mix to report.`,
    };
  }

  // Gated on the *displayed* figure, not the raw share. Rounding to a whole
  // percent while testing the unrounded value disagrees on [59.5%, 60%):
  // the headline reads "60%" directly above a sentence saying "Below 60%".
  // `>=`, and "At or above", because exactly 60% is on the line.
  const shownPercent = Math.round(latest.share * 100);
  const crossed = shownPercent >= RECOMMENDED_CHANNEL_THRESHOLD * 100;
  const when = `the ${bucketNoun} of ${latest.bucket}`;

  return {
    figure: `${shownPercent}%`,
    sentence: crossed
      ? `At or above 60% in ${when} — recommendations, not just search.`
      : `Below 60% in ${when} — short of recommended-channel territory.`,
  };
}

export function trafficShareDetails(bucketNoun: string) {
  return {
    method: `Views from Browse and Suggested as a share of all views, per ${bucketNoun}.`,
    caveats: [
      LATEST_BUCKET_CAVEAT(bucketNoun),
      'The dashed line marks 60%, above which a channel reads as recommended rather than searched for.',
    ],
  } as const;
}

/**
 * Browse + Suggested as a share of views over time — the clearest signal
 * of whether the algorithm has decided what the channel is for. Early on
 * most views come from Search and external; crossing ~60% means the
 * channel has entered recommended territory.
 */
export function TrafficShareCard({
  buckets,
  isLoading = false,
  isError = false,
}: TrafficShareCardProps) {
  if (isLoading) {
    return <TrafficShareCardSkeleton />;
  }

  // The claim above says what failed or what is missing. Gated on
  // `isError`, not an empty array: the tab fills the window's 52 week
  // starts, so `buckets` is never empty, and the caller passes `isError`
  // only when no response ever arrived.
  if (isError || buckets.length === 0) {
    return null;
  }

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'overflow-x-auto'}>
        {/* The threshold line is positioned against this inner box, not the
            scroller: an absolute child of an overflow container is laid out
            against its *visible* width and scrolls away with the content,
            while a wrapper outside the scroller does not lose the
            scrollbar's height and so sits a few pixels off the bars. Sized
            to content but at least full width, this box is both the bars'
            containing block and the full scroll width. */}
        <ChartMarks
          label={'Browse + Suggested share by week'}
          className={'relative flex w-max min-w-full items-end gap-1'}
          style={{ height: STACK_HEIGHT_PX }}
          data-test={'traffic-share-bars'}
        >
          {buckets.map((bucket, index) => (
            <ChartMark
              key={bucket.bucket}
              col={index}
              // The same colour as Browse + Suggested in the breakdown
              // beside it: one series, one colour, wherever it is drawn.
              className={`min-w-2 flex-1 rounded-sm ${
                bucket.totalViews === 0
                  ? 'bg-muted-foreground/30'
                  : TRAFFIC_GROUP_COLORS.browse_suggested
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
              detail={
                bucket.totalViews === 0
                  ? `${bucket.bucket}: no views`
                  : `${bucket.bucket}: ${formatTrueShare(bucket.share)} of ${bucket.totalViews.toLocaleString()} views`
              }
              data-test={'traffic-share-bar'}
              data-bucket={bucket.bucket}
              data-share={bucket.share}
            />
          ))}

          <div
            aria-hidden
            className={
              'pointer-events-none absolute right-0 left-0 border-t border-dashed border-foreground/40'
            }
            style={{ bottom: `${RECOMMENDED_CHANNEL_THRESHOLD * 100}%` }}
          />
        </ChartMarks>
      </div>
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

/**
 * Group colours, assigned by meaning rather than by index (FILM-1708).
 *
 * The four groups a reader compares — Browse + Suggested, Search, Shorts
 * and External — take the four chart hues that stay furthest apart under
 * protanopia and deuteranopia (worst pair ΔE 12.0); Playlists and Channel
 * page take the other two. Direct and Other are neutrals apart in
 * *lightness*, not alpha: two alphas of one grey cannot be told apart at
 * the 2px floor. Every one of the 28 pairs clears CVD ΔE 9.6 and normal ΔE
 * 15.9 — `__tests__/chart-ramp.test.ts` computes it from the stylesheet.
 *
 * Other also carries a hatch, so it reads as the residual it is rather than
 * as an eighth finding. Its background colour stays the solid neutral, which
 * is what the hatch lets through and what the browser test samples.
 */
export const TRAFFIC_GROUP_COLORS: Record<TrafficSourceGroup, string> = {
  browse_suggested: 'bg-chart-1',
  search: 'bg-chart-2',
  shorts_feed: 'bg-chart-6',
  external: 'bg-chart-4',
  playlists: 'bg-chart-5',
  channel_page: 'bg-chart-3',
  direct: 'bg-chart-neutral-strong',
  other:
    'bg-chart-neutral-soft bg-[image:repeating-linear-gradient(135deg,transparent_0_3px,var(--color-card)_3px_4px)]',
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

  // A zero-view bucket never reaches here: the card renders that column
  // explicitly, so its baseline is not mistaken for genuine Other traffic.
  if (bucket.totalViews === 0) {
    return new Map();
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

/** The breakdown card's claim: the largest source over the window. */
export function trafficBreakdownClaim(
  buckets: readonly TrafficGroupBucket[],
  windowLabel: string,
): CardClaim {
  const { windowViews, groups } = windowTrafficMix(buckets);

  if (buckets.length === 0) {
    return {
      figure: null,
      noFigure: 'No traffic-source data.',
      sentence: `No traffic-source data in ${windowLabel}.`,
    };
  }

  if (windowViews === 0) {
    return {
      figure: null,
      noFigure: 'No views.',
      sentence: `No views in ${windowLabel}, so there is no traffic mix to report.`,
    };
  }

  const top = Math.max(...groups.map(({ share }) => share));
  const leaders = groups.filter(({ share }) => share === top);
  const names = leaders.map(({ group }) => GROUP_LABELS[group]);

  return {
    figure: `${Math.round(top * 100)}%`,
    sentence:
      leaders.length > 1
        ? `${names.join(' and ')} were level as the largest sources of views over ${windowLabel}.`
        : `${names[0]} was the largest source of views over ${windowLabel}.`,
  };
}

export const TRAFFIC_BREAKDOWN_DETAILS = {
  method: 'Each source’s share of all views across the whole window shown.',
  caveats: [
    'Shares cover videos published through this platform. Views on channel videos that never matched a publish are not counted, so these percentages will not match the platform’s own analytics exactly.',
  ],
} as const;

/**
 * The breakdown card's details, with the drill-down under "Where this comes
 * from" (FILM-1708): each group that occurred, and the native YouTube codes
 * that made it up, from the response the chart already drew. Opening it
 * issues no query.
 *
 * `source` replaces the shell's matrix-derived note, so the note is passed
 * in and kept above the codes rather than lost.
 */
export function trafficBreakdownDetails(
  buckets: readonly TrafficGroupBucket[],
  sourceNotes: readonly string[],
): CardDetails {
  return {
    ...TRAFFIC_BREAKDOWN_DETAILS,
    source: <TrafficSourceDrillDown buckets={buckets} notes={sourceNotes} />,
  };
}

function TrafficSourceDrillDown({
  buckets,
  notes,
}: {
  buckets: readonly TrafficGroupBucket[];
  notes: readonly string[];
}) {
  const { windowViews, groups } = windowTrafficMix(buckets);
  const occurred = groups.filter((group) => group.views > 0);

  return (
    <div className={'flex flex-col gap-2'} data-test={'traffic-drilldown'}>
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}

      {occurred.length === 0 ? (
        <p>No traffic-source rows in this window.</p>
      ) : (
        <>
          <p>
            {platformLabel('youtube')}’s own traffic-source codes behind each group, as a share of
            all {windowViews.toLocaleString()} views. Only codes that occurred
            are listed.
          </p>
          <ul className={'flex flex-col gap-2'}>
            {occurred.map((group) => (
              <li
                key={group.group}
                className={'flex flex-col gap-1'}
                data-test={'traffic-drilldown-group'}
                data-group={group.group}
                data-share={group.share}
              >
                <div className={'flex items-center justify-between gap-2'}>
                  <span className={'flex items-center gap-1.5 text-foreground'}>
                    <span
                      aria-hidden
                      className={`size-2 shrink-0 rounded-full ${TRAFFIC_GROUP_COLORS[group.group]}`}
                    />
                    {GROUP_LABELS[group.group]}
                  </span>
                  <span className={'text-foreground tabular-nums'}>
                    {formatTrueShare(group.share)}
                  </span>
                </div>
                <div className={'flex flex-wrap gap-1 pl-3.5'}>
                  {group.sources.map((source) => (
                    <Badge
                      key={source.source}
                      variant={source.recognised ? 'secondary' : 'outline'}
                      className={'gap-1 font-mono text-[11px] font-normal'}
                      data-test={'traffic-drilldown-source'}
                      data-source={source.source}
                      data-share={source.share}
                      data-recognised={source.recognised}
                    >
                      {source.source}
                      <span className={'tabular-nums'}>
                        {formatTrueShare(source.share)}
                      </span>
                      {!source.recognised && (
                        <span className={'font-sans'}>· unrecognised code</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

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
 * match Studio exactly, which the card's details say rather than leaving
 * the reader to discover.
 */
export function TrafficBreakdownCard({
  buckets,
  isLoading = false,
  isError = false,
}: TrafficBreakdownCardProps) {
  if (isLoading) {
    return <TrafficShareCardSkeleton />;
  }

  // Over the whole window, not the latest bucket. The legend sits above a
  // chart spanning every bucket, so a per-bucket figure reads as the period
  // share and would be wrong by exactly the amount the last bucket differs.
  const { windowViews, groups: legend } = windowTrafficMix(buckets);

  // The claim above says what failed or what is missing. `isError` is set
  // only when no response arrived: React Query keeps `data` through a
  // failed background refetch, and discarding a chart the user is already
  // reading is worse than serving the last good one.
  if (isError || buckets.length === 0 || windowViews === 0) {
    return null;
  }

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex flex-wrap gap-x-4 gap-y-1'}>
        {legend.map((group) => (
          <span
            key={group.group}
            className={'flex items-center gap-1.5 text-xs'}
            data-test={'traffic-legend-item'}
            data-group={group.group}
          >
            <span
              className={`size-2 rounded-full ${TRAFFIC_GROUP_COLORS[group.group]}`}
              data-test={'traffic-legend-swatch'}
            />
            <span className={'text-muted-foreground'}>
              {GROUP_LABELS[group.group]}
            </span>
            {/* The drill-down's format, so the legend and the codes under it
                agree — and so 0.2% does not read as "0%". */}
            <span className={'font-medium tabular-nums'}>
              {formatTrueShare(group.share)}
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
      <ChartMarks
        label={'Share of views by traffic source, by week'}
        className={'flex items-end gap-1 overflow-x-auto'}
        style={{ height: STACK_HEIGHT_PX }}
        data-test={'traffic-breakdown-bars'}
      >
        {buckets.map((bucket, col) => {
          const heights = stackHeights(bucket);
          // Only slices with views are drawn and focusable; a zero-height
          // slice has nothing to hover and would be a dead arrow-key stop.
          const slices = bucket.groups.filter((group) => group.views > 0);

          return (
            <div
              key={bucket.bucket}
              className={
                'flex h-full min-w-2 flex-1 flex-col-reverse rounded-sm'
              }
            >
              {bucket.totalViews === 0 ? (
                // Distinct from genuine Other traffic, which is a hatched
                // neutral. Matching the sibling card's treatment of the
                // same case, and carrying the column's "no views" detail
                // itself so the baseline is not read as Other traffic.
                <ChartMark
                  col={col}
                  className={'rounded-sm bg-muted-foreground/30'}
                  style={{ height: `${MIN_SLICE_FLOOR_PERCENT}%` }}
                  detail={`${bucket.bucket}: no views`}
                  data-test={'traffic-empty-bucket'}
                  data-bucket={bucket.bucket}
                />
              ) : (
                slices.map((group, row) => (
                  <ChartMark
                    key={group.group}
                    col={col}
                    row={row}
                    className={cn(
                      TRAFFIC_GROUP_COLORS[group.group],
                      row === 0 && 'rounded-b-sm',
                      row === slices.length - 1 && 'rounded-t-sm',
                    )}
                    style={{ height: heights.get(group.group) ?? 0 }}
                    // The true share, not the drawn one: a slice floored to
                    // MIN_SLICE_PX draws larger than it is, and this is the
                    // one place its real size shows (FILM-1605).
                    detail={`${bucket.bucket} — ${GROUP_LABELS[group.group]}: ${formatTrueShare(
                      group.share,
                    )} of ${bucket.totalViews.toLocaleString()} views`}
                    data-test={'traffic-slice'}
                    data-bucket={bucket.bucket}
                    data-group={group.group}
                    data-share={group.share}
                  />
                ))
              )}
            </div>
          );
        })}
      </ChartMarks>
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
