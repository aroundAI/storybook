import 'server-only';

import { z } from 'zod';

import {
  getEpisodeRetentionPublishService,
  getRetentionCurveService,
} from '@kit/content-analytics/server/diagnostics-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  requireOwnedEpisode,
  requireOwnedPublish,
  windowOf,
} from './shared';

/**
 * One video's retention curve, by publish or by episode (its latest
 * published YouTube video). The curve is fed by YouTube only, so an episode
 * published elsewhere has `publishId: null` and no curve, as the page's
 * empty state says.
 */
export const getRetentionCurve = defineTool({
  name: 'get_retention_curve',
  title: 'Retention curve',
  description:
    'Audience retention through one video: points of (elapsed ratio, audience watch ratio) and the published asset’s duration. Give `publishId`, or `episodeId` to use the episode’s latest published YouTube video. Only YouTube reports a curve.',
  inputSchema: {
    publishId: z.string().uuid().optional(),
    episodeId: z.string().uuid().optional(),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    if (!input.publishId && !input.episodeId) {
      throw new McpToolError(
        'VALIDATION_FAILED',
        'Give a publishId or an episodeId.',
      );
    }

    const client = context.principal.supabase;
    let publishId = input.publishId ?? null;
    let projectId: string;

    if (publishId) {
      ({ projectId } = await requireOwnedPublish(context, publishId));
    } else {
      ({ projectId } = await requireOwnedEpisode(context, input.episodeId!));
      publishId = (
        await callService(() =>
          getEpisodeRetentionPublishService(client, {
            episodeId: input.episodeId!,
          }),
        )
      ).publishId;
    }

    const window = windowOf({});
    const [curve, notes] = await Promise.all([
      publishId
        ? callService(() => getRetentionCurveService(client, { publishId }))
        : null,
      analyticsNotes(context, { projectId }, window),
    ]);

    return {
      structuredContent: {
        publishId,
        data: curve,
        ...(curve
          ? {}
          : {
              reason:
                'This episode has no published YouTube video, and only YouTube reports a retention curve.',
            }),
        notes,
      },
    };
  },
});
