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

    // 4. Filter clips by language, activation status, and track mute state
    const activeClips = (clips ?? []).filter((clip) => {
        // Skip deactivated clips
        if (!clip.is_active) return false;

        const track = (tracks ?? []).find((t) => t.id === clip.track_id);
        if (!track || track.is_muted) return false;

        // Non-dialogue clips are always included (if active + unmuted)
        if (track.type !== 'dialogue') return true;

        // For dialogue clips, filter by language
        return !clip.language || clip.language === language;
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

    // 6. Upload result to R2 using streaming (avoids loading entire video into RAM)
    const { uploadToR2 } = await import('./utils/r2-storage');
    const { createReadStream, statSync } = await import('fs');
    const { createHash } = await import('crypto');
    const fileStream = createReadStream(result.outputPath);
    const uploadResult = await uploadToR2(
        'renders',
        `${editProjectId}/${language}/output.mp4`,
        fileStream,
        'video/mp4',
    );

    await sendRenderStatus(userId, editProjectId, 'rendering', {
        progress: 92,
    });

    // 6.5 Create master video asset (FILM-716 integration)
    // Compute SHA-256 hash for dedup, create asset record, link to episode
    try {
        // Stream-based hashing to avoid loading entire video into RAM
        const fileSizeBytes = statSync(result.outputPath).size;
        const fileHash = await new Promise<string>((resolve, reject) => {
            const hash = createHash('sha256');
            const stream = createReadStream(result.outputPath);
            stream.on('error', reject);
            // @ts-expect-error Node.js Buffer is compatible with hash.update() at runtime
            stream.on('data', (d) => hash.update(d));
            stream.on('end', () => resolve(hash.digest('hex')));
        });

        // Check if a master_video asset with this hash already exists for the project
        const episodeId = project.episode_id;
        const { data: episode } = await supabase
            .from('episodes')
            .select('project_id')
            .eq('id', episodeId)
            .single();

        const projectId = episode?.project_id;

        if (projectId) {
            // Check for existing asset with same hash (dedup)
            const { data: existingAsset } = await supabase
                .from('assets')
                .select('id')
                .eq('project_id', projectId)
                .eq('file_hash', fileHash)
                .eq('type', 'master_video')
                .is('deleted_at', null)
                .maybeSingle();

            let masterAssetId: string | undefined;

            if (existingAsset) {
                // Reuse existing asset (identical file)
                masterAssetId = existingAsset.id;
                console.log(`[Render] Reusing existing master asset: ${masterAssetId}`);
            } else {
                // Create new master video asset
                const { data: newAsset, error: assetError } = await supabase
                    .from('assets')
                    .insert({
                        project_id: projectId,
                        episode_id: episodeId,
                        type: 'master_video',
                        name: `Master Video (${language.toUpperCase()})`,
                        file_url: uploadResult.url,
                        file_hash: fileHash,
                        file_size_bytes: fileSizeBytes,
                        content_type: 'video/mp4',
                        metadata: {
                            language,
                            editProjectId,
                            renderedAt: new Date().toISOString(),
                        },
                    })
                    .select('id')
                    .single();

                if (assetError || !newAsset) {
                    console.error('[Render] Failed to create master asset:', assetError);
                } else {
                    masterAssetId = newAsset.id;
                    console.log(`[Render] Created master asset: ${masterAssetId}`);
                }
            }

            // Link master asset to episode (only for primary language renders)
            if (masterAssetId && language === 'en') {
                await supabase
                    .from('episodes')
                    .update({ master_video_asset_id: masterAssetId })
                    .eq('id', episodeId);
                console.log(`[Render] Linked master asset to episode ${episodeId}`);
            }
        }
    } catch (assetErr) {
        // Non-fatal: log and continue — the render itself succeeded
        console.error('[Render] Master asset creation failed (non-fatal):', assetErr);
    }

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
