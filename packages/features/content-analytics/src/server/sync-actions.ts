'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { readFailed, whyNoRow } from '@kit/shared/rows';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { SYNCED_PLATFORMS, type SyncStatusResponse } from '../lib/sync-status';
import { syncSinglePublishById } from './analytics-sync-cron';
import { type SyncStatusRow, toSyncStatus } from './sync-status';
import type { SyncResult } from './types';
import { withRefusals } from './with-refusals';

/**
 * Schema for manual sync action
 */
const ManualSyncSchema = z.object({
  publishId: z.string().uuid(),
});

/**
 * Schema for get sync status action
 */
const GetSyncStatusSchema = z.union([
  z.object({ episodeId: z.string().uuid() }),
  z.object({ publishIds: z.array(z.string().uuid()).min(1).max(500) }),
]);

/**
 * Triggers an immediate analytics sync for a specific publish.
 *
 * @param data - Contains publishId to sync
 * @returns Sync result with success status and metrics
 */
export const manualSyncAction = enhanceAction(
  async function (data): Promise<SyncResult> {
    const client = getSupabaseServerClient();

    // Verify user has access to this publish via project membership
    const { data: publish, error } = await client
      .from('publishes')
      .select(
        `
        id,
        episodes!inner (
          project_id,
          projects!inner (
            account_id
          )
        )
      `,
      )
      .eq('id', data.publishId)
      .single();

    if (readFailed(error)) {
      throw new Error(whyNoRow(error, 'Publish not found or access denied'));
    }

    if (error || !publish) {
      return {
        publishId: data.publishId,
        success: false,
        error: 'Publish not found or access denied',
        errorType: 'not_found',
      };
    }

    const result = await syncSinglePublishById(data.publishId);

    revalidatePath(
      `/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]`,
      'page',
    );

    return result;
  },
  {
    auth: true,
    schema: ManualSyncSchema,
  },
);

/**
 * Each synced publish's analytics sync record (KB-150): when its figures were
 * last refreshed, whether the latest attempt failed and why, and whether the
 * schedule will try again. For one episode's publishes (the episode
 * analytics page) or a list of them (the Video Log's page of rows).
 *
 * Read on the user-scoped client, so RLS decides which publishes the caller
 * sees. A failed read is returned as a refusal, never as an empty list: "no
 * sync record" and "could not read the sync record" are different answers.
 */
export const getSyncStatusAction = withRefusals(
  'load the analytics sync status',
  enhanceAction(
    async function (data): Promise<SyncStatusResponse[]> {
      const client = getSupabaseServerClient();

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
    },
    {
      auth: true,
      schema: GetSyncStatusSchema,
    },
  ),
);
