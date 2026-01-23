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

import type { PublishJobMessage } from '../publish-worker/index';

const sqsClient = new SQSClient({});

const PUBLISH_QUEUE_URL = process.env.PUBLISH_QUEUE_URL!;
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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
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
  source_shot_id: string | null; // UUID of shorts group for shorts
  language: string | null; // Direct language field
  episodes: {
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
 *
 * ALGORITHM:
 * 1. For shorts (content_type === 'short'):
 *    a. If source_shot_id exists: find matching group by ID, return videos[lang]
 *    b. Fallback: return first group's videos[lang] (legacy data)
 * 2. For full videos:
 *    a. If localized_videos[lang] exists: return it
 *    b. Fallback: return final_video_url
 */
function resolveVideoUrl(publish: ScheduledPublish): string | null {
  const episode = publish.episodes;
  if (!episode) return null;

  // Get language from publish record (direct field) or metadata fallback
  const lang = publish.language || (publish.metadata?.language as string) || 'en';
  const isShort = publish.content_type === 'short';
  const localizedVideos = episode.localized_videos ?? {};
  const shortsGroups = episode.shorts_groups ?? [];

  // ═══════════════════════════════════════════════════════════════════════════
  // SHORTS RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════
  if (isShort) {
    // CASE A: We have source_shot_id - find exact group
    if (publish.source_shot_id) {
      for (const group of shortsGroups) {
        if (group?.id === publish.source_shot_id) {
          if (group.videos?.[lang]) {
            console.log(
              `[Cron] Resolved short: group=${group.id}, lang=${lang}`,
            );
            return group.videos[lang];
          }
          console.warn(
            `[Cron] Shorts group ${group.id} has no video for lang=${lang}`,
          );
          return null;
        }
      }
      console.warn(
        `[Cron] source_shot_id ${publish.source_shot_id} not found in shorts_groups`,
      );
    }

    // CASE B: Fallback to first group with matching language (legacy)
    for (const group of shortsGroups) {
      if (group?.videos?.[lang]) {
        console.log(`[Cron] Resolved short (fallback): first group with lang=${lang}`);
        return group.videos[lang];
      }
    }

    console.error(`[Cron] No shorts video found for lang=${lang}`);
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL VIDEO RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════
  if (localizedVideos[lang]) {
    console.log(`[Cron] Resolved full video: localized_videos.${lang}`);
    return localizedVideos[lang];
  }

  if (episode.final_video_url) {
    console.log(`[Cron] Resolved full video: final_video_url (fallback)`);
    return episode.final_video_url;
  }

  console.error(`[Cron] No video URL found for lang=${lang}`);
  return null;
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
    .select(`
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
      source_shot_id,
      language,
      episodes(
        final_video_url,
        thumbnail_url,
        localized_videos,
        shorts_groups,
        projects(account_id)
      )
    `)
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50);

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

  for (const publish of duePublishes as ScheduledPublish[]) {
    // Resolve video URL based on language
    const videoUrl = resolveVideoUrl(publish);

    if (!videoUrl) {
      console.error(`[Cron] No video URL for publish ${publish.id}, skipping`);
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
      console.error(`[Cron] Failed to update status for ${publish.id}:`, updateError);
      skipped++;
      continue;
    }

    // Get language from metadata
    const language = (publish.metadata?.language as string) || 'en';

    // Build the job message
    const message: PublishJobMessage = {
      publishId: publish.id,
      userId: accountId, // Use account_id as the user identifier
      platform: publish.platform as PublishJobMessage['platform'],
      platformConnectionId: publish.platform_connection_id,
      episodeId: publish.episode_id,
      videoUrl,
      title: publish.title || '',
      description: publish.description || '',
      tags: publish.tags || [],
      thumbnailUrl: publish.thumbnail_url || publish.episodes?.thumbnail_url || undefined,
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

  console.log(
    `[Cron] Complete: ${queued} queued, ${skipped} skipped`,
  );

  return { success: true, queued, skipped };
}
