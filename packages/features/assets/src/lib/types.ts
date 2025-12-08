/**
 * Asset Types
 * Type definitions for asset management (FILM-201)
 */

/**
 * All supported asset types
 */
export type AssetType =
  | 'character'
  | 'location'
  | 'prop'
  | 'voice'
  | 'music'
  | 'sfx';

/**
 * Base asset interface matching database schema
 */
export interface Asset {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  description: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
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
 */
export interface AssetRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  description: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Transform database row to Asset type
 */
export function mapRowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type as AssetType,
    name: row.name,
    description: row.description,
    fileUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
