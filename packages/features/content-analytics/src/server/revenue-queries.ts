import 'server-only';

import { forEachPage } from '@kit/shared/pagination';

/**
 * Shared revenue reads.
 *
 * These live outside `revenue-actions.ts` because that file carries the
 * `'use server'` directive, where every export becomes a callable endpoint.
 * A helper that takes an `accountId` and returns that account's revenue must
 * not be reachable that way, so it sits here and is imported by the actions
 * and by the alert evaluator.
 */

/**
 * One revenue row as seen by an account, from either scope.
 * `publish_id`/`episode_id` are null for channel-level rows.
 */
export interface AccountRevenueRow {
  id: string;
  publish_id: string | null;
  platform: string;
  record_date: string;
  revenue_cents: number;
  currency: string | null;
  source: string;
  category: string;
  episode_id: string | null;
}

/**
 * Every revenue row an account can see in a window, across BOTH scopes.
 *
 * Revenue attaches to either a publish or an account (channel-level
 * sponsorship and product income), enforced by a CHECK that one of the two
 * is set — so `account_id` is NULL on per-video rows and filtering on it
 * alone would drop them. A single `publishes!inner` join drops the other
 * half. The two scopes are therefore queried separately and merged here;
 * PostgREST cannot express an OR across an embedded resource.
 */
export async function forEachAccountRevenueRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
  from: string,
  to: string,
  onRow: (row: AccountRevenueRow) => void,
  options?: { toExclusive?: boolean },
): Promise<void> {
  const COLUMNS = `
    id,
    publish_id,
    platform,
    record_date,
    revenue_cents,
    currency,
    source,
    category
  `;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyRange = (query: any) => {
    const bounded = query.gte('record_date', from);
    return options?.toExclusive
      ? bounded.lt('record_date', to)
      : bounded.lte('record_date', to);
  };

  // Both halves are paged. They truncate independently, so a short read
  // does not merely understate revenue — the current and previous windows
  // lose different amounts, which can flip the reported trend direction.
  //
  // Rows are handed to the caller a page at a time rather than collected.
  // revenue_records holds a row per publish per day per category, so a
  // yearly window on a busy account reaches six figures: materializing that
  // to fold it once costs the memory and trips the pagination guard, which
  // would turn a rendering-but-understated summary into a hard failure.
  //
  // TODO(FILM-1614): fold this into SQL. The consumers do grouped folds —
  // by platform, category, episode and date — so this wants an RPC
  // returning pre-grouped sums, not a single SUM(). That collapses six
  // figures of rows to a few hundred and puts the scope predicate in one
  // place instead of two client-side query shapes. Deferred here because it
  // needs a migration and regenerated types.
  await Promise.all([
    forEachPage<AccountRevenueRow>(
      // Named pageFrom/pageTo so they cannot shadow the `from`/`to` date
      // bounds of the enclosing function. If they did and any date filter
      // were written inline here, integer page offsets would be passed as
      // record_date values — wrong revenue, no error.
      (pageFrom, pageTo) =>
        applyRange(
          client
            .from('revenue_records')
            .select(COLUMNS)
            .is('publish_id', null)
            .eq('account_id', accountId),
        )
          .order('id')
          .range(pageFrom, pageTo),
      (batch) => {
        for (const row of batch) {
          onRow({ ...(row as AccountRevenueRow), episode_id: null });
        }
      },
      'channel-scoped revenue',
    ),
    forEachPage<AccountRevenueRow & { publishes?: { episode_id?: string } }>(
      (pageFrom, pageTo) =>
        applyRange(
          client
            .from('revenue_records')
            .select(
              `${COLUMNS},
          publishes!inner (
            id,
            episode_id,
            episodes!inner (
              id,
              project_id,
              projects!inner ( account_id )
            )
          )`,
            )
            .eq('publishes.episodes.projects.account_id', accountId),
        )
          .order('id')
          .range(pageFrom, pageTo),
      (batch) => {
        for (const row of batch) {
          const publish = (
            row as { publishes?: { episode_id?: string | null } }
          ).publishes;
          onRow({
            ...(row as AccountRevenueRow),
            episode_id: publish?.episode_id ?? null,
          });
        }
      },
      'publish-scoped revenue',
    ),
  ]);
}

/**
 * Collects every row into an array.
 *
 * Prefer `forEachAccountRevenueRow` for aggregation — this materializes the
 * whole window, which is what the streaming variant exists to avoid.
 */
export async function fetchAccountRevenueRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
  from: string,
  to: string,
  options?: { toExclusive?: boolean },
): Promise<AccountRevenueRow[]> {
  const rows: AccountRevenueRow[] = [];

  await forEachAccountRevenueRow(
    client,
    accountId,
    from,
    to,
    (row) => rows.push(row),
    options,
  );

  return rows;
}
