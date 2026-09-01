import 'server-only';

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
export async function fetchAccountRevenueRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
  from: string,
  to: string,
  options?: { toExclusive?: boolean },
): Promise<AccountRevenueRow[]> {
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

  const [channelScoped, publishScoped] = await Promise.all([
    applyRange(
      client
        .from('revenue_records')
        .select(COLUMNS)
        .is('publish_id', null)
        .eq('account_id', accountId),
    ),
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
    ),
  ]);

  if (channelScoped.error) throw channelScoped.error;
  if (publishScoped.error) throw publishScoped.error;

  const rows: AccountRevenueRow[] = [];

  for (const row of channelScoped.data ?? []) {
    rows.push({ ...(row as AccountRevenueRow), episode_id: null });
  }

  for (const row of publishScoped.data ?? []) {
    const publish = (row as { publishes?: { episode_id?: string | null } })
      .publishes;
    rows.push({
      ...(row as AccountRevenueRow),
      episode_id: publish?.episode_id ?? null,
    });
  }

  return rows;
}
