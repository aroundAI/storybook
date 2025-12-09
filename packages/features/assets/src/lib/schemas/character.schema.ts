/**
 * Character Schema Definitions (FILM-202)
 *
 * Zod schemas for character validation, shared between server actions and client forms.
 * Implements structured data for AI-driven video generation with Kling AI.
 */
import { z } from 'zod';

/**
 * Physical attributes schema - structured character appearance data
 */
export const PhysicalAttributesSchema = z.object({
  age: z.number().int().min(0).max(150).optional(),
  ageRange: z
    .enum(['child', 'teen', 'young_adult', 'adult', 'senior'])
    .optional(),
  gender: z.enum(['male', 'female', 'non_binary', 'other']).optional(),
  ethnicity: z.string().max(100).optional(),
  height: z.string().max(50).optional(), // e.g., "5'10\"", "180cm"
  build: z
    .enum(['slim', 'athletic', 'average', 'heavy', 'muscular'])
    .optional(),
  hairColor: z.string().max(50).optional(),
  hairStyle: z.string().max(100).optional(),
  eyeColor: z.string().max(50).optional(),
  skinTone: z.string().max(50).optional(),
  distinctiveFeatures: z.array(z.string().max(100)).max(10).optional(),
  facialHair: z.string().max(100).optional(),
});

/**
 * Personality traits schema
 */
export const PersonalityTraitsSchema = z.object({
  traits: z.array(z.string().max(50)).max(10).optional(), // brave, shy, intelligent
  mannerisms: z.array(z.string().max(100)).max(10).optional(), // gestures, speech patterns
  motivations: z.string().max(500).optional(),
  fears: z.string().max(500).optional(),
  strengths: z.array(z.string().max(50)).max(10).optional(),
  weaknesses: z.array(z.string().max(50)).max(10).optional(),
});

/**
 * Clothing style schema
 */
export const ClothingStyleSchema = z.object({
  defaultOutfit: z.string().max(500).optional(),
  style: z
    .enum([
      'casual',
      'formal',
      'sporty',
      'vintage',
      'fantasy',
      'modern',
      'futuristic',
      'period',
    ])
    .optional(),
  colors: z.array(z.string().max(50)).max(10).optional(),
  accessories: z.array(z.string().max(100)).max(10).optional(),
});

/**
 * Create character schema - full input for creating a new character
 */
export const CreateCharacterSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1, 'Character name is required').max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional().or(z.literal('')),
  thumbnailUrl: z.string().url().optional().or(z.literal('')),
  // Character-specific fields
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: z.string().max(2000).optional(),
  personalityTraits: PersonalityTraitsSchema.optional(),
  clothingStyle: ClothingStyleSchema.optional(),
  backstory: z.string().max(5000).optional(),
  elementPrompt: z.string().max(2000).optional(),
  referenceImages: z.array(z.string().url()).max(10).optional(),
  voiceAssetId: z.string().uuid().nullable().optional(),
});

/**
 * Update character schema - partial update of character fields
 */
export const UpdateCharacterSchema = z.object({
  assetId: z.string().uuid(),
  // Base asset fields
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  fileUrl: z.string().url().nullable().optional().or(z.literal('')),
  thumbnailUrl: z.string().url().nullable().optional().or(z.literal('')),
  // Character-specific fields
  physicalAttributes: PhysicalAttributesSchema.nullable().optional(),
  personality: z.string().max(2000).nullable().optional(),
  personalityTraits: PersonalityTraitsSchema.nullable().optional(),
  clothingStyle: ClothingStyleSchema.nullable().optional(),
  backstory: z.string().max(5000).nullable().optional(),
  elementPrompt: z.string().max(2000).nullable().optional(),
  referenceImages: z.array(z.string().url()).max(10).nullable().optional(),
  voiceAssetId: z.string().uuid().nullable().optional(),
});

/**
 * Get character schema
 */
export const GetCharacterSchema = z.object({
  assetId: z.string().uuid(),
});

/**
 * List characters schema with pagination
 */
export const ListCharactersSchema = z.object({
  projectId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/**
 * Delete character schema
 */
export const DeleteCharacterSchema = z.object({
  assetId: z.string().uuid(),
});

/**
 * Character form schema for client-side validation
 * Used in CharacterEditor component
 */
export const CharacterFormSchema = z.object({
  name: z.string().min(1, 'Character name is required').max(255),
  description: z.string().max(1000).optional().or(z.literal('')),
  fileUrl: z.string().url().optional().or(z.literal('')),
  thumbnailUrl: z.string().url().optional().or(z.literal('')),
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: z.string().max(2000).optional().or(z.literal('')),
  personalityTraits: PersonalityTraitsSchema.optional(),
  clothingStyle: ClothingStyleSchema.optional(),
  backstory: z.string().max(5000).optional().or(z.literal('')),
  elementPrompt: z.string().max(2000).optional().or(z.literal('')),
  referenceImages: z.array(z.string().url()).max(10).optional(),
  voiceAssetId: z.string().uuid().nullable().optional(),
});

// Type exports
export type PhysicalAttributes = z.infer<typeof PhysicalAttributesSchema>;
export type PersonalityTraits = z.infer<typeof PersonalityTraitsSchema>;
export type ClothingStyle = z.infer<typeof ClothingStyleSchema>;
export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof UpdateCharacterSchema>;
export type GetCharacterInput = z.infer<typeof GetCharacterSchema>;
export type ListCharactersInput = z.infer<typeof ListCharactersSchema>;
export type DeleteCharacterInput = z.infer<typeof DeleteCharacterSchema>;
export type CharacterFormData = z.infer<typeof CharacterFormSchema>;
