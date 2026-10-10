'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// Actions
// =============================================================================

const SetProjectChannelsSchema = z.object({
  projectId: z.string().uuid(),
  connectionIds: z.array(z.string().uuid()),
});

const REFUSED = "You can't change this project's channels.";

/**
 * Sets the channels a project publishes to: exactly `connectionIds`.
 */
export const setProjectChannelsAction = enhanceAction(
  async ({
    projectId,
    connectionIds,
  }): Promise<{ success: boolean; error?: string }> => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.setProjectChannels', projectId };
    const client = getSupabaseServerClient();
    const chosen = new Set(connectionIds);

    try {
      const { data: existing, error: readError } = await client
        .from('project_publishing_configs')
        .select('id, platform_connection_id')
        .eq('project_id', projectId);

      if (readError) throw readError;

      const toDelete = existing
        .filter((row) => !chosen.has(row.platform_connection_id))
        .map((row) => row.id);

      if (toDelete.length > 0) {
        const { data: deleted, error } = await client
          .from('project_publishing_configs')
          .delete()
          .in('id', toDelete)
          .select('id');

        if (error) throw error;
        // RLS answers a refused write with no rows and no error (KB-105).
        if (deleted.length !== toDelete.length) throw new Error(REFUSED);
      }

      if (chosen.size > 0) {
        const { data: saved, error } = await client
          .from('project_publishing_configs')
          .upsert(
            [...chosen].map((platform_connection_id) => ({
              project_id: projectId,
              platform_connection_id,
              is_enabled: true,
            })),
            { onConflict: 'project_id,platform_connection_id' },
          )
          .select('id');

        if (error) throw error;
        if (saved.length !== chosen.size) throw new Error(REFUSED);
      }

      logger.info({ ...ctx, count: chosen.size }, 'Project channels set');

      revalidatePath('/home/[account]/studio', 'layout');

      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : ((error as { message?: string }).message ?? 'Unknown error');
      logger.error(
        { ...ctx, error: message },
        'Failed to set project channels',
      );
      return { success: false, error: message };
    }
  },
  {
    schema: SetProjectChannelsSchema,
  },
);
