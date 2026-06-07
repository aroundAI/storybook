'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const GetBulkEpisodeStatusSchema = z.object({
  seasonId: z.string().uuid(),
  episodeIds: z.array(z.string().uuid()).min(1).max(100),
});

export interface BulkEpisodeStatusItem {
  id: string;
  status: string;
  version: number;
  hasStory: boolean;
  hasScreenplay: boolean;
  shotCount: number;
  storyPreview: string | null;
  sceneCount: number;
  dialogueCount: number;
  characterNames: string[];
  locationNames: string[];
}

/**
 * Fetch detailed status for multiple episodes in a single query.
 * Used by the Bulk Generate modal for efficient polling.
 */
export const getBulkEpisodeStatusAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: true; data: BulkEpisodeStatusItem[] }> => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.bulkStatus', seasonId: data.seasonId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch episodes with their current state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episodes, error } = await (client as any)
      .from('episodes')
      .select(
        `
        id, status, version, story_data, screenplay_data,
        metadata
      `,
      )
      .in('id', data.episodeIds)
      .is('deleted_at', null);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch bulk episode status');
      throw new Error('Failed to fetch episode statuses');
    }

    // Fetch shot counts for all episodes in one query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shotCounts } = await (client as any)
      .from('shots')
      .select('episode_id')
      .in('episode_id', data.episodeIds)
      .is('deleted_at', null);

    const shotCountMap: Record<string, number> = {};
    for (const shot of shotCounts ?? []) {
      shotCountMap[shot.episode_id] =
        (shotCountMap[shot.episode_id] ?? 0) + 1;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: BulkEpisodeStatusItem[] = (episodes ?? []).map((ep: any) => {
      const storyData = ep.story_data as Record<string, unknown> | null;
      const screenplayData = ep.screenplay_data as Record<
        string,
        unknown
      > | null;
      const metadata = ep.metadata as Record<string, unknown> | null;

      const fullStory = storyData?.fullStory as string | undefined;
      const scenes = screenplayData?.scenes as unknown[] | undefined;

      // Count dialogue lines from screenplay
      let dialogueCount = 0;
      if (scenes) {
        for (const scene of scenes) {
          const s = scene as Record<string, unknown>;
          const dialogue = s.dialogue as unknown[] | undefined;
          dialogueCount += dialogue?.length ?? 0;
        }
      }

      return {
        id: ep.id,
        status: ep.status,
        version: ep.version,
        hasStory: !!fullStory,
        hasScreenplay: !!scenes?.length,
        shotCount: shotCountMap[ep.id] ?? 0,
        storyPreview: fullStory ? fullStory.substring(0, 300) : null,
        sceneCount: scenes?.length ?? 0,
        dialogueCount,
        characterNames: (metadata?.character_names as string[]) ?? [],
        locationNames: (metadata?.location_names as string[]) ?? [],
      };
    });

    return { success: true, data: result };
  },
  {
    schema: GetBulkEpisodeStatusSchema,
  },
);
