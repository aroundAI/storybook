import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../index';

/**
 * FILM-1911: the guard Lambda fails when the check finds a model call on an
 * external run, or cannot run, because McpGuardFailedAlarm (sst.config.ts)
 * counts this function's errors. A clean check succeeds.
 */

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('API_URL', 'https://app.example/');
  vi.stubEnv('CRON_SECRET', 'secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the MCP guard Lambda', () => {
  it('succeeds when no external run has a model call', async () => {
    reply(200, { success: true, violations: 0 });

    await expect(handler()).resolves.toEqual({ success: true, violations: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example/api/cron/external-run-model-calls',
      { method: 'GET', headers: { Authorization: 'Bearer secret' } },
    );
  });

  it('fails when the check finds model calls on external runs', async () => {
    reply(200, { success: true, violations: 2 });

    await expect(handler()).rejects.toThrow(
      'MCP guard failed: 2 model-usage rows belong to external runs',
    );
  });

  it('fails when the check could not run', async () => {
    reply(500, { error: 'Guard check failed' });

    await expect(handler()).rejects.toThrow(
      'MCP guard check could not run: HTTP 500',
    );
  });

  it('fails when it is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');

    await expect(handler()).rejects.toThrow(
      'MCP guard check could not run: API_URL or CRON_SECRET not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
