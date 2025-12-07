import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { Episode, Shot } from '../lib/types';

// Note: These queries assume the episodes and shots tables exist in the database.
// The tables will be created as part of the database migration in FILM-101.

export async function getEpisodesByProject(projectId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('episodes')
    .select('*')
    .eq('project_id', projectId)
    .order('episode_number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Episode[],
    error: null,
  };
}

export async function getEpisode(episodeId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('episodes')
    .select('*')
    .eq('id', episodeId)
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Episode,
    error: null,
  };
}

export async function getShotsByEpisode(episodeId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select('*')
    .eq('episode_id', episodeId)
    .order('scene_number', { ascending: true })
    .order('shot_number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot[],
    error: null,
  };
}

export async function getShot(shotId: string) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select('*')
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

export async function getShotsByScene(episodeId: string, sceneNumber: number) {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select('*')
    .eq('episode_id', episodeId)
    .eq('scene_number', sceneNumber)
    .order('shot_number', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: data as Shot[],
    error: null,
  };
}
