import { z } from 'zod';

import { URLSchema, UUIDSchema } from './common';

// Video Provider
export const VideoProviderSchema = z.enum(['kling', 'runway', 'luma']);

// Generation Status
export const GenerationStatusSchema = z.enum([
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

// Aspect Ratio
export const AspectRatioSchema = z.string().regex(/^\d+:\d+$/);

// Video Generation Settings
export const VideoGenerationSettingsSchema = z.object({
  provider: VideoProviderSchema,
  modelVersion: z.string().optional(),
  aspectRatio: AspectRatioSchema.default('16:9'),
  duration: z.number().positive().max(20).default(5),
  seed: z.number().int().positive().optional(),
  negativePrompt: z.string().max(1000).optional(),
  fps: z.number().int().positive().optional(),
  quality: z.enum(['draft', 'standard', 'high']).optional(),
  motionStrength: z.number().min(0).max(1).optional(),
});

// Video Generation Request
export const VideoGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  duration: z.number().positive().max(20),
  aspectRatio: AspectRatioSchema,
  seed: z.number().int().positive().optional(),
  modelVersion: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

// Generate Video
export const GenerateVideoSchema = z.object({
  shotId: UUIDSchema,
  provider: VideoProviderSchema,
  request: VideoGenerationRequestSchema,
});

// Video Generation Job Update
export const UpdateVideoGenerationJobSchema = z.object({
  jobId: UUIDSchema,
  status: GenerationStatusSchema,
  videoUrl: URLSchema.optional(),
  thumbnailUrl: URLSchema.optional(),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Provider-specific schemas
export const KlingGenerationSchema = VideoGenerationRequestSchema.extend({
  mode: z.enum(['standard', 'pro']).optional(),
  negativePrompt: z.string().max(2000).optional(),
});

export const RunwayGenerationSchema = VideoGenerationRequestSchema.extend({
  interpolate: z.boolean().optional(),
  upscale: z.boolean().optional(),
  watermark: z.boolean().default(false),
});

export const LumaGenerationSchema = VideoGenerationRequestSchema.extend({
  loop: z.boolean().optional(),
  keyframes: z
    .array(
      z.object({
        frame: z.number().int().nonnegative(),
        prompt: z.string(),
      }),
    )
    .optional(),
});

// Type exports
export type VideoProvider = z.infer<typeof VideoProviderSchema>;
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type VideoGenerationSettings = z.infer<
  typeof VideoGenerationSettingsSchema
>;
export type VideoGenerationRequest = z.infer<
  typeof VideoGenerationRequestSchema
>;
export type GenerateVideo = z.infer<typeof GenerateVideoSchema>;
export type UpdateVideoGenerationJob = z.infer<
  typeof UpdateVideoGenerationJobSchema
>;
export type KlingGeneration = z.infer<typeof KlingGenerationSchema>;
export type RunwayGeneration = z.infer<typeof RunwayGenerationSchema>;
export type LumaGeneration = z.infer<typeof LumaGenerationSchema>;
