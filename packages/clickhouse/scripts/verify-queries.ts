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
  getClickHouseClient,
  insertChannelDaily,
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
  queryDailyStats,
  queryDailyTimeSeries,
  queryDailyTimeSeriesByPlatform,
  queryDataDaysForVideos,
  queryLatestSnapshots,
  queryLatestSubscriberLevels,
  queryMedianViewsPerVideo,
  queryNetSubscribersForVideos,
  queryPerVideoTotals,
  queryPlatformBreakdown,
  queryQualityMetricsForVideos,
  queryRetentionCurve,
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
  queryVideoViewsAtAge,
  queryViewsForVideos,
  queryWatchWindowTotals,
} from '../src/server';

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
        platform: 'youtube',
        metric_date: '2026-01-11',
        impressions: 4000,
        impressions_ctr: 0.05,
        engaged_views: 90,
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
        impressions: 0,
        engaged_views: 0,
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
          engaged_views: 0,
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
  await watchedMetricSteps();
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
