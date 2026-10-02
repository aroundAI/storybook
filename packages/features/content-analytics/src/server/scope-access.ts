import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AnalyticsPlatform } from '@kit/clickhouse';

/**
 * Scope shared by the deep-dive and Video Log actions: project- or
 * account-level, with optional segment filters.
 */
// The same loose client type the action modules use; the typed client's
// generics do not survive being passed around.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface AnalyticsScope {
  projectId?: string;
  accountId?: string;
  connectionId?: string;
  platform?: AnalyticsPlatform;
  contentType?: string;
  language?: string;
  channelLanguage?: string;
}

/**
 * ClickHouse queries are not covered by Postgres RLS, so every action
 * verifies the caller can see the scoped project/account through the
 * user-scoped Supabase client first.
 *
 * Lives outside the `'use server'` action modules so both can share it —
 * there, every export becomes a callable endpoint, and an access check that
 * takes a scope and returns nothing must not be reachable that way.
 *
 * Returns the account the scope resolved to, which a project-scoped caller
 * would otherwise have to look up again. Callers that only need the check
 * ignore it.
 *
 * Takes the caller's client rather than building one (FILM-1906): the same
 * check then answers for a cookie session and for an MCP principal's
 * RLS-scoped client, and a service cannot be handed one client for its
 * reads and have its access check quietly answer for another.
 */
export async function assertScopeAccess(
  client: Client,
  scope: AnalyticsScope,
): Promise<string | undefined> {
  const scopeAccountId = scope.projectId
    ? await assertProjectAccess(client, scope.projectId)
    : await assertAccountAccess(client, scope.accountId!);

  if (!scope.connectionId) return scopeAccountId;

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

  return scopeAccountId;
}

/**
 * The account a project belongs to, if the caller is a member of it — the
 * guard every ClickHouse read by project goes through.
 *
 * Reading the `projects` row is not proof: a project with `visibility`
 * public or unlisted is readable by any signed-in user, so a check that
 * stopped there let another account's user read a public project's
 * analytics by rewriting a request (FILM-1615 EDD, F-0 — reproduced).
 * `has_account_access` is the account owner or anyone with a role on it,
 * the rule the analytics tables' own policies use; `has_role_on_account`
 * alone would shut out a personal account's owner, who has no membership
 * row. The same message covers "no such project" and "not yours", so the
 * answer does not reveal which.
 */
export async function assertProjectAccess(
  client: Client,
  projectId: string,
): Promise<string> {
  const { data } = await client
    .from('projects')
    .select('account_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!data?.account_id || !(await hasAccountAccess(client, data.account_id))) {
    throw new Error('Project not found or access denied');
  }

  return data.account_id;
}

/**
 * The same guard for an account scope. An `accounts` read is not proof
 * either: accounts with a public profile are readable by anyone.
 */
export async function assertAccountAccess(
  client: Client,
  accountId: string,
): Promise<string> {
  if (!(await hasAccountAccess(client, accountId))) {
    throw new Error('Account not found or access denied');
  }

  return accountId;
}

async function hasAccountAccess(
  client: Client,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('has_account_access', {
    p_account_id: accountId,
  });

  if (error) {
    throw new Error(`Failed to check account access: ${error.message}`);
  }

  return data === true;
}
