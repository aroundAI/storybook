/**
 * Scheduled Publish Cron Lambda Handler
 *
 * Queries database for due publishes and sends each to SQS for processing.
 * Triggered by AWS EventBridge every 5 minutes.
 *
 * Architecture:
 * - This Lambda: Queries DB, queues messages (fast, <5s)
 * - Publish Worker Lambda: Processes each upload (up to 5 min per video)
 */
import { createClient } from '@supabase/supabase-js';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import ws from 'ws';

import { cadenceGate, longVideoStates } from '@kit/publishing/lib/cadence/gate';
import {
  SCHEDULED_LAMBDA_PRECEDENCE,
  resolveEpisodeVideo,
} from '@kit/publishing/lib/episode-video';
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import {
  EPISODE_VIDEO_PUBLISH_REFUSAL,
  ownedEpisodeVideo,
} from '@kit/publishing/lib/owned-episode-video';
import { pausedConnectionIds } from '@kit/publishing/lib/publish-block';
import { publishThumbnail } from '@kit/publishing/lib/publish-thumbnail';
import { awsClientOptions, queueUrlFromEnv } from '@kit/shared/vendors';
import type { Database, Json } from '@kit/supabase/database';

import { failStalePublishing } from './stale-publishing';

const sqsClient = new SQSClient(awsClientOptions('sqs'));

const PUBLISH_QUEUE_URL = queueUrlFromEnv(process.env.PUBLISH_QUEUE_URL)!;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    `Supabase credentials missing: URL=${!!supabaseUrl}, ServiceKey=${!!supabaseServiceKey}`,
  );
}

if (!PUBLISH_QUEUE_URL) {
  throw new Error('PUBLISH_QUEUE_URL environment variable not configured');
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    // ws is the WHATWG client the realtime transport expects; @types/ws leads
    // with a server-mode `new (address: null)` overload that defeats inference.
    transport: ws as unknown as typeof WebSocket,
  },
});

interface ScheduledPublishResult {
  success: boolean;
  queued: number;
  skipped: number;
  /** FILM-719: Shorts still waiting for their episode's long video */
  waiting?: number;
  /** FILM-719: posts moved a day on because their channel had its day's */
  deferred?: number;
  /** KB-213: posts of a connection Meta has paused, left scheduled */
  paused?: number;
  error?: string;
}

interface ScheduledPublish {
  id: string;
  episode_id: string;
  platform_connection_id: string;
  platform: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  metadata: Record<string, unknown> | null;
  content_type: string | null;
  language: string | null; // Direct language field
  ai_generated: boolean;
  scheduled_at: string | null;
  slot_at: string | null;
  after_episode_full: boolean;
  release_priority: string;
  episodes: {
    project_id: string;
    final_video_url: string | null;
    thumbnail_url: string | null;
    localized_videos: Record<string, string> | null;
    shorts_groups: Array<{
      id?: string; // Group UUID for matching
      videos?: Record<string, string>;
    }> | null;
    projects: {
      account_id: string;
    } | null;
  } | null;
}

/**
 * Resolve video URL based on content type, language, and shorts group ID
 */
function resolveVideoUrl(publish: ScheduledPublish): string | null {
  const episode = publish.episodes;
  if (!episode) return null;

  const lang =
    publish.language || (publish.metadata?.language as string) || 'en';
  const isShort = publish.content_type === 'short';
  const shortsGroupId = publish.metadata?.shortsGroupId as string | undefined;

  if (isShort && !shortsGroupId) {
    console.error(
      `[Cron] Short publish ${publish.id} missing shortsGroupId in metadata`,
    );
  }

  // One resolver for every publish path (KB-123), with this path's precedence
  const resolved = resolveEpisodeVideo(episode, {
    language: lang,
    platform: publish.platform,
    short: isShort,
    shortsGroupId,
    ...SCHEDULED_LAMBDA_PRECEDENCE,
  });

  if (!resolved) {
    console.error(`[Cron] No video URL found for lang=${lang}`);
    return null;
  }

  console.log(`[Cron] Resolved video: ${resolved.from}, lang=${lang}`);
  return resolved.url;
}

async function markFailed(publish: ScheduledPublish, error: string) {
  await supabase
    .from('publishes')
    .update({
      status: 'failed',
      metadata: {
        ...(publish.metadata ?? {}),
        error,
        failedAt: new Date().toISOString(),
      } as Json,
    })
    .eq('id', publish.id)
    .eq('status', 'scheduled');
}

/**
 * Lambda handler for scheduled publish cron job
 */
export async function handler(): Promise<ScheduledPublishResult> {
  console.log(`[Cron] Starting scheduled publish check...`);

  const now = new Date();

  // KB-206: an upload that stopped without an answer is failed, not left
  // 'publishing' for good. Never stops the run.
  try {
    const failed = await failStalePublishing(supabase, now);
    if (failed) console.log(`[Cron] Failed ${failed} stale publishing rows`);
  } catch (sweepError) {
    console.error(`[Cron] Stale publishing sweep failed:`, sweepError);
  }

  // Query for due publishes - join with episodes and projects to get account_id
  const { data: duePublishes, error } = await supabase
    .from('publishes')
    .select(
      `
      id,
      episode_id,
      platform_connection_id,
      platform,
      title,
      description,
      tags,
      thumbnail_url,
      metadata,
      content_type,
      language,
      ai_generated,
      scheduled_at,
      slot_at,
      after_episode_full,
      release_priority,
      episodes!inner(
        project_id,
        final_video_url,
        thumbnail_url,
        localized_videos,
        shorts_groups,
        projects(account_id)
      )
    `,
    )
    .eq('status', 'scheduled')
    // KB-207: a deleted episode's post is never sent
    .is('episodes.deleted_at', null)
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50)
    // episodes and projects are many-to-one embeds: objects, not the arrays
    // the untyped client infers.
    .overrideTypes<ScheduledPublish[], { merge: false }>();

  if (error) {
    console.error(`[Cron] Database query failed:`, error);
    return { success: false, queued: 0, skipped: 0, error: error.message };
  }

  if (!duePublishes?.length) {
    console.log(`[Cron] No due publishes`);
    return { success: true, queued: 0, skipped: 0 };
  }

  console.log(`[Cron] Found ${duePublishes.length} due publishes`);

  let queued = 0;
  let skipped = 0;
  let waiting = 0;
  let deferred = 0;
  let paused = 0;

  const longVideos = await longVideoStates(supabase, duePublishes);

  // KB-213: a connection Meta has paused sends nothing until it is cleared
  const pausedConnections = await pausedConnectionIds(
    supabase,
    duePublishes.map((publish) => publish.platform_connection_id),
  );

  for (const publish of duePublishes) {
    if (pausedConnections.has(publish.platform_connection_id)) {
      paused++;
      continue;
    }

    // FILM-719: a Short goes after its episode's long video is live, and a
    // cadence post waits for a day its channel has room
    const gate = await cadenceGate(supabase, publish, longVideos, now);

    if (gate === 'waiting') {
      waiting++;
      continue;
    }

    if (gate === 'deferred') {
      deferred++;
      continue;
    }

    if (gate === 'failed') {
      console.error(`[Cron] ${publish.id}'s long video never went out`);
      skipped++;
      continue;
    }

    // Resolve video URL based on language
    const videoUrl = resolveVideoUrl(publish);

    if (!videoUrl) {
      console.error(`[Cron] No video URL for publish ${publish.id}, skipping`);
      skipped++;
      continue;
    }

    // Only a file of this episode's own project is sent (KB-123). Marked
    // failed rather than skipped, so it is not picked up again every run.
    const projectId = publish.episodes?.project_id;
    const ownedVideoUrl = projectId
      ? await ownedEpisodeVideo(
          videoUrl,
          { episodeId: publish.episode_id, projectId },
          async (episodeId) => {
            const { data } = await supabase
              .from('episodes')
              .select('project_id')
              .eq('id', episodeId)
              .maybeSingle();

            return data?.project_id ?? null;
          },
        )
      : null;

    if (!ownedVideoUrl) {
      console.error(
        `[Cron] Refused a video that is not a file of publish ${publish.id}'s project`,
      );
      await markFailed(publish, EPISODE_VIDEO_PUBLISH_REFUSAL);
      skipped++;
      continue;
    }

    // Get user/account ID from episode → project → account_id
    const accountId = publish.episodes?.projects?.account_id;
    if (!accountId) {
      console.error(`[Cron] No account ID for publish ${publish.id}, skipping`);
      skipped++;
      continue;
    }

    // Claim it: only a row still 'scheduled' moves to 'queued', so two
    // overlapping runs cannot both send it (FILM-719)
    const { data: claimed, error: updateError } = await supabase
      .from('publishes')
      .update({ status: 'queued' })
      .eq('id', publish.id)
      .eq('status', 'scheduled')
      .select('id');

    if (updateError) {
      console.error(
        `[Cron] Failed to update status for ${publish.id}:`,
        updateError,
      );
      skipped++;
      continue;
    }

    if (!claimed?.length) {
      console.log(`[Cron] ${publish.id} was claimed by another run`);
      skipped++;
      continue;
    }

    // Get language from metadata
    const language = (publish.metadata?.language as string) || 'en';

    // Get user ID for notifications
    // Prefer createdBy from metadata (scheduled by user)
    // Fallback to accountId (Team ID) for legacy records - notifications might miss if user subscribes to user-channel
    const userId = (publish.metadata?.createdBy as string) || accountId;

    // Build the job message
    const message: PublishJobMessage = {
      type: 'publish',
      publishId: publish.id,
      userId,
      platform: publish.platform as PublishJobMessage['platform'],
      platformConnectionId: publish.platform_connection_id,
      episodeId: publish.episode_id,
      videoUrl,
      title: publish.title || '',
      description: publish.description || '',
      tags: publish.tags || [],
      thumbnailUrl:
        publishThumbnail(
          publish.content_type,
          publish.thumbnail_url,
          publish.episodes?.thumbnail_url,
        ) ?? undefined,
      metadata: publish.metadata || {},
      aiGenerated: publish.ai_generated,
    };

    // Send to SQS
    try {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: PUBLISH_QUEUE_URL,
          MessageBody: JSON.stringify(message),
        }),
      );

      queued++;
      console.log(
        `[Cron] Queued publish ${publish.id} for ${publish.platform} (${language})`,
      );
    } catch (sqsError) {
      console.error(`[Cron] Failed to queue ${publish.id}:`, sqsError);

      // Revert status back to scheduled
      await supabase
        .from('publishes')
        .update({ status: 'scheduled' })
        .eq('id', publish.id)
        .eq('status', 'queued');

      skipped++;
    }
  }

  console.log(
    `[Cron] Complete: ${queued} queued, ${skipped} skipped, ${waiting} waiting, ${deferred} deferred, ${paused} paused`,
  );

  return { success: true, queued, skipped, waiting, deferred, paused };
}
