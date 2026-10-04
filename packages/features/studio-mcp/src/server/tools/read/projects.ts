import 'server-only';

import { z } from 'zod';

import { ProjectStatusSchema } from '@kit/projects/schemas';
import { STUDIO_SETTINGS_KEYS } from '@kit/projects/service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  OffsetCursor,
  PAGING_NOTE,
  cursorArg,
  decodeCursor,
  encodeCursor,
  limitArg,
  pageOf,
} from '../pagination';
import { requireProjectInAccount } from './scope';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface ProjectRowLike {
  id: string;
  account_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
  user_role?: string | null;
}

/**
 * A project as the tools present it: the columns plus the studio settings
 * the settings page keeps in `metadata` (genre, audience, video and content
 * style, default episode duration, rating, language, recurring elements,
 * aesthetic style), picked out by name so a client sees the series
 * settings without the rest of the metadata bag.
 */
export function projectSummary(row: ProjectRowLike) {
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const settings = Object.fromEntries(
    STUDIO_SETTINGS_KEYS.filter((key) => metadata[key] !== undefined).map(
      (key) => [key, metadata[key]],
    ),
  );

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    settings,
    role: row.user_role ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const PROJECT_COLUMNS =
  'id, account_id, name, slug, description, status, metadata, created_at, updated_at';

export const listProjectsTool = defineTool({
  name: 'list_projects',
  title: 'List projects',
  description: `The projects of the team this connection is bound to, newest first, with their series settings and the caller's role. ${PAGING_NOTE} Filter by status (active, archived); deleted projects are left out unless asked for.`,
  inputSchema: {
    status: ProjectStatusSchema.optional().describe(
      'Only projects with this status. Default: active and archived.',
    ),
    cursor: cursorArg,
    limit: limitArg,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const { data, error } = await context.principal.supabase.rpc(
      'get_account_projects',
      { target_account_id: context.accountId },
    );

    if (error) {
      throw new McpToolError('INTERNAL', 'Could not list the projects.');
    }

    const rows = ((data ?? []) as ProjectRowLike[])
      .filter((row) =>
        input.status ? row.status === input.status : row.status !== 'deleted',
      )
      .sort(
        (a, b) =>
          (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
          a.id.localeCompare(b.id),
      );

    const offset = decodeCursor(input.cursor, OffsetCursor)?.offset ?? 0;
    const { items, hasMore } = pageOf(
      rows.slice(offset, offset + input.limit + 1),
      input.limit,
    );
    const projects = items.map(projectSummary);

    return {
      text: `${rows.length} project${rows.length === 1 ? '' : 's'} in ${context.accountSlug}${hasMore ? `; showing ${offset + 1}-${offset + projects.length}` : ''}: ${projects.map((p) => `"${p.name}"`).join(', ') || 'none'}.`,
      structuredContent: {
        team: context.accountSlug,
        total: rows.length,
        projects,
        nextCursor: hasMore
          ? encodeCursor({ offset: offset + input.limit })
          : null,
      },
    };
  },
});

export const getProjectTool = defineTool({
  name: 'get_project',
  title: 'Get project',
  description:
    'One project of the team: its series settings and style, plus how many episodes, characters and locations it has.',
  inputSchema: {
    projectId: z
      .string()
      .uuid()
      .describe('The project id (from list_projects).'),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const project = await requireProjectInAccount<ProjectRowLike>(
      client,
      context.accountId,
      input.projectId,
      PROJECT_COLUMNS,
    );

    const [episodes, characters, locations] = await Promise.all([
      client
        .from('episodes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .is('deleted_at', null),
      client
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('type', 'character')
        .is('deleted_at', null),
      client
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('type', 'location')
        .is('deleted_at', null),
    ]);

    if (episodes.error || characters.error || locations.error) {
      throw new McpToolError(
        'INTERNAL',
        'Could not count the project content.',
      );
    }

    const summary = projectSummary(project);
    const counts = {
      episodes: episodes.count ?? 0,
      characters: characters.count ?? 0,
      locations: locations.count ?? 0,
    };

    return {
      text: `Project "${summary.name}" (${summary.status}): ${counts.episodes} episodes, ${counts.characters} characters, ${counts.locations} locations.`,
      structuredContent: { project: summary, counts },
    };
  },
});
