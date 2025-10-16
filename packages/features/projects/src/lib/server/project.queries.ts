import 'server-only';

import { cache } from 'react';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { ProjectMemberWithUser, ProjectWithRole } from '../types';

/**
 * Get all projects for an account with the user's role
 */
export const getAccountProjects = cache(async (accountId: string) => {
  const logger = await getLogger();
  const ctx = { name: 'projects.getAccountProjects', accountId };

  logger.info(ctx, 'Fetching account projects');

  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc('get_account_projects', {
    target_account_id: accountId,
  });

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch account projects');
    throw new Error(`Failed to fetch projects: ${error.message}`);
  }

  logger.info({ ...ctx, count: data?.length || 0 }, 'Account projects fetched');

  return data as ProjectWithRole[];
});

/**
 * Get a single project by ID
 */
export const getProject = cache(async (projectId: string) => {
  const logger = await getLogger();
  const ctx = { name: 'projects.getProject', projectId };

  logger.info(ctx, 'Fetching project');

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch project');
    throw new Error(`Failed to fetch project: ${error.message}`);
  }

  logger.info(ctx, 'Project fetched');

  return data;
});

/**
 * Get project members with user information
 */
export const getProjectMembers = cache(async (projectId: string) => {
  const logger = await getLogger();
  const ctx = { name: 'projects.getProjectMembers', projectId };

  logger.info(ctx, 'Fetching project members');

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('project_members')
    .select(
      `
      *,
      user:user_id (
        id,
        name:accounts!inner(name),
        email:accounts!inner(email),
        picture_url:accounts!inner(picture_url)
      )
    `,
    )
    .eq('project_id', projectId);

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch project members');
    throw new Error(`Failed to fetch project members: ${error.message}`);
  }

  logger.info({ ...ctx, count: data?.length || 0 }, 'Project members fetched');

  // Transform the data to match our interface
  const members = data.map((member) => ({
    ...member,
    user: {
      id: member.user_id,
      name:
        (member.user as unknown as { name: Array<{ name: string }> })?.name?.[0]
          ?.name || null,
      email:
        (member.user as unknown as { email: Array<{ email: string }> })
          ?.email?.[0]?.email || null,
      picture_url:
        (
          member.user as unknown as {
            picture_url: Array<{ picture_url: string }>;
          }
        )?.picture_url?.[0]?.picture_url || null,
    },
  }));

  return members as ProjectMemberWithUser[];
});

/**
 * Check if user has a specific role on a project
 */
export const hasProjectRole = cache(
  async (projectId: string, role?: 'owner' | 'admin' | 'member' | 'viewer') => {
    const logger = await getLogger();
    const ctx = { name: 'projects.hasProjectRole', projectId, role };

    logger.info(ctx, 'Checking project role');

    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('has_role_on_project', {
      target_project_id: projectId,
      target_role: role,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to check project role');
      return false;
    }

    logger.info({ ...ctx, hasRole: data }, 'Project role checked');

    return data as boolean;
  },
);

/**
 * Check if user can perform a specific action on a project
 */
export const canPerformProjectAction = cache(
  async (
    projectId: string,
    action:
      | 'project.view'
      | 'project.edit'
      | 'project.delete'
      | 'project.members.view'
      | 'project.members.add'
      | 'project.members.remove'
      | 'project.settings.view'
      | 'project.settings.edit',
  ) => {
    const logger = await getLogger();
    const ctx = { name: 'projects.canPerformAction', projectId, action };

    logger.info(ctx, 'Checking project action permission');

    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('can_perform_project_action', {
      target_project_id: projectId,
      action,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to check project action');
      return false;
    }

    logger.info(
      { ...ctx, canPerform: data },
      'Project action permission checked',
    );

    return data as boolean;
  },
);

/**
 * Get user's role on a project
 */
export const getUserProjectRole = cache(async (projectId: string) => {
  const logger = await getLogger();
  const ctx = { name: 'projects.getUserProjectRole', projectId };

  logger.info(ctx, 'Fetching user project role');

  const client = getSupabaseServerClient();

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    logger.warn(ctx, 'User not authenticated');
    return null;
  }

  const { data, error } = await client
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (error) {
    // User might not be a member - this is not an error condition
    logger.info({ ...ctx, error }, 'User is not a project member');
    return null;
  }

  logger.info({ ...ctx, role: data.role }, 'User project role fetched');

  return data.role;
});
