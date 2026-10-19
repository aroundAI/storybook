import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { ensureValidToken } from '../lib/token-refresh';
import {
  type YouTubeVideoState,
  youtubeProcessingVerdict,
} from '../lib/youtube-processing';
import { YouTubeProvider } from '../providers/youtube/youtube-provider';

/**
 * KB-205. An upload YouTube accepted is marked published, but YouTube can
 * still abandon it while processing — a video over 15 minutes from an
 * unverified channel ends "Processing abandoned — Video is too long". This
 * asks YouTube, on the token-refresh cron, what became of each YouTube
 * upload of the last two days not yet settled, and marks the publish failed
 * with YouTube's reason when it failed. A settled one is recorded on the
 * row's metadata and not asked about again. One `videos.list` (1 quota
 * unit) per channel per 50 videos, only while something is unsettled.
 */

const WINDOW_MS = 48 * 60 * 60 * 1000;

export const YOUTUBE_PROCESSING_KEY = 'youtube_processing';

export interface YouTubeProcessingResult {
  checked: number;
  failed: number;
  processed: number;
}

interface UnsettledPublish {
  id: string;
  platform_connection_id: string | null;
  platform_content_id: string | null;
  metadata: Json | null;
}

type Client = SupabaseClient<Database>;

export async function checkYouTubeProcessing(
  now: Date = new Date(),
  client: Client = getSupabaseServerAdminClient(),
  states: (
    accessToken: string,
    videoIds: string[],
  ) => Promise<Map<string, YouTubeVideoState>> = (accessToken, videoIds) =>
    new YouTubeProvider(accessToken).getProcessingStates(videoIds),
): Promise<YouTubeProcessingResult> {
  const logger = await getLogger();
  const ctx = { name: 'youtube-processing.job' };
  const result: YouTubeProcessingResult = {
    checked: 0,
    failed: 0,
    processed: 0,
  };

  const unsettled = await fetchAllRows<UnsettledPublish>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, platform_connection_id, platform_content_id, metadata')
        .eq('platform', 'youtube')
        .eq('status', 'published')
        .gte('published_at', new Date(now.getTime() - WINDOW_MS).toISOString())
        .not('platform_content_id', 'is', null)
        .is(`metadata->${YOUTUBE_PROCESSING_KEY}`, null)
        .order('id')
        .range(from, to),
    'unsettled YouTube publishes',
  );

  const byConnection = new Map<string, UnsettledPublish[]>();
  for (const publish of unsettled) {
    if (!publish.platform_connection_id || !publish.platform_content_id) {
      continue;
    }
    const list = byConnection.get(publish.platform_connection_id) ?? [];
    list.push(publish);
    byConnection.set(publish.platform_connection_id, list);
  }

  for (const [connectionId, publishes] of byConnection) {
    try {
      const token = await ensureValidToken(connectionId);
      if (!token.valid || !token.accessToken) continue;

      const found = await states(
        token.accessToken,
        publishes.map((publish) => publish.platform_content_id!),
      );

      for (const publish of publishes) {
        const video = found.get(publish.platform_content_id!);
        // Not listed: deleted on YouTube. It leaves the window by itself.
        if (!video) continue;

        result.checked++;
        const verdict = youtubeProcessingVerdict(video);
        if (verdict.state === 'pending') continue;

        await settle(client, publish, verdict, now);
        result[verdict.state]++;

        if (verdict.state === 'failed') {
          logger.warn(
            { ...ctx, publishId: publish.id, reason: verdict.reason },
            'YouTube did not process an upload; publish marked failed',
          );
        }
      }
    } catch (error) {
      logger.error(
        { ...ctx, connectionId, error },
        'Could not check YouTube processing for a channel',
      );
    }
  }

  return result;
}

async function settle(
  client: Client,
  publish: UnsettledPublish,
  verdict: Exclude<
    ReturnType<typeof youtubeProcessingVerdict>,
    {
      state: 'pending';
    }
  >,
  now: Date,
) {
  const base =
    publish.metadata &&
    typeof publish.metadata === 'object' &&
    !Array.isArray(publish.metadata)
      ? publish.metadata
      : {};
  const checkedAt = now.toISOString();

  const update =
    verdict.state === 'failed'
      ? {
          status: 'failed',
          metadata: {
            ...base,
            error: verdict.error,
            errorCode: 'YOUTUBE_PROCESSING_FAILED',
            failedAt: checkedAt,
            [YOUTUBE_PROCESSING_KEY]: {
              state: 'failed',
              reason: verdict.reason,
              checkedAt,
            },
          },
        }
      : {
          metadata: {
            ...base,
            [YOUTUBE_PROCESSING_KEY]: { state: 'processed', checkedAt },
          },
        };

  const { error } = await client
    .from('publishes')
    .update(update)
    .eq('id', publish.id)
    .eq('status', 'published');

  if (error) {
    throw new Error(`Could not record YouTube processing: ${error.message}`);
  }
}
