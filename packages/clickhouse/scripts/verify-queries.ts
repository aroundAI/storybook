/**
 * Executes every query and insert against a real ClickHouse.
 *
 * The unit suite mocks the client, so it never runs SQL — which is how a
 * `WHERE` clause that ClickHouse rejects outright shipped to main with 120
 * green tests behind it. Anything that only fails when the server parses
 * the query is invisible to that suite by construction: alias shadowing,
 * aggregate placement, a column that does not exist, a row shape that does
 * not match the table.
 *
 * Usage:
 *   ./clickhouse server &                       # or any reachable instance
 *   pnpm --filter @kit/clickhouse migrate
 *   pnpm --filter @kit/clickhouse verify
 */
import {
  insertChannelDaily,
  insertRetentionCurves,
  insertVideoAudience,
  insertVideoDims,
  insertVideoMetrics,
  insertVideoReachDaily,
  insertVideoSnapshots,
  insertVideoTrafficSources,
  isClickHouseEnabled,
  queryAudienceRows,
  queryBackCatalogShare,
  queryChannelWatchWindow,
  queryCohortMedians,
  queryDailyStats,
  queryDailyTimeSeries,
  queryDailyTimeSeriesByPlatform,
  queryLatestSnapshots,
  queryMedianByTag,
  queryMedianViewsPerVideo,
  queryPerVideoTotals,
  queryPlatformBreakdown,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryRollingViews,
  queryTotals,
  queryTotalsByVideoIds,
  queryTrafficShareTrend,
  queryTrafficSources,
  queryVideoViewsAtAge,
  queryViewsForVideos,
  queryWatchWindowTotals,
} from '../src/server';

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const ACCOUNT = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_PROJECT = '11111111-1111-1111-1111-111111111111';
const CHANNEL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const EPISODE = 'aaaaaaaa-0000-0000-0000-000000000001';

const NORMAL = 'vid-normal';
const PRE_INGEST = 'vid-preingest';
const ZERO = 'vid-zero';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function step(name: string, run: () => Promise<unknown>) {
  try {
    const value = await run();
    const detail = Array.isArray(value)
      ? `${value.length} row(s)`
      : value instanceof Map
        ? `${value.size} key(s)`
        : value === undefined
          ? 'ok'
          : JSON.stringify(value).slice(0, 80);
    results.push({ name, ok: true, detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      ok: false,
      detail: message.split('\n')[0]!.slice(0, 200),
    });
  }
}

async function seed() {
  await step('insertVideoDims', () =>
    insertVideoDims([
      {
        video_id: NORMAL,
        project_id: PROJECT,
        account_id: ACCOUNT,
        episode_id: EPISODE,
        connection_id: CHANNEL,
        platform: 'youtube',
        content_type: 'full',
        language: 'en',
        title: 'Normal video',
        published_at: '2026-01-10 00:00:00',
        duration_seconds: 600,
        tags: ['topic:a'],
      },
      {
        video_id: PRE_INGEST,
        project_id: PROJECT,
        account_id: ACCOUNT,
        episode_id: EPISODE,
        connection_id: CHANNEL,
        platform: 'youtube',
        content_type: 'full',
        language: 'en',
        title: 'Back catalogue',
        published_at: '2024-03-01 00:00:00',
        duration_seconds: 600,
        tags: ['topic:a'],
      },
      {
        video_id: ZERO,
        project_id: PROJECT,
        account_id: ACCOUNT,
        episode_id: EPISODE,
        connection_id: CHANNEL,
        platform: 'youtube',
        content_type: 'short',
        language: 'es',
        title: 'Never watched',
        published_at: '2026-01-12 00:00:00',
        duration_seconds: 60,
        tags: ['topic:b'],
      },
    ]),
  );

  await step('insertVideoMetrics', () =>
    insertVideoMetrics([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        metric_date: '2026-01-11',
        views: 100,
        likes: 1,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 600,
        revenue_cents: 10,
        subscribers_gained: 1,
        subscribers_lost: 0,
        metric_source: 'analytics_api',
        extra_metrics: '{}',
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        metric_date: '2026-01-20',
        views: 400,
        likes: 4,
        comments: 2,
        shares: 1,
        saves: 0,
        watch_time_seconds: 2400,
        revenue_cents: 40,
        subscribers_gained: 2,
        subscribers_lost: 1,
        metric_source: 'reporting_api',
        extra_metrics: '{}',
      },
      {
        project_id: PROJECT,
        video_id: PRE_INGEST,
        platform: 'youtube',
        metric_date: '2026-01-11',
        views: 7,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 42,
        revenue_cents: 0,
        subscribers_gained: 0,
        subscribers_lost: 0,
        metric_source: 'backfill',
        extra_metrics: '{}',
      },
      // Same video id under a DIFFERENT project — proves the metrics join
      // is scoped, rather than summing another tenant's rows into this one.
      {
        project_id: OTHER_PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        metric_date: '2026-01-11',
        views: 99_999,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 0,
        revenue_cents: 0,
        subscribers_gained: 0,
        subscribers_lost: 0,
        metric_source: 'analytics_api',
        extra_metrics: '{}',
      },
    ]),
  );

  await step('insertVideoSnapshots', () =>
    insertVideoSnapshots([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        snapshot_date: '2026-01-20',
        views: 500,
        likes: 5,
        comments: 2,
        shares: 1,
        saves: 0,
        watch_time_seconds: 3000,
        subscribers_gained: 3,
      },
    ]),
  );

  await step('insertVideoReachDaily', () =>
    insertVideoReachDaily([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        metric_date: '2026-01-11',
        impressions: 4000,
        impressions_ctr: 0.05,
        engaged_views: 90,
        average_view_duration_seconds: 180,
        average_view_percentage: 30,
      },
    ]),
  );

  await step('insertVideoTrafficSources', () =>
    insertVideoTrafficSources([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        metric_date: '2026-01-11',
        source: 'RELATED_VIDEO',
        views: 60,
        watch_time_minutes: 6,
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        metric_date: '2026-01-11',
        source: 'YT_SEARCH',
        views: 40,
        watch_time_minutes: 4,
      },
    ]),
  );

  await step('insertVideoAudience', () =>
    insertVideoAudience([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        snapshot_date: '2026-01-20',
        dimension: 'follower_status',
        key: 'subscribed',
        views: 300,
        percentage: 60,
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        snapshot_date: '2026-01-20',
        dimension: 'age_group',
        key: 'age25-34',
        views: 200,
        percentage: 40,
      },
    ]),
  );

  await step('insertRetentionCurves', () =>
    insertRetentionCurves([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        snapshot_date: '2026-01-20',
        elapsed_ratio: 0.1,
        audience_watch_ratio: 0.9,
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        snapshot_date: '2026-01-20',
        elapsed_ratio: 0.5,
        audience_watch_ratio: 0.4,
      },
    ]),
  );

  await step('insertChannelDaily', () =>
    insertChannelDaily([
      {
        connection_id: CHANNEL,
        account_id: ACCOUNT,
        metric_date: '2026-01-11',
        views: 25,
        watch_time_seconds: 300,
        subscribers_gained: 1,
        subscribers_lost: 0,
      },
    ]),
  );
}

async function queries() {
  const scope = { projectId: PROJECT };
  const ids = [NORMAL, PRE_INGEST, ZERO];
  const range = { startDate: '2026-01-01', endDate: '2026-12-31' };

  await step('queryTotals (videoIds)', () =>
    queryTotals({ videoIds: ids, ...range }),
  );
  await step('queryTotals (projectId)', () =>
    queryTotals({ projectId: PROJECT, ...range }),
  );
  await step('queryTotalsByVideoIds', () => queryTotalsByVideoIds(ids, range));
  await step('queryPerVideoTotals', () =>
    queryPerVideoTotals({ videoIds: ids, ...range }),
  );
  await step('queryDailyTimeSeries', () =>
    queryDailyTimeSeries({ videoIds: ids, ...range }),
  );
  await step('queryDailyTimeSeriesByPlatform', () =>
    queryDailyTimeSeriesByPlatform({ videoIds: ids, ...range }),
  );
  await step('queryPlatformBreakdown', () =>
    queryPlatformBreakdown({ videoIds: ids, ...range }),
  );
  await step('queryDailyStats', () =>
    queryDailyStats({ videoIds: ids, ...range }),
  );
  await step('queryViewsForVideos', () => queryViewsForVideos(PROJECT, ids));
  await step('queryLatestSnapshots', () =>
    queryLatestSnapshots({ videoIds: ids, beforeDate: '2026-06-01' }),
  );
  await step('queryQualityMetricsForVideos', () =>
    queryQualityMetricsForVideos({ videoIds: ids, ...range }),
  );
  await step('queryAudienceRows', () =>
    queryAudienceRows({ videoIds: ids, dimension: 'follower_status' }),
  );
  await step('queryTrafficSources', () =>
    queryTrafficSources({ videoIds: ids, ...range }),
  );
  await step('queryTrafficSources (byDate+byVideo)', () =>
    queryTrafficSources({ videoIds: ids, ...range, byDate: true, byVideo: true }),
  );
  await step('queryRetentionCurve', () =>
    queryRetentionCurve({ videoId: NORMAL }),
  );

  // Scoped deep-dive queries — the shapes that broke on the alias bug.
  await step('queryMedianViewsPerVideo (cohort)', () =>
    queryMedianViewsPerVideo({ scope, bucket: 'month', mode: 'cohort_views_to_date' }),
  );
  await step('queryMedianViewsPerVideo (period)', () =>
    queryMedianViewsPerVideo({ scope, bucket: 'quarter', mode: 'views_in_period' }),
  );
  await step('queryRollingViews', () =>
    queryRollingViews({ scope, windowDays: 90, startDate: '2026-01-01', endDate: '2026-03-31' }),
  );
  await step('queryTrafficShareTrend', () =>
    queryTrafficShareTrend({ scope, bucket: 'week' }),
  );
  await step('queryBackCatalogShare', () =>
    queryBackCatalogShare({ scope, ageDays: 90, startDate: '2026-01-01', endDate: '2026-03-31' }),
  );
  await step('queryCohortMedians', () => queryCohortMedians({ scope }));
  await step('queryCohortMedians (month)', () =>
    queryCohortMedians({ scope, bucket: 'month' }),
  );
  await step('queryMedianByTag', () =>
    queryMedianByTag({ scope, dimension: 'topic', minVideos: 1 }),
  );
  await step('queryVideoViewsAtAge', () => queryVideoViewsAtAge({ scope }));
  await step('queryWatchWindowTotals', () =>
    queryWatchWindowTotals({ scope: { accountId: ACCOUNT, platform: 'youtube' }, windowDays: 365 }),
  );
  await step('queryChannelWatchWindow', () =>
    queryChannelWatchWindow({ connectionIds: [CHANNEL], windowDays: 365 }),
  );

  // Every scope filter, since each one is an alias that shadowed its column.
  for (const [label, narrowed] of [
    ['connectionId', { ...scope, connectionId: CHANNEL }],
    ['platform', { ...scope, platform: 'youtube' }],
    ['contentType', { ...scope, contentType: 'full' }],
    ['language', { ...scope, language: 'en' }],
    ['accountId', { accountId: ACCOUNT }],
  ] as const) {
    await step(`scope filter: ${label}`, () =>
      queryVideoViewsAtAge({ scope: narrowed }),
    );
  }
}

/**
 * A handful of behaviours worth asserting, not just executing. These are
 * the ones where a query can run cleanly and still be wrong.
 */
async function assertions() {
  const scope = { projectId: PROJECT };

  await step('assert: dim-joined reads are scoped by project', async () => {
    // The fixture seeds a row with the same video_id under a second
    // project. That is not reachable in production — video_id is the
    // publish UUID (dim-sync writes `row.id`), which is unique per tenant —
    // but it does pin the join predicate on the queries that carry one.
    const rows = await queryVideoViewsAtAge({ scope });
    const normal = rows.find((r) => r.videoId === NORMAL);

    if (normal?.lifetimeViews !== 500) {
      throw new Error(`expected 500 views, got ${normal?.lifetimeViews}`);
    }
    return normal.lifetimeViews;
  });

  await step('note: videoId-only reads span project_id by design', async () => {
    // queryTotalsByVideoIds filters on video_id alone, so it sums a
    // video's rows across every project_id they carry. Harmless today for
    // the reason above.
    //
    // It stops being harmless if a publish ever moves between projects:
    // video_metrics is ordered by (project_id, platform, video_id,
    // metric_date), so the same day under two project_ids is two rows that
    // ReplacingMergeTree will not collapse, and this sums both. Recorded
    // rather than "fixed" — adding a project filter here would instead
    // drop the pre-move history, which is the opposite error.
    const totals = await queryTotalsByVideoIds([NORMAL], {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    return `spans projects: ${totals.get(NORMAL)?.views} views`;
  });

  await step('assert: nothing-ingested is distinct from no-views', async () => {
    const rows = await queryVideoViewsAtAge({ scope });
    const zero = rows.find((r) => r.videoId === ZERO);

    if (!zero) throw new Error('zero-view video missing from the log');
    if (zero.firstMetricDate !== null) {
      throw new Error(`expected null firstMetricDate, got ${zero.firstMetricDate}`);
    }
    if (zero.ingestLagDays !== null) {
      throw new Error(`expected null ingestLagDays, got ${zero.ingestLagDays}`);
    }
    return 'firstMetricDate=null, ingestLagDays=null';
  });

  await step('assert: pre-ingest videos are excluded from a checkpoint', async () => {
    const rows = await queryCohortMedians({ scope, asOf: '2026-06-01 00:00:00' });
    const old = rows.find((r) => r.cohort.startsWith('2024'));

    if (!old) throw new Error('2024 cohort missing');

    const at30 = old.checkpoints[30]!;

    if (at30.matureVideoCount !== 0) {
      throw new Error(`expected 0 mature, got ${at30.matureVideoCount}`);
    }
    if (at30.predatesIngestCount !== 1) {
      throw new Error(`expected 1 pre-ingest, got ${at30.predatesIngestCount}`);
    }
    return `mature=0 predatesIngest=1`;
  });

  await step('assert: latest snapshot resolves', async () => {
    const snaps = await queryLatestSnapshots({
      videoIds: [NORMAL],
      beforeDate: '2026-06-01',
    });
    const snap = snaps.get(NORMAL);

    if (!snap) throw new Error('snapshot missing');
    if (snap.views !== 500) throw new Error(`expected 500, got ${snap.views}`);
    return `views=${snap.views} on ${snap.snapshot_date}`;
  });

  await step('assert: every orderBy returns the full page', async () => {
    for (const orderBy of ['published_at', 'lifetime_views', 'title'] as const) {
      const rows = await queryVideoViewsAtAge({ scope, orderBy });
      if (rows.length !== 3) {
        throw new Error(`${orderBy}: expected 3 rows, got ${rows.length}`);
      }
    }
    return 'published_at, lifetime_views, title';
  });
}

async function main() {
  if (!isClickHouseEnabled()) {
    console.error(
      'CLICKHOUSE_ENABLED is not true — set it, plus CLICKHOUSE_HOST, and re-run.',
    );
    process.exit(1);
  }

  await seed();
  await queries();
  await assertions();

  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} ${r.detail}`,
    );
  }

  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

void main();
