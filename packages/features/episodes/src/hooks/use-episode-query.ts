'use client';

import { useQuery } from '@tanstack/react-query';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

import type { EpisodeWithShots, Shot } from '../lib/types';

const POLL_INTERVAL = 5000; // 5 seconds during generation

interface UseEpisodeQueryOptions {
  enabled?: boolean;
}

interface DatabaseEpisode {
  id: string;
  project_id: string;
  season_id: string | null;
  number: number;
  title: string;
  description: string | null;
  status: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  final_video_url: string | null;
  story_data: unknown;
  screenplay_data: unknown;
  shot_list: unknown;
  metadata: unknown;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  season: Array<{
    id: string;
    name: string;
    number: number;
  }> | null;
}

interface DatabaseShot {
  id: string;
  episode_id: string;
  scene_number: number;
  shot_number: number;
  sequence_number: number;
  description: string;
  duration: number;
  status: string;
  camera_angle: string | null;
  camera_movement: string | null;
  prompt: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  metadata: unknown;
  generation_settings: unknown;
  generation_job_id: string | null;
  generation_started_at: string | null;
  generation_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function transformShot(shot: DatabaseShot): Shot {
  return {
    id: shot.id,
    episodeId: shot.episode_id,
    sceneNumber: shot.scene_number,
    shotNumber: shot.shot_number,
    description: shot.description,
    duration: shot.duration,
    status: shot.status as Shot['status'],
    cameraAngle: shot.camera_angle as Shot['cameraAngle'],
    cameraMovement: shot.camera_movement as Shot['cameraMovement'],
    prompt: shot.prompt,
    videoUrl: shot.video_url,
    thumbnailUrl: shot.thumbnail_url,
    metadata: shot.metadata as Shot['metadata'],
    generationSettings: shot.generation_settings as Shot['generationSettings'],
    generationJobId: shot.generation_job_id,
    generationStartedAt: shot.generation_started_at,
    generationCompletedAt: shot.generation_completed_at,
    createdAt: shot.created_at,
    updatedAt: shot.updated_at,
  };
}

function transformEpisodeResponse(
  episode: DatabaseEpisode,
  shots: DatabaseShot[],
): EpisodeWithShots {
  return {
    id: episode.id,
    projectId: episode.project_id,
    seasonId: episode.season_id,
    number: episode.number,
    title: episode.title,
    description: episode.description,
    status: episode.status as EpisodeWithShots['status'],
    durationSeconds: episode.duration_seconds,
    thumbnailUrl: episode.thumbnail_url,
    finalVideoUrl: episode.final_video_url,
    storyData: episode.story_data as EpisodeWithShots['storyData'],
    screenplayData:
      episode.screenplay_data as EpisodeWithShots['screenplayData'],
    shotList: episode.shot_list as EpisodeWithShots['shotList'],
    metadata: episode.metadata as EpisodeWithShots['metadata'],
    version: episode.version,
    createdAt: episode.created_at,
    updatedAt: episode.updated_at,
    deletedAt: episode.deleted_at,
    shots: shots.map(transformShot),
    season: episode.season?.[0] ?? null,
  };
}

export function useEpisodeQuery(
  episodeId: string,
  options: UseEpisodeQueryOptions = {},
) {
  const supabase = useSupabase();

  return useQuery({
    queryKey: ['episode', episodeId],
    queryFn: async (): Promise<EpisodeWithShots> => {
      // Fetch episode with season info
      const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .select(
          `
          *,
          season:seasons(id, name, number)
        `,
        )
        .eq('id', episodeId)
        .is('deleted_at', null)
        .single();

      if (episodeError) {
        throw new Error(`Failed to fetch episode: ${episodeError.message}`);
      }

      // Fetch related shots
      const { data: shots, error: shotsError } = await supabase
        .from('shots')
        .select('*')
        .eq('episode_id', episodeId)
        .order('sequence_number', { ascending: true });

      if (shotsError) {
        throw new Error(`Failed to fetch shots: ${shotsError.message}`);
      }

      return transformEpisodeResponse(
        episode as unknown as DatabaseEpisode,
        (shots ?? []) as unknown as DatabaseShot[],
      );
    },
    enabled: options.enabled !== false,
    refetchInterval: (query: {
      state: { data: EpisodeWithShots | undefined };
    }) => {
      const episode = query.state.data;

      // Poll every 5 seconds during generation
      return episode?.status === 'generating' ? POLL_INTERVAL : false;
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}

export function useInvalidateEpisode() {
  const queryClient = useQueryClient();

  return (episodeId: string) => {
    queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
  };
}
