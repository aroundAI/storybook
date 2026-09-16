'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GetAnalyticsSettingsSchema,
  UpdateAccountAnalyticsSettingsSchema,
  UpdateChannelAnalyticsSettingsSchema,
} from '../lib/schemas/settings.schema';
import type { ChannelSettingsRow } from '../lib/ypp-targets';
import { listAccountChannels } from './channels';
import { assertScopeAccess } from './scope-access';
import { fetchAccountAnalyticsSettings } from './settings-queries';

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

    const [accountSettings, channels, { data: overrides }] = await Promise.all([
      fetchAccountAnalyticsSettings(accountId, client),
      // The same filter `getYppProgressAction` applies. If the settings
      // page listed channels the progress card does not, an operator
      // could configure a target for a channel that never appears
      // anywhere, and never find out why.
      listAccountChannels(accountId, client, {
        platform: 'youtube',
        activeOnly: true,
      }),
      client
        .from('channel_analytics_settings')
        .select(
          'connection_id, ypp_target_watch_hours, ypp_target_subscribers, ypp_applicant_status, joined_ypp_at',
        )
        .eq('account_id', accountId),
    ]);

    // One row per channel at most — `connection_id` is the primary key — so
    // a map cannot lose an override to a duplicate key.
    const byConnection = new Map(
      (overrides ?? []).map((row) => [row.connection_id, row]),
    );

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

export const updateAccountAnalyticsSettingsAction = enhanceAction(
  async (data): Promise<UpdateAnalyticsSettingsResult> => {
    const {
      accountId,
      yppTargetWatchHours,
      yppTargetSubscribers,
      tagMinSample,
    } = data;

    try {
      await assertScopeAccess({ accountId });
    } catch {
      return { ok: false, reason: 'no_access' };
    }

    const client = getSupabaseServerClient();

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
  async (data): Promise<UpdateAnalyticsSettingsResult> => {
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
    const { data: connection } = await client
      .from('platform_connections')
      .select('id, account_id')
      .eq('id', connectionId)
      .maybeSingle();

    if (!connection) return { ok: false, reason: 'no_access' };

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
