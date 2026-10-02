import 'server-only';

import { resolveAnalyticsAccess } from '@kit/publishing/oauth/analytics-scopes';
import { analyticsScopesEnabled } from '@kit/publishing/server/analytics-scope-switch';
import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type RevenueAccessNote,
  revenueAccessNotes,
} from '../lib/revenue-access';

/**
 * Why an account's channels have no measured revenue, one sentence per
 * reason (FILM-1726). Revenue access is a fact about the account's
 * connections, so the project and account dashboards read the same notes.
 */
export async function readAccountRevenueAccess(
  client: ReturnType<typeof getSupabaseServerClient<Database>>,
  accountId: string,
): Promise<RevenueAccessNote[]> {
  const { data: connections, error } = await client
    .from('platform_connections')
    .select('platform, scopes, metadata')
    .eq('account_id', accountId)
    .is('disconnected_at', null)
    .order('id');

  if (error) throw error;

  const scopesEnabled = analyticsScopesEnabled();

  return revenueAccessNotes(
    (connections ?? []).map((connection) => ({
      platform: connection.platform,
      entries:
        resolveAnalyticsAccess({
          platform: connection.platform,
          grantedScopes: connection.scopes,
          metadata: connection.metadata,
          scopesEnabled,
        })?.entries ?? null,
    })),
  );
}
