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
import { awsClientOptions, queueUrlFromEnv } from '@kit/shared/vendors';
import ws from 'ws';

import {
  SCHEDULED_LAMBDA_PRECEDENCE,
  resolveEpisodeVideo,
} from '@kit/publishing/lib/episode-video';
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import {
  EPISODE_VIDEO_PUBLISH_REFUSAL,
  ownedEpisodeVideo,
} from '@kit/publishing/lib/owned-episode-video';
import type { Database, Json } from '@kit/supabase/database';

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

/**
 * Lambda handler for scheduled publish cron job
 */
export async function handler(): Promise<ScheduledPublishResult> {
  console.log(`[Cron] Starting scheduled publish check...`);

  const now = new Date();

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
      episodes(
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

  for (const publish of duePublishes) {
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
      await supabase
        .from('publishes')
        .update({
          status: 'failed',
          metadata: {
            ...(publish.metadata ?? {}),
            error: EPISODE_VIDEO_PUBLISH_REFUSAL,
            failedAt: new Date().toISOString(),
          } as Json,
        })
        .eq('id', publish.id);
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

    // Update status to 'queued' to prevent re-processing
    const { error: updateError } = await supabase
      .from('publishes')
      .update({ status: 'queued' })
      .eq('id', publish.id);

    if (updateError) {
      console.error(
        `[Cron] Failed to update status for ${publish.id}:`,
        updateError,
      );
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
        publish.thumbnail_url || publish.episodes?.thumbnail_url || undefined,
      metadata: publish.metadata || {},
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
        .eq('id', publish.id);

      skipped++;
    }
  }

  console.log(`[Cron] Complete: ${queued} queued, ${skipped} skipped`);

  return { success: true, queued, skipped };
}
