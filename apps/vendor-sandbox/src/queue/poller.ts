import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';

/**
 * Feeds one SQS queue to one Lambda handler, the way the SQS event source
 * does (FILM-1806): long-poll, hand the handler an SQS event, delete what it
 * reports as done, and leave the rest - so a failed message is redelivered
 * after its visibility timeout and moved to the dead-letter queue by the
 * queue's own redrive policy. Nothing here retries on its own.
 */

export interface SqsBatchResponse {
  batchItemFailures?: Array<{ itemIdentifier: string }>;
}

export type SqsHandler = (event: { Records: unknown[] }) => Promise<SqsBatchResponse | void>;

export interface PollerOptions {
  client: SQSClient;
  queueName: string;
  handler: () => Promise<SqsHandler>;
  batchSize: number;
  region: string;
  /** Called after each batch, for logs and tests. */
  onBatch?: (summary: { queueName: string; received: number; deleted: number; failed: string[] }) => void;
  waitSeconds?: number;
}

function toRecord(message: Message, queueName: string, region: string) {
  return {
    messageId: message.MessageId,
    receiptHandle: message.ReceiptHandle,
    body: message.Body ?? '',
    attributes: message.Attributes ?? {},
    messageAttributes: Object.fromEntries(
      Object.entries(message.MessageAttributes ?? {}).map(([name, value]) => [
        name,
        { stringValue: value.StringValue, dataType: value.DataType, stringListValues: [], binaryListValues: [] },
      ]),
    ),
    md5OfBody: message.MD5OfBody,
    eventSource: 'aws:sqs',
    eventSourceARN: `arn:aws:sqs:${region}:000000000000:${queueName}`,
    awsRegion: region,
  };
}

export function startPoller(options: PollerOptions) {
  let running = true;
  let queueUrl: string | undefined;

  const loop = async () => {
    while (running) {
      try {
        queueUrl ??= (await options.client.send(new GetQueueUrlCommand({ QueueName: options.queueName }))).QueueUrl;

        const { Messages = [] } = await options.client.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: options.batchSize,
            WaitTimeSeconds: options.waitSeconds ?? 20,
            MessageAttributeNames: ['All'],
            MessageSystemAttributeNames: ['All'],
          }),
        );
        if (!running || Messages.length === 0) continue;

        const handler = await options.handler();
        let failed: string[];
        try {
          const response = await handler({ Records: Messages.map((m) => toRecord(m, options.queueName, options.region)) });
          failed = (response?.batchItemFailures ?? []).map((f) => f.itemIdentifier);
        } catch (error) {
          // A handler that throws fails the whole batch, as in Lambda.
          console.error(`[local-workers] ${options.queueName} handler threw:`, error);
          failed = Messages.map((m) => m.MessageId ?? '');
        }

        const done = Messages.filter((m) => !failed.includes(m.MessageId ?? ''));
        for (const message of done) {
          await options.client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
        }
        if (failed.length > 0) {
          console.warn(
            `[local-workers] ${options.queueName}: ${failed.length} message(s) failed; left for redelivery (then the DLQ)`,
          );
        }
        options.onBatch?.({ queueName: options.queueName, received: Messages.length, deleted: done.length, failed });
      } catch (error) {
        if (!running) break;
        console.error(`[local-workers] ${options.queueName} poll failed:`, error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };

  const done = loop();
  return {
    stop: async () => {
      running = false;
      await done;
    },
  };
}
