import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteGeneratedReportAction,
  generateReportAction,
  getGeneratedReportDownloadAction,
  listGeneratedReportsAction,
} from '../src/server/report-actions';

/**
 * FILM-809. Every generated report leaves a history row written with the
 * caller's own client, so RLS decides whose it is; the row must never take
 * the download away when it fails to save; and a history row can be listed,
 * re-downloaded through a new signed link, and deleted with its file.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';
const ROW = '33333333-3333-4333-8333-333333333333';
const PUBLISH = '44444444-4444-4444-8444-444444444444';

interface State {
  inserted: Array<Record<string, unknown>>;
  insertError: { message: string } | null;
  historyRows: Array<Record<string, unknown>>;
  rangeCalls: Array<[number, number]>;
  storagePath: string | null;
  removed: string[];
  removeError: { message: string } | null;
  deleteRows: Array<{ id: string }>;
  signed: string[];
  logged: string[];
}

const state: State = {
  inserted: [],
  insertError: null,
  historyRows: [],
  rangeCalls: [],
  storagePath: null,
  removed: [],
  removeError: null,
  deleteRows: [],
  signed: [],
  logged: [],
};

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: USER }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    error: (_ctx: unknown, message: string) => state.logged.push(message),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: async () =>
    new Map([
      [
        PUBLISH,
        {
          views: 10,
          likes: 1,
          comments: 0,
          shares: 0,
          watch_time_seconds: 5,
          subscribers_gained: 0,
          revenue_cents: 0,
          measured: { watch_time_seconds: true, subscribers_gained: false },
        },
      ],
    ]),
  queryQualityMetricsForVideos: async () => new Map(),
  queryRetentionCurve: async () => [],
}));

function publishesChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'eq', 'order']) {
    chain[method] = () => chain;
  }
  chain.range = async (from: number) => ({
    data:
      from > 0
        ? []
        : [
            {
              id: PUBLISH,
              platform: 'youtube',
              title: 'Pilot',
              episodes: { title: 'Ep 1', projects: { name: 'Show' } },
            },
          ],
    error: null,
  });
  return chain;
}

function historyChain() {
  const chain: Record<string, unknown> = {};
  chain.insert = async (row: Record<string, unknown>) => {
    state.inserted.push(row);
    return { error: state.insertError };
  };
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async (from: number, to: number) => {
    state.rangeCalls.push([from, to]);
    return { data: state.historyRows.slice(from, to + 1), error: null };
  };
  chain.maybeSingle = async () => ({
    data: state.storagePath ? { storage_path: state.storagePath } : null,
    error: null,
  });
  chain.delete = () => ({
    eq: () => ({
      select: async () => ({ data: state.deleteRows, error: null }),
    }),
  });
  return chain;
}

const client = {
  from: (table: string) =>
    table === 'publishes' ? publishesChain() : historyChain(),
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async (path: string) => {
        state.signed.push(path);
        return { data: { signedUrl: `https://signed/${path}` }, error: null };
      },
      remove: async (paths: string[]) => {
        state.removed.push(...paths);
        return { error: state.removeError };
      },
    }),
  },
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => client,
}));

const csvRequest = {
  accountId: ACCOUNT,
  config: {
    type: 'csv' as const,
    dateRange: {
      start: new Date('2026-09-01T00:00:00Z'),
      end: new Date('2026-09-30T00:00:00Z'),
      preset: 'custom' as const,
    },
    metrics: ['views' as const],
    platforms: ['youtube' as const],
  },
};

beforeEach(() => {
  state.inserted = [];
  state.insertError = null;
  state.historyRows = [];
  state.rangeCalls = [];
  state.storagePath = null;
  state.removed = [];
  state.removeError = null;
  state.deleteRows = [];
  state.signed = [];
  state.logged = [];
});

describe('generateReportAction records history', () => {
  it('inserts a row naming the file, range, count and caller after the upload', async () => {
    const result = await generateReportAction(csvRequest);

    expect(result.ok).toBe(true);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      account_id: ACCOUNT,
      created_by: USER,
      report_type: 'csv',
      file_name: 'analytics-report-2026-09-01.csv',
      date_range_start: '2026-09-01',
      date_range_end: '2026-09-30',
      record_count: 1,
      config: { metrics: ['views'], platforms: ['youtube'] },
    });
    expect(state.inserted[0]!.storage_path).toMatch(
      new RegExp(`^exports/${ACCOUNT}/\\d+-analytics-report-2026-09-01\\.csv$`),
    );
  });

  it('still returns the download when the history row cannot be saved', async () => {
    state.insertError = { message: 'permission denied' };

    const result = await generateReportAction(csvRequest);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.downloadUrl).toContain('https://signed/');
    expect(state.logged).toEqual([
      'Report was generated but its history row was not saved',
    ]);
  });
});

describe('listGeneratedReportsAction', () => {
  const row = (n: number) => ({
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    report_type: 'csv',
    file_name: `r${n}.csv`,
    date_range_start: '2026-09-01',
    date_range_end: '2026-09-30',
    record_count: n,
    created_at: '2026-09-30T10:00:00Z',
  });

  it('pages: one page of the limit, and says whether more follow', async () => {
    state.historyRows = [row(1), row(2), row(3)];

    const result = await listGeneratedReportsAction({
      accountId: ACCOUNT,
      limit: 2,
      offset: 0,
    });

    expect(state.rangeCalls).toEqual([[0, 2]]);
    expect(result).toMatchObject({
      ok: true,
      data: { hasMore: true },
    });
    if (result.ok) {
      expect(result.data.reports.map((r) => r.fileName)).toEqual([
        'r1.csv',
        'r2.csv',
      ]);
    }
  });

  it('says there is no more on the last page', async () => {
    state.historyRows = [row(1)];

    const result = await listGeneratedReportsAction({
      accountId: ACCOUNT,
      limit: 10,
      offset: 0,
    });

    expect(result).toMatchObject({ ok: true, data: { hasMore: false } });
  });

  it('refuses a limit past the cap', async () => {
    await expect(
      listGeneratedReportsAction({ accountId: ACCOUNT, limit: 500, offset: 0 }),
    ).rejects.toThrow();
  });
});

describe('getGeneratedReportDownloadAction', () => {
  it('signs a new link for a row the caller can read', async () => {
    state.storagePath = `exports/${ACCOUNT}/1-r.csv`;

    const result = await getGeneratedReportDownloadAction({ id: ROW });

    expect(state.signed).toEqual([`exports/${ACCOUNT}/1-r.csv`]);
    expect(result).toMatchObject({
      ok: true,
      data: { downloadUrl: `https://signed/exports/${ACCOUNT}/1-r.csv` },
    });
  });

  it('refuses, and signs nothing, for a row RLS hides', async () => {
    const result = await getGeneratedReportDownloadAction({ id: ROW });

    expect(result).toEqual({
      ok: false,
      error: 'That report is not in your history.',
    });
    expect(state.signed).toEqual([]);
  });
});

describe('deleteGeneratedReportAction', () => {
  it('removes the file, then the row', async () => {
    state.storagePath = `exports/${ACCOUNT}/1-r.csv`;
    state.deleteRows = [{ id: ROW }];

    const result = await deleteGeneratedReportAction({ id: ROW });

    expect(result).toEqual({ ok: true, data: { success: true } });
    expect(state.removed).toEqual([`exports/${ACCOUNT}/1-r.csv`]);
  });

  it('refuses a row the caller cannot see, touching no file', async () => {
    const result = await deleteGeneratedReportAction({ id: ROW });

    expect(result.ok).toBe(false);
    expect(state.removed).toEqual([]);
  });

  it('refuses when the delete matched no row', async () => {
    state.storagePath = `exports/${ACCOUNT}/1-r.csv`;
    state.deleteRows = [];

    const result = await deleteGeneratedReportAction({ id: ROW });

    expect(result).toEqual({ ok: false, error: "That report wasn't deleted." });
  });
});
