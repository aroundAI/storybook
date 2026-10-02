import 'server-only';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';

/**
 * Every read and write is scoped to the team the connection is bound to,
 * on top of RLS: a user who belongs to two teams still sees only the bound
 * team's rows through this token. A row outside it is NOT_FOUND, not
 * FORBIDDEN, because RLS hides rather than refuses and the tools say the
 * same thing either way.
 */
type Client = McpPrincipal['supabase'];

export interface ProjectRef {
  id: string;
  account_id: string;
  name?: string;
  slug?: string | null;
  metadata?: unknown;
}

export async function requireProjectInAccount<
  T extends ProjectRef = ProjectRef,
>(
  client: Client,
  accountId: string,
  projectId: string,
  columns = 'id, account_id',
): Promise<T> {
  const { data, error } = await client
    .from('projects')
    .select(columns)
    .eq('id', projectId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the project.');
  }

  if (!data) {
    throw new McpToolError(
      'NOT_FOUND',
      'No project with this id in your team.',
      { details: { projectId } },
    );
  }

  return data as unknown as T;
}

/** The embedded project every episode read joins, to scope by team. */
export const EPISODE_PROJECT_JOIN =
  'project:projects!inner(id, account_id, name, slug)';

export interface EpisodeRef {
  id: string;
  project: {
    id: string;
    account_id: string;
    name: string;
    slug: string | null;
  };
}

/**
 * One live episode of the bound team. Deleted episodes
 * (`episodes.deleted_at`) are filtered here, as every web page does: RLS
 * does not hide them.
 */
export async function requireEpisodeInAccount<
  T extends EpisodeRef = EpisodeRef,
>(
  client: Client,
  accountId: string,
  episodeId: string,
  columns: string,
): Promise<T> {
  const { data, error } = await client
    .from('episodes')
    .select(`${columns}, ${EPISODE_PROJECT_JOIN}`)
    .eq('id', episodeId)
    .eq('project.account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the episode.');
  }

  if (!data) {
    throw new McpToolError(
      'NOT_FOUND',
      'No episode with this id in your team (deleted episodes are not visible).',
      { details: { episodeId } },
    );
  }

  return data as unknown as T;
}
