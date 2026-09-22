import { describe, expect, it } from 'vitest';

import { foldMoney } from '../src/lib/money';
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

  // Keyed by the projection string, which differs between the two halves —
  // the publish-scoped select carries the embedded `publishes!inner` block.
  //
  // A global call counter cannot work here: the halves run concurrently and
  // finish after different numbers of pages, so once the shorter one stops,
  // a round-robin mapping hands the longer one the other query's result and
  // builder. Its filters would then be recorded against the wrong query,
  // and the account-scoping assertions below would be checking a builder
  // holding some other query's predicates.
  const byProjection = new Map<
    string,
    { calls: Call[]; resultIndex: number }
  >();

  return {
    queries,
    from() {
      return {
        select(projection: string) {
          let state = byProjection.get(projection);

          if (!state) {
            state = { calls: [], resultIndex: byProjection.size };
            byProjection.set(projection, state);
            queries.push(state);
          }

          const result = results[state.resultIndex] ?? {
            data: [],
            error: null,
          };
          const calls = state.calls;

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

          for (const method of ['is', 'eq', 'gte', 'lte', 'lt', 'order']) {
            builder[method] = (...args: unknown[]) => {
              calls.push([method, ...args]);
              return builder;
            };
          }

          builder.range = (rangeFrom: number, rangeTo: number) => {
            range = [rangeFrom, rangeTo];
            return builder;
          };

          return builder;
        },
      };
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
        data: [
          { id: 'r1', publish_id: null, revenue_cents: 500, currency: 'EUR' },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'r2',
            publish_id: 'p1',
            revenue_cents: 250,
            currency: 'USD',
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

    // KB-12: the figure leaves this read with its currency attached, and
    // not as a bare number a caller can add to another row's.
    expect(rows.map((row) => row.amount)).toEqual([
      { currency: 'EUR', cents: 500 },
      { currency: 'USD', cents: 250 },
    ]);
    expect(rows[0]).not.toHaveProperty('revenue_cents');
  });

  it('returns every row when a half exceeds one page', async () => {
    // 600 rows is past the 500-row page size and would previously have been
    // cut short by the server cap with no error, understating revenue.
    const many = Array.from({ length: 600 }, (_, index) => ({
      id: `r${index}`,
      publish_id: null,
      revenue_cents: 100,
      currency: 'USD',
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
    expect(foldMoney(rows.map((row) => row.amount))).toEqual([
      { currency: 'USD', cents: 60_000 },
    ]);
  });

  it('keeps each half’s filters separate when both page past one page', async () => {
    // The halves finish after different numbers of pages, so this is the
    // case where a mock keyed on a global call counter starts handing one
    // query the other's builder — quietly invalidating the scoping
    // assertions above. Both halves carry data here, and the channel half
    // outlives the publish half.
    const channelRows = Array.from({ length: 1200 }, (_, index) => ({
      id: `c${index}`,
      publish_id: null,
      revenue_cents: 10,
    }));
    const publishRows = Array.from({ length: 20 }, (_, index) => ({
      id: `p${index}`,
      publish_id: `pub${index}`,
      revenue_cents: 5,
      publishes: { episode_id: `ep${index}` },
    }));

    const client = createClient([
      { data: channelRows, error: null },
      { data: publishRows, error: null },
    ]);

    const rows = await fetchAccountRevenueRows(
      client,
      ACCOUNT,
      '2026-01-01',
      '2026-01-31',
    );

    expect(rows).toHaveLength(1220);

    const [channelScoped, publishScoped] = client.queries;

    // The channel half must not have picked up the publish half's join
    // predicate, or vice versa, however many pages each ran for.
    expect(filtersOf(channelScoped!.calls)).toContain('is publish_id null');
    expect(filtersOf(channelScoped!.calls)).not.toContain(
      `eq publishes.episodes.projects.account_id ${ACCOUNT}`,
    );
    expect(filtersOf(publishScoped!.calls)).toContain(
      `eq publishes.episodes.projects.account_id ${ACCOUNT}`,
    );
    expect(filtersOf(publishScoped!.calls)).not.toContain('is publish_id null');
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
