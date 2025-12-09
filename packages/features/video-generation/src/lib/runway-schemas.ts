import { z } from 'zod';

/**
 * Schema for validating Runway video generation requests.
 */
export const RunwayGenerationRequestSchema = z.object({
  /** Text prompt describing the video to generate */
  prompt: z.string().min(1, 'Prompt is required').max(1000, 'Prompt too long'),

  /** Video duration in seconds (5, 10, or 18) */
  duration: z.union([z.literal(5), z.literal(10), z.literal(18)]).default(10),

  /** Aspect ratio for the output video */
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).default('16:9'),

  /** Runway model version */
  model: z.enum(['gen3_alpha', 'gen3_turbo']).default('gen3_turbo'),

  /** URL of reference image for image-to-video generation */
  referenceImageUrl: z.string().url().optional(),

  /** Motion strength for image-to-video (0-1) */
  motionStrength: z
    .number()
    .min(0, 'Motion strength must be >= 0')
    .max(1, 'Motion strength must be <= 1')
    .default(0.5),

  /** Seed for reproducible generation */
  seed: z.number().int().positive().optional(),
});

/**
 * Inferred type from the schema.
 */
export type RunwayGenerationRequestInput = z.input<
  typeof RunwayGenerationRequestSchema
>;
export type RunwayGenerationRequestOutput = z.output<
  typeof RunwayGenerationRequestSchema
>;
