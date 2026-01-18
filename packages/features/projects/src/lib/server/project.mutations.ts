'use server';

import { revalidatePath } from 'next/cache';

/**
 * Update project audio settings
 * Used to configure per-project audio generation models (TTS, SFX, Music)
 */
import { z } from 'zod';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AddProjectMemberSchema,
  CreateProjectSchema,
  DeleteProjectSchema,
  RemoveProjectMemberSchema,
  UpdateProjectMemberSchema,
  UpdateProjectSchema,
} from '../schemas/project.schema';
import type {
  AddProjectMemberParams,
  CreateProjectParams,
  RemoveProjectMemberParams,
  UpdateProjectMemberParams,
  UpdateProjectParams,
} from '../types';
import {
  invalidateAccountProjectsCache,
  invalidateProjectCache,
  invalidateProjectMembersCache,
} from './cache-invalidation';

/**
 * Create a new project
 */
export const createProjectAction = enhanceAction(
  async (data: CreateProjectParams) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.create', data };

    logger.info(ctx, 'Creating project');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Insert project
    const { data: project, error: projectError } = await client
      .from('projects')
      .insert({
        account_id: data.account_id,
        name: data.name,
        description: data.description,
        slug: data.slug,
        metadata: (data.metadata as Json) || ({} as Json),
      })
      .select()
      .single();

    if (projectError) {
      logger.error({ ...ctx, error: projectError }, 'Failed to create project');
      throw new Error(`Failed to create project: ${projectError.message}`);
    }

    // Note: Project creator is automatically added as owner via database trigger
    logger.info(
      { ...ctx, projectId: project.id },
      'Project created successfully',
    );

    // Create audit log with network context
    const networkContext = await extractNetworkContext();

    await createAuditLog({
      accountId: data.account_id,
      userId: user.id,
      action: 'create',
      objectType: 'project',
      objectId: project.id,
      objectName: project.name,
      after: project,
      scopes: [
        { type: 'account', id: data.account_id },
        { type: 'project', id: project.id },
      ],
      ...networkContext,
    });

    // Invalidate cache
    await invalidateAccountProjectsCache(data.account_id);

    // Revalidate the projects list
    revalidatePath(`/home/[account]/projects`, 'page');
    revalidatePath(`/home/(user)/projects`, 'page');

    return { success: true, data: project };
  },
  {
    schema: CreateProjectSchema,
  },
);

/**
 * Update an existing project
 */
export const updateProjectAction = enhanceAction(
  async (data: UpdateProjectParams) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.update', projectId: data.id };

    logger.info(ctx, 'Updating project');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch before state for audit log
    const { data: beforeProject } = await client
      .from('projects')
      .select(
        `
        id, name, slug, description, account_id, metadata, status, visibility,
        audio_settings, created_by, updated_by, public_slug, seo_metadata,
        created_at, updated_at
      `,
      )
      .eq('id', data.id)
      .single();

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.slug !== undefined) updateData.slug = data.slug;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.metadata !== undefined)
      updateData.metadata = data.metadata as Json;

    const { data: project, error } = await client
      .from('projects')
      .update(updateData)
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update project');
      throw new Error(`Failed to update project: ${error.message}`);
    }

    logger.info(ctx, 'Project updated successfully');

    // Create audit log with before/after states
    if (beforeProject) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: project.account_id,
        userId: user.id,
        action: 'update',
        objectType: 'project',
        objectId: project.id,
        objectName: project.name,
        before: beforeProject,
        after: project,
        scopes: [
          { type: 'account', id: project.account_id },
          { type: 'project', id: project.id },
        ],
        ...networkContext,
      });
    }

    // Invalidate cache
    await invalidateProjectCache(data.id, project.account_id);

    // Revalidate the projects list and detail pages
    revalidatePath(`/home/[account]/projects`, 'page');
    revalidatePath(`/home/(user)/projects`, 'page');
    revalidatePath(`/home/[account]/projects/${data.id}`, 'page');

    return { success: true, data: project };
  },
  {
    schema: UpdateProjectSchema,
  },
);

/**
 * Delete a project
 */
export const deleteProjectAction = enhanceAction(
  async (data: { id: string }) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.delete', projectId: data.id };

    logger.info(ctx, 'Deleting project');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch before state for audit log
    const { data: project } = await client
      .from('projects')
      .select(
        `
        id, name, slug, description, account_id, metadata, status, visibility,
        audio_settings, created_by, updated_by, public_slug, seo_metadata,
        created_at, updated_at
      `,
      )
      .eq('id', data.id)
      .single();

    const { error } = await client.from('projects').delete().eq('id', data.id);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete project');
      throw new Error(`Failed to delete project: ${error.message}`);
    }

    logger.info(ctx, 'Project deleted successfully');

    // Create audit log
    if (project) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: project.account_id,
        userId: user.id,
        action: 'delete',
        objectType: 'project',
        objectId: project.id,
        objectName: project.name,
        before: project,
        scopes: [{ type: 'account', id: project.account_id }],
        ...networkContext,
      });
    }

    // Invalidate cache
    if (project) {
      await invalidateProjectCache(data.id, project.account_id);
    }

    // Revalidate the projects list
    revalidatePath(`/home/[account]/projects`, 'page');
    revalidatePath(`/home/(user)/projects`, 'page');

    return { success: true };
  },
  {
    schema: DeleteProjectSchema,
  },
);

/**
 * Add a member to a project
 */
export const addProjectMemberAction = enhanceAction(
  async (data: AddProjectMemberParams) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.addMember', projectId: data.project_id };

    logger.info(ctx, 'Adding project member');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Get project info for audit log
    const { data: project } = await client
      .from('projects')
      .select('account_id, name')
      .eq('id', data.project_id)
      .single();

    const { data: member, error } = await client
      .from('project_members')
      .insert({
        project_id: data.project_id,
        user_id: data.user_id,
        role: data.role,
      })
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to add project member');
      throw new Error(`Failed to add project member: ${error.message}`);
    }

    logger.info(
      { ...ctx, userId: data.user_id },
      'Project member added successfully',
    );

    // Create audit log
    if (project) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: project.account_id,
        userId: user.id,
        action: 'create',
        objectType: 'team_member',
        objectId: `${data.project_id}-${data.user_id}`,
        objectName: `Project member in ${project.name}`,
        after: member,
        scopes: [
          { type: 'account', id: project.account_id },
          { type: 'project', id: data.project_id },
        ],
        ...networkContext,
      });
    }

    // Invalidate cache
    await invalidateProjectMembersCache(data.project_id);

    // Revalidate the project detail pages
    revalidatePath(`/home/[account]/projects/${data.project_id}`, 'page');
    revalidatePath(`/home/(user)/projects/${data.project_id}`, 'page');

    return { success: true, data: member };
  },
  {
    schema: AddProjectMemberSchema,
  },
);

/**
 * Update a project member's role
 */
export const updateProjectMemberAction = enhanceAction(
  async (data: UpdateProjectMemberParams) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.updateMember', projectId: data.project_id };

    logger.info(ctx, 'Updating project member role');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Get project info and before state
    const { data: project } = await client
      .from('projects')
      .select('account_id, name')
      .eq('id', data.project_id)
      .single();

    const { data: beforeMember } = await client
      .from('project_members')
      .select('id, project_id, user_id, role, created_at, updated_at')
      .eq('project_id', data.project_id)
      .eq('user_id', data.user_id)
      .single();

    const { data: member, error } = await client
      .from('project_members')
      .update({ role: data.role })
      .eq('project_id', data.project_id)
      .eq('user_id', data.user_id)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update project member');
      throw new Error(`Failed to update project member: ${error.message}`);
    }

    logger.info(
      { ...ctx, userId: data.user_id },
      'Project member updated successfully',
    );

    // Create audit log
    if (project && beforeMember) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: project.account_id,
        userId: user.id,
        action: 'permission_change',
        objectType: 'team_member',
        objectId: `${data.project_id}-${data.user_id}`,
        objectName: `Project member in ${project.name}`,
        before: beforeMember,
        after: member,
        scopes: [
          { type: 'account', id: project.account_id },
          { type: 'project', id: data.project_id },
        ],
        ...networkContext,
      });
    }

    // Invalidate cache
    await invalidateProjectMembersCache(data.project_id);

    // Revalidate the project detail pages
    revalidatePath(`/home/[account]/projects/${data.project_id}`, 'page');
    revalidatePath(`/home/(user)/projects/${data.project_id}`, 'page');

    return { success: true, data: member };
  },
  {
    schema: UpdateProjectMemberSchema,
  },
);

/**
 * Remove a member from a project
 */
export const removeProjectMemberAction = enhanceAction(
  async (data: RemoveProjectMemberParams) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.removeMember', projectId: data.project_id };

    logger.info(ctx, 'Removing project member');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Get project info and before state
    const { data: project } = await client
      .from('projects')
      .select('account_id, name')
      .eq('id', data.project_id)
      .single();

    const { data: member } = await client
      .from('project_members')
      .select('id, project_id, user_id, role, created_at, updated_at')
      .eq('project_id', data.project_id)
      .eq('user_id', data.user_id)
      .single();

    const { error } = await client
      .from('project_members')
      .delete()
      .eq('project_id', data.project_id)
      .eq('user_id', data.user_id);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to remove project member');
      throw new Error(`Failed to remove project member: ${error.message}`);
    }

    logger.info(
      { ...ctx, userId: data.user_id },
      'Project member removed successfully',
    );

    // Create audit log
    if (project && member) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: project.account_id,
        userId: user.id,
        action: 'delete',
        objectType: 'team_member',
        objectId: `${data.project_id}-${data.user_id}`,
        objectName: `Project member in ${project.name}`,
        before: member,
        scopes: [
          { type: 'account', id: project.account_id },
          { type: 'project', id: data.project_id },
        ],
        ...networkContext,
      });
    }

    // Invalidate cache
    await invalidateProjectMembersCache(data.project_id);

    // Revalidate the project detail pages
    revalidatePath(`/home/[account]/projects/${data.project_id}`, 'page');
    revalidatePath(`/home/(user)/projects/${data.project_id}`, 'page');

    return { success: true };
  },
  {
    schema: RemoveProjectMemberSchema,
  },
);

const UpdateProjectAudioSettingsSchema = z.object({
  projectId: z.string().uuid(),
  audioSettings: z.object({
    elevenlabs: z
      .object({
        enabled: z.boolean().optional(),
        tts_model: z.string().optional(),
        sfx_model: z.string().optional(),
        music_model: z.string().optional(),
      })
      .optional(),
    voice_provider: z
      .enum(['elevenlabs', 'playht', 'azure', 'google'])
      .optional(),
    sfx_provider: z.enum(['elevenlabs']).optional(),
    music_provider: z.enum(['suno', 'udio', 'elevenlabs']).optional(),
  }),
});

export type ProjectAudioSettings = z.infer<
  typeof UpdateProjectAudioSettingsSchema
>['audioSettings'];

export const updateProjectAudioSettingsAction = enhanceAction(
  async (data: z.infer<typeof UpdateProjectAudioSettingsSchema>) => {
    const logger = await getLogger();
    const ctx = {
      name: 'projects.updateAudioSettings',
      projectId: data.projectId,
    };

    logger.info(ctx, 'Updating project audio settings');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Get current project for account_id
    const { data: project, error: fetchError } = await client
      .from('projects')
      .select('account_id')
      .eq('id', data.projectId)
      .single();

    if (fetchError || !project) {
      throw new Error('Project not found');
    }

    // Update audio_settings column
    const { error } = await client
      .from('projects')
      .update({ audio_settings: data.audioSettings as Json })
      .eq('id', data.projectId);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update audio settings');
      throw new Error(`Failed to update audio settings: ${error.message}`);
    }

    logger.info(ctx, 'Audio settings updated successfully');

    // Invalidate cache
    await invalidateProjectCache(data.projectId, project.account_id);

    // Revalidate project settings page
    revalidatePath(`/home/[account]/studio/[projectSlug]/settings`, 'page');

    return { success: true };
  },
  {
    schema: UpdateProjectAudioSettingsSchema,
  },
);
