// Asset types
export type AssetType = 'character' | 'location' | 'prop';

export interface Asset {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  description: string | null;
  imageUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

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
    provider?: 'elevenlabs' | 'playht';
    stability?: number;
    similarityBoost?: number;
  };
}

export interface Character extends Omit<Asset, 'type' | 'metadata'> {
  type: 'character';
  metadata: CharacterMetadata | null;
}

export interface LocationMetadata {
  setting?: string;
  timeOfDay?: string;
  weather?: string;
  atmosphere?: string;
}

export interface Location extends Omit<Asset, 'type' | 'metadata'> {
  type: 'location';
  metadata: LocationMetadata | null;
}

export interface PropMetadata {
  category?: string;
  material?: string;
  size?: string;
}

export interface Prop extends Omit<Asset, 'type' | 'metadata'> {
  type: 'prop';
  metadata: PropMetadata | null;
}
