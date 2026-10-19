import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/**
 * KB-210. The thumbnail an episode's long video posts with, in one language:
 * the episode's thumbnail in that language, else its default, else none.
 *
 * Thumbnails live in `episode_thumbnails` (the Publish screen's upload and
 * MCP's finalize_episode_thumbnail both save there), not on the episode row,
 * so a publish that read only `episodes.thumbnail_url` went out bare. A
 * Short never takes one (KB-197): callers ask only for a long video.
 *
 * Not an ownership check: a caller sends the URL through
 * ownedEpisodeThumbnail (KB-104) before anything fetches it.
 *
 * Environment-free: the schedule services, schedule_release and the publish
 * worker Lambda all import it.
 */

export interface EpisodeThumbnailRow {
  language: string;
  thumbnail_url: string;
  is_default: boolean | null;
}

/** The episode's thumbnail rows, every language */
export async function readEpisodeThumbnails(
  client: SupabaseClient<Database>,
  episodeId: string,
): Promise<EpisodeThumbnailRow[]> {
  const { data, error } = await client
    .from('episode_thumbnails')
    .select('language, thumbnail_url, is_default')
    .eq('episode_id', episodeId);

  if (error) {
    throw new Error(
      `Could not read the episode's thumbnails: ${error.message}`,
    );
  }

  return data ?? [];
}

/** The thumbnail in `language`, else the default, else null */
export function pickEpisodeThumbnail(
  rows: readonly EpisodeThumbnailRow[],
  language: string | null | undefined,
): string | null {
  return (
    rows.find((row) => row.language === language)?.thumbnail_url ??
    rows.find((row) => row.is_default)?.thumbnail_url ??
    null
  );
}

/** The thumbnail for this episode's long video in `language` */
export async function episodeLongVideoThumbnail(
  client: SupabaseClient<Database>,
  episodeId: string,
  language: string | null | undefined,
): Promise<string | null> {
  return pickEpisodeThumbnail(
    await readEpisodeThumbnails(client, episodeId),
    language,
  );
}
