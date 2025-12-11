import { z } from 'zod';

/**
 * PlayHT API response for TTS generation
 */
export interface PlayHTGenerationResponse {
  id: string;
  status: 'CREATED' | 'GENERATING' | 'COMPLETE' | 'FAILED';
  transcription_id?: string;
  audio_url?: string;
  duration?: number;
  created_at: string;
  voice: string;
  text: string;
  output_format: string;
  sample_rate: number;
}

/**
 * PlayHT voice from API
 */
export interface PlayHTVoice {
  id: string;
  name: string;
  voice_engine: string;
  language: string;
  language_code: string;
  gender: 'male' | 'female';
  age?: 'youth' | 'adult' | 'old';
  style?: string;
  sample?: string;
  tempo?: string;
  is_cloned?: boolean;
  loudness?: string;
  texture?: string;
  voiceEngine?: string;
  accent?: string;
}

/**
 * PlayHT cloned voice response
 */
export interface PlayHTClonedVoice {
  id: string;
  name: string;
  created_at: string;
  type: 'instant' | 'professional';
  status: 'pending' | 'ready' | 'failed';
}

/**
 * PlayHT voice clone request response
 */
export interface PlayHTCloneResponse {
  id: string;
  name: string;
  status: 'pending' | 'ready' | 'failed';
}

/**
 * PlayHT error response
 */
export interface PlayHTErrorResponse {
  error_message?: string;
  message?: string;
  error?: string;
  status?: number;
}

/**
 * PlayHT output formats
 */
export type PlayHTOutputFormat = 'mp3' | 'wav' | 'ogg' | 'mulaw';

/**
 * PlayHT sample rates
 */
export type PlayHTSampleRate = 8000 | 16000 | 24000 | 44100 | 48000;

/**
 * PlayHT quality levels
 */
export type PlayHTQuality = 'draft' | 'low' | 'medium' | 'high' | 'premium';

/**
 * PlayHT voice settings schema
 */
export const PlayHTVoiceSettingsSchema = z.object({
  speed: z.number().min(0.5).max(2.0).default(1.0),
  temperature: z.number().min(0).max(2).default(1.0),
  quality: z
    .enum(['draft', 'low', 'medium', 'high', 'premium'])
    .default('medium'),
  sampleRate: z
    .union([
      z.literal(8000),
      z.literal(16000),
      z.literal(24000),
      z.literal(44100),
      z.literal(48000),
    ])
    .default(24000),
  outputFormat: z.enum(['mp3', 'wav', 'ogg', 'mulaw']).default('mp3'),
  emotion: z.string().optional(),
  seed: z.number().int().positive().optional(),
});

export type PlayHTVoiceSettings = z.infer<typeof PlayHTVoiceSettingsSchema>;

/**
 * PlayHT TTS request payload
 */
export interface PlayHTTTSPayload {
  text: string;
  voice: string;
  output_format: PlayHTOutputFormat;
  sample_rate: PlayHTSampleRate;
  speed?: number;
  temperature?: number;
  quality: PlayHTQuality;
  voice_engine?: string;
  emotion?: string;
  seed?: number;
}
