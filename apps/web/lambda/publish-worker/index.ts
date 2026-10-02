/**
 * Publish Worker Lambda
 *
 * Processes single video publish jobs from SQS queue.
 * Each message = one video upload to one platform.
 *
 * Features:
 * - 5-minute timeout per video upload
 * - Automatic retries via SQS (3 attempts)
 * - WebSocket notifications to user
 * - Full stack trace logging
 */
import { createClient } from '@supabase/supabase-js';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import ws from 'ws';

import type {
  DeleteJobMessage,
  JobMessage,
  PublishJobMessage,
} from '@kit/publishing/lib/job-types';
import {
  EPISODE_VIDEO_PUBLISH_REFUSAL,
  ownedEpisodeVideo,
} from '@kit/publishing/lib/owned-episode-video';
import { ownedEpisodeThumbnail } from '@kit/publishing/lib/owned-thumbnail';
import { isOfferedPlatform } from '@kit/publishing/lib/platforms';
import {
  type TokenErrorCode,
  TokenRefusal,
  tokenErrorCodeOf,
  tokenErrorMessage,
} from '@kit/publishing/lib/token-errors';
import { recordUploadedFileDuration } from '@kit/publishing/lib/uploaded-file-duration';
import type { YouTubeChannelDeclaration } from '@kit/publishing/lib/youtube-declaration';
import { awsClientOptions } from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';

import { mergeFailureMetadata } from './failure-metadata';
import {
  PublishJobRefused,
  deleteJobTarget,
  publishJobConnection,
} from './job-guard';
import { checkConnectionToken } from './token';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient(awsClientOptions('dynamodb'));
const ddb = DynamoDBDocumentClient.from(ddbClient);
const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || '';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    `Supabase credentials missing: URL=${!!supabaseUrl}, ServiceKey=${!!supabaseServiceKey}`,
  );
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

/**
 * Send message to user via WebSocket
 */
async function sendToUser(
  userId: string,
  message: Record<string, unknown>,
): Promise<void> {
  if (!CONNECTIONS_TABLE_NAME || !WEBSOCKET_ENDPOINT) {
    console.log(
      `[Publish Worker] WebSocket not configured, skipping notification`,
    );
    return;
  }

  // Query DynamoDB for all connections belonging to userId
  const connections = await ddb.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      IndexName: 'userIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    }),
  );

  if (!connections.Items?.length) {
    console.log(
      `[Publish Worker] No active connections for user ${userId.substring(0, 8)}...`,
    );
    return;
  }

  const wsClient = new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_ENDPOINT,
    ...awsClientOptions('apigateway'),
  });

  const messageStr = JSON.stringify(message);

  const promises = connections.Items.map(async (conn) => {
    try {
      await wsClient.send(
        new PostToConnectionCommand({
          ConnectionId: conn.connectionId,
          Data: new TextEncoder().encode(messageStr),
        }),
      );
    } catch (error) {
      // Connection may have closed, clean up
      if ((error as { statusCode?: number }).statusCode === 410) {
        console.log(
          `[Publish Worker] Cleaning up stale connection ${conn.connectionId}`,
        );
        await ddb.send(
          new DeleteCommand({
            TableName: CONNECTIONS_TABLE_NAME,
            Key: { connectionId: conn.connectionId },
          }),
        );
      }
    }
  });

  await Promise.all(promises);
}

/**
 * Upload video to platform
 */
async function uploadToPlatform(
  job: PublishJobMessage,
  accessToken: string,
): Promise<{ contentId: string; url: string }> {
  console.log(`[Publish Worker] Uploading to ${job.platform}...`);

  switch (job.platform) {
    case 'youtube': {
      const { uploadToYouTube } = await import('./handlers/youtube');
      return uploadToYouTube(
        accessToken,
        job,
        await readYouTubeDeclaration(job.platformConnectionId),
      );
    }
    case 'tiktok': {
      const { uploadToTikTok } = await import('./handlers/tiktok');
      return uploadToTikTok(accessToken, job);
    }
    case 'instagram': {
      const { uploadToInstagram } = await import('./handlers/instagram');
      return uploadToInstagram(accessToken, job);
    }
    case 'facebook': {
      const { uploadToFacebook } = await import('./handlers/facebook');
      return uploadToFacebook(accessToken, job);
    }
    case 'twitter': {
      const { uploadToTwitter } = await import('./handlers/twitter');
      return uploadToTwitter(
        accessToken,
        job,
        await readXGrant(job.platformConnectionId),
      );
    }
    default:
      throw new Error(`Unsupported platform: ${job.platform}`);
  }
}

/** The X account's name and the scopes it granted at connect (FILM-1729). */
async function readXGrant(connectionId: string) {
  const { data, error } = await supabase
    .from('platform_connections')
    .select('platform_account_name, scopes')
    .eq('id', connectionId)
    .single();

  if (error) {
    throw new Error(`Could not read the X connection: ${error.message}`);
  }

  return { accountName: data.platform_account_name, scopes: data.scopes };
}

/**
 * The channel's own audience and category (KB-30). A publish row made after
 * KB-30 carries both in its metadata; this answers for rows scheduled before
 * it. Read at upload time, so a channel declared after a failed attempt is
 * honoured when SQS redelivers the job.
 */
async function readYouTubeDeclaration(
  connectionId: string,
): Promise<YouTubeChannelDeclaration | null> {
  const { data, error } = await supabase
    .from('platform_connections')
    .select('youtube_made_for_kids, youtube_category_id')
    .eq('id', connectionId)
    .single();

  if (error) {
    throw new Error(
      `Could not read the channel's YouTube audience: ${error.message}`,
    );
  }

  return data;
}

/**
 * Delete content from platform
 */
async function deleteFromPlatform(
  job: DeleteJobMessage,
  accessToken: string,
): Promise<void> {
  console.log(`[Publish Worker] Deleting from ${job.platform}...`);

  switch (job.platform) {
    case 'youtube': {
      const { deleteFromYouTube } = await import('./handlers/youtube');
      return deleteFromYouTube(accessToken, job.platformContentId);
    }
    case 'facebook': {
      const { deleteFromFacebook } = await import('./handlers/facebook');
      return deleteFromFacebook(accessToken, job.platformContentId);
    }
    case 'twitter': {
      const { deleteFromTwitter } = await import('./handlers/twitter');
      return deleteFromTwitter(accessToken, job.platformContentId);
    }
    case 'tiktok':
    case 'instagram':
      console.warn(
        `[Publish Worker] Delete not implemented for ${job.platform}, skipping platform deletion.`,
      );
      return;
    default:
      throw new Error(`Unsupported platform: ${job.platform}`);
  }
}

/**
 * Update publish status in database
 */
async function updatePublishStatus(
  publishId: string,
  status: 'published' | 'failed',
  data: Record<string, unknown>,
): Promise<void> {
  const updateData: Record<string, unknown> = { status };

  if (status === 'published') {
    updateData.platform_content_id = data.platform_content_id;
    updateData.platform_url = data.platform_url;
    updateData.published_at = data.published_at;
  } else {
    // For failures, store error in metadata
    const { data: existing } = await supabase
      .from('publishes')
      .select('metadata')
      .eq('id', publishId)
      .single();

    updateData.metadata = mergeFailureMetadata(existing?.metadata, {
      error: data.error,
      errorCode: data.errorCode,
      errorStack: data.errorStack,
      failedAt: data.failedAt,
    });
  }

  await supabase.from('publishes').update(updateData).eq('id', publishId);
}

/** The job's video when it is a file of the episode's own project (KB-123) */
async function ownedJobVideo(job: PublishJobMessage): Promise<string> {
  const projectOfEpisode = async (episodeId: string) => {
    const { data } = await supabase
      .from('episodes')
      .select('project_id')
      .eq('id', episodeId)
      .maybeSingle();

    return data?.project_id ?? null;
  };

  const projectId = await projectOfEpisode(job.episodeId);
  const videoUrl = projectId
    ? await ownedEpisodeVideo(
        job.videoUrl,
        { episodeId: job.episodeId, projectId },
        projectOfEpisode,
      )
    : null;

  if (!videoUrl) {
    throw new Error(EPISODE_VIDEO_PUBLISH_REFUSAL);
  }

  return videoUrl;
}

/**
 * Process a single publish job
 */
async function processPublish(job: PublishJobMessage): Promise<void> {
  console.log(
    `[Publish Worker] Processing publish ${job.publishId} to ${job.platform}`,
  );

  // 1. The publish row's own connection, of the episode's account (KB-109)
  await publishJobConnection(supabase, job);

  // KB-104: the handlers download the thumbnail and send it to the channel,
  // and it comes from a row any project writer can update. Only one of the
  // episode's own uploads goes; anything else is dropped, not fetched.
  if (job.thumbnailUrl) {
    const thumbnailUrl = ownedEpisodeThumbnail(job.thumbnailUrl, job.episodeId);
    if (!thumbnailUrl) {
      console.warn(
        `[Publish Worker] Dropped a thumbnail that is not one of episode ${job.episodeId}'s uploads (publish ${job.publishId})`,
      );
    }
    job.thumbnailUrl = thumbnailUrl ?? undefined;
  }

  // KB-123: the handlers download the video or hand its URL to the platform,
  // and it comes from a row any project writer can update. Only a file of the
  // episode's own project goes; anything else fails the job before a fetch.
  job.videoUrl = await ownedJobVideo(job);

  // 2. Get valid access token
  const tokenResult = await checkConnectionToken(
    job.platformConnectionId,
    supabase,
  );
  if (!tokenResult.valid) {
    throw new TokenRefusal(
      tokenResult.error ?? 'NO_ACCESS_TOKEN',
      job.platform,
    );
  }

  // Inject platform-specific account IDs from connection record if available
  // This handles cases where metadata from the scheduler is missing the ID
  if (tokenResult.platformAccountId) {
    if (job.platform === 'facebook') {
      job.metadata.pageId = tokenResult.platformAccountId;
    } else if (job.platform === 'instagram') {
      job.metadata.accountId = tokenResult.platformAccountId;
    }
  }

  // 2. Upload to platform
  const result = await uploadToPlatform(job, tokenResult.accessToken!);

  // 3. Update DB status to published
  await updatePublishStatus(job.publishId, 'published', {
    platform_content_id: result.contentId,
    platform_url: result.url,
    published_at: new Date().toISOString(),
  });

  // FILM-1710: the length of the file just sent, for a platform that never
  // reports one back. Never throws.
  await recordUploadedFileDuration(
    () => supabase,
    { id: job.publishId, platform: job.platform },
    job.videoUrl,
  );

  // 4. Notify user via WebSocket
  await sendToUser(job.userId, {
    type: 'publish-success',
    jobType: 'publish-status',
    publishId: job.publishId,
    platform: job.platform,
    url: result.url,
    timestamp: new Date().toISOString(),
  });

  console.log(`[Publish Worker] SUCCESS: ${job.publishId} → ${result.url}`);
}

/**
 * Process a single delete job
 */
async function processDelete(message: DeleteJobMessage): Promise<void> {
  console.log(`[Publish Worker] Processing delete ${message.publishId}`);

  // The row says what to delete, and whether this user may (KB-47): the
  // message's platform, video and connection are not read
  const target = await deleteJobTarget(supabase, message);

  if (!target) {
    console.log(
      `[Publish Worker] Publish ${message.publishId} is already gone, nothing to delete`,
    );
    return;
  }

  const job: DeleteJobMessage = {
    ...message,
    platform: target.platform as DeleteJobMessage['platform'],
    platformContentId: target.platformContentId,
    platformConnectionId: target.platformConnectionId ?? '',
  };

  // 1. Get valid access token
  const tokenResult = target.platformConnectionId
    ? await checkConnectionToken(target.platformConnectionId, supabase)
    : { valid: false as const, error: 'The publish has no connection' };
  if (!tokenResult.valid) {
    // If token invalid, we might still want to delete the record locally
    // but warn about platform deletion failure
    console.warn(
      `[Publish Worker] Token invalid for ${job.platform}, skipping platform deletion: ${tokenResult.error}`,
    );
  } else {
    // 2. Delete from platform
    try {
      await deleteFromPlatform(job, tokenResult.accessToken!);
    } catch (platformError) {
      console.error(
        `[Publish Worker] Platform deletion failed for ${job.platform}:`,
        platformError,
      );
      // We continue to delete from DB even if platform deletion fails,
      // but we notify the user about the partial failure
      await sendToUser(job.userId, {
        type: 'delete-warning',
        jobType: 'publish-status',
        publishId: job.publishId,
        platform: job.platform,
        message: 'Deleted from records but failed to remove from platform',
        error:
          platformError instanceof Error
            ? platformError.message
            : String(platformError),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 3. Delete from DB
  const { error: dbError } = await supabase
    .from('publishes')
    .delete()
    .eq('id', job.publishId);

  if (dbError) {
    throw new Error(`Database deletion failed: ${dbError.message}`);
  }

  // 4. Notify user via WebSocket
  await sendToUser(job.userId, {
    type: 'delete-success',
    jobType: 'publish-status',
    publishId: job.publishId,
    platform: job.platform,
    timestamp: new Date().toISOString(),
  });

  console.log(`[Publish Worker] DELETE SUCCESS: ${job.publishId}`);
}

interface JobFailure {
  errorMessage: string;
  errorCode?: TokenErrorCode;
  errorStack?: string;
}

/**
 * Marks the job's row failed with what happened, and tells the user. A
 * delete leaves the row alone: it is retried or refused as it stands.
 */
async function recordJobFailure(job: JobMessage, failure: JobFailure) {
  const { errorMessage, errorCode, errorStack } = failure;
  const stored = {
    error: errorMessage,
    errorCode,
    errorStack: errorStack?.split('\n').slice(0, 5).join('\n'),
    failedAt: new Date().toISOString(),
  };

  try {
    if (job.type === 'publish') {
      await updatePublishStatus(job.publishId, 'failed', stored);
    }

    await sendToUser(job.userId, {
      type: job.type === 'delete' ? 'delete-error' : 'publish-error',
      jobType: 'publish-status',
      platform: job.platform,
      publishId: job.publishId,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  } catch (notifyError) {
    console.error(
      `[Publish Worker] Failed to update status or notify user:`,
      notifyError,
    );
  }
}

/**
 * Main Lambda handler
 * Processes batch of SQS messages containing publish or delete jobs
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`[Publish Worker] Received ${event.Records.length} job(s)`);

  const results = await Promise.allSettled(
    event.Records.map(async (record) => {
      let job: JobMessage | undefined;
      try {
        const parsed = JSON.parse(record.body) as
          | JobMessage
          | Omit<PublishJobMessage, 'type'>;
        // Default to 'publish' type for backward compatibility
        job = 'type' in parsed ? parsed : { ...parsed, type: 'publish' };

        // FILM-717: a job for a platform the product removed or hides (X
        // while `X_ENABLED` is off), queued before that, is answered as a
        // refusal value, not retried, and the platform is never called. A
        // delete still runs: it removes our record of a past publish.
        if (job.type !== 'delete' && !isOfferedPlatform(job.platform)) {
          const errorMessage = tokenErrorMessage(
            'PLATFORM_UNSUPPORTED',
            job.platform,
          );
          console.warn(
            `[Publish Worker] REFUSED (PLATFORM_UNSUPPORTED): ${errorMessage}`,
          );
          await recordJobFailure(job, {
            errorMessage,
            errorCode: 'PLATFORM_UNSUPPORTED',
          });
          return { itemIdentifier: record.messageId, status: 'refused' };
        }

        if (job.type === 'delete') {
          await processDelete(job);
        } else {
          await processPublish(job);
        }

        return { itemIdentifier: record.messageId, status: 'fulfilled' };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        const errorCode = tokenErrorCodeOf(error);

        console.error(
          `[Publish Worker] FAILED${errorCode ? ` (${errorCode})` : ''}: ${errorMessage}`,
        );
        if (errorStack) {
          console.error(`[Publish Worker] Stack trace:\n${errorStack}`);
        }

        if (job) {
          await recordJobFailure(job, { errorMessage, errorCode, errorStack });
        }

        // A refusal is an answer: acknowledged, so SQS does not ask again
        if (error instanceof PublishJobRefused) {
          return { itemIdentifier: record.messageId, status: 'refused' };
        }

        throw error; // Re-throw to be caught by Promise.allSettled
      }
    }),
  );

  // Collect failures for SQS batch reporting
  const batchItemFailures = results
    .map((result, index) => {
      if (result.status === 'rejected') {
        return { itemIdentifier: event.Records[index]!.messageId };
      }
      return null;
    })
    .filter((item): item is { itemIdentifier: string } => item !== null);

  console.log(
    `[Publish Worker] Completed: ${event.Records.length - batchItemFailures.length} succeeded, ${batchItemFailures.length} failed`,
  );

  return { batchItemFailures };
};
