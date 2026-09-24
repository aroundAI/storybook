'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { canPerformProjectAction } from '@kit/projects/queries';
import { getLogger } from '@kit/shared/logger';
import {
  type StorageAdapter,
  deleteOwnedObject,
  getStorageAdapter,
} from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Schema for uploading a project intro
 */
const UploadProjectIntroSchema = z.object({
  projectId: z.string().uuid(),
  language: z.string().min(2).max(10),
  languageLabel: z.string().max(100).optional(),
  videoUrl: z.string().url(),
  durationSeconds: z.number().min(0.1).max(60), // Max 60 seconds for intros
  fileName: z.string().max(255).optional(),
  fileSizeBytes: z.number().int().positive().optional(),
  mimeType: z.string().max(100).optional(),
  thumbnailUrl: z.string().url().optional(),
});

export type UploadProjectIntroInput = z.infer<typeof UploadProjectIntroSchema>;

/**
 * Schema for deleting a project intro
 */
const DeleteProjectIntroSchema = z.object({
  introId: z.string().uuid(),
  projectId: z.string().uuid(), // For permission check
});

export type DeleteProjectIntroInput = z.infer<typeof DeleteProjectIntroSchema>;

/**
 * Schema for getting project intros
 */
const GetProjectIntrosSchema = z.object({
  projectId: z.string().uuid(),
});

export type GetProjectIntrosInput = z.infer<typeof GetProjectIntrosSchema>;

/**
 * Project intro data type
 */
export interface ProjectIntro {
  id: string;
  projectId: string;
  language: string;
  languageLabel: string | null;
  videoUrl: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Best-effort delete of an intro's stored file. Only a file inside this
 * project's folder: the URL came from the client, and on R2 the delete runs
 * with the app's own credentials (KB-54).
 */
async function removeIntroFile(
  storage: StorageAdapter,
  videoUrl: string,
  projectId: string,
  ctx: Record<string, unknown>,
) {
  const logger = await getLogger();
  const result = await deleteOwnedObject(
    storage,
    'project-assets',
    videoUrl,
    `projects/${projectId}/`,
  );

  if (result.deleted) {
    logger.info(
      { ...ctx, key: result.key },
      'Deleted intro video from storage',
    );
  } else {
    logger.warn(
      { ...ctx, videoUrl, reason: result.reason, error: result.error },
      'Intro video left in storage',
    );
  }
}

// ============================================================================
// Upload Project Intro Action
// ============================================================================

/**
 * Upload or update a project intro for a specific language
 *
 * This action handles upserting an intro - if an intro already exists
 * for the given project + language combination, it will be replaced.
 */
export const uploadProjectIntroAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: boolean; intro?: ProjectIntro; error?: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'intro.upload',
      projectId: data.projectId,
      language: data.language,
    };

    logger.info(ctx, 'Uploading project intro');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized intro upload attempt');
      throw new Error('Authentication required');
    }

    // Verify project edit permission
    const canEdit = await canPerformProjectAction(
      data.projectId,
      'project.edit',
    );
    if (!canEdit) {
      logger.warn(ctx, 'Insufficient permissions for intro upload');
      throw new Error('Insufficient permissions');
    }

    try {
      // Check if intro already exists for this project + language
      const { data: existingIntro } = await client
        .from('project_intros')
        .select('id, video_url')
        .eq('project_id', data.projectId)
        .eq('language', data.language)
        .single();

      // Upsert intro record
      const introData = {
        project_id: data.projectId,
        language: data.language,
        language_label: data.languageLabel || null,
        video_url: data.videoUrl,
        duration_seconds: data.durationSeconds,
        thumbnail_url: data.thumbnailUrl || null,
        file_name: data.fileName || null,
        file_size_bytes: data.fileSizeBytes || null,
        mime_type: data.mimeType || null,
        is_active: true,
        created_by: user.id,
      };

      const { data: intro, error: upsertError } = await client
        .from('project_intros')
        .upsert(introData, {
          onConflict: 'project_id,language',
        })
        .select()
        .single();

      if (upsertError) {
        logger.error({ ...ctx, error: upsertError }, 'Failed to upsert intro');
        throw new Error(`Failed to save intro: ${upsertError.message}`);
      }

      if (!intro) {
        throw new Error('Failed to save intro: no data returned');
      }

      // Only once the row points at the new file: had the save failed, the
      // row would still point at the old one (KB-54).
      if (
        existingIntro?.video_url &&
        existingIntro.video_url !== data.videoUrl
      ) {
        await removeIntroFile(
          getStorageAdapter(client),
          existingIntro.video_url,
          data.projectId,
          ctx,
        );
      }

      logger.info(ctx, 'Project intro uploaded successfully');

      // Revalidate project settings page
      revalidatePath('/home/[account]/studio/[projectSlug]/settings', 'page');

      return {
        success: true,
        intro: {
          id: intro.id,
          projectId: intro.project_id,
          language: intro.language,
          languageLabel: intro.language_label,
          videoUrl: intro.video_url,
          durationSeconds: Number(intro.duration_seconds),
          thumbnailUrl: intro.thumbnail_url,
          fileName: intro.file_name,
          fileSizeBytes: intro.file_size_bytes,
          mimeType: intro.mime_type,
          isActive: intro.is_active ?? false,
          createdAt: intro.created_at ?? '',
          updatedAt: intro.updated_at ?? '',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ ...ctx, error: message }, 'Intro upload failed');
      return { success: false, error: message };
    }
  },
  {
    schema: UploadProjectIntroSchema,
  },
);

// ============================================================================
// Delete Project Intro Action
// ============================================================================

/**
 * Delete a project intro
 */
export const deleteProjectIntroAction = enhanceAction(
  async (data): Promise<{ success: boolean; error?: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'intro.delete',
      introId: data.introId,
      projectId: data.projectId,
    };

    logger.info(ctx, 'Deleting project intro');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized intro delete attempt');
      throw new Error('Authentication required');
    }

    // Verify project edit permission
    const canEdit = await canPerformProjectAction(
      data.projectId,
      'project.edit',
    );
    if (!canEdit) {
      logger.warn(ctx, 'Insufficient permissions for intro delete');
      throw new Error('Insufficient permissions');
    }

    try {
      // Fetch intro to get video URL for storage cleanup
      const { data: intro, error: fetchError } = await client
        .from('project_intros')
        .select('video_url')
        .eq('id', data.introId)
        .eq('project_id', data.projectId)
        .single();

      if (fetchError || !intro) {
        throw new Error('Intro not found');
      }

      if (intro.video_url) {
        await removeIntroFile(
          getStorageAdapter(client),
          intro.video_url,
          data.projectId,
          ctx,
        );
      }

      // Delete from database
      const { error: deleteError } = await client
        .from('project_intros')
        .delete()
        .eq('id', data.introId);

      if (deleteError) {
        throw new Error(`Failed to delete intro: ${deleteError.message}`);
      }

      logger.info(ctx, 'Project intro deleted successfully');

      // Revalidate project settings page
      revalidatePath('/home/[account]/studio/[projectSlug]/settings', 'page');

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ ...ctx, error: message }, 'Intro delete failed');
      return { success: false, error: message };
    }
  },
  {
    schema: DeleteProjectIntroSchema,
  },
);

// ============================================================================
// Get Project Intros Action
// ============================================================================

/**
 * Get all intros for a project
 */
export const getProjectIntrosAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: boolean; intros?: ProjectIntro[]; error?: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'intro.getAll',
      projectId: data.projectId,
    };

    logger.info(ctx, 'Fetching project intros');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized intro fetch attempt');
      throw new Error('Authentication required');
    }

    try {
      const { data: intros, error: fetchError } = await client
        .from('project_intros')
        .select(
          `
                    id, project_id, language, language_label, video_url,
                    duration_seconds, thumbnail_url, file_name, file_size_bytes,
                    mime_type, is_active, created_at, updated_at
                `,
        )
        .eq('project_id', data.projectId)
        .order('language', { ascending: true });

      if (fetchError) {
        throw new Error(`Failed to fetch intros: ${fetchError.message}`);
      }

      logger.info(
        { ...ctx, count: intros?.length ?? 0 },
        'Project intros fetched',
      );

      return {
        success: true,
        intros: (intros ?? []).map((intro) => ({
          id: intro.id,
          projectId: intro.project_id,
          language: intro.language,
          languageLabel: intro.language_label,
          videoUrl: intro.video_url,
          durationSeconds: Number(intro.duration_seconds),
          thumbnailUrl: intro.thumbnail_url,
          fileName: intro.file_name,
          fileSizeBytes: intro.file_size_bytes,
          mimeType: intro.mime_type,
          isActive: intro.is_active ?? false,
          createdAt: intro.created_at ?? '',
          updatedAt: intro.updated_at ?? '',
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ ...ctx, error: message }, 'Intro fetch failed');
      return { success: false, error: message };
    }
  },
  {
    schema: GetProjectIntrosSchema,
  },
);
