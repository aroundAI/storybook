import 'server-only';

import { z } from 'zod';

import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';

import { SYNCED_PLATFORMS, type SyncStatusResponse } from '../lib/sync-status';
import type { AnalyticsClient } from './analytics-client';
import { type SyncStatusRow, toSyncStatus } from './sync-status';

export const GetSyncStatusSchema = z.union([
  z.object({ episodeId: z.string().uuid() }),
  z.object({ publishIds: z.array(z.string().uuid()).min(1).max(500) }),
]);

export type GetSyncStatusInput = z.infer<typeof GetSyncStatusSchema>;

/**
 * Each synced publish's analytics sync record (KB-150): when its figures were
 * last refreshed, whether the latest attempt failed and why, and whether the
 * schedule will try again. For one episode's publishes (the episode
 * analytics page) or a list of them (the Video Log's page of rows).
 *
 * Read on the caller's client, so RLS decides which publishes the caller
 * sees (FILM-1906). A failed read throws, and the action's `withRefusals`
 * returns it as a refusal, never as an empty list: "no sync record" and
 * "could not read the sync record" are different answers.
 */
export async function getSyncStatusService(
  client: AnalyticsClient,
  data: GetSyncStatusInput,
): Promise<SyncStatusResponse[]> {
  const select = () =>
    client
      .from('publishes')
      .select(
        'id, platform, metadata, platform_connections!publishes_platform_connection_id_fkey(scopes, metadata, disconnected_at)',
      )
      .eq('status', 'published')
      .not('platform_content_id', 'is', null)
      .in('platform', [...SYNCED_PLATFORMS]);

  const rows =
    'episodeId' in data
      ? await fetchAllRows<SyncStatusRow>(
          (from, to) =>
            select()
              .eq('episode_id', data.episodeId)
              .order('id')
              .range(from, to),
          'episode sync status',
        )
      : await fetchAllByIds<SyncStatusRow>(
          data.publishIds,
          (chunk, from, to) =>
            select().in('id', chunk).order('id').range(from, to),
          'publish sync status',
        );

  return rows.map(toSyncStatus);
}
