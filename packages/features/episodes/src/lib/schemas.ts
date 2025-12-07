import { z } from 'zod';

export const EpisodeStatusSchema = z.enum([
  'draft',
  'planning',
  'in_progress',
  'completed',
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

export const CreateEpisodeSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  episodeNumber: z.number().int().positive(),
  script: z.string().optional(),
  metadata: EpisodeMetadataSchema.optional(),
});

export const UpdateEpisodeSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  episodeNumber: z.number().int().positive().optional(),
  script: z.string().optional(),
  status: EpisodeStatusSchema.optional(),
  duration: z.number().nonnegative().optional(),
  metadata: EpisodeMetadataSchema.optional(),
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

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;
export type CreateShotInput = z.infer<typeof CreateShotSchema>;
export type UpdateShotInput = z.infer<typeof UpdateShotSchema>;
