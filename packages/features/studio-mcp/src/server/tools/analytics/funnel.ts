import 'server-only';

import { z } from 'zod';

import {
  SignalSurfaceSchema,
  getSignalSurfaceService,
} from '@kit/content-analytics/server/signal-surface-service';

import { defineTool } from '../../../registry';
import {
  NOT_MEASURED_REASON,
  READ_ONLY,
  callService,
  parseWith,
  requireTeamScope,
} from './shared';

/**
 * FILM-1719's six-stage strip for one video: each stage's state, the
 * diagnosis and the genome's findings. The service's own states are passed
 * through: `analytics_off` with ClickHouse off, `unavailable` with a reason
 * for a video it cannot judge.
 */
export const getVideoFunnel = defineTool({
  name: 'get_video_funnel',
  title: 'Video funnel',
  description:
    'One video’s funnel at a checkpoint age (FILM-1719): the stages in order with each figure beside its evidence, the diagnosis, what each rate divided by, and the genome findings at the stages that have a per-video measure. `status` is `ok`, `unavailable` (with `reason`) or `analytics_off`.',
  inputSchema: {
    projectId: z.string().uuid(),
    videoId: z
      .string()
      .min(1)
      .max(200)
      .describe('The publish id (the video’s id in the analytics tables).'),
    checkpointDays: z.number().int().min(1).max(730).default(30),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireTeamScope(context, { projectId: input.projectId });

    const data = await callService(() =>
      getSignalSurfaceService(
        context.principal.supabase,
        parseWith(SignalSurfaceSchema, input),
      ),
    );

    return {
      structuredContent: {
        data,
        notes: {
          measured: data.status !== 'analytics_off',
          reason: data.status === 'analytics_off' ? NOT_MEASURED_REASON : null,
        },
      },
    };
  },
});
