import { z } from 'zod';

import { VoiceSettingsSchema } from '../schemas';

/**
 * Voice assignment for a character in batch generation
 */
export const VoiceAssignmentSchema = z.object({
  voiceId: z.string().min(1),
  settings: VoiceSettingsSchema.optional(),
});

/**
 * Schema for batch generating dialogue voice for an episode
 */
export const BatchGenerateDialogueSchema = z.object({
  episodeId: z.string().uuid(),
  voiceAssignments: z
    .record(
      z.string().uuid(), // character asset ID
      VoiceAssignmentSchema,
    )
    .optional(),
  overwriteExisting: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

export type BatchGenerateDialogueSchemaType = z.infer<
  typeof BatchGenerateDialogueSchema
>;

/**
 * Schema for getting batch job status
 */
export const GetBatchStatusSchema = z.object({
  batchJobId: z.string().uuid(),
});

export type GetBatchStatusSchemaType = z.infer<typeof GetBatchStatusSchema>;

/**
 * Schema for retrying failed dialogue lines
 */
export const RetryFailedDialogueSchema = z.object({
  batchJobId: z.string().uuid(),
});

export type RetryFailedDialogueSchemaType = z.infer<
  typeof RetryFailedDialogueSchema
>;

/**
 * Schema for cancelling a batch job
 */
export const CancelBatchSchema = z.object({
  batchJobId: z.string().uuid(),
});

export type CancelBatchSchemaType = z.infer<typeof CancelBatchSchema>;

/**
 * Batch job status enum
 */
export const BatchJobStatusEnum = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

export type BatchJobStatusType = z.infer<typeof BatchJobStatusEnum>;

/**
 * Voice assignment type (from schema)
 */
export interface VoiceAssignment {
  voiceId: string;
  settings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speed?: number;
    useSpeakerBoost?: boolean;
  };
}

/**
 * Error entry for failed dialogue lines
 */
export interface BatchError {
  dialogueLineId: string;
  error: string;
  timestamp: string;
}

/**
 * Result type for batch generation start
 */
export interface BatchGenerateDialogueResult {
  batchJobId: string;
  episodeId: string;
  totalLines: number;
  estimatedCost: number;
  estimatedDuration: number;
  status: BatchJobStatusType;
}

/**
 * Progress information for batch job
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  percentage: number;
}

/**
 * Cost information for batch job
 */
export interface BatchCost {
  estimated: number;
  actual: number;
}

/**
 * Status result for batch job
 */
export interface BatchJobStatus {
  batchJobId: string;
  status: BatchJobStatusType;
  progress: BatchProgress;
  cost: BatchCost;
  errors: BatchError[];
  startedAt: string | null;
  completedAt: string | null;
  estimatedCompletionAt: string | null;
}

/**
 * Result type for retry failed dialogue
 */
export interface RetryFailedDialogueResult {
  batchJobId: string;
  retriedCount: number;
  status: 'processing';
}

/**
 * Result type for cancel batch
 */
export interface CancelBatchResult {
  success: boolean;
  batchJobId: string;
}

/**
 * Database record type for batch_generation_jobs
 */
export interface BatchGenerationJob {
  id: string;
  episode_id: string;
  account_id: string;
  status: BatchJobStatusType;
  total_lines: number;
  completed_lines: number;
  failed_lines: number;
  estimated_cost: number;
  actual_cost: number;
  voice_assignments: Record<string, VoiceAssignment>;
  errors: BatchError[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
