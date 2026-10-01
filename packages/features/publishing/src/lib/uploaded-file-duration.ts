import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeAssetDurationSeconds } from '@kit/clickhouse';
import type { Database } from '@kit/supabase/database';

import { readMp4Facts } from './mp4-facts';

/**
 * The publish-time writer of `publishes.duration_seconds` for platforms that
 * never report a duration back (FILM-1710).
 *
 * Meta's IG Media node has no duration field, so the only honest source for
 * an Instagram publish is the file we sent it, measured from its own MP4
 * header (`mvhd`) with range requests — never the episode's duration or its
 * target. A file whose header cannot be read leaves the row null, which is
 * `duration_unknown`, never 0.
 *
 * YouTube and TikTok are not measured here: their platforms report what they
 * served, and `syncAssetDurations` (content-analytics) asks them. One writer
 * per platform, so the two never race over a row.
 *
 * Never throws. A publish has already succeeded by the time this runs, and a
 * duration is never worth failing it.
 */
export const UPLOADED_FILE_DURATION_PLATFORMS = ['instagram'] as const;

export type UploadedFileDuration =
  | { recorded: true; seconds: number }
  | {
      recorded: false;
      reason: 'not_measured_here' | 'duration_unknown' | 'write_failed';
    };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function measuredHere(platform: string) {
  return (UPLOADED_FILE_DURATION_PLATFORMS as readonly string[]).includes(
    platform,
  );
}

/**
 * Measures the uploaded file and fills a null duration on the publish.
 *
 * `serviceClient` must give a service-role client:
 * `publishes_keep_asset_duration` silently keeps the column unchanged for an
 * end-user session. It is called only for a platform measured here, so no
 * other publish builds one.
 */
export async function recordUploadedFileDuration(
  serviceClient: () => SupabaseClient<Database>,
  publish: { id: string; platform: string },
  videoUrl: string,
  fetcher?: Fetcher,
): Promise<UploadedFileDuration> {
  if (!measuredHere(publish.platform)) {
    return { recorded: false, reason: 'not_measured_here' };
  }

  const facts = await readMp4Facts(videoUrl, fetcher);
  const seconds = normalizeAssetDurationSeconds(facts.durationSeconds);

  if (seconds === null) {
    return { recorded: false, reason: 'duration_unknown' };
  }

  try {
    // Fill-only, as the provider sync is: a duration is a fact about one
    // uploaded file, and a row that already has one keeps it.
    const { error } = await serviceClient()
      .from('publishes')
      .update({ duration_seconds: seconds })
      .eq('id', publish.id)
      .is('duration_seconds', null);

    if (error) return { recorded: false, reason: 'write_failed' };
  } catch {
    return { recorded: false, reason: 'write_failed' };
  }

  return { recorded: true, seconds };
}
