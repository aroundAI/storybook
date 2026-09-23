import 'server-only';

import type { getSupabaseServerClient } from '@kit/supabase/server-client';

type ServerClient = ReturnType<typeof getSupabaseServerClient>;

export const PROJECT_WRITE_REFUSAL =
  'You need to be a member of this project to add research to it.';

/**
 * Whether the signed-in caller holds an owner, admin or member row for the
 * project in `project_members` (KB-26, via KB-28's `can_write_project`).
 *
 * Deliberately not "can the caller read the project": public and unlisted
 * projects are readable by every signed-in user
 * (20260108120000_public_sharing_rls.sql:28), so a read proves nothing about
 * the right to add to one. The same function gates reading uploaded research
 * in RLS, so who may add research and who may read it are one rule.
 */
export async function canWriteProject(
  client: ServerClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('can_write_project', {
    target_project_id: projectId,
  });

  if (error) {
    throw new Error(`can_write_project failed: ${error.message}`);
  }

  return data === true;
}
