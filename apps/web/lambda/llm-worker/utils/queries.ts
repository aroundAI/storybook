import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Episode type for Lambda handlers
 */
export interface Episode {
  id: string;
  slug: string;
  project_id: string;
  season_id: string | null;
  number: number;
  title: string;
  description: string | null;
  status: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  final_video_url: string | null;
  localized_videos: Record<string, unknown> | null;
  story_data: Record<string, unknown> | null;
  screenplay_data: Record<string, unknown> | null;
  shot_list: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Shot type for Lambda handlers
 */
export interface Shot {
  id: string;
  episode_id: string;
  scene_number: number;
  shot_number: number;
  sequence_number: number;
  duration_seconds: number | null;
  scene_description: string | null;
  action_description: string | null;
  prompt: string | null;
  camera_direction: string | null;
  status: string;
  video_url: string | null;
  thumbnail_url: string | null;
  generation_job_id: string | null;
  generation_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Episode with shots and season info
 */
export interface EpisodeWithShots extends Episode {
  shots: Shot[];
  season: { id: string; name: string; number: number } | null;
}

/**
 * Get all episodes for a project (excluding soft-deleted)
 */
export async function getEpisodesByProject(projectId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('episodes')
    .select(`
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, story_data, screenplay_data, shot_list,
      metadata, version, created_at, updated_at, deleted_at
    `)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Episode[],
    error: null,
  };
}

/**
 * Get episode metadata for a project (excluding soft-deleted)
 */
export async function getEpisodeMetadataByProject(projectId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('episodes')
    .select(`
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, metadata, version, created_at, updated_at, deleted_at
    `)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Omit<Episode, 'story_data' | 'screenplay_data' | 'shot_list'>[],
    error: null,
  };
}

/**
 * Get a single episode by ID (excluding soft-deleted)
 */
export async function getEpisode(episodeId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('episodes')
    .select(`
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, story_data, screenplay_data, shot_list,
      metadata, version, created_at, updated_at, deleted_at
    `)
    .eq('id', episodeId)
    .is('deleted_at', null)
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Episode,
    error: null,
  };
}

/**
 * Get episode with all related shots and season info
 */
export async function getEpisodeWithShots(episodeId: string, supabase: SupabaseClient) {
  // Fetch episode with season info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: episode, error: episodeError } = await (supabase as any)
    .from('episodes')
    .select(
      `
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, story_data, screenplay_data, shot_list,
      metadata, version, created_at, updated_at, deleted_at,
      season:seasons(id, name, number)
    `,
    )
    .eq('id', episodeId)
    .is('deleted_at', null)
    .single();

  if (episodeError) {
    return { data: null, error: episodeError };
  }

  // Fetch related shots (ordered by sequence)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shots, error: shotsError } = await (supabase as any)
    .from('shots')
    .select(`
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `)
    .eq('episode_id', episodeId)
    .order('sequence_number', { ascending: true });

  if (shotsError) {
    return { data: null, error: shotsError };
  }

  return {
    data: {
      ...episode,
      shots: shots ?? [],
      season: episode.season?.[0] ?? null,
    } as EpisodeWithShots,
    error: null,
  };
}

/**
 * Get the next episode number for auto-assignment
 */
export async function getNextEpisodeNumber(projectId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('episodes')
    .select('number')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('number', { ascending: false })
    .limit(1);

  if (error) {
    return { number: 1, error };
  }

  return {
    number: (data?.[0]?.number ?? 0) + 1,
    error: null,
  };
}

/**
 * Get episode count for a project (excluding soft-deleted)
 */
export async function getEpisodeCount(projectId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from('episodes')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('deleted_at', null);

  if (error) {
    return { count: 0, error };
  }

  return {
    count: count ?? 0,
    error: null,
  };
}

/**
 * Get all shots for an episode (ordered by sequence)
 */
export async function getShotsByEpisode(episodeId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('shots')
    .select(`
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `)
    .eq('episode_id', episodeId)
    .order('sequence_number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot[],
    error: null,
  };
}

/**
 * Get a single shot by ID
 */
export async function getShot(shotId: string, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('shots')
    .select(`
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `)
    .eq('id', shotId)
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot,
    error: null,
  };
}

/**
 * Get shots by scene number within an episode
 */
export async function getShotsByScene(episodeId: string, sceneNumber: number, supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('shots')
    .select(`
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `)
    .eq('episode_id', episodeId)
    .eq('scene_number', sceneNumber)
    .order('sequence_number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot[],
    error: null,
  };
}
