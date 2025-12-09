/**
 * Character Types (FILM-202)
 * Type definitions for character assets with extended details for video generation
 */

/**
 * Physical attributes stored in character_details.physical_attributes JSONB
 */
export interface PhysicalAttributes {
  age?: number;
  ageRange?: 'child' | 'teen' | 'young_adult' | 'adult' | 'senior';
  gender?: 'male' | 'female' | 'non_binary' | 'other';
  ethnicity?: string;
  height?: string;
  build?: 'slim' | 'athletic' | 'average' | 'heavy' | 'muscular';
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  skinTone?: string;
  distinctiveFeatures?: string[];
  facialHair?: string;
}

/**
 * Personality traits for character development
 * Used for element prompt generation context (not visual)
 */
export interface PersonalityTraits {
  traits?: string[];
  mannerisms?: string[];
  motivations?: string;
  fears?: string;
  strengths?: string[];
  weaknesses?: string[];
}

/**
 * Clothing style for visual consistency
 */
export interface ClothingStyle {
  defaultOutfit?: string;
  style?: 'casual' | 'formal' | 'sporty' | 'vintage' | 'fantasy' | 'modern';
  colors?: string[];
  accessories?: string[];
}

/**
 * Full Character interface combining asset + character_details
 */
export interface Character {
  // Asset fields
  id: string;
  projectId: string;
  name: string;
  type: 'character';
  description: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;

  // Character-specific fields from character_details
  voiceAssetId: string | null;
  physicalAttributes: PhysicalAttributes | null;
  personality: PersonalityTraits | null;
  clothing: ClothingStyle | null;
  backstory: string | null;
  elementPrompt: string | null;
  referenceImages: string[] | null;
}

/**
 * Response type for listCharactersAction with pagination
 */
export interface ListCharactersResponse {
  characters: Character[];
  total: number;
  hasMore: boolean;
}

/**
 * Database row type for character_details table
 */
export interface CharacterDetailsRow {
  asset_id: string;
  voice_asset_id: string | null;
  physical_attributes: Record<string, unknown> | null;
  personality: string | null;
  element_prompt: string | null;
  reference_images: string[] | null;
}
