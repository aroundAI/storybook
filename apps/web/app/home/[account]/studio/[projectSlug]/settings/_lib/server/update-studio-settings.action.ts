'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { requireRow, returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { mergeStudioSettings } from '@kit/projects/service';

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
const updateStudioSettings = enhanceAction(
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
    const project = requireRow(
      await client
        .from('projects')
        .select(
          `
        id, name, slug, description, account_id, metadata, status, visibility,
        created_at, updated_at
      `,
        )
        .eq('id', data.projectId)
        .single(),
      'Project not found',
    );

    // Merge new settings with existing metadata: one key per field, the
    // same merge the MCP update_project tool applies (project.service.ts)
    const existingMetadata =
      (project.metadata as Record<string, unknown>) || {};
    const updatedMetadata = mergeStudioSettings(existingMetadata, data);

    // Update project metadata and description
    const updatePayload: Record<string, unknown> = {
      metadata: updatedMetadata as Json,
      updated_at: new Date().toISOString(),
    };

    // Description is a direct column, not part of metadata
    if (data.description !== undefined) {
      updatePayload.description = data.description;
    }

    const { data: updatedProject, error: updateError } = await client
      .from('projects')
      .update(updatePayload)
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

export const updateStudioSettingsAction = returnRefusals(updateStudioSettings);
