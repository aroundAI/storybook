import 'server-only';

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

/**
 * The SDK's `StreamableHTTPServerTransport` (1.18.0) speaks Node's
 * `IncomingMessage` and `ServerResponse`; a Next.js route handler has a Web
 * `Request` and returns a Web `Response`. This bridges the two for the
 * stateless, JSON-response mode the endpoint uses: the transport writes a
 * status, headers and one body, and `end()` resolves the `Response`.
 *
 * Not a general adapter: SSE streaming (`flushHeaders` followed by many
 * `write`s with no `end`) would never resolve, and the endpoint does not
 * enable it.
 */
export function toNodeRequest(request: Request, body: string): IncomingMessage {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};

  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const stream = Readable.from([Buffer.from(body, 'utf8')]);

  return Object.assign(stream, {
    headers,
    method: request.method,
    url: `${url.pathname}${url.search}`,
    httpVersion: '1.1',
    socket: null,
  }) as unknown as IncomingMessage;
}

export interface CollectedResponse {
  res: ServerResponse;
  /** Resolves when the transport calls `end()`. */
  response: Promise<Response>;
}

export function collectNodeResponse(): CollectedResponse {
  const emitter = new EventEmitter();
  const chunks: Buffer[] = [];
  const headers = new Headers();
  let statusCode = 200;
  let headersSent = false;
  let ended = false;
  let resolve!: (response: Response) => void;

  const response = new Promise<Response>((done) => {
    resolve = done;
  });

  const toBuffer = (chunk: unknown) =>
    typeof chunk === 'string'
      ? Buffer.from(chunk, 'utf8')
      : Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : null;

  const setHeaders = (incoming?: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(incoming ?? {})) {
      if (value === undefined) continue;
      headers.set(
        key,
        Array.isArray(value) ? value.join(', ') : String(value),
      );
    }
  };

  const res = Object.assign(emitter, {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    get headersSent() {
      return headersSent;
    },
    get writableEnded() {
      return ended;
    },
    writeHead(code: number, maybeHeaders?: unknown, more?: unknown) {
      statusCode = code;
      const given = typeof maybeHeaders === 'string' ? more : maybeHeaders;
      setHeaders(given as Record<string, unknown> | undefined);
      headersSent = true;
      return res;
    },
    setHeader(name: string, value: unknown) {
      setHeaders({ [name]: value });
      return res;
    },
    getHeader(name: string) {
      return headers.get(name) ?? undefined;
    },
    getHeaders() {
      return Object.fromEntries(headers.entries());
    },
    hasHeader(name: string) {
      return headers.has(name);
    },
    removeHeader(name: string) {
      headers.delete(name);
    },
    flushHeaders() {
      headersSent = true;
    },
    write(chunk: unknown) {
      const buffer = toBuffer(chunk);
      if (buffer) chunks.push(buffer);
      return true;
    },
    end(chunk?: unknown) {
      if (ended) return res;
      ended = true;
      const buffer = toBuffer(chunk);
      if (buffer) chunks.push(buffer);
      headersSent = true;

      const body = Buffer.concat(chunks);
      const bodyless = statusCode === 204 || statusCode === 304 || body.length === 0;

      resolve(
        new Response(bodyless ? null : new Uint8Array(body), {
          status: statusCode,
          headers,
        }),
      );
      emitter.emit('finish');
      emitter.emit('close');
      return res;
    },
  });

  return { res: res as unknown as ServerResponse, response };
}
