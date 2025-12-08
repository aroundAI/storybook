import { z } from 'zod';

/**
 * Schema for validating Kling generation request parameters.
 */
export const KlingGenerationRequestSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .max(2000, 'Prompt must be 2000 characters or less'),
  negativePrompt: z
    .string()
    .max(1000, 'Negative prompt must be 1000 characters or less')
    .optional(),
  duration: z.union([z.literal(5), z.literal(10)], {
    errorMap: () => ({ message: 'Duration must be 5 or 10 seconds' }),
  }),
  aspectRatio: z.enum(['16:9', '9:16', '1:1'], {
    errorMap: () => ({
      message: 'Aspect ratio must be 16:9, 9:16, or 1:1',
    }),
  }),
  model: z.enum(['kling-v1.0', 'kling-v1.5']).default('kling-v1.5'),
  mode: z.enum(['std', 'pro']).default('std'),
  referenceImageUrl: z
    .string()
    .url('Reference image must be a valid URL')
    .optional(),
  seed: z.number().int().positive('Seed must be a positive integer').optional(),
});

/**
 * Schema for validating Kling job status responses.
 */
export const KlingStatusSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  progress: z.number().min(0).max(100).optional(),
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  completedAt: z.string().optional(),
});

/**
 * Schema for PiAPI generation response.
 */
export const PiAPIGenerationResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.object({
    task_id: z.string(),
    task_status: z.string(),
    created_at: z.number(),
  }),
});

/**
 * Schema for PiAPI status response.
 */
export const PiAPIStatusResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.object({
    task_id: z.string(),
    task_status: z.enum(['submitted', 'processing', 'succeed', 'failed']),
    task_status_msg: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
    progress: z.number(),
    task_result: z
      .object({
        videos: z.array(
          z.object({
            id: z.string(),
            url: z.string().url(),
            duration: z.number(),
          }),
        ),
      })
      .optional(),
  }),
});

/**
 * Inferred types from schemas for runtime validation.
 */
export type KlingGenerationRequestInput = z.input<
  typeof KlingGenerationRequestSchema
>;
export type KlingGenerationRequestOutput = z.output<
  typeof KlingGenerationRequestSchema
>;
export type KlingStatusOutput = z.output<typeof KlingStatusSchema>;
