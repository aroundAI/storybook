/**
 * Who may take a published video down from its platform (KB-47).
 *
 * Owner decision, 2026-09-25: project owners and admins only. Removing a
 * live video is irreversible, and `publishes_delete` already says the same.
 * The unpublish actions, the publish worker and the Publish screen all read
 * this one list.
 *
 * No `server-only` import: the publish worker and the Publish screen use it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

export const TAKEDOWN_ROLES = ['owner', 'admin'] as const;

export const TAKEDOWN_REFUSAL =
  'Only project owners and admins can take a published video down.';

export function canTakeDown(role: string | null | undefined): boolean {
  return (TAKEDOWN_ROLES as readonly string[]).includes(role ?? '');
}

/**
 * The user's role on the project, or `null` for none. With the caller's own
 * client, RLS lets a user read their own `project_members` row; the worker
 * reads it on the service-role key.
 */
export async function projectRoleOf(
  client: SupabaseClient<Database>,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read project role: ${error.message}`);
  }

  return data?.role ?? null;
}
