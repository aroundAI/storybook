import { z } from 'zod';

import { URLSchema, UUIDSchema } from './common';

// Shot Status
export const ShotStatusSchema = z.enum([
  'pending',
  'queued',
  'generating',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

// Camera Angle
export const CameraAngleSchema = z.enum([
  'wide',
  'full',
  'medium',
  'medium-close-up',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'pov',
  'low-angle',
  'high-angle',
  'birds-eye',
  'dutch-angle',
  'aerial',
]);

// Camera Movement
export const CameraMovementSchema = z.enum([
  'static',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'zoom-in',
  'zoom-out',
  'dolly-in',
  'dolly-out',
  'tracking',
  'crane-up',
  'crane-down',
  'handheld',
  'steadicam',
  'orbit',
]);

// Shot Composition
export const ShotCompositionSchema = z.object({
  framing: z.string().optional(),
  focus: z.string().optional(),
  depth: z.enum(['shallow', 'deep', 'medium']).optional(),
  rule: z
    .enum(['rule-of-thirds', 'golden-ratio', 'centered', 'symmetrical'])
    .optional(),
});

// Shot Metadata
export const ShotMetadataSchema = z.object({
  characters: z.array(UUIDSchema).optional(),
  locations: z.array(UUIDSchema).optional(),
  props: z.array(UUIDSchema).optional(),
  dialogue: z.string().optional(),
  action: z.string().optional(),
  soundEffects: z.array(z.string()).optional(),
  music: z.string().optional(),
  lighting: z
    .enum(['natural', 'soft', 'hard', 'dramatic', 'low-key', 'high-key'])
    .optional(),
  mood: z.string().optional(),
  colorGrading: z.string().optional(),
  visualEffects: z.array(z.string()).optional(),
  composition: ShotCompositionSchema.optional(),
});

// Create Shot
export const CreateShotSchema = z.object({
  episodeId: UUIDSchema,
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1),
  duration: z.number().positive().default(5),
  cameraAngle: CameraAngleSchema.optional(),
  cameraMovement: CameraMovementSchema.optional(),
  prompt: z.string().optional(),
  metadata: ShotMetadataSchema.optional(),
});

// Update Shot
export const UpdateShotSchema = CreateShotSchema.partial().extend({
  id: UUIDSchema,
  status: ShotStatusSchema.optional(),
  videoUrl: URLSchema.optional(),
  thumbnailUrl: URLSchema.optional(),
});

// Batch Create Shots
export const BatchCreateShotsSchema = z.object({
  episodeId: UUIDSchema,
  shots: z.array(CreateShotSchema.omit({ episodeId: true })),
});

// Type exports
export type ShotStatus = z.infer<typeof ShotStatusSchema>;
export type CameraAngle = z.infer<typeof CameraAngleSchema>;
export type CameraMovement = z.infer<typeof CameraMovementSchema>;
export type ShotComposition = z.infer<typeof ShotCompositionSchema>;
export type ShotMetadata = z.infer<typeof ShotMetadataSchema>;
export type CreateShot = z.infer<typeof CreateShotSchema>;
export type UpdateShot = z.infer<typeof UpdateShotSchema>;
export type BatchCreateShots = z.infer<typeof BatchCreateShotsSchema>;
