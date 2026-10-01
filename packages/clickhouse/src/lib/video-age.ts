/**
 * Age arithmetic for per-video checkpoints.
 *
 * Pure, so the two judgements that decide whether a "@30d" figure means
 * anything can be tested without a ClickHouse instance.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A bare 'YYYY-MM-DD', which V8 already parses as UTC midnight. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Trailing 'Z' or '+HH:MM' — a value that already states its offset. */
const HAS_ZONE = /([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Parses a ClickHouse timestamp as UTC.
 *
 * The two values compared here arrive in different formats and neither
 * carries a zone: `published_at` as toString(DateTime) —
 * 'YYYY-MM-DD HH:MM:SS', which V8 parses as *local* — and
 * `first_metric_date` as toString(Date) — 'YYYY-MM-DD', which V8 parses as
 * *UTC*. Both denote UTC instants, so parsing them differently skews the
 * difference by the host offset, and `daysBetween`'s floor turns that into
 * an off-by-one at exactly the boundaries this module exists to get right:
 * whether a checkpoint has elapsed, and whether a figure is suppressed.
 *
 * Lambda runs UTC, so production was unaffected — which is what makes this
 * the kind of bug that only ever reproduces on someone's laptop.
 */
function parseUtc(value: string | Date): Date {
  if (value instanceof Date) return value;

  const raw = value.trim();

  if (DATE_ONLY.test(raw)) return new Date(`${raw}T00:00:00Z`);

  const iso = raw.replace(' ', 'T');

  return new Date(HAS_ZONE.test(iso) ? iso : `${iso}Z`);
}

/** Whole days between two instants, floored, negative when b precedes a. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * UTC calendar-day boundaries crossed between two instants — what
 * ClickHouse's `dateDiff('day', a, b)` returns, and so what the cohort query
 * judges maturity and ingest lag with (KB-152).
 *
 * Not `daysBetween`: an upload at 23:00 on 1 January has its "@30d" sum
 * (metric days 1–30 January) complete at 01:00 on 31 January, two hours of
 * elapsed time short of thirty days. Floored elapsed time called that video
 * immature while the cohort query, counting calendar days, admitted it — so
 * the same video could be a peer in the cohort and unjudgable as itself.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  const day = (value: Date) => Math.floor(value.getTime() / MS_PER_DAY);

  return day(to) - day(from);
}

/**
 * Whether each checkpoint has actually elapsed for a video.
 *
 * A video 12 days old has not got a "@30d" figure yet: its sum is not zero,
 * it is not yet knowable. Consumers must render the two differently, which
 * they can only do if the distinction survives the query.
 *
 * The boundary matches the sums — calendar days 0..N-1 count toward "@Nd",
 * so the checkpoint is reached once N calendar days (UTC) have begun since
 * publication, exactly as the cohort query's `dateDiff('day', …)` counts.
 */
export function computeMaturity(
  publishedAt: string | Date,
  checkpoints: number[],
  now: Date = new Date(),
): Record<number, boolean> {
  const published = parseUtc(publishedAt);
  const mature: Record<number, boolean> = {};

  if (Number.isNaN(published.getTime())) {
    for (const days of checkpoints) mature[days] = false;
    return mature;
  }

  const ageDays = calendarDaysBetween(published, now);

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

  const published = parseUtc(publishedAt);
  const first = parseUtc(firstMetricDate);

  if (Number.isNaN(published.getTime()) || Number.isNaN(first.getTime())) {
    return null;
  }

  // Clamp at zero: a metric day before publication is a data oddity, not a
  // negative lag, and must not read as "ingested early".
  return Math.max(0, calendarDaysBetween(published, first));
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
