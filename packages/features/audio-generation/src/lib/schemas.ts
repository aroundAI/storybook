import { z } from 'zod';

// Provider enums
export const VoiceProviderNameSchema = z.enum([
  'elevenlabs',
  'playht',
  'deepgram',
  'azure',
  'google',
]);

export const AudioProviderSchema = VoiceProviderNameSchema;

export const AudioTypeSchema = z.enum(['voice', 'music', 'sfx']);

// Voice settings schema
export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  useSpeakerBoost: z.boolean().optional(),
});

// Voice generation request schema
export const VoiceGenerationRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1),
  settings: VoiceSettingsSchema.optional(),
  modelId: z.string().optional(),
  outputFormat: z.enum(['mp3', 'wav', 'pcm', 'ogg']).optional(),
  sampleRate: z.number().positive().optional(),
});

// Clone voice request schema
export const CloneVoiceRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  language: z.string().optional(),
});

// Music generation request schema
export const MusicGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  duration: z.number().positive().max(240),
  genre: z.string().optional(),
  mood: z.string().optional(),
  tempo: z.string().optional(),
  instrumentalOnly: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

// Server action schemas
export const GenerateVoiceSchema = z.object({
  shotId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  provider: VoiceProviderNameSchema.optional(),
  request: VoiceGenerationRequestSchema,
});

export const GenerateMusicSchema = z.object({
  episodeId: z.string().uuid(),
  request: MusicGenerationRequestSchema,
});

// Music job status schema
export const GetMusicJobStatusSchema = z.object({
  jobId: z.string().uuid(),
});

// Cancel music generation schema
export const CancelMusicGenerationSchema = z.object({
  jobId: z.string().uuid(),
});

export const GetVoicesSchema = z.object({
  provider: VoiceProviderNameSchema.optional(),
  language: z.string().optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  age: z.string().optional(),
  accent: z.string().optional(),
});

export const CloneVoiceSchema = z.object({
  provider: VoiceProviderNameSchema.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  language: z.string().optional(),
});

// Provider configuration schemas
export const VoiceProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  userId: z.string().optional(),
  baseUrl: z.string().url().optional(),
  timeout: z.number().positive().optional(),
  maxRetries: z.number().positive().max(10).optional(),
});

export const MusicProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  timeout: z.number().positive().optional(),
  maxRetries: z.number().positive().max(10).optional(),
});

// Audio job status schema
export const AudioJobStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

// Voice cloning consent schema
export const VoiceCloneConsentSchema = z.object({
  consenterName: z.string().min(1, 'Name is required'),
  consenterEmail: z.string().email().optional().or(z.literal('')),
  consentType: z.enum(['self', 'other_authorized']),
  consentText: z
    .string()
    .min(50, 'Consent text must be at least 50 characters'),
  consentSignature: z.string().optional(),
});

// Start voice clone action schema
export const StartVoiceCloneSchema = z.object({
  assetId: z.string().uuid(),
  voiceName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  samples: z
    .array(z.string().url())
    .min(1, 'At least one sample required')
    .max(25, 'Maximum 25 samples allowed'),
  consent: VoiceCloneConsentSchema,
});

// Delete voice clone schema
export const DeleteVoiceCloneSchema = z.object({
  assetId: z.string().uuid(),
});

// Check clone status schema
export const CheckCloneStatusSchema = z.object({
  assetId: z.string().uuid(),
});

// Clone status enum schema
export const CloneStatusSchema = z.enum([
  'pending',
  'training',
  'ready',
  'failed',
]);

// Infer types from schemas
export type VoiceProviderNameType = z.infer<typeof VoiceProviderNameSchema>;
export type AudioProviderType = z.infer<typeof AudioProviderSchema>;
export type AudioTypeSchemaType = z.infer<typeof AudioTypeSchema>;
export type VoiceSettingsSchemaType = z.infer<typeof VoiceSettingsSchema>;
export type VoiceGenerationRequestSchemaType = z.infer<
  typeof VoiceGenerationRequestSchema
>;
export type MusicGenerationRequestSchemaType = z.infer<
  typeof MusicGenerationRequestSchema
>;
export type GenerateVoiceSchemaType = z.infer<typeof GenerateVoiceSchema>;
export type GenerateMusicSchemaType = z.infer<typeof GenerateMusicSchema>;
export type GetMusicJobStatusSchemaType = z.infer<
  typeof GetMusicJobStatusSchema
>;
export type CancelMusicGenerationSchemaType = z.infer<
  typeof CancelMusicGenerationSchema
>;
export type GetVoicesSchemaType = z.infer<typeof GetVoicesSchema>;
export type CloneVoiceSchemaType = z.infer<typeof CloneVoiceSchema>;
export type VoiceCloneConsentSchemaType = z.infer<
  typeof VoiceCloneConsentSchema
>;
export type StartVoiceCloneSchemaType = z.infer<typeof StartVoiceCloneSchema>;
export type DeleteVoiceCloneSchemaType = z.infer<typeof DeleteVoiceCloneSchema>;
export type CheckCloneStatusSchemaType = z.infer<typeof CheckCloneStatusSchema>;
export type CloneStatusType = z.infer<typeof CloneStatusSchema>;
