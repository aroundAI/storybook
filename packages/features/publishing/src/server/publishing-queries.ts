import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { PlatformConnection } from './episode-publishing-actions';
import type { GlobalOAuthApp } from './global-oauth-actions';
import type { ProjectPublishingConfig } from './project-publishing-actions';

/*
 * Reads for server components. Not `'use server'`: every export of such a
 * module is an endpoint anyone can call with any argument (KB-58). These
 * read through the caller's session, so RLS still applies.
 */

/**
 * Get all platform connections for an account
 */
export async function getAccountPlatformConnections(
  accountId: string,
): Promise<PlatformConnection[]> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('platform_connections')
    .select(
      `
      id,
      platform,
      platform_account_id,
      platform_account_name,
      language,
      is_active
    `,
    )
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('platform', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch connections: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    platformAccountId: row.platform_account_id,
    platformAccountName: row.platform_account_name,
    language: row.language,
    isActive: row.is_active,
  }));
}

/**
 * Get all global OAuth app credentials (for super admin UI)
 * Returns apps without secrets (secrets are never exposed to client)
 */
export async function getGlobalOAuthApps(): Promise<GlobalOAuthApp[]> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('oauth_app_credentials')
    .select('id, platform, client_id, created_at, updated_at')
    .order('platform');

  if (error) {
    console.error('Error fetching global OAuth apps:', error);
    return [];
  }

  return (data ?? []).map((app) => ({
    id: app.id,
    platform: app.platform as GlobalOAuthApp['platform'],
    clientId: app.client_id,
    createdAt: app.created_at,
    updatedAt: app.updated_at,
  }));
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
