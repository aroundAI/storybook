import 'server-only';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import { OptimisticLockError } from '../lib/status-workflow';

/**
 * The season writes, callable with any Supabase client: the web's server
 * actions pass the cookie session's client, the MCP tools (FILM-2204) the
 * principal's RLS-scoped one. One copy of the numbering and retry rules for
 * the season dialog, the episode wizard's inline season and Generate Season
 * (FILM-2201).
 *
 * A failure the user caused comes back as `{ ok: false, ... }`; a database
 * failure throws.
 */
export type SeasonRow = Database['public']['Tables']['seasons']['Row'];

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

type Log = { warn: (ctx: unknown, msg: string) => void };

const noLog: Log = { warn: () => {} };

const MAX_RETRIES = 3;

export interface InsertSeasonInput {
  projectId: string;
  /** Defaults to "Season {number}", the name Generate Season has always given. */
  name?: string;
  /** A number the caller chose; auto-assigned (and retried on a clash) when absent. */
  number?: number;
  description?: string | null;
  directionNotes?: string | null;
}

export type InsertSeasonResult =
  | { ok: true; data: SeasonRow }
  | { ok: false; refusal: string; field: 'number' };

/**
 * Inserts a season at the given number, or at the project's next free one.
 * The live-number index refuses a number a concurrent create took
 * between the read and the insert (23505); an auto-assigned number is then
 * read again, a chosen one is refused.
 */
export async function insertSeason(
  client: Client,
  input: InsertSeasonInput,
  log: Log = noLog,
): Promise<InsertSeasonResult> {
  let lastMessage = 'Unknown error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const number = input.number ?? (await nextSeasonNumber(client, input));

    const { data, error } = await client
      .from('seasons')
      .insert({
        project_id: input.projectId,
        number,
        name: input.name || `Season ${number}`,
        description: input.description ?? null,
        direction_notes: input.directionNotes ?? null,
      })
      .select()
      .single();

    if (!error) {
      return { ok: true, data };
    }

    lastMessage = error.message;

    if (error.code !== '23505') {
      break;
    }

    if (input.number) {
      return {
        ok: false,
        refusal: `Season ${input.number} already exists in this project. Choose a different number.`,
        field: 'number',
      };
    }

    log.warn({ attempt, error }, 'Season number conflict, retrying');
  }

  throw new Error(`Failed to create season: ${lastMessage}`);
}

/**
 * The number after the project's highest live season: a deleted season's
 * number is free again (`seasons_project_id_number_active_idx`).
 */
async function nextSeasonNumber(client: Client, input: InsertSeasonInput) {
  const { data, error } = await client
    .from('seasons')
    .select('number')
    .eq('project_id', input.projectId)
    .is('deleted_at', null)
    .order('number', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to read season numbers: ${error.message}`);
  }

  return (data?.[0]?.number ?? 0) + 1;
}

export type SeasonRefusalReason = 'invalid' | 'forbidden' | 'not_found';

/** A refusal the caller can show, and why; a database failure throws instead. */
export type SeasonWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: string; reason: SeasonRefusalReason };

export interface UpdateSeasonInput {
  seasonId: string;
  /** The version the caller read. Without it the write is unconditional (the web's inline rename). */
  version?: number;
  name?: string;
  description?: string | null;
  directionNotes?: string | null;
  coverUrl?: string | null;
}

/**
 * Changes a season's name, description, direction notes or cover. With a
 * version, the write lands only on that version and moves it on; a season
 * that moved since throws OptimisticLockError, as an episode does.
 */
export async function updateSeasonRow(
  client: Client,
  input: UpdateSeasonInput,
): Promise<SeasonWriteResult<SeasonRow>> {
  const { data: current, error: readError } = await client
    .from('seasons')
    .select('id, version')
    .eq('id', input.seasonId)
    .is('deleted_at', null)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read season: ${readError.message}`);
  }

  if (!current) {
    return { ok: false, refusal: 'Season not found.', reason: 'not_found' };
  }

  if (input.version !== undefined && current.version !== input.version) {
    throw new OptimisticLockError('season');
  }

  const updates: Database['public']['Tables']['seasons']['Update'] = {
    version: current.version + 1,
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.directionNotes !== undefined)
    updates.direction_notes = input.directionNotes;
  if (input.coverUrl !== undefined) updates.cover_url = input.coverUrl;

  const { data, error } = await client
    .from('seasons')
    .update(updates)
    .eq('id', input.seasonId)
    .eq('version', current.version)
    .is('deleted_at', null)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update season: ${error.message}`);
  }

  // RLS filters a refused update to no rows (KB-61); so does a concurrent write
  if (!data) {
    if (input.version !== undefined) {
      throw new OptimisticLockError('season');
    }

    return {
      ok: false,
      refusal:
        "The season wasn't changed: you can't edit it, or it changed. Reload the page.",
      reason: 'forbidden',
    };
  }

  return { ok: true, data };
}

/**
 * Renumbers a project's live seasons 1..n in the order given
 * (`reorder_seasons`), for a caller who may update every one of them.
 */
export async function reorderSeasons(
  client: Client,
  input: { projectId: string; seasonIds: string[] },
): Promise<SeasonWriteResult<SeasonRow[]>> {
  const { data, error } = await client.rpc('reorder_seasons', {
    p_project_id: input.projectId,
    p_season_ids: input.seasonIds,
  });

  if (error) {
    const refusal = seasonRefusal(error);
    if (refusal) return { ok: false, ...refusal };
    throw new Error(`Failed to reorder seasons: ${error.message}`);
  }

  return { ok: true, data: data ?? [] };
}

/**
 * Soft-deletes a season at the version the caller read and moves its live
 * episodes to Unsorted (`soft_delete_season`). Nothing of the episodes is
 * deleted. Returns how many moved.
 */
export async function softDeleteSeason(
  client: Client,
  input: { seasonId: string; version: number },
): Promise<SeasonWriteResult<{ episodesMoved: number }>> {
  const { data, error } = await client.rpc('soft_delete_season', {
    p_season_id: input.seasonId,
    p_version: input.version,
  });

  if (error) {
    if (error.code === '40001') throw new OptimisticLockError('season');
    const refusal = seasonRefusal(error);
    if (refusal) return { ok: false, ...refusal };
    throw new Error(`Failed to delete season: ${error.message}`);
  }

  return { ok: true, data: { episodesMoved: data ?? 0 } };
}

/** The refusals reorder_seasons and soft_delete_season raise, by SQLSTATE. */
function seasonRefusal(error: {
  code?: string;
  message: string;
}): { refusal: string; reason: SeasonRefusalReason } | null {
  switch (error.code) {
    case '22023':
      return {
        refusal: 'Give every season of the project exactly once.',
        reason: 'invalid',
      };
    case '42501':
      return {
        refusal:
          "You can't change this project's seasons (project owner or admin).",
        reason: 'forbidden',
      };
    case 'P0002':
      return { refusal: 'Season not found.', reason: 'not_found' };
    default:
      return null;
  }
}

/**
 * Moves an episode into a season of its own project, or to Unsorted (null),
 * at the version the caller read. Its number does not change: the position
 * within the season is derived (seasonPositions).
 */
export async function moveEpisodeToSeason(
  client: Client,
  input: { episodeId: string; version: number; seasonId: string | null },
): Promise<
  SeasonWriteResult<{ id: string; season_id: string | null; version: number }>
> {
  const { data: episode, error: readError } = await client
    .from('episodes')
    .select('id, project_id, version')
    .eq('id', input.episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read episode: ${readError.message}`);
  }

  if (!episode) {
    return { ok: false, refusal: 'Episode not found.', reason: 'not_found' };
  }

  if (episode.version !== input.version) {
    throw new OptimisticLockError('episode');
  }

  if (input.seasonId !== null) {
    const { data: season, error: seasonError } = await client
      .from('seasons')
      .select('id')
      .eq('id', input.seasonId)
      .eq('project_id', episode.project_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (seasonError) {
      throw new Error(`Failed to read season: ${seasonError.message}`);
    }

    if (!season) {
      return {
        ok: false,
        refusal: 'That season is not in this project.',
        reason: 'invalid',
      };
    }
  }

  const { data, error } = await client
    .from('episodes')
    .update({ season_id: input.seasonId })
    .eq('id', input.episodeId)
    .eq('version', input.version)
    .is('deleted_at', null)
    .select('id, season_id, version')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to move episode: ${error.message}`);
  }

  if (!data) {
    throw new OptimisticLockError('episode');
  }

  return { ok: true, data };
}

export interface SeasonWithEpisodeCountRow extends SeasonRow {
  episodeCount: number;
}

/** A project's live seasons in number order, each with its live episode count. */
export async function listSeasons(
  client: Client,
  input: { projectId: string },
): Promise<SeasonWithEpisodeCountRow[]> {
  const { data: seasons, error } = await client
    .from('seasons')
    .select()
    .eq('project_id', input.projectId)
    .is('deleted_at', null)
    .order('number', { ascending: true });

  if (error) {
    throw new Error(`Failed to read seasons: ${error.message}`);
  }

  // Paged: a project can hold more than max_rows episodes
  const episodes = await fetchAllRows<{ season_id: string | null }>(
    (from, to) =>
      client
        .from('episodes')
        .select('season_id')
        .eq('project_id', input.projectId)
        .is('deleted_at', null)
        .not('season_id', 'is', null)
        .order('id')
        .range(from, to),
    'season episode counts',
  );

  const counts = new Map<string, number>();
  for (const { season_id } of episodes) {
    if (season_id) counts.set(season_id, (counts.get(season_id) ?? 0) + 1);
  }

  return (seasons ?? []).map((season) => ({
    ...season,
    episodeCount: counts.get(season.id) ?? 0,
  }));
}
