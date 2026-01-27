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
import { SupabaseClient, createClient } from '@supabase/supabase-js';

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

import type {
  DeleteJobMessage,
  JobMessage,
  PublishJobMessage,
} from '@kit/publishing/lib/job-types';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
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
 * Ensure we have a valid access token for the platform
 * Note: Token refresh is handled by a cron job (every 30 min).
 * This just decrypts and returns the token.
 */
async function ensureValidToken(
  connectionId: string,
  client: SupabaseClient,
): Promise<{
  valid: boolean;
  accessToken?: string;
  platformAccountId?: string;
  error?: string;
}> {
  // Import crypto utilities
  const { decrypt } = await import('./crypto');

  // Get platform connection
  const { data: connection, error } = await client
    .from('platform_connections')
    .select(
      `
            id, platform, platform_account_id, platform_account_name,
            access_token_encrypted, token_expires_at, is_active
        `,
    )
    .eq('id', connectionId)
    .single();

  if (error || !connection) {
    return { valid: false, error: 'Platform connection not found' };
  }

  if (!connection.is_active) {
    return { valid: false, error: 'Platform connection is inactive' };
  }

  if (!connection.access_token_encrypted) {
    return { valid: false, error: 'No access token available' };
  }

  // Check if token is expired
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;
  const now = new Date();

  if (expiresAt && expiresAt <= now) {
    return {
      valid: false,
      error:
        'Token expired - please reconnect your account or wait for refresh',
    };
  }

  // Decrypt and return the token
  try {
    const accessToken = await decrypt(connection.access_token_encrypted);
    return {
      valid: true,
      accessToken,
      platformAccountId: connection.platform_account_id,
    };
  } catch (decryptError) {
    console.error(
      `[Publish Worker] Failed to decrypt access token:`,
      decryptError,
    );
    return { valid: false, error: 'Failed to decrypt access token' };
  }
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
      return uploadToYouTube(accessToken, job);
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
      return uploadToTwitter(accessToken, job);
    }
    case 'linkedin': {
      const { uploadToLinkedIn } = await import('./handlers/linkedin');
      return uploadToLinkedIn(accessToken, job);
    }
    default:
      throw new Error(`Unsupported platform: ${job.platform}`);
  }
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
    case 'tiktok':
    case 'instagram':
    case 'linkedin':
    case 'twitter':
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

    updateData.metadata = {
      ...(existing?.metadata || {}),
      error: data.error,
      errorStack: data.errorStack,
      failedAt: data.failedAt,
    };
  }

  await supabase.from('publishes').update(updateData).eq('id', publishId);
}

/**
 * Process a single publish job
 */
async function processPublish(job: PublishJobMessage): Promise<void> {
  console.log(
    `[Publish Worker] Processing publish ${job.publishId} to ${job.platform}`,
  );

  // 1. Get valid access token
  const tokenResult = await ensureValidToken(
    job.platformConnectionId,
    supabase,
  );
  if (!tokenResult.valid) {
    throw new Error(tokenResult.error || 'Failed to get access token');
  }

  // Inject platform-specific account IDs from connection record if available
  // This handles cases where metadata from the scheduler is missing the ID
  if (tokenResult.platformAccountId) {
    if (job.platform === 'facebook') {
      job.metadata.pageId = tokenResult.platformAccountId;
    } else if (job.platform === 'instagram') {
      job.metadata.accountId = tokenResult.platformAccountId;
    } else if (job.platform === 'linkedin') {
      job.metadata.authorUrn = tokenResult.platformAccountId;
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
async function processDelete(job: DeleteJobMessage): Promise<void> {
  console.log(
    `[Publish Worker] Processing delete ${job.publishId} from ${job.platform}`,
  );

  // 1. Get valid access token
  const tokenResult = await ensureValidToken(
    job.platformConnectionId,
    supabase,
  );
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
        job = JSON.parse(record.body) as JobMessage;

        // Default to 'publish' type for backward compatibility
        const jobType = 'type' in job ? job.type : 'publish';

        if (jobType === 'delete') {
          await processDelete(job as DeleteJobMessage);
        } else {
          await processPublish(job as PublishJobMessage);
        }

        return { itemIdentifier: record.messageId, status: 'fulfilled' };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        console.error(`[Publish Worker] FAILED: ${errorMessage}`);
        if (errorStack) {
          console.error(`[Publish Worker] Stack trace:\n${errorStack}`);
        }

        // Notify user about failure
        if (job) {
          try {
            const isDelete = 'type' in job && job.type === 'delete';
            const type = isDelete ? 'delete-error' : 'publish-error';

            if (!isDelete) {
              // Only update status for publish jobs, delete jobs are just retried or failed
              await updatePublishStatus(
                (job as PublishJobMessage).publishId,
                'failed',
                {
                  error: errorMessage,
                  errorStack: errorStack?.split('\n').slice(0, 5).join('\n'),
                  failedAt: new Date().toISOString(),
                },
              );
            }

            await sendToUser(job.userId, {
              type,
              jobType: 'publish-status',
              publishId: job.publishId, // Both types have publishId
              platform: job.platform as string,
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
