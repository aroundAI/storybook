import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getEpisodeRetentionCurveService } from '@kit/content-analytics/server/diagnostics-service';
import { getLogger } from '@kit/shared/logger';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { type StorageAdapter, getStorageAdapter } from '@kit/storage';
import type { Database } from '@kit/supabase/database';

import {
  type AudioAssetSourceRow,
  type AudioTrackSourceRow,
  type CaptionSegmentSourceRow,
  type CaptionSourceRow,
  type CharacterAssetSourceRow,
  type CharacterDetailSourceRow,
  type DialogueSourceRow,
  type DubbedLineSourceRow,
  type DubbedVersionSourceRow,
  type EditPackageSources,
  type EpisodeSourceRow,
  type ProjectSourceRow,
  type ShortSourceRow,
  type ShotSourceRow,
  buildEditPackage,
  collectMediaUrls,
  editPackageEtag,
} from '../build-edit-package';
import {
  EDIT_PACKAGE_URL_TTL_SECONDS,
  type EditPackage,
  EditPackageSchema,
  type MediaEntry,
} from '../edit-package.schema';
import {
  type EpisodeRetentionCurve,
  analyticsHintsFrom,
} from '../retention-hints';
import { resolveMedia } from './resolve-media';

/**
 * FILM-2001: reads an episode's edit package with the caller's own client.
 *
 * Every read runs under RLS as the caller (the MCP principal's 5-minute
 * JWT), scoped to the team the connection is bound to; there is no
 * service-role client here. Every list is paged (`fetchAllRows`,
 * `fetchAllByIds`): PostgREST caps a read at 1000 rows without an error,
 * and a 60-shot episode in two languages has more caption segments than
 * that. Only keys read out of those rows are signed (`resolve-media.ts`).
 */

type Client = SupabaseClient<Database>;

export class EditPackageReadError extends Error {
  override name = 'EditPackageReadError';
}

function failed(table: string, error: { message: string } | null): never {
  throw new EditPackageReadError(
    `Could not read ${table}: ${error?.message ?? 'no data'}`,
  );
}

const SHOT_COLUMNS =
  'id, scene_number, shot_number, sequence_number, status, duration_seconds, source_duration, timeline_start_seconds, trim_in_point, trim_out_point, transition_type, prompt, action_description, camera_direction, primary_subject, continuation_from_shot_id, inherit_last_frame, shorts_candidate, video_url, first_frame_url, last_frame_url';
const DIALOGUE_COLUMNS =
  'id, shot_id, scene_number, sequence_number, character_name, character_asset_id, text, emotion, language, timeline_start_seconds, estimated_duration_seconds, status, audio_url';
const AUDIO_TRACK_COLUMNS =
  'id, type, name, file_url, duration_seconds, timeline_start_seconds, volume, metadata, audio_asset_id';
const SHORT_COLUMNS =
  'id, start_seconds, end_seconds, duration_seconds, viral_score, hook_type, title, source_shot_id, status';
const DUBBED_LINE_COLUMNS =
  'id, dubbed_version_id, original_dialogue_id, translated_text, timing_adjustment, timeline_start_seconds, duration_seconds, status, audio_url';

const ALL_CHARACTERS = 'all characters';

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * The characters an episode is tagged with (`episodes.metadata`), as the
 * shot generator reads them: the "All Characters" tag means every character
 * of the project.
 */
async function loadCharacters(
  client: Client,
  projectId: string,
  metadata: Record<string, unknown>,
): Promise<CharacterAssetSourceRow[]> {
  const columns = 'id, name, description, file_url, metadata';
  const wildcard = stringList(metadata.character_names).some(
    (name) => name.toLowerCase() === ALL_CHARACTERS,
  );

  const rows = wildcard
    ? await fetchAllRows<CharacterAssetSourceRow>(
        (from, to) =>
          client
            .from('assets')
            .select(columns)
            .eq('project_id', projectId)
            .eq('type', 'character')
            .is('deleted_at', null)
            .order('id')
            .range(from, to),
        'edit package characters',
      )
    : await fetchAllByIds<CharacterAssetSourceRow>(
        stringList(metadata.character_ids),
        (chunk, from, to) =>
          client
            .from('assets')
            .select(columns)
            .in('id', chunk)
            .eq('project_id', projectId)
            .eq('type', 'character')
            .is('deleted_at', null)
            .order('id')
            .range(from, to),
        'edit package characters',
      );

  return rows.filter((row) => row.name.toLowerCase() !== ALL_CHARACTERS);
}

/**
 * Every row the package is built from, or null when the caller cannot see
 * a live episode with this id in the team.
 */
export async function loadEditPackageSources(
  client: Client,
  { accountId, episodeId }: { accountId: string; episodeId: string },
): Promise<EditPackageSources | null> {
  const { data: found, error } = await client
    .from('episodes')
    .select(
      'id, project_id, number, title, status, version, target_duration_seconds, metadata, screenplay_data, project:projects!inner(id, account_id, name, slug, brand, edit_policy)',
    )
    .eq('id', episodeId)
    .eq('project.account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) failed('the episode', error);
  if (!found) return null;

  const { project: projectRow, ...episodeRow } = found as unknown as Omit<
    EpisodeSourceRow,
    never
  > & { project: ProjectSourceRow & { account_id: string } };
  const episode = episodeRow as EpisodeSourceRow;
  const project: ProjectSourceRow = {
    id: projectRow.id,
    name: projectRow.name,
    slug: projectRow.slug,
    brand: projectRow.brand,
    edit_policy: projectRow.edit_policy,
  };
  const metadata =
    episode.metadata && typeof episode.metadata === 'object'
      ? (episode.metadata as Record<string, unknown>)
      : {};

  const [
    shots,
    dialogueLines,
    audioTracks,
    captions,
    characters,
    shorts,
    dubbedVersions,
    hashed,
  ] = await Promise.all([
    fetchAllRows<ShotSourceRow>(
      (from, to) =>
        client
          .from('shots')
          .select(SHOT_COLUMNS)
          .eq('episode_id', episodeId)
          .is('deleted_at', null)
          .order('sequence_number')
          .order('id')
          .range(from, to),
      'edit package shots',
    ),
    fetchAllRows<DialogueSourceRow>(
      (from, to) =>
        client
          .from('dialogue_lines')
          .select(DIALOGUE_COLUMNS)
          .eq('episode_id', episodeId)
          .order('sequence_number')
          .order('id')
          .range(from, to),
      'edit package dialogue',
    ),
    fetchAllRows<AudioTrackSourceRow>(
      (from, to) =>
        client
          .from('audio_tracks')
          .select(AUDIO_TRACK_COLUMNS)
          .eq('episode_id', episodeId)
          .order('id')
          .range(from, to),
      'edit package audio tracks',
    ),
    fetchAllRows<CaptionSourceRow>(
      (from, to) =>
        client
          .from('captions')
          .select('id, language, status, style_preset')
          .eq('episode_id', episodeId)
          .order('id')
          .range(from, to),
      'edit package captions',
    ),
    loadCharacters(client, project.id, metadata),
    fetchAllRows<ShortSourceRow>(
      (from, to) =>
        client
          .from('shorts')
          .select(SHORT_COLUMNS)
          .eq('episode_id', episodeId)
          .order('id')
          .range(from, to),
      'edit package shorts',
    ),
    fetchAllRows<DubbedVersionSourceRow>(
      (from, to) =>
        client
          .from('dubbed_versions')
          .select('id, language, status')
          .eq('episode_id', episodeId)
          .order('id')
          .range(from, to),
      'edit package dubbed versions',
    ),
    fetchAllRows<{ file_url: string | null; file_hash: string | null }>(
      (from, to) =>
        client
          .from('assets')
          .select('id, file_url, file_hash')
          .eq('project_id', project.id)
          .not('file_hash', 'is', null)
          .is('deleted_at', null)
          .order('id')
          .range(from, to),
      'edit package recorded hashes',
    ),
  ]);

  const [audioAssets, captionSegments, characterDetails, dubbedLines] =
    await Promise.all([
      fetchAllByIds<AudioAssetSourceRow & { project_id: string }>(
        audioTracks.flatMap((t) =>
          t.audio_asset_id ? [t.audio_asset_id] : [],
        ),
        (chunk, from, to) =>
          client
            .from('audio_assets')
            .select('id, project_id, file_url, is_loopable, tags')
            .in('id', chunk)
            .eq('project_id', project.id)
            .order('id')
            .range(from, to),
        'edit package audio assets',
      ),
      fetchAllByIds<CaptionSegmentSourceRow>(
        captions.map((c) => c.id),
        (chunk, from, to) =>
          client
            .from('caption_segments')
            .select(
              'id, caption_id, sequence_number, start_time, end_time, text, speaker_id',
            )
            .in('caption_id', chunk)
            .order('id')
            .range(from, to),
        'edit package caption segments',
      ),
      fetchAllByIds<CharacterDetailSourceRow>(
        characters.map((c) => c.id),
        (chunk, from, to) =>
          client
            .from('character_details')
            .select('asset_id, role, elevenlabs_voice_id, reference_images')
            .in('asset_id', chunk)
            .order('asset_id')
            .range(from, to),
        'edit package character details',
      ),
      fetchAllByIds<DubbedLineSourceRow>(
        dubbedVersions.map((v) => v.id),
        (chunk, from, to) =>
          client
            .from('dubbed_dialogue_lines')
            .select(DUBBED_LINE_COLUMNS)
            .in('dubbed_version_id', chunk)
            .order('id')
            .range(from, to),
        'edit package dubbed lines',
      ),
    ]);

  const recordedHashes: Record<string, string> = {};
  for (const asset of hashed) {
    if (asset.file_url && asset.file_hash) {
      recordedHashes[asset.file_url] = asset.file_hash;
    }
  }

  return {
    project,
    episode,
    shots,
    dialogueLines,
    audioTracks,
    audioAssets: audioAssets.map(({ project_id: _project, ...asset }) => asset),
    captions,
    captionSegments,
    characters,
    characterDetails,
    shorts,
    dubbedVersions,
    dubbedLines,
    recordedHashes,
  };
}

/**
 * The episode's current edit-package etag, as get_edit_package would return
 * it, or null when the caller cannot see the episode. Reads the same rows
 * under the same RLS and signs nothing, so FILM-2003's deliver_edit can
 * answer TARGET_CHANGED with the etag the Studio should re-sync to.
 */
export async function currentEditPackageEtag(
  client: Client,
  input: { accountId: string; episodeId: string },
): Promise<string | null> {
  const sources = await loadEditPackageSources(client, input);

  return sources ? editPackageEtag(sources) : null;
}

export type GetEditPackageResult =
  | { status: 'not_found' }
  | { status: 'unchanged'; etag: string }
  | { status: 'package'; editPackage: EditPackage };

export interface GetEditPackageInput {
  accountId: string;
  episodeId: string;
  ifNoneMatch?: string | null;
  /** Defaults to the configured adapter, on the caller's client. */
  storage?: StorageAdapter;
  /** Defaults to the analytics service on the caller's client. */
  readRetention?: (episodeId: string) => Promise<EpisodeRetentionCurve>;
  now?: () => Date;
}

/**
 * The episode's edit package, `unchanged` when `ifNoneMatch` is its etag
 * (checked before any media is signed or analytics read), or `not_found`
 * when the caller cannot see the episode.
 */
export async function getEditPackage(
  client: Client,
  input: GetEditPackageInput,
): Promise<GetEditPackageResult> {
  const sources = await loadEditPackageSources(client, input);

  if (!sources) return { status: 'not_found' };

  const etag = editPackageEtag(sources);

  if (input.ifNoneMatch && input.ifNoneMatch === etag) {
    return { status: 'unchanged', etag };
  }

  const storage = input.storage ?? getStorageAdapter(client);
  const readRetention =
    input.readRetention ??
    ((episodeId: string) =>
      getEpisodeRetentionCurveService(client, { episodeId }));

  const [resolved, retention] = await Promise.all([
    resolveMedia(collectMediaUrls(sources), {
      storage,
      projectId: sources.project.id,
      episodeId: sources.episode.id,
      audioAssetIds: new Set(
        sources.audioAssets.map((a) => a.id.toLowerCase()),
      ),
      recordedHashes: sources.recordedHashes,
      ttlSeconds: EDIT_PACKAGE_URL_TTL_SECONDS,
    }),
    readRetention(sources.episode.id).catch(
      async (error: unknown): Promise<EpisodeRetentionCurve> => {
        // The package still opens; its hints say they could not be read.
        const logger = await getLogger();
        logger.warn(
          {
            name: 'edit-package.retention',
            episodeId: sources.episode.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'Could not read retention hints for an edit package',
        );

        return { state: 'unavailable' };
      },
    ),
  ]);

  const media = (url: string | null): MediaEntry =>
    url
      ? (resolved.get(url) ?? { url: null, mediaReason: 'unavailable' })
      : { url: null, mediaReason: 'not_generated' };

  const editPackage = buildEditPackage({
    sources,
    media,
    analyticsHints: analyticsHintsFrom(retention),
    generatedAt: (input.now ?? (() => new Date()))(),
    etag,
  });

  return {
    status: 'package',
    editPackage: EditPackageSchema.parse(editPackage),
  };
}
