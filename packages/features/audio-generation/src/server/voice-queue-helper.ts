import 'server-only';

import {
  SQSClient,
  SendMessageBatchCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

import type { LlmJobTarget } from '@kit/prompt-engine/llm-job-target';
import { awsClientOptions, queueUrlFromEnv } from '@kit/shared/vendors';

import {
  type DubEpisodeMessageInput,
  DubEpisodeMessageSchema,
} from '../lib/dub-episode';

// Initialize SQS client
const sqs = new SQSClient(awsClientOptions('sqs'));

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
  return queueUrlFromEnv(process.env.VOICE_QUEUE_URL) ?? '';
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
 * A voice job as its producer describes it. The account is not part of it:
 * it comes from the target (KB-46, KB-47).
 */
export type VoiceJob = Omit<VoiceJobMessage, 'accountId'>;

/**
 * The message as sent: billed to the target's account, and only for the
 * target's episode.
 *
 * The voice worker runs on the service-role key. It decrypts the message's
 * account's ElevenLabs key and writes audio onto the message's line, so the
 * target — from `authorizeEpisodeTarget`, which asks `can_write_project` as
 * the caller — is the only check between a caller and what it spends and
 * writes. A job naming a different episode is a programming error, thrown
 * before anything is sent.
 */
export function voiceMessageForTarget(
  target: LlmJobTarget,
  job: VoiceJob,
): VoiceJobMessage {
  if (!target.episodeId || job.episodeId !== target.episodeId) {
    throw new Error(
      `Voice job for episode ${job.episodeId} does not match its authorised target`,
    );
  }

  return { ...job, accountId: target.accountId };
}

/**
 * Queue a single voice generation job
 *
 * @example
 * ```typescript
 * const target = await authorizeEpisodeTarget(client, episodeId);
 * if (!target) throw new ActionRefusal('Dialogue line not found');
 * await queueVoiceJob(target, {
 *   dialogueLineId: 'uuid',
 *   batchJobId: null,
 *   episodeId,
 *   voiceId: 'voice-id',
 *   ttsModel: 'eleven_multilingual_v2',
 *   voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
 *   text: 'Hello world',
 *   userId: 'uuid',
 *   overwriteExisting: false,
 * });
 * ```
 */
export async function queueVoiceJob(
  target: LlmJobTarget,
  job: VoiceJob,
): Promise<void> {
  const params = voiceMessageForTarget(target, job);
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
 * Every job must be for the target's episode.
 *
 * @param target - The authorised episode, from `authorizeEpisodeTarget`
 * @param voiceJobs - Array of voice job parameters
 * @returns Promise that resolves when all messages are queued
 */
export async function queueVoiceJobs(
  target: LlmJobTarget,
  voiceJobs: VoiceJob[],
): Promise<void> {
  const jobs = voiceJobs.map((job) => voiceMessageForTarget(target, job));
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

/**
 * Queue one `dub-episode` job per language (FILM-2007). Each message is
 * billed to the target's account and names only the target's episode, as a
 * voice job does; `delaySeconds` holds back a language whose translation
 * has only just been queued.
 */
export async function queueDubEpisodeJobs(
  target: LlmJobTarget,
  jobs: Array<{ message: DubEpisodeMessageInput; delaySeconds: number }>,
): Promise<void> {
  const queueUrl = getVoiceQueueUrl();

  if (!queueUrl) {
    throw new Error(
      'VOICE_QUEUE_URL not configured. Ensure the queue is linked in sst.config.ts',
    );
  }

  for (const { message, delaySeconds } of jobs) {
    if (
      !target.episodeId ||
      message.episodeId !== target.episodeId ||
      message.accountId !== target.accountId
    ) {
      throw new Error(
        `Dub job for episode ${message.episodeId} does not match its authorised target`,
      );
    }

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(DubEpisodeMessageSchema.parse(message)),
        DelaySeconds: delaySeconds,
        MessageAttributes: {
          jobType: { DataType: 'String', StringValue: 'dub-episode' },
        },
      }),
    );
  }

  console.log(`[SQS] ${jobs.length} dub-episode job(s) queued`);
}
