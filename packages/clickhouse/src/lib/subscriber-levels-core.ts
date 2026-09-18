/**
 * The pure half of the subscriber readers (FILM-1617): everything between
 * the raw anchor and delta rows and what the surfaces show.
 *
 * Split from `subscriber-levels.ts`, which does the I/O, so the Deep Dive
 * curve, the YPP count and the follower chip — and the scenario tests that
 * guard all three — run exactly the same code. No ClickHouse client behind
 * it, so it is safe to import anywhere.
 */
import {
  type SubscriberAnchor,
  type SubscriberDelta,
  type SubscriberPoint,
  reconstructSeries,
} from './subscriber-series';

export interface ConnectionSubscriberSeries {
  connectionId: string;
  points: SubscriberPoint[];
  /**
   * The widest rounding step among the anchors behind this series; 0 when
   * every anchor was exact. A rounded seed offsets every reconstructed day by
   * up to `roundingStep - 1`, so the curve's shape is exact and its height is
   * not — surfaces must say so.
   */
  roundingStep: number;
  /**
   * The newest date with any measurement, in the window or not; null when
   * the connection has never been measured. Tells "history that ended
   * before this window" apart from "no count yet" when `points` is empty.
   */
  lastDataDate: string | null;
}

export interface LatestSubscriberLevel extends SubscriberPoint {
  roundingStep: number;
}

/** One connection's raw rows, as the readers fetch them. */
export interface SubscriberInputs {
  connectionId: string;
  anchors: SubscriberAnchor[];
  deltas: SubscriberDelta[];
}

export function widestStep(anchors: Array<{ roundingStep: number }>): number {
  return anchors.reduce((widest, a) => Math.max(widest, a.roundingStep), 0);
}

/**
 * The newest date this connection has any measurement for.
 *
 * `reconstructSeries` carries a level forward over days with no delta, so a
 * walk read to today always ends today — flat, and labelled as reconstructed
 * from movement nobody measured. Anything past this date is that invention.
 */
export function lastEvidenceDate(
  anchors: Array<{ snapshotDate: string }>,
  deltas: Array<{ metricDate: string }>,
): string | null {
  let last: string | null = null;

  for (const date of [
    ...anchors.map((a) => a.snapshotDate),
    ...deltas.map((d) => d.metricDate),
  ]) {
    if (last === null || date > last) last = date;
  }

  return last;
}

/** One connection's curve over `range`, ending where its data ends. */
export function buildSubscriberSeries(
  { connectionId, anchors, deltas }: SubscriberInputs,
  range: { from: string; to: string },
): ConnectionSubscriberSeries {
  const last = lastEvidenceDate(anchors, deltas);

  return {
    connectionId,
    // Stops where the data stops: a disconnected channel's line ends when
    // capture ended, and an active one's ends before its ingest lag.
    points: reconstructSeries(anchors, deltas, range).filter(
      (point) => last !== null && point.date <= last,
    ),
    roundingStep: widestStep(anchors),
    // Only a snapshot makes a channel "measured". Movement alone is an
    // offset, never a count — a channel whose owner hides the count has
    // movement every day and no snapshot ever, and is not a capture that
    // stopped.
    lastDataDate: anchors.length > 0 ? last : null,
  };
}

/**
 * The most recent level a connection has evidence for, dated by that
 * evidence rather than by today. Undefined with no anchor — never
 * snapshotted, or a count the owner hides — rather than 0.
 */
export function buildLatestLevel({
  anchors,
  deltas,
}: SubscriberInputs): LatestSubscriberLevel | undefined {
  const lastEvidence = lastEvidenceDate(anchors, deltas);

  if (anchors.length === 0 || lastEvidence === null) return undefined;

  // Re-walk only up to the evidence, so the returned point is dated by it.
  const latest = reconstructSeries(anchors, deltas, {
    from: lastEvidence,
    to: lastEvidence,
  }).at(-1);

  return latest ? { ...latest, roundingStep: widestStep(anchors) } : undefined;
}
