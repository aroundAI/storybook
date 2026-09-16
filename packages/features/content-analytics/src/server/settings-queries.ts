import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Typed against the generated schema rather than `SupabaseClient<any, any,
// any>`. `channels.ts` uses the `any` form with an eslint-disable; this file
// only ever touches one well-known table, so it does not need the escape
// hatch — and the repo's TypeScript rules ask for `any` to be avoided.
type Client = SupabaseClient<Database>;

export interface AccountAnalyticsSettings {
  ypp_target_watch_hours: number | null;
  ypp_target_subscribers: number | null;
  tag_min_sample: number | null;
}

/**
 * The one read of `analytics_settings` (FILM-1608).
 *
 * There were two before this, in `deep-dive-actions` and `taxonomy-actions`,
 * each selecting its own subset of columns and each applying its own `??`
 * fallback — and they had already drifted, resolving an unset value by
 * different rules against the same row. Three readers once the settings page
 * arrived would have been three chances to drift again.
 *
 * All three columns every time. The table is keyed by `account_id` and holds
 * one narrow row per account, so selecting a column a caller does not need
 * costs nothing measurable and removes the reason to write a second query.
 *
 * Returns `null` when no row exists, which callers must treat exactly as they
 * treat a row of nulls: both mean "nothing configured". `resolveYppTarget`
 * and `resolveTagMinSample` already do.
 */
export async function fetchAccountAnalyticsSettings(
  accountId: string,
  client: Client = getSupabaseServerClient(),
): Promise<AccountAnalyticsSettings | null> {
  const { data } = await client
    .from('analytics_settings')
    .select('ypp_target_watch_hours, ypp_target_subscribers, tag_min_sample')
    .eq('account_id', accountId)
    .maybeSingle();

  return data;
}
