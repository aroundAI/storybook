/**
 * Reconstructing a daily subscriber level from anchors plus deltas
 * (FILM-1607 §2).
 *
 * Pure: no I/O, so the rules below are unit-tested without a ClickHouse
 * instance — the same split as `video-age.ts` in FILM-1603.
 */

export interface SubscriberAnchor {
  /** UTC date of the capture run. */
  snapshotDate: string;
  subscriberCount: number;
  /** 0 when the platform reported an exact figure. */
  roundingStep: number;
}

export interface SubscriberDelta {
  metricDate: string;
  /** gained − lost for the day, already netted by the query. */
  net: number;
  /**
   * False when the day's gains or losses were not measured (TikTok reports
   * neither per video, Instagram no losses; KB-114). Such a `net` is not a
   * movement, and `reconstructSeries` ignores it. Absent means measured.
   */
  measured?: boolean;
}

/**
 * How a day's level was arrived at.
 *
 * Four states, not two. A rounded anchor whose band already contains the
 * delta-derived value leaves that value in place, which is neither "the
 * snapshot's number" nor "no anchor was present" — reporting it as either
 * would be a lie about the same row.
 */
export type SubscriberSource =
  | 'snapshot'
  | 'interpolated'
  | 'constrained'
  | 'clamped'
  /**
   * A day between two snapshots of a channel with no measured daily
   * movement (KB-114, decision 2026-09-25): a straight line between the two
   * recorded counts, not a measured gain or loss.
   */
  | 'between_snapshots';

export interface SubscriberPoint {
  date: string;
  level: number;
  source: SubscriberSource;
}

/**
 * The half-open band of true values consistent with a rounded anchor.
 *
 * YouTube rounds *down* to three significant figures, so `1230000` means "at
 * least 1,230,000, less than 1,240,000". A centred band would exclude a true
 * 1,238,000 and drag it down against an anchor that actually agreed with it.
 */
function bandOf(anchor: SubscriberAnchor): { low: number; high: number } {
  if (anchor.roundingStep <= 0) {
    return { low: anchor.subscriberCount, high: anchor.subscriberCount };
  }

  return {
    low: anchor.subscriberCount,
    // Exclusive upper bound, so the largest admissible value is one below it.
    high: anchor.subscriberCount + anchor.roundingStep - 1,
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];

  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
  }

  return days;
}

/**
 * Walk one connection's series across `[from, to]`.
 *
 * Forward from the earliest anchor and backward from it, because an anchor
 * levels the past as readily as the future: `level(D-1) = level(D) − net(D)`.
 * Days with no delta and no anchor before them are omitted — deltas alone
 * give an offset, never a level.
 */
export function reconstructSeries(
  anchors: SubscriberAnchor[],
  deltas: SubscriberDelta[],
  range: { from: string; to: string },
): SubscriberPoint[] {
  if (anchors.length === 0) {
    return [];
  }

  const sortedAnchors = [...anchors].sort((a, b) =>
    a.snapshotDate < b.snapshotDate ? -1 : 1,
  );

  const measuredDeltas = deltas.filter((d) => d.measured !== false);

  // No measured movement at all (TikTok, Instagram): the only facts are the
  // recorded counts, so draw straight lines between them and say so, rather
  // than walk a flat line labelled as daily movement (KB-114, option a).
  if (measuredDeltas.length === 0) {
    return betweenSnapshots(sortedAnchors, range);
  }

  const anchorByDate = new Map(sortedAnchors.map((a) => [a.snapshotDate, a]));
  const netByDate = new Map(measuredDeltas.map((d) => [d.metricDate, d.net]));

  const first = sortedAnchors[0]!;
  const firstBand = bandOf(first);

  // The seed. With no prior delta-derived value there is nothing to compare
  // against, so a rounded first anchor pins to the band floor — the
  // platform's own reported figure. The midpoint would estimate an unknown
  // value better, but it invents precision the platform never gave, and left
  // unstated two implementers would differ by step/2 for the life of the
  // series.
  const points = new Map<string, SubscriberPoint>();

  points.set(first.snapshotDate, {
    date: first.snapshotDate,
    level: firstBand.low,
    source: first.roundingStep > 0 ? 'clamped' : 'snapshot',
  });

  const applyAnchor = (
    date: string,
    walked: number,
  ): { level: number; source: SubscriberSource } => {
    const anchor = anchorByDate.get(date);

    if (!anchor) {
      return { level: walked, source: 'interpolated' };
    }

    if (anchor.roundingStep <= 0) {
      // Exact: authoritative, sets the level outright.
      return { level: anchor.subscriberCount, source: 'snapshot' };
    }

    const band = bandOf(anchor);

    if (walked >= band.low && walked <= band.high) {
      // Inside the band, so the deltas are the finer measurement and stand.
      // Re-levelling here would flatten a channel whose rounded anchor is
      // unchanged for weeks into a staircase.
      return { level: walked, source: 'constrained' };
    }

    // Outside: the deltas have drifted further than the platform's own figure
    // permits, so clamp to the nearest value the band admits.
    return {
      level: walked < band.low ? band.low : band.high,
      source: 'clamped',
    };
  };

  // Forward from the seed. A clamp re-bases the walk, so sustained drift is
  // absorbed once rather than clamping every subsequent day into a sawtooth.
  let level = points.get(first.snapshotDate)!.level;

  for (
    let d = addDays(first.snapshotDate, 1);
    d <= range.to;
    d = addDays(d, 1)
  ) {
    const walked = level + (netByDate.get(d) ?? 0);
    const resolved = applyAnchor(d, walked);

    points.set(d, { date: d, level: resolved.level, source: resolved.source });
    level = resolved.level;
  }

  // Backward from the seed, for days the anchors postdate.
  level = points.get(first.snapshotDate)!.level;

  for (
    let d = addDays(first.snapshotDate, -1);
    d >= range.from;
    d = addDays(d, -1)
  ) {
    const net = netByDate.get(addDays(d, 1));

    if (net === undefined) {
      // No delta for the following day, so this day's level is not determined.
      break;
    }

    const walked = level - net;
    const resolved = applyAnchor(d, walked);

    points.set(d, { date: d, level: resolved.level, source: resolved.source });
    level = resolved.level;
  }

  return eachDay(range.from, range.to)
    .map((d) => points.get(d))
    .filter((p): p is SubscriberPoint => p !== undefined);
}

/**
 * A series from snapshots alone (KB-114, option a, decided 2026-09-25).
 *
 * Each recorded count is a point: its exact figure, or a rounded one's floor
 * as the seed rule above does. Days between two of them lie on the straight
 * line joining them, rounded to a whole follower, and are marked
 * `between_snapshots`. Nothing is drawn before the first snapshot or after
 * the last: with no movement measured, there is no basis to extend either
 * way.
 */
function betweenSnapshots(
  sortedAnchors: SubscriberAnchor[],
  range: { from: string; to: string },
): SubscriberPoint[] {
  const points: SubscriberPoint[] = [];

  const recorded = (anchor: SubscriberAnchor): SubscriberPoint => ({
    date: anchor.snapshotDate,
    level: bandOf(anchor).low,
    source: anchor.roundingStep > 0 ? 'clamped' : 'snapshot',
  });

  for (const [index, anchor] of sortedAnchors.entries()) {
    const start = recorded(anchor);
    points.push(start);

    const nextAnchor = sortedAnchors[index + 1];
    if (!nextAnchor) break;

    const end = recorded(nextAnchor);
    const span = daysBetween(start.date, end.date);

    for (let step = 1; step < span; step++) {
      points.push({
        date: addDays(start.date, step),
        level: Math.round(
          start.level + ((end.level - start.level) * step) / span,
        ),
        source: 'between_snapshots',
      });
    }
  }

  return points.filter((p) => p.date >= range.from && p.date <= range.to);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
