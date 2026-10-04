import 'server-only';

import { z } from 'zod';

import {
  AbandonExperimentSchema,
  ConcludeExperimentSchema,
  CreateExperimentSchema,
  StartExperimentSchema,
} from '@kit/content-analytics/lib/schemas/experiment';
import { UpdatePublishNoteSchema } from '@kit/content-analytics/lib/schemas/publish-note';
import { SetPublishTagsSchema } from '@kit/content-analytics/lib/schemas/taxonomy';
import {
  abandonExperimentService,
  concludeExperimentService,
  createExperimentService,
  startExperimentService,
} from '@kit/content-analytics/server/experiment-service';
import { updatePublishNoteService } from '@kit/content-analytics/server/publish-notes-service';
import { setPublishTagsService } from '@kit/content-analytics/server/taxonomy-service';

import { defineTool } from '../../../registry';
import {
  callService,
  parseWith,
  requireOwnedPublish,
  requireOwnedRow,
  requireTeamScope,
} from './shared';

/**
 * The analytics writes (`studio:write`): what lets an agent record what it
 * learned and set up the next test. Each is validated with the service's
 * own schema and runs through the same service as the page's action, on the
 * principal's client, so RLS and the services' own rules (same-account tags,
 * compare-and-save notes, status transitions) apply unchanged.
 */

export const updatePublishNote = defineTool({
  name: 'update_publish_note',
  title: 'Update a video’s analytics note',
  description:
    'Writes a video’s analytics note (at most 5,000 characters; blank clears it). Compare-and-save: pass `expectedUpdatedAt` as get_video_log returned it (null for a note never written); if someone changed the note in between, nothing is written and `status` is `conflict` with the other edit.',
  inputSchema: {
    publishId: z.string().uuid(),
    note: z.string().max(5000).nullable(),
    expectedUpdatedAt: z.string().max(64).nullable(),
  },
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    await requireOwnedPublish(context, input.publishId);

    const result = await callService(() =>
      updatePublishNoteService(
        context.principal.supabase,
        parseWith(UpdatePublishNoteSchema, input),
      ),
    );

    return { structuredContent: { result } };
  },
});

export const assignPublishTags = defineTool({
  name: 'assign_publish_tags',
  title: 'Assign tags to a video',
  description:
    'Replaces the full tag set on one video with `tagIds` (from get_tag_performance view tags; at most 50). Tags from another team are refused before anything is cleared.',
  inputSchema: SetPublishTagsSchema.shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    await requireOwnedPublish(context, input.publishId);

    const result = await callService(() =>
      setPublishTagsService(
        context.principal.supabase,
        parseWith(SetPublishTagsSchema, input),
      ),
    );

    return { structuredContent: { result } };
  },
});

export const createExperiment = defineTool({
  name: 'create_experiment',
  title: 'Create an experiment',
  description:
    'Logs a planned change in the change log: title, what changed, hypothesis and expected outcome, category, the metric to watch, the review window, and the published videos or tags it concerns. Created as planned; start_experiment takes the baseline.',
  inputSchema: CreateExperimentSchema.omit({ accountId: true }).shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    if (input.projectId) {
      await requireTeamScope(context, { projectId: input.projectId });
    }

    if (input.connectionId) {
      await requireTeamScope(context, { channelId: input.connectionId });
    }

    const result = await callService(() =>
      createExperimentService(
        context.principal.supabase,
        parseWith(CreateExperimentSchema, {
          ...input,
          accountId: context.accountId,
        }),
      ),
    );

    return { structuredContent: { result } };
  },
});

export const startExperiment = defineTool({
  name: 'start_experiment',
  title: 'Start an experiment',
  description:
    'Marks a planned experiment running and snapshots the watched metric over the linked videos as the baseline. `startedAt` is the caller’s calendar day (default today).',
  inputSchema: StartExperimentSchema.shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    await requireOwnedRow(
      context,
      'analytics_experiments',
      input.experimentId,
      'Experiment',
    );

    const result = await callService(() =>
      startExperimentService(
        context.principal.supabase,
        parseWith(StartExperimentSchema, input),
      ),
    );

    return { structuredContent: { result } };
  },
});

export const concludeExperiment = defineTool({
  name: 'conclude_experiment',
  title: 'Conclude an experiment',
  description:
    'Concludes a running experiment with what actually happened and whether the hypothesis was confirmed, rejected or inconclusive, snapshotting the watched metric as the result. Irreversible.',
  inputSchema: ConcludeExperimentSchema.shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    await requireOwnedRow(
      context,
      'analytics_experiments',
      input.experimentId,
      'Experiment',
    );

    const result = await callService(() =>
      concludeExperimentService(
        context.principal.supabase,
        parseWith(ConcludeExperimentSchema, input),
      ),
    );

    return { structuredContent: { result } };
  },
});

export const abandonExperiment = defineTool({
  name: 'abandon_experiment',
  title: 'Abandon an experiment',
  description:
    'Abandons a planned or running experiment with an optional reason; its outcome is recorded as inconclusive. Irreversible.',
  inputSchema: AbandonExperimentSchema.shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    await requireOwnedRow(
      context,
      'analytics_experiments',
      input.experimentId,
      'Experiment',
    );

    const result = await callService(() =>
      abandonExperimentService(
        context.principal.supabase,
        parseWith(AbandonExperimentSchema, input),
      ),
    );

    return { structuredContent: { result } };
  },
});
