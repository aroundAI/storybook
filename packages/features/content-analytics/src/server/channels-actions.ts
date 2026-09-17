'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { listAccountChannels, listProjectChannels } from './channels';
import { assertScopeAccess } from './scope-access';

const ListChannelsSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
  })
  .refine((scope) => scope.projectId || scope.accountId, {
    message: 'projectId or accountId is required',
  });

/**
 * The channels a project publishes to, or an account's channels, for the
 * Deep Dive channel filter (FILM-1611).
 *
 * `channels.ts` is `server-only` with no `'use server'`, so a client component
 * cannot call its listers directly — this is the entry point, not a second
 * copy. It adds no query. Inactive channels are included: a disconnected
 * channel still owns historical figures.
 */
export const listChannelsAction = enhanceAction(
  async ({ projectId, accountId }) => {
    await assertScopeAccess(projectId ? { projectId } : { accountId });

    const client = getSupabaseServerClient();

    return projectId
      ? listProjectChannels(projectId, client)
      : listAccountChannels(accountId!, client);
  },
  {
    schema: ListChannelsSchema,
    auth: true,
  },
);
