import { z } from 'zod';

/**
 * Asset type enum - all supported asset types from database
 */
export const AssetTypeSchema = z.enum([
  'character',
  'location',
  'prop',
  'voice',
  'music',
  'sfx',
  'master_video',
  'master_title_card',
]);

/**
 * Check asset hash schema
 */
export const CheckAssetHashSchema = z.object({
  projectId: z.string().uuid(),
  fileHash: z.string(),
  type: AssetTypeSchema,
});

/**
 * Physical attributes for character assets
 */
export const PhysicalAttributesSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  height: z.string().optional(),
  build: z.string().optional(),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  distinctiveFeatures: z.string().optional(),
});

/**
 * Voice settings for character or voice assets
 */
export const VoiceSettingsSchema = z.object({
  voiceId: z.string().optional(),
  provider: z
    .enum(['elevenlabs', 'playht', 'azure', 'google', 'custom'])
    .optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
});

/**
 * Character-specific metadata
 */
export const CharacterMetadataSchema = z.object({
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: z.string().optional(),
  backstory: z.string().optional(),
  voiceSettings: VoiceSettingsSchema.optional(),
});

/**
 * Location-specific metadata
 */
export const LocationMetadataSchema = z.object({
  setting: z.string().optional(),
  timeOfDay: z.string().optional(),
  weather: z.string().optional(),
  atmosphere: z.string().optional(),
});

/**
 * Prop-specific metadata
 */
export const PropMetadataSchema = z.object({
  category: z.string().optional(),
  material: z.string().optional(),
  size: z.string().optional(),
});

/**
 * Voice profile metadata
 */
export const VoiceMetadataSchema = z.object({
  provider: z
    .enum(['elevenlabs', 'playht', 'azure', 'google', 'custom'])
    .optional(),
  providerVoiceId: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

/**
 * Create asset schema - validates input for creating new assets
 */
export const CreateAssetSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  type: AssetTypeSchema,
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  fileHash: z.string().optional(),
  fileSizeBytes: z.number().int().optional(),
  contentType: z.string().optional(),
});

/**
 * Update asset schema - validates input for updating assets
 */
export const UpdateAssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Get project assets schema - validates input for fetching assets
 */
export const GetProjectAssetsSchema = z.object({
  projectId: z.string().uuid(),
  type: AssetTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * Delete asset schema - validates input for deleting assets
 */
export const DeleteAssetSchema = z.object({
  assetId: z.string().uuid(),
});

/**
 * Get asset schema - validates input for fetching single asset
 */
export const GetAssetSchema = z.object({
  assetId: z.string().uuid(),
});

// Type-specific creation schemas
export const CreateCharacterSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  metadata: CharacterMetadataSchema.optional(),
});

export const CreateLocationSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  metadata: LocationMetadataSchema.optional(),
});

export const CreatePropSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  metadata: PropMetadataSchema.optional(),
});

export const CreateVoiceSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  metadata: VoiceMetadataSchema.optional(),
});

// Type exports for schema inference
export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;
export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;
export type GetProjectAssetsInput = z.infer<typeof GetProjectAssetsSchema>;
export type DeleteAssetInput = z.infer<typeof DeleteAssetSchema>;
export type GetAssetInput = z.infer<typeof GetAssetSchema>;
