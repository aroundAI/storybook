import { z } from 'zod';

export const VideoProviderSchema = z.enum(['kling', 'runway', 'luma']);

export const GenerationStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

export const VideoGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  duration: z.number().positive().max(20),
  aspectRatio: z.string().regex(/^\d+:\d+$/),
  seed: z.number().int().positive().optional(),
  modelVersion: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const GenerateVideoSchema = z.object({
  accountId: z.string().uuid(),
  shotId: z.string().uuid(),
  provider: VideoProviderSchema,
  request: VideoGenerationRequestSchema,
});

export const BatchGenerateVideoSchema = z.object({
  shots: z.array(
    z.object({
      shotId: z.string().uuid(),
      request: VideoGenerationRequestSchema,
    }),
  ),
  provider: VideoProviderSchema,
});

export const PollVideoStatusSchema = z.object({
  jobId: z.string().uuid(),
});

export const CancelVideoJobSchema = z.object({
  jobId: z.string().uuid(),
});

export type GenerateVideoInput = z.infer<typeof GenerateVideoSchema>;
export type BatchGenerateVideoInput = z.infer<typeof BatchGenerateVideoSchema>;
export type PollVideoStatusInput = z.infer<typeof PollVideoStatusSchema>;
export type CancelVideoJobInput = z.infer<typeof CancelVideoJobSchema>;
