/**
 * Asset Types
 * Type definitions for asset management (FILM-201, FILM-202)
 */
import type {
  ClothingStyle,
  PersonalityTraits,
  PhysicalAttributes,
} from './schemas/character.schema';

/**
 * All supported asset types
 */
export type AssetType =
  | 'character'
  | 'location'
  | 'prop'
  | 'voice'
  | 'music'
  | 'sfx'
  | 'master_video'
  | 'master_title_card';

/**
 * Base asset interface matching database schema
 */
export interface Asset {
  id: string;
  projectId: string;
  episodeId: string | null;
  type: AssetType;
  name: string;
  description: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  fileHash: string | null;
  fileSizeBytes: number | null;
  contentType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Response type for getProjectAssets with pagination
 */
export interface GetProjectAssetsResponse {
  assets: Asset[];
  total: number;
  hasMore: boolean;
}

/**
 * Response type for delete asset action
 */
export interface DeleteAssetResponse {
  success: boolean;
  assetId: string;
}

/**
 * Character-specific metadata
 */
export interface CharacterMetadata {
  physicalAttributes?: {
    age?: string;
    gender?: string;
    height?: string;
    build?: string;
    hairColor?: string;
    eyeColor?: string;
    distinctiveFeatures?: string;
  };
  personality?: string;
  backstory?: string;
  voiceSettings?: {
    voiceId?: string;
    provider?: 'elevenlabs' | 'playht' | 'azure' | 'google' | 'custom';
    stability?: number;
    similarityBoost?: number;
  };
}

/**
 * Character asset with typed metadata
 */
export interface Character extends Omit<Asset, 'type' | 'metadata'> {
  type: 'character';
  metadata: CharacterMetadata | null;
}

/**
 * Location-specific metadata
 */
export interface LocationMetadata {
  setting?: string;
  timeOfDay?: string;
  weather?: string;
  atmosphere?: string;
  referenceImages?: string[];
}

/**
 * Location asset with typed metadata
 */
export interface Location extends Omit<Asset, 'type' | 'metadata'> {
  type: 'location';
  metadata: LocationMetadata | null;
}

/**
 * Prop-specific metadata
 */
export interface PropMetadata {
  category?: string;
  material?: string;
  size?: string;
}

/**
 * Prop asset with typed metadata
 */
export interface Prop extends Omit<Asset, 'type' | 'metadata'> {
  type: 'prop';
  metadata: PropMetadata | null;
}

/**
 * Voice profile metadata
 */
export interface VoiceMetadata {
  provider?: 'elevenlabs' | 'playht' | 'azure' | 'google' | 'custom';
  providerVoiceId?: string;
  settings?: Record<string, unknown>;
}

/**
 * Voice asset with typed metadata
 */
export interface Voice extends Omit<Asset, 'type' | 'metadata'> {
  type: 'voice';
  metadata: VoiceMetadata | null;
}

/**
 * Database row to Asset mapping helper type
 * Note: deleted_at is optional as it may not exist in older database types
 */
export interface AssetRow {
  id: string;
  project_id: string;
  episode_id: string | null;
  type: string;
  name: string;
  description: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  file_hash: string | null;
  file_size_bytes: number | null;
  content_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/**
 * Transform database row to Asset type
 */
export function mapRowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    type: row.type as AssetType,
    name: row.name,
    description: row.description,
    fileUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url,
    fileHash: row.file_hash,
    fileSizeBytes: row.file_size_bytes,
    contentType: row.content_type,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  };
}

// ============================================================================
// Character Types (FILM-202)
// ============================================================================

/**
 * Character role for sorting
 */
export type CharacterRole =
  | 'protagonist'
  | 'deuteragonist'
  | 'supporting'
  | 'creature'
  | 'object'
  | 'background'
  | 'narrator';

/**
 * Character with full details from character_details table
 * Used for CharacterEditor and character display components
 */
export interface CharacterWithDetails extends Omit<Asset, 'type' | 'metadata'> {
  type: 'character';
  metadata: Record<string, unknown> | null;
  // Character details (from character_details table)
  role: CharacterRole;
  physicalAttributes: PhysicalAttributes | null;
  personality: string | null;
  personalityTraits: PersonalityTraits | null;
  clothingStyle: ClothingStyle | null;
  backstory: string | null;
  elementPrompt: string | null;
  referenceImages: string[] | null;
  voiceAssetId: string | null;
}

/**
 * Database row type for character with joined details
 */
export interface CharacterDetailsRow {
  role: string | null;
  physical_attributes: Record<string, unknown> | null;
  personality: string | null;
  element_prompt: string | null;
  reference_images: string[] | null;
  elevenlabs_voice_id: string | null;
}

export interface CharacterRow extends AssetRow {
  character_details: CharacterDetailsRow | CharacterDetailsRow[] | null;
}

/**
 * Response type for listCharacters with pagination
 */
export interface ListCharactersResponse {
  characters: CharacterWithDetails[];
  total: number;
  hasMore: boolean;
}

/**
 * Transform database row to CharacterWithDetails type
 */
export function mapRowToCharacterWithDetails(
  row: CharacterRow,
): CharacterWithDetails {
  const baseAsset = mapRowToAsset(row);

  // Handle both single object and array formats from Supabase
  const details = Array.isArray(row.character_details)
    ? row.character_details[0]
    : row.character_details;

  // Parse physical_attributes JSONB - it stores structured character data
  const physicalAttrs = details?.physical_attributes as Record<
    string,
    unknown
  > | null;

  return {
    ...baseAsset,
    type: 'character',
    role: (details?.role as CharacterRole) ?? 'supporting',
    physicalAttributes:
      (physicalAttrs?.physicalAttributes as PhysicalAttributes | undefined) ??
      null,
    personality: details?.personality ?? null,
    personalityTraits:
      (physicalAttrs?.personalityTraits as PersonalityTraits | undefined) ??
      null,
    clothingStyle:
      (physicalAttrs?.clothingStyle as ClothingStyle | undefined) ?? null,
    backstory: (physicalAttrs?.backstory as string | undefined) ?? null,
    elementPrompt: details?.element_prompt ?? null,
    referenceImages: details?.reference_images ?? null,
    voiceAssetId: details?.elevenlabs_voice_id ?? null,
  };
}

/**
 * Voice asset for voice selector dropdown
 */
export interface VoiceAssetOption {
  id: string;
  name: string;
  fileUrl: string | null;
  thumbnailUrl: string | null;
}
