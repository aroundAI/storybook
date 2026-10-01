import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => mockClickHouseClient),
}));

interface QueryCall {
  query: string;
  query_params: Record<string, unknown>;
}

const mockQueryResult = { json: vi.fn() };

const mockClickHouseClient = {
  insert: vi.fn(),
  query: vi.fn((_args: QueryCall) => Promise.resolve(mockQueryResult)),
  ping: vi.fn(() => Promise.resolve({ success: true })),
  close: vi.fn(),
  command: vi.fn(),
};

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';

/**
 * FILM-1704 §2: one statement, `UNION ALL` over the five fact tables, no
 * `FINAL`, scoped like every other dim-joined read. What the SQL returns is
 * checked against a real server in `scripts/verify-queries.ts`; this pins
 * the shape a mocked client can see.
 */
describe('queryObservedCoverage', () => {
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

  async function run() {
    const { queryObservedCoverage } = await import('../src/queries-advanced');

    const rows = await queryObservedCoverage(
      { projectId: PROJECT },
      '2026-09-01',
      '2026-09-30',
    );

    return { rows, calls: mockClickHouseClient.query.mock.calls };
  }

  it('asks once for the whole page', async () => {
    const { calls } = await run();

    expect(calls).toHaveLength(1);
  });

  it('unions all five fact tables in that one statement', async () => {
    const { calls } = await run();
    const query = calls[0]![0].query;

    for (const table of [
      'video_metrics',
      'video_traffic_sources',
      'video_reach_daily',
      'video_retention_curves',
      'channel_daily',
    ]) {
      expect(query).toMatch(new RegExp(`FROM ${table}\\b`));
    }
    expect(query.match(/UNION ALL/g)).toHaveLength(4);
  });

  it('avoids FINAL: coverage asks whether rows exist, not the deduplicated total', async () => {
    const { calls } = await run();

    expect(calls[0]![0].query).not.toMatch(/\bFINAL\b/);
  });

  it('binds the window and the scope rather than splicing them', async () => {
    const { calls } = await run();
    const { query, query_params } = calls[0]![0];

    expect(query_params).toMatchObject({
      coverageFrom: '2026-09-01',
      coverageTo: '2026-09-30',
      scopeProjectId: PROJECT,
    });
    expect(query).not.toContain('2026-09-01');
    expect(query).toContain('project_id IN (SELECT project_id FROM video_dim');
  });

  it('resolves channel_daily to a platform through the connection, never a literal', async () => {
    const { calls } = await run();
    const query = calls[0]![0].query;
    const channelBranch = query.slice(query.indexOf("'channel_daily'"));

    expect(channelBranch).toMatch(/JOIN/);
    expect(channelBranch).toContain('connection_id');
    expect(channelBranch).not.toMatch(/'youtube'/);
  });

  it('maps rows, numbers and all', async () => {
    mockQueryResult.json.mockResolvedValue([
      {
        source_table: 'video_metrics',
        platform: 'youtube',
        row_count: '300',
        latest_date: '2026-09-28',
        metric_sources: ['reporting_api'],
      },
      {
        source_table: 'channel_daily',
        platform: '',
        row_count: '5',
        latest_date: '2026-09-29',
        metric_sources: [],
      },
    ]);

    const { rows } = await run();

    expect(rows).toEqual([
      {
        table: 'video_metrics',
        platform: 'youtube',
        rows: 300,
        latestDate: '2026-09-28',
        metricSources: ['reporting_api'],
      },
      // An unresolved connection comes back as null, not as a guess.
      {
        table: 'channel_daily',
        platform: null,
        rows: 5,
        latestDate: '2026-09-29',
        metricSources: [],
      },
    ]);
  });

  it('refuses an unscoped read', async () => {
    const { queryObservedCoverage } = await import('../src/queries-advanced');

    await expect(
      queryObservedCoverage({}, '2026-09-01', '2026-09-30'),
    ).rejects.toThrow(/requires projectId or accountId/);
  });

  it('returns null — cannot measure — when ClickHouse is off, never an empty list', async () => {
    process.env.CLICKHOUSE_ENABLED = 'false';

    const { rows, calls } = await run();

    expect(rows).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
