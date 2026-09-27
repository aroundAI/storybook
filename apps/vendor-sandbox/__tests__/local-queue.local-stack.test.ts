import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPoller } from '../src/queue/poller';

/**
 * FILM-1806: the runner against the real ElasticMQ that local-env.sh starts
 * (127.0.0.1:4120). A message a handler finishes is deleted; one it fails is
 * left, redelivered after its visibility timeout, and moved to the dead-letter
 * queue by the queue's own redrive policy after its last receive. Nothing is
 * retried forever.
 *
 *   LOCAL_QUEUE_STACK=1 pnpm --filter vendor-sandbox test local-queue
 */

const ENDPOINT = process.env.LOCAL_QUEUE_ENDPOINT ?? 'http://127.0.0.1:4120';
const client = new SQSClient({
  endpoint: ENDPOINT,
  region: 'us-east-1',
  credentials: { accessKeyId: 'sandbox', secretAccessKey: 'sandbox' },
});

const stamp = Date.now();
const QUEUE = `film1806-test-${stamp}`;
const DLQ = `film1806-test-dlq-${stamp}`;
let queueUrl = '';
let dlqUrl = '';

async function count(url: string) {
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return Number(Attributes?.ApproximateNumberOfMessages ?? 0) + Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
}

async function until(check: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('condition not met in time');
}

describe.skipIf(!process.env.LOCAL_QUEUE_STACK)('the local job queue runner, against ElasticMQ', () => {
  beforeAll(async () => {
    dlqUrl = (await client.send(new CreateQueueCommand({ QueueName: DLQ }))).QueueUrl!;
    const dlqArn = (
      await client.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }))
    ).Attributes!.QueueArn!;
    queueUrl = (
      await client.send(
        new CreateQueueCommand({
          QueueName: QUEUE,
          Attributes: {
            VisibilityTimeout: '1',
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
          },
        }),
      )
    ).QueueUrl!;
  });

  afterAll(async () => {
    await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    await client.send(new DeleteQueueCommand({ QueueUrl: dlqUrl }));
  });

  it('hands the handler an SQS event and deletes what it finishes', async () => {
    const seen: string[] = [];
    const poller = startPoller({
      client,
      queueName: QUEUE,
      region: 'us-east-1',
      batchSize: 10,
      waitSeconds: 1,
      handler: async () => async (event) => {
        for (const record of event.Records as Array<{ body: string; eventSource: string }>) {
          expect(record.eventSource).toBe('aws:sqs');
          seen.push(record.body);
        }
        return { batchItemFailures: [] };
      },
    });

    await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: '{"jobType":"story-ideation"}' }));
    await until(async () => seen.length === 1 && (await count(queueUrl)) === 0);
    await poller.stop();

    expect(seen).toEqual(['{"jobType":"story-ideation"}']);
  });

  it('leaves a failed message for redelivery, then the dead-letter queue takes it', async () => {
    let receives = 0;
    const poller = startPoller({
      client,
      queueName: QUEUE,
      region: 'us-east-1',
      batchSize: 1,
      waitSeconds: 1,
      handler: async () => async (event) => {
        receives += 1;
        const [record] = event.Records as Array<{ messageId: string }>;
        return { batchItemFailures: [{ itemIdentifier: record!.messageId }] };
      },
    });

    await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: '{"jobType":"doomed"}' }));
    await until(async () => (await count(dlqUrl)) === 1, 30_000);
    await poller.stop();

    expect(receives).toBe(3);
    const { Messages = [] } = await client.send(new ReceiveMessageCommand({ QueueUrl: dlqUrl, WaitTimeSeconds: 1 }));
    expect(Messages[0]?.Body).toBe('{"jobType":"doomed"}');
  });

  it('matches production: the local queues carry the visibility timeouts and redrive of sst.config.ts', async () => {
    const expected = {
      StorybookLlmJobsQueue: ['900', 'StorybookLlmJobsDLQ'],
      StorybookVoiceQueue: ['300', 'StorybookVoiceDLQ'],
      StorybookPublishQueue: ['300', 'StorybookPublishDLQ'],
    };
    for (const [name, [visibility, dlq]] of Object.entries(expected)) {
      const url = `${ENDPOINT}/000000000000/${name}`;
      const { Attributes } = await client.send(
        new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['VisibilityTimeout', 'RedrivePolicy'] }),
      );
      expect(Attributes?.VisibilityTimeout, name).toBe(visibility);
      const redrive = JSON.parse(Attributes?.RedrivePolicy ?? '{}') as { deadLetterTargetArn?: string; maxReceiveCount?: number };
      expect(redrive.deadLetterTargetArn, name).toContain(dlq);
      expect(Number(redrive.maxReceiveCount), name).toBe(3);
    }
  });
});
