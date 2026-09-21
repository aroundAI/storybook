/**
 * Folding revenue rows onto segments (FILM-1606).
 *
 * Pure and streaming. Revenue lives in Postgres and segment membership in
 * ClickHouse, so the join happens in application code — which is exactly
 * the kind of thing that should not be buried in a server action where it
 * cannot be tested without a database.
 *
 * An accumulator rather than a function over an array: revenue_records
 * holds a row per publish per day per category, so a yearly window on a
 * busy account reaches six figures and is streamed a page at a time.
 *
 * Two rules make the resulting rate meaningful rather than merely present:
 *
 * **Every cent is accounted for.** A row lands in exactly one of three
 * buckets — a segment, `channelLevelCents`, or `unattributedCents` — and
 * the three sum to what was streamed in. An earlier version silently
 * dropped any publish outside the membership, so revenue from another
 * project, or from a video excluded as immature, vanished without
 * appearing in any total the UI could show.
 *
 * **Revenue is bounded to the same window as the views.** `totalViews` is
 * each video's views in its first N days of life, so revenue must be each
 * video's earnings over that same span. Dividing a calendar month's
 * revenue by a lifetime of first-30-day views is an RPM wrong by whatever
 * ratio those windows happen to stand in.
 */
import { pooledRpmCents } from '@kit/clickhouse';

import type { CurrencyAmount, MoneyByCurrency } from './money';
import { createMoneyFold } from './money';

/** The only fields of a revenue row this fold reads. */
export interface FoldableRevenueRow {
  publish_id: string | null;
  record_date: string;
  amount: CurrencyAmount;
}

/** A video's segments and the window its views were measured over. */
export interface MembershipEntry {
  segments: string[];
  /** Inclusive first day of the video's checkpoint window, 'YYYY-MM-DD'. */
  windowStart: string;
  /** Exclusive last day of that window, 'YYYY-MM-DD'. */
  windowEnd: string;
}

/**
 * Every bucket is per currency (KB-12). "Every cent is accounted for" holds
 * within each: a euro lands in exactly one of the three, as euros.
 */
export interface SegmentRevenueTotals {
  revenueBySegment: Map<string, MoneyByCurrency>;
  /**
   * Revenue scoped to an account rather than a publish: real income that
   * belongs to no video, and therefore to no segment.
   */
  channelLevel: MoneyByCurrency;
  /**
   * Revenue on a publish that is not in the membership, or is but falls
   * outside its checkpoint window. Neither attributable nor channel-level
   * — reported so the difference against a total shown elsewhere can be
   * explained rather than discovered.
   */
  unattributed: MoneyByCurrency;
}

/** Day the video's checkpoint window opens and closes, as date strings. */
export function checkpointWindow(
  publishedAt: string,
  checkpointDays: number,
): { windowStart: string; windowEnd: string } {
  // Parsed as UTC. ClickHouse hands back zone-less timestamps, which V8
  // reads as local for 'YYYY-MM-DD HH:MM:SS' and as UTC for 'YYYY-MM-DD' —
  // so an unqualified Date() here shifts the window by a day either side
  // of midnight depending on where the process runs.
  const start = new Date(`${publishedAt.slice(0, 10)}T00:00:00Z`);
  const end = new Date(start);

  end.setUTCDate(end.getUTCDate() + checkpointDays);

  return {
    windowStart: start.toISOString().slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
  };
}

/**
 * Drops segment names the aggregate trimmed, and any video left with none.
 *
 * The aggregate applies `minVideos`; membership does not. Without this, a
 * trimmed segment's revenue is attributed to a key no returned row carries
 * — displayed nowhere and counted in no total, breaking the guarantee that
 * every cent lands in exactly one of three buckets.
 *
 * Narrowing each video's segment list, rather than reconciling per segment
 * afterwards, is what keeps a video in two trimmed tags from being counted
 * as unattributed twice.
 */
export function retainSurvivingSegments(
  membership: Map<string, MembershipEntry>,
  surviving: Set<string>,
): void {
  for (const [videoId, entry] of membership) {
    const kept = entry.segments.filter((name) => surviving.has(name));

    if (kept.length === 0) {
      membership.delete(videoId);
      continue;
    }

    entry.segments = kept;
  }
}

/**
 * A segment's pooled rate, or null when it has no revenue rows at all.
 *
 * The distinction is the point: a segment whose rows sum to zero earned
 * nothing, while a segment with no rows has no rate to report. Revenue
 * ingest covering one platform and not another makes the second case
 * ordinary, and rendering it as "$0.00 RPM" states a finding about the
 * content that the data cannot support.
 */
export function segmentRpm(
  revenueBySegment: Map<string, MoneyByCurrency>,
  segment: string,
  totalViews: number,
): MoneyByCurrency | null {
  const revenue = revenueBySegment.get(segment);

  if (!revenue) return null;

  // One rate per currency, over the same views: a segment paid $12 and €5
  // earned both per thousand views, and 1700 "cents" per thousand of
  // neither. The division is monotonic, so the amounts keep their order.
  const rates: MoneyByCurrency = [];

  for (const { currency, cents } of revenue) {
    // Delegated, never re-derived: an inline `(cents / views) * 1000` here
    // would be a second definition of the pooled rate, which is the drift
    // lib/segment-stats.ts exists to prevent.
    const rate = pooledRpmCents(cents, totalViews);

    if (rate === null) return null;

    rates.push({ currency, cents: rate });
  }

  return rates;
}

export function createSegmentRevenueFold(
  membership: Map<string, MembershipEntry>,
) {
  const bySegment = new Map<string, ReturnType<typeof createMoneyFold>>();
  const channelLevel = createMoneyFold();
  const unattributed = createMoneyFold();

  return {
    add(row: FoldableRevenueRow): void {
      if (!row.publish_id) {
        channelLevel.add(row.amount);
        return;
      }

      const entry = membership.get(row.publish_id);

      // Absent from the membership: another project under the same
      // account, or a video excluded as immature or predating ingest. Its
      // views are not in any denominator, so its revenue must not be in
      // any numerator — but it is still money, so it is still counted.
      if (!entry) {
        unattributed.add(row.amount);
        return;
      }

      const day = row.record_date.slice(0, 10);

      // Outside the window the views were measured over. Half-open, so a
      // 30-day checkpoint covers days 0-29 — the `< N` convention the rest
      // of the phase uses.
      if (day < entry.windowStart || day >= entry.windowEnd) {
        unattributed.add(row.amount);
        return;
      }

      // A video in four tags contributes its revenue to four segments,
      // exactly as it contributes its views to four medians. Segment
      // totals therefore do not sum to the account total, which is a
      // property of overlapping segments and not double-counting.
      for (const name of entry.segments) {
        const fold = bySegment.get(name) ?? createMoneyFold();

        fold.add(row.amount);
        bySegment.set(name, fold);
      }
    },

    result(): SegmentRevenueTotals {
      return {
        revenueBySegment: new Map(
          [...bySegment].map(([name, fold]) => [name, fold.result()]),
        ),
        channelLevel: channelLevel.result(),
        unattributed: unattributed.result(),
      };
    },
  };
}

/** Earliest and latest day any video checkpoint window touches. */
export function revenueFetchWindow(membership: Map<string, MembershipEntry>) {
  let from: string | undefined;
  let toExclusive: string | undefined;

  for (const entry of membership.values()) {
    if (!from || entry.windowStart < from) from = entry.windowStart;
    if (!toExclusive || entry.windowEnd > toExclusive) {
      toExclusive = entry.windowEnd;
    }
  }

  return from && toExclusive ? { from, toExclusive } : null;
}

/**
 * Splits a span into year-long chunks.
 *
 * forEachAccountRevenueRow refuses to read past 100k rows *per call*, and
 * revenue_records holds a row per publish per day per category — so a
 * couple of hundred tracked videos over a year in two categories already
 * approaches that. Because this window spans the account's whole history
 * by construction, reading it in one call would make the guard fire for
 * exactly the accounts the feature is for. Chunking keeps each call inside
 * the limit; TODO(FILM-1614)'s pre-grouped RPC is the real fix.
 */
export function yearChunks(from: string, toExclusive: string) {
  const chunks: Array<{ from: string; toExclusive: string }> = [];
  let cursor = from;

  while (cursor < toExclusive) {
    const next = new Date(`${cursor}T00:00:00Z`);

    next.setUTCFullYear(next.getUTCFullYear() + 1);

    const end = next.toISOString().slice(0, 10);
    const chunkEnd = end < toExclusive ? end : toExclusive;

    chunks.push({ from: cursor, toExclusive: chunkEnd });
    cursor = chunkEnd;
  }

  return chunks;
}
