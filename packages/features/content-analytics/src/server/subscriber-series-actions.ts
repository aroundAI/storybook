'use server';

import { z } from 'zod';

import { querySubscriberSeries } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { listProjectChannels } from './channels';
import { assertScopeAccess } from './scope-access';

/**
 * The reconstructed subscriber curve (FILM-1607), one series per connection.
 */

const ScopeSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    connectionId: z.string().uuid().optional(),
  })
  .refine((scope) => scope.projectId || scope.accountId, {
    message: 'projectId or accountId is required',
  });

const SubscriberSeriesSchema = z.object({
  scope: ScopeSchema,
  from: z.string().date(),
  to: z.string().date(),
});

/**
 * The connections a verified scope covers.
 *
 * Never from a caller-supplied `accountId` alongside a project:
 * `assertScopeAccess` proves the project is the caller's and ignores the
 * extra id, so filtering on it would read another account's channels.
 */
async function resolveConnectionIds(
  scope: z.infer<typeof ScopeSchema>,
  accountId: string | undefined,
): Promise<string[]> {
  let ids: string[];

  if (scope.projectId) {
    // The channels the project publishes to, disconnected ones included —
    // the same list the Deep Dive channel filter offers.
    const channels = await listProjectChannels(
      scope.projectId,
      getSupabaseServerClient(),
    );

    ids = channels.map((c) => c.connectionId);
  } else {
    if (!accountId) return [];

    const client = getSupabaseServerAdminClient();

    const rows = await fetchAllRows<{ id: string }>(
      (rangeFrom, rangeTo) =>
        client
          .from('platform_connections')
          .select('id')
          .eq('is_active', true)
          .eq('account_id', accountId)
          .order('id')
          .range(rangeFrom, rangeTo),
      'subscriber series connections',
    );

    ids = rows.map((r) => r.id);
  }

  return scope.connectionId
    ? ids.filter((id) => id === scope.connectionId)
    : ids;
}

export const getSubscriberSeriesAction = enhanceAction(
  async ({ scope, from, to }) => {
    // Not optional. The ClickHouse reads take connection ids and carry no
    // tenant predicate of their own, so this and resolveConnectionIds are
    // the only things standing between a caller-supplied scope and another
    // account's subscriber curve.
    const accountId = await assertScopeAccess(scope);

    const connectionIds = await resolveConnectionIds(scope, accountId);

    return querySubscriberSeries({ connectionIds, from, to });
  },
  { schema: SubscriberSeriesSchema, auth: true },
);
