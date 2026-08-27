/**
 * Retention curve analysis (FILM-1505 / FILM-1510 / FILM-1511).
 *
 * Pure functions over an audience-retention curve, which platforms report
 * as normalized positions (0..1 through the video) rather than seconds.
 */

export interface RetentionPoint {
  /** Position through the video, 0..1. */
  elapsedRatio: number;
  /** Share of viewers who started that are still watching here. */
  audienceWatchRatio: number;
}

/**
 * Retention at an absolute time, interpolated linearly between the two
 * surrounding curve points.
 *
 * Returns null when the curve is empty, the duration is unknown, or the
 * requested time is past the end of the video — a hook test on a video
 * with no known duration would otherwise silently compare nonsense.
 */
export function retentionAtSeconds(
  points: RetentionPoint[],
  seconds: number,
  durationSeconds: number,
): number | null {
  if (points.length === 0 || durationSeconds <= 0) return null;
  if (seconds < 0 || seconds > durationSeconds) return null;

  const target = seconds / durationSeconds;
  const sorted = [...points].sort((a, b) => a.elapsedRatio - b.elapsedRatio);

  const first = sorted[0]!;
  if (target <= first.elapsedRatio) return first.audienceWatchRatio;

  const last = sorted[sorted.length - 1]!;
  if (target >= last.elapsedRatio) return last.audienceWatchRatio;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;

    if (target <= next.elapsedRatio) {
      const span = next.elapsedRatio - prev.elapsedRatio;

      if (span === 0) return next.audienceWatchRatio;

      const weight = (target - prev.elapsedRatio) / span;

      return (
        prev.audienceWatchRatio +
        weight * (next.audienceWatchRatio - prev.audienceWatchRatio)
      );
    }
  }

  return last.audienceWatchRatio;
}

/** Retention at the end of the curve — the share who watched through. */
export function retentionFull(points: RetentionPoint[]): number | null {
  if (points.length === 0) return null;

  return points.reduce((latest, point) =>
    point.elapsedRatio > latest.elapsedRatio ? point : latest,
  ).audienceWatchRatio;
}

export interface RetentionCliff {
  /** Position through the video where the drop starts, 0..1. */
  position: number;
  /** Size of the drop in retention share. */
  drop: number;
  /** Approximate seconds into the video, when duration is known. */
  seconds?: number;
}

/**
 * Finds the sharpest early drop-off in a retention curve — the "cliff at
 * 0:45" that means the intro failed.
 *
 * Only the opening stretch is considered: viewers leaving late is normal
 * decay, whereas a steep early drop is a packaging or intro problem worth
 * acting on. Returns null when nothing exceeds the threshold.
 */
export function detectRetentionCliff(
  points: RetentionPoint[],
  options?: {
    /** Minimum drop between adjacent points to count. Default 0.15. */
    minDrop?: number;
    /** Fraction of the video treated as "early". Default 0.25. */
    earlyWindow?: number;
    /** Video length, to report the cliff position in seconds. */
    durationSeconds?: number;
  },
): RetentionCliff | null {
  const minDrop = options?.minDrop ?? 0.15;
  const earlyWindow = options?.earlyWindow ?? 0.25;

  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.elapsedRatio - b.elapsedRatio);

  let worst: RetentionCliff | null = null;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;

    // The whole segment must lie inside the early window. A segment that
    // merely starts there and runs to the end of the video is ordinary
    // decay measured over a long span, not an intro cliff.
    if (next.elapsedRatio > earlyWindow) break;

    const drop = prev.audienceWatchRatio - next.audienceWatchRatio;

    if (drop >= minDrop && (!worst || drop > worst.drop)) {
      worst = {
        position: prev.elapsedRatio,
        drop,
        ...(options?.durationSeconds
          ? { seconds: prev.elapsedRatio * options.durationSeconds }
          : {}),
      };
    }
  }

  return worst;
}
