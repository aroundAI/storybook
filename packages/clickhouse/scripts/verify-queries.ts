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
  CAPABILITY_MATRIX,
  METRIC_FAMILIES,
  allowedMetricSources,
  capabilityFor,
  coverageAsOf,
  foldObservedCoverage,
  unclaimedPlatforms,
} from '../src/lib/data-provenance';
import type { MetricFamily } from '../src/lib/data-provenance';
import {
  FORMAT_FAMILIES,
  formatFamilyOfDim,
  unmappedFormatPairs,
} from '../src/lib/format-families';
import type { FormatFamily } from '../src/lib/format-families';
import { VIEWS_DATA_WINDOWS } from '../src/lib/self-benchmark';
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
  queryChannelNewAccounts,
  queryChannelReach,
  queryChannelWatchWindow,
  queryCohortMedians,
  queryCompleteChannelWindowDays,
  queryConnectionVideoIds,
  queryDailyReachForVideos,
  queryDailyStats,
  queryDailyTimeSeries,
  queryDailyTimeSeriesByPlatform,
  queryDataDaysForVideos,
  queryFollowerStatusByUploadMonth,
  queryLanguagePairs,
  queryLatestSnapshots,
  queryLatestSubscriberLevels,
  queryMedianViewsPerVideo,
  queryNetSubscribersForVideos,
  queryObservedCoverage,
  queryPerVideoTotals,
  queryPlatformBreakdown,
  queryPostAccountsReached,
  queryPostsAccountsReached,
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
  queryVideoBenchmark,
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
        reposts: null,
        all_surface_views: null,
        all_surface_likes: null,
        all_surface_comments: null,
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

  // KB-124. quantileExact returned the upper of the two middle values for an
  // even count; the median queries use quantileExactInclusive, which averages
  // them, wrapped in ifNotFinite because it answers nan (not 0) for no rows.
  await step(
    'assert: the median of an even count averages the middle two, and of no rows is 0',
    async () => {
      const result = await getClickHouseClient().query({
        query: `
          SELECT
            (SELECT ifNotFinite(quantileExactInclusive(0.5)(v), 0)
               FROM (SELECT arrayJoin([1000, 3000]) AS v)) AS even_median,
            (SELECT ifNotFinite(quantileExactInclusiveIf(0.5)(v, v > 0), 0)
               FROM (SELECT arrayJoin([1000, 2000, 9000]) AS v)) AS odd_median,
            (SELECT ifNotFinite(quantileExactInclusive(0.5)(v), 0)
               FROM (SELECT arrayJoin([1000, 3000]) AS v) WHERE 0) AS empty_median`,
        format: 'JSONEachRow',
      });
      const [row] = await result.json<{
        even_median: number;
        odd_median: number;
        empty_median: number;
      }>();

      if (
        Number(row?.even_median) !== 2000 ||
        Number(row?.odd_median) !== 2000 ||
        Number(row?.empty_median) !== 0
      ) {
        throw new Error(`unexpected medians ${JSON.stringify(row)}`);
      }

      return 'even 2000, odd 2000, empty 0';
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
    "assert: the baseline reach, watch time and reposts are the latest snapshot's, NULL included",
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
        // Migration 017: the snapshot that recorded no reach recorded no
        // watch time either, and the baseline must say so too.
        watch_time_seconds: accountsReached === null ? null : 0,
        subscribers_gained: 0,
        accounts_reached: accountsReached,
        // Migration 018: reposts follow the same rule as reach.
        reposts: accountsReached === null ? null : accountsReached / 100,
        // Migration 019: so do the all-surface aggregates.
        all_surface_views:
          accountsReached === null ? null : accountsReached * 2,
        all_surface_likes: accountsReached === null ? null : 0,
        all_surface_comments: accountsReached === null ? null : 0,
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
      const lostWatch = snaps.get('reach-lost')?.watch_time_seconds;
      if (lostWatch !== null) {
        throw new Error(`watch time: expected null, got ${lostWatch}`);
      }
      const keptReposts = snaps.get('reach-kept')?.reposts;
      const lostReposts = snaps.get('reach-lost')?.reposts;
      if (keptReposts !== 52 || lostReposts !== null) {
        throw new Error(
          `reposts: expected 52 and null, got ${keptReposts} and ${lostReposts}`,
        );
      }
      const keptAll = snaps.get('reach-kept')?.all_surface_views;
      const lostAll = snaps.get('reach-lost')?.all_surface_views;
      if (keptAll !== 10400 || lostAll !== null) {
        throw new Error(
          `all_surface_views: expected 10400 and null, got ${keptAll} and ${lostAll}`,
        );
      }
      return `kept=${kept} lost=${lost} lostWatch=${lostWatch} reposts=${keptReposts}/${lostReposts} allSurfaceViews=${keptAll}/${lostAll}`;
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

  // The reach readers (src/reach.ts), with hand-computed answers.
  await step(
    'assert: reach readers answer per channel and per post',
    async () => {
      const connectionId = '17171717-0000-4000-8000-000000000017';
      const w = (asOf: string, windowDays: number, reach: number | null) => ({
        connectionId,
        platform: 'instagram' as const,
        asOf,
        windowDays,
        accountsReached: reach,
        accountsReachedFollowers: null,
        accountsReachedNonFollowers: null,
        source: 'verify',
      });

      await insertChannelWindows([
        w('2026-09-26', 7, 60),
        w('2026-09-26', 30, 170),
        w('2026-09-26', 23, 130),
        w('2026-09-27', 30, 175),
        w('2026-09-27', 23, null),
      ]);

      const reach30 = await queryChannelReach({
        connectionId,
        platform: 'instagram',
        windowDays: 30,
        from: '2026-09-01',
        to: '2026-09-30',
      });
      const fresh = await queryChannelNewAccounts({
        connectionId,
        from: '2026-09-01',
        to: '2026-09-30',
      });

      const got30 = reach30
        .map((r) => `${r.asOf}=${r.accountsReached}`)
        .join(',');
      if (got30 !== '2026-09-26=170,2026-09-27=175')
        throw new Error(`30-day ${got30}`);
      const gotNew = fresh.map((r) => `${r.asOf}=${r.newAccounts}`).join(',');
      // 170 - 130 = 40; the 27th has no 23-day figure, so it is unknown.
      if (gotNew !== '2026-09-26=40,2026-09-27=null')
        throw new Error(`new ${gotNew}`);

      const post = {
        project_id: PROJECT,
        video_id: 'reach-post',
        platform: 'instagram' as const,
      };
      const day = (metric_date: string, accounts_reached: number) => ({
        ...post,
        metric_date,
        views: 10,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: null,
        revenue_cents: 0,
        subscribers_gained: null,
        // Instagram's daily rows are snapshot deltas; a provenance step checks it.
        metric_source: 'snapshot_delta' as const,
        accounts_reached,
        extra_metrics: '{}',
      });
      await insertVideoMetrics([
        day('2026-09-25', 1200),
        day('2026-09-26', 700),
      ]);
      await insertVideoSnapshots([
        {
          ...post,
          snapshot_date: '2026-09-26',
          views: 20,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          watch_time_seconds: 0,
          subscribers_gained: 0,
          accounts_reached: 5900,
          reposts: 0,
          all_surface_views: null,
          all_surface_likes: null,
          all_surface_comments: null,
        },
      ]);

      const reached = await queryPostAccountsReached({
        projectId: PROJECT,
        videoId: 'reach-post',
        from: '2026-09-01',
        to: '2026-09-30',
      });

      if (reached.inRange !== 1900)
        throw new Error(`inRange ${reached.inRange}`);
      if (reached.lifetime !== 5900)
        throw new Error(`lifetime ${reached.lifetime}`);

      const none = await queryPostAccountsReached({
        projectId: PROJECT,
        videoId: 'no-such-post',
        from: '2026-09-01',
        to: '2026-09-30',
      });
      if (none.lifetime !== null || none.inRange !== null) {
        throw new Error(`empty post ${JSON.stringify(none)}`);
      }

      // The batched reader gives each post the same two figures, per post.
      const batched = await queryPostsAccountsReached({
        projectIds: [PROJECT],
        videoIds: ['reach-post', 'no-such-post'],
        from: '2026-09-01',
        to: '2026-09-30',
      });
      const one = batched.get('reach-post');
      if (one?.inRange !== 1900 || one.lifetime !== 5900) {
        throw new Error(`batched ${JSON.stringify(one)}`);
      }
      if (batched.has('no-such-post')) throw new Error('batched: empty post');

      return `30d=${got30} new=${gotNew} post=${reached.inRange}/${reached.lifetime}`;
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
    // Every table it unions, over a window wide enough to include the noise
    // era: bounded to a recent window, the date filter alone would exclude
    // the noise and this would report +0 whatever its project predicate did.
    coverage: () =>
      readRowsOf('groupUniqArray(metric_source)', () =>
        queryObservedCoverage(
          { projectId: PROJECT },
          '1989-01-01',
          '2030-12-31',
        ),
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
      //
      // Cleared *before* the baseline (KB-147). A persistent ClickHouse —
      // a developer's, local CI's lane A — still holds the previous run's
      // noise, and a baseline read over it already contains every noise
      // row: the difference is then zero whatever the read's SQL says, and
      // an unscoped read passed. Clearing only before the insert, below,
      // made this a guard on a fresh container and nowhere else.
      await clearNoise();

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
      // container); every developer with a persistent ClickHouse does. The
      // clear above the baseline covers it.

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
  // Told apart from engagement by the column, as watch_time is.
  reposts: `SELECT DISTINCT platform FROM video_metrics
            WHERE ${NOT_NOISE} AND reposts IS NOT NULL`,
  all_surface_engagement: `SELECT DISTINCT platform FROM video_metrics
            WHERE ${NOT_NOISE} AND all_surface_views IS NOT NULL`,
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
  // Told apart from engagement by the column, as watch_time is.
  accounts_reached: `SELECT DISTINCT platform FROM video_metrics
                     WHERE ${NOT_NOISE} AND accounts_reached IS NOT NULL`,
  // Keyed by connection, with its own platform column and no project.
  channel_accounts_reached: `SELECT DISTINCT platform FROM channel_windows
                             WHERE accounts_reached IS NOT NULL`,
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

/** A project holding only the format-family fixture below. */
const FORMAT_PROJECT = '33333333-3333-3333-3333-333333333333';

/**
 * One video per case the family mapping has to get right (FILM-1716). The
 * `superseded` row is the same video's first dim row, written before its
 * asset duration was known: a filter that read it instead of the newest
 * row would put a 200-second upload back among the Shorts.
 */
const FORMAT_FIXTURE: {
  video_id: string;
  platform: string;
  content_type: string;
  asset_duration_seconds: number | null;
  superseded?: { asset_duration_seconds: number | null };
}[] = [
  {
    video_id: 'fmt-yt-short-45',
    platform: 'youtube',
    content_type: 'short',
    asset_duration_seconds: 45,
  },
  {
    video_id: 'fmt-yt-short-200',
    platform: 'youtube',
    content_type: 'short',
    asset_duration_seconds: 200,
    superseded: { asset_duration_seconds: null },
  },
  {
    video_id: 'fmt-yt-short-null',
    platform: 'youtube',
    content_type: 'short',
    asset_duration_seconds: null,
  },
  {
    video_id: 'fmt-yt-full',
    platform: 'youtube',
    content_type: 'full',
    asset_duration_seconds: 1320,
  },
  {
    video_id: 'fmt-tt-full',
    platform: 'tiktok',
    content_type: 'full',
    asset_duration_seconds: null,
  },
  {
    video_id: 'fmt-x-short',
    platform: 'twitter',
    content_type: 'short',
    asset_duration_seconds: null,
  },
  {
    video_id: 'fmt-ig-trailer',
    platform: 'instagram',
    content_type: 'trailer',
    asset_duration_seconds: null,
  },
  {
    video_id: 'fmt-fb-teaser',
    platform: 'facebook',
    content_type: 'teaser',
    asset_duration_seconds: null,
  },
];

/**
 * Format families against the live table (FILM-1716).
 *
 * The first step is the one that matters over time: every `(platform,
 * content_type)` actually in `video_dim` must be covered by
 * `FORMAT_BY_CONTENT_TYPE`, so a new content type fails here rather than
 * falling silently out of every family. The second proves the SQL filter
 * and `resolveFormatFamily` agree row for row — they are built from the
 * same tables, and this is what says so.
 */
async function formatFamilySteps() {
  const client = getClickHouseClient();
  const dimRow = (
    row: (typeof FORMAT_FIXTURE)[number],
    asset: number | null,
    updatedAt: string,
  ) => ({
    video_id: row.video_id,
    project_id: FORMAT_PROJECT,
    account_id: FORMAT_PROJECT,
    episode_id: EPISODE,
    connection_id: CHANNEL,
    platform: row.platform,
    content_type: row.content_type,
    language: 'en',
    channel_language: 'en',
    title: row.video_id,
    published_at: '2026-01-10 00:00:00',
    episode_duration_seconds: 1320,
    asset_duration_seconds: asset,
    tags: [],
    updated_at: updatedAt,
  });

  await step('format families: seed', async () => {
    await client.command({
      query: 'ALTER TABLE video_dim DELETE WHERE project_id = {project:UUID}',
      query_params: { project: FORMAT_PROJECT },
      clickhouse_settings: { mutations_sync: '2' },
    });
    await client.insert({
      table: 'video_dim',
      format: 'JSONEachRow',
      // Otherwise ReplacingMergeTree collapses the superseded row into the
      // newest one on the way in, and the case it exists for never occurs —
      // the guard below then passes with the filter in the wrong clause.
      clickhouse_settings: { optimize_on_insert: 0 },
      values: FORMAT_FIXTURE.flatMap((row) => [
        ...(row.superseded
          ? [
              dimRow(
                row,
                row.superseded.asset_duration_seconds,
                '2020-01-01 00:00:00',
              ),
            ]
          : []),
        dimRow(row, row.asset_duration_seconds, '2026-01-11 00:00:00'),
      ]),
    });
  });

  await step('format families: every live pair is mapped', async () => {
    const result = await client.query({
      query: `SELECT DISTINCT platform, content_type FROM video_dim FINAL
              WHERE ${NOT_NOISE}`,
      query_params: { noiseProject: NOISE_PROJECT },
      format: 'JSONEachRow',
    });
    const observed = await result.json<{
      platform: string;
      content_type: string;
    }>();
    const unmapped = unmappedFormatPairs(observed);

    if (unmapped.length > 0) {
      throw new Error(
        `video_dim holds ${unmapped
          .map((pair) => `${pair.platform}/${pair.content_type}`)
          .join(', ')} — no format family maps it; add it to ` +
          `FORMAT_BY_CONTENT_TYPE rather than letting it fall out of every family`,
      );
    }

    return `${observed.length} pair(s), all mapped`;
  });

  const expected = (family: FormatFamily) =>
    FORMAT_FIXTURE.filter((row) => {
      const resolved = formatFamilyOfDim(row);
      return resolved.ok && resolved.family === family;
    })
      .map((row) => row.video_id)
      .sort();

  for (const family of FORMAT_FAMILIES) {
    await step(`format families: ${family} in SQL = in TS`, async () => {
      const rows = await queryVideoLanguages({
        scope: { projectId: FORMAT_PROJECT, formatFamily: family },
      });
      const got = rows.map((row) => row.videoId).sort();
      const want = expected(family);

      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(
          `SQL selected [${got.join(', ')}], resolveFormatFamily says [${want.join(', ')}]`,
        );
      }

      return got.join(', ') || 'none';
    });
  }

  await step('format families: a content-type list binds as IN', async () => {
    const rows = await queryVideoLanguages({
      scope: { projectId: FORMAT_PROJECT, contentType: ['teaser', 'trailer'] },
    });
    const got = rows.map((row) => row.videoId).sort();

    if (got.join() !== 'fmt-fb-teaser,fmt-ig-trailer') {
      throw new Error(`selected [${got.join(', ')}]`);
    }

    return got.join(', ');
  });

  await step('format families: cleanup', () =>
    client.command({
      query: 'ALTER TABLE video_dim DELETE WHERE project_id = {project:UUID}',
      query_params: { project: FORMAT_PROJECT },
      clickhouse_settings: { mutations_sync: '2' },
    }),
  );
}

/**
 * A run that must not depend on an earlier one: every fixture below is
 * deleted first and again afterwards, so a re-run reads only what it seeds.
 */
async function clearFixtureRows(
  projects: string[],
  connections: string[],
): Promise<void> {
  const client = getClickHouseClient();

  for (const table of [
    'video_dim',
    'video_metrics',
    'video_traffic_sources',
    'video_audience',
  ]) {
    for (const project of projects) {
      await client.command({
        query: `ALTER TABLE ${table} DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });
    }
  }

  for (const connection of connections) {
    await client.command({
      query:
        'ALTER TABLE channel_daily DELETE WHERE connection_id = {connection:UUID}',
      query_params: { connection },
      clickhouse_settings: { mutations_sync: '2' },
    });
  }
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function expectClose(label: string, actual: number, expected: number): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-6) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const HAND_PROJECT = '66666666-6666-6666-6666-666666666666';
const HAND_ACCOUNT = '66666666-6666-6666-6666-666666666667';
const HAND_CHANNEL = '66666666-6666-6666-6666-666666666668';
const YPP_PROJECT = '88888888-8888-8888-8888-888888888881';
const YPP_ACCOUNT = '88888888-8888-8888-8888-888888888882';
const YPP_CHANNEL = '88888888-8888-8888-8888-888888888883';
const YPP_UNATTRIBUTED_PROJECT = '88888888-8888-8888-8888-888888888884';
const YPP_UNATTRIBUTED_ACCOUNT = '88888888-8888-8888-8888-888888888885';
const ZERO_CONNECTION = '00000000-0000-0000-0000-000000000000';

/**
 * Videos of the hand-computed fixture, all on one channel and account.
 *
 * | video | published  | daily views (date: views)                    | total |
 * |-------|------------|----------------------------------------------|-------|
 * | hand-a | 2026-01-05 | 01-06: 100 · 02-10: 50 · 03-20: 60           |   210 |
 * | hand-b | 2026-01-10 | 01-11: 200                                   |   200 |
 * | hand-c | 2026-01-20 | 01-21: 9,000 (the viral one)                 | 9,000 |
 * | hand-d | 2026-02-03 | 02-04: 400 · 03-01: 100                      |   500 |
 * | hand-e | 2025-11-01 | none: uploaded before the channel's ingest   |     - |
 */
const HAND_FACEBOOK = 'hand-fb';

const HAND_VIDEOS = [
  {
    id: 'hand-a',
    published: '2026-01-05',
    days: { '2026-01-06': 100, '2026-02-10': 50, '2026-03-20': 60 },
  },
  { id: 'hand-b', published: '2026-01-10', days: { '2026-01-11': 200 } },
  { id: 'hand-c', published: '2026-01-20', days: { '2026-01-21': 9000 } },
  {
    id: 'hand-d',
    published: '2026-02-03',
    days: { '2026-02-04': 400, '2026-03-01': 100 },
  },
  { id: 'hand-e', published: '2025-11-01', days: {} },
] as const;

function dimFor(input: {
  id: string;
  project: string;
  account: string;
  connection: string;
  published: string;
}) {
  return {
    video_id: input.id,
    project_id: input.project,
    account_id: input.account,
    episode_id: EPISODE,
    connection_id: input.connection,
    platform: 'youtube' as const,
    content_type: 'full',
    language: 'en',
    channel_language: 'en',
    title: input.id,
    published_at: `${input.published} 00:00:00`,
    episode_duration_seconds: 600,
    asset_duration_seconds: null,
    tags: [],
  };
}

function metricFor(input: {
  project: string;
  id: string;
  date: string;
  views: number;
  watchTimeSeconds?: number;
  subscribersGained?: number;
  subscribersLost?: number;
}) {
  return {
    project_id: input.project,
    video_id: input.id,
    platform: 'youtube' as const,
    metric_date: input.date,
    views: input.views,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: input.watchTimeSeconds ?? 0,
    revenue_cents: 0,
    subscribers_gained: input.subscribersGained ?? 0,
    subscribers_lost: input.subscribersLost ?? 0,
    metric_source: 'analytics_api' as const,
    extra_metrics: '{}',
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Asserts a value, not a row count, for the queries FILM-1506 and FILM-1602
 * list. Every expected figure is worked out by hand in the comment beside
 * it from the fixture table above, never read back from the query.
 */
async function handComputedSteps() {
  const projects = [HAND_PROJECT, YPP_PROJECT, YPP_UNATTRIBUTED_PROJECT];
  const connections = [HAND_CHANNEL, YPP_CHANNEL];
  const scope = { projectId: HAND_PROJECT };

  await step('seed: hand-computed fixture', async () => {
    await clearFixtureRows(projects, connections);

    await insertVideoDims(
      HAND_VIDEOS.map((video) =>
        dimFor({
          id: video.id,
          project: HAND_PROJECT,
          account: HAND_ACCOUNT,
          connection: HAND_CHANNEL,
          published: video.published,
        }),
      ),
    );

    await insertVideoMetrics(
      HAND_VIDEOS.flatMap((video) =>
        Object.entries<number>(video.days).map(([date, views]) =>
          metricFor({ project: HAND_PROJECT, id: video.id, date, views }),
        ),
      ),
    );

    // A Facebook reel beside them (FILM-1720): `views` is NULL, its own
    // denominators are not. Every views figure below is worked out without
    // it, because a Facebook play is not a YouTube view: a reader that
    // counts it as a video with 0 views, or adds a denominator to views,
    // moves an expected figure.
    await insertVideoDims([
      {
        ...dimFor({
          id: HAND_FACEBOOK,
          project: HAND_PROJECT,
          account: HAND_ACCOUNT,
          connection: HAND_CHANNEL,
          published: '2026-01-15',
        }),
        platform: 'facebook',
        content_type: 'short',
      },
    ]);
    await insertVideoMetrics(
      ['2026-01-16', '2026-02-12'].map((date) => ({
        ...metricFor({
          project: HAND_PROJECT,
          id: HAND_FACEBOOK,
          date,
          views: 0,
        }),
        platform: 'facebook' as const,
        views: null,
        likes: 7,
        comments: 2,
        shares: 1,
        saves: null,
        subscribers_lost: null,
        metric_source: 'snapshot_delta' as const,
        plays: 900,
        views_3s: 500,
        views_3s_organic: 400,
        views_3s_paid: 100,
      })),
    );

    const traffic = (
      id: string,
      date: string,
      source: string,
      views: number,
    ) => ({
      project_id: HAND_PROJECT,
      video_id: id,
      platform: 'youtube' as const,
      metric_date: date,
      source,
      views,
      watch_time_minutes: views / 10,
    });

    await insertVideoTrafficSources([
      traffic('hand-a', '2026-01-06', 'RELATED_VIDEO', 60),
      traffic('hand-a', '2026-01-06', 'SUBSCRIBER', 20),
      traffic('hand-a', '2026-01-06', 'YT_SEARCH', 20),
      traffic('hand-b', '2026-01-11', 'YT_SEARCH', 20),
      traffic('hand-b', '2026-01-11', 'EXTERNAL_URL', 80),
      traffic('hand-a', '2026-02-10', 'YT_SEARCH', 25),
      traffic('hand-d', '2026-02-04', 'SHORTS', 50),
      traffic('hand-d', '2026-02-04', 'TS_99', 25),
    ]);

    await insertVideoReachDaily([
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-a',
        platform: 'youtube' as const,
        metric_date: '2026-01-06',
        impressions: 1000,
        impressions_ctr: 0.5,
      },
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-a',
        platform: 'youtube' as const,
        metric_date: '2026-02-10',
        impressions: 400,
        impressions_ctr: 0.25,
      },
    ]);

    await insertVideoAudience([
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-a',
        platform: 'youtube' as const,
        dimension: 'follower_status',
        key: 'subscribed',
        views: 300,
        percentage: 30,
      },
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-a',
        platform: 'youtube' as const,
        dimension: 'follower_status',
        key: 'not_subscribed',
        views: 700,
        percentage: 70,
      },
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-b',
        platform: 'youtube' as const,
        dimension: 'follower_status',
        key: 'subscribed',
        views: 50,
        percentage: 25,
      },
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-b',
        platform: 'youtube' as const,
        dimension: 'follower_status',
        key: 'not_subscribed',
        views: 150,
        percentage: 75,
      },
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-d',
        platform: 'youtube' as const,
        dimension: 'follower_status',
        key: 'subscribed',
        views: 30,
        percentage: 30,
      },
      {
        project_id: HAND_PROJECT,
        video_id: 'hand-d',
        platform: 'youtube' as const,
        dimension: 'follower_status',
        key: 'not_subscribed',
        views: 70,
        percentage: 70,
      },
    ]);
  });

  await step('assert: monthly median by upload month is by hand', async () => {
    const buckets = await queryMedianViewsPerVideo({
      scope,
      bucket: 'month',
      mode: 'cohort_views_to_date',
    });
    const january = buckets.find((b) => b.bucket === '2026-01-01');
    const february = buckets.find((b) => b.bucket === '2026-02-01');

    // January uploads a, b, c have 210, 200, 9000 views to date. Sorted
    // [200, 210, 9000]: median is the middle, 210. p25 sits at position
    // 0.5 of the way: 200 + 0.5 * (210 - 200) = 205. p75 at position 1.5:
    // 210 + 0.5 * (9000 - 210) = 4605. Mean (200 + 210 + 9000) / 3 = 3136.667.
    expectEqual('jan count', january?.videoCount, 3);
    expectEqual('jan median', january?.medianViews, 210);
    expectEqual('jan p25', january?.p25Views, 205);
    expectEqual('jan p75', january?.p75Views, 4605);
    expectClose('jan mean', january?.meanViews ?? NaN, 9410 / 3);
    // February: d alone, 400 + 100 = 500.
    expectEqual('feb count', february?.videoCount, 1);
    expectEqual('feb median', february?.medianViews, 500);

    if ((january?.medianViews ?? Infinity) > (january?.meanViews ?? 0)) {
      throw new Error('median exceeds mean on right-skewed data');
    }

    return 'jan median 210 <= mean 3136.67; feb 500';
  });

  await step(
    'assert: monthly median by calendar month is by hand',
    async () => {
      const buckets = await queryMedianViewsPerVideo({
        scope,
        bucket: 'month',
        mode: 'views_in_period',
      });
      const byBucket = Object.fromEntries(buckets.map((b) => [b.bucket, b]));

      // January's views per video: a 100, b 200, c 9000. Median 200,
      // p25 = 100 + 0.5 * 100 = 150, p75 = 200 + 0.5 * 8800 = 4600,
      // mean 9300 / 3 = 3100.
      expectEqual('jan median', byBucket['2026-01-01']?.medianViews, 200);
      expectEqual('jan p25', byBucket['2026-01-01']?.p25Views, 150);
      expectEqual('jan p75', byBucket['2026-01-01']?.p75Views, 4600);
      expectClose('jan mean', byBucket['2026-01-01']?.meanViews ?? NaN, 3100);
      // February: a 50, d 400. Two rows: the median is their average, 225;
      // p25 = 50 + 0.25 * 350 = 137.5, p75 = 50 + 0.75 * 350 = 312.5.
      expectEqual('feb median', byBucket['2026-02-01']?.medianViews, 225);
      expectEqual('feb p25', byBucket['2026-02-01']?.p25Views, 137.5);
      expectEqual('feb p75', byBucket['2026-02-01']?.p75Views, 312.5);
      // March: a 60, d 100, median 80.
      expectEqual('mar median', byBucket['2026-03-01']?.medianViews, 80);

      if (
        (byBucket['2026-01-01']?.medianViews ?? Infinity) >
        (byBucket['2026-01-01']?.meanViews ?? 0)
      ) {
        throw new Error('median exceeds mean on right-skewed data');
      }

      return 'jan median 200 <= mean 3100; feb 225; mar 80';
    },
  );

  await step(
    'assert: rolling-90 is the trailing 90 days, by hand',
    async () => {
      const points = await queryRollingViews({
        scope,
        windowDays: 90,
        startDate: '2026-01-01',
        endDate: '2026-04-15',
      });
      const at = (date: string) => points.find((p) => p.date === date);

      // 2026-01-01 .. 2026-04-15 is 105 days, zero-filled, so a quiet day is a
      // row rather than a gap.
      expectEqual('rows', points.length, 105);
      expectEqual('quiet day', at('2026-01-02')?.views, 0);
      // 01-21: 100 + 200 + 9000 = 9300 (nothing yet from February on).
      expectEqual('01-21', at('2026-01-21')?.rollingViews, 9300);
      // 03-31 is day 89 of the range: its window is days 0..89, all seven
      // view days: 100+200+9000+400+50+100+60 = 9910.
      expectEqual('03-31', at('2026-03-31')?.rollingViews, 9910);
      // 04-05 is day 94, window 5..94 still holds 01-06 (day 5): 9910.
      expectEqual('04-05', at('2026-04-05')?.rollingViews, 9910);
      // 04-06 drops 01-06's 100: 9810.
      expectEqual('04-06', at('2026-04-06')?.rollingViews, 9810);
      // 04-15 (day 104), window 15..104 also loses 01-11's 200: 9610.
      expectEqual('04-15', at('2026-04-15')?.rollingViews, 9610);

      return '01-21 9300 · 04-05 9910 · 04-06 9810 · 04-15 9610';
    },
  );

  await step('assert: traffic share by month is by hand', async () => {
    const buckets = await queryTrafficSourceBreakdown({
      scope,
      bucket: 'month',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    });
    const share = (bucket: string, group: string) => {
      const row = buckets
        .find((b) => b.bucket === bucket)
        ?.groups.find((g) => g.group === group);

      return { views: row?.views, share: row?.share };
    };

    // January total 60+20+20+20+80 = 200: browse_suggested (related 60 +
    // subscriber 20) 80 -> 0.4, search (20 + 20) 40 -> 0.2, external 80 ->
    // 0.4.
    expectEqual(
      'jan total',
      buckets.find((b) => b.bucket === '2026-01-01')?.totalViews,
      200,
    );
    expectEqual('jan browse', share('2026-01-01', 'browse_suggested'), {
      views: 80,
      share: 0.4,
    });
    expectEqual('jan search', share('2026-01-01', 'search'), {
      views: 40,
      share: 0.2,
    });
    expectEqual('jan external', share('2026-01-01', 'external'), {
      views: 80,
      share: 0.4,
    });
    // February total 25+50+25 = 100: search 0.25, shorts 0.5, and the
    // unknown TS_99 is `other`, not dropped: 0.25.
    expectEqual(
      'feb total',
      buckets.find((b) => b.bucket === '2026-02-01')?.totalViews,
      100,
    );
    expectEqual('feb search', share('2026-02-01', 'search'), {
      views: 25,
      share: 0.25,
    });
    expectEqual('feb shorts', share('2026-02-01', 'shorts_feed'), {
      views: 50,
      share: 0.5,
    });
    expectEqual('feb other', share('2026-02-01', 'other'), {
      views: 25,
      share: 0.25,
    });

    return 'jan 0.4/0.2/0.4 · feb 0.25/0.5/0.25';
  });

  await step('assert: back-catalog share is by hand', async () => {
    const buckets = await queryBackCatalogShare({
      scope,
      ageDays: 30,
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    });
    const byBucket = Object.fromEntries(buckets.map((b) => [b.bucket, b]));

    // A view is back catalogue when the video was published more than 30
    // days before that day. January: every view is within a day or two of
    // upload -> 0 of 9300. February: a's 02-10 views are 36 days old (>30),
    // d's 02-04 are 1 -> 50 of 450 = 0.1111. March: a's 03-20 are 74 days
    // old, d's 03-01 are 26 -> 60 of 160 = 0.375.
    expectEqual(
      'jan',
      [
        byBucket['2026-01-01']?.totalViews,
        byBucket['2026-01-01']?.backCatalogViews,
      ],
      [9300, 0],
    );
    expectEqual(
      'feb',
      [
        byBucket['2026-02-01']?.totalViews,
        byBucket['2026-02-01']?.backCatalogViews,
      ],
      [450, 50],
    );
    expectClose('feb share', byBucket['2026-02-01']?.share ?? NaN, 50 / 450);
    expectEqual(
      'mar',
      [
        byBucket['2026-03-01']?.totalViews,
        byBucket['2026-03-01']?.backCatalogViews,
      ],
      [160, 60],
    );
    expectClose('mar share', byBucket['2026-03-01']?.share ?? NaN, 0.375);

    return 'jan 0/9300 · feb 50/450 · mar 60/160';
  });

  await step(
    'assert: a Facebook reel adds nothing to views, by hand',
    async () => {
      const totals = await queryTotals({ projectId: HAND_PROJECT });
      const facebook = await queryTotals({
        projectId: HAND_PROJECT,
        platforms: ['facebook'],
      });

      // Views: 210 + 200 + 9000 + 500 from the YouTube videos; the reel's
      // two rows are NULL, so 9910. Likes: 0 on YouTube, 7 + 7 on the reel.
      expectEqual('pooled views', totals.views, 9910);
      expectEqual('pooled likes', totals.likes, 14);
      // A Facebook-only selection has no views at all: the sum is NULL,
      // which this reader reads as 0 (a sum over nothing).
      expectEqual('facebook likes', facebook.likes, 14);

      const client = getClickHouseClient();
      const [kept] = await (
        await client.query({
          query: `
            SELECT
              countIf(views IS NULL) AS null_views,
              sum(plays) AS plays,
              sum(views_3s) AS views_3s,
              sum(views_3s_organic) AS organic,
              sum(views_3s_paid) AS paid
            FROM video_metrics FINAL
            WHERE project_id = {project: UUID} AND platform = 'facebook'
          `,
          query_params: { project: HAND_PROJECT },
          format: 'JSONEachRow',
        })
      ).json<Record<string, string>>();

      // Two rows of 900 plays, 500 three-second views (400 organic, 100 paid).
      expectEqual('facebook denominators', kept, {
        null_views: '2',
        plays: '1800',
        views_3s: '1000',
        organic: '800',
        paid: '200',
      });

      return 'views 9910 without the reel; its plays 1800, 3s 800 organic + 200 paid';
    },
  );

  await step('assert: cohort medians at 30 days are by hand', async () => {
    const cohorts = await queryCohortMedians({
      scope,
      bucket: 'month',
      checkpoints: [30],
      asOf: '2026-06-01 00:00:00',
    });
    const january = cohorts.find((c) => c.cohort === '2026-01-01');
    const february = cohorts.find((c) => c.cohort === '2026-02-01');
    const november = cohorts.find((c) => c.cohort === '2025-11-01');

    // Views within each video's first 30 days: a 100 (02-10 and 03-20 are
    // older), b 200, c 9000 -> median 200, p25 150, p75 4600, mean 3100.
    expectEqual('jan mature', january?.checkpoints[30]?.matureVideoCount, 3);
    expectEqual('jan median', january?.checkpoints[30]?.medianViews, 200);
    expectEqual('jan p25', january?.checkpoints[30]?.p25Views, 150);
    expectEqual('jan p75', january?.checkpoints[30]?.p75Views, 4600);
    expectEqual('jan mean', january?.checkpoints[30]?.meanViews, 3100);
    // d: 02-04 400 (age 1) + 03-01 100 (age 26) = 500; 03-01 is inside 30.
    expectEqual('feb median', february?.checkpoints[30]?.medianViews, 500);
    // e was uploaded 66 days before the channel's first ingested day
    // (2025-11-01 -> 2026-01-06), longer than the 30-day window: its figure
    // is unknowable, so it is counted as predating ingest, not as a zero.
    expectEqual('nov mature', november?.checkpoints[30]?.matureVideoCount, 0);
    expectEqual(
      'nov predates',
      november?.checkpoints[30]?.predatesIngestCount,
      1,
    );

    return 'jan 200 (n=3) · feb 500 · nov predates ingest';
  });

  await step(
    'assert: daily reach is one row per video-day, by hand',
    async () => {
      const rows = await queryDailyReachForVideos({
        videoIds: ['hand-a', 'hand-b'],
        projectIds: [HAND_PROJECT],
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      });

      // Two reach days were seeded for hand-a and none for hand-b. Each day
      // keeps its own figure (1000 and 400) rather than the period total 1400,
      // and hand-b, with no reach row, is absent rather than zero.
      expectEqual('rows', rows, [
        {
          videoId: 'hand-a',
          date: '2026-01-06',
          impressions: 1000,
          impressionsCtr: 0.5,
        },
        {
          videoId: 'hand-a',
          date: '2026-02-10',
          impressions: 400,
          impressionsCtr: 0.25,
        },
      ]);

      return '1000 on 01-06, 400 on 02-10, hand-b absent';
    },
  );

  await step(
    'assert: the returning-viewer proxy rows are by hand',
    async () => {
      const rows = await queryAudienceRows({
        videoIds: ['hand-a', 'hand-b'],
        projectIds: [HAND_PROJECT],
        dimension: 'follower_status',
      });
      const sum = (key: string) =>
        rows.filter((r) => r.key === key).reduce((n, r) => n + r.views, 0);

      // Subscribed 300 + 50 = 350 of 1200 views: 350 / 1200 = 0.2917. The
      // rows carry counts, so the share is arithmetic over them, never a
      // percentage averaged across videos ((30 + 25) / 2 = 27.5 would be wrong).
      expectEqual('subscribed', sum('subscribed'), 350);
      expectEqual('not subscribed', sum('not_subscribed'), 850);
      expectClose('share', 350 / (350 + 850), 0.291666666);

      return 'subscribed 350 of 1200';
    },
  );

  await step(
    'assert: the subscribed share by upload month is by hand',
    async () => {
      const months = await queryFollowerStatusByUploadMonth({
        videoIds: HAND_VIDEOS.map((video) => video.id),
        projectIds: [HAND_PROJECT],
      });
      const byMonth = Object.fromEntries(months.map((m) => [m.month, m]));

      // 2025-11: hand-e only, uploaded that month, no follower-status row.
      //   1 video, 0 with a split, 0 + 0 views: no denominator, so the
      //   share is unknowable, not 0%.
      expectEqual('nov', byMonth['2025-11-01'], {
        month: '2025-11-01',
        videoCount: 1,
        videosWithSplit: 0,
        subscribedViews: 0,
        notSubscribedViews: 0,
      });
      // 2026-01: hand-a 300/700, hand-b 50/150, hand-c no row.
      //   3 videos, 2 with a split; subscribed 300 + 50 = 350,
      //   not subscribed 700 + 150 = 850; 350 / 1200 = 0.2917.
      expectEqual('jan', byMonth['2026-01-01'], {
        month: '2026-01-01',
        videoCount: 3,
        videosWithSplit: 2,
        subscribedViews: 350,
        notSubscribedViews: 850,
      });
      // 2026-02: hand-d 30/70. 30 / 100 = 0.30.
      expectEqual('feb', byMonth['2026-02-01'], {
        month: '2026-02-01',
        videoCount: 1,
        videosWithSplit: 1,
        subscribedViews: 30,
        notSubscribedViews: 70,
      });
      // December 2025 has no upload, so no row: the helper fills that gap.
      expectEqual(
        'months',
        months.map((m) => m.month),
        ['2025-11-01', '2026-01-01', '2026-02-01'],
      );

      return 'nov none · jan 350/1200 · feb 30/100';
    },
  );

  await step(
    'assert: per-channel watch hours sum to the pooled total',
    async () => {
      const ended = isoDaysAgo(3);
      const early = isoDaysAgo(10);
      const outside = isoDaysAgo(100);

      await insertVideoDims([
        dimFor({
          id: 'ypp-a',
          project: YPP_PROJECT,
          account: YPP_ACCOUNT,
          connection: YPP_CHANNEL,
          published: '2025-01-01',
        }),
        dimFor({
          id: 'ypp-orphan',
          project: YPP_UNATTRIBUTED_PROJECT,
          account: YPP_UNATTRIBUTED_ACCOUNT,
          connection: ZERO_CONNECTION,
          published: '2025-01-01',
        }),
      ]);
      await insertVideoMetrics([
        metricFor({
          project: YPP_PROJECT,
          id: 'ypp-a',
          date: ended,
          views: 10,
          watchTimeSeconds: 3600,
          subscribersGained: 5,
          subscribersLost: 2,
        }),
        metricFor({
          project: YPP_PROJECT,
          id: 'ypp-a',
          date: early,
          views: 10,
          watchTimeSeconds: 1800,
          subscribersGained: 1,
        }),
        metricFor({
          project: YPP_PROJECT,
          id: 'ypp-a',
          date: outside,
          views: 10,
          watchTimeSeconds: 7200,
        }),
        metricFor({
          project: YPP_UNATTRIBUTED_PROJECT,
          id: 'ypp-orphan',
          date: ended,
          views: 1,
          watchTimeSeconds: 600,
        }),
      ]);
      await insertChannelDaily([
        {
          connection_id: YPP_CHANNEL,
          metric_date: ended,
          views: 5,
          watch_time_seconds: 900,
          engaged_views: 0,
          subscribers_gained: 0,
          subscribers_lost: 0,
        },
        {
          connection_id: YPP_CHANNEL,
          metric_date: isoDaysAgo(40),
          views: 5,
          watch_time_seconds: 5000,
          engaged_views: 0,
          subscribers_gained: 0,
          subscribers_lost: 0,
        },
      ]);

      const windowDays = 30;
      const pooledVideos = await queryWatchWindowTotals({
        scope: { accountId: YPP_ACCOUNT, platform: 'youtube' },
        windowDays,
      });
      const channelVideos = await queryWatchWindowTotals({
        scope: {
          accountId: YPP_ACCOUNT,
          connectionId: YPP_CHANNEL,
          platform: 'youtube' as const,
        },
        windowDays,
      });
      const channelOnly = await queryChannelWatchWindow({
        connectionIds: [YPP_CHANNEL],
        windowDays,
      });

      // Inside 30 days: platform videos 3600 + 1800 = 5400 s (the 100-day-old
      // 7200 is outside), net subscribers (5 + 1) - (2 + 0) = 4; the channel's
      // own residual 900 s (the 40-day-old 5000 is outside). A channel is
      // 5400 + 900 = 6300 s = 1.75 h, and with one channel that is the pool.
      expectEqual('video watch seconds', channelVideos.watchTimeSeconds, 5400);
      expectEqual('net subscribers', channelVideos.netSubscribers, 4);
      expectEqual('channel residual', channelOnly.watchTimeSeconds, 900);
      expectEqual(
        'per-channel total',
        channelVideos.watchTimeSeconds + channelOnly.watchTimeSeconds,
        6300,
      );
      expectEqual(
        'pooled video watch equals the one channel',
        pooledVideos.watchTimeSeconds,
        channelVideos.watchTimeSeconds,
      );

      // The known edge (FILM-1602 remaining): a video synced with the zero
      // UUID is in the account's pooled total and in no channel's.
      const orphanPooled = await queryWatchWindowTotals({
        scope: { accountId: YPP_UNATTRIBUTED_ACCOUNT, platform: 'youtube' },
        windowDays,
      });
      const orphanChannel = await queryWatchWindowTotals({
        scope: {
          accountId: YPP_UNATTRIBUTED_ACCOUNT,
          connectionId: YPP_CHANNEL,
          platform: 'youtube' as const,
        },
        windowDays,
      });

      expectEqual('unattributed pooled', orphanPooled.watchTimeSeconds, 600);
      expectEqual(
        'unattributed per channel',
        orphanChannel.watchTimeSeconds,
        0,
      );

      return 'channel 6300 s = pooled 6300 s; unattributed 600 s in the pool only';
    },
  );

  await step('clear: hand-computed fixture', () =>
    clearFixtureRows(projects, connections),
  );
}

const SB_PROJECT = '17150000-0000-4000-8000-000000000001';
const SB_ACCOUNT = '17150000-0000-4000-8000-000000000002';
const SB_CHANNEL = '17150000-0000-4000-8000-000000000003';
const SB_OTHER_CHANNEL = '17150000-0000-4000-8000-000000000004';
const SB_ENGAGED_CHANNEL = '17150000-0000-4000-8000-000000000005';
const SB_NARROWED_CHANNEL = '17150000-0000-4000-8000-000000000006';
const SB_INSTAGRAM_CHANNEL = '17150000-0000-4000-8000-000000000007';

/**
 * The self-benchmark fixture (FILM-1715). Channel C is YouTube, so every
 * `full` upload is `long_horizontal`; the channel's first ingested day is
 * 2026-01-06 (sb-p1's), which is what every ingest lag below is measured
 * from. Figures are views on the day shown.
 *
 * | video          | published         | lang | type  | metric days                     | @30 | @90  |
 * |----------------|-------------------|------|-------|---------------------------------|-----|------|
 * | sb-p1          | 2026-01-05        | en   | full  | 01-06: 100 · 02-20: 5,000       | 100 | 5100 |
 * | sb-p2          | 2026-01-10        | en   | full  | 01-11: 200                      | 200 |  200 |
 * | sb-p3          | 2026-01-15        | en   | full  | 01-16: 300                      | 300 |  300 |
 * | sb-p4          | 2026-01-20        | en   | full  | 01-21: 400                      | 400 |  400 |
 * | sb-p5          | 2026-01-25        | en   | full  | 01-26: 1,000                    | 1000| 1000 |
 * | sb-p6          | 2026-02-01        | es   | full  | 02-02: 600                      | 600 |  600 |
 * | sb-short       | 2026-01-12        | en   | short | 01-13: 50,000 (another family)  |     |      |
 * | sb-elsewhere   | 2026-01-07 (ch D) | en   | full  | 01-08: 99,999 (another channel) |     |      |
 * | sb-late        | 2025-12-01        | en   | full  | none — lag 36, so @30 predates ingest           |
 * | sb-old         | 2023-12-01        | en   | full  | none — predates ingest everywhere               |
 * | sb-subject     | 2026-03-02        | en   | full  | 03-03: 300 · 03-31: 200 · 04-01: 999 | 500 | 1499 |
 * | sb-es-subject  | 2026-03-05        | es   | full  | 03-06: 900                      | 900 |      |
 * | sb-young       | 2026-05-10        | en   | full  | 05-11: 10                       |     |      |
 * | sb-boundary    | 2026-04-30 23:00  | en   | full  | 05-01: 70                       |     |      |
 *
 * `asOf` is 2026-06-01 00:00 unless a step says otherwise.
 */
const SB_VIDEOS: ReadonlyArray<{
  id: string;
  published: string;
  language?: string;
  contentType?: string;
  connection?: string;
  days: Record<string, number>;
}> = [
  {
    id: 'sb-p1',
    published: '2026-01-05 00:00:00',
    days: { '2026-01-06': 100, '2026-02-20': 5000 },
  },
  {
    id: 'sb-p2',
    published: '2026-01-10 00:00:00',
    days: { '2026-01-11': 200 },
  },
  {
    id: 'sb-p3',
    published: '2026-01-15 00:00:00',
    days: { '2026-01-16': 300 },
  },
  {
    id: 'sb-p4',
    published: '2026-01-20 00:00:00',
    days: { '2026-01-21': 400 },
  },
  {
    id: 'sb-p5',
    published: '2026-01-25 00:00:00',
    days: { '2026-01-26': 1000 },
  },
  {
    id: 'sb-p6',
    published: '2026-02-01 00:00:00',
    language: 'es',
    days: { '2026-02-02': 600 },
  },
  {
    id: 'sb-short',
    published: '2026-01-12 00:00:00',
    contentType: 'short',
    days: { '2026-01-13': 50000 },
  },
  {
    id: 'sb-elsewhere',
    published: '2026-01-07 00:00:00',
    connection: SB_OTHER_CHANNEL,
    days: { '2026-01-08': 99999 },
  },
  { id: 'sb-late', published: '2025-12-01 00:00:00', days: {} },
  { id: 'sb-old', published: '2023-12-01 00:00:00', days: {} },
  {
    id: 'sb-subject',
    published: '2026-03-02 00:00:00',
    days: { '2026-03-03': 300, '2026-03-31': 200, '2026-04-01': 999 },
  },
  {
    id: 'sb-es-subject',
    published: '2026-03-05 00:00:00',
    language: 'es',
    days: { '2026-03-06': 900 },
  },
  {
    id: 'sb-young',
    published: '2026-05-10 00:00:00',
    days: { '2026-05-11': 10 },
  },
  {
    id: 'sb-boundary',
    published: '2026-04-30 23:00:00',
    days: { '2026-05-01': 70 },
  },
];

/**
 * Channel E: a range that crosses YouTube's 2026-08-27 views change, where
 * engaged views cover the whole window. Views and engaged views differ on
 * purpose, so reading the wrong series changes every figure.
 *
 * | video     | published  | views | engaged |
 * |-----------|------------|-------|---------|
 * | sb-e1..e5 | 2026-09-01..05 | 1,000 each | 100, 200, 300, 400, 500 |
 * | sb-e-subj | 2027-05-01 | 5,000 | 450 |
 */
const SB_ENGAGED_VIDEOS = [
  { id: 'sb-e1', published: '2026-09-01', views: 1000, engaged: 100 },
  { id: 'sb-e2', published: '2026-09-02', views: 1000, engaged: 200 },
  { id: 'sb-e3', published: '2026-09-03', views: 1000, engaged: 300 },
  { id: 'sb-e4', published: '2026-09-04', views: 1000, engaged: 400 },
  { id: 'sb-e5', published: '2026-09-05', views: 1000, engaged: 500 },
  { id: 'sb-e-subj', published: '2027-05-01', views: 5000, engaged: 450 },
] as const;

/**
 * Channel F: a video published inside 2026-07-29 → 2027-04-24, whose
 * 24-month window (from 2024-09-15) crosses 2026-08-27 and starts before
 * engaged views exist (2025-04-24). By the owner's decision (2026-10-01)
 * the window starts at 2025-04-24 — 16 whole months before 2026-09-15 — so
 * sb-f-old, inside 24 months but before the series, is not a peer.
 *
 * | video     | published  | views  | engaged |
 * |-----------|------------|--------|---------|
 * | sb-f-old  | 2025-01-10 | 99,999 | 99,999  |
 * | sb-f1..f5 | 2025-06-01, 08-01, 10-01, 2026-01-05, 03-01 | 1,000 each | 10, 20, 30, 40, 50 |
 * | sb-f-subj | 2026-09-15 | 5,000  | 45      |
 */
const SB_NARROWED_VIDEOS = [
  { id: 'sb-f-old', published: '2025-01-10', views: 99999, engaged: 99999 },
  { id: 'sb-f1', published: '2025-06-01', views: 1000, engaged: 10 },
  { id: 'sb-f2', published: '2025-08-01', views: 1000, engaged: 20 },
  { id: 'sb-f3', published: '2025-10-01', views: 1000, engaged: 30 },
  { id: 'sb-f4', published: '2026-01-05', views: 1000, engaged: 40 },
  { id: 'sb-f5', published: '2026-03-01', views: 1000, engaged: 50 },
  { id: 'sb-f-subj', published: '2026-09-15', views: 5000, engaged: 45 },
] as const;

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function sbDim(input: {
  id: string;
  published: string;
  connection: string;
  language?: string;
  contentType?: string;
  platform?: AnalyticsPlatform;
}) {
  return {
    video_id: input.id,
    project_id: SB_PROJECT,
    account_id: SB_ACCOUNT,
    episode_id: EPISODE,
    connection_id: input.connection,
    platform: input.platform ?? 'youtube',
    content_type: input.contentType ?? 'full',
    language: input.language ?? 'en',
    channel_language: 'en',
    title: input.id,
    published_at: input.published,
    episode_duration_seconds: 600,
    asset_duration_seconds: null,
    tags: [],
  };
}

function sbMetric(input: {
  id: string;
  date: string;
  views: number;
  engaged?: number;
  platform?: AnalyticsPlatform;
}): VideoMetric {
  return {
    project_id: SB_PROJECT,
    video_id: input.id,
    platform: input.platform ?? 'youtube',
    metric_date: input.date,
    views: input.views,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents: 0,
    subscribers_gained: 0,
    subscribers_lost: 0,
    metric_source: 'analytics_api',
    engaged_views: input.engaged ?? null,
    extra_metrics: '{}',
  };
}

/**
 * Every figure below is worked out by hand from the tables above, never read
 * back from the query. quantileExactInclusive interpolates at (n − 1)·p.
 */
async function selfBenchmarkSteps() {
  const channels = [
    SB_CHANNEL,
    SB_OTHER_CHANNEL,
    SB_ENGAGED_CHANNEL,
    SB_NARROWED_CHANNEL,
    SB_INSTAGRAM_CHANNEL,
  ];
  const scope = { projectId: SB_PROJECT };
  const asOf = new Date('2026-06-01T00:00:00Z');

  await step('self-benchmark: seed', async () => {
    await clearFixtureRows([SB_PROJECT], channels);

    await insertVideoDims([
      ...SB_VIDEOS.map((video) =>
        sbDim({
          ...video,
          connection: video.connection ?? SB_CHANNEL,
        }),
      ),
      ...SB_ENGAGED_VIDEOS.map((video) =>
        sbDim({
          id: video.id,
          published: `${video.published} 00:00:00`,
          connection: SB_ENGAGED_CHANNEL,
        }),
      ),
      ...SB_NARROWED_VIDEOS.map((video) =>
        sbDim({
          id: video.id,
          published: `${video.published} 00:00:00`,
          connection: SB_NARROWED_CHANNEL,
        }),
      ),
      sbDim({
        id: 'sb-ig-subj',
        published: '2025-06-01 00:00:00',
        connection: SB_INSTAGRAM_CHANNEL,
        contentType: 'short',
        platform: 'instagram',
      }),
    ]);

    await insertVideoMetrics([
      ...SB_VIDEOS.flatMap((video) =>
        Object.entries(video.days).map(([date, views]) =>
          sbMetric({ id: video.id, date, views }),
        ),
      ),
      ...SB_ENGAGED_VIDEOS.map((video) =>
        sbMetric({
          id: video.id,
          date: nextDay(video.published),
          views: video.views,
          engaged: video.engaged,
        }),
      ),
      ...SB_NARROWED_VIDEOS.map((video) =>
        sbMetric({
          id: video.id,
          date: nextDay(video.published),
          views: video.views,
          engaged: video.engaged,
        }),
      ),
      sbMetric({
        id: 'sb-ig-subj',
        date: '2025-06-02',
        views: 7,
        platform: 'instagram',
      }),
    ]);

    return `${
      SB_VIDEOS.length +
      SB_ENGAGED_VIDEOS.length +
      SB_NARROWED_VIDEOS.length +
      1
    } videos`;
  });

  await step(
    'self-benchmark: a video against its own channel at 30 and 90 days, by hand',
    async () => {
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-subject',
        checkpoints: [30, 90, 180],
        asOf,
      });

      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      const [at30, at90, at180] = result.checkpoints;

      // Peers at 30: p1 100, p2 200, p3 300, p4 400, p5 1000 — same channel
      // (not sb-elsewhere's 99,999), same family (not sb-short's 50,000),
      // same language (not sb-p6), before 03-02. sb-late predates ingest
      // (published 36 days before 2026-01-06). n = 5: median 300, p25 200,
      // p75 400. The video's own @30 is 300 + 200 = 500 (04-01 is day 30).
      // 500 > 400: above; lift 500/300; adjusted 1 + (2/3)·5/(5 + 15).
      expectEqual('30 state', at30?.state, 'directional');
      if (at30?.state !== 'directional') return;
      expectEqual('30 n', at30.n, 5);
      expectEqual('30 median', at30.cohortMedian, 300);
      expectEqual('30 p25/p75', [at30.cohortP25, at30.cohortP75], [200, 400]);
      expectEqual('30 value', at30.value, 500);
      expectEqual('30 band', at30.band, 'above');
      expectClose('30 lift', at30.observedLift, 500 / 300);
      expectClose('30 adjusted', at30.adjustedLift, 1 + (2 / 3) * (5 / 20));
      expectEqual('30 relaxed', at30.relaxedAxes, []);
      expectEqual('30 series', at30.viewsColumn, 'views');

      // At 90: p1 is 100 + 5,000 (02-20 is day 46). sb-late's 36-day lag no
      // longer swallows the window, so it joins — as the zero its ingested
      // days 36..89 hold. [0, 200, 300, 400, 1000, 5100]: n 6, median 350,
      // p25 225, p75 850. The video's own @90 is 300 + 200 + 999 = 1,499.
      expectEqual('90 state', at90?.state, 'directional');
      if (at90?.state !== 'directional') return;
      expectEqual('90 n', at90.n, 6);
      expectEqual('90 median', at90.cohortMedian, 350);
      expectEqual('90 p25/p75', [at90.cohortP25, at90.cohortP75], [225, 850]);
      expectEqual('90 value', at90.value, 1499);
      expectEqual('90 band', at90.band, 'above');

      // 91 days old: @180 is reached on 2026-08-29.
      expectEqual('180', at180, {
        state: 'not_judgable',
        checkpointDays: 180,
        reason: { kind: 'too_young', ageDays: 91, judgableOn: '2026-08-29' },
        viewsColumn: null,
      });

      return '@30 500 vs 300 (n=5) above · @90 1499 vs 350 (n=6) · @180 too young';
    },
  );

  await step(
    'self-benchmark: a thin peer set relaxes window then language, by hand',
    async () => {
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-es-subject',
        checkpoints: [30],
        asOf,
      });

      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      const [at30] = result.checkpoints;

      // es peers: sb-p6 alone, in 24 months and in 48 — n = 1 twice. Across
      // languages: p1..p5, p6 and sb-subject (en, 03-02, @30 500); sb-late
      // and sb-old predate ingest. [100, 200, 300, 400, 500, 600, 1000]:
      // median 400, p25 250, p75 550. 900 is above; lift 2.25.
      expectEqual('state', at30?.state, 'directional');
      if (at30?.state !== 'directional') return;
      expectEqual('relaxed', at30.relaxedAxes, ['window', 'language']);
      expectEqual('n', at30.n, 7);
      expectEqual('median', at30.cohortMedian, 400);
      expectEqual('p25/p75', [at30.cohortP25, at30.cohortP75], [250, 550]);
      expectEqual('band', at30.band, 'above');
      expectClose('lift', at30.observedLift, 2.25);
      expectClose('adjusted', at30.adjustedLift, 1 + 1.25 * (7 / 22));

      return 'n=7 across all languages, 900 vs 400';
    },
  );

  await step(
    'self-benchmark: a video the cohort excludes for ingest lag is suppressed as itself',
    async () => {
      // As a peer: sb-late is old enough for @30 and in sb-subject's window,
      // and is counted as predating ingest rather than as a zero.
      const [cohort] = await queryCohortMedians({
        scope: {
          accountId: SB_ACCOUNT,
          connectionId: SB_CHANNEL,
          formatFamily: 'long_horizontal',
          language: 'en',
        },
        bucket: 'all',
        checkpoints: [30],
        asOf: '2026-06-01 00:00:00',
        publishedFrom: '2024-03-02 00:00:00',
        publishedBefore: '2026-03-02 00:00:00',
      });
      expectEqual('peer side', cohort?.checkpoints[30], {
        medianViews: 300,
        p25Views: 200,
        p75Views: 400,
        meanViews: 400,
        matureVideoCount: 5,
        predatesIngestCount: 1,
      });

      // As the subject: the same rule, from the same channel ingest start.
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-late',
        checkpoints: [30],
        asOf,
      });
      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      expectEqual('subject side', result.checkpoints[0], {
        state: 'not_judgable',
        checkpointDays: 30,
        reason: {
          kind: 'predates_ingest',
          ingestLagDays: 36,
          window: VIEWS_DATA_WINDOWS.youtube,
        },
        viewsColumn: null,
      });

      return 'excluded as a peer (predates 1) and as itself (lag 36)';
    },
  );

  await step(
    'self-benchmark: the subject and its cohort judge maturity alike (KB-152)',
    async () => {
      // sb-boundary went up at 23:00 on 04-30. At 01:00 on 05-30 its @30
      // window (05-01 .. 05-29 plus 04-30) is complete: dateDiff counts 30
      // calendar days, though only 29 days and 2 hours have elapsed.
      const [cohort] = await queryCohortMedians({
        scope: { projectId: SB_PROJECT, connectionId: SB_CHANNEL },
        bucket: 'all',
        checkpoints: [30],
        asOf: '2026-05-30 01:00:00',
        publishedFrom: '2026-04-30 00:00:00',
      });
      // sb-boundary is mature; sb-young (05-10) is not.
      expectEqual(
        'peer side mature',
        cohort?.checkpoints[30]?.matureVideoCount,
        1,
      );

      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-boundary',
        checkpoints: [30],
        asOf: new Date('2026-05-30T01:00:00Z'),
      });
      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      const at30 = result.checkpoints[0];

      // Judgable as itself, against p1..p5 and sb-subject (sb-late
      // predates): [100, 200, 300, 400, 500, 1000], median 350. 70 < p25.
      expectEqual('subject side', at30?.state, 'directional');
      if (at30?.state !== 'directional') return;
      expectEqual('value', at30.value, 70);
      expectEqual('median', at30.cohortMedian, 350);
      expectEqual('band', at30.band, 'below');

      return 'mature on both sides at 29d 2h elapsed';
    },
  );

  await step(
    'self-benchmark: a video one day short is not judged, and says when it will be',
    async () => {
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-young',
        checkpoints: [30],
        asOf,
      });
      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      expectEqual('young', result.checkpoints[0], {
        state: 'not_judgable',
        checkpointDays: 30,
        reason: { kind: 'too_young', ageDays: 22, judgableOn: '2026-06-09' },
        viewsColumn: null,
      });

      return '22 days old, judgable on 2026-06-09';
    },
  );

  await step(
    'self-benchmark: a change no continuous series covers is suppressed with the date',
    async () => {
      // An Instagram Reel at 30 days: 2023-06-01 .. 2025-06-30 crosses
      // Instagram's 2025-04-21 views change, and Instagram has no continuous
      // series to narrow to.
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-ig-subj',
        checkpoints: [30],
        asOf,
      });
      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      expectEqual('family', result.formatFamily, 'short_vertical');
      expectEqual('suppressed', result.checkpoints[0], {
        state: 'not_judgable',
        checkpointDays: 30,
        reason: { kind: 'view_definition_changed', changedOn: '2025-04-21' },
        viewsColumn: null,
      });

      return 'view_definition_changed 2025-04-21';
    },
  );

  await step(
    'self-benchmark: across 2026-08-27 the window narrows to engaged views, by hand',
    async () => {
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-f-subj',
        checkpoints: [30],
        asOf: new Date('2026-11-01T00:00:00Z'),
      });
      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      const at30 = result.checkpoints[0];

      // Peers from 2025-04-24: f1..f5, engaged [10, 20, 30, 40, 50] —
      // median 30, p25 20, p75 40. sb-f-old (2025-01-10, 99,999) is inside
      // 24 months but before the series, so it is not a peer. The video's
      // own engaged figure, 45, is above; lift 1.5. 2025-04-24 → 2026-09-15
      // is 16 whole months.
      expectEqual('state', at30?.state, 'directional');
      if (at30?.state !== 'directional') return;
      expectEqual('series', at30.viewsColumn, 'engaged_views');
      expectEqual('n', at30.n, 5);
      expectEqual('median', at30.cohortMedian, 30);
      expectEqual('p25/p75', [at30.cohortP25, at30.cohortP75], [20, 40]);
      expectEqual('value', at30.value, 45);
      expectEqual('band', at30.band, 'above');
      expectClose('lift', at30.observedLift, 1.5);
      expectEqual('relaxed', at30.relaxedAxes, []);
      expectEqual('window', at30.peerWindow, {
        months: 16,
        defaultMonths: 24,
        narrowed: {
          reason: 'view_definition_changed',
          changedOn: '2026-08-27',
          continuousFrom: '2025-04-24',
        },
      });

      return '16 of 24 months: engaged 45 vs 30 (n=5)';
    },
  );

  await step(
    'self-benchmark: across 2026-08-27 it reads engaged views on both sides, by hand',
    async () => {
      const result = await queryVideoBenchmark({
        scope,
        videoId: 'sb-e-subj',
        checkpoints: [30],
        asOf: new Date('2027-06-15T00:00:00Z'),
      });
      if (!result?.ok) throw new Error(`not ok: ${JSON.stringify(result)}`);
      const at30 = result.checkpoints[0];

      // Engaged: [100, 200, 300, 400, 500], median 300, p25 200, p75 400;
      // the video's 450 is above, lift 1.5. On `views` it would be 5,000
      // against 1,000.
      expectEqual('state', at30?.state, 'directional');
      if (at30?.state !== 'directional') return;
      expectEqual('series', at30.viewsColumn, 'engaged_views');
      expectEqual('value', at30.value, 450);
      expectEqual('median', at30.cohortMedian, 300);
      expectEqual('band', at30.band, 'above');
      expectClose('lift', at30.observedLift, 1.5);

      return 'engaged 450 vs 300';
    },
  );

  await step('self-benchmark: cleanup', () =>
    clearFixtureRows([SB_PROJECT], channels),
  );
}

const COVER_PROJECT = '17041704-1704-4704-8704-170417041704';
const COVER_ACCOUNT = '17041704-1704-4704-8704-170417041705';
const COVER_OTHER_PROJECT = '17041704-1704-4704-8704-170417041706';
const COVER_YT = '17041704-1704-4704-8704-170417041707';
const COVER_TT = '17041704-1704-4704-8704-170417041708';
/** channel_daily rows for a connection no video in scope was published to. */
const COVER_ORPHAN = '17041704-1704-4704-8704-170417041709';

/** Removes the coverage fixture from every table it writes. */
async function clearCoverageFixture(): Promise<void> {
  const client = getClickHouseClient();

  for (const table of [
    'video_dim',
    'video_metrics',
    'video_traffic_sources',
    'video_reach_daily',
    'video_retention_curves',
  ]) {
    for (const project of [COVER_PROJECT, COVER_OTHER_PROJECT]) {
      await client.command({
        query: `ALTER TABLE ${table} DELETE WHERE project_id = {project:UUID}`,
        query_params: { project },
        clickhouse_settings: { mutations_sync: '2' },
      });
    }
  }

  for (const connection of [COVER_YT, COVER_TT, COVER_ORPHAN]) {
    await client.command({
      query:
        'ALTER TABLE channel_daily DELETE WHERE connection_id = {connection:UUID}',
      query_params: { connection },
      clickhouse_settings: { mutations_sync: '2' },
    });
  }
}

/**
 * Observed coverage (FILM-1704 §7) against a fixture whose answer is worked
 * out by hand, for the window 2026-03-01..2026-03-31:
 *
 * | table                  | rows in scope and window                       | expected        |
 * |------------------------|------------------------------------------------|-----------------|
 * | video_metrics          | cov-yt-1 03-02 + 03-10 (reporting_api),        | youtube 3,      |
 * |                        | cov-yt-2 03-05 (analytics_api); 01-15 outside; | latest 03-10    |
 * |                        | cov-tt-1 01-20 only (outside)                  | no tiktok row   |
 * | video_traffic_sources  | cov-yt-1 03-29 × 2 sources; cov-yt-2 02-28 out | youtube 2, 03-29|
 * | video_reach_daily      | cov-yt-2 03-31 (inclusive edge)                | youtube 1, 03-31|
 * | video_retention_curves | cov-yt-1 3 points, not windowed                | youtube 3, today|
 * | channel_daily          | COVER_YT 03-03 + 03-04, 02-01 outside;         | youtube 2, 03-04|
 * |                        | COVER_ORPHAN 03-03 (no video in scope)         | not read        |
 *
 * And under another project, a `video_metrics` row for the same video id in
 * the window, which must not count. Only there: `video_dim` is keyed on
 * `video_id` alone, so a second dim row for it would replace the first. Folded with YouTube and TikTok connected, the one set of
 * rows must produce every state at once.
 */
async function observedCoverageSteps() {
  const window = { from: '2026-03-01', to: '2026-03-31' };

  await step('seed: observed coverage fixture', async () => {
    await clearCoverageFixture();

    await insertVideoDims([
      ...['cov-yt-1', 'cov-yt-2'].map((id) =>
        dimFor({
          id,
          project: COVER_PROJECT,
          account: COVER_ACCOUNT,
          connection: COVER_YT,
          published: '2026-01-01',
        }),
      ),
      {
        ...dimFor({
          id: 'cov-tt-1',
          project: COVER_PROJECT,
          account: COVER_ACCOUNT,
          connection: COVER_TT,
          published: '2026-01-01',
        }),
        platform: 'tiktok',
      },
    ]);

    const metric = (
      project: string,
      id: string,
      date: string,
      source: 'reporting_api' | 'analytics_api',
    ) => ({
      ...metricFor({ project, id, date, views: 1 }),
      metric_source: source,
    });

    await insertVideoMetrics([
      metric(COVER_PROJECT, 'cov-yt-1', '2026-03-02', 'reporting_api'),
      metric(COVER_PROJECT, 'cov-yt-1', '2026-03-10', 'reporting_api'),
      metric(COVER_PROJECT, 'cov-yt-2', '2026-03-05', 'analytics_api'),
      metric(COVER_PROJECT, 'cov-yt-1', '2026-01-15', 'reporting_api'),
      {
        ...metricFor({
          project: COVER_PROJECT,
          id: 'cov-tt-1',
          date: '2026-01-20',
          views: 1,
        }),
        platform: 'tiktok' as const,
        metric_source: 'snapshot_delta' as const,
      },
      metric(COVER_OTHER_PROJECT, 'cov-yt-1', '2026-03-03', 'reporting_api'),
    ]);

    const traffic = (id: string, date: string, source: string) => ({
      project_id: COVER_PROJECT,
      video_id: id,
      platform: 'youtube' as const,
      metric_date: date,
      source,
      views: 1,
      watch_time_minutes: 0,
    });

    await insertVideoTrafficSources([
      traffic('cov-yt-1', '2026-03-29', 'YT_SEARCH'),
      traffic('cov-yt-1', '2026-03-29', 'SUBSCRIBER'),
      traffic('cov-yt-2', '2026-02-28', 'YT_SEARCH'),
    ]);

    await insertVideoReachDaily([
      {
        project_id: COVER_PROJECT,
        video_id: 'cov-yt-2',
        platform: 'youtube' as const,
        metric_date: '2026-03-31',
        impressions: 10,
        impressions_ctr: 0.1,
      },
    ]);

    await insertRetentionCurves(
      [0, 0.5, 1].map((elapsed_ratio) => ({
        project_id: COVER_PROJECT,
        video_id: 'cov-yt-1',
        platform: 'youtube' as const,
        elapsed_ratio,
        audience_watch_ratio: 1 - elapsed_ratio / 2,
      })),
    );

    const day = (connection_id: string, metric_date: string) => ({
      connection_id,
      metric_date,
      views: 1,
      watch_time_seconds: 0,
      engaged_views: 0,
      subscribers_gained: 0,
      subscribers_lost: 0,
    });

    await insertChannelDaily([
      day(COVER_YT, '2026-03-03'),
      day(COVER_YT, '2026-03-04'),
      day(COVER_YT, '2026-02-01'),
      day(COVER_ORPHAN, '2026-03-03'),
    ]);
  });

  await step(
    'assert: observed coverage counts each table in scope and window (FILM-1704)',
    async () => {
      const client = getClickHouseClient();
      const todayResult = await client.query({
        query: 'SELECT toString(today()) AS today',
        format: 'JSONEachRow',
      });
      const serverToday = (await todayResult.json<{ today: string }>())[0]!
        .today;

      const rows = await queryObservedCoverage(
        { projectId: COVER_PROJECT },
        window.from,
        window.to,
      );

      if (rows === null) throw new Error('ClickHouse is on; expected rows');

      const actual = rows
        .map((row) => ({
          ...row,
          metricSources: [...row.metricSources].sort(),
        }))
        .sort((a, b) =>
          `${a.table}:${a.platform}`.localeCompare(`${b.table}:${b.platform}`),
        );

      expectEqual('observed rows', actual, [
        {
          table: 'channel_daily',
          platform: 'youtube',
          rows: 2,
          latestDate: '2026-03-04',
          metricSources: [],
        },
        {
          table: 'video_metrics',
          platform: 'youtube',
          rows: 3,
          latestDate: '2026-03-10',
          metricSources: ['analytics_api', 'reporting_api'],
        },
        {
          table: 'video_reach_daily',
          platform: 'youtube',
          rows: 1,
          latestDate: '2026-03-31',
          metricSources: [],
        },
        {
          table: 'video_retention_curves',
          platform: 'youtube',
          rows: 3,
          latestDate: serverToday,
          metricSources: [],
        },
        {
          table: 'video_traffic_sources',
          platform: 'youtube',
          rows: 2,
          latestDate: '2026-03-29',
          metricSources: [],
        },
      ]);

      return `${rows.length} (table, platform) rows, as hand-computed`;
    },
  );

  await step(
    'assert: one fixture folds to every coverage state at once (FILM-1704 §7)',
    async () => {
      const rows = await queryObservedCoverage(
        { projectId: COVER_PROJECT },
        window.from,
        window.to,
      );
      const matrix = foldObservedCoverage(rows, CAPABILITY_MATRIX, {
        connectedPlatforms: ['youtube', 'tiktok'],
        asOf: coverageAsOf(window.to, new Date().toISOString().slice(0, 10)),
      });

      expectEqual('YouTube traffic sources', matrix.traffic_sources.youtube, {
        kind: 'covered',
        rows: 2,
        latestDate: '2026-03-29',
        stale: false,
      });
      expectEqual(
        'TikTok traffic sources',
        matrix.traffic_sources.tiktok?.kind,
        'not_ingested',
      );
      expectEqual(
        'Instagram traffic sources',
        matrix.traffic_sources.instagram?.kind,
        'unsupported',
      );
      expectEqual('TikTok engagement', matrix.engagement.tiktok, {
        kind: 'no_data_in_window',
      });
      expectEqual('Instagram engagement', matrix.engagement.instagram, {
        kind: 'not_connected',
      });
      // 03-10 is 21 days before the window's end: past the threshold.
      expectEqual('YouTube engagement', matrix.engagement.youtube, {
        kind: 'covered',
        rows: 3,
        latestDate: '2026-03-10',
        stale: true,
      });

      return 'covered · not_ingested · unsupported · no_data_in_window · not_connected';
    },
  );

  await step(
    'assert: a platform filter narrows observed coverage to that platform',
    async () => {
      const rows = await queryObservedCoverage(
        { projectId: COVER_PROJECT, platform: 'tiktok' },
        '2026-01-01',
        window.to,
      );

      expectEqual(
        'tiktok-only rows',
        (rows ?? []).map((row) => `${row.table}:${row.platform}:${row.rows}`),
        ['video_metrics:tiktok:1'],
      );

      return rows;
    },
  );

  await step('clear: observed coverage fixture', clearCoverageFixture);
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
  await formatFamilySteps();
  await selfBenchmarkSteps();
  await handComputedSteps();
  await observedCoverageSteps();
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
