import { z } from 'zod';

// Provider enums
export const VoiceProviderNameSchema = z.enum([
  'elevenlabs',
  'playht',
  'deepgram',
  'azure',
  'google',
]);

export const MusicProviderNameSchema = z.enum([
  'suno',
  'udio',
  'mubert',
  'beatoven',
]);

export const AudioProviderSchema = z.union([
  VoiceProviderNameSchema,
  MusicProviderNameSchema,
]);

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
  provider: MusicProviderNameSchema.optional(),
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

// Infer types from schemas
export type VoiceProviderNameType = z.infer<typeof VoiceProviderNameSchema>;
export type MusicProviderNameType = z.infer<typeof MusicProviderNameSchema>;
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
