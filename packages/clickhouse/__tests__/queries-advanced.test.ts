import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => mockClickHouseClient),
}));

const mockQueryResult = {
  json: vi.fn(),
};

const mockClickHouseClient = {
  insert: vi.fn(),
  query: vi.fn(() => Promise.resolve(mockQueryResult)),
  ping: vi.fn(() => Promise.resolve({ success: true })),
  close: vi.fn(),
  command: vi.fn(),
};

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';

function lastQuery(): { query: string; query_params: Record<string, unknown> } {
  const calls = mockClickHouseClient.query.mock.calls;
  return calls[calls.length - 1]![0] as {
    query: string;
    query_params: Record<string, unknown>;
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
      const { queryCohortCurves } = await import('../src/queries-advanced');

      await expect(queryCohortCurves({ scope: {} })).rejects.toThrow(
        /requires projectId or accountId/,
      );
    });

    it('accepts an account-scoped query', async () => {
      const { queryCohortCurves } = await import('../src/queries-advanced');

      await expect(
        queryCohortCurves({ scope: { accountId: PROJECT } }),
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
      expect(query_params.windowPreceding).toBe(89);
      expect(query).toContain('WITH FILL');
      expect(query).toContain('ROWS BETWEEN');
    });
  });

  describe('queryTrafficShareTrend', () => {
    it('computes Browse+Suggested share per bucket', async () => {
      mockQueryResult.json.mockResolvedValue([
        { bucket: '2026-06-01', total_views: '1000', browse_views: '650' },
      ]);

      const { queryTrafficShareTrend } = await import(
        '../src/queries-advanced'
      );

      const rows = await queryTrafficShareTrend({
        scope: { projectId: PROJECT },
        bucket: 'week',
      });

      expect(rows[0]!.share).toBeCloseTo(0.65, 6);
      expect(lastQuery().query_params.browseSources).toContain('RELATED_VIDEO');
    });

    it('returns zero share rather than dividing by zero', async () => {
      mockQueryResult.json.mockResolvedValue([
        { bucket: '2026-06-01', total_views: '0', browse_views: '0' },
      ]);

      const { queryTrafficShareTrend } = await import(
        '../src/queries-advanced'
      );

      const rows = await queryTrafficShareTrend({
        scope: { projectId: PROJECT },
        bucket: 'month',
      });

      expect(rows[0]!.share).toBe(0);
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

  describe('FILM-1601 correctness fixes', () => {
    it('counts cohort videos from the dimension side, not metric rows', async () => {
      const { queryCohortCurves } = await import('../src/queries-advanced');

      await queryCohortCurves({ scope: { projectId: PROJECT } });

      const { query } = lastQuery();
      // Counting distinct video_id on the metrics side drops published
      // videos that have no ingested days, inflating views-per-video.
      expect(query).toContain('count(DISTINCT d.video_id)');
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

  describe('queryCohortCurves', () => {
    it('returns per-checkpoint cumulative views per cohort', async () => {
      mockQueryResult.json.mockResolvedValue([
        {
          cohort: '2026-01-01',
          video_count: '4',
          views_at_30: '4000',
          views_at_90: '9000',
        },
      ]);

      const { queryCohortCurves } = await import('../src/queries-advanced');

      const rows = await queryCohortCurves({
        scope: { projectId: PROJECT },
        checkpoints: [30, 90],
      });

      expect(rows[0]).toEqual({
        cohort: '2026-01-01',
        videoCount: 4,
        viewsAtCheckpoint: { 30: 4000, 90: 9000 },
      });

      expect(lastQuery().query).toContain('toStartOfQuarter(d.published_at)');
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
