import 'server-only';

import { cache } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { Episode, EpisodeWithShots, Shot } from '../lib/types';

/**
 * Get all episodes for a project (excluding soft-deleted)
 * Ordered by episode number ascending
 *
 * NOTE: This fetches FULL episode data including large JSON blobs.
 * For list views, prefer getEpisodeMetadataByProject() instead.
 */
export const getEpisodesByProject = cache(async function getEpisodesByProject(
  projectId: string,
) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('episodes')
    .select(
      `
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, story_data, screenplay_data, shot_list,
      metadata, version, created_at, updated_at, deleted_at
    `,
    )
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('number', { ascending: true })
    .limit(100);

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Episode[],
    error: null,
  };
});

/**
 * Get episode metadata for a project (excluding soft-deleted)
 * Ordered by episode number ascending
 *
 * LIGHTWEIGHT: Excludes large JSON blobs (story_data, screenplay_data, shot_list)
 * Use this for list views to reduce data transfer by 90%+
 */
export const getEpisodeMetadataByProject = cache(
  async function getEpisodeMetadataByProject(projectId: string) {
    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any)
      .from('episodes')
      .select(
        `
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, metadata, version, created_at, updated_at, deleted_at
    `,
      )
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('number', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    return {
      data: data as Omit<
        Episode,
        'story_data' | 'screenplay_data' | 'shot_list'
      >[],
      error: null,
    };
  },
);

/**
 * Get a single episode by ID (excluding soft-deleted)
 */
export const getEpisode = cache(async function getEpisode(episodeId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('episodes')
    .select(
      `
      id, slug, project_id, season_id, number, title, description,
      status, duration_seconds, thumbnail_url, final_video_url,
      localized_videos, story_data, screenplay_data, shot_list,
      metadata, version, created_at, updated_at, deleted_at
    `,
    )
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
});

/**
 * Get episode with all related shots and season info
 */
export const getEpisodeWithShots = cache(async function getEpisodeWithShots(
  episodeId: string,
) {
  const client = getSupabaseServerClient();

  // Fetch episode with season info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: episode, error: episodeError } = await (client as any)
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
  const { data: shots, error: shotsError } = await (client as any)
    .from('shots')
    .select(
      `
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `,
    )
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
});

/**
 * Get the next episode number for auto-assignment
 */
export async function getNextEpisodeNumber(projectId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
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
export const getEpisodeCount = cache(async function getEpisodeCount(
  projectId: string,
) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (client as any)
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
});

/**
 * Get all shots for an episode (ordered by sequence)
 */
export const getShotsByEpisode = cache(async function getShotsByEpisode(
  episodeId: string,
) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select(
      `
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `,
    )
    .eq('episode_id', episodeId)
    .order('sequence_number', { ascending: true })
    .limit(200);

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot[],
    error: null,
  };
});

/**
 * Get a single shot by ID
 */
export const getShot = cache(async function getShot(shotId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select(
      `
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `,
    )
    .eq('id', shotId)
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot,
    error: null,
  };
});

/**
 * Get shots by scene number within an episode
 */
export const getShotsByScene = cache(async function getShotsByScene(
  episodeId: string,
  sceneNumber: number,
) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select(
      `
      id, episode_id, scene_number, shot_number, sequence_number,
      duration_seconds, scene_description, action_description,
      prompt, camera_direction, status, video_url, thumbnail_url,
      generation_job_id, generation_metadata, created_at, updated_at, deleted_at
    `,
    )
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
});
