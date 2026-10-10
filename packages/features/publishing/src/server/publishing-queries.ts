import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { isOfferedPlatform } from '../lib/platforms';
import type { PlatformConnection } from './episode-publishing-actions';
import type { GlobalOAuthApp } from './global-oauth-actions';
import { getProjectChannelIds } from './project-channels';

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
    // A disconnected channel is history, not somewhere to publish (KB-22).
    .is('disconnected_at', null)
    .order('platform', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch connections: ${error.message}`);
  }

  // A kept row on a removed or hidden platform is not somewhere to publish
  return data
    .filter((row) => isOfferedPlatform(row.platform))
    .map((row) => ({
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
 * The ids of the channels a project publishes to
 */
export async function getProjectChannelSelection(
  projectId: string,
): Promise<string[]> {
  return [
    ...(await getProjectChannelIds(getSupabaseServerClient(), projectId)),
  ];
}
