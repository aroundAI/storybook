/**
 * Reconstructed subscriber levels per connection (FILM-1607, FILM-1617).
 *
 * The one place that composes the anchor and delta reads with
 * `reconstructSeries`, so the Deep Dive curve, the YPP card and the Publish
 * Hub badge cannot disagree about a channel's level.
 *
 * Takes connection ids and carries no tenant predicate, like the queries it
 * composes: callers resolve and authorise the ids in Postgres first.
 */
import {
  type SubscriberPoint,
  reconstructSeries,
} from './lib/subscriber-series';
import {
  querySubscriberAnchors,
  querySubscriberDeltas,
} from './queries-advanced';

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

/**
 * The lower bound for the anchor read: ClickHouse `Date`'s minimum, so every
 * snapshot a connection has ever had comes back.
 */
const EARLIEST_DATE = '1970-01-01';

function widestStep(anchors: Array<{ roundingStep: number }>): number {
  return anchors.reduce((widest, a) => Math.max(widest, a.roundingStep), 0);
}

/**
 * The newest date this connection has any measurement for.
 *
 * `reconstructSeries` carries a level forward over days with no delta, so a
 * walk read to today always ends today — flat, and labelled as reconstructed
 * from movement nobody measured. Anything past this date is that invention.
 */
function lastEvidenceDate(
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

/**
 * Anchors and deltas grouped per connection, seeded from the earliest
 * snapshot ever recorded.
 *
 * Not from a window relative to `from`. `reconstructSeries` seeds from the
 * earliest anchor it is given, so readers with different windows — the
 * Deep Dive curve reaches back a year further than the YPP card or the
 * follower chip — seeded a rounded channel at different points in its band
 * and disagreed by up to step − 1. And as old anchors left the window, the
 * seed moved: the figure shifted overnight with nothing new measured.
 *
 * Cost: the delta read now spans each channel's whole capture history. That
 * is small today — capture began with FILM-1607 — and grows daily. If it
 * becomes a problem, the answer is a stored level per connection, not a
 * shorter window, which would bring the disagreement back.
 */
async function readInputs(input: {
  connectionIds: string[];
  from: string;
  to: string;
}) {
  const anchors = await querySubscriberAnchors({
    connectionIds: input.connectionIds,
    from: EARLIEST_DATE,
    to: input.to,
  });

  // Every delta after the earliest seed, for the forward walks; and every
  // delta from `from`, for the curve's backward walk before a channel's
  // first snapshot.
  const deltasFrom = anchors.reduce(
    (earliest, a) => (a.snapshotDate < earliest ? a.snapshotDate : earliest),
    input.from,
  );

  const deltas = await querySubscriberDeltas({
    connectionIds: input.connectionIds,
    from: deltasFrom,
    to: input.to,
  });

  return input.connectionIds.map((connectionId) => ({
    connectionId,
    anchors: anchors.filter((a) => a.connectionId === connectionId),
    deltas: deltas.filter((d) => d.connectionId === connectionId),
  }));
}

/**
 * One series per connection, never summed. Channels connected at different
 * times have different first-anchor dates, so a naive sum steps up by a whole
 * channel's level the day its first snapshot lands — indistinguishable from
 * real growth. Summing is the surface's job, under its own rule.
 */
export async function querySubscriberSeries(input: {
  connectionIds: string[];
  from: string;
  to: string;
}): Promise<ConnectionSubscriberSeries[]> {
  if (input.connectionIds.length === 0) return [];

  return (await readInputs(input)).map(({ connectionId, anchors, deltas }) => {
    const last = lastEvidenceDate(anchors, deltas);

    return {
      connectionId,
      // Stops where the data stops: a disconnected channel's line ends when
      // capture ended, and an active one's ends before its ingest lag.
      points: reconstructSeries(anchors, deltas, input).filter(
        (point) => last !== null && point.date <= last,
      ),
      roundingStep: widestStep(anchors),
      lastDataDate: last,
    };
  });
}

/**
 * The most recent level each connection has evidence for.
 *
 * Not simply the last point up to today: `reconstructSeries` carries the
 * level forward over days with no delta, so a series read to today always
 * ends today even when its newest data is a week old. Stopping at the latest
 * anchor or delta dates the figure by what was actually measured.
 *
 * Connections with no anchor — never snapshotted, or a count the owner hides
 * — are absent from the map rather than present as 0.
 */
export async function queryLatestSubscriberLevels(
  connectionIds: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<Map<string, LatestSubscriberLevel>> {
  const levels = new Map<string, LatestSubscriberLevel>();

  if (connectionIds.length === 0) return levels;

  const entries = await readInputs({ connectionIds, from: today, to: today });

  for (const { connectionId, anchors, deltas } of entries) {
    const lastEvidence = lastEvidenceDate(anchors, deltas);

    if (anchors.length === 0 || lastEvidence === null) continue;

    // Re-walk only up to the evidence, so the returned point is dated by it.
    const points = reconstructSeries(anchors, deltas, {
      from: lastEvidence,
      to: lastEvidence,
    });
    const latest = points.at(-1);

    if (latest) {
      levels.set(connectionId, {
        ...latest,
        roundingStep: widestStep(anchors),
      });
    }
  }

  return levels;
}
