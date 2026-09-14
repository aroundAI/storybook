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
 */

/** The only fields of a revenue row this fold reads. */
export interface FoldableRevenueRow {
  publish_id: string | null;
  revenue_cents: number;
}

export interface SegmentRevenueTotals {
  revenueBySegment: Map<string, number>;
  /**
   * Channel-level revenue: real income belonging to no segment, because
   * `revenue_records` permits a row scoped to an account rather than a
   * publish. Kept so the gap can be stated rather than discovered.
   */
  excludedRevenueCents: number;
}

export function createSegmentRevenueFold(
  segmentsByVideo: Map<string, string[]>,
) {
  const revenueBySegment = new Map<string, number>();
  let excludedRevenueCents = 0;

  return {
    add(row: FoldableRevenueRow): void {
      if (!row.publish_id) {
        excludedRevenueCents += row.revenue_cents;
        return;
      }

      const segments = segmentsByVideo.get(row.publish_id);

      // A video absent from the membership was excluded from the figures
      // too — immature, or predating ingest. Its revenue must not land in
      // a segment whose views do not include it, or the rate inflates.
      if (!segments) return;

      for (const name of segments) {
        revenueBySegment.set(
          name,
          (revenueBySegment.get(name) ?? 0) + row.revenue_cents,
        );
      }
    },

    result(): SegmentRevenueTotals {
      return { revenueBySegment, excludedRevenueCents };
    },
  };
}
