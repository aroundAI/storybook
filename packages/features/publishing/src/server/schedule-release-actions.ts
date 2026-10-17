'use server';

import 'server-only';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { DEFAULT_CADENCE, resolveCadence } from '../lib/cadence/cadence';
import {
  ChannelCadenceSchema,
  ChannelCadencesQuerySchema,
  HeldShortsSchema,
  ScheduleReleaseSchema,
} from '../lib/schemas/schedule-release.schema';
import {
  discardHeldShorts,
  previewCadenceRelease,
  requeueHeldShorts,
  scheduleCadenceRelease,
} from './schedule-release.service';

/**
 * FILM-719. The Publish screen's cadence release: preview it, schedule it,
 * and re-queue or discard the Shorts it held. Refusals come back as values,
 * so a production build shows their words.
 */

function unwrapResult<T>(
  result: { ok: true; data: T } | { ok: false; refusal: string },
) {
  if (!result.ok) throw new ActionRefusal(result.refusal);

  return result.data;
}

export const previewCadenceReleaseAction = returnRefusals(
  enhanceAction(
    async (input) =>
      unwrapResult(
        await previewCadenceRelease(getSupabaseServerClient(), {
          ...input,
          aiGenerated: input.aiGenerated ?? false,
        }),
      ),
    { schema: ScheduleReleaseSchema, auth: true },
  ),
);

export const scheduleCadenceReleaseAction = returnRefusals(
  enhanceAction(
    async (input, user) =>
      unwrapResult(
        await scheduleCadenceRelease(getSupabaseServerClient(), user.id, {
          ...input,
          aiGenerated: input.aiGenerated ?? false,
        }),
      ),
    { schema: ScheduleReleaseSchema, auth: true },
  ),
);

export const requeueHeldShortsAction = returnRefusals(
  enhanceAction(
    async (input) =>
      unwrapResult(await requeueHeldShorts(getSupabaseServerClient(), input)),
    { schema: HeldShortsSchema, auth: true },
  ),
);

export const discardHeldShortsAction = returnRefusals(
  enhanceAction(
    async ({ publishIds }) =>
      unwrapResult(
        await discardHeldShorts(getSupabaseServerClient(), publishIds),
      ),
    { schema: HeldShortsSchema, auth: true },
  ),
);

/** Each channel's cadence for both content types: its own, else the defaults */
export const getChannelCadencesAction = enhanceAction(
  async ({ connectionIds }) => {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from('channel_posting_cadences')
      .select(
        'platform_connection_id, content_type, timezone, slot_times, days_of_week, min_days_between, start_after_hours, jitter_minutes, enabled',
      )
      .in('platform_connection_id', connectionIds);

    if (error) {
      throw new Error(`Could not read the channels' cadence: ${error.message}`);
    }

    return connectionIds.flatMap((connectionId) =>
      (['full', 'short'] as const).map((contentType) => {
        const row = data.find(
          (r) =>
            r.platform_connection_id === connectionId &&
            r.content_type === contentType,
        );

        return {
          connectionId,
          contentType,
          own: !!row,
          enabled: row?.enabled ?? true,
          cadence: row
            ? resolveCadence({ ...row, enabled: true }, contentType, 'UTC')
            : { ...DEFAULT_CADENCE[contentType], timezone: null },
        };
      }),
    );
  },
  { schema: ChannelCadencesQuerySchema, auth: true },
);

export const saveChannelCadenceAction = returnRefusals(
  enhanceAction(
    async (input) => {
      const client = getSupabaseServerClient();

      const { data: channel, error: readError } = await client
        .from('platform_connections')
        .select('id, account_id')
        .eq('id', input.connectionId)
        .maybeSingle();

      if (readError) {
        throw new Error(`Could not read the channel: ${readError.message}`);
      }

      if (!channel) {
        throw new ActionRefusal('That channel is not one of this team’s.');
      }

      const { error } = await client.from('channel_posting_cadences').upsert(
        {
          account_id: channel.account_id,
          platform_connection_id: input.connectionId,
          content_type: input.contentType,
          timezone: input.timezone,
          slot_times: [...input.slotTimes].sort(),
          days_of_week: [...new Set(input.daysOfWeek)].sort(),
          min_days_between: input.minDaysBetween,
          start_after_hours: input.startAfterHours,
          jitter_minutes: input.jitterMinutes,
          enabled: input.enabled,
        },
        { onConflict: 'platform_connection_id,content_type' },
      );

      if (error) {
        throw new Error(`Could not save the cadence: ${error.message}`);
      }

      return {
        connectionId: input.connectionId,
        contentType: input.contentType,
      };
    },
    { schema: ChannelCadenceSchema, auth: true },
  ),
);
