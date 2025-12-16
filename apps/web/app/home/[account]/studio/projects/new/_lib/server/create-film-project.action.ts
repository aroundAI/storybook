'use server';

import type { StudioProjectSettings } from '@kit/film-studio-schemas/project';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Create Film Studio project and return project data for client-side redirect
 * Returns project ID so client can upload cover image before redirecting
 */
export async function createFilmProject(
  accountSlug: string,
  formData: {
    name: string;
    description?: string;
    settings: StudioProjectSettings;
  },
): Promise<{ projectId: string; accountSlug: string }> {
  const client = getSupabaseServerClient();

  // Get account ID from slug
  const { data: account, error: accountError } = await client
    .from('accounts')
    .select('id')
    .eq('slug', accountSlug)
    .single();

  if (accountError || !account) {
    throw new Error('Account not found');
  }

  // Create the project with Film Studio settings in metadata
  // Cast metadata to satisfy TypeScript - the JSON column accepts any serializable object
  const { data: project, error } = await client
    .from('projects')
    .insert({
      account_id: account.id,
      name: formData.name,
      description: formData.description ?? null,
      metadata: formData.settings as unknown as Json,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create project: ${error.message}`);
  }

  return { projectId: project.id, accountSlug };
}

/**
 * Update project cover image URL in metadata
 * Uses SECURITY DEFINER RPC to bypass RLS recursion
 */
export async function updateProjectCoverImage(
  projectId: string,
  coverImageUrl: string,
): Promise<void> {
  const client = getSupabaseServerClient();

  // Call SECURITY DEFINER function to bypass RLS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.rpc as any)('update_project_cover_image', {
    p_project_id: projectId,
    p_cover_image_url: coverImageUrl,
  });

  if (error) {
    throw new Error(`Failed to update cover image: ${error.message}`);
  }
}
