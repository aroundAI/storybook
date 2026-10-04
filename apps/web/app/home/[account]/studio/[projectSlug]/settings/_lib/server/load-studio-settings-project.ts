import 'server-only';

import { notFound } from 'next/navigation';

import { getProjectPermissions } from '@kit/projects/queries';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { loadTeamWorkspace } from '../../../../../_lib/server/team-account-workspace.loader';

/**
 * The project a FILM-2004 settings page edits, scoped to the team in the
 * URL (a slug is unique per team, not globally), and whether the caller may
 * save: a project owner or admin (projects_update) holding the team's
 * `settings.manage`. The action checks both again; this only decides
 * whether the form is enabled.
 */
export async function loadStudioSettingsProject(
  accountSlug: string,
  projectSlug: string,
) {
  const workspace = await loadTeamWorkspace(accountSlug);
  const client = getSupabaseServerClient();

  const { data: project, error } = await client
    .from('projects')
    .select('id, name, slug, account_id, brand, edit_policy')
    .eq('account_id', workspace.account.id)
    .eq('slug', projectSlug)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the project: ${error.message}`);
  }

  if (!project) {
    notFound();
  }

  const permissions = await getProjectPermissions(project.id);
  const canManage =
    permissions.canEditSettings &&
    workspace.account.permissions.includes('settings.manage');

  return { project, canManage };
}

export interface ProjectAssetChoice {
  id: string;
  name: string;
  type: string;
  contentType: string | null;
  previewUrl: string | null;
}

/**
 * Every live asset of the project, for the logo, intro and outro pickers.
 * Paged: a project's asset count is not bounded by the 1000-row cap.
 */
export async function loadProjectAssetChoices(
  projectId: string,
): Promise<ProjectAssetChoice[]> {
  const client = getSupabaseServerClient();

  const rows = await fetchAllRows<{
    id: string;
    name: string;
    type: string;
    content_type: string | null;
    file_url: string | null;
    thumbnail_url: string | null;
  }>(
    (from, to) =>
      client
        .from('assets')
        .select('id, name, type, content_type, file_url, thumbnail_url')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    'assets',
  );

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      contentType: row.content_type,
      previewUrl: row.thumbnail_url ?? row.file_url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
