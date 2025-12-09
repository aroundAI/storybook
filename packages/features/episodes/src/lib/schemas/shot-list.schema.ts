import { z } from 'zod';

/**
 * Schema for generating a shot list from screenplay/story
 */
export const GenerateShotListSchema = z.object({
  episodeId: z.string().uuid(),
  shotDurationMin: z.number().min(3).max(10).default(5),
  shotDurationMax: z.number().min(3).max(10).default(8),
  videoProvider: z.enum(['kling', 'runway', 'luma']).default('kling'),
  provider: z.enum(['anthropic', 'openai', 'google']).optional(),
  model: z.string().optional(),
});

/**
 * Shot type enum matching prompt template output
 */
export const ShotTypeSchema = z.enum([
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-shoulder',
  'pov',
]);

/**
 * Camera direction enum matching prompt template output
 */
export const PromptCameraDirectionSchema = z.enum([
  'static',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'zoom_in',
  'zoom_out',
  'dolly_in',
  'dolly_out',
]);

/**
 * Time of day enum
 */
export const TimeOfDaySchema = z.enum(['day', 'night', 'dawn', 'dusk']);

/**
 * Shot metadata from LLM
 */
export const GeneratedShotMetadataSchema = z.object({
  location: z.string(),
  timeOfDay: TimeOfDaySchema,
  mood: z.string().optional(),
  lighting: z.string().optional(),
});

/**
 * Individual generated shot from LLM
 */
export const GeneratedShotSchema = z.object({
  sequenceNumber: z.number(),
  sceneNumber: z.number(),
  shotNumber: z.number(),
  shotType: ShotTypeSchema,
  cameraDirection: PromptCameraDirectionSchema,
  description: z.string(),
  action: z.string(),
  prompt: z.string(),
  characters: z.array(z.string()),
  duration: z.number().min(3).max(10),
  metadata: GeneratedShotMetadataSchema,
});

/**
 * Shot list metadata summary
 */
export const ShotListMetadataSchema = z.object({
  totalShots: z.number(),
  totalDuration: z.number(),
  shotTypes: z.object({
    wide: z.number(),
    medium: z.number(),
    closeUp: z.number(),
  }),
  locations: z.array(z.string()),
  characters: z.array(z.string()),
});

/**
 * Complete shot list output from LLM
 */
export const ShotListOutputSchema = z.object({
  shots: z.array(GeneratedShotSchema),
  metadata: ShotListMetadataSchema,
});

/**
 * Full LLM response structure
 */
export const ShotListGenerationOutputSchema = z.object({
  shotList: ShotListOutputSchema,
});

// Type exports
export type GenerateShotListInput = z.infer<typeof GenerateShotListSchema>;
export type ShotType = z.infer<typeof ShotTypeSchema>;
export type PromptCameraDirection = z.infer<typeof PromptCameraDirectionSchema>;
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;
export type GeneratedShotMetadata = z.infer<typeof GeneratedShotMetadataSchema>;
export type GeneratedShot = z.infer<typeof GeneratedShotSchema>;
export type ShotListMetadata = z.infer<typeof ShotListMetadataSchema>;
export type ShotListOutput = z.infer<typeof ShotListOutputSchema>;
export type ShotListGenerationOutput = z.infer<
  typeof ShotListGenerationOutputSchema
>;
