'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AbandonChannelExperimentSchema,
  AddExperimentStyleSchema,
  AssignExperimentVideoSchema,
  ChannelExperimentIdSchema,
  ConcludeChannelExperimentSchema,
  CreateChannelExperimentSchema,
  ListChannelExperimentsSchema,
  RemoveExperimentStyleSchema,
  StartChannelExperimentSchema,
  UnassignExperimentVideoSchema,
} from '../lib/schemas/channel-experiment.schema';
import {
  abandonChannelExperimentService,
  addExperimentStyleService,
  assignExperimentVideoService,
  concludeChannelExperimentService,
  createChannelExperimentService,
  deleteChannelExperimentService,
  getChannelExperimentService,
  listAssignableVideosService,
  listChannelExperimentsService,
  removeExperimentStyleService,
  startChannelExperimentService,
  unassignExperimentVideoService,
} from './channel-experiment-service';
import { withRefusals } from './with-refusals';

/**
 * Channel experiments (FILM-1724): each action is the cookie-session wrapper
 * over its service in `channel-experiment-service.ts` (FILM-1906), which
 * holds the reads, the lifecycle rules and the table's refusals.
 */

export const listChannelExperimentsAction = enhanceAction(
  async (data) =>
    listChannelExperimentsService(getSupabaseServerClient(), data),
  { schema: ListChannelExperimentsSchema, auth: true },
);

export const getChannelExperimentAction = withRefusals(
  'load the experiment',
  enhanceAction(
    async (data) =>
      getChannelExperimentService(getSupabaseServerClient(), data),
    { schema: ChannelExperimentIdSchema, auth: true },
  ),
);

export const createChannelExperimentAction = withRefusals(
  'create the experiment',
  enhanceAction(
    async (data) =>
      createChannelExperimentService(getSupabaseServerClient(), data),
    { schema: CreateChannelExperimentSchema, auth: true },
  ),
);

export const startChannelExperimentAction = withRefusals(
  'start the experiment',
  enhanceAction(
    async (data) =>
      startChannelExperimentService(getSupabaseServerClient(), data),
    { schema: StartChannelExperimentSchema, auth: true },
  ),
);

export const addExperimentStyleAction = withRefusals(
  'add the style',
  enhanceAction(
    async (data) => addExperimentStyleService(getSupabaseServerClient(), data),
    { schema: AddExperimentStyleSchema, auth: true },
  ),
);

export const removeExperimentStyleAction = withRefusals(
  'remove the style',
  enhanceAction(
    async (data) =>
      removeExperimentStyleService(getSupabaseServerClient(), data),
    { schema: RemoveExperimentStyleSchema, auth: true },
  ),
);

export const assignExperimentVideoAction = withRefusals(
  'assign the video',
  enhanceAction(
    async (data) =>
      assignExperimentVideoService(getSupabaseServerClient(), data),
    { schema: AssignExperimentVideoSchema, auth: true },
  ),
);

export const unassignExperimentVideoAction = withRefusals(
  'remove the video',
  enhanceAction(
    async (data) =>
      unassignExperimentVideoService(getSupabaseServerClient(), data),
    { schema: UnassignExperimentVideoSchema, auth: true },
  ),
);

/**
 * Videos that can join the experiment now, newest first, at most 100.
 */
export const listAssignableVideosAction = withRefusals(
  'list the videos',
  enhanceAction(
    async (data) =>
      listAssignableVideosService(getSupabaseServerClient(), data),
    { schema: ChannelExperimentIdSchema, auth: true },
  ),
);

/**
 * Ends the experiment with what the user concluded, and freezes the
 * per-style results as they stand.
 */
export const concludeChannelExperimentAction = withRefusals(
  'conclude the experiment',
  enhanceAction(
    async (data) =>
      concludeChannelExperimentService(getSupabaseServerClient(), data),
    { schema: ConcludeChannelExperimentSchema, auth: true },
  ),
);

export const abandonChannelExperimentAction = withRefusals(
  'abandon the experiment',
  enhanceAction(
    async (data) =>
      abandonChannelExperimentService(getSupabaseServerClient(), data),
    { schema: AbandonChannelExperimentSchema, auth: true },
  ),
);

export const deleteChannelExperimentAction = withRefusals(
  'delete the experiment',
  enhanceAction(
    async (data) =>
      deleteChannelExperimentService(getSupabaseServerClient(), data),
    { schema: ChannelExperimentIdSchema, auth: true },
  ),
);
