import { describe, expect, it } from 'vitest';

import { collectNodeResponse, toNodeRequest } from '../src/server/node-adapter';

describe('toNodeRequest', () => {
  it('carries method, path, query and lowercased headers, and streams the body', async () => {
    const request = new Request('https://app.test/api/mcp?x=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const req = toNodeRequest(request, '{"a":1}');

    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/mcp?x=1');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers.accept).toBe('application/json');

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('{"a":1}');
  });
});

describe('collectNodeResponse', () => {
  it('resolves a Response from writeHead().end(body), as the SDK writes JSON mode', async () => {
    const { res, response } = collectNodeResponse();

    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end('{"ok":true}');

    const out = await response;
    expect(out.status).toBe(200);
    expect(out.headers.get('content-type')).toBe('application/json');
    expect(await out.json()).toEqual({ ok: true });
  });

  it('handles a bodyless 202 and chained writes', async () => {
    const a = collectNodeResponse();
    a.res.writeHead(202).end();
    const accepted = await a.response;
    expect(accepted.status).toBe(202);
    expect(await accepted.text()).toBe('');

    const b = collectNodeResponse();
    b.res.setHeader('X-One', '1');
    b.res.write('ab');
    b.res.write(Buffer.from('cd'));
    b.res.end('ef');
    const chained = await b.response;
    expect(chained.headers.get('x-one')).toBe('1');
    expect(await chained.text()).toBe('abcdef');
  });

  it('emits close on end and tracks headersSent', async () => {
    const { res, response } = collectNodeResponse();
    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    expect(res.headersSent).toBe(false);
    res.writeHead(405, { Allow: 'POST' });
    expect(res.headersSent).toBe(true);
    res.end('{}');

    await response;
    expect(closed).toBe(true);
    expect(res.writableEnded).toBe(true);
  });
});
