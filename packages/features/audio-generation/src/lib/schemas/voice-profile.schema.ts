import { z } from 'zod';

import { VoiceSettingsSchema } from '../schemas';

/**
 * Voice profile schemas for FILM-507 Voice Assignment
 */

// List voices with optional filters
export const ListVoicesSchema = z.object({
  language: z.string().optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  age: z.string().optional(),
  accent: z.string().optional(),
  search: z.string().optional(),
});

export type ListVoicesSchemaType = z.infer<typeof ListVoicesSchema>;

// Get voice profile for a character
export const GetVoiceProfileSchema = z.object({
  characterAssetId: z.string().uuid(),
});

export type GetVoiceProfileSchemaType = z.infer<typeof GetVoiceProfileSchema>;

// Save voice profile to a character
export const SaveVoiceProfileSchema = z.object({
  characterAssetId: z.string().uuid(),
  providerVoiceId: z.string().min(1),
  provider: z.enum(['elevenlabs', 'playht', 'deepgram', 'azure', 'google']),
  settings: VoiceSettingsSchema.optional(),
});

export type SaveVoiceProfileSchemaType = z.infer<typeof SaveVoiceProfileSchema>;

// Delete voice profile from a character
export const DeleteVoiceProfileSchema = z.object({
  characterAssetId: z.string().uuid(),
});

export type DeleteVoiceProfileSchemaType = z.infer<
  typeof DeleteVoiceProfileSchema
>;

// Bulk assign same voice to multiple characters
export const BulkAssignVoiceSchema = z.object({
  characterAssetIds: z.array(z.string().uuid()).min(1),
  providerVoiceId: z.string().min(1),
  provider: z.enum(['elevenlabs', 'playht', 'deepgram', 'azure', 'google']),
  settings: VoiceSettingsSchema.optional(),
});

export type BulkAssignVoiceSchemaType = z.infer<typeof BulkAssignVoiceSchema>;

// Auto-assign voices based on character gender/age
export const AutoAssignVoicesSchema = z.object({
  characterAssetIds: z.array(z.string().uuid()).min(1),
  projectId: z.string().uuid(),
});

export type AutoAssignVoicesSchemaType = z.infer<typeof AutoAssignVoicesSchema>;

// Response types
export interface VoiceProfileResponse {
  assetId: string;
  provider: string;
  providerVoiceId: string;
  settings: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speed?: number;
    useSpeakerBoost?: boolean;
  } | null;
}

export interface ListVoicesResponse {
  voices: Array<{
    id: string;
    name: string;
    provider: string;
    language: string;
    gender?: 'male' | 'female' | 'neutral';
    age?: string;
    accent?: string;
    description?: string;
    previewUrl?: string;
    isCloned?: boolean;
  }>;
  total: number;
}

export interface SaveVoiceProfileResponse {
  success: boolean;
  voiceAssetId: string;
}

export interface BulkAssignVoiceResponse {
  success: boolean;
  assignedCount: number;
  failedCount: number;
  results: Array<{
    characterAssetId: string;
    success: boolean;
    error?: string;
  }>;
}

export interface AutoAssignVoicesResponse {
  success: boolean;
  assignedCount: number;
  results: Array<{
    characterAssetId: string;
    assignedVoiceId: string | null;
    assignedVoiceName: string | null;
    reason: string;
  }>;
}
