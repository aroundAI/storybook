/**
 * Character Schemas (FILM-202)
 * Zod validation schemas for character CRUD operations
 */
import { z } from 'zod';

/**
 * Schema for physical attributes stored in character_details
 */
export const PhysicalAttributesSchema = z.object({
  age: z.number().int().min(0).max(150).optional(),
  ageRange: z
    .enum(['child', 'teen', 'young_adult', 'adult', 'senior'])
    .optional(),
  gender: z.enum(['male', 'female', 'non_binary', 'other']).optional(),
  ethnicity: z.string().max(100).optional(),
  height: z.string().max(50).optional(),
  build: z
    .enum(['slim', 'athletic', 'average', 'heavy', 'muscular'])
    .optional(),
  hairColor: z.string().max(50).optional(),
  hairStyle: z.string().max(100).optional(),
  eyeColor: z.string().max(50).optional(),
  skinTone: z.string().max(50).optional(),
  distinctiveFeatures: z.array(z.string().max(200)).max(20).optional(),
  facialHair: z.string().max(100).optional(),
});

/**
 * Schema for personality traits
 */
export const PersonalityTraitsSchema = z.object({
  traits: z.array(z.string().max(100)).max(20).optional(),
  mannerisms: z.array(z.string().max(200)).max(20).optional(),
  motivations: z.string().max(500).optional(),
  fears: z.string().max(500).optional(),
  strengths: z.array(z.string().max(100)).max(10).optional(),
  weaknesses: z.array(z.string().max(100)).max(10).optional(),
});

/**
 * Schema for clothing style
 */
export const ClothingStyleSchema = z.object({
  defaultOutfit: z.string().max(500).optional(),
  style: z
    .enum(['casual', 'formal', 'sporty', 'vintage', 'fantasy', 'modern'])
    .optional(),
  colors: z.array(z.string().max(50)).max(10).optional(),
  accessories: z.array(z.string().max(100)).max(20).optional(),
});

/**
 * Schema for creating a new character
 */
export const CreateCharacterSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  voiceAssetId: z.string().uuid().optional(),
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: PersonalityTraitsSchema.optional(),
  clothing: ClothingStyleSchema.optional(),
  backstory: z.string().max(2000).optional(),
});

/**
 * Schema for getting a character by ID
 */
export const GetCharacterSchema = z.object({
  characterId: z.string().uuid(),
});

/**
 * Schema for updating a character
 */
export const UpdateCharacterSchema = z.object({
  characterId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  fileUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  voiceAssetId: z.string().uuid().nullable().optional(),
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: PersonalityTraitsSchema.optional(),
  clothing: ClothingStyleSchema.optional(),
  backstory: z.string().max(2000).nullable().optional(),
});

/**
 * Schema for listing characters with pagination
 */
export const ListCharactersSchema = z.object({
  projectId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Type exports from schemas
export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>;
export type GetCharacterInput = z.infer<typeof GetCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof UpdateCharacterSchema>;
export type ListCharactersInput = z.infer<typeof ListCharactersSchema>;
export type PhysicalAttributesInput = z.infer<typeof PhysicalAttributesSchema>;
export type PersonalityTraitsInput = z.infer<typeof PersonalityTraitsSchema>;
export type ClothingStyleInput = z.infer<typeof ClothingStyleSchema>;
