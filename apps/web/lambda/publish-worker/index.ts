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
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
 * Publish Job Message Structure
 */
export interface PublishJobMessage {
    publishId: string;
    userId: string;
    platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'twitter' | 'linkedin';
    platformConnectionId: string;
    episodeId: string;
    videoUrl: string;
    title: string;
    description: string;
    tags: string[];
    thumbnailUrl?: string;
    metadata: Record<string, unknown>;
}

/**
 * Send message to user via WebSocket
 */
async function sendToUser(
    userId: string,
    message: Record<string, unknown>,
): Promise<void> {
    if (!CONNECTIONS_TABLE_NAME || !WEBSOCKET_ENDPOINT) {
        console.log(`[Publish Worker] WebSocket not configured, skipping notification`);
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
        console.log(`[Publish Worker] No active connections for user ${userId.substring(0, 8)}...`);
        return;
    }

    const wsClient = new ApiGatewayManagementApiClient({
        endpoint: WEBSOCKET_ENDPOINT,
    });

    const messageStr = JSON.stringify(message);

    for (const conn of connections.Items) {
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
                console.log(`[Publish Worker] Cleaning up stale connection ${conn.connectionId}`);
                await ddb.send(
                    new DeleteCommand({
                        TableName: CONNECTIONS_TABLE_NAME,
                        Key: { connectionId: conn.connectionId },
                    }),
                );
            }
        }
    }
}

/**
 * Ensure we have a valid access token for the platform
 */
async function ensureValidToken(
    connectionId: string,
    client: SupabaseClient,
): Promise<{ valid: boolean; accessToken?: string; error?: string }> {
    // Get platform connection
    const { data: connection, error } = await client
        .from('platform_connections')
        .select('*')
        .eq('id', connectionId)
        .single();

    if (error || !connection) {
        return { valid: false, error: 'Platform connection not found' };
    }

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = connection.expires_at ? new Date(connection.expires_at) : null;
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiresAt && expiresAt > fiveMinutesFromNow) {
        // Token still valid
        return { valid: true, accessToken: connection.access_token };
    }

    // Need to refresh token
    if (!connection.refresh_token) {
        return { valid: false, error: 'No refresh token available' };
    }

    console.log(`[Publish Worker] Refreshing token for connection ${connectionId}`);

    try {
        // Dynamic import to keep bundle smaller
        const { refreshOAuthToken } = await import('./token-refresh');
        const newTokens = await refreshOAuthToken(connection.platform, connection.refresh_token);

        // Update tokens in database
        await client
            .from('platform_connections')
            .update({
                access_token: newTokens.accessToken,
                refresh_token: newTokens.refreshToken || connection.refresh_token,
                expires_at: newTokens.expiresAt,
            })
            .eq('id', connectionId);

        return { valid: true, accessToken: newTokens.accessToken };
    } catch (refreshError) {
        const errorMessage = refreshError instanceof Error ? refreshError.message : String(refreshError);
        console.error(`[Publish Worker] Token refresh failed: ${errorMessage}`);
        return { valid: false, error: `Token refresh failed: ${errorMessage}` };
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
    console.log(`[Publish Worker] Processing publish ${job.publishId} to ${job.platform}`);

    // 1. Get valid access token
    const tokenResult = await ensureValidToken(job.platformConnectionId, supabase);
    if (!tokenResult.valid) {
        throw new Error(tokenResult.error || 'Failed to get access token');
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
        publishId: job.publishId,
        platform: job.platform,
        url: result.url,
        timestamp: new Date().toISOString(),
    });

    console.log(`[Publish Worker] SUCCESS: ${job.publishId} → ${result.url}`);
}

/**
 * Main Lambda handler
 * Processes batch of SQS messages containing publish jobs
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
    console.log(`[Publish Worker] Received ${event.Records.length} job(s)`);

    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
        let job: PublishJobMessage | undefined;

        try {
            job = JSON.parse(record.body) as PublishJobMessage;

            console.log(
                `[Publish Worker] Processing job ${job.publishId} for ${job.platform}`,
            );

            await processPublish(job);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            console.error(`[Publish Worker] FAILED: ${errorMessage}`);
            if (errorStack) {
                console.error(`[Publish Worker] Stack trace:\n${errorStack}`);
            }

            // Update status to failed if we have the job
            if (job) {
                try {
                    await updatePublishStatus(job.publishId, 'failed', {
                        error: errorMessage,
                        errorStack: errorStack?.split('\n').slice(0, 5).join('\n'),
                        failedAt: new Date().toISOString(),
                    });

                    await sendToUser(job.userId, {
                        type: 'publish-error',
                        publishId: job.publishId,
                        platform: job.platform,
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

            // Add to failures for retry/DLQ
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    console.log(
        `[Publish Worker] Completed: ${event.Records.length - batchItemFailures.length} succeeded, ${batchItemFailures.length} failed`,
    );

    return { batchItemFailures };
};
