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
  ReplanScheduleSchema,
  ReschedulePublishSchema,
  ScheduleReleaseSchema,
} from '../lib/schemas/schedule-release.schema';
import {
  replanSchedule,
  reschedulePublishes,
  saveCadenceAndReplan,
} from './reschedule.service';
import { cancelScheduledPublish } from './schedule-publishes.service';
import {
  discardHeldShorts,
  previewBreakingRelease,
  previewCadenceRelease,
  readChannelCadences,
  requeueHeldShorts,
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

/**
 * FILM-2213: saving a channel's posting rules re-plans everything scheduled
 * on it, in the same request; the result says what moved and what did not
 */
export const saveChannelCadenceAction = returnRefusals(
  enhanceAction(
    async (input, user) =>
      unwrapResult(
        await saveCadenceAndReplan(
          getSupabaseServerClient(),
          { userId: user.id, via: 'ui' },
          input,
        ),
      ),
    { schema: ChannelCadenceSchema, auth: true },
  ),
);

/** FILM-2213: what saving these rules would move, saving nothing */
export const previewChannelCadenceAction = returnRefusals(
  enhanceAction(
    async (input, user) =>
      unwrapResult(
        await saveCadenceAndReplan(
          getSupabaseServerClient(),
          { userId: user.id, via: 'ui' },
          input,
          { dryRun: true },
        ),
      ),
    { schema: ChannelCadenceSchema, auth: true },
  ),
);

/** FILM-2213: the Schedule page's Change time, previewed */
export const previewReschedulePublishAction = returnRefusals(
  enhanceAction(
    async ({ note, ...input }, user) =>
      unwrapResult(
        await reschedulePublishes(
          getSupabaseServerClient(),
          { userId: user.id, via: 'ui', note },
          input,
          { dryRun: true },
        ),
      ),
    { schema: ReschedulePublishSchema, auth: true },
  ),
);

/** FILM-2213: the Schedule page's Change time: the post moves in place */
export const reschedulePublishAction = returnRefusals(
  enhanceAction(
    async ({ note, ...input }, user) =>
      unwrapResult(
        await reschedulePublishes(
          getSupabaseServerClient(),
          { userId: user.id, via: 'ui', note },
          input,
        ),
      ),
    { schema: ReschedulePublishSchema, auth: true },
  ),
);

/** FILM-2213: the Schedule page's Re-plan to posting rules, preview or apply */
export const replanScheduleAction = returnRefusals(
  enhanceAction(
    async (input, user) =>
      unwrapResult(
        await replanSchedule(
          getSupabaseServerClient(),
          { userId: user.id, via: 'ui' },
          input,
        ),
      ),
    { schema: ReplanScheduleSchema, auth: true },
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
