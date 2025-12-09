/**
 * Episode status type matching database CHECK constraint
 * Workflow: draft → story → storyboard → generating → editing → ready → published
 */
export type EpisodeStatus =
  | 'draft'
  | 'story'
  | 'storyboard'
  | 'generating'
  | 'editing'
  | 'ready'
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

/**
 * Story generation output stored in story_data JSONB
 */
export interface StoryData {
  premise?: string;
  fullStory?: string;
  generatedAt?: string;
  approvedAt?: string;
  generatedBy?: {
    model: string;
    provider: string;
    costCents: number;
  };
}

/**
 * Dialogue line within a screenplay scene
 */
export interface ScreenplayDialogueLine {
  character: string;
  text: string;
  parenthetical?: string;
}

/**
 * Scene in a screenplay
 */
export interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: 'day' | 'night' | 'dawn' | 'dusk';
  description: string;
  dialogue: ScreenplayDialogueLine[];
  estimatedDuration: number;
}

/**
 * Screenplay metadata summary
 */
export interface ScreenplayMetadataSummary {
  totalScenes: number;
  estimatedDuration: number;
  locations: string[];
  characters: string[];
}

/**
 * Screenplay conversion output stored in screenplay_data JSONB
 */
export interface ScreenplayData {
  scenes: ScreenplayScene[];
  metadata: ScreenplayMetadataSummary;
  generatedAt?: string;
  approvedAt?: string;
  generatedBy?: {
    model: string;
    provider: string;
    costCents: number;
  };
}

/**
 * Shot list generation output stored in shot_list JSONB
 */
export interface ShotListData {
  shots?: Array<{
    sequenceNumber: number;
    sceneNumber: number;
    duration: number;
    sceneDescription: string;
    actionDescription: string;
    prompt: string;
    cameraDirection: string;
    characters: string[];
  }>;
  generatedAt?: string;
  approvedAt?: string;
  totalEstimatedDuration?: number;
}

/**
 * Episode entity with all fields from database
 */
export interface Episode {
  id: string;
  projectId: string;
  seasonId: string | null;
  number: number;
  title: string;
  description: string | null;
  status: EpisodeStatus;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  finalVideoUrl: string | null;
  storyData: StoryData | null;
  screenplayData: ScreenplayData | null;
  shotList: ShotListData | null;
  metadata: EpisodeMetadata | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Episode with related shots and season info
 */
export interface EpisodeWithShots extends Episode {
  shots: Shot[];
  season: {
    id: string;
    name: string;
    number: number;
  } | null;
}

/**
 * Response for listing episodes with pagination
 */
export interface ListEpisodesResponse {
  episodes: Episode[];
  total: number;
  hasMore: boolean;
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
