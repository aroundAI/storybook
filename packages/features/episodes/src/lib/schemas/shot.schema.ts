import { z } from 'zod';

/**
 * Shot status matching database CHECK constraint
 * Workflow: pending → generating → completed | failed
 */
export const ShotStatusSchema = z.enum([
  'pending',
  'generating',
  'completed',
  'failed',
]);

/**
 * Camera direction for shot
 * Simple movements optimized for AI video generation
 */
export const CameraDirectionSchema = z.enum([
  'static',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'zoom_in',
  'zoom_out',
  'dolly_in',
  'dolly_out',
  'tracking',
  'crane_up',
  'crane_down',
]);

/**
 * Shot metadata schema
 */
export const ShotMetadataSchema = z.object({
  characters: z.array(z.string()).optional(),
  location: z.string().optional(),
  timeOfDay: z.enum(['day', 'night', 'dawn', 'dusk']).optional(),
  weather: z.string().optional(),
  mood: z.string().optional(),
  lighting: z.string().optional(),
});

/**
 * Schema for creating a single shot
 */
export const CreateShotSchema = z.object({
  episodeId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1).max(1000),
  prompt: z.string().min(1).max(2000),
  durationSeconds: z.number().positive().max(10),
  cameraDirection: CameraDirectionSchema.optional(),
  metadata: ShotMetadataSchema.optional(),
});

/**
 * Single shot definition for batch creation
 */
export const BatchShotDefinitionSchema = z.object({
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1).max(1000),
  prompt: z.string().min(1).max(2000),
  durationSeconds: z.number().positive().max(10),
  cameraDirection: CameraDirectionSchema.optional(),
  characters: z.array(z.string()).optional(),
  metadata: ShotMetadataSchema.optional(),
});

/**
 * Schema for batch creating multiple shots
 */
export const BatchCreateShotsSchema = z.object({
  episodeId: z.string().uuid(),
  shots: z.array(BatchShotDefinitionSchema).min(1).max(100),
});

/**
 * Schema for reordering shots
 */
export const ReorderShotsSchema = z.object({
  episodeId: z.string().uuid(),
  shotIds: z.array(z.string().uuid()).min(1),
});

/**
 * Schema for fetching episode shots
 */
export const GetEpisodeShotsSchema = z.object({
  episodeId: z.string().uuid(),
  status: ShotStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * Schema for updating a shot
 */
export const UpdateShotSchema = z.object({
  shotId: z.string().uuid(),
  description: z.string().min(1).max(1000).optional(),
  prompt: z.string().min(1).max(2000).optional(),
  durationSeconds: z.number().positive().max(10).optional(),
  cameraDirection: CameraDirectionSchema.optional(),
  status: ShotStatusSchema.optional(),
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Schema for deleting a shot
 */
export const DeleteShotSchema = z.object({
  shotId: z.string().uuid(),
});

// Type exports
export type ShotStatus = z.infer<typeof ShotStatusSchema>;
export type CameraDirection = z.infer<typeof CameraDirectionSchema>;
export type ShotMetadata = z.infer<typeof ShotMetadataSchema>;
export type CreateShotInput = z.infer<typeof CreateShotSchema>;
export type BatchShotDefinition = z.infer<typeof BatchShotDefinitionSchema>;
export type BatchCreateShotsInput = z.infer<typeof BatchCreateShotsSchema>;
export type ReorderShotsInput = z.infer<typeof ReorderShotsSchema>;
export type GetEpisodeShotsInput = z.infer<typeof GetEpisodeShotsSchema>;
export type UpdateShotInput = z.infer<typeof UpdateShotSchema>;
export type DeleteShotInput = z.infer<typeof DeleteShotSchema>;
