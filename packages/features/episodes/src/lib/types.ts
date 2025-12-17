import type { ContentStyle } from './duration-scaling';

/**
 * Story Studio tab identifiers
 */
export type StudioTab = 'ideation' | 'story' | 'screenplay' | 'shot-list';

// ============================================================================
// Season Types (FILM-302)
// ============================================================================

/**
 * Season entity with all fields from database
 */
export interface Season {
  id: string;
  project_id: string;
  number: number;
  name: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Season with episode count for list views
 */
export interface SeasonWithEpisodeCount extends Season {
  episodeCount: number;
}

/**
 * Response for fetching project seasons
 */
export interface GetProjectSeasonsResponse {
  seasons: SeasonWithEpisodeCount[];
}

/**
 * Response for deleting a season
 */
export interface DeleteSeasonResponse {
  success: boolean;
  seasonId: string;
}

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
  character_ids?: string[]; // Asset IDs for tagged characters
  location_ids?: string[]; // Asset IDs for tagged locations
  season_premise?: string; // Season-level premise for context
}

/**
 * Character arc information from story generation
 */
export interface StoryCharacterArc {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | string;
  arc: string;
}

/**
 * Story generation output stored in story_data JSONB
 */
export interface StoryData {
  // Core story content
  title?: string;
  logline?: string;
  premise?: string;
  fullStory?: string;
  generatedAt?: string;
  approvedAt?: string;
  generatedBy?: {
    model: string;
    provider: string;
    costCents: number;
  };

  // LLM output fields (stored but were missing from interface)
  actBreakdown?: {
    act1: string;
    act2: string;
    act3: string;
  };
  characters?: StoryCharacterArc[];
  themes?: string[];
  tone?: string;
  estimatedSceneCount?: number;

  // Generation settings (NEW: persisted for downstream steps)
  targetDuration?: number; // Duration in seconds used for generation
  contentStyle?: ContentStyle; // Affects dialogue density
  genre?: string; // Genre used for generation
  targetAudience?: string; // Target audience used
  videoStyle?: string; // Visual style used
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
  generatedAt?: string | null;
  approvedAt?: string | null;
  totalEstimatedDuration?: number;
  generatedBy?: {
    model: string;
    provider: string;
    costCents: number;
  };
  metadata?: {
    totalShots: number;
    shotTypes: {
      wide: number;
      medium: number;
      closeUp: number;
    };
    locations: string[];
    characters: string[];
    inputSource: 'screenplay' | 'story';
  };
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
  projectMetadata?: {
    videoStyle?: string;
    targetAudience?: string;
    description?: string;
    [key: string]: unknown;
  };
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
  sequenceNumber?: number;
  description: string;
  duration: number;
  durationSeconds?: number;
  status: ShotStatus;
  cameraAngle: CameraAngle | null;
  cameraMovement: CameraMovement | null;
  cameraDirection?: string | null;
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
  deletedAt?: string | null;
}

/**
 * Shot with generation job status information
 */
export interface ShotWithJobStatus extends Shot {
  generationJob: {
    id: string;
    status: string;
    provider: string;
    progress: number;
    error_message: string | null;
  } | null;
}

/**
 * Response for batch creating shots
 */
export interface BatchCreateShotsResponse {
  success: boolean;
  shots: Shot[];
  count: number;
}

/**
 * Response for reordering shots
 */
export interface ReorderShotsResponse {
  success: boolean;
  shots: Shot[];
  count: number;
}

/**
 * Response for getting episode shots
 */
export interface GetEpisodeShotsResponse {
  success: boolean;
  shots: ShotWithJobStatus[];
  total: number;
  hasMore: boolean;
}

/**
 * Response for deleting a shot
 */
export interface DeleteShotResponse {
  success: boolean;
  shotId: string;
}

/**
 * Generated shot from LLM (used in generation response)
 */
export interface GeneratedShot {
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  shotType: string;
  cameraDirection: string;
  description: string;
  action: string;
  prompt: string;
  characters: string[];
  duration: number;
  metadata: {
    location: string;
    timeOfDay: string;
    mood?: string;
    lighting?: string;
  };
}

/**
 * Response for generating a shot list
 */
export interface GenerateShotListResponse {
  success: boolean;
  shots: GeneratedShot[];
  shotsCreated: number;
  episode: {
    id: string;
    status: string;
    version: number;
  };
  metadata: {
    provider: string;
    model: string;
    costCents: number;
    tokensUsed: number;
    generatedAt: string;
    totalShots: number;
    totalDuration: number;
    inputSource: 'screenplay' | 'story';
  };
}
