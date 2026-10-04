import 'server-only';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { ActionRefusal } from '@kit/next/action-result';
import { requireAffectedRows, requireRow } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/** The project columns a FILM-2004 settings page writes whole. */
type ProjectJsonSetting = 'brand' | 'edit_policy';

const NOUN: Record<ProjectJsonSetting, string> = {
  brand: 'brand',
  edit_policy: 'edit policy',
};

/**
 * Writes the brand or edit policy of a project (FILM-2004), already
 * validated by its schema. Two rules, each refused as a value:
 *
 * - the caller holds `settings.manage` in the project's team, checked
 *   here because RLS on projects knows only project roles;
 * - the caller is a project owner or admin (projects_update), which RLS
 *   enforces by updating no row, so the write ends in `.select()`.
 *
 * `check` runs after the permission check, before the write: the brand
 * page uses it to refuse assets of another project.
 */
export async function writeProjectJsonSetting(params: {
  projectId: string;
  userId: string;
  column: ProjectJsonSetting;
  value: Json;
  check?: () => Promise<void>;
}) {
  const { projectId, userId, column, value } = params;
  const noun = NOUN[column];
  const logger = await getLogger();
  const ctx = { name: `studio.update.${column}`, projectId };
  const client = getSupabaseServerClient();

  const project = requireRow(
    await client
      .from('projects')
      .select('id, name, account_id, brand, edit_policy')
      .eq('id', projectId)
      .single(),
    'Project not found',
  );

  const { data: allowed, error: permissionError } = await client.rpc(
    'has_permission',
    {
      user_id: userId,
      account_id: project.account_id,
      permission_name: 'settings.manage',
    },
  );

  if (permissionError) {
    throw new Error(`Could not check permissions: ${permissionError.message}`);
  }

  if (!allowed) {
    throw new ActionRefusal(
      `Changing the ${noun} needs the team's settings permission. Ask a team owner.`,
    );
  }

  await params.check?.();

  const { data: updated, error } = await client
    .from('projects')
    .update({ [column]: value })
    .eq('id', projectId)
    .select('id, updated_at');

  if (error) {
    throw new Error(`Failed to update the ${noun}: ${error.message}`);
  }

  const rows = requireAffectedRows(
    updated,
    `Only a project owner or admin can change the ${noun}.`,
  );

  await createAuditLog({
    accountId: project.account_id,
    userId,
    action: 'update',
    objectType: 'project',
    objectId: project.id,
    objectName: project.name,
    before: { [column]: project[column] },
    after: { [column]: value },
    scopes: [
      { type: 'account', id: project.account_id },
      { type: 'project', id: project.id },
    ],
    metadata: { operation: `${column}_update` },
    ...(await extractNetworkContext()),
  });

  logger.info(ctx, `Project ${noun} updated`);
  revalidatePath('/home/[account]/studio/[projectSlug]/settings', 'layout');

  return { projectId, updatedAt: rows[0]?.updated_at ?? null };
}
