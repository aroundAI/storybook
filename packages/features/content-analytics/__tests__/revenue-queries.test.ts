import { describe, expect, it } from 'vitest';

import { fetchAccountRevenueRows } from '../src/server/revenue-queries';

type Call = [string, ...unknown[]];

/**
 * A chainable stand-in for the PostgREST builder that records every filter
 * applied, so the tests can assert on scoping rather than on returned rows.
 */
function createClient(results: Array<{ data: unknown[]; error: unknown }>) {
  const queries: Array<{ calls: Call[] }> = [];

  return {
    queries,
    from() {
      const calls: Call[] = [];
      const result = results[queries.length] ?? { data: [], error: null };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        calls,
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };

      for (const method of ['select', 'is', 'eq', 'gte', 'lte', 'lt']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }

      queries.push(builder);
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
    ).rejects.toMatchObject({ message: 'boom' });

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
    ).rejects.toMatchObject({ message: 'bang' });
  });
});
