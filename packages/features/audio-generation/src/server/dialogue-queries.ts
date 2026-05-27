'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GetCharactersForEpisodeSchema,
  type GetCharactersForEpisodeSchemaType,
  GetDialogueLinesSchema,
  type GetDialogueLinesSchemaType,
} from '../lib/schemas/dialogue.schema';
import type {
  CharacterAsset,
  DialogueLine,
  DialogueLineSummary,
  GetDialogueLinesResult,
  SupportedLanguage,
} from '../lib/types/dialogue.types';

// Note: These queries use type assertions because the film studio tables
// are not yet in the generated database types. The database schema will
// be aligned in a future update. RLS policies enforce authorization.

/**
 * Fetch available languages for an episode
 * Returns list of language codes present in dialogue lines
 */
export const getAvailableLanguagesAction = enhanceAction(
  async (data: { episodeId: string }): Promise<SupportedLanguage[]> => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch distinct languages (using select only language column)
    // TODO: Generate specific Supabase types to avoid 'any' casting (FILM-506)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (client as any)
      .from('dialogue_lines')
      .select('language')
      .eq('episode_id', data.episodeId)
      .limit(200);

    if (error) {
      throw new Error('Failed to fetch languages');
    }

    const languages = new Set<SupportedLanguage>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows || []).forEach((r: any) => {
      if (r.language) languages.add(r.language as SupportedLanguage);
    });

    // Default to 'en' if empty or not present
    if (languages.size === 0) languages.add('en');

    return Array.from(languages);
  },
  {
    schema: z.object({ episodeId: z.string().uuid() }),
  },
);

/**
 * Database response type for dialogue line
 */
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

/**
 * Database response type for character asset
 */
interface AssetRow {
  id: string;
  name: string;
  type: string;
  thumbnail_url?: string;
}

/**
 * Transform database row to DialogueLine interface
 */
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

// Note: calculateSummary function removed - now calculated inline with single-pass loop

/**
 * Fetch all dialogue lines for an episode
 *
 * Returns dialogue lines ordered by sequence number with summary counts.
 * RLS policies ensure user has access to the episode.
 */
export const getDialogueLinesAction = enhanceAction(
  async (data: GetDialogueLinesSchemaType): Promise<GetDialogueLinesResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dialogue.getLines',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Fetching dialogue lines for episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized dialogue fetch attempt');
      throw new Error('Authentication required');
    }

    // Fetch dialogue lines for the episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('dialogue_lines')
      .select(
        `
        id,
        episode_id,
        character_asset_id,
        shot_id,
        text,
        sequence_number,
        scene_number,
        status,
        audio_url,
        timeline_start_seconds,
        estimated_duration_seconds,
        generation_metadata,
        language,
        source_dialogue_id,
        created_at
      `,
      )
      .eq('episode_id', data.episodeId);

    // Apply language filter if provided
    if (data.language) {
      query = query.eq('language', data.language);
    }

    const { data: rows, error } = await query.order('sequence_number', {
      ascending: true,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch dialogue lines');
      throw new Error('Failed to fetch dialogue lines');
    }

    const dialogueRows = (rows ?? []) as DialogueLineRow[];
    const lines = dialogueRows.map(transformDialogueLine);

    // Calculate summary directly from raw rows for efficiency (avoid 5x filter on transformed array)
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

    logger.info(
      { ...ctx, total: summary.total, completed: summary.completed },
      'Dialogue lines fetched successfully',
    );

    return { lines, summary };
  },
  {
    schema: GetDialogueLinesSchema,
  },
);

/**
 * Fetch characters that have dialogue lines in an episode
 *
 * Returns unique characters from dialogue lines for filtering.
 */
export const getCharactersForEpisodeAction = enhanceAction(
  async (
    data: GetCharactersForEpisodeSchemaType,
  ): Promise<CharacterAsset[]> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dialogue.getCharacters',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Fetching characters for episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized characters fetch attempt');
      throw new Error('Authentication required');
    }

    // First get unique character IDs from dialogue lines
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueRows, error: dialogueError } = await (client as any)
      .from('dialogue_lines')
      .select('character_asset_id')
      .eq('episode_id', data.episodeId)
      .not('character_asset_id', 'is', null);

    if (dialogueError) {
      logger.error(
        { ...ctx, error: dialogueError },
        'Failed to fetch dialogue character IDs',
      );
      throw new Error('Failed to fetch characters');
    }

    // Get unique character IDs
    const characterIds = [
      ...new Set(
        (dialogueRows ?? [])
          .map(
            (row: { character_asset_id: string | null }) =>
              row.character_asset_id,
          )
          .filter((id: string | null): id is string => id !== null),
      ),
    ];

    if (characterIds.length === 0) {
      return [];
    }

    // Fetch character assets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: assets, error: assetsError } = await (client as any)
      .from('assets')
      .select('id, name, type, thumbnail_url')
      .in('id', characterIds)
      .eq('type', 'character');

    if (assetsError) {
      logger.error(
        { ...ctx, error: assetsError },
        'Failed to fetch characters',
      );
      throw new Error('Failed to fetch characters');
    }

    const characters: CharacterAsset[] = ((assets ?? []) as AssetRow[]).map(
      (asset) => ({
        id: asset.id,
        name: asset.name,
        type: 'character' as const,
        thumbnailUrl: asset.thumbnail_url,
      }),
    );

    logger.info(
      { ...ctx, characterCount: characters.length },
      'Characters fetched successfully',
    );

    return characters;
  },
  {
    schema: GetCharactersForEpisodeSchema,
  },
);
