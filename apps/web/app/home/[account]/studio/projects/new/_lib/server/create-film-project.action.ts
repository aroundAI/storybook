'use server';

import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { redirect } from 'next/navigation';

import type { StudioProjectSettings } from '@kit/film-studio-schemas/project';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Create Film Studio project and redirect to studio workspace
 */
export async function createFilmProjectAndRedirect(
  accountSlug: string,
  formData: {
    name: string;
    description?: string;
    settings: StudioProjectSettings;
  },
) {
  const client = getSupabaseServerClient();

  try {
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
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create project: ${error.message}`);
    }

    // Redirect to the new project's studio workspace
    redirect(`/home/${accountSlug}/studio/${project.id}`);
  } catch (error) {
    // Re-throw redirect errors (they're expected behavior)
    if (isRedirectError(error)) {
      throw error;
    }

    throw error;
  }
}
