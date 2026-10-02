import { expect, test } from '@playwright/test';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { sourceStamp } from '../../../vendor-sandbox/src/version';
import { sandboxFreshnessProblem } from '../utils/sandbox-freshness';

/**
 * The refusal `sandboxRun()` makes before any sandbox-backed spec, against
 * stand-in control ports: no sandbox, browser or app is needed, so this runs
 * wherever the suite does. The real route is covered in
 * apps/vendor-sandbox/__tests__/version.test.ts.
 */

const CHECKOUT = resolve(__dirname, '../../../..');
const servers: Server[] = [];

async function control(version: unknown) {
  const server = createServer((req, res) => {
    if (req.url === '/__sandbox/version' && version !== undefined) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(version));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `no such control route: GET ${req.url}` }));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test.afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise((done) => server.close(done))),
  );
});

test.describe('sandbox freshness', () => {
  const stamp = sourceStamp(CHECKOUT);
  const started = { pid: 4242, startedAt: '2026-10-02T01:00:00.000Z' };

  test('a sandbox started from this checkout is accepted', async () => {
    const url = await control({ ...stamp, ...started });

    expect(await sandboxFreshnessProblem(url)).toBeNull();
  });

  test('a sandbox started from older source is refused, naming the file', async () => {
    const edited = 'apps/vendor-sandbox/src/social/vendors/meta/insights.ts';
    const url = await control({
      ...stamp,
      ...started,
      digest: 'older',
      root: '/elsewhere/storybook',
      files: { ...stamp.files, [edited]: 'older' },
    });

    expect(await sandboxFreshnessProblem(url)).toBe(
      `The vendor sandbox on ${url} was started at 2026-10-02T01:00:00.000Z from source that differs from this tree's (1 file: ${edited}). ` +
        `Restart the sandbox from this worktree: stop the one on ${url} (pid 4242, started from /elsewhere/storybook); ` +
        `then: cd ${CHECKOUT}/apps/vendor-sandbox && SANDBOX_PORT_BASE=${new URL(url).port} pnpm start.`,
    );
  });

  test('a sandbox with no version route is refused as older than the route', async () => {
    const url = await control(undefined);

    expect(await sandboxFreshnessProblem(url)).toBe(
      `The vendor sandbox on ${url} has no /__sandbox/version, so it was started from source older than this tree. ` +
        `Restart the sandbox from this worktree: stop the one on ${url}; ` +
        `then: cd ${CHECKOUT}/apps/vendor-sandbox && SANDBOX_PORT_BASE=${new URL(url).port} pnpm start.`,
    );
  });
});
