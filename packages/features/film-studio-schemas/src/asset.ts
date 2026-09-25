import { z } from 'zod';

import { MetadataSchema, URLSchema, UUIDSchema } from './common';

// Asset Type
export const AssetTypeSchema = z.enum(['character', 'location', 'prop']);

// Physical Attributes
export const PhysicalAttributesSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  height: z.string().optional(),
  build: z.string().optional(),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  skinTone: z.string().optional(),
  distinctiveFeatures: z.string().optional(),
});

// Voice Settings
export const VoiceSettingsSchema = z.object({
  voiceId: z.string().optional(),
  provider: z.enum(['elevenlabs']).optional(),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.0),
  useSpeakerBoost: z.boolean().default(true),
});

// Character Metadata
export const CharacterMetadataSchema = z.object({
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: z.string().optional(),
  backstory: z.string().optional(),
  voiceSettings: VoiceSettingsSchema.optional(),
  relationships: z
    .array(
      z.object({
        characterId: UUIDSchema,
        relationship: z.string(),
      }),
    )
    .optional(),
});

// Location Metadata
export const LocationMetadataSchema = z.object({
  setting: z.string().optional(),
  timeOfDay: z
    .enum(['dawn', 'morning', 'afternoon', 'evening', 'night', 'any'])
    .optional(),
  weather: z
    .enum(['sunny', 'cloudy', 'rainy', 'snowy', 'stormy', 'foggy', 'any'])
    .optional(),
  atmosphere: z.string().optional(),
  lighting: z.string().optional(),
  soundscape: z.string().optional(),
});

// Prop Metadata
export const PropMetadataSchema = z.object({
  category: z.string().optional(),
  dimensions: z.string().optional(),
  material: z.string().optional(),
  color: z.string().optional(),
  significance: z.string().optional(),
});

// Base Asset Schema
export const BaseAssetSchema = z.object({
  projectId: UUIDSchema,
  type: AssetTypeSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: URLSchema.optional(),
  metadata: MetadataSchema.optional(),
});

// Create Asset Schema
export const CreateAssetSchema = BaseAssetSchema;

export const CreateCharacterSchema = BaseAssetSchema.extend({
  type: z.literal('character'),
  metadata: CharacterMetadataSchema.optional(),
});

export const CreateLocationSchema = BaseAssetSchema.extend({
  type: z.literal('location'),
  metadata: LocationMetadataSchema.optional(),
});

export const CreatePropSchema = BaseAssetSchema.extend({
  type: z.literal('prop'),
  metadata: PropMetadataSchema.optional(),
});

// Update Asset Schema
export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  id: UUIDSchema,
});

export const UpdateCharacterSchema = CreateCharacterSchema.partial().extend({
  id: UUIDSchema,
});

export const UpdateLocationSchema = CreateLocationSchema.partial().extend({
  id: UUIDSchema,
});

export const UpdatePropSchema = CreatePropSchema.partial().extend({
  id: UUIDSchema,
});

// Type exports
export type AssetType = z.infer<typeof AssetTypeSchema>;
export type PhysicalAttributes = z.infer<typeof PhysicalAttributesSchema>;
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;
export type CharacterMetadata = z.infer<typeof CharacterMetadataSchema>;
export type LocationMetadata = z.infer<typeof LocationMetadataSchema>;
export type PropMetadata = z.infer<typeof PropMetadataSchema>;
export type BaseAsset = z.infer<typeof BaseAssetSchema>;
export type CreateAsset = z.infer<typeof CreateAssetSchema>;
export type CreateCharacter = z.infer<typeof CreateCharacterSchema>;
export type CreateLocation = z.infer<typeof CreateLocationSchema>;
export type CreateProp = z.infer<typeof CreatePropSchema>;
export type UpdateAsset = z.infer<typeof UpdateAssetSchema>;
export type UpdateCharacter = z.infer<typeof UpdateCharacterSchema>;
export type UpdateLocation = z.infer<typeof UpdateLocationSchema>;
export type UpdateProp = z.infer<typeof UpdatePropSchema>;
