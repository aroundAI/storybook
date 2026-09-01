import { describe, expect, it } from 'vitest';

import { fetchAccountRevenueRows } from '../src/server/revenue-queries';

type Call = [string, ...unknown[]];

/**
 * A chainable stand-in for the PostgREST builder that records every filter
 * applied, so the tests can assert on scoping rather than on returned rows.
 *
 * It honours `.range()` by slicing, which both keeps the pagination loop
 * terminating and lets the tests confirm the reads really are paged.
 */
function createClient(results: Array<{ data: unknown[]; error: unknown }>) {
  // One entry per logical query, reused across that query's pages.
  const queries: Array<{ calls: Call[] }> = [];
  const builders = new Map<number, { calls: Call[] }>();
  let nextIndex = 0;

  return {
    queries,
    from() {
      // fetchAllRows re-invokes the callback per page, so a query keeps its
      // identity (and its recorded filters) across pages.
      const index = nextIndex % results.length;
      const result = results[index] ?? { data: [], error: null };

      const existing = builders.get(index);
      const calls: Call[] = existing?.calls ?? [];

      let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        calls,
        then(resolve: (value: unknown) => unknown) {
          const page = result.error
            ? { data: null, error: result.error }
            : {
                data: result.data.slice(range[0], range[1] + 1),
                error: null,
              };
          return Promise.resolve(page).then(resolve);
        },
      };

      for (const method of [
        'select',
        'is',
        'eq',
        'gte',
        'lte',
        'lt',
        'order',
      ]) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }

      builder.range = (from: number, to: number) => {
        range = [from, to];
        return builder;
      };

      if (!existing) {
        builders.set(index, builder);
        queries.push(builder);
      }

      nextIndex++;
      return builder;
    },
  };
}

const ACCOUNT = 'acct-1';

function filtersOf(calls: Call[]) {
  // String() rather than join(), which renders a null argument as ''.
  return calls.map(([method, ...args]) =>
    [method, ...args.map((arg) => String(arg))].join(' '),
  );
}

describe('fetchAccountRevenueRows', () => {
  it('scopes both halves to the account', async () => {
    const client = createClient([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await fetchAccountRevenueRows(client, ACCOUNT, '2026-01-01', '2026-01-31');

    expect(client.queries).toHaveLength(2);

    const [channelScoped, publishScoped] = client.queries;

    // Channel-level rows carry account_id directly.
    expect(filtersOf(channelScoped!.calls)).toContain('is publish_id null');
    expect(filtersOf(channelScoped!.calls)).toContain(
      `eq account_id ${ACCOUNT}`,
    );

    // Per-video rows have account_id NULL, so they can only be scoped
    // through the publish -> episode -> project chain. A plain
    // `.eq('account_id', ...)` here would silently drop all of them.
    expect(filtersOf(publishScoped!.calls)).toContain(
      `eq publishes.episodes.projects.account_id ${ACCOUNT}`,
    );
    expect(filtersOf(publishScoped!.calls)).not.toContain(
      `eq account_id ${ACCOUNT}`,
    );
  });

  it('never issues an unscoped read', async () => {
    const client = createClient([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await fetchAccountRevenueRows(client, ACCOUNT, '2026-01-01', '2026-01-31');

    // The evaluator runs on the RLS-bypassing admin client, so a query with
    // no account predicate would aggregate every tenant's revenue.
    for (const query of client.queries) {
      const applied = filtersOf(query.calls).join('|');
      expect(applied).toContain(ACCOUNT);
    }
  });

  it('bounds the date range inclusively by default and exclusively on request', async () => {
    const inclusive = createClient([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await fetchAccountRevenueRows(
      inclusive,
      ACCOUNT,
      '2026-01-01',
      '2026-01-31',
    );
    expect(filtersOf(inclusive.queries[0]!.calls)).toContain(
      'lte record_date 2026-01-31',
    );

    const exclusive = createClient([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await fetchAccountRevenueRows(
      exclusive,
      ACCOUNT,
      '2026-01-01',
      '2026-01-31',
      { toExclusive: true },
    );
    expect(filtersOf(exclusive.queries[0]!.calls)).toContain(
      'lt record_date 2026-01-31',
    );
  });

  it('merges both scopes, resolving episode_id only for publish-scoped rows', async () => {
    const client = createClient([
      {
        data: [{ id: 'r1', publish_id: null, revenue_cents: 500 }],
        error: null,
      },
      {
        data: [
          {
            id: 'r2',
            publish_id: 'p1',
            revenue_cents: 250,
            publishes: { episode_id: 'ep-1' },
          },
        ],
        error: null,
      },
    ]);

    const rows = await fetchAccountRevenueRows(
      client,
      ACCOUNT,
      '2026-01-01',
      '2026-01-31',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'r1', episode_id: null });
    expect(rows[1]).toMatchObject({ id: 'r2', episode_id: 'ep-1' });
  });

  it('returns every row when a half exceeds one page', async () => {
    // 600 rows is past the 500-row page size and would previously have been
    // cut short by the server cap with no error, understating revenue.
    const many = Array.from({ length: 600 }, (_, index) => ({
      id: `r${index}`,
      publish_id: null,
      revenue_cents: 100,
    }));

    const client = createClient([
      { data: many, error: null },
      { data: [], error: null },
    ]);

    const rows = await fetchAccountRevenueRows(
      client,
      ACCOUNT,
      '2026-01-01',
      '2026-01-31',
    );

    expect(rows).toHaveLength(600);
    expect(rows.reduce((sum, r) => sum + r.revenue_cents, 0)).toBe(60_000);
  });

  it('throws when either half fails rather than reporting partial revenue', async () => {
    const channelFailed = createClient([
      { data: [], error: { message: 'boom' } },
      { data: [], error: null },
    ]);
    await expect(
      fetchAccountRevenueRows(
        channelFailed,
        ACCOUNT,
        '2026-01-01',
        '2026-01-31',
      ),
      // The label identifies which half failed, so a partial-revenue bug
      // cannot hide behind a bare message.
    ).rejects.toThrow(/channel-scoped revenue.*boom/);

    const publishFailed = createClient([
      { data: [], error: null },
      { data: [], error: { message: 'bang' } },
    ]);
    await expect(
      fetchAccountRevenueRows(
        publishFailed,
        ACCOUNT,
        '2026-01-01',
        '2026-01-31',
      ),
    ).rejects.toThrow(/publish-scoped revenue.*bang/);
  });
});
