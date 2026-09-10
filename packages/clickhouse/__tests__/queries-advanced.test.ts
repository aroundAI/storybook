import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => mockClickHouseClient),
}));

const mockQueryResult = {
  json: vi.fn(),
};

/**
 * The shape these tests read back off the mock. Declaring it on the mock
 * function — rather than casting at each read site — is what makes
 * `query.mock.calls[0][0]` typed: an untyped `vi.fn(() => …)` has no
 * parameters, so its `calls` are empty tuples and every index is `never`.
 */
interface QueryCall {
  query: string;
  query_params: Record<string, unknown>;
}

const mockClickHouseClient = {
  insert: vi.fn(),
  query: vi.fn((_args: QueryCall) => Promise.resolve(mockQueryResult)),
  ping: vi.fn(() => Promise.resolve({ success: true })),
  close: vi.fn(),
  command: vi.fn(),
};

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const CHANNEL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function lastQuery(): QueryCall {
  const calls = mockClickHouseClient.query.mock.calls;
  const last = calls[calls.length - 1];

  if (!last) {
    throw new Error('no ClickHouse query was issued');
  }

  return last[0];
}

function makeAgeRow(videoId: string, publishedAt: string) {
  return {
    video_id: videoId,
    title: videoId,
    published_at: publishedAt,
    connection_id: CHANNEL,
    platform: 'youtube',
    content_type: 'full',
    language: 'en',
    views_at_30: 1,
    lifetime_views: 1,
    first_metric_date: '2026-01-02',
    metric_days: 1,
  };
}

describe('queries-advanced', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockQueryResult.json.mockResolvedValue([]);

    process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
    process.env.CLICKHOUSE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_ENABLED;
  });

  describe('scope guard', () => {
    it('rejects unscoped queries to prevent full table scans', async () => {
      const { queryCohortMedians } = await import('../src/queries-advanced');

      await expect(queryCohortMedians({ scope: {} })).rejects.toThrow(
        /requires projectId or accountId/,
      );
    });

    it('accepts an account-scoped query', async () => {
      const { queryCohortMedians } = await import('../src/queries-advanced');

      await expect(
        queryCohortMedians({ scope: { accountId: PROJECT } }),
      ).resolves.toEqual([]);
    });
  });

  describe('queryMedianViewsPerVideo', () => {
    it('buckets by upload period and uses exact quantiles in cohort mode', async () => {
      mockQueryResult.json.mockResolvedValue([
        {
          bucket: '2026-06-01',
          video_count: '5',
          median_views: '1200',
          p25_views: '800',
          p75_views: '3000',
          mean_views: '2400',
        },
      ]);

      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      const rows = await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT },
        bucket: 'month',
        mode: 'cohort_views_to_date',
      });

      expect(rows[0]).toEqual({
        bucket: '2026-06-01',
        videoCount: 5,
        medianViews: 1200,
        p25Views: 800,
        p75Views: 3000,
        meanViews: 2400,
      });

      const { query, query_params } = lastQuery();
      expect(query).toContain('quantileExact(0.5)');
      // cohort mode buckets by the video's publish date, not the metric date
      expect(query).toContain('toStartOfMonth(d.published_at)');
      expect(query_params.scopeProjectId).toBe(PROJECT);
    });

    it('buckets by calendar period in views_in_period mode', async () => {
      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT },
        bucket: 'quarter',
        mode: 'views_in_period',
      });

      const { query } = lastQuery();
      expect(query).toContain('toStartOfQuarter(metric_date)');
    });
  });

  describe('queryRollingViews', () => {
    it('uses a day-filled window of windowDays-1 preceding rows', async () => {
      const { queryRollingViews } = await import('../src/queries-advanced');

      await queryRollingViews({
        scope: { projectId: PROJECT },
        windowDays: 90,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      const { query, query_params } = lastQuery();
      // Interpolated rather than bound: ClickHouse 24.x rejects a
      // parameter in a window frame, which only showed up when the suite
      // started executing SQL against a real server.
      expect(query).toContain('ROWS BETWEEN 89 PRECEDING AND CURRENT ROW');
      expect(query_params.windowPreceding).toBeUndefined();
      expect(query).toContain('WITH FILL');
      expect(query).toContain('ROWS BETWEEN');
    });
  });

  describe('queryTrafficSourceBreakdown', () => {
    it('buckets by the requested granularity and groups by raw source', async () => {
      mockQueryResult.json.mockResolvedValue([]);

      const { queryTrafficSourceBreakdown } = await import(
        '../src/queries-advanced'
      );

      await queryTrafficSourceBreakdown({
        scope: { projectId: PROJECT },
        bucket: 'month',
      });

      const query = lastQuery().query;

      expect(query).toContain('toStartOfMonth(metric_date)');
      expect(query).toContain('GROUP BY bucket, source');
      // The taxonomy must not reach SQL, or changing it becomes a migration.
      expect(query).not.toContain('browse_suggested');
    });

    it('returns every group per bucket with shares over one denominator', async () => {
      mockQueryResult.json.mockResolvedValue([
        {
          bucket: '2026-06-01',
          source: 'RELATED_VIDEO',
          views: '600',
          watch_time_minutes: '60',
        },
        {
          bucket: '2026-06-01',
          source: 'YT_SEARCH',
          views: '300',
          watch_time_minutes: '30',
        },
        {
          bucket: '2026-06-01',
          source: 'TS_91',
          views: '100',
          watch_time_minutes: '10',
        },
      ]);

      const { queryTrafficSourceBreakdown } = await import(
        '../src/queries-advanced'
      );

      const buckets = await queryTrafficSourceBreakdown({
        scope: { projectId: PROJECT },
        bucket: 'week',
      });

      expect(buckets[0]!.totalViews).toBe(1000);
      expect(buckets[0]!.groups).toHaveLength(8);
      expect(
        buckets[0]!.groups.reduce((sum, g) => sum + g.share, 0),
      ).toBeCloseTo(1, 10);
      // The unrecognised code is counted, not dropped.
      expect(buckets[0]!.groups.find((g) => g.group === 'other')!.views).toBe(
        100,
      );
    });

    it('bucket cannot inject SQL', async () => {
      mockQueryResult.json.mockResolvedValue([]);

      const { queryTrafficSourceBreakdown } = await import(
        '../src/queries-advanced'
      );

      await queryTrafficSourceBreakdown({
        scope: { projectId: PROJECT },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bucket: "day'; DROP TABLE video_traffic_sources; --" as any,
      });

      const query = lastQuery().query;

      // Absence of the payload is necessary but not sufficient: without a
      // fallback the lookup yields undefined, which interpolates as the
      // literal "undefined" and produces a query ClickHouse rejects with
      // "Unknown function undefined". Assert the query is executable, not
      // merely that it is not an injection.
      expect(query).not.toContain('DROP TABLE');
      expect(query).not.toContain('undefined(');
      expect(query).toContain('toStartOfWeek(metric_date)');
    });

    it('does not resolve a bucket up the prototype chain', async () => {
      mockQueryResult.json.mockResolvedValue([]);

      const { queryTrafficSourceBreakdown } = await import(
        '../src/queries-advanced'
      );

      for (const bucket of ['constructor', 'toString', 'valueOf']) {
        await queryTrafficSourceBreakdown({
          scope: { projectId: PROJECT },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          bucket: bucket as any,
        });

        const query = lastQuery().query;

        // A bare index would return Object.prototype.constructor here — a
        // truthy function that skips a `??` fallback and interpolates its
        // own body into the SQL.
        expect(query).not.toContain('native code');
        expect(query).not.toContain('function');
        expect(query).toContain('toStartOfWeek(metric_date)');
      }
    });

    it('returns nothing when ClickHouse is disabled', async () => {
      process.env.CLICKHOUSE_ENABLED = 'false';

      const { queryTrafficSourceBreakdown } = await import(
        '../src/queries-advanced'
      );

      await expect(
        queryTrafficSourceBreakdown({
          scope: { projectId: PROJECT },
          bucket: 'week',
        }),
      ).resolves.toEqual([]);
    });
  });

  describe('queryBackCatalogShare', () => {
    it('splits views by video age against the metric date', async () => {
      mockQueryResult.json.mockResolvedValue([
        { bucket: '2026-06-01', total_views: '2000', back_views: '1500' },
      ]);

      const { queryBackCatalogShare } = await import('../src/queries-advanced');

      const rows = await queryBackCatalogShare({
        scope: { projectId: PROJECT },
        ageDays: 90,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      expect(rows[0]!.share).toBeCloseTo(0.75, 6);

      const { query, query_params } = lastQuery();
      expect(query).toContain("dateDiff('day', d.published_at");
      expect(query_params.ageDays).toBe(90);
    });
  });

  describe('queryVideoViewsAtAge (FILM-1603)', () => {
    const load = async () =>
      (await import('../src/queries-advanced')).queryVideoViewsAtAge;

    it('bounds each checkpoint with < N, not <= N', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        checkpoints: [30],
      });

      // Days 0..29 count toward @30d. The off-by-one is invisible in the
      // UI, so it is pinned here rather than left to inspection.
      expect(lastQuery().query).toContain(
        "dateDiff('day', d.published_at, toDateTime(m.metric_date)) < 30",
      );
      expect(lastQuery().query).not.toContain('<= 30)');
    });

    it('de-duplicates checkpoints so the generated aliases stay unique', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        checkpoints: [90, 30, 30],
      });

      const { query } = lastQuery();
      expect(query.match(/as views_at_30\b/g)).toHaveLength(1);
      expect(query.match(/as views_at_90\b/g)).toHaveLength(1);
    });

    it('LEFT JOINs so videos with no metrics stay in the log', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({ scope: { projectId: PROJECT } });

      // An inner join would drop zero-view videos and shorten every
      // denominator derived from this list — the FILM-1601 defect.
      expect(lastQuery().query).toContain('LEFT JOIN video_daily_stats');
    });

    it('scopes the metrics join by project as well as video', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({ scope: { projectId: PROJECT } });

      expect(lastQuery().query).toContain(
        'ON m.video_id = d.video_id AND m.project_id = d.project_id',
      );
    });

    it('always paginates, and clamps an oversized limit', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({ scope: { projectId: PROJECT } });
      expect(lastQuery().query).toContain('LIMIT 200 OFFSET 0');

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        limit: 99999,
      });
      expect(lastQuery().query).toContain('LIMIT 1000');
    });

    it('rejects an unknown orderBy instead of interpolating it', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        // A caller-supplied identifier reaches SQL by interpolation, since
        // ClickHouse cannot bind one as a parameter — so it is whitelisted.
        orderBy: 'published_at; DROP TABLE video_dim' as never,
      });

      const { query } = lastQuery();
      expect(query).not.toContain('DROP TABLE');
      expect(query).toContain('ORDER BY published_at DESC');
    });

    it('binds the published-date filters as parameters', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        publishedFrom: '2026-01-01 00:00:00',
        publishedTo: '2026-06-01 00:00:00',
      });

      const { query, query_params } = lastQuery();
      expect(query).toContain('published_at >= {publishedFrom: DateTime}');
      expect(query_params.publishedFrom).toBe('2026-01-01 00:00:00');
      expect(query_params.publishedTo).toBe('2026-06-01 00:00:00');
    });

    it('widens a bare date to cover the whole day', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        publishedFrom: '2026-01-01',
        publishedTo: '2026-06-01',
      });

      // The parameter is declared DateTime, so a bare date would lean on
      // coercion — and an unwidened upper bound would cut off everything
      // published after midnight on its own last day.
      const { query_params } = lastQuery();
      expect(query_params.publishedFrom).toBe('2026-01-01 00:00:00');
      expect(query_params.publishedTo).toBe('2026-06-01 23:59:59');
    });

    it('marks an immature checkpoint and reports ingest lag', async () => {
      const queryVideoViewsAtAge = await load();

      mockQueryResult.json.mockResolvedValue([
        {
          video_id: 'v1',
          title: 'A video',
          published_at: '2026-05-15 00:00:00',
          connection_id: CHANNEL,
          platform: 'youtube',
          content_type: 'full',
          language: 'en',
          views_at_30: 10,
          views_at_90: 10,
          lifetime_views: 10,
          first_metric_date: '2026-05-16',
          metric_days: 3,
        },
      ]);

      const [row] = await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        checkpoints: [30, 90],
        now: new Date('2026-06-20T00:00:00Z'),
      });

      // 36 days old: @30d has elapsed, @90d has not.
      expect(row!.matureAt).toEqual({ 30: true, 90: false });
      expect(row!.ingestLagDays).toBe(1);
      expect(row!.viewsAtAge[30]).toBe(10);
    });

    it('counts metric days in a way an unmatched join cannot fake', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({ scope: { projectId: PROJECT } });

      // join_use_nulls defaults to 0 and is not overridden, so an unmatched
      // LEFT JOIN row is filled with each column's *default* — '' and
      // 1970-01-01, not NULL. count() counts non-NULLs, so it would return
      // 1 for a video with no rows at all and "nothing ingested" would be
      // unreachable. countIf against the filler date is genuinely zero.
      const { query } = lastQuery();
      expect(query).toContain('countIf(m.metric_date > toDate(0))');
      expect(query).not.toContain('count(m.video_id)');
    });

    it('orders by SELECT aliases so the sort key is a grouping key', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({ scope: { projectId: PROJECT } });

      // `published_at` is selected as toString(d.published_at) and GROUP BY
      // resolves the bare name to that alias. Ordering by the raw
      // d.published_at would be neither grouped nor aggregated, which
      // ClickHouse rejects — and this is the default order, so it would
      // have broken every call.
      const { query } = lastQuery();
      expect(query).toContain('ORDER BY published_at DESC');
      expect(query).not.toContain('ORDER BY d.published_at');
    });

    it('breaks ordering ties on video_id so pages cannot overlap', async () => {
      const queryVideoViewsAtAge = await load();

      await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        orderBy: 'lifetime_views',
      });

      // Every zero-view video ties on lifetime_views, and ties have no
      // stable order across separate queries — so without a unique
      // tiebreaker a reader paging the log sees one video twice and misses
      // another. Same discipline fetchAllRows enforces for PostgREST.
      expect(lastQuery().query).toContain(
        'ORDER BY lifetime_views DESC, video_id ASC',
      );
    });

    it('distinguishes "nothing ingested" from "no views"', async () => {
      const queryVideoViewsAtAge = await load();

      // metric_days is what separates the two cases; countIf makes zero
      // reachable for a video with no matching rows.
      mockQueryResult.json.mockResolvedValue([
        {
          video_id: 'v2',
          title: 'Never ingested',
          published_at: '2026-01-01 00:00:00',
          connection_id: CHANNEL,
          platform: 'youtube',
          content_type: 'full',
          language: 'en',
          views_at_30: 0,
          lifetime_views: 0,
          first_metric_date: '1970-01-01',
          metric_days: 0,
        },
      ]);

      const [row] = await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        checkpoints: [30],
        now: new Date('2026-06-20T00:00:00Z'),
      });

      expect(row!.firstMetricDate).toBeNull();
      expect(row!.ingestLagDays).toBeNull();
      expect(row!.lifetimeViews).toBe(0);
    });

    it('re-sorts globally when the id list spans several chunks', async () => {
      const queryVideoViewsAtAge = await load();

      // Each chunk is ordered by the server independently, so concatenating
      // them leaves the array sorted only within each block. Two chunks
      // whose ranges interleave would come back out of order.
      const ids = Array.from({ length: 1500 }, (_, i) => `v${i}`);

      let call = 0;
      mockQueryResult.json.mockImplementation(() => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? [makeAgeRow('a', '2026-01-01 00:00:00')]
            : [makeAgeRow('b', '2026-06-01 00:00:00')],
        );
      });

      const rows = await queryVideoViewsAtAge({
        scope: { projectId: PROJECT },
        videoIds: ids,
        checkpoints: [30],
      });

      // Newest first: the second chunk's row must sort ahead of the first's.
      expect(rows.map((r) => r.videoId)).toEqual(['b', 'a']);
    });

    it('requires a project or account scope', async () => {
      const queryVideoViewsAtAge = await load();

      await expect(
        queryVideoViewsAtAge({ scope: { connectionId: CHANNEL } }),
      ).rejects.toThrow(/requires projectId or accountId/);
    });
  });

  describe('channel dimension (FILM-1602)', () => {
    it('filters by connection_id when a channel is scoped', async () => {
      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT, connectionId: CHANNEL },
        bucket: 'month',
        mode: 'cohort_views_to_date',
      });

      const { query, query_params } = lastQuery();
      expect(query).toContain('connection_id = {scopeConnectionId: UUID}');
      expect(query_params.scopeConnectionId).toBe(CHANNEL);
      // The channel narrows an existing scope rather than replacing it
      expect(query_params.scopeProjectId).toBe(PROJECT);
    });

    it('omits the channel condition when none is given', async () => {
      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT },
        bucket: 'month',
        mode: 'cohort_views_to_date',
      });

      // Asserts the absence of the *filter*, not of the identifier: the dim
      // subquery projects connection_id as a column for every query since
      // FILM-1603, so a bare substring check would pass vacuously.
      const { query, query_params } = lastQuery();
      expect(query).not.toContain('connection_id = {scopeConnectionId: UUID}');
      expect(query_params.scopeConnectionId).toBeUndefined();
    });

    it('still requires a project or account, not a channel alone', async () => {
      const { queryCohortMedians } = await import('../src/queries-advanced');

      await expect(
        queryCohortMedians({ scope: { connectionId: CHANNEL } }),
      ).rejects.toThrow(/requires projectId or accountId/);
    });

    it('scopes channel watch time to the given connections only', async () => {
      const { queryChannelWatchWindow } = await import(
        '../src/queries-advanced'
      );

      await queryChannelWatchWindow({
        connectionIds: [CHANNEL],
        windowDays: 365,
      });

      const { query, query_params } = lastQuery();
      expect(query).toContain('connection_id IN {connectionIds:');
      expect(query_params.connectionIds).toEqual([CHANNEL]);
    });
  });

  describe('dim scope filtering', () => {
    it('filters inside a subquery so aliases cannot shadow filter columns', async () => {
      const { queryCohortMedians } = await import('../src/queries-advanced');

      await queryCohortMedians({
        scope: { projectId: PROJECT, platform: 'youtube' },
      });

      // Every projected column is aliased to its own name, and several are
      // also filter columns. A WHERE alongside the argMax resolves the bare
      // name to the *aggregate*, and ClickHouse rejects the whole query:
      // "Aggregate function argMax(...) is found in WHERE". Verified
      // against a real ClickHouse — the mocked suite cannot catch it.
      const { query } = lastQuery();
      expect(query).toContain('FROM (SELECT * FROM video_dim WHERE');
      expect(query).not.toMatch(/argMax[\s\S]*?\n\s*FROM video_dim\n\s*WHERE/);
    });
  });

  describe('FILM-1601 correctness fixes', () => {
    it('counts cohort videos from the dimension side, not metric rows', async () => {
      const { queryCohortMedians } = await import('../src/queries-advanced');

      await queryCohortMedians({ scope: { projectId: PROJECT } });

      const { query } = lastQuery();
      // Counting distinct video_id on the metrics side drops published
      // videos that have no ingested days, inflating views-per-video.
      //
      // FILM-1604 restructured this into a per-video subquery, so the
      // guarantee now holds by construction rather than by DISTINCT: the
      // inner GROUP BY yields exactly one row per dimension video, and the
      // outer count() counts those rows.
      expect(query).toContain('GROUP BY video_id, published_at');
      expect(query).toContain('count() as video_count');
      expect(query).not.toContain('count(DISTINCT m.video_id)');
      expect(query).toContain('LEFT JOIN video_daily_stats');
    });

    it('bounds cohort_views_to_date by upload date, not metric date', async () => {
      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT },
        bucket: 'month',
        mode: 'cohort_views_to_date',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      const { query } = lastQuery();
      // Each selected upload contributes its full views-to-date; bounding
      // the metric days instead silently truncates older buckets.
      expect(query).toContain('d.published_at >= {startDate: Date}');
      expect(query).toContain('d.published_at <= {endDate: Date}');
      expect(query).not.toContain('AND metric_date >= {startDate: Date}');
    });

    it('still bounds views_in_period by metric date', async () => {
      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT },
        bucket: 'month',
        mode: 'views_in_period',
        startDate: '2026-01-01',
      });

      expect(lastQuery().query).toContain('metric_date >= {startDate: Date}');
    });

    it('derives net subscribers from the gross columns', async () => {
      const { queryWatchWindowTotals } = await import(
        '../src/queries-advanced'
      );

      await queryWatchWindowTotals({
        scope: { accountId: PROJECT },
        windowDays: 365,
      });

      expect(lastQuery().query).toContain(
        'sum(subscribers_gained) - sum(subscribers_lost)',
      );
    });
  });

  describe('queryCohortMedians (FILM-1604)', () => {
    const load = async () =>
      (await import('../src/queries-advanced')).queryCohortMedians;

    it('returns the distribution per checkpoint, with its mature count', async () => {
      mockQueryResult.json.mockResolvedValue([
        {
          cohort: '2026-01-01',
          video_count: '9',
          median_30: '1200',
          p25_30: '800',
          p75_30: '3000',
          mean_30: '2400.4',
          mature_count_30: '9',
          predates_ingest_count_30: '0',
          median_90: '2600',
          p25_90: '1500',
          p75_90: '5000',
          mean_90: '3100',
          mature_count_90: '4',
          predates_ingest_count_90: '3',
        },
      ]);

      const rows = await (
        await load()
      )({
        scope: { projectId: PROJECT },
        checkpoints: [30, 90],
      });

      expect(rows[0]!.cohort).toBe('2026-01-01');
      expect(rows[0]!.videoCount).toBe(9);
      expect(rows[0]!.checkpoints[30]).toEqual({
        medianViews: 1200,
        p25Views: 800,
        p75Views: 3000,
        meanViews: 2400,
        matureVideoCount: 9,
        predatesIngestCount: 0,
      });
      // Fewer videos have reached 90 days than 30 — the count travels with
      // the figure precisely so a reader can see that.
      expect(rows[0]!.checkpoints[90]!.matureVideoCount).toBe(4);
      // Three more are old enough but predate ingest, so they are excluded
      // from the figures and reported separately rather than counted as
      // zeroes that would drag the median down.
      expect(rows[0]!.checkpoints[90]!.predatesIngestCount).toBe(3);
    });

    it('de-duplicates checkpoints so the generated aliases stay unique', async () => {
      // The action's schema permits [30, 30]; a repeated alias makes
      // ClickHouse reject the whole query, so this 500s on valid input.
      await (
        await load()
      )({
        scope: { projectId: PROJECT },
        checkpoints: [30, 30, 90],
      });

      const { query } = lastQuery();
      expect(query.match(/as median_30\b/g)).toHaveLength(1);
      expect(query.match(/as v_30\b/g)).toHaveLength(1);
      expect(query.match(/as median_90\b/g)).toHaveLength(1);
    });

    it('filters each checkpoint by the video own age, not the cohort start', async () => {
      await (
        await load()
      )({
        scope: { projectId: PROJECT },
        checkpoints: [30],
      });

      // This is the correctness win of the phase: a quarter spans ~90 days,
      // so judging maturity from the cohort's start lets a video published
      // yesterday drag down its cohort's 30-day figure.
      const { query } = lastQuery();
      expect(query).toContain(
        'quantileExactIf(0.5)(v_30, age_days >= 30 AND ingest_lag_days < 30) as median_30',
      );
      expect(query).toContain(
        'countIf(age_days >= 30 AND ingest_lag_days < 30) as mature_count_30',
      );
    });

    it('excludes a checkpoint whose window closed before ingest began', async () => {
      await (
        await load()
      )({
        scope: { projectId: PROJECT },
        checkpoints: [30],
      });

      const { query } = lastQuery();

      // Such a video's sum is unknowable, not low — the Reporting API
      // backfills only ~30 days from job creation, so the rows do not
      // exist and never will. Counted as zero it drags the median down,
      // and because it still satisfies age_days >= N it also inflates the
      // mature count, so the growth gate stops firing on exactly the
      // cohorts it exists to protect. Excluded from both.
      expect(query).toContain('ingest_lag_days < 30');
      expect(query).toContain(
        'countIf(age_days >= 30 AND ingest_lag_days >= 30) as predates_ingest_count_30',
      );
    });

    it('derives the ingest floor per channel, not per video', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });

      const { query } = lastQuery();

      // A video with no rows on a well-ingested channel is a real zero and
      // must keep counting as one, so the floor comes from the channel.
      expect(query).toContain('GROUP BY d.connection_id');
      expect(query).toContain(
        'LEFT JOIN ingest i ON i.connection_id = d.connection_id',
      );
    });

    it('still LEFT JOINs, so a zero-view video on an ingested channel counts', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });

      // The original decision survives the exclusion: dropping genuine
      // zeroes would inflate the median by removing the worst performers.
      expect(lastQuery().query).toContain('LEFT JOIN video_daily_stats');
    });

    it('scopes the metrics join by project as well as video', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });

      // video_id is the platform's id, not a per-tenant key, and
      // video_daily_stats spans every tenant — so the same YouTube video
      // tracked under two projects would have both projects' rows summed
      // into it.
      expect(lastQuery().query).toContain(
        'ON m.video_id = d.video_id AND m.project_id = d.project_id',
      );
    });

    it('aggregates per video first, so the median is over videos', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });

      // A cohort-level SUM divided by video count is a mean; a median needs
      // one row per video to take the quantile over.
      const { query } = lastQuery();
      expect(query).toContain('GROUP BY video_id, published_at');
      expect(query).toContain(') per_video');
    });

    it('uses exact quantiles, not approximate ones', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });

      // Cohorts are small; an approximate quantile would return a different
      // number run to run.
      expect(lastQuery().query).toContain('quantileExactIf');
      expect(lastQuery().query).not.toContain('quantileIf(');
    });

    it('LEFT JOINs so a video with no metrics counts as a zero', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });

      // Dropping it would inflate the median by removing the worst
      // performers.
      expect(lastQuery().query).toContain('LEFT JOIN video_daily_stats');
    });

    it('buckets by quarter by default and by month on request', async () => {
      await (
        await load()
      )({ scope: { projectId: PROJECT } });
      expect(lastQuery().query).toContain('toStartOfQuarter(published_at)');

      await (
        await load()
      )({ scope: { projectId: PROJECT }, bucket: 'month' });
      expect(lastQuery().query).toContain('toStartOfMonth(published_at)');
    });

    it('binds asOf so a call is reproducible', async () => {
      await (
        await load()
      )({
        scope: { projectId: PROJECT },
        asOf: '2026-06-01 00:00:00',
      });

      const { query, query_params } = lastQuery();
      expect(query).toContain(
        "dateDiff('day', d.published_at, {asOf: DateTime})",
      );
      expect(query_params.asOf).toBe('2026-06-01 00:00:00');
    });
  });

  describe('queryMedianByTag', () => {
    it('filters to one dimension and enforces a minimum sample', async () => {
      const { queryMedianByTag } = await import('../src/queries-advanced');

      await queryMedianByTag({
        scope: { accountId: PROJECT },
        dimension: 'topic',
        minVideos: 5,
      });

      const { query, query_params } = lastQuery();
      expect(query).toContain('arrayJoin(tags)');
      expect(query).toContain('HAVING video_count >=');
      expect(query_params.tagPrefix).toBe('topic:%');
      expect(query_params.minVideos).toBe(5);
    });
  });

  describe('disabled ClickHouse', () => {
    it('returns empty results instead of querying', async () => {
      process.env.CLICKHOUSE_ENABLED = 'false';

      const { queryMedianViewsPerVideo } = await import(
        '../src/queries-advanced'
      );

      const rows = await queryMedianViewsPerVideo({
        scope: { projectId: PROJECT },
        bucket: 'month',
        mode: 'cohort_views_to_date',
      });

      expect(rows).toEqual([]);
      expect(mockClickHouseClient.query).not.toHaveBeenCalled();
    });
  });
});
