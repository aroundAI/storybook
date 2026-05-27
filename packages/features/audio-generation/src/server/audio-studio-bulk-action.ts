'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  AudioTrack,
  AudioTrackMetadata,
  AudioTrackStatus,
  AudioTrackSummary,
  AudioTrackType,
} from '../lib/schemas/audio-track.schema';
import type { ProjectAudioSettings } from '../lib/types';
import type {
  CharacterAsset,
  DialogueLine,
  DialogueLineSummary,
  SupportedLanguage,
} from '../lib/types/dialogue.types';

// =============================================================================
// Schema
// =============================================================================

const AudioStudioBulkSchema = z.object({
  episodeId: z.string().uuid(),
  projectId: z.string().uuid(),
  language: z.string().min(2).max(5),
});

// =============================================================================
// Internal row types (copied to avoid circular deps)
// =============================================================================

interface DialogueLineRow {
  id: string;
  episode_id: string;
  character_asset_id: string | null;
  shot_id: string | null;
  text: string;
  sequence_number: number;
  scene_number: number;
  status: string;
  audio_url: string | null;
  timeline_start_seconds: number | null;
  estimated_duration_seconds: number | null;
  generation_metadata: Record<string, unknown> | null;
  language: string;
  source_dialogue_id: string | null;
  created_at: string;
}

interface AudioTrackRow {
  id: string;
  episode_id: string;
  type: AudioTrackType;
  name: string | null;
  file_url: string | null;
  duration_seconds: number | null;
  timeline_start_seconds: number;
  volume: number;
  metadata: AudioTrackMetadata | null;
  created_at: string;
}

interface AssetRow {
  id: string;
  name: string;
  type: string;
  thumbnail_url?: string;
}

interface AudioCueRow {
  id: string;
  episode_id: string;
  scene_number: number;
  cue_type: string;
  prompt: string;
  start_offset_seconds: number;
  duration_seconds: number | null;
  is_loopable: boolean;
  status: string;
  audio_asset_id: string | null;
  audio_track_id: string | null;
  audio_assets: {
    id: string;
    name: string;
    file_url: string | null;
    duration_seconds: number | null;
    tags: string[] | null;
  } | null;
}

// =============================================================================
// Transform helpers (inlined to avoid circular deps)
// =============================================================================

function transformDialogueLine(row: DialogueLineRow): DialogueLine {
  return {
    id: row.id,
    episodeId: row.episode_id,
    characterAssetId: row.character_asset_id,
    shotId: row.shot_id,
    text: row.text,
    sequenceNumber: row.sequence_number,
    sceneNumber: row.scene_number,
    status: row.status as DialogueLine['status'],
    audioUrl: row.audio_url,
    timelineStartSeconds: row.timeline_start_seconds,
    estimatedDurationSeconds: row.estimated_duration_seconds,
    generationMetadata: row.generation_metadata
      ? {
          durationSeconds:
            (row.generation_metadata.durationSeconds as number) ?? undefined,
          error: (row.generation_metadata.error as string) ?? undefined,
          provider: (row.generation_metadata.provider as string) ?? undefined,
          costCents: (row.generation_metadata.costCents as number) ?? undefined,
          voiceId: (row.generation_metadata.voiceId as string) ?? undefined,
          generatedAt:
            (row.generation_metadata.generatedAt as string) ?? undefined,
          characterCount:
            (row.generation_metadata.characterCount as number) ?? undefined,
        }
      : null,
    language: (row.language || 'en') as SupportedLanguage,
    sourceDialogueId: row.source_dialogue_id,
    createdAt: row.created_at,
  };
}

function getTrackStatus(row: AudioTrackRow): AudioTrackStatus {
  if (row.metadata?.status) {
    return row.metadata.status;
  }
  if (row.file_url) {
    return 'completed';
  }
  return 'pending';
}

function transformAudioTrack(row: AudioTrackRow): AudioTrack {
  return {
    id: row.id,
    episodeId: row.episode_id,
    type: row.type,
    name: row.name,
    fileUrl: row.file_url,
    durationSeconds: row.duration_seconds,
    timelineStartSeconds: row.timeline_start_seconds,
    volume: row.volume,
    metadata: row.metadata,
    createdAt: row.created_at,
    status: getTrackStatus(row),
  };
}

// =============================================================================
// Result type
// =============================================================================

export interface AudioStudioBulkData {
  dialogue: { lines: DialogueLine[]; summary: DialogueLineSummary };
  languages: SupportedLanguage[];
  characters: CharacterAsset[];
  audioSettings: ProjectAudioSettings | null;
  audioTracks: { tracks: AudioTrack[]; summary: AudioTrackSummary };
  audioCues: AudioCueRow[];
  activeBatchJobId: string | null;
  staleResetCount: number;
}

// =============================================================================
// Action
// =============================================================================

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Bulk data loader for Audio Studio
 *
 * Replaces 5+ individual server actions with a single round-trip.
 * Runs one auth check, then fires all queries in parallel via Promise.all.
 * Stale generating-line reset runs as fire-and-forget so it doesn't block the response.
 */
export const getAudioStudioBulkDataAction = enhanceAction(
  async (
    data: z.infer<typeof AudioStudioBulkSchema>,
  ): Promise<AudioStudioBulkData> => {
    const logger = await getLogger();
    const ctx = {
      name: 'audioStudio.bulkLoad',
      episodeId: data.episodeId,
      projectId: data.projectId,
      language: data.language,
    };

    logger.info(ctx, 'Loading Audio Studio bulk data');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized Audio Studio bulk load attempt');
      throw new Error('Authentication required');
    }

    // -------------------------------------------------------------------------
    // Parallel queries — all independent, run simultaneously
    // -------------------------------------------------------------------------

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = client as any;

    const [
      dialogueResult,
      languagesResult,
      characterIdsResult,
      audioSettingsResult,
      activeBatchResult,
      audioTracksResult,
      audioCuesResult,
    ] = await Promise.all([
      // 1. Dialogue lines filtered by language
      db
        .from('dialogue_lines')
        .select(
          `id, episode_id, character_asset_id, shot_id, text, sequence_number,
           scene_number, status, audio_url, timeline_start_seconds,
           estimated_duration_seconds, generation_metadata, language,
           source_dialogue_id, created_at`,
        )
        .eq('episode_id', data.episodeId)
        .eq('language', data.language)
        .order('sequence_number', { ascending: true }),

      // 2. Distinct languages
      db
        .from('dialogue_lines')
        .select('language')
        .eq('episode_id', data.episodeId)
        .limit(200),

      // 3. Character asset IDs (non-null)
      db
        .from('dialogue_lines')
        .select('character_asset_id')
        .eq('episode_id', data.episodeId)
        .not('character_asset_id', 'is', null),

      // 4. Project audio settings
      client
        .from('projects')
        .select('audio_settings')
        .eq('id', data.projectId)
        .single(),

      // 5. Active batch job check
      db
        .from('batch_generation_jobs')
        .select('id, started_at')
        .eq('episode_id', data.episodeId)
        .in('status', ['queued', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // 6. Audio tracks (all types)
      db
        .from('audio_tracks')
        .select(
          `id, episode_id, type, name, file_url, duration_seconds,
           timeline_start_seconds, volume, metadata, created_at`,
        )
        .eq('episode_id', data.episodeId)
        .order('created_at', { ascending: false }),

      // 7. Audio cues with joined audio_assets
      db
        .from('audio_cues')
        .select(
          `id, episode_id, scene_number, cue_type, prompt,
           start_offset_seconds, duration_seconds, is_loopable, status,
           audio_asset_id, audio_track_id,
           audio_assets(id, name, file_url, duration_seconds, tags)`,
        )
        .eq('episode_id', data.episodeId)
        .order('scene_number')
        .order('start_offset_seconds'),
    ]);

    // -------------------------------------------------------------------------
    // Process dialogue lines
    // -------------------------------------------------------------------------

    if (dialogueResult.error) {
      logger.error(
        { ...ctx, error: dialogueResult.error },
        'Failed to fetch dialogue lines',
      );
      throw new Error('Failed to fetch dialogue lines');
    }

    const dialogueRows = (dialogueResult.data ?? []) as DialogueLineRow[];
    const lines = dialogueRows.map(transformDialogueLine);

    const summary: DialogueLineSummary = {
      total: dialogueRows.length,
      pending: 0,
      generating: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of dialogueRows) {
      if (row.status === 'pending') summary.pending++;
      else if (row.status === 'generating') summary.generating++;
      else if (row.status === 'completed') summary.completed++;
      else if (row.status === 'failed') summary.failed++;
    }

    // -------------------------------------------------------------------------
    // Process languages
    // -------------------------------------------------------------------------

    const languageSet = new Set<SupportedLanguage>();
    if (!languagesResult.error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((languagesResult.data ?? []) as any[]).forEach((r) => {
        if (r.language) languageSet.add(r.language as SupportedLanguage);
      });
    }
    if (languageSet.size === 0) languageSet.add('en');
    const languages = Array.from(languageSet);

    // -------------------------------------------------------------------------
    // Process character IDs → fetch assets
    // -------------------------------------------------------------------------

    const characterIds = [
      ...new Set(
        ((characterIdsResult.data ?? []) as { character_asset_id: string }[])
          .map((r) => r.character_asset_id)
          .filter((id): id is string => id !== null),
      ),
    ];

    let characters: CharacterAsset[] = [];
    if (characterIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: assets, error: assetsError } = await (client as any)
        .from('assets')
        .select('id, name, type, thumbnail_url')
        .in('id', characterIds)
        .eq('type', 'character');

      if (assetsError) {
        logger.error(
          { ...ctx, error: assetsError },
          'Failed to fetch character assets',
        );
      } else {
        characters = ((assets ?? []) as AssetRow[]).map((asset) => ({
          id: asset.id,
          name: asset.name,
          type: 'character' as const,
          thumbnailUrl: asset.thumbnail_url,
        }));
      }
    }

    // -------------------------------------------------------------------------
    // Process audio settings
    // -------------------------------------------------------------------------

    const audioSettings =
      audioSettingsResult.error || !audioSettingsResult.data?.audio_settings
        ? null
        : (audioSettingsResult.data.audio_settings as ProjectAudioSettings);

    // -------------------------------------------------------------------------
    // Process active batch job
    // -------------------------------------------------------------------------

    const activeJob = activeBatchResult.data as {
      id: string;
      started_at: string | null;
    } | null;
    const activeBatchJobId = activeJob?.id ?? null;

    // -------------------------------------------------------------------------
    // Process audio tracks
    // -------------------------------------------------------------------------

    if (audioTracksResult.error) {
      logger.error(
        { ...ctx, error: audioTracksResult.error },
        'Failed to fetch audio tracks',
      );
    }

    const trackRows = (audioTracksResult.data ?? []) as AudioTrackRow[];
    const tracks = trackRows.map(transformAudioTrack);

    const trackSummary: AudioTrackSummary = {
      total: tracks.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    for (const track of tracks) {
      if (track.status === 'pending') trackSummary.pending++;
      else if (track.status === 'processing') trackSummary.processing++;
      else if (track.status === 'completed') trackSummary.completed++;
      else if (track.status === 'failed') trackSummary.failed++;
    }

    // -------------------------------------------------------------------------
    // Process audio cues
    // -------------------------------------------------------------------------

    if (audioCuesResult.error) {
      logger.error(
        { ...ctx, error: audioCuesResult.error },
        'Failed to fetch audio cues',
      );
    }

    const audioCues = (audioCuesResult.data ?? []) as AudioCueRow[];

    // -------------------------------------------------------------------------
    // Fire-and-forget: stale reset logic
    // -------------------------------------------------------------------------

    const staleResetCount = 0;

    const shouldReset =
      !activeJob ||
      !activeJob.started_at ||
      Date.now() - new Date(activeJob.started_at).getTime() >=
        STALE_THRESHOLD_MS;

    if (shouldReset) {
      // Non-blocking — don't await this in the critical path
      void (async () => {
        try {
          const { data: updated } = await db
            .from('dialogue_lines')
            .update({ status: 'pending' })
            .eq('episode_id', data.episodeId)
            .eq('status', 'generating')
            .select('id');

          const count = updated?.length ?? 0;
          if (count > 0) {
            logger.info(
              { ...ctx, resetCount: count },
              'Reset stale generating lines to pending (bulk)',
            );
          }
        } catch (err) {
          logger.error(
            { ...ctx, error: err },
            'Failed to reset stale generating lines (bulk)',
          );
        }
      })();
    }

    // -------------------------------------------------------------------------
    // Return result
    // -------------------------------------------------------------------------

    logger.info(
      {
        ...ctx,
        dialogueCount: lines.length,
        languageCount: languages.length,
        characterCount: characters.length,
        trackCount: tracks.length,
        cueCount: audioCues.length,
        hasActiveBatch: !!activeBatchJobId,
      },
      'Audio Studio bulk data loaded',
    );

    return {
      dialogue: { lines, summary },
      languages,
      characters,
      audioSettings,
      audioTracks: { tracks, summary: trackSummary },
      audioCues,
      activeBatchJobId,
      staleResetCount,
    };
  },
  {
    schema: AudioStudioBulkSchema,
  },
);
