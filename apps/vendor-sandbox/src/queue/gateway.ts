import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { type WebSocket, WebSocketServer } from 'ws';

import { HOST, readBody } from '../http';

/**
 * A local stand-in for the API Gateway WebSocket API (FILM-1806). The browser
 * connects here exactly as it connects to API Gateway, and each event is
 * handed to the app's own handlers in apps/web/websocket - $connect checks the
 * token, $default handles messages, $disconnect cleans up - so the local path
 * runs the code production does. Only the transport is local: the Management
 * API's `POST /@connections/{id}`, which the workers use to push a result, is
 * answered here by writing to that socket.
 */

type Handler = (event: Record<string, unknown>) => Promise<{ statusCode?: number } | undefined | void>;

export interface WebSocketHandlers {
  connect: Handler;
  disconnect: Handler;
  default: Handler;
}

export interface Gateway {
  url: string;
  port: number;
  /** Open connections, by connection id. */
  connections: Map<string, WebSocket>;
  close(): Promise<void>;
}

const STAGE = 'local';

function requestContext(connectionId: string, routeKey: string, port: number) {
  return {
    connectionId,
    routeKey,
    eventType: routeKey === '$connect' ? 'CONNECT' : routeKey === '$disconnect' ? 'DISCONNECT' : 'MESSAGE',
    domainName: `127.0.0.1:${port}`,
    stage: STAGE,
    apiId: 'local',
    requestId: randomUUID(),
    requestTimeEpoch: Date.now(),
    connectedAt: Date.now(),
  };
}

export async function startGateway(handlers: WebSocketHandlers, port: number): Promise<Gateway> {
  const connections = new Map<string, WebSocket>();
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  let boundPort = port;

  // The Management API, as the AWS SDK calls it: POST /@connections/{id}
  // (DELETE and GET exist too; the app uses POST only).
  server.on('request', (req, res) => {
    void readBody(req).then((body) => {
      const match = /^\/(?:[^/]+\/)?@connections\/([^/?]+)/.exec(req.url ?? '');
      const socket = match ? connections.get(decodeURIComponent(match[1]!)) : undefined;
      if (!match || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      if (!socket) {
        res.writeHead(410, { 'content-type': 'application/json', 'x-amzn-errortype': 'GoneException' });
        res.end(JSON.stringify({ message: 'Gone' }));
        return;
      }
      socket.send(body.toString('utf8'));
      res.writeHead(200).end();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const connectionId = randomUUID().replaceAll('-', '').slice(0, 16);
    const event = {
      requestContext: requestContext(connectionId, '$connect', boundPort),
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])),
      queryStringParameters: Object.fromEntries(url.searchParams),
      isBase64Encoded: false,
    };

    handlers
      .connect(event)
      .then((result) => {
        if ((result?.statusCode ?? 200) !== 200) {
          socket.write(`HTTP/1.1 ${result?.statusCode ?? 401} Unauthorized\r\n\r\n`);
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          connections.set(connectionId, ws);
          ws.on('message', (data) => {
            void handlers.default({
              requestContext: requestContext(connectionId, '$default', boundPort),
              body: data.toString(),
              isBase64Encoded: false,
            });
          });
          ws.on('close', () => {
            connections.delete(connectionId);
            void handlers.disconnect({
              requestContext: requestContext(connectionId, '$disconnect', boundPort),
              isBase64Encoded: false,
            });
          });
        });
      })
      .catch((error: unknown) => {
        console.error('[local-gateway] $connect failed:', error);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      });
  });

  await new Promise<void>((resolve) => server.listen(port, HOST, resolve));
  boundPort = (server.address() as AddressInfo).port;

  return {
    url: `http://${HOST}:${boundPort}`,
    port: boundPort,
    connections,
    close: () =>
      new Promise((resolve) => {
        for (const ws of connections.values()) ws.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
