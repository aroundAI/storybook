'use server';

import 'server-only';

/**
 * Database queries for audio generation
 *
 * NOTE: These queries reference database tables that will be created in FILM-101.
 * The tables (voice_profiles, audio_tracks) don't exist yet, so these functions
 * are stubs that will be implemented once the database schema is ready.
 */

export interface VoiceProfileRow {
  id: string;
  provider: string;
  is_active: boolean;
  name: string;
}

export interface AudioTrackRow {
  id: string;
  episode_id: string;
  created_at: string;
}

/**
 * Get available voices from a provider
 * TODO: Implement once voice_profiles table exists (FILM-101)
 */
export async function getAvailableVoices(_provider: string): Promise<{
  data: VoiceProfileRow[];
  error: Error | null;
}> {
  // Will query voice_profiles table once it exists
  return { data: [], error: null };
}

/**
 * Get audio generation jobs for an episode
 * TODO: Implement once audio_tracks table exists (FILM-101)
 */
export async function getEpisodeAudioJobs(_episodeId: string): Promise<{
  data: AudioTrackRow[];
  error: Error | null;
}> {
  // Will query audio_tracks table once it exists
  return { data: [], error: null };
}

/**
 * Get audio generation job by ID
 * TODO: Implement once audio_tracks table exists (FILM-101)
 */
export async function getAudioJob(_jobId: string): Promise<{
  data: AudioTrackRow | null;
  error: Error | null;
}> {
  // Will query audio_tracks table once it exists
  return { data: null, error: null };
}

/**
 * Get voice profile by ID
 * TODO: Implement once voice_profiles table exists (FILM-101)
 */
export async function getVoiceProfile(_voiceId: string): Promise<{
  data: VoiceProfileRow | null;
  error: Error | null;
}> {
  // Will query voice_profiles table once it exists
  return { data: null, error: null };
}

/**
 * Get all voice profiles for a project
 * TODO: Implement once voice_profiles table exists (FILM-101)
 */
export async function getProjectVoiceProfiles(_projectId: string): Promise<{
  data: VoiceProfileRow[];
  error: Error | null;
}> {
  // Will query voice_profiles table once it exists
  return { data: [], error: null };
}
