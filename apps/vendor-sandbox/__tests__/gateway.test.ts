import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { type Gateway, startGateway } from '../src/queue/gateway';

/**
 * FILM-1806: the local WebSocket gateway. It hands every event to the
 * handlers it is given - in the runner, apps/web/websocket's own - and answers
 * the Management API as the real AWS SDK client calls it. Only the transport
 * is exercised here; the handlers' own behaviour is theirs.
 */

let gateway: Gateway | undefined;

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

function events() {
  const log: Array<{ route: string; event: Record<string, unknown> }> = [];
  const record =
    (route: string, statusCode = 200) =>
    async (event: Record<string, unknown>) => {
      log.push({ route, event });
      return { statusCode };
    };
  return { log, record };
}

function open(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`refused: ${res.statusCode}`)),
    );
  });
}

const sdk = (endpoint: string) =>
  new ApiGatewayManagementApiClient({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'sandbox', secretAccessKey: 'sandbox' },
  });

describe('the local WebSocket gateway', () => {
  it('passes $connect the token as API Gateway does, and pushes what the Management API posts', async () => {
    const { log, record } = events();
    gateway = await startGateway(
      {
        connect: record('$connect'),
        default: record('$default'),
        disconnect: record('$disconnect'),
      },
      0,
    );

    const ws = await open(`ws://127.0.0.1:${gateway.port}?token=local-jwt`);
    const connect = log.find((e) => e.route === '$connect')!.event as {
      requestContext: { connectionId: string; routeKey: string };
      queryStringParameters: { token: string };
    };
    expect(connect.queryStringParameters.token).toBe('local-jwt');
    expect(connect.requestContext.routeKey).toBe('$connect');

    const received = new Promise<string>((resolve) =>
      ws.once('message', (data) => resolve(data.toString())),
    );
    await sdk(gateway.url).send(
      new PostToConnectionCommand({
        ConnectionId: connect.requestContext.connectionId,
        Data: JSON.stringify({ type: 'llm-result', jobType: 'story-ideation' }),
      }),
    );
    expect(JSON.parse(await received)).toEqual({
      type: 'llm-result',
      jobType: 'story-ideation',
    });
    ws.close();
  });

  it('routes a message to $default and a close to $disconnect', async () => {
    const { log, record } = events();
    gateway = await startGateway(
      {
        connect: record('$connect'),
        default: record('$default'),
        disconnect: record('$disconnect'),
      },
      0,
    );
    const ws = await open(`ws://127.0.0.1:${gateway.port}?token=t`);

    ws.send('{"action":"ping"}');
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(log.map((e) => e.route)).toEqual([
      '$connect',
      '$default',
      '$disconnect',
    ]);
    expect(log[1]!.event.body).toBe('{"action":"ping"}');
  });

  it('refuses the connection when $connect does', async () => {
    const { record } = events();
    gateway = await startGateway(
      {
        connect: record('$connect', 401),
        default: record('$default'),
        disconnect: record('$disconnect'),
      },
      0,
    );
    await expect(
      open(`ws://127.0.0.1:${gateway.port}?token=bad`),
    ).rejects.toThrow(/401/);
  });

  it('answers a post to a gone connection with 410, as API Gateway does', async () => {
    const { record } = events();
    gateway = await startGateway(
      {
        connect: record('$connect'),
        default: record('$default'),
        disconnect: record('$disconnect'),
      },
      0,
    );
    await expect(
      sdk(gateway.url).send(
        new PostToConnectionCommand({ ConnectionId: 'long-gone', Data: '{}' }),
      ),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 410 } });
  });
});
