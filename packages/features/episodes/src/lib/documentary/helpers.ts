/**
 * Shared helpers for documentary service functions.
 *
 * Extracted to deduplicate common patterns between researcher.ts,
 * fact-checker.ts, and other documentary services.
 */

import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Fetch the account_id for a project and the current user's ID.
 * Throws if the project is not found.
 *
 * Used by researcher and fact-checker to:
 * 1. Get account_id for LLM context logging
 * 2. Get user ID for audit logging
 *
 * @returns The returned `supabase` client uses the request-scoped auth context
 *          (i.e. the current user's session). It is NOT a service-role client.
 */
export async function getProjectContext(projectId: string) {
    const supabase = getSupabaseServerClient();

    const { data: project } = await supabase
        .from('projects')
        .select('account_id')
        .eq('id', projectId)
        .single();

    if (!project) {
        throw new Error(`Project not found: ${projectId}`);
    }

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? 'anonymous';

    return { accountId: project.account_id, userId, supabase };
}
