/**
 * SQS Helper for LLM Job Queue
 *
 * Provides a simple interface for server actions to queue LLM jobs
 * for background processing.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import {
  type LlmJobPayloadInput,
  type LlmJobType,
  parseLlmJobPayload,
} from '../llm-job-payloads';
import type { LlmJobTarget } from './llm-job-target';

// Initialize SQS client
const sqs = new SQSClient({});

/**
 * Get queue URL from SST Resource or environment variable
 * SST v3 provides linked resources via the Resource object
 */
function getQueueUrl(): string {
  // Try SST Resource binding first (production)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require('sst');
    if (Resource?.StorybookLlmJobsQueue?.url) {
      return Resource.StorybookLlmJobsQueue.url;
    }
  } catch {
    // Resource not available - not in SST environment
  }

  // Fall back to environment variable
  return process.env.LLM_JOBS_QUEUE_URL || '';
}

export type { LlmJobType };

/**
 * Queue an LLM job for background processing
 *
 * @param params.jobType - Type of job (determines which handler runs)
 * @param params.userId - User ID to send results to via WebSocket
 * @param params.target - What the job may touch, from an authoriser in
 *   `./llm-job-target` (KB-31). The worker runs on the service-role key, so
 *   this is the only check between a caller and the ids it names.
 * @param params.payload - Job-specific payload data
 * @returns Promise that resolves when message is queued
 *
 * The payload's `accountId`, `projectId` and `episodeId` are the target's:
 * `accountId` is always stamped from it, and a payload naming a different
 * project or episode is a programming error, thrown before anything is sent.
 * `userId` is stamped from `params.userId`. The result is parsed with the job
 * type's schema (`../llm-job-payloads`), which the worker also uses.
 *
 * @example
 * ```typescript
 * const target = await authorizeProjectTarget(client, projectId);
 * if (!target) throw new ActionRefusal('Project not found');
 * await queueLlmJob({
 *   jobType: 'season-analysis',
 *   userId: user.id,
 *   target,
 *   payload: { projectId, roadmap },
 * });
 * return { queued: true };
 * ```
 */
export async function queueLlmJob<T extends LlmJobType>(params: {
  jobType: T;
  userId: string;
  target: LlmJobTarget;
  payload: LlmJobPayloadInput<T>;
}): Promise<void> {
  // The handler parses with the same schema: a payload it would refuse is
  // refused here, before anything is sent (KB-33)
  const payload = parseLlmJobPayload(params.jobType, {
    ...payloadForTarget(params.target, params.payload),
    userId: params.userId,
  });
  const queueUrl = getQueueUrl();

  if (!queueUrl) {
    throw new Error(
      'LLM_JOBS_QUEUE_URL not configured. Ensure the queue is linked in sst.config.ts',
    );
  }

  console.log(
    `[SQS] Queuing ${params.jobType} job for user ${params.userId.substring(0, 8)}...`,
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        jobType: params.jobType,
        userId: params.userId,
        payload,
      }),
      // Add message attributes for filtering/monitoring
      MessageAttributes: {
        jobType: {
          DataType: 'String',
          StringValue: params.jobType,
        },
      },
    }),
  );

  console.log(`[SQS] Job queued successfully`);
}

/**
 * The payload as sent: the target's ids, never different ones.
 */
export function payloadForTarget(
  target: LlmJobTarget,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of ['projectId', 'episodeId'] as const) {
    const named = payload[key];
    const authorised = target[key];

    if (named !== undefined && named !== authorised) {
      throw new Error(
        `queueLlmJob: payload.${key} is not the authorised target's ${key}`,
      );
    }
  }

  return {
    ...payload,
    accountId: target.accountId,
    ...(target.projectId !== undefined && { projectId: target.projectId }),
    ...(target.episodeId !== undefined && { episodeId: target.episodeId }),
  };
}

/**
 * Check if we're in a Lambda environment where SQS is available
 */
export function isLambdaEnvironment(): boolean {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!getQueueUrl();
}
