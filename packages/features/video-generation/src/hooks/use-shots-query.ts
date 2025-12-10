'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

import type { ShotGridShot } from '../components/shot-grid';

/**
 * Database shot row type (matches the shots table schema)
 */
interface DatabaseShot {
  id: string;
  episode_id: string;
  scene_number: number | null;
  shot_number: number | null;
  sequence_number: number;
  duration_seconds: number;
  scene_description: string | null;
  action_description: string | null;
  prompt: string;
  camera_direction: string | null;
  status:
    | 'pending'
    | 'queued'
    | 'generating'
    | 'completed'
    | 'failed'
    | 'approved';
  video_url: string | null;
  thumbnail_url: string | null;
  generation_job_id: string | null;
  generation_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Transform database shot to ShotGridShot for component use
 */
function transformDatabaseShot(dbShot: DatabaseShot): ShotGridShot {
  // Map 'approved' status to 'completed' for display purposes
  const displayStatus =
    dbShot.status === 'approved' ? 'completed' : dbShot.status;

  return {
    id: dbShot.id,
    sequenceNumber: dbShot.sequence_number,
    sceneNumber: dbShot.scene_number ?? 1,
    shotNumber: dbShot.shot_number ?? dbShot.sequence_number,
    prompt: dbShot.prompt,
    description: dbShot.scene_description ?? dbShot.action_description ?? '',
    duration: dbShot.duration_seconds,
    aspectRatio: '16:9', // Default aspect ratio
    status: displayStatus,
    videoUrl: dbShot.video_url,
    thumbnailUrl: dbShot.thumbnail_url,
    progress: undefined,
    errorMessage: undefined,
  };
}

/**
 * Query key factory for shots queries
 */
export const shotsQueryKeys = {
  all: ['shots'] as const,
  byEpisode: (episodeId: string) => ['shots', episodeId] as const,
};

/**
 * Hook to fetch shots for an episode
 *
 * @param episodeId - The episode ID to fetch shots for
 * @returns Query result with shots data
 */
export function useShotsQuery(episodeId: string) {
  const supabase = useSupabase();

  return useQuery({
    queryKey: shotsQueryKeys.byEpisode(episodeId),
    queryFn: async (): Promise<ShotGridShot[]> => {
      const { data, error } = await supabase
        .from('shots')
        .select('*')
        .eq('episode_id', episodeId)
        .is('deleted_at', null)
        .order('sequence_number', { ascending: true });

      if (error) {
        throw error;
      }

      return (data as unknown as DatabaseShot[]).map(transformDatabaseShot);
    },
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
  });
}

/**
 * Hook to invalidate shots cache
 *
 * @returns Function to invalidate shots for an episode
 */
export function useInvalidateShots() {
  const queryClient = useQueryClient();

  return (episodeId: string) => {
    queryClient.invalidateQueries({
      queryKey: shotsQueryKeys.byEpisode(episodeId),
    });
  };
}
