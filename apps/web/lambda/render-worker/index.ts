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
import { createHash } from 'crypto';
import { createReadStream, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ws from 'ws';

import type { Database } from '@kit/supabase/database';

import {
  type RenderClip,
  type RenderProject,
  RenderStageError,
  type RenderTrack,
  loadRenderInput,
  selectRenderClips,
} from './render-input';

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
        console.error(`[WebSocket] Error sending to ${connectionId}:`, error);
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

  // 1-2. Mark 'rendering' and read the project, tracks and clips
  const input = await loadRenderInput(supabase, editProjectId).catch(
    (error: unknown) => {
      if (error instanceof RenderStageError) {
        console.error(`[Render] ${error.message}`, {
          editProjectId,
          language,
          ...error.detail,
        });
      }

      throw error;
    },
  );

  const { project, tracks } = input;

  await sendRenderStatus(userId, editProjectId, 'rendering', { progress: 0 });

  // 3. Keep the clips this language's render includes
  const activeClips = selectRenderClips(tracks, input.clips, language);

  await sendRenderStatus(userId, editProjectId, 'rendering', {
    progress: 10,
  });

  console.log(
    `[Render] Found ${activeClips.length} active clips for language '${language}'`,
  );

  // The output must outlive the render: the upload and the hash below read
  // it. This directory is removed only once they have (finally, below).
  const workDir = mkdtempSync(join(tmpdir(), 'render-'));

  try {
    await renderUploadAndRecord({
      project,
      tracks,
      clips: activeClips,
      language,
      workDir,
      userId,
      editProjectId,
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function renderUploadAndRecord({
  project,
  tracks,
  clips,
  language,
  workDir,
  userId,
  editProjectId,
}: {
  project: RenderProject;
  tracks: RenderTrack[];
  clips: RenderClip[];
  language: string;
  workDir: string;
  userId: string;
  editProjectId: string;
}): Promise<void> {
  // 4. Import and run FFmpeg render handler
  const { processFFmpegRender } = await import('./handlers/ffmpeg-render');

  const result = await processFFmpegRender({
    project,
    tracks,
    clips,
    language,
    workDir,
    onProgress: async (progress: number) => {
      await sendRenderStatus(userId, editProjectId, 'rendering', {
        progress: 10 + Math.round(progress * 0.8), // 10-90% for FFmpeg
      });
    },
  });

  await sendRenderStatus(userId, editProjectId, 'rendering', {
    progress: 90,
  });

  // 5. Upload result to R2 using streaming (avoids loading entire video into RAM)
  const { uploadToR2 } = await import('./utils/r2-storage');
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

  // 5.5 Create master video asset (FILM-716 integration)
  // Compute SHA-256 hash for dedup, create asset record, link to episode
  try {
    // Stream-based hashing to avoid loading entire video into RAM
    const fileSizeBytes = statSync(result.outputPath).size;
    const fileHash = await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(result.outputPath);
      stream.on('error', reject);
      stream.on('data', (d) => hash.update(d));
      stream.on('end', () => resolve(hash.digest('hex')));
    });

    // Check if a master_video asset with this hash already exists for the project
    // A compilation's edit project has no episode, so no master asset.
    const episodeId = project.episode_id;
    const { data: episode } = episodeId
      ? await supabase
          .from('episodes')
          .select('project_id')
          .eq('id', episodeId)
          .single()
      : { data: null };

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
      if (masterAssetId && episodeId && language === 'en') {
        await supabase
          .from('episodes')
          .update({ master_video_asset_id: masterAssetId })
          .eq('id', episodeId);
        console.log(`[Render] Linked master asset to episode ${episodeId}`);
      }
    }
  } catch (assetErr) {
    // Non-fatal: log and continue — the render itself succeeded
    console.error(
      '[Render] Master asset creation failed (non-fatal):',
      assetErr,
    );
  }

  await sendRenderStatus(userId, editProjectId, 'rendering', {
    progress: 95,
  });

  // 6. Update DB with completed status
  await supabase
    .from('edit_projects')
    .update({
      render_status: 'completed',
      render_url: uploadResult.url,
      render_completed_at: new Date().toISOString(),
    })
    .eq('id', editProjectId);

  // 7. Send completion via WebSocket
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
            error instanceof Error ? error.message : 'Unknown render error';

          await supabase
            .from('edit_projects')
            .update({
              render_status: 'failed',
              render_error: errorMessage,
            })
            .eq('id', job.editProjectId);

          await sendRenderStatus(job.userId, job.editProjectId, 'failed', {
            renderError: errorMessage,
          });
        } catch {
          console.error(`[Render Worker] Could not update failure status`);
        }
      }

      // Add to failures for retry/DLQ
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
