/**
 * Age arithmetic for per-video checkpoints.
 *
 * Pure, so the two judgements that decide whether a "@30d" figure means
 * anything can be tested without a ClickHouse instance.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two instants, floored, negative when b precedes a. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Whether each checkpoint has actually elapsed for a video.
 *
 * A video 12 days old has not got a "@30d" figure yet: its sum is not zero,
 * it is not yet knowable. Consumers must render the two differently, which
 * they can only do if the distinction survives the query.
 *
 * The boundary matches the sums — days 0..N-1 count toward "@Nd", so the
 * checkpoint is reached once the video is N days old.
 */
export function computeMaturity(
  publishedAt: string | Date,
  checkpoints: number[],
  now: Date = new Date(),
): Record<number, boolean> {
  const published = new Date(publishedAt);
  const mature: Record<number, boolean> = {};

  if (Number.isNaN(published.getTime())) {
    for (const days of checkpoints) mature[days] = false;
    return mature;
  }

  const ageDays = daysBetween(published, now);

  for (const days of checkpoints) {
    mature[days] = ageDays >= days;
  }

  return mature;
}

/**
 * Days between publication and the first ingested metric day.
 *
 * Anything above ~1 means the video's early life predates ingest for its
 * channel: the Reporting API backfills only ~30 days from job creation, so
 * those rows do not exist and cannot be fetched later. An "@30d" computed
 * over that gap is truncated rather than small, and the UI marks it.
 *
 * Returns null when there are no metric rows at all — that is "nothing
 * ingested", which is a different statement from "ingested late".
 */
export function computeIngestLagDays(
  publishedAt: string | Date,
  firstMetricDate: string | Date | null | undefined,
): number | null {
  if (!firstMetricDate) return null;

  const published = new Date(publishedAt);
  const first = new Date(firstMetricDate);

  if (Number.isNaN(published.getTime()) || Number.isNaN(first.getTime())) {
    return null;
  }

  // Clamp at zero: a metric day before publication is a data oddity, not a
  // negative lag, and must not read as "ingested early".
  return Math.max(0, daysBetween(published, first));
}

/**
 * Whether a checkpoint's entire window closed before ingest began.
 *
 * Any lag beyond a day means *some* early days are missing from *every*
 * window, since all of them start at publication — so "is anything
 * missing?" is true almost everywhere and tells a reader nothing. That
 * row-level signal is just `ingestLagDays > 1`.
 *
 * The per-checkpoint question worth asking is sharper: did this window end
 * before the first metric arrived? A 45-day lag leaves "@30d" with no data
 * from its window at all — a number that should not be shown — while
 * "@365d" is missing its first 45 days and is still broadly meaningful.
 */
export function checkpointPredatesIngest(
  ingestLagDays: number | null,
  checkpointDays: number,
): boolean {
  if (ingestLagDays === null) return false;

  return ingestLagDays >= checkpointDays;
}
