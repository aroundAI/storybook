'use server';

import 'server-only';

import {
  SQSClient,
  SendMessageBatchCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

// Initialize SQS client
const sqs = new SQSClient({});

/**
 * Get queue URL from SST Resource or environment variable
 * SST v3 provides linked resources via the Resource object
 */
function getVoiceQueueUrl(): string {
  // Try SST Resource binding first (production)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require('sst');
    if (Resource?.StorybookVoiceQueue?.url) {
      return Resource.StorybookVoiceQueue.url;
    }
  } catch {
    // Resource not available - not in SST environment
  }

  // Fall back to environment variable
  return process.env.VOICE_QUEUE_URL || '';
}

/**
 * Voice job message structure
 */
export interface VoiceJobMessage {
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
 * Queue a single voice generation job
 *
 * @param params - Voice job parameters
 * @returns Promise that resolves when message is queued
 *
 * @example
 * ```typescript
 * await queueVoiceJob({
 *   dialogueLineId: 'uuid',
 *   batchJobId: null,
 *   episodeId: 'uuid',
 *   accountId: 'uuid',
 *   voiceId: 'voice-id',
 *   ttsModel: 'eleven_multilingual_v2',
 *   voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
 *   text: 'Hello world',
 *   userId: 'uuid',
 *   overwriteExisting: false,
 * });
 * ```
 */
export async function queueVoiceJob(params: VoiceJobMessage): Promise<void> {
  const queueUrl = getVoiceQueueUrl();

  if (!queueUrl) {
    throw new Error(
      'VOICE_QUEUE_URL not configured. Ensure the queue is linked in sst.config.ts',
    );
  }

  console.log(`[SQS] Queuing voice job for dialogue ${params.dialogueLineId}`);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(params),
      MessageAttributes: {
        jobType: {
          DataType: 'String',
          StringValue: 'voice-generation',
        },
      },
    }),
  );

  console.log(`[SQS] Voice job queued successfully`);
}

/**
 * Queue multiple voice generation jobs efficiently (batches of 10)
 *
 * SQS SendMessageBatch supports up to 10 messages per request.
 * This function automatically chunks jobs into groups of 10.
 *
 * @param jobs - Array of voice job parameters
 * @returns Promise that resolves when all messages are queued
 */
export async function queueVoiceJobs(jobs: VoiceJobMessage[]): Promise<void> {
  const queueUrl = getVoiceQueueUrl();

  if (!queueUrl) {
    throw new Error(
      'VOICE_QUEUE_URL not configured. Ensure the queue is linked in sst.config.ts',
    );
  }

  console.log(`[SQS] Queuing ${jobs.length} voice jobs`);

  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);

    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((job, idx) => ({
          Id: `${i + idx}`,
          MessageBody: JSON.stringify(job),
          MessageAttributes: {
            jobType: {
              DataType: 'String',
              StringValue: 'voice-generation',
            },
          },
        })),
      }),
    );
  }

  console.log(`[SQS] All ${jobs.length} voice jobs queued`);
}
