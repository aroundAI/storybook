import 'server-only';

import { z } from 'zod';

import {
  type SeasonRow,
  listSeasons,
} from '@kit/episodes/server/season-service';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { defineTool } from '../../../registry';
import { requireProjectInAccount } from './scope';

type Client = McpPrincipal['supabase'];

/** A season as every season tool returns it (FILM-2204). */
export function seasonSummary(row: SeasonRow & { episodeCount?: number }) {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    name: row.name,
    description: row.description,
    directionNotes: row.direction_notes,
    coverUrl: row.cover_url,
    version: row.version,
    ...(row.episodeCount !== undefined && { episodeCount: row.episodeCount }),
  };
}

/** One live season of the bound team, as the caller sees it. */
export async function requireSeasonInAccount(
  client: Client,
  accountId: string,
  seasonId: string,
) {
  const { data, error } = await client
    .from('seasons')
    .select('id, project_id, version, project:projects!inner(account_id)')
    .eq('id', seasonId)
    .eq('project.account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the season.');
  }

  if (!data) {
    throw new McpToolError(
      'NOT_FOUND',
      'No season with this id in your team (deleted seasons are not visible).',
      { details: { seasonId } },
    );
  }

  return data;
}

export const listSeasonsTool = defineTool({
  name: 'list_seasons',
  title: 'List seasons',
  description:
    "A project's live seasons in number order, each with its live episode count and the version a write needs. A season can be empty: create one with create_season and add episodes later. Episodes in no season are Unsorted (list_episodes with seasonId null).",
  inputSchema: { projectId: z.string().uuid() },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    const seasons = (
      await listSeasons(client, { projectId: input.projectId })
    ).map(seasonSummary);

    return {
      text:
        seasons.length === 0
          ? 'This project has no seasons.'
          : seasons
              .map(
                (season) =>
                  `Season ${season.number}${season.name ? ` · ${season.name}` : ''} (${season.id}, version ${season.version}): ${season.episodeCount} episode${season.episodeCount === 1 ? '' : 's'}`,
              )
              .join('\n'),
      structuredContent: { seasons },
    };
  },
});
