import { z } from 'zod';

import { VoiceProviderNameSchema, VoiceSettingsSchema } from '../schemas';

/**
 * Schema for generating voice audio for a dialogue line
 */
export const GenerateDialogueVoiceSchema = z.object({
  dialogueLineId: z.string().uuid(),
  voiceId: z.string().optional(),
  provider: VoiceProviderNameSchema.optional(),
  settings: VoiceSettingsSchema.optional(),
  overwriteExisting: z.boolean().optional(),
});

export type GenerateDialogueVoiceSchemaType = z.infer<
  typeof GenerateDialogueVoiceSchema
>;

/**
 * Schema for generating voice audio from raw text (previews)
 */
export const GenerateVoiceFromTextSchema = z.object({
  episodeId: z.string().uuid(),
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1),
  provider: VoiceProviderNameSchema.optional(),
  settings: VoiceSettingsSchema.optional(),
});

export type GenerateVoiceFromTextSchemaType = z.infer<
  typeof GenerateVoiceFromTextSchema
>;

/**
 * Result type for dialogue voice generation
 */
export interface GenerateDialogueVoiceResult {
  dialogueLineId: string;
  audioUrl: string;
  duration: number;
  cost: number;
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Result type for text-based voice generation
 */
export interface GenerateVoiceFromTextResult {
  audioUrl: string;
  duration: number;
  cost: number;
  format: string;
}

/**
 * Metadata stored in dialogue_lines.generation_metadata
 */
export interface VoiceGenerationMetadata {
  provider: string;
  providerJobId?: string;
  voiceId: string;
  settings: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speed?: number;
  };
  costCents: number;
  durationSeconds: number;
  generatedAt: string;
  characterCount: number;
  error?: string;
}
