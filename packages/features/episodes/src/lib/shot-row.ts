/**
 * A `shots` row as the studio reads it: the columns the episode workspace
 * selects, and the one mapping to the `Shot` the visual studio and the
 * OpenClaw manifest take. Shared by the workspace layout and the MCP
 * `get_veo_manifest` tool (FILM-1909), so the manifest Claude reads is the
 * one the visual studio's export builds.
 */
import type { Database } from '@kit/supabase/database';

import { PrimarySubjectSchema } from './schemas/shot-list.schema';
import type {
  FirstFrameSource,
  FrameStrategy,
  ShortsMetadata,
  Shot,
  TransitionType,
} from './types';

export const STUDIO_SHOT_COLUMNS = `
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      first_frame_url, last_frame_url, generation_job_id, generation_metadata,
      shorts_candidate, shorts_metadata,
      transition_type, continuation_from_shot_id, inherit_last_frame,
      first_frame_description, last_frame_description, first_frame_source,
      location_area, location_environment_description,
      primary_subject, frame_strategy, generation_origin,
      created_at, updated_at, deleted_at
    `;

type ShotsRow = Database['public']['Tables']['shots']['Row'];

export type StudioShotRow = Pick<
  ShotsRow,
  | 'id'
  | 'episode_id'
  | 'scene_number'
  | 'shot_number'
  | 'sequence_number'
  | 'duration_seconds'
  | 'scene_description'
  | 'action_description'
  | 'prompt'
  | 'camera_direction'
  | 'status'
  | 'video_url'
  | 'thumbnail_url'
  | 'first_frame_url'
  | 'last_frame_url'
  | 'generation_job_id'
  | 'generation_metadata'
  | 'shorts_candidate'
  | 'shorts_metadata'
  | 'transition_type'
  | 'continuation_from_shot_id'
  | 'inherit_last_frame'
  | 'first_frame_description'
  | 'last_frame_description'
  | 'first_frame_source'
  | 'location_area'
  | 'location_environment_description'
  | 'primary_subject'
  | 'frame_strategy'
  | 'generation_origin'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;

export function shotFromRow(shot: StudioShotRow): Shot {
  return {
    id: shot.id,
    episodeId: shot.episode_id,
    sceneNumber: shot.scene_number ?? 1,
    shotNumber: shot.shot_number ?? shot.sequence_number,
    sequenceNumber: shot.sequence_number,
    description: shot.action_description ?? shot.scene_description ?? '',
    duration: shot.duration_seconds,
    durationSeconds: shot.duration_seconds,
    prompt: shot.prompt,
    cameraAngle: null,
    cameraMovement: null,
    cameraDirection: shot.camera_direction,
    status: shot.status as 'pending' | 'generating' | 'completed' | 'failed',
    videoUrl: shot.video_url,
    thumbnailUrl: shot.thumbnail_url,
    firstFrameUrl: shot.first_frame_url ?? null,
    lastFrameUrl: shot.last_frame_url ?? null,
    generationJobId: shot.generation_job_id,
    metadata: (shot.generation_metadata as Record<string, unknown>) ?? null,
    generationSettings: null,
    generationStartedAt: null,
    generationCompletedAt: null,
    shortsCandidate: shot.shorts_candidate ?? false,
    shortsMetadata: (shot.shorts_metadata as ShortsMetadata | null) ?? null,
    // OpenClaw Shot Intelligence fields
    transitionType: (shot.transition_type as TransitionType | null) ?? null,
    continuationFromShotId: shot.continuation_from_shot_id ?? null,
    inheritLastFrame: shot.inherit_last_frame ?? false,
    firstFrameDescription: shot.first_frame_description ?? null,
    lastFrameDescription: shot.last_frame_description ?? null,
    firstFrameSource:
      (shot.first_frame_source as FirstFrameSource | null) ?? null,
    locationArea: shot.location_area ?? null,
    locationEnvironmentDescription:
      shot.location_environment_description ?? null,
    primarySubject:
      PrimarySubjectSchema.nullish().parse(shot.primary_subject) ?? null,
    frameStrategy: (shot.frame_strategy as FrameStrategy | null) ?? null,
    generationOrigin: shot.generation_origin,
    createdAt: shot.created_at,
    updatedAt: shot.updated_at,
    deletedAt: shot.deleted_at,
  };
}
