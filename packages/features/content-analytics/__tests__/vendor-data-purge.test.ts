import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-22 part B: the purge job's bookkeeping. The SQL each half runs is
 * tested where it can be seen — `vendor-data-purges.test.sql` (pgTAP) and
 * `verify:purge` (a real ClickHouse). This covers what those cannot: which
 * queue rows the job takes, how it records a result, a failure and a
 * breach, and that with ClickHouse off it says so rather than claiming a
 * deletion.
 */

vi.mock('server-only', () => ({}));

const clickhouse = vi.hoisted(() => ({
  isClickHouseEnabled: vi.fn(() => true),
  purgeConnectionFromClickHouse: vi.fn(),
  queryConnectionVideoIds: vi.fn(),
}));

vi.mock('@kit/clickhouse/server', () => clickhouse);

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({ getLogger: async () => logger }));

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  queue: [] as Array<Record<string, unknown>>,
  overdue: [] as Array<Record<string, unknown>>,
  publishes: [] as Array<{ id: string }>,
  rpc: vi.fn(),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const filters: Call[] = [];
      let mode = 'select';

      const builder = {
        select: () => builder,
        is: (...args: unknown[]) => {
          filters.push({ table, op: 'is', args });
          return builder;
        },
        lte: (...args: unknown[]) => {
          filters.push({ table, op: 'lte', args });
          return builder;
        },
        lt: (...args: unknown[]) => {
          filters.push({ table, op: 'lt', args });
          return builder;
        },
        eq: (...args: unknown[]) => {
          filters.push({ table, op: 'eq', args });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        range: async (from: number, to: number) => ({
          data: state.publishes.slice(from, to + 1),
          error: null,
        }),
        update: (values: unknown) => {
          mode = 'update';
          state.calls.push({ table, op: 'update', args: [values] });
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (mode === 'update') return resolve({ data: null, error: null });

          const overdueRead = filters.some((f) => f.op === 'lt');

          return resolve({
            data: overdueRead ? state.overdue : state.queue,
            error: null,
          });
        },
      };

      return builder;
    },
  }),
}));

const PURGE = {
  id: 'purge-1',
  connection_id: 'conn-a',
  platform: 'youtube',
  reason: 'in_app_disconnect',
  due_by: '2026-09-30T00:00:00Z',
  attempts: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.queue = [PURGE];
  state.overdue = [];
  state.publishes = [{ id: 'pub-1' }];
  state.rpc.mockResolvedValue({
    data: {
      revenue_records_api: 1,
      youtube_report_jobs: 1,
      publishes_reset: 1,
    },
    error: null,
  });
  clickhouse.isClickHouseEnabled.mockReturnValue(true);
  clickhouse.queryConnectionVideoIds.mockResolvedValue(['pub-1', 'pub-2']);
  clickhouse.purgeConnectionFromClickHouse.mockResolvedValue({
    deleted: { video_metrics: 4 },
    absent: [],
  });
});

async function run() {
  const { runVendorDataPurges } = await import(
    '../src/server/vendor-data-purge'
  );

  return runVendorDataPurges({ now: new Date('2026-09-23T12:00:00Z') });
}

function updatesOf() {
  return state.calls
    .filter(
      (call) => call.table === 'vendor_data_purges' && call.op === 'update',
    )
    .map((call) => call.args[0] as Record<string, unknown>);
}

describe('runVendorDataPurges', () => {
  it('purges both halves and records the result as done', async () => {
    const result = await run();

    expect(result).toEqual({
      processed: 1,
      completed: 1,
      failed: 0,
      overdue: 0,
    });
    expect(state.rpc).toHaveBeenCalledWith('purge_connection_vendor_rows', {
      p_connection_id: 'conn-a',
    });

    const done = updatesOf().find((update) => 'completed_at' in update);

    expect(done?.result).toEqual({
      postgres: {
        revenue_records_api: 1,
        youtube_report_jobs: 1,
        publishes_reset: 1,
      },
      clickhouse: {
        status: 'deleted',
        deleted: { video_metrics: 4 },
        absent: [],
      },
    });
  });

  it('deletes by Postgres publish ids and video_dim ids together', async () => {
    await run();

    expect(clickhouse.purgeConnectionFromClickHouse).toHaveBeenCalledWith({
      connectionId: 'conn-a',
      videoIds: ['pub-1', 'pub-1', 'pub-2'],
    });
  });

  it('says ClickHouse was off rather than claiming a deletion', async () => {
    clickhouse.isClickHouseEnabled.mockReturnValue(false);

    await run();

    const done = updatesOf().find((update) => 'completed_at' in update);

    expect(done?.result).toMatchObject({ clickhouse: 'disabled' });
    expect(clickhouse.purgeConnectionFromClickHouse).not.toHaveBeenCalled();
  });

  it('records a failure without marking the purge done, so it is retried', async () => {
    clickhouse.purgeConnectionFromClickHouse.mockRejectedValue(
      new Error('video_metrics: 2 of 4 rows remain after the delete'),
    );

    const result = await run();

    expect(result).toMatchObject({ completed: 0, failed: 1 });
    expect(updatesOf().some((update) => 'completed_at' in update)).toBe(false);
    expect(updatesOf()).toContainEqual({
      last_error: 'video_metrics: 2 of 4 rows remain after the delete',
    });
  });

  it('counts an attempt before it starts', async () => {
    await run();

    expect(updatesOf()[0]).toEqual({
      started_at: '2026-09-23T12:00:00.000Z',
      attempts: 1,
    });
  });

  it('logs a purge past its deadline at error — the breach is loud', async () => {
    state.queue = [];
    state.overdue = [{ ...PURGE, due_by: '2026-09-20T00:00:00Z' }];

    const result = await run();

    expect(result.overdue).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'vendor-data-purge.overdue',
        purgeId: 'purge-1',
      }),
      expect.any(String),
    );
  });
});
