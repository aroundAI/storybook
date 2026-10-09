import 'server-only';

import { episodeVideoSaveRefusal } from '@kit/storage/episode-video';
import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

/**
 * Stores, or removes, the finished video an episode publishes in one
 * language (`localized_videos`), for the publish screen's upload and the MCP
 * video tools alike (FILM-2202, FILM-2204). A new video must be one of the
 * episode's own uploads (KB-123); an empty `videoUrl` removes it.
 *
 * An episode with a video is ready to publish, whatever stages it went
 * through: storing one moves it to `ready` unless it is already published,
 * as deliver_edit does for a StorybookStudio cut.
 */
export async function saveEpisodeVideo(
  client: Client,
  input: { episodeId: string; language: string; videoUrl: string },
): Promise<{ ok: true; status: string } | { ok: false; refusal: string }> {
  const { data: episode, error: fetchError } = await client
    .from('episodes')
    .select(
      'project_id, status, final_video_url, localized_videos, shorts_groups',
    )
    .eq('id', input.episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to fetch episode: ${fetchError.message}`);
  }

  if (!episode) {
    return { ok: false, refusal: 'Episode not found.' };
  }

  const refusal = episodeVideoSaveRefusal({
    episodeId: input.episodeId,
    projectId: episode.project_id,
    stored: episode,
    next: [input.videoUrl],
  });

  if (refusal) {
    return { ok: false, refusal };
  }

  const videos = {
    ...((episode.localized_videos as Record<string, string> | null) ?? {}),
  };

  if (input.videoUrl) {
    videos[input.language] = input.videoUrl;
  } else {
    delete videos[input.language];
  }

  const status =
    input.videoUrl && episode.status !== 'published' ? 'ready' : episode.status;

  const { data: updated, error: updateError } = await client
    .from('episodes')
    .update({ localized_videos: videos, status })
    .eq('id', input.episodeId)
    .select('id');

  if (updateError) {
    throw new Error(`Failed to update published video: ${updateError.message}`);
  }

  // RLS filters a refused update to no rows (KB-61)
  if (!updated?.length) {
    return {
      ok: false,
      refusal: "You can't change this episode's published videos.",
    };
  }

  return { ok: true, status };
}
