'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { UpdateStudioSettingsSchema } from '../schemas/studio-settings.schema';

/**
 * Update studio settings for a project
 *
 * Updates the project's metadata JSONB field with content generation settings:
 * - targetAudience
 * - genre
 * - videoStyle
 * - contentStyle
 * - defaultEpisodeDuration
 * - contentRating
 * - language
 */
export const updateStudioSettingsAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'studio.updateSettings',
      projectId: data.projectId,
    };

    logger.info(ctx, 'Updating studio settings');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized settings update attempt');
      throw new Error('Authentication required');
    }

    // Fetch current project
    const { data: project, error: fetchError } = await client
      .from('projects')
      .select('*')
      .eq('id', data.projectId)
      .single();

    if (fetchError || !project) {
      logger.error({ ...ctx, error: fetchError }, 'Project not found');
      throw new Error('Project not found');
    }

    // Merge new settings with existing metadata
    const existingMetadata =
      (project.metadata as Record<string, unknown>) || {};
    const updatedMetadata: Record<string, unknown> = {
      ...existingMetadata,
    };

    // Only update fields that were provided
    if (data.targetAudience !== undefined) {
      updatedMetadata.targetAudience = data.targetAudience;
    }
    if (data.genre !== undefined) {
      updatedMetadata.genre = data.genre;
    }
    if (data.videoStyle !== undefined) {
      updatedMetadata.videoStyle = data.videoStyle;
    }
    if (data.contentStyle !== undefined) {
      updatedMetadata.contentStyle = data.contentStyle;
    }
    if (data.defaultEpisodeDuration !== undefined) {
      updatedMetadata.defaultEpisodeDuration = data.defaultEpisodeDuration;
    }
    if (data.contentRating !== undefined) {
      updatedMetadata.contentRating = data.contentRating;
    }
    if (data.language !== undefined) {
      updatedMetadata.language = data.language;
    }
    if (data.recurringElement !== undefined) {
      updatedMetadata.recurringElement = data.recurringElement;
    }

    // Update project metadata
    const { data: updatedProject, error: updateError } = await client
      .from('projects')
      .update({
        metadata: updatedMetadata as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.projectId)
      .select()
      .single();

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update settings');
      throw new Error(`Failed to update settings: ${updateError.message}`);
    }

    // Create audit log
    const networkContext = await extractNetworkContext();

    await createAuditLog({
      accountId: project.account_id,
      userId: user.id,
      action: 'update',
      objectType: 'project',
      objectId: project.id,
      objectName: project.name,
      before: { metadata: existingMetadata },
      after: { metadata: updatedMetadata },
      scopes: [
        { type: 'account', id: project.account_id },
        { type: 'project', id: project.id },
      ],
      metadata: {
        operation: 'studio_settings_update',
      },
      ...networkContext,
    });

    logger.info(ctx, 'Studio settings updated successfully');

    // Revalidate paths
    revalidatePath(`/home/[account]/studio/${data.projectId}`, 'page');
    revalidatePath(`/home/[account]/studio/${data.projectId}/settings`, 'page');

    return {
      success: true,
      data: {
        projectId: updatedProject.id,
        metadata: updatedMetadata,
      },
    };
  },
  {
    schema: UpdateStudioSettingsSchema,
  },
);
