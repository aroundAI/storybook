/**
 * Dialogue list types for FILM-506
 * Types for displaying dialogue lines with voice assignments and status
 */

/**
 * Status of a dialogue line's audio generation
 */
export type DialogueLineStatus =
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed';

/**
 * Metadata about voice generation for a dialogue line
 */
export interface DialogueVoiceGenerationMetadata {
  /** Duration of generated audio in seconds */
  durationSeconds?: number;
  /** Error message if generation failed */
  error?: string;
  /** Voice provider used (e.g., 'elevenlabs') */
  provider?: string;
  /** Cost of generation in cents */
  costCents?: number;
  /** Voice ID used for generation */
  voiceId?: string;
  /** ISO timestamp of generation */
  generatedAt?: string;
  /** Number of characters in the text */
  characterCount?: number;
}

/**
 * A dialogue line with its audio generation status
 */
export interface DialogueLine {
  /** Unique identifier */
  id: string;
  /** Episode this line belongs to */
  episodeId: string;
  /** Character asset ID (null for narrator/system) */
  characterAssetId: string | null;
  /** Shot this dialogue belongs to (for timeline alignment) */
  shotId: string | null;
  /** The dialogue text */
  text: string;
  /** Order in the episode */
  sequenceNumber: number;
  /** Scene number this dialogue belongs to */
  sceneNumber: number;
  /** Audio generation status */
  status: DialogueLineStatus;
  /** URL to generated audio file (null if not generated) */
  audioUrl: string | null;
  /** Absolute position in episode timeline (seconds from start) */
  timelineStartSeconds: number | null;
  /** Speaking duration calculated from word count (~0.4s per word) */
  estimatedDurationSeconds: number | null;
  /** Metadata about the generation */
  generationMetadata: DialogueVoiceGenerationMetadata | null;
  /** Creation timestamp */
  createdAt?: string;
}

/**
 * A character asset for voice assignment display
 */
export interface CharacterAsset {
  /** Unique identifier */
  id: string;
  /** Character name */
  name: string;
  /** Asset type */
  type: 'character';
  /** Optional thumbnail URL */
  thumbnailUrl?: string;
}

/**
 * Summary counts for dialogue list header
 */
export interface DialogueLineSummary {
  /** Total number of dialogue lines */
  total: number;
  /** Lines pending generation */
  pending: number;
  /** Lines currently generating */
  generating: number;
  /** Lines with completed audio */
  completed: number;
  /** Lines that failed generation */
  failed: number;
}

/**
 * Result of fetching dialogue lines for an episode
 */
export interface GetDialogueLinesResult {
  /** All dialogue lines for the episode */
  lines: DialogueLine[];
  /** Summary counts */
  summary: DialogueLineSummary;
}
