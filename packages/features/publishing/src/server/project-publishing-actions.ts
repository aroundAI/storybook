'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// Types
// =============================================================================

export interface ProjectPublishingConfig {
  id: string;
  projectId: string;
  platformConnectionId: string;
  language: string;
  defaultTitleSuffix: string | null;
  defaultDescriptionTemplate: string | null;
  defaultTags: string[] | null;
  isEnabled: boolean;
  // Joined from platform_connections
  platform?: string;
  platformAccountName?: string;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Get all publishing configs for a project
 */
export async function getProjectPublishingConfigs(
  projectId: string,
): Promise<ProjectPublishingConfig[]> {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('project_publishing_configs')
    .select(
      `
      id,
      project_id,
      platform_connection_id,
      language,
      default_title_suffix,
      default_description_template,
      default_tags,
      is_enabled,
      platform_connections!inner (
        platform,
        platform_account_name
      )
    `,
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch configs: ${error.message}`);
  }

  return (data ?? []).map(
    (row: {
      id: string;
      project_id: string;
      platform_connection_id: string;
      language: string;
      default_title_suffix: string | null;
      default_description_template: string | null;
      default_tags: string[] | null;
      is_enabled: boolean;
      platform_connections: {
        platform: string;
        platform_account_name: string | null;
      };
    }) => ({
      id: row.id,
      projectId: row.project_id,
      platformConnectionId: row.platform_connection_id,
      language: row.language,
      defaultTitleSuffix: row.default_title_suffix,
      defaultDescriptionTemplate: row.default_description_template,
      defaultTags: row.default_tags,
      isEnabled: row.is_enabled,
      platform: row.platform_connections?.platform,
      platformAccountName: row.platform_connections?.platform_account_name,
    }),
  );
}

// =============================================================================
// Actions
// =============================================================================

const UpdateProjectPublishingConfigSchema = z.object({
  projectId: z.string().uuid(),
  configs: z.array(
    z.object({
      id: z.string().uuid().optional(),
      platformConnectionId: z.string().uuid(),
      language: z.enum(['en', 'hi', 'es', 'pt']),
      isEnabled: z.boolean(),
      defaultTitleSuffix: z.string().max(100).optional().nullable(),
      defaultDescriptionTemplate: z.string().optional().nullable(),
      defaultTags: z.array(z.string()).optional().nullable(),
    }),
  ),
});

/**
 * Update publishing configs for a project
 */
export const updateProjectPublishingConfigsAction = enhanceAction(
  async (
    input: z.infer<typeof UpdateProjectPublishingConfigSchema>,
  ): Promise<{ success: boolean; error?: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'publishing.updateProjectConfigs',
      projectId: input.projectId,
    };

    logger.info(ctx, 'Updating project publishing configs');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    try {
      // Get existing configs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (client as any)
        .from('project_publishing_configs')
        .select('id')
        .eq('project_id', input.projectId);

      const existingIds = new Set<string>(
        (existing ?? []).map((e: { id: string }) => e.id),
      );
      const inputIds = new Set(
        input.configs.filter((c) => c.id).map((c) => c.id),
      );

      // Delete removed configs
      const toDelete = [...existingIds].filter(
        (id) => !inputIds.has(id),
      ) as string[];
      if (toDelete.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('project_publishing_configs')
          .delete()
          .in('id', toDelete);
      }

      // Upsert configs
      for (const config of input.configs) {
        if (config.id && existingIds.has(config.id)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any)
            .from('project_publishing_configs')
            .update({
              platform_connection_id: config.platformConnectionId,
              language: config.language,
              is_enabled: config.isEnabled,
              default_title_suffix: config.defaultTitleSuffix ?? null,
              default_description_template:
                config.defaultDescriptionTemplate ?? null,
              default_tags: config.defaultTags ?? null,
            })
            .eq('id', config.id);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any).from('project_publishing_configs').insert({
            project_id: input.projectId,
            platform_connection_id: config.platformConnectionId,
            language: config.language,
            is_enabled: config.isEnabled,
            default_title_suffix: config.defaultTitleSuffix ?? null,
            default_description_template:
              config.defaultDescriptionTemplate ?? null,
            default_tags: config.defaultTags ?? null,
          });
        }
      }

      logger.info(
        { ...ctx, configCount: input.configs.length },
        'Configs updated',
      );

      revalidatePath('/home/[account]/studio', 'layout');

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ ...ctx, error: message }, 'Failed to update configs');
      return { success: false, error: message };
    }
  },
  {
    schema: UpdateProjectPublishingConfigSchema,
  },
);
