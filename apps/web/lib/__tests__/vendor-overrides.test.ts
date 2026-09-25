import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportIgnoredVendorOverrides } from '../vendor-overrides';

const error = vi.fn();

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({ error })),
}));

/**
 * FILM-1801 §3: in production a `VENDOR_URL_*` is logged as an error and
 * ignored. The ignoring is `vendorUrl`'s and is tested in `@kit/shared`; this
 * is the logging.
 */
describe('reportIgnoredVendorOverrides', () => {
  beforeEach(() => {
    error.mockClear();
  });

  it('logs each override present in production as an error, by name only', async () => {
    const ignored = await reportIgnoredVendorOverrides({
      NODE_ENV: 'production',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: 'http://localhost:4102',
      VENDOR_URL_META_GRAPH: 'https://collector.example.com',
    });

    expect(ignored).toEqual(['VENDOR_URL_META_GRAPH', 'VENDOR_URL_TIKTOK']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toEqual({
      name: 'vendor-overrides',
      ignored: ['VENDOR_URL_META_GRAPH', 'VENDOR_URL_TIKTOK'],
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('collector');
  });

  it('says nothing when production carries no override', async () => {
    await reportIgnoredVendorOverrides({ NODE_ENV: 'production' });

    expect(error).not.toHaveBeenCalled();
  });

  it('logs a set LLM SDK base-URL variable by name only, even with the sandbox on (FILM-1805)', async () => {
    const ignored = await reportIgnoredVendorOverrides({
      NODE_ENV: 'development',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_GEMINI: 'http://127.0.0.1:4112',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
      GOOGLE_GEMINI_BASE_URL: 'https://proxy.example.com',
    });

    expect(ignored).toEqual(['GOOGLE_GEMINI_BASE_URL', 'OPENAI_BASE_URL']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toEqual({
      name: 'vendor-overrides',
      ignored: ['GOOGLE_GEMINI_BASE_URL', 'OPENAI_BASE_URL'],
    });
    expect(error.mock.calls[0]?.[1]).toContain('SDK base-URL variable');
    expect(JSON.stringify(error.mock.calls)).not.toContain('proxy.example');
  });

  it('says nothing about an override that is being honoured', async () => {
    await reportIgnoredVendorOverrides({
      NODE_ENV: 'development',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: 'http://localhost:4102',
    });

    expect(error).not.toHaveBeenCalled();
  });
});
