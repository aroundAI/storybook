/**
 * Velocity and acceleration (FILM-1713), at the grain the data has.
 *
 * Velocity is the change in a cumulative count per day of a video's age;
 * acceleration is whether that velocity is rising, holding, falling or gone.
 * Both are descriptive: "accelerating" says what the series did, never why.
 *
 * Every number below is a named constant with its argument, for the owner to
 * review; none is fitted to data, and each says so.
 *
 * Pure and client-safe, like the rest of `lib/`.
 */

/**
 * The finest grain velocity is emitted at: a day.
 *
 * `video_snapshots` is `ReplacingMergeTree(fetched_at)` ordered by
 * `(project_id, platform, video_id, snapshot_date)` (migration 002), so the
 * hourly sync overwrites the day's row and keeps only its latest fetch;
 * `video_metrics` is keyed by `metric_date`. There is no stored sub-daily
 * history, so an hourly-looking figure would be a daily one relabelled. Hourly
 * early-warning is a storage decision, filed as its own lead.
 */
export const VELOCITY_GRAIN = 'day' as const;

export type AgeBucketId =
  | 'day_0'
  | 'day_1'
  | 'days_2_3'
  | 'days_4_7'
  | 'days_8_14'
  | 'days_15_30'
  | 'days_31_plus';

/**
 * Age buckets, by whole days since publication. Velocity is only ever
 * compared within one: a day-1 video's pace says nothing about a day-10's.
 *
 * The first week is split finely because that is where a video's daily pace
 * changes fastest — the launch spike, then the first decay — and a coarser
 * bucket would compare the spike with its tail. Edges after that double
 * (2, 4, 8, 15, 31) so each bucket spans roughly as much change as the last,
 * and 30/31 lines up with `computeMaturity`'s first checkpoint so FILM-1715
 * can join on it. Provisional: chosen from the shape of the problem, not
 * fitted to any channel's data.
 */
export const AGE_BUCKETS: readonly { id: AgeBucketId; fromDay: number }[] = [
  { id: 'day_0', fromDay: 0 },
  { id: 'day_1', fromDay: 1 },
  { id: 'days_2_3', fromDay: 2 },
  { id: 'days_4_7', fromDay: 4 },
  { id: 'days_8_14', fromDay: 8 },
  { id: 'days_15_30', fromDay: 15 },
  { id: 'days_31_plus', fromDay: 31 },
];

/** The bucket for an age in whole days. Anything finer than a day is refused. */
export function ageBucket(ageDays: number): AgeBucketId {
  if (!Number.isInteger(ageDays) || ageDays < 0) {
    throw new RangeError(
      `Age must be a whole number of days (grain: ${VELOCITY_GRAIN}), got ${ageDays}`,
    );
  }

  return AGE_BUCKETS.filter((bucket) => bucket.fromDay <= ageDays).at(-1)!.id;
}

/** One day's cumulative count for one video, at its age that day. */
export interface DailyPoint {
  ageDays: number;
  cumulative: number;
}

export type VelocityReading =
  | { kind: 'value'; ageDays: number; bucket: AgeBucketId; perDay: number }
  | {
      kind: 'absent';
      ageDays: number;
      /**
       * `missing_day`: no snapshot the day before, so the change cannot be
       * placed on a day. `cumulative_decreased`: the platform recounted.
       */
      reason: 'missing_day' | 'cumulative_decreased';
    };

/**
 * Day-over-day velocity from consecutive daily cumulative counts, oldest
 * first. A gap is named, never spread across the missing days.
 *
 * For views, feed this the column FILM-1722's `viewsDenominatorFor` chose,
 * so a series across YouTube's 2026-08-27 change is on engaged views or
 * refused, as a rate is.
 */
export function dailyVelocities(
  points: readonly DailyPoint[],
): VelocityReading[] {
  const sorted = [...points].sort((a, b) => a.ageDays - b.ageDays);

  return sorted.slice(1).map((point, index) => {
    const previous = sorted[index]!;
    ageBucket(point.ageDays);

    if (point.ageDays - previous.ageDays !== 1) {
      return { kind: 'absent', ageDays: point.ageDays, reason: 'missing_day' };
    }

    const perDay = point.cumulative - previous.cumulative;

    if (perDay < 0) {
      return {
        kind: 'absent',
        ageDays: point.ageDays,
        reason: 'cumulative_decreased',
      };
    }

    return {
      kind: 'value',
      ageDays: point.ageDays,
      bucket: ageBucket(point.ageDays),
      perDay,
    };
  });
}

type VelocityValue = Extract<VelocityReading, { kind: 'value' }>;

/** How two videos' paces compare, only ever within one age bucket. */
export function compareVelocity(
  a: VelocityValue,
  b: VelocityValue,
):
  | { kind: 'compared'; ratio: number }
  | {
      kind: 'not_comparable';
      reason: 'different_age_buckets' | 'zero_baseline';
    } {
  if (a.bucket !== b.bucket) {
    return { kind: 'not_comparable', reason: 'different_age_buckets' };
  }

  if (b.perDay === 0) {
    return { kind: 'not_comparable', reason: 'zero_baseline' };
  }

  return { kind: 'compared', ratio: a.perDay / b.perDay };
}

/**
 * Today's velocity at least this multiple of yesterday's is accelerating.
 *
 * 1.05 and its reciprocal (`DECELERATING_AT`) make the band symmetric in log
 * space, so a +5% day and a -5% day are equally far from stable. It is the
 * widest symmetric band that still reads the spec's own example, 100 → 120 →
 * 110 views a day (0.917), as decelerating. Provisional: daily counts carry
 * day-of-week noise of more than 5% on small channels, which argues for
 * wider; the owner reviews it in the PR.
 */
export const ACCELERATING_AT = 1.05;

/** Today's velocity at most this multiple of yesterday's is decelerating: 1 / ACCELERATING_AT. */
export const DECELERATING_AT = 1 / ACCELERATING_AT;

/**
 * Today's velocity at or below this share of the video's own peak daily
 * velocity is stalled — "this is over", not "this is cooling".
 *
 * Relative to the video's peak because no absolute floor fits a channel with
 * 200 views a day and one with 200,000. A tenth of the peak is where a
 * typical launch decay has flattened into the long tail. Provisional.
 */
export const STALLED_SHARE_OF_PEAK = 0.1;

export type GrowthState =
  | 'accelerating'
  | 'stable'
  | 'decelerating'
  | 'stalled'
  /** Fewer than two consecutive daily velocities: not stable, unknown. */
  | 'not_enough_points';

/**
 * Acceleration from consecutive daily velocities, oldest first. Only the
 * run of consecutive days ending today should be passed in; a gap breaks it.
 */
export function growthState(velocities: readonly number[]): GrowthState {
  if (velocities.length < 2) return 'not_enough_points';

  const today = velocities.at(-1)!;
  const yesterday = velocities.at(-2)!;
  const peak = Math.max(...velocities);

  if (peak === 0 || today <= STALLED_SHARE_OF_PEAK * peak) return 'stalled';
  if (yesterday === 0) return 'accelerating';

  const change = today / yesterday;

  if (change >= ACCELERATING_AT) return 'accelerating';
  if (change <= DECELERATING_AT) return 'decelerating';
  return 'stable';
}
