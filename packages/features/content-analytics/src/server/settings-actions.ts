'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GetAnalyticsSettingsSchema,
  UpdateAccountAnalyticsSettingsSchema,
  UpdateChannelAnalyticsSettingsSchema,
  isFutureJoinDate,
} from '../lib/schemas/settings.schema';
import type { ChannelSettingsRow } from '../lib/ypp-targets';
import { listAccountChannels } from './channels';
import { assertScopeAccess } from './scope-access';
import {
  fetchAccountAnalyticsSettings,
  fetchChannelAnalyticsOverrides,
} from './settings-queries';

/**
 * The first writer `analytics_settings` has ever had (FILM-1608).
 *
 * Every write here is an upsert and never a delete: neither table grants
 * `delete` to `authenticated`, and resetting a value to its default means
 * writing `null`, not removing the row. That is deliberate — a delete would
 * also discard the applicant status and joined date sitting beside the
 * targets in the same row.
 */

export interface ChannelSettingsEntry extends ChannelSettingsRow {
  connectionId: string;
  channelName: string;
}

export interface AnalyticsSettingsView {
  accountSettings: {
    ypp_target_watch_hours: number | null;
    ypp_target_subscribers: number | null;
    tag_min_sample: number | null;
  } | null;
  channels: ChannelSettingsEntry[];
}

export const getAnalyticsSettingsAction = enhanceAction(
  async ({ accountId }): Promise<AnalyticsSettingsView> => {
    await assertScopeAccess({ accountId });

    const client = getSupabaseServerClient();

    const [accountSettings, channels, byConnection] = await Promise.all([
      fetchAccountAnalyticsSettings(accountId, client),
      // The same filter `getYppProgressAction` applies. If the settings
      // page listed channels the progress card does not, an operator
      // could configure a target for a channel that never appears
      // anywhere, and never find out why.
      listAccountChannels(accountId, client, {
        platform: 'youtube',
        activeOnly: true,
      }),
      fetchChannelAnalyticsOverrides(accountId, client),
    ]);

    return {
      accountSettings,
      channels: channels.map((channel) => {
        const override = byConnection.get(channel.connectionId);

        return {
          connectionId: channel.connectionId,
          channelName: channel.name,
          ypp_target_watch_hours: override?.ypp_target_watch_hours ?? null,
          ypp_target_subscribers: override?.ypp_target_subscribers ?? null,
          ypp_applicant_status: override?.ypp_applicant_status ?? 'unknown',
          joined_ypp_at: override?.joined_ypp_at ?? null,
        };
      }),
    };
  },
  {
    schema: GetAnalyticsSettingsSchema,
    auth: true,
  },
);

export type UpdateAnalyticsSettingsResult =
  | { ok: true }
  | { ok: false; reason: 'no_access' | 'write_failed' };

/**
 * The channel writer can also refuse the joined date, which the account one
 * has no field for — a shared type would make every caller handle a reason
 * its action cannot return.
 */
export type UpdateChannelSettingsResult =
  | { ok: true }
  | { ok: false; reason: 'no_access' | 'write_failed' | 'invalid_joined_date' };

export const updateAccountAnalyticsSettingsAction = enhanceAction(
  async (data): Promise<UpdateAnalyticsSettingsResult> => {
    const {
      accountId,
      yppTargetWatchHours,
      yppTargetSubscribers,
      tagMinSample,
    } = data;

    const client = getSupabaseServerClient();

    // Read directly rather than through `assertScopeAccess`, which discards
    // the read error and throws the same "access denied" for both cases. An
    // outage must not tell a real member they have been locked out — the same
    // split the channel action below makes.
    const { data: account, error: accountError } = await client
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .maybeSingle();

    if (accountError) return { ok: false, reason: 'write_failed' };

    if (!account) return { ok: false, reason: 'no_access' };

    const { error } = await client.from('analytics_settings').upsert(
      {
        account_id: accountId,
        ypp_target_watch_hours: yppTargetWatchHours,
        ypp_target_subscribers: yppTargetSubscribers,
        tag_min_sample: tagMinSample,
      },
      { onConflict: 'account_id' },
    );

    // RLS refuses rather than throwing, so the error is the only signal
    // there is. Returning a reason instead of throwing because Next masks
    // Server Action error messages in a production build — a thrown error
    // reaches the user as an opaque digest.
    if (error) return { ok: false, reason: 'write_failed' };

    return { ok: true };
  },
  {
    schema: UpdateAccountAnalyticsSettingsSchema,
    auth: true,
  },
);

export const updateChannelAnalyticsSettingsAction = enhanceAction(
  async (data): Promise<UpdateChannelSettingsResult> => {
    const {
      connectionId,
      yppTargetWatchHours,
      yppTargetSubscribers,
      yppApplicantStatus,
      joinedYppAt,
    } = data;

    const client = getSupabaseServerClient();

    // The account is read off the connection, never taken from the caller.
    // This select is RLS-scoped, so a connection belonging to someone else
    // returns no row at all and the write never happens.
    const { data: connection, error: connectionError } = await client
      .from('platform_connections')
      .select('id, account_id')
      .eq('id', connectionId)
      .maybeSingle();

    // Two ways to get no row, and they must not report the same thing. An
    // error means the read failed; telling the user their own channel "is not
    // part of this account" would be the same conflation `settings-queries`
    // refuses to make, just moved one file across.
    if (connectionError) return { ok: false, reason: 'write_failed' };

    if (!connection) return { ok: false, reason: 'no_access' };

    // A future date cannot be *entered*, but one already stored may be left
    // alone: rows written before that bound existed would otherwise lock
    // every other setting on the channel. The stored value is read here
    // rather than trusted from the caller, and the schema cannot make this
    // call because it never sees the row.
    if (joinedYppAt !== null && isFutureJoinDate(joinedYppAt)) {
      const { data: stored, error: storedError } = await client
        .from('channel_analytics_settings')
        .select('joined_ypp_at')
        .eq('connection_id', connectionId)
        .maybeSingle();

      if (storedError) return { ok: false, reason: 'write_failed' };

      if (stored?.joined_ypp_at !== joinedYppAt) {
        return { ok: false, reason: 'invalid_joined_date' };
      }
    }

    const { error } = await client.from('channel_analytics_settings').upsert(
      {
        connection_id: connectionId,
        account_id: connection.account_id,
        ypp_target_watch_hours: yppTargetWatchHours,
        ypp_target_subscribers: yppTargetSubscribers,
        ypp_applicant_status: yppApplicantStatus,
        joined_ypp_at: joinedYppAt,
      },
      { onConflict: 'connection_id' },
    );

    if (error) return { ok: false, reason: 'write_failed' };

    return { ok: true };
  },
  {
    schema: UpdateChannelAnalyticsSettingsSchema,
    auth: true,
  },
);
