'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
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

/**
 * Create a new project
 */
export const createProjectAction = enhanceAction(
  async (data: CreateProjectParams) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.create', data };

    logger.info(ctx, 'Creating project');

    const client = getSupabaseServerClient();

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

    const { error } = await client.from('projects').delete().eq('id', data.id);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete project');
      throw new Error(`Failed to delete project: ${error.message}`);
    }

    logger.info(ctx, 'Project deleted successfully');

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

    // Revalidate the project detail pages
    revalidatePath(`/home/[account]/projects/${data.project_id}`, 'page');
    revalidatePath(`/home/(user)/projects/${data.project_id}`, 'page');

    return { success: true };
  },
  {
    schema: RemoveProjectMemberSchema,
  },
);
