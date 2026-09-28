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
  ANALYTICS_PLATFORMS,
  AUDIENCE_FAMILY_DIMENSIONS,
  METRIC_FAMILIES,
  allowedMetricSources,
  capabilityFor,
  unclaimedPlatforms,
} from '../src/lib/data-provenance';
import type { MetricFamily } from '../src/lib/data-provenance';
import {
  getClickHouseClient,
  insertChannelDaily,
  insertChannelReachDaily,
  insertChannelWindows,
  insertRetentionCurves,
  insertSubscriberSnapshot,
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
  queryCompleteChannelWindowDays,
  queryConnectionVideoIds,
  queryDailyStats,
  queryDailyTimeSeries,
  queryDailyTimeSeriesByPlatform,
  queryDataDaysForVideos,
  queryLanguagePairs,
  queryLatestSnapshots,
  queryLatestSubscriberLevels,
  queryMedianViewsPerVideo,
  queryNetSubscribersForVideos,
  queryPerVideoTotals,
  queryPlatformBreakdown,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryRetentionCurves,
  queryRollingViews,
  querySegmentMembership,
  querySegmentPerformance,
  querySubscriberAnchors,
  querySubscriberDeltas,
  querySubscriberSeries,
  queryTotals,
  queryTotalsByVideoIds,
  queryTrafficSourceBreakdown,
  queryTrafficSources,
  queryVideoLanguages,
  queryVideoViewsAtAge,
  queryViewsForVideos,
  queryWatchWindowTotals,
} from '../src/server';
import type {
  AnalyticsPlatform,
  VideoMetric,
  YouTubeVideoMetric,
} from '../src/types';

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const ACCOUNT = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_PROJECT = '11111111-1111-1111-1111-111111111111';
const CHANNEL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const EPISODE = 'aaaaaaaa-0000-0000-0000-000000000001';

/**
 * A project the scan-scope assertion fills with noise, referenced by nothing
 * else here. Its rows exist to be *not* read.
 */
const NOISE_PROJECT = '22222222-2222-2222-2222-222222222222';

/**
 * Enough rows to clear several index granules (8192 apiece), so "read the
 * scoped rows" and "read the table" are separated by more than rounding. At
 * one granule the two are indistinguishable and the assertion would pass on
 * a full scan.
 */
const NOISE_ROWS = 50_000;

/**
 * How much more the scoped read may touch after the noise lands: two index
 * granules, which is the most a range read can pick up at its boundaries.
 * Anything above this is the noise itself being read.
 */
const NOISE_TOLERANCE = 2 * 8192;

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
        channel_language: 'en',
        title: 'Normal video',
        published_at: '2026-01-10 00:00:00',
        episode_duration_seconds: 600,
        asset_duration_seconds: null,
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
        channel_language: 'en',
        title: 'Back catalogue',
        published_at: '2024-03-01 00:00:00',
        episode_duration_seconds: 600,
        asset_duration_seconds: null,
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
        channel_language: 'en',
        title: 'Never watched',
        published_at: '2026-01-12 00:00:00',
        episode_duration_seconds: 1320,
        asset_duration_seconds: 45,
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
        accounts_reached: null,
      },
    ]),
  );

  await step('insertVideoReachDaily', () =>
    insertVideoReachDaily([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        metric_date: '2026-01-11',
        impressions: 4000,
        impressions_ctr: 0.05,
      },
    ]),
  );

  await step('insertVideoTrafficSources', () =>
    insertVideoTrafficSources([
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        metric_date: '2026-01-11',
        source: 'RELATED_VIDEO',
        views: 60,
        watch_time_minutes: 6,
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
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
        platform: 'youtube',
        dimension: 'follower_status',
        key: 'subscribed',
        views: 300,
        percentage: 60,
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
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
        platform: 'youtube',
        elapsed_ratio: 0.1,
        audience_watch_ratio: 0.9,
      },
      {
        project_id: PROJECT,
        video_id: NORMAL,
        platform: 'youtube',
        elapsed_ratio: 0.5,
        audience_watch_ratio: 0.4,
      },
    ]),
  );

  await step('insertChannelDaily', () =>
    insertChannelDaily([
      {
        connection_id: CHANNEL,
        metric_date: '2026-01-11',
        views: 25,
        watch_time_seconds: 300,
        engaged_views: 0,
        subscribers_gained: 1,
        subscribers_lost: 0,
      },
    ]),
  );

  await step('insertChannelReachDaily', () =>
    insertChannelReachDaily([
      {
        connection_id: CHANNEL,
        metric_date: '2026-01-11',
        impressions: 900,
        impressions_ctr: 0.05,
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
    queryTrafficSources({
      videoIds: ids,
      ...range,
      byDate: true,
      byVideo: true,
    }),
  );
  await step('queryRetentionCurve', () =>
    queryRetentionCurve({ videoId: NORMAL }),
  );

  await step('queryRetentionCurves', async () => {
    // The batched form must agree with the single-video one, or the two
    // call sites it replaced would start disagreeing about the same video.
    const batched = await queryRetentionCurves({ videoIds: [NORMAL] });
    const single = await queryRetentionCurve({ videoId: NORMAL });

    if (JSON.stringify(batched.get(NORMAL) ?? []) !== JSON.stringify(single)) {
      throw new Error(`batched and single-video curves disagree for ${NORMAL}`);
    }

    // Absent, not empty: "no retention data" and "nobody watched" are
    // different answers, and the callers render them differently.
    const missing = await queryRetentionCurves({ videoIds: [ZERO] });

    if (missing.has(ZERO)) {
      throw new Error('a video with no curve must be absent from the map');
    }

    return `${batched.get(NORMAL)?.length ?? 0} point(s), matching single`;
  });

  // Scoped deep-dive queries — the shapes that broke on the alias bug.
  await step('queryMedianViewsPerVideo (cohort)', () =>
    queryMedianViewsPerVideo({
      scope,
      bucket: 'month',
      mode: 'cohort_views_to_date',
    }),
  );
  await step('queryMedianViewsPerVideo (period)', () =>
    queryMedianViewsPerVideo({
      scope,
      bucket: 'quarter',
      mode: 'views_in_period',
    }),
  );
  await step('queryRollingViews', () =>
    queryRollingViews({
      scope,
      windowDays: 90,
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    }),
  );
  await step('queryTrafficSourceBreakdown', () =>
    queryTrafficSourceBreakdown({
      scope,
      bucket: 'week',
      startDate: '2020-01-01',
      endDate: '2030-01-01',
    }),
  );
  await step('queryTrafficSourceBreakdown (month)', () =>
    queryTrafficSourceBreakdown({
      scope,
      bucket: 'month',
      startDate: '2020-01-01',
      endDate: '2030-01-01',
    }),
  );
  await step('queryBackCatalogShare', () =>
    queryBackCatalogShare({
      scope,
      ageDays: 90,
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    }),
  );
  await step('queryCohortMedians', () => queryCohortMedians({ scope }));
  await step('queryCohortMedians (month)', () =>
    queryCohortMedians({ scope, bucket: 'month' }),
  );
  // Every kind, because the grouping expression is the one part of the SQL
  // that changes between them — arrayJoin for tags, a bare column for the
  // rest — and only the server can say whether each shape is accepted.
  for (const kind of [
    'tag',
    'language',
    'channel_language',
    'content_type',
    'connection',
  ] as const) {
    await step(`querySegmentPerformance (${kind})`, () =>
      querySegmentPerformance({
        scope,
        segment: { kind, dimension: kind === 'tag' ? 'topic' : undefined },
        minVideos: 1,
      }),
    );
  }

  await step('querySegmentMembership', () =>
    querySegmentMembership({ scope, segment: { kind: 'language' } }),
  );
  await step('queryVideoViewsAtAge', () => queryVideoViewsAtAge({ scope }));
  await step('queryWatchWindowTotals', () =>
    queryWatchWindowTotals({
      scope: { accountId: ACCOUNT, platform: 'youtube' },
      windowDays: 365,
    }),
  );
  await step('queryChannelWatchWindow', () =>
    queryChannelWatchWindow({ connectionIds: [CHANNEL], windowDays: 365 }),
  );
  await step('querySubscriberAnchors', () =>
    querySubscriberAnchors({
      connectionIds: [CHANNEL],
      from: '2020-01-01',
      to: '2030-01-01',
    }),
  );
  await step('querySubscriberDeltas', () =>
    querySubscriberDeltas({
      connectionIds: [CHANNEL],
      from: '2020-01-01',
      to: '2030-01-01',
    }),
  );

  // Every scope filter, since each one is an alias that shadowed its column.
  for (const [label, narrowed] of [
    ['connectionId', { ...scope, connectionId: CHANNEL }],
    ['platform', { ...scope, platform: 'youtube' }],
    ['contentType', { ...scope, contentType: 'full' }],
    ['language', { ...scope, language: 'en' }],
    ['channelLanguage', { ...scope, channelLanguage: 'en' }],
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

  await step(
    'assert: a later reach residual leaves the core residual intact (FILM-1504)',
    async () => {
      // The two residual reports for one channel-day, in the order they
      // usually arrive: core first, reach second. When both wrote
      // channel_daily, the reach row's zeroes won under FINAL and YPP watch
      // time and residual subscribers read back as 0.
      const connection = '77777777-7777-7777-7777-777777777777';
      const day = new Date(Date.now() - 3 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      // The day moves with the clock, so a run on an earlier day left a row
      // this 30-day window still sums: on a reused server the watch time read
      // 3600, not 1800. Start from nothing.
      for (const table of ['channel_daily', 'channel_reach_daily']) {
        await getClickHouseClient().command({
          query: `ALTER TABLE ${table} DELETE WHERE connection_id = {connection:UUID}`,
          query_params: { connection },
          clickhouse_settings: { mutations_sync: '2' },
        });
      }

      await insertChannelDaily([
        {
          connection_id: connection,
          metric_date: day,
          views: 400,
          watch_time_seconds: 1800,
          engaged_views: 330,
          subscribers_gained: 3,
          subscribers_lost: 1,
        },
      ]);
      await insertChannelReachDaily([
        {
          connection_id: connection,
          metric_date: day,
          impressions: 4000,
          impressions_ctr: 0.055,
        },
      ]);

      const watch = await queryChannelWatchWindow({
        connectionIds: [connection],
        windowDays: 30,
      });
      const deltas = await querySubscriberDeltas({
        connectionIds: [connection],
        from: day,
        to: day,
      });
      const reach = await getClickHouseClient().query({
        query: `
          SELECT impressions, round(impressions_ctr, 4) AS ctr
          FROM channel_reach_daily FINAL
          WHERE connection_id = {connection:UUID} AND metric_date = {day:Date}`,
        query_params: { connection, day },
        format: 'JSONEachRow',
      });

      const got = JSON.stringify({
        watch: watch.watchTimeSeconds,
        net: deltas.map((d) => [d.net, d.measured]),
        reach: await reach.json(),
      });
      const want = JSON.stringify({
        watch: 1800,
        // channel_daily holds YouTube's gains and losses: a measured movement.
        net: [[2, true]],
        reach: [{ impressions: '4000', ctr: 0.055 }],
      });

      if (got !== want) throw new Error(`expected ${want}, got ${got}`);

      return { watch: watch.watchTimeSeconds };
    },
  );

  await step(
    'assert: engaged views survive the other video_metrics writer (KB-50)',
    async () => {
      // The Reporting ingest and the hourly Analytics-API sync write the same
      // (video, day) key, and ReplacingMergeTree keeps the later row whole.
      // A column only one of them filled read NULL after the other's next
      // write — measured on a scratch table before this fix. Both orders,
      // and a day YouTube did not report, which must stay NULL rather than 0.
      //
      // `inserted_at` is set per row, through the writer: it is the version
      // and is second-resolution here, so two writes inside one second tie.
      const client = getClickHouseClient();
      const project = '50505050-5050-4050-8050-505050505050';
      const base = Math.floor(Date.now() / 1000);
      const at = (offset: number) =>
        new Date((base + offset) * 1000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');
      const row = (
        video: string,
        source: 'reporting_api' | 'analytics_api',
        engaged: number | null,
        offset: number,
      ): VideoMetric & { inserted_at: string } => ({
        project_id: project,
        video_id: video,
        platform: 'youtube',
        metric_date: '2026-09-20',
        views: 400,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 0,
        revenue_cents: 0,
        subscribers_gained: 0,
        metric_source: source,
        engaged_views: engaged,
        extra_metrics: '{}',
        inserted_at: at(offset),
      });

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      for (const values of [
        [row('report-then-sync', 'reporting_api', 330, 0)],
        [row('report-then-sync', 'analytics_api', 331, 1)],
        [row('sync-then-report', 'analytics_api', 331, 0)],
        [row('sync-then-report', 'reporting_api', 330, 1)],
        [row('not-reported', 'analytics_api', null, 0)],
      ]) {
        await insertVideoMetrics(values);
      }

      const result = await client.query({
        query: `
          SELECT video_id, engaged_views
          FROM video_metrics FINAL
          WHERE project_id = {project:UUID}
          ORDER BY video_id`,
        query_params: { project },
        format: 'JSONEachRow',
      });

      const got = JSON.stringify(await result.json());
      const want = JSON.stringify([
        { video_id: 'not-reported', engaged_views: null },
        { video_id: 'report-then-sync', engaged_views: '331' },
        { video_id: 'sync-then-report', engaged_views: '330' },
      ]);

      if (got !== want) throw new Error(`expected ${want}, got ${got}`);

      return 'both write orders keep a figure; unreported stays null';
    },
  );

  await step(
    'assert: dislikes, subscribers lost and AVP survive the other video_metrics writer (KB-94)',
    async () => {
      // KB-50's shape, for the three columns the Analytics-API sync used to
      // leave to their DEFAULT 0: measured on main, the sync's row turned a
      // Reporting 2 / 1 / 45.5 into 0 / 0 / 0. Rows are `YouTubeVideoMetric`,
      // the type both writers now return, so each carries every column.
      // Both write orders, a restatement by a later sync, and a repair — a
      // zeroed row from before the fix superseded by a backfill row.
      const client = getClickHouseClient();
      const project = '94949494-9494-4494-8494-949494949494';
      const base = Math.floor(Date.now() / 1000);
      const at = (offset: number) =>
        new Date((base + offset) * 1000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');
      const row = (
        video: string,
        source: YouTubeVideoMetric['metric_source'],
        [dislikes, lost, avp]: [number, number, number],
        offset: number,
      ): YouTubeVideoMetric & { inserted_at: string } => ({
        project_id: project,
        video_id: video,
        platform: 'youtube',
        metric_date: '2026-09-20',
        views: 400,
        likes: 20,
        comments: 3,
        shares: 1,
        saves: null,
        watch_time_seconds: 18000,
        revenue_cents: 0,
        subscribers_gained: 5,
        subscribers_lost: lost,
        metric_source: source,
        avg_view_duration_seconds: 45,
        avg_view_percentage: avp,
        dislikes,
        engaged_views: 330,
        extra_metrics: '{}',
        inserted_at: at(offset),
      });
      // What main's sync wrote: the three keys absent, so the defaults.
      const zeroed = (video: string, offset: number) => {
        const {
          dislikes: _d,
          subscribers_lost: _l,
          avg_view_percentage: _p,
          ...rest
        } = row(video, 'analytics_api', [0, 0, 0], offset);
        return rest as VideoMetric;
      };

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      for (const values of [
        [row('report-then-sync', 'reporting_api', [2, 1, 45.5], 0)],
        [row('report-then-sync', 'analytics_api', [3, 1, 46], 1)],
        [row('sync-then-report', 'analytics_api', [3, 1, 46], 0)],
        [row('sync-then-report', 'reporting_api', [2, 1, 45.5], 1)],
        [row('restated', 'analytics_api', [3, 1, 46], 0)],
        [row('restated', 'analytics_api', [4, 2, 47], 1)],
        [row('repaired', 'reporting_api', [2, 1, 45.5], 0)],
        [zeroed('repaired', 1)],
        [row('repaired', 'backfill', [3, 1, 46], 2)],
      ]) {
        await insertVideoMetrics(values);
      }

      const result = await client.query({
        query: `
          SELECT video_id, metric_source, dislikes, subscribers_lost,
                 avg_view_percentage
          FROM video_metrics FINAL
          WHERE project_id = {project:UUID}
          ORDER BY video_id`,
        query_params: { project },
        format: 'JSONEachRow',
      });

      const got = JSON.stringify(await result.json());
      const want = JSON.stringify([
        {
          video_id: 'repaired',
          metric_source: 'backfill',
          dislikes: 3,
          subscribers_lost: 1,
          avg_view_percentage: 46,
        },
        {
          video_id: 'report-then-sync',
          metric_source: 'analytics_api',
          dislikes: 3,
          subscribers_lost: 1,
          avg_view_percentage: 46,
        },
        {
          video_id: 'restated',
          metric_source: 'analytics_api',
          dislikes: 4,
          subscribers_lost: 2,
          avg_view_percentage: 47,
        },
        {
          video_id: 'sync-then-report',
          metric_source: 'reporting_api',
          dislikes: 2,
          subscribers_lost: 1,
          avg_view_percentage: 45.5,
        },
      ]);

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      if (got !== want) throw new Error(`expected ${want}, got ${got}`);

      return 'both write orders, a restatement and a repair keep measured figures';
    },
  );

  await step(
    'assert: a figure the platform does not measure is null, not 0 (KB-111)',
    async () => {
      // Measured on main: a TikTok video "measured" an average percentage
      // viewed of 0, and pooled with a YouTube video at 45.5% it read 13%.
      // After migration 013 the four columns are Nullable with no default,
      // the view reads NULL, and the per-video readers return null for it.
      const client = getClickHouseClient();
      const project = '11111111-1111-4111-8111-111111111111';
      const youtube = 'kb111-youtube';
      const tiktok = 'kb111-tiktok';

      const columns = await client.query({
        query: `
          SELECT name, type, default_kind
          FROM system.columns
          WHERE database = currentDatabase() AND name IN
            ('avg_view_duration_seconds', 'avg_view_percentage', 'dislikes', 'subscribers_lost')
            AND table IN ('video_metrics', 'video_daily_stats')
          ORDER BY table, name`,
        format: 'JSONEachRow',
      });
      const shapes = (
        await columns.json<{
          name: string;
          type: string;
          default_kind: string;
        }>()
      ).filter((c) => !c.type.startsWith('Nullable(') || c.default_kind !== '');
      if (shapes.length > 0) {
        throw new Error(
          `not Nullable-without-default: ${JSON.stringify(shapes)}`,
        );
      }

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      const base = {
        project_id: project,
        metric_date: '2026-09-20',
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 0,
        revenue_cents: 0,
        extra_metrics: '{}',
      };
      await insertVideoMetrics([
        {
          ...base,
          video_id: youtube,
          platform: 'youtube',
          views: 400,
          subscribers_gained: 5,
          subscribers_lost: 1,
          avg_view_duration_seconds: 45,
          avg_view_percentage: 45.5,
          dislikes: 2,
          metric_source: 'reporting_api',
        },
        // As buildSnapshotDeltaRow writes it: the four explicitly null.
        {
          ...base,
          video_id: tiktok,
          platform: 'tiktok',
          views: 1000,
          subscribers_gained: 7,
          subscribers_lost: null,
          avg_view_duration_seconds: null,
          avg_view_percentage: null,
          dislikes: null,
          metric_source: 'snapshot_delta',
        },
      ]);

      const quality = await queryQualityMetricsForVideos({
        videoIds: [youtube, tiktok],
      });
      const net = await queryNetSubscribersForVideos({
        videoIds: [youtube, tiktok],
      });

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      const got = JSON.stringify({
        youtube: [
          quality.get(youtube)?.avgViewPercentage,
          quality.get(youtube)?.avgViewDurationSeconds,
          net.get(youtube),
        ],
        tiktok: [
          quality.get(tiktok)?.avgViewPercentage,
          quality.get(tiktok)?.avgViewDurationSeconds,
          net.get(tiktok),
        ],
      });
      const want = JSON.stringify({
        youtube: [45.5, 45, { gained: 5, lost: 1 }],
        tiktok: [null, null, { gained: 7, lost: null }],
      });

      if (got !== want) throw new Error(`expected ${want}, got ${got}`);

      return 'Nullable, no default; YouTube measured, TikTok null';
    },
  );

  await step(
    'assert: saves, watch time and follower gains a platform does not measure are null (KB-114)',
    async () => {
      // TikTok measures none of the three, Instagram no watch time, YouTube
      // no saves. After migration 014 they are Nullable with no default, the
      // view reads NULL, and the per-video and daily readers say which sums
      // were measured at all: `count(col) > 0`, since `count` skips NULL.
      const client = getClickHouseClient();
      const project = '11411411-1141-4114-8114-114114114114';
      const [youtube, tiktok, instagram] = [
        'kb114-youtube',
        'kb114-tiktok',
        'kb114-instagram',
      ];

      const columns = await client.query({
        query: `
          SELECT table, name, type, default_kind
          FROM system.columns
          WHERE database = currentDatabase()
            AND name IN ('saves', 'watch_time_seconds', 'subscribers_gained')
            AND table IN ('video_metrics', 'video_daily_stats')
          ORDER BY table, name`,
        format: 'JSONEachRow',
      });
      const shapes = (
        await columns.json<{ type: string; default_kind: string }>()
      ).filter((c) => !c.type.startsWith('Nullable(') || c.default_kind !== '');
      if (shapes.length > 0) {
        throw new Error(
          `not Nullable-without-default: ${JSON.stringify(shapes)}`,
        );
      }

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      const base = {
        project_id: project,
        metric_date: '2026-09-20',
        views: 100,
        likes: 1,
        comments: 1,
        shares: 1,
        revenue_cents: 0,
        extra_metrics: '{}',
      };
      await insertVideoMetrics([
        {
          ...base,
          video_id: youtube,
          platform: 'youtube',
          saves: null,
          watch_time_seconds: 600,
          subscribers_gained: 2,
          subscribers_lost: 1,
          metric_source: 'reporting_api',
        },
        {
          ...base,
          video_id: tiktok,
          platform: 'tiktok',
          saves: null,
          watch_time_seconds: null,
          subscribers_gained: null,
          metric_source: 'snapshot_delta',
        },
        {
          ...base,
          video_id: instagram,
          platform: 'instagram',
          saves: 4,
          watch_time_seconds: null,
          subscribers_gained: null,
          metric_source: 'snapshot_delta',
        },
      ]);

      // One connection per video, so the subscriber movement read can say
      // per platform whether a day's movement was measured at all.
      const connectionOf = {
        [youtube]: '11411411-0000-4000-8000-00000000000a',
        [tiktok]: '11411411-0000-4000-8000-00000000000b',
        [instagram]: '11411411-0000-4000-8000-00000000000c',
      };
      await insertVideoDims(
        (['youtube', 'tiktok', 'instagram'] as const).map((platform) => {
          const videoId = `kb114-${platform}`;
          return {
            video_id: videoId,
            project_id: project,
            account_id: project,
            episode_id: project,
            connection_id: connectionOf[videoId]!,
            platform,
            content_type: 'short',
            language: 'en',
            channel_language: 'en',
            title: videoId,
            published_at: '2026-09-01 00:00:00',
            episode_duration_seconds: 60,
            asset_duration_seconds: null,
            tags: [],
          };
        }),
      );

      const ids = [youtube, tiktok, instagram];
      const totals = await queryTotalsByVideoIds(ids);
      const daily = await queryDailyStats({ videoIds: ids });
      const movement = await querySubscriberDeltas({
        connectionIds: ids.map((id) => connectionOf[id]!),
        from: '2026-09-20',
        to: '2026-09-20',
      });
      const measuredMovement = ids.map(
        (id) =>
          movement.find((d) => d.connectionId === connectionOf[id])?.measured,
      );

      await client.command({
        query: `ALTER TABLE video_dim DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      await client.command({
        query: `ALTER TABLE video_metrics DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });

      const got = JSON.stringify({
        totals: ids.map((id) => totals.get(id)?.measured),
        daily: ids.map(
          (id) => daily.find((row) => row.video_id === id)?.measured,
        ),
        youtubeWatch: totals.get(youtube)?.watch_time_seconds,
        instagramSaves: totals.get(instagram)?.saves,
        measuredMovement,
      });
      const flags = [
        { saves: false, watch_time_seconds: true, subscribers_gained: true },
        { saves: false, watch_time_seconds: false, subscribers_gained: false },
        { saves: true, watch_time_seconds: false, subscribers_gained: false },
      ];
      const want = JSON.stringify({
        totals: flags,
        daily: flags,
        youtubeWatch: 600,
        instagramSaves: 4,
        // TikTok measures neither gains nor losses, Instagram no losses: a
        // day's movement for either is not a movement (KB-114).
        measuredMovement: [true, false, false],
      });

      if (got !== want) throw new Error(`expected ${want}, got ${got}`);

      return 'Nullable, no default; measured flags per platform';
    },
  );

  await step(
    'assert: an unknown asset duration is null, not zero (FILM-1710)',
    async () => {
      // The Short was cut from a 22-minute episode. Its own duration is 45s,
      // and the two fulls have never been measured. `UInt32` would have
      // stored those as 0 — a measured zero — which is how the episode's
      // duration passed for the clip's.
      const result = await getClickHouseClient().query({
        query: `
          SELECT video_id, episode_duration_seconds, asset_duration_seconds
          FROM video_dim FINAL
          WHERE project_id = {projectId:UUID}
            AND video_id IN ({ids:Array(String)})
          ORDER BY video_id`,
        query_params: { projectId: PROJECT, ids: [NORMAL, ZERO] },
        format: 'JSONEachRow',
      });
      const rows = await result.json<{
        video_id: string;
        episode_duration_seconds: number;
        asset_duration_seconds: number | null;
      }>();

      const got = JSON.stringify(rows);
      const want = JSON.stringify([
        {
          video_id: NORMAL,
          episode_duration_seconds: 600,
          asset_duration_seconds: null,
        },
        {
          video_id: ZERO,
          episode_duration_seconds: 1320,
          asset_duration_seconds: 45,
        },
      ]);

      if (got !== want) throw new Error(`expected ${want}, got ${got}`);

      return rows;
    },
  );

  await step('assert: a same-day re-insert collapses to one row', async () => {
    // ReplacingMergeTree collapses on merge, at ClickHouse's discretion, so
    // this reads with FINAL. Counting rows without it passes or fails on
    // timing — a flaky test dressed as a correctness proof.
    const day = '2029-01-01';

    await insertSubscriberSnapshot({
      connectionId: CHANNEL,
      snapshotDate: day,
      subscriberCount: 1000,
      roundingStep: 0,
    });
    await insertSubscriberSnapshot({
      connectionId: CHANNEL,
      snapshotDate: day,
      subscriberCount: 2000,
      roundingStep: 0,
    });

    const rows = await querySubscriberAnchors({
      connectionIds: [CHANNEL],
      from: day,
      to: day,
    });

    if (rows.length !== 1) {
      throw new Error(`expected 1 row after re-insert, got ${rows.length}`);
    }

    if (rows[0]!.subscriberCount !== 2000) {
      throw new Error(
        `expected the later write to win, got ${rows[0]!.subscriberCount}`,
      );
    }

    return `one row, count=${rows[0]!.subscriberCount}`;
  });

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
      throw new Error(
        `expected null firstMetricDate, got ${zero.firstMetricDate}`,
      );
    }
    if (zero.ingestLagDays !== null) {
      throw new Error(`expected null ingestLagDays, got ${zero.ingestLagDays}`);
    }
    return 'firstMetricDate=null, ingestLagDays=null';
  });

  await step(
    'assert: keyset paging returns every membership row exactly once',
    async () => {
      const all = await querySegmentMembership({
        scope,
        segment: { kind: 'language' },
      });

      // One row at a time, so the resume path is exercised on every row
      // rather than only on a boundary that happens to fall mid-set.
      const paged: string[] = [];
      let after: { segment: string; videoId: string } | undefined;

      for (let i = 0; i < all.length + 2; i++) {
        const page = await querySegmentMembership({
          scope,
          segment: { kind: 'language' },
          limit: 1,
          after,
        });

        if (page.length === 0) break;

        const row = page[0]!;

        paged.push(`${row.segment}/${row.videoId}`);
        after = { segment: row.segment, videoId: row.videoId };
      }

      const expected = all.map((r) => `${r.segment}/${r.videoId}`);

      if (paged.join('|') !== expected.join('|')) {
        throw new Error(
          `keyset paging drifted: got [${paged.join(', ')}] want [${expected.join(', ')}]`,
        );
      }

      if (new Set(paged).size !== paged.length) {
        throw new Error(`keyset paging repeated a row: ${paged.join(', ')}`);
      }

      return `${paged.length} row(s), one per page, no repeats`;
    },
  );

  await step(
    'assert: a segment with no mature videos is trimmed, not shown as zero',
    async () => {
      // Gating on video_count instead would return this segment with every
      // aggregate empty — medianViews 0 over a real video count — which
      // renders as a measured zero rather than an absent measurement.
      const rows = await querySegmentPerformance({
        scope,
        segment: { kind: 'language' },
        minVideos: 1,
        // No video in the fixture is a year old as of its publish date, so
        // every segment should fall below the gate rather than come back
        // with zeroed figures.
        checkpointDays: 3650,
      });

      const zeroed = rows.find((r) => r.matureVideoCount === 0);

      if (zeroed) {
        throw new Error(
          `segment "${zeroed.segment}" returned with 0 mature videos and medianViews=${zeroed.medianViews}`,
        );
      }

      return `${rows.length} segment(s) survived a 3650-day checkpoint`;
    },
  );

  await step(
    'assert: an absent tag dimension returns tags rather than nothing',
    async () => {
      const all = await querySegmentPerformance({
        scope,
        segment: { kind: 'tag' },
        minVideos: 1,
      });

      if (all.length === 0) {
        throw new Error('no tags returned when no dimension was given');
      }

      return `${all.length} tag(s) across all dimensions`;
    },
  );

  await step(
    'assert: pre-ingest videos are excluded from a checkpoint',
    async () => {
      const rows = await queryCohortMedians({
        scope,
        asOf: '2026-06-01 00:00:00',
      });
      const old = rows.find((r) => r.cohort.startsWith('2024'));

      if (!old) throw new Error('2024 cohort missing');

      const at30 = old.checkpoints[30]!;

      if (at30.matureVideoCount !== 0) {
        throw new Error(`expected 0 mature, got ${at30.matureVideoCount}`);
      }
      if (at30.predatesIngestCount !== 1) {
        throw new Error(
          `expected 1 pre-ingest, got ${at30.predatesIngestCount}`,
        );
      }
      return `mature=0 predatesIngest=1`;
    },
  );

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

  // FILM-1712 part B. ClickHouse aggregates skip NULLs, so a bare
  // argMax(accounts_reached) would return an older snapshot's reach when the
  // latest recorded none. The baseline must be the latest snapshot's own
  // value, NULL included.
  await step(
    "assert: the baseline reach is the latest snapshot's, NULL included",
    async () => {
      const snapshot = (
        videoId: string,
        date: string,
        fetchedAt: string,
        accountsReached: number | null,
      ) => ({
        project_id: PROJECT,
        video_id: videoId,
        platform: 'instagram',
        snapshot_date: date,
        fetched_at: fetchedAt,
        views: 100,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 0,
        subscribers_gained: 0,
        accounts_reached: accountsReached,
      });

      await getClickHouseClient().insert({
        table: 'video_snapshots',
        values: [
          snapshot('reach-kept', '2026-05-01', '2026-05-01 10:00:00', 4000),
          snapshot('reach-kept', '2026-05-02', '2026-05-02 10:00:00', 5200),
          snapshot('reach-lost', '2026-05-01', '2026-05-01 10:00:00', 4000),
          snapshot('reach-lost', '2026-05-02', '2026-05-02 10:00:00', null),
        ],
        format: 'JSONEachRow',
      });

      const snaps = await queryLatestSnapshots({
        videoIds: ['reach-kept', 'reach-lost'],
        beforeDate: '2026-06-01',
      });
      const kept = snaps.get('reach-kept')?.accounts_reached;
      const lost = snaps.get('reach-lost')?.accounts_reached;

      if (kept !== 5200) throw new Error(`expected 5200, got ${kept}`);
      if (lost !== null) throw new Error(`expected null, got ${lost}`);
      return `kept=${kept} lost=${lost}`;
    },
  );

  // Migration 016: a day counts as recorded only when all its windows are.
  await step(
    'assert: a channel day is complete only with every window',
    async () => {
      const connectionId = '16161616-0000-4000-8000-000000000016';
      const row = (asOf: string, windowDays: number) => ({
        connectionId,
        platform: 'instagram' as const,
        asOf,
        windowDays,
        accountsReached: 170,
        accountsReachedFollowers: 40,
        accountsReachedNonFollowers: null,
        source: 'verify',
      });

      await insertChannelWindows([
        row('2026-09-26', 7),
        row('2026-09-26', 23),
        row('2026-09-26', 30),
        row('2026-09-27', 7),
      ]);

      const complete = await queryCompleteChannelWindowDays({
        connectionId,
        platform: 'instagram',
        windowDays: [7, 23, 30],
        since: '2026-09-01',
      });

      if (!complete.has('2026-09-26')) throw new Error('complete day missing');
      if (complete.has('2026-09-27')) throw new Error('partial day counted');
      return `complete=${[...complete].join(',')}`;
    },
  );

  await step('assert: the breakdown groups the seeded sources', async () => {
    // Fixed expectations, not a comparison of two derivations of the same
    // rows. Both queries now fold from one private row fetch and the browse
    // set is derived from the taxonomy, so asserting they agree compares a
    // thing to itself — it could only fail on a race between two concurrent
    // reads. The seed is 60 RELATED_VIDEO + 40 YT_SEARCH on one day.
    const breakdown = await queryTrafficSourceBreakdown({
      scope,
      bucket: 'month',
      startDate: '2020-01-01',
      endDate: '2030-01-01',
    });

    const bucket = breakdown.find((b) => b.totalViews > 0);

    if (!bucket) {
      throw new Error('no traffic bucket carried views');
    }

    const views = (group: string) =>
      bucket.groups.find((g) => g.group === group)?.views ?? 0;

    if (bucket.totalViews !== 100) {
      throw new Error(`total ${bucket.totalViews} != 100`);
    }

    if (views('browse_suggested') !== 60) {
      throw new Error(`browse_suggested ${views('browse_suggested')} != 60`);
    }

    if (views('search') !== 40) {
      throw new Error(`search ${views('search')} != 40`);
    }

    if (bucket.groups.length !== 8) {
      throw new Error(`${bucket.groups.length} groups != 8`);
    }

    const shareSum = bucket.groups.reduce((sum, g) => sum + g.share, 0);

    if (Math.abs(shareSum - 1) > 1e-9) {
      throw new Error(`shares sum to ${shareSum}, not 1`);
    }

    return 'browse 60 / search 40 of 100, 8 groups summing to 1';
  });

  await step('assert: every orderBy returns the full page', async () => {
    for (const orderBy of [
      'published_at',
      'lifetime_views',
      'title',
    ] as const) {
      const rows = await queryVideoViewsAtAge({ scope, orderBy });
      if (rows.length !== 3) {
        throw new Error(`${orderBy}: expected 3 rows, got ${rows.length}`);
      }
    }
    return 'published_at, lifetime_views, title';
  });
}

/** Its own project, so none of these videos move a figure asserted above. */
const LANGUAGE_PROJECT = '33333333-3333-3333-3333-333333333333';
const CHANNEL_EN = '44444444-4444-4444-4444-444444444444';
const CHANNEL_ES = '55555555-5555-5555-5555-555555555555';
const NO_CHANNEL = '00000000-0000-0000-0000-000000000000';

/**
 * The fixture FILM-1702 §8 requires, with its answers worked out by hand.
 *
 * | video           | content | channel | views |
 * |-----------------|---------|---------|-------|
 * | lang-en         | en      | en      | 1,000 |
 * | lang-es         | es      | es      |   300 | explicitly non-English
 * | lang-unset      | not set | en      | 5,000 | never set
 * | lang-misrouted  | es      | en      |   700 | differs from its channel
 * | lang-relabelled | not set | en      |    40 | was 'en'; the old row remains
 * | lang-nochannel  | not set | not set |     9 | no channel at all
 *
 * CHANNEL_EN carries English, Spanish and unlabelled videos, which is the
 * "channel carrying two languages" case.
 *
 * By content: en 1,000 · es 1,000 · not set 5,049. Under the old `'en'`
 * default the first of those would have read 6,049 and the last would not
 * have existed. By channel: en 6,740 · es 300 · not set 9.
 */
const LANGUAGE_FIXTURE = [
  {
    id: 'lang-en',
    language: 'en',
    channel: 'en',
    conn: CHANNEL_EN,
    views: 1000,
  },
  {
    id: 'lang-es',
    language: 'es',
    channel: 'es',
    conn: CHANNEL_ES,
    views: 300,
  },
  {
    id: 'lang-unset',
    language: '',
    channel: 'en',
    conn: CHANNEL_EN,
    views: 5000,
  },
  {
    id: 'lang-misrouted',
    language: 'es',
    channel: 'en',
    conn: CHANNEL_EN,
    views: 700,
  },
  {
    id: 'lang-relabelled',
    language: '',
    channel: 'en',
    conn: CHANNEL_EN,
    views: 40,
  },
  {
    id: 'lang-nochannel',
    language: '',
    channel: '',
    conn: NO_CHANNEL,
    views: 9,
  },
] as const;

async function languageSteps() {
  // Merges are what remove a superseded dim row, and on a table this small
  // they run within moments of the insert — so without this the relabelled
  // video's old row is usually gone before the assertion about it runs, and
  // that assertion passes whether or not the query handles it. (It did:
  // moving the language filter back before the argMax left this script
  // green.) Production gives no such guarantee in either direction.
  await step('pause merges on video_dim', () =>
    getClickHouseClient().command({ query: 'SYSTEM STOP MERGES video_dim' }),
  );

  try {
    await languageFixtureSteps();
  } finally {
    await step('resume merges on video_dim', () =>
      getClickHouseClient().command({ query: 'SYSTEM START MERGES video_dim' }),
    );
  }
}

async function languageFixtureSteps() {
  const scope = { projectId: LANGUAGE_PROJECT };

  await step('seed: language fixture', async () => {
    await insertVideoDims(
      LANGUAGE_FIXTURE.map((video) => ({
        video_id: video.id,
        project_id: LANGUAGE_PROJECT,
        account_id: ACCOUNT,
        episode_id: EPISODE,
        connection_id: video.conn,
        platform: 'youtube',
        content_type: 'full',
        language: video.language,
        channel_language: video.channel,
        title: video.id,
        published_at: '2026-01-10 00:00:00',
        episode_duration_seconds: 600,
        asset_duration_seconds: null,
        tags: [],
      })),
    );

    // The row the backfill supersedes: this video said 'en' until its
    // publish was reclassified. `updated_at` is set by hand so it is
    // unambiguously the older of the two, and it goes in through the raw
    // client because VideoDim has no such field — the application never
    // writes one.
    await getClickHouseClient().insert({
      table: 'video_dim',
      values: [
        {
          video_id: 'lang-relabelled',
          project_id: LANGUAGE_PROJECT,
          account_id: ACCOUNT,
          episode_id: EPISODE,
          connection_id: CHANNEL_EN,
          platform: 'youtube',
          content_type: 'full',
          language: 'en',
          channel_language: 'en',
          title: 'lang-relabelled',
          published_at: '2026-01-10 00:00:00',
          duration_seconds: 600,
          tags: [],
          updated_at: '2026-01-01 00:00:00',
        },
      ],
      format: 'JSONEachRow',
    });

    await insertVideoMetrics(
      LANGUAGE_FIXTURE.map((video) => ({
        project_id: LANGUAGE_PROJECT,
        video_id: video.id,
        platform: 'youtube',
        metric_date: '2026-01-11',
        views: video.views,
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
      })),
    );
  });

  await step('queryVideoLanguages', () => queryVideoLanguages({ scope }));
  // KB-22 part B: the purge's lookup from a connection to its videos. The
  // purge itself deletes, so it is exercised by `verify:purge`, not here.
  await step('queryConnectionVideoIds', () =>
    queryConnectionVideoIds('00000000-0000-4000-8000-0000000000c2'),
  );
  await step('queryLanguagePairs', () => queryLanguagePairs({ scope }));

  const totalsBy = async (kind: 'language' | 'channel_language') => {
    const rows = await querySegmentPerformance({
      scope,
      segment: { kind },
      minVideos: 1,
    });

    return Object.fromEntries(
      rows.map((row) => [row.segment || '(not set)', row.totalViews]),
    );
  };

  await step('assert: a language nobody set is not English', async () => {
    const totals = await totalsBy('language');
    const expected = { en: 1000, es: 1000, '(not set)': 5049 };

    if (JSON.stringify(sorted(totals)) !== JSON.stringify(sorted(expected))) {
      throw new Error(
        `by content language: got ${JSON.stringify(totals)} want ${JSON.stringify(expected)}`,
      );
    }

    return JSON.stringify(totals);
  });

  await step(
    'assert: switching the dimension changes the numbers',
    async () => {
      const totals = await totalsBy('channel_language');
      const expected = { en: 6740, es: 300, '(not set)': 9 };

      if (JSON.stringify(sorted(totals)) !== JSON.stringify(sorted(expected))) {
        throw new Error(
          `by channel target: got ${JSON.stringify(totals)} want ${JSON.stringify(expected)}`,
        );
      }

      return JSON.stringify(totals);
    },
  );

  await step(
    'assert: a relabelled video is not found under its old language',
    async () => {
      // Its superseded 'en' row is still in the table. A filter applied
      // before the argMax keeps only that row and reports the video as
      // English — which is every publish the backfill reclassified.
      const rows = await queryVideoViewsAtAge({
        scope: { ...scope, language: 'en' },
      });
      const ids = rows.map((row) => row.videoId).sort();

      if (ids.join(',') !== 'lang-en') {
        throw new Error(`language 'en' matched [${ids.join(', ')}]`);
      }

      return `language 'en' → [${ids.join(', ')}]`;
    },
  );

  await step(
    'assert: the not-set filter selects the unlabelled, not everything',
    async () => {
      const rows = await queryVideoViewsAtAge({
        scope: { ...scope, language: '' },
      });
      const ids = rows.map((row) => row.videoId).sort();
      const expected = ['lang-nochannel', 'lang-relabelled', 'lang-unset'];

      if (ids.join(',') !== expected.join(',')) {
        throw new Error(`language '' matched [${ids.join(', ')}]`);
      }

      return `${ids.length} of ${LANGUAGE_FIXTURE.length} videos`;
    },
  );

  await step(
    'assert: the Language tab and a scoped Deep Dive agree per language',
    async () => {
      // The acceptance criterion, run rather than argued: the tab groups by
      // the dim column; the Deep Dive filters on it. Same column, same
      // checkpoint, so the same number — for every language, and for the
      // unlabelled bucket.
      const totals = await totalsBy('language');
      const checked: string[] = [];

      for (const [label, tabViews] of Object.entries(totals)) {
        const language = label === '(not set)' ? '' : label;
        const rows = await queryVideoViewsAtAge({
          scope: { ...scope, language },
          checkpoints: [30],
        });
        const deepDiveViews = rows.reduce(
          (sum, row) => sum + (row.viewsAtAge[30] ?? 0),
          0,
        );

        if (deepDiveViews !== tabViews) {
          throw new Error(
            `${label}: Language tab ${tabViews}, Deep Dive ${deepDiveViews}`,
          );
        }

        checked.push(`${label}=${tabViews}`);
      }

      return checked.join(' ');
    },
  );

  await step('assert: divergent publishes are countable', async () => {
    const pairs = await queryLanguagePairs({ scope });
    const divergent = pairs
      .filter(
        (pair) =>
          pair.language !== null &&
          pair.channelLanguage !== null &&
          pair.language !== pair.channelLanguage,
      )
      .reduce((sum, pair) => sum + pair.videoCount, 0);
    const total = pairs.reduce((sum, pair) => sum + pair.videoCount, 0);

    // Only lang-misrouted. The three unlabelled videos differ from their
    // channel's 'en' as strings and must not be counted as misrouted: an
    // absence is not a disagreement.
    if (divergent !== 1 || total !== LANGUAGE_FIXTURE.length) {
      throw new Error(
        `divergent=${divergent} of ${total}: ${JSON.stringify(pairs)}`,
      );
    }

    return `${divergent} of ${total}`;
  });

  await step('assert: every video comes back with both languages', async () => {
    const rows = await queryVideoLanguages({ scope });
    const got = rows
      .map((row) => `${row.videoId}:${row.language}/${row.channelLanguage}`)
      .sort();
    const expected = LANGUAGE_FIXTURE.map(
      (video) =>
        `${video.id}:${video.language || null}/${video.channel || null}`,
    ).sort();

    if (got.join('|') !== expected.join('|')) {
      throw new Error(`got [${got.join(', ')}]`);
    }

    return `${rows.length} video(s)`;
  });
}

function sorted(record: Record<string, number>) {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Queries that CI never ran until `verify-coverage.test.ts` made a missing
 * entry fail (FILM-1610 review, D1, D2). Each asserts a value the fixture
 * determines, not merely that the SQL parsed.
 */
async function watchedMetricSteps() {
  const ids = [NORMAL, PRE_INGEST, ZERO];

  await step('queryNetSubscribersForVideos', async () => {
    const perVideo = await queryNetSubscribersForVideos({
      videoIds: ids,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const normal = perVideo.get(NORMAL);

    // NORMAL: +1 on 01-11, +2/-1 on 01-20.
    if (normal?.gained !== 3 || normal.lost !== 1) {
      throw new Error(`expected NORMAL +3/-1, got ${JSON.stringify(normal)}`);
    }
    // ZERO has no metric rows at all: absent, not present with zeros.
    if (perVideo.has(ZERO)) {
      throw new Error('a video with no rows must be absent, not zero');
    }
    return `NORMAL +${normal.gained}/-${normal.lost}`;
  });

  await step('queryDataDaysForVideos', async () => {
    const full = { startDate: '2026-01-01', endDate: '2026-12-31' };
    const counts = {
      daily: await queryDataDaysForVideos({
        videoIds: ids,
        source: 'daily',
        ...full,
      }),
      reach: await queryDataDaysForVideos({
        videoIds: ids,
        source: 'reach',
        ...full,
      }),
      traffic: await queryDataDaysForVideos({
        videoIds: ids,
        source: 'traffic',
        ...full,
      }),
      // Only 01-20 falls in this window.
      narrow: await queryDataDaysForVideos({
        videoIds: ids,
        source: 'daily',
        startDate: '2026-01-15',
        endDate: '2026-01-31',
      }),
    };

    const expected = { daily: 2, reach: 1, traffic: 1, narrow: 1 };

    if (JSON.stringify(counts) !== JSON.stringify(expected)) {
      throw new Error(
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(counts)}`,
      );
    }
    return JSON.stringify(counts);
  });

  await step('queryVideoViewsAtAge (videoIds)', async () => {
    // The chunked path views_at_30d uses; the scoped path is covered above.
    const rows = await queryVideoViewsAtAge({
      scope: { projectId: PROJECT },
      videoIds: [NORMAL, ZERO],
      checkpoints: [30],
    });
    const found = rows.map((row) => row.videoId).sort();

    if (JSON.stringify(found) !== JSON.stringify([NORMAL, ZERO].sort())) {
      throw new Error(`expected NORMAL and ZERO, got ${JSON.stringify(found)}`);
    }
    return `${rows.length} row(s)`;
  });

  await step('querySubscriberSeries', async () => {
    const series = await querySubscriberSeries({
      connectionIds: [CHANNEL],
      from: '2026-01-01',
      to: '2026-01-31',
    });

    if (series.length !== 1) {
      throw new Error(`expected one channel's series, got ${series.length}`);
    }
    return `${series.length} series`;
  });

  await step('queryLatestSubscriberLevels', async () => {
    // The 2029-01-01 snapshot written by the re-insert assertion is the
    // latest evidence for CHANNEL.
    const levels = await queryLatestSubscriberLevels([CHANNEL], '2029-01-02');

    if (!levels.has(CHANNEL)) {
      throw new Error('expected a latest level for the seeded channel');
    }
    return JSON.stringify(levels.get(CHANNEL)).slice(0, 80);
  });
}

/**
 * How much the Video Log's read actually reads.
 *
 * Every other check here asks what a query returns. This one asks what it
 * touched to get there, because `queryVideoViewsAtAge` returned the right
 * rows for a year while joining `video_daily_stats` — `video_metrics FINAL`
 * entire, every tenant — as the hash side of its LEFT JOIN. Correct output,
 * whole-table scan, and no test at any layer could tell the difference: the
 * unit suite mocks the client, and the assertion above this one checks the
 * join predicate, which was never the part that was wrong.
 *
 * It cost a CI failure before it cost a customer: the read grew with the
 * table until it passed the client's 30s socket timeout mid-job, and the
 * Video Log rendered as an empty table (PR #272).
 */
async function scanScopeSteps() {
  // Each read, and the string that finds its entry in system.query_log.
  const videoIds = [NORMAL, PRE_INGEST, ZERO];
  const projectIds = [PROJECT];

  const reads = {
    'dim-join': () =>
      readRowsOf('views_at_30', () =>
        queryVideoViewsAtAge({ scope: { projectId: PROJECT } }),
      ),
    quality: () =>
      readRowsOf('ctr_weighted', () =>
        queryQualityMetricsForVideos({ videoIds, projectIds }),
      ),
    totals: () =>
      readRowsOf('video_id, sum(views)', () =>
        queryTotalsByVideoIds(videoIds, { projectIds }),
      ),
    audience: () =>
      readRowsOf('video_audience', () =>
        queryAudienceRows({ videoIds, projectIds, dimension: 'country' }),
      ),
    traffic: () =>
      readRowsOf('video_traffic_sources', () =>
        queryTrafficSources({ videoIds, projectIds }),
      ),
    subs: () =>
      readRowsOf('subscribers_gained', () =>
        queryNetSubscribersForVideos({ videoIds, projectIds }),
      ),
    retention: () =>
      readRowsOf('audience_watch_ratio', () =>
        queryRetentionCurve({ videoId: NORMAL, projectIds }),
      ),
    'retention-batch': () =>
      readRowsOf('GROUP BY video_id, elapsed_ratio', () =>
        queryRetentionCurves({ videoIds, projectIds }),
      ),
    daily: () =>
      readRowsOf('toString(metric_date)', () =>
        queryDailyTimeSeries({ videoIds, projectId: PROJECT }),
      ),
    'data-days': () =>
      readRowsOf('DISTINCT toString(metric_date)', () =>
        queryDataDaysForVideos({
          videoIds,
          projectIds,
          source: 'daily',
          // Wide enough to include the noise era. Bounded to 2020 this read
          // excluded every noise row on its own date filter, so it reported
          // +0 whatever its project predicate did.
          startDate: '1989-01-01',
          endDate: '2030-12-31',
        }),
      ),
  };

  await step(
    "assert: another project's rows do not enlarge these reads",
    async () => {
      // Differential, not a threshold on the absolute figure: this runs
      // against a clean container in CI and against whatever a developer's
      // ClickHouse already holds, and only the difference means the same
      // thing in both. The property is exactly the one that broke — a
      // tenant's read must not grow when an unrelated tenant's data does.
      const before: Record<string, number> = {};
      for (const [name, read] of Object.entries(reads)) {
        before[name] = await read();
      }

      // The *same* video ids, under another project. That is the whole
      // point: a read filtered on `video_id` alone still prunes granules by
      // video_id, so noise under unrelated ids is excluded without any
      // project predicate and the assertion passes on the unscoped query —
      // measured, with a guard that stayed green when the bound under test
      // was deleted. Sharing the ids leaves `project_id` as the only thing
      // that can exclude these rows.
      //
      // One row per (video, day), all distinct: `video_metrics` is a
      // ReplacingMergeTree keyed on (project_id, platform, video_id,
      // metric_date), so a generator that repeats a pair collapses it at
      // insert. Two moduli over the same index did exactly that — 50,000
      // rows became 1,400, and this went green against noise that was not
      // there.
      const noiseIds = [NORMAL, PRE_INGEST, ZERO];
      const noisePlatforms = ['youtube', 'tiktok', 'instagram'] as const;
      const perDay = noiseIds.length * noisePlatforms.length;

      // Which video and platform row `index` is, and the day it falls on.
      // One day per full (video × platform) round keeps the block inside
      // few enough months to satisfy ClickHouse's 100-partitions-per-INSERT
      // limit on the tables that are partitioned by month.
      const at = (index: number) => ({
        video_id: noiseIds[index % noiseIds.length]!,
        platform:
          noisePlatforms[
            Math.floor(index / noiseIds.length) % noisePlatforms.length
          ]!,
        metric_date: new Date(
          Date.UTC(1990, 0, 1) + Math.floor(index / perDay) * 86_400_000,
        )
          .toISOString()
          .slice(0, 10),
      });

      /** Inserts in slices, so a partitioned table never sees >100 months. */
      const inSlices = async <T>(
        rows: T[],
        insert: (slice: T[]) => Promise<void>,
      ) => {
        for (let from = 0; from < rows.length; from += 4_000) {
          await insert(rows.slice(from, from + 4_000));
        }
      };

      const range = Array.from({ length: NOISE_ROWS }, (_, index) => index);

      // Nothing else removes these, and the count below is exact. A run of
      // an older generator leaves rows whose keys the current one does not
      // reuse, so ReplacingMergeTree keeps both and the count comes out at
      // a multiple of NOISE_ROWS — which fails against the *generator*
      // rather than against the leftovers. CI never sees it (fresh service
      // container); every developer with a persistent ClickHouse does.
      await clearNoise();

      // Every table a scoped read touches, not just video_metrics. A read
      // of video_audience cannot be enlarged by noise in video_metrics, so
      // a guard that seeded only the latter reported +0 for the audience,
      // traffic and retention reads whatever their SQL said — three
      // assertions about nothing.
      await inSlices(
        range.map((index) => ({
          project_id: NOISE_PROJECT,
          ...at(index),
          views: 1,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          watch_time_seconds: 0,
          revenue_cents: 0,
          subscribers_gained: 0,
          subscribers_lost: 0,
          extra_metrics: '{}',
        })),
        insertVideoMetrics,
      );

      await inSlices(
        range.map((index) => ({
          project_id: NOISE_PROJECT,
          ...at(index),
          impressions: 1,
          impressions_ctr: 0,
        })),
        insertVideoReachDaily,
      );

      await inSlices(
        range.map((index) => ({
          project_id: NOISE_PROJECT,
          ...at(index),
          source: `SRC_${index % 7}`,
          views: 1,
          watch_time_minutes: 0,
        })),
        insertVideoTrafficSources,
      );

      // Unpartitioned, and keyed on (…, dimension, key) / (…, elapsed_ratio)
      // rather than a date, so these vary that last column instead.
      await inSlices(
        range.map((index) => ({
          project_id: NOISE_PROJECT,
          video_id: noiseIds[index % noiseIds.length]!,
          platform: 'youtube' as const,
          dimension: 'country' as const,
          key: `NOISE_${index}`,
          views: 1,
          percentage: 0,
        })),
        insertVideoAudience,
      );

      // All on NORMAL, because that is the single video the retention read
      // asks for. Spread over three ids it saw a third of the noise and had
      // the thinnest margin over NOISE_TOLERANCE of the eight reads.
      await inSlices(
        range.map((index) => ({
          project_id: NOISE_PROJECT,
          video_id: NORMAL,
          platform: 'youtube' as const,
          elapsed_ratio: index / NOISE_ROWS,
          audience_watch_ratio: 0,
        })),
        insertRetentionCurves,
      );

      // Every table, not just video_daily_stats: a generator whose key
      // tuple repeats collapses at insert, and a read of a table whose
      // noise collapsed reports +0 while guarding nothing.
      for (const [table, landed] of Object.entries(await countNoiseRows())) {
        if (landed !== NOISE_ROWS) {
          throw new Error(
            `seeded ${NOISE_ROWS} noise rows into ${table} but ${landed} ` +
              `are there: reads of it would be measured against noise that ` +
              `does not exist`,
          );
        }
      }

      const grown: string[] = [];
      const growth: Record<string, number> = {};

      for (const [name, read] of Object.entries(reads)) {
        const after = await read();
        const grew = after - before[name]!;

        growth[name] = grew;

        if (grew > NOISE_TOLERANCE) {
          grown.push(`${name} +${grew}`);
        }
      }

      if (grown.length > 0) {
        throw new Error(
          `+${NOISE_ROWS} rows under another project enlarged: ` +
            `${grown.join(', ')} — not bounded by project_id`,
        );
      }

      // `step` truncates its detail, so report the shape rather than every
      // figure: the number of reads checked and the worst one.
      const worst = Math.max(...Object.values(growth));

      return `${Object.keys(reads).length} reads, worst +${worst} for +${NOISE_ROWS} rows elsewhere`;
    },
  );
}

/** The tables the scan-scope step seeds, and reads back. */
const NOISE_TABLES = [
  'video_metrics',
  'video_reach_daily',
  'video_traffic_sources',
  'video_audience',
  'video_retention_curves',
] as const;

/** Removes any earlier run's noise, and waits for the removal to apply. */
async function clearNoise(): Promise<void> {
  const client = getClickHouseClient();

  for (const table of NOISE_TABLES) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE project_id = {noiseProject: UUID}`,
      query_params: { noiseProject: NOISE_PROJECT },
      clickhouse_settings: { mutations_sync: '2' },
    });
  }
}

/** How much of the noise survived the ReplacingMergeTree's key, per table. */
async function countNoiseRows(): Promise<Record<string, number>> {
  const client = getClickHouseClient();
  const counts: Record<string, number> = {};

  for (const table of NOISE_TABLES) {
    const result = await client.query({
      query: `
        SELECT count() AS rows
        FROM ${table}
        WHERE project_id = {noiseProject: UUID}
      `,
      query_params: { noiseProject: NOISE_PROJECT },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{ rows: string }>();

    counts[table] = Number(rows[0]?.rows ?? 0);
  }

  return counts;
}

/**
 * `read_rows` for the query a call made, out of `system.query_log`.
 *
 * Matched on a string unique to the query's SQL rather than a query id:
 * passing one would mean threading it through the query function's
 * signature for a test's benefit, and this script runs its steps one at a
 * time.
 *
 * The marker must survive ClickHouse's normalisation: `system.query_log`
 * stores the query reformatted — whitespace collapsed, keywords upper-cased
 * — so `sum(x) as x` is logged as `sum(x) AS x` and a marker carrying a
 * lowercase ` as ` matches nothing. Prefer a bare identifier or an
 * expression without aliases.
 */
async function readRowsOf(
  marker: string,
  run: () => Promise<unknown>,
): Promise<number> {
  const client = getClickHouseClient();

  await run();
  await client.command({ query: 'SYSTEM FLUSH LOGS' });

  const result = await client.query({
    query: `
      SELECT read_rows
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND query LIKE {marker: String}
        AND query NOT LIKE '%system.query_log%'
      ORDER BY event_time_microseconds DESC
      LIMIT 1
    `,
    query_params: { marker: `%${marker}%` },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ read_rows: string }>();

  if (rows.length === 0) {
    throw new Error(
      `no query_log entry matching ${JSON.stringify(marker)} — either the ` +
        `query did not run or its SQL no longer contains that string`,
    );
  }

  return Number(rows[0]!.read_rows);
}

/**
 * The capability matrix against what the tables actually hold (FILM-1703 §5c).
 *
 * The writer-binding test sees call sites; this sees rows. Per family, the
 * platforms present must be a **subset** of those the matrix marks `native`
 * or `derived` — subset, not equality, because a fresh fixture holds YouTube
 * or nothing and equality would fail on every table it leaves empty. The
 * matrix claims what the pipeline *may* produce; this catches it producing
 * more. Proving a `native` entry is genuinely populated needs the
 * multi-platform fixture from FILM-1701.
 *
 * The noise project is excluded by name. `scanScopeSteps` fills it with
 * TikTok and Instagram rows in tables those platforms never write, as rows
 * that exist to be *not* read — and on a developer's persistent ClickHouse
 * they are still there from the previous run.
 */
const NOT_NOISE = 'project_id != {noiseProject: UUID}';

const audienceProbe = (family: keyof typeof AUDIENCE_FAMILY_DIMENSIONS) =>
  `SELECT DISTINCT platform FROM video_audience
   WHERE ${NOT_NOISE}
     AND dimension IN (${AUDIENCE_FAMILY_DIMENSIONS[family]
       .map((dimension) => `'${dimension}'`)
       .join(', ')})`;

/**
 * How each family's presence is read. A `Record` over `MetricFamily`, so a
 * new family has to say how it is checked, or why it is not.
 */
const PRESENCE_PROBES: Record<MetricFamily, string | null> = {
  engagement: `SELECT DISTINCT platform FROM video_metrics WHERE ${NOT_NOISE}`,
  // Families that share video_metrics are told apart by their column: a row
  // existing says nothing about whether watch time was measured.
  watch_time: `SELECT DISTINCT platform FROM video_metrics
               WHERE ${NOT_NOISE} AND watch_time_seconds > 0`,
  // Not checked, and said so rather than skipped silently. Fixtures — this
  // one, and the E2E evidence seeds — carry `revenue_cents` on YouTube rows to
  // exercise the sums, while every pipeline writer sets it to a literal 0. A
  // probe here would be testing the fixtures. What binds `revenue` is the
  // OAuth-scope marker in data-provenance.test.ts.
  revenue: null,
  traffic_sources: `SELECT DISTINCT platform FROM video_traffic_sources WHERE ${NOT_NOISE}`,
  retention_curve: `SELECT DISTINCT platform FROM video_retention_curves WHERE ${NOT_NOISE}`,
  reach: `SELECT DISTINCT platform FROM video_reach_daily WHERE ${NOT_NOISE}`,
  // Neither channel table has a platform column; both are keyed by
  // connection. Resolved through video_dim rather than assumed to be YouTube
  // because that happens to be true today. A connection with no dim row
  // cannot be resolved and is not guessed at.
  channel_totals: `SELECT DISTINCT dims.platform AS platform
                   FROM (
                     SELECT connection_id FROM channel_daily
                     UNION DISTINCT
                     SELECT connection_id FROM channel_subscribers
                   ) AS channels
                   INNER JOIN (
                     SELECT DISTINCT connection_id, platform
                     FROM video_dim
                     WHERE ${NOT_NOISE}
                   ) AS dims ON channels.connection_id = dims.connection_id`,
  demographics: audienceProbe('demographics'),
  geography: audienceProbe('geography'),
  device: audienceProbe('device'),
  follower_status: audienceProbe('follower_status'),
};

async function provenanceSteps() {
  const client = getClickHouseClient();

  const rowsOf = async <T>(query: string): Promise<T[]> => {
    const result = await client.query({
      query,
      query_params: { noiseProject: NOISE_PROJECT },
      format: 'JSONEachRow',
    });

    return result.json<T>();
  };

  const levelOf = (family: MetricFamily, platform: string) =>
    (ANALYTICS_PLATFORMS as readonly string[]).includes(platform)
      ? capabilityFor(family, platform as AnalyticsPlatform).level
      : 'not a platform the matrix knows';

  for (const family of METRIC_FAMILIES) {
    const probe = PRESENCE_PROBES[family];

    await step(`provenance: ${family}`, async () => {
      if (probe === null) return 'not checked — see PRESENCE_PROBES';

      const observed = (await rowsOf<{ platform: string }>(probe)).map(
        (row) => row.platform,
      );
      const unclaimed = unclaimedPlatforms(family, observed);

      if (unclaimed.length > 0) {
        throw new Error(
          `rows exist for ${unclaimed
            .map((platform) => `${platform} (${levelOf(family, platform)})`)
            .join(', ')} — the pipeline writes ${family} for a platform ` +
            `CAPABILITY_MATRIX says has none`,
        );
      }

      return `${observed.sort().join(', ') || 'no rows'} ⊆ matrix`;
    });
  }

  // `metric_source` already records how a row was arrived at, so the matrix
  // is reconciled against it rather than given a parallel notion: a
  // `reporting_api` row for TikTok means the matrix is wrong.
  await step('provenance: metric_source agrees with the level', async () => {
    const rows = await rowsOf<{ platform: string; sources: string[] }>(
      `SELECT platform, groupUniqArray(metric_source) AS sources
       FROM video_metrics
       WHERE ${NOT_NOISE}
       GROUP BY platform`,
    );

    const stray = rows.flatMap(({ platform, sources }) => {
      const allowed: readonly string[] = (
        ANALYTICS_PLATFORMS as readonly string[]
      ).includes(platform)
        ? allowedMetricSources(
            capabilityFor('engagement', platform as AnalyticsPlatform),
          )
        : [];

      return sources
        .filter((source) => !allowed.includes(source))
        .map((source) => `${platform}: ${source}`);
    });

    if (stray.length > 0) {
      throw new Error(
        `metric_source the matrix's level does not allow — ${stray.join(', ')}`,
      );
    }

    return rows
      .map(
        ({ platform, sources }) => `${platform}: ${sources.sort().join('/')}`,
      )
      .join('; ');
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
  await languageSteps();
  await assertions();
  await watchedMetricSteps();
  await provenanceSteps();
  // Last: it fills a project with noise, and nothing above should see it.
  await scanScopeSteps();

  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} ${r.detail}`);
  }

  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

void main();
