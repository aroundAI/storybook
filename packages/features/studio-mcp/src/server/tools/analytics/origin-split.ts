import 'server-only';

import { z } from 'zod';

import {
  ORIGIN_STAGES,
  PerformanceByOriginSchema,
  getPerformanceByOriginService,
} from '@kit/content-analytics/server/origin-split-service';

import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  parseWith,
  requireTeamScope,
  windowOf,
} from './shared';

/**
 * FILM-1912: a project's episode performance split by who wrote it, from
 * the `generation_origin` each commit stamps. With ClickHouse off the
 * result is `unmeasured` with its reason, and the notes say so.
 */
export const getPerformanceByOrigin = defineTool({
  name: 'get_performance_by_origin',
  title: 'Performance by generation origin',
  description:
    'A project’s episode performance split by who wrote each episode: StoryBook’s model (`server`), an agent over MCP (`external`), a person (`human`), or `unrecorded` (written before origins were stamped). Per platform and content type, each origin’s video count, median lifetime retention and median early views, each with how many videos it is over. Observational, not causal.',
  inputSchema: {
    projectId: z.string().uuid(),
    stage: z
      .enum(ORIGIN_STAGES)
      .optional()
      .describe('Whose stamp decides an episode’s origin. Default: story.'),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireTeamScope(context, { projectId: input.projectId });

    const [data, notes] = await Promise.all([
      callService(() =>
        getPerformanceByOriginService(
          context.principal.supabase,
          parseWith(PerformanceByOriginSchema, input),
        ),
      ),
      analyticsNotes(context, { projectId: input.projectId }, windowOf({})),
    ]);

    return { structuredContent: { data, notes } };
  },
});
