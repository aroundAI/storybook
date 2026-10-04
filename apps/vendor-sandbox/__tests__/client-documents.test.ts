import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Sandbox, startSandbox } from './helpers';

/**
 * The MCP OAuth server's client metadata documents (FILM-1911, KB-185),
 * served from the copies committed with the studio-mcp tests, so a local
 * E2E run signs in as Claude and ChatGPT without reaching either vendor.
 */
const FIXTURES = resolve(
  __dirname,
  '../../../packages/features/studio-mcp/__tests__/oauth/fixtures',
);

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await startSandbox(7);
});

afterAll(async () => {
  await sandbox.close();
});

const documentFor = (clientId: string) =>
  fetch(
    `${sandbox.urls.control}/__sandbox/client-documents/${encodeURIComponent(clientId)}`,
  );

describe('client documents', () => {
  it.each([
    [
      'https://claude.ai/oauth/mcp-oauth-client-metadata',
      'claude-client-metadata.2026-10-04.json',
    ],
    [
      'https://chatgpt.com/oauth/client.json',
      'chatgpt-client-metadata.2026-10-04.json',
    ],
  ])('serves %s byte for byte from %s', async (clientId, file) => {
    const response = await documentFor(clientId);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).toBe(
      readFileSync(resolve(FIXTURES, file), 'utf8'),
    );
  });

  it('any other client id is a 404', async () => {
    expect((await documentFor('https://evil.example/client.json')).status).toBe(
      404,
    );
  });
});
