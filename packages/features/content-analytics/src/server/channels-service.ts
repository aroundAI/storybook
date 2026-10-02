import 'server-only';

import { z } from 'zod';

import type { AnalyticsClient } from './analytics-client';
import { listAccountChannels, listProjectChannels } from './channels';
import { assertScopeAccess } from './scope-access';

export const ListChannelsSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
  })
  .refine((scope) => scope.projectId || scope.accountId, {
    message: 'projectId or accountId is required',
  });

export type ListChannelsInput = z.infer<typeof ListChannelsSchema>;

/**
 * The channels a project publishes to, or an account's channels, for the
 * Deep Dive channel filter (FILM-1611), as a service over the caller's
 * client (FILM-1906).
 *
 * It adds no query to `channels.ts`'s listers: the access check is what
 * stops a caller naming a project in another account and learning its
 * channel names. Inactive channels are included: a disconnected channel
 * still owns historical figures.
 */
export async function listChannelsService(
  client: AnalyticsClient,
  { projectId, accountId }: ListChannelsInput,
) {
  await assertScopeAccess(client, projectId ? { projectId } : { accountId });

  return projectId
    ? listProjectChannels(projectId, client)
    : listAccountChannels(accountId!, client);
}
