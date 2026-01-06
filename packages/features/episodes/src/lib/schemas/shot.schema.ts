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
 * Camera direction for shot - free-form string to allow LLM creativity
 * Examples: static, pan_left, zoom_in_slow, push_in_slow, dolly_in, etc.
 */
export const CameraDirectionSchema = z.string();

/**
 * Timeline event type within a shot
 */
export const TimelineEventTypeSchema = z.enum([
  'action',
  'dialogue',
  'transition',
]);

/**
 * Single timeline event within a shot (timestamp-based)
 */
export const TimelineEventDataSchema = z.object({
  startTime: z.string(), // "00:00" format
  endTime: z.string(), // "03:00" format
  type: TimelineEventTypeSchema,
  character: z.string().nullish(),
  content: z.string(),
  emotion: z.string().nullable().optional(),
});

/**
 * VEO 3.1 structured prompt for a shot (V2 - Timeline-based)
 */
export const VeoPromptDataSchema = z.object({
  shotLine: z.string(),
  timeline: z.array(TimelineEventDataSchema),
  audio: z.string(),
  style: z.string(),
  avoid: z.string(),
  fullPrompt: z.string(),
});

/**
 * Reference image for VEO 3.1 "Ingredients"
 */
export const ShotReferenceImageSchema = z.object({
  name: z.string(),
  url: z.string().url(),
});

/**
 * Dialogue timing for a shot
 */
export const ShotDialogueTimingDataSchema = z.object({
  startSeconds: z.number(),
  durationSeconds: z.number(),
  characterName: z.string(),
  text: z.string(),
  emotion: z.string().nullable(),
});

/**
 * Shot metadata schema (extended for VEO 3.1)
 */
export const ShotMetadataSchema = z.object({
  characters: z.array(z.string()).optional(),
  location: z.string().optional(),
  timeOfDay: z
    .enum([
      'dawn',
      'morning',
      'midday',
      'afternoon',
      'golden-hour',
      'dusk',
      'night',
      'day',
    ])
    .optional(),
  weather: z.string().optional(),
  mood: z.string().optional(),
  lighting: z.string().optional(),
  shotType: z.string().optional(),
  action: z.string().optional(),
  // VEO 3.1 Enhanced Fields
  veoPrompt: VeoPromptDataSchema.optional(),
  referenceImages: z
    .object({
      characters: z.array(ShotReferenceImageSchema),
      locations: z.array(ShotReferenceImageSchema),
    })
    .optional(),
  dialogueTiming: z.array(ShotDialogueTimingDataSchema).optional(),
  missingAssets: z
    .object({
      characters: z.array(z.string()),
      locations: z.array(z.string()),
    })
    .optional(),
  // Shorts/Clips Candidate Fields
  shortsCandidate: z.boolean().optional().default(false),
  shortsMetadata: z
    .object({
      viralScore: z.number().min(1).max(10),
      hookType: z
        .enum(['question', 'reveal', 'conflict', 'visual', 'humor', 'cliffhanger'])
        .nullish(),
      standaloneSummary: z.string().nullish(),
    })
    .optional(),
});

/**
 * Schema for creating a single shot
 */
export const CreateShotSchema = z.object({
  episodeId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1).max(1000),
  prompt: z.string().min(1).max(8000),
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
  prompt: z.string().min(1).max(8000),
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
  firstFrameUrl: z.string().url().optional().or(z.literal('')),
  lastFrameUrl: z.string().url().optional().or(z.literal('')),
  metadata: z.record(z.unknown()).optional(),
  // Video clip trimming fields (Phase 1: Video Clip Trimming)
  trimInPoint: z.number().min(0).optional().nullable(),
  trimOutPoint: z.number().min(0).optional().nullable(),
  sourceDuration: z.number().positive().optional().nullable(),
  // Timeline positioning
  timelineStartSeconds: z.number().min(0).optional(),
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
export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>;
export type TimelineEventData = z.infer<typeof TimelineEventDataSchema>;
export type VeoPromptData = z.infer<typeof VeoPromptDataSchema>;
export type ShotMetadata = z.infer<typeof ShotMetadataSchema>;
export type CreateShotInput = z.infer<typeof CreateShotSchema>;
export type BatchShotDefinition = z.infer<typeof BatchShotDefinitionSchema>;
export type BatchCreateShotsInput = z.infer<typeof BatchCreateShotsSchema>;
export type ReorderShotsInput = z.infer<typeof ReorderShotsSchema>;
export type GetEpisodeShotsInput = z.infer<typeof GetEpisodeShotsSchema>;
export type UpdateShotInput = z.infer<typeof UpdateShotSchema>;
export type DeleteShotInput = z.infer<typeof DeleteShotSchema>;
