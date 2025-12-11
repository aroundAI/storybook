import { z } from 'zod';

/**
 * Lip sync schemas for validation
 */

// Provider name schema
export const LipSyncProviderNameSchema = z.enum(['synclabs', 'wav2lip']);

// Quality schema
export const LipSyncQualitySchema = z.enum(['fast', 'standard', 'high']);

// Status schema
export const LipSyncStatusSchema = z.enum([
  'queued',
  'pending',
  'processing',
  'completed',
  'failed',
]);

// Face coordinates schema
export const FaceCoordinatesSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

// Detect faces action schema
export const DetectFacesSchema = z.object({
  videoUrl: z.string().url(),
});

// Generate lip sync action schema
export const GenerateLipSyncSchema = z.object({
  shotId: z.string().uuid(),
  dialogueLineId: z.string().uuid(),
  provider: LipSyncProviderNameSchema.optional(),
  quality: LipSyncQualitySchema.optional().default('standard'),
  faceCoordinates: FaceCoordinatesSchema.optional(),
});

// Apply lip sync action schema
export const ApplyLipSyncSchema = z.object({
  jobId: z.string().uuid(),
});

// Get lip sync job schema
export const GetLipSyncJobSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    shotId: z.string().uuid().optional(),
  })
  .refine((data) => data.jobId || data.shotId, {
    message: 'Either jobId or shotId must be provided',
  });

// Poll lip sync status schema
export const PollLipSyncStatusSchema = z.object({
  jobId: z.string().uuid(),
});
