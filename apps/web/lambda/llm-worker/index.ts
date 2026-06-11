/**
 * LLM Worker Lambda
 *
 * Processes long-running LLM jobs from SQS queue.
 * Results are pushed to users via WebSocket.
 *
 * Features:
 * - 15-minute timeout for long LLM calls
 * - Routes to appropriate job handlers
 * - Sends results/errors via WebSocket to requesting user
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

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
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
      Buffer.from(parts[1], 'base64').toString('utf8'),
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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: ws,
  },
});

/**
 * LLM Job message structure
 */
interface LlmJobMessage {
  jobType: string;
  userId: string;
  payload: Record<string, unknown>;
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
 * Process a single LLM job
 * Routes to appropriate handler based on jobType
 */
async function processJob(job: LlmJobMessage): Promise<unknown> {
  console.log(`[LLM Worker] Processing job: ${job.jobType}`);

  // Dynamic import of job handlers to keep Lambda bundle smaller
  switch (job.jobType) {
    case 'season-analysis': {
      const { processSeasonAnalysis } = await import(
        './handlers/season-analysis'
      );
      return processSeasonAnalysis(job.payload, supabase);
    }
    case 'season-outline': {
      const { processSeasonOutline } = await import(
        './handlers/season-outline'
      );
      return processSeasonOutline(job.payload, supabase);
    }
    case 'story-ideation': {
      const { processStoryIdeation } = await import(
        './handlers/story-ideation'
      );
      return processStoryIdeation(job.payload, supabase);
    }
    case 'story-generation': {
      const { processStoryGeneration } = await import(
        './handlers/story-generation'
      );
      return processStoryGeneration(job.payload, supabase);
    }
    case 'screenplay-conversion': {
      const { processScreenplayConversion } = await import(
        './handlers/screenplay-conversion'
      );
      return processScreenplayConversion(job.payload, supabase);
    }
    case 'shot-generation': {
      const { processShotGeneration } = await import(
        './handlers/shot-generation'
      );
      return processShotGeneration(job.payload, supabase);
    }
    case 'batch-translate-metadata': {
      const { processBatchTranslateMetadata } = await import(
        './handlers/batch-translate-metadata'
      );
      return processBatchTranslateMetadata(job.payload, supabase);
    }
    case 'analytics-insights': {
      const { processAnalyticsInsights } = await import(
        './handlers/analytics-insights'
      );
      return processAnalyticsInsights(job.payload, supabase);
    }
    case 'asset-creation': {
      const { processAssetCreation } = await import(
        './handlers/asset-creation'
      );
      return processAssetCreation(job.payload, supabase);
    }
    case 'language-insights': {
      const { processLanguageInsights } = await import(
        './handlers/language-insights'
      );
      return processLanguageInsights(job.payload, supabase);
    }
    case 'translate-dialogue': {
      const { processTranslateDialogue } = await import(
        './handlers/translate-dialogue'
      );
      return processTranslateDialogue(job.payload, supabase);
    }
    case 'audio-cue-generation': {
      const { processAudioCueGeneration } = await import(
        './handlers/audio-cue-generation'
      );
      return processAudioCueGeneration(job.payload, supabase);
    }
    case 'audio-file-generation': {
      const { processAudioFileGeneration } = await import(
        './handlers/audio-file-generation'
      );
      return processAudioFileGeneration(job.payload, supabase);
    }
    case 'story-refinement': {
      const { processStoryRefinement } = await import(
        './handlers/story-refinement'
      );
      return processStoryRefinement(job.payload, supabase);
    }
    case 'screenplay-refinement': {
      const { processScreenplayRefinement } = await import(
        './handlers/screenplay-refinement'
      );
      return processScreenplayRefinement(job.payload, supabase);
    }
    case 'fact-extraction': {
      const { processFactExtraction } = await import(
        './handlers/fact-extraction'
      );
      return processFactExtraction(job.payload, supabase);
    }
    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}

/**
 * Main Lambda handler
 * Processes batch of SQS messages containing LLM jobs
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`[LLM Worker] Received ${event.Records.length} job(s)`);

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const job: LlmJobMessage = JSON.parse(record.body);

      console.log(
        `[LLM Worker] Processing job ${job.jobType} for user ${job.userId.substring(0, 8)}...`,
      );

      // Process the job
      const result = await processJob(job);

      // Send success result via WebSocket
      await sendToUser(job.userId, {
        type: 'llm-result',
        jobType: job.jobType,
        episodeId: (job.payload?.episodeId as string) ?? undefined,
        result,
        timestamp: new Date().toISOString(),
      });

      console.log(`[LLM Worker] Job ${job.jobType} completed successfully`);
    } catch (error) {
      console.error(`[LLM Worker] Job failed:`, error);

      // Try to parse job to send error to user
      try {
        const job: LlmJobMessage = JSON.parse(record.body);

        await sendToUser(job.userId, {
          type: 'llm-error',
          jobType: job.jobType,
          episodeId: (job.payload?.episodeId as string) ?? undefined,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        });
      } catch {
        console.error(`[LLM Worker] Could not parse job or send error to user`);
      }

      // Add to failures for retry/DLQ
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
