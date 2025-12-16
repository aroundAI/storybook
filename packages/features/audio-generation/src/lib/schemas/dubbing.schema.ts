import { z } from 'zod';

import { LANGUAGE_CODE_SCHEMA_VALUES } from '../dubbing-languages';
import { VoiceSettingsSchema } from '../schemas';

// ===================
// Language Code Schema
// ===================

export const LanguageCodeSchema = z.enum(LANGUAGE_CODE_SCHEMA_VALUES);

// ===================
// Status Schemas
// ===================

export const DubbedVersionStatusSchema = z.enum([
  'draft',
  'translating',
  'voicing',
  'syncing',
  'ready',
  'failed',
]);

export const TranslationStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const VoiceStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const SyncStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const DubbedLineStatusSchema = z.enum([
  'pending',
  'translated',
  'generating',
  'voiced',
  'failed',
]);

// ===================
// Action Schemas
// ===================

/**
 * Schema for creating a dubbed version
 */
export const CreateDubbedVersionSchema = z.object({
  episodeId: z.string().uuid(),
  language: LanguageCodeSchema,
});

export type CreateDubbedVersionSchemaType = z.infer<
  typeof CreateDubbedVersionSchema
>;

/**
 * Schema for translating dialogue in a dubbed version
 */
export const TranslateDialogueSchema = z.object({
  versionId: z.string().uuid(),
  /** Override default concurrency (1-5) */
  concurrency: z.number().int().min(1).max(5).optional(),
});

export type TranslateDialogueSchemaType = z.infer<
  typeof TranslateDialogueSchema
>;

/**
 * Schema for generating dubbed audio
 */
export const GenerateDubbedAudioSchema = z.object({
  versionId: z.string().uuid(),
  /** Override voice settings for all lines */
  voiceSettings: VoiceSettingsSchema.optional(),
  /** Concurrency for parallel generation (1-5) */
  concurrency: z.number().int().min(1).max(5).optional(),
});

export type GenerateDubbedAudioSchemaType = z.infer<
  typeof GenerateDubbedAudioSchema
>;

/**
 * Schema for updating a single dubbed line's translation
 */
export const UpdateDubbedLineSchema = z.object({
  lineId: z.string().uuid(),
  translatedText: z.string().min(1).max(5000),
  timingAdjustment: z.number().min(0.5).max(2.0).optional(),
});

export type UpdateDubbedLineSchemaType = z.infer<typeof UpdateDubbedLineSchema>;

/**
 * Schema for getting dubbed version status
 */
export const GetDubbedVersionSchema = z.object({
  versionId: z.string().uuid(),
});

export type GetDubbedVersionSchemaType = z.infer<typeof GetDubbedVersionSchema>;

/**
 * Schema for getting all dubbed versions for an episode
 */
export const GetDubbedVersionsSchema = z.object({
  episodeId: z.string().uuid(),
});

export type GetDubbedVersionsSchemaType = z.infer<
  typeof GetDubbedVersionsSchema
>;

/**
 * Schema for deleting a dubbed version
 */
export const DeleteDubbedVersionSchema = z.object({
  versionId: z.string().uuid(),
});

export type DeleteDubbedVersionSchemaType = z.infer<
  typeof DeleteDubbedVersionSchema
>;

/**
 * Schema for regenerating a single dubbed line's audio
 */
export const RegenerateDubbedLineAudioSchema = z.object({
  lineId: z.string().uuid(),
  voiceSettings: VoiceSettingsSchema.optional(),
});

export type RegenerateDubbedLineAudioSchemaType = z.infer<
  typeof RegenerateDubbedLineAudioSchema
>;

// ===================
// Result Types
// ===================

export interface CreateDubbedVersionResult {
  versionId: string;
  language: string;
  totalLines: number;
  status: 'draft';
}

export interface TranslateDialogueResult {
  versionId: string;
  translatedCount: number;
  failedCount: number;
  estimatedCost: number;
  status: 'processing' | 'completed' | 'failed';
}

export interface GenerateDubbedAudioResult {
  versionId: string;
  generatedCount: number;
  failedCount: number;
  estimatedCost: number;
  status: 'processing' | 'completed' | 'failed';
}

export interface DubbedVersionStatus {
  id: string;
  episodeId: string;
  language: string;
  status: string;
  translationStatus: string;
  voiceStatus: string;
  syncStatus: string;
  progress: {
    total: number;
    translated: number;
    voiced: number;
    failed: number;
    percentage: number;
  };
  cost: {
    translation: number;
    voice: number;
    total: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface DubbedLineDetail {
  id: string;
  originalText: string;
  translatedText: string;
  characterName: string | null;
  audioUrl: string | null;
  timingAdjustment: number;
  status: string;
  sequenceNumber: number;
}

export interface UpdateDubbedLineResult {
  lineId: string;
  translatedText: string;
  status: string;
}

export interface DeleteDubbedVersionResult {
  versionId: string;
  deleted: boolean;
}

// ===================
// Database Response Types
// ===================

export interface DubbedVersionResponse {
  id: string;
  episode_id: string;
  language: string;
  status: string;
  translation_status: string;
  voice_status: string;
  sync_status: string;
  final_video_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  episodes?: {
    id: string;
    project_id: string;
    projects?: {
      id: string;
      account_id: string;
    };
  };
}

export interface DubbedDialogueLineResponse {
  id: string;
  dubbed_version_id: string;
  original_dialogue_id: string;
  translated_text: string;
  audio_url: string | null;
  timing_adjustment: number;
  duration_seconds: number | null;
  status: string;
  generation_metadata: Record<string, unknown> | null;
  created_at: string;
  dialogue_lines?: {
    id: string;
    text: string;
    sequence_number: number;
    character_asset_id: string | null;
    assets?: {
      id: string;
      name: string;
    } | null;
  };
}
