import { z } from 'zod';

/**
 * Episode status enum matching database CHECK constraint
 * Workflow: draft → story → storyboard → generating → editing → ready → published
 */
export const EpisodeStatusSchema = z.enum([
  'draft',
  'story',
  'storyboard',
  'generating',
  'editing',
  'ready',
  'published',
]);

export const ShotStatusSchema = z.enum([
  'pending',
  'generating',
  'completed',
  'failed',
]);

export const CameraAngleSchema = z.enum([
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'pov',
  'low-angle',
  'high-angle',
  'birds-eye',
  'dutch-angle',
]);

export const CameraMovementSchema = z.enum([
  'static',
  'pan',
  'tilt',
  'zoom',
  'dolly',
  'tracking',
  'crane',
  'handheld',
  'steadicam',
]);

export const EpisodeMetadataSchema = z.object({
  sceneCount: z.number().int().nonnegative().optional(),
  shotCount: z.number().int().nonnegative().optional(),
  totalDuration: z.number().nonnegative().optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Schema for creating a new episode
 * Episode number is auto-assigned if not provided
 */
export const CreateEpisodeSchema = z.object({
  projectId: z.string().uuid(),
  seasonId: z.string().uuid().optional(),
  number: z.number().int().positive().optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

/**
 * Schema for getting a single episode
 */
export const GetEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
});

/**
 * Schema for updating episode status with workflow validation
 * Requires version for optimistic locking
 */
export const UpdateEpisodeStatusSchema = z.object({
  episodeId: z.string().uuid(),
  status: EpisodeStatusSchema,
  version: z.number().int().positive(),
});

/**
 * Schema for listing episodes with filters and pagination
 */
export const ListProjectEpisodesSchema = z.object({
  projectId: z.string().uuid(),
  seasonId: z.string().uuid().optional(),
  status: EpisodeStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * Schema for updating episode data
 * Requires version for optimistic locking
 */
export const UpdateEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  storyData: z.record(z.unknown()).optional(),
  screenplayData: z.record(z.unknown()).optional(),
  shotList: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  masterVideoAssetId: z.string().uuid().optional().nullable(),
});

/**
 * Schema for deleting an episode (soft delete)
 */
export const DeleteEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
});

/**
 * Schema for resetting an episode to draft state.
 * Clears story_data, screenplay_data, shot_list and all shots rows.
 */
export const ResetEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
  version: z.number().int().positive(),
});

/**
 * Schema for surgical reset to storyboard state.
 * Keeps story_data, screenplay_data, and dialogue_lines intact.
 * Clears shots, audio tracks, audio cues, and shot_list.
 */
export const ResetToStoryboardSchema = z.object({
  episodeId: z.string().uuid(),
  accountId: z.string().uuid(),
});

/**
 * Schema for bulk surgical reset to storyboard state.
 * Same as ResetToStoryboardSchema but for multiple episodes.
 */
export const BulkResetToStoryboardSchema = z.object({
  episodeIds: z.array(z.string().uuid()),
  accountId: z.string().uuid(),
});

/**
 * Schema for flexible reset to a specific pipeline stage.
 * Unlike ResetEpisodeSchema, does NOT require version (no optimistic locking).
 * Clears all data produced after the target stage.
 */
export const ResetToStageSchema = z.object({
  episodeId: z.string().uuid(),
  targetStage: z.enum(['draft', 'story', 'screenplay', 'storyboard']),
});
export type ResetToStageInput = z.infer<typeof ResetToStageSchema>;

/**
 * Schema for bulk flexible reset to a specific pipeline stage.
 * Applies the same stage-based cleanup to multiple episodes.
 */
export const BulkResetToStageSchema = z.object({
  episodeIds: z.array(z.string().uuid()),
  accountId: z.string().uuid(),
  targetStage: z.enum(['draft', 'story', 'screenplay', 'storyboard']),
});
export type BulkResetToStageInput = z.infer<typeof BulkResetToStageSchema>;

/**
 * Schema for batch fetching shot counts for multiple episodes.
 * Used by the bulk generate modal to detect which episodes already have shots.
 */
export const BatchShotCountSchema = z.object({
  episodeIds: z.array(z.string().uuid()).min(1).max(100),
});
export type BatchShotCountInput = z.infer<typeof BatchShotCountSchema>;


export const ShotMetadataSchema = z.object({
  characters: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  props: z.array(z.string()).optional(),
  dialogue: z.string().optional(),
  soundEffects: z.array(z.string()).optional(),
  music: z.string().optional(),
  lighting: z.string().optional(),
  mood: z.string().optional(),
});

export const ShotGenerationSettingsSchema = z.object({
  provider: z.enum(['kling', 'runway', 'luma']).optional(),
  modelVersion: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().positive().optional(),
  seed: z.number().int().positive().optional(),
  negativePrompt: z.string().optional(),
});

export const CreateShotSchema = z.object({
  episodeId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1),
  duration: z.number().positive(),
  cameraAngle: CameraAngleSchema.optional(),
  cameraMovement: CameraMovementSchema.optional(),
  prompt: z.string().optional(),
  metadata: ShotMetadataSchema.optional(),
  generationSettings: ShotGenerationSettingsSchema.optional(),
});

export const UpdateShotSchema = z.object({
  id: z.string().uuid(),
  sceneNumber: z.number().int().positive().optional(),
  shotNumber: z.number().int().positive().optional(),
  description: z.string().min(1).optional(),
  duration: z.number().positive().optional(),
  cameraAngle: CameraAngleSchema.optional(),
  cameraMovement: CameraMovementSchema.optional(),
  prompt: z.string().optional(),
  status: ShotStatusSchema.optional(),
  videoUrl: z.string().url().optional().or(z.literal('')),
  thumbnailUrl: z.string().url().optional().or(z.literal('')),
  metadata: ShotMetadataSchema.optional(),
  generationSettings: ShotGenerationSettingsSchema.optional(),
});

/**
 * Schema for reordering shots
 * Accepts an array of shot IDs in their new order
 */
export const ReorderShotsSchema = z.object({
  episodeId: z.string().uuid(),
  shotIds: z.array(z.string().uuid()).min(1),
});

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type GetEpisodeInput = z.infer<typeof GetEpisodeSchema>;
export type UpdateEpisodeStatusInput = z.infer<
  typeof UpdateEpisodeStatusSchema
>;
export type ListProjectEpisodesInput = z.infer<
  typeof ListProjectEpisodesSchema
>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;
export type DeleteEpisodeInput = z.infer<typeof DeleteEpisodeSchema>;
export type ResetEpisodeInput = z.infer<typeof ResetEpisodeSchema>;
export type ResetToStoryboardInput = z.infer<typeof ResetToStoryboardSchema>;
export type BulkResetToStoryboardInput = z.infer<
  typeof BulkResetToStoryboardSchema
>;
export type CreateShotInput = z.infer<typeof CreateShotSchema>;
export type UpdateShotInput = z.infer<typeof UpdateShotSchema>;
export type ReorderShotsInput = z.infer<typeof ReorderShotsSchema>;

// Story generation schemas (FILM-305)
export {
  GenerateStoryIdeasSchema,
  GenerateFullStorySchema,
  CharacterInputSchema,
  type GenerateStoryIdeasInput,
  type GenerateFullStoryInput,
  type CharacterInput,
  type GenerationMetadata,
} from './schemas/story.schema';

// Shot CRUD schemas are in ./schemas/shot.schema.ts (FILM-303)
// Shot list generation schemas are in ./schemas/shot-list.schema.ts (FILM-307)
// Import directly from those files to avoid naming conflicts

// Batch episode creation schemas (FILM-314)
export {
  ArcPositionSchema,
  EpisodeOutlineSchema,
  GenerateSeasonOutlineSchema,
  BatchCreateEpisodesSchema,
  RegenerateEpisodeOutlineSchema,
  type ArcPosition,
  type EpisodeOutline,
  type GenerateSeasonOutlineInput,
  type BatchCreateEpisodesInput,
  type RegenerateEpisodeOutlineInput,
  type GenerateSeasonOutlineResponse,
  type BatchCreateEpisodesResponse,
  type RegenerateEpisodeOutlineResponse,
} from './schemas/batch-episode.schema';

// ============================================================================
// Screenplay Conversion Schemas (FILM-306)
// ============================================================================

/**
 * Content style affects dialogue density and pacing
 */
export const ContentStyleSchema = z.enum([
  'dialogue-heavy',
  'action-heavy',
  'balanced',
]);

/**
 * Schema for converting episode story to screenplay format
 * Used by convertToScreenplayAction
 */
export const ConvertToScreenplaySchema = z.object({
  episodeId: z.string().uuid(),
  targetSceneCount: z.number().int().min(2).max(200).optional(), // Extended for long-form content
  dialogueStyle: z.enum(['natural', 'stylized', 'minimal']).optional(),
  contentStyle: ContentStyleSchema.optional(), // Affects dialogue density
});

export type ConvertToScreenplayInput = z.infer<
  typeof ConvertToScreenplaySchema
>;

// Season CRUD schemas (FILM-302)
export {
  CreateSeasonSchema,
  GetProjectSeasonsSchema,
  UpdateSeasonSchema,
  DeleteSeasonSchema,
  type CreateSeasonInput,
  type GetProjectSeasonsInput,
  type UpdateSeasonInput,
  type DeleteSeasonInput,
} from './schemas/season.schema';

// Season Generation Schema (FILM-201)
export {
  AnalyzeSeasonSchema,
  GenerateSeasonEpisodesSchema,
} from './schemas/season-generation.schema';

// Enhanced Create Episode Wizard
export {
  CreateEpisodeWithContextSchema,
  type CreateEpisodeWithContextInput,
} from './schemas/create-episode-wizard.schema';

// Timeline Planning Schema
export const PlanTimelineSchema = z.object({
  episodeId: z.string().uuid(),
});

export type PlanTimelineInput = z.infer<typeof PlanTimelineSchema>;
