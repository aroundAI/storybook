import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1903: the hourly cron marks runs past their lease expired through
 * `expire_generation_runs()`, behind the CRON_SECRET bearer check every cron
 * route uses. It then trims mcp_tool_calls older than 90 days (FILM-1904),
 * in bounded batches.
 */

const rpc = vi.hoisted(() => vi.fn());
const closeStaleEditSessions = vi.hoisted(() => vi.fn());

vi.mock('@kit/desktop-integration/server', () => ({
  closeStaleEditSessions,
}));

// FILM-2006's alerts have their own test (studio-delivery-alerts.test.ts)
vi.mock('../studio-delivery-alerts', () => ({
  raiseStudioDeliveryAlerts: vi.fn(async () => ({
    targetChanged: 0,
    alerts: [],
  })),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({ rpc }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler:
    (handler: (args: { request: Request }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request }),
}));

function cronRequest(authorization?: string) {
  return new Request('http://localhost/api/cron/expire-generation-runs', {
    headers: authorization ? { authorization } : {},
  });
}

async function call(request: Request) {
  const { GET } = await import('../route');

  return GET(request as never, {} as never);
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  rpc.mockReset();
  closeStaleEditSessions.mockReset();
  closeStaleEditSessions.mockResolvedValue({ closed: 0, failed: 0, ids: [] });
});

describe('the expire-generation-runs cron', () => {
  it('expires runs past their lease and reports how many', async () => {
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'expire_generation_runs' ? 3 : 0,
      error: null,
    }));

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(rpc).toHaveBeenNthCalledWith(1, 'expire_generation_runs');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      expired: 3,
      trimmed: 0,
      staleEditSessions: { closed: 0, failed: 0 },
    });
  });

  it('trims old tool calls batch by batch until a batch comes back short', async () => {
    const trims = [5000, 5000, 120];
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'expire_generation_runs' ? 0 : trims.shift(),
      error: null,
    }));

    const response = await call(cronRequest('Bearer test-cron-secret'));

    const trimCalls = rpc.mock.calls.filter(
      ([fn]) => fn === 'trim_mcp_tool_calls',
    );
    expect(trimCalls).toEqual([
      ['trim_mcp_tool_calls', { p_batch: 5000 }],
      ['trim_mcp_tool_calls', { p_batch: 5000 }],
      ['trim_mcp_tool_calls', { p_batch: 5000 }],
    ]);
    expect(await response.json()).toEqual({
      success: true,
      expired: 0,
      trimmed: 10120,
      staleEditSessions: { closed: 0, failed: 0 },
    });
  });

  it('stops after a bounded number of batches, leaving the rest to the next hour', async () => {
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'expire_generation_runs' ? 0 : 5000,
      error: null,
    }));

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(
      rpc.mock.calls.filter(([fn]) => fn === 'trim_mcp_tool_calls'),
    ).toHaveLength(20);
    expect(await response.json()).toEqual({
      success: true,
      expired: 0,
      trimmed: 100000,
      staleEditSessions: { closed: 0, failed: 0 },
    });
  });

  it('reports a failed trim as a 500, with what expiry and earlier batches did', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'expire_generation_runs'
        ? { data: 2, error: null }
        : { data: null, error: { message: 'boom' } },
    );

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'MCP tool-call trim failed',
      expired: 2,
      trimmed: 0,
      staleEditSessions: { closed: 0, failed: 0 },
    });
  });

  it('closes stale edit sessions with the admin client (FILM-2002) and reports them', async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    closeStaleEditSessions.mockResolvedValue({
      closed: 2,
      failed: 0,
      ids: ['s1', 's2'],
    });

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(closeStaleEditSessions).toHaveBeenCalledTimes(1);
    expect(closeStaleEditSessions.mock.calls[0]?.[0]).toHaveProperty('rpc');
    expect(await response.json()).toEqual({
      success: true,
      expired: 0,
      trimmed: 0,
      staleEditSessions: { closed: 2, failed: 0 },
    });
  });

  it('still trims when closing stale sessions fails, and reports a 500', async () => {
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'expire_generation_runs' ? 0 : 7,
      error: null,
    }));
    closeStaleEditSessions.mockRejectedValue(new Error('boom'));

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Closing stale edit sessions failed',
      expired: 0,
      trimmed: 7,
    });
  });

  it('refuses a caller without the cron secret, before touching the database', async () => {
    const response = await call(cronRequest('Bearer wrong'));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(closeStaleEditSessions).not.toHaveBeenCalled();
  });

  it('refuses a caller with no Authorization header', async () => {
    const response = await call(cronRequest());

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await call(cronRequest('Bearer '));

    expect(response.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a failed expiry as a 500, not a success', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function does not exist' },
    });

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Generation run expiry failed',
    });
  });
});
