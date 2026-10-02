import 'server-only';

import { z } from 'zod';

import {
  ListExperimentsDueSchema,
  ListExperimentsSchema,
} from '@kit/content-analytics/lib/schemas/experiment';
import {
  getExperimentService,
  listExperimentsDueForReviewService,
  listExperimentsService,
} from '@kit/content-analytics/server/experiment-service';

import { defineTool } from '../../../registry';
import {
  CalendarDay,
  READ_ONLY,
  callService,
  pageArgs,
  paginate,
  parseWith,
  requireOwnedRow,
  requireTeamScope,
} from './shared';

/**
 * The change log (FILM-1610): experiments on videos already published,
 * with the watched metric's baseline and result snapshots.
 */
export const listExperiments = defineTool({
  name: 'list_experiments',
  title: 'List experiments',
  description:
    'The team’s change log, newest first: experiments on published videos with status and outcome. `projectId` and `status` filter; `dueForReview` lists only running experiments whose review date has arrived (soonest first). Paged.',
  inputSchema: {
    projectId: z.string().uuid().optional(),
    status: ListExperimentsSchema.shape.status,
    dueForReview: z.boolean().default(false),
    asOf: CalendarDay.optional().describe(
      'dueForReview: the caller’s calendar day (default today, UTC).',
    ),
    ...pageArgs,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    if (input.projectId) {
      await requireTeamScope(context, { projectId: input.projectId });
    }

    const client = context.principal.supabase;
    const accountId = context.accountId;

    const rows: Array<Record<string, unknown>> = input.dueForReview
      ? await callService(() =>
          listExperimentsDueForReviewService(
            client,
            parseWith(ListExperimentsDueSchema, {
              accountId,
              asOf: input.asOf,
            }),
          ),
        )
      : await callService(() =>
          listExperimentsService(
            client,
            parseWith(ListExperimentsSchema, {
              accountId,
              projectId: input.projectId,
              status: input.status,
            }),
          ),
        );

    return {
      structuredContent: {
        ...paginate(rows, input),
        dueForReview: input.dueForReview,
      },
    };
  },
});

export const getExperiment = defineTool({
  name: 'get_experiment',
  title: 'Get experiment',
  description:
    'One experiment from the change log with its linked videos and tags, the baseline snapshot taken at start and the result snapshot taken at conclusion. A metric that was not measured is null in the snapshots, never zero.',
  inputSchema: { experimentId: z.string().uuid() },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireOwnedRow(
      context,
      'analytics_experiments',
      input.experimentId,
      'Experiment',
    );

    const data = await callService(() =>
      getExperimentService(context.principal.supabase, input),
    );

    return { structuredContent: { data } };
  },
});
