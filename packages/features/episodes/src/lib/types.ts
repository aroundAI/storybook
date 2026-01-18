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
  character_names?: string[]; // Character names for immediate display in header
  location_names?: string[]; // Location names for immediate display in header
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

  // SCORE Framework fields (for episode continuity)
  episodeSummary?: string; // 2-3 sentence plot summary
  sentimentScore?: number; // 0-1 emotional tone
  keyEvents?: string[]; // Major plot points affecting future
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
  timeOfDay:
    | 'dawn'
    | 'morning'
    | 'midday'
    | 'afternoon'
    | 'golden-hour'
    | 'dusk'
    | 'night'
    | 'day';
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
 * Timeline event within a VEO 3.1 shot (V2 format)
 */
export interface TimelineEventData {
  startTime: string; // "00:00" format
  endTime: string; // "03:00" format
  type: 'action' | 'dialogue' | 'transition';
  character?: string | null;
  content: string;
  emotion?: string | null;
}

/**
 * VEO 3.1 structured prompt components (V2 - Timeline-based)
 * Designed for Ingredients-to-Video workflow with reference images
 */
export interface VeoPromptData {
  shotLine: string;
  timeline: TimelineEventData[];
  audio: string;
  style: string;
  avoid: string;
  fullPrompt: string;
}

/**
 * Dialogue timing for a shot
 */
export interface ShotDialogueTimingData {
  startSeconds: number;
  durationSeconds: number;
  characterName: string;
  text: string;
  emotion: string | null;
}

/**
 * Reference image for VEO 3.1 "Ingredients"
 */
export interface ReferenceImageData {
  name: string;
  url: string;
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
    // VEO 3.1 Enhanced Fields
    veoPrompt?: VeoPromptData;
    dialogueTiming?: ShotDialogueTimingData[];
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
    // Processing method: parallel-batches (default), scene-by-scene (legacy), or monolithic
    processingMethod?: 'parallel-batches' | 'scene-by-scene' | 'monolithic';
    scenesProcessed?: number;
    scenesSuccessful?: number;
    // VEO 3.1 reference images summary
    referenceImages?: {
      characters: ReferenceImageData[];
      locations: ReferenceImageData[];
    };
    missingAssets?: {
      characters: string[];
      locations: string[];
    };
  };
}

/**
 * Episode entity with all fields from database
 */
/**
 * A group of shorts with shared metadata that gets translated per language
 */
export interface ShortsGroup {
  id: string;
  name: string;
  title: string;
  description: string;
  tags: string[];
  /** Video URLs by language: { en: "url", hi: "url" } */
  videos: Record<string, string>;
}

export interface Episode {
  id: string;
  slug: string | null;
  projectId: string;
  seasonId: string | null;
  number: number;
  title: string;
  description: string | null;
  status: EpisodeStatus;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  finalVideoUrl: string | null;
  /** Localized video URLs by language: { en: "url", hi: "url", es: "url", pt: "url" } */
  localizedVideos?: Record<string, string> | null;
  /** Grouped shorts with per-group metadata */
  shortsGroups?: ShortsGroup[] | null;
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
    projectAestheticStyle?: string;
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

/**
 * Metadata for shorts/clips potential
 */
export interface ShortsMetadata {
  /** LLM-rated viral potential 1-10 */
  viralScore: number;
  /** Type of hook this shot contains */
  hookType?:
    | 'question'
    | 'reveal'
    | 'conflict'
    | 'visual'
    | 'humor'
    | 'cliffhanger';
  /** Suggested offset from shot start for optimal clip (seconds) */
  suggestedStartOffset?: number;
  /** Suggested clip duration (seconds) */
  suggestedDuration?: number;
  /** Brief context so clip makes sense standalone */
  standaloneSummary?: string;
  /** Suggested hashtags */
  hashtags?: string[];
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
  /** URL for first frame storyboard image */
  firstFrameUrl: string | null;
  /** URL for last frame storyboard image */
  lastFrameUrl: string | null;
  metadata: ShotMetadata | null;
  generationSettings: ShotGenerationSettings | null;
  generationJobId: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  /** Whether this shot is suitable for short-form content */
  shortsCandidate?: boolean;
  /** Shorts/clips metadata: viralScore, hookType, etc. */
  shortsMetadata?: ShortsMetadata | null;

  // Video trimming fields (Phase 1: Video Clip Trimming)
  /** In-point for video trimming in seconds (start of clip) */
  trimInPoint?: number | null;
  /** Out-point for video trimming in seconds (end of clip) */
  trimOutPoint?: number | null;
  /** Original source video duration in seconds */
  sourceDuration?: number | null;
  /** Timeline start time in seconds */
  timelineStartSeconds?: number | null;

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
 * Shot with dialogue lines for timeline planning
 */
export interface ShotWithDialogue {
  shotId: string;
  sceneNumber: number;
  shotNumber: number;
  sequenceNumber: number;
  durationSeconds: number;
  startSeconds: number;
  dialogueLines: {
    id: string;
    text: string;
    characterAssetId: string | null;
    sequenceNumber: number;
  }[];
}

/**
 * Result of timeline planning action
 */
export interface TimelinePlanResult {
  episodeId: string;
  totalDurationSeconds: number;
  shotsProcessed: number;
  dialogueLinesUpdated: number;
  shots: Array<{
    id: string;
    startSeconds: number;
    durationSeconds: number;
    dialogueCount: number;
  }>;
}

/**
 * Response for generating a shot list
 * Supports both legacy monolithic and new scene-by-scene processing
 */
export interface GenerateShotListResponse {
  success: boolean;
  shots: GeneratedShot[];
  shotsCreated: number;
  // Episode info (optional for scene-by-scene processing)
  episode?: {
    id: string;
    status: string;
    version: number;
  };
  metadata: {
    // Common fields
    totalShots: number;
    totalDuration: number;
    // Legacy fields (monolithic processing)
    provider?: string;
    model?: string;
    costCents?: number;
    tokensUsed?: number;
    generatedAt?: string;
    inputSource?: 'screenplay' | 'story';
    // Scene-by-scene processing fields
    shotTypes?: {
      wide: number;
      medium: number;
      closeUp: number;
    };
    locations?: string[];
    characters?: string[];
    processingMethod?: 'parallel-batches' | 'scene-by-scene' | 'monolithic';
  };
}
