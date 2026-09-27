import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';

import { awsClientOptions, vendorSandboxEnabled } from '@kit/shared/vendors';

import { startGateway } from './gateway';
import { type SqsHandler, startPoller } from './poller';

/**
 * The local job queue (FILM-1806): runs the app's own workers against the
 * local queue emulator, so the studio stages - enqueued in production - run
 * on a laptop. Started by `./scripts/local-env.sh up`, beside the AI sandbox,
 * with local.env's environment. Everything it reaches is loopback: run it with
 * the egress guard preloaded, and a worker that tried a real vendor would be
 * refused.
 *
 *   - StorybookLlmJobsQueue  → apps/web/lambda/llm-worker    (batch 10)
 *   - StorybookVoiceQueue    → apps/web/lambda/voice-worker  (batch 1)
 *   - StorybookPublishQueue  → apps/web/lambda/publish-worker (batch 10)
 *   - every 5 minutes        → apps/web/lambda/scheduled-publish
 *   - ws://127.0.0.1:4121    → apps/web/websocket ($connect, $default, $disconnect)
 */

const REGION = process.env.AWS_REGION || 'us-east-1';

async function ensureConnectionsTable(ddb: DynamoDBClient, table: string) {
  try {
    await ddb.send(new DescribeTableCommand({ TableName: table }));
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }
  // As sst.config.ts declares it: hash key connectionId, GSI userIdIndex.
  await ddb.send(
    new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [
        { AttributeName: 'connectionId', AttributeType: 'S' },
        { AttributeName: 'userId', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'connectionId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'userIdIndex',
          KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
}

/**
 * Loaded once, on first use. The paths are literal so that esbuild bundles
 * the workers as SST does - the runner is built with it before it starts
 * (see start_local_queue), which is also what makes the app's ESM files and
 * its CommonJS packages load together.
 */
function once<E>(
  load: () => Promise<{ handler: (event: E) => Promise<unknown> }>,
) {
  let loaded: Promise<SqsHandler> | undefined;
  // The runner hands each worker an SQS event of the shape Lambda does.
  return () =>
    (loaded ??= load().then((m) => m.handler as unknown as SqsHandler));
}

const llmWorker = once(() => import('../../../web/lambda/llm-worker/index'));
const voiceWorker = once(
  () => import('../../../web/lambda/voice-worker/index'),
);
const publishWorker = once(
  () => import('../../../web/lambda/publish-worker/index'),
);

async function main() {
  if (!vendorSandboxEnabled()) {
    throw new Error(
      'The local job queue runs only in the sandbox: NODE_ENV=development or test, VENDOR_SANDBOX=1, outside a Lambda. Load local.env first.',
    );
  }
  const sqsOptions = awsClientOptions('sqs');
  const ddbOptions = awsClientOptions('dynamodb');
  if (!sqsOptions.endpoint || !ddbOptions.endpoint) {
    throw new Error(
      'VENDOR_URL_SQS and VENDOR_URL_DYNAMODB must name the local emulators (see local.env).',
    );
  }

  const table = process.env.CONNECTIONS_TABLE_NAME;
  if (!table)
    throw new Error('CONNECTIONS_TABLE_NAME is not set (see local.env).');
  await ensureConnectionsTable(new DynamoDBClient(ddbOptions), table);

  const ws = await import('../../../web/websocket/connect');
  const wsDefault = await import('../../../web/websocket/default');
  const wsDisconnect = await import('../../../web/websocket/disconnect');
  const gateway = await startGateway(
    {
      connect: ws.handler as never,
      default: wsDefault.handler as never,
      disconnect: wsDisconnect.handler as never,
    },
    Number(process.env.LOCAL_GATEWAY_PORT || 4121),
  );

  const client = new SQSClient(sqsOptions);
  const pollers = [
    startPoller({
      client,
      queueName: 'StorybookLlmJobsQueue',
      handler: llmWorker,
      batchSize: 10,
      region: REGION,
    }),
    startPoller({
      client,
      queueName: 'StorybookVoiceQueue',
      handler: voiceWorker,
      batchSize: 1,
      region: REGION,
    }),
    startPoller({
      client,
      queueName: 'StorybookPublishQueue',
      handler: publishWorker,
      batchSize: 10,
      region: REGION,
    }),
  ];

  const scheduled = setInterval(() => {
    import('../../../web/lambda/scheduled-publish/index')
      .then((m) => m.handler())
      .catch((error: unknown) =>
        console.error('[local-workers] scheduled-publish failed:', error),
      );
  }, 5 * 60_000);

  console.log(
    `[local-workers] ready: 3 queues on ${sqsOptions.endpoint}, WebSocket gateway on ws://127.0.0.1:${gateway.port}, scheduled publish every 5 minutes`,
  );

  const stop = () => {
    clearInterval(scheduled);
    void Promise.all([...pollers.map((p) => p.stop()), gateway.close()]).then(
      () => process.exit(0),
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(
    '[local-workers] failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
