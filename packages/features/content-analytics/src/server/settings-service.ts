import 'server-only';

import type { z } from 'zod';

import type { GetAnalyticsSettingsSchema } from '../lib/schemas/settings.schema';
import type { ChannelSettingsRow } from '../lib/ypp-targets';
import type { AnalyticsClient } from './analytics-client';
import { listAccountChannels } from './channels';
import { assertScopeAccess } from './scope-access';
import {
  fetchAccountAnalyticsSettings,
  fetchChannelAnalyticsOverrides,
} from './settings-queries';

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

export type GetAnalyticsSettingsInput = z.infer<
  typeof GetAnalyticsSettingsSchema
>;

/**
 * The analytics settings page's read (FILM-1608), as a service over the
 * caller's client (FILM-1906): the account's targets and every YouTube
 * channel's overrides.
 */
export async function getAnalyticsSettingsService(
  client: AnalyticsClient,
  { accountId }: GetAnalyticsSettingsInput,
): Promise<AnalyticsSettingsView> {
  await assertScopeAccess(client, { accountId });

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
}
