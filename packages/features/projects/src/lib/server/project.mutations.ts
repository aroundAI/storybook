'use server';

import { revalidatePath } from 'next/cache';

/**
 * Update project audio settings
 * Used to configure per-project audio generation models (TTS, SFX, Music)
 */
import { z } from 'zod';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
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
import { TEAM_ONLY, TEAM_ONLY_CODE } from '../team-only';
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

/** Postgres `unique_violation`: the one insert/update failure a user causes. */
const UNIQUE_VIOLATION = '23505';

const SLUG_TAKEN =
  'A project with this slug already exists in this workspace. Choose a different slug.';

/**
 * Create a new project
 */
const createProject = enhanceAction(
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
      if (projectError.code === UNIQUE_VIOLATION) {
        throw new ActionRefusal(SLUG_TAKEN);
      }

      // A personal account (KB-99): the database refuses it, and says why.
      if (projectError.code === TEAM_ONLY_CODE) {
        throw new ActionRefusal(TEAM_ONLY);
      }

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

export const createProjectAction = returnRefusals(createProject);

/**
 * Update an existing project
 */
const updateProject = enhanceAction(
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
      if (error.code === UNIQUE_VIOLATION) {
        throw new ActionRefusal(SLUG_TAKEN);
      }

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

export const updateProjectAction = returnRefusals(updateProject);

/**
 * Delete a project
 */
const deleteProject = enhanceAction(
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

    const { data: deleted, error } = await client
      .from('projects')
      .delete()
      .eq('id', data.id)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete project');
      throw new Error(`Failed to delete project: ${error.message}`);
    }

    // RLS filters a refused delete to no rows, without an error (KB-61).
    // Before the audit log: a refused delete is not recorded as one.
    requireAffectedRows(
      deleted,
      "The project wasn't deleted: it's already gone, or only its owner can delete it. Reload the page.",
    );

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

export const deleteProjectAction = returnRefusals(deleteProject);

/**
 * Add a member to a project
 */
const addProjectMember = enhanceAction(
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
      if (error.code === UNIQUE_VIOLATION) {
        // Two unique rules on this table: one membership per person, and
        // one owner per project (`ix_project_members_owner`).
        throw new ActionRefusal(
          error.message.includes('ix_project_members_owner')
            ? 'A project can have only one owner.'
            : 'This person is already a member of the project.',
        );
      }

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

export const addProjectMemberAction = returnRefusals(addProjectMember);

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
const removeProjectMember = enhanceAction(
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

    const { data: removed, error } = await client
      .from('project_members')
      .delete()
      .eq('project_id', data.project_id)
      .eq('user_id', data.user_id)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to remove project member');
      throw new Error(`Failed to remove project member: ${error.message}`);
    }

    // RLS filters a refused delete to no rows, without an error (KB-61)
    requireAffectedRows(
      removed,
      "The member wasn't removed: they're no longer on the project, or you can't remove them. Reload the page.",
    );

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

export const removeProjectMemberAction = returnRefusals(removeProjectMember);

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
    music_provider: z.enum(['elevenlabs']).optional(),
  }),
});

export type ProjectAudioSettings = z.infer<
  typeof UpdateProjectAudioSettingsSchema
>['audioSettings'];

const updateProjectAudioSettings = enhanceAction(
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
    const project = requireRow(
      await client
        .from('projects')
        .select('account_id')
        .eq('id', data.projectId)
        .single(),
      'Project not found',
    );

    // Update audio_settings column
    const { data: updated, error } = await client
      .from('projects')
      .update({ audio_settings: data.audioSettings as Json })
      .eq('id', data.projectId)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update audio settings');
      throw new Error(`Failed to update audio settings: ${error.message}`);
    }

    requireAffectedRows(
      updated,
      "You can't change this project's audio settings.",
    );

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

export const updateProjectAudioSettingsAction = returnRefusals(
  updateProjectAudioSettings,
);
