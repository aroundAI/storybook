/**
 * The rows `seed-local-analytics.ts` writes, as a pure function of the
 * publishes it found — so the one property the fixture exists to have can be
 * tested: **every row is written under the platform of the publish it
 * belongs to** (FILM-1701 §6).
 *
 * It used to pick `dims[week % dims.length]` across every publish and stamp
 * `platform: 'youtube'` on the result, so 23 of the seeded project's 41
 * publishes — TikTok and Instagram ones included — carried YouTube traffic
 * sources and YouTube metrics. Phase 17 is verified by looking at pages whose
 * whole subject is which platform a number came from, and that fixture could
 * not show one.
 *
 * What each platform gets mirrors what its real sync writes:
 *
 * | Platform  | `video_traffic_sources` | `video_metrics`                  |
 * |-----------|-------------------------|----------------------------------|
 * | youtube   | yes                     | true daily rows (`backfill`)     |
 * | tiktok    | **none**                | `snapshot_delta`                 |
 * | instagram | **none**                | `snapshot_delta`                 |
 *
 * Traffic-source attribution is YouTube-only (phase-17 README, "Known
 * limits"), so the absence of TikTok and Instagram traffic rows is the
 * fixture being right, not incomplete.
 */
import type {
  VideoDim,
  VideoMetric,
  VideoTrafficSource,
} from '@kit/clickhouse/server';

const DAY_MS = 86_400_000;

type Platform = VideoMetric['platform'];

const SNAPSHOT_PLATFORMS: Platform[] = ['tiktok', 'instagram'];

/**
 * Deterministic, so re-running does not move the numbers under a screenshot
 * that was already reviewed. A seeded LCG rather than Math.random.
 */
export function makeRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;

    return state / 4_294_967_296;
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isPlatform(dim: VideoDim, platform: Platform) {
  return dim.platform === platform;
}

export function buildLocalAnalyticsFixture(input: {
  /** The seeded project's videos, every platform. */
  dims: VideoDim[];
  /** The Sunday the 52-week window starts on. */
  from: Date;
  weeks: number;
}): { traffic: VideoTrafficSource[]; metrics: VideoMetric[] } {
  const youtube = input.dims.filter((dim) => isPlatform(dim, 'youtube'));

  if (youtube.length === 0) {
    // `week % 0` is NaN, which indexes to undefined and surfaces three lines
    // later as "Cannot read properties of undefined (reading 'project_id')".
    throw new Error(
      'The seeded project has no YouTube publish, and traffic sources are YouTube-only.',
    );
  }

  // Its own stream per platform: YouTube keeps the draws it has always had,
  // so its figures do not move because TikTok gained rows.
  const random = makeRandom(1605);
  const snapshotRandom = makeRandom(1701);

  const traffic: VideoTrafficSource[] = [];
  const metrics: VideoMetric[] = [];

  for (let week = 0; week < input.weeks; week++) {
    const metricDate = isoDate(
      new Date(input.from.getTime() + week * 7 * DAY_MS),
    );

    // Weeks 9-12 are left with no rows at all, so the tab's gap-fill has
    // something real to fill and a reviewer can see quiet weeks rendered in
    // place rather than as a shorter chart.
    if (week >= 9 && week <= 12) continue;

    const dim = youtube[week % youtube.length]!;

    // Week 20 gets rows that sum to zero views — distinct from a missing
    // week, and the case both cards label "no views".
    const zeroWeek = week === 20;

    // Browse+Suggested climbs across the year and crosses 60% near the end,
    // so the threshold line has a real crossing to sit against rather than a
    // flat series on one side of it.
    const browseShare = zeroWeek ? 0 : 0.28 + (week / input.weeks) * 0.45;
    const total = zeroWeek ? 0 : 1_200 + Math.round(random() * 2_400);

    const split: Array<[string, number]> = [
      ['RELATED_VIDEO', browseShare * 0.62],
      ['SUBSCRIBER', browseShare * 0.26],
      ['NOTIFICATION', browseShare * 0.12],
      ['YT_SEARCH', (1 - browseShare) * 0.44],
      ['EXTERNAL_URL', (1 - browseShare) * 0.16],
      ['SHORTS', (1 - browseShare) * 0.14],
      ['PLAYLIST', (1 - browseShare) * 0.12],
      ['CHANNEL_PAGE', (1 - browseShare) * 0.09],
      ['DIRECT_OR_UNKNOWN', (1 - browseShare) * 0.04],
      // Deliberately under 1% of the week, to exercise the minimum slice
      // height that three review rounds went back and forth over.
      ['END_SCREEN', (1 - browseShare) * 0.01],
    ];

    for (const [source, share] of split) {
      const views = Math.round(total * share);

      if (views === 0 && !zeroWeek) continue;

      traffic.push({
        project_id: dim.project_id,
        video_id: dim.video_id,
        platform: 'youtube',
        metric_date: metricDate,
        source,
        views,
        watch_time_minutes: Math.round(views * 2.4),
      });
    }

    // So the sibling Deep Dive cards are not empty beside the traffic ones.
    metrics.push({
      project_id: dim.project_id,
      video_id: dim.video_id,
      platform: 'youtube',
      metric_date: metricDate,
      views: total,
      likes: Math.round(total * 0.04),
      comments: Math.round(total * 0.006),
      shares: Math.round(total * 0.003),
      saves: 0,
      watch_time_seconds: Math.round(total * 144),
      revenue_cents: 0,
      subscribers_gained: Math.round(total * 0.01),
      subscribers_lost: Math.round(total * 0.002),
      metric_source: 'backfill',
      extra_metrics: '{}',
    });

    // The zero week stays zero: a snapshot row here would give the week
    // views, and the "no views" label would lose its only fixture.
    if (zeroWeek) continue;

    for (const platform of SNAPSHOT_PLATFORMS) {
      const videos = input.dims.filter((dim) => isPlatform(dim, platform));

      if (videos.length === 0) continue;

      const video = videos[week % videos.length]!;
      const views = 400 + Math.round(snapshotRandom() * 1_600);

      // Shaped like `ingestCumulativeSnapshot` writes them: a delta of lifetime
      // counters, with no watch time, no subscribers and no revenue, because
      // neither API reports them per video.
      metrics.push({
        project_id: video.project_id,
        video_id: video.video_id,
        platform,
        metric_date: metricDate,
        views,
        likes: Math.round(views * 0.07),
        comments: Math.round(views * 0.008),
        shares: Math.round(views * 0.011),
        saves: platform === 'instagram' ? Math.round(views * 0.015) : 0,
        watch_time_seconds: 0,
        revenue_cents: 0,
        subscribers_gained: 0,
        metric_source: 'snapshot_delta',
        extra_metrics: '{}',
      });
    }
  }

  return { traffic, metrics };
}
