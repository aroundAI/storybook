import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllByIds } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

/**
 * `account_ai_settings.desktop_integration_enabled` (FILM-2005): whether a
 * team uses StorybookStudio. It shows "Open in Studio" on the team's
 * episodes and lets a member consent to the storybookstudio client for the
 * team. Read as the signed-in user, so RLS returns only teams they belong
 * to; a team with no settings row is off.
 */
export async function teamsWithDesktopIntegration(
  client: SupabaseClient<Database>,
  accountIds: string[],
): Promise<Set<string>> {
  const rows = await fetchAllByIds<{ account_id: string }>(
    accountIds,
    (chunk, from, to) =>
      client
        .from('account_ai_settings')
        .select('account_id')
        .in('account_id', chunk)
        .eq('desktop_integration_enabled', true)
        .order('account_id')
        .range(from, to),
    'account_ai_settings',
  );

  return new Set(rows.map((row) => row.account_id));
}

export async function isDesktopIntegrationEnabled(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  return (await teamsWithDesktopIntegration(client, [accountId])).has(
    accountId,
  );
}
