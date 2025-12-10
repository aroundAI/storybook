import { z } from 'zod';

/**
 * Video provider options for generation
 */
export const VideoProviderSchema = z.enum([
  'kling',
  'runway',
  'luma',
  'hailuo',
]);
export type VideoProviderType = z.infer<typeof VideoProviderSchema>;

/**
 * Audio provider options for voice generation
 */
export const AudioProviderSchema = z.enum(['elevenlabs', 'playht']);
export type AudioProviderType = z.infer<typeof AudioProviderSchema>;

/**
 * Video quality levels
 */
export const VideoQualitySchema = z.enum(['standard', 'pro']);
export type VideoQualityType = z.infer<typeof VideoQualitySchema>;

/**
 * Aspect ratio options for video generation
 */
export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);
export type AspectRatioType = z.infer<typeof AspectRatioSchema>;

/**
 * Complete generation settings schema (without defaults - for form validation)
 */
export const GenerationSettingsSchema = z.object({
  // Video settings
  defaultVideoProvider: VideoProviderSchema,
  defaultVideoQuality: VideoQualitySchema,
  defaultAspectRatio: AspectRatioSchema,

  // Audio settings
  defaultAudioProvider: AudioProviderSchema,
  voiceStability: z.number().min(0).max(100),

  // Cost controls
  monthlyBudgetCents: z.number().min(0).max(1000000),
  enableBudgetAlerts: z.boolean(),
  budgetWarningThreshold: z.number().min(50).max(95),

  // Concurrency settings
  maxConcurrentJobs: z.number().min(1).max(10),

  // Auto-retry settings
  enableAutoRetry: z.boolean(),
  maxRetryAttempts: z.number().min(0).max(5),

  // Notification preferences
  notifyOnCompletion: z.boolean(),
  notifyOnFailure: z.boolean(),
  notifyViaEmail: z.boolean(),
});

export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;

/**
 * Default generation settings for new accounts
 */
export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  defaultVideoProvider: 'kling',
  defaultVideoQuality: 'standard',
  defaultAspectRatio: '16:9',
  defaultAudioProvider: 'elevenlabs',
  voiceStability: 50,
  monthlyBudgetCents: 10000,
  enableBudgetAlerts: true,
  budgetWarningThreshold: 80,
  maxConcurrentJobs: 3,
  enableAutoRetry: true,
  maxRetryAttempts: 2,
  notifyOnCompletion: true,
  notifyOnFailure: true,
  notifyViaEmail: false,
};
