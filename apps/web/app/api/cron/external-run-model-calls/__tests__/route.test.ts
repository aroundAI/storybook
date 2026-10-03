import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1911: the hourly guard check. A model-usage row whose run is external
 * means the FILM-1903 lock failed; the route raises it through the monitoring
 * service (Sentry when MONITORING_PROVIDER is set) and an error log line with
 * a stable tag, and stays quiet when there is none.
 */

const rpc = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({ rpc }),
}));

vi.mock('@kit/monitoring/server', () => ({
  getServerMonitoringService: async () => ({
    ready: async () => undefined,
    captureException,
  }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: logError,
  }),
}));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler:
    (handler: (args: { request: Request }) => Promise<Response>) =>
    (request: Request) =>
      handler({ request }),
}));

function cronRequest(authorization?: string) {
  return new Request('http://localhost/api/cron/external-run-model-calls', {
    headers: authorization ? { authorization } : {},
  });
}

async function call(request: Request) {
  const { GET } = await import('../route');

  return GET(request as never, {} as never);
}

const violation = {
  usage_id: '19110000-0000-4000-8000-0000000000f1',
  run_id: '19110000-0000-4000-8000-0000000000e1',
  account_id: '19110000-0000-4000-8000-00000000000a',
  created_at: '2026-10-03T12:00:00Z',
  total: 2,
};

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  rpc.mockReset();
  captureException.mockReset();
  logError.mockReset();
});

describe('the external-run-model-calls cron', () => {
  it('stays quiet when no external run has a model call', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(rpc).toHaveBeenCalledExactlyOnceWith('external_run_model_calls', {
      p_limit: 20,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, violations: 0 });
    expect(captureException).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('raises an alert with the ids when the guard has failed', async () => {
    rpc.mockResolvedValue({ data: [violation], error: null });

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, violations: 2 });

    expect(captureException).toHaveBeenCalledOnce();
    const [error, extra] = captureException.mock.calls[0]!;
    expect((error as Error).message).toBe(
      'MCP guard failed: 2 model-usage rows belong to external runs',
    );
    expect(extra).toEqual({
      alert: 'mcp.guard.external_run_model_call',
      violations: 2,
      usageIds: [violation.usage_id],
      runIds: [violation.run_id],
    });

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: 'mcp.guard.external_run_model_call',
        violations: 2,
      }),
      'MCP guard failed: 2 model-usage rows belong to external runs',
    );
  });

  it('reports a check that could not run as a 500 and an alert, not a pass', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function does not exist' },
    });

    const response = await call(cronRequest('Bearer test-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Guard check failed' });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it('refuses a caller without the cron secret, before touching the database', async () => {
    const response = await call(cronRequest('Bearer wrong'));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await call(cronRequest('Bearer '));

    expect(response.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
});
