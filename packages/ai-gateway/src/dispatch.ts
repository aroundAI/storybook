/**
 * The LLM jobs queue, private to the gateway (FILM-1903): the only way onto
 * it is `run.dispatch()`, and the message is `{ runId }`. The worker loads
 * the run and runs what it says; nothing else about the work travels.
 * Moved from @kit/prompt-engine's sqs-helper, whose `queueLlmJob` sent
 * `{ jobType, userId, payload }` and could be called from anywhere.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import type { RunHandle } from '@kit/generation';
import { awsClientOptions, queueUrlFromEnv } from '@kit/shared/vendors';

let sqs: SQSClient | undefined;

function client() {
  sqs ??= new SQSClient(awsClientOptions('sqs'));
  return sqs;
}

/**
 * The queue URL: the SST resource binding in production, the environment
 * variable elsewhere.
 */
export function getQueueUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require('sst');
    if (Resource?.StorybookLlmJobsQueue?.url) {
      return Resource.StorybookLlmJobsQueue.url;
    }
  } catch {
    // Resource not available - not in SST environment
  }

  return queueUrlFromEnv(process.env.LLM_JOBS_QUEUE_URL) ?? '';
}

/** The message the worker receives. */
export interface RunMessage {
  runId: string;
}

export function runMessage(run: RunHandle): RunMessage {
  return { runId: run.id };
}

/**
 * Sends the run to the worker. Not exported from the package: the run
 * handle calls it through the gateway backend, after its own checks.
 */
export async function sendRunMessage(
  run: RunHandle,
  deps: { send?: (command: SendMessageCommand) => Promise<unknown> } = {},
): Promise<void> {
  const queueUrl = getQueueUrl();

  if (!queueUrl) {
    throw new Error(
      'LLM_JOBS_QUEUE_URL not configured. Ensure the queue is linked in sst.config.ts',
    );
  }

  console.log(`[SQS] Queuing ${run.stage} run ${run.id.substring(0, 8)}...`);

  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(runMessage(run)),
    MessageAttributes: {
      stage: { DataType: 'String', StringValue: run.stage },
    },
  });

  await (deps.send ?? ((c) => client().send(c)))(command);

  console.log(`[SQS] Run queued successfully`);
}

/** Whether the queue can be reached from here: Lambda, or a configured URL. */
export function isLambdaEnvironment(): boolean {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!getQueueUrl();
}
