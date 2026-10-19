import type { PublishJobMessage } from '../src/lib/job-types';

/**
 * KB-206: a publish made now goes to the publish worker's queue, not to the
 * platform. A test mocks `@aws-sdk/client-sqs` with this module and reads
 * what the action sent from `sentJobs`; set `PUBLISH_QUEUE_URL` in a
 * `vi.hoisted` block, since the action reads it when it loads.
 */
export const QUEUE_URL =
  'https://sqs.us-east-1.amazonaws.com/000000000000/publish';

export const sentJobs: PublishJobMessage[] = [];

export const queue = {
  /** The error the queue answers this job with, if it refuses it */
  refuse: null as ((job: PublishJobMessage) => Error | undefined) | null,
};

export class SQSClient {
  async send(command: SendMessageCommand) {
    const job: PublishJobMessage = JSON.parse(command.input.MessageBody);
    const refusal = queue.refuse?.(job);
    if (refusal) throw refusal;
    sentJobs.push(job);
    return {};
  }
}

export class SendMessageCommand {
  constructor(readonly input: { QueueUrl: string; MessageBody: string }) {}
}

export function resetQueue() {
  sentJobs.length = 0;
  queue.refuse = null;
}
