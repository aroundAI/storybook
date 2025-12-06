export type EpisodeStatus =
  | 'draft'
  | 'planning'
  | 'in_progress'
  | 'completed'
  | 'published';

export type ShotStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type CameraAngle =
  | 'wide'
  | 'medium'
  | 'close-up'
  | 'extreme-close-up'
  | 'over-the-shoulder'
  | 'pov'
  | 'low-angle'
  | 'high-angle'
  | 'birds-eye'
  | 'dutch-angle';

export type CameraMovement =
  | 'static'
  | 'pan'
  | 'tilt'
  | 'zoom'
  | 'dolly'
  | 'tracking'
  | 'crane'
  | 'handheld'
  | 'steadicam';

export interface EpisodeMetadata {
  sceneCount?: number;
  shotCount?: number;
  totalDuration?: number;
  themes?: string[];
  tags?: string[];
}

export interface Episode {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  episodeNumber: number;
  status: EpisodeStatus;
  script: string | null;
  duration: number | null;
  metadata: EpisodeMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShotMetadata {
  characters?: string[];
  locations?: string[];
  props?: string[];
  dialogue?: string;
  soundEffects?: string[];
  music?: string;
  lighting?: string;
  mood?: string;
}

export interface ShotGenerationSettings {
  provider?: 'kling' | 'runway' | 'luma';
  modelVersion?: string;
  aspectRatio?: string;
  duration?: number;
  seed?: number;
  negativePrompt?: string;
}

export interface Shot {
  id: string;
  episodeId: string;
  sceneNumber: number;
  shotNumber: number;
  description: string;
  duration: number;
  status: ShotStatus;
  cameraAngle: CameraAngle | null;
  cameraMovement: CameraMovement | null;
  prompt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  metadata: ShotMetadata | null;
  generationSettings: ShotGenerationSettings | null;
  generationJobId: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
