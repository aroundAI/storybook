import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unwrap } from '@kit/next/action-result';

import {
  addManualRevenueAction,
  deleteManualRevenueAction,
  getRevenueProjectionAction,
} from '../src/server/revenue-actions';

/**
 * KB-23 and KB-24, at the action boundary.
 *
 * `revenue_records` is modelled as an in-memory table that applies the
 * filters the actions send, so "a € entry, then a $ entry" plays out the way
 * it would against Postgres: the lookup that decides insert-or-replace sees
 * exactly the rows its filters admit. The unique index itself is pgTAP's
 * (`revenue-records-currency-key.test.sql`).
 */

type Row = Record<string, unknown> & { id: string };

const table: { rows: Row[]; nextId: number } = { rows: [], nextId: 1 };

const ranges: Array<{ from: string; to: string }> = [];
let streamed: Array<{ record_date: string; currency: string; cents: number }> =
  [];

vi.mock('@kit/next/actions', () => ({
  // The real schema runs, so defaults and upper-casing apply as they do in
  // production.
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: async () => new Map(),
}));

vi.mock('../src/server/revenue-queries', () => ({
  forEachAccountRevenueRow: async (
    _client: unknown,
    _accountId: string,
    from: string,
    to: string,
    onRow: (row: unknown) => void,
  ) => {
    ranges.push({ from, to });

    for (const row of streamed) {
      if (row.record_date < from || row.record_date > to) continue;

      onRow({
        record_date: row.record_date,
        amount: { currency: row.currency, cents: row.cents },
      });
    }
  },
}));

type Filter = (row: Row) => boolean;

/** A PostgREST-shaped builder over `table.rows`, for the calls these actions make. */
function query(op: 'select' | 'delete' | 'update', payload?: Row) {
  const filters: Filter[] = [];

  const matched = () =>
    table.rows.filter((row) => filters.every((f) => f(row)));

  const run = () => {
    const rows = matched();

    if (op === 'delete') {
      table.rows = table.rows.filter((row) => !rows.includes(row));
    }

    if (op === 'update') {
      for (const row of rows) Object.assign(row, payload);
    }

    return rows;
  };

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    is: (column: string, value: null) => {
      filters.push((row) => (row[column] ?? null) === value);
      return builder;
    },
    maybeSingle: async () => {
      const rows = run();

      return rows.length > 1
        ? { data: null, error: { message: 'multiple rows' } }
        : { data: rows[0] ?? null, error: null };
    },
    then: (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      select: () => query('select'),
      delete: () => query('delete'),
      update: (payload: Row) => query('update', payload),
      insert: (payload: Row) => ({
        select: () => ({
          single: async () => {
            const row = {
              ...payload,
              id: `r${table.nextId++}`,
              created_at: '2026-09-24T00:00:00Z',
              updated_at: '2026-09-24T00:00:00Z',
            };
            table.rows.push(row);
            return { data: row, error: null };
          },
        }),
      }),
    }),
  }),
}));

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function entry(currency: string, revenueCents: number) {
  return {
    accountId: ACCOUNT,
    date: '2026-09-24',
    revenueCents,
    currency,
    category: 'sponsorship' as const,
  };
}

beforeEach(() => {
  table.rows = [];
  table.nextId = 1;
  ranges.length = 0;
  streamed = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addManualRevenueAction (KB-23)', () => {
  it('keeps a euro entry when a dollar entry follows it on the same day and category', async () => {
    await addManualRevenueAction(entry('EUR', 5000));
    await addManualRevenueAction(entry('USD', 10000));

    expect(
      table.rows.map(({ currency, revenue_cents }) => ({
        currency,
        revenue_cents,
      })),
    ).toEqual([
      { currency: 'EUR', revenue_cents: 5000 },
      { currency: 'USD', revenue_cents: 10000 },
    ]);
  });

  it('still replaces an entry in the same currency, and says it replaced one', async () => {
    const first = await addManualRevenueAction(entry('EUR', 5000));
    const second = await addManualRevenueAction(entry('EUR', 6000));

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.revenue_cents).toBe(6000);
    expect(first).toMatchObject({ ok: true, replaced: false });
    expect(second).toMatchObject({ ok: true, replaced: true });
  });

  it('matches a lower-case currency to the stored upper-case one', async () => {
    await addManualRevenueAction(entry('EUR', 5000));
    await addManualRevenueAction(entry('eur', 7000));

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({
      currency: 'EUR',
      revenue_cents: 7000,
    });
  });
});

describe('deleteManualRevenueAction (KB-23)', () => {
  it('deletes only the named currency when one is given', async () => {
    await addManualRevenueAction(entry('EUR', 5000));
    await addManualRevenueAction(entry('USD', 10000));

    const result = await deleteManualRevenueAction({
      accountId: ACCOUNT,
      date: '2026-09-24',
      category: 'sponsorship',
      currency: 'usd',
    });

    expect(result).toEqual({ success: true });
    expect(table.rows.map((row) => row.currency)).toEqual(['EUR']);
  });

  it('without a currency, deletes every currency for the date and category', async () => {
    await addManualRevenueAction(entry('EUR', 5000));
    await addManualRevenueAction(entry('USD', 10000));

    await deleteManualRevenueAction({
      accountId: ACCOUNT,
      date: '2026-09-24',
      category: 'sponsorship',
    });

    expect(table.rows).toEqual([]);
  });
});

describe('getRevenueProjectionAction (KB-24)', () => {
  // 22:00 UTC on the 24th is 03:30 on the 25th in Kolkata.
  const LATE_UTC = new Date('2026-09-24T22:00:00Z');

  it("ends the window at the caller's local date, so an entry saved today counts", async () => {
    vi.useFakeTimers({ now: LATE_UTC, toFake: ['Date'] });
    streamed = [{ record_date: '2026-09-25', currency: 'EUR', cents: 5000 }];

    const [projection] = await unwrap(
      getRevenueProjectionAction({
        accountId: ACCOUNT,
        asOf: '2026-09-25',
      }),
    );

    expect(ranges).toEqual([{ from: '2026-08-26', to: '2026-09-25' }]);
    // 5000 on one day × 30.
    expect(projection).toMatchObject({
      currency: 'EUR',
      estimatedMonthlyRevenueCents: 150000,
      basedOnDays: 1,
    });
  });

  it('splits the trend halves on calendar dates, not on the hour the server happens to run', async () => {
    // 01:00 UTC. The split used to be "now minus 15 days" as an instant —
    // 9 Sep 01:00 UTC here — so a row dated 9 Sep (midnight UTC) fell in
    // the first half at this hour and the second half later in the day.
    vi.useFakeTimers({
      now: new Date('2026-09-24T01:00:00Z'),
      toFake: ['Date'],
    });
    // Window 25 Aug–24 Sep; halves 25 Aug–8 Sep and 9–24 Sep.
    streamed = [
      { record_date: '2026-09-08', currency: 'USD', cents: 1000 },
      { record_date: '2026-09-09', currency: 'USD', cents: 2000 },
    ];

    const [projection] = await unwrap(
      getRevenueProjectionAction({
        accountId: ACCOUNT,
        asOf: '2026-09-24',
      }),
    );

    // Second half 2000 against first half 1000: +100% × 50 = +50.
    expect(
      projection!.factors.find((f) => f.factor !== 'Historical Data')?.impact,
    ).toBe(50);
  });

  it("falls back to the server's UTC date for a date that cannot be today anywhere", async () => {
    vi.useFakeTimers({ now: LATE_UTC, toFake: ['Date'] });

    await unwrap(
      getRevenueProjectionAction({
        accountId: ACCOUNT,
        asOf: '2026-10-30',
      }),
    );

    expect(ranges).toEqual([{ from: '2026-08-25', to: '2026-09-24' }]);
  });

  it("uses the server's UTC date when the caller sends none", async () => {
    vi.useFakeTimers({ now: LATE_UTC, toFake: ['Date'] });

    await unwrap(getRevenueProjectionAction({ accountId: ACCOUNT }));

    expect(ranges).toEqual([{ from: '2026-08-25', to: '2026-09-24' }]);
  });
});
