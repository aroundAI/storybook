/**
 * KB-210: a long video whose job carries no thumbnail posts with the
 * episode's, read at upload time. Rows scheduled before KB-210 have none
 * stored (MCP schedule_publish never looked one up), and the job is built
 * from the row, so without this they went out bare. A Short never gets one
 * (KB-197). Only one of the episode's own uploads (KB-104).
 *
 * Never throws: a thumbnail that cannot be read does not stop the video.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { episodeLongVideoThumbnail } from '@kit/publishing/lib/episode-thumbnail';
import { ownedEpisodeThumbnail } from '@kit/publishing/lib/owned-thumbnail';
import { publishThumbnail } from '@kit/publishing/lib/publish-thumbnail';
import type { Database } from '@kit/supabase/database';

export async function missingLongVideoThumbnail(
  supabase: SupabaseClient<Database>,
  job: { publishId: string; episodeId: string },
): Promise<string | null> {
  try {
    const { data: row, error } = await supabase
      .from('publishes')
      .select('content_type, language')
      .eq('id', job.publishId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!row || row.content_type === 'short') return null;

    const url = await episodeLongVideoThumbnail(
      supabase,
      job.episodeId,
      row.language,
    );

    return publishThumbnail(
      row.content_type,
      null,
      ownedEpisodeThumbnail(url, job.episodeId),
    );
  } catch (error) {
    console.warn(
      `[Publish Worker] Could not look up a thumbnail for publish ${job.publishId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
