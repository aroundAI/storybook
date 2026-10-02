import 'server-only';

import { forEachPage } from '@kit/shared/pagination';

import type { CurrencyAmount } from '../lib/money';

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
 *
 * The figure travels with its currency as one `amount`, and there is no
 * bare `revenue_cents` to reach for (KB-12): every caller of this read used
 * to add that number across rows without looking at the column beside it.
 * `money.test.ts` holds the type to that.
 */
export interface AccountRevenueRow {
  id: string;
  publish_id: string | null;
  platform: string;
  record_date: string;
  amount: CurrencyAmount;
  source: string;
  category: string;
  episode_id: string | null;
}

/** The columns as PostgREST returns them, before `toAccountRevenueRow`. */
interface StoredRevenueRow extends Omit<AccountRevenueRow, 'amount'> {
  revenue_cents: number | null;
  currency: string | null;
}

/**
 * Every read below skips a row marked not measured (`revenue_cents` NULL on
 * a synced row, FILM-1726): it is not revenue, and an unmeasured USD row
 * would otherwise give a EUR-only account a $0.00 card (KB-12). The `?? 0`
 * is for the type; the filter means it is never reached.
 */
function toAccountRevenueRow(
  { revenue_cents, currency, ...row }: StoredRevenueRow,
  episodeId: string | null,
): AccountRevenueRow {
  return {
    ...row,
    amount: { currency, cents: revenue_cents ?? 0 },
    episode_id: episodeId,
  };
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
    forEachPage<StoredRevenueRow>(
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
            .not('revenue_cents', 'is', null)
            .eq('account_id', accountId),
        )
          .order('id')
          .range(pageFrom, pageTo),
      (batch) => {
        for (const row of batch) onRow(toAccountRevenueRow(row, null));
      },
      'channel-scoped revenue',
    ),
    forEachPage<
      StoredRevenueRow & { publishes?: { episode_id?: string | null } }
    >(
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
            .not('revenue_cents', 'is', null)
            .eq('publishes.episodes.projects.account_id', accountId),
        )
          .order('id')
          .range(pageFrom, pageTo),
      (batch) => {
        for (const { publishes, ...row } of batch) {
          onRow(toAccountRevenueRow(row, publishes?.episode_id ?? null));
        }
      },
      'publish-scoped revenue',
    ),
  ]);
}

/**
 * Every revenue row recorded against one project's publishes in a window,
 * for the Overview's revenue card (KB-16).
 *
 * Publish-scoped rows only. Channel-level income (`publish_id` null) has
 * no project to belong to, and the card says it is not here rather than
 * spreading the account's sponsorships over every project. Paged, because
 * the fold over it is a total and a truncated read is a smaller total with
 * no error.
 */
export async function forEachProjectRevenueRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  projectId: string,
  from: string,
  to: string,
  onRow: (row: AccountRevenueRow) => void,
  /** The analytics page's platform filter (FILM-1709); absent is every platform. */
  options?: { platforms?: readonly string[] },
): Promise<void> {
  await forEachPage<
    StoredRevenueRow & { publishes?: { episode_id?: string | null } }
  >(
    (pageFrom, pageTo) => {
      let query = client
        .from('revenue_records')
        .select(
          `id,
          publish_id,
          platform,
          record_date,
          revenue_cents,
          currency,
          source,
          category,
          publishes!inner (
            id,
            episode_id,
            episodes!inner ( id, project_id )
          )`,
        )
        .not('revenue_cents', 'is', null)
        .eq('publishes.episodes.project_id', projectId)
        .gte('record_date', from)
        .lte('record_date', to);

      if (options?.platforms) {
        query = query.in('platform', options.platforms);
      }

      return query.order('id').range(pageFrom, pageTo);
    },
    (batch) => {
      for (const { publishes, ...row } of batch) {
        onRow(toAccountRevenueRow(row, publishes?.episode_id ?? null));
      }
    },
    'project revenue',
  );
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
