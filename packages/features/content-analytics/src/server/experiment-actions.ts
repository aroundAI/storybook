'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AbandonExperimentSchema,
  ConcludeExperimentSchema,
  CreateExperimentSchema,
  DeleteExperimentSchema,
  GetExperimentSchema,
  ListExperimentsDueSchema,
  ListExperimentsSchema,
  ListLinkablePublishesSchema,
  StartExperimentSchema,
  UpdateExperimentSchema,
} from '../lib/schemas/experiment.schema';
import {
  abandonExperimentService,
  concludeExperimentService,
  createExperimentService,
  deleteExperimentService,
  getExperimentService,
  listExperimentsDueForReviewService,
  listExperimentsService,
  listLinkablePublishesService,
  startExperimentService,
  updateExperimentService,
} from './experiment-service';
import { withRefusals } from './with-refusals';

export type { ExperimentSnapshot } from './experiment-service';

/**
 * The Change Log's actions (FILM-1610): each is the cookie-session wrapper
 * over its service in `experiment-service.ts` (FILM-1906), which holds the
 * logic, the lifecycle rules and the reasoning behind them.
 */

export const createExperimentAction = withRefusals(
  'log the change',
  enhanceAction(
    async (data) => createExperimentService(getSupabaseServerClient(), data),
    { schema: CreateExperimentSchema, auth: true },
  ),
);

export const updateExperimentAction = withRefusals(
  'save the change',
  enhanceAction(
    async (data) => updateExperimentService(getSupabaseServerClient(), data),
    { schema: UpdateExperimentSchema, auth: true },
  ),
);

/**
 * Marks an experiment running and snapshots the linked content's metrics
 * as the baseline to compare against later.
 */
export const startExperimentAction = withRefusals(
  'start the change',
  enhanceAction(
    async (data) => startExperimentService(getSupabaseServerClient(), data),
    { schema: StartExperimentSchema, auth: true },
  ),
);

/**
 * Concludes an experiment, snapshotting results. The actual outcome is
 * required — an experiment without a recorded result teaches nothing.
 */
export const concludeExperimentAction = withRefusals(
  'conclude the change',
  enhanceAction(
    async (data) => concludeExperimentService(getSupabaseServerClient(), data),
    { schema: ConcludeExperimentSchema, auth: true },
  ),
);

export const abandonExperimentAction = withRefusals(
  'abandon the change',
  enhanceAction(
    async (data) => abandonExperimentService(getSupabaseServerClient(), data),
    { schema: AbandonExperimentSchema, auth: true },
  ),
);

/**
 * Running experiments whose review date has arrived, soonest first.
 */
export const listExperimentsDueForReviewAction = enhanceAction(
  async (data) =>
    listExperimentsDueForReviewService(getSupabaseServerClient(), data),
  { schema: ListExperimentsDueSchema, auth: true },
);

/**
 * The account's published videos matching a title search, newest first.
 */
export const listLinkablePublishesAction = enhanceAction(
  async (data) => listLinkablePublishesService(getSupabaseServerClient(), data),
  { schema: ListLinkablePublishesSchema, auth: true },
);

/**
 * The account's experiments, newest first.
 */
export const listExperimentsAction = enhanceAction(
  async (data) => listExperimentsService(getSupabaseServerClient(), data),
  { schema: ListExperimentsSchema, auth: true },
);

export const getExperimentAction = enhanceAction(
  async (data) => getExperimentService(getSupabaseServerClient(), data),
  { schema: GetExperimentSchema, auth: true },
);

export const deleteExperimentAction = withRefusals(
  'delete the change',
  enhanceAction(
    async (data) => deleteExperimentService(getSupabaseServerClient(), data),
    { schema: DeleteExperimentSchema, auth: true },
  ),
);
