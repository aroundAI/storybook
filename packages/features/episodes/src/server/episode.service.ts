import 'server-only';

import { whyNoRow } from '@kit/shared/rows';
import type { Database, Json } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import { generateEpisodeSlug } from '../lib/slug-utils';
import { OptimisticLockError } from '../lib/status-workflow';

export { OptimisticLockError };

/**
 * The episode writes a user authors by hand, callable with any Supabase
 * client: the web's server actions pass the cookie session's client, the
 * MCP author tools (FILM-1905) the principal's RLS-scoped one. One copy of
 * the numbering, slug, retry and optimistic-lock rules for both.
 *
 * A failure the user caused comes back as `{ ok: false, ... }`; a database
 * failure throws.
 */
export type EpisodeRow = Database['public']['Tables']['episodes']['Row'];

/** Any client over the project's database: the cookie session's or a minted user JWT's. */
type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

export interface InsertEpisodeInput {
  projectId: string;
  seasonId?: string | null;
  /** A number the caller chose; auto-assigned (and retried on a clash) when absent. */
  number?: number;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  targetDurationSeconds?: number | null;
  /** Creative direction the wizard seeds the story with; never set over MCP. */
  storyData?: Record<string, unknown> | null;
}

export type InsertEpisodeResult =
  | { ok: true; data: EpisodeRow }
  | { ok: false; refusal: string; field: 'number' };

const MAX_RETRIES = 3;

export interface InsertedEpisodeRow {
  id: string;
  number: number;
  title: string;
  status: string;
}

/**
 * Inserts several episodes in one statement, numbered from the project's
 * next free number. A concurrent create can take that number between the
 * read and the insert; the database refuses the whole statement (23505,
 * KB-175) and the numbers are read again. `buildRows` gets the first number
 * and returns rows numbered from it. Throws when every attempt clashed.
 */
export async function insertEpisodesAtNextNumbers(
  client: Client,
  projectId: string,
  buildRows: (
    firstNumber: number,
  ) => Database['public']['Tables']['episodes']['Insert'][],
  log: { warn: (ctx: unknown, msg: string) => void } = { warn: () => {} },
): Promise<InsertedEpisodeRow[]> {
  let lastMessage = 'Unknown error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: top } = await client
      .from('episodes')
      .select('number')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('number', { ascending: false })
      .limit(1);

    const { data, error } = await client
      .from('episodes')
      .insert(buildRows((top?.[0]?.number ?? 0) + 1))
      .select('id, number, title, status');

    if (!error) {
      return data ?? [];
    }

    lastMessage = error.message;

    if (error.code !== '23505') {
      break;
    }

    log.warn({ attempt, error }, 'Episode number conflict, retrying');
  }

  throw new Error(`Failed to create episodes: ${lastMessage}`);
}

export async function insertEpisode(
  client: Client,
  input: InsertEpisodeInput,
  log: { warn: (ctx: unknown, msg: string) => void } = { warn: () => {} },
): Promise<InsertEpisodeResult> {
  // Auto-assign episode number with retry logic for race conditions. The
  // database keeps a project's live numbers unique (idx_episodes_project_number,
  // KB-175), so an auto-assigned number that clashes is picked again.
  let lastError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let episodeNumber: number;

    if (input.number) {
      episodeNumber = input.number;
    } else {
      const { data: existingEpisodes } = await client
        .from('episodes')
        .select('number')
        .eq('project_id', input.projectId)
        .is('deleted_at', null)
        .order('number', { ascending: false })
        .limit(1);

      episodeNumber = (existingEpisodes?.[0]?.number ?? 0) + 1;
    }

    const row: Database['public']['Tables']['episodes']['Insert'] = {
      project_id: input.projectId,
      season_id: input.seasonId ?? null,
      number: episodeNumber,
      title: input.title,
      slug: generateEpisodeSlug(episodeNumber, input.title),
      description: input.description ?? null,
      status: 'draft',
      metadata: (input.metadata ?? {}) as Json,
      version: 1,
    };

    if (input.targetDurationSeconds !== undefined) {
      row.target_duration_seconds = input.targetDurationSeconds;
    }

    if (input.storyData !== undefined) {
      row.story_data = input.storyData as Json;
    }

    const { data: inserted, error } = await client
      .from('episodes')
      .insert(row)
      .select()
      .single();

    if (!error) {
      return { ok: true, data: inserted };
    }

    const isUniqueViolation =
      error.code === '23505' || error.message?.includes('unique');

    if (isUniqueViolation && !input.number && attempt < MAX_RETRIES - 1) {
      log.warn({ attempt, error }, 'Episode number conflict, retrying');
      continue;
    }

    lastError = error;
    break;
  }

  // A number chosen by the caller is never retried, so a clash on it is
  // theirs to resolve. An auto-assigned number that still clashes after
  // every retry is a failure, and stays thrown.
  if (input.number && lastError?.code === '23505') {
    return {
      ok: false,
      refusal: `Episode ${input.number} already exists in this project. Choose a different number.`,
      field: 'number',
    };
  }

  throw new Error(
    `Failed to create episode: ${lastError?.message ?? 'Unknown error'}`,
  );
}

export interface UpdateEpisodeFields {
  episodeId: string;
  /** The version the caller read; the update is refused if it moved. */
  version: number;
  title?: string;
  description?: string;
  storyData?: Record<string, unknown>;
  screenplayData?: Record<string, unknown>;
  shotList?: Record<string, unknown>;
  /** Replaces `metadata` wholesale, as the web's update action does. */
  metadata?: Record<string, unknown>;
  /** Merged into the current `metadata`, one key at a time. */
  metadataPatch?: Record<string, unknown>;
  masterVideoAssetId?: string | null;
  targetDurationSeconds?: number | null;
}

export type EpisodeBefore = Pick<
  EpisodeRow,
  | 'id'
  | 'project_id'
  | 'season_id'
  | 'number'
  | 'slug'
  | 'title'
  | 'description'
  | 'status'
  | 'version'
  | 'duration_seconds'
  | 'thumbnail_url'
  | 'final_video_url'
  | 'target_duration_seconds'
  | 'metadata'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
> & { project: { account_id: string } | null };

export type UpdateEpisodeResult =
  | { ok: true; before: EpisodeBefore; data: EpisodeRow }
  | { ok: false; code: 'not_found' | 'asset_not_in_project'; message: string };

/**
 * Updates the fields given, under optimistic locking: the row is read, its
 * version compared with the caller's, and the update filtered on that
 * version too, so a concurrent write makes this one fail rather than win.
 * Throws `OptimisticLockError` when the version moved.
 */
export async function updateEpisodeRow(
  client: Client,
  data: UpdateEpisodeFields,
): Promise<UpdateEpisodeResult> {
  const { data: currentEpisode, error: fetchError } = await client
    .from('episodes')
    .select(
      `
        id, project_id, season_id, number, slug, title, description, status, version,
        duration_seconds, thumbnail_url, final_video_url, target_duration_seconds,
        metadata, created_at, updated_at, deleted_at,
        project:projects(account_id)
      `,
    )
    .eq('id', data.episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchError || !currentEpisode) {
    return {
      ok: false,
      code: 'not_found',
      message: whyNoRow(fetchError, 'Episode not found'),
    };
  }

  // Check version for optimistic locking
  if (currentEpisode.version !== data.version) {
    throw new OptimisticLockError('episode');
  }

  // Build update object (only include provided fields)
  const updates: Database['public']['Tables']['episodes']['Update'] = {
    updated_at: new Date().toISOString(),
  };

  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.storyData !== undefined) updates.story_data = data.storyData as Json;
  if (data.screenplayData !== undefined)
    updates.screenplay_data = data.screenplayData as Json;
  if (data.shotList !== undefined) updates.shot_list = data.shotList as Json;
  if (data.metadata !== undefined) updates.metadata = data.metadata as Json;
  if (data.metadataPatch !== undefined) {
    updates.metadata = {
      ...((currentEpisode.metadata as Record<string, unknown> | null) ?? {}),
      ...(data.metadata ?? {}),
      ...data.metadataPatch,
    } as Json;
  }
  if (data.targetDurationSeconds !== undefined)
    updates.target_duration_seconds = data.targetDurationSeconds;

  // Security: Verify masterVideoAssetId belongs to the same project
  if (data.masterVideoAssetId !== undefined) {
    if (data.masterVideoAssetId !== null) {
      const { data: assetCheck, error: assetError } = await client
        .from('assets')
        .select('id, project_id')
        .eq('id', data.masterVideoAssetId)
        .single();

      if (assetError || !assetCheck) {
        throw new Error('Failed to verify asset access');
      }

      if (assetCheck.project_id !== currentEpisode.project_id) {
        return {
          ok: false,
          code: 'asset_not_in_project',
          message: 'Asset does not belong to this project',
        };
      }
    }
    updates.master_video_asset_id = data.masterVideoAssetId;
  }

  const { data: episode, error: updateError } = await client
    .from('episodes')
    .update(updates)
    .eq('id', data.episodeId)
    .eq('version', data.version)
    .is('deleted_at', null)
    .select()
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to update episode: ${updateError.message}`);
  }

  if (!episode) {
    throw new OptimisticLockError('episode');
  }

  return {
    ok: true,
    before: currentEpisode as EpisodeBefore,
    data: episode,
  };
}

export interface LinkedAsset {
  id: string;
  name: string;
  type: 'character' | 'location';
}

export type LinkAssetsResult =
  | { ok: true; data: { linked: LinkedAsset[] } }
  | {
      ok: false;
      code: 'episode_not_found' | 'asset_not_in_project' | 'not_permitted';
      message: string;
    };

/**
 * Links existing characters and locations to an episode by adding their ids
 * and names to `episodes.metadata` (`character_ids` / `location_ids` and the
 * `_names` beside them), which is what every stage after the story reads
 * its cast from. Deduplicates by id and by case-insensitive name. The web's
 * episode sidebar and the MCP `link_assets_to_episode` tool both call this.
 *
 * Each asset must be a live character or location of the episode's own
 * project; RLS hides other teams' rows, and a row of another project of the
 * same team is refused here. Nothing is written when any asset is refused.
 * The metadata write is filtered on the version that was read, and re-read
 * and retried when another write moved it.
 */
export async function linkAssetsToEpisode(
  client: Client,
  input: { episodeId: string; assetIds: string[] },
): Promise<LinkAssetsResult> {
  const assetIds = [...new Set(input.assetIds)];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('id, project_id, version, metadata')
      .eq('id', input.episodeId)
      .is('deleted_at', null)
      .maybeSingle();

    if (episodeError || !episode) {
      return {
        ok: false,
        code: 'episode_not_found',
        message: whyNoRow(episodeError, 'Episode not found'),
      };
    }

    const { data: assets, error: assetsError } = await client
      .from('assets')
      .select('id, name, type, project_id')
      .in('id', assetIds)
      .is('deleted_at', null);

    if (assetsError) {
      throw new Error(`Failed to read assets: ${assetsError.message}`);
    }

    const found = new Map((assets ?? []).map((asset) => [asset.id, asset]));
    const refused = assetIds.filter((id) => {
      const asset = found.get(id);

      return (
        !asset ||
        asset.project_id !== episode.project_id ||
        (asset.type !== 'character' && asset.type !== 'location')
      );
    });

    if (refused.length > 0) {
      return {
        ok: false,
        code: 'asset_not_in_project',
        message: `Not a character or location of this episode's project: ${refused.join(', ')}`,
      };
    }

    const metadata = (episode.metadata ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...metadata };
    const linked: LinkedAsset[] = [];

    for (const id of assetIds) {
      const asset = found.get(id)!;
      const type = asset.type as LinkedAsset['type'];
      const idsKey = type === 'character' ? 'character_ids' : 'location_ids';
      const namesKey =
        type === 'character' ? 'character_names' : 'location_names';
      const ids = (next[idsKey] as string[] | undefined) ?? [];
      const names = (next[namesKey] as string[] | undefined) ?? [];

      next[idsKey] = ids.includes(id) ? ids : [...ids, id];
      next[namesKey] = names.some(
        (name) => name.toLowerCase() === asset.name.toLowerCase(),
      )
        ? names
        : [...names, asset.name];
      linked.push({ id, name: asset.name, type });
    }

    const { data: updated, error: updateError } = await client
      .from('episodes')
      .update({ metadata: next as Json })
      .eq('id', input.episodeId)
      .eq('version', episode.version)
      .is('deleted_at', null)
      .select('id');

    if (updateError) {
      throw new Error(
        `Failed to link assets to episode: ${updateError.message}`,
      );
    }

    if (updated && updated.length > 0) {
      return { ok: true, data: { linked } };
    }

    // No row changed: either the version moved (read again) or RLS filtered
    // the write out, which looks the same. Read the version to tell which.
    const { data: now } = await client
      .from('episodes')
      .select('version')
      .eq('id', input.episodeId)
      .maybeSingle();

    if (!now || now.version === episode.version) {
      return {
        ok: false,
        code: 'not_permitted',
        message: "You can't change this episode's assets.",
      };
    }
  }

  throw new OptimisticLockError('episode');
}
