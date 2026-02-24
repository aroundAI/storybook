/**
 * FFmpeg Render Worker Lambda
 *
 * Processes video render jobs from SQS queue.
 * Downloads media from R2, runs FFmpeg, uploads result to R2.
 * Sends real-time render status updates via WebSocket.
 *
 * Features:
 * - 15-minute timeout for long FFmpeg renders
 * - Progress reporting via WebSocket
 * - R2 media download and upload
 * - Multi-language render support
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

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface RenderJobMessage {
    editProjectId: string;
    userId: string;
    language: string; // 'en', 'es', etc.
}

// ──────────────────────────────────────────
// WebSocket helpers
// ──────────────────────────────────────────

/**
 * Send message to user via WebSocket
 */
async function sendToUser(
    userId: string,
    message: Record<string, unknown>,
): Promise<void> {
    if (!CONNECTIONS_TABLE_NAME || !WEBSOCKET_ENDPOINT) {
        console.log('[WebSocket] Not configured, skipping');
        return;
    }

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
        console.log(`[WebSocket] No active connections for user ${userId}`);
        return;
    }

    const apiGatewayClient = new ApiGatewayManagementApiClient({
        endpoint: WEBSOCKET_ENDPOINT,
    });

    const postCalls = connections.Items.map(async ({ connectionId }) => {
        try {
            await apiGatewayClient.send(
                new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify(message),
                }),
            );
        } catch (error: unknown) {
            const statusCode =
                error &&
                    typeof error === 'object' &&
                    'statusCode' in error &&
                    typeof error.statusCode === 'number'
                    ? error.statusCode
                    : null;

            if (statusCode === 410) {
                // Connection is gone, remove from DynamoDB
                await ddb.send(
                    new DeleteCommand({
                        TableName: CONNECTIONS_TABLE_NAME,
                        Key: { connectionId },
                    }),
                );
            } else {
                console.error(
                    `[WebSocket] Error sending to ${connectionId}:`,
                    error,
                );
            }
        }
    });

    await Promise.all(postCalls);
}

/**
 * Send render status update via WebSocket
 */
async function sendRenderStatus(
    userId: string,
    editProjectId: string,
    status: 'queued' | 'rendering' | 'completed' | 'failed',
    extra?: { renderUrl?: string; renderError?: string; progress?: number },
): Promise<void> {
    await sendToUser(userId, {
        type: 'render-status-changed',
        data: {
            editProjectId,
            status,
            renderUrl: extra?.renderUrl ?? null,
            renderError: extra?.renderError ?? null,
            progress: extra?.progress ?? null,
        },
    });
}

// ──────────────────────────────────────────
// Render processing
// ──────────────────────────────────────────

async function processRender(job: RenderJobMessage): Promise<void> {
    const { editProjectId, userId, language } = job;

    console.log(
        `[Render] Starting render for project ${editProjectId}, language: ${language}`,
    );

    // 1. Update status to 'rendering'
    await supabase
        .from('edit_projects')
        .update({
            render_status: 'rendering',
            render_started_at: new Date().toISOString(),
            render_error: null,
        })
        .eq('id', editProjectId);

    await sendRenderStatus(userId, editProjectId, 'rendering', { progress: 0 });

    // 2. Fetch all edit project data
    const { data: project, error: projectError } = await supabase
        .from('edit_projects')
        .select('*')
        .eq('id', editProjectId)
        .single();

    if (projectError || !project) {
        throw new Error(`Edit project not found: ${editProjectId}`);
    }

    // 3. Fetch tracks, clips, transitions, keyframes
    const { data: tracks } = await supabase
        .from('edit_tracks')
        .select('*')
        .eq('edit_project_id', editProjectId)
        .order('sort_order');

    const trackIds = (tracks ?? []).map((t) => t.id);

    const { data: clips } = await supabase
        .from('edit_clips')
        .select('*')
        .in('track_id', trackIds)
        .order('start_ms');

    const { data: transitions } = await supabase
        .from('edit_transitions')
        .select('*');

    const { data: keyframes } = await supabase
        .from('edit_keyframes')
        .select('*');

    // 4. Filter clips by language
    const activeClips = (clips ?? []).filter((clip) => {
        // Video/music/sfx/ambient clips are always active
        const track = (tracks ?? []).find((t) => t.id === clip.track_id);
        if (!track) return false;

        const audioTrackTypes = ['dialogue'];
        if (!audioTrackTypes.includes(track.type)) return true;

        // For dialogue clips, filter by language
        if (!clip.language) return true;
        return clip.language === language;
    });

    await sendRenderStatus(userId, editProjectId, 'rendering', {
        progress: 10,
    });

    console.log(
        `[Render] Found ${activeClips.length} active clips for language '${language}'`,
    );

    // 5. Import and run FFmpeg render handler
    const { processFFmpegRender } = await import(
        './handlers/ffmpeg-render'
    );

    const result = await processFFmpegRender({
        project,
        tracks: tracks ?? [],
        clips: activeClips,
        transitions: transitions ?? [],
        keyframes: keyframes ?? [],
        language,
        onProgress: async (progress: number) => {
            await sendRenderStatus(userId, editProjectId, 'rendering', {
                progress: 10 + Math.round(progress * 0.8), // 10-90% for FFmpeg
            });
        },
    });

    await sendRenderStatus(userId, editProjectId, 'rendering', {
        progress: 90,
    });

    // 6. Upload result to R2
    const { uploadToR2 } = await import('./utils/r2-storage');
    const renderPath = `renders/${editProjectId}/${language}/output.mp4`;
    const uploadResult = await uploadToR2(
        'renders',
        `${editProjectId}/${language}/output.mp4`,
        result.buffer,
        'video/mp4',
    );

    await sendRenderStatus(userId, editProjectId, 'rendering', {
        progress: 95,
    });

    // 7. Update DB with completed status
    await supabase
        .from('edit_projects')
        .update({
            render_status: 'completed',
            render_url: uploadResult.url,
            render_completed_at: new Date().toISOString(),
        })
        .eq('id', editProjectId);

    // 8. Send completion via WebSocket
    await sendRenderStatus(userId, editProjectId, 'completed', {
        renderUrl: uploadResult.url,
        progress: 100,
    });

    console.log(`[Render] Completed: ${uploadResult.url}`);
}

// ──────────────────────────────────────────
// Main Lambda handler
// ──────────────────────────────────────────

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
    console.log(`[Render Worker] Received ${event.Records.length} job(s)`);

    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
        let job: RenderJobMessage | null = null;

        try {
            job = JSON.parse(record.body);

            console.log(
                `[Render Worker] Processing render for project ${job!.editProjectId}, lang=${job!.language}`,
            );

            await processRender(job!);

            console.log(`[Render Worker] Render completed successfully`);
        } catch (error) {
            console.error(`[Render Worker] Render failed:`, error);

            // Try to update status to failed and notify user
            if (job) {
                try {
                    const errorMessage =
                        error instanceof Error
                            ? error.message
                            : 'Unknown render error';

                    await supabase
                        .from('edit_projects')
                        .update({
                            render_status: 'failed',
                            render_error: errorMessage,
                        })
                        .eq('id', job.editProjectId);

                    await sendRenderStatus(
                        job.userId,
                        job.editProjectId,
                        'failed',
                        { renderError: errorMessage },
                    );
                } catch {
                    console.error(
                        `[Render Worker] Could not update failure status`,
                    );
                }
            }

            // Add to failures for retry/DLQ
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
};
