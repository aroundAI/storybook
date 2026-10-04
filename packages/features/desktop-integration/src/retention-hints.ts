import type { AnalyticsHints, RetentionDrop } from './edit-package.schema';

/**
 * FILM-2001 AC6 (lead decision 2, brief v5): the edit package's retention
 * hints come from ClickHouse `video_retention_curves` for the episode's
 * latest published YouTube video. `content_analytics.retention_data`, which
 * the spec first named, was dropped in FILM-1201.
 *
 * What the analytics service found, before it becomes hints. Each state is
 * a different answer, and none of them is a zero.
 */
export type EpisodeRetentionCurve =
  | { state: 'unmeasured' }
  | { state: 'unavailable' }
  | { state: 'no_published_video' }
  | { state: 'no_curve'; publishId: string }
  | {
      state: 'curve';
      publishId: string;
      platform: string;
      /** When the curve was fetched, ISO 8601. */
      asOf: string;
      /** Length of the published video, when known. */
      durationSeconds: number | null;
      points: Array<{ elapsedRatio: number; audienceWatchRatio: number }>;
    };

/** How many drop-offs a package carries: the Studio places one marker each. */
export const RETENTION_HINT_LIMIT = 5;

/**
 * The smallest fall, in percentage points of the starting audience between
 * two curve points, that is a drop-off rather than the steady decline every
 * video has.
 */
export const RETENTION_HINT_MIN_DROP = 3;

const round = (value: number, places: number) =>
  Math.round(value * 10 ** places) / 10 ** places;

/**
 * The largest falls in audience between consecutive curve points, at least
 * RETENTION_HINT_MIN_DROP points each, in time order. A drop sits at the
 * start of the interval it happens over, where an edit would have to act.
 * Rises (rewatches) are not drops.
 */
export function retentionDrops(
  curve: Extract<EpisodeRetentionCurve, { state: 'curve' }>,
  limit = RETENTION_HINT_LIMIT,
): RetentionDrop[] {
  const points = [...curve.points].sort(
    (a, b) => a.elapsedRatio - b.elapsedRatio,
  );
  const drops: RetentionDrop[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    const dropPercentage = round(
      (before.audienceWatchRatio - after.audienceWatchRatio) * 100,
      2,
    );

    if (dropPercentage < RETENTION_HINT_MIN_DROP) continue;

    const elapsedRatio = Math.min(1, Math.max(0, before.elapsedRatio));

    drops.push({
      timestamp:
        curve.durationSeconds !== null
          ? round(elapsedRatio * curve.durationSeconds, 2)
          : null,
      elapsedRatio: round(elapsedRatio, 4),
      dropPercentage,
      platform: curve.platform,
      asOf: curve.asOf,
    });
  }

  return drops
    .sort(
      (a, b) =>
        b.dropPercentage - a.dropPercentage || a.elapsedRatio - b.elapsedRatio,
    )
    .slice(0, limit)
    .sort((a, b) => a.elapsedRatio - b.elapsedRatio);
}

/** The package's `analyticsHints` for what the service found. */
export function analyticsHintsFrom(
  curve: EpisodeRetentionCurve,
): AnalyticsHints {
  switch (curve.state) {
    case 'unmeasured':
    case 'unavailable':
    case 'no_published_video':
      return { retention: [], publishId: null, reason: curve.state };
    case 'no_curve':
      return { retention: [], publishId: curve.publishId, reason: 'no_curve' };
    case 'curve': {
      const retention = retentionDrops(curve);

      return retention.length > 0 || curve.points.length > 1
        ? { retention, publishId: curve.publishId }
        : { retention: [], publishId: curve.publishId, reason: 'no_curve' };
    }
  }
}
