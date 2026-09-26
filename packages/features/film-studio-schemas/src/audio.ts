import { z } from 'zod';

import { URLSchema, UUIDSchema } from './common';
import { GenerationStatusSchema } from './video';

// Audio Provider
export const AudioProviderSchema = z.enum(['elevenlabs']);

// Audio Type
export const AudioTypeSchema = z.enum(['voice', 'music', 'sfx', 'ambient']);

// Audio Format
export const AudioFormatSchema = z.enum(['mp3', 'wav', 'pcm', 'ogg', 'flac']);

// Voice Settings
export const VoiceGenerationSettingsSchema = z.object({
  voiceId: z.string().min(1),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.0),
  useSpeakerBoost: z.boolean().default(true),
  modelId: z.string().optional(),
  outputFormat: AudioFormatSchema.default('mp3'),
});

// Voice Generation Request
export const VoiceGenerationRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1),
  settings: VoiceGenerationSettingsSchema.partial().optional(),
  modelId: z.string().optional(),
  outputFormat: AudioFormatSchema.optional(),
});

// Music Generation Request
export const MusicGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  duration: z.number().positive().max(240), // 4 minutes max
  genre: z.string().optional(),
  mood: z.string().optional(),
  tempo: z.enum(['slow', 'medium', 'fast']).optional(),
  instrumentalOnly: z.boolean().default(true),
  tags: z.array(z.string()).optional(),
});

// Generate Voice
export const GenerateVoiceSchema = z.object({
  shotId: UUIDSchema.optional(),
  episodeId: UUIDSchema.optional(),
  request: VoiceGenerationRequestSchema,
});

// Generate Music
export const GenerateMusicSchema = z.object({
  episodeId: UUIDSchema,
  shotId: UUIDSchema.optional(),
  request: MusicGenerationRequestSchema,
});

// Audio Generation Job Update
export const UpdateAudioGenerationJobSchema = z.object({
  jobId: UUIDSchema,
  status: GenerationStatusSchema,
  audioUrl: URLSchema.optional(),
  duration: z.number().positive().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Voice Clone
export const VoiceCloneSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  audioFiles: z.array(z.string()).min(1), // URLs or file paths
  labels: z.record(z.string()).optional(),
});

// Voice Library
export const VoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: AudioProviderSchema,
  language: z.string(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  age: z.enum(['young', 'middle-aged', 'old']).optional(),
  accent: z.string().optional(),
  description: z.string().optional(),
  previewUrl: URLSchema.optional(),
  settings: VoiceGenerationSettingsSchema.partial().optional(),
  isCustom: z.boolean().default(false),
});

// Type exports
export type AudioProvider = z.infer<typeof AudioProviderSchema>;
export type AudioType = z.infer<typeof AudioTypeSchema>;
export type AudioFormat = z.infer<typeof AudioFormatSchema>;
export type VoiceGenerationSettings = z.infer<
  typeof VoiceGenerationSettingsSchema
>;
export type VoiceGenerationRequest = z.infer<
  typeof VoiceGenerationRequestSchema
>;
export type MusicGenerationRequest = z.infer<
  typeof MusicGenerationRequestSchema
>;
export type GenerateVoice = z.infer<typeof GenerateVoiceSchema>;
export type GenerateMusic = z.infer<typeof GenerateMusicSchema>;
export type UpdateAudioGenerationJob = z.infer<
  typeof UpdateAudioGenerationJobSchema
>;
export type VoiceClone = z.infer<typeof VoiceCloneSchema>;
export type Voice = z.infer<typeof VoiceSchema>;
