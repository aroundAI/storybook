/**
 * Voice Worker Lambda
 *
 * Processes voice generation jobs from SQS queue.
 * Each message = one dialogue line TTS generation.
 *
 * Features:
 * - Parallel processing via Promise.allSettled
 * - Batch job progress tracking via Supabase RPC
 * - WebSocket notifications for single-line and batch-complete events
 * - Comprehensive logging for debugging
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

import {
  QueuedJobRefused,
  assertQueuedJobAccess,
} from '@kit/prompt-engine/llm-job-target';
import { awsClientOptions } from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient(awsClientOptions('dynamodb'));
const ddb = DynamoDBDocumentClient.from(ddbClient);
const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || '';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Debug: Log whether credentials are properly set (without exposing full key)
console.log(`[Supabase Init] URL: ${supabaseUrl ? 'SET' : 'MISSING'}`);
console.log(
  `[Supabase Init] Service Key: ${supabaseServiceKey ? `SET (${supabaseServiceKey.length} chars, starts with: ${supabaseServiceKey.substring(0, 10)}...)` : 'MISSING'}`,
);

// Decode JWT to verify role (without external library)
try {
  const parts = supabaseServiceKey.split('.');
  if (parts.length === 3) {
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? '', 'base64').toString('utf8'),
    );
    console.log(`[Supabase Init] JWT Role: ${payload.role}`);
    console.log(
      `[Supabase Init] JWT Issued At: ${new Date(payload.iat * 1000).toISOString()}`,
    );
    if (payload.role !== 'service_role') {
      console.error(
        `[Supabase Init] WARNING: Expected 'service_role' but got '${payload.role}'`,
      );
    }
  }
} catch (e) {
  console.warn(`[Supabase Init] Could not decode JWT: ${e}`);
}

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    `Supabase credentials missing: URL=${!!supabaseUrl}, ServiceKey=${!!supabaseServiceKey}`,
  );
}

/** `increment_batch_progress` returns jsonb of this shape (20260527094643_increment_batch_progress_rpc.sql). */
type BatchProgress = {
  is_complete: boolean;
  completed?: number;
  failed?: number;
  total?: number;
};

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
 * Voice job message structure
 */
interface VoiceJobMessage {
  dialogueLineId: string;
  batchJobId: string | null;
  episodeId: string;
  accountId: string;
  voiceId: string;
  ttsModel: string;
  voiceSettings: {
    stability: number;
    similarityBoost: number;
    style?: number;
    speed?: number;
  };
  text: string;
  characterAssetId?: string;
  userId: string;
  overwriteExisting: boolean;
}

/**
 * Send message to user via WebSocket
 */
async function sendToUser(
  userId: string,
  message: Record<string, unknown>,
): Promise<void> {
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
    console.log(`[WebSocket] No active connections for user ${userId}`);
    return;
  }

  console.log(
    `[WebSocket] Sending to ${connections.Items.length} connections for user ${userId}`,
  );

  // Create API Gateway Management API client
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_ENDPOINT,
    ...awsClientOptions('apigateway'),
  });

  // Send to all connections
  const postCalls = connections.Items.map(async ({ connectionId }) => {
    try {
      await apiGatewayClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(message),
        }),
      );
      console.log(`[WebSocket] Message sent to connection ${connectionId}`);
    } catch (error: unknown) {
      const statusCode =
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        typeof error.statusCode === 'number'
          ? error.statusCode
          : null;

      if (statusCode === 410) {
        // Connection is gone, remove it from DynamoDB
        console.log(`[WebSocket] Stale connection ${connectionId}, removing`);
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
 * Main Lambda handler
 * Processes batch of SQS messages containing voice generation jobs
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`[Voice Worker] Received ${event.Records.length} job(s)`);

  const results = await Promise.allSettled(
    event.Records.map(async (record) => {
      const payload: VoiceJobMessage = JSON.parse(record.body);

      console.log(
        `[Voice Worker] Processing dialogue ${payload.dialogueLineId} for user ${payload.userId.substring(0, 8)}...`,
      );

      try {
        // The job's user must still be able to write the line's project;
        // the producer asked as them when it queued (KB-46), this asks again
        // now, on the service-role key (KB-49)
        await assertQueuedJobAccess(supabase, {
          userId: payload.userId,
          accountId: payload.accountId,
          episodeId: payload.episodeId,
        });

        // Process the voice generation with retry for rate limits
        const { processDialogueVoiceGeneration } = await import(
          './voice-generation'
        );

        // Retry logic for ElevenLabs 429 rate limit errors
        const MAX_RETRIES = 3;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = await processDialogueVoiceGeneration(
              payload,
              supabase,
            );

            // Success — handle batch vs single-line
            if (payload.batchJobId) {
              // Batch mode: increment progress via RPC
              const { data: batchStatus } = (await supabase.rpc(
                'increment_batch_progress',
                {
                  p_batch_job_id: payload.batchJobId,
                  p_status: 'completed',
                },
              )) as { data: BatchProgress | null };

              console.log(
                `[Voice Worker] Batch ${payload.batchJobId} progress updated`,
              );

              // If batch is complete, notify user
              if (batchStatus?.is_complete) {
                await sendToUser(payload.userId, {
                  type: 'llm-result',
                  jobType: 'batch-voice-complete',
                  result: {
                    batchJobId: payload.batchJobId,
                    completed: batchStatus.completed,
                    failed: batchStatus.failed,
                    total: batchStatus.total,
                  },
                  timestamp: new Date().toISOString(),
                });
              }
            } else {
              // Single-line mode: send result directly via WebSocket
              await sendToUser(payload.userId, {
                type: 'llm-result',
                jobType: 'dialogue-voice-generation',
                result,
                timestamp: new Date().toISOString(),
              });
            }

            console.log(
              `[Voice Worker] Dialogue ${payload.dialogueLineId} completed successfully${attempt > 0 ? ` (after ${attempt} retries)` : ''}`,
            );
            lastError = null;
            break; // Success — exit retry loop
          } catch (retryError) {
            lastError =
              retryError instanceof Error
                ? retryError
                : new Error(String(retryError));

            // Only retry on 429 rate limit errors
            const is429 =
              lastError.message.includes('429') ||
              lastError.message.includes('concurrent_limit_exceeded') ||
              lastError.message.includes('rate_limit');

            if (is429 && attempt < MAX_RETRIES) {
              const backoffMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
              console.log(
                `[Voice Worker] 429 rate limit for ${payload.dialogueLineId}, retry ${attempt + 1}/${MAX_RETRIES} in ${backoffMs}ms`,
              );
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              continue;
            }

            // Non-retryable error or max retries exhausted
            throw lastError;
          }
        }

        if (lastError) {
          throw lastError;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.error(
          `[Voice Worker] Failed dialogue ${payload.dialogueLineId}:`,
          error,
        );

        if (payload.batchJobId) {
          // Batch mode: mark as failed in batch progress
          try {
            const { data: batchStatus } = (await supabase.rpc(
              'increment_batch_progress',
              {
                p_batch_job_id: payload.batchJobId,
                p_status: 'failed',
              },
            )) as { data: BatchProgress | null };

            // If batch is complete (all items processed, some failed), notify user
            if (batchStatus?.is_complete) {
              await sendToUser(payload.userId, {
                type: 'llm-result',
                jobType: 'batch-voice-complete',
                result: {
                  batchJobId: payload.batchJobId,
                  completed: batchStatus.completed,
                  failed: batchStatus.failed,
                  total: batchStatus.total,
                },
                timestamp: new Date().toISOString(),
              });
            }
          } catch (rpcError) {
            console.error(
              `[Voice Worker] Failed to update batch progress:`,
              rpcError,
            );
          }
        } else {
          // Single-line mode: send error via WebSocket
          await sendToUser(payload.userId, {
            type: 'llm-error',
            jobType: 'dialogue-voice-generation',
            error: errorMessage,
            timestamp: new Date().toISOString(),
          });
        }

        // A refusal is an answer: acknowledged, so SQS does not ask again
        if (error instanceof QueuedJobRefused) return;

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
    `[Voice Worker] Completed: ${event.Records.length - batchItemFailures.length} succeeded, ${batchItemFailures.length} failed`,
  );

  return { batchItemFailures };
};
