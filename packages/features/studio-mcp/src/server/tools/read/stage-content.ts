import 'server-only';

import { z } from 'zod';

import { fetchAllRows } from '@kit/shared/pagination';

import { defineTool } from '../../../registry';
import {
  AfterCursor,
  PAGING_NOTE,
  cursorArg,
  decodeCursor,
  limitArg,
  sceneWindow,
} from '../pagination';
import { type EpisodeRef, requireEpisodeInAccount } from './scope';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const SCENE_PAGING = `${PAGING_NOTE} The unit is the scene: one page holds whole scenes.`;

const episodeIdArg = z
  .string()
  .uuid()
  .describe('The episode id (from list_episodes).');

interface ScreenplaySceneLike {
  number?: number;
  heading?: string;
  location?: string;
  timeOfDay?: string;
  description?: string;
  dialogue?: Array<{
    character?: string;
    text?: string;
    parenthetical?: string;
  }>;
  estimatedDuration?: number;
}

type ScreenplayRow = EpisodeRef & {
  title: string;
  screenplay_data: {
    scenes?: ScreenplaySceneLike[];
    metadata?: unknown;
  } | null;
};

export const getScreenplayTool = defineTool({
  name: 'get_screenplay',
  title: 'Get screenplay',
  description: `The episode's screenplay, scene by scene: heading, location, time of day, description, dialogue lines and estimated duration, in the shape the screenplay stage writes. ${SCENE_PAGING}`,
  inputSchema: { episodeId: episodeIdArg, cursor: cursorArg, limit: limitArg },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const episode = await requireEpisodeInAccount<ScreenplayRow>(
      context.principal.supabase,
      context.accountId,
      input.episodeId,
      'id, title, screenplay_data',
    );

    const all = [...(episode.screenplay_data?.scenes ?? [])]
      .map((scene, index) => ({ ...scene, number: scene.number ?? index + 1 }))
      .sort((a, b) => a.number - b.number);

    if (all.length === 0) {
      return {
        text: `Episode "${episode.title}" has no screenplay yet.`,
        structuredContent: {
          episodeId: episode.id,
          totalScenes: 0,
          scenes: [],
          nextCursor: null,
          note: 'No screenplay yet: the screenplay stage has not run for this episode.',
        },
      };
    }

    const after = decodeCursor(input.cursor, AfterCursor)?.after;
    const window = sceneWindow(
      all.map((scene) => scene.number),
      after,
      input.limit,
    );
    const scenes = all.filter((scene) => window.scenes.includes(scene.number));

    return {
      text: `Screenplay of "${episode.title}": scenes ${scenes[0]?.number}-${scenes[scenes.length - 1]?.number} of ${window.totalScenes}${window.nextCursor ? ' (more follow)' : ''}.`,
      structuredContent: {
        episodeId: episode.id,
        totalScenes: window.totalScenes,
        metadata: episode.screenplay_data?.metadata ?? null,
        scenes,
        nextCursor: window.nextCursor,
      },
    };
  },
});

interface ShotRow {
  id: string;
  scene_number: number | null;
  shot_number: number | null;
  sequence_number: number;
  duration_seconds: number;
  scene_description: string | null;
  action_description: string | null;
  prompt: string;
  camera_direction: string | null;
  status: string;
  video_url: string | null;
  thumbnail_url: string | null;
  first_frame_description: string | null;
  last_frame_description: string | null;
  transition_type: string | null;
  continuation_from_shot_id: string | null;
  location_area: string | null;
  location_environment_description: string | null;
  primary_subject: unknown;
  frame_strategy: string | null;
  shorts_candidate: boolean | null;
  created_at: string;
  updated_at: string;
}

const SHOT_COLUMNS =
  'id, scene_number, shot_number, sequence_number, duration_seconds, scene_description, action_description, prompt, camera_direction, status, video_url, thumbnail_url, first_frame_description, last_frame_description, transition_type, continuation_from_shot_id, location_area, location_environment_description, primary_subject, frame_strategy, shorts_candidate, created_at, updated_at';

/** Shots and dialogue lines without a scene are reported as scene 0. */
const sceneOf = (row: { scene_number: number | null }) => row.scene_number ?? 0;

export const getShotsTool = defineTool({
  name: 'get_shots',
  title: 'Get shots',
  description: `The episode's shot list from the shots table, grouped by scene and in sequence order: description, duration, VEO prompt, camera direction, frame descriptions, transition and status, as the visual studio shows them. ${SCENE_PAGING}`,
  inputSchema: { episodeId: episodeIdArg, cursor: cursorArg, limit: limitArg },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const episode = await requireEpisodeInAccount<
      EpisodeRef & { title: string }
    >(client, context.accountId, input.episodeId, 'id, title');

    const rows = await fetchAllRows<ShotRow>(
      (from, to) =>
        client
          .from('shots')
          .select(SHOT_COLUMNS)
          .eq('episode_id', episode.id)
          .is('deleted_at', null)
          .order('scene_number', { ascending: true, nullsFirst: true })
          .order('sequence_number', { ascending: true })
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: ShotRow[] | null;
          error: { message: string } | null;
        }>,
      'shots',
    );

    const after = decodeCursor(input.cursor, AfterCursor)?.after;
    const window = sceneWindow(rows.map(sceneOf), after, input.limit);

    const scenes = window.scenes.map((sceneNumber) => ({
      sceneNumber,
      shots: rows
        .filter((row) => sceneOf(row) === sceneNumber)
        .map((row) => ({
          id: row.id,
          sceneNumber,
          shotNumber: row.shot_number ?? row.sequence_number,
          sequenceNumber: row.sequence_number,
          description: row.action_description ?? row.scene_description ?? '',
          sceneDescription: row.scene_description,
          durationSeconds: row.duration_seconds,
          prompt: row.prompt,
          cameraDirection: row.camera_direction,
          status: row.status,
          videoUrl: row.video_url,
          thumbnailUrl: row.thumbnail_url,
          firstFrameDescription: row.first_frame_description,
          lastFrameDescription: row.last_frame_description,
          transitionType: row.transition_type,
          continuationFromShotId: row.continuation_from_shot_id,
          locationArea: row.location_area,
          locationEnvironmentDescription: row.location_environment_description,
          primarySubject: row.primary_subject,
          frameStrategy: row.frame_strategy,
          shortsCandidate: row.shorts_candidate ?? false,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
    }));

    const shown = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);

    return {
      text:
        rows.length === 0
          ? `Episode "${episode.title}" has no shots yet.`
          : `${shown} of ${rows.length} shots in "${episode.title}", scenes ${window.scenes[0]}-${window.scenes[window.scenes.length - 1]} of ${window.totalScenes}${window.nextCursor ? ' (more follow)' : ''}.`,
      structuredContent: {
        episodeId: episode.id,
        totalShots: rows.length,
        totalScenes: window.totalScenes,
        scenes,
        nextCursor: window.nextCursor,
        ...(rows.length === 0
          ? {
              note: 'No shots yet: the shot list stage has not run for this episode.',
            }
          : {}),
      },
    };
  },
});

interface DialogueRow {
  id: string;
  scene_number: number | null;
  sequence_number: number;
  shot_id: string | null;
  character_name: string | null;
  character_asset_id: string | null;
  text: string;
  emotion: string | null;
  language: string;
  status: string;
  audio_url: string | null;
  estimated_duration_seconds: number | null;
  timeline_start_seconds: number | null;
}

const DIALOGUE_COLUMNS =
  'id, scene_number, sequence_number, shot_id, character_name, character_asset_id, text, emotion, language, status, audio_url, estimated_duration_seconds, timeline_start_seconds';

export const getDialogueTool = defineTool({
  name: 'get_dialogue',
  title: 'Get dialogue',
  description: `The episode's dialogue lines from the dialogue_lines table, grouped by scene and in sequence order: character, text, emotion, language, the shot each line belongs to, and whether a voice render exists. ${SCENE_PAGING}`,
  inputSchema: { episodeId: episodeIdArg, cursor: cursorArg, limit: limitArg },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const episode = await requireEpisodeInAccount<
      EpisodeRef & { title: string }
    >(client, context.accountId, input.episodeId, 'id, title');

    const rows = await fetchAllRows<DialogueRow>(
      (from, to) =>
        client
          .from('dialogue_lines')
          .select(DIALOGUE_COLUMNS)
          .eq('episode_id', episode.id)
          .order('scene_number', { ascending: true, nullsFirst: true })
          .order('sequence_number', { ascending: true })
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: DialogueRow[] | null;
          error: { message: string } | null;
        }>,
      'dialogue_lines',
    );

    const after = decodeCursor(input.cursor, AfterCursor)?.after;
    const window = sceneWindow(rows.map(sceneOf), after, input.limit);

    const scenes = window.scenes.map((sceneNumber) => ({
      sceneNumber,
      lines: rows
        .filter((row) => sceneOf(row) === sceneNumber)
        .map((row) => ({
          id: row.id,
          sceneNumber,
          sequenceNumber: row.sequence_number,
          shotId: row.shot_id,
          character: row.character_name,
          characterAssetId: row.character_asset_id,
          text: row.text,
          emotion: row.emotion,
          language: row.language,
          status: row.status,
          audioUrl: row.audio_url,
          estimatedDurationSeconds: row.estimated_duration_seconds,
          timelineStartSeconds: row.timeline_start_seconds,
        })),
    }));

    const shown = scenes.reduce((sum, scene) => sum + scene.lines.length, 0);

    return {
      text:
        rows.length === 0
          ? `Episode "${episode.title}" has no dialogue lines yet.`
          : `${shown} of ${rows.length} dialogue lines in "${episode.title}", scenes ${window.scenes[0]}-${window.scenes[window.scenes.length - 1]} of ${window.totalScenes}${window.nextCursor ? ' (more follow)' : ''}.`,
      structuredContent: {
        episodeId: episode.id,
        totalLines: rows.length,
        totalScenes: window.totalScenes,
        scenes,
        nextCursor: window.nextCursor,
        ...(rows.length === 0
          ? {
              note: 'No dialogue lines yet: they are written with the shot list.',
            }
          : {}),
      },
    };
  },
});
