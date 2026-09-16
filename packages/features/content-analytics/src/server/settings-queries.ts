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
 *
 * **Throws on a failed read rather than returning null.** The two are not the
 * same thing and the difference is destructive here: `null` means "nothing
 * configured", so a swallowed error renders every field blank, and the user's
 * next save upserts those blanks over a row that was fine. A read failure has
 * to stop the page, not quietly become a proposal to erase the settings.
 */
export async function fetchAccountAnalyticsSettings(
  accountId: string,
  client: Client = getSupabaseServerClient(),
): Promise<AccountAnalyticsSettings | null> {
  const { data, error } = await client
    .from('analytics_settings')
    .select('ypp_target_watch_hours, ypp_target_subscribers, tag_min_sample')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read analytics settings: ${error.message}`);
  }

  return data;
}

export interface ChannelAnalyticsOverride {
  connection_id: string;
  ypp_target_watch_hours: number | null;
  ypp_target_subscribers: number | null;
  ypp_applicant_status: string;
  joined_ypp_at: string | null;
}

/**
 * Every per-channel override on an account, keyed by connection.
 *
 * Here rather than inline in its two callers — the settings page and
 * `getYppProgressAction` — because it is the same query twice, and the last
 * time this table had two independent readers they drifted on what an unset
 * value meant.
 *
 * Throws on a failed read, for the same reason the account read does. An
 * empty map is indistinguishable from "no overrides configured": on the
 * settings page that renders every channel blank and arms a save that wipes
 * the status and joined date the header of `settings-actions.ts` explains
 * were deliberately kept out of reach of a delete. In
 * `getYppProgressAction` it is worse than blank — every channel then reports
 * `basis: 'account'` or `'default'`, so the card states a provenance that is
 * false rather than merely missing.
 *
 * The result is a Map because `connection_id` is the table's primary key, so
 * a lookup cannot lose an override to a duplicate.
 */
export async function fetchChannelAnalyticsOverrides(
  accountId: string,
  client: Client = getSupabaseServerClient(),
): Promise<Map<string, ChannelAnalyticsOverride>> {
  const { data, error } = await client
    .from('channel_analytics_settings')
    .select(
      'connection_id, ypp_target_watch_hours, ypp_target_subscribers, ypp_applicant_status, joined_ypp_at',
    )
    .eq('account_id', accountId);

  if (error) {
    throw new Error(
      `Failed to read per-channel analytics settings: ${error.message}`,
    );
  }

  return new Map((data ?? []).map((row) => [row.connection_id, row]));
}
