/**
 * Action Schemas
 *
 * Zod schemas for video generation server actions.
 * Note: These schemas are for the refactored actions with queue integration.
 * The original schemas in lib/schemas.ts are kept for backwards compatibility.
 */

import { z } from 'zod';

/**
 * Schema for generating a single video (refactored action with queue integration)
 * Differs from lib/schemas.ts - derives accountId from shot instead of requiring it
 */
export const GenerateVideoActionSchema = z.object({
  shotId: z.string().uuid(),
  provider: z.enum(['kling', 'runway', 'luma', 'hailuo']).optional(),
  mode: z.enum(['std', 'pro']).optional().default('std'),
  referenceImageUrl: z.string().url().optional(),
});

export type GenerateVideoActionInput = z.infer<typeof GenerateVideoActionSchema>;

/**
 * Response from generate video action
 */
export interface GenerateVideoResponse {
  success: boolean;
  generationJobId: string;
  estimatedCostCents: number;
  estimatedTime: number;
  queuePosition?: number;
  message?: string;
}

/**
 * Schema for batch generating videos (refactored action with queue integration)
 */
export const BatchGenerateVideosActionSchema = z.object({
  shotIds: z.array(z.string().uuid()).min(1).max(50),
  provider: z.enum(['kling', 'runway', 'luma', 'hailuo']).optional(),
  mode: z.enum(['std', 'pro']).optional().default('std'),
  priority: z.enum(['high', 'normal', 'low']).optional().default('normal'),
});

export type BatchGenerateVideosActionInput = z.infer<typeof BatchGenerateVideosActionSchema>;

/**
 * Result for a single shot in batch generation
 */
export interface BatchGenerateResult {
  shotId: string;
  success: boolean;
  generationJobId?: string;
  error?: string;
}

/**
 * Response from batch generate videos action
 */
export interface BatchGenerateResponse {
  totalShots: number;
  successCount: number;
  failureCount: number;
  totalEstimatedCostCents: number;
  results: BatchGenerateResult[];
}

/**
 * Priority level for batch generation
 */
export type BatchPriority = 'high' | 'normal' | 'low';

/**
 * Map batch priority to queue priority (0-10, higher = more important)
 */
export const PRIORITY_MAP: Record<BatchPriority, number> = {
  high: 8,
  normal: 5,
  low: 2,
};
