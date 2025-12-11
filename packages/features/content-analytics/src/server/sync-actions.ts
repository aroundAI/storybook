'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { syncSinglePublishById } from './analytics-sync-cron';
import type { PublishMetadata, SyncResult, SyncStatusResponse } from './types';

/**
 * Schema for manual sync action
 */
const ManualSyncSchema = z.object({
  publishId: z.string().uuid(),
});

/**
 * Schema for get sync status action
 */
const GetSyncStatusSchema = z.object({
  publishId: z.string().uuid(),
});

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

    if (error || !publish) {
      return {
        publishId: data.publishId,
        success: false,
        error: 'Publish not found or access denied',
        errorType: 'not_found',
      };
    }

    // Sync the publish
    return syncSinglePublishById(data.publishId);
  },
  {
    auth: true,
    schema: ManualSyncSchema,
  },
);

/**
 * Gets the sync status for a specific publish.
 *
 * @param data - Contains publishId to check
 * @returns Current sync status including last sync time and errors
 */
export const getSyncStatusAction = enhanceAction(
  async function (data): Promise<SyncStatusResponse | null> {
    const client = getSupabaseServerClient();

    // Fetch publish with metadata
    const { data: publish, error } = await client
      .from('publishes')
      .select('id, platform, metadata')
      .eq('id', data.publishId)
      .single();

    if (error || !publish) {
      return null;
    }

    const metadata = publish.metadata as PublishMetadata | null;
    const syncMeta = metadata?.sync;

    return {
      publishId: publish.id,
      platform: publish.platform,
      lastSyncedAt: syncMeta?.last_synced_at ?? null,
      lastSyncStatus: syncMeta?.last_sync_status ?? null,
      lastError: syncMeta?.last_error ?? null,
      consecutiveFailures: syncMeta?.consecutive_failures ?? 0,
      requiresReauth: syncMeta?.requires_reauth ?? false,
    };
  },
  {
    auth: true,
    schema: GetSyncStatusSchema,
  },
);
