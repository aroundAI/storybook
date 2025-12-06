import { z } from 'zod';

// Zod schemas for validation
export const AssetTypeSchema = z.enum(['character', 'location', 'prop']);

export const PhysicalAttributesSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  height: z.string().optional(),
  build: z.string().optional(),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  distinctiveFeatures: z.string().optional(),
});

export const VoiceSettingsSchema = z.object({
  voiceId: z.string().optional(),
  provider: z.enum(['elevenlabs', 'playht']).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
});

export const CharacterMetadataSchema = z.object({
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: z.string().optional(),
  backstory: z.string().optional(),
  voiceSettings: VoiceSettingsSchema.optional(),
});

export const LocationMetadataSchema = z.object({
  setting: z.string().optional(),
  timeOfDay: z.string().optional(),
  weather: z.string().optional(),
  atmosphere: z.string().optional(),
});

export const PropMetadataSchema = z.object({
  category: z.string().optional(),
  material: z.string().optional(),
  size: z.string().optional(),
});

export const CreateAssetSchema = z.object({
  projectId: z.string().uuid(),
  type: AssetTypeSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  id: z.string().uuid(),
});

export const CreateCharacterSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  metadata: CharacterMetadataSchema.optional(),
});

export const CreateLocationSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  metadata: LocationMetadataSchema.optional(),
});

export const CreatePropSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  metadata: PropMetadataSchema.optional(),
});
