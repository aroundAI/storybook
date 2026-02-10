import 'server-only';

import { cache } from 'react';

import { createCacheClient } from '@kit/cache';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { projectCacheKeys, projectCacheTTL } from '../cache-keys';
import type { ProjectMemberWithUser, ProjectWithRole } from '../types';

/**
 * Get all projects for an account with the user's role
 * Results are cached in Redis for performance
 */
export const getAccountProjects = cache(async (accountId: string) => {
  const logger = await getLogger();
  const ctx = { name: 'projects.getAccountProjects', accountId };

  // Check Redis cache first
  const cacheClient = createCacheClient();
  const cacheKey = projectCacheKeys.accountProjects(accountId);

  try {
    const cached = await cacheClient.get<ProjectWithRole[]>(cacheKey);
    if (cached) {
      logger.info(
        { ...ctx, cached: true },
        'Account projects fetched from cache',
      );
      return cached;
    }
  } catch (cacheError) {
    // Log but don't fail - cache miss is acceptable
    logger.warn(
      { ...ctx, error: cacheError },
      'Cache read failed, fetching from DB',
    );
  }

  logger.info(ctx, 'Fetching account projects from DB');

  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc('get_account_projects', {
    target_account_id: accountId,
  });

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch account projects');
    throw new Error(`Failed to fetch projects: ${error.message}`);
  }

  const projects = data as ProjectWithRole[];

  // Cache result
  try {
    await cacheClient.set(cacheKey, projects, projectCacheTTL.projects);
  } catch (cacheError) {
    logger.warn({ ...ctx, error: cacheError }, 'Failed to cache projects');
  }

  logger.info(
    { ...ctx, count: projects?.length || 0 },
    'Account projects fetched',
  );

  return projects;
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
    .select(
      `
      id, name, slug, description, account_id, metadata, status, visibility,
      audio_settings, created_by, updated_by, public_slug, seo_metadata,
      sequel_of, created_at, updated_at
    `,
    )
    .eq('id', projectId)
    .single();

  if (error) {
    // PGRST116 = "JSON object requested, multiple (or no) rows returned"
    // This means the project doesn't exist or user doesn't have access
    if (error.code === 'PGRST116') {
      logger.info({ ...ctx, error }, 'Project not found or access denied');
      return null;
    }

    // For actual database errors, still throw
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

  // Use the database function to get members with user info
  const { data, error } = await client.rpc('get_project_members', {
    target_project_id: projectId,
  });

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch project members');
    throw new Error(`Failed to fetch project members: ${error.message}`);
  }

  if (!data) {
    logger.warn(ctx, 'No project members found');
    return [];
  }

  logger.info({ ...ctx, count: data.length }, 'Project members fetched');

  // Transform the data to match our interface
  const members = data.map((member) => ({
    id: member.id,
    project_id: member.project_id,
    user_id: member.user_id,
    role: member.role,
    created_at: member.created_at,
    updated_at: member.updated_at,
    user: {
      id: member.user_id,
      name: member.user_name,
      email: member.user_email,
      picture_url: member.user_picture_url,
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

/**
 * Get all project permissions for the current user
 * Computes permissions from role in memory to avoid multiple RPC calls
 */
export const getProjectPermissions = cache(async (projectId: string) => {
  const role = await getUserProjectRole(projectId);

  // Compute all permissions from role in memory (no additional DB calls)
  return {
    canView: !!role,
    canEdit: role === 'owner' || role === 'admin',
    canDelete: role === 'owner',
    canViewMembers: !!role,
    canAddMembers: role === 'owner' || role === 'admin',
    canRemoveMembers: role === 'owner' || role === 'admin',
    canViewSettings: !!role,
    canEditSettings: role === 'owner' || role === 'admin',
    role,
  };
});

/**
 * Get available users to add to a project (account members not already in project)
 */
export const getAvailableProjectMembers = cache(
  async (projectId: string, accountSlug: string) => {
    const logger = await getLogger();
    const ctx = {
      name: 'projects.getAvailableMembers',
      projectId,
      accountSlug,
    };

    logger.info(ctx, 'Fetching available project members');

    const client = getSupabaseServerClient();

    // Get all account members
    const { data: accountMembers, error: accountError } = await client.rpc(
      'get_account_members',
      {
        account_slug: accountSlug,
      },
    );

    if (accountError) {
      logger.error(
        { ...ctx, error: accountError },
        'Failed to fetch account members',
      );
      throw new Error(
        `Failed to fetch account members: ${accountError.message}`,
      );
    }

    // Get existing project members
    const { data: projectMembers, error: projectError } = await client
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId);

    if (projectError) {
      logger.error(
        { ...ctx, error: projectError },
        'Failed to fetch project members',
      );
      throw new Error(
        `Failed to fetch project members: ${projectError.message}`,
      );
    }

    // Filter out users already in the project
    const projectMemberIds = new Set(
      projectMembers?.map((m) => m.user_id) || [],
    );
    const availableMembers =
      accountMembers?.filter(
        (member) => !projectMemberIds.has(member.user_id),
      ) || [];

    logger.info(
      { ...ctx, count: availableMembers.length },
      'Available project members fetched',
    );

    return availableMembers;
  },
);
