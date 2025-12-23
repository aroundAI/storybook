import { z } from 'zod';

/**
 * Music generation schemas for scene-based and cue-based music
 */

/**
 * Common music generation fields
 */
const MusicBaseFields = {
  genre: z.string().max(50).optional(),
  mood: z.string().max(50).optional(),
  tempo: z.enum(['slow', 'medium', 'fast', 'varied']).optional(),
  instrumentalOnly: z.boolean().optional(),
  tags: z.array(z.string().max(30)).max(5).optional(),
};

/**
 * Generate music for a specific scene
 * Extracts mood/description from screenplay data automatically
 */
export const GenerateSceneMusicSchema = z.object({
  episodeId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  /** Custom prompt (optional - auto-generated from scene if not provided) */
  prompt: z.string().max(500).optional(),
  /** Duration in seconds (optional - calculated from scene if not provided) */
  duration: z.number().int().min(15).max(240).optional(),
  ...MusicBaseFields,
});

export type GenerateSceneMusicInput = z.infer<typeof GenerateSceneMusicSchema>;

/**
 * Generate music from a manual cue placement
 * User specifies exact timeline position and prompt
 */
export const GenerateMusicCueSchema = z.object({
  episodeId: z.string().uuid(),
  /** Descriptive prompt for the music */
  prompt: z.string().min(10).max(500),
  /** Duration in seconds */
  duration: z.number().int().min(15).max(240),
  /** Timeline position in seconds */
  timelineStartSeconds: z.number().min(0),
  /** Optional name for the cue */
  name: z.string().max(100).optional(),
  ...MusicBaseFields,
});

export type GenerateMusicCueInput = z.infer<typeof GenerateMusicCueSchema>;

/**
 * Get audio tracks for an episode
 */
export const GetAudioTracksSchema = z.object({
  episodeId: z.string().uuid(),
  /** Filter by track type */
  type: z.enum(['music', 'sfx', 'ambient', 'dialogue_composite']).optional(),
});

export type GetAudioTracksInput = z.infer<typeof GetAudioTracksSchema>;

/**
 * Poll music generation status
 */
export const PollMusicStatusSchema = z.object({
  trackId: z.string().uuid(),
});

export type PollMusicStatusInput = z.infer<typeof PollMusicStatusSchema>;

/**
 * Update audio track
 */
export const UpdateAudioTrackSchema = z.object({
  trackId: z.string().uuid(),
  name: z.string().max(100).optional(),
  timelineStartSeconds: z.number().min(0).optional(),
  volume: z.number().min(0).max(2).optional(),
});

export type UpdateAudioTrackInput = z.infer<typeof UpdateAudioTrackSchema>;

/**
 * Delete audio track
 */
export const DeleteAudioTrackSchema = z.object({
  trackId: z.string().uuid(),
});

export type DeleteAudioTrackInput = z.infer<typeof DeleteAudioTrackSchema>;
