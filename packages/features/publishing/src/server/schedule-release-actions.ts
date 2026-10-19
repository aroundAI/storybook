'use server';

import 'server-only';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { markPublishRemoved } from '../lib/publish-removal';
import {
  BreakingReleaseSchema,
  CancelScheduledPublishSchema,
  ChannelCadenceSchema,
  ChannelCadencesQuerySchema,
  HeldShortsSchema,
  ScheduleReleaseSchema,
} from '../lib/schemas/schedule-release.schema';
import { cancelScheduledPublish } from './schedule-publishes.service';
import {
  discardHeldShorts,
  previewBreakingRelease,
  previewCadenceRelease,
  readChannelCadences,
  requeueHeldShorts,
  saveChannelCadence,
  scheduleBreakingRelease,
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

/** FILM-2210: a breaking-news release, previewed, then scheduled */
export const previewBreakingReleaseAction = returnRefusals(
  enhanceAction(
    async (input) =>
      unwrapResult(
        await previewBreakingRelease(getSupabaseServerClient(), {
          ...input,
          aiGenerated: input.aiGenerated ?? false,
        }),
      ),
    { schema: BreakingReleaseSchema, auth: true },
  ),
);

export const scheduleBreakingReleaseAction = returnRefusals(
  enhanceAction(
    async (input, user) =>
      unwrapResult(
        await scheduleBreakingRelease(getSupabaseServerClient(), user.id, {
          ...input,
          aiGenerated: input.aiGenerated ?? false,
        }),
      ),
    { schema: BreakingReleaseSchema, auth: true },
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
  async ({ connectionIds }) =>
    readChannelCadences(getSupabaseServerClient(), connectionIds),
  { schema: ChannelCadencesQuerySchema, auth: true },
);

export const saveChannelCadenceAction = returnRefusals(
  enhanceAction(
    async (input) =>
      unwrapResult(await saveChannelCadence(getSupabaseServerClient(), input)),
    { schema: ChannelCadenceSchema, auth: true },
  ),
);

/** FILM-2211: the Schedule page cancels a post the scheduled job has not claimed */
export const cancelScheduledPublishAction = returnRefusals(
  enhanceAction(
    async ({ publishId }, user) =>
      unwrapResult(
        await cancelScheduledPublish(
          getSupabaseServerClient(),
          user.id,
          publishId,
        ),
      ),
    { schema: CancelScheduledPublishSchema, auth: true },
  ),
);

/** KB-207: the Schedule page marks a video taken down on its platform removed */
export const markPublishRemovedAction = returnRefusals(
  enhanceAction(
    async ({ publishId }, user) =>
      unwrapResult(
        await markPublishRemoved(getSupabaseServerClient(), user.id, publishId),
      ),
    { schema: CancelScheduledPublishSchema, auth: true },
  ),
);
