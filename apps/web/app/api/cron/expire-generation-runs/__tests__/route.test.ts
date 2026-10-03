import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1903: the hourly cron marks runs past their lease expired through
 * `expire_generation_runs()`, behind the CRON_SECRET bearer check every cron
 * route uses.
 */

const rpc = vi.hoisted(() => vi.fn());

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
});

describe('the expire-generation-runs cron', () => {
  it('expires runs past their lease and reports how many', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(rpc).toHaveBeenCalledExactlyOnceWith('expire_generation_runs');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, expired: 3 });
  });

  it('refuses a caller without the cron secret, before touching the database', async () => {
    const response = await call(cronRequest('Bearer wrong'));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
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
