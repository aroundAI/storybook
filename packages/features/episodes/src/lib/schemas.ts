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
});

/**
 * Schema for deleting an episode (soft delete)
 */
export const DeleteEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
});

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
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
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
