import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The sandbox binds loopback and nothing else: it is a stand-in for vendors
 * on this machine, never a service on a network.
 */
export const HOST = '127.0.0.1';

export type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
) => Promise<void> | void;

export async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  value: unknown,
) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
  return body;
}

export function parseJson(body: Buffer): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

export async function listen(handler: Handler, port: number) {
  const server = http.createServer((req, res) => {
    readBody(req)
      .then((body) => handler(req, res, body))
      .catch((error: unknown) => {
        console.error('[sandbox] handler failed:', error);
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: {
              code: 500,
              message: 'vendor-sandbox internal error',
              status: 'INTERNAL',
            },
          });
        } else {
          res.end();
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  if (address.address !== HOST) {
    server.close();
    throw new Error(
      `vendor-sandbox bound ${address.address}; it must bind ${HOST} only`,
    );
  }

  return server;
}

export function urlOf(server: http.Server) {
  const { address, port } = server.address() as AddressInfo;
  return `http://${address}:${port}`;
}
