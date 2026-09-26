'use server';

import { z } from 'zod';

import { MAX_MEMORY_HORIZON, MIN_MEMORY_HORIZON } from '@kit/episodes/lib';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const UpdateCanonSettingsSchema = z.object({
  projectId: z.string().uuid(),
  settings: z.object({
    enabled: z.boolean(),
    roleSeparation: z.boolean(),
    // null = automatic: the project's content type decides (FILM-1110)
    memoryHorizon: z
      .number()
      .int()
      .min(MIN_MEMORY_HORIZON)
      .max(MAX_MEMORY_HORIZON)
      .nullable(),
    enforcement: z.enum(['flexible', 'strict']),
  }),
});

const updateCanonSettings = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // Get current project metadata
    const { data: project, error: fetchError } = await client
      .from('projects')
      .select('metadata')
      .eq('id', data.projectId)
      .single();

    if (fetchError || !project) {
      throw new ActionRefusal('Project not found');
    }

    // Merge canon settings into existing metadata
    const currentMetadata = (project.metadata ?? {}) as Record<string, unknown>;
    const updatedMetadata = {
      ...currentMetadata,
      canon: {
        ...data.settings,
        memoryHorizonMode:
          data.settings.memoryHorizon === null ? 'automatic' : 'custom',
      },
    };

    // Update project
    const { data: updated, error: updateError } = await client
      .from('projects')
      .update({
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.projectId)
      .select('id');

    if (updateError) {
      throw new Error('Failed to update canon settings');
    }

    requireAffectedRows(
      updated,
      "You can't change this project's canon settings.",
    );

    return { success: true };
  },
  {
    schema: UpdateCanonSettingsSchema,
  },
);

export const updateCanonSettingsAction = returnRefusals(updateCanonSettings);
