'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const UpdateCanonSettingsSchema = z.object({
  projectId: z.string().uuid(),
  settings: z.object({
    enabled: z.boolean(),
    roleSeparation: z.boolean(),
    memoryHorizon: z.number().min(1).max(20),
    enforcement: z.enum(['flexible', 'strict']),
    contentType: z.enum(['series', 'movie', 'factual', 'news']),
  }),
});

export const updateCanonSettingsAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    // Get current project metadata
    const { data: project, error: fetchError } = await client
      .from('projects')
      .select('metadata')
      .eq('id', data.projectId)
      .single();

    if (fetchError || !project) {
      throw new Error('Project not found');
    }

    // Merge canon settings into existing metadata
    const currentMetadata = (project.metadata ?? {}) as Record<string, unknown>;
    const updatedMetadata = {
      ...currentMetadata,
      canon: data.settings,
    };

    // Update project
    const { error: updateError } = await client
      .from('projects')
      .update({
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.projectId);

    if (updateError) {
      throw new Error('Failed to update canon settings');
    }

    return { success: true };
  },
  {
    schema: UpdateCanonSettingsSchema,
  },
);
