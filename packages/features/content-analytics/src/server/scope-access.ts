import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Scope shared by the deep-dive and Video Log actions: project- or
 * account-level, with optional segment filters.
 */
export interface AnalyticsScope {
  projectId?: string;
  accountId?: string;
  connectionId?: string;
  platform?: 'youtube' | 'tiktok' | 'instagram';
  contentType?: string;
  language?: string;
}

/**
 * ClickHouse queries are not covered by Postgres RLS, so every action
 * verifies the caller can see the scoped project/account through the
 * user-scoped Supabase client first.
 *
 * Lives outside the `'use server'` action modules so both can share it —
 * there, every export becomes a callable endpoint, and an access check that
 * takes a scope and returns nothing must not be reachable that way.
 */
export async function assertScopeAccess(scope: AnalyticsScope): Promise<void> {
  const client = getSupabaseServerClient();

  let scopeAccountId = scope.accountId;

  if (scope.projectId) {
    const { data } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', scope.projectId)
      .maybeSingle();

    if (!data) {
      throw new Error('Project not found or access denied');
    }

    scopeAccountId = data.account_id ?? scope.accountId;
  } else {
    const { data } = await client
      .from('accounts')
      .select('id')
      .eq('id', scope.accountId!)
      .maybeSingle();

    if (!data) {
      throw new Error('Account not found or access denied');
    }
  }

  if (!scope.connectionId) return;

  // A channel filter narrows a scope that has already been proven to belong
  // to the caller — `buildDimConditions` ANDs it onto the verified project
  // or account — so this check is not what keeps data private. It is here so
  // that a channel outside the scope fails loudly, instead of silently
  // matching no rows and rendering as "no data".
  const { data: connection } = await client
    .from('platform_connections')
    .select('id, account_id')
    .eq('id', scope.connectionId)
    .maybeSingle();

  if (
    !connection ||
    (scopeAccountId && connection.account_id !== scopeAccountId)
  ) {
    throw new Error('Channel not found or not part of this scope');
  }
}
