import 'server-only';

import { z } from 'zod';

import {
  CreateSeasonSchema,
  DeleteSeasonKeepEpisodesSchema,
  ReorderSeasonsSchema,
  UpdateSeasonSchema,
} from '@kit/episodes/schemas';
import { OptimisticLockError } from '@kit/episodes/server/episode-service';
import {
  type SeasonRefusalReason,
  insertSeason,
  reorderSeasons,
  softDeleteSeason,
  updateSeasonRow,
} from '@kit/episodes/server/season-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { requireProjectInAccount } from '../read/scope';
import { requireSeasonInAccount, seasonSummary } from '../read/seasons';
import { refused } from '../validation';

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** A season refusal as the error contract: who may not, what is not there, what is wrong. */
function seasonRefusal(
  result: { refusal: string; reason: SeasonRefusalReason },
  field?: string,
) {
  switch (result.reason) {
    case 'forbidden':
      return new McpToolError('FORBIDDEN', result.refusal);
    case 'not_found':
      return new McpToolError('NOT_FOUND', result.refusal);
    case 'invalid':
      return refused(result.refusal, field);
  }
}

function targetChanged(what: string) {
  return new McpToolError(
    'TARGET_CHANGED',
    `The ${what} changed since you read it. Read it again (list_seasons) and retry with the new version.`,
  );
}

const create = CreateSeasonSchema.shape;

export const createSeasonTool = defineTool({
  name: 'create_season',
  title: 'Create season',
  description:
    "Creates an empty season in a project. Name 1-255 characters; optional description (up to 1000) and direction notes (up to 5000; the generators read them when writing this season's episodes). The number is the next free one unless given. Adds no episodes: use create_episode with this seasonId, or Generate Season on the web.",
  inputSchema: {
    projectId: create.projectId,
    name: create.name,
    description: create.description,
    directionNotes: create.directionNotes,
    number: create.number,
  },
  scope: 'studio:write',
  annotations: WRITE,
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    const result = await insertSeason(client, input);

    if (!result.ok) {
      throw refused(result.refusal, result.field);
    }

    const season = seasonSummary(result.data);

    return {
      text: `Created Season ${season.number} "${season.name}" (${season.id}).`,
      structuredContent: { season },
    };
  },
});

const update = UpdateSeasonSchema.shape;

export const updateSeasonTool = defineTool({
  name: 'update_season',
  title: 'Update season',
  description:
    "Changes a season's name, description or direction notes under optimistic locking: pass the version list_seasons returned; TARGET_CHANGED if the season moved since. Project owner or admin.",
  inputSchema: {
    seasonId: update.seasonId,
    version: z.number().int().positive(),
    name: update.name,
    description: update.description,
    directionNotes: update.directionNotes,
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireSeasonInAccount(client, context.accountId, input.seasonId);

    if (
      input.name === undefined &&
      input.description === undefined &&
      input.directionNotes === undefined
    ) {
      throw refused('Give at least one field to change.');
    }

    let result;

    try {
      result = await updateSeasonRow(client, input);
    } catch (error) {
      if (error instanceof OptimisticLockError) throw targetChanged('season');
      throw error;
    }

    if (!result.ok) {
      throw seasonRefusal(result);
    }

    const season = seasonSummary(result.data);

    return {
      text: `Updated Season ${season.number} (now version ${season.version}).`,
      structuredContent: { season },
    };
  },
});

export const reorderSeasonsTool = defineTool({
  name: 'reorder_seasons',
  title: 'Reorder seasons',
  description:
    "Renumbers a project's seasons 1..n in the order given. List every live season once (list_seasons); a list that leaves one out or repeats one is refused. Episode numbers do not change. Project owner or admin.",
  inputSchema: ReorderSeasonsSchema.shape,
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireProjectInAccount(client, context.accountId, input.projectId);

    const result = await reorderSeasons(client, input);

    if (!result.ok) {
      throw seasonRefusal(result, 'seasonIds');
    }

    const seasons = result.data.map(seasonSummary);

    return {
      text: seasons
        .map((season) => `${season.number}. ${season.name ?? season.id}`)
        .join('\n'),
      structuredContent: { seasons },
    };
  },
});

export const deleteSeasonTool = defineTool({
  name: 'delete_season',
  title: 'Delete season',
  description:
    'Deletes a season at the version you read and moves its episodes to Unsorted (no season). None of the episodes is deleted. Returns how many moved. TARGET_CHANGED if the season moved since. Project owner or admin.',
  inputSchema: DeleteSeasonKeepEpisodesSchema.shape,
  scope: 'studio:write',
  annotations: { ...WRITE, destructiveHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireSeasonInAccount(client, context.accountId, input.seasonId);

    let result;

    try {
      result = await softDeleteSeason(client, input);
    } catch (error) {
      if (error instanceof OptimisticLockError) throw targetChanged('season');
      throw error;
    }

    if (!result.ok) {
      throw seasonRefusal(result);
    }

    return {
      text: `Deleted the season; ${result.data.episodesMoved} episode${result.data.episodesMoved === 1 ? '' : 's'} moved to Unsorted.`,
      structuredContent: { deleted: true, ...result.data },
    };
  },
});
